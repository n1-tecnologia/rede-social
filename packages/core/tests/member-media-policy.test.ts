import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-06 (D-474, MOD-02): the kernel seam through which the media broker learns what a member of a
 * `social` tenant may upload. The broker cannot import the social settings schema, so the app tier
 * registers a resolver at import time (the `setPermissionResolver` inversion) and the broker only
 * ever asks `memberMediaPolicyFor(ctx)`. Null means "no member allowance".
 *
 * The module holds its resolver at module level, so each case re-imports a fresh copy.
 */

const ctx = { userId: 'u-1', tenantId: 't-1', role: 'member' as const };
const policy = {
  photoMaxBytes: 1048576,
  photosPerPost: 4,
  video: { enabled: false, maxDurationSeconds: 60, maxBytes: 104857600 },
};

async function fresh() {
  vi.resetModules();
  return import('../server/media/member-policy');
}

afterEach(() => {
  vi.resetModules();
});

describe('memberMediaPolicyFor (D-474 seam)', () => {
  it('answers null until a resolver is registered: a project without social keeps today’s behavior', async () => {
    const seam = await fresh();
    await expect(seam.memberMediaPolicyFor(ctx)).resolves.toBeNull();
  });

  it('answers whatever the registered resolver answers, and hands it the caller’s context', async () => {
    const seam = await fresh();
    const resolver = vi.fn(async () => policy);
    seam.setMemberMediaPolicy(resolver);
    await expect(seam.memberMediaPolicyFor(ctx)).resolves.toEqual(policy);
    expect(resolver).toHaveBeenCalledWith(ctx);
  });

  it('lets a resolver answer null (social off) and the last registration win', async () => {
    const seam = await fresh();
    seam.setMemberMediaPolicy(async () => policy);
    seam.setMemberMediaPolicy(async () => null);
    await expect(seam.memberMediaPolicyFor(ctx)).resolves.toBeNull();
  });
});
