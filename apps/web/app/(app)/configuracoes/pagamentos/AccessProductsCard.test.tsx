// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-13 — Produtos de acesso (UI-D-515, D-502, A-UI-7), against the REAL merged pt-BR catalog
 * through next-intl's own `createTranslator`. Stubbed: the server actions, the router and the toast.
 * Real: the card, the sheet, the shipped `BottomSheet`, `ConfirmDialog`, inputs and pills.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, refresh, create, update, remove } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

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

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => ({
  createAccessProductAction: create,
  updateAccessProductAction: update,
  removeAccessProductAction: remove,
}));

const { AccessProductsCard } = await import('./AccessProductsCard');
type AccessProductView = import('@/lib/payments-view').AccessProductView;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function product(patch: Partial<AccessProductView> & { id: string }): AccessProductView {
  const externalProductId = patch.externalProductId ?? `ext-${patch.id.slice(0, 4)}`;
  return {
    name: 'Assinatura mensal',
    externalProductId,
    checkoutUrl: 'https://pay.example.test/mensal',
    idMeta: `ID ${externalProductId}`,
    hasLink: patch.checkoutUrl !== null,
    feedsButton: false,
    ...patch,
  };
}

const MONTHLY = product({
  id: A,
  name: 'Assinatura mensal',
  externalProductId: 'a1b2c3',
  feedsButton: true,
});
const YEARLY = product({
  id: B,
  name: 'Assinatura anual',
  externalProductId: 'd4e5f6',
  checkoutUrl: null,
});

function Harness({
  initial,
  gateRequired = false,
}: {
  initial: AccessProductView[];
  gateRequired?: boolean;
}) {
  const [products, setProducts] = useState(initial);
  return (
    <AccessProductsCard
      gatewayName="Kiwify"
      tenantName="Rede Demo"
      products={products}
      gateRequired={gateRequired}
      onProductsChange={setProducts}
    />
  );
}

function renderCard(initial: AccessProductView[], gateRequired = false) {
  return render(<Harness initial={initial} gateRequired={gateRequired} />);
}

const rows = () => Array.from(document.querySelectorAll('ul[aria-labelledby] > li'));
const dialog = (name: string | RegExp) => screen.getByRole('dialog', { name });
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

function fill(id: string, value: string) {
  fireEvent.change(field(id), { target: { value } });
}

beforeEach(() => {
  for (const mock of [toast.show, refresh, create, update, remove]) mock.mockReset();
});
afterEach(cleanup);

describe('AccessProductsCard: E03 empty and zero-one-many', () => {
  it('0 products: the card EmptyState with the outline action, and no list button of its own', () => {
    renderCard([]);
    expect(screen.getByText('Nenhum produto de acesso')).toBeTruthy();
    expect(
      screen.getByText(
        'Cadastre o produto de assinatura do Kiwify para liberar a entrada de quem comprar.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Adicionar produto de acesso' })).toHaveLength(1);
    expect(rows()).toHaveLength(0);
  });

  it('1 product with a link: one row, and it is the one marked "Usado no botão Assinar"', () => {
    renderCard([MONTHLY]);
    expect(rows()).toHaveLength(1);
    expect(screen.getAllByText('Usado no botão Assinar')).toHaveLength(1);
    expect(screen.queryByText('Sem link de compra')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Adicionar produto de acesso' })).toHaveLength(1);
  });

  it('1 product without a link: the warning pill and no mark at all (E03 partial)', () => {
    renderCard([product({ id: B, name: 'Anual', checkoutUrl: null })]);
    expect(screen.getByText('Sem link de compra')).toBeTruthy();
    expect(screen.queryByText('Usado no botão Assinar')).toBeNull();
  });

  it('many: stacked rows in the order given, exactly one carrying the mark (E03 populated)', () => {
    renderCard([MONTHLY, YEARLY, product({ id: C, name: 'Vitalícia', externalProductId: 'z9' })]);
    const items = rows();
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.querySelector('b, span.font-bold')?.textContent)).toEqual([
      'Assinatura mensal',
      'Assinatura anual',
      'Vitalícia',
    ]);
    expect(screen.getAllByText('Usado no botão Assinar')).toHaveLength(1);
    expect(items[0]?.textContent).toContain('Usado no botão Assinar');
    expect(items[1]?.textContent).toContain('Sem link de compra');
    expect(items[0]?.textContent).toContain('ID a1b2c3');
  });
});

describe('AccessProductsCard: row anatomy (E03 overflow, long text)', () => {
  it('truncates the name and the ID to one line inside min-w-0 flex-1, and keeps the chevron', () => {
    const longName = 'N'.repeat(120);
    const longId = 'I'.repeat(60);
    renderCard([product({ id: A, name: longName, externalProductId: longId, feedsButton: true })]);
    const row = rows()[0] as HTMLElement;
    const button = row.querySelector('button') as HTMLButtonElement;
    expect(button.className).toContain('min-h-18');
    const column = button.querySelector('.min-w-0.flex-1') as HTMLElement;
    expect(column).toBeTruthy();
    const name = within(column).getByText(longName);
    const id = within(column).getByText(`ID ${longId}`);
    expect(name.className).toContain('truncate');
    expect(id.className).toContain('truncate');
    expect(id.className).toContain('tabular-nums');
    // The pills and the chevron stay on the row.
    expect(within(column).getByText('Usado no botão Assinar')).toBeTruthy();
    expect(button.querySelector('svg:last-child')).toBeTruthy();
    expect(button.querySelector('.w-10.h-10')).toBeTruthy();
  });
});

describe('AccessProductsCard: the new-product sheet (D-502)', () => {
  it('opens from the list button, with the submit disabled until the name and the ID are filled', () => {
    renderCard([MONTHLY]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto de acesso' }));
    expect(dialog('Novo produto de acesso')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Adicionar produto' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(field('payments-product-name').getAttribute('maxlength')).toBe('80');
    expect(field('payments-product-name').getAttribute('placeholder')).toBe(
      'Ex.: Assinatura mensal',
    );
    expect(screen.getByText('ID do produto no Kiwify')).toBeTruthy();
    expect(field('payments-product-id').getAttribute('autocapitalize')).toBe('none');
    expect(field('payments-product-link').type).toBe('url');
    expect(field('payments-product-link').getAttribute('placeholder')).toBe('https://');

    fill('payments-product-name', 'Anual');
    expect(submit.disabled).toBe(true);
    fill('payments-product-id', 'xyz');
    expect(submit.disabled).toBe(false);
  });

  it('keeps the submit disabled while a typed link does not start with https://', () => {
    renderCard([]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto de acesso' }));
    fill('payments-product-name', 'Anual');
    fill('payments-product-id', 'xyz');
    const submit = screen.getByRole('button', { name: 'Adicionar produto' }) as HTMLButtonElement;
    fill('payments-product-link', 'http://pay.example.test');
    expect(submit.disabled).toBe(true);
    fill('payments-product-link', 'https://pay.example.test/anual');
    expect(submit.disabled).toBe(false);
    fill('payments-product-link', '');
    expect(submit.disabled).toBe(false);
  });

  it('creates the product, appends the row from the server answer, closes and toasts', async () => {
    create.mockResolvedValue({
      ok: true,
      product: {
        id: B,
        name: 'Anual',
        externalProductId: 'xyz',
        checkoutUrl: 'https://pay.example.test/anual',
        feedsSubscribeButton: false,
        createdAt: '2026-10-21T12:00:00.000Z',
      },
    });
    renderCard([MONTHLY]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto de acesso' }));
    fill('payments-product-name', '  Anual ');
    fill('payments-product-id', 'xyz');
    fill('payments-product-link', 'https://pay.example.test/anual');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto' }));

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(create).toHaveBeenCalledWith({
      name: '  Anual ',
      externalProductId: 'xyz',
      checkoutUrl: 'https://pay.example.test/anual',
    });
    expect(rows()[1]?.textContent).toContain('Anual');
    // Still exactly one mark: the oldest product with a link keeps it.
    expect(screen.getAllByText('Usado no botão Assinar')).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Usado no botão Assinar');
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto adicionado.' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Novo produto de acesso' })).toBeNull(),
    );
  });

  it.each([
    ['name_required', 'payments-product-name', 'Informe um nome.'],
    ['product_id_required', 'payments-product-id', 'Informe o ID do produto.'],
    [
      'gateway_product_taken',
      'payments-product-id',
      'Este ID já está em uso. Confira o ID no Kiwify.',
    ],
    ['link_invalid', 'payments-product-link', 'Informe um link que comece com https://.'],
  ])(
    'shows the %s refusal under its field with role="alert", cleared by the next edit',
    async (code, id, text) => {
      create.mockResolvedValue({ ok: false, code });
      renderCard([]);
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto de acesso' }));
      fill('payments-product-name', 'Anual');
      fill('payments-product-id', 'xyz');
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(text);
      expect(field(id).getAttribute('aria-invalid')).toBe('true');
      expect(dialog('Novo produto de acesso')).toBeTruthy();
      expect(toast.show).not.toHaveBeenCalled();

      fill(id, `${field(id).value}1`);
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('toasts a failed save and keeps the sheet open with what was typed', async () => {
    create.mockResolvedValue({ ok: false, code: 'generic' });
    renderCard([]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto de acesso' }));
    fill('payments-product-name', 'Anual');
    fill('payments-product-id', 'xyz');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível salvar o produto. Tente novamente.',
      }),
    );
    expect(dialog('Novo produto de acesso')).toBeTruthy();
    expect(field('payments-product-name').value).toBe('Anual');
    expect(rows()).toHaveLength(0);
  });
});

describe('AccessProductsCard: editing', () => {
  it('opens the row in the edit sheet and saves ONLY the keys that changed, in place', async () => {
    update.mockResolvedValue({
      ok: true,
      product: {
        id: A,
        name: 'Mensal Plus',
        externalProductId: 'a1b2c3',
        checkoutUrl: 'https://pay.example.test/mensal',
        feedsSubscribeButton: true,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    });
    renderCard([MONTHLY, YEARLY]);
    fireEvent.click(rows()[0]?.querySelector('button') as HTMLButtonElement);
    expect(dialog('Editar produto de acesso')).toBeTruthy();
    expect(field('payments-product-name').value).toBe('Assinatura mensal');
    expect(field('payments-product-id').value).toBe('a1b2c3');
    expect(field('payments-product-link').value).toBe('https://pay.example.test/mensal');
    expect(screen.getByRole('button', { name: 'Remover produto' })).toBeTruthy();

    fill('payments-product-name', 'Mensal Plus');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto salvo.' }),
    );
    expect(update).toHaveBeenCalledWith(A, { name: 'Mensal Plus' });
    expect(rows()[0]?.textContent).toContain('Mensal Plus');
    expect(rows()).toHaveLength(2);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Editar produto de acesso' })).toBeNull(),
    );
  });

  it('moves the mark to the next product with a link when the marked one loses its link', async () => {
    const second = product({ id: C, name: 'Vitalícia', externalProductId: 'z9' });
    update.mockResolvedValue({
      ok: true,
      product: {
        id: A,
        name: 'Assinatura mensal',
        externalProductId: 'a1b2c3',
        checkoutUrl: null,
        feedsSubscribeButton: false,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    });
    renderCard([MONTHLY, second]);
    fireEvent.click(rows()[0]?.querySelector('button') as HTMLButtonElement);
    fill('payments-product-link', '');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(A, { checkoutUrl: '' }));
    await waitFor(() => expect(rows()[1]?.textContent).toContain('Usado no botão Assinar'));
    expect(rows()[0]?.textContent).toContain('Sem link de compra');
    expect(screen.getAllByText('Usado no botão Assinar')).toHaveLength(1);
  });
});

describe('AccessProductsCard: removal (UI-D-515, E03 error)', () => {
  async function openRemoveDialog() {
    fireEvent.click(rows()[0]?.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: 'Remover produto' }));
    return dialog('Remover Assinatura mensal?');
  }

  it('confirms in the danger dialog, removes the row and toasts', async () => {
    remove.mockResolvedValue({ ok: true, id: A });
    renderCard([MONTHLY, YEARLY]);
    const confirmDialog = await openRemoveDialog();
    expect(
      within(confirmDialog).getByText(
        'Renovações, cancelamentos e reembolsos deste produto deixam de ser reconhecidos, e quem já tem acesso por ele o mantém.',
      ),
    ).toBeTruthy();
    expect(within(confirmDialog).getByRole('button', { name: 'Remover' }).className).toContain(
      'text-danger',
    );
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(remove).toHaveBeenCalledWith(A);
    expect(rows()[0]?.textContent).toContain('Assinatura anual');
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto removido.' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Editar produto de acesso' })).toBeNull(),
    );
  });

  it('shows the inline alert when the server refuses the last product, and keeps the product and the sheet', async () => {
    remove.mockResolvedValue({ ok: false, code: 'last_access_product' });
    renderCard([MONTHLY]);
    const confirmDialog = await openRemoveDialog();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remover' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Desative “Exigir assinatura para entrar” antes de remover o último produto de acesso.',
    );
    expect(rows()).toHaveLength(1);
    expect(dialog('Editar produto de acesso')).toBeTruthy();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('does not even open the dialog for the last product while the gate is on: the alert is the answer', () => {
    renderCard([MONTHLY], true);
    fireEvent.click(rows()[0]?.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: 'Remover produto' }));
    expect(screen.queryByRole('dialog', { name: 'Remover Assinatura mensal?' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(
      'Desative “Exigir assinatura para entrar”',
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('with the gate on and more than one product, removal is allowed', async () => {
    remove.mockResolvedValue({ ok: true, id: A });
    renderCard([MONTHLY, YEARLY], true);
    const confirmDialog = await openRemoveDialog();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(A));
  });
});

describe('AccessProductsCard: a lost permission', () => {
  it('toasts the shipped forbidden line, closes the sheet and refreshes into notFound()', async () => {
    create.mockResolvedValue({ ok: false, code: 'forbidden' });
    renderCard([]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto de acesso' }));
    fill('payments-product-name', 'Anual');
    fill('payments-product-id', 'xyz');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar produto' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Você não tem mais permissão para esta ação.',
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
