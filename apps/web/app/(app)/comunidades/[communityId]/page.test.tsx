import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-14 (UI-D-709, UI-D-710, the Escopo seam) — the community page draws its publish controls from the
 * API's `viewer` flags and nothing else.
 *
 * The page is an async server component: it is called directly with its collaborators mocked, the
 * element it returns is rendered to static markup with the REAL pt-BR catalog, and the props it hands
 * to the client islands (`CommunityPosts`, `StoriesSurface`, the lifecycle controls) are captured. The
 * page holds no role name and no id comparison, so every fixture here is built the way the API computes
 * the flags (`viewerOf`): `post` and `story` equal `canPublish`, `like`, `comment` and `share` are true.
 * The Escopo cases break that equality on purpose, to show the page reads the action flags.
 */

type Props = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  role: 'member',
  modules: [{ key: 'communities' }, { key: 'stories' }] as { key: string }[],
  result: null as unknown,
  highlights: { items: [] } as unknown,
  loadHighlights: vi.fn(),
  postsProps: null as Props | null,
  surfaceProps: null as Props | null,
  lifecycle: [] as { name: string; props: Props }[],
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
vi.mock('@/lib/stories', () => ({
  loadHighlights: (...args: unknown[]) => {
    mocks.loadHighlights(...args);
    return Promise.resolve(mocks.highlights);
  },
}));
vi.mock('@/lib/store', () => ({ getCommunityAccess: async () => null }));
vi.mock('@/lib/admin-icon-cookie', () => ({ readAdminIconChoice: async () => null }));
vi.mock('@/lib/registry', () => ({
  postCardLabels: () => ({ media: { carousel: 'carrossel', attachmentError: 'erro' } }),
  postMenuLabels: () => ({}),
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
vi.mock('@/components/stories/StoriesSurface', () => ({
  StoriesSurface: (props: Props) => {
    mocks.surfaceProps = props;
    return null;
  },
}));
vi.mock('./CommunityPosts', () => ({
  CommunityPosts: (props: Props) => {
    mocks.postsProps = props;
    return null;
  },
}));
vi.mock('./DeleteCommunityControl', () => ({
  DeleteCommunityControl: (props: Props) => {
    mocks.lifecycle.push({ name: 'delete', props });
    return <span data-delete-control="community" />;
  },
}));
vi.mock('./ReactivateCommunity', () => ({
  ReactivateCommunity: (props: Props) => {
    mocks.lifecycle.push({ name: 'reactivate', props });
    return <span data-community-page-reactivate />;
  },
}));
vi.mock('./LockedCommunity', () => ({ LockedCommunity: () => null }));

const { default: CommunityPage } = await import('./page');

const ID = '5d0c1c2e-7a41-4c52-9d3a-0e6f1b2c3d40';
const CREATOR = {
  membershipId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  displayName: 'Ana Souza',
  avatarAssetId: null,
};

type Viewer = {
  isOwner: boolean;
  canPublish: boolean;
  canEdit: boolean;
  canCurate: boolean;
  post?: boolean;
  story?: boolean;
};

/** One community as the API computes it for a viewer kind. */
function community(
  kind: 'organization' | 'member',
  viewer: Viewer,
  over: { status?: 'active' | 'archived'; postCount?: number } = {},
) {
  return {
    id: ID,
    name: 'Clube de Leitura',
    slug: 'clube',
    description: 'Livros e conversa',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: over.postCount ?? 0,
    status: over.status ?? 'active',
    lastActivityAt: '2026-11-01T00:00:00.000Z',
    kind,
    createdBy: kind === 'member' ? CREATOR : null,
    viewer: {
      isOwner: viewer.isOwner,
      canPublish: viewer.canPublish,
      canEdit: viewer.canEdit,
      canCurate: viewer.canCurate,
      actions: {
        like: true,
        comment: true,
        share: true,
        post: viewer.post ?? viewer.canPublish,
        story: viewer.story ?? viewer.canPublish,
      },
    },
  };
}

/** The viewer kinds of UI-D-710, flags exactly as `viewerOf` produces them. */
const CREATOR_VIEW: Viewer = { isOwner: true, canPublish: true, canEdit: true, canCurate: true };
const OTHER_MEMBER_VIEW: Viewer = {
  isOwner: false,
  canPublish: false,
  canEdit: false,
  canCurate: false,
};

async function render(searchParams: { exclusivo?: string } = {}) {
  mocks.postsProps = null;
  mocks.surfaceProps = null;
  mocks.lifecycle = [];
  const tree = (await CommunityPage({
    params: Promise.resolve({ communityId: ID }),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return renderToStaticMarkup(tree);
}

const circles = () => (mocks.surfaceProps?.circles ?? []) as { key: string; href?: string }[];
const ownCircle = () => circles().find((circle) => circle.key === 'own');
const manageCircle = () =>
  (circles() as { key: string; href?: string; disc?: { kind: string } }[]).find(
    (circle) => circle.disc?.kind === 'manage',
  );
const labels = () => (mocks.postsProps?.labels ?? {}) as Record<string, string>;

const MEMBER_PERMISSIONS = ['social.participate', 'feed.post.create'];

beforeEach(() => {
  mocks.permissions = MEMBER_PERMISSIONS;
  mocks.role = 'member';
  mocks.modules = [{ key: 'communities' }, { key: 'stories' }];
  mocks.highlights = { items: [] };
  mocks.loadHighlights.mockReset();
  mocks.notFound.mockClear();
});

describe('/comunidades/[communityId] — the creator of a member community (UI-D-709, UI-D-710)', () => {
  beforeEach(() => {
    mocks.result = { status: 'ok', community: community('member', CREATOR_VIEW) };
  });

  it('1. the creator sees the FAB and desktop button (canPost + createHref), the "+" circle, the pencil and the manage circle', async () => {
    const html = await render();

    expect(mocks.postsProps?.canPost).toBe(true);
    expect(mocks.postsProps?.createHref).toBe(`/criar?comunidade=${ID}`);
    expect(labels().createCta).toBe('Publicar nesta comunidade');
    expect(ownCircle()?.href).toBe(`/stories/publicar?comunidade=${ID}`);
    expect(manageCircle()?.href).toBe(`/comunidades/${ID}/destaques`);
    expect(html).toContain('data-community-edit');
    expect(html).toContain(`href="/comunidades/${ID}/editar"`);
  });

  it('2. the header reads "Criada por você" as plain text, with no profile link', async () => {
    const html = await render();

    expect(html).toContain('data-community-byline');
    expect(html).toContain('Criada por você');
    expect(html).not.toContain('/membros/');
  });

  it('3. the owner empty list says "Compartilhe a primeira novidade da sua comunidade." with the shipped CTA', async () => {
    await render();

    expect(labels().emptyTitle).toBe('Nada publicado ainda');
    expect(labels().emptyBodyAuthor).toBe('Compartilhe a primeira novidade da sua comunidade.');
    expect(labels().emptyBody).toBe('As publicações desta comunidade vão aparecer aqui.');
    expect(labels().emptyCta).toBe('Publicar nesta comunidade');
  });
});

describe('/comunidades/[communityId] — the byline for every other viewer (UI-D-709)', () => {
  it('4. a member viewer with social on gets a live profile link to /membros/{membershipId}', async () => {
    mocks.result = { status: 'ok', community: community('member', OTHER_MEMBER_VIEW) };

    const html = await render();

    expect(html).toContain('Criada por ');
    expect(html).toContain(`href="/membros/${CREATOR.membershipId}"`);
    expect(html).toContain('aria-label="Ver perfil de Ana Souza"');
    expect(html).toContain('Ana Souza');
    // The user id never reaches the page: only the membership id, the name and the avatar asset.
    expect(html).not.toContain('userId');
  });

  it('5. with social off a member viewer sees the name as plain text (UI-D-510)', async () => {
    mocks.permissions = [];
    mocks.result = { status: 'ok', community: community('member', OTHER_MEMBER_VIEW) };

    const html = await render();

    expect(html).toContain('Criada por ');
    expect(html).toContain('Ana Souza');
    expect(html).not.toContain('/membros/');
  });

  it('6. a staff viewer gets the live link even without social.participate', async () => {
    mocks.permissions = ['communities.community.manage'];
    mocks.role = 'admin_tenant';
    mocks.result = {
      status: 'ok',
      community: community('member', {
        isOwner: false,
        canPublish: false,
        canEdit: true,
        canCurate: false,
      }),
    };

    const html = await render();

    expect(html).toContain(`href="/membros/${CREATOR.membershipId}"`);
  });

  it('7. an organization community has no byline at all', async () => {
    mocks.permissions = ['communities.community.manage', 'feed.post.create', 'content.publish'];
    mocks.role = 'admin_tenant';
    mocks.result = {
      status: 'ok',
      community: community('organization', {
        isOwner: false,
        canPublish: true,
        canEdit: true,
        canCurate: true,
      }),
    };

    const html = await render();

    expect(html).not.toContain('data-community-byline');
    expect(html).not.toContain('Criada por');
  });
});

describe('/comunidades/[communityId] — the Escopo seam (viewer.actions)', () => {
  it('8. actions.post true with canPublish false shows the FAB, the desktop button, the empty CTA and keeps ?comunidade=', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { ...OTHER_MEMBER_VIEW, post: true }),
    };

    await render();

    expect(mocks.postsProps?.canPost).toBe(true);
    expect(mocks.postsProps?.createHref).toBe(`/criar?comunidade=${ID}`);
    // ...and the story door stays shut: only actions.story opens it.
    expect(ownCircle()).toBeUndefined();
  });

  it('9. actions.story true with canPublish false shows the "+" circle only', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { ...OTHER_MEMBER_VIEW, story: true }),
    };

    await render();

    expect(ownCircle()?.href).toBe(`/stories/publicar?comunidade=${ID}`);
    expect(mocks.postsProps?.canPost).toBe(false);
  });

  it('10. the reverse hides each: actions.post false and actions.story false with canPublish true', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', { ...CREATOR_VIEW, post: false, story: false }),
    };

    await render();

    expect(mocks.postsProps?.canPost).toBe(false);
    expect(ownCircle()).toBeUndefined();
  });

  it('11. an archived community offers no publish control even when the flags say yes', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', CREATOR_VIEW, { status: 'archived' }),
    };

    await render();

    expect(mocks.postsProps?.canPost).toBe(false);
    expect(ownCircle()).toBeUndefined();
    expect(manageCircle()).toBeUndefined();
  });
});
