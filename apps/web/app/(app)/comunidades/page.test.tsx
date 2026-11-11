import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-13 (UI-D-706, UI-D-708) — the `/comunidades` page decides what the title row offers a viewer.
 *
 * The page is an async server component: it is called directly with its collaborators mocked, the
 * element it returns is rendered to static markup with the REAL pt-BR catalog, and the props it hands
 * to `CommunitiesList` are captured. What the page owns, and what is asserted here:
 *
 *  - the "Criar comunidade" control is decided by the COMPOSED permission the bootstrap carries
 *    (`communities.community.manage` for the organization, `communities.community.create` for a
 *    member) and by the quota numbers the list read carries, never by a role comparison;
 *  - the member's limit notice replaces the control at the limit, and limit 0 shows neither;
 *  - the member's "Ativas · Arquivadas" chips exist only while the member owns an archived community
 *    (the API scopes that read to the caller's own rows), and any other `status` lands on Ativas.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  role: 'member',
  modules: [{ key: 'communities' }] as { key: string }[],
  activePage: {
    items: [],
    nextCursor: null,
    memberQuota: null,
  } as unknown,
  archivedPage: { items: [], nextCursor: null, memberQuota: null } as unknown,
  loadCommunities: vi.fn(),
  listProps: null as Record<string, unknown> | null,
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
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    tenant: { displayName: 'Rede Demo' },
    membership: { role: mocks.role },
    modules: mocks.modules,
  }),
}));
vi.mock('@/lib/communities', async (orig) => ({
  ...(await orig<typeof import('@/lib/communities')>()),
  loadCommunities: (...args: unknown[]) => mocks.loadCommunities(...args),
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
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/store', () => ({ getCommunityAccessList: async () => null }));
vi.mock('./CommunitiesList', () => ({
  CommunitiesList: (props: Record<string, unknown>) => {
    mocks.listProps = props;
    return null;
  },
}));

const { default: CommunitiesPage } = await import('./page');

const MANAGE = 'communities.community.manage';
const CREATE = 'communities.community.create';
const MANAGE_OWN = 'communities.community.manage_own';

/** Renders the page for a viewer and returns its markup. */
async function render(searchParams: { status?: string | string[] } = {}) {
  mocks.listProps = null;
  const tree = (await CommunitiesPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  mocks.permissions = [];
  mocks.role = 'member';
  mocks.modules = [{ key: 'communities' }];
  mocks.activePage = { items: [], nextCursor: null, memberQuota: null };
  mocks.archivedPage = { items: [], nextCursor: null, memberQuota: null };
  mocks.loadCommunities.mockReset();
  mocks.loadCommunities.mockImplementation(async (query?: { status?: string }) =>
    query?.status === 'archived' ? mocks.archivedPage : mocks.activePage,
  );
});

describe('/comunidades — the create control (UI-D-706, UI-D-48)', () => {
  it('1. a member under the limit gets the brand control, no chips and no reorder', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.activePage = { items: [], nextCursor: null, memberQuota: { ownedActive: 1, limit: 3 } };

    const html = await render();

    expect(html).toContain('href="/comunidades/nova"');
    expect(html).toContain('data-communities-create');
    expect(html).toContain('Criar comunidade');
    expect(html).not.toContain('Arquivadas');
    expect(mocks.listProps?.canManage).toBe(false);
    expect(mocks.listProps?.canCreate).toBe(true);
  });

  it('2. an admin keeps the control and the chips, decided by the manage permission', async () => {
    mocks.permissions = [MANAGE];
    mocks.role = 'admin_tenant';

    const html = await render();

    expect(html).toContain('data-communities-create');
    expect(html).toContain('Ativas');
    expect(html).toContain('Arquivadas');
    expect(mocks.listProps?.canManage).toBe(true);
    expect(mocks.listProps?.canCreate).toBe(true);
  });

  it('3. a viewer holding neither permission sees no control and no chips', async () => {
    mocks.permissions = [];

    const html = await render();

    expect(html).not.toContain('data-communities-create');
    expect(html).not.toContain('Arquivadas');
    expect(mocks.listProps?.canManage).toBe(false);
    expect(mocks.listProps?.canCreate).toBe(false);
  });
});
