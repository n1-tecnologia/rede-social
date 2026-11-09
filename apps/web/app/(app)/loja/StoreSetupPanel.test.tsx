// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.3-13 (D-690, D-691, UI-D-685 to UI-D-688): Gerenciar's two setup sheets save to the API. Against
 * the REAL pt-BR catalog; the two server actions are stubs. Claims:
 *
 *  - Save sends the ordered ids / the whole ordered list (a kept row with its slug, a new row none);
 *  - while the call is in flight Save reads "Salvando…" and is disabled and the sheet cannot be closed
 *    (Cancelar disabled, Escape and the backdrop do nothing);
 *  - success closes the sheet, shows the toast and refreshes the route;
 *  - a refusal keeps the sheet and the draft and draws ONE `role=alert` line above Save;
 *  - a stale answer (`featured_invalid`, `category_invalid`) refreshes and re-seeds the draft from the
 *    refreshed list;
 *  - "Restaurar as categorias padrão" only replaces the draft; nothing is sent until Save.
 */

const { push, refresh, toast, setFeatured, saveCategories } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { show: vi.fn() },
  setFeatured: vi.fn(),
  saveCategories: vi.fn(),
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
vi.mock('./actions', () => ({
  setStoreFeaturedAction: setFeatured,
  saveStoreCategoriesAction: saveCategories,
}));

const { StoreSetupPanel } = await import('./StoreSetupPanel');

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const PRODUCTS = [
  { id: P1, name: 'Mentoria', price: 'R$ 100,00', thumb: null },
  { id: P2, name: 'Jaleco', price: 'R$ 50,00', thumb: null },
  { id: P3, name: 'Perfume', price: 'R$ 30,00', thumb: null },
];
const CATS = [
  { id: 'livros', name: 'Livros', icon: 'book-open' as const },
  { id: 'roupas', name: 'Roupas', icon: 'shirt' as const },
];
const COUNTS = { livros: 2, roupas: 1 };

function panel(over: Partial<Parameters<typeof StoreSetupPanel>[0]> = {}) {
  return (
    <StoreSetupPanel
      products={PRODUCTS}
      categories={CATS}
      counts={COUNTS}
      featured={[P1]}
      {...over}
    />
  );
}

/** A promise the test settles by hand, to hold a save "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sheet = () => screen.queryByRole('dialog');
const saveButton = (testId: string) => screen.getByTestId(testId) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('the two cards', () => {
  it('say who sees them, and no longer say "só neste aparelho"', () => {
    render(panel());
    expect(screen.getByText('Todos os membros veem esta ordem na vitrine.')).toBeTruthy();
    expect(screen.getByText('Todos os membros veem estas categorias na vitrine.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('neste aparelho');
  });

  it('draw the store own rows as chips with their count, and the ordered featured thumbs', () => {
    render(panel());
    const chips = screen.getByRole('list', { name: 'Categorias' });
    expect(chips.textContent).toContain('Livros');
    expect(chips.textContent).toContain('2 produtos');
    expect(chips.textContent).toContain('1 produto');
    expect(screen.getByText('Principal')).toBeTruthy();
  });

  it('no category: the shipped "Nenhuma categoria" with "Gerenciar", and the sheet lets the admin add', () => {
    render(panel({ categories: [], counts: {}, featured: [] }));
    expect(screen.getByText('Nenhuma categoria')).toBeTruthy();
    expect(screen.getByText('Automático: os produtos mais recentes.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('store-setup-categories-edit'));
    expect(document.querySelectorAll('[data-category-row]')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Nova categoria'), { target: { value: 'Skincare' } });
    fireEvent.click(screen.getByTestId('store-setup-category-add'));
    expect(document.querySelectorAll('[data-category-row]')).toHaveLength(1);
  });
});

describe('"Em destaque"', () => {
  const open = () => fireEvent.click(screen.getByTestId('store-setup-featured-edit'));
  const pick = (id: string) =>
    fireEvent.click(document.querySelector(`[data-featured-option="${id}"]`) as Element);

  it('Save sends the ids in the order they were tapped', async () => {
    setFeatured.mockResolvedValue({ ok: true });
    render(panel({ featured: [] }));
    open();
    pick(P2);
    pick(P1);
    await act(async () => {
      fireEvent.click(saveButton('store-setup-featured-save'));
    });
    expect(setFeatured).toHaveBeenCalledWith([P2, P1]);
  });

  it('"Usar os mais recentes" sends an empty list', async () => {
    setFeatured.mockResolvedValue({ ok: true });
    render(panel());
    open();
    fireEvent.click(screen.getByText('Usar os mais recentes'));
    await act(async () => {
      fireEvent.click(saveButton('store-setup-featured-save'));
    });
    expect(setFeatured).toHaveBeenCalledWith([]);
  });

  it('pending: "Salvando…", Save disabled, the sheet cannot be closed; then success closes, toasts and refreshes', async () => {
    const call = deferred<{ ok: true }>();
    setFeatured.mockReturnValue(call.promise);
    render(panel());
    open();
    await act(async () => {
      fireEvent.click(saveButton('store-setup-featured-save'));
    });
    const save = saveButton('store-setup-featured-save');
    expect(save.textContent).toContain('Salvando…');
    expect(save.disabled).toBe(true);
    expect((screen.getByText('Cancelar') as HTMLButtonElement).closest('button')?.disabled).toBe(
      true,
    );
    // Escape and the backdrop do nothing while the call is in flight.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sheet()).not.toBeNull();
    await act(async () => {
      call.resolve({ ok: true });
    });
    await waitFor(() => expect(sheet()).toBeNull());
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Destaque salvo.' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a refusal keeps the sheet and the draft, with one alert line above Save', async () => {
    setFeatured.mockResolvedValue({ ok: false, code: 'too_many_featured' });
    render(panel({ featured: [P1] }));
    open();
    pick(P2);
    await act(async () => {
      fireEvent.click(saveButton('store-setup-featured-save'));
    });
    expect(sheet()).not.toBeNull();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe('O destaque aceita até 5 produtos.');
    expect(
      document.querySelector(`[data-featured-option="${P2}"]`)?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(saveButton('store-setup-featured-save').disabled).toBe(false);
    expect(toast.show).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('an unknown code or a thrown call shows the editor generic sentence', async () => {
    setFeatured.mockRejectedValue(new Error('network'));
    render(panel());
    open();
    await act(async () => {
      fireEvent.click(saveButton('store-setup-featured-save'));
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Não foi possível salvar o destaque. Tente de novo.',
    );
  });

  it('a stale answer refreshes and re-seeds the draft from the refreshed list', async () => {
    setFeatured.mockResolvedValue({ ok: false, code: 'featured_invalid' });
    const { rerender } = render(panel({ featured: [P1] }));
    open();
    pick(P2);
    await act(async () => {
      fireEvent.click(saveButton('store-setup-featured-save'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(
      'Um dos produtos não está mais à venda. Atualizamos a lista; escolha de novo.',
    );
    // The page re-reads: P1 is gone from the store, P3 is the saved one now.
    rerender(panel({ products: [PRODUCTS[1], PRODUCTS[2]] as never, featured: [P3] }));
    const pressed = [...document.querySelectorAll('[data-featured-option]')]
      .filter((node) => node.getAttribute('aria-pressed') === 'true')
      .map((node) => node.getAttribute('data-featured-option'));
    expect(pressed).toEqual([P3]);
    // The line stays: the admin must know why the list changed.
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('opens on what is saved every time; a cancelled edit leaves nothing behind', () => {
    render(panel({ featured: [P1] }));
    open();
    pick(P2);
    fireEvent.click(screen.getByText('Cancelar'));
    open();
    const pressed = [...document.querySelectorAll('[data-featured-option]')]
      .filter((node) => node.getAttribute('aria-pressed') === 'true')
      .map((node) => node.getAttribute('data-featured-option'));
    expect(pressed).toEqual([P1]);
  });
});

describe('"Categorias"', () => {
  const open = () => fireEvent.click(screen.getByTestId('store-setup-categories-edit'));
  const rows = () => [...document.querySelectorAll('[data-category-row]')];
  const names = () => rows().map((row) => (row.querySelector('input') as HTMLInputElement).value);
  const add = (name: string) => {
    fireEvent.change(screen.getByLabelText('Nova categoria'), { target: { value: name } });
    fireEvent.click(screen.getByTestId('store-setup-category-add'));
  };

  it('Save sends the whole ordered list: a kept row with its slug, a new row with none', async () => {
    saveCategories.mockResolvedValue({ ok: true });
    render(panel());
    open();
    add('Skincare');
    await act(async () => {
      fireEvent.click(saveButton('store-setup-categories-save'));
    });
    expect(saveCategories).toHaveBeenCalledWith([
      { id: 'livros', name: 'Livros', icon: 'book-open' },
      { id: 'roupas', name: 'Roupas', icon: 'shirt' },
      { name: 'Skincare', icon: 'tag' },
    ]);
  });

  it('a rename keeps the slug; moving a row changes the order sent', async () => {
    saveCategories.mockResolvedValue({ ok: true });
    render(panel());
    open();
    fireEvent.change(rows()[0]?.querySelector('input') as HTMLInputElement, {
      target: { value: 'Livros e e-books' },
    });
    fireEvent.click(screen.getByLabelText('Mover para baixo: Livros e e-books'));
    await act(async () => {
      fireEvent.click(saveButton('store-setup-categories-save'));
    });
    expect(saveCategories).toHaveBeenCalledWith([
      { id: 'roupas', name: 'Roupas', icon: 'shirt' },
      { id: 'livros', name: 'Livros e e-books', icon: 'book-open' },
    ]);
  });

  it('the rules come from the contract: 20 categories at most, 30 characters per name', () => {
    render(panel({ categories: [], counts: {} }));
    open();
    for (let n = 1; n <= 20; n += 1) add(`Cat ${n}`);
    expect(rows()).toHaveLength(20);
    add('A vigésima primeira');
    expect(rows()).toHaveLength(20);
    expect(screen.getByRole('alert').textContent).toBe('A loja pode ter até 20 categorias.');
    expect((screen.getByLabelText('Nova categoria') as HTMLInputElement).maxLength).toBe(30);
  });

  it('removing keeps the shipped confirm sentence and Save drops the row', async () => {
    saveCategories.mockResolvedValue({ ok: true });
    render(panel());
    open();
    fireEvent.click(screen.getByLabelText('Excluir Livros'));
    expect(screen.getByText('Excluir Livros? Os produtos dela ficam sem categoria.')).toBeTruthy();
    fireEvent.click(screen.getByText('Excluir', { selector: 'button' }));
    await act(async () => {
      fireEvent.click(saveButton('store-setup-categories-save'));
    });
    expect(saveCategories).toHaveBeenCalledWith([{ id: 'roupas', name: 'Roupas', icon: 'shirt' }]);
  });

  it('"Restaurar as categorias padrão" only replaces the draft with the eight; nothing is sent', async () => {
    render(panel());
    open();
    fireEvent.click(screen.getByText('Restaurar as categorias padrão'));
    expect(names()).toEqual([
      'Cursos',
      'Livros',
      'Materiais',
      'Roupas',
      'Perfumes',
      'Equipamentos',
      'Serviços',
      'Outros',
    ]);
    expect(saveCategories).not.toHaveBeenCalled();
    // Cancelling leaves the store's own list as it was.
    fireEvent.click(screen.getByText('Cancelar'));
    open();
    expect(names()).toEqual(['Livros', 'Roupas']);
  });

  it('a restored draft commits with Save: the slugs the store holds keep their id, the others are new rows', async () => {
    saveCategories.mockResolvedValue({ ok: true });
    render(panel());
    open();
    fireEvent.click(screen.getByText('Restaurar as categorias padrão'));
    await act(async () => {
      fireEvent.click(saveButton('store-setup-categories-save'));
    });
    const sent = saveCategories.mock.calls[0]?.[0] as { id?: string; name: string }[];
    expect(sent.map((row) => row.name)).toHaveLength(8);
    // The server refuses an unknown id: only the two the store holds carry one.
    expect(sent.filter((row) => row.id !== undefined).map((row) => row.id)).toEqual([
      'livros',
      'roupas',
    ]);
  });

  it('pending: "Salvando…", Save disabled, the sheet cannot be closed; then success toasts and refreshes', async () => {
    const call = deferred<{ ok: true }>();
    saveCategories.mockReturnValue(call.promise);
    render(panel());
    open();
    await act(async () => {
      fireEvent.click(saveButton('store-setup-categories-save'));
    });
    const save = saveButton('store-setup-categories-save');
    expect(save.textContent).toContain('Salvando…');
    expect(save.disabled).toBe(true);
    expect(screen.getByText('Cancelar').closest('button')?.disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sheet()).not.toBeNull();
    await act(async () => {
      call.resolve({ ok: true });
    });
    await waitFor(() => expect(sheet()).toBeNull());
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Categorias salvas.' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('each refusal shows its coded sentence in one alert line and keeps the draft', async () => {
    const sentences: Record<string, string> = {
      category_name_required: 'Dê um nome a cada categoria.',
      category_name_taken: 'Já existe uma categoria com esse nome.',
      too_many_categories: 'A loja pode ter até 20 categorias.',
      category_name_too_long: 'Use até 30 caracteres no nome.',
      category_icon_invalid: 'Escolha um dos ícones da lista.',
      generic: 'Não foi possível salvar as categorias. Tente de novo.',
    };
    for (const [code, sentence] of Object.entries(sentences)) {
      cleanup();
      saveCategories.mockResolvedValue({ ok: false, code });
      render(panel());
      open();
      add('Skincare');
      await act(async () => {
        fireEvent.click(saveButton('store-setup-categories-save'));
      });
      expect(sheet(), code).not.toBeNull();
      expect(
        screen.getAllByRole('alert').map((node) => node.textContent),
        code,
      ).toEqual([sentence]);
      expect(names(), code).toEqual(['Livros', 'Roupas', 'Skincare']);
    }
  });

  it('a stale answer refreshes and re-seeds the draft from the refreshed list', async () => {
    saveCategories.mockResolvedValue({ ok: false, code: 'category_invalid' });
    const { rerender } = render(panel());
    open();
    add('Skincare');
    await act(async () => {
      fireEvent.click(saveButton('store-setup-categories-save'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(
      'As categorias mudaram enquanto você editava. Atualizamos a lista; confira e tente de novo.',
    );
    // Another admin deleted "Roupas" and made "Acessórios" meanwhile.
    rerender(
      panel({
        categories: [
          { id: 'livros', name: 'Livros', icon: 'book-open' },
          { id: 'acessorios', name: 'Acessórios', icon: 'gem' },
        ],
        counts: {},
      }),
    );
    expect(names()).toEqual(['Livros', 'Acessórios']);
  });
});
