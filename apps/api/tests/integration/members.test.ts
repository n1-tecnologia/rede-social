import {
  memberListSchema,
  memberProfileSchema,
  ownProfileSchema,
} from '@rede-social/contracts/profiles';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, SEED_PASSWORD, signInAs } from './setup';

/**
 * PROF-02 / PROF-03 / TENANT-04 — the member directory and one member's profile against the live
 * local stack.
 *
 * The tracer is one path through every layer: the seeded admin lists the community, searches it by
 * an unaccented fragment, follows the keyset cursor to the next page, and a seeded member opens one
 * of the results.
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
 *  - pendencias item 7 (quick 261016-jsq): the LIST is staff-only (`admin_tenant`, `support_tenant`;
 *    403 `FORBIDDEN` for `member`) and the single read stays open to every member. 09-02 (D-466)
 *    reopens the list to a `member` ONLY while `social` is on for the tenant (rede-lab, 200) and
 *    keeps the 403 otherwise (rede-demo and the throwaway fixture tenant, `social` off); a blocked
 *    member (`blocked_at` set, D-484) is absent for everyone.
 */

const MEMBER_EMAIL = 'member@rede-demo.local';
const ADMIN_EMAIL = 'admin@rede-demo.local';
const SUPPORT_EMAIL = 'support@rede-demo.local';
const LAB_MEMBER_EMAIL = 'member@rede-lab.local';
const LAB_ADMIN_EMAIL = 'admin@rede-lab.local';

const RUN = Date.now();
const FIXTURE_SLUG = `mb-${RUN}`.slice(0, 40);
const FIXTURE_PASSWORD = 'Segredo123';
/** The two homonyms the adjacency case needs: identical names, two stable adjacent slots. */
const HOMONYM = 'Ana Paula Ferreira';

let memberToken = '';
let memberMembershipId = '';
let adminMembershipId = '';
let labToken = '';
/** Staff tokens: the directory LIST is staff-only since pendencias item 7. */
let staffToken = '';
let supportToken = '';
let labStaffToken = '';

/** The throwaway community: every role × status combination D-47 has an opinion about. */
let fixtureTenantId = '';
let fixtureToken = '';
/** The fixture tenant's support seat: the staff reader of the fixture directory. */
let fixtureStaffToken = '';
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

/** The LIST defaults to the demo staff token (pendencias item 7: a member gets 403). */
const members = (query = '', token?: string) =>
  api.request(`/v1/members${query}`, {
    headers: { authorization: `Bearer ${token ?? staffToken}` },
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

  if (opts.signIn) {
    const token = await signInAs(email, FIXTURE_PASSWORD);
    if ((opts.role ?? 'member') === 'member') fixtureToken = token;
    else fixtureStaffToken = token;
  }
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
  staffToken = await signInAs(ADMIN_EMAIL, SEED_PASSWORD);
  supportToken = await signInAs(SUPPORT_EMAIL, SEED_PASSWORD);
  labStaffToken = await signInAs(LAB_ADMIN_EMAIL, SEED_PASSWORD);
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
    signIn: true,
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
    const ids = await listIds('', fixtureStaffToken);
    expect(new Set(ids)).toEqual(new Set([fixture.activeA, fixture.activeB, fixture.activeZ]));
    expect(ids).toHaveLength(3);
  });

  it('8. admin_tenant, support_tenant, invited, blocked and soft-deleted are all absent', async () => {
    const ids = await listIds('', fixtureStaffToken);
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
    const none = await listIds('', fixtureStaffToken);
    const empty = await listIds('?q=', fixtureStaffToken);
    const blank = await listIds('?q=%20%20', fixtureStaffToken);
    expect(empty).toEqual(none);
    expect(blank).toEqual(none);
  });

  it('12. `%` and `_` are LITERALS — a member cannot widen their own result set', async () => {
    // Unescaped, `like '%%%'` would return the whole directory; the escape clause makes it zero.
    const percent = await page('?q=%25', fixtureStaffToken);
    expect(percent.items).toEqual([]);
    const underscore = await page('?q=_', fixtureStaffToken);
    expect(underscore.items).toEqual([]);
    const backslash = await page('?q=%5C', fixtureStaffToken);
    expect(backslash.items).toEqual([]);
  });

  it('13. a term matching nothing is 200 with an empty page, never a 404', async () => {
    const res = await members('?q=nao-existe-ninguem-assim', fixtureStaffToken);
    expect(res.status).toBe(200);
    expect(memberListSchema.parse(await res.json())).toEqual({ items: [], nextCursor: null });
  });

  it('14. exactly one match answers one item and a null cursor', async () => {
    const body = await page('?q=zulmira', fixtureStaffToken);
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
    const first = await listIds('', fixtureStaffToken);
    const second = await listIds('', fixtureStaffToken);
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
        fixtureStaffToken,
      );
      expect(body.items.length).toBeLessThanOrEqual(1);
      collected.push(...body.items.map((i) => i.membershipId));
      cursor = body.nextCursor;
      guard += 1;
      expect(guard).toBeLessThan(10);
    } while (cursor !== null);

    expect(collected).toEqual(await listIds('', fixtureStaffToken));
    expect(collected.filter((id) => id === fixture.activeA)).toHaveLength(1);
    expect(collected.filter((id) => id === fixture.activeB)).toHaveLength(1);
  });

  it('18. a rename between page 1 and page 2 still answers a well-formed page with no duplicate', async () => {
    const one = await page('?limit=1', fixtureStaffToken);
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
        fixtureStaffToken,
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
      const res = await members(bad, fixtureStaffToken);
      expect(res.status).toBe(400);
      const body = await refusal(res);
      expect(body.code).toBe('VALIDATION_FAILED');
      const issues = (body.details as { issues?: { path: string }[] })?.issues ?? [];
      expect(issues.some((i) => i.path === 'limit')).toBe(true);
    }
  });

  it('20. limit=1 answers one item and limit=50 never exceeds the clamp', async () => {
    expect((await page('?limit=1', fixtureStaffToken)).items).toHaveLength(1);
    const wide = await page('?limit=50');
    expect(wide.items.length).toBeLessThanOrEqual(50);
    expect(wide.nextCursor).toBeNull();
  });

  it('21. cursor=garbage is page one, not a 500 — a shared link must not explode', async () => {
    const res = await members('?cursor=garbage', fixtureStaffToken);
    expect(res.status).toBe(200);
    const body = memberListSchema.parse(await res.json());
    expect(body.items.map((i) => i.membershipId)).toEqual(await listIds('', fixtureStaffToken));

    // A structurally valid envelope with a bogus version degrades the same way.
    const stale = Buffer.from(JSON.stringify({ v: 2, n: 'a', id: fixture.activeA })).toString(
      'base64url',
    );
    expect(await listIds(`?cursor=${stale}`, fixtureStaffToken)).toEqual(
      await listIds('', fixtureStaffToken),
    );
  });

  it('22. an unknown query key is refused rather than silently ignored (D-47)', async () => {
    const res = await members('?role=admin_tenant', fixtureStaffToken);
    expect(res.status).toBe(400);
    expect((await refusal(res)).code).toBe('VALIDATION_FAILED');
  });
});

describe('TENANT-04 — a tenant-B session can neither list, search nor open a tenant-A member', () => {
  it("23. B's full listing contains none of A's names and none of A's ids", async () => {
    const demo = await page('?limit=50');
    const lab = await page('?limit=50', labStaffToken);

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
    expect((await page('?q=goncal', labStaffToken)).items).toEqual([]);
    expect((await page('?q=goncal')).items).toHaveLength(1);
  });

  it('26. TENANT-05 adjacency: the SAME display name in both communities, and only ids can tell them apart', async () => {
    const mine = await listIds('', fixtureStaffToken);
    const theirs = await listIds();
    for (const id of mine) expect(theirs).not.toContain(id);

    // `Ana Paula Ferreira` exists in rede-demo (seeded) AND twice in the fixture tenant, so a leak
    // that matched on a VALUE rather than on `tenant_id` could not pass by looking plausible:
    // rede-demo's search for that exact name must answer its own single row and nothing else.
    const inDemo = await listIds(`?q=${encodeURIComponent(HOMONYM)}`);
    expect(inDemo).toHaveLength(1);
    expect(inDemo).not.toContain(fixture.activeA);
    expect(inDemo).not.toContain(fixture.activeB);

    const inFixture = await listIds(`?q=${encodeURIComponent(HOMONYM)}`, fixtureStaffToken);
    expect(new Set(inFixture)).toEqual(new Set([fixture.activeA, fixture.activeB]));
  });
});

describe('pendencias item 7 / 09-02 D-466 — the directory is staff-only until social is on (403 FORBIDDEN for member)', () => {
  /** Numbered after 27 though it runs before the teardown, which deletes the fixture memberships. */
  it('28. the seeded demo member gets 403 FORBIDDEN, no details, on every list query', async () => {
    for (const query of ['', '?q=goncal', '?cursor=garbage', '?limit=0']) {
      const res = await members(query, memberToken);
      expect(res.status, query).toBe(403);
      const raw = await res.text();
      const { error } = JSON.parse(raw) as Envelope;
      expect(error.code, query).toBe('FORBIDDEN');
      expect(error.details, query).toBeUndefined();
      expect(raw).not.toContain('João Gonçalves');
      expect(raw).not.toContain('Íris Muñoz');
    }
  });

  it('29. the seeded demo support and demo admin both list, with the same ordered ids', async () => {
    const asSupport = await listIds('?limit=50', supportToken);
    const asAdmin = await listIds('?limit=50', staffToken);
    expect(asSupport.length).toBeGreaterThanOrEqual(8);
    expect(asSupport).toEqual(asAdmin);
  });

  it('30. the fixture member gets 403 while the fixture support seat lists exactly the three active ids', async () => {
    const refused = await members('', fixtureToken);
    expect(refused.status).toBe(403);
    expect((await refusal(refused)).code).toBe('FORBIDDEN');

    const ids = await listIds('', fixtureStaffToken);
    expect(new Set(ids)).toEqual(new Set([fixture.activeA, fixture.activeB, fixture.activeZ]));
    expect(ids).toHaveLength(3);
  });

  it('31. D-466: with social ON the lab member lists members only (never staff, never a blocked one); staff keep 200', async () => {
    const res = await members('?limit=50', labToken);
    expect(res.status).toBe(200);
    const body = memberListSchema.parse(await res.json());
    const ids = body.items.map((item) => item.membershipId);
    // The lab has three named members plus the seeded `member@` account; staff are never listed.
    expect(ids.length).toBeGreaterThanOrEqual(4);
    const staff = await adminSql<{ id: string }[]>`
      select m.id from public.memberships m join public.tenants t on t.id = m.tenant_id
       where t.slug = 'rede-lab' and m.role in ('admin_tenant', 'support_tenant')`;
    expect(staff.length).toBeGreaterThanOrEqual(2);
    for (const row of staff) expect(ids).not.toContain(row.id);

    // D-484: a blocked member leaves the directory and returns when unblocked.
    const [target] = await adminSql<{ id: string }[]>`
      select m.id from public.memberships m
        join public.tenants t on t.id = m.tenant_id
        join public.users u on u.id = m.user_id
       where t.slug = 'rede-lab' and u.email = 'marcos.vinicius@rede-lab.local'`;
    expect(target).toBeDefined();
    try {
      await adminSql`update public.memberships set status = 'blocked', blocked_at = now() where id = ${target?.id ?? ''}::uuid`;
      const blocked = memberListSchema.parse(await (await members('?limit=50', labToken)).json());
      expect(blocked.items.map((item) => item.membershipId)).not.toContain(target?.id);
      // Staff see the same: a blocked member is absent from the directory for everyone.
      const staffView = memberListSchema.parse(
        await (await members('?limit=50', labStaffToken)).json(),
      );
      expect(staffView.items.map((item) => item.membershipId)).not.toContain(target?.id);
    } finally {
      await adminSql`update public.memberships set status = 'active', blocked_at = null where id = ${target?.id ?? ''}::uuid`;
    }
    const restored = memberListSchema.parse(await (await members('?limit=50', labToken)).json());
    expect(restored.items.map((item) => item.membershipId)).toContain(target?.id);

    const staffRes = await members('?limit=50', labStaffToken);
    expect(staffRes.status).toBe(200);
    memberListSchema.parse(await staffRes.json());
  });

  it('31b. D-466: with social OFF the same member call is 403 FORBIDDEN before an invalid limit is validated', async () => {
    const [lab] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-lab'`;
    const labId = lab?.id ?? '';
    const [previous] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules where tenant_id = ${labId}::uuid and module_key = 'social'`;
    try {
      await adminSql`
        update public.tenant_modules set enabled = false, updated_at = now()
         where tenant_id = ${labId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labId);
      for (const query of ['', '?q=helena', '?limit=0', '?cursor=garbage']) {
        const refused = await members(query, labToken);
        expect(refused.status, query).toBe(403);
        const { error } = (await refused.json()) as Envelope;
        expect(error.code, query).toBe('FORBIDDEN');
        expect(error.details, query).toBeUndefined();
      }
      // Staff always list, social or not.
      expect((await members('?limit=50', labStaffToken)).status).toBe(200);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = ${previous?.enabled ?? true}, updated_at = now()
         where tenant_id = ${labId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labId);
    }
  });

  it("32. the seeded demo member still opens another member's profile and the admin's by id (200)", async () => {
    const other = (await listIds('?limit=50')).find((id) => id !== memberMembershipId);
    expect(other).toBeDefined();
    for (const id of [other ?? '', adminMembershipId]) {
      const res = await member(id, memberToken);
      expect(res.status, id).toBe(200);
      expect(memberProfileSchema.parse(await res.json()).membershipId).toBe(id);
    }
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
