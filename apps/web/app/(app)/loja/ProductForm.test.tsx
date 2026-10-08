// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.2-10 — the product form (UI-D-377, UI-D-383, D-363), against the REAL merged pt-BR catalogs
 * through next-intl's own `createTranslator` (ICU plurals included), so a copy drift fails here.
 * Stubbed: the server actions, the router, the toast and the upload hook. Real: the form, the store
 * contracts, `parseBrlToCents`, the shipped `CommunityPickerSheet`, `ConfirmDialog` and inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, push, refresh, create, update, setStatus, lockPreview } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setStatus: vi.fn(),
  lockPreview: vi.fn(),
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./product-actions', () => ({
  createProductAction: create,
  updateProductAction: update,
  setProductStatusAction: setStatus,
  lockPreviewAction: lockPreview,
}));

vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: () => ({
    state: 'idle',
    progress: 0,
    error: null,
    pick: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

const { ProductForm, priceVerdict } = await import('./ProductForm');

const NBSP = ' ';
const P = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

const COMMUNITIES = [
  { id: C1, name: 'Mentoria ao vivo', coverAssetId: null, coverVariantWidths: [] },
  { id: C2, name: 'Bastidores da mentoria', coverAssetId: null, coverVariantWidths: [] },
];

const EDIT_INITIAL = {
  name: 'Mentoria em grupo',
  description: 'Seis encontros.',
  priceText: '19,90',
  priceCents: 1990,
  imageAssetId: null,
  communities: [
    { id: C1, name: 'Mentoria ao vivo', coverAssetId: null, coverVariantWidths: [640] },
  ],
  status: 'active' as const,
};

function renderCreate(overrides: Record<string, unknown> = {}) {
  return render(
    <ProductForm mode="create" tenantName="Rede Demo" communities={COMMUNITIES} {...overrides} />,
  );
}

function renderEdit(overrides: Record<string, unknown> = {}) {
  return render(
    <ProductForm
      mode="edit"
      productId={P}
      initial={EDIT_INITIAL}
      tenantName="Rede Demo"
      communities={COMMUNITIES}
      {...overrides}
    />,
  );
}

const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const priceInput = () => document.getElementById('product-price') as HTMLInputElement;
const nameInput = () => document.getElementById('product-name') as HTMLInputElement;

function typePrice(value: string) {
  fireEvent.change(priceInput(), { target: { value } });
  fireEvent.blur(priceInput());
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing newly locks (every added community is already gated by another product).
  lockPreview.mockResolvedValue({ ok: true, items: [] });
});
afterEach(cleanup);

describe('priceVerdict (UI-D-383)', () => {
  it.each([
    ['19', 1900],
    ['19,9', 1990],
    ['19,90', 1990],
    ['1.234,50', 123450],
    ['1234,50', 123450],
    ['0', 0],
    ['100.000,00', 10_000_000],
  ])('accepts %s as %i cents', (text, cents) => {
    expect(priceVerdict(text)).toEqual({ kind: 'ok', cents });
  });

  it.each(['-1', '19.90', '19,999', 'abc', '1,2,3'])('refuses %s as invalid', (text) => {
    expect(priceVerdict(text)).toEqual({ kind: 'invalid' });
  });

  it('refuses more than R$ 100.000,00 as too high, and an empty field as empty', () => {
    expect(priceVerdict('100.000,01')).toEqual({ kind: 'too_high', cents: 10_000_001 });
    expect(priceVerdict('  ')).toEqual({ kind: 'empty' });
  });
});

describe('ProductForm — create (UI-D-377)', () => {
  it('1. an empty create form: title, disabled submit, gradient preview, helpers, the none line', () => {
    renderCreate();

    expect(screen.getByRole('heading', { name: 'Novo produto' })).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Criar produto');
    expect(document.querySelector('form')?.getAttribute('data-shell-hide')).toBe('nav');
    expect(document.querySelector('[data-product-image-fallback]')).not.toBeNull();
    expect(screen.getByText(/usamos as cores de Rede Demo\./)).toBeTruthy();
    expect(screen.getByText('Use 0 para oferecer grátis.')).toBeTruthy();
    expect(priceInput().getAttribute('inputmode')).toBe('decimal');
    expect(priceInput().getAttribute('placeholder')).toBe('0,00');
    expect(nameInput().maxLength).toBe(80);
    expect(screen.getByText(/^Nenhuma comunidade\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Escolher comunidades' })).toBeTruthy();
  });

  it('2. the price re-displays with two decimals on blur and enables the submit with a name', () => {
    renderCreate();
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });

    for (const [typed, shown] of [
      ['19', '19,00'],
      ['19,9', '19,90'],
      ['1.234,50', '1.234,50'],
      ['1234,50', '1.234,50'],
      ['0', '0,00'],
    ]) {
      typePrice(typed as string);
      expect(priceInput().value).toBe(shown);
      expect(document.getElementById('product-price-error')).toBeNull();
      expect(submitButton().disabled).toBe(false);
    }
  });

  it('3. unparseable and over-cap prices show the field error and block the submit', () => {
    renderCreate();
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });

    for (const typed of ['-1', '19.90', 'abc']) {
      typePrice(typed);
      expect(document.getElementById('product-price-error')?.textContent).toBe(
        'Informe um valor como 19,90.',
      );
      expect(submitButton().disabled).toBe(true);
    }

    typePrice('100.000,01');
    expect(document.getElementById('product-price-error')?.textContent).toBe(
      `O valor máximo é R$${NBSP}100.000,00.`,
    );
    expect(submitButton().disabled).toBe(true);
  });

  it('4. the description counter follows the text', () => {
    renderCreate();
    fireEvent.change(document.getElementById('product-description') as HTMLTextAreaElement, {
      target: { value: 'Cinco' },
    });
    expect(document.getElementById('product-description-counter')?.textContent).toBe('5/2000');
  });

  it('5. the picker toggles communities; the button reads Alterar with one or more; X removes', () => {
    renderCreate();

    fireEvent.click(screen.getByRole('button', { name: 'Escolher comunidades' }));
    const sheet = screen.getByRole('dialog', { name: 'Comunidades liberadas' });
    expect(within(sheet).getByText('Toque para incluir ou tirar.')).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Mentoria ao vivo, não incluída' }));
    expect(within(sheet).getByRole('button', { name: 'Mentoria ao vivo, incluída' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    expect(screen.getByRole('button', { name: 'Alterar comunidades' })).toBeTruthy();
    expect(document.querySelector(`[data-product-community="${C1}"]`)).not.toBeNull();
    expect(screen.queryByText(/^Nenhuma comunidade\./)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remover Mentoria ao vivo' }));
    expect(screen.getByRole('button', { name: 'Escolher comunidades' })).toBeTruthy();
    expect(screen.getByText(/^Nenhuma comunidade\./)).toBeTruthy();
  });

  it('6. with the communities module off there is no communities field and no links are sent', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ communities: null });

    expect(document.querySelector('[data-product-communities]')).toBeNull();
    expect(screen.queryByText('Comunidades liberadas')).toBeNull();

    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('0');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('communityIds');
    expect(create.mock.calls[0]?.[0]).toMatchObject({ name: 'Mentoria', priceCents: 0 });
  });

  it('7. a dirty close opens the discard dialog; a clean close leaves for /loja', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(push).toHaveBeenCalledWith('/loja');

    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('dialog', { name: 'Descartar produto?' })).toBeTruthy();
  });

  it('8. a create save sends cents and the selection, toasts and opens the product page', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate();

    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher comunidades' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bastidores da mentoria, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(create).toHaveBeenCalledWith({
      name: 'Mentoria',
      description: '',
      priceCents: 1990,
      imageAssetId: null,
      communityIds: [C2],
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto criado.' });
    expect(push).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('9. field refusals land under their field; any other refusal toasts and keeps the draft', async () => {
    renderCreate();
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');

    create.mockResolvedValueOnce({ ok: false, code: 'price_invalid' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.getElementById('product-price-error')?.textContent).toBe(
      'Informe um valor como 19,90.',
    );
    expect(toast.show).not.toHaveBeenCalled();

    // Editing the field clears the server's verdict.
    typePrice('19,90');
    create.mockResolvedValueOnce({ ok: false, code: 'image_invalid' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-product-image-error]')?.textContent).toBe(
      'Não foi possível usar esta imagem. Escolha outra.',
    );

    create.mockResolvedValueOnce({ ok: false, code: 'generic' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(nameInput().value).toBe('Mentoria');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('ProductForm — edit (UI-D-377, D-363)', () => {
  it('10. opens filled, clean (submit disabled), with the saved link and the archive row', () => {
    renderEdit();

    expect(screen.getByRole('heading', { name: 'Editar produto' })).toBeTruthy();
    expect(nameInput().value).toBe('Mentoria em grupo');
    expect(priceInput().value).toBe('19,90');
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Salvar alterações');
    expect(screen.getByRole('button', { name: 'Alterar comunidades' })).toBeTruthy();
    expect(document.querySelector('[data-product-archive]')?.textContent).toContain(
      'Arquivar produto',
    );

    // Re-typing the same price in another spelling is not a change.
    typePrice('19,9');
    expect(submitButton().disabled).toBe(true);
  });

  it('11. a price-only edit sends ONLY priceCents (the patch never wipes description, image or links)', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit();

    typePrice('29,90');
    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(update).toHaveBeenCalledWith(P, { priceCents: 2990 });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' });
    expect(push).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('12. removing the saved link sends the whole new set', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'Remover Mentoria ao vivo' }));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(P, { communityIds: [] });
  });

  it('13. an archived product offers Reativar produto behind its dialog', async () => {
    setStatus.mockResolvedValue({ ok: true });
    renderEdit({ initial: { ...EDIT_INITIAL, status: 'archived' } });

    expect(document.querySelector('[data-product-archive]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reativar produto' }));
    const dialog = screen.getByRole('dialog', { name: 'Reativar produto?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reativar' }));
    });

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(P, 'active'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto reativado.' });
  });

  it('14. archiving goes through its danger dialog', async () => {
    setStatus.mockResolvedValue({ ok: true });
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar produto' }));
    const dialog = screen.getByRole('dialog', { name: 'Arquivar produto?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));
    });
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(P, 'archived'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto arquivado.' });
  });
});

describe('ProductForm — the lock warning before save (D-364, UI-D-378)', () => {
  /** Edit form (C1 saved), adds C2 through the picker. */
  function addSecondCommunity() {
    fireEvent.click(screen.getByRole('button', { name: 'Alterar comunidades' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bastidores da mentoria, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
  }

  it('15. a failed preview toasts and saves NOTHING (the prohibition)', async () => {
    lockPreview.mockResolvedValue({ ok: false });
    renderEdit();
    addSecondCommunity();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    // Only the NEWLY added community is asked about, with the product being edited.
    expect(lockPreview).toHaveBeenCalledWith({ productId: P, communityIds: [C2] });
    expect(update).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível conferir o impacto. Tente salvar de novo.',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('16. a thrown preview is a failed preview too: nothing saved', async () => {
    lockPreview.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderEdit();
    addSecondCommunity();

    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível conferir o impacto. Tente salvar de novo.',
    });
  });

  it('17. one newly locked community: the danger dialog names it and N; Voltar keeps the selection', async () => {
    lockPreview.mockResolvedValue({
      ok: true,
      items: [{ communityId: C2, membersLosingAccess: 37 }],
    });
    renderEdit();
    addSecondCommunity();

    await act(async () => {
      fireEvent.click(submitButton());
    });
    const dialog = screen.getByRole('dialog', {
      name: 'Tornar Bastidores da mentoria exclusiva?',
    });
    expect(dialog.textContent).toContain(
      '37 membros perderão acesso a Bastidores da mentoria até comprarem ou receberem acesso.',
    );
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();
    // The selection is intact.
    expect(document.querySelector(`[data-product-community="${C2}"]`)).not.toBeNull();

    // Confirming saves the whole new set.
    update.mockResolvedValue({ ok: true, productId: P });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    const again = screen.getByRole('dialog', { name: 'Tornar Bastidores da mentoria exclusiva?' });
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: 'Tornar exclusiva' }));
    });
    await waitFor(() => expect(update).toHaveBeenCalledWith(P, { communityIds: [C1, C2] }));
    expect(push).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('18. a community another product already gates saves without the dialog', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit();
    addSecondCommunity();

    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(lockPreview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).toHaveBeenCalledWith(P, { communityIds: [C1, C2] });
  });

  it('19. no added community (a price change, a removal) never asks the preview', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit();
    typePrice('5');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(lockPreview).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(P, { priceCents: 500 });
  });

  it('20. several on a create: the list body, Tornar exclusivas; a refusal after confirm keeps the form', async () => {
    lockPreview.mockResolvedValue({
      ok: true,
      items: [
        { communityId: C1, membersLosingAccess: 1 },
        { communityId: C2, membersLosingAccess: 0 },
      ],
    });
    create.mockResolvedValue({ ok: false, code: 'generic' });
    renderCreate();
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher comunidades' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mentoria ao vivo, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bastidores da mentoria, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    await act(async () => {
      fireEvent.click(submitButton());
    });
    // A new product sends no productId.
    expect(lockPreview).toHaveBeenCalledWith({ communityIds: [C1, C2] });
    const dialog = screen.getByRole('dialog', { name: 'Tornar 2 comunidades exclusivas?' });
    expect(dialog.textContent).toContain(
      'Membros sem este produto perderão acesso a estas comunidades até comprarem ou receberem acesso: Mentoria ao vivo (1 membro) e Bastidores da mentoria (0 membros).',
    );

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tornar exclusivas' }));
    });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe('Mentoria');
    expect(document.querySelector(`[data-product-community="${C2}"]`)).not.toBeNull();
  });
});
