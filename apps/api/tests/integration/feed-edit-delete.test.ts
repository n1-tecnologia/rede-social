import { sqlClient } from '@rede-social/core/db';
import type { FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs, uploadAvatar } from './setup';

/**
 * FEED-03 — the admin's two write paths against the live local stack.
 *
 * What only this file can prove:
 *  - **UI-D-15's "any persisted change" is real**, including a media-only edit and a re-save of
 *    byte-identical content. The marker is what the card renders, so an edit path that quietly
 *    stopped setting it would be invisible to every unit test and obvious to every member.
 *  - **T-04-54: the permission is NOT the authorisation.** A SECOND `admin_tenant` of the same
 *    tenant holds `feed.post.manage` and still cannot touch a colleague's post — the bare 404 comes
 *    from the statement's `author_user_id` predicate, with the author's own success as the positive
 *    control in the same test so a globally broken route could not make it pass vacuously.
 *  - **The guard ORDER is observable**: a member answers 403 (the route's permission fires first)
 *    while an admin of ANOTHER tenant answers 404 (they hold the permission, their lane simply
 *    cannot see the row). Two different refusals that a single-role test would never separate.
 *  - **T-04-57: delete deterministically wins a concurrent edit.** The delete is performed through
 *    the admin connection BETWEEN the read and the edit, so the race is constructed rather than
 *    raced — and the edit answers the same bare 404 an unknown id gets.
 *  - **A soft delete deletes NOTHING**: the row keeps its stamp and its `feed_post_media` rows, its
 *    comments and its `media_assets` all survive for Phase 8's moderation and the Phase 3 sweeper.
 *  - **A repeat delete is a no-op**: the same bare 404, and `deleted_at` does not move — which is
 *    the observable proof that no second state and therefore no second event was produced.
 *
 * The second admin is a THROWAWAY identity added to the seeded tenant rather than a seeded
 * membership mutated in place: every other feed spec reads those rows, and flipping one to a
 * second admin for the duration of a run would poison them for the rest of the suite.
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, unknown>; requestId?: string };
};

const DEMO_ADMIN = 'admin@rede-demo.local';
const DEMO_MEMBER = 'member@rede-demo.local';
const LAB_ADMIN = 'admin@rede-lab.local';

/** The throwaway second admin: a real GoTrue identity with a real `admin_tenant` membership. */
const SECOND_ADMIN_EMAIL = 'segundo-admin@rede-demo-04-09.local';
const SECOND_ADMIN_PASSWORD = 'segundo-admin-04-09-Aa1!';

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '', secondAdmin: '' };
const tenantIds = { demo: '', lab: '' };

const createdPostIds: string[] = [];
const createdAssetIds: string[] = [];
const throwawayUserIds: string[] = [];

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function request(path: string, init: RequestInit, token: string, host = HOSTS.demo) {
  return api.request(path, {
    ...init,
    headers: { ...authed(token), 'x-tenant-host': host, ...(init.headers ?? {}) },
  });
}

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

/** A 201 create as the seeded demo admin, registered for cleanup. Fails loudly on anything else. */
async function createPost(body: unknown, token = tokens.demoAdmin): Promise<FeedPost> {
  const res = await request(
    '/v1/feed/posts',
    { method: 'POST', body: JSON.stringify(body) },
    token,
  );
  expect(res.status, `POST /v1/feed/posts -> ${res.status}`).toBe(201);
  const post = (await res.json()) as FeedPost;
  createdPostIds.push(post.id);
  return post;
}

const patch = (postId: string, body: unknown, token: string, host = HOSTS.demo) =>
  request(`/v1/feed/posts/${postId}`, { method: 'PATCH', body: JSON.stringify(body) }, token, host);

const remove = (postId: string, token: string, host = HOSTS.demo) =>
  request(`/v1/feed/posts/${postId}`, { method: 'DELETE' }, token, host);

/** The raw row, read through the superuser connection — the only honest "nothing was deleted". */
async function postRow(postId: string) {
  const [row] = await adminSql<
    { caption: string; media_kind: string; edited_at: string | null; deleted_at: string | null }[]
  >`select caption, media_kind, edited_at, deleted_at
      from public.feed_posts where id = ${postId}::uuid`;
  return row;
}

async function countRows(table: 'feed_post_media' | 'feed_comments', postId: string) {
  const [row] = await adminSql<{ n: string }[]>`
    select count(*)::text as n
      from ${adminSql(`public.${table}`)} where post_id = ${postId}::uuid`;
  return Number(row?.n ?? '0');
}

/** A real `ready` post image through the Phase 3 broker — the same fixture `feed-media` uses. */
async function postImage(token = tokens.demoAdmin): Promise<string> {
  const id = await uploadAvatar(token, { purpose: 'post' });
  createdAssetIds.push(id);
  return id;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  if (!tenantIds.demo || !tenantIds.lab) throw new Error('the two demo tenants are not seeded');

  // A previous interrupted run must not poison this one (the 02-05 fixture rule).
  await cleanupSecondAdmin();

  const created = await authAdmin().createUser({
    email: SECOND_ADMIN_EMAIL,
    password: SECOND_ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Segunda Direcao' },
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed for the second admin: ${created.error?.message}`);
  }
  throwawayUserIds.push(created.data.user.id);

  // The membership must exist BEFORE the sign-in: the custom access token hook reads it to mint
  // the `tenant_id` / `app_role` claims, so a token issued first would carry neither.
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantIds.demo}::uuid, ${created.data.user.id}::uuid, 'admin_tenant', 'active')`;

  [tokens.demoAdmin, tokens.demoMember, tokens.labAdmin, tokens.secondAdmin] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(LAB_ADMIN, SEED_PASSWORD),
    signInAs(SECOND_ADMIN_EMAIL, SECOND_ADMIN_PASSWORD),
  ]);
});

async function cleanupSecondAdmin(): Promise<void> {
  const rows = await adminSql<{ id: string }[]>`
    select id from auth.users where email = ${SECOND_ADMIN_EMAIL}`;
  for (const row of rows) {
    await adminSql`delete from public.memberships where user_id = ${row.id}::uuid`;
    await authAdmin().deleteUser(row.id);
  }
}

afterAll(async () => {
  if (createdPostIds.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPostIds}::uuid[])`;
  }
  if (createdAssetIds.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssetIds}::uuid[])`;
  }
  await cleanupSecondAdmin();
  throwawayUserIds.length = 0;
  await adminSql.end();
  await sqlClient.end();
});

describe('UI-D-15 — the edit marker follows ANY persisted change', () => {
  it('sets edited_at on a caption edit and reports it on the wire', async () => {
    const post = await createPost({ caption: 'Aviso original da assembleia.' });
    expect(post.editedAt).toBeNull();

    const res = await patch(
      post.id,
      { caption: 'Aviso corrigido da assembleia.' },
      tokens.demoAdmin,
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as FeedPost;
    expect(updated.caption).toBe('Aviso corrigido da assembleia.');
    expect(updated.editedAt).not.toBeNull();

    const row = await postRow(post.id);
    expect(row?.edited_at).not.toBeNull();
  });

  it('sets edited_at on a MEDIA-ONLY edit, with no caption in the body at all', async () => {
    const post = await createPost({ caption: 'Fotos do encontro.' });
    expect(post.mediaKind).toBe('none');
    const image = await postImage();

    const res = await patch(post.id, { imageAssetIds: [image] }, tokens.demoAdmin);
    expect(res.status).toBe(200);
    const updated = (await res.json()) as FeedPost;
    // The caption is untouched — this really was a media-only save.
    expect(updated.caption).toBe('Fotos do encontro.');
    expect(updated.mediaKind).toBe('gallery');
    expect(updated.media).toHaveLength(1);
    expect(updated.editedAt).not.toBeNull();
  });

  it('re-saving byte-identical content still ADVANCES the marker (no diff gate)', async () => {
    const post = await createPost({ caption: 'Mesmo texto, duas vezes.' });

    const first = await patch(post.id, { caption: 'Mesmo texto, duas vezes.' }, tokens.demoAdmin);
    expect(first.status).toBe(200);
    const firstStamp = ((await first.json()) as FeedPost).editedAt;
    expect(firstStamp).not.toBeNull();

    const second = await patch(post.id, { caption: 'Mesmo texto, duas vezes.' }, tokens.demoAdmin);
    expect(second.status).toBe(200);
    const secondStamp = ((await second.json()) as FeedPost).editedAt;
    expect(secondStamp).not.toBeNull();
    // "Edited" means "the author saved this again", not "the bytes differ".
    expect(new Date(secondStamp as string).getTime()).toBeGreaterThanOrEqual(
      new Date(firstStamp as string).getTime(),
    );
  });
});

describe('T-04-54 — holding the permission is not owning the post', () => {
  it('refuses a SECOND admin of the same tenant with a bare 404, and the author succeeds', async () => {
    const post = await createPost({ caption: 'Publicacao da primeira direcao.' });

    const refusedEdit = await patch(post.id, { caption: 'sequestrada' }, tokens.secondAdmin);
    expect(refusedEdit.status).toBe(404);
    const editError = await envelope(refusedEdit);
    expect(editError.code).toBe('NOT_FOUND');
    // No `details` payload at all: a per-cause code over an enumerable uuid space is an oracle.
    expect(editError.details).toBeUndefined();

    const refusedDelete = await remove(post.id, tokens.secondAdmin);
    expect(refusedDelete.status).toBe(404);
    expect((await envelope(refusedDelete)).details).toBeUndefined();

    // The row is untouched by either refusal.
    const untouched = await postRow(post.id);
    expect(untouched?.caption).toBe('Publicacao da primeira direcao.');
    expect(untouched?.edited_at).toBeNull();
    expect(untouched?.deleted_at).toBeNull();

    // The positive control, in the SAME test: the route works, the predicate is what refused.
    const allowed = await patch(post.id, { caption: 'Corrigida pela autora.' }, tokens.demoAdmin);
    expect(allowed.status).toBe(200);
  });

  it('answers 403 to a MEMBER — the route guard fires before the author predicate', async () => {
    const post = await createPost({ caption: 'Fora do alcance de um membro.' });

    const edit = await patch(post.id, { caption: 'nao' }, tokens.demoMember);
    expect(edit.status).toBe(403);
    expect((await envelope(edit)).code).toBe('FORBIDDEN');

    const del = await remove(post.id, tokens.demoMember);
    expect(del.status).toBe(403);
    expect((await envelope(del)).code).toBe('FORBIDDEN');
  });

  it('answers 404 to an admin of ANOTHER tenant — they hold the permission, not the row', async () => {
    const post = await createPost({ caption: 'Publicacao da rede-demo.' });

    const edit = await patch(post.id, { caption: 'nao' }, tokens.labAdmin, HOSTS.lab);
    expect(edit.status).toBe(404);
    expect((await envelope(edit)).details).toBeUndefined();

    const del = await remove(post.id, tokens.labAdmin, HOSTS.lab);
    expect(del.status).toBe(404);

    expect((await postRow(post.id))?.deleted_at).toBeNull();
  });
});

describe('FEED-03 — the soft delete removes the post and deletes nothing', () => {
  it('drops it from the feed and from its own page, while every row survives', async () => {
    const image = await postImage();
    const post = await createPost({ caption: 'Com foto e comentario.', imageAssetIds: [image] });

    // A member's comment, so "the comments stop being reachable through it" has something to mean.
    const comment = await request(
      `/v1/feed/posts/${post.id}/comments`,
      { method: 'POST', body: JSON.stringify({ body: 'Vou estar la.' }) },
      tokens.demoMember,
    );
    expect(comment.status).toBe(201);

    expect(await countRows('feed_post_media', post.id)).toBe(1);
    expect(await countRows('feed_comments', post.id)).toBe(1);

    const deleted = await remove(post.id, tokens.demoAdmin);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });

    // Gone from every read…
    const detail = await request(`/v1/feed/posts/${post.id}`, {}, tokens.demoMember);
    expect(detail.status).toBe(404);
    expect((await envelope(detail)).details).toBeUndefined();

    const comments = await request(`/v1/feed/posts/${post.id}/comments`, {}, tokens.demoMember);
    expect(comments.status).toBe(404);

    const feed = await request('/v1/feed?limit=25', {}, tokens.demoMember);
    expect(feed.status).toBe(200);
    const page = (await feed.json()) as FeedPage;
    expect(page.items.map((item) => item.id)).not.toContain(post.id);

    // …and yet nothing was removed: the row keeps its stamp and every child row is still there.
    const row = await postRow(post.id);
    expect(row?.deleted_at).not.toBeNull();
    expect(await countRows('feed_post_media', post.id)).toBe(1);
    expect(await countRows('feed_comments', post.id)).toBe(1);
    const [asset] = await adminSql<{ id: string }[]>`
      select id from public.media_assets where id = ${image}::uuid and deleted_at is null`;
    expect(asset?.id).toBe(image);
  });

  it('answers the same bare 404 on a REPEAT delete, and the stamp does not move', async () => {
    const post = await createPost({ caption: 'Excluida uma vez so.' });

    expect((await remove(post.id, tokens.demoAdmin)).status).toBe(200);
    const first = (await postRow(post.id))?.deleted_at;
    expect(first).not.toBeNull();

    const again = await remove(post.id, tokens.demoAdmin);
    expect(again.status).toBe(404);
    expect((await envelope(again)).details).toBeUndefined();

    // Byte-identical stamp: no second state was written, so no second event could be emitted.
    expect((await postRow(post.id))?.deleted_at).toEqual(first);
  });
});

describe('T-04-57 — delete wins a concurrent edit', () => {
  it('answers 404 to an edit applied to a post removed in between, leaving deleted_at intact', async () => {
    const post = await createPost({ caption: 'Vai ser excluida no meio da edicao.' });

    // The race is CONSTRUCTED rather than raced: the delete lands through the admin connection
    // between the composer's read and its save, which is exactly the window the predicate closes.
    await adminSql`
      update public.feed_posts set deleted_at = now() where id = ${post.id}::uuid`;
    const stamp = (await postRow(post.id))?.deleted_at;
    expect(stamp).not.toBeNull();

    const edit = await patch(post.id, { caption: 'ressuscitada' }, tokens.demoAdmin);
    expect(edit.status).toBe(404);
    expect((await envelope(edit)).details).toBeUndefined();

    const row = await postRow(post.id);
    expect(row?.deleted_at).toEqual(stamp);
    // Not half-updated either: the caption is exactly what it was before the edit.
    expect(row?.caption).toBe('Vai ser excluida no meio da edicao.');
    expect(row?.edited_at).toBeNull();
  });
});

describe('FEED-01 / empty — a post with neither caption nor media', () => {
  it('is refused with a validation error and creates no row', async () => {
    const [before] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.feed_posts where tenant_id = ${tenantIds.demo}::uuid`;

    const res = await request(
      '/v1/feed/posts',
      { method: 'POST', body: JSON.stringify({ caption: '   ' }) },
      tokens.demoAdmin,
    );
    expect(res.status).toBe(400);
    const error = await envelope(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(error.details)).toContain('empty_post');

    const [after] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.feed_posts where tenant_id = ${tenantIds.demo}::uuid`;
    expect(after?.n).toBe(before?.n);
  });

  it('refuses an EDIT that would leave the post with neither, against the resulting row', async () => {
    const post = await createPost({ caption: 'So texto, sem midia.' });

    const res = await patch(post.id, { caption: '' }, tokens.demoAdmin);
    expect(res.status).toBe(400);
    expect(JSON.stringify((await envelope(res)).details)).toContain('empty_post');

    // Unchanged, marker included: a refused save is not a persisted change.
    const row = await postRow(post.id);
    expect(row?.caption).toBe('So texto, sem midia.');
    expect(row?.edited_at).toBeNull();
  });
});
