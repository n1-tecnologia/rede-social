import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  followStateSchema,
  memberSocialProfileSchema,
  socialListPageSchema,
} from '@rede-social/module-social/contracts';
import { socialRoutes } from '@rede-social/module-social/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 09-02 (FOLLOW-01, FOLLOW-02, SOCIAL-10; D-466, D-467, D-468, D-483, D-484) against the live local
 * stack and the real seed: the follow graph between members of ONE tenant.
 *
 * The seed turns `social` ON for rede-lab and OFF for rede-demo, and writes two lab follow fixtures
 * (`alvaro.pinheiro` follows `helena.kuster`, `helena.kuster` follows `marcos.vinicius`). Every case
 * that changes a fixture puts it back in `finally` or in `afterAll`, so the isolation sweep and the
 * e2e keep reading the seeded graph.
 *
 * `09 tracer` is ONE follow through every layer (the route, both module guards, the permission, the
 * tenant lane, the `social_follows` policies, the counts definer). `09 reads` covers the two private
 * lists, the batch state, the social profile variant and D-484 (blocked members vanish and return).
 * `09 gate` covers D-483 (off hides everything, `feed` off too), the staff 403 and idempotency under
 * concurrency. Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };
type FollowBody = { following: boolean; followerCount: number };

const LAB = 'rede-lab';
const tokens = {
  alvaro: '',
  helena: '',
  labMember: '',
  labAdmin: '',
  labSupport: '',
  demoMember: '',
};
const ids = { alvaro: '', helena: '', marcos: '', labMember: '', labAdmin: '', demoMember: '' };
const userIds = { alvaro: '', helena: '', marcos: '', labMember: '' };
let labTenantId = '';

const request = (path: string, token: string, init: RequestInit = {}, host = HOSTS.lab) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const put = (membershipId: string, token: string) =>
  request(`/v1/social/follows/${membershipId}`, token, { method: 'PUT' });
const del = (membershipId: string, token: string) =>
  request(`/v1/social/follows/${membershipId}`, token, { method: 'DELETE' });

async function membershipOf(email: string): Promise<{ id: string; userId: string }> {
  const [row] = await adminSql<{ id: string; user_id: string }[]>`
    select m.id, m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return { id: row.id, userId: row.user_id };
}

/** The independent count: follower rows of one lab user, straight from Postgres. */
async function followerRows(followeeUserId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.social_follows f
      join public.tenants t on t.id = f.tenant_id
     where t.slug = ${LAB} and f.followee_user_id = ${followeeUserId}::uuid`;
  return row?.n ?? 0;
}

async function pairRows(followerUserId: string, followeeUserId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.social_follows
     where follower_user_id = ${followerUserId}::uuid and followee_user_id = ${followeeUserId}::uuid`;
  return row?.n ?? 0;
}

/** Puts the two seeded lab fixtures back (the seed writes them with `on conflict do nothing`). */
async function restoreSeedFollows(): Promise<void> {
  await adminSql`
    insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
    select t.id, ${userIds.alvaro}::uuid, ${userIds.helena}::uuid
      from public.tenants t where t.slug = ${LAB}
    on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`;
  await adminSql`
    insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
    select t.id, ${userIds.helena}::uuid, ${userIds.marcos}::uuid
      from public.tenants t where t.slug = ${LAB}
    on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  const alvaro = await membershipOf('alvaro.pinheiro@rede-lab.local');
  const helena = await membershipOf('helena.kuster@rede-lab.local');
  const marcos = await membershipOf('marcos.vinicius@rede-lab.local');
  ids.alvaro = alvaro.id;
  ids.helena = helena.id;
  ids.marcos = marcos.id;
  userIds.alvaro = alvaro.userId;
  userIds.helena = helena.userId;
  userIds.marcos = marcos.userId;
  const labMember = await membershipOf('member@rede-lab.local');
  ids.labMember = labMember.id;
  userIds.labMember = labMember.userId;
  ids.labAdmin = (await membershipOf('admin@rede-lab.local')).id;
  ids.demoMember = (await membershipOf('member@rede-demo.local')).id;
  const [lab] = await adminSql<{ id: string }[]>`select id from public.tenants where slug = ${LAB}`;
  labTenantId = lab?.id ?? '';
  moduleFlags.invalidate(labTenantId);
});

afterAll(async () => {
  await restoreSeedFollows();
  await adminSql.end();
});

describe('09 tracer', () => {
  it('1. PUT follows, writes exactly one row through the tenant lane, and the count equals Postgres', async () => {
    // Start from a clean pair: the seed fixture alvaro -> helena is put back in afterAll.
    await adminSql`
      delete from public.social_follows
       where follower_user_id = ${userIds.alvaro}::uuid and followee_user_id = ${userIds.helena}::uuid`;
    expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(0);

    const res = await put(ids.helena, tokens.alvaro);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as FollowBody;
    expect(body).toEqual({ following: true, followerCount: 1 });
    expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(1);
    expect(body.followerCount).toBe(await followerRows(userIds.helena));
  });

  it('2. a second PUT on the same pair is 200, unchanged, and leaves one row', async () => {
    const res = await put(ids.helena, tokens.alvaro);
    expect(res.status).toBe(200);
    expect((await res.json()) as FollowBody).toEqual({ following: true, followerCount: 1 });
    expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(1);
  });

  it('3. DELETE unfollows: 200 following false, count 0, the row is gone', async () => {
    const res = await del(ids.helena, tokens.alvaro);
    expect(res.status).toBe(200);
    expect((await res.json()) as FollowBody).toEqual({ following: false, followerCount: 0 });
    expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(0);
    expect(await followerRows(userIds.helena)).toBe(0);
  });

  it('4. a second DELETE is still 200 following false (never 404, never 409)', async () => {
    const res = await del(ids.helena, tokens.alvaro);
    expect(res.status).toBe(200);
    expect((await res.json()) as FollowBody).toEqual({ following: false, followerCount: 0 });
  });

  it('5. D-467: a self-follow is 400 VALIDATION_FAILED with details.follow = self_follow', async () => {
    const res = await put(ids.alvaro, tokens.alvaro);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as Envelope;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({ follow: 'self_follow' });
    expect(await pairRows(userIds.alvaro, userIds.alvaro)).toBe(0);
  });

  it('6. D-467 / T-09-03: an unknown, a staff and a rede-demo target are ONE bare 404', async () => {
    const targets = ['99999999-9999-4999-8999-999999999999', ids.labAdmin, ids.demoMember];
    const bodies: string[] = [];
    for (const target of targets) {
      const res = await put(target, tokens.alvaro);
      expect(res.status, target).toBe(404);
      const { error } = (await res.json()) as Envelope;
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      bodies.push(`${error.code}|${error.message}`);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('7. D-467: staff cannot join the graph, 403 FORBIDDEN before the target is looked up', async () => {
    for (const token of [tokens.labAdmin, tokens.labSupport]) {
      // An unknown target would be a 404 if the target were looked up first.
      const res = await put('99999999-9999-4999-8999-999999999999', token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Helpers for the reads and the gate.
// ---------------------------------------------------------------------------------------------

const get = (path: string, token: string) => request(path, token);
const postJson = (path: string, token: string, body: unknown) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) });

type ListBody = {
  items: {
    membershipId: string;
    displayName: string;
    bio: string | null;
    avatarAssetId: string | null;
    viewerFollows: boolean;
  }[];
  nextCursor: string | null;
};

async function list(path: 'followers' | 'following', token: string, query = ''): Promise<ListBody> {
  const res = await get(`/v1/social/me/${path}${query}`, token);
  expect(res.status, `${path}${query}`).toBe(200);
  return socialListPageSchema.parse(await res.json()) as ListBody;
}

const ids_ = (page: ListBody) => page.items.map((item) => item.membershipId);

type Social = {
  membershipId: string;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
  self: boolean;
};

async function social(membershipId: string, token: string): Promise<Social> {
  const res = await get(`/v1/social/members/${membershipId}`, token);
  expect(res.status, membershipId).toBe(200);
  return memberSocialProfileSchema.parse(await res.json()) as Social;
}

const insertFollow = (follower: string, followee: string, at?: string) =>
  adminSql`
    insert into public.social_follows (tenant_id, follower_user_id, followee_user_id, created_at)
    values (${labTenantId}::uuid, ${follower}::uuid, ${followee}::uuid, coalesce(${at ?? null}::timestamptz, now()))
    on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`;

const deleteFollow = (follower: string, followee: string) =>
  adminSql`
    delete from public.social_follows
     where follower_user_id = ${follower}::uuid and followee_user_id = ${followee}::uuid`;

const setBlocked = (membershipId: string, blocked: boolean) =>
  blocked
    ? adminSql`update public.memberships set status = 'blocked', blocked_at = now() where id = ${membershipId}::uuid`
    : adminSql`update public.memberships set status = 'active', blocked_at = null where id = ${membershipId}::uuid`;

/** One module row, set to a value and put back (`finally`), with the per-process flag cache dropped. */
async function withModuleRow<T>(key: string, enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = ${key}`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${labTenantId}::uuid, ${key}, ${enabled})
    on conflict (tenant_id, module_key) do update set enabled = ${enabled}, updated_at = now()`;
  moduleFlags.invalidate(labTenantId);
  try {
    return await fn();
  } finally {
    if (previous) {
      // An upsert, not an update: a case may have DELETED the row to prove "no row = off".
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${labTenantId}::uuid, ${key}, ${previous.enabled})
        on conflict (tenant_id, module_key)
        do update set enabled = ${previous.enabled}, updated_at = now()`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = ${key}`;
    }
    moduleFlags.invalidate(labTenantId);
  }
}

/** The six routes, each answered for one token: `[label, status, code]`. */
async function sixRoutes(token: string): Promise<[string, number, string | undefined][]> {
  const calls: [string, Promise<Response>][] = [
    ['PUT follow', put(ids.marcos, token)],
    ['DELETE follow', del(ids.marcos, token)],
    ['POST state', postJson('/v1/social/follows/state', token, { membershipIds: [ids.marcos] })],
    ['GET followers', get('/v1/social/me/followers', token)],
    ['GET following', get('/v1/social/me/following', token)],
    ['GET member', get(`/v1/social/members/${ids.marcos}`, token)],
  ];
  const out: [string, number, string | undefined][] = [];
  for (const [label, pending] of calls) {
    const res = await pending;
    const body = res.status === 200 ? undefined : ((await res.json()) as Envelope);
    out.push([label, res.status, body?.error.code]);
  }
  return out;
}

describe('09 reads', () => {
  it('1. EP-37 / EP-30 / EP-40: a member with no relations reads empty lists and the zero shape', async () => {
    expect(await list('followers', tokens.labMember)).toEqual({ items: [], nextCursor: null });
    expect(await list('following', tokens.labMember)).toEqual({ items: [], nextCursor: null });
    const seen = await social(ids.labMember, tokens.alvaro);
    expect(seen).toEqual({
      membershipId: ids.labMember,
      followerCount: 0,
      followingCount: 0,
      viewerFollows: false,
      self: false,
    });
  });

  it('2. the seeded graph: Alvaro follows Helena, Helena follows Marcos, and each reads only their own rows', async () => {
    const alvaroFollowing = await list('following', tokens.alvaro);
    expect(ids_(alvaroFollowing)).toEqual([ids.helena]);
    expect(alvaroFollowing.items[0]?.viewerFollows).toBe(true);
    expect(alvaroFollowing.items[0]?.displayName).toBe('Helena Küster');
    expect(await list('followers', tokens.alvaro)).toEqual({ items: [], nextCursor: null });

    const helenaFollowers = await list('followers', tokens.helena);
    expect(ids_(helenaFollowers)).toEqual([ids.alvaro]);
    // Helena does not follow Alvaro back.
    expect(helenaFollowers.items[0]?.viewerFollows).toBe(false);
    expect(ids_(await list('following', tokens.helena))).toEqual([ids.marcos]);
  });

  it('3. EP-38: both lists are newest first on (created_at, id); a limit-1 walk neither skips nor repeats, ties included', async () => {
    // Three followers of the lab member: Marcos older, Alvaro and Helena with the IDENTICAL instant.
    await insertFollow(userIds.marcos, userIds.labMember, '2026-01-01T10:00:00.000000Z');
    await insertFollow(userIds.alvaro, userIds.labMember, '2026-01-02T10:00:00.000000Z');
    await insertFollow(userIds.helena, userIds.labMember, '2026-01-02T10:00:00.000000Z');
    try {
      const expected = await adminSql<{ id: string }[]>`
        select m.id from public.social_follows f
          join public.memberships m on m.user_id = f.follower_user_id and m.tenant_id = f.tenant_id
         where f.followee_user_id = ${userIds.labMember}::uuid
         order by f.created_at desc, f.id desc`;
      const walked: string[] = [];
      let cursor: string | null = null;
      for (let pageNo = 0; pageNo < 5; pageNo += 1) {
        const query: string = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page: ListBody = await list('followers', tokens.labMember, query);
        walked.push(...ids_(page));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(walked).toHaveLength(3);
      expect(new Set(walked).size).toBe(3);
      expect(walked).toEqual(expected.map((row) => row.id));
      // The two tied rows sit adjacent and before the older one.
      expect(walked[2]).toBe(ids.marcos);

      // A tampered cursor degrades to page 1, never an error.
      const tampered = await list('followers', tokens.labMember, '?limit=1&cursor=garbage');
      expect(ids_(tampered)).toEqual([expected[0]?.id]);

      // The full page lists the same three in the same order.
      expect(ids_(await list('followers', tokens.labMember))).toEqual(expected.map((r) => r.id));
    } finally {
      await deleteFollow(userIds.marcos, userIds.labMember);
      await deleteFollow(userIds.alvaro, userIds.labMember);
      await deleteFollow(userIds.helena, userIds.labMember);
    }
  });

  it('4. EP-36: a mutual pair counts once each way, and one is the integer 1', async () => {
    await insertFollow(userIds.labMember, userIds.marcos);
    await insertFollow(userIds.marcos, userIds.labMember);
    try {
      const seen = await social(ids.labMember, tokens.alvaro);
      expect(seen.followerCount).toBe(1);
      expect(seen.followingCount).toBe(1);
      const marcos = await social(ids.marcos, tokens.alvaro);
      // Helena (seed) and the lab member follow Marcos; Marcos follows the lab member.
      expect(marcos.followerCount).toBe(2);
      expect(marcos.followingCount).toBe(1);
    } finally {
      await deleteFollow(userIds.labMember, userIds.marcos);
      await deleteFollow(userIds.marcos, userIds.labMember);
    }
  });

  it('5. EP-39: the own id answers self true; a staff id is the bare 404; a followed member shows viewerFollows', async () => {
    const own = await social(ids.alvaro, tokens.alvaro);
    expect(own).toEqual({
      membershipId: ids.alvaro,
      followerCount: 0,
      followingCount: 1,
      viewerFollows: false,
      self: true,
    });

    for (const target of [ids.labAdmin, ids.demoMember, '99999999-9999-4999-8999-999999999999']) {
      const res = await get(`/v1/social/members/${target}`, tokens.alvaro);
      expect(res.status, target).toBe(404);
      const { error } = (await res.json()) as Envelope;
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
    }

    const helena = await social(ids.helena, tokens.alvaro);
    expect(helena.viewerFollows).toBe(true);
    expect(helena.followerCount).toBe(1);
    expect(helena.followingCount).toBe(1);
    expect(helena.self).toBe(false);
  });

  it('6. the batch state: 1 and 50 ids answer per id in input order; 0, 51 and a non-uuid are 400', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const asked = [ids.helena, ids.marcos, ids.labAdmin, ids.demoMember, unknown];
    const res = await postJson('/v1/social/follows/state', tokens.alvaro, { membershipIds: asked });
    expect(res.status).toBe(200);
    const body = followStateSchema.parse(await res.json());
    expect(body.items).toEqual([
      { membershipId: ids.helena, following: true },
      { membershipId: ids.marcos, following: false },
      { membershipId: ids.labAdmin, following: false },
      { membershipId: ids.demoMember, following: false },
      { membershipId: unknown, following: false },
    ]);

    const one = await postJson('/v1/social/follows/state', tokens.alvaro, {
      membershipIds: [ids.helena],
    });
    expect(one.status).toBe(200);

    const fifty = Array.from(
      { length: 50 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const fiftyRes = await postJson('/v1/social/follows/state', tokens.alvaro, {
      membershipIds: fifty,
    });
    expect(fiftyRes.status).toBe(200);
    expect(followStateSchema.parse(await fiftyRes.json()).items).toHaveLength(50);

    for (const membershipIds of [[], [...fifty, ids.helena], ['not-a-uuid']]) {
      const bad = await postJson('/v1/social/follows/state', tokens.alvaro, { membershipIds });
      expect(bad.status, JSON.stringify(membershipIds).slice(0, 30)).toBe(400);
    }
  });

  it('7. D-468: no route in the router takes a member id for a list, and no /me path has a parameter', () => {
    const paths = socialRoutes.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);
    expect(paths.sort()).toEqual(
      [
        'DELETE /follows/:membershipId',
        'GET /me/followers',
        'GET /me/following',
        'GET /members/:membershipId',
        'POST /follows/state',
        'PUT /follows/:membershipId',
      ].sort(),
    );
    for (const route of socialRoutes.routes) {
      if (route.method === 'ALL') continue;
      if (route.path.startsWith('/me/')) expect(route.path, route.path).not.toContain(':');
      if (/followers|following/.test(route.path)) expect(route.path, route.path).not.toContain(':');
    }
    // The query schema refuses a member id too.
  });

  it('8. D-484 / EP-35: a blocked member vanishes from lists and counts, a follow of them is the bare 404, unfollow still works, and unblocking restores everything', async () => {
    try {
      await setBlocked(ids.helena, true);

      // Alvaro's "Seguindo" no longer shows Helena; Marcos has lost his only (blocked) follower.
      expect(await list('following', tokens.alvaro)).toEqual({ items: [], nextCursor: null });
      const marcos = await social(ids.marcos, tokens.alvaro);
      expect(marcos.followerCount).toBe(0);

      // Helena is the bare 404 on the social read and on a new PUT.
      const read = await get(`/v1/social/members/${ids.helena}`, tokens.alvaro);
      expect(read.status).toBe(404);
      expect(((await read.json()) as Envelope).error.details).toBeUndefined();
      const refused = await put(ids.helena, tokens.alvaro);
      expect(refused.status).toBe(404);
      expect(((await refused.json()) as Envelope).error.details).toBeUndefined();

      // The stored row is still there: nothing was deleted.
      expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(1);

      await setBlocked(ids.helena, false);

      // Unblocked: everything returns, followers included.
      expect(ids_(await list('following', tokens.alvaro))).toEqual([ids.helena]);
      expect((await social(ids.marcos, tokens.alvaro)).followerCount).toBe(1);
      expect((await social(ids.helena, tokens.alvaro)).viewerFollows).toBe(true);

      // EP-33: unfollowing a target that is blocked at that moment still answers 200.
      await setBlocked(ids.helena, true);
      const unfollow = await del(ids.helena, tokens.alvaro);
      expect(unfollow.status).toBe(200);
      expect((await unfollow.json()) as FollowBody).toEqual({ following: false, followerCount: 0 });
      expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(0);
    } finally {
      await setBlocked(ids.helena, false);
      await restoreSeedFollows();
    }
  });
});

describe('09 gate', () => {
  it('1. D-483: with social off every route answers 404 MODULE_DISABLED; the rows return when it is on again', async () => {
    const before = await pairRows(userIds.alvaro, userIds.helena);
    expect(before).toBe(1);
    await withModuleRow('social', false, async () => {
      for (const [label, status, code] of await sixRoutes(tokens.alvaro)) {
        expect([label, status, code]).toEqual([label, 404, 'MODULE_DISABLED']);
      }
      // Nothing was deleted by being off.
      expect(await pairRows(userIds.alvaro, userIds.helena)).toBe(1);
    });
    expect(ids_(await list('following', tokens.alvaro))).toEqual([ids.helena]);
  });

  it('2. D-483 / T-09-02: with social on and feed off every route still answers 404 MODULE_DISABLED (requires is not enforced by requireModule)', async () => {
    await withModuleRow('feed', false, async () => {
      for (const [label, status, code] of await sixRoutes(tokens.alvaro)) {
        expect([label, status, code]).toEqual([label, 404, 'MODULE_DISABLED']);
      }
    });
    // And with no social row at all.
    await withModuleRow('social', false, async () => {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
      const [first] = await sixRoutes(tokens.alvaro);
      expect(first).toEqual(['PUT follow', 404, 'MODULE_DISABLED']);
    });
  });

  it('3. D-467: admin and support get 403 FORBIDDEN on every route', async () => {
    for (const token of [tokens.labAdmin, tokens.labSupport]) {
      for (const [label, status, code] of await sixRoutes(token)) {
        expect([label, status, code]).toEqual([label, 403, 'FORBIDDEN']);
      }
    }
  });

  it('4. EP-33: two PUTs then two DELETEs on one pair are all 200 and never 404 or 409', async () => {
    await deleteFollow(userIds.alvaro, userIds.marcos);
    const first = await put(ids.marcos, tokens.alvaro);
    const second = await put(ids.marcos, tokens.alvaro);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await first.json()) as FollowBody).toEqual((await second.json()) as FollowBody);
    expect(await pairRows(userIds.alvaro, userIds.marcos)).toBe(1);
    const third = await del(ids.marcos, tokens.alvaro);
    const fourth = await del(ids.marcos, tokens.alvaro);
    expect([third.status, fourth.status]).toEqual([200, 200]);
    expect(await pairRows(userIds.alvaro, userIds.marcos)).toBe(0);
  });

  it('5. EP-34: ten parallel PUTs leave one row and all answer 200; a PUT racing a DELETE never answers 5xx', async () => {
    await deleteFollow(userIds.alvaro, userIds.marcos);
    const parallel = await Promise.all(
      Array.from({ length: 10 }, () => put(ids.marcos, tokens.alvaro)),
    );
    expect(parallel.map((res) => res.status)).toEqual(Array(10).fill(200));
    expect(await pairRows(userIds.alvaro, userIds.marcos)).toBe(1);

    const raced = await Promise.all([
      ...Array.from({ length: 5 }, () => put(ids.marcos, tokens.alvaro)),
      ...Array.from({ length: 5 }, () => del(ids.marcos, tokens.alvaro)),
    ]);
    for (const res of raced) expect(res.status).toBeLessThan(500);
    expect(await pairRows(userIds.alvaro, userIds.marcos)).toBeLessThanOrEqual(1);
    await deleteFollow(userIds.alvaro, userIds.marcos);
  });
});
