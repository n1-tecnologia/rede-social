import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-16 (D-498, T-09.1-76) — the Membros page reads `?status=subscription_pending` as "Todos" while
 * the `payments` module is off for the tenant, BEFORE any request, and passes `paymentsOn` to the
 * list so the chip renders only while the module is on. The page is an async server component, so it
 * is called directly with its collaborators mocked and the element it returns is inspected.
 */

const mocks = vi.hoisted(() => ({
  modules: [] as { key: string }[],
  loadAdminMembers: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: 'tenant' }) }));
vi.mock('@/lib/admin-members', () => ({
  loadAdminMembers: (...args: unknown[]) => mocks.loadAdminMembers(...args),
}));
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: ['members.manage', 'moderation.manage'],
    tenant: { displayName: 'Rede Demo' },
    modules: mocks.modules,
  }),
}));
vi.mock('./AdminMembersList', () => ({ AdminMembersList: () => null }));
vi.mock('@rede-social/ui', () => ({ PageHeader: () => null }));

const { default: AdminMembersPage } = await import('./page');

/** The props the page hands to `AdminMembersList`. */
async function listProps(sp: Record<string, string>) {
  const tree = (await AdminMembersPage({ searchParams: Promise.resolve(sp) })) as ReactElement<{
    children: ReactElement<Record<string, unknown>>[];
  }>;
  return tree.props.children[1]?.props ?? {};
}

beforeEach(() => {
  mocks.modules = [];
  mocks.loadAdminMembers.mockReset();
  mocks.loadAdminMembers.mockResolvedValue({ items: [], nextCursor: null });
});

describe('Membros page — payments module and ?status= (T-09.1-76)', () => {
  it('with payments on the filter is honoured and the list is told the module is on', async () => {
    mocks.modules = [{ key: 'feed' }, { key: 'payments' }];
    const props = await listProps({ status: 'subscription_pending' });
    expect(props.status).toBe('subscription_pending');
    expect(props.paymentsOn).toBe(true);
    expect(mocks.loadAdminMembers).toHaveBeenCalledWith({
      q: undefined,
      status: 'subscription_pending',
    });
  });

  it('with payments off a hand-typed ?status=subscription_pending reads as Todos, before any request', async () => {
    mocks.modules = [{ key: 'feed' }];
    const props = await listProps({ status: 'subscription_pending' });
    expect(props.status).toBe('all');
    expect(props.paymentsOn).toBe(false);
    expect(mocks.loadAdminMembers).toHaveBeenCalledWith({ q: undefined, status: 'all' });
  });

  it('every other filter reads the same whether payments is on or off', async () => {
    for (const modules of [[], [{ key: 'payments' }]]) {
      mocks.modules = modules;
      expect((await listProps({ status: 'blocked' })).status).toBe('blocked');
      expect((await listProps({ status: 'invited' })).status).toBe('invited');
      expect((await listProps({ status: 'bogus' })).status).toBe('all');
      expect((await listProps({})).status).toBe('all');
    }
  });
});
