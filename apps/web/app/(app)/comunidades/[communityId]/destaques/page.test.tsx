import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-14 Task 2 (UI-D-713, UI-D-716) — `/comunidades/[communityId]/destaques` opens for the API's
 * `viewer.canCurate`: the creator of a member community (while `social` is on) and `stories.story.manage`
 * on an organization community. Every other caller (another member, an admin on a member community, the
 * creator with `social` off) gets the shipped not-found screen, never a disabled page.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  result: null as unknown,
  managerProps: null as Record<string, unknown> | null,
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
    tenant: { displayName: 'Rede Lab' },
  }),
}));
vi.mock('@/lib/communities', () => ({ loadCommunity: async () => mocks.result }));
vi.mock('@/lib/stories', () => ({
  loadCuratorHighlights: async () => ({ status: 'ok', list: { items: [] } }),
}));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: 'tenant' }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/x',
}));
vi.mock('@/components/stories/HighlightManager', () => ({
  HighlightManager: (props: Record<string, unknown>) => {
    mocks.managerProps = props;
    return null;
  },
}));

const { default: HighlightsPage } = await import('./page');

const ID = '5d0c1c2e-7a41-4c52-9d3a-0e6f1b2c3d40';

function community(
  kind: 'organization' | 'member',
  canCurate: boolean,
  status: 'active' | 'archived' = 'active',
) {
  return {
    id: ID,
    name: 'Clube de Leitura',
    slug: 'clube',
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status,
    lastActivityAt: '2026-11-01T00:00:00.000Z',
    kind,
    createdBy: null,
    viewer: {
      isOwner: kind === 'member' && canCurate,
      canPublish: canCurate,
      canEdit: canCurate,
      canCurate,
      actions: { like: true, comment: true, share: true, post: canCurate, story: canCurate },
    },
  };
}

async function render() {
  mocks.managerProps = null;
  const tree = (await HighlightsPage({
    params: Promise.resolve({ communityId: ID }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  mocks.permissions = [];
});

describe('/comunidades/[communityId]/destaques — the guard is viewer.canCurate (UI-D-713)', () => {
  it('D1. the creator of a member community opens it, with the publish door to the same member screen', async () => {
    mocks.result = { status: 'ok', community: community('member', true) };

    const html = await render();

    expect(html).toContain('Clube de Leitura');
    expect(mocks.managerProps?.place).toEqual({ communityId: ID });
    expect(mocks.managerProps?.publishHref).toBe(`/stories/publicar?comunidade=${ID}`);
  });

  it('D2. stories.story.manage on an organization community opens it', async () => {
    mocks.result = { status: 'ok', community: community('organization', true) };

    await render();

    expect(mocks.managerProps?.place).toEqual({ communityId: ID });
  });

  it('D3. an admin on a member community, another member and the creator with social off get not-found', async () => {
    // The admin holds stories.story.manage; the flag is what decides, and the API says false.
    mocks.permissions = ['stories.story.manage'];
    mocks.result = { status: 'ok', community: community('member', false) };
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(mocks.managerProps).toBeNull();
  });

  it('D4. a miss, a blocked creator (the API 404) and a failed read are the same not-found screen', async () => {
    mocks.result = { status: 'not-found' };
    await expect(render()).rejects.toThrow('NOT_FOUND');
    mocks.result = { status: 'error' };
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });

  it('D5. an archived community keeps the read-only note for the creator', async () => {
    mocks.result = { status: 'ok', community: community('member', true, 'archived') };

    const html = await render();

    expect(mocks.managerProps?.archived).toBe(true);
    expect(html).toContain('arquivada');
  });
});
