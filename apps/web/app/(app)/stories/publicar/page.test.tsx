import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-12 (UI-D-702..UI-D-704, D-716) — `/stories/publicar` decides, on the server, which screen a viewer
 * gets and which destinations it may name.
 *
 * The page is an async server component: it is called directly with its collaborators mocked and the
 * props it hands to `StoryComposer` are captured. What the page owns, and what is asserted here:
 *
 *  - **the Escopo seam.** The ONE host decision of the form "the caller may publish a story into this
 *    community" is the API's `viewer.actions.story` of the communities list read, on the ACTIVE
 *    communities: never the owner boolean and never a role or id comparison. The fixtures make the two
 *    DISAGREE (a community with `actions.story` true and `isOwner` false, and the reverse), so a page
 *    that read the owner flag fails here;
 *  - the member mode and the tenant's `social.media` limits, read off the bootstrap the page already
 *    holds; the administrator keeps the unchanged screen (no `member` prop, Início among the places);
 *  - `social` off or no publish permission goes back to `/inicio`;
 *  - `?comunidade=` is resolved against the destinations the caller may name: a foreign, unknown or
 *    archived id falls back silently to "Nenhum".
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  modules: [] as { key: string; settings: Record<string, unknown> }[],
  communities: [] as unknown[],
  catalog: [] as unknown[],
  listAllCommunities: vi.fn(),
  getHighlightCatalog: vi.fn(),
  composerProps: null as Record<string, unknown> | null,
  hostMode: 'tenant',
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    modules: mocks.modules,
    tenant: { displayName: 'Rede Demo' },
  }),
}));
vi.mock('@/lib/communities', () => ({
  listAllCommunities: (...args: unknown[]) => mocks.listAllCommunities(...args),
}));
vi.mock('@/lib/stories', () => ({
  getHighlightCatalog: (...args: unknown[]) => mocks.getHighlightCatalog(...args),
}));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: mocks.hostMode }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@/app/(app)/stories/publicar/StoryComposer', () => ({
  StoryComposer: (props: Record<string, unknown>) => {
    mocks.composerProps = props;
    return null;
  },
}));

const { default: PublishStoryPage } = await import('./page');

const PUBLISH = 'stories.story.publish';
const MANAGE = 'stories.story.manage';

const X = '0c000000-0000-4000-8000-0000000000a1';
const Y = '0c000000-0000-4000-8000-0000000000a2';
const Z = '0c000000-0000-4000-8000-0000000000a3';
const H_X = '0000000a-1111-4111-8111-0000000000a1';

/** A community as the list read projects it; `story` and `isOwner` are set INDEPENDENTLY. */
function community(
  id: string,
  name: string,
  flags: { story: boolean; isOwner: boolean; status?: 'active' | 'archived' },
) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: flags.status ?? 'active',
    lastActivityAt: '2026-11-11T12:00:00.000Z',
    kind: 'member',
    createdBy: null,
    viewer: {
      isOwner: flags.isOwner,
      canPublish: flags.story,
      canEdit: flags.isOwner,
      canCurate: flags.isOwner,
      actions: { like: true, comment: true, share: true, post: flags.story, story: flags.story },
    },
  };
}

function summary(id: string, communityId: string | null, title: string) {
  return {
    id,
    communityId,
    title,
    position: 0,
    coverAssetId: null,
    coverVariantWidths: [],
    coverStoryId: null,
    coverChosen: false,
    itemCount: 1,
  };
}

async function render(searchParams: { comunidade?: string | string[] } = {}) {
  mocks.composerProps = null;
  await PublishStoryPage({ searchParams: Promise.resolve(searchParams) });
  return mocks.composerProps as Record<string, unknown> | null;
}

const labelsOf = (props: Record<string, unknown> | null) =>
  ((props?.places as { label: string }[] | undefined) ?? []).map((place) => place.label);

beforeEach(() => {
  mocks.permissions = [PUBLISH, 'social.participate'];
  mocks.modules = [
    { key: 'social', settings: {} },
    { key: 'stories', settings: {} },
    { key: 'communities', settings: {} },
  ];
  mocks.hostMode = 'tenant';
  mocks.communities = [];
  mocks.catalog = [];
  mocks.listAllCommunities.mockReset();
  mocks.listAllCommunities.mockImplementation(async () => mocks.communities);
  mocks.getHighlightCatalog.mockReset();
  mocks.getHighlightCatalog.mockImplementation(async () => ({ items: mocks.catalog }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/stories/publicar — the member screen (10-12, UI-D-702..UI-D-704)', () => {
  it('P1. a member gets the member mode with the tenant’s limits from the bootstrap (video on or off), and the history link', async () => {
    mocks.modules[0] = {
      key: 'social',
      settings: {
        media: {
          photoMaxBytes: 3 * 1024 * 1024,
          photosPerPost: 4,
          video: { enabled: true, maxDurationSeconds: 45, maxBytes: 80 * 1024 * 1024 },
        },
      },
    };
    const props = await render();
    expect(props?.historyHref).toBe('/stories/meus');
    expect(props?.member).toEqual({
      limits: {
        photoMaxBytes: 3 * 1024 * 1024,
        photosPerPost: 4,
        video: { enabled: true, maxDurationSeconds: 45, maxBytes: 80 * 1024 * 1024 },
      },
    });
  });

  it('P2. the Escopo seam: the destination groups are the communities whose actions.story is true — NEVER the owner flag', async () => {
    mocks.communities = [
      // `actions.story` true with the owner flag FALSE: the row and the group exist.
      community(X, 'Alfa', { story: true, isOwner: false }),
      // `actions.story` false with the owner flag TRUE: both are hidden.
      community(Y, 'Beta', { story: false, isOwner: true }),
    ];
    mocks.catalog = [summary(H_X, X, 'Destaque do Alfa')];
    const props = await render();
    expect(labelsOf(props)).toEqual(['Alfa']);
    expect(((props?.places ?? []) as { rows: unknown[] }[])[0]?.rows).toEqual([
      { id: H_X, title: 'Destaque do Alfa', cover: null },
    ]);
  });

  it('P3. a community that is archived never becomes a destination, even with actions.story true', async () => {
    mocks.communities = [
      community(X, 'Alfa', { story: true, isOwner: true }),
      community(Z, 'Gama', { story: true, isOwner: true, status: 'archived' }),
    ];
    expect(labelsOf(await render())).toEqual(['Alfa']);
  });

  it('P4. with no destination the page passes no places at all (no row, no gap), and never reads an "Início" group', async () => {
    mocks.communities = [community(Y, 'Beta', { story: false, isOwner: true })];
    const props = await render();
    expect(props?.places).toEqual([]);
  });

  it('P5. ?comunidade= resolves against the destinations the caller may name; a foreign, unknown or owner-only id falls back to "Nenhum"', async () => {
    mocks.communities = [
      community(X, 'Alfa', { story: true, isOwner: false }),
      community(Y, 'Beta', { story: false, isOwner: true }),
    ];
    mocks.catalog = [summary(H_X, X, 'Destaque do Alfa')];
    const ok = await render({ comunidade: X });
    expect(ok?.originCommunityId).toBe(X);
    // An origin with highlights arrives pre-filled with its first highlight (D-112).
    expect(ok?.initialSelection).toEqual({ kind: 'highlight', highlightId: H_X });

    for (const requested of [Y, Z, 'nao-e-um-id']) {
      const fallback = await render({ comunidade: requested });
      expect(fallback?.originCommunityId).toBeNull();
      expect(fallback?.initialSelection).toEqual({ kind: 'none' });
    }
  });

  it('P6. social off (the module is not on the bootstrap) and no publish permission both go back to /inicio', async () => {
    mocks.modules = [{ key: 'stories', settings: {} }];
    await expect(render()).rejects.toThrow('redirect:/inicio');
    mocks.modules = [{ key: 'social', settings: {} }];
    mocks.permissions = ['social.participate'];
    await expect(render()).rejects.toThrow('redirect:/inicio');
  });

  it('P7. with the communities module off the list is never read and the member screen has no destination', async () => {
    mocks.modules = [
      { key: 'social', settings: {} },
      { key: 'stories', settings: {} },
    ];
    const props = await render();
    expect(mocks.listAllCommunities).not.toHaveBeenCalled();
    expect(props?.places).toEqual([]);
    expect(props?.member).toBeDefined();
  });

  it('P8. the administrator keeps the unchanged screen: no member mode, Início among the places', async () => {
    mocks.permissions = [PUBLISH, MANAGE, 'content.publish'];
    mocks.communities = [];
    mocks.catalog = [summary(H_X, null, 'Bastidores')];
    const props = await render();
    expect(props?.member).toBeUndefined();
    expect(labelsOf(props)).toEqual(['Início']);
  });
});
