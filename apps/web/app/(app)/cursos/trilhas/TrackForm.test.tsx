// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.3-10 — the track form (UI-D-402, D-414, D-415, COURSE-10), against the REAL merged pt-BR
 * catalogs through next-intl's own `createTranslator`, so a copy drift fails here. Stubbed: the
 * server actions, the router, the toast and the upload hook. Real: the form, the courses contracts,
 * the module's `CoursePickerSheet` and `ReorderList`, `ConfirmDialog` and the inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, push, refresh, create, update, setStatus, replaceCourses } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setStatus: vi.fn(),
  replaceCourses: vi.fn(),
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

vi.mock('../track-actions', () => ({
  createTrackAction: create,
  updateTrackAction: update,
  setTrackStatusAction: setStatus,
  replaceTrackCoursesAction: replaceCourses,
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

const { TrackForm, sameOrder } = await import('./TrackForm');

const TRACK = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';
const C3 = '44444444-4444-4444-8444-444444444444';
const DRAFT = '55555555-5555-4555-8555-555555555555';

/** The page hands the PUBLISHED catalogue; a draft slipped in here proves the form filters anyway. */
const COURSES = [
  {
    id: C1,
    title: 'Harmonização facial do zero',
    coverAssetId: null,
    status: 'published' as const,
  },
  {
    id: C2,
    title: 'Protocolos de biossegurança',
    coverAssetId: null,
    status: 'published' as const,
  },
  { id: C3, title: 'Pele: preenchimento', coverAssetId: null, status: 'published' as const },
  { id: DRAFT, title: 'Rascunho secreto', coverAssetId: null, status: 'draft' as const },
];

const EDIT_INITIAL = {
  title: 'Do zero ao primeiro atendimento',
  subtitle: 'Quatro cursos em sequência',
  audience: 'Para quem está começando',
  description: '',
  coverAssetId: null,
  courses: [
    {
      id: C1,
      title: 'Harmonização facial do zero',
      coverAssetId: null,
      status: 'published' as const,
    },
    {
      id: DRAFT,
      title: 'Lábios: técnica e segurança',
      coverAssetId: null,
      status: 'draft' as const,
    },
    {
      id: C2,
      title: 'Protocolos de biossegurança',
      coverAssetId: null,
      status: 'published' as const,
    },
  ],
  status: 'active' as const,
};

function renderCreate(overrides: Record<string, unknown> = {}) {
  return render(
    <TrackForm mode="create" tenantName="Rede Demo" courses={COURSES} {...overrides} />,
  );
}

function renderEdit(overrides: Record<string, unknown> = {}) {
  return render(
    <TrackForm
      mode="edit"
      trackId={TRACK}
      initial={EDIT_INITIAL}
      tenantName="Rede Demo"
      courses={COURSES}
      {...overrides}
    />,
  );
}

const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const titleInput = () => document.getElementById('track-title') as HTMLInputElement;
const subtitleInput = () => document.getElementById('track-subtitle') as HTMLInputElement;
const courseRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-track-course-row]'));
const rowIds = () => courseRows().map((row) => row.getAttribute('data-track-course-row'));
const pickButton = () => document.querySelector('[data-track-courses-pick]') as HTMLButtonElement;

async function submit() {
  await act(async () => {
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('sameOrder', () => {
  it('compares ids AND their order — a track list is ordered', () => {
    expect(sameOrder([C1, C2], [C1, C2])).toBe(true);
    expect(sameOrder([C1, C2], [C2, C1])).toBe(false);
    expect(sameOrder([C1], [C1, C2])).toBe(false);
    expect(sameOrder([], [])).toBe(true);
  });
});

describe('TrackForm — create (UI-D-402, E12 empty)', () => {
  it('1. an empty form: disabled submit, the gradient preview, "Nenhum curso ainda." above "Escolher cursos", the helper', () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: 'Nova trilha' })).toBeTruthy();
    expect(submitButton().textContent).toBe('Criar trilha');
    expect(submitButton().disabled).toBe(true);
    expect(document.querySelector('[data-track-cover-fallback]')).not.toBeNull();
    expect(document.querySelector('[data-track-courses-none]')?.textContent).toBe(
      'Nenhum curso ainda.',
    );
    expect(pickButton().textContent).toContain('Escolher cursos');
    expect(
      screen.getByText(
        'A ordem é a sequência recomendada. Só cursos publicados entram na trilha; um curso despublicado ou arquivado some dela até voltar.',
      ),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText('Ex.: Para quem está começando')).toBeTruthy();
    expect(titleInput().maxLength).toBe(120);
    expect(subtitleInput().maxLength).toBe(160);
    expect((document.getElementById('track-audience') as HTMLInputElement).maxLength).toBe(60);
    // No archive row, no note on create.
    expect(document.querySelector('[data-track-archive]')).toBeNull();
    expect(document.querySelector('[data-track-archived-note]')).toBeNull();
  });

  it('1b. WR-06: a course list that reaches the picker walk cap (200) says it shows only the most recent published courses', () => {
    const full = Array.from({ length: 200 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Curso ${index}`,
      coverAssetId: null,
      status: 'published' as const,
    }));
    renderCreate({ courses: full });
    fireEvent.click(pickButton());
    const sheet = screen.getByRole('dialog', { name: 'Cursos da trilha' });
    expect(
      within(sheet).getByText(
        'Toque para incluir ou tirar. Mostrando os 200 cursos publicados mais recentes.',
      ),
    ).toBeTruthy();
    expect(within(sheet).getAllByTestId('course-picker-row')).toHaveLength(200);
  });

  it('2. the picker lists PUBLISHED courses only (the draft is absent); a tap includes, the rows appear, the button reads "Alterar cursos", "Concluir" closes', () => {
    renderCreate();
    fireEvent.click(pickButton());
    const sheet = screen.getByRole('dialog', { name: 'Cursos da trilha' });
    expect(within(sheet).getByText('Toque para incluir ou tirar. Só cursos publicados aparecem.'));
    const rows = within(sheet).getAllByTestId('course-picker-row');
    expect(rows.map((row) => row.getAttribute('data-course-id'))).toEqual([C1, C2, C3]);
    expect(within(sheet).queryByText('Rascunho secreto')).toBeNull();

    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Protocolos de biossegurança, não incluído' }),
    );
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Harmonização facial do zero, não incluído' }),
    );
    expect(
      within(sheet).getByRole('button', { name: 'Protocolos de biossegurança, incluído' }),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));

    // Picked in tap order; the arrows are the list's; the remove control names the course.
    expect(rowIds()).toEqual([C2, C1]);
    expect(pickButton().textContent).toContain('Alterar cursos');
    expect(
      screen.getByRole('button', { name: 'Remover Protocolos de biossegurança' }),
    ).toBeTruthy();
    const up = screen.getAllByRole('button', { name: /^Mover para cima:/ });
    const down = screen.getAllByRole('button', { name: /^Mover para baixo:/ });
    expect(up).toHaveLength(2);
    expect((up[0] as HTMLButtonElement).disabled).toBe(true);
    expect((down[1] as HTMLButtonElement).disabled).toBe(true);
    // The picker now shows the included rows checked.
    fireEvent.click(pickButton());
    expect(
      screen.getByRole('button', { name: 'Harmonização facial do zero, incluído' }),
    ).toBeTruthy();
  });

  it('3. creating sends the body with the defaults, then ONE PUT …/order with the permutation the arrow made; toasts and lands on the Trilhas tab', async () => {
    create.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    replaceCourses.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Do zero' } });
    fireEvent.click(pickButton());
    const sheet = screen.getByRole('dialog', { name: 'Cursos da trilha' });
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Harmonização facial do zero, não incluído' }),
    );
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Protocolos de biossegurança, não incluído' }),
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Concluir' }));
    expect(rowIds()).toEqual([C1, C2]);
    // The arrow: the second course goes first (D-414).
    fireEvent.click(
      screen.getByRole('button', { name: 'Mover para cima: Protocolos de biossegurança' }),
    );
    expect(rowIds()).toEqual([C2, C1]);
    expect(submitButton().disabled).toBe(false);

    await submit();
    await waitFor(() => expect(replaceCourses).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      title: 'Do zero',
      subtitle: '',
      audience: '',
      description: '',
      coverAssetId: null,
    });
    expect(replaceCourses).toHaveBeenCalledWith(TRACK, [C2, C1]);
    expect(update).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Trilha criada.' });
    expect(push).toHaveBeenCalledWith('/cursos?aba=trilhas');
  });

  it('4. a track with no course creates with ONE write and no PUT (P40); an empty title shows the field error and sends nothing', async () => {
    create.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: '   ' } });
    fireEvent.blur(titleInput());
    expect(screen.getByText('Dê um título à trilha.')).toBeTruthy();
    await submit();
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(titleInput(), { target: { value: 'Só o título' } });
    await submit();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(replaceCourses).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Trilha criada.' });
  });

  it('5. a create whose course list is refused with course_invalid toasts the sentence, keeps the list and does not leave; the next submit patches the SAME track instead of creating again', async () => {
    create.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    replaceCourses
      .mockResolvedValueOnce({ ok: false, code: 'course_invalid' })
      .mockResolvedValueOnce({ ok: true, trackId: TRACK, status: 'active' });
    update.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Do zero' } });
    fireEvent.click(pickButton());
    fireEvent.click(
      screen.getByRole('button', { name: 'Harmonização facial do zero, não incluído' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    await submit();
    await waitFor(() => expect(replaceCourses).toHaveBeenCalledTimes(1));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Um dos cursos não está mais publicado. Confira a lista e tente de novo.',
    });
    expect(push).not.toHaveBeenCalled();
    expect(rowIds()).toEqual([C1]);

    // Second submit: no second create; the list goes again.
    await submit();
    await waitFor(() => expect(replaceCourses).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(1);
    expect(replaceCourses).toHaveBeenLastCalledWith(TRACK, [C1]);
    expect(push).toHaveBeenCalledWith('/cursos?aba=trilhas');
  });
});

describe('TrackForm — edit (UI-D-402, E12 partial, UI-D-404)', () => {
  it('6. opens filled and clean; a linked course no longer published shows "Não publicado" with a tertiary title and stays removable; the archive row is present', () => {
    renderEdit();
    expect(screen.getByRole('heading', { name: 'Editar trilha' })).toBeTruthy();
    expect(titleInput().value).toBe('Do zero ao primeiro atendimento');
    expect(subtitleInput().value).toBe('Quatro cursos em sequência');
    expect(submitButton().textContent).toBe('Salvar alterações');
    expect(submitButton().disabled).toBe(true);
    expect(rowIds()).toEqual([C1, DRAFT, C2]);
    const stale = document.querySelector(`[data-track-course-row="${DRAFT}"]`) as HTMLElement;
    expect(stale.getAttribute('data-track-course-status')).toBe('draft');
    expect(within(stale).getByText('Não publicado')).toBeTruthy();
    expect(within(stale).getByText('Lábios: técnica e segurança').className).toContain(
      'text-text-tertiary',
    );
    expect(
      within(stale).getByRole('button', { name: 'Remover Lábios: técnica e segurança' }),
    ).toBeTruthy();
    const published = document.querySelector(`[data-track-course-row="${C1}"]`) as HTMLElement;
    expect(within(published).queryByText('Não publicado')).toBeNull();
    expect(pickButton().textContent).toContain('Alterar cursos');
    expect(document.querySelector('[data-track-archive]')).not.toBeNull();
    expect(document.querySelector('[data-track-archived-note]')).toBeNull();
  });

  it('7. changing only the subtitle sends { subtitle } and NO course list (unchanged); the unpublished link stays untouched', async () => {
    update.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    renderEdit();
    fireEvent.change(subtitleInput(), { target: { value: 'Novo subtítulo' } });
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(TRACK, { subtitle: 'Novo subtítulo' });
    expect(replaceCourses).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' });
    expect(push).toHaveBeenCalledWith('/cursos?aba=trilhas');
  });

  it('8. a move sends the permutation of the PUBLISHED rows only — the unpublished course is excluded — with no PATCH when no field changed', async () => {
    replaceCourses.mockResolvedValue({ ok: true, trackId: TRACK, status: 'active' });
    renderEdit();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mover para cima: Protocolos de biossegurança' }),
    );
    expect(rowIds()).toEqual([C1, C2, DRAFT]);
    await submit();
    await waitFor(() => expect(replaceCourses).toHaveBeenCalledTimes(1));
    expect(replaceCourses).toHaveBeenCalledWith(TRACK, [C1, C2]);
    expect(update).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' });
  });

  it('9. removing the unpublished course sends the list without it; course_invalid from the server toasts and keeps the rows', async () => {
    replaceCourses.mockResolvedValue({ ok: false, code: 'course_invalid' });
    renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Remover Lábios: técnica e segurança' }));
    expect(rowIds()).toEqual([C1, C2]);
    await submit();
    await waitFor(() => expect(replaceCourses).toHaveBeenCalledWith(TRACK, [C1, C2]));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Um dos cursos não está mais publicado. Confira a lista e tente de novo.',
    });
    expect(push).not.toHaveBeenCalled();
    expect(rowIds()).toEqual([C1, C2]);
  });

  it('10. a dirty close opens "Descartar trilha?"; a clean close leaves for the Trilhas tab', () => {
    renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(push).toHaveBeenCalledWith('/cursos?aba=trilhas');
    push.mockClear();
    fireEvent.change(titleInput(), { target: { value: 'Outro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('dialog', { name: 'Descartar trilha?' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('11. archiving goes through the danger dialog, toasts "Trilha arquivada." and lands on the Arquivadas chip', async () => {
    setStatus.mockResolvedValue({ ok: true, trackId: TRACK, status: 'archived' });
    renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar trilha' }));
    const dialog = screen.getByRole('dialog', { name: 'Arquivar trilha?' });
    expect(dialog.textContent).toContain('Ela some do catálogo. Os cursos continuam onde estão.');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));
    });
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(TRACK, 'archived'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Trilha arquivada.' });
    expect(push).toHaveBeenCalledWith('/cursos?aba=trilhas&filtro=arquivadas');
  });

  it('12. an archived track shows the note instead of the archive row and still saves', async () => {
    update.mockResolvedValue({ ok: true, trackId: TRACK, status: 'archived' });
    renderEdit({ initial: { ...EDIT_INITIAL, status: 'archived' } });
    expect(document.querySelector('[data-track-archive]')).toBeNull();
    expect(document.querySelector('[data-track-archived-note]')?.textContent).toBe(
      'Esta trilha foi arquivada.',
    );
    fireEvent.change(titleInput(), { target: { value: 'Ainda editável' } });
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledWith(TRACK, { title: 'Ainda editável' }));
  });
});
