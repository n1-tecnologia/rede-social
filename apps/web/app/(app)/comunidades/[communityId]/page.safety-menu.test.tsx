import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-24 (D-733, AD-1, AD-8, UI-D-869) — which viewers the community page offers "Mais opções da comunidade" to.
 *
 * The page is an async server component called directly, with the client islands replaced by spies: the menu
 * receives exactly what the API's `viewer.canReport` and `canBlock` riders and the creator say, and it is NOT
 * mounted for the creator, on the locked page, on an archived community or on the not-found screen. The shipped
 * `page.test.tsx` keeps `postMenuSafety` undefined and so never sees the control.
 */

type Props = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  role: 'member',
  modules: [{ key: 'communities' }, { key: 'stories' }] as { key: string }[],
  result: null as unknown,
  access: null as unknown,
  menu: [] as Props[],
  safety: undefined as unknown,
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
    getLocale: async () => 'pt-BR',
  };
});
vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: () => mocks.notFound(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/comunidades/x',
}));
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    tenant: { displayName: 'Rede Lab', timezone: 'America/Sao_Paulo' },
    membership: { role: mocks.role },
    modules: mocks.modules,
  }),
}));
vi.mock('@/lib/communities', async (orig) => ({
  ...(await orig<typeof import('@/lib/communities')>()),
  loadCommunity: async () => mocks.result,
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
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({ mode: 'tenant' }),
  primaryHostOrigin: async () => 'https://lab.test',
}));
vi.mock('@/lib/feed', () => ({ loadFeed: async () => ({ items: [], nextCursor: null }) }));
vi.mock('@/lib/author-instagram', () => ({
  loadAuthorInstagrams: async () => new Map(),
  withAuthorInstagrams: async (page: unknown) => ({ page, instagrams: new Map() }),
}));
vi.mock('@/lib/stories', () => ({ loadHighlights: async () => ({ items: [] }) }));
vi.mock('@/lib/store', () => ({ getCommunityAccess: async () => mocks.access }));
vi.mock('@/lib/store-view', () => ({
  lockedPageView: () => ({ archivedTag: false, choices: [] }),
}));
vi.mock('@/lib/admin-icon-cookie', () => ({ readAdminIconChoice: async () => null }));
vi.mock('@/lib/registry', () => ({
  postCardLabels: () => ({ media: { carousel: 'carrossel', attachmentError: 'erro' } }),
  postMenuLabels: () => ({ deleteBodyMember: 'base-member', removeBody: 'base-remove' }),
  postMenuSafety: () => mocks.safety,
  feedCommentsProps: () => ({}),
  storyCommentsProps: () => ({}),
  reelsOverlayProps: async () => null,
}));
vi.mock('@/app/(app)/comunidades/actions', () => ({
  loadMoreCommunityPostsAction: { bind: () => vi.fn() },
  refreshCommunityPostsAction: { bind: () => vi.fn() },
}));
vi.mock('@/app/(app)/inicio/feed-actions', () => ({
  deletePostAction: vi.fn(),
  likePostAction: vi.fn(),
  unlikePostAction: vi.fn(),
}));
vi.mock('@/app/(app)/stories/story-actions', () => ({
  likeStoryAction: vi.fn(),
  unlikeStoryAction: vi.fn(),
}));
vi.mock('@/components/stories/StoriesSurface', () => ({ StoriesSurface: () => null }));
vi.mock('./CommunityPosts', () => ({ CommunityPosts: () => null }));
vi.mock('./DeleteCommunityControl', () => ({ DeleteCommunityControl: () => null }));
vi.mock('./ReactivateCommunity', () => ({ ReactivateCommunity: () => null }));
vi.mock('./LockedCommunity', () => ({
  LockedCommunity: ({ header }: { header: ReactNode }) => <div data-locked>{header}</div>,
}));
vi.mock('./CommunityMenu', () => ({
  CommunityMenu: (props: Props) => {
    mocks.menu.push(props);
    return <span data-community-menu-spy />;
  },
}));

const { default: CommunityPage } = await import('./page');

const ID = '5d0c1c2e-7a41-4c52-9d3a-0e6f1b2c3d40';
const CREATOR = {
  membershipId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  displayName: 'Ana Souza',
  avatarAssetId: null,
};
const SAFETY = { socialOn: true, reportAction: vi.fn(), blockAction: vi.fn() };

type Viewer = {
  isOwner?: boolean;
  canEdit?: boolean;
  canReport?: boolean;
  canBlock?: boolean;
};

function community(
  kind: 'organization' | 'member',
  viewer: Viewer,
  over: { status?: 'active' | 'archived'; description?: string } = {},
) {
  return {
    id: ID,
    name: 'Clube de Leitura',
    slug: 'clube',
    description: over.description ?? 'Livros e conversa',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: over.status ?? 'active',
    lastActivityAt: '2026-11-01T00:00:00.000Z',
    kind,
    createdBy: kind === 'member' ? CREATOR : null,
    viewer: {
      isOwner: viewer.isOwner ?? false,
      canPublish: false,
      canEdit: viewer.canEdit ?? false,
      canCurate: false,
      actions: { like: true, comment: true, share: true, post: false, story: false },
      ...(viewer.canReport === undefined ? {} : { canReport: viewer.canReport }),
      ...(viewer.canBlock === undefined ? {} : { canBlock: viewer.canBlock }),
    },
  };
}

async function render() {
  mocks.menu = [];
  const tree = (await CommunityPage({
    params: Promise.resolve({ communityId: ID }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  mocks.permissions = ['social.participate'];
  mocks.role = 'member';
  mocks.modules = [{ key: 'communities' }, { key: 'stories' }];
  mocks.access = null;
  mocks.safety = SAFETY;
  mocks.notFound.mockClear();
});

describe('/comunidades/[communityId] — the header menu (11-24, UI-D-869)', () => {
  it('1. another member viewing a member community gets the menu with the creator as the block target', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { canReport: true, canBlock: true }),
    };
    const html = await render();
    expect(html).toContain('data-community-menu-spy');
    expect(mocks.menu).toHaveLength(1);
    expect(mocks.menu[0]).toMatchObject({
      communityId: ID,
      canReport: true,
      block: { membershipId: CREATOR.membershipId, name: 'Ana Souza' },
      tenantName: 'Rede Lab',
      safety: SAFETY,
    });
  });

  it('2. staff (canReport, no canBlock) get Denunciar and no block target; an organization community has none either', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { canReport: true, canBlock: false }),
    };
    await render();
    expect(mocks.menu[0]).toMatchObject({ canReport: true, block: null });
    mocks.result = {
      status: 'ok',
      community: community('organization', { canReport: true, canBlock: false }),
    };
    await render();
    expect(mocks.menu[0]).toMatchObject({ canReport: true, block: null });
  });

  it('3. the creator (both riders false) and an API that predates the riders get no control', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', {
        isOwner: true,
        canEdit: true,
        canReport: false,
        canBlock: false,
      }),
    };
    let html = await render();
    expect(mocks.menu).toHaveLength(0);
    expect(html).not.toContain('data-community-menu-spy');
    // The creator keeps their edit pencil.
    expect(html).toContain('data-community-edit');

    mocks.result = { status: 'ok', community: community('member', {}) };
    html = await render();
    expect(mocks.menu).toHaveLength(0);
  });

  it('4. the creator-editor and a reporter share the cluster: the pencil first, the menu after it', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { canEdit: true, canReport: true, canBlock: true }),
    };
    const html = await render();
    expect(html.indexOf('data-community-edit')).toBeGreaterThan(-1);
    expect(html.indexOf('data-community-edit')).toBeLessThan(
      html.indexOf('data-community-menu-spy'),
    );
    expect(html).toContain('data-community-actions');
  });

  it('5. an archived community shows no content to report: no control, whatever the riders say', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { canReport: true, canBlock: true }, { status: 'archived' }),
    };
    const html = await render();
    expect(mocks.menu).toHaveLength(0);
    expect(html).not.toContain('data-community-menu-spy');
  });

  it('6. the locked page draws its own plain header and no menu', async () => {
    mocks.modules = [{ key: 'communities' }, { key: 'stories' }, { key: 'store' }];
    mocks.access = { locked: true, communityId: ID, archivedTag: false, buyableProducts: [] };
    mocks.result = {
      status: 'ok',
      community: community('member', { canReport: true, canBlock: true }),
    };
    const html = await render();
    expect(html).toContain('data-locked');
    expect(mocks.menu).toHaveLength(0);
  });

  it('7. the not-found screen never reaches a header', async () => {
    mocks.result = { status: 'not-found' };
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(mocks.menu).toHaveLength(0);
  });

  it('8. a community with no description still offers the menu (MODER-05, edge empty)', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { canReport: true, canBlock: true }, { description: '' }),
    };
    await render();
    expect(mocks.menu).toHaveLength(1);
  });

  it('9. without the opt-in (postMenuSafety undefined) there is no menu: no dead entry', async () => {
    mocks.safety = undefined;
    mocks.result = {
      status: 'ok',
      community: community('member', { canReport: true, canBlock: true }),
    };
    await render();
    expect(mocks.menu).toHaveLength(0);
  });
});
