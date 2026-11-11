import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-14 (UI-D-710, UI-D-711, the Escopo seam) — `/criar?comunidade={id}` for a MEMBER.
 *
 * The page is an async server component, called directly with its collaborators mocked; the element
 * it returns is inspected for the props it hands to `ComposerForm`. What the page owns:
 *
 *  - a member who may publish in the community (the API's `viewer.actions.post`, the Escopo seam,
 *    read here and nowhere else: never the owner flag, never a role) gets the in-community composer;
 *  - a foreign id, an archived community, a miss or a failed read falls back SILENTLY to the plain
 *    member composer (the D-93 rule; the API's 403 is the real control): no redirect, no error;
 *  - the first value of a repeated `?comunidade=` wins.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  loadCommunity: vi.fn(),
  listAllCommunities: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    tenant: { displayName: 'Rede Lab' },
    membership: { role: 'member' },
    modules: [{ key: 'communities' }],
  }),
}));
vi.mock('@/lib/communities', () => ({
  loadCommunity: (...args: unknown[]) => mocks.loadCommunity(...args),
  listAllCommunities: (...args: unknown[]) => mocks.listAllCommunities(...args),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/social-settings', () => ({
  socialMediaLimits: () => ({
    photoMaxBytes: 1024,
    photosPerPost: 4,
    video: { enabled: false, maxDurationSeconds: 60, maxBytes: 1024 },
  }),
}));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: 'tenant' }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => mocks.redirect(path),
}));

const { default: CreatePostPage } = await import('./page');

const ID = '5d0c1c2e-7a41-4c52-9d3a-0e6f1b2c3d40';
const MEMBER_PERMISSIONS = ['feed.post.create', 'social.participate'];

type Overrides = {
  id?: string;
  name?: string;
  status?: 'active' | 'archived';
  kind?: 'organization' | 'member';
  isOwner?: boolean;
  canPublish?: boolean;
  post?: boolean;
  story?: boolean;
};

function community(over: Overrides = {}) {
  const canPublish = over.canPublish ?? true;
  return {
    id: over.id ?? ID,
    name: over.name ?? 'Clube de Leitura',
    slug: 'clube',
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: over.status ?? 'active',
    lastActivityAt: '2026-11-01T00:00:00.000Z',
    kind: over.kind ?? 'member',
    createdBy: null,
    viewer: {
      isOwner: over.isOwner ?? true,
      canPublish,
      canEdit: true,
      canCurate: true,
      actions: {
        like: true,
        comment: true,
        share: true,
        post: over.post ?? canPublish,
        story: over.story ?? canPublish,
      },
    },
  };
}

async function props(searchParams: { comunidade?: string | string[] } = {}) {
  const element = (await CreatePostPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement<Record<string, unknown>>;
  return element.props;
}

beforeEach(() => {
  mocks.permissions = MEMBER_PERMISSIONS;
  mocks.loadCommunity.mockReset();
  mocks.listAllCommunities.mockReset();
  mocks.listAllCommunities.mockResolvedValue([]);
  mocks.redirect.mockClear();
});

describe('/criar?comunidade= — a member in a community (UI-D-711, the Escopo seam)', () => {
  it('P1. the creator gets the in-community composer: member limits, the community, no destinations', async () => {
    mocks.loadCommunity.mockResolvedValue({ status: 'ok', community: community() });

    const p = await props({ comunidade: ID });

    expect(mocks.loadCommunity).toHaveBeenCalledWith(ID);
    expect(p.memberCommunity).toEqual({ id: ID, name: 'Clube de Leitura' });
    expect(p.memberLimits).toBeDefined();
    expect(p.destinations).toEqual([]);
    expect(mocks.listAllCommunities).not.toHaveBeenCalled();
  });

  it('P2. a foreign community (viewer.actions.post false) falls back silently to the plain member composer', async () => {
    mocks.loadCommunity.mockResolvedValue({
      status: 'ok',
      community: community({ isOwner: false, canPublish: false }),
    });

    const p = await props({ comunidade: ID });

    expect(p.memberCommunity).toBeUndefined();
    expect(p.memberLimits).toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('P3. the Escopo seam: actions.post decides, never the owner flag nor canPublish', async () => {
    // post true while canPublish and the owner flag say no: kept.
    mocks.loadCommunity.mockResolvedValue({
      status: 'ok',
      community: community({ isOwner: false, canPublish: false, post: true }),
    });
    expect((await props({ comunidade: ID })).memberCommunity).toEqual({
      id: ID,
      name: 'Clube de Leitura',
    });

    // post false while canPublish and the owner flag say yes: dropped.
    mocks.loadCommunity.mockResolvedValue({
      status: 'ok',
      community: community({ isOwner: true, canPublish: true, post: false }),
    });
    expect((await props({ comunidade: ID })).memberCommunity).toBeUndefined();
  });

  it('P4. an archived community, a miss and a failed read are the plain composer too', async () => {
    mocks.loadCommunity.mockResolvedValue({
      status: 'ok',
      community: community({ status: 'archived' }),
    });
    expect((await props({ comunidade: ID })).memberCommunity).toBeUndefined();

    mocks.loadCommunity.mockResolvedValue({ status: 'not-found' });
    expect((await props({ comunidade: ID })).memberCommunity).toBeUndefined();

    mocks.loadCommunity.mockResolvedValue({ status: 'error' });
    expect((await props({ comunidade: ID })).memberCommunity).toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('P5. no ?comunidade= reads nothing; a repeated one takes the first value', async () => {
    expect((await props()).memberCommunity).toBeUndefined();
    expect(mocks.loadCommunity).not.toHaveBeenCalled();

    mocks.loadCommunity.mockResolvedValue({ status: 'ok', community: community() });
    await props({ comunidade: [ID, 'outra'] });
    expect(mocks.loadCommunity).toHaveBeenCalledWith(ID);
  });
});
