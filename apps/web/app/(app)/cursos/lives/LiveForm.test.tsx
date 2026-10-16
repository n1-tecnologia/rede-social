// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.3-11 — the live form (UI-D-403, D-416, COURSE-11; 08.4 D-418, UI-D-418), against the REAL
 * merged pt-BR catalogs through next-intl's own `createTranslator`, so a copy drift fails here.
 * Stubbed: the server actions, the router, the toast and the upload hook. Real: the form, the
 * courses contracts, the module's `LessonPickerSheet`, the store-view sentence builder,
 * `ConfirmDialog` and the inputs. Since 08.4 the form never writes a product link.
 *
 * The clock never enters: every case passes the status the SERVER would have computed, and the only
 * instant the form produces is the one its two inputs name in the tenant zone (`America/Sao_Paulo`).
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, push, refresh, create, update, cancel, reactivate } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  reactivate: vi.fn(),
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

vi.mock('../live-actions', () => ({
  createLiveAction: create,
  updateLiveAction: update,
  cancelLiveAction: cancel,
  reactivateLiveAction: reactivate,
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

const { LiveForm, durationVerdict, isHttpsUrl } = await import('./LiveForm');

const LIVE = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';
const L1 = '44444444-4444-4444-8444-444444444444';
const L2 = '55555555-5555-4555-8555-555555555555';
const COURSE_A = '66666666-6666-4666-8666-666666666666';
const COURSE_B = '77777777-7777-4777-8777-777777777777';

const ZONE = 'America/Sao_Paulo';

/** The read-only line's links (`communityAccessProductsView` of the live detail's products). */
const ACCESS = [
  { id: P1, name: 'Plano anual', href: `/loja/${P1}`, archived: false },
  { id: P2, name: 'Mentoria', href: `/loja/${P2}`, archived: true },
];

const LESSONS = [
  {
    id: L1,
    title: 'Anatomia da região',
    courseId: COURSE_A,
    courseTitle: 'Harmonização facial',
    videoStatus: 'ready' as const,
  },
  {
    id: L2,
    title: 'Protocolo completo',
    courseId: COURSE_B,
    courseTitle: 'Protocolos',
    videoStatus: 'none' as const,
  },
];

/** A live stored for 19:00 São Paulo on 2026-10-16 (22:00Z), 60 min, no product, no replay. */
const INITIAL = {
  title: 'Tira-dúvidas de outubro',
  description: '',
  coverAssetId: null,
  startsAt: '2026-10-16T22:00:00.000000Z',
  start: { date: '2026-10-16', time: '19:00' },
  durationMin: 60,
  externalUrl: 'https://youtu.be/abc',
  replayLesson: null,
  status: 'scheduled' as const,
};

function renderCreate(overrides: Record<string, unknown> = {}) {
  return render(<LiveForm mode="create" tenantName="Rede Demo" timeZone={ZONE} {...overrides} />);
}

function renderEdit(
  status: 'scheduled' | 'live' | 'recorded' | 'cancelled',
  overrides: Record<string, unknown> = {},
) {
  return render(
    <LiveForm
      mode="edit"
      liveId={LIVE}
      initial={{ ...INITIAL, status }}
      status={status}
      tenantName="Rede Demo"
      timeZone={ZONE}
      {...overrides}
    />,
  );
}

const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const setValue = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });

async function submit() {
  await act(async () => {
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
  });
}

/** Fills the four required fields the create form opens blank or default. */
function fillValid() {
  setValue('live-title', 'Tira-dúvidas');
  setValue('live-start-date', '2026-10-16');
  setValue('live-start-time', '19:00');
  setValue('live-url', 'https://youtu.be/abc');
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('durationVerdict and isHttpsUrl (D-416)', () => {
  it('duration is an integer 5..600; the url is https with a host, at most 2048 characters', () => {
    expect(durationVerdict('60')).toEqual({ kind: 'ok', minutes: 60 });
    expect(durationVerdict('5')).toEqual({ kind: 'ok', minutes: 5 });
    expect(durationVerdict('600')).toEqual({ kind: 'ok', minutes: 600 });
    for (const text of ['4', '601', '5.5', '', 'abc', '-10']) {
      expect(durationVerdict(text)).toEqual({ kind: 'invalid' });
    }
    expect(isHttpsUrl('https://youtu.be/abc')).toBe(true);
    expect(isHttpsUrl('  https://meet.google.com/x  ')).toBe(true);
    for (const value of [
      'http://youtu.be/abc',
      'javascript:alert(1)',
      'youtu.be/abc',
      'https://',
      '',
      `https://e.com/${'a'.repeat(2048)}`,
    ]) {
      expect(isHttpsUrl(value)).toBe(false);
    }
  });
});

describe('LiveForm — create (UI-D-403, E13)', () => {
  it('1. opens with "Nova live", a disabled "Agendar live", the gradient preview, the Quando pair, 60 min, the https field and its helper; no Acesso block, no product control, no pill, no replay row, no cancel row', () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: 'Nova live' })).toBeTruthy();
    expect(submitButton().textContent).toBe('Agendar live');
    expect(submitButton().disabled).toBe(true);
    expect(document.querySelector('[data-live-cover-fallback]')).not.toBeNull();
    expect(field('live-start-date').type).toBe('date');
    expect(field('live-start-time').type).toBe('time');
    expect(field('live-start-time').step).toBe('300');
    expect(field('live-duration').type).toBe('number');
    expect(field('live-duration').value).toBe('60');
    expect(field('live-duration').min).toBe('5');
    expect(field('live-duration').max).toBe('600');
    expect(screen.getByText('Depois desse tempo a live passa a Gravada.')).toBeTruthy();
    expect(field('live-url').type).toBe('url');
    expect(field('live-url').placeholder).toBe('https://');
    expect(
      screen.getByText('YouTube, Zoom, Meet ou qualquer link que comece com https://.'),
    ).toBeTruthy();
    // Create mode has no Acesso block and no product control at all (UI-D-418, D-418).
    expect(document.querySelector('[data-live-access]')).toBeNull();
    expect(screen.queryByText(/Liberada pelos produtos/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escolher produtos' })).toBeNull();
    expect(screen.queryByText('Aberto para todos os membros.')).toBeNull();
    expect(document.querySelector('[data-live-status-pill]')).toBeNull();
    expect(document.querySelector('[data-live-replay]')).toBeNull();
    expect(document.querySelector('[data-live-cancel]')).toBeNull();
    expect(document.querySelector('[data-live-cancelled-note]')).toBeNull();
    expect(field('live-title').maxLength).toBe(120);
  });

  it('2. create mode renders no Acesso block even when products are passed, and the body carries no link key', async () => {
    create.mockResolvedValue({ ok: true, liveId: LIVE, status: 'scheduled' });
    renderCreate({ accessProducts: ACCESS });
    expect(document.querySelector('[data-live-access]')).toBeNull();
    fillValid();
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('productIds');
  });

  it('3. an http:// link renders the url error under the field and nothing is sent (E13 error, T-08.3-11)', async () => {
    renderCreate();
    fillValid();
    setValue('live-url', 'http://youtu.be/abc');
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Use um link que comece com https://.')).toBeTruthy();
    // Fixing the link clears the error.
    setValue('live-url', 'https://youtu.be/abc');
    expect(screen.queryByText('Use um link que comece com https://.')).toBeNull();
  });

  it('4. duration 601 renders its error; a blank date renders startRequired under the pair; nothing is sent', async () => {
    renderCreate();
    fillValid();
    setValue('live-duration', '601');
    setValue('live-start-date', '');
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Use uma duração entre 5 e 600 minutos.')).toBeTruthy();
    const startError = document.querySelector('[data-live-start-error]');
    expect(startError?.textContent).toBe('Informe a data e a hora de início.');
    expect(field('live-start-date').getAttribute('aria-invalid')).toBe('true');
    expect(field('live-start-time').getAttribute('aria-invalid')).toBe('true');
  });

  it('5. the submit sends ONE body with the ISO instant built in the TENANT zone (19:00 São Paulo → 22:00Z), the trimmed https link and the duration, never a link key; "Live agendada." and the Lives tab', async () => {
    create.mockResolvedValue({ ok: true, liveId: LIVE, status: 'scheduled' });
    renderCreate();
    fillValid();
    setValue('live-description', ' Traga suas dúvidas. ');
    setValue('live-duration', '90');
    setValue('live-url', '  https://meet.google.com/abc-defg  ');
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      title: 'Tira-dúvidas',
      description: ' Traga suas dúvidas. ',
      coverAssetId: null,
      startsAt: '2026-10-16T22:00:00.000Z',
      durationMin: 90,
      externalUrl: 'https://meet.google.com/abc-defg',
    });
    await waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Live agendada.' });
    expect(push).toHaveBeenCalledWith('/cursos?aba=lives');
  });

  it('6. a server refusal lands under its field: url_invalid, duration_invalid, start_required; the draft stays', async () => {
    renderCreate();
    fillValid();
    for (const [code, text] of [
      ['url_invalid', 'Use um link que comece com https://.'],
      ['duration_invalid', 'Use uma duração entre 5 e 600 minutos.'],
      ['start_required', 'Informe a data e a hora de início.'],
    ] as const) {
      create.mockResolvedValueOnce({ ok: false, code });
      await submit();
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(push).not.toHaveBeenCalled();
    expect(field('live-title').value).toBe('Tira-dúvidas');
  });
});

describe('LiveForm — edit (UI-D-403, E13 partial)', () => {
  it('7. a scheduled live: "Editar live", the Agendada pill, the stored wall clock in the inputs, disabled "Salvar alterações" until dirty, the cancel row, NO replay row', () => {
    renderEdit('scheduled');
    expect(screen.getByRole('heading', { name: 'Editar live' })).toBeTruthy();
    expect(document.querySelector('[data-live-status-pill]')?.textContent).toBe('Agendada');
    expect(field('live-start-date').value).toBe('2026-10-16');
    expect(field('live-start-time').value).toBe('19:00');
    expect(field('live-url').value).toBe('https://youtu.be/abc');
    expect(submitButton().textContent).toBe('Salvar alterações');
    expect(submitButton().disabled).toBe(true);
    expect(document.querySelector('[data-live-cancel]')).not.toBeNull();
    expect(document.querySelector('[data-live-replay]')).toBeNull();
    // An on-air live reads the same, with its own pill.
    cleanup();
    renderEdit('live');
    expect(document.querySelector('[data-live-status-pill]')?.textContent).toBe('Ao vivo');
    expect(document.querySelector('[data-live-replay]')).toBeNull();
  });

  it('8. a field-only edit sends ONLY the changed keys; an unchanged wall clock sends no startsAt; "Alterações salvas."', async () => {
    update.mockResolvedValue({ ok: true, liveId: LIVE, status: 'scheduled' });
    renderEdit('scheduled');
    setValue('live-title', 'Tira-dúvidas de novembro');
    setValue('live-start-time', '19:00');
    await submit();
    expect(update).toHaveBeenCalledWith(LIVE, { title: 'Tira-dúvidas de novembro' });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' }),
    );
    expect(push).toHaveBeenCalledWith('/cursos?aba=lives');
  });

  it('9. a moved time sends the rebuilt instant in the tenant zone', async () => {
    update.mockResolvedValue({ ok: true, liveId: LIVE, status: 'scheduled' });
    renderEdit('scheduled');
    setValue('live-start-time', '20:30');
    await submit();
    expect(update).toHaveBeenCalledWith(LIVE, { startsAt: '2026-10-16T23:30:00.000Z' });
  });

  it('10. a recorded live shows the Gravada pill and the Replay row reading "Sem replay"; the sheet lists the lessons grouped by course with "Sem replay" first; picking one reads "{course} · {lesson}" and the save sends replayLessonId → "Replay definido."', async () => {
    update.mockResolvedValue({ ok: true, liveId: LIVE, status: 'recorded' });
    renderEdit('recorded', { lessons: LESSONS });
    expect(document.querySelector('[data-live-status-pill]')?.textContent).toBe('Gravada');
    const row = document.querySelector('[data-live-replay-row]') as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(document.querySelector('[data-live-replay-value]')?.textContent).toBe('Sem replay');
    expect(screen.getByText('A aula que os membros abrem como gravação desta live.')).toBeTruthy();
    fireEvent.click(row);
    const sheet = screen.getByRole('dialog', { name: 'Replay' });
    expect(within(sheet).getByText('Escolha a aula que guarda a gravação.')).toBeTruthy();
    const radios = within(sheet).getAllByRole('radio');
    expect(radios[0]?.getAttribute('data-testid')).toBe('lesson-picker-none');
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(
      within(sheet)
        .getAllByTestId('lesson-picker-group')
        .map((group) => within(group).getByRole('heading').textContent),
    ).toEqual(['Harmonização facial', 'Protocolos']);
    fireEvent.click(
      within(sheet).getByRole('radio', { name: 'Anatomia da região, de Harmonização facial' }),
    );
    expect(document.querySelector('[data-live-replay-value]')?.textContent).toBe(
      'Harmonização facial · Anatomia da região',
    );
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(update).toHaveBeenCalledWith(LIVE, { replayLessonId: L1 });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Replay definido.' }),
    );
  });

  it('10b. WR-06: a replay list that reaches the API cap (200) says it shows only the first lessons, never truncating in silence', () => {
    const full = Array.from({ length: 200 }, (_, index) => ({
      ...LESSONS[0],
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Aula ${index}`,
    }));
    renderEdit('recorded', { lessons: full });
    fireEvent.click(document.querySelector('[data-live-replay-row]') as HTMLButtonElement);
    const sheet = screen.getByRole('dialog', { name: 'Replay' });
    expect(
      within(sheet).getByText(
        'Escolha a aula que guarda a gravação. Mostrando as 200 primeiras aulas, dos cursos mais recentes.',
      ),
    ).toBeTruthy();
  });

  it('11. a saved replay reads back and "Sem replay" clears it (replayLessonId: null, "Alterações salvas."); lesson_invalid lands under the row', async () => {
    renderEdit('recorded', {
      lessons: LESSONS,
      initial: {
        ...INITIAL,
        status: 'recorded',
        replayLesson: { id: L2, title: 'Protocolo completo', courseTitle: 'Protocolos' },
      },
    });
    expect(document.querySelector('[data-live-replay-value]')?.textContent).toBe(
      'Protocolos · Protocolo completo',
    );
    update.mockResolvedValueOnce({ ok: false, code: 'lesson_invalid' });
    fireEvent.click(document.querySelector('[data-live-replay-row]') as HTMLButtonElement);
    fireEvent.click(screen.getByTestId('lesson-picker-none'));
    expect(document.querySelector('[data-live-replay-value]')?.textContent).toBe('Sem replay');
    await submit();
    expect(update).toHaveBeenCalledWith(LIVE, { replayLessonId: null });
    // The refusal: under the row, the draft kept.
    fireEvent.click(document.querySelector('[data-live-replay-row]') as HTMLButtonElement);
    fireEvent.click(
      screen.getByRole('radio', { name: 'Anatomia da região, de Harmonização facial' }),
    );
    update.mockResolvedValueOnce({ ok: false, code: 'lesson_invalid' });
    await submit();
    expect(document.querySelector('[data-live-replay-error]')?.textContent).toBe(
      'Esta aula não está mais disponível. Escolha outra.',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('12. "Cancelar live" → the danger dialog with the D-447 body ("Voltar" / "Cancelar live") → cancelLiveAction, "Live cancelada." and a refresh; "Voltar" closes without a call', async () => {
    cancel.mockResolvedValue({ ok: true, liveId: LIVE, status: 'cancelled' });
    renderEdit('scheduled');
    fireEvent.click(document.querySelector('[data-live-cancel]') as HTMLButtonElement);
    const dialog = screen.getByRole('dialog', { name: 'Cancelar live?' });
    expect(
      within(dialog).getByText(
        'Ela continua na agenda com o selo Cancelada e o link é desativado. Quem ativou o lembrete recebe um aviso.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cancelar live?' })).toBeNull(),
    );
    fireEvent.click(document.querySelector('[data-live-cancel]') as HTMLButtonElement);
    const again = screen.getByRole('dialog', { name: 'Cancelar live?' });
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: 'Cancelar live' }));
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(LIVE));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Live cancelada.' }),
    );
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('13. a cancelled live is read-only: the Cancelada pill, the note instead of the cancel row, no replay row, every field disabled, the submit disabled', () => {
    renderEdit('cancelled', { lessons: LESSONS, reactivatable: true });
    expect(document.querySelector('[data-live-status-pill]')?.textContent).toBe('Cancelada');
    expect(document.querySelector('[data-live-cancelled-note]')?.textContent).toBe(
      'Esta live foi cancelada.',
    );
    expect(document.querySelector('[data-live-cancel]')).toBeNull();
    expect(document.querySelector('[data-live-replay]')).toBeNull();
    for (const id of [
      'live-title',
      'live-description',
      'live-start-date',
      'live-start-time',
      'live-duration',
      'live-url',
    ]) {
      expect(field(id).disabled, id).toBe(true);
    }
    expect(screen.queryByRole('button', { name: 'Escolher produtos' })).toBeNull();
    setValue('live-title', 'x');
    expect(submitButton().disabled).toBe(true);
  });

  it('14. a cancel that landed first (409 live_cancelled on save) toasts and refreshes into the server truth', async () => {
    update.mockResolvedValue({ ok: false, code: 'live_cancelled' });
    renderEdit('scheduled');
    setValue('live-title', 'Outro título');
    await submit();
    await waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar. Revise os campos e tente novamente.',
    });
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('LiveForm — the read-only Acesso line (08.4, UI-D-418)', () => {
  it('15. edit mode with access products renders "Liberada pelos produtos: X e Y" with links to /loja/{id}, the archived suffix and the helper, after Onde acontece and before Replay', () => {
    renderEdit('recorded', { accessProducts: ACCESS, lessons: LESSONS });
    const block = document.querySelector('[data-live-access]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(within(block).getByText('Acesso')).toBeTruthy();
    expect(block.querySelector('[data-live-access-value]')?.textContent).toBe(
      'Liberada pelos produtos: Plano anual e Mentoria (arquivado)',
    );
    const links = block.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe(`/loja/${P1}`);
    expect(links[1]?.getAttribute('href')).toBe(`/loja/${P2}`);
    expect(within(block).getByText('Para mudar, edite o produto na Loja.')).toBeTruthy();
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
    // Order: after the link field, before the replay block.
    const url = document.getElementById('live-url') as HTMLElement;
    const replay = document.querySelector('[data-live-replay]') as HTMLElement;
    expect(url.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(replay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('16. a cancelled live still renders the line', () => {
    renderEdit('cancelled', { accessProducts: ACCESS });
    expect(document.querySelector('[data-live-access-value]')?.textContent).toBe(
      'Liberada pelos produtos: Plano anual e Mentoria (arquivado)',
    );
  });

  it('17. undefined or empty access products render no Acesso block; an edit sends no link key', async () => {
    update.mockResolvedValue({ ok: true, liveId: LIVE, status: 'scheduled' });
    renderEdit('scheduled', { accessProducts: [] });
    expect(document.querySelector('[data-live-access]')).toBeNull();
    cleanup();
    renderEdit('scheduled');
    expect(document.querySelector('[data-live-access]')).toBeNull();
    setValue('live-title', 'Outro título');
    await submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toEqual({ title: 'Outro título' });
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('productIds');
  });
});

describe('LiveForm — "Reativar live" (08.6-12, D-452, UI-D-462, E13)', () => {
  const reactivateButton = () =>
    document.querySelector('[data-live-reactivate]') as HTMLButtonElement | null;

  it('18. start ahead (reactivatable): the note, then the outline full-width "Reativar live" with its glyph', () => {
    renderEdit('cancelled', { reactivatable: true });
    expect(document.querySelector('[data-live-cancelled-note]')?.textContent).toBe(
      'Esta live foi cancelada.',
    );
    const button = reactivateButton();
    expect(button?.textContent).toBe('Reativar live');
    expect(button?.className).toContain('w-full');
    expect(button?.className).toContain('mt-3');
    expect(button?.querySelector('svg.lucide-rotate-ccw')).not.toBeNull();
    expect(document.querySelector('[data-live-cancel]')).toBeNull();
  });

  it('19. start passed (not reactivatable): only the past-start note, no button', () => {
    renderEdit('cancelled');
    expect(document.querySelector('[data-live-cancelled-note]')?.textContent).toBe(
      'Esta live foi cancelada e não pode mais ser reativada, porque o horário de início já passou.',
    );
    expect(reactivateButton()).toBeNull();
  });

  it('20. not cancelled: neither the note nor the button, even with reactivatable (the shipped cancel row)', () => {
    renderEdit('scheduled', { reactivatable: true });
    expect(document.querySelector('[data-live-cancelled-note]')).toBeNull();
    expect(reactivateButton()).toBeNull();
    expect(document.querySelector('[data-live-cancel]')).not.toBeNull();
  });

  it('21. the BRAND dialog with its copy; "Manter cancelada" closes without a call; confirm → reactivateLiveAction, "Live reativada." and a refresh', async () => {
    reactivate.mockResolvedValue({ ok: true, liveId: LIVE, status: 'scheduled' });
    renderEdit('cancelled', { reactivatable: true });
    fireEvent.click(reactivateButton() as HTMLButtonElement);
    const dialog = screen.getByRole('dialog', { name: 'Reativar live?' });
    expect(
      within(dialog).getByText(
        'O link volta a funcionar no horário marcado. Os membros recebem o aviso da live, e quem tinha ativado o lembrete volta a recebê-lo.',
      ),
    ).toBeTruthy();
    // Brand, not danger: the disc is the brand tint and holds the RotateCcw glyph.
    const disc = dialog.querySelector('span.bg-brand\\/10');
    expect(disc).not.toBeNull();
    expect(disc?.querySelector('svg.lucide-rotate-ccw')).not.toBeNull();
    expect(dialog.querySelector('.text-danger')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Manter cancelada' }));
    expect(reactivate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reativar live?' })).toBeNull(),
    );

    fireEvent.click(reactivateButton() as HTMLButtonElement);
    const again = screen.getByRole('dialog', { name: 'Reativar live?' });
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: 'Reativar live' }));
    });
    await waitFor(() => expect(reactivate).toHaveBeenCalledWith(LIVE));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Live reativada.' }),
    );
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('22. the confirm is pending (both footer buttons disabled) while the action runs', async () => {
    let settle: (value: unknown) => void = () => undefined;
    reactivate.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderEdit('cancelled', { reactivatable: true });
    fireEvent.click(reactivateButton() as HTMLButtonElement);
    const dialog = screen.getByRole('dialog', { name: 'Reativar live?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reativar live' }));
    });
    const keep = within(dialog).getByRole('button', {
      name: 'Manter cancelada',
    }) as HTMLButtonElement;
    expect(keep.disabled).toBe(true);
    await act(async () => {
      settle({ ok: true, liveId: LIVE, status: 'scheduled' });
    });
  });

  it('23. a 409 live_not_reactivatable toasts "already started" and refreshes into the past-start note', async () => {
    reactivate.mockResolvedValue({ ok: false, code: 'live_not_reactivatable' });
    renderEdit('cancelled', { reactivatable: true });
    fireEvent.click(reactivateButton() as HTMLButtonElement);
    const dialog = screen.getByRole('dialog', { name: 'Reativar live?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reativar live' }));
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não é possível reativar uma live que já começou.',
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('24. any other failure toasts the generic reactivate error and keeps the cancelled form (no refresh)', async () => {
    reactivate.mockResolvedValue({ ok: false, code: 'generic' });
    renderEdit('cancelled', { reactivatable: true });
    fireEvent.click(reactivateButton() as HTMLButtonElement);
    const dialog = screen.getByRole('dialog', { name: 'Reativar live?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reativar live' }));
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível reativar a live. Tente novamente.',
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(reactivateButton()).not.toBeNull();
  });
});
