// @vitest-environment happy-dom
import type { EventItem } from '@rede-social/contracts/payments';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-14 — the Eventos tab (UI-D-519, UI-D-520, D-503, PAY-21), against the REAL pt-BR catalog. The
 * server actions, the router and the toast are stubs; `PullToRefresh` is swapped for a button that calls
 * its `onRefresh` (happy-dom has no touch pull). The row, the dialog and the pills are the real ones.
 *
 * The list renders ONLY the contract's fields (T-09.1-65): no payload, header, signature or gateway
 * message exists in an `EventItem`, and a test below hands it extra ones to prove none is drawn.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, replace: vi.fn(), push: vi.fn() }),
}));

const actions = vi.hoisted(() => ({ load: vi.fn(), grant: vi.fn() }));
vi.mock('./actions', () => ({
  loadEventsAction: (...args: unknown[]) => actions.load(...args),
  grantEventAction: (...args: unknown[]) => actions.grant(...args),
}));

const toast = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    useToast: () => toast,
    PullToRefresh: ({
      children,
      onRefresh,
    }: {
      children: ReactNode;
      onRefresh: () => Promise<void>;
    }) =>
      createElement(
        'div',
        null,
        createElement('button', { type: 'button', 'data-pull': true, onClick: onRefresh }, 'puxar'),
        children,
      ),
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

const { EventsList } = await import('./EventsList');

const NOW = '2026-10-21T12:00:00.000Z';
const THREE_MIN = '2026-10-21T11:57:00.000Z';
const ONE_HOUR = '2026-10-21T11:00:00.000Z';
const THREE_DAYS = '2026-10-18T12:00:00.000Z';

const APPLIED: EventItem = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'purchase_approved',
  state: 'applied',
  email: 'ana@exemplo.com.br',
  productName: 'Assinatura mensal',
  externalProductId: 'a1b2c3',
  outcome: 'access_granted',
  receivedAt: THREE_MIN,
};
const NO_ACCOUNT: EventItem = {
  id: '22222222-2222-4222-8222-222222222222',
  type: 'purchase_approved',
  state: 'no_account',
  email: 'caio@exemplo.com.br',
  productName: 'Curso de Harmonização',
  externalProductId: 'c1c1c1',
  outcome: null,
  receivedAt: ONE_HOUR,
};
const UNKNOWN: EventItem = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'purchase_approved',
  state: 'unknown_product',
  email: null,
  productName: null,
  externalProductId: 'z9y8x7',
  outcome: null,
  receivedAt: THREE_DAYS,
};
const IGNORED: EventItem = {
  id: '44444444-4444-4444-8444-444444444444',
  type: 'cart_abandoned',
  state: 'ignored',
  email: null,
  productName: 'Assinatura mensal',
  externalProductId: 'a1b2c3',
  outcome: 'no_effect',
  receivedAt: THREE_DAYS,
};

type ListProps = Parameters<typeof EventsList>[0];

function props(over: Partial<ListProps> = {}): ListProps {
  return {
    initialItems: [APPLIED, NO_ACCOUNT, UNKNOWN, IGNORED],
    serverNow: NOW,
    gatewayName: 'Kiwify',
    tenantName: 'Rede Demo',
    ...over,
  };
}

function mount(over: Partial<ListProps> = {}) {
  const view = render(<EventsList {...props(over)} />);
  return {
    ...view,
    update: (next: Partial<ListProps>) =>
      view.rerender(<EventsList {...props({ ...over, ...next })} />),
  };
}

const list = () => screen.getByRole('list', { name: 'Eventos recentes' });
const rows = () => within(list()).getAllByRole('listitem');
const rowWith = (text: string) =>
  rows().find((row) => row.textContent?.includes(text)) as HTMLElement;

beforeEach(() => {
  nav.refresh.mockReset();
  actions.load.mockReset();
  actions.grant.mockReset();
  toast.show.mockReset();
});

afterEach(cleanup);

describe('EventsList: the section (E07 zero-one-many)', () => {
  it('titles the section and counts the events with the plural', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Eventos recentes' })).toBeTruthy();
    expect(screen.getByText('Mostrando os últimos 4 eventos.')).toBeTruthy();
  });

  it('counts ONE event with the ICU singular, as the approved copy writes it', () => {
    mount({ initialItems: [APPLIED] });
    expect(screen.getByText('Mostrando os últimos 1 evento.')).toBeTruthy();
    expect(rows()).toHaveLength(1);
  });

  it('is capped by the server and never paged or searched: no sentinel, no field', () => {
    mount({
      initialItems: Array.from({ length: 50 }, (_, index) => ({
        ...APPLIED,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      })),
    });
    expect(rows()).toHaveLength(50);
    expect(screen.getByText('Mostrando os últimos 50 eventos.')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('keeps the list in the card geometry, divided, named', () => {
    mount();
    expect(list().className).toContain('divide-y');
    expect(list().className).toContain('divide-divider');
  });
});

describe('EventsList: empty (E07 empty)', () => {
  it('shows the Webhook empty state that tells the admin how to send a test, and no helper line', () => {
    mount({ initialItems: [] });
    expect(screen.getByText('Nenhum evento recebido ainda')).toBeTruthy();
    expect(
      screen.getByText(
        'Quando o Kiwify enviar uma compra, ela aparece aqui. Use “Testar webhook” no painel do Kiwify para conferir a integração.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Mostrando os últimos/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Eventos recentes' })).toBeNull();
  });
});

describe('EventsList: populated (E07 populated, partial)', () => {
  it('draws name, e-mail, product, effect, state pill and "recebido {when}" for an applied access purchase', () => {
    mount();
    const row = rowWith('ana@exemplo.com.br');
    expect(row.textContent).toBe(
      'Compra aprovadaana@exemplo.com.brAssinatura mensalAcesso liberadoAplicadorecebido há 3 min',
    );
  });

  it('gives each state its word and its own action: grant on no-account, register on unknown-product, none otherwise', () => {
    mount();
    expect(within(rowWith('caio@exemplo.com.br')).getByText('Sem conta')).toBeTruthy();
    expect(
      within(rowWith('caio@exemplo.com.br')).getByRole('button', { name: 'Liberar manualmente' }),
    ).toBeTruthy();
    expect(within(rowWith('Produto desconhecido')).getByText('Produto desconhecido')).toBeTruthy();
    expect(within(rowWith('Produto desconhecido')).queryByRole('button')).toBeNull();
    expect(within(rowWith('Aplicado')).queryByRole('button')).toBeNull();
    expect(within(rowWith('Ignorado')).queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Liberar manualmente' })).toHaveLength(1);
  });

  it('"Cadastrar produto" is a link to the Configuração tab, on the unknown-product row only', () => {
    mount();
    const link = screen.getByRole('link', { name: 'Cadastrar produto' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/configuracoes/pagamentos');
    expect(
      within(rowWith('Produto desconhecido')).getByRole('link', { name: 'Cadastrar produto' }),
    ).toBe(link);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('partial: no e-mail reads "E-mail não informado", an unknown product reads "ID {externalId}", no outcome draws no effect line', () => {
    mount();
    const unknown = rowWith('Produto desconhecido');
    expect(unknown.textContent).toBe(
      'Compra aprovadaE-mail não informadoID z9y8x7Produto desconhecidorecebido há 3 dias',
    );
    const ignored = rowWith('Ignorado');
    expect(ignored.textContent).toContain('Carrinho abandonado');
    expect(ignored.textContent).toContain('Evento sem efeito no acesso');
  });

  it('names an event by the neutral type, never the gateway trigger', () => {
    mount();
    expect(screen.queryByText(/order_approved|compra_aprovada|webhook/i)).toBeNull();
  });
});

describe('EventsList: overflow and long text (E07 overflow, E07 long-text)', () => {
  it('truncates a long e-mail and a 120-character product and keeps the action beside the column, 44px tappable', () => {
    const email = `${'a'.repeat(64)}@${'clinica-de-estetica-avancada'.repeat(3)}.com.br`;
    const product = 'Curso de Harmonização Orofacial '.repeat(4).trim().slice(0, 120);
    mount({ initialItems: [{ ...NO_ACCOUNT, email, productName: product }] });
    expect(screen.getByText(email).className).toContain('truncate');
    expect(screen.getByText(product).className).toContain('truncate');
    const action = screen.getByRole('button', { name: 'Liberar manualmente' });
    expect(action.parentElement?.className).toContain('shrink-0');
    expect(action.parentElement?.className).toContain('max-[359px]:basis-full');
    // `hitArea` is the transparent 44px target around the 36px `sm` look (UI-D-443).
    expect(action.outerHTML).toMatch(/after:|before:|min-h-11|h-11/);
  });
});

describe('EventsList: T-09.1-65 — nothing but the contract fields is ever drawn', () => {
  it('ignores a payload, a signature and a header even if an object carries them', () => {
    const leaky = {
      ...APPLIED,
      payload: 'SEGREDO-DO-PAYLOAD',
      signature: 'SEGREDO-DA-ASSINATURA',
      headers: { authorization: 'SEGREDO-DO-CABECALHO' },
      message: 'SEGREDO-DA-MENSAGEM',
    } as unknown as EventItem;
    mount({ initialItems: [leaky] });
    expect(document.body.textContent).not.toMatch(/SEGREDO/);
  });

  it('writes the e-mail and the product as plain text, never markup', () => {
    mount({
      initialItems: [
        { ...NO_ACCOUNT, email: '<img src=x onerror=alert(1)>', productName: '<b>x</b>' },
      ],
    });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('EventsList: "Liberar manualmente" (D-503, the store grant)', () => {
  const grantedEvent: EventItem = {
    ...NO_ACCOUNT,
    state: 'applied',
    outcome: 'product_granted',
  };

  async function confirmGrant() {
    fireEvent.click(screen.getByRole('button', { name: 'Liberar manualmente' }));
    const dialog = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar' }));
    });
  }

  it('opens the brand dialog "Liberar {product} para {email}?" and writes nothing until confirmed', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Liberar manualmente' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', {
        name: 'Liberar Curso de Harmonização para caio@exemplo.com.br?',
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('O produto é liberado agora, como se a compra tivesse chegado.'),
    ).toBeTruthy();
    expect(actions.grant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(actions.grant).not.toHaveBeenCalled();
  });

  it('sends only the event id, then the row becomes "Aplicado" IN PLACE from the server answer and toasts', async () => {
    actions.grant.mockResolvedValue({ ok: true, event: grantedEvent, serverNow: NOW });
    mount();
    await confirmGrant();
    await waitFor(() =>
      expect(within(rowWith('caio@exemplo.com.br')).getByText('Aplicado')).toBeTruthy(),
    );
    expect(actions.grant).toHaveBeenCalledWith(NO_ACCOUNT.id);
    const row = rowWith('caio@exemplo.com.br');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row.textContent).toContain('Produto liberado');
    expect(rows()).toHaveLength(4);
    expect(rows().indexOf(row)).toBe(1);
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Curso de Harmonização liberado para caio@exemplo.com.br.',
    });
  });

  it('never flips the row before the server answers (no optimistic state)', async () => {
    let finish: (value: unknown) => void = () => {};
    actions.grant.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount();
    await confirmGrant();
    expect(within(rowWith('caio@exemplo.com.br')).getByText('Sem conta')).toBeTruthy();
    await act(async () => finish({ ok: true, event: grantedEvent, serverNow: NOW }));
    await waitFor(() =>
      expect(within(rowWith('caio@exemplo.com.br')).getByText('Aplicado')).toBeTruthy(),
    );
  });

  it('a 409 no_membership toasts the sentence with the tenant name and leaves the row unchanged', async () => {
    actions.grant.mockResolvedValue({ ok: false, code: 'no_membership' });
    mount();
    await confirmGrant();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message:
          'Esta pessoa ainda não tem conta em Rede Demo. Peça que crie a conta com o mesmo e-mail da compra.',
      }),
    );
    const row = rowWith('caio@exemplo.com.br');
    expect(within(row).getByText('Sem conta')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Liberar manualmente' })).toBeTruthy();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('a row that is no longer grantable toasts the generic line and refreshes', async () => {
    actions.grant.mockResolvedValue({ ok: false, code: 'not_grantable' });
    mount();
    await confirmGrant();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('a vanished event leaves the list, toasts the generic line and refreshes', async () => {
    actions.grant.mockResolvedValue({ ok: false, code: 'gone' });
    mount();
    await confirmGrant();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByText('caio@exemplo.com.br')).toBeNull();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Algo deu errado. Tente novamente.',
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('a lost permission toasts the shipped line and refreshes', async () => {
    actions.grant.mockResolvedValue({ ok: false, code: 'forbidden' });
    mount();
    await confirmGrant();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Você não tem mais permissão para esta ação.',
      }),
    );
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('any other failure, or a rejected action, toasts the generic line and keeps the row', async () => {
    actions.grant.mockRejectedValue(new Error('network'));
    mount();
    await confirmGrant();
    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
    expect(within(rowWith('caio@exemplo.com.br')).getByText('Sem conta')).toBeTruthy();
  });
});

describe('EventsList: refresh and reseed', () => {
  it('re-seeds from the new page when the server renders a new one (router.refresh)', () => {
    const view = mount();
    expect(rows()).toHaveLength(4);
    view.update({ initialItems: [APPLIED] });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Mostrando os últimos 1 evento.')).toBeTruthy();
  });

  it('a pull asks the server again and replaces the rows and the count', async () => {
    actions.load.mockResolvedValue({ ok: true, items: [APPLIED, IGNORED], serverNow: NOW });
    mount();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-pull]') as HTMLElement);
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText('Mostrando os últimos 2 eventos.')).toBeTruthy();
  });

  it('a failed pull keeps every row and toasts the events line', async () => {
    actions.load.mockResolvedValue({ ok: false, code: 'generic' });
    mount();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-pull]') as HTMLElement);
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível carregar os eventos. Tente novamente.',
      }),
    );
    expect(rows()).toHaveLength(4);
  });

  it('a pull that finds the permission lost toasts the shipped line and refreshes', async () => {
    actions.load.mockResolvedValue({ ok: false, code: 'forbidden' });
    mount();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-pull]') as HTMLElement);
    });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });
});
