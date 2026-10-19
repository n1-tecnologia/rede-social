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
 * tenant lane, the `social_follows` policies, the counts definer). Test ORDER is load-bearing
 * (`fileParallelism: false`, declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };
type FollowBody = { following: boolean; followerCount: number };

const LAB = 'rede-lab';
const tokens = { alvaro: '', helena: '', labAdmin: '', labSupport: '', demoMember: '' };
const ids = { alvaro: '', helena: '', marcos: '', labAdmin: '', demoMember: '' };
const userIds = { alvaro: '', helena: '', marcos: '' };

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
  ids.labAdmin = (await membershipOf('admin@rede-lab.local')).id;
  ids.demoMember = (await membershipOf('member@rede-demo.local')).id;
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
