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

const lane = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[] }));

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
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
    }),
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
