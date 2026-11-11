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

const NOTICE_3 = 'Você chegou ao limite de 3 comunidades ativas. Arquive uma para criar outra.';
const ARCHIVED_OWN = {
  items: [{ id: '33333333-3333-4333-8333-333333333333' }],
  nextCursor: null,
  memberQuota: null,
};

describe('/comunidades — the limit states (UI-D-706 a to d)', () => {
  it('4. at the limit the control is ABSENT and the notice replaces it, with no action', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.activePage = { items: [], nextCursor: null, memberQuota: { ownedActive: 3, limit: 3 } };

    const html = await render();

    expect(html).not.toContain('data-communities-create');
    expect(html).not.toContain('href="/comunidades/nova"');
    expect(html).toContain(NOTICE_3);
    expect(html).toContain('data-community-limit-notice');
    expect(html).toContain('rounded-xl bg-bg-secondary p-4');
    expect(mocks.listProps?.canCreate).toBe(false);
  });

  it('5. the notice names the limit with an ICU plural', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.activePage = { items: [], nextCursor: null, memberQuota: { ownedActive: 1, limit: 1 } };

    const html = await render();

    expect(html).toContain(
      'Você chegou ao limite de 1 comunidade ativa. Arquive uma para criar outra.',
    );
  });

  it('6. limit 0 shows neither the control nor the notice', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.activePage = { items: [], nextCursor: null, memberQuota: { ownedActive: 0, limit: 0 } };

    const html = await render();

    expect(html).not.toContain('data-communities-create');
    expect(html).not.toContain('data-community-limit-notice');
    expect(html).not.toContain('Você chegou ao limite');
  });

  it('7. under the limit the control shows and the notice does not', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.activePage = { items: [], nextCursor: null, memberQuota: { ownedActive: 2, limit: 3 } };

    const html = await render();

    expect(html).toContain('data-communities-create');
    expect(html).not.toContain('data-community-limit-notice');
  });

  it('8. an admin never sees the notice, whatever the quota says', async () => {
    mocks.permissions = [MANAGE];
    mocks.activePage = { items: [], nextCursor: null, memberQuota: { ownedActive: 9, limit: 3 } };

    const html = await render();

    expect(html).toContain('data-communities-create');
    expect(html).not.toContain('data-community-limit-notice');
  });
});

describe('/comunidades — the member chips and the archived read (UI-D-706, UI-D-716)', () => {
  it('9. the chips show for a member ONLY while they own an archived community', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.archivedPage = ARCHIVED_OWN;

    const html = await render();

    expect(html).toContain('Ativas');
    expect(html).toContain('Arquivadas');
    expect(mocks.listProps?.status).toBe('active');
    // The probe is the API's own read, scoped to the caller.
    expect(mocks.loadCommunities).toHaveBeenCalledWith({ status: 'archived', limit: 1 });
  });

  it('10. a member with none owned gets no chips, and ?status=arquivadas lands on Ativas', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];

    const html = await render({ status: 'arquivadas' });

    expect(html).not.toContain('Arquivadas');
    expect(mocks.listProps?.status).toBe('active');
  });

  it('11. a member who owns one reads Arquivadas by the exact single value only', async () => {
    mocks.permissions = [CREATE, MANAGE_OWN];
    mocks.archivedPage = ARCHIVED_OWN;

    await render({ status: 'arquivadas' });
    expect(mocks.listProps?.status).toBe('archived');

    await render({ status: ['arquivadas', 'arquivadas'] });
    expect(mocks.listProps?.status).toBe('active');

    await render({ status: 'qualquer' });
    expect(mocks.listProps?.status).toBe('active');
  });

  it('12. with social off (no member permission) there are no chips and no archived read', async () => {
    mocks.permissions = [];

    const html = await render({ status: 'arquivadas' });

    expect(html).not.toContain('Arquivadas');
    expect(mocks.listProps?.status).toBe('active');
    expect(mocks.loadCommunities).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived' }),
    );
  });

  it('13. an admin keeps the chips and the archived list, whatever the member probe says', async () => {
    mocks.permissions = [MANAGE];

    const html = await render({ status: 'arquivadas' });

    expect(html).toContain('Arquivadas');
    expect(mocks.listProps?.status).toBe('archived');
  });
});
