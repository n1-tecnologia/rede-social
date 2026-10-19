import { ApiError } from '@rede-social/core/server/http/api-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-02 (FOLLOW-01, FOLLOW-02, D-467): the follow service's decisions, without a database.
 *
 * `withTenantTx` is the mocked seam: each `tx.execute` answers the next queued result and counts as
 * one statement, so "before any write" is asserted as "exactly one statement ran" (the target
 * lookup). The SQL itself (the policies, the arbiter, the definer) is proved by pgTAP 200 and by
 * `apps/api/tests/integration/social.test.ts`.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const TARGET_USER = '22222222-2222-4222-8222-222222222222';
const TARGET_MEMBERSHIP = '33333333-3333-4333-8333-333333333333';
const ctx = {
  userId: ME,
  tenantId: '44444444-4444-4444-8444-444444444444',
  role: 'member' as const,
  requestId: 'req-1',
  events: [],
};

const lane = vi.hoisted(() => ({ results: [] as unknown[][], executed: 0 }));
vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      execute: async () => {
        lane.executed += 1;
        return lane.results.shift() ?? [];
      },
    }),
}));

const { followMember, unfollowMember } = await import('../server/service');

beforeEach(() => {
  lane.results = [];
  lane.executed = 0;
});

describe('followMember (D-467)', () => {
  it('refuses the caller’s own membership with the closed code self_follow before any write', async () => {
    lane.results = [[{ user_id: ME }]];
    const refusal = await followMember(ctx, TARGET_MEMBERSHIP).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(400);
    expect((refusal as ApiError).code).toBe('VALIDATION_FAILED');
    expect((refusal as ApiError).details).toEqual({ follow: 'self_follow' });
    expect(lane.executed).toBe(1);
  });

  it('answers the bare 404 for a target that is not a live member and writes nothing', async () => {
    lane.results = [[]];
    const refusal = await followMember(ctx, TARGET_MEMBERSHIP).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(404);
    expect((refusal as ApiError).code).toBe('NOT_FOUND');
    expect((refusal as ApiError).details).toBeUndefined();
    expect(lane.executed).toBe(1);
  });

  it('inserts once and answers following true with the definer count', async () => {
    lane.results = [
      [{ user_id: TARGET_USER }],
      [{ id: 'row' }],
      [{ counts: { followers: 3, following: 1 } }],
    ];
    await expect(followMember(ctx, TARGET_MEMBERSHIP)).resolves.toEqual({
      following: true,
      followerCount: 3,
    });
    expect(lane.executed).toBe(3);
  });

  it('answers the bare 404 when the target stopped being a live member after the insert', async () => {
    lane.results = [[{ user_id: TARGET_USER }], [], [{ counts: null }]];
    const refusal = await followMember(ctx, TARGET_MEMBERSHIP).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(404);
    expect((refusal as ApiError).details).toBeUndefined();
  });
});

describe('unfollowMember (EP-33)', () => {
  it('deletes the caller’s own row and answers following false with the live count', async () => {
    lane.results = [[{ user_id: TARGET_USER }], [], [{ counts: { followers: 0, following: 2 } }]];
    await expect(unfollowMember(ctx, TARGET_MEMBERSHIP)).resolves.toEqual({
      following: false,
      followerCount: 0,
    });
    expect(lane.executed).toBe(3);
  });

  it('answers following false and count 0 for a target that is no longer a live member', async () => {
    lane.results = [[{ user_id: TARGET_USER }], [], [{ counts: null }]];
    await expect(unfollowMember(ctx, TARGET_MEMBERSHIP)).resolves.toEqual({
      following: false,
      followerCount: 0,
    });
  });

  it('answers following false and never a 404 for an unknown membership, without a delete', async () => {
    lane.results = [[]];
    await expect(unfollowMember(ctx, TARGET_MEMBERSHIP)).resolves.toEqual({
      following: false,
      followerCount: 0,
    });
    expect(lane.executed).toBe(1);
  });
});
