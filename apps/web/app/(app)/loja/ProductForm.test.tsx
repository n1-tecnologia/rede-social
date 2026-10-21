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

const { toast, push, replace, refresh, create, update, setStatus, lockPreview, saveMapping } =
  vi.hoisted(() => ({
    toast: { show: vi.fn(), dismiss: vi.fn() },
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    lockPreview: vi.fn(),
    saveMapping: vi.fn(),
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

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

vi.mock('./payment-actions', () => ({ savePaymentMappingAction: saveMapping }));

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

const K1 = '44444444-4444-4444-8444-444444444444';
const K2 = '55555555-5555-4555-8555-555555555555';

const COURSE_ROWS = [
  {
    id: K1,
    title: 'Harmonização facial do zero',
    coverAssetId: null,
    coverVariantWidths: [],
    meta: 'Rascunho',
  },
  {
    id: K2,
    title: 'Lábios: técnica e segurança',
    coverAssetId: null,
    coverVariantWidths: [],
    meta: null,
  },
];
const COURSES = { items: COURSE_ROWS, failed: false, capped: false };

const L1 = '66666666-6666-4666-8666-666666666666';
const L2 = '77777777-7777-4777-8777-777777777777';

/** Metas arrive finished from the server (UI-D-288): the form never formats a date. */
const LIVE_ROWS = [
  {
    id: L1,
    title: 'Tira-dúvidas de outubro',
    coverAssetId: null,
    coverVariantWidths: [],
    meta: 'qui, 15 de out, 19:00 · Agendada',
  },
  {
    id: L2,
    title: 'Live de abertura',
    coverAssetId: null,
    coverVariantWidths: [],
    meta: 'ter, 13 de out, 20:00 · Gravada',
  },
];
const LIVES = { items: LIVE_ROWS, failed: false, capped: false };

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
  courses: [] as typeof COURSE_ROWS,
  lives: [] as typeof LIVE_ROWS,
  status: 'active' as const,
};

function renderCreate(overrides: Record<string, unknown> = {}) {
  return render(
    <ProductForm
      mode="create"
      tenantName="Rede Demo"
      communities={COMMUNITIES}
      courses={null}
      lives={null}
      {...overrides}
    />,
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
      courses={null}
      lives={null}
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
  saveMapping.mockResolvedValue({ ok: true });
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
    // 2026-10-09: the new product takes the form's place (lib/form-exit.ts), never a push on it.
    expect(replace).toHaveBeenCalledWith(`/loja/${P}`);
    expect(push).not.toHaveBeenCalled();
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

describe('ProductForm — Cursos liberados (08.4, D-418, UI-D-413, UI-D-414, UI-D-416)', () => {
  const EDIT_WITH_COURSE = {
    ...EDIT_INITIAL,
    courses: [COURSE_ROWS[1] as (typeof COURSE_ROWS)[number]],
  };

  it('21. courses null (module off or no courses.manage): no block in the DOM and no courseIds sent (SC 5)', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ courses: null });

    expect(document.querySelector('[data-product-courses]')).toBeNull();
    expect(screen.queryByText('Cursos liberados')).toBeNull();

    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('0');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('courseIds');
  });

  it('22. the block sits after the communities block: label, none line, Escolher cursos, helper', () => {
    renderCreate({ courses: COURSES });
    const block = document.querySelector('[data-product-courses]') as HTMLElement;
    expect(block).not.toBeNull();
    const communities = document.querySelector('[data-product-communities]') as HTMLElement;
    expect(communities.nextElementSibling).toBe(block);
    expect(within(block).getByText('Cursos liberados')).toBeTruthy();
    expect(block.querySelector('[data-product-courses-none]')?.textContent).toBe('Nenhum curso.');
    expect(within(block).getByRole('button', { name: 'Escolher cursos' })).toBeTruthy();
    expect(
      within(block).getByText(
        'Quem tiver este produto acessa estes cursos por completo. Para os demais, só as aulas abertas ficam liberadas.',
      ),
    ).toBeTruthy();
  });

  it('23. picking a course shows its row (Rascunho meta) and Alterar cursos; X removes it', () => {
    renderCreate({ courses: COURSES });

    fireEvent.click(screen.getByRole('button', { name: 'Escolher cursos' }));
    const sheet = screen.getByRole('dialog', { name: 'Cursos liberados' });
    expect(
      within(sheet).getByText(
        'Toque para incluir ou tirar. Rascunhos e cursos publicados aparecem.',
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Harmonização facial do zero, não incluído' }),
    );
    expect(
      within(sheet).getByRole('button', { name: 'Harmonização facial do zero, incluído' }),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    const row = document.querySelector(`[data-product-course="${K1}"]`) as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('Rascunho')).toBeTruthy();
    expect(within(row).getByText('Harmonização facial do zero').className).toContain('truncate');
    expect(screen.getByRole('button', { name: 'Alterar cursos' })).toBeTruthy();
    expect(document.querySelector('[data-product-courses-none]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remover Harmonização facial do zero' }));
    expect(document.querySelector(`[data-product-course="${K1}"]`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Escolher cursos' })).toBeTruthy();
  });

  it('24. a create save sends courseIds when the block is present: [] with none picked, the pick otherwise', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ courses: COURSES });
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ courseIds: [] });

    cleanup();
    create.mockClear();
    renderCreate({ courses: COURSES });
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher cursos' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Lábios: técnica e segurança, não incluído' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create).toHaveBeenCalledWith({
      name: 'Mentoria',
      description: '',
      priceCents: 1990,
      imageAssetId: null,
      communityIds: [],
      courseIds: [K2],
    });
    // Adding only a course asks no lock preview (A-UI-3).
    expect(lockPreview).not.toHaveBeenCalled();
  });

  it('25. an edit opened with one saved course is clean; a price-only edit sends no courseIds', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit({ initial: EDIT_WITH_COURSE, courses: COURSES });

    expect(document.querySelector(`[data-product-course="${K2}"]`)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Alterar cursos' })).toBeTruthy();
    expect(submitButton().disabled).toBe(true);

    typePrice('29,90');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(P, { priceCents: 2990 });
  });

  it('26. removing the saved course sends courseIds: [] and nothing else', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit({ initial: EDIT_WITH_COURSE, courses: COURSES });

    fireEvent.click(screen.getByRole('button', { name: 'Remover Lábios: técnica e segurança' }));
    expect(submitButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(P, { courseIds: [] });
  });

  it('27. a course-only addition saves straight away: no lock preview, no dialog (PR-3)', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit({ initial: EDIT_WITH_COURSE, courses: COURSES });

    fireEvent.click(screen.getByRole('button', { name: 'Alterar cursos' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Harmonização facial do zero, não incluído' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    // Newly picked rows come first, then the saved ones (UI-D-414).
    const rows = Array.from(document.querySelectorAll('[data-product-course]')).map((row) =>
      row.getAttribute('data-product-course'),
    );
    expect(rows).toEqual([K1, K2]);

    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(lockPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).toHaveBeenCalledWith(P, { courseIds: [K2, K1] });
  });

  it('28. a saved course outside the walked picker rows still shows as a selected row', () => {
    renderEdit({
      initial: EDIT_WITH_COURSE,
      courses: { items: [COURSE_ROWS[0]], failed: false, capped: true },
    });
    expect(document.querySelector(`[data-product-course="${K2}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alterar cursos' }));
    expect(
      screen.getByText('Toque para incluir ou tirar. Mostrando os 1 cursos mais recentes.'),
    ).toBeTruthy();
  });
});

describe('ProductForm — Lives liberadas (08.4, D-418, UI-D-413, UI-D-414, UI-D-416)', () => {
  const EDIT_WITH_LIVE = { ...EDIT_INITIAL, lives: [LIVE_ROWS[1] as (typeof LIVE_ROWS)[number]] };

  it('29. lives null: no block in the DOM and no liveIds sent (SC 5)', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ courses: COURSES, lives: null });

    expect(document.querySelector('[data-product-lives]')).toBeNull();
    expect(screen.queryByText('Lives liberadas')).toBeNull();

    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('0');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('liveIds');
  });

  it('30. the block follows the courses block; picking a live shows its row with the server meta and the 16:10 thumb', () => {
    renderCreate({ courses: COURSES, lives: LIVES });
    const block = document.querySelector('[data-product-lives]') as HTMLElement;
    expect(document.querySelector('[data-product-courses]')?.nextElementSibling).toBe(block);
    expect(block.querySelector('[data-product-lives-none]')?.textContent).toBe('Nenhuma live.');
    expect(
      within(block).getByText(
        'Quem tiver este produto vê o link destas lives. Para os demais, o link fica oculto.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Escolher lives' }));
    const sheet = screen.getByRole('dialog', { name: 'Lives liberadas' });
    expect(
      within(sheet).getByText('Toque para incluir ou tirar. Lives canceladas não aparecem.'),
    ).toBeTruthy();
    // The live sheet draws the wide slot and each row's meta.
    expect(within(sheet).getAllByTestId('course-picker-fallback')[0]?.className).toContain('w-12');
    expect(within(sheet).getByText('qui, 15 de out, 19:00 · Agendada')).toBeTruthy();
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Tira-dúvidas de outubro, não incluída' }),
    );
    expect(
      within(sheet).getByRole('button', { name: 'Tira-dúvidas de outubro, incluída' }),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    const row = document.querySelector(`[data-product-live="${L1}"]`) as HTMLElement;
    expect(within(row).getByText('qui, 15 de out, 19:00 · Agendada')).toBeTruthy();
    expect(row.querySelector('span[aria-hidden]')?.className).toContain('aspect-[16/10]');
    expect(screen.getByRole('button', { name: 'Alterar lives' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover Tira-dúvidas de outubro' }));
    expect(document.querySelector(`[data-product-live="${L1}"]`)).toBeNull();
  });

  it('31. the create body carries both courseIds and liveIds when both blocks are present', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ courses: COURSES, lives: LIVES });
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher lives' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live de abertura, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create).toHaveBeenCalledWith({
      name: 'Mentoria',
      description: '',
      priceCents: 1990,
      imageAssetId: null,
      communityIds: [],
      courseIds: [],
      liveIds: [L2],
    });
    expect(lockPreview).not.toHaveBeenCalled();
  });

  it('32. an edit that changes only the lives sends only liveIds; a price-only edit sends neither key', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit({ initial: EDIT_WITH_LIVE, courses: COURSES, lives: LIVES });
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Alterar lives' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tira-dúvidas de outubro, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(P, { liveIds: [L2, L1] });
    expect(lockPreview).not.toHaveBeenCalled();

    cleanup();
    update.mockClear();
    renderEdit({ initial: EDIT_WITH_LIVE, courses: COURSES, lives: LIVES });
    typePrice('29,90');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(P, { priceCents: 2990 });
  });
});

describe('ProductForm — course and live refusals, degraded lists, focus (08.4, UI-D-419..UI-D-421)', () => {
  const K3 = '88888888-8888-4888-8888-888888888888';
  const THREE = {
    items: [
      ...COURSE_ROWS,
      {
        id: K3,
        title: 'Olhar: do básico ao avançado',
        coverAssetId: null,
        coverVariantWidths: [],
        meta: null,
      },
    ],
    failed: false,
    capped: false,
  };
  const SAVED_THREE = { ...EDIT_INITIAL, courses: THREE.items };

  /** A create with a name and a price, the course K1 and the live L1 picked. */
  function fillCreate() {
    fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
    typePrice('19,90');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher cursos' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Harmonização facial do zero, não incluído' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
  }

  it('33. course_invalid is a role=alert field error under Cursos liberados, no toast; the next toggle clears it', async () => {
    create.mockResolvedValueOnce({ ok: false, code: 'course_invalid' });
    renderCreate({ courses: COURSES, lives: LIVES });
    fillCreate();
    await act(async () => {
      fireEvent.click(submitButton());
    });

    const block = document.querySelector('[data-product-courses]') as HTMLElement;
    const error = block.querySelector('[data-product-courses-error]') as HTMLElement;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('Um dos cursos não está mais disponível. Confira a lista.');
    expect(error.className).toContain('text-danger');
    // Between the open button and the helper.
    expect(error.previousElementSibling?.hasAttribute('data-product-courses-open')).toBe(true);
    expect(toast.show).not.toHaveBeenCalled();
    expect(document.querySelector('[data-product-lives-error]')).toBeNull();
    expect(nameInput().value).toBe('Mentoria');

    fireEvent.click(screen.getByRole('button', { name: 'Remover Harmonização facial do zero' }));
    expect(document.querySelector('[data-product-courses-error]')).toBeNull();
  });

  it('34. too_many_courses and too_many_lives carry the cap of 50 under their own block', async () => {
    renderCreate({ courses: COURSES, lives: LIVES });
    fillCreate();
    create.mockResolvedValueOnce({ ok: false, code: 'too_many_lives' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-product-lives-error]')?.textContent).toBe(
      'Você pode liberar até 50 lives por produto.',
    );
    expect(document.querySelector('[data-product-courses-error]')).toBeNull();

    create.mockResolvedValueOnce({ ok: false, code: 'too_many_courses' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-product-courses-error]')?.textContent).toBe(
      'Você pode liberar até 50 cursos por produto.',
    );

    create.mockResolvedValueOnce({ ok: false, code: 'live_invalid' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-product-lives-error]')?.textContent).toBe(
      'Uma das lives não está mais disponível. Confira a lista.',
    );
    // A live toggle clears only the live error.
    fireEvent.click(screen.getByRole('button', { name: 'Escolher lives' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live de abertura, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(document.querySelector('[data-product-lives-error]')).toBeNull();
    expect(document.querySelector('[data-product-courses-error]')).not.toBeNull();
  });

  it('35. any other refusal keeps the save toast and the draft, with no field error', async () => {
    create.mockResolvedValueOnce({ ok: false, code: 'too_many_communities' });
    renderCreate({ courses: COURSES, lives: LIVES });
    fillCreate();
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(document.querySelector('[data-product-courses-error]')).toBeNull();
    expect(document.querySelector('[data-product-lives-error]')).toBeNull();
    expect(document.querySelector(`[data-product-course="${K1}"]`)).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('36. a failed list read keeps the saved rows and the sheet says it could not load (no action)', () => {
    renderEdit({
      initial: { ...EDIT_INITIAL, courses: [COURSE_ROWS[1]], lives: [LIVE_ROWS[0]] },
      courses: { items: [], failed: true, capped: false },
      lives: { items: [], failed: true, capped: false },
    });
    expect(document.querySelector(`[data-product-course="${K2}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-product-live="${L1}"]`)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Alterar cursos' }));
    let sheet = screen.getByRole('dialog', { name: 'Cursos liberados' });
    let empty = within(sheet).getByTestId('course-picker-empty');
    expect(within(empty).getByText('Não foi possível carregar os cursos')).toBeTruthy();
    expect(within(empty).getByText('Feche o formulário e abra de novo.')).toBeTruthy();
    expect(within(empty).queryByRole('button')).toBeNull();
    expect(within(sheet).queryByText('Nenhum curso ainda')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    fireEvent.click(screen.getByRole('button', { name: 'Alterar lives' }));
    sheet = screen.getByRole('dialog', { name: 'Lives liberadas' });
    empty = within(sheet).getByTestId('course-picker-empty');
    expect(within(empty).getByText('Não foi possível carregar as lives')).toBeTruthy();
    expect(within(empty).getByText('Feche o formulário e abra de novo.')).toBeTruthy();
  });

  it('37. an empty school: Nenhum curso ainda under the cap, Nenhuma live ainda under the radio, no action', () => {
    renderCreate({
      courses: { items: [], failed: false, capped: false },
      lives: { items: [], failed: false, capped: false },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Escolher cursos' }));
    let sheet = screen.getByRole('dialog', { name: 'Cursos liberados' });
    let empty = within(sheet).getByTestId('course-picker-empty');
    expect(within(empty).getByText('Nenhum curso ainda')).toBeTruthy();
    expect(
      within(empty).getByText('Crie um curso em Cursos para liberá-lo por este produto.'),
    ).toBeTruthy();
    expect(empty.querySelector('svg.lucide-graduation-cap')).not.toBeNull();
    expect(within(empty).queryByRole('button')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    fireEvent.click(screen.getByRole('button', { name: 'Escolher lives' }));
    sheet = screen.getByRole('dialog', { name: 'Lives liberadas' });
    empty = within(sheet).getByTestId('course-picker-empty');
    expect(within(empty).getByText('Nenhuma live ainda')).toBeTruthy();
    expect(
      within(empty).getByText('Agende uma live em Cursos para liberá-la por este produto.'),
    ).toBeTruthy();
    expect(empty.querySelector('svg.lucide-radio')).not.toBeNull();
    expect(within(empty).queryByRole('button')).toBeNull();
  });

  it('38. after an X the focus moves to the next row, else the previous one, else Escolher cursos', () => {
    renderEdit({ initial: SAVED_THREE, courses: THREE });
    const removeButton = (title: string) =>
      screen.getByRole('button', { name: `Remover ${title}` });

    // The middle of three: the next row's X.
    fireEvent.click(removeButton('Lábios: técnica e segurança'));
    expect(document.activeElement).toBe(removeButton('Olhar: do básico ao avançado'));

    // The last of two: the previous row's X.
    fireEvent.click(removeButton('Olhar: do básico ao avançado'));
    expect(document.activeElement).toBe(removeButton('Harmonização facial do zero'));

    // The only one: the open button.
    fireEvent.click(removeButton('Harmonização facial do zero'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Escolher cursos' }));
  });

  it('39. a dirty close after changing only the lives opens Descartar produto?', () => {
    renderEdit({ courses: COURSES, lives: LIVES });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(push).toHaveBeenCalledWith(`/loja/${P}`);
    push.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Escolher lives' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live de abertura, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('dialog', { name: 'Descartar produto?' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('40. a course-only addition never asks the lock preview and never renders a dialog (PR-3)', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit({ courses: COURSES, lives: LIVES });
    fireEvent.click(screen.getByRole('button', { name: 'Escolher cursos' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Lábios: técnica e segurança, não incluído' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(lockPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).toHaveBeenCalledWith(P, { courseIds: [K2] });
  });

  it('41. while the save runs (Salvando…) the three blocks are inert', async () => {
    let resolve: (value: unknown) => void = () => {};
    update.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderEdit({
      initial: { ...EDIT_INITIAL, courses: [COURSE_ROWS[1]] },
      courses: COURSES,
      lives: LIVES,
    });
    typePrice('29,90');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(submitButton().textContent).toContain('Salvando…');
    for (const name of [
      'Alterar comunidades',
      'Remover Mentoria ao vivo',
      'Alterar cursos',
      'Remover Lábios: técnica e segurança',
      'Escolher lives',
    ]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(true);
    }
    await act(async () => {
      resolve({ ok: true, productId: P });
    });
  });
});

/* ── 09.1-17: the Pagamento block (D-502, D-508, UI-D-524, A-P12) ────────────────────────────── */

const GATEWAY = 'Pagamentos Exemplo';
const PAYMENT = { gatewayName: GATEWAY, connected: true, externalProductId: '', checkoutUrl: '' };
const MAPPED = {
  ...PAYMENT,
  externalProductId: 'a1b2',
  checkoutUrl: 'https://pay.example/a1b2',
};
const WARNING = 'Sem link de pagamento. Os membros não conseguem comprar este produto.';
const gatewayInput = () => document.getElementById('product-gateway-id') as HTMLInputElement;
const linkInput = () => document.getElementById('product-checkout-url') as HTMLInputElement;
const typeId = (value: string) => fireEvent.change(gatewayInput(), { target: { value } });
const typeLink = (value: string) => fireEvent.change(linkInput(), { target: { value } });

function fillValidCreate() {
  fireEvent.change(nameInput(), { target: { value: 'Mentoria' } });
  typePrice('19,90');
}

async function save() {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

describe('ProductForm — the Pagamento block (UI-D-524, D-502)', () => {
  it('P1. payment null: no node in the DOM, nothing sent, the shipped flow unchanged', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ payment: null });
    expect(gatewayInput()).toBeNull();
    expect(linkInput()).toBeNull();
    expect(screen.queryByText('Pagamento')).toBeNull();
    fillValidCreate();
    await save();
    expect(create).toHaveBeenCalledTimes(1);
    expect(saveMapping).not.toHaveBeenCalled();
  });

  it('P2. with a payment prop the block sits after the price and before Comunidades liberadas', () => {
    renderCreate({ payment: PAYMENT });
    const block = document.querySelector('[data-product-payment]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('Pagamento');
    const price = priceInput();
    const communities = document.querySelector('[data-product-communities]') as HTMLElement;
    expect(price.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      block.compareDocumentPosition(communities) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('P3. the labels, helpers, ids and input traits', () => {
    renderCreate({ payment: PAYMENT });
    expect(screen.getByLabelText(`ID do produto no ${GATEWAY}`)).toBe(gatewayInput());
    expect(screen.getByLabelText('Link de compra')).toBe(linkInput());
    expect(
      screen.getByText(`Copie o ID no painel do ${GATEWAY}. É por ele que reconhecemos a compra.`),
    ).toBeTruthy();
    expect(screen.getByText('O botão Comprar abre este link.')).toBeTruthy();
    expect(linkInput().type).toBe('url');
    expect(linkInput().placeholder).toBe('https://');
    expect(gatewayInput().className).toContain('tabular-nums');
    expect(gatewayInput().getAttribute('autocapitalize')).toBe('none');
  });

  it('P4. connected with the link empty shows the warning row; typing a link hides it', () => {
    renderCreate({ payment: PAYMENT });
    expect(screen.getByText(WARNING)).toBeTruthy();
    typeLink('https://pay.example/x');
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('P5. not connected: the neutral note with the Abrir Pagamentos link, no warning', () => {
    renderCreate({ payment: { ...PAYMENT, connected: false } });
    expect(screen.queryByText(WARNING)).toBeNull();
    const link = screen.getByRole('link', { name: 'Abrir Pagamentos' });
    expect(link.getAttribute('href')).toBe('/configuracoes/pagamentos');
    expect(
      screen.getByText(/Conecte a integração em Pagamentos para receber as compras\./),
    ).toBeTruthy();
  });

  it('P6. both fields empty is a valid unpaid draft: one create, no mapping call', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    await save();
    expect(create).toHaveBeenCalledTimes(1);
    expect(saveMapping).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(`/loja/${P}`);
    // The warning stays: an unpaid draft cannot be bought.
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it('P7. an ID without a link saves and maps (the warning shows)', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeId('a1b2');
    expect(screen.getByText(WARNING)).toBeTruthy();
    await save();
    expect(create).toHaveBeenCalledTimes(1);
    expect(saveMapping).toHaveBeenCalledWith(P, { externalProductId: 'a1b2', checkoutUrl: '' });
    expect(replace).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('P8. a link without an ID is refused BEFORE any request; the error clears on the next ID edit', async () => {
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeLink('https://pay.example/x');
    await save();
    expect(create).not.toHaveBeenCalled();
    expect(saveMapping).not.toHaveBeenCalled();
    const error = document.getElementById('product-gateway-id-error');
    expect(error?.textContent).toBe('Informe o ID do produto para usar o link de compra.');
    expect(error?.getAttribute('role')).toBe('alert');
    typeId('a');
    expect(document.getElementById('product-gateway-id-error')).toBeNull();
  });

  it('P9. a link without https:// shows the link error; the next edit of the link clears it', async () => {
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeId('a1b2');
    typeLink('http://pay.example/x');
    await save();
    expect(create).not.toHaveBeenCalled();
    expect(document.getElementById('product-checkout-url-error')?.textContent).toBe(
      'Informe um link que comece com https://.',
    );
    typeLink('https://pay.example/x');
    expect(document.getElementById('product-checkout-url-error')).toBeNull();
  });

  it('P10. create then map, in that order, with the new id', async () => {
    const order: string[] = [];
    create.mockImplementation(async () => {
      order.push('create');
      return { ok: true, productId: P };
    });
    saveMapping.mockImplementation(async () => {
      order.push('map');
      return { ok: true };
    });
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeId(' a1b2 ');
    typeLink('https://pay.example/a1b2');
    await save();
    expect(order).toEqual(['create', 'map']);
    expect(saveMapping).toHaveBeenCalledWith(P, {
      externalProductId: 'a1b2',
      checkoutUrl: 'https://pay.example/a1b2',
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Produto criado.' });
    expect(replace).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('P11. a mapping refused after the create keeps the product, shows the error, and the next Salvar updates and retries only the mapping', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    update.mockResolvedValue({ ok: true, productId: P });
    saveMapping.mockResolvedValueOnce({ ok: false, issue: 'id_taken' });
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeId('a1b2');
    typeLink('https://pay.example/a1b2');
    await save();

    expect(create).toHaveBeenCalledTimes(1);
    expect(document.getElementById('product-gateway-id-error')?.textContent).toBe(
      `Este ID já está em uso. Confira o ID no ${GATEWAY}.`,
    );
    expect(replace).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    // The typed values stay.
    expect(gatewayInput().value).toBe('a1b2');
    expect(linkInput().value).toBe('https://pay.example/a1b2');

    typeId('a1b3');
    expect(document.getElementById('product-gateway-id-error')).toBeNull();
    await save();

    // A create is NEVER repeated: the created id takes the full body through the update.
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(P, {
      name: 'Mentoria',
      description: '',
      priceCents: 1990,
      imageAssetId: null,
      communityIds: [],
    });
    expect(saveMapping).toHaveBeenCalledTimes(2);
    expect(saveMapping).toHaveBeenLastCalledWith(P, {
      externalProductId: 'a1b3',
      checkoutUrl: 'https://pay.example/a1b2',
    });
    expect(replace).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('P12. a generic mapping failure toasts the shipped save line, keeps the values and does not navigate', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    saveMapping.mockResolvedValue({ ok: false, issue: 'generic' });
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeId('a1b2');
    await save();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(gatewayInput().value).toBe('a1b2');
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('P13. a thrown mapping action is the same toast, and a link_invalid answer lands under the link', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    saveMapping.mockRejectedValueOnce(new Error('boom'));
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    typeId('a1b2');
    await save();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    saveMapping.mockResolvedValueOnce({ ok: false, issue: 'link_invalid' });
    update.mockResolvedValue({ ok: true, productId: P });
    await save();
    expect(document.getElementById('product-checkout-url-error')?.textContent).toBe(
      'Informe um link que comece com https://.',
    );
  });

  it('P14. edit opens clean with the saved mapping; no mapping call when neither field changed', async () => {
    update.mockResolvedValue({ ok: true, productId: P });
    renderEdit({ payment: MAPPED });
    expect(gatewayInput().value).toBe('a1b2');
    expect(linkInput().value).toBe('https://pay.example/a1b2');
    expect(submitButton().disabled).toBe(true);
    typePrice('29,90');
    await save();
    expect(update).toHaveBeenCalledWith(P, { priceCents: 2990 });
    expect(saveMapping).not.toHaveBeenCalled();
  });

  it('P15. editing only a payment field enables the save, skips the (empty) store patch and maps', async () => {
    renderEdit({ payment: MAPPED });
    typeLink('https://pay.example/novo');
    expect(submitButton().disabled).toBe(false);
    await save();
    expect(update).not.toHaveBeenCalled();
    expect(saveMapping).toHaveBeenCalledWith(P, {
      externalProductId: 'a1b2',
      checkoutUrl: 'https://pay.example/novo',
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' });
    expect(push).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('P16. a price change and a payment change are two ordered calls on an edit', async () => {
    const order: string[] = [];
    update.mockImplementation(async () => {
      order.push('update');
      return { ok: true, productId: P };
    });
    saveMapping.mockImplementation(async () => {
      order.push('map');
      return { ok: true };
    });
    renderEdit({ payment: MAPPED });
    typePrice('29,90');
    typeId('zz9');
    await save();
    expect(order).toEqual(['update', 'map']);
    expect(update).toHaveBeenCalledWith(P, { priceCents: 2990 });
  });

  it('P17. clearing both fields of a saved mapping sends the empty pair (the action deletes)', async () => {
    renderEdit({ payment: MAPPED });
    typeId('');
    typeLink('');
    await save();
    expect(saveMapping).toHaveBeenCalledWith(P, { externalProductId: '', checkoutUrl: '' });
  });

  it('P18. an edit whose mapping is refused as taken keeps the form on the page', async () => {
    saveMapping.mockResolvedValue({ ok: false, issue: 'id_taken' });
    renderEdit({ payment: MAPPED });
    typeId('outro');
    await save();
    expect(document.getElementById('product-gateway-id-error')?.textContent).toBe(
      `Este ID já está em uso. Confira o ID no ${GATEWAY}.`,
    );
    expect(push).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('P19. after the create, a retry never asks the lock preview again (the links are already saved)', async () => {
    create.mockResolvedValue({ ok: true, productId: P });
    update.mockResolvedValue({ ok: true, productId: P });
    lockPreview.mockResolvedValue({
      ok: true,
      items: [{ communityId: C1, membersLosingAccess: 0 }],
    });
    saveMapping.mockResolvedValueOnce({ ok: false, issue: 'id_taken' });
    renderCreate({ payment: PAYMENT });
    fillValidCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Escolher comunidades' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mentoria ao vivo, não incluída' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    typeId('a1b2');
    await save();
    // The first save asked the preview and showed its dialog.
    const dialog = screen.getByRole('dialog', { name: /exclusiva/ });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Tornar exclusiva/ }));
    });
    await waitFor(() => expect(saveMapping).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(lockPreview).toHaveBeenCalledTimes(1);

    typeId('a1b3');
    await save();
    expect(lockPreview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('P20. E11 long text: a 300-character link stays in its shrinking field and the helper and error lines render', async () => {
    const long = `https://pay.example/${'x'.repeat(280)}`;
    expect(long.length).toBe(300);
    renderEdit({ payment: { ...MAPPED, checkoutUrl: long } });
    expect(linkInput().value).toBe(long);
    expect(linkInput().className).toContain('min-w-0');
    expect(linkInput().className).toContain('w-full');
    expect(screen.getByText('O botão Comprar abre este link.')).toBeTruthy();

    typeLink(`http://pay.example/${'y'.repeat(280)}`);
    await save();
    expect(document.getElementById('product-checkout-url-error')?.textContent).toBe(
      'Informe um link que comece com https://.',
    );
    expect(screen.getByText('O botão Comprar abre este link.')).toBeTruthy();
  });

  it('P21. the two fields cap their length at the contract (128 and 2048)', () => {
    renderCreate({ payment: PAYMENT });
    expect(gatewayInput().maxLength).toBe(128);
    expect(linkInput().maxLength).toBe(2048);
  });
});
