// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.3-07 — the category manager and its sheet (UI-D-400, UI-D-404, UI-D-407, D-411), against the
 * REAL merged pt-BR catalogs through next-intl's `createTranslator` (the ICU count included).
 * Stubbed: the server actions, the toast and the upload hook. Real: the island, the sheet, the
 * shipped `BottomSheet`, `ConfirmDialog` and inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, create, update, remove } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
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

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./category-actions', () => ({
  createCategoryAction: create,
  updateCategoryAction: update,
  deleteCategoryAction: remove,
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

const { CategoryManager } = await import('./CategoryManager');

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';
const C4 = '44444444-4444-4444-8444-444444444444';

const ITEMS = [
  { id: C1, name: 'Biossegurança', coverAssetId: null, courseCount: 1 },
  { id: C2, name: 'Lábios', coverAssetId: null, courseCount: 2 },
  { id: C3, name: 'Olhar', coverAssetId: null, courseCount: 0 },
];

const nameInput = () => document.getElementById('category-name') as HTMLInputElement;
const sheetSubmit = () =>
  document.querySelector('[data-category-sheet] button[type="submit"]') as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('CategoryManager (UI-D-400)', () => {
  it('1. renders the header, the rows as buttons with the ICU count at 0 / 1 / many, and the chevron', () => {
    render(<CategoryManager initialItems={ITEMS} />);

    expect(screen.getByRole('heading', { name: 'Categorias' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar' }).getAttribute('href')).toBe('/cursos');
    expect(screen.getByRole('button', { name: 'Nova categoria' })).toBeTruthy();

    const list = screen.getByRole('list', { name: 'Categorias' });
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Biossegurança');
    expect(rows[0]?.textContent).toContain('1 curso');
    expect(rows[1]?.textContent).toContain('Lábios');
    expect(rows[1]?.textContent).toContain('2 cursos');
    expect(rows[2]?.textContent).toContain('Olhar');
    expect(rows[2]?.textContent).toContain('Nenhum curso');
    expect(document.querySelectorAll('[data-testid="category-row-fallback"]')).toHaveLength(3);
    expect(document.querySelector('[data-testid="category-row-fallback"]')?.className).toContain(
      'aspect-[3/4]',
    );
    expect(screen.queryByTestId('categories-empty')).toBeNull();
  });

  it('2. with no category the EmptyState offers Criar categoria, which opens the new sheet focused on the name', async () => {
    render(<CategoryManager initialItems={[]} />);
    const empty = screen.getByTestId('categories-empty');
    expect(within(empty).getByRole('heading', { name: 'Nenhuma categoria' })).toBeTruthy();
    expect(empty.textContent).toContain('Categorias organizam o catálogo. Elas são opcionais.');

    fireEvent.click(within(empty).getByRole('button', { name: 'Criar categoria' }));
    const sheet = screen.getByRole('dialog', { name: 'Nova categoria' });
    expect(
      within(sheet).getByText('Opcional. Aparece no catálogo como a arte da categoria.'),
    ).toBeTruthy();
    expect(nameInput().maxLength).toBe(60);
    expect(nameInput().getAttribute('placeholder')).toBe('Ex.: Lábios');
    expect(sheetSubmit().textContent).toContain('Criar categoria');
    expect(sheetSubmit().disabled).toBe(true);
    expect(document.querySelector('[data-category-remove]')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(nameInput()));
  });

  it('3. a row opens the edit sheet filled; the remove row is DISABLED with the in-use helper when courseCount is 2', () => {
    render(<CategoryManager initialItems={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /^Lábios/ }));

    const sheet = screen.getByRole('dialog', { name: 'Editar categoria' });
    expect(nameInput().value).toBe('Lábios');
    expect(sheetSubmit().textContent).toContain('Salvar alterações');
    expect(sheetSubmit().disabled).toBe(true);

    const removeRow = within(sheet).getByRole('button', { name: 'Remover categoria' });
    expect(removeRow.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('[data-category-remove-helper]')?.textContent).toBe(
      'Esta categoria tem 2 cursos. Mude a categoria deles antes de remover.',
    );
  });

  it('4. an empty category: remove is enabled, the danger dialog confirms, the row leaves and the toast fires; a stale count toasts the in-use sentence', async () => {
    remove.mockResolvedValueOnce({ ok: false, code: 'category_in_use', courseCount: 3 });
    render(<CategoryManager initialItems={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /^Olhar/ }));

    const removeRow = screen.getByRole('button', { name: 'Remover categoria' });
    expect(removeRow.hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('[data-category-remove-helper]')).toBeNull();

    fireEvent.click(removeRow);
    let dialog = screen.getByRole('dialog', { name: 'Remover categoria?' });
    expect(dialog.textContent).toContain('Ela some da lista. Nenhum curso é alterado.');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    });
    await waitFor(() => expect(remove).toHaveBeenCalledWith(C3));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Esta categoria tem 3 cursos. Mude a categoria deles antes de remover.',
    });
    // The sheet stays, the row stays.
    expect(screen.getByRole('dialog', { name: 'Editar categoria' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Olhar/ })).toBeTruthy();

    remove.mockResolvedValueOnce({ ok: true, category: null });
    fireEvent.click(screen.getByRole('button', { name: 'Remover categoria' }));
    dialog = screen.getByRole('dialog', { name: 'Remover categoria?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Olhar/ })).toBeNull());
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Categoria removida.' });
    expect(
      within(screen.getByRole('list', { name: 'Categorias' })).getAllByRole('button'),
    ).toHaveLength(2);
  });

  it('5. removing the LAST category shows the empty state and moves focus to Nova categoria', async () => {
    remove.mockResolvedValue({ ok: true, category: null });
    render(<CategoryManager initialItems={[ITEMS[2] as (typeof ITEMS)[number]]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Olhar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover categoria' }));
    const dialog = screen.getByRole('dialog', { name: 'Remover categoria?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    });
    await waitFor(() => expect(screen.getByTestId('categories-empty')).toBeTruthy());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nova categoria' })),
    );
  });

  it('6. removing a middle row moves focus to the next row', async () => {
    remove.mockResolvedValue({ ok: true, category: null });
    render(<CategoryManager initialItems={ITEMS.map((item) => ({ ...item, courseCount: 0 }))} />);
    fireEvent.click(screen.getByRole('button', { name: /^Lábios/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover categoria' }));
    const dialog = screen.getByRole('dialog', { name: 'Remover categoria?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Lábios/ })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(`[data-category-row="${C3}"]`) as HTMLElement,
      ),
    );
  });

  it('7. creating: an empty name shows the field error; category_exists shows the name error; a success inserts the row in name order and toasts', async () => {
    render(<CategoryManager initialItems={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nova categoria' }));
    screen.getByRole('dialog', { name: 'Nova categoria' });

    fireEvent.focus(nameInput());
    fireEvent.blur(nameInput());
    expect(document.getElementById('category-name-error')?.textContent).toBe(
      'Dê um nome à categoria.',
    );
    expect(sheetSubmit().disabled).toBe(true);

    fireEvent.change(nameInput(), { target: { value: 'lábios' } });
    expect(document.getElementById('category-name-error')).toBeNull();
    create.mockResolvedValueOnce({ ok: false, code: 'category_exists' });
    await act(async () => {
      fireEvent.click(sheetSubmit());
    });
    expect(create).toHaveBeenCalledWith({ name: 'lábios', coverAssetId: null });
    expect(document.getElementById('category-name-error')?.textContent).toBe(
      'Já existe uma categoria com este nome.',
    );
    expect(toast.show).not.toHaveBeenCalled();

    fireEvent.change(nameInput(), { target: { value: 'Mandíbula' } });
    create.mockResolvedValueOnce({
      ok: true,
      category: { id: C4, name: 'Mandíbula', coverAssetId: null, courseCount: 0 },
    });
    await act(async () => {
      fireEvent.click(sheetSubmit());
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Categoria criada.' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nova categoria' })).toBeNull(),
    );
    const rows = within(screen.getByRole('list', { name: 'Categorias' })).getAllByRole('button');
    expect(rows.map((row) => row.textContent?.split(/Nenhum curso|\d+ cursos?/)[0])).toEqual([
      'Biossegurança',
      'Lábios',
      'Mandíbula',
      'Olhar',
    ]);
  });

  it('8. editing a name sends ONLY the name, replaces the row and toasts Alterações salvas.', async () => {
    update.mockResolvedValue({
      ok: true,
      category: { id: C3, name: 'Olhos', coverAssetId: null, courseCount: 0 },
    });
    render(<CategoryManager initialItems={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /^Olhar/ }));
    fireEvent.change(nameInput(), { target: { value: 'Olhos' } });
    expect(sheetSubmit().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(sheetSubmit());
    });
    expect(update).toHaveBeenCalledWith(C3, { name: 'Olhos' });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Olhos/ })).toBeTruthy());
  });

  it('9. a dirty close asks Descartar categoria?; a save failure toasts and keeps the sheet', async () => {
    create.mockResolvedValueOnce({ ok: false, code: 'generic' });
    render(<CategoryManager initialItems={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nova categoria' }));
    fireEvent.change(nameInput(), { target: { value: 'Pele' } });

    await act(async () => {
      fireEvent.click(sheetSubmit());
    });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(screen.getByRole('dialog', { name: 'Nova categoria' })).toBeTruthy();
    expect(nameInput().value).toBe('Pele');

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Nova categoria' }), { key: 'Escape' });
    const discard = screen.getByRole('dialog', { name: 'Descartar categoria?' });
    expect(discard.textContent).toContain('As informações preenchidas serão perdidas.');
    fireEvent.click(within(discard).getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Descartar categoria?' })).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: 'Nova categoria' })).toBeTruthy();
  });
});
