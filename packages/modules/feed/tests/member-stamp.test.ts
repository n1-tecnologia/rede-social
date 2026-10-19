import { ApiError } from '@rede-social/core/server/http/api-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-03 (D-473, SOCIAL-03; T-09-08): the audience of a new post is stamped by the SERVICE from the
 * caller's role, never from the request body, without a database.
 *
 * `withTenantTx` is the mocked seam: the fake `tx.insert(...).values(v)` captures what `createPost`
 * writes, and `tx.execute` answers the projection read with a row that mirrors the stamp. The SQL
 * (the restrictive insert policy, the shape check) is proved by pgTAP 201 and by
 * `apps/api/tests/integration/feed-social.test.ts`.
 */

const TENANT = '44444444-4444-4444-8444-444444444444';
const POST_ID = '55555555-5555-4555-8555-555555555555';
const ME = '11111111-1111-4111-8111-111111111111';

const lane = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  /** How many times a tenant-lane transaction was opened: a refusal before any lookup opens none. */
  opened: 0,
}));

/** 09-06: the kernel seam the media broker and the member rules read; one fixed policy here. */
const policy = vi.hoisted(() => ({
  current: {
    photoMaxBytes: 5 * 1024 * 1024,
    photosPerPost: 4,
    video: { enabled: false, maxDurationSeconds: 60, maxBytes: 100 * 1024 * 1024 },
  } as unknown,
}));

vi.mock('@rede-social/core/server/media/member-policy', () => ({
  memberMediaPolicyFor: async () => policy.current,
}));

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    lane.opened += 1;
    return fn({
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          lane.inserted.push(value);
          return { returning: async () => [{ id: POST_ID, ...value }] };
        },
      }),
      execute: async () => [
        {
          id: POST_ID,
          created_at: '2026-10-19T12:00:00.000000Z',
          edited_at: null,
          caption: 'oi',
          community_id: null,
          community_name: null,
          community_slug: null,
          like_count: 0,
          comment_count: 0,
          viewer_liked: false,
          author_user_id: ME,
          membership_id: '66666666-6666-4666-8666-666666666666',
          display_name: 'Helena',
          avatar_asset_id: null,
          media_kind: 'none',
          media: [],
          link_preview_status: null,
          link_preview_url: null,
          link_preview_title: null,
          link_preview_description: null,
          link_preview_site_name: null,
          link_preview_provider: null,
          link_preview_image_asset_id: null,
          visibility: lane.inserted[lane.inserted.length - 1]?.visibility ?? 'tenant',
        },
      ],
    });
  },
}));

const { createPost } = await import('../server/service');

const ctxFor = (role: 'member' | 'admin_tenant') => ({
  userId: ME,
  tenantId: TENANT,
  role,
  requestId: 'req-1',
  events: [],
});

beforeEach(() => {
  lane.inserted = [];
  lane.opened = 0;
});

describe('createPost stamps the audience from the role (D-473)', () => {
  it('a member context inserts visibility "followers" and the post answers audience "followers"', async () => {
    const post = await createPost(ctxFor('member'), { caption: 'oi' });
    expect(lane.inserted).toHaveLength(1);
    expect(lane.inserted[0]?.visibility).toBe('followers');
    expect(post.audience).toBe('followers');
  });

  it('an admin_tenant context inserts visibility "tenant" and emits no audience key', async () => {
    const post = await createPost(ctxFor('admin_tenant'), { caption: 'oi' });
    expect(lane.inserted[0]?.visibility).toBe('tenant');
    expect(post).not.toHaveProperty('audience');
  });

  it('a member cannot smuggle visibility "tenant" through the input', async () => {
    const forged = { caption: 'oi', visibility: 'tenant' } as unknown as Parameters<
      typeof createPost
    >[1];
    await createPost(ctxFor('member'), forged);
    expect(lane.inserted[0]?.visibility).toBe('followers');
  });
});

/**
 * 09-06 (D-473, T-09-20): a member post carries no attachment and no community, and the refusal is a
 * validation code answered BEFORE any asset or community lookup. Here the proof is that the tenant
 * lane was never opened (`lane.opened`): the integration suite proves the same through the real route.
 */
const ASSET = '77777777-7777-4777-8777-777777777777';
const COMMUNITY = '88888888-8888-4888-8888-888888888888';

async function refusal(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError, but the call resolved');
}

describe('createPost member authoring rules (D-473)', () => {
  it('refuses a non-empty attachmentAssetIds with member_no_attachments before any lookup', async () => {
    const error = await refusal(
      createPost(ctxFor('member'), { caption: 'oi', attachmentAssetIds: [ASSET] }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({ member: 'member_no_attachments' });
    expect(lane.opened).toBe(0);
    expect(lane.inserted).toHaveLength(0);
  });

  it('refuses a non-null communityId with member_no_community before any community lookup', async () => {
    const error = await refusal(
      createPost(ctxFor('member'), { caption: 'oi', communityId: COMMUNITY }),
    );
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ member: 'member_no_community' });
    expect(lane.opened).toBe(0);
  });

  it('refuses a video while the policy has video off, with member_video_off', async () => {
    const error = await refusal(
      createPost(ctxFor('member'), { caption: 'oi', videoAssetId: ASSET }),
    );
    expect(error.details).toEqual({ member: 'member_video_off' });
    expect(lane.opened).toBe(0);
  });

  it('refuses more images than photosPerPost with the existing too_many_images', async () => {
    const five = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const error = await refusal(
      createPost(ctxFor('member'), { caption: 'oi', imageAssetIds: five }),
    );
    expect(error.details).toEqual({ media: 'too_many_images' });
  });

  it('answers 403 when the policy is null (social off) for a member, and never for an admin', async () => {
    const saved = policy.current;
    policy.current = null;
    try {
      const error = await refusal(createPost(ctxFor('member'), { caption: 'oi' }));
      expect(error.status).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
      const post = await createPost(ctxFor('admin_tenant'), { caption: 'oi' });
      expect(post.caption).toBe('oi');
    } finally {
      policy.current = saved;
    }
  });

  it('leaves the admin path alone: an attachment and a community id are not refused for admin_tenant', async () => {
    // The mocked lane answers an empty asset read, so the admin path stops at asset validation, not
    // at a member code: the point is that no `member` detail is ever produced for staff.
    const error = await refusal(
      createPost(ctxFor('admin_tenant'), {
        caption: 'oi',
        attachmentAssetIds: [ASSET],
        communityId: COMMUNITY,
      }),
    );
    expect(error.details).not.toHaveProperty('member');
  });
});
