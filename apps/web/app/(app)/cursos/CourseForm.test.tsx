// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.3-07 — the course form (UI-D-393, D-404, D-405, D-412), against the REAL merged pt-BR catalogs
 * through next-intl's own `createTranslator`, so a copy drift fails here. Stubbed: the server
 * actions, the router, the toast and the upload hook. Real: the form, the courses contracts, the
 * module's `CategoryPickerSheet`, the app's `ProductPickerSheet`, `ConfirmDialog` and the inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, push, refresh, create, update, setStatus } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setStatus: vi.fn(),
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

vi.mock('./course-actions', () => ({
  createCourseAction: create,
  updateCourseAction: update,
  setCourseStatusAction: setStatus,
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

const { CourseForm, hoursVerdict, sameSet } = await import('./CourseForm');

const COURSE = '11111111-1111-4111-8111-111111111111';
const CAT1 = '22222222-2222-4222-8222-222222222222';
const CAT2 = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444444';
const P2 = '55555555-5555-4555-8555-555555555555';

const CATEGORIES = [
  { id: CAT1, name: 'Lábios', coverAssetId: null },
  { id: CAT2, name: 'Olhar', coverAssetId: null },
];
const PRODUCTS = [
  { id: P1, name: 'Mentoria em grupo', imageAssetId: null, status: 'active' as const },
  { id: P2, name: 'Clube de leitura', imageAssetId: null, status: 'active' as const },
];

const EDIT_INITIAL = {
  title: 'Harmonização facial do zero',
  tagline: 'Do primeiro ponto ao resultado natural.',
  description: 'Um curso para quem está começando.',
  categoryId: CAT1,
  categoryName: 'Lábios',
  level: 'iniciante' as const,
  coverAssetId: null,
  instructorName: 'Dra. Ana Souza',
  instructorPhotoAssetId: null,
  outcomes: ['Marcar os pontos', 'Escolher o produto'],
  certificateHours: 12,
  products: [{ id: P1, name: 'Mentoria em grupo', imageAssetId: null, status: 'active' as const }],
  status: 'draft' as const,
};

function renderCreate(overrides: Record<string, unknown> = {}) {
  return render(
    <CourseForm
      mode="create"
      tenantName="Rede Demo"
      categories={CATEGORIES}
      products={PRODUCTS}
      {...overrides}
    />,
  );
}

function renderEdit(overrides: Record<string, unknown> = {}) {
  return render(
    <CourseForm
      mode="edit"
      courseId={COURSE}
      initial={EDIT_INITIAL}
      tenantName="Rede Demo"
      categories={CATEGORIES}
      products={PRODUCTS}
      {...overrides}
    />,
  );
}

const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const titleInput = () => document.getElementById('course-title') as HTMLInputElement;
const instructorInput = () => document.getElementById('course-instructor') as HTMLInputElement;
const taglineInput = () => document.getElementById('course-tagline') as HTMLInputElement;
const hoursInput = () => document.getElementById('course-hours') as HTMLInputElement;
const outcomeInputs = () => document.querySelectorAll('[data-course-outcome] input');
const levelChip = (key: string) =>
  document.querySelector(`[data-course-level-chip="${key}"]`) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('hoursVerdict and sameSet', () => {
  it('reads an empty field as valid, integers 0..999 as hours, anything else as invalid', () => {
    expect(hoursVerdict('')).toEqual({ kind: 'empty' });
    expect(hoursVerdict('  ')).toEqual({ kind: 'empty' });
    expect(hoursVerdict('0')).toEqual({ kind: 'ok', hours: 0 });
    expect(hoursVerdict('12')).toEqual({ kind: 'ok', hours: 12 });
    expect(hoursVerdict('999')).toEqual({ kind: 'ok', hours: 999 });
    for (const text of ['1000', '-1', '1.5', '12h', 'abc']) {
      expect(hoursVerdict(text)).toEqual({ kind: 'invalid' });
    }
  });

  it('compares link sets regardless of order', () => {
    expect(sameSet([P1, P2], [P2, P1])).toBe(true);
    expect(sameSet([P1], [P1, P2])).toBe(false);
    expect(sameSet([], [])).toBe(true);
  });
});

describe('CourseForm — create (UI-D-393)', () => {
  it('1. an empty create form: title, disabled submit, gradient preview, Sem categoria, no level, one outcome input, the none line', () => {
    renderCreate();

    expect(screen.getByRole('heading', { name: 'Novo curso' })).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Criar curso');
    expect(document.querySelector('form')?.getAttribute('data-shell-hide')).toBe('nav');
    expect(document.querySelector('[data-course-cover-fallback]')).not.toBeNull();
    expect(document.querySelector('[data-course-cover-preview]')?.className).toContain(
      'aspect-[3/4]',
    );
    expect(screen.getByText(/usamos as cores de Rede Demo\./)).toBeTruthy();
    expect(document.querySelector('[data-course-category-value]')?.textContent).toBe(
      'Sem categoria',
    );
    expect(screen.getByRole('link', { name: 'Gerenciar categorias' }).getAttribute('href')).toBe(
      '/cursos/categorias',
    );
    for (const key of ['iniciante', 'intermediario', 'avancado']) {
      expect(levelChip(key).getAttribute('aria-pressed')).toBe('false');
    }
    expect(document.querySelector('[data-course-level-chips]')?.className).toContain('flex-wrap');
    expect(document.querySelector('[data-course-photo-fallback]')).not.toBeNull();
    expect(outcomeInputs()).toHaveLength(1);
    expect(titleInput().maxLength).toBe(120);
    expect(taglineInput().maxLength).toBe(160);
    expect(instructorInput().maxLength).toBe(120);
    expect(hoursInput().getAttribute('type')).toBe('number');
    expect(hoursInput().getAttribute('max')).toBe('999');
    expect(screen.getByText('horas')).toBeTruthy();
    expect(document.querySelector('[data-course-products-none]')?.textContent).toBe(
      'Aberto para todos os membros.',
    );
    expect(screen.getByRole('button', { name: 'Escolher produtos' })).toBeTruthy();
    expect(document.querySelector('[data-course-archive]')).toBeNull();
  });

  it('2. creating with a title and an instructor calls createCourseAction with the defaults', async () => {
    create.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderCreate();

    fireEvent.change(titleInput(), { target: { value: 'Harmonização facial' } });
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(instructorInput(), { target: { value: 'Dra. Ana' } });
    expect(submitButton().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(create).toHaveBeenCalledWith({
      title: 'Harmonização facial',
      tagline: '',
      description: '',
      categoryId: null,
      level: null,
      coverAssetId: null,
      instructorName: 'Dra. Ana',
      instructorPhotoAssetId: null,
      outcomes: [],
      certificateHours: null,
      productIds: [],
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Curso criado.' });
    expect(push).toHaveBeenCalledWith('/cursos');
  });

  it('3. the instructor error renders under the field on an empty name (blur), and the server refusal too', async () => {
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Curso' } });

    fireEvent.focus(instructorInput());
    fireEvent.blur(instructorInput());
    expect(document.getElementById('course-instructor-error')?.textContent).toBe(
      'Informe o nome de quem ensina.',
    );
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(instructorInput(), { target: { value: 'Alguém' } });
    expect(document.getElementById('course-instructor-error')).toBeNull();

    create.mockResolvedValueOnce({ ok: false, code: 'instructor_required' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.getElementById('course-instructor-error')?.textContent).toBe(
      'Informe o nome de quem ensina.',
    );
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('4. the 11th outcome cannot be added: "Adicionar item" hides at 10; removing the last leaves one empty input', () => {
    renderCreate();
    const add = () => screen.queryByRole('button', { name: 'Adicionar item' });

    for (let n = 1; n < 10; n += 1) {
      const button = add();
      expect(button, `add button before item ${n + 1}`).not.toBeNull();
      fireEvent.click(button as HTMLElement);
    }
    expect(outcomeInputs()).toHaveLength(10);
    expect(add()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remover item 10' }));
    expect(outcomeInputs()).toHaveLength(9);
    expect(add()).not.toBeNull();

    for (let n = 9; n >= 1; n -= 1) {
      fireEvent.click(screen.getByRole('button', { name: `Remover item ${n}` }));
    }
    // E08/empty: never zero inputs.
    expect(outcomeInputs()).toHaveLength(1);
  });

  it('5. only trimmed, non-empty outcomes are sent; a level chip is pressed once and clears on the second tap', async () => {
    create.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Curso' } });
    fireEvent.change(instructorInput(), { target: { value: 'Alguém' } });

    fireEvent.click(levelChip('intermediario'));
    expect(levelChip('intermediario').getAttribute('aria-pressed')).toBe('true');
    expect(levelChip('iniciante').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(levelChip('avancado'));
    expect(levelChip('avancado').getAttribute('aria-pressed')).toBe('true');
    expect(levelChip('intermediario').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(levelChip('avancado'));
    expect(levelChip('avancado').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(levelChip('iniciante'));
    fireEvent.change(outcomeInputs()[0] as HTMLInputElement, { target: { value: '  Primeiro ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item' }));
    fireEvent.change(outcomeInputs()[1] as HTMLInputElement, { target: { value: '   ' } });
    fireEvent.change(hoursInput(), { target: { value: '12' } });

    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      level: 'iniciante',
      outcomes: ['Primeiro'],
      certificateHours: 12,
    });
  });

  it('6. the hours field refuses 1000 and "12h" with the field error and blocks the submit; empty is valid', () => {
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Curso' } });
    fireEvent.change(instructorInput(), { target: { value: 'Alguém' } });

    fireEvent.change(hoursInput(), { target: { value: '1000' } });
    fireEvent.blur(hoursInput());
    expect(document.getElementById('course-hours-error')?.textContent).toBe(
      'Use um número de 0 a 999.',
    );
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(hoursInput(), { target: { value: '' } });
    expect(document.getElementById('course-hours-error')).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('7. with the store off (products null) there is no Acesso block and no productIds are sent', async () => {
    create.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderCreate({ products: null });

    expect(document.querySelector('[data-course-products]')).toBeNull();
    expect(screen.queryByText('Liberado pelos produtos')).toBeNull();

    fireEvent.change(titleInput(), { target: { value: 'Curso' } });
    fireEvent.change(instructorInput(), { target: { value: 'Alguém' } });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('productIds');
  });

  it('8. the product picker toggles products; the button reads Alterar with one or more; X removes', () => {
    renderCreate();

    fireEvent.click(screen.getByRole('button', { name: 'Escolher produtos' }));
    const sheet = screen.getByRole('dialog', { name: 'Liberado pelos produtos' });
    expect(within(sheet).getByText('Toque para incluir ou tirar.')).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Mentoria em grupo, não incluído' }));
    expect(within(sheet).getByRole('button', { name: 'Mentoria em grupo, incluído' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    expect(screen.getByRole('button', { name: 'Alterar produtos' })).toBeTruthy();
    expect(document.querySelector(`[data-course-product="${P1}"]`)).not.toBeNull();
    expect(document.querySelector('[data-course-products-none]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remover Mentoria em grupo' }));
    expect(screen.getByRole('button', { name: 'Escolher produtos' })).toBeTruthy();
    expect(document.querySelector('[data-course-products-none]')).not.toBeNull();
  });

  it('9. the category picker: Sem categoria first, a choice names the row, choosing none clears it', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /^Categoria/ }));
    const sheet = screen.getByRole('dialog', { name: 'Categoria' });
    const radios = within(sheet).getAllByRole('radio');
    expect(radios[0]?.textContent).toContain('Sem categoria');
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Olhar' }));
    expect(document.querySelector('[data-course-category-value]')?.textContent).toBe('Olhar');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /^Categoria/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sem categoria' }));
    expect(document.querySelector('[data-course-category-value]')?.textContent).toBe(
      'Sem categoria',
    );
  });

  it('10. field refusals land under their field; product_invalid is the product line; anything else toasts and keeps the draft', async () => {
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Curso' } });
    fireEvent.change(instructorInput(), { target: { value: 'Alguém' } });

    create.mockResolvedValueOnce({ ok: false, code: 'cover_invalid' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-course-cover-error]')?.textContent).toBe(
      'Não foi possível usar esta imagem. Escolha outra.',
    );

    create.mockResolvedValueOnce({ ok: false, code: 'product_invalid' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-course-products-error]')?.textContent).toBe(
      'Um dos produtos não está mais disponível. Confira a lista.',
    );

    create.mockResolvedValueOnce({ ok: false, code: 'outcome_too_long' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(document.querySelector('[data-course-outcomes-error]')?.textContent).toBe(
      'Cada item tem até 120 caracteres.',
    );
    expect(toast.show).not.toHaveBeenCalled();

    create.mockResolvedValueOnce({ ok: false, code: 'generic' });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(titleInput().value).toBe('Curso');
    expect(push).not.toHaveBeenCalled();
  });

  it('11. a dirty close opens "Descartar curso?"; a clean close leaves for the hub', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(push).toHaveBeenCalledWith('/cursos');

    fireEvent.change(titleInput(), { target: { value: 'Curso' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    const dialog = screen.getByRole('dialog', { name: 'Descartar curso?' });
    expect(dialog.textContent).toContain('As informações preenchidas serão perdidas.');
    expect(within(dialog).getByRole('button', { name: 'Continuar editando' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Descartar' })).toBeTruthy();
  });
});

describe('CourseForm — edit (UI-D-393, D-404)', () => {
  it('12. opens filled and clean (submit disabled), with the saved category, level, outcomes, hours, product and the archive row', () => {
    renderEdit();

    expect(screen.getByRole('heading', { name: 'Editar curso' })).toBeTruthy();
    expect(titleInput().value).toBe('Harmonização facial do zero');
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Salvar alterações');
    expect(document.querySelector('[data-course-category-value]')?.textContent).toBe('Lábios');
    expect(levelChip('iniciante').getAttribute('aria-pressed')).toBe('true');
    expect(outcomeInputs()).toHaveLength(2);
    expect(hoursInput().value).toBe('12');
    expect(document.querySelector(`[data-course-product="${P1}"]`)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Alterar produtos' })).toBeTruthy();
    expect(document.querySelector('[data-course-archive]')?.textContent).toContain(
      'Arquivar curso',
    );
    expect(document.querySelector('[data-course-archived-note]')).toBeNull();
  });

  it('13. changing only the tagline sends { tagline } and nothing else', async () => {
    update.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderEdit();

    fireEvent.change(taglineInput(), { target: { value: 'Nova frase' } });
    expect(submitButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(update).toHaveBeenCalledWith(COURSE, { tagline: 'Nova frase' });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' });
    expect(push).toHaveBeenCalledWith('/cursos');
  });

  it('14. re-selecting the same product set sends no productIds; a changed set sends the whole set', async () => {
    update.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderEdit();

    // Off and on again: the set is what it was, so the form is clean and nothing is sent for it.
    fireEvent.click(screen.getByRole('button', { name: 'Remover Mentoria em grupo' }));
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Escolher produtos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mentoria em grupo, não incluído' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(taglineInput(), { target: { value: 'Outra' } });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(COURSE, { tagline: 'Outra' });
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('productIds');

    fireEvent.click(screen.getByRole('button', { name: 'Alterar produtos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clube de leitura, não incluído' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenLastCalledWith(COURSE, { tagline: 'Outra', productIds: [P1, P2] });
  });

  it('15. with the store off the saved links are untouched: no Acesso block, a tagline edit sends only the tagline', async () => {
    update.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderEdit({ products: null });

    expect(document.querySelector('[data-course-products]')).toBeNull();
    fireEvent.change(taglineInput(), { target: { value: 'Só a frase' } });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(update).toHaveBeenCalledWith(COURSE, { tagline: 'Só a frase' });
  });

  it('16. archiving goes through the danger dialog, toasts and lands on the archived chip', async () => {
    setStatus.mockResolvedValue({ ok: true, courseId: COURSE, status: 'archived' });
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar curso' }));
    const dialog = screen.getByRole('dialog', { name: 'Arquivar curso?' });
    expect(dialog.textContent).toContain(
      'Ele sai do catálogo e ninguém mais consegue acessá-lo. O progresso de quem já assistiu fica guardado.',
    );
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));
    });
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(COURSE, 'archived'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Curso arquivado.' });
    expect(push).toHaveBeenCalledWith('/cursos?filtro=arquivados');
  });

  it('17. a refusal after confirming the archive toasts and keeps the screen', async () => {
    setStatus.mockResolvedValue({ ok: false, code: 'generic' });
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar curso' }));
    const dialog = screen.getByRole('dialog', { name: 'Arquivar curso?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));
    });
    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(push).not.toHaveBeenCalled();
    expect(titleInput().value).toBe('Harmonização facial do zero');
  });

  it('18. an archived course shows the note instead of the archive row and still saves', () => {
    renderEdit({ initial: { ...EDIT_INITIAL, status: 'archived' } });
    expect(document.querySelector('[data-course-archive]')).toBeNull();
    expect(document.querySelector('[data-course-archived-note]')?.textContent).toBe(
      'Este curso foi arquivado. Ele não aparece para os membros.',
    );
  });
});
