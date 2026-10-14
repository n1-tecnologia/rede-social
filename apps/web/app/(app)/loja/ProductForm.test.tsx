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
