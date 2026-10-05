import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_ISSUE_SET,
  COMMUNITY_ISSUES,
  COMMUNITY_MAX_ORDER,
  reorderCommunitiesSchema,
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
  it('6. gains order_stale (2026-10-03) and keeps every earlier code', () => {
    expect([...COMMUNITY_ISSUES]).toEqual([
      'name_required',
      'archived',
      'cover_invalid',
      'order_stale',
    ]);
    expect(COMMUNITY_ISSUE_SET.has('order_stale')).toBe(true);
    // A miss is never in here: it is a bare 404 with no `details` (D-23).
    expect(COMMUNITY_ISSUE_SET.has('not_found')).toBe(false);
  });
});
