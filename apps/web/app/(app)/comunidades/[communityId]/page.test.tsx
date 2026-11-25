import { FeedList, type FeedListProps, type PostCardView } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
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
  postMenuLabels: () => ({ deleteBodyMember: 'base-member', removeBody: 'base-remove' }),
  postMenuSafety: () => undefined,
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

/**
 * 10-14 Task 2 (UI-D-710 matrix, UI-D-716, UI-D-717): one rendering test per viewer kind. Every fixture
 * carries `viewer.actions` exactly as the API computes it (`post` and `story` equal `canPublish`, the
 * other three true), so the matrix shows the action flags reproduce the owner rule for every kind.
 */
const HIGHLIGHT = {
  id: 'b7a1c0de-0000-4000-8000-000000000001',
  communityId: ID,
  title: 'Mudas',
  position: 0,
  coverAssetId: null,
  coverVariantWidths: [],
  coverStoryId: null,
  coverChosen: false,
  itemCount: 2,
};

const ADMIN_PERMISSIONS = [
  'communities.community.manage',
  'feed.post.create',
  'content.publish',
  'stories.story.manage',
  'stories.story.publish',
];

describe('/comunidades/[communityId] — the control matrix per viewer kind (UI-D-710)', () => {
  it('12. another member: no publish control, no pencil, no manage circle; the posts and highlights stay', async () => {
    mocks.highlights = { items: [HIGHLIGHT] };
    mocks.result = { status: 'ok', community: community('member', OTHER_MEMBER_VIEW) };

    const html = await render();

    expect(mocks.postsProps?.canPost).toBe(false);
    expect(ownCircle()).toBeUndefined();
    expect(manageCircle()).toBeUndefined();
    expect(html).not.toContain('data-community-edit');
    // The highlight circle is still drawn: reading is intact.
    expect(circles().length).toBe(1);
    expect(labels().emptyBodyAuthor).toBe('As publicações desta comunidade vão aparecer aqui.');
    expect(mocks.postsProps?.onLike).toBeDefined();
  });

  it('13. an admin on a member community: the pencil only, no publish control, no "+", no manage circle', async () => {
    mocks.permissions = ADMIN_PERMISSIONS;
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

    expect(html).toContain('data-community-edit');
    expect(mocks.postsProps?.canPost).toBe(false);
    expect(ownCircle()).toBeUndefined();
    expect(manageCircle()).toBeUndefined();
  });

  it('14. an admin on an organization community: every control, as today', async () => {
    mocks.permissions = ADMIN_PERMISSIONS;
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

    expect(html).toContain('data-community-edit');
    expect(mocks.postsProps?.canPost).toBe(true);
    expect(mocks.postsProps?.createHref).toBe(`/criar?comunidade=${ID}`);
    expect(ownCircle()?.href).toBe(`/stories/publicar?comunidade=${ID}`);
    expect(manageCircle()?.href).toBe(`/comunidades/${ID}/destaques`);
    // The organization admin keeps today's empty-list sentence, not the owner's.
    expect(labels().emptyBodyAuthor).toBe('As publicações desta comunidade vão aparecer aqui.');
    expect(mocks.loadHighlights).toHaveBeenCalledWith({ communityId: ID, scope: 'all' });
  });

  it('15. support_tenant: nothing to write on either kind of community', async () => {
    mocks.permissions = [];
    mocks.role = 'support_tenant';
    for (const kind of ['organization', 'member'] as const) {
      mocks.result = { status: 'ok', community: community(kind, OTHER_MEMBER_VIEW) };
      const html = await render();
      expect(html).not.toContain('data-community-edit');
      expect(mocks.postsProps?.canPost).toBe(false);
      expect(ownCircle()).toBeUndefined();
      expect(manageCircle()).toBeUndefined();
    }
  });
});

describe('/comunidades/[communityId] — social off (UI-D-716) and a blocked creator (UI-D-717)', () => {
  it('16. the creator with social off keeps every read and loses every write control, with no notice', async () => {
    // The API drops the member keys while `social` is off: canEdit, canCurate and both actions go false,
    // while isOwner (a fact about the row) and like, comment and share stay.
    mocks.permissions = [];
    mocks.highlights = { items: [HIGHLIGHT] };
    mocks.result = {
      status: 'ok',
      community: community('member', {
        isOwner: true,
        canPublish: false,
        canEdit: false,
        canCurate: false,
      }),
    };

    const html = await render();

    expect(html).not.toContain('data-community-edit');
    expect(mocks.postsProps?.canPost).toBe(false);
    expect(ownCircle()).toBeUndefined();
    expect(manageCircle()).toBeUndefined();
    expect(circles().length).toBe(1);
    // "Criada por" stays as plain text, and nothing explains the missing controls.
    expect(html).toContain('Criada por você');
    expect(html).not.toContain('/membros/');
    expect(html).not.toContain('desativada');
  });

  it('17. an ARCHIVED community the creator may edit offers Reativar and Excluir, never for a viewer who may not edit', async () => {
    mocks.result = {
      status: 'ok',
      community: community('member', CREATOR_VIEW, { status: 'archived' }),
    };
    await render();
    expect(mocks.lifecycle.map((entry) => entry.name).sort()).toEqual(['delete', 'reactivate']);
    // UI-D-712: the relation reaches the delete control, read from the flags (the creator is the owner).
    expect(mocks.lifecycle.find((entry) => entry.name === 'delete')?.props.relation).toBe('owner');

    mocks.result = {
      status: 'ok',
      community: community('member', OTHER_MEMBER_VIEW, { status: 'archived' }),
    };
    await render();
    expect(mocks.lifecycle).toEqual([]);
  });

  it('18. a blocked or departed creator answers the shipped not-found screen, with no special copy', async () => {
    mocks.result = { status: 'not-found' };

    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });
});

describe('/comunidades/[communityId] — the lifecycle relation and the post menu wording (10-14)', () => {
  const menuLabels = () =>
    ((mocks.postsProps?.menu as { labels: Record<string, string> } | undefined)?.labels ??
      {}) as Record<string, string>;

  it('19. the moderator’s Excluir comunidade carries the moderator relation; the organization admin the organization one', async () => {
    mocks.result = {
      status: 'ok',
      community: community(
        'member',
        { isOwner: false, canPublish: false, canEdit: true, canCurate: false },
        { status: 'archived' },
      ),
    };
    await render();
    expect(mocks.lifecycle.find((entry) => entry.name === 'delete')?.props.relation).toBe(
      'moderator',
    );

    mocks.result = {
      status: 'ok',
      community: community(
        'organization',
        { isOwner: false, canPublish: true, canEdit: true, canCurate: true },
        { status: 'archived' },
      ),
    };
    await render();
    expect(mocks.lifecycle.find((entry) => entry.name === 'delete')?.props.relation).toBe(
      'organization',
    );
  });

  it('20. a post inside a MEMBER community leaves the community, not Explorar: delete and removal bodies', async () => {
    mocks.result = { status: 'ok', community: community('member', CREATOR_VIEW) };

    await render();

    expect(menuLabels().deleteBodyMember).toBe(
      'Ela sai da comunidade para todos os membros. Os comentários também deixam de aparecer.',
    );
    expect(menuLabels().removeBody).toBe(
      'Ela sai da comunidade e do link compartilhado para todos. A pessoa não é avisada.',
    );
  });

  it('21. an organization community keeps the shipped wording', async () => {
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

    await render();

    expect(menuLabels().deleteBodyMember).toBe('base-member');
    expect(menuLabels().removeBody).toBe('base-remove');
  });
});

/**
 * Phase 10 review WR-06: the story viewer's "Destacar" and curator menu follow the community's own
 * `viewer.canCurate`, the API's per-community answer, and not the organization-wide
 * `stories.story.manage`. An admin on a MEMBER community holds that permission but cannot curate the
 * place (the API answers a bare 404), and the creator curates their own community without holding it.
 */
describe('/comunidades/[communityId] — the story viewer curates by viewer.canCurate (WR-06)', () => {
  const viewerProps = () => mocks.surfaceProps?.viewer as { canCurate?: boolean } | undefined;

  it('22. an admin on a MEMBER community holds stories.story.manage but gets no curator menu', async () => {
    mocks.permissions = ADMIN_PERMISSIONS;
    mocks.role = 'admin_tenant';
    mocks.highlights = { items: [HIGHLIGHT] };
    mocks.result = {
      status: 'ok',
      community: community('member', {
        isOwner: false,
        canPublish: false,
        canEdit: true,
        canCurate: false,
      }),
    };

    await render();

    expect(viewerProps()?.canCurate).toBe(false);
  });

  it('23. the creator of a member community, who does not hold stories.story.manage, gets the curator menu', async () => {
    mocks.permissions = ['social.participate', 'stories.story.publish'];
    mocks.highlights = { items: [HIGHLIGHT] };
    mocks.result = { status: 'ok', community: community('member', CREATOR_VIEW) };

    await render();

    expect(viewerProps()?.canCurate).toBe(true);
  });

  it('24. an admin on an organization community keeps the curator menu', async () => {
    mocks.permissions = ADMIN_PERMISSIONS;
    mocks.role = 'admin_tenant';
    mocks.highlights = { items: [HIGHLIGHT] };
    mocks.result = {
      status: 'ok',
      community: community('organization', {
        isOwner: false,
        canPublish: true,
        canEdit: true,
        canCurate: true,
      }),
    };

    await render();

    expect(viewerProps()?.canCurate).toBe(true);
  });
});

/**
 * 11.1-16 (UI-D-891 c, A-UI-13, UI-D-888): the buyer's story door on an ORGANIZATION community. The
 * leading "+" is gated by `viewer.actions.story` alone, which the API makes true for a buyer only while
 * the community has an open highlight; with it false the circle is absent and, when the row has no
 * highlight circle either, the whole band row and its title are absent (the shipped null case, no
 * reserved height).
 */
describe('/comunidades/[communityId] — the buyer’s story door (11.1-16)', () => {
  const BUYER_VIEW: Viewer = {
    isOwner: false,
    canPublish: false,
    canEdit: false,
    canCurate: false,
  };
  const SECTION = 'aria-label="Destaques"';

  it('B1. story true: the "+" circle opens the composer pre-filled for this community', async () => {
    mocks.permissions = ['social.participate', 'stories.story.publish'];
    mocks.result = {
      status: 'ok',
      community: community('organization', { ...BUYER_VIEW, story: true }),
    };

    const html = await render();

    expect(ownCircle()?.href).toBe(`/stories/publicar?comunidade=${ID}`);
    expect(html).toContain(SECTION);
  });

  it('B2. story false and no highlight: no "+", and the band row and its title are absent (no reserved height)', async () => {
    mocks.permissions = ['social.participate', 'stories.story.publish'];
    mocks.highlights = { items: [] };
    mocks.result = {
      status: 'ok',
      community: community('organization', { ...BUYER_VIEW, story: false }),
    };

    const html = await render();

    expect(ownCircle()).toBeUndefined();
    expect(mocks.surfaceProps).toBeNull();
    expect(html).not.toContain(SECTION);
  });

  it('B3. story false with a highlight to watch: the circle of the highlight stays, the "+" and every curator door do not', async () => {
    mocks.permissions = ['social.participate', 'stories.story.publish'];
    mocks.highlights = { items: [HIGHLIGHT] };
    mocks.result = {
      status: 'ok',
      community: community('organization', { ...BUYER_VIEW, story: false }),
    };

    const html = await render();

    expect(ownCircle()).toBeUndefined();
    expect(manageCircle()).toBeUndefined();
    expect(html).toContain(SECTION);
    expect((mocks.surfaceProps?.viewer as { canCurate?: boolean } | undefined)?.canCurate).toBe(
      false,
    );
  });

  it('B4. the page reads the fact, not the permission: story true with no story permission on the session still shows the "+"', async () => {
    mocks.permissions = ['social.participate'];
    mocks.result = {
      status: 'ok',
      community: community('organization', { ...BUYER_VIEW, story: true }),
    };

    await render();

    expect(ownCircle()).toBeDefined();
  });
});

/**
 * 11.1-17 (UI-D-892, D-880, UI-D-710 Escopo seam): the buyer's compose entries on the community page.
 *
 * The page hands `canPost` (the API's `viewer.actions.post` and an active community) and `createHref`
 * to the feed list, and the REAL list draws the three entries from them: the floating button (phone),
 * the desktop "Criar publicação" and the empty state's own CTA. The cases render the real `FeedList`
 * with exactly the props the page captured, so the DOM is what a buyer would get. A buyer is a member
 * of an ORGANIZATION community: not the owner, `canPublish` false, `post` true or false.
 */
describe('/comunidades/[communityId] - the buyer’s compose entries (11.1-17)', () => {
  const BUYER_VIEW: Viewer = {
    isOwner: false,
    canPublish: false,
    canEdit: false,
    canCurate: false,
  };
  const HREF = `href="/criar?comunidade=${ID}"`;
  const POST: PostCardView = {
    id: '00000000-0000-4000-8000-000000000001',
    caption: 'Uma novidade',
    author: { displayName: 'Ana Souza', profileHref: '/membros/m1', avatarUrl: null },
    createdAtIso: '2026-10-08T10:00:00.000Z',
    createdAtRelative: 'há 1 h',
    createdAtAbsolute: '08/10/2026',
    community: null,
    shareUrl: null,
    edited: false,
    canManage: false,
    editHref: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    ariaLabel: 'post-1',
    media: { mediaKind: 'none', images: [], attachments: [] },
  } as PostCardView;

  /** The real list over the props the page handed to its post column. */
  function entries(items: PostCardView[]) {
    const {
      share: _share,
      menu: _menu,
      reels: _reels,
      communityId: _id,
      ...list
    } = (mocks.postsProps ?? {}) as Props;
    return renderToStaticMarkup(
      <ToastProvider>
        <FeedList {...(list as unknown as FeedListProps)} initialItems={items} />
      </ToastProvider>,
    );
  }
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  async function renderBuyer(post: boolean, over: { status?: 'active' | 'archived' } = {}) {
    mocks.permissions = ['social.participate', 'feed.post.create'];
    mocks.result = {
      status: 'ok',
      community: community('organization', { ...BUYER_VIEW, post }, over),
    };
    await render();
  }

  it('E1. (the path) post true: the desktop button, the empty-state CTA and (with posts) the floating button all open /criar?comunidade={id}', async () => {
    await renderBuyer(true);

    expect(mocks.postsProps?.canPost).toBe(true);
    expect(mocks.postsProps?.createHref).toBe(`/criar?comunidade=${ID}`);

    // Empty list: the desktop header button and the empty card's own CTA; the floating button stands
    // down so the screen keeps one brand fill (UI-D-17).
    const empty = entries([]);
    expect(count(empty, HREF)).toBe(2);
    expect(empty).not.toContain('data-compose-fab');
    expect(empty).toContain('Publicar nesta comunidade');

    // A list with a post: the desktop header button and the floating button.
    const filled = entries([POST]);
    expect(count(filled, HREF)).toBe(2);
    expect(filled).toContain('data-compose-fab');
  });

  it('E2. post false: none of the three entries is in the DOM (absent, not disabled) and no /criar link exists', async () => {
    await renderBuyer(false);

    expect(mocks.postsProps?.canPost).toBe(false);
    for (const html of [entries([]), entries([POST])]) {
      expect(html).not.toContain('/criar');
      expect(html).not.toContain('data-compose-fab');
      expect(html).not.toContain('Publicar nesta comunidade');
      expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
      expect(html).not.toContain('aria-disabled');
    }
  });

  it('E3. post false: the empty state keeps its title and body with no button; the body is the shipped one for a non-owner', async () => {
    await renderBuyer(false);

    const html = entries([]);
    expect(html).toContain('Nada publicado ainda');
    expect(html).toContain('As publicações desta comunidade vão aparecer aqui.');
    expect(html).not.toContain('Compartilhe a primeira novidade');
    expect(html).not.toContain('<button');
    expect(labels().emptyBodyAuthor).toBe('As publicações desta comunidade vão aparecer aqui.');
  });

  it('E4. post true but the community is archived: no entry at all, as for the administrator', async () => {
    await renderBuyer(true, { status: 'archived' });

    expect(mocks.postsProps?.canPost).toBe(false);
    expect(entries([])).not.toContain('/criar');
    expect(entries([POST])).not.toContain('data-compose-fab');
  });

  it('E5. the page holds no role or product comparison: the same fixture with the administrator role and no fact still shows no entry', async () => {
    mocks.permissions = ADMIN_PERMISSIONS;
    mocks.role = 'admin_tenant';
    mocks.result = {
      status: 'ok',
      community: community('organization', { ...BUYER_VIEW, post: false }),
    };
    await render();

    expect(mocks.postsProps?.canPost).toBe(false);
    expect(entries([])).not.toContain('/criar');
  });
});
