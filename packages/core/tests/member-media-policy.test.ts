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

/**
 * 10-07 (D-715, MSTORY-07, Pitfall 10, A9): the member media rules reach the `story` and `cover`
 * purposes. They are pure functions of the purpose and the policy's seconds, so the three decisions the
 * broker makes at `start` and the minutes share can be pinned without a database.
 */
describe('10-07 member media purposes', () => {
  it('the member photo cap applies to post, story and cover, and to no other purpose', async () => {
    const seam = await fresh();
    for (const purpose of ['post', 'story', 'cover']) {
      expect(seam.memberPhotoCapApplies(purpose), purpose).toBe(true);
    }
    for (const purpose of ['avatar', 'attachment', 'lesson']) {
      expect(seam.memberPhotoCapApplies(purpose), purpose).toBe(false);
    }
  });

  it('member video is allowed for post and story only: never cover, lesson, avatar or attachment', async () => {
    const seam = await fresh();
    expect(seam.memberVideoPurposeAllowed('post')).toBe(true);
    expect(seam.memberVideoPurposeAllowed('story')).toBe(true);
    for (const purpose of ['cover', 'lesson', 'avatar', 'attachment']) {
      expect(seam.memberVideoPurposeAllowed(purpose), purpose).toBe(false);
    }
  });

  it('A9: a story video is capped at the LOWER of the member seconds and 60; a post video keeps the member seconds', async () => {
    const seam = await fresh();
    expect(seam.memberVideoDurationCap('story', 300)).toBe(60);
    expect(seam.memberVideoDurationCap('story', 60)).toBe(60);
    expect(seam.memberVideoDurationCap('story', 30)).toBe(30);
    expect(seam.memberVideoDurationCap('post', 300)).toBe(300);
    expect(seam.memberVideoDurationCap('post', 30)).toBe(30);
  });

  it('the member video-minutes share counts post and story videos', async () => {
    const seam = await fresh();
    expect([...seam.MEMBER_SHARED_VIDEO_PURPOSES]).toEqual(['post', 'story']);
  });
});
