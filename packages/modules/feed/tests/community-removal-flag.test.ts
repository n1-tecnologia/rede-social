import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10 review WR-01: a holder of `moderation.manage` may remove a single post inside a MEMBER
 * community (`softDeletePostInTx` admits `'community'` posts), so the post must tell the web so. The
 * menu decides its "Remover" row from the post's own `removal` key and never from a role, which means
 * the key has to ride a member community's page as well as Explorar.
 *
 * `withTenantTx` is the mocked seam: the first `execute` answers the community lookup, the second the
 * page projection. The SQL (which rows a lane may read) is proved by pgTAP and by the integration
 * suites; this file proves only what `toPost` stamps on a row the lane already returned.
 */

const TENANT = '44444444-4444-4444-8444-444444444444';
const COMMUNITY = '88888888-8888-4888-8888-888888888888';
const CREATOR = '11111111-1111-4111-8111-111111111111';
const MODERATOR = '22222222-2222-4222-8222-222222222222';

const lane = vi.hoisted(() => ({ answers: [] as unknown[][] }));

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ execute: async () => lane.answers.shift() ?? [] }),
}));

vi.mock('@rede-social/core/server/modules/flags-cache', () => ({
  moduleFlags: { isEnabled: async () => true },
}));

const { listCommunityFeed } = await import('../server/service');

const row = (overrides: Record<string, unknown>) => ({
  id: '55555555-5555-4555-8555-555555555555',
  created_at: '2026-11-12T12:00:00.000000Z',
  edited_at: null,
  caption: 'oi',
  community_id: COMMUNITY,
  community_name: 'Comunidade',
  community_slug: 'comunidade',
  like_count: 0,
  comment_count: 0,
  viewer_liked: false,
  author_user_id: CREATOR,
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
  visibility: 'community',
  ...overrides,
});

const ctxFor = (userId: string) => ({
  userId,
  tenantId: TENANT,
  role: 'admin_tenant' as const,
  requestId: 'req-1',
  events: [],
});

const QUERY = { limit: 20 } as Parameters<typeof listCommunityFeed>[2];

async function page(userId: string, rows: unknown[], canModerate?: boolean) {
  lane.answers = [[{ id: COMMUNITY, locked: false, post_count: rows.length }], rows];
  return listCommunityFeed(
    ctxFor(userId),
    COMMUNITY,
    QUERY,
    canModerate === undefined ? undefined : { canModerate },
  );
}

beforeEach(() => {
  lane.answers = [];
});

describe('WR-01: `removal` on a member community post', () => {
  it('a moderator sees removal "moderation" on the creator\'s community post', async () => {
    const result = await page(MODERATOR, [row({})], true);
    expect(result.items[0]?.audience).toBe('community');
    expect(result.items[0]?.removal).toBe('moderation');
  });

  it('a viewer who does not moderate gets no removal key', async () => {
    const result = await page(MODERATOR, [row({})], false);
    expect('removal' in (result.items[0] ?? {})).toBe(false);
  });

  it('the default (no options) is not a moderator', async () => {
    const result = await page(MODERATOR, [row({})]);
    expect('removal' in (result.items[0] ?? {})).toBe(false);
  });

  it('the author never gets removal on their own post, moderator or not', async () => {
    const result = await page(CREATOR, [row({})], true);
    expect(result.items[0]?.canManage).toBe(true);
    expect('removal' in (result.items[0] ?? {})).toBe(false);
  });

  it('an organization post in an organization community stays without removal (only member audiences carry it)', async () => {
    const result = await page(MODERATOR, [row({ visibility: 'tenant' })], true);
    expect('removal' in (result.items[0] ?? {})).toBe(false);
  });
});
