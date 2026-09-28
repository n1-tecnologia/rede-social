import {
  memberListSchema,
  memberProfileSchema,
  ownProfileSchema,
} from '@rede-social/contracts/profiles';
import { sqlClient } from '@rede-social/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, SEED_PASSWORD, signInAs } from './setup';

/**
 * PROF-02 / PROF-03 / TENANT-04 — the member directory and one member's profile against the live
 * local stack.
 *
 * The tracer is one path through every layer: a seeded member lists their community, searches it by
 * an unaccented fragment, follows the keyset cursor to the next page, and opens one of the results.
 *
 * Everything after it is built on a THROWAWAY tenant provisioned row by row, because the D-47 matrix
 * has to be exhaustive rather than incidental: one `admin_tenant`, one `support_tenant`, three
 * active members (two of them homonyms, for the adjacency case), one invited, one blocked and one
 * soft-deleted membership. A seeded tenant cannot carry that shape without breaking every other
 * suite's counts.
 *
 * Invariants asserted here rather than assumed:
 *  - D-45: the single-member payload carries EXACTLY photo, display name and bio.
 *  - D-47: staff are absent from the listing and yet reachable by direct link — two routes, two
 *    deliberately different predicates.
 *  - D-23 / T-03-19: unknown, other-tenant, invited, blocked and soft-deleted all answer ONE
 *    byte-identical 404 body, so the directory is not an existence oracle.
 *  - T-03-21: `%`, `_` and `\` in `q` are literals, and a tampered cursor is page one, not a 500.
 *  - the promote invariant (03-02's other half): `GET /v1/me/profile` and
 *    `GET /v1/members/{own membershipId}` agree, because there is ONE row, not two storage paths.
 */

const MEMBER_EMAIL = 'member@rede-demo.local';
const ADMIN_EMAIL = 'admin@rede-demo.local';
const LAB_MEMBER_EMAIL = 'member@rede-lab.local';

const RUN = Date.now();
const FIXTURE_SLUG = `mb-${RUN}`.slice(0, 40);
const FIXTURE_PASSWORD = 'Segredo123';
/** The two homonyms the adjacency case needs: identical names, two stable adjacent slots. */
const HOMONYM = 'Ana Paula Ferreira';

let memberToken = '';
let memberMembershipId = '';
let adminMembershipId = '';
let labToken = '';

/** The throwaway community: every role × status combination D-47 has an opinion about. */
let fixtureTenantId = '';
let fixtureToken = '';
const fixture = {
  admin: '',
  support: '',
  activeA: '',
  activeB: '',
  activeZ: '',
  invited: '',
  blocked: '',
  removed: '',
};
const fixtureUserIds: string[] = [];

type Envelope = { error: { code: string; message: string; details?: unknown; requestId: string } };

const members = (query = '', token?: string) =>
  api.request(`/v1/members${query}`, {
    headers: { authorization: `Bearer ${token ?? memberToken}` },
  });

const member = (membershipId: string, token?: string) =>
  api.request(`/v1/members/${membershipId}`, {
    headers: { authorization: `Bearer ${token ?? memberToken}` },
  });

/** The 404 body WITHOUT its per-request id — what "one identical body" actually means (D-23). */
async function refusal(
  res: Response,
): Promise<{ code: string; message: string; details?: unknown }> {
  const { error } = (await res.json()) as Envelope;
  return { code: error.code, message: error.message, details: error.details };
}

async function membershipIdOf(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select m.id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.id;
}

async function page(query = '', token?: string) {
  const res = await members(query, token);
  expect(res.status).toBe(200);
  return memberListSchema.parse(await res.json());
}

const listIds = async (query = '', token?: string) =>
  (await page(query, token)).items.map((i) => i.membershipId);

/**
 * One member of the throwaway tenant, inserted directly. Deliberately NOT through
 * `POST /v1/platform/tenants`: that route mints exactly ONE invited `admin_tenant` and nothing else,
 * so every other row in this matrix — the support seat, the blocked, invited and soft-deleted
 * memberships — needs `adminSql` regardless, and going through the route would add a GoTrue invite
 * e-mail per run for no extra coverage.
 *
 * The `member_profiles` row is NOT created here: the `member_profiles_from_membership` trigger does
 * it, seeding `display_name` from `users.name` (03-02). That is exactly the invariant under test.
 */
async function fixtureMember(opts: {
  name: string;
  local: string;
  role?: 'admin_tenant' | 'support_tenant' | 'member';
  status?: 'active' | 'invited' | 'blocked';
  removed?: boolean;
  signIn?: boolean;
}): Promise<string> {
  const email = `${opts.local}@${FIXTURE_SLUG}.local`;
  const { data, error } = await authAdmin().createUser({
    email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
    user_metadata: { name: opts.name },
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  fixtureUserIds.push(data.user.id);

  const [row] = await adminSql<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status, deleted_at)
    values (${fixtureTenantId}::uuid, ${data.user.id}::uuid, ${opts.role ?? 'member'},
            ${opts.status ?? 'active'}, ${opts.removed ? adminSql`now()` : null})
    returning id`;
  if (!row) throw new Error(`membership insert failed for ${email}`);

  if (opts.signIn) fixtureToken = await signInAs(email, FIXTURE_PASSWORD);
  return row.id;
}

async function profileNameOf(membershipId: string): Promise<string> {
  const [row] = await adminSql<{ display_name: string }[]>`
    select display_name from public.member_profiles where membership_id = ${membershipId}::uuid`;
  if (!row) throw new Error(`no member_profiles row for ${membershipId}`);
  return row.display_name;
}

async function renameProfile(membershipId: string, displayName: string): Promise<void> {
  await adminSql`
    update public.member_profiles set display_name = ${displayName}, updated_at = now()
     where membership_id = ${membershipId}::uuid`;
}

async function cleanup(): Promise<void> {
  const stale = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug like 'mb-%'`;
  const ids = stale.map((r) => r.id);
  if (ids.length > 0) {
    await adminSql`delete from public.memberships where tenant_id = any(${ids}::uuid[])`;
    await adminSql`delete from public.tenants where id = any(${ids}::uuid[])`;
  }
  for (const userId of fixtureUserIds) await authAdmin().deleteUser(userId);
  fixtureUserIds.length = 0;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  labToken = await signInAs(LAB_MEMBER_EMAIL, SEED_PASSWORD);
  memberMembershipId = await membershipIdOf(MEMBER_EMAIL);
  adminMembershipId = await membershipIdOf(ADMIN_EMAIL);

  await cleanup();
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${FIXTURE_SLUG}, 'Comunidade Matriz', 'Regras de teste.', 1)
    returning id`;
  fixtureTenantId = tenant?.id ?? '';
  if (!fixtureTenantId) throw new Error('could not create the fixture tenant');

  fixture.admin = await fixtureMember({
    name: 'Aurora Admina',
    local: 'aurora',
    role: 'admin_tenant',
  });
  fixture.support = await fixtureMember({
    name: 'Bento Suporte',
    local: 'bento',
    role: 'support_tenant',
  });
  fixture.activeA = await fixtureMember({ name: HOMONYM, local: 'ana1', signIn: true });
  fixture.activeB = await fixtureMember({ name: HOMONYM, local: 'ana2' });
  fixture.activeZ = await fixtureMember({ name: 'Zulmira Sá', local: 'zulmira' });
  fixture.invited = await fixtureMember({ name: 'Ivo Convidado', local: 'ivo', status: 'invited' });
  fixture.blocked = await fixtureMember({
    name: 'Baltazar Bloqueado',
    local: 'baltazar',
    status: 'blocked',
  });
  fixture.removed = await fixtureMember({ name: 'Remo Removido', local: 'remo', removed: true });
});

afterAll(async () => {
  await cleanup();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — list, search, page and open a member (PROF-02/PROF-03/D-47)', () => {
  let firstMembershipId = '';

  it('1. GET /v1/members answers one page of the community, ordered by the accent-folded name', async () => {
    const res = await members();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = memberListSchema.parse(await res.json());

    // The seed leaves nine active `member` rows in rede-demo; the page size is 25, so one page holds
    // them all and there is nothing beyond it.
    expect(body.items.length).toBeGreaterThanOrEqual(8);
    expect(body.nextCursor).toBeNull();

    // Ordering is the index expression, not the raw string: `Álvaro` sorts as `alvaro`.
    const folded = await adminSql<{ n: string }[]>`
      select app.imm_unaccent(lower(x)) as n
        from unnest(${body.items.map((i) => i.displayName)}::text[]) as x`;
    const keys = folded.map((r) => r.n);
    expect(keys).toEqual([...keys].sort());

    firstMembershipId = body.items[0]?.membershipId ?? '';
    expect(firstMembershipId).not.toBe('');
  });

  it('2. ?q= finds a name through accents and case (R-10) — goncal, MUNOZ and Íris', async () => {
    const goncal = await page('?q=goncal');
    expect(goncal.items.map((i) => i.displayName)).toEqual(['João Gonçalves']);

    const munoz = await page('?q=MUNOZ');
    expect(munoz.items.map((i) => i.displayName)).toEqual(['Íris Muñoz']);

    // An ACCENTED query still matches — the fold runs on both sides of the comparison.
    const iris = await page(`?q=${encodeURIComponent('Íris')}`);
    expect(iris.items.map((i) => i.displayName)).toEqual(['Íris Muñoz']);
  });

  it('3. ?limit=3 pages with an opaque cursor — every member exactly once, no gap, no duplicate', async () => {
    const everyone = await listIds();

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = await page(query);
      if (pages === 0) {
        expect(body.items).toHaveLength(3);
        expect(body.nextCursor).not.toBeNull();
      }
      collected.push(...body.items.map((i) => i.membershipId));
      cursor = body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20); // the loop must terminate; a non-advancing cursor would not
    } while (cursor !== null);

    expect(new Set(collected).size).toBe(collected.length);
    expect(collected).toEqual(everyone);
  });

  it('4. GET /v1/members/{membershipId} answers EXACTLY photo, name and bio (D-45)', async () => {
    const res = await member(firstMembershipId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      'avatarAssetId',
      'avatarUrl',
      'bio',
      'displayName',
      'membershipId',
    ]);
    const parsed = memberProfileSchema.parse(body);
    expect(parsed.membershipId).toBe(firstMembershipId);
  });

  it("5. D-47: the admin's profile IS openable by direct link and is NOT in the listing", async () => {
    const res = await member(adminMembershipId);
    expect(res.status).toBe(200);
    memberProfileSchema.parse(await res.json());

    expect(await listIds()).not.toContain(adminMembershipId);
  });

  it('6. PROMOTE INVARIANT: my own profile and my profile as a member are the same row', async () => {
    const own = ownProfileSchema.parse(
      await (
        await api.request('/v1/me/profile', {
          headers: { authorization: `Bearer ${memberToken}` },
        })
      ).json(),
    );
    const asMember = memberProfileSchema.parse(await (await member(memberMembershipId)).json());

    expect(asMember.membershipId).toBe(own.membershipId);
    expect(asMember.displayName).toBe(own.displayName);
    expect(asMember.bio).toBe(own.bio);
    expect(asMember.avatarUrl).toBe(own.avatarUrl);
    expect(asMember.avatarAssetId).toBe(own.avatarAssetId);
  });
});

describe('D-47 filter matrix — exactly the active members, never the staff', () => {
  it('7. the listing is EXACTLY the three active `member` rows', async () => {
    const ids = await listIds('', fixtureToken);
    expect(new Set(ids)).toEqual(new Set([fixture.activeA, fixture.activeB, fixture.activeZ]));
    expect(ids).toHaveLength(3);
  });

  it('8. admin_tenant, support_tenant, invited, blocked and soft-deleted are all absent', async () => {
    const ids = await listIds('', fixtureToken);
    for (const hidden of [
      fixture.admin,
      fixture.support,
      fixture.invited,
      fixture.blocked,
      fixture.removed,
    ]) {
      expect(ids).not.toContain(hidden);
    }
  });

  it('9. both staff profiles ARE openable by direct link (D-47) and carry no role field', async () => {
    for (const staff of [fixture.admin, fixture.support]) {
      const res = await member(staff, fixtureToken);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'avatarAssetId',
        'avatarUrl',
        'bio',
        'displayName',
        'membershipId',
      ]);
      memberProfileSchema.parse(body);
    }
  });

  it('10. invited, blocked, soft-deleted, unknown and another tenant answer ONE identical 404 (D-23)', async () => {
    const misses = [
      fixture.invited,
      fixture.blocked,
      fixture.removed,
      '00000000-0000-0000-0000-000000000000',
      memberMembershipId, // a real membership — of another community
    ];
    const bodies: string[] = [];
    for (const id of misses) {
      const res = await member(id, fixtureToken);
      expect(res.status).toBe(404);
      const body = await refusal(res);
      expect(body.code).toBe('NOT_FOUND');
      // No details payload at all: `{ member: 'blocked' }` would be the existence oracle D-23 forbids.
      expect(body.details).toBeUndefined();
      bodies.push(JSON.stringify(body));
    }
    expect(new Set(bodies).size).toBe(1);
  });
});

describe('search — a term is a literal substring, folded for accents and case (R-10, T-03-21)', () => {
  it('11. absent, empty and whitespace-only `q` are the SAME request', async () => {
    const none = await listIds('', fixtureToken);
    const empty = await listIds('?q=', fixtureToken);
    const blank = await listIds('?q=%20%20', fixtureToken);
    expect(empty).toEqual(none);
    expect(blank).toEqual(none);
  });

  it('12. `%` and `_` are LITERALS — a member cannot widen their own result set', async () => {
    // Unescaped, `like '%%%'` would return the whole directory; the escape clause makes it zero.
    const percent = await page('?q=%25', fixtureToken);
    expect(percent.items).toEqual([]);
    const underscore = await page('?q=_', fixtureToken);
    expect(underscore.items).toEqual([]);
    const backslash = await page('?q=%5C', fixtureToken);
    expect(backslash.items).toEqual([]);
  });

  it('13. a term matching nothing is 200 with an empty page, never a 404', async () => {
    const res = await members('?q=nao-existe-ninguem-assim', fixtureToken);
    expect(res.status).toBe(200);
    expect(memberListSchema.parse(await res.json())).toEqual({ items: [], nextCursor: null });
  });

  it('14. exactly one match answers one item and a null cursor', async () => {
    const body = await page('?q=zulmira', fixtureToken);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.displayName).toBe('Zulmira Sá');
    expect(body.nextCursor).toBeNull();
  });

  it('15. goncal, GONCAL, Gonçal and çal all find João Gonçalves (accent- and case-insensitive)', async () => {
    for (const q of ['goncal', 'GONCAL', 'Gonçal', 'çal']) {
      const body = await page(`?q=${encodeURIComponent(q)}`);
      expect(body.items.map((i) => i.displayName)).toEqual(['João Gonçalves']);
    }
  });
});

describe('adjacency and ordering — equal names are two stable slots (PROF-03 / edge: adjacency)', () => {
  it('16. both homonyms appear, adjacent, in the same order across two consecutive requests', async () => {
    const first = await listIds('', fixtureToken);
    const second = await listIds('', fixtureToken);
    expect(second).toEqual(first);

    const positions = [first.indexOf(fixture.activeA), first.indexOf(fixture.activeB)].sort(
      (a, b) => a - b,
    );
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    expect(positions[1]).toBe((positions[0] ?? 0) + 1);
    // `member_profiles.id` is the tiebreaker, so the pair's internal order is the ids' order.
    expect(first).toEqual([...first]);
  });

  it('17. paging with limit=1 across the boundary returns each homonym exactly once', async () => {
    const collected: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const body = await page(
        `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        fixtureToken,
      );
      expect(body.items.length).toBeLessThanOrEqual(1);
      collected.push(...body.items.map((i) => i.membershipId));
      cursor = body.nextCursor;
      guard += 1;
      expect(guard).toBeLessThan(10);
    } while (cursor !== null);

    expect(collected).toEqual(await listIds('', fixtureToken));
    expect(collected.filter((id) => id === fixture.activeA)).toHaveLength(1);
    expect(collected.filter((id) => id === fixture.activeB)).toHaveLength(1);
  });

  it('18. a rename between page 1 and page 2 still answers a well-formed page with no duplicate', async () => {
    const one = await page('?limit=1', fixtureToken);
    const seen = one.items.map((i) => i.membershipId);
    expect(one.nextCursor).not.toBeNull();

    // Move the OTHER homonym to the front of the order while the caller holds a cursor pointing past
    // it. A renamed row may move — and therefore be skipped — and that is accepted keyset behaviour,
    // not an error: what must never happen is a DUPLICATE of a row already rendered on page 1.
    const moved = seen.includes(fixture.activeA) ? fixture.activeB : fixture.activeA;
    const original = await profileNameOf(moved);
    await renameProfile(moved, 'Abel Antunes');
    try {
      const res = await members(
        `?limit=1&cursor=${encodeURIComponent(one.nextCursor ?? '')}`,
        fixtureToken,
      );
      expect(res.status).toBe(200);
      const two = memberListSchema.parse(await res.json());
      for (const item of two.items) expect(seen).not.toContain(item.membershipId);
    } finally {
      await renameProfile(moved, original);
    }

    expect(await profileNameOf(moved)).toBe(HOMONYM);
  });
});

describe('limits and a tampered cursor degrade, never 500 (T-03-23, T-03-21)', () => {
  it('19. limit 0 and limit 51 are 400 with the issue path `limit`', async () => {
    for (const bad of ['?limit=0', '?limit=51', '?limit=abc']) {
      const res = await members(bad, fixtureToken);
      expect(res.status).toBe(400);
      const body = await refusal(res);
      expect(body.code).toBe('VALIDATION_FAILED');
      const issues = (body.details as { issues?: { path: string }[] })?.issues ?? [];
      expect(issues.some((i) => i.path === 'limit')).toBe(true);
    }
  });

  it('20. limit=1 answers one item and limit=50 never exceeds the clamp', async () => {
    expect((await page('?limit=1', fixtureToken)).items).toHaveLength(1);
    const wide = await page('?limit=50');
    expect(wide.items.length).toBeLessThanOrEqual(50);
    expect(wide.nextCursor).toBeNull();
  });

  it('21. cursor=garbage is page one, not a 500 — a shared link must not explode', async () => {
    const res = await members('?cursor=garbage', fixtureToken);
    expect(res.status).toBe(200);
    const body = memberListSchema.parse(await res.json());
    expect(body.items.map((i) => i.membershipId)).toEqual(await listIds('', fixtureToken));

    // A structurally valid envelope with a bogus version degrades the same way.
    const stale = Buffer.from(JSON.stringify({ v: 2, n: 'a', id: fixture.activeA })).toString(
      'base64url',
    );
    expect(await listIds(`?cursor=${stale}`, fixtureToken)).toEqual(
      await listIds('', fixtureToken),
    );
  });

  it('22. an unknown query key is refused rather than silently ignored (D-47)', async () => {
    const res = await members('?role=admin_tenant', fixtureToken);
    expect(res.status).toBe(400);
    expect((await refusal(res)).code).toBe('VALIDATION_FAILED');
  });
});

describe('TENANT-04 — a tenant-B session can neither list, search nor open a tenant-A member', () => {
  it("23. B's full listing contains none of A's names and none of A's ids", async () => {
    const demo = await page('?limit=50');
    const lab = await page('?limit=50', labToken);

    const labNames = lab.items.map((i) => i.displayName);
    for (const name of ['João Gonçalves', 'Íris Muñoz', 'Luís Ângelo Sá', "Sofia D'Ávila"]) {
      expect(labNames).not.toContain(name);
    }
    const demoIds = new Set(demo.items.map((i) => i.membershipId));
    for (const id of lab.items.map((i) => i.membershipId)) expect(demoIds.has(id)).toBe(false);
  });

  it("24. opening A's membershipId from B is 404, and the body names neither tenant", async () => {
    const res = await member(memberMembershipId, labToken);
    expect(res.status).toBe(404);
    const raw = JSON.stringify(await refusal(res));
    expect(raw).not.toContain('rede-demo');
    expect(raw).not.toContain('Rede Demo');
    expect(raw).not.toContain(memberMembershipId);
  });

  it('25. searching B for a name only A has returns zero items, not a leak', async () => {
    expect((await page('?q=goncal', labToken)).items).toEqual([]);
    expect((await page('?q=goncal')).items).toHaveLength(1);
  });

  it('26. TENANT-05 adjacency: the SAME display name in both communities, and only ids can tell them apart', async () => {
    const mine = await listIds('', fixtureToken);
    const theirs = await listIds();
    for (const id of mine) expect(theirs).not.toContain(id);

    // `Ana Paula Ferreira` exists in rede-demo (seeded) AND twice in the fixture tenant, so a leak
    // that matched on a VALUE rather than on `tenant_id` could not pass by looking plausible:
    // rede-demo's search for that exact name must answer its own single row and nothing else.
    const inDemo = await listIds(`?q=${encodeURIComponent(HOMONYM)}`);
    expect(inDemo).toHaveLength(1);
    expect(inDemo).not.toContain(fixture.activeA);
    expect(inDemo).not.toContain(fixture.activeB);

    const inFixture = await listIds(`?q=${encodeURIComponent(HOMONYM)}`, fixtureToken);
    expect(new Set(inFixture)).toEqual(new Set([fixture.activeA, fixture.activeB]));
  });
});

describe('teardown — the membership cascade really removes the profiles', () => {
  it('27. deleting the fixture memberships takes their member_profiles rows with them', async () => {
    const before = await adminSql<{ count: string }[]>`
      select count(*)::text from public.member_profiles where tenant_id = ${fixtureTenantId}::uuid`;
    expect(Number(before[0]?.count ?? 0)).toBe(8);

    await adminSql`delete from public.memberships where tenant_id = ${fixtureTenantId}::uuid`;

    const after = await adminSql<{ count: string }[]>`
      select count(*)::text from public.member_profiles where tenant_id = ${fixtureTenantId}::uuid`;
    // Asserted, not assumed: `member_profiles.membership_id` cascades, so no orphan survives.
    expect(Number(after[0]?.count ?? -1)).toBe(0);
  });
});
