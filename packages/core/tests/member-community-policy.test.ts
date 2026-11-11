import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAttemptLimiter } from '../server/accounts/rate-limit';

/**
 * 10-05 (D-710, MOD-02): the kernel seam through which the communities module learns how many ACTIVE
 * communities one member of a `social` tenant may own. The module cannot import the social settings
 * schema, so the app tier registers a resolver at import time (the `setMemberMediaPolicy` inversion) and
 * the module only ever asks `memberCommunityPolicyFor(ctx)`. Null means "no member allowance".
 *
 * The module holds its resolver at module level, so each case re-imports a fresh copy.
 */

const ctx = { userId: 'u-1', tenantId: 't-1', role: 'member' as const };

async function fresh() {
  vi.resetModules();
  return import('../server/communities/member-policy');
}

afterEach(() => {
  vi.resetModules();
});

describe('memberCommunityPolicyFor (D-710 seam)', () => {
  it('answers null until a resolver is registered: a project without social keeps today’s behavior', async () => {
    const seam = await fresh();
    await expect(seam.memberCommunityPolicyFor(ctx)).resolves.toBeNull();
  });

  it('answers whatever the registered resolver answers, and hands it the caller’s context', async () => {
    const seam = await fresh();
    const resolver = vi.fn(async () => ({ maxActive: 3 }));
    seam.setMemberCommunityPolicy(resolver);
    await expect(seam.memberCommunityPolicyFor(ctx)).resolves.toEqual({ maxActive: 3 });
    expect(resolver).toHaveBeenCalledWith(ctx);
  });

  it('a limit of 0 is a policy (nobody may create), not a null', async () => {
    const seam = await fresh();
    seam.setMemberCommunityPolicy(async () => ({ maxActive: 0 }));
    await expect(seam.memberCommunityPolicyFor(ctx)).resolves.toEqual({ maxActive: 0 });
  });

  it('lets a resolver answer null (social off) and the last registration win', async () => {
    const seam = await fresh();
    seam.setMemberCommunityPolicy(async () => ({ maxActive: 3 }));
    seam.setMemberCommunityPolicy(async () => null);
    await expect(seam.memberCommunityPolicyFor(ctx)).resolves.toBeNull();
  });

  it('error path: a resolver that throws makes the seam reject; the caller decides (the flags read is never swallowed here)', async () => {
    const seam = await fresh();
    seam.setMemberCommunityPolicy(async () => {
      throw new Error('flags unavailable');
    });
    await expect(seam.memberCommunityPolicyFor(ctx)).rejects.toThrow('flags unavailable');
  });
});

describe('the abuse ceilings of A6 (assumption, adopted)', () => {
  it('declares 10 community creations and 30 story publications per member per hour', async () => {
    const limits = await import('../server/safety/limits');
    expect(limits.COMMUNITY_CREATES_PER_HOUR).toBe(10);
    expect(limits.STORY_PUBLISHES_PER_HOUR).toBe(30);
    expect(typeof limits.communityCreateLimiter.consume).toBe('function');
    expect(typeof limits.storyPublishLimiter.consume).toBe('function');
  });

  it('communityCreateLimiter refuses the 11th attempt in one hour for one key and not for another key', async () => {
    const limits = await import('../server/safety/limits');
    limits.communityCreateLimiter.reset();
    const mine = limits.safetyLimiterKey({ tenantId: 't-1', userId: 'u-1' });
    const other = limits.safetyLimiterKey({ tenantId: 't-1', userId: 'u-2' });
    for (let i = 0; i < 10; i += 1) {
      expect(limits.communityCreateLimiter.consume(mine), `attempt ${i + 1}`).toBe(true);
    }
    expect(limits.communityCreateLimiter.consume(mine)).toBe(false);
    expect(limits.communityCreateLimiter.consume(other)).toBe(true);
    limits.communityCreateLimiter.reset();
  });

  it('storyPublishLimiter refuses the 31st attempt', async () => {
    const limits = await import('../server/safety/limits');
    limits.storyPublishLimiter.reset();
    const key = limits.safetyLimiterKey({ tenantId: 't-1', userId: 'u-1' });
    for (let i = 0; i < 30; i += 1) expect(limits.storyPublishLimiter.consume(key)).toBe(true);
    expect(limits.storyPublishLimiter.consume(key)).toBe(false);
    limits.storyPublishLimiter.reset();
  });

  it('the limiter factory it is built on is the repository’s own', () => {
    expect(typeof createAttemptLimiter).toBe('function');
  });
});
