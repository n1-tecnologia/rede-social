import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ModerationLogPage } from '@rede-social/contracts/moderation';
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import type { CommentDeleted, FeedComment, FeedPost } from '@rede-social/module-feed/contracts';
import type { StoryComment } from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, runNotificationJobs, SEED_PASSWORD, signInAs } from './setup';

/**
 * 08-01 — the Phase 8 tracer (MODER-01 into MODER-03) end to end against the live local stack.
 *
 * `moderation tracer`: the demo admin removes a ROOT comment the demo member wrote, with two replies
 * by another member, through `DELETE /v1/feed/comments/{id}`. What is proved here and nowhere else:
 *  - D-334: the root and both replies carry `deleted_at` + `deleted_by_user_id`, the post's count
 *    drops by 3, and one `comment.deleted` per removed id retracts the replies' "X respondeu" rows;
 *  - D-337 / MODER-03: exactly ONE `moderation_log` row, anchored to the two MEMBERSHIPS of this
 *    tenant, with the root's body as the excerpt, listed first by `GET /v1/admin/moderation-log`;
 *  - T-08-05 (atomicity): a forced failure of the log insert rolls the removal back;
 *  - D-335 (silence): no notification row is created for the author;
 *  - Pitfall 2 / MODER-03 adjacency: an author's own delete (a moderator's included) logs nothing;
 *  - D-338: member and support get the bare 404 on someone else's comment and 403 on the log;
 *  - idempotency and concurrency of both the removal and the log;
 *  - D-336 (feed half): a story comment id on the feed route stays the bare 404 (07 review B-WR-03).
 *
 * The log is APPEND-ONLY (08-01 Task 2), so this suite never deletes log rows: every assertion is
 * scoped by the subject id it created, and a reset database is the clean slate (`pnpm db:reset`).
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const tokens = { admin: '', admin2: '', member: '', other: '', support: '' };
const ids = { tenant: '', admin: '', member: '', other: '', support: '' };
const memberships = { admin: '', member: '' };

const CAPTION_PREFIX = 'Moderacao de teste';
const BODY_PREFIX = 'Comentario moderado';
const createdPosts: string[] = [];
const createdStories: string[] = [];
const createdAssets: string[] = [];

const deletedEvents: CommentDeleted[] = [];
const unsubscribers: (() => void)[] = [];

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'x-tenant-host': HOSTS.demo,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const remove = (token: string, commentId: string) =>
  request(`/v1/feed/comments/${commentId}`, token, { method: 'DELETE' });

async function seedPost(label: string): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, caption, author_user_id)
    values (${ids.tenant}::uuid, ${`${CAPTION_PREFIX} ${label}`}, ${ids.admin}::uuid)
    returning id`;
  const id = rows[0]?.id ?? '';
  createdPosts.push(id);
  return id;
}

async function comment(
  token: string,
  postId: string,
  body: string,
  parentId?: string,
): Promise<FeedComment> {
  const res = await request(`/v1/feed/posts/${postId}/comments`, token, {
    method: 'POST',
    body: JSON.stringify(parentId ? { body, parentId } : { body }),
  });
  expect(res.status, `POST comment ${body}`).toBe(201);
  return (await res.json()) as FeedComment;
}

async function commentCount(postId: string): Promise<number> {
  const res = await request(`/v1/feed/posts/${postId}`, tokens.member);
  expect(res.status).toBe(200);
  return ((await res.json()) as FeedPost).commentCount;
}

type LogRow = {
  id: string;
  tenant_id: string;
  action: string;
  actor_user_id: string;
  actor_membership_id: string;
  target_user_id: string;
  target_membership_id: string;
  subject_type: string | null;
  subject_id: string | null;
  excerpt: string | null;
  reason: string | null;
};

const logRowsFor = (subjectId: string) =>
  adminSql<LogRow[]>`
    select id::text, tenant_id::text, action, actor_user_id::text, actor_membership_id::text,
           target_user_id::text, target_membership_id::text, subject_type, subject_id::text,
           excerpt, reason
      from public.moderation_log
     where subject_id = ${subjectId}::uuid`;

const commentState = (commentIds: string[]) =>
  adminSql<{ id: string; deleted_at: Date | null; deleted_by_user_id: string | null }[]>`
    select id::text, deleted_at, deleted_by_user_id::text
      from public.feed_comments where id = any(${commentIds}::uuid[])`;

async function getLog(token: string, query = ''): Promise<Response> {
  return request(`/v1/admin/moderation-log${query}`, token);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  // A SECOND session of the same admin: the concurrency case races two moderator sessions.
  tokens.admin2 = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);

  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text from public.tenants where slug = 'rede-demo'`;
  ids.tenant = tenant?.id ?? '';

  const people = await adminSql<{ email: string; user_id: string; membership_id: string }[]>`
    select u.email, u.id::text as user_id, m.id::text as membership_id
      from public.users u join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${ids.tenant}::uuid`;
  const byEmail = new Map(people.map((p) => [p.email, p]));
  ids.admin = byEmail.get('admin@rede-demo.local')?.user_id ?? '';
  ids.member = byEmail.get('member@rede-demo.local')?.user_id ?? '';
  ids.support = byEmail.get('support@rede-demo.local')?.user_id ?? '';
  memberships.admin = byEmail.get('admin@rede-demo.local')?.membership_id ?? '';
  memberships.member = byEmail.get('member@rede-demo.local')?.membership_id ?? '';

  // A second ordinary member writes the replies, so "X respondeu" rows exist for the root author.
  const [other] = await adminSql<{ email: string; user_id: string }[]>`
    select u.email, u.id::text as user_id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${ids.tenant}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and u.email <> 'member@rede-demo.local'
     order by u.email limit 1`;
  if (!other) throw new Error('the seed must provide a second demo member');
  ids.other = other.user_id;
  tokens.other = await signInAs(other.email, SEED_PASSWORD);

  unsubscribers.push(
    subscribe('comment.deleted', async (payload) => {
      deletedEvents.push(payload);
    }),
  );
});

afterAll(async () => {
  for (const off of unsubscribers) off();
  if (createdPosts.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${createdPosts}::uuid[])`;
    await adminSql`delete from public.feed_posts where id = any(${createdPosts}::uuid[])`;
  }
  await adminSql`delete from public.feed_posts where caption like ${`${CAPTION_PREFIX}%`}`;
  if (createdStories.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${createdStories}::uuid[])`;
    await adminSql`delete from public.stories where id = any(${createdStories}::uuid[])`;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
  }
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'
       and data->>'tenantId' = ${ids.tenant}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('moderation tracer', () => {
  it('the admin removes a member’s root with two replies: cascade, one anchored log row, retraction, silence', async () => {
    const postId = await seedPost('tracer');
    const rootBody = `${BODY_PREFIX} raiz\ncom duas linhas`;
    const root = await comment(tokens.member, postId, rootBody);
    const r1 = await comment(tokens.other, postId, `${BODY_PREFIX} resposta 1`, root.id);
    const r2 = await comment(tokens.other, postId, `${BODY_PREFIX} resposta 2`, root.id);
    // The "X respondeu" rows for the root's author exist before the removal.
    await runNotificationJobs(ids.tenant);
    const before = await adminSql<{ id: string; object_id: string; payload: unknown }[]>`
      select id::text, object_id::text, payload from public.notifications
       where subject_id = ${postId}::uuid and user_id = ${ids.member}::uuid`;
    expect(before.map((row) => row.object_id).sort()).toEqual([r1.id, r2.id].sort());
    const memberRowsBefore = before.length;

    // The admin's read derives the moderation removal; the member's own read derives `own`.
    const page = (await (
      await request(`/v1/feed/posts/${postId}/comments`, tokens.admin)
    ).json()) as { items: FeedComment[] };
    expect(page.items.find((c) => c.id === root.id)).toMatchObject({
      removal: 'moderation',
      canDelete: true,
    });
    const ownPage = (await (
      await request(`/v1/feed/posts/${postId}/comments`, tokens.member)
    ).json()) as { items: FeedComment[] };
    expect(ownPage.items.find((c) => c.id === root.id)?.removal).toBe('own');
    const otherPage = (await (
      await request(`/v1/feed/posts/${postId}/comments`, tokens.other)
    ).json()) as { items: FeedComment[] };
    expect(otherPage.items.find((c) => c.id === root.id)).toMatchObject({
      removal: null,
      canDelete: false,
    });

    expect(await commentCount(postId)).toBe(3);
    const eventsBefore = deletedEvents.length;

    const res = await remove(tokens.admin, root.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    // D-334: the root and both replies, stamped with the actor.
    const state = await commentState([root.id, r1.id, r2.id]);
    expect(state).toHaveLength(3);
    for (const row of state) {
      expect(row.deleted_at).not.toBeNull();
      expect(row.deleted_by_user_id).toBe(ids.admin);
    }
    expect(await commentCount(postId)).toBe(0);

    // One event per removed id (the retraction's input).
    const emitted = deletedEvents.slice(eventsBefore).map((e) => e.commentId);
    expect(emitted.sort()).toEqual([root.id, r1.id, r2.id].sort());

    // MODER-03: exactly one row, anchored to the two memberships of THIS tenant.
    const rows = await logRowsFor(root.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: ids.tenant,
      action: 'comment_removed',
      actor_user_id: ids.admin,
      actor_membership_id: memberships.admin,
      target_user_id: ids.member,
      target_membership_id: memberships.member,
      subject_type: 'post_comment',
      subject_id: root.id,
      excerpt: rootBody,
      reason: null,
    });
    const anchored = await adminSql<{ ok: boolean }[]>`
      select bool_and(a.tenant_id = l.tenant_id and t.tenant_id = l.tenant_id) as ok
        from public.moderation_log l
        join public.memberships a on a.id = l.actor_membership_id
        join public.memberships t on t.id = l.target_membership_id
       where l.subject_id = ${root.id}::uuid`;
    expect(anchored[0]?.ok).toBe(true);

    // The retraction marks the replies' rows; D-335: no NEW row of any kind for the author.
    await runNotificationJobs(ids.tenant);
    const after = await adminSql<{ object_id: string; payload: Record<string, unknown> }[]>`
      select object_id::text, payload from public.notifications
       where subject_id = ${postId}::uuid and user_id = ${ids.member}::uuid`;
    expect(after).toHaveLength(memberRowsBefore);
    for (const row of after) expect(row.payload).toEqual({ removed: true });

    // The log lists it first, with the excerpt and the admin marked as the viewer.
    const logRes = await getLog(tokens.admin);
    expect(logRes.status).toBe(200);
    expect(logRes.headers.get('cache-control')).toBe('no-store');
    const log = (await logRes.json()) as ModerationLogPage;
    expect(log.items[0]).toMatchObject({
      id: rows[0]?.id,
      action: 'comment_removed',
      actor: { membershipId: memberships.admin, isViewer: true },
      target: { membershipId: memberships.member },
      subjectType: 'post_comment',
      excerpt: rootBody,
      reason: null,
      details: null,
    });
    expect(log.items[0]?.target.displayName).not.toBeNull();

    // The post shows none of the three.
    const remaining = (await (
      await request(`/v1/feed/posts/${postId}/comments`, tokens.member)
    ).json()) as { items: FeedComment[] };
    expect(remaining.items).toHaveLength(0);
    const replies = (await (
      await request(`/v1/feed/comments/${root.id}/replies`, tokens.member)
    ).json()) as { items: FeedComment[] };
    expect(replies.items).toHaveLength(0);
  });

  it('atomicity: a failing log insert leaves the comment and its reply live, emits nothing and keeps the count', async () => {
    const postId = await seedPost('atomicity');
    const root = await comment(tokens.member, postId, `${BODY_PREFIX} atomico`);
    const reply = await comment(tokens.other, postId, `${BODY_PREFIX} atomico resposta`, root.id);
    const eventsBefore = deletedEvents.length;

    await adminSql.unsafe(`
      create or replace function public.test_moderation_log_fail() returns trigger
        language plpgsql as $$ begin raise exception 'forced log failure'; end $$;
      create trigger test_moderation_log_fail before insert on public.moderation_log
        for each row execute function public.test_moderation_log_fail();`);
    try {
      const res = await remove(tokens.admin, root.id);
      expect(res.status).toBe(500);
    } finally {
      await adminSql.unsafe(`
        drop trigger if exists test_moderation_log_fail on public.moderation_log;
        drop function if exists public.test_moderation_log_fail();`);
    }

    const state = await commentState([root.id, reply.id]);
    for (const row of state) {
      expect(row.deleted_at).toBeNull();
      expect(row.deleted_by_user_id).toBeNull();
    }
    expect(deletedEvents.length).toBe(eventsBefore);
    expect(await commentCount(postId)).toBe(2);
    expect(await logRowsFor(root.id)).toHaveLength(0);
  });

  it('an author deleting their own root with a reply cascades the same way and logs nothing', async () => {
    const postId = await seedPost('own root');
    const root = await comment(tokens.member, postId, `${BODY_PREFIX} proprio`);
    const reply = await comment(tokens.other, postId, `${BODY_PREFIX} proprio resposta`, root.id);
    expect(await commentCount(postId)).toBe(2);

    const res = await remove(tokens.member, root.id);
    expect(res.status).toBe(200);
    const state = await commentState([root.id, reply.id]);
    for (const row of state) {
      expect(row.deleted_at).not.toBeNull();
      expect(row.deleted_by_user_id).toBe(ids.member);
    }
    expect(await commentCount(postId)).toBe(0);
    expect(await logRowsFor(root.id)).toHaveLength(0);
  });

  it('a moderator deleting their OWN comment is an author delete: same response, no log row', async () => {
    const postId = await seedPost('admin own');
    const mine = await comment(tokens.admin, postId, `${BODY_PREFIX} do admin`);
    expect(mine.removal).toBe('own');
    const res = await remove(tokens.admin, mine.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(await logRowsFor(mine.id)).toHaveLength(0);
  });

  it('member and support cannot remove someone else’s comment: the ONE bare 404, row untouched', async () => {
    const postId = await seedPost('refusals');
    const theirs = await comment(tokens.other, postId, `${BODY_PREFIX} de outra pessoa`);
    for (const token of [tokens.member, tokens.support]) {
      const res = await remove(token, theirs.id);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
    }
    const [state] = await commentState([theirs.id]);
    expect(state?.deleted_at).toBeNull();
    expect(await logRowsFor(theirs.id)).toHaveLength(0);
    // An unknown id is indistinguishable.
    const unknown = await remove(tokens.admin, randomUUID());
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as Envelope).error.details).toBeUndefined();
  });

  it('member and support get 403 FORBIDDEN on the log', async () => {
    for (const token of [tokens.member, tokens.support]) {
      const res = await getLog(token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
    expect((await getLog('')).status).toBe(401);
  });

  it('idempotency: a second DELETE is the bare 404, with no second row, no event and no count change', async () => {
    const postId = await seedPost('idempotency');
    const theirs = await comment(tokens.member, postId, `${BODY_PREFIX} duas vezes`);
    expect((await remove(tokens.admin, theirs.id)).status).toBe(200);
    const eventsAfterFirst = deletedEvents.length;
    const countAfterFirst = await commentCount(postId);

    const again = await remove(tokens.admin, theirs.id);
    expect(again.status).toBe(404);
    expect(((await again.json()) as Envelope).error.details).toBeUndefined();
    expect(await logRowsFor(theirs.id)).toHaveLength(1);
    expect(deletedEvents.length).toBe(eventsAfterFirst);
    expect(await commentCount(postId)).toBe(countAfterFirst);
  });

  it('concurrency: two moderator sessions removing the SAME comment — one 200, one 404, one row', async () => {
    const postId = await seedPost('race same');
    const theirs = await comment(tokens.member, postId, `${BODY_PREFIX} corrida`);
    const results = await Promise.all([
      remove(tokens.admin, theirs.id),
      remove(tokens.admin2, theirs.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(await logRowsFor(theirs.id)).toHaveLength(1);
  });

  it('concurrency: two removals of DIFFERENT comments at once each get their own row', async () => {
    const postId = await seedPost('race different');
    const a = await comment(tokens.member, postId, `${BODY_PREFIX} paralelo A`);
    const b = await comment(tokens.other, postId, `${BODY_PREFIX} paralelo B`);
    const results = await Promise.all([remove(tokens.admin, a.id), remove(tokens.admin2, b.id)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await logRowsFor(a.id)).toHaveLength(1);
    expect(await logRowsFor(b.id)).toHaveLength(1);
    expect((await logRowsFor(b.id))[0]?.target_user_id).toBe(ids.other);
  });

  it('D-336 feed half: a STORY comment id on the feed route is the bare 404 and is untouched', async () => {
    const assetId = randomUUID();
    createdAssets.push(assetId);
    await adminSql`
      insert into public.media_assets
        (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${assetId}::uuid, ${ids.tenant}::uuid, ${ids.admin}::uuid, 'image', 'story', 'ready',
              'supabase', 'image/webp', 1024, '{640,1080}'::int[])`;
    const published = await request('/v1/stories', tokens.admin, {
      method: 'POST',
      body: JSON.stringify({ mediaAssetId: assetId, mediaKind: 'image', caption: '' }),
    });
    expect(published.status).toBe(201);
    const { id: storyId } = (await published.json()) as { id: string };
    createdStories.push(storyId);
    const commented = await request(`/v1/stories/${storyId}/comments`, tokens.member, {
      method: 'POST',
      body: JSON.stringify({ body: `${BODY_PREFIX} no story` }),
    });
    expect(commented.status).toBe(201);
    const { id: storyCommentId } = (await commented.json()) as { id: string };

    const res = await remove(tokens.admin, storyCommentId);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Envelope).error.details).toBeUndefined();
    const [state] = await commentState([storyCommentId]);
    expect(state?.deleted_at).toBeNull();
    expect(await logRowsFor(storyCommentId)).toHaveLength(0);
  });

  it('reading the log never writes, and the action filter narrows it', async () => {
    const [{ n: before } = { n: 0 }] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.moderation_log where tenant_id = ${ids.tenant}::uuid`;
    const all = (await (await getLog(tokens.admin)).json()) as ModerationLogPage;
    expect(all.items.length).toBeGreaterThan(0);
    const filtered = (await (
      await getLog(tokens.admin, '?action=member_blocked')
    ).json()) as ModerationLogPage;
    expect(filtered.items.every((item) => item.action === 'member_blocked')).toBe(true);
    expect((await getLog(tokens.admin, '?action=tudo')).status).toBe(400);
    const [{ n: afterReads } = { n: 0 }] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.moderation_log where tenant_id = ${ids.tenant}::uuid`;
    expect(afterReads).toBe(before);
  });
});

/**
 * 08-03 (D-336, MODER-01, T-08-14, T-08-17) — the stories module's own admin-delete path, through
 * `DELETE /v1/stories/{storyId}/comments/{commentId}`. Story comments are FLAT (nothing cascades),
 * and the response stays the shipped 204 whoever removed the row.
 */
describe('story', () => {
  const storyDeletedEvents: { commentId: string; storyId: string }[] = [];

  beforeAll(() => {
    unsubscribers.push(
      subscribe('story.comment_deleted', async (payload) => {
        storyDeletedEvents.push({ commentId: payload.commentId, storyId: payload.storyId });
      }),
    );
  });

  async function seedStory(): Promise<string> {
    const assetId = randomUUID();
    createdAssets.push(assetId);
    await adminSql`
      insert into public.media_assets
        (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${assetId}::uuid, ${ids.tenant}::uuid, ${ids.admin}::uuid, 'image', 'story', 'ready',
              'supabase', 'image/webp', 1024, '{640,1080}'::int[])`;
    const published = await request('/v1/stories', tokens.admin, {
      method: 'POST',
      body: JSON.stringify({ mediaAssetId: assetId, mediaKind: 'image', caption: '' }),
    });
    expect(published.status).toBe(201);
    const { id } = (await published.json()) as { id: string };
    createdStories.push(id);
    return id;
  }

  async function storyComment(token: string, storyId: string, body: string): Promise<StoryComment> {
    const res = await request(`/v1/stories/${storyId}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    expect(res.status, `POST story comment ${body}`).toBe(201);
    return (await res.json()) as StoryComment;
  }

  const removeStoryComment = (token: string, storyId: string, commentId: string) =>
    request(`/v1/stories/${storyId}/comments/${commentId}`, token, { method: 'DELETE' });

  async function storyCount(storyId: string): Promise<number> {
    const [row] = await adminSql<{ n: number }[]>`
      select comment_count::int as n from public.stories where id = ${storyId}::uuid`;
    return row?.n ?? -1;
  }

  async function listAs(token: string, storyId: string): Promise<StoryComment[]> {
    const res = await request(`/v1/stories/${storyId}/comments`, token);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: StoryComment[] }).items;
  }

  it('the admin removes a member’s story comment: 204, stamped, count −1, one story_comment row, retraction, silence', async () => {
    const storyId = await seedStory();
    const body = `${BODY_PREFIX} no story\ncom duas linhas`;
    const theirs = await storyComment(tokens.member, storyId, body);
    // The story author (the admin) holds a "comentou no seu story" row for this comment.
    await runNotificationJobs(ids.tenant);
    const authorRows = await adminSql<{ id: string }[]>`
      select id::text from public.notifications
       where user_id = ${ids.admin}::uuid and object_id = ${theirs.id}::uuid`;
    expect(authorRows).toHaveLength(1);
    const memberRowsBefore = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications where user_id = ${ids.member}::uuid`;

    // The read derives `removal` per viewer, server-side.
    expect((await listAs(tokens.admin, storyId)).find((c) => c.id === theirs.id)).toMatchObject({
      removal: 'moderation',
      canDelete: true,
    });
    expect((await listAs(tokens.member, storyId)).find((c) => c.id === theirs.id)?.removal).toBe(
      'own',
    );
    expect((await listAs(tokens.other, storyId)).find((c) => c.id === theirs.id)).toMatchObject({
      removal: null,
      canDelete: false,
    });

    expect(await storyCount(storyId)).toBe(1);
    const eventsBefore = storyDeletedEvents.length;

    const res = await removeStoryComment(tokens.admin, storyId, theirs.id);
    expect(res.status).toBe(204);

    const [state] = await commentState([theirs.id]);
    expect(state?.deleted_at).not.toBeNull();
    expect(state?.deleted_by_user_id).toBe(ids.admin);
    expect(await storyCount(storyId)).toBe(0);
    expect(storyDeletedEvents.slice(eventsBefore)).toEqual([{ commentId: theirs.id, storyId }]);

    const rows = await logRowsFor(theirs.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: ids.tenant,
      action: 'comment_removed',
      actor_user_id: ids.admin,
      actor_membership_id: memberships.admin,
      target_user_id: ids.member,
      target_membership_id: memberships.member,
      subject_type: 'story_comment',
      subject_id: theirs.id,
      excerpt: body,
      reason: null,
    });

    // The story author's row is retracted (keep-and-mark), and the comment's author gets nothing.
    await runNotificationJobs(ids.tenant);
    const retracted = await adminSql<{ payload: Record<string, unknown> }[]>`
      select payload from public.notifications
       where user_id = ${ids.admin}::uuid and object_id = ${theirs.id}::uuid`;
    expect(retracted).toHaveLength(1);
    expect(retracted[0]?.payload).toEqual({ removed: true });
    const memberRowsAfter = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications where user_id = ${ids.member}::uuid`;
    expect(memberRowsAfter[0]?.n).toBe(memberRowsBefore[0]?.n);

    // Moderação lists it, with the story subject type.
    const log = (await (await getLog(tokens.admin)).json()) as ModerationLogPage;
    expect(log.items.find((item) => item.id === rows[0]?.id)).toMatchObject({
      action: 'comment_removed',
      subjectType: 'story_comment',
      excerpt: body,
      actor: { isViewer: true },
    });
    expect(await listAs(tokens.member, storyId)).toHaveLength(0);
  });

  it('an admin removing their OWN story comment is an author delete: 204, no log row', async () => {
    const storyId = await seedStory();
    const mine = await storyComment(tokens.admin, storyId, `${BODY_PREFIX} story do admin`);
    expect(mine.removal).toBe('own');
    const res = await removeStoryComment(tokens.admin, storyId, mine.id);
    expect(res.status).toBe(204);
    const [state] = await commentState([mine.id]);
    expect(state?.deleted_by_user_id).toBe(ids.admin);
    expect(await logRowsFor(mine.id)).toHaveLength(0);
  });

  it('member and support on another member’s story comment get the ONE bare 404; the row is untouched', async () => {
    const storyId = await seedStory();
    const theirs = await storyComment(
      tokens.other,
      storyId,
      `${BODY_PREFIX} story de outra pessoa`,
    );
    for (const token of [tokens.member, tokens.support]) {
      const res = await removeStoryComment(token, storyId, theirs.id);
      expect(res.status).toBe(404);
      const envelope = (await res.json()) as Envelope;
      expect(envelope.error.code).toBe('NOT_FOUND');
      expect(envelope.error.details).toBeUndefined();
    }
    const [state] = await commentState([theirs.id]);
    expect(state?.deleted_at).toBeNull();
    expect(await logRowsFor(theirs.id)).toHaveLength(0);
    expect(await storyCount(storyId)).toBe(1);
  });

  it('a POST comment id on the story route is the bare 404 and is untouched', async () => {
    const storyId = await seedStory();
    const postId = await seedPost('story route');
    const postComment = await comment(tokens.member, postId, `${BODY_PREFIX} no post`);
    const res = await removeStoryComment(tokens.admin, storyId, postComment.id);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Envelope).error.details).toBeUndefined();
    const [state] = await commentState([postComment.id]);
    expect(state?.deleted_at).toBeNull();
    expect(await logRowsFor(postComment.id)).toHaveLength(0);
  });

  it('a story comment id under ANOTHER story is the bare 404', async () => {
    const storyA = await seedStory();
    const storyB = await seedStory();
    const theirs = await storyComment(tokens.member, storyA, `${BODY_PREFIX} story A`);
    const res = await removeStoryComment(tokens.admin, storyB, theirs.id);
    expect(res.status).toBe(404);
    const [state] = await commentState([theirs.id]);
    expect(state?.deleted_at).toBeNull();
  });

  it('a second removal is the bare 404, with no second row, no event and no count change', async () => {
    const storyId = await seedStory();
    const theirs = await storyComment(tokens.member, storyId, `${BODY_PREFIX} story duas vezes`);
    expect((await removeStoryComment(tokens.admin, storyId, theirs.id)).status).toBe(204);
    const eventsAfterFirst = storyDeletedEvents.length;
    const again = await removeStoryComment(tokens.admin2, storyId, theirs.id);
    expect(again.status).toBe(404);
    expect(((await again.json()) as Envelope).error.details).toBeUndefined();
    expect(await logRowsFor(theirs.id)).toHaveLength(1);
    expect(storyDeletedEvents.length).toBe(eventsAfterFirst);
    expect(await storyCount(storyId)).toBe(0);
  });

  it('atomicity: a failing log insert leaves the story comment live and the count unchanged', async () => {
    const storyId = await seedStory();
    const theirs = await storyComment(tokens.member, storyId, `${BODY_PREFIX} story atomico`);
    const eventsBefore = storyDeletedEvents.length;
    await adminSql.unsafe(`
      create or replace function public.test_moderation_log_fail() returns trigger
        language plpgsql as $$ begin raise exception 'forced log failure'; end $$;
      create trigger test_moderation_log_fail before insert on public.moderation_log
        for each row execute function public.test_moderation_log_fail();`);
    try {
      const res = await removeStoryComment(tokens.admin, storyId, theirs.id);
      expect(res.status).toBe(500);
    } finally {
      await adminSql.unsafe(`
        drop trigger if exists test_moderation_log_fail on public.moderation_log;
        drop function if exists public.test_moderation_log_fail();`);
    }
    const [state] = await commentState([theirs.id]);
    expect(state?.deleted_at).toBeNull();
    expect(state?.deleted_by_user_id).toBeNull();
    expect(storyDeletedEvents.length).toBe(eventsBefore);
    expect(await storyCount(storyId)).toBe(1);
    expect(await logRowsFor(theirs.id)).toHaveLength(0);
  });
});

/**
 * 08-01 Task 2: the one-off DATA repair of replies orphaned under a root deleted the pre-Phase-8 way.
 * The statement is read from the migration file itself, so this case runs exactly what production
 * runs — twice, to prove it idempotent.
 */
describe('orphan repair', () => {
  const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
  const repairFile = readdirSync(migrationsDir).find((file) =>
    file.endsWith('_feed_comments_orphan_replies.sql'),
  );

  it('soft-deletes a live reply of an already-deleted root once, keeps it identifiable, and the count follows', async () => {
    expect(repairFile, 'the orphan-repair migration exists').toBeDefined();
    const repair = readFileSync(`${migrationsDir}${repairFile}`, 'utf8');

    const postId = await seedPost('orphan repair');
    const [root] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
      values (${ids.tenant}::uuid, ${postId}::uuid, ${ids.member}::uuid, ${`${BODY_PREFIX} raiz legada`})
      returning id::text`;
    const [reply] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments
        (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
      values (${ids.tenant}::uuid, ${postId}::uuid, ${ids.other}::uuid,
              ${`${BODY_PREFIX} resposta legada`}, 1, ${root?.id ?? ''}::uuid, 0, 'post')
      returning id::text`;
    expect(await commentCount(postId)).toBe(2);

    // The LEGACY delete: the root alone, `deleted_at` only (what `deleteComment` did before 08-01).
    await adminSql`
      update public.feed_comments set deleted_at = now() where id = ${root?.id ?? ''}::uuid`;
    expect(await commentCount(postId)).toBe(1);

    await adminSql.unsafe(repair);
    const once = await adminSql<
      { id: string; deleted_at: Date | null; deleted_by_user_id: string | null }[]
    >`
      select r.id::text, r.deleted_at, r.deleted_by_user_id::text
        from public.feed_comments r where r.id = ${reply?.id ?? ''}::uuid`;
    const [rootAfter] = await adminSql<{ deleted_at: Date }[]>`
      select deleted_at from public.feed_comments where id = ${root?.id ?? ''}::uuid`;
    expect(once[0]?.deleted_at?.getTime()).toBe(rootAfter?.deleted_at.getTime());
    // Identifiable: the repair never names an actor.
    expect(once[0]?.deleted_by_user_id).toBeNull();
    expect(await commentCount(postId)).toBe(0);

    // Idempotent: a second run changes nothing, and the count still equals the live rows.
    await adminSql.unsafe(repair);
    const twice = await adminSql<{ deleted_at: Date | null }[]>`
      select deleted_at from public.feed_comments where id = ${reply?.id ?? ''}::uuid`;
    expect(twice[0]?.deleted_at?.getTime()).toBe(once[0]?.deleted_at?.getTime());
    const [live] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments
       where post_id = ${postId}::uuid and deleted_at is null`;
    expect(await commentCount(postId)).toBe(live?.n);
    expect(live?.n).toBe(0);
  });
});
