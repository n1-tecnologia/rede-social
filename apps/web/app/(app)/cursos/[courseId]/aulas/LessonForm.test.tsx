// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonFormDefaults } from '@/lib/courses-view';

/**
 * 08.3-09 — the lesson form (UI-D-398, D-407, D-409, D-413), against the REAL merged pt-BR catalogs
 * through next-intl's own `createTranslator`, so a copy drift fails here. Stubbed: the server
 * actions, the router, the toast, the upload hook (its OPTIONS are recorded — the `purpose` the start
 * body carries), the readiness poll (controlled per case) and the Mux player (a marker). Real: the
 * form, the video block, the materials list, the module's `ReorderList`, `ConfirmDialog`, `Switch`
 * and the inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const {
  toast,
  push,
  refresh,
  create,
  update,
  remove,
  replace,
  open,
  readVideo,
  uploads,
  readiness,
} = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  replace: vi.fn(),
  open: vi.fn(),
  readVideo: vi.fn(),
  /** Every `useSignedUpload(options)` call the render made. */
  uploads: [] as unknown[],
  /** What `useAssetReadiness` answers for the current case. */
  readiness: { value: { phase: 'waiting' } as Record<string, unknown> },
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

vi.mock('../../lesson-actions', () => ({
  createLessonAction: create,
  updateLessonAction: update,
  deleteLessonAction: remove,
  replaceMaterialsAction: replace,
  materialUrlAction: open,
  lessonVideoAction: readVideo,
}));

vi.mock('@/components/media/useSignedUpload', () => ({
  formatMediaLimit: (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`,
  useSignedUpload: (options: unknown) => {
    uploads.push(options);
    return {
      state: 'idle',
      progress: 0,
      error: null,
      pick: vi.fn(),
      reject: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

vi.mock('@/components/media/useAssetReadiness', () => ({
  useAssetReadiness: (assetId: string | null) => (assetId ? readiness.value : { phase: 'idle' }),
}));

vi.mock('@/components/media/VideoPlayer', () => ({
  VideoPlayer: ({ assetId, status }: { assetId: string; status: string }) => (
    <div data-testid="video-player-stub" data-asset={assetId} data-status={status} />
  ),
}));

const { LessonForm, sameOrder } = await import('./LessonForm');

const COURSE = '11111111-1111-4111-8111-111111111111';
const MODULE = '22222222-2222-4222-8222-222222222222';
const LESSON = '33333333-3333-4333-8333-333333333333';
const ASSET = '44444444-4444-4444-8444-444444444444';
const A1 = '55555555-5555-4555-8555-555555555555';
const A2 = '66666666-6666-4666-8666-666666666666';

const SAVED: LessonFormDefaults = {
  title: 'Pontos de aplicação',
  description: 'Onde marcar.',
  video: null,
  isFree: false,
  materials: [
    {
      assetId: A1,
      materialId: '77777777-7777-4777-8777-777777777777',
      filename: 'Protocolo.pdf',
      mime: 'application/pdf',
      bytes: 2_516_582,
    },
    {
      assetId: A2,
      materialId: '88888888-8888-4888-8888-888888888888',
      filename: 'Tabela.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: 184_320,
    },
  ],
};

function renderCreate(overrides: Record<string, unknown> = {}) {
  return render(
    <LessonForm
      mode="create"
      courseId={COURSE}
      moduleId={MODULE}
      moduleTitle="Fundamentos"
      modulePosition={1}
      hasProducts={true}
      {...overrides}
    />,
  );
}

function renderEdit(initial: LessonFormDefaults, overrides: Record<string, unknown> = {}) {
  return render(
    <LessonForm
      mode="edit"
      courseId={COURSE}
      lessonId={LESSON}
      moduleId={MODULE}
      moduleTitle="Fundamentos"
      modulePosition={2}
      hasProducts={true}
      initial={initial}
      {...overrides}
    />,
  );
}

const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const titleInput = () => document.getElementById('lesson-title') as HTMLInputElement;
const videoBlock = () => document.querySelector('[data-lesson-video]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  uploads.length = 0;
  readiness.value = { phase: 'waiting' };
});
afterEach(cleanup);

describe('sameOrder', () => {
  it('compares the asset ids in order', () => {
    const a = { assetId: A1, materialId: null, filename: '', mime: '', bytes: 0 };
    const b = { assetId: A2, materialId: null, filename: '', mime: '', bytes: 0 };
    expect(sameOrder([a, b], [a, b])).toBe(true);
    expect(sameOrder([a, b], [b, a])).toBe(false);
    expect(sameOrder([a], [a, b])).toBe(false);
  });
});

describe('LessonForm — create (UI-D-398, E09 empty / error)', () => {
  it('renders the header, the module subtitle, the empty video field with its helper, the switch off and 0/10 materials; the submit waits for a title', () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: 'Nova aula' })).toBeTruthy();
    expect(document.querySelector('[data-lesson-module]')?.textContent).toBe(
      'Módulo 1 · Fundamentos',
    );
    expect(submitButton().textContent).toBe('Criar aula');
    expect(submitButton().disabled).toBe(true);
    // E09 empty: the dropzone, "Enviar vídeo" and the helper; no player, no card.
    expect(videoBlock().dataset.videoState).toBe('empty');
    expect(screen.getByTestId('video-upload')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar vídeo' })).toBeTruthy();
    expect(
      screen.getByText('Opcional. Uma aula sem vídeo é uma aula prática: texto e materiais.'),
    ).toBeTruthy();
    expect(document.querySelector('[data-lesson-video-processing]')).toBeNull();
    // D-409: nothing about the video is typed — no URL field, no duration input.
    expect(document.querySelector('input[type="url"]')).toBeNull();
    expect(
      (screen.getByRole('switch', { name: 'Aula aberta' }) as HTMLButtonElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
    expect(document.querySelector('[data-materials-count]')?.textContent).toBe('0/10');
    expect(screen.queryByTestId('lesson-materials')).toBeNull();
    expect(document.querySelector('[data-lesson-remove]')).toBeNull();
  });

  it('the start bodies carry the lesson video purpose and the attachment purpose (D-409, D-410)', () => {
    renderCreate();
    expect(uploads).toContainEqual(expect.objectContaining({ kind: 'video', purpose: 'lesson' }));
    expect(uploads).toContainEqual(
      expect.objectContaining({ kind: 'file', purpose: 'attachment' }),
    );
  });

  it('saves a practice lesson without a video: the whole body, no materials write, the toast and the course page', async () => {
    create.mockResolvedValue({
      ok: true,
      lesson: { id: LESSON, moduleId: MODULE, title: 'Aula prática' },
    });
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Aula prática' } });
    expect(submitButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(COURSE, MODULE, {
      title: 'Aula prática',
      description: '',
      videoAssetId: null,
      isFree: false,
    });
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Aula criada.' }),
    );
    expect(push).toHaveBeenCalledWith(`/cursos/${COURSE}`);
  });

  it('an empty title is the field error and nothing is sent (E09 error)', async () => {
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'x' } });
    fireEvent.change(titleInput(), { target: { value: '   ' } });
    fireEvent.blur(titleInput());
    expect(screen.getByText('Dê um título à aula.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('a server title_required lands under the field; a generic refusal is the save toast', async () => {
    create.mockResolvedValueOnce({ ok: false, code: 'title_required' });
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Aula' } });
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(screen.getByText('Dê um título à aula.')).toBeTruthy());
    expect(push).not.toHaveBeenCalled();

    create.mockResolvedValueOnce({ ok: false, code: 'video_in_use' });
    fireEvent.change(titleInput(), { target: { value: 'Aula 2' } });
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível salvar. Revise os campos e tente novamente.',
      }),
    );
  });

  it('swaps the free helper on a course without products (D-407, E09 partial) and keeps the switch editable', () => {
    const gated = renderCreate({ hasProducts: true });
    expect(document.querySelector('[data-lesson-free-helper]')?.textContent).toBe(
      'Quem não tem o produto do curso pode assistir esta aula.',
    );
    gated.unmount();
    renderCreate({ hasProducts: false });
    expect(document.querySelector('[data-lesson-free-helper]')?.textContent).toBe(
      'Este curso é aberto: todas as aulas já são liberadas.',
    );
    const toggle = screen.getByRole('switch', { name: 'Aula aberta' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('a dirty close asks "Descartar aula?" and discarding leaves for the course page', async () => {
    renderCreate();
    fireEvent.change(titleInput(), { target: { value: 'Rascunho' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Descartar aula?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/cursos/${COURSE}`));
  });
});

describe('LessonForm — the video states (UI-D-398, D-409, E09 loading / partial / error)', () => {
  it('shows the processing card while the poll waits, and the form still saves (D-413)', async () => {
    update.mockResolvedValue({ ok: true, lesson: null });
    readiness.value = { phase: 'waiting' };
    renderEdit({
      ...SAVED,
      materials: [],
      video: { assetId: ASSET, status: 'processing', durationSeconds: null },
    });
    expect(videoBlock().dataset.videoState).toBe('processing');
    expect(document.querySelector('[data-lesson-video-processing]')).toBeTruthy();
    expect(screen.getByText('Processando o vídeo…')).toBeTruthy();
    expect(
      screen.getByText('Isso pode levar alguns minutos. Você pode salvar a aula e voltar depois.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('video-upload')).toBeNull();

    fireEvent.change(titleInput(), { target: { value: 'Pontos de aplicação (rev.)' } });
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // ONLY the changed key; the processing video is untouched.
    expect(update).toHaveBeenCalledWith(COURSE, LESSON, { title: 'Pontos de aplicação (rev.)' });
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' }),
    );
  });

  it('shows the player and "12:34" from the asset for a ready video, and "Remover vídeo" detaches it through the dialog', async () => {
    renderEdit({
      ...SAVED,
      materials: [],
      video: { assetId: ASSET, status: 'ready', durationSeconds: 754 },
    });
    expect(videoBlock().dataset.videoState).toBe('ready');
    const player = screen.getByTestId('video-player-stub');
    expect(player.dataset.asset).toBe(ASSET);
    expect(player.dataset.status).toBe('ready');
    const caption = document.querySelector('[data-lesson-video-duration]') as HTMLElement;
    expect(caption.querySelector('[aria-hidden]')?.textContent).toBe('12:34');
    expect(caption.textContent).toContain('Duração 12:34');

    fireEvent.click(screen.getByRole('button', { name: 'Remover vídeo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remover este vídeo?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    });
    await waitFor(() => expect(videoBlock().dataset.videoState).toBe('empty'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Vídeo removido.' });
    // The detach is a patch key on save.
    update.mockResolvedValue({ ok: true, lesson: null });
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(COURSE, LESSON, { videoAssetId: null }),
    );
  });

  it('once the poll answers ready the block reads the asset for its seconds and shows the player (never typed)', async () => {
    readiness.value = { phase: 'ready' };
    readVideo.mockResolvedValue({ ok: true, status: 'ready', durationSeconds: 65 });
    renderEdit({
      ...SAVED,
      materials: [],
      video: { assetId: ASSET, status: 'pending', durationSeconds: null },
    });
    await waitFor(() => expect(videoBlock().dataset.videoState).toBe('ready'));
    expect(readVideo).toHaveBeenCalledWith(ASSET);
    await waitFor(() =>
      expect(
        document.querySelector('[data-lesson-video-duration] [aria-hidden]')?.textContent,
      ).toBe('1:05'),
    );
  });

  it('a duration_too_long rejection shows the shipped sentence with the 4 h lesson cap and a retry that brings the field back', async () => {
    readiness.value = { phase: 'failed', issue: 'duration_too_long' };
    renderEdit({
      ...SAVED,
      materials: [],
      video: { assetId: ASSET, status: 'processing', durationSeconds: null },
    });
    await waitFor(() => expect(videoBlock().dataset.videoState).toBe('failed'));
    expect(screen.getByRole('alert').textContent).toBe('Vídeo muito longo. O limite é 4 h.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(videoBlock().dataset.videoState).toBe('empty'));
    expect(screen.getByTestId('video-upload')).toBeTruthy();
  });

  it('a failed transcode shows "Não foi possível processar este vídeo."', async () => {
    readiness.value = { phase: 'failed', issue: 'transcode_failed' };
    renderEdit({
      ...SAVED,
      materials: [],
      video: { assetId: ASSET, status: 'processing', durationSeconds: null },
    });
    await waitFor(() => expect(videoBlock().dataset.videoState).toBe('failed'));
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível processar este vídeo.');
  });
});

describe('LessonForm — edit: materials, the switch and the remove row (UI-D-399, D-407, D-410)', () => {
  it('lists the saved materials with kind · size, saves a reorder as ONE whole-set write, and opens a saved row through a fresh URL', async () => {
    replace.mockResolvedValue({ ok: true, lesson: null });
    open.mockResolvedValue({ ok: true, url: 'https://storage.local/x?token=abc', expiresAt: '' });
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderEdit(SAVED);
    expect(document.querySelector('[data-materials-count]')?.textContent).toBe('2/10');
    const metas = Array.from(document.querySelectorAll('[data-material-meta]')).map(
      (node) => node.textContent,
    );
    expect(metas).toEqual(['PDF · 2,4 MB', 'Planilha · 180 KB']);
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Mover para cima: Tabela.xlsx' }));
    expect(submitButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(COURSE, LESSON, [A2, A1]));
    expect(update).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Alterações salvas.' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Protocolo.pdf' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(LESSON, SAVED.materials[0]?.materialId));
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith(
        'https://storage.local/x?token=abc',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    opened.mockRestore();
  });

  it('WR-07: the tab opens INSIDE the tap (before the action resolves), loses its opener and is navigated to the fresh URL; a refusal closes it', async () => {
    let resolveUrl: (value: unknown) => void = () => undefined;
    open.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUrl = resolve;
        }),
    );
    const tab = { opener: window as unknown, close: vi.fn(), location: { href: '' } };
    const opened = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
    renderEdit(SAVED);
    fireEvent.click(screen.getByRole('button', { name: 'Protocolo.pdf' }));
    // Synchronously, in the gesture: a blank tab, already cut off from this one.
    expect(opened).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    await act(async () => {
      resolveUrl({ ok: true, url: 'https://storage.local/x?token=abc', expiresAt: '' });
    });
    await waitFor(() => expect(tab.location.href).toBe('https://storage.local/x?token=abc'));
    expect(opened).toHaveBeenCalledTimes(1);

    // A refused mint closes the blank tab and toasts.
    open.mockResolvedValue({ ok: false, code: 'not_found' });
    fireEvent.click(screen.getByRole('button', { name: 'Protocolo.pdf' }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    opened.mockRestore();
  });

  it('too_many_materials from the server lands under the list', async () => {
    replace.mockResolvedValue({ ok: false, code: 'too_many_materials' });
    renderEdit(SAVED);
    fireEvent.click(screen.getByRole('button', { name: 'Remover Protocolo.pdf' }));
    expect(document.querySelector('[data-materials-count]')?.textContent).toBe('1/10');
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() =>
      expect(document.querySelector('[data-materials-error]')?.textContent).toBe(
        'Você pode anexar até 10 arquivos.',
      ),
    );
  });

  it('toggling "Aula aberta" saves only the flag', async () => {
    update.mockResolvedValue({ ok: true, lesson: null });
    renderEdit(SAVED);
    fireEvent.click(screen.getByRole('switch', { name: 'Aula aberta' }));
    await act(async () => {
      fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(update).toHaveBeenCalledWith(COURSE, LESSON, { isFree: true }));
    expect(replace).not.toHaveBeenCalled();
  });

  it('"Remover aula" → the danger dialog → the action, the toast and the course page', async () => {
    remove.mockResolvedValue({ ok: true, lesson: null });
    renderEdit(SAVED);
    expect(screen.getByRole('heading', { name: 'Editar aula' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover aula' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remover aula?' });
    expect(
      within(dialog).getByText(
        'A aula sai do curso. O progresso de quem já assistiu fica guardado.',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    });
    await waitFor(() => expect(remove).toHaveBeenCalledWith(COURSE, LESSON));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Aula removida.' }),
    );
    expect(push).toHaveBeenCalledWith(`/cursos/${COURSE}`);
  });
});
