import type { RequestContext } from '@rede-social/core/server/auth/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { communityViewerFlags } from '../server/service';

/**
 * Phase 10 review WR-02: `viewer.actions.story` follows the STORY rule, not the post rule.
 *
 * The community page draws its "+ Seu story" door from `viewer.actions.story`. A story needs the
 * story permissions (`stories.story.publish`, and `stories.story.manage` for an organization place),
 * which exist only while the `stories` module is composed. With `stories` off and `communities` on, the
 * post rule (`feed.post.create` + `content.publish`, or `manage_own`) still holds, and the door used to
 * appear on a route that redirects away. `viewer.actions` keeps the same five keys (the Escopo seam is
 * behaviour-neutral); only the value of `story` changes.
 *
 * `withTenantTx` is the seam: `getCommunity` reads one row and `viewerOf` decides from the row and the
 * permission flags, with no database.
 */

const COMMUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const lane = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ execute: async () => lane.rows }),
}));

const { getCommunity } = await import('../server/service');

const ctx = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  role: 'admin_tenant',
  requestId: 'req-1',
  events: [],
} as unknown as RequestContext;

const row = (overrides: Record<string, unknown>) => ({
  id: COMMUNITY_ID,
  name: 'Avisos',
  slug: 'avisos',
  description: '',
  cover_asset_id: null,
  cover_variant_widths: null,
  post_count: 0,
  status: 'active',
  last_activity_at: '2026-11-12T12:00:00.000000Z',
  kind: 'organization',
  is_owner: false,
  creator_membership_id: null,
  creator_display_name: null,
  creator_avatar_asset_id: null,
  ...overrides,
});

/** The composed permission sets the review names. */
const ADMIN_STORIES_ON = [
  'communities.community.manage',
  'feed.post.create',
  'content.publish',
  'stories.story.manage',
  'stories.story.publish',
];
const ADMIN_STORIES_OFF = ['communities.community.manage', 'feed.post.create', 'content.publish'];
const MEMBER_STORIES_ON = ['communities.community.manage_own', 'stories.story.publish'];
const MEMBER_STORIES_OFF = ['communities.community.manage_own'];

async function actionsFor(granted: string[], overrides: Record<string, unknown>) {
  lane.rows = [row(overrides)];
  const community = await getCommunity(ctx, COMMUNITY_ID, communityViewerFlags(granted));
  return community.viewer;
}

beforeEach(() => {
  lane.rows = [];
});

describe('WR-02: the community story door follows the story rule', () => {
  it('organization community, admin, stories ON: the door is open and so is the post action', async () => {
    const viewer = await actionsFor(ADMIN_STORIES_ON, {});
    expect(viewer.actions.story).toBe(true);
    expect(viewer.actions.post).toBe(true);
  });

  it('organization community, admin, stories OFF: the door is absent while the post action stays', async () => {
    const viewer = await actionsFor(ADMIN_STORIES_OFF, {});
    expect(viewer.actions.story).toBe(false);
    expect(viewer.actions.post).toBe(true);
  });

  it('organization community, publish without manage: no door (the old gate needed both halves)', async () => {
    const viewer = await actionsFor(
      ['feed.post.create', 'content.publish', 'stories.story.publish'],
      {},
    );
    expect(viewer.actions.story).toBe(false);
  });

  it('member community, its creator, stories ON: the door is open', async () => {
    const viewer = await actionsFor(MEMBER_STORIES_ON, { kind: 'member', is_owner: true });
    expect(viewer.actions.story).toBe(true);
    expect(viewer.actions.post).toBe(true);
  });

  it('member community, its creator, stories OFF: the door is absent while the post action stays', async () => {
    const viewer = await actionsFor(MEMBER_STORIES_OFF, { kind: 'member', is_owner: true });
    expect(viewer.actions.story).toBe(false);
    expect(viewer.actions.post).toBe(true);
  });

  it('member community, a reader who is not the creator: no door', async () => {
    const viewer = await actionsFor(MEMBER_STORIES_ON, { kind: 'member', is_owner: false });
    expect(viewer.actions.story).toBe(false);
  });

  it('member community, an admin who is not the creator: no door even with every story key', async () => {
    const viewer = await actionsFor(ADMIN_STORIES_ON, { kind: 'member', is_owner: false });
    expect(viewer.actions.story).toBe(false);
  });

  it('the seam keeps its five keys', async () => {
    const viewer = await actionsFor(ADMIN_STORIES_ON, {});
    expect(Object.keys(viewer.actions).sort()).toEqual([
      'comment',
      'like',
      'post',
      'share',
      'story',
    ]);
  });
});
