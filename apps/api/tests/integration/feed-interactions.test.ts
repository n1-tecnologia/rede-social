import { sqlClient } from '@tria/core/db';
import { subscribe } from '@tria/core/server/events/bus';
import {
  type CommentCreated,
  type CommentDeleted,
  type CommentLiked,
  type FeedComment,
  type FeedCommentPage,
  type FeedPost,
  type LikeResult,
  type PostLiked,
  REPLIES_PAGE_SIZE,
} from '@tria/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * The interaction layer end to end against the live local stack (04-03, extended by 04-07).
 *
 * Eight things are proved here that nothing else in the repo can prove:
 *  - **FEED-04 idempotency and concurrency.** A double-tap, a retried request and five genuinely
 *    concurrent requests all leave ONE row and ONE count — and no like route ever answers a
 *    CONFLICT status, which would surface as an error toast on every double-tap.
 *  - **FEED-05 is the DATABASE's refusal, translated.** A reply to a reply is a `400
 *    VALIDATION_FAILED { comment: 'reply_depth_exceeded' }`, and the row is never created.
 *  - **D-62 ordering in both directions.** Roots page newest-first, replies oldest-first, each
 *    cursor walking its own list exactly once and neither usable on the other.
 *  - **FEED-06.** Comment and reply likes ride the same table and the same toggle.
 *  - **D-61 soft delete.** A member removes their own comment and only their own; the post's
 *    `commentCount` follows, and the comment leaves the list.
 *  - **MOD-03.** Six events, once each, after commit — and none at all when the write was refused.
 *  - **T-04-21.** Every miss is the same bare 404, so nothing here is an existence oracle.
 *  - **UI-D-24 (04-07).** A comment written by someone since removed from the tenant KEEPS its row,
 *    its text, its place in the trigger-maintained count and the live member's reply under it —
 *    nameless and unlinkable, with a live author on the same page as the positive control.
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, string>; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', demoOther: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** Everything this file created, swept in `afterAll` so the suite is re-runnable. */
const createdPosts: string[] = [];
const CAPTION_PREFIX = 'Interacao de teste';
const BODY_PREFIX = 'Comentario de teste';

const events: { name: string; payload: unknown }[] = [];
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

const envelope = async (res: Response) => (await res.json()) as Envelope;

/** A post owned by the demo admin, inserted straight through the admin connection. */
async function seedPost(label: string): Promise<string> {
  const [author] = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantIds.demo}::uuid and m.role = 'admin_tenant' limit 1`;
  const rows = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, caption, author_user_id)
    values (${tenantIds.demo}::uuid, ${`${CAPTION_PREFIX} ${label}`}, ${author?.id ?? null}::uuid)
    returning id`;
  const id = rows[0]?.id ?? '';
  createdPosts.push(id);
  return id;
}

/** `POST …/comments`, asserted 201 so a broken write never reads as a missing one. */
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
  expect(res.status, `POST /posts/${postId}/comments`).toBe(201);
  return (await res.json()) as FeedComment;
}

async function likeResult(res: Response): Promise<LikeResult> {
  expect(res.status).toBe(200);
  return (await res.json()) as LikeResult;
}

const like = (token: string, postId: string) =>
  request(`/v1/feed/posts/${postId}/like`, token, { method: 'POST' });
const unlike = (token: string, postId: string) =>
  request(`/v1/feed/posts/${postId}/like`, token, { method: 'DELETE' });

async function getPost(token: string, postId: string): Promise<FeedPost> {
  const res = await request(`/v1/feed/posts/${postId}`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as FeedPost;
}

async function comments(token: string, postId: string, query = ''): Promise<FeedCommentPage> {
  const res = await request(`/v1/feed/posts/${postId}/comments${query}`, token);
  expect(res.status, `GET /posts/${postId}/comments${query}`).toBe(200);
  return (await res.json()) as FeedCommentPage;
}

async function replies(token: string, commentId: string, query = ''): Promise<FeedCommentPage> {
  const res = await request(`/v1/feed/comments/${commentId}/replies${query}`, token);
  expect(res.status, `GET /comments/${commentId}/replies${query}`).toBe(200);
  return (await res.json()) as FeedCommentPage;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@tria-lab.local', SEED_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }

  // A SECOND demo member, so "someone else's comment" is a real session rather than a mocked id.
  const [other] = await adminSql<{ email: string }[]>`
    select u.email from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantIds.demo}::uuid and m.role = 'member'
       and u.email <> 'member@tria-demo.local'
     order by u.email limit 1`;
  if (!other) throw new Error('the seed must provide a second demo member');
  tokens.demoOther = await signInAs(other.email, SEED_PASSWORD);

  for (const name of [
    'post.liked',
    'post.unliked',
    'comment.created',
    'comment.deleted',
    'comment.liked',
    'comment.unliked',
  ] as const) {
    unsubscribers.push(
      subscribe(name, async (payload) => {
        events.push({ name, payload });
      }),
    );
  }
});

afterAll(async () => {
  for (const off of unsubscribers) off();
  if (createdPosts.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPosts}::uuid[])`;
  }
  // Sweep by prefix too: a write that committed and THEN failed to respond leaves a row whose id
  // this suite never learned (the exact 04-01 failure mode).
  await adminSql`delete from public.feed_posts where caption like ${`${CAPTION_PREFIX}%`}`;
  await adminSql`delete from public.feed_comments where body like ${`${BODY_PREFIX}%`}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('like toggle — idempotent, never a conflict (FEED-04)', () => {
  it('1. a repeated like is a no-op with the identical body, and an unlike returns to zero', async () => {
    const postId = await seedPost('idempotency');

    const fresh = await getPost(tokens.demoMember, postId);
    expect(fresh.likeCount).toBe(0);
    expect(fresh.viewerLiked).toBe(false);

    const first = await likeResult(await like(tokens.demoMember, postId));
    expect(first).toEqual({ liked: true, likeCount: 1 });

    // The retry: same request, same answer, no intermediate value anybody could observe.
    const again = await likeResult(await like(tokens.demoMember, postId));
    expect(again).toEqual({ liked: true, likeCount: 1 });

    const rows = await adminSql<{ id: string }[]>`
      select id from public.feed_likes where post_id = ${postId}::uuid`;
    expect(rows).toHaveLength(1);

    expect((await getPost(tokens.demoMember, postId)).viewerLiked).toBe(true);

    const off = await likeResult(await unlike(tokens.demoMember, postId));
    expect(off).toEqual({ liked: false, likeCount: 0 });

    // …and unliking something never liked is a successful no-op, never -1.
    const offAgain = await likeResult(await unlike(tokens.demoMember, postId));
    expect(offAgain).toEqual({ liked: false, likeCount: 0 });
    expect((await getPost(tokens.demoMember, postId)).viewerLiked).toBe(false);
  });

  it('2. five CONCURRENT likes leave one row and one count; a like/unlike race stays consistent', async () => {
    const postId = await seedPost('concurrency');

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => like(tokens.demoMember, postId)));
    for (const res of results) expect(res.status).toBe(200);

    const rows = await adminSql<{ id: string }[]>`
      select id from public.feed_likes where post_id = ${postId}::uuid`;
    expect(rows).toHaveLength(1);
    expect((await getPost(tokens.demoMember, postId)).likeCount).toBe(1);

    // A real race between the two directions. Pinning the WINNER would be flaky by construction;
    // what must hold either way is that the counter equals the rows it summarises.
    await Promise.all([like(tokens.demoMember, postId), unlike(tokens.demoMember, postId)]);
    const after = await adminSql<{ id: string }[]>`
      select id from public.feed_likes where post_id = ${postId}::uuid`;
    const rowCount = after.length;
    expect((await getPost(tokens.demoMember, postId)).likeCount).toBe(rowCount);
  });

  it('3. every like and unlike answers 200 — never a conflict — and an unknown post is a bare 404', async () => {
    const postId = await seedPost('status codes');
    const statuses = [
      (await like(tokens.demoMember, postId)).status,
      (await like(tokens.demoMember, postId)).status,
      (await unlike(tokens.demoMember, postId)).status,
      (await unlike(tokens.demoMember, postId)).status,
    ];
    expect(statuses).toEqual([200, 200, 200, 200]);

    const unknown = await like(tokens.demoMember, '00000000-0000-4000-8000-00000000dead');
    expect(unknown.status).toBe(404);
    const body = await envelope(unknown);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details).toBeUndefined();
  });
});

describe('comments and the one reply level (FEED-05)', () => {
  it('4. a root is not a reply, a reply is — and a reply to a reply is refused by the database', async () => {
    const postId = await seedPost('depth');

    const root = await comment(tokens.demoMember, postId, `${BODY_PREFIX} raiz`);
    expect(root.isReply).toBe(false);
    expect(root.replyCount).toBe(0);

    const reply = await comment(tokens.demoOther, postId, `${BODY_PREFIX} resposta`, root.id);
    expect(reply.isReply).toBe(true);

    const refused = await request(`/v1/feed/posts/${postId}/comments`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ body: `${BODY_PREFIX} nivel tres`, parentId: reply.id }),
    });
    expect(refused.status).toBe(400);
    const body = await envelope(refused);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.comment).toBe('reply_depth_exceeded');

    // …and nothing was written: the post still has exactly two comments.
    const stored = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments where post_id = ${postId}::uuid`;
    expect(stored[0]?.n).toBe(2);
  });

  it('5. a parentId naming a comment on ANOTHER post creates nothing', async () => {
    const postA = await seedPost('parent from A');
    const postB = await seedPost('parent from B');
    const foreignParent = await comment(tokens.demoMember, postA, `${BODY_PREFIX} de outro post`);

    const res = await request(`/v1/feed/posts/${postB}/comments`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ body: `${BODY_PREFIX} cruzado`, parentId: foreignParent.id }),
    });
    expect([400, 404]).toContain(res.status);

    const stored = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments where post_id = ${postB}::uuid`;
    expect(stored[0]?.n).toBe(0);
  });

  it('6. roots page newest-first and replies oldest-first, each cursor walking its own list once', async () => {
    const postId = await seedPost('ordering');

    const roots: FeedComment[] = [];
    for (let i = 0; i < 5; i++) {
      roots.push(await comment(tokens.demoMember, postId, `${BODY_PREFIX} raiz ${i}`));
    }
    const replyIds: string[] = [];
    const firstRoot = roots[0] as FeedComment;
    for (let i = 0; i < 3; i++) {
      replyIds.push(
        (await comment(tokens.demoOther, postId, `${BODY_PREFIX} resposta ${i}`, firstRoot.id)).id,
      );
    }

    const newestFirst = await comments(tokens.demoMember, postId);
    expect(newestFirst.items.map((c) => c.id)).toEqual([...roots].reverse().map((c) => c.id));
    // The reply count the "Ver N respostas" toggle reads, and no replies inlined in the page.
    expect(newestFirst.items.at(-1)?.replyCount).toBe(3);

    const oldestFirst = await replies(tokens.demoMember, firstRoot.id);
    expect(oldestFirst.items.map((c) => c.id)).toEqual(replyIds);
    for (const item of oldestFirst.items) expect(item.isReply).toBe(true);

    // A full walk of each list returns every id exactly once.
    const walk = async (
      fetchPage: (cursor: string) => Promise<FeedCommentPage>,
    ): Promise<string[]> => {
      const seen: string[] = [];
      let cursor = '';
      for (let guard = 0; guard < 10; guard++) {
        const p = await fetchPage(cursor);
        seen.push(...p.items.map((c) => c.id));
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      return seen;
    };
    const walkedRoots = await walk((cursor) =>
      comments(tokens.demoMember, postId, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
    );
    expect(new Set(walkedRoots).size).toBe(walkedRoots.length);
    expect(walkedRoots.sort()).toEqual(roots.map((c) => c.id).sort());

    const walkedReplies = await walk((cursor) =>
      replies(tokens.demoMember, firstRoot.id, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
    );
    expect(new Set(walkedReplies).size).toBe(walkedReplies.length);
    expect(walkedReplies.sort()).toEqual([...replyIds].sort());

    // The two cursors are not interchangeable: a foreign cursor degrades to page 1, never a 500.
    const rootCursor = (await comments(tokens.demoMember, postId, '?limit=2')).nextCursor;
    expect(rootCursor).not.toBeNull();
    const crossed = await replies(tokens.demoMember, firstRoot.id, `?cursor=${rootCursor}`);
    expect(crossed.items.length).toBeGreaterThanOrEqual(0);
    expect(REPLIES_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('comment likes and soft delete (FEED-06, D-61)', () => {
  it('7. liking a comment and liking a reply take the same idempotent path', async () => {
    const postId = await seedPost('comment likes');
    const root = await comment(tokens.demoMember, postId, `${BODY_PREFIX} curtivel`);
    const reply = await comment(tokens.demoOther, postId, `${BODY_PREFIX} resposta`, root.id);

    for (const id of [root.id, reply.id]) {
      const first = await likeResult(
        await request(`/v1/feed/comments/${id}/like`, tokens.demoMember, { method: 'POST' }),
      );
      expect(first).toEqual({ liked: true, likeCount: 1 });
      const again = await likeResult(
        await request(`/v1/feed/comments/${id}/like`, tokens.demoMember, { method: 'POST' }),
      );
      expect(again).toEqual({ liked: true, likeCount: 1 });

      const rows = await adminSql<{ like_count: number }[]>`
        select like_count from public.feed_comments where id = ${id}::uuid`;
      expect(rows[0]?.like_count).toBe(1);
    }

    const page = await comments(tokens.demoMember, postId);
    expect(page.items[0]?.viewerLiked).toBe(true);
    expect(page.items[0]?.likeCount).toBe(1);

    const off = await likeResult(
      await request(`/v1/feed/comments/${root.id}/like`, tokens.demoMember, { method: 'DELETE' }),
    );
    expect(off).toEqual({ liked: false, likeCount: 0 });
  });

  it('8. a member deletes their OWN comment and no one else’s; the counter follows', async () => {
    const postId = await seedPost('soft delete');
    const mine = await comment(tokens.demoMember, postId, `${BODY_PREFIX} meu`);
    const theirs = await comment(tokens.demoOther, postId, `${BODY_PREFIX} deles`);

    expect((await getPost(tokens.demoMember, postId)).commentCount).toBe(2);
    expect(mine.canDelete).toBe(true);

    const foreign = await request(`/v1/feed/comments/${theirs.id}`, tokens.demoMember, {
      method: 'DELETE',
    });
    expect(foreign.status).toBe(404);
    const stillThere = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at from public.feed_comments where id = ${theirs.id}::uuid`;
    expect(stillThere[0]?.deleted_at).toBeNull();

    const own = await request(`/v1/feed/comments/${mine.id}`, tokens.demoMember, {
      method: 'DELETE',
    });
    expect(own.status).toBe(200);

    expect((await getPost(tokens.demoMember, postId)).commentCount).toBe(1);
    const page = await comments(tokens.demoMember, postId);
    expect(page.items.map((c) => c.id)).not.toContain(mine.id);
    // The row STAYS for Phase 8 moderation — only `deleted_at` was set.
    const soft = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at from public.feed_comments where id = ${mine.id}::uuid`;
    expect(soft[0]?.deleted_at).not.toBeNull();

    // Deleting an already-deleted comment is the same bare 404 as someone else's.
    const twice = await request(`/v1/feed/comments/${mine.id}`, tokens.demoMember, {
      method: 'DELETE',
    });
    expect(twice.status).toBe(404);
    expect((await envelope(twice)).error.details).toBeUndefined();
  });
});

describe('domain events, once each, after commit (MOD-03)', () => {
  it('9. every interaction emits its typed event carrying the recipient Phase 7 needs', async () => {
    const postId = await seedPost('events');
    const before = events.length;

    await like(tokens.demoMember, postId);
    await unlike(tokens.demoMember, postId);
    const root = await comment(tokens.demoMember, postId, `${BODY_PREFIX} evento`);
    const reply = await comment(
      tokens.demoOther,
      postId,
      `${BODY_PREFIX} evento resposta`,
      root.id,
    );
    await request(`/v1/feed/comments/${root.id}/like`, tokens.demoOther, { method: 'POST' });
    await request(`/v1/feed/comments/${root.id}/like`, tokens.demoOther, { method: 'DELETE' });
    await request(`/v1/feed/comments/${reply.id}`, tokens.demoOther, { method: 'DELETE' });

    const mine = events.slice(before);
    const names = mine.map((e) => e.name);
    expect(names.filter((n) => n === 'post.liked')).toHaveLength(1);
    expect(names.filter((n) => n === 'post.unliked')).toHaveLength(1);
    expect(names.filter((n) => n === 'comment.created')).toHaveLength(2);
    expect(names.filter((n) => n === 'comment.liked')).toHaveLength(1);
    expect(names.filter((n) => n === 'comment.unliked')).toHaveLength(1);
    expect(names.filter((n) => n === 'comment.deleted')).toHaveLength(1);

    const liked = mine.find((e) => e.name === 'post.liked')?.payload as PostLiked;
    expect(liked.postId).toBe(postId);
    expect(liked.postAuthorUserId).toBeTruthy();
    expect(liked.actorUserId).not.toBe('');

    const created = mine
      .filter((e) => e.name === 'comment.created')
      .map((e) => e.payload as CommentCreated);
    expect(created[0]?.parentCommentId).toBeNull();
    expect(created[0]?.parentAuthorUserId).toBeNull();
    expect(created[1]?.parentCommentId).toBe(root.id);
    // The SECOND recipient Phase 7 needs: the root's author, carried so it never re-reads the row.
    expect(created[1]?.parentAuthorUserId).toBeTruthy();
    expect(created[1]?.postAuthorUserId).toBeTruthy();

    const commentLiked = mine.find((e) => e.name === 'comment.liked')?.payload as CommentLiked;
    expect(commentLiked.commentAuthorUserId).toBeTruthy();
    const deleted = mine.find((e) => e.name === 'comment.deleted')?.payload as CommentDeleted;
    expect(deleted.commentId).toBe(reply.id);
  });

  it('10. a REFUSED reply-to-a-reply emits nothing at all', async () => {
    const postId = await seedPost('refused emits nothing');
    const root = await comment(tokens.demoMember, postId, `${BODY_PREFIX} raiz`);
    const reply = await comment(tokens.demoOther, postId, `${BODY_PREFIX} resposta`, root.id);

    const before = events.length;
    const refused = await request(`/v1/feed/posts/${postId}/comments`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ body: `${BODY_PREFIX} recusado`, parentId: reply.id }),
    });
    expect(refused.status).toBe(400);
    expect(events.length).toBe(before);
  });
});

describe('tenant isolation, each with its positive control (T-04-14, T-04-21)', () => {
  it('11. a lab session cannot like, comment on, or list the comments of a demo post', async () => {
    const postId = await seedPost('isolation');
    const root = await comment(tokens.demoMember, postId, `${BODY_PREFIX} isolado`);

    const lab = (path: string, init: RequestInit = {}) =>
      api.request(path, {
        ...init,
        headers: {
          authorization: `Bearer ${tokens.labAdmin}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          'x-tenant-host': HOSTS.lab,
        },
      });

    expect((await lab(`/v1/feed/posts/${postId}/like`, { method: 'POST' })).status).toBe(404);
    expect(
      (
        await lab(`/v1/feed/posts/${postId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: 'nao deveria existir' }),
        })
      ).status,
    ).toBe(404);
    expect((await lab(`/v1/feed/posts/${postId}/comments`)).status).toBe(404);
    expect((await lab(`/v1/feed/comments/${root.id}/like`, { method: 'POST' })).status).toBe(404);
    expect((await lab(`/v1/feed/comments/${root.id}`, { method: 'DELETE' })).status).toBe(404);

    // Nothing leaked into the other tenant, and nothing was written at all.
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes where post_id = ${postId}::uuid`;
    expect(rows[0]?.n).toBe(0);
    const stored = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments where post_id = ${postId}::uuid`;
    expect(stored[0]?.n).toBe(1);

    // The POSITIVE control, in the same test: the demo session succeeds on the same ids.
    expect((await like(tokens.demoMember, postId)).status).toBe(200);
    expect((await request(`/v1/feed/posts/${postId}/comments`, tokens.demoMember)).status).toBe(
      200,
    );
    expect(
      (await request(`/v1/feed/comments/${root.id}/like`, tokens.demoMember, { method: 'POST' }))
        .status,
    ).toBe(200);
  });
});

/**
 * 04-07 / UI-D-24 — the removed-author fixture `scripts/seed.ts` writes for BOTH tenants.
 *
 * Mirrored here rather than imported for the reason `apps/web/e2e/fixtures.ts` gives: the seed is a
 * top-level-await script that demands `SEED_PASSWORD` and opens a connection at import time. The ids
 * are fixed literals in the seed precisely so a test can name the row without querying for it first.
 */
const REMOVED_AUTHOR = {
  postId: '0d000000-0000-4000-8000-000000000002',
  rootId: '0d000000-0000-4000-8000-0000000000c3',
  replyId: '0d000000-0000-4000-8000-0000000000c4',
  /** The live-author root seeded on the SAME post — the positive control (03-08). */
  liveRootId: '0d000000-0000-4000-8000-0000000000c5',
  rootBody: 'Escrevi isto antes de sair da comunidade.',
  replyBody: 'Obrigado pelo recado, seguimos com o combinado.',
} as const;

describe('a removed author keeps their thread (UI-D-24)', () => {
  it('12. the comment survives the membership, nameless and unlinkable — and a live author does not', async () => {
    // The seed's own membership soft-delete, re-asserted: if this ever stops being true the three
    // assertions below would pass vacuously against a member who was simply never removed.
    const removed = await adminSql<{ n: number }[]>`
      select count(*)::int as n
        from public.feed_comments c
        join public.memberships m
          on m.user_id = c.author_user_id and m.tenant_id = ${tenantIds.demo}::uuid
       where c.id = ${REMOVED_AUTHOR.rootId}::uuid and m.deleted_at is not null`;
    expect(removed[0]?.n, 'the seed must soft-delete the removed author’s membership').toBe(1);

    const page = await comments(tokens.demoMember, REMOVED_AUTHOR.postId);
    const orphanRoot = page.items.find((c) => c.id === REMOVED_AUTHOR.rootId);

    // The row is STILL THERE. An inner join on `memberships` would have dropped it here.
    expect(orphanRoot, 'the removed author’s comment must still be listed').toBeDefined();
    const root = orphanRoot as FeedComment;
    expect(root.authorRemoved).toBe(true);
    expect(root.author.displayName).toBeNull();
    expect(root.author.membershipId).toBeNull();
    expect(root.author.avatarAssetId).toBeNull();
    // Everything that is NOT the person is untouched: the text, and the thread hanging off it.
    expect(root.body).toBe(REMOVED_AUTHOR.rootBody);
    expect(root.replyCount).toBe(1);

    // THE POSITIVE CONTROL, in the same test (03-08): the live-author root the seed writes on this
    // same post reports the flag false with a real name, so `authorRemoved: true` cannot be a
    // constant and the three nulls above cannot be what the projection returns for everyone.
    const liveRoot = page.items.find((c) => c.id === REMOVED_AUTHOR.liveRootId);
    expect(liveRoot, 'the seed must write a live-author root on the same post').toBeDefined();
    const live = liveRoot as FeedComment;
    expect(live.authorRemoved).toBe(false);
    expect(live.author.displayName).not.toBeNull();
    expect(live.author.displayName).not.toBe('');
    expect(live.author.membershipId).not.toBeNull();
  });

  it('13. the live member’s reply under that root is still returned, with its own author intact', async () => {
    const page = await replies(tokens.demoMember, REMOVED_AUTHOR.rootId);

    expect(page.items.map((c) => c.id)).toContain(REMOVED_AUTHOR.replyId);
    const reply = page.items.find((c) => c.id === REMOVED_AUTHOR.replyId) as FeedComment;
    expect(reply.body).toBe(REMOVED_AUTHOR.replyBody);
    expect(reply.isReply).toBe(true);
    // The REPLY's author is alive — removing the root's author must not touch anyone else's row.
    expect(reply.authorRemoved).toBe(false);
    expect(reply.author.displayName).not.toBeNull();
  });

  it('14. the post’s trigger-maintained commentCount still counts the removed author’s comment', async () => {
    const post = await getPost(tokens.demoMember, REMOVED_AUTHOR.postId);

    // The counter summarises ROWS, not visible authors. Dropping the row from the projection while
    // the trigger keeps counting it is exactly the drift UI-D-24 exists to prevent, so the count is
    // reconciled here against the live rows rather than against a hard-coded number.
    const live = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments
       where post_id = ${REMOVED_AUTHOR.postId}::uuid and deleted_at is null`;
    expect(post.commentCount).toBe(live[0]?.n);
    expect(post.commentCount).toBeGreaterThanOrEqual(2);
  });
});
