import { sqlClient } from '@tria/core/db';
import { subscribe } from '@tria/core/server/events/bus';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import {
  FEED_MAX_CAPTION,
  FEED_MAX_PAGE_SIZE,
  FEED_PAGE_SIZE,
  type FeedPage,
  type FeedPost,
  type PostPublished,
} from '@tria/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@tria/module-feed` end to end against the live local stack and the real seed (04-01).
 *
 * Five things are proved here that nothing else in the repo can prove:
 *  - **FEED-02 paging is TOTAL.** Walking the feed with the returned cursors under a CONCURRENT
 *    insert returns every pre-existing post exactly once — no duplicate, no skip — because
 *    `(created_at, id)` is a total order the index carries.
 *  - **FEED-08 is one value.** Flipping `tenant_modules['feed'].settings.postingPolicy` to
 *    `'members'` turns a member into an author with NO migration and NO route edit, and the same
 *    flip shows up in `GET /v1/me/bootstrap`'s `permissions`.
 *  - **T-04-01: the cross-tenant refusal is a bare 404** whose body is byte-identical to the one an
 *    unknown id produces, carries no `details` key, and names neither tenant.
 *  - **MOD-03: `post.published` fires exactly once after commit** and zero times when the request
 *    never committed.
 *  - **T-04-06: a hostile cursor degrades to page 1**, and `limit` is clamped server-side.
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };
/** Every post this file created, removed in `afterAll` so the suite is re-runnable. */
const created: string[] = [];
const events: PostPublished[] = [];
let unsubscribe: () => void = () => {};

/** 23 fixture posts: more than two pages of 10, with a partial last page. */
const FIXTURE_COUNT = 23;
const FIXTURE_CAPTION = 'Publicacao de teste';
const fixtureIds: string[] = [];

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** Insert straight through the admin connection: fixtures the lane must page over, not create. */
async function seedPost(tenantId: string, caption: string, createdAt: Date): Promise<string> {
  const [author] = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant' limit 1`;
  const rows = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, caption, author_user_id, created_at)
    values (${tenantId}::uuid, ${caption}, ${author?.id ?? null}::uuid, ${createdAt.toISOString()}::timestamptz)
    returning id`;
  const id = rows[0]?.id ?? '';
  created.push(id);
  return id;
}

/** One page, parsed. Fails loudly on a non-200 so a broken page never reads as an empty one. */
async function page(token: string, query = '', host = HOSTS.demo): Promise<FeedPage> {
  const res = await request(`/v1/feed${query}`, token, { headers: { 'x-tenant-host': host } });
  expect(res.status, `GET /v1/feed${query}`).toBe(200);
  return (await res.json()) as FeedPage;
}

/** Strictly descending on `(createdAt, id)` — the ordering the cursor is built on. */
function isStrictlyDescending(items: FeedPost[]): boolean {
  for (let i = 1; i < items.length; i++) {
    const previous = items[i - 1] as FeedPost;
    const current = items[i] as FeedPost;
    const before = `${previous.createdAt}|${previous.id}`;
    const after = `${current.createdAt}|${current.id}`;
    if (!(before > after)) return false;
  }
  return true;
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

  // One minute apart, oldest first, so the newest fixture is `fixtureIds[FIXTURE_COUNT - 1]`.
  const base = Date.now();
  for (let i = 0; i < FIXTURE_COUNT; i++) {
    fixtureIds.push(
      await seedPost(
        tenantIds.demo,
        `${FIXTURE_CAPTION} ${i}`,
        new Date(base - (FIXTURE_COUNT - i) * 60_000),
      ),
    );
  }

  unsubscribe = subscribe('post.published', async (payload) => {
    events.push(payload);
  });
});

afterAll(async () => {
  unsubscribe();
  if (created.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${created}::uuid[])`;
  }
  // Belt and braces: a create that returns a non-201 AFTER its transaction committed (the exact
  // defect this file caught in 04-01) leaves a row this suite never learned the id of. Sweeping by
  // the caption prefixes this file writes keeps the shared seed clean for the e2e that follows.
  await adminSql`
    delete from public.feed_posts
     where caption like 'Publicacao %' or caption ~ '^a{100,}$'`;
  // Leave the tenant on the V1 default whatever this file did to it.
  await adminSql`
    update public.tenant_modules set settings = settings - 'postingPolicy'
     where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
  moduleFlags.invalidate(tenantIds.demo);
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/feed — keyset paging (FEED-02)', () => {
  it('1. the first page is FEED_PAGE_SIZE items with a non-null cursor', async () => {
    const first = await page(tokens.demoMember, '', HOSTS.demo);
    expect(first.items).toHaveLength(FEED_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    expect(isStrictlyDescending(first.items)).toBe(true);
    // The newest fixture is the newest post in the tenant, so it heads the feed.
    expect(first.items[0]?.id).toBe(fixtureIds[FIXTURE_COUNT - 1]);
  });

  it('2. walking the cursors returns every post exactly once, in a strictly descending order', async () => {
    const seen: FeedPost[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const body: FeedPage = await page(
        tokens.demoMember,
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : '',
      );
      seen.push(...body.items);
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    // The last page reports no next cursor — the over-fetch makes that exact, not a guess.
    expect(cursor).toBeNull();
    const ids = seen.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isStrictlyDescending(seen)).toBe(true);
    for (const id of fixtureIds) expect(ids).toContain(id);

    // …and the walk really did see the whole tenant's feed, not a prefix of it.
    //
    // 05-03 dropped `and community_id is null` from this count. That clause was not describing the
    // FEED — it was describing the Phase 4 predicate, which D-73 replaced with an absence: with the
    // `communities` module on, "the whole tenant's feed" is every live post of the tenant, whatever
    // container it sits in. The count is deliberately left as a count of ROWS rather than a
    // hard-coded number, so it keeps measuring the walk and not the fixture.
    const [total] = await adminSql<{ count: number }[]>`
      select count(*)::int as count from public.feed_posts
       where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null`;
    expect(ids.length).toBe(total?.count);
  });

  it('3. an insert BETWEEN two pages neither duplicates nor skips a pre-existing post', async () => {
    const first = await page(tokens.demoMember);
    expect(first.nextCursor).not.toBeNull();

    // The classic keyset property: a row written ABOVE the cursor cannot shift the page boundary.
    const intruder = await seedPost(tenantIds.demo, 'Publicacao concorrente', new Date());

    const seen = [...first.items.map((item) => item.id)];
    let cursor: string | null = first.nextCursor;
    for (let guard = 0; guard < 20 && cursor !== null; guard++) {
      const body: FeedPage = await page(tokens.demoMember, `?cursor=${encodeURIComponent(cursor)}`);
      seen.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    for (const id of fixtureIds) {
      expect(seen.filter((seenId) => seenId === id)).toHaveLength(1);
    }
    // The intruder sorts above page 1's boundary, so the walk correctly never reaches it.
    expect(seen).not.toContain(intruder);
  });

  it('4. limit is bounded server-side and validated; an unknown query key is refused', async () => {
    // The repo's established posture (03-07 `GET /v1/media`): the bound is a REFUSAL, not a silent
    // reduction. A caller asking for 999 gets told its request was wrong rather than quietly served
    // a different page than the one it asked for — and either way no request can ask for an
    // unbounded page (T-04-06).
    const tooBig = await request(`/v1/feed?limit=${FEED_MAX_PAGE_SIZE + 1}`, tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(tooBig.status).toBe(400);
    expect(await code(tooBig)).toBe('VALIDATION_FAILED');

    // …and the largest ACCEPTED page really is the cap.
    const atCap = await page(tokens.demoMember, `?limit=${FEED_MAX_PAGE_SIZE}`);
    expect(atCap.items.length).toBeLessThanOrEqual(FEED_MAX_PAGE_SIZE);
    expect(atCap.items.length).toBeGreaterThan(FEED_PAGE_SIZE);

    const zero = await request('/v1/feed?limit=0', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(zero.status).toBe(400);
    expect(await code(zero)).toBe('VALIDATION_FAILED');

    // `.strict()`: a typo'd filter must fail loudly rather than be silently ignored.
    const unknown = await request('/v1/feed?bogus=1', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(unknown.status).toBe(400);
    expect(await code(unknown)).toBe('VALIDATION_FAILED');
  });

  it('5. a tampered or stale cursor degrades to page 1 rather than 500 (T-04-06)', async () => {
    const baseline = await page(tokens.demoMember);

    const garbage = await page(tokens.demoMember, '?cursor=not-base64-at-all');
    expect(garbage.items.map((item) => item.id)).toEqual(baseline.items.map((item) => item.id));

    // A well-formed envelope from ANOTHER ordering (the member directory's name cursor): valid
    // base64url JSON, wrong shape for this endpoint. Still page 1, never a 500.
    const foreign = Buffer.from(
      JSON.stringify({ v: 1, n: 'ana paula', id: 'not-a-uuid' }),
    ).toString('base64url');
    const stale = await page(tokens.demoMember, `?cursor=${encodeURIComponent(foreign)}`);
    expect(stale.items.map((item) => item.id)).toEqual(baseline.items.map((item) => item.id));
  });
});

describe('POST /v1/feed/posts — the posting policy is ONE value (FEED-08)', () => {
  it('6. the admin publishes (201) and the post heads the feed; a member is refused (403)', async () => {
    const caption = `Publicacao do admin ${Date.now()}`;
    const res = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as FeedPost;
    created.push(post.id);
    expect(post.caption).toBe(caption);
    // T-04-02: authorship and tenancy come from the session, never from the body.
    expect(post.author.displayName.length).toBeGreaterThan(0);
    expect(post.canManage).toBe(true);
    expect(post.likeCount).toBe(0);
    expect(post.viewerLiked).toBe(false);

    const first = await page(tokens.demoMember);
    expect(first.items[0]?.id).toBe(post.id);

    const refused = await request('/v1/feed/posts', tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ caption: 'Publicacao de membro' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(refused.status).toBe(403);
    expect(await code(refused)).toBe('FORBIDDEN');
  });

  it('7. flipping settings.postingPolicy to "members" makes the SAME member an author', async () => {
    const before = await request('/v1/me/bootstrap', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    const beforeBody = (await before.json()) as { permissions: string[] };
    expect(beforeBody.permissions).not.toContain('feed.post.create');

    // The WHOLE V2 migration, in one statement and with no code change whatsoever.
    await adminSql`
      update public.tenant_modules
         set settings = settings || '{"postingPolicy":"members"}'::jsonb
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
    moduleFlags.invalidate(tenantIds.demo);

    const caption = `Publicacao de membro ${Date.now()}`;
    const res = await request('/v1/feed/posts', tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ caption }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as FeedPost;
    created.push(post.id);
    // The assumption-delta invariant: the member's post round-trips through the SAME generic
    // `author_user_id` path and renders in the feed. A future phase that reintroduces an admin-only
    // authorship assumption goes red HERE.
    expect(post.canManage).toBe(true);
    const first = await page(tokens.demoMember);
    expect(first.items[0]?.id).toBe(post.id);

    const after = await request('/v1/me/bootstrap', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    const afterBody = (await after.json()) as { permissions: string[] };
    // The guard and the composer's visibility read the SAME composed value.
    expect(afterBody.permissions).toContain('feed.post.create');

    await adminSql`
      update public.tenant_modules set settings = settings - 'postingPolicy'
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
    moduleFlags.invalidate(tenantIds.demo);
  });

  it('8. the caption is bounded at both ends, in UTF-16 code units', async () => {
    const headers = { 'x-tenant-host': HOSTS.demo };

    const empty = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: '   ' }),
      headers,
    });
    expect(empty.status).toBe(400);
    expect(await code(empty)).toBe('VALIDATION_FAILED');

    const tooLong = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: 'a'.repeat(FEED_MAX_CAPTION + 1) }),
      headers,
    });
    expect(tooLong.status).toBe(400);
    expect(await code(tooLong)).toBe('VALIDATION_FAILED');

    // Exactly at the cap is accepted: the counter the composer shows and this check count the same
    // unit, so a caption the UI accepts is never refused here.
    const atCap = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: 'a'.repeat(FEED_MAX_CAPTION) }),
      headers,
    });
    expect(atCap.status).toBe(201);
    created.push(((await atCap.json()) as FeedPost).id);
  });
});

describe('cross-tenant: one bare 404, never an existence oracle (T-04-01)', () => {
  it('9. a lab session never sees a demo post, by list or by id — and demo still does', async () => {
    const demoPostId = fixtureIds[0] as string;

    const labFeed = await page(tokens.labAdmin, '?limit=25', HOSTS.lab);
    expect(labFeed.items.map((item) => item.id)).not.toContain(demoPostId);
    for (const item of labFeed.items) expect(fixtureIds).not.toContain(item.id);

    // Positive control IN THE SAME TEST (the 03-08 discipline): the id is real and readable — by
    // its own tenant. Without this line the 404 below could pass on a typo'd uuid.
    const ownedByDemo = await request(`/v1/feed/posts/${demoPostId}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(ownedByDemo.status).toBe(200);

    const foreign = await request(`/v1/feed/posts/${demoPostId}`, tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(foreign.status).toBe(404);
    const foreignBody = (await foreign.json()) as Envelope;
    expect(foreignBody.error.code).toBe('NOT_FOUND');
    // No `details` key at all: even `{ post: 'other_tenant' }` would be the oracle D-23 forbids.
    expect(Object.hasOwn(foreignBody.error, 'details')).toBe(false);
    const asText = JSON.stringify(foreignBody);
    expect(asText).not.toContain('tria-demo');
    expect(asText).not.toContain('TRIA Demo');
  });

  it('10. an unknown uuid produces the byte-identical 404 body', async () => {
    const unknown = await request(
      '/v1/feed/posts/00000000-0000-4000-8000-000000000000',
      tokens.demoAdmin,
      { headers: { 'x-tenant-host': HOSTS.demo } },
    );
    const foreign = await request(`/v1/feed/posts/${fixtureIds[0]}`, tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(unknown.status).toBe(foreign.status);

    // `requestId` is per request by construction; everything else must match exactly.
    const strip = (body: Envelope) => ({ ...body.error, requestId: undefined });
    expect(strip((await unknown.json()) as Envelope)).toEqual(
      strip((await foreign.json()) as Envelope),
    );
  });

  it('11. a tenant without the module gets 404 MODULE_DISABLED, and no token gets 401', async () => {
    // `feed` is enabled for both seed tenants, so the disabled case is proved on a tenant whose flag
    // this test turns off and restores — the state itself is what must 404, not a particular tenant.
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'feed'`;
    moduleFlags.invalidate(tenantIds.lab);
    try {
      const disabled = await request('/v1/feed', tokens.labAdmin, {
        headers: { 'x-tenant-host': HOSTS.lab },
      });
      expect(disabled.status).toBe(404);
      expect(await code(disabled)).toBe('MODULE_DISABLED');
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.lab);
    }

    const anonymous = await request('/v1/feed');
    // 401 before 404: an anonymous probe never learns whether the module exists here.
    expect(anonymous.status).toBe(401);
    expect(await code(anonymous)).toBe('UNAUTHENTICATED');
  });
});

describe('post.published — after commit, exactly once (MOD-03)', () => {
  it('12. one successful create delivers one event; a refused create delivers none', async () => {
    const before = events.length;

    const res = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `Publicacao com evento ${Date.now()}` }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as FeedPost;
    created.push(post.id);

    // Delivered by `flushEventsAfterHandler`, i.e. after the handler's transaction committed.
    const delivered = events.filter((event) => event.postId === post.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.tenantId).toBe(tenantIds.demo);
    expect(delivered[0]?.authorUserId).toMatch(/^[0-9a-f-]{36}$/);
    expect(delivered[0]?.communityId).toBeNull();

    const refused = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: '' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(refused.status).toBe(400);
    // Nothing committed, so nothing was announced: the count moved by exactly one.
    expect(events.length).toBe(before + 1);
  });
});

/**
 * 05-03 — the MERGED feed (D-71, D-73, D-74) and COMM-04's write, against the live stack.
 *
 * These are the assertions no unit test can make: whether ONE query really returns two sources in
 * one chronological order, whether the community summary really rides the same statement, and
 * whether the destination check really runs inside the write's own transaction.
 *
 * The seeded communities are the fixture (`scripts/seed.ts` writes four per tenant and six posts
 * inside them); this block creates only the posts it needs and sweeps them by id.
 */
describe('the merged feed and COMM-04’s write (D-71, D-73, COMM-04)', () => {
  /**
   * Every ACTIVE seeded community of the demo tenant, newest activity first, with the trigger-owned
   * `post_count` beside it.
   *
   * The `status = 'active'` predicate is load-bearing since 05-04: the seed now ships an ARCHIVED
   * fifth community (the UI-D-37 fixture), which sorts LAST and carries no posts. Without the
   * filter, case 16's "the last community" would have selected it — and would then have archived an
   * already-archived container, found no posts of it in the feed, and RESTORED it to `active`,
   * leaving the shared seed in a state three assertions in `communities.test.ts` depend on not
   * being in.
   */
  async function demoCommunities(): Promise<
    { id: string; name: string; status: string; post_count: number }[]
  > {
    return adminSql<{ id: string; name: string; status: string; post_count: number }[]>`
      select id, name, status, post_count from public.communities
       where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null and status = 'active'
       order by last_activity_at desc, id desc`;
  }

  /** Walk the merged feed to the end (bounded), in the server's own order. */
  async function walkFeed(token: string): Promise<FeedPost[]> {
    const seen: FeedPost[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const query: string = cursor ? `?limit=25&cursor=${encodeURIComponent(cursor)}` : '?limit=25';
      const body: FeedPage = await page(token, query);
      seen.push(...body.items);
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    return seen;
  }

  it('13. D-73: community posts and tenant-wide posts are ONE chronological list, interleaved', async () => {
    const items = await walkFeed(tokens.demoMember);

    // Both sources are present — without this the ordering assertion below would pass vacuously on
    // a feed that had quietly gone back to `community_id is null`.
    const withCommunity = items.filter((item) => item.community !== null);
    const tenantWide = items.filter((item) => item.community === null);
    expect(withCommunity.length, 'the seed publishes inside communities').toBeGreaterThan(0);
    expect(tenantWide.length).toBeGreaterThan(0);

    // ONE ordering expression: the concatenation of every page is strictly descending on
    // `(createdAt, id)` regardless of which source each row came from.
    expect(isStrictlyDescending(items)).toBe(true);

    // INTERLEAVED, not appended: some tenant-wide post sits BELOW some community post in the list.
    // Two concatenated blocks would satisfy "strictly descending" inside each block and fail here.
    const firstCommunityIndex = items.findIndex((item) => item.community !== null);
    const lastTenantWideIndex = items.map((item) => item.community).lastIndexOf(null);
    expect(lastTenantWideIndex).toBeGreaterThan(firstCommunityIndex);
  });

  it('14. D-71: every community item carries its summary, every tenant-wide item carries null', async () => {
    const items = await walkFeed(tokens.demoMember);
    const names = new Map((await demoCommunities()).map((row) => [row.id, row.name]));

    for (const item of items) {
      // The two fields are one fact: a `communityId` with a null `community` would be a label the
      // reader never sees, and the reverse would be a label with nothing behind it.
      expect(item.community === null, item.id).toBe(item.communityId === null);
      if (item.community === null) continue;
      expect(item.community.id).toBe(item.communityId);
      // The name really came from THIS tenant's row (T-05-14), not from anywhere else.
      expect(item.community.name).toBe(names.get(item.community.id));
      expect(item.community.slug.length).toBeGreaterThan(0);
      // `.strict()` on the wire shape: the label is a name and a route, never a second card.
      expect(Object.keys(item.community).sort()).toEqual(['id', 'name', 'slug']);
    }
  });

  it('15. COMM-04: posting into an ACTIVE community lands in both the merged feed and that community', async () => {
    const [target] = await demoCommunities();
    expect(target?.status).toBe('active');
    const communityId = target?.id ?? '';

    const res = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `Publicacao na comunidade ${Date.now()}`, communityId }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as FeedPost;
    created.push(post.id);
    expect(post.communityId).toBe(communityId);
    expect(post.community?.id).toBe(communityId);
    expect(post.community?.name).toBe(target?.name);

    // The merged feed's FIRST page carries it — it is the newest post in the tenant.
    const merged = await page(tokens.demoMember, '?limit=10');
    expect(merged.items.map((item) => item.id)).toContain(post.id);

    // …and so does the community's own page, which is the same endpoint with a predicate.
    const scoped = await page(tokens.demoMember, `?limit=10&communityId=${communityId}`);
    expect(scoped.items.map((item) => item.id)).toContain(post.id);
    expect(scoped.items.every((item) => item.communityId === communityId)).toBe(true);
  });

  it('16. COMM-04: an ARCHIVED community answers 400 with details.community === "archived"', async () => {
    const communities = await demoCommunities();
    // A container that actually HAS posts: the second half of this case asserts that archiving
    // leaves them in the feed, and an empty container would let that pass vacuously.
    const target = communities.filter((row) => row.post_count > 0).at(-1);
    expect(target, 'the seed publishes inside at least one demo community').toBeDefined();
    const communityId = target?.id ?? '';

    await adminSql`
      update public.communities set status = 'archived' where id = ${communityId}::uuid`;
    try {
      const res = await request('/v1/feed/posts', tokens.demoAdmin, {
        method: 'POST',
        body: JSON.stringify({ caption: 'Publicacao recusada', communityId }),
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect((body.error.details as { community?: string }).community).toBe('archived');

      // 05-RESEARCH §Pattern 7: archive is a WRITE gate, never a feed gate. The posts already
      // inside it stay exactly where members last saw them.
      const items = await walkFeed(tokens.demoMember);
      expect(items.some((item) => item.communityId === communityId)).toBe(true);
    } finally {
      await adminSql`
        update public.communities set status = 'active' where id = ${communityId}::uuid`;
    }
  });

  it('17. COMM-04: an unknown or other-tenant community is a BARE 404 with no details key', async () => {
    const [labCommunity] = await adminSql<{ id: string }[]>`
      select id from public.communities where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    expect(labCommunity?.id, 'the lab tenant is seeded with communities too').toBeDefined();

    const bodies: Envelope[] = [];
    for (const communityId of [labCommunity?.id ?? '', '00000000-0000-4000-8000-000000000000']) {
      const res = await request('/v1/feed/posts', tokens.demoAdmin, {
        method: 'POST',
        body: JSON.stringify({ caption: 'Publicacao sem destino', communityId }),
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      expect(res.status, communityId).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      // D-23 / T-05-13: no `details` at all. A per-cause code over an enumerable uuid space would
      // let the composer enumerate another organisation's containers one refusal at a time.
      expect(Object.hasOwn(body.error, 'details')).toBe(false);
      bodies.push(body);
    }
    // The two refusals are byte-identical apart from the request id that correlates the logs.
    const strip = (body: Envelope) => JSON.stringify({ ...body.error, requestId: undefined });
    expect(strip(bodies[0] as Envelope)).toBe(strip(bodies[1] as Envelope));

    // The READ path answers the same way, for the same reason.
    const read = await request(`/v1/feed?communityId=${labCommunity?.id ?? ''}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(read.status).toBe(404);
  });

  it('18. D-72: a published post cannot be moved between communities', async () => {
    const communities = await demoCommunities();
    const from = communities[0]?.id ?? '';
    const to = communities[1]?.id ?? '';
    expect(from).not.toBe(to);

    const create = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `Publicacao fixa ${Date.now()}`, communityId: from }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(create.status).toBe(201);
    const post = (await create.json()) as FeedPost;
    created.push(post.id);

    // `updatePostSchema` is `.strict()` and has no `communityId` key, so the attempt is REFUSED
    // rather than silently ignored — the rule is visible to the caller, not just to the row.
    const moved = await request(`/v1/feed/posts/${post.id}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ caption: 'Publicacao fixa editada', communityId: to }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(moved.status).toBe(400);

    // …and a legitimate edit leaves the placement exactly where publication put it.
    const edited = await request(`/v1/feed/posts/${post.id}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ caption: 'Publicacao fixa editada' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(edited.status).toBe(200);
    const after = (await edited.json()) as FeedPost;
    expect(after.communityId).toBe(from);
    expect(after.community?.id).toBe(from);
  });
});
