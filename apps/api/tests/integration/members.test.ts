import { memberListSchema, memberProfileSchema, ownProfileSchema } from '@tria/contracts/profiles';
import { sqlClient } from '@tria/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * PROF-02 / PROF-03 / TENANT-04 — the member directory and one member's profile against the live
 * local stack.
 *
 * The tracer is one path through every layer: a seeded member lists their community, searches it by
 * an unaccented fragment, follows the keyset cursor to the next page, and opens one of the results.
 *
 * Three invariants are asserted here rather than assumed:
 *  - D-45: the single-member payload carries EXACTLY photo, display name and bio — the key set is
 *    pinned, so a later column cannot leak into it.
 *  - D-47: the seeded `admin_tenant` is ABSENT from the listing and yet reachable by direct link —
 *    the two routes apply deliberately different predicates.
 *  - the promote invariant (03-02's other half): `GET /v1/me/profile` and
 *    `GET /v1/members/{own membershipId}` agree, because there is ONE row, not two storage paths.
 */

const MEMBER_EMAIL = 'member@tria-demo.local';
const ADMIN_EMAIL = 'admin@tria-demo.local';

let memberToken = '';
let memberMembershipId = '';
let adminMembershipId = '';

const members = (query = '', token?: string) =>
  api.request(`/v1/members${query}`, {
    headers: { authorization: `Bearer ${token ?? memberToken}` },
  });

const member = (membershipId: string, token?: string) =>
  api.request(`/v1/members/${membershipId}`, {
    headers: { authorization: `Bearer ${token ?? memberToken}` },
  });

async function membershipIdOf(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select m.id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.id;
}

async function listAll(query = ''): Promise<{ membershipId: string; displayName: string }[]> {
  const res = await members(query);
  expect(res.status).toBe(200);
  return memberListSchema.parse(await res.json()).items;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  memberMembershipId = await membershipIdOf(MEMBER_EMAIL);
  adminMembershipId = await membershipIdOf(ADMIN_EMAIL);
});

afterAll(async () => {
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

    // The seed leaves nine active `member` rows in tria-demo; the page size is 25, so one page holds
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
    const goncal = await listAll('?q=goncal');
    expect(goncal.map((i) => i.displayName)).toEqual(['João Gonçalves']);

    const munoz = await listAll('?q=MUNOZ');
    expect(munoz.map((i) => i.displayName)).toEqual(['Íris Muñoz']);

    // An ACCENTED query still matches — the fold runs on both sides of the comparison.
    const iris = await listAll(`?q=${encodeURIComponent('Íris')}`);
    expect(iris.map((i) => i.displayName)).toEqual(['Íris Muñoz']);
  });

  it('3. ?limit=3 pages with an opaque cursor — every member exactly once, no gap, no duplicate', async () => {
    const everyone = await listAll();

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res: Response = await members(query);
      expect(res.status).toBe(200);
      const page = memberListSchema.parse(await res.json());
      if (pages === 0) {
        expect(page.items).toHaveLength(3);
        expect(page.nextCursor).not.toBeNull();
      }
      collected.push(...page.items.map((i) => i.membershipId));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20); // the loop must terminate; a non-advancing cursor would not
    } while (cursor !== null);

    expect(new Set(collected).size).toBe(collected.length);
    expect(collected).toEqual(everyone.map((i) => i.membershipId));
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

    const everyone = await listAll();
    expect(everyone.map((i) => i.membershipId)).not.toContain(adminMembershipId);
  });

  it('6. PROMOTE INVARIANT: my own profile and my profile as a member are the same row', async () => {
    const own = ownProfileSchema.parse(
      await (await api.request('/v1/me/profile', {
        headers: { authorization: `Bearer ${memberToken}` },
      })).json(),
    );
    const asMember = memberProfileSchema.parse(await (await member(memberMembershipId)).json());

    expect(asMember.membershipId).toBe(own.membershipId);
    expect(asMember.displayName).toBe(own.displayName);
    expect(asMember.bio).toBe(own.bio);
    expect(asMember.avatarUrl).toBe(own.avatarUrl);
    expect(asMember.avatarAssetId).toBe(own.avatarAssetId);
  });
});
