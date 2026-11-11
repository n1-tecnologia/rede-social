import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_ISSUE_SET,
  COMMUNITY_ISSUES,
  COMMUNITY_MAX_DESCRIPTION,
  COMMUNITY_MAX_NAME,
  COMMUNITY_MAX_ORDER,
  COMMUNITY_PERMISSIONS,
  COMMUNITY_UNLOCK_NAMES_MAX,
  communityUnlockRefusalSchema,
  createCommunitySchema,
  reorderCommunitiesSchema,
  updateCommunitySchema,
} from '../contracts/index';

/**
 * 2026-10-03 — `PUT /v1/communities/order`'s published contract, pinned without a server.
 *
 * The split this file exists to hold: a body that can NEVER be a permutation of anything — empty,
 * oversized, not uuids, the same community twice, an extra key — is refused HERE (400, before any
 * lookup), while a well-formed list that merely differs from the tenant's current set is the
 * service's `409 { community: 'order_stale' }`, because only the database knows the current set.
 *
 * A refusal is read the way the route's `defaultHook` reads it: the FIRST issue message that is in
 * `COMMUNITY_ISSUE_SET` would become `details.community`. The duplicate refusal deliberately has none,
 * so the route answers the plain `issues` list rather than inventing a community code for it.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** A distinct, valid v4-shaped uuid per index — enough of them to walk past the cap. */
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

describe('reorderCommunitiesSchema — one full permutation, bounded and duplicate-free', () => {
  it('1. a permutation of distinct uuids parses, in the order given (positive control)', () => {
    const parsed = reorderCommunitiesSchema.parse({ ids: [C, A, B] });
    expect(parsed.ids).toEqual([C, A, B]);
    // One id is a legal (if trivial) order: a tenant with a single community can still save it.
    expect(reorderCommunitiesSchema.safeParse({ ids: [A] }).success).toBe(true);
  });

  it('2. bounded: empty is refused, COMMUNITY_MAX_ORDER is accepted, one more is refused', () => {
    expect(reorderCommunitiesSchema.safeParse({ ids: [] }).success).toBe(false);

    const atCap = Array.from({ length: COMMUNITY_MAX_ORDER }, (_, index) => uuid(index + 1));
    expect(reorderCommunitiesSchema.safeParse({ ids: atCap }).success).toBe(true);

    const overCap = [...atCap, uuid(COMMUNITY_MAX_ORDER + 1)];
    expect(reorderCommunitiesSchema.safeParse({ ids: overCap }).success).toBe(false);
  });

  it('3. the same community twice is refused — including two spellings of one uuid', () => {
    expect(reorderCommunitiesSchema.safeParse({ ids: [A, B, A] }).success).toBe(false);
    // `z.uuid()` accepts upper-case hex, and uuid equality is Postgres' (integration case 32): the
    // upper-case spelling of A IS A, so a list naming both is not a permutation either.
    expect(reorderCommunitiesSchema.safeParse({ ids: [A, A.toUpperCase()] }).success).toBe(false);
    // …while one upper-case spelling on its own is a perfectly good id.
    expect(reorderCommunitiesSchema.safeParse({ ids: [A.toUpperCase(), B] }).success).toBe(true);
  });

  it('4. the duplicate refusal carries NO community code — it is input, not state', () => {
    const result = reorderCommunitiesSchema.safeParse({ ids: [A, A] });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => COMMUNITY_ISSUE_SET.has(message))).toBe(false);
  });

  it('5. strict: not-a-uuid, a missing `ids` and an unknown key are all refused', () => {
    expect(reorderCommunitiesSchema.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);
    expect(reorderCommunitiesSchema.safeParse({ ids: [A.slice(0, 35)] }).success).toBe(false);
    expect(reorderCommunitiesSchema.safeParse({}).success).toBe(false);
    expect(reorderCommunitiesSchema.safeParse({ ids: [A], communityId: B }).success).toBe(false);
    expect(reorderCommunitiesSchema.safeParse({ ids: A }).success).toBe(false);
  });
});

describe('COMMUNITY_ISSUES — the closed refusal vocabulary', () => {
  it('6. gains order_stale (2026-10-03), not_archived and unlock_active (09.3) and keeps every earlier code', () => {
    expect([...COMMUNITY_ISSUES]).toEqual([
      'name_required',
      'archived',
      'cover_invalid',
      'order_stale',
      'not_archived',
      'unlock_active',
    ]);
    expect(COMMUNITY_ISSUE_SET.has('order_stale')).toBe(true);
    expect(COMMUNITY_ISSUE_SET.has('not_archived')).toBe(true);
    expect(COMMUNITY_ISSUE_SET.has('unlock_active')).toBe(true);
    // A miss is never in here: it is a bare 404 with no `details` (D-23).
    expect(COMMUNITY_ISSUE_SET.has('not_found')).toBe(false);
  });
});

describe('communityUnlockRefusalSchema - the delete refusal the web parses (D-554)', () => {
  const product = (index: number) => ({ id: uuid(index), name: `Produto ${index}` });

  it('7. the cap is five names', () => {
    expect(COMMUNITY_UNLOCK_NAMES_MAX).toBe(5);
  });

  it('8. accepts 1 to 5 products with a count of at least 1 (a count above the list is the "e mais N")', () => {
    for (const size of [1, 2, 5]) {
      const products = Array.from({ length: size }, (_, index) => product(index + 1));
      expect(
        communityUnlockRefusalSchema.safeParse({
          community: 'unlock_active',
          products,
          count: size,
        }).success,
      ).toBe(true);
    }
    const five = Array.from({ length: 5 }, (_, index) => product(index + 1));
    const parsed = communityUnlockRefusalSchema.parse({
      community: 'unlock_active',
      products: five,
      count: 6,
    });
    expect(parsed.count).toBe(6);
    expect(parsed.products).toHaveLength(5);
  });

  it('9. refuses an empty list, six products, a non-uuid id, a count of 0 and another code', () => {
    const one = [product(1)];
    const six = Array.from({ length: 6 }, (_, index) => product(index + 1));
    const base = { community: 'unlock_active', products: one, count: 1 };
    expect(communityUnlockRefusalSchema.safeParse(base).success).toBe(true);
    expect(communityUnlockRefusalSchema.safeParse({ ...base, products: [] }).success).toBe(false);
    expect(communityUnlockRefusalSchema.safeParse({ ...base, products: six }).success).toBe(false);
    expect(
      communityUnlockRefusalSchema.safeParse({
        ...base,
        products: [{ id: 'not-a-uuid', name: 'x' }],
      }).success,
    ).toBe(false);
    expect(communityUnlockRefusalSchema.safeParse({ ...base, count: 0 }).success).toBe(false);
    expect(communityUnlockRefusalSchema.safeParse({ ...base, count: 1.5 }).success).toBe(false);
    expect(
      communityUnlockRefusalSchema.safeParse({ ...base, community: 'not_archived' }).success,
    ).toBe(false);
  });
});

/**
 * 10-05 (D-706, D-707, EP-01..03, EP-22): the member creator's published contract, without a server.
 * The body of a create or an edit never carries `kind`, `createdByUserId`, `position` or `productIds`:
 * both schemas are `.strict()`, so a forged key is a 400 and the service stamps from the session.
 */
describe('10-05: the member create and edit contract', () => {
  it('the permission strings: manage (unchanged), create and manage_own (member-only, composed in the app tier)', () => {
    expect(COMMUNITY_PERMISSIONS).toEqual({
      manage: 'communities.community.manage',
      create: 'communities.community.create',
      manageOwn: 'communities.community.manage_own',
    });
  });

  it('the create schema refuses kind, createdByUserId, position and productIds (mass assignment, T-10-15)', () => {
    expect(createCommunitySchema.safeParse({ name: 'x' }).success).toBe(true);
    for (const extra of [
      { kind: 'organization' },
      { kind: 'member' },
      { createdByUserId: '11111111-1111-4111-8111-111111111111' },
      { position: 0 },
      { productIds: [] },
    ]) {
      expect(
        createCommunitySchema.safeParse({ name: 'x', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('the edit schema refuses the same keys, and an empty object is still the valid no-op shape the route 400s on empty names only', () => {
    for (const extra of [
      { kind: 'member' },
      { createdByUserId: 'x' },
      { position: 1 },
      { productIds: [] },
    ]) {
      expect(updateCommunitySchema.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('EP-01 boundary: 80 name characters and 280 description characters parse, 81 and 281 do not', () => {
    const name = 'á'.repeat(COMMUNITY_MAX_NAME);
    const description = 'ç'.repeat(COMMUNITY_MAX_DESCRIPTION);
    expect(createCommunitySchema.safeParse({ name, description }).success).toBe(true);
    expect(createCommunitySchema.safeParse({ name: `${name}a` }).success).toBe(false);
    expect(
      createCommunitySchema.safeParse({ name: 'x', description: `${description}a` }).success,
    ).toBe(false);
  });

  it('EP-02 empty: an empty or whitespace-only name is name_required; no description and no cover parse', () => {
    for (const name of ['', '   ']) {
      const result = createCommunitySchema.safeParse({ name });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues.map((i) => i.message)).toContain(
        'name_required',
      );
    }
    expect(createCommunitySchema.parse({ name: 'x' })).toMatchObject({ description: '' });
  });

  it('EP-03 encoding: accents, an emoji and a combining sequence survive the parse byte for byte', () => {
    const name = 'Café ☕ e\u0301 🎉';
    expect(createCommunitySchema.parse({ name }).name).toBe(name);
  });
});
