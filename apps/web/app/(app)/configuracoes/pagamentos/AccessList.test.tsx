// @vitest-environment happy-dom
import type { AccessItem } from '@rede-social/contracts/payments';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-14 — the Acessos list (UI-D-517, D-487, D-489, D-504): the Membros machine on the access row,
 * against the REAL pt-BR catalog. `InfiniteScroll` and `PullToRefresh` are swapped for a button and a
 * passthrough (happy-dom has no scrolling IntersectionObserver and no touch pull, the Membros list's
 * own precedent); the server actions and the toast are stubs. The row, the sheet and the dialogs are
 * the real components, so a block is followed end to end up to the row changing in place.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), pending: false }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));

/** A navigation in flight cannot be observed with a synchronous mock router, so the flag is forced. */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useTransition: () => {
      const [pending, start] = actual.useTransition();
      return [nav.pending || pending, start] as const;
    },
  };
});

const actions = vi.hoisted(() => ({
  loadMore: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
}));
vi.mock('./actions', () => ({
  loadMoreAccessesAction: (...args: unknown[]) => actions.loadMore(...args),
  blockAccessAction: (...args: unknown[]) => actions.block(...args),
  unblockAccessAction: (...args: unknown[]) => actions.unblock(...args),
}));

const toast = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    useToast: () => toast,
    PullToRefresh: ({ children }: { children: ReactNode }) => createElement('div', null, children),
    InfiniteScroll: ({
      hasMore,
      enabled = true,
      onLoadMore,
    }: {
      hasMore: boolean;
      enabled?: boolean;
      onLoadMore: () => void;
    }) =>
      hasMore && enabled
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
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { AccessList } = await import('./AccessList');

const NOW = '2026-10-21T12:00:00.000Z';

function item(n: number, over: Partial<AccessItem> = {}): AccessItem {
  const email = `pessoa${n}@exemplo.com.br`;
  return {
    id: email,
    email,
    source: 'kiwify',
    state: 'active',
    validUntil: '2026-11-12T15:00:00.000Z',
    hasAccount: true,
    updatedAt: '2026-10-21T11:57:00.000Z',
    ...over,
  };
}

type ListProps = Parameters<typeof AccessList>[0];

function props(over: Partial<ListProps> = {}): ListProps {
  return {
    initialItems: [item(1)],
    initialCursor: null,
    serverNow: NOW,
    q: '',
    status: 'all',
    gatewayName: 'Kiwify',
    tenantName: 'Rede Demo',
    timeZone: 'America/Sao_Paulo',
    gateRequired: true,
    ...over,
  };
}

function mount(over: Partial<ListProps> = {}) {
  const view = render(<AccessList {...props(over)} />);
  return {
    ...view,
    update: (next: Partial<ListProps>) =>
      view.rerender(<AccessList {...props({ ...over, ...next })} />),
  };
}

const filters = () => document.querySelector('[data-access-filters]') as HTMLElement;
const chipLabels = () => Array.from(filters().querySelectorAll('button')).map((c) => c.textContent);
const rows = () => Array.from(document.querySelectorAll('[data-access-row]'));
const rowOf = (email: string) =>
  document.querySelector(`[data-access-row="${email}"]`) as HTMLElement;

beforeEach(() => {
  nav.replace.mockReset();
  nav.refresh.mockReset();
  nav.pending = false;
  actions.loadMore.mockReset();
  actions.block.mockReset();
  actions.unblock.mockReset();
  toast.show.mockReset();
});

afterEach(cleanup);

describe('AccessList: the rows (E05 populated, partial, zero-one-many)', () => {
  it('renders one row per e-mail inside the named list, in the server order', () => {
    mount({ initialItems: [item(2), item(1), item(3)] });
    expect(screen.getByRole('list', { name: 'Acessos' })).toBeTruthy();
    expect(rows().map((row) => row.getAttribute('data-access-row'))).toEqual([
      'pessoa2@exemplo.com.br',
      'pessoa1@exemplo.com.br',
      'pessoa3@exemplo.com.br',
    ]);
  });

  it('words each row from the server fields: state, source, account and validity', () => {
    mount({
      initialItems: [
        item(1),
        item(2, { source: 'manual', validUntil: null, hasAccount: false }),
        item(3, { state: 'blocked', source: 'manual', validUntil: null }),
        item(4, { state: 'subscription_pending' }),
      ],
    });
    expect(rowOf('pessoa1@exemplo.com.br').textContent).toBe(
      'pessoa1@exemplo.com.brAtivoKiwifyVálido até 12 de nov. de 2026',
    );
    expect(rowOf('pessoa2@exemplo.com.br').textContent).toBe(
      'pessoa2@exemplo.com.brAtivoManualAinda sem contaSem data de validade',
    );
    expect(rowOf('pessoa3@exemplo.com.br').textContent).toContain('Bloqueado');
    expect(rowOf('pessoa4@exemplo.com.br').textContent).toContain('Assinatura pendente');
  });

  it('renders a single row at the top, and a row with a missing hasAccount omits that pill', () => {
    mount({ initialItems: [{ ...item(1), hasAccount: undefined } as unknown as AccessItem] });
    expect(rows()).toHaveLength(1);
    expect(rowOf('pessoa1@exemplo.com.br').textContent).not.toContain('Ainda sem conta');
  });
});

describe('AccessList: the toolbar and the URL (the URL is the query)', () => {
  it('draws the search field and the four chips in order, scrolling sideways, never wrapping (E05 overflow)', () => {
    mount();
    expect(screen.getByRole('searchbox', { name: 'Buscar por e-mail' })).toBeTruthy();
    expect(chipLabels()).toEqual(['Todos', 'Ativos', 'Assinatura pendente', 'Bloqueados']);
    expect(filters().className).toContain('overflow-x-auto');
    expect(filters().className).not.toContain('flex-wrap');
    for (const chip of Array.from(filters().querySelectorAll('button'))) {
      expect(chip.className).toContain('shrink-0');
    }
  });

  it('marks the chip of the URL status as pressed', () => {
    mount({ status: 'subscription_pending' });
    const chip = within(filters()).getByRole('button', { name: 'Assinatura pendente' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(
      within(filters()).getByRole('button', { name: 'Todos' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('writes ?status= through router.replace and keeps the search term', () => {
    mount({ q: 'ana' });
    fireEvent.click(within(filters()).getByRole('button', { name: 'Bloqueados' }));
    expect(nav.replace).toHaveBeenCalledWith(
      '/configuracoes/pagamentos?aba=acessos&q=ana&status=blocked',
      { scroll: false },
    );
  });

  it('"Todos" is the bare tab URL', () => {
    mount({ status: 'blocked' });
    fireEvent.click(within(filters()).getByRole('button', { name: 'Todos' }));
    expect(nav.replace).toHaveBeenCalledWith('/configuracoes/pagamentos?aba=acessos', {
      scroll: false,
    });
  });

  it('debounces the typed search into ?q= (300 ms) and does not write while typing', async () => {
    mount();
    const field = screen.getByRole('searchbox', { name: 'Buscar por e-mail' });
    fireEvent.change(field, { target: { value: 'an' } });
    fireEvent.change(field, { target: { value: 'ana' } });
    expect(nav.replace).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(nav.replace).toHaveBeenCalledWith('/configuracoes/pagamentos?aba=acessos&q=ana', {
          scroll: false,
        }),
      { timeout: 1500 },
    );
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});

describe('AccessList: loading, reseeding and paging (E05 loading, zero-one-many)', () => {
  it('shows 8 row skeletons, aria-busy, while the navigation is pending and no old row', () => {
    nav.pending = true;
    mount({ initialItems: [item(1)] });
    const skeleton = document.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(skeleton.querySelectorAll('[data-access-skeleton-row]')).toHaveLength(8);
    expect(rows()).toHaveLength(0);
  });

  it('reseeds from the new page when the URL query changes: the old rows never paint under it', () => {
    const view = mount({ initialItems: [item(1), item(2)] });
    expect(rowOf('pessoa1@exemplo.com.br')).toBeTruthy();
    view.update({
      status: 'blocked',
      initialItems: [item(3, { state: 'blocked', source: 'manual' })],
    });
    expect(document.querySelector('[data-access-row="pessoa1@exemplo.com.br"]')).toBeNull();
    expect(rowOf('pessoa3@exemplo.com.br')).toBeTruthy();
  });

  it('appends the next keyset page with no duplicate row and forwards the opaque cursor', async () => {
    actions.loadMore.mockResolvedValue({
      ok: true,
      items: [item(2), item(3)],
      nextCursor: null,
      serverNow: NOW,
    });
    mount({
      initialItems: [item(1), item(2)],
      initialCursor: 'cursor-1',
      q: 'pessoa',
      status: 'active',
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((row) => row.getAttribute('data-access-row'))).toEqual([
      'pessoa1@exemplo.com.br',
      'pessoa2@exemplo.com.br',
      'pessoa3@exemplo.com.br',
    ]);
    expect(actions.loadMore).toHaveBeenCalledWith('cursor-1', 'pessoa', 'active');
    expect(document.querySelector('[data-load-more]')).toBeNull();
  });

  it('asks for the unfiltered page with null when the status is "Todos"', async () => {
    actions.loadMore.mockResolvedValue({ ok: true, items: [], nextCursor: null, serverNow: NOW });
    mount({ initialCursor: 'cursor-1' });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    expect(actions.loadMore).toHaveBeenCalledWith('cursor-1', null, null);
  });

  it('drops a page that started before the query changed (the generation guard)', async () => {
    let finish: (page: unknown) => void = () => {};
    actions.loadMore.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const view = mount({ initialItems: [item(1)], initialCursor: 'cursor-1' });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    view.update({ q: 'zzz', initialItems: [item(7)], initialCursor: null });
    await act(async () => {
      finish({ ok: true, items: [item(9)], nextCursor: null, serverNow: NOW });
    });
    expect(document.querySelector('[data-access-row="pessoa9@exemplo.com.br"]')).toBeNull();
    expect(rowOf('pessoa7@exemplo.com.br')).toBeTruthy();
  });
});

describe('AccessList: the empty states (E05 empty)', () => {
  it('nothing at all: "Nenhum acesso por aqui" with its body', () => {
    mount({ initialItems: [] });
    expect(screen.getByText('Nenhum acesso por aqui')).toBeTruthy();
    expect(
      screen.getByText(
        'Quando alguém comprar o produto de acesso, o e-mail aparece aqui. Você também pode liberar um e-mail antes de a pessoa criar a conta.',
      ),
    ).toBeTruthy();
  });

  it('a search: "Nenhum e-mail encontrado" / "Tente outro e-mail.", whatever the filter', () => {
    mount({ initialItems: [], q: 'zzz', status: 'blocked' });
    expect(screen.getByText('Nenhum e-mail encontrado')).toBeTruthy();
    expect(screen.getByText('Tente outro e-mail.')).toBeTruthy();
    expect(screen.queryByText('Nenhum e-mail bloqueado')).toBeNull();
  });

  it.each([
    ['active', 'Nenhum acesso ativo', 'Quando houver acessos ativos, eles aparecem aqui.'],
    [
      'subscription_pending',
      'Nenhuma assinatura pendente',
      'Quem estiver com a assinatura atrasada ou cancelada aparece aqui. O acesso volta sozinho quando o pagamento é confirmado.',
    ],
    ['blocked', 'Nenhum e-mail bloqueado', 'E-mails que você bloquear aparecem aqui.'],
  ] as const)('the %s filter has its own words', (status, title, body) => {
    mount({ initialItems: [], status });
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
  });
});

describe('AccessList: failures (E05 error)', () => {
  it('a first-load failure is the card "Algo deu errado" with "Tentar novamente", which asks page 1 again', async () => {
    actions.loadMore.mockResolvedValue({
      ok: true,
      items: [item(1)],
      nextCursor: null,
      serverNow: NOW,
    });
    mount({ initialItems: [], initialError: true, q: 'ana', status: 'active' });
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.getByText('Não foi possível carregar os acessos. Tente novamente.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });
    await waitFor(() => expect(rowOf('pessoa1@exemplo.com.br')).toBeTruthy());
    expect(actions.loadMore).toHaveBeenCalledWith(null, 'ana', 'active');
  });

  it('a load-more failure keeps every loaded row, shows the inline line and retries on demand', async () => {
    actions.loadMore.mockResolvedValueOnce({ ok: false, code: 'generic' });
    mount({ initialItems: [item(1), item(2)], initialCursor: 'cursor-1' });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar mais acessos.')).toBeTruthy(),
    );
    expect(rows()).toHaveLength(2);
    expect(document.querySelector('[data-load-more]')).toBeNull();

    actions.loadMore.mockResolvedValueOnce({
      ok: true,
      items: [item(3)],
      nextCursor: null,
      serverNow: NOW,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('a lost permission toasts the shipped line and refreshes', async () => {
    actions.loadMore.mockResolvedValue({ ok: false, code: 'forbidden' });
    mount({ initialCursor: 'cursor-1' });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement);
    });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você não tem mais permissão para esta ação.',
    });
  });
});

describe('AccessList: the sheet and the block flow settle the row IN PLACE from the server', () => {
  const dialogs = () => screen.getAllByRole('dialog');
  const top = () => dialogs().at(-1) as HTMLElement;

  it('blocks: the row turns "Bloqueado" with the server answer, the sheet closes and the toast names the e-mail', async () => {
    actions.block.mockResolvedValue({
      ok: true,
      access: item(2, { state: 'blocked', source: 'manual', validUntil: null }),
      serverNow: NOW,
    });
    mount({ initialItems: [item(1), item(2)] });
    fireEvent.click(rowOf('pessoa2@exemplo.com.br'));
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', { name: 'pessoa2@exemplo.com.br' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear acesso' }));
    await act(async () => {
      fireEvent.click(within(top()).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() => expect(rowOf('pessoa2@exemplo.com.br').textContent).toContain('Bloqueado'));
    expect(rowOf('pessoa2@exemplo.com.br').textContent).toContain('Manual');
    expect(rowOf('pessoa1@exemplo.com.br').textContent).toContain('Ativo');
    expect(actions.block).toHaveBeenCalledWith('pessoa2@exemplo.com.br');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Acesso de pessoa2@exemplo.com.br bloqueado.',
    });
  });

  it('never flips the row before the server answers (no optimistic state)', async () => {
    let finish: (value: unknown) => void = () => {};
    actions.block.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount({ initialItems: [item(1)] });
    fireEvent.click(rowOf('pessoa1@exemplo.com.br'));
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear acesso' }));
    await act(async () => {
      fireEvent.click(within(top()).getByRole('button', { name: 'Bloquear' }));
    });
    expect(rowOf('pessoa1@exemplo.com.br').textContent).not.toContain('Bloqueado');
    await act(async () => {
      finish({
        ok: true,
        access: item(1, { state: 'blocked', source: 'manual', validUntil: null }),
        serverNow: NOW,
      });
    });
    await waitFor(() => expect(rowOf('pessoa1@exemplo.com.br').textContent).toContain('Bloqueado'));
  });

  it('unblocks: the previous pill returns from the server answer and the toast says so', async () => {
    actions.unblock.mockResolvedValue({ ok: true, access: item(1), serverNow: NOW });
    mount({
      initialItems: [item(1, { state: 'blocked', source: 'manual', validUntil: null })],
    });
    fireEvent.click(rowOf('pessoa1@exemplo.com.br'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear acesso' }));
    });
    await waitFor(() => expect(rowOf('pessoa1@exemplo.com.br').textContent).toContain('Ativo'));
    expect(rowOf('pessoa1@exemplo.com.br').textContent).toContain('Kiwify');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Acesso de pessoa1@exemplo.com.br desbloqueado.',
    });
  });

  it('a vanished row (404) leaves the list, toasts "Este acesso não existe mais." and refreshes', async () => {
    actions.block.mockResolvedValue({ ok: false, code: 'gone' });
    mount({ initialItems: [item(1), item(2)] });
    fireEvent.click(rowOf('pessoa2@exemplo.com.br'));
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear acesso' }));
    await act(async () => {
      fireEvent.click(within(top()).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-access-row="pessoa2@exemplo.com.br"]')).toBeNull(),
    );
    expect(rowOf('pessoa1@exemplo.com.br')).toBeTruthy();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Este acesso não existe mais.',
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('a server write that answers no row removes the row (access: null)', async () => {
    actions.unblock.mockResolvedValue({ ok: true, access: null, serverNow: NOW });
    mount({
      initialItems: [item(1, { state: 'blocked', source: 'manual', validUntil: null }), item(2)],
    });
    fireEvent.click(rowOf('pessoa1@exemplo.com.br'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear acesso' }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-access-row="pessoa1@exemplo.com.br"]')).toBeNull(),
    );
    expect(rowOf('pessoa2@exemplo.com.br')).toBeTruthy();
  });
});
