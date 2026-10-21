// @vitest-environment happy-dom

import type { AdminMember, AdminMemberStatusFilter } from '@rede-social/contracts/moderation';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-16 (UI-D-523, D-498, D-500) — the Membros list's fifth chip, its own empty state and the
 * payments-off behaviour, on the shipped `AdminMembersList` with the REAL pt-BR catalog through
 * next-intl's own translator. `InfiniteScroll` and `PullToRefresh` are swapped for a button and a
 * passthrough (happy-dom has no scrolling IntersectionObserver and no touch pull), the
 * `NotificationsSurface` precedent; the member sheet is a stub (its own note has its own suite).
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));

const actions = vi.hoisted(() => ({ loadMore: vi.fn() }));
vi.mock('./actions', () => ({
  blockMemberAction: vi.fn(),
  changeMemberRoleAction: vi.fn(),
  unblockMemberAction: vi.fn(),
  loadMoreAdminMembersAction: (...args: unknown[]) => actions.loadMore(...args),
}));

vi.mock('@/components/admin/MemberAdminSheet', () => ({
  MemberAdminSheet: () => null,
}));

vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    PullToRefresh: ({ children }: { children: ReactNode }) => createElement('div', null, children),
    InfiniteScroll: ({ hasMore, onLoadMore }: { hasMore: boolean; onLoadMore: () => void }) =>
      hasMore
        ? createElement(
            'button',
            { type: 'button', 'data-load-more': true, onClick: onLoadMore },
            'mais',
          )
        : null,
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      let tr = byNamespace.get(namespace);
      if (!tr) {
        tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace });
        byNamespace.set(namespace, tr);
      }
      return tr;
    },
  };
});

const { AdminMembersList } = await import('./AdminMembersList');

function member(n: number, over: Partial<AdminMember> = {}): AdminMember {
  return {
    membershipId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    displayName: `Membro ${n}`,
    email: `membro${n}@exemplo.com.br`,
    avatarAssetId: null,
    role: 'member',
    status: 'active',
    isViewer: false,
    ...over,
  };
}

type ListProps = Parameters<typeof AdminMembersList>[0];

function props(over: Partial<ListProps> = {}): ListProps {
  return {
    initialItems: [member(1)],
    initialCursor: null,
    q: '',
    status: 'all',
    tenantName: 'Rede Demo',
    canModerate: true,
    canManageMembers: true,
    paymentsOn: true,
    ...over,
  };
}

function mount(over: Partial<ListProps> = {}) {
  const ui = (p: ListProps): ReactNode => (
    <ToastProvider>
      <AdminMembersList {...p} />
    </ToastProvider>
  );
  const view = render(ui(props(over)));
  return {
    ...view,
    update: (next: Partial<ListProps>) => view.rerender(ui(props({ ...over, ...next }))),
  };
}

const chipRow = () => document.querySelector('[data-admin-members-filters]') as HTMLElement;
const chipLabels = () =>
  Array.from(chipRow().querySelectorAll('button')).map((chip) => chip.textContent);

beforeEach(() => {
  nav.replace.mockReset();
  nav.refresh.mockReset();
  actions.loadMore.mockReset();
});

afterEach(cleanup);

describe('AdminMembersList — the fifth chip (UI-D-523)', () => {
  it('with payments on shows five chips and "Assinatura pendente" LAST', () => {
    mount({ paymentsOn: true });
    expect(chipLabels()).toEqual([
      'Todos',
      'Ativos',
      'Bloqueados',
      'Convidados',
      'Assinatura pendente',
    ]);
  });

  it('with payments off the chip is absent from the DOM and the four shipped chips are unchanged', () => {
    mount({ paymentsOn: false });
    expect(chipLabels()).toEqual(['Todos', 'Ativos', 'Bloqueados', 'Convidados']);
    expect(screen.queryByText('Assinatura pendente')).toBeNull();
  });

  it('keeps the row scrolling sideways and never wrapping, every chip shrink-0 (E10 overflow)', () => {
    mount({ paymentsOn: true });
    expect(chipRow().className).toContain('overflow-x-auto');
    expect(chipRow().className).not.toContain('flex-wrap');
    for (const chip of Array.from(chipRow().querySelectorAll('button'))) {
      expect(chip.className).toContain('shrink-0');
    }
  });

  it('marks the active chip and writes ?status=subscription_pending through router.replace', () => {
    mount({ paymentsOn: true, status: 'blocked' });
    const chip = within(chipRow()).getByRole('button', { name: 'Assinatura pendente' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(nav.replace).toHaveBeenCalledWith('/configuracoes/membros?status=subscription_pending', {
      scroll: false,
    });
  });

  it('keeps the search term when the chip is chosen', () => {
    mount({ paymentsOn: true, q: 'bia' });
    fireEvent.click(within(chipRow()).getByRole('button', { name: 'Assinatura pendente' }));
    expect(nav.replace).toHaveBeenCalledWith(
      '/configuracoes/membros?q=bia&status=subscription_pending',
      { scroll: false },
    );
  });

  it('shows the filter as active when the URL carries it', () => {
    mount({ paymentsOn: true, status: 'subscription_pending', initialItems: [member(2)] });
    const chip = within(chipRow()).getByRole('button', { name: 'Assinatura pendente' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('AdminMembersList — the filter states (E10 zero, one, many)', () => {
  it('empty with no search: the Users empty state with the contract words and no action', () => {
    mount({ status: 'subscription_pending', initialItems: [] });
    const empty = document.querySelector('[data-admin-members-empty]');
    expect(empty?.getAttribute('data-admin-members-empty')).toBe('subscriptionPendingEmpty');
    expect(screen.getByText('Nenhuma assinatura pendente')).toBeTruthy();
    expect(
      screen.getByText(
        'Quem estiver com a assinatura atrasada ou cancelada aparece aqui. O acesso volta sozinho quando o pagamento é confirmado.',
      ),
    ).toBeTruthy();
    expect(empty?.querySelector('button')).toBeNull();
  });

  it('empty WITH a search keeps the search copy, whatever the filter', () => {
    mount({ status: 'subscription_pending', q: 'zzz', initialItems: [] });
    expect(screen.getByText('Nenhum membro encontrado')).toBeTruthy();
    expect(screen.queryByText('Nenhuma assinatura pendente')).toBeNull();
  });

  it('the shipped empty states are unchanged for the other filters', () => {
    mount({ status: 'blocked', initialItems: [] });
    expect(screen.getByText('Nenhum acesso bloqueado')).toBeTruthy();
    cleanup();
    mount({ status: 'invited', initialItems: [] });
    expect(screen.getByText('Nenhum convite pendente')).toBeTruthy();
  });

  it.each([1, 3])('renders %i flagged row(s) with the warning pill', (count) => {
    mount({
      status: 'subscription_pending',
      initialItems: Array.from({ length: count }, (_, i) =>
        member(i + 1, { subscriptionPending: true }),
      ),
    });
    expect(document.querySelectorAll('[data-member-row]')).toHaveLength(count);
    expect(screen.getAllByText('Assinatura pendente', { selector: 'span' })).toHaveLength(
      count + 0,
    );
  });

  it('reseeds page 1 when the filter changes: the previous rows never paint under the new filter', () => {
    const view = mount({ initialItems: [member(1), member(2)] });
    expect(screen.getByText('Membro 1')).toBeTruthy();
    view.update({
      status: 'subscription_pending' as AdminMemberStatusFilter,
      initialItems: [member(3, { subscriptionPending: true })],
    });
    expect(screen.queryByText('Membro 1')).toBeNull();
    expect(screen.getByText('Membro 3')).toBeTruthy();
  });

  it('pages the filter through the load-more action with the same status and the module flag', async () => {
    actions.loadMore.mockResolvedValue({
      ok: true,
      items: [member(9, { subscriptionPending: true })],
      nextCursor: null,
    });
    mount({
      status: 'subscription_pending',
      initialItems: [member(2, { subscriptionPending: true })],
      initialCursor: 'cursor-1',
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    await waitFor(() => expect(screen.getByText('Membro 9')).toBeTruthy());
    expect(actions.loadMore).toHaveBeenCalledWith('cursor-1', null, 'subscription_pending', true);
  });
});
