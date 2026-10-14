// @vitest-environment happy-dom
import type { CourseDetail, ModuleView } from '@rede-social/module-courses/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.3-08 — the curriculum editor and the publish zone (UI-D-394..397, D-406, D-413, D-414), against
 * the REAL merged pt-BR catalogs through next-intl's own `createTranslator`. Stubbed: the server
 * actions, the router, the toast and the readiness poll. Real: the editor, the sheet, the module's
 * `ReorderList` / `ModuleCard` / `LessonRow` / `PublishBlockedNotice`, the shipped `BottomSheet`,
 * `ConfirmDialog` and inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, push, refresh, reorderModules, reorderLessons, create, update, remove, setStatus } =
  vi.hoisted(() => ({
    toast: { show: vi.fn(), dismiss: vi.fn() },
    push: vi.fn(),
    refresh: vi.fn(),
    reorderModules: vi.fn(),
    reorderLessons: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
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

vi.mock('../curriculum-actions', () => ({
  reorderModulesAction: reorderModules,
  reorderLessonsAction: reorderLessons,
  createModuleAction: create,
  updateModuleAction: update,
  deleteModuleAction: remove,
}));

vi.mock('../course-actions', () => ({ setCourseStatusAction: setStatus }));

vi.mock('@/components/media/useAssetReadiness', () => ({
  useAssetReadiness: () => ({ phase: 'waiting' }),
}));

const { CurriculumEditor } = await import('./CurriculumEditor');
const { CoursePage } = await import('./CoursePage');

const COURSE = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const M2 = '33333333-3333-4333-8333-333333333333';
const L1 = '44444444-4444-4444-8444-444444444444';
const L2 = '55555555-5555-4555-8555-555555555555';
const L3 = '66666666-6666-4666-8666-666666666666';
const ASSET = '77777777-7777-4777-8777-777777777777';

const MODULES: ModuleView[] = [
  {
    id: M1,
    title: 'Fundamentos',
    summary: '',
    position: 1,
    requiresPrevious: false,
    lessonCount: 2,
    durationSeconds: 0,
    lessons: [
      {
        id: L1,
        moduleId: M1,
        title: 'Pontos de aplicação',
        description: '',
        position: 1,
        isFree: false,
        videoAssetId: ASSET,
        videoStatus: 'processing',
        durationSeconds: null,
      },
      {
        id: L2,
        moduleId: M1,
        title: 'Protocolo impresso',
        description: '',
        position: 2,
        isFree: true,
        videoAssetId: null,
        videoStatus: 'none',
        durationSeconds: null,
      },
    ],
  },
  {
    id: M2,
    title: 'Técnica',
    summary: 'Resumo da técnica.',
    position: 2,
    requiresPrevious: true,
    lessonCount: 1,
    durationSeconds: 902,
    lessons: [
      {
        id: L3,
        moduleId: M2,
        title: 'Marcação segura',
        description: '',
        position: 1,
        isFree: false,
        videoAssetId: ASSET,
        videoStatus: 'ready',
        durationSeconds: 902,
      },
    ],
  },
];

function course(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: COURSE,
    title: 'Harmonização facial do zero',
    tagline: 'Do primeiro ponto ao resultado natural.',
    description: '',
    category: null,
    level: 'iniciante',
    coverAssetId: null,
    instructorName: 'Dra. Ana Souza',
    instructorPhotoAssetId: null,
    outcomes: [],
    certificateHours: 12,
    status: 'draft',
    publishedAt: null,
    archivedAt: null,
    createdAt: '2026-10-13T12:00:00.000Z',
    products: [],
    modules: MODULES,
    moduleCount: 2,
    lessonCount: 3,
    durationSeconds: 902,
    hasUnreadyVideo: true,
    unreadyLessonIds: [L1],
    ...overrides,
  };
}

const moveUp = (name: string) => screen.getByRole('button', { name: `Mover para cima: ${name}` });
const moveDown = (name: string) =>
  screen.getByRole('button', { name: `Mover para baixo: ${name}` });
const numerals = () =>
  Array.from(document.querySelectorAll('[data-testid="module-card-numeral"]')).map(
    (node) => node.querySelector('[aria-hidden]')?.textContent,
  );
const titles = () =>
  Array.from(document.querySelectorAll('[data-testid="module-card-title"]')).map(
    (node) => node.textContent,
  );
const publishButton = () => screen.getByTestId('course-publish') as HTMLButtonElement;

function renderEditor(modules: ModuleView[] = MODULES) {
  return render(
    <CurriculumEditor
      courseId={COURSE}
      courseTitle="Harmonização facial do zero"
      modules={modules}
      thumbnails={{ [L3]: 'https://image.example/poster.jpg' }}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('CurriculumEditor (UI-D-395, UI-D-397)', () => {
  it('1. renders the module cards in order with numerals, the lock caption only on a later module, the meta, the lesson rows and Nova aula', () => {
    renderEditor();
    expect(screen.getByRole('heading', { name: 'Módulos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo módulo' })).toBeTruthy();
    const list = screen.getByRole('list', {
      name: 'Módulos de Harmonização facial do zero',
    });
    expect(list.tagName).toBe('OL');
    expect(numerals()).toEqual(['1', '2']);
    expect(titles()).toEqual(['Fundamentos', 'Técnica']);
    const locks = document.querySelectorAll('[data-testid="module-card-lock"]');
    expect(locks).toHaveLength(1);
    expect(locks[0]?.textContent).toBe('Exige o anterior');
    const metas = Array.from(document.querySelectorAll('[data-testid="module-card-meta"]')).map(
      (node) => node.textContent,
    );
    expect(metas).toEqual(['2 aulas', '1 aula · 15 min']);
    expect(screen.getByRole('button', { name: 'Editar módulo: Fundamentos' })).toBeTruthy();

    // The lesson lists are named by their module; rows link to the lesson form.
    const lessons = screen.getByRole('list', { name: 'Aulas de Fundamentos' });
    const rows = within(lessons).getAllByTestId('lesson-row');
    expect(rows).toHaveLength(2);
    expect(
      within(lessons).getByRole('link', { name: 'Pontos de aplicação, Processando' }),
    ).toBeTruthy();
    expect(within(lessons).getByTestId('lesson-row-pill').textContent).toBe('Processando');
    expect(within(lessons).getAllByTestId('lesson-row-meta')[0]?.textContent).toBe(
      'Prática · Aula aberta',
    );
    expect(within(lessons).getByRole('link', { name: 'Protocolo impresso' })).toBeTruthy();
    const tecnica = screen.getByRole('list', { name: 'Aulas de Técnica' });
    expect(within(tecnica).getByTestId('lesson-row-meta').textContent).toBe('15:02');
    expect(within(tecnica).getByTestId('lesson-row-thumb').getAttribute('data-thumb')).toBe(
      'poster',
    );

    const newLessons = screen.getAllByRole('link', { name: 'Nova aula' });
    expect(newLessons.map((link) => link.getAttribute('href'))).toEqual([
      `/cursos/${COURSE}/aulas/nova?modulo=${M1}`,
      `/cursos/${COURSE}/aulas/nova?modulo=${M2}`,
    ]);
    // Zero-one-many: the ends are disabled.
    expect((moveUp('Fundamentos') as HTMLButtonElement).disabled).toBe(true);
    expect((moveDown('Técnica') as HTMLButtonElement).disabled).toBe(true);
    expect((moveUp('Marcação segura') as HTMLButtonElement).disabled).toBe(true);
    expect((moveDown('Marcação segura') as HTMLButtonElement).disabled).toBe(true);
  });

  it('2. a module arrow writes the WHOLE order at once; every arrow of the list is disabled until the write answers; the server answer re-seeds', async () => {
    let answer: ((value: unknown) => void) | undefined;
    reorderModules.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderEditor();

    fireEvent.click(moveUp('Técnica'));
    // Optimistic: the numerals and the order swapped at once; the list is busy.
    expect(titles()).toEqual(['Técnica', 'Fundamentos']);
    expect(numerals()).toEqual(['1', '2']);
    expect(reorderModules).toHaveBeenCalledWith(COURSE, [M2, M1]);
    for (const name of ['Técnica', 'Fundamentos']) {
      expect((moveUp(name) as HTMLButtonElement).disabled).toBe(true);
      expect((moveDown(name) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId('curriculum-modules').getAttribute('aria-busy')).toBe('true');
    // The lesson lists save on their own: their arrows stay as they were.
    expect((moveDown('Pontos de aplicação') as HTMLButtonElement).disabled).toBe(false);

    // The server answers the modules in the NEW order (Técnica first).
    await act(async () => {
      answer?.({ ok: true, items: [MODULES[1], MODULES[0]] });
    });
    await waitFor(() => expect((moveDown('Técnica') as HTMLButtonElement).disabled).toBe(false));
    expect((moveUp('Técnica') as HTMLButtonElement).disabled).toBe(true);
    expect(titles()).toEqual(['Técnica', 'Fundamentos']);
    // D-406 with the draft's index: Técnica is first now, so its lock caption is gone.
    expect(document.querySelectorAll('[data-testid="module-card-lock"]')).toHaveLength(0);
    // Success: no toast (the live region announced the move).
    expect(toast.show).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole('status')
        .some((node) => node.textContent?.includes('Técnica agora está na posição 1 de 2.')),
    ).toBe(true);
  });

  it('3. a failure restores the previous order and toasts', async () => {
    reorderModules.mockResolvedValue({ ok: false, code: 'generic' });
    renderEditor();
    fireEvent.click(moveUp('Técnica'));
    expect(titles()).toEqual(['Técnica', 'Fundamentos']);
    await waitFor(() => expect(titles()).toEqual(['Fundamentos', 'Técnica']));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar a nova ordem. Tente novamente.',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('4. order_stale toasts why and refreshes the page', async () => {
    reorderModules.mockResolvedValue({ ok: false, code: 'order_stale' });
    renderEditor();
    fireEvent.click(moveDown('Fundamentos'));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'A lista mudou. Confira a ordem e tente de novo.',
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('5. a lesson arrow writes the module’s whole lesson order', async () => {
    reorderLessons.mockResolvedValue({
      ok: true,
      items: [MODULES[0]?.lessons[1], MODULES[0]?.lessons[0]],
    });
    renderEditor();
    fireEvent.click(moveDown('Pontos de aplicação'));
    expect(reorderLessons).toHaveBeenCalledWith(COURSE, M1, [L2, L1]);
    await waitFor(() =>
      expect((moveDown('Pontos de aplicação') as HTMLButtonElement).disabled).toBe(true),
    );
    const lessons = screen.getByRole('list', { name: 'Aulas de Fundamentos' });
    expect(
      within(lessons)
        .getAllByTestId('lesson-row-title')
        .map((node) => node.textContent),
    ).toEqual(['Protocolo impresso', 'Pontos de aplicação']);
    expect(reorderModules).not.toHaveBeenCalled();
  });

  it('6. the first module’s sheet has the switch DISABLED with "Este é o primeiro módulo."; the second’s is enabled and on; Novo módulo opens the create sheet focused on the title', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Editar módulo: Fundamentos' }));
    let sheet = screen.getByRole('dialog', { name: 'Editar módulo' });
    let toggle = within(sheet).getByRole('switch', {
      name: 'Exige concluir o módulo anterior',
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(sheet.querySelector('[data-module-requires-helper]')?.textContent).toBe(
      'Este é o primeiro módulo.',
    );
    expect((document.getElementById('module-title') as HTMLInputElement).value).toBe('Fundamentos');
    expect(within(sheet).getByRole('button', { name: 'Remover módulo' })).toBeTruthy();
    expect((sheet.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Editar módulo: Técnica' }));
    sheet = screen.getByRole('dialog', { name: 'Editar módulo' });
    toggle = within(sheet).getByRole('switch', {
      name: 'Exige concluir o módulo anterior',
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(sheet.querySelector('[data-module-requires-helper]')?.textContent).toBe(
      'Vale a partir da área de membros. O primeiro módulo nunca fica bloqueado.',
    );
    expect((document.getElementById('module-summary') as HTMLTextAreaElement).value).toBe(
      'Resumo da técnica.',
    );
    expect(sheet.textContent).toContain('18/500');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Novo módulo' }));
    sheet = screen.getByRole('dialog', { name: 'Novo módulo' });
    expect((document.getElementById('module-title') as HTMLInputElement).maxLength).toBe(120);
    expect(sheet.querySelector('button[type="submit"]')?.textContent).toContain('Criar módulo');
    expect(within(sheet).queryByRole('button', { name: 'Remover módulo' })).toBeNull();
    // The third module would not be first: the switch is enabled and off.
    expect((within(sheet).getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById('module-title')),
    );
  });

  it('7. creating a module through the sheet appends its card and toasts Módulo criado.; removing one through the danger dialog drops it and toasts Módulo removido.', async () => {
    const created: ModuleView = {
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Finalização',
      summary: '',
      position: 3,
      requiresPrevious: false,
      lessonCount: 0,
      durationSeconds: 0,
      lessons: [],
    };
    create.mockResolvedValue({ ok: true, module: created });
    remove.mockResolvedValue({ ok: true, module: null });
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Novo módulo' }));
    const sheet = screen.getByRole('dialog', { name: 'Novo módulo' });
    fireEvent.change(document.getElementById('module-title') as HTMLInputElement, {
      target: { value: 'Finalização' },
    });
    fireEvent.submit(sheet.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(COURSE, {
        title: 'Finalização',
        summary: '',
        requiresPrevious: false,
      }),
    );
    await waitFor(() => expect(titles()).toEqual(['Fundamentos', 'Técnica', 'Finalização']));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Módulo criado.' });
    expect(numerals()).toEqual(['1', '2', '3']);
    // A module with no lesson: the ghost row above Nova aula.
    expect(screen.getByTestId('curriculum-no-lessons').textContent).toBe(
      'Nenhuma aula neste módulo.',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Editar módulo: Técnica' }));
    const edit = screen.getByRole('dialog', { name: 'Editar módulo' });
    fireEvent.click(within(edit).getByRole('button', { name: 'Remover módulo' }));
    const dialog = screen.getByRole('dialog', { name: 'Remover módulo?' });
    expect(dialog.textContent).toContain(
      'As aulas deste módulo saem do curso junto com ele. O progresso de quem já assistiu fica guardado.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(COURSE, M2));
    await waitFor(() => expect(titles()).toEqual(['Fundamentos', 'Finalização']));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Módulo removido.' });
  });

  it('8. with no module the EmptyState offers Criar módulo, which opens the sheet', () => {
    renderEditor([]);
    const empty = screen.getByTestId('curriculum-empty');
    expect(within(empty).getByRole('heading', { name: 'Nenhum módulo ainda' })).toBeTruthy();
    expect(empty.textContent).toContain('Crie o primeiro módulo e adicione aulas a ele.');
    fireEvent.click(within(empty).getByRole('button', { name: 'Criar módulo' }));
    const sheet = screen.getByRole('dialog', { name: 'Novo módulo' });
    // The first module ever: the switch is present but disabled.
    expect((within(sheet).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CoursePage / PublishZone (UI-D-394, D-413)', () => {
  function renderPage(overrides: Partial<CourseDetail> = {}, gated: string[] = []) {
    return render(
      <CoursePage
        course={course(overrides)}
        thumbnails={{}}
        publishedAtLabel={overrides.status === 'published' ? '9 de outubro de 2026' : null}
        gatedProducts={gated}
      />,
    );
  }

  it('9. a draft with an unready video: the notice names the lesson as a link and Publicar curso is DISABLED; the header, hero fallback, pills and instructor line render', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Harmonização facial do zero' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para Cursos' }).getAttribute('href')).toBe(
      '/cursos',
    );
    expect(screen.getByRole('link', { name: 'Editar curso' }).getAttribute('href')).toBe(
      `/cursos/${COURSE}/editar`,
    );
    expect(screen.getByTestId('course-hero-fallback').className).toContain('aspect-[16/10]');
    expect(screen.getByTestId('course-tagline').textContent).toBe(
      'Do primeiro ponto ao resultado natural.',
    );
    expect(screen.getByTestId('course-status-pill').textContent).toBe('Rascunho');
    expect(screen.getByTestId('course-level-pill').textContent).toBe('Iniciante');
    expect(screen.getByTestId('course-hours-pill').textContent).toBe('12 h');
    expect(screen.getByTestId('course-instructor').textContent).toBe('Com Dra. Ana Souza');

    const notice = screen.getByTestId('publish-blocked');
    expect(notice.getAttribute('role')).toBe('status');
    expect(
      within(notice).getByText('Não é possível publicar: 1 aula ainda processa o vídeo.'),
    ).toBeTruthy();
    expect(
      within(notice).getByRole('link', { name: 'Pontos de aplicação' }).getAttribute('href'),
    ).toBe(`/cursos/${COURSE}/aulas/${L1}`);
    expect(publishButton().disabled).toBe(true);
    expect(publishButton().textContent).toContain('Publicar curso');
    expect(screen.queryByTestId('course-unpublish')).toBeNull();
  });

  it('10. every video ready: no notice, the button enabled; no level or hours → no pill; published → Despublicar with the caption; archived → the note and no button', () => {
    renderPage({
      hasUnreadyVideo: false,
      unreadyLessonIds: [],
      level: null,
      certificateHours: null,
    });
    expect(screen.queryByTestId('publish-blocked')).toBeNull();
    expect(publishButton().disabled).toBe(false);
    expect(screen.queryByTestId('course-level-pill')).toBeNull();
    expect(screen.queryByTestId('course-hours-pill')).toBeNull();
    cleanup();

    renderPage({
      status: 'published',
      publishedAt: '2026-10-09T12:00:00.000Z',
      hasUnreadyVideo: false,
      unreadyLessonIds: [],
    });
    expect(screen.queryByTestId('course-publish')).toBeNull();
    const unpublish = screen.getByTestId('course-unpublish');
    expect(unpublish.textContent).toContain('Despublicar');
    expect(unpublish.className).toContain('border');
    expect(screen.getByTestId('course-published-at').textContent).toBe(
      'Publicado em 9 de outubro de 2026.',
    );
    expect(screen.getByTestId('course-status-pill').textContent).toBe('Publicado');
    cleanup();

    renderPage({ status: 'archived', archivedAt: '2026-10-10T12:00:00.000Z' });
    expect(screen.getByTestId('course-archived-note').textContent).toBe(
      'Este curso foi arquivado. Ele não aparece para os membros.',
    );
    expect(screen.queryByTestId('course-publish')).toBeNull();
    expect(screen.queryByTestId('course-unpublish')).toBeNull();
    // The header's edit control still works on an archived course (A-UI-3).
    expect(screen.getByRole('link', { name: 'Editar curso' })).toBeTruthy();
  });

  it('11. Publicar curso? confirms (the gated body only with products) → published → toast and refresh', async () => {
    setStatus.mockResolvedValue({ ok: true, courseId: COURSE, status: 'published' });
    renderPage({ hasUnreadyVideo: false, unreadyLessonIds: [] }, ['Mentoria em grupo', 'Clube']);
    fireEvent.click(publishButton());
    const dialog = screen.getByRole('dialog', { name: 'Publicar curso?' });
    expect(dialog.textContent).toContain(
      'Os membros com Mentoria em grupo e Clube passam a ver o curso; os demais veem só as aulas abertas.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(COURSE, 'published'));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Curso publicado.' }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();

    vi.clearAllMocks();
    renderPage({ hasUnreadyVideo: false, unreadyLessonIds: [] });
    fireEvent.click(publishButton());
    expect(screen.getByRole('dialog', { name: 'Publicar curso?' }).textContent).toContain(
      'Os membros passam a ver o curso no catálogo.',
    );
  });

  it('12. a 409 video_not_ready after the confirm re-renders the notice from the SERVER’s lesson ids, toasts the same sentence and disables the button', async () => {
    setStatus.mockResolvedValue({ ok: false, code: 'video_not_ready', lessonIds: [L3] });
    renderPage({ hasUnreadyVideo: false, unreadyLessonIds: [] });
    expect(screen.queryByTestId('publish-blocked')).toBeNull();
    fireEvent.click(publishButton());
    const dialog = screen.getByRole('dialog', { name: 'Publicar curso?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(screen.getByTestId('publish-blocked')).toBeTruthy());
    const notice = screen.getByTestId('publish-blocked');
    expect(within(notice).getByRole('link', { name: 'Marcação segura' })).toBeTruthy();
    expect(within(notice).queryByRole('link', { name: 'Pontos de aplicação' })).toBeNull();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não é possível publicar: 1 aula ainda processa o vídeo.',
    });
    expect(publishButton().disabled).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(notice));
  });

  it('13. Despublicar curso? (danger) → draft → toast; a refusal after confirm toasts and keeps the screen', async () => {
    setStatus.mockResolvedValue({ ok: true, courseId: COURSE, status: 'draft' });
    renderPage({
      status: 'published',
      publishedAt: '2026-10-09T12:00:00.000Z',
      hasUnreadyVideo: false,
      unreadyLessonIds: [],
    });
    fireEvent.click(screen.getByTestId('course-unpublish'));
    const dialog = screen.getByRole('dialog', { name: 'Despublicar curso?' });
    expect(dialog.textContent).toContain(
      'Ele volta a rascunho e some do catálogo até ser publicado de novo.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Despublicar' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(COURSE, 'draft'));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Curso despublicado.' }),
    );
    cleanup();

    vi.clearAllMocks();
    setStatus.mockResolvedValue({ ok: false, code: 'generic' });
    renderPage({
      status: 'published',
      publishedAt: '2026-10-09T12:00:00.000Z',
      hasUnreadyVideo: false,
      unreadyLessonIds: [],
    });
    fireEvent.click(screen.getByTestId('course-unpublish'));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Despublicar curso?' })).getByRole('button', {
        name: 'Despublicar',
      }),
    );
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível salvar. Revise os campos e tente novamente.',
      }),
    );
    expect(screen.getByTestId('course-unpublish')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
