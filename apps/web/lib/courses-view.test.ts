import { fileURLToPath } from 'node:url';
import { ATTACHMENT_MIMES } from '@rede-social/contracts/media';
import type {
  CourseRow,
  LessonDetail,
  LessonView,
  LiveDetail,
  TrackDetail,
} from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  COURSE_FILTER_ORDER,
  CURRICULUM_SECTION_ID,
  courseFilterFromParam,
  courseFilterHref,
  courseRowView,
  formatBytes,
  formatCourseDuration,
  formatHours,
  formatLessonDuration,
  formatLiveDate,
  formatPublishedAt,
  groupLessonsForPicker,
  instantToTenantWallClock,
  LIVE_FILTER_ORDER,
  lessonFormDefaults,
  lessonHref,
  lessonRowView,
  liveFilterFromParam,
  liveFilterHref,
  liveFormDefaults,
  liveRowView,
  materialKindsSentence,
  materialRowView,
  moduleCardView,
  newLessonHref,
  PUBLISH_BLOCKED_LINKS,
  publishBlockedLessons,
  publishBlockedView,
  publishedTrackCourseIds,
  TRACK_FILTER_ORDER,
  tenantWallClockToInstant,
  trackFilterFromParam,
  trackFilterHref,
  trackFormDefaults,
  trackRowView,
} from './courses-view';

/**
 * 08.3-06 — the ONE courses formatter (UI-D-410, UI-D-392). Durations and sizes are built from the
 * asset's integers; the web never rounds a count and never sorts (P09, P29).
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof courseRowView>[1];

const C = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';

function row(overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    id: C,
    title: 'Harmonização facial do zero',
    status: 'draft',
    coverAssetId: null,
    categoryName: null,
    level: null,
    moduleCount: 2,
    lessonCount: 6,
    durationSeconds: 0,
    hasUnreadyVideo: false,
    createdAt: '2026-10-13T12:00:00.000Z',
    publishedAt: null,
    ...overrides,
  };
}

describe('formatCourseDuration (UI-D-410)', () => {
  it('omits zero, says minutes under an hour, hours and minutes above', () => {
    expect(formatCourseDuration(0)).toBe('');
    expect(formatCourseDuration(-5)).toBe('');
    expect(formatCourseDuration(2700)).toBe('45 min');
    expect(formatCourseDuration(8100)).toBe('2 h 15 min');
    expect(formatCourseDuration(3600)).toBe('1 h');
  });

  it('rounds to the nearest minute and never prints "0 min" for a positive length', () => {
    expect(formatCourseDuration(20)).toBe('1 min');
    expect(formatCourseDuration(89)).toBe('1 min');
    expect(formatCourseDuration(90)).toBe('2 min');
    expect(formatCourseDuration(3570)).toBe('1 h');
  });
});

describe('formatLessonDuration (UI-D-410, D-409)', () => {
  it('reads mm:ss under an hour and h:mm:ss above', () => {
    expect(formatLessonDuration(754)).toBe('12:34');
    expect(formatLessonDuration(65)).toBe('1:05');
    expect(formatLessonDuration(5)).toBe('0:05');
    expect(formatLessonDuration(3661)).toBe('1:01:01');
    expect(formatLessonDuration(3600)).toBe('1:00:00');
  });
});

describe('formatHours', () => {
  it('is the integer with the unit', () => {
    expect(formatHours(12)).toBe('12 h');
    expect(formatHours(0)).toBe('0 h');
  });
});

describe('formatBytes (P29, UI-D-410)', () => {
  it('binary units, one decimal, pt-BR comma, the formatMediaLimit labels', () => {
    expect(formatBytes(2_516_582)).toBe('2,4 MB');
    expect(formatBytes(184_320)).toBe('180 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1,5 GB');
  });
});

describe('courseFilterFromParam / courseFilterHref (UI-D-391, E03 partial)', () => {
  it('maps the four pt-BR chip values; anything else reads as Todos', () => {
    expect(courseFilterFromParam(undefined)).toBe('all');
    expect(courseFilterFromParam('todos')).toBe('all');
    expect(courseFilterFromParam('rascunhos')).toBe('draft');
    expect(courseFilterFromParam('publicados')).toBe('published');
    expect(courseFilterFromParam('arquivados')).toBe('archived');
    expect(courseFilterFromParam('qualquer')).toBe('all');
    expect(courseFilterFromParam(['rascunhos', 'publicados'])).toBe('all');
    expect(courseFilterFromParam('constructor')).toBe('all');
  });

  it('builds the chip hrefs in the P57 order', () => {
    expect(COURSE_FILTER_ORDER).toEqual(['all', 'draft', 'published', 'archived']);
    expect(courseFilterHref('all')).toBe('/cursos');
    expect(courseFilterHref('draft')).toBe('/cursos?filtro=rascunhos');
    expect(courseFilterHref('published')).toBe('/cursos?filtro=publicados');
    expect(courseFilterHref('archived')).toBe('/cursos?filtro=arquivados');
  });
});

describe('courseRowView (UI-D-392)', () => {
  it('a draft with no ready video: counts only, the Rascunho pill, the "{title}, {status}" name', () => {
    const view = courseRowView(row(), t);
    expect(view).toEqual({
      id: C,
      href: `/cursos/${C}`,
      title: 'Harmonização facial do zero',
      meta: '2 módulos · 6 aulas',
      pills: [{ label: 'Rascunho', tone: 'neutral' }],
      ariaLabel: 'Harmonização facial do zero, Rascunho',
      coverAssetId: null,
      coverAlt: 'Capa do curso Harmonização facial do zero',
    });
  });

  it('a published course with ready videos: the duration joins the meta and the pill is success', () => {
    const view = courseRowView(
      row({
        status: 'published',
        moduleCount: 4,
        lessonCount: 18,
        durationSeconds: 8100,
        coverAssetId: A,
      }),
      t,
    );
    expect(view.meta).toBe('4 módulos · 18 aulas · 2 h 15 min');
    expect(view.pills).toEqual([{ label: 'Publicado', tone: 'success' }]);
    expect(view.ariaLabel).toBe('Harmonização facial do zero, Publicado');
    expect(view.coverAssetId).toBe(A);
  });

  it('a draft with an unready video: two pills, status first then Processando (warning)', () => {
    const view = courseRowView(row({ hasUnreadyVideo: true }), t);
    expect(view.pills).toEqual([
      { label: 'Rascunho', tone: 'neutral' },
      { label: 'Processando', tone: 'warning' },
    ]);
    // The accessible name carries the status alone; the second pill is read as a sibling.
    expect(view.ariaLabel).toBe('Harmonização facial do zero, Rascunho');
  });

  it('an archived course is neutral; singulars pluralise 1 módulo · 1 aula', () => {
    const view = courseRowView(row({ status: 'archived', moduleCount: 1, lessonCount: 1 }), t);
    expect(view.pills).toEqual([{ label: 'Arquivado', tone: 'neutral' }]);
    expect(view.meta).toBe('1 módulo · 1 aula');
  });
});

describe('trackRowView and liveRowView scaffolds (UI-D-392, plans 10 and 11)', () => {
  it('a track: "{N} cursos" with the =0 form, Arquivada only when archived', () => {
    const active = trackRowView(
      {
        id: C,
        title: 'Do zero ao atendimento',
        status: 'active',
        coverAssetId: null,
        courseCount: 3,
      },
      t,
    );
    expect(active.href).toBe(`/cursos/trilhas/${C}`);
    expect(active.meta).toBe('3 cursos');
    expect(active.pills).toEqual([]);
    const none = trackRowView(
      { id: C, title: 'T', status: 'archived', coverAssetId: null, courseCount: 0 },
      t,
    );
    expect(none.meta).toBe('Nenhum curso');
    expect(none.pills).toEqual([{ label: 'Arquivada', tone: 'neutral' }]);
    expect(none.ariaLabel).toBe('T, Arquivada');
  });

  it('a live: the tenant-zone date line and the derived pill; Ao vivo is the only success', () => {
    const live = {
      id: C,
      title: 'Tira-dúvidas de outubro',
      coverAssetId: null,
      // 22:00 UTC on the 16th is 19:00 in São Paulo (UTC-3) the same day.
      startsAt: '2026-10-16T22:00:00.000Z',
      durationMin: 60,
    };
    const scheduled = liveRowView(
      { ...live, status: 'scheduled' },
      { timezone: 'America/Sao_Paulo' },
      t,
    );
    expect(scheduled.href).toBe(`/cursos/lives/${C}`);
    expect(scheduled.meta).toBe('sex, 16 de out, 19:00 · 60 min');
    expect(scheduled.pills).toEqual([{ label: 'Agendada', tone: 'neutral' }]);
    const onAir = liveRowView({ ...live, status: 'live' }, { timezone: 'Europe/Lisbon' }, t);
    expect(onAir.meta).toBe('sex, 16 de out, 23:00 · 60 min');
    expect(onAir.pills).toEqual([{ label: 'Ao vivo', tone: 'success' }]);
    expect(liveRowView({ ...live, status: 'cancelled' }, { timezone: 'UTC' }, t).pills).toEqual([
      { label: 'Cancelada', tone: 'neutral' },
    ]);
  });
});

/* ── 08.3-08: the course page and the curriculum editor (UI-D-394, UI-D-395) ─────────────────── */

const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';

function lesson(overrides: Partial<LessonView> = {}): LessonView {
  return {
    id: L1,
    moduleId: A,
    title: 'Anatomia da região',
    description: '',
    position: 1,
    isFree: false,
    requiresPrevious: false,
    videoAssetId: null,
    videoStatus: 'none',
    durationSeconds: null,
    ...overrides,
  };
}

describe('moduleCardView (UI-D-395)', () => {
  const module = {
    title: 'Fundamentos',
    requiresPrevious: true,
    lessonCount: 3,
    durationSeconds: 2520,
  };

  it('names the numeral, says the lock only after the first module, and appends the duration when any video is ready', () => {
    const second = moduleCardView(module, 2, t);
    expect(second.positionLabel).toBe('Módulo 2');
    expect(second.requiresPreviousLabel).toBe('Exige o anterior');
    expect(second.meta).toBe('3 aulas · 42 min');
    expect(second.editLabel).toBe('Editar módulo: Fundamentos');

    // D-406: the first module never shows the caption, whatever the stored flag says.
    const first = moduleCardView(module, 1, t);
    expect(first.positionLabel).toBe('Módulo 1');
    expect(first.requiresPreviousLabel).toBeUndefined();

    expect(
      moduleCardView({ ...module, requiresPrevious: false }, 3, t).requiresPreviousLabel,
    ).toBeUndefined();
    expect(moduleCardView({ ...module, lessonCount: 0, durationSeconds: 0 }, 1, t).meta).toBe(
      '0 aulas',
    );
    expect(moduleCardView({ ...module, lessonCount: 1, durationSeconds: 0 }, 1, t).meta).toBe(
      '1 aula',
    );
  });
});

describe('lessonRowView (UI-D-395, D-407, D-409)', () => {
  it('a ready video: the asset seconds as mm:ss, the poster when minted, the Camera when not, no pill', () => {
    const ready = lessonRowView(
      lesson({ videoAssetId: A, videoStatus: 'ready', durationSeconds: 754 }),
      C,
      t,
      'https://image.example/poster.jpg',
    );
    expect(ready.href).toBe(`/cursos/${C}/aulas/${L1}`);
    expect(ready.meta).toBe('12:34');
    expect(ready.thumb).toEqual({ kind: 'poster', src: 'https://image.example/poster.jpg' });
    expect(ready.pill).toBeUndefined();
    expect(ready.ariaLabel).toBe('Anatomia da região');

    const noPoster = lessonRowView(
      lesson({ videoAssetId: A, videoStatus: 'ready', durationSeconds: 754 }),
      C,
      t,
    );
    expect(noPoster.thumb).toEqual({ kind: 'failed' });
  });

  it('pending and processing: the spinner and the Processando pill; failed: the Camera and Falhou; the aria names the pill', () => {
    const processing = lessonRowView(lesson({ videoAssetId: A, videoStatus: 'processing' }), C, t);
    expect(processing.thumb).toEqual({ kind: 'processing' });
    expect(processing.pill).toEqual({ label: 'Processando', tone: 'warning' });
    expect(processing.meta).toBe('');
    expect(processing.ariaLabel).toBe('Anatomia da região, Processando');
    expect(lessonRowView(lesson({ videoAssetId: A, videoStatus: 'pending' }), C, t).thumb).toEqual({
      kind: 'processing',
    });

    const failed = lessonRowView(lesson({ videoAssetId: A, videoStatus: 'failed' }), C, t);
    expect(failed.thumb).toEqual({ kind: 'failed' });
    expect(failed.pill).toEqual({ label: 'Falhou', tone: 'danger' });
    expect(failed.ariaLabel).toBe('Anatomia da região, Falhou');
  });

  it('no video reads Prática with the file glyph; isFree appends Aula aberta — alone when nothing precedes it', () => {
    const practice = lessonRowView(lesson(), C, t);
    expect(practice.meta).toBe('Prática');
    expect(practice.thumb).toEqual({ kind: 'practice' });
    expect(lessonRowView(lesson({ isFree: true }), C, t).meta).toBe('Prática · Aula aberta');
    expect(
      lessonRowView(
        lesson({ videoAssetId: A, videoStatus: 'ready', durationSeconds: 372, isFree: true }),
        C,
        t,
        'x',
      ).meta,
    ).toBe('6:12 · Aula aberta');
    expect(
      lessonRowView(lesson({ videoAssetId: A, videoStatus: 'processing', isFree: true }), C, t)
        .meta,
    ).toBe('Aula aberta');
  });
});

describe('publishBlockedView (UI-D-394, E05 overflow)', () => {
  const lessons = Array.from({ length: 8 }, (_, index) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
    title: `Aula ${index + 1}`,
    href: `/cursos/${C}/aulas/l${index + 1}`,
  }));

  it('is null with nothing blocking; names one lesson in the singular and N in the plural, each a link, in the curriculum order', () => {
    expect(publishBlockedView([], lessons, C, t)).toBeNull();

    const one = publishBlockedView([lessons[2]?.id ?? ''], lessons, C, t);
    expect(one?.sentence).toBe('Não é possível publicar: 1 aula ainda processa o vídeo.');
    expect(one?.links).toEqual([{ href: lessons[2]?.href, label: 'Aula 3' }]);
    expect(one?.moreHref).toBeUndefined();
    expect(one?.moreLabel).toBeUndefined();

    // The ids arrive in any order; the links follow the curriculum.
    const two = publishBlockedView([lessons[5]?.id ?? '', lessons[1]?.id ?? ''], lessons, C, t);
    expect(two?.sentence).toBe('Não é possível publicar: 2 aulas ainda processam o vídeo.');
    expect(two?.links.map((link) => link.label)).toEqual(['Aula 2', 'Aula 6']);
  });

  it('lists every link for the component to cap at five, and says "e mais {n}" to the curriculum beyond five', () => {
    const seven = publishBlockedView(
      lessons.slice(0, 7).map((item) => item.id),
      lessons,
      C,
      t,
    );
    expect(seven?.sentence).toBe('Não é possível publicar: 7 aulas ainda processam o vídeo.');
    expect(seven?.links).toHaveLength(7);
    expect(seven?.moreLabel).toBe('e mais 2');
    expect(seven?.moreHref).toBe(`/cursos/${C}#modulos`);
    expect(PUBLISH_BLOCKED_LINKS).toBe(5);
  });

  it('an id the page no longer lists still counts (server truth wins) but has no link', () => {
    const view = publishBlockedView(['99999999-9999-4999-8999-999999999999'], lessons, C, t);
    expect(view?.sentence).toBe('Não é possível publicar: 1 aula ainda processa o vídeo.');
    expect(view?.links).toEqual([]);
  });

  it('publishBlockedLessons flattens the modules in order with the lesson form hrefs', () => {
    const flat = publishBlockedLessons(
      [{ lessons: [lesson({ id: L1 })] }, { lessons: [lesson({ id: L2, title: 'Segunda' })] }],
      C,
    );
    expect(flat).toEqual([
      { id: L1, title: 'Anatomia da região', href: `/cursos/${C}/aulas/${L1}` },
      { id: L2, title: 'Segunda', href: `/cursos/${C}/aulas/${L2}` },
    ]);
  });
});

describe('formatPublishedAt and the curriculum hrefs', () => {
  it('writes the long pt-BR date in the tenant timezone', () => {
    // 01:30 UTC on the 10th is still the 9th in São Paulo.
    expect(formatPublishedAt('2026-10-10T01:30:00.000Z', 'America/Sao_Paulo')).toBe(
      '9 de outubro de 2026',
    );
    expect(formatPublishedAt('2026-10-10T01:30:00.000Z', 'UTC')).toBe('10 de outubro de 2026');
  });

  it('the lesson routes of plan 09', () => {
    expect(lessonHref(C, L1)).toBe(`/cursos/${C}/aulas/${L1}`);
    expect(newLessonHref(C, A)).toBe(`/cursos/${C}/aulas/nova?modulo=${A}`);
    expect(CURRICULUM_SECTION_ID).toBe('modulos');
  });
});

describe('materialKindsSentence (08.3-09, UI-D-399, A-UI-1, E10 partial)', () => {
  it("reads the contract's full sentence for the eight accepted mimes", () => {
    expect(materialKindsSentence(ATTACHMENT_MIMES, t)).toBe('PDF, planilhas, slides e imagens');
  });

  it('reads "PDF" alone for a PDF-only contract — no copy change needed', () => {
    expect(materialKindsSentence(['application/pdf'], t)).toBe('PDF');
  });

  it('joins any other subset with Intl.ListFormat pt-BR from the kind labels, in the contract order', () => {
    expect(
      materialKindsSentence(['image/png', 'application/pdf', 'application/vnd.ms-excel'], t),
    ).toBe('PDF, planilha e imagem');
    expect(materialKindsSentence(['image/jpeg'], t)).toBe('imagem');
    expect(materialKindsSentence([], t)).toBe('');
  });
});

describe('materialRowView (08.3-09, UI-D-399, P27, P29)', () => {
  it('derives the kind from the mime and the size from the bytes: "PDF · 2,4 MB", "Planilha · 180 KB"', () => {
    const pdf = materialRowView(
      {
        assetId: A,
        materialId: C,
        filename: 'Protocolo de marcação.pdf',
        mime: 'application/pdf',
        bytes: 2_516_582,
      },
      t,
    );
    expect(pdf).toEqual({
      id: A,
      assetId: A,
      materialId: C,
      name: 'Protocolo de marcação.pdf',
      meta: 'PDF · 2,4 MB',
      glyph: 'file',
      removeLabel: 'Remover Protocolo de marcação.pdf',
    });
    expect(
      materialRowView(
        {
          assetId: A,
          filename: 'Tabela.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes: 184_320,
        },
        t,
      ),
    ).toMatchObject({ materialId: null, meta: 'Planilha · 180 KB', glyph: 'file' });
    expect(
      materialRowView(
        { assetId: A, filename: 'foto.png', mime: 'image/png', bytes: 50 * 1024 * 1024 },
        t,
      ),
    ).toMatchObject({ meta: 'Imagem · 50 MB', glyph: 'image' });
    expect(
      materialRowView(
        { assetId: A, filename: 'deck.ppt', mime: 'application/vnd.ms-powerpoint', bytes: 1024 },
        t,
      ),
    ).toMatchObject({ meta: 'Slides · 1 KB' });
    expect(
      materialRowView(
        { assetId: A, filename: 'x.bin', mime: 'application/octet-stream', bytes: 0 },
        t,
      ),
    ).toMatchObject({ meta: 'Arquivo · 0 B' });
  });
});

describe('lessonFormDefaults (08.3-09, UI-D-398)', () => {
  const base: LessonDetail = {
    id: A,
    moduleId: C,
    title: 'Pontos',
    description: 'Onde marcar.',
    position: 2,
    isFree: true,
    requiresPrevious: false,
    videoAssetId: null,
    videoStatus: 'none',
    durationSeconds: null,
    materials: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        assetId: '44444444-4444-4444-8444-444444444444',
        filename: 'Protocolo.pdf',
        mime: 'application/pdf',
        kind: 'pdf',
        bytes: 4096,
        position: 1,
      },
    ],
    module: { id: C, title: 'Fundamentos', position: 1 },
    course: {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Curso',
      status: 'draft',
      hasProducts: true,
    },
  };

  it('a practice lesson has no video; the materials keep the API order with their join ids', () => {
    expect(lessonFormDefaults(base)).toEqual({
      title: 'Pontos',
      description: 'Onde marcar.',
      video: null,
      isFree: true,
      materials: [
        {
          assetId: '44444444-4444-4444-8444-444444444444',
          materialId: '33333333-3333-4333-8333-333333333333',
          filename: 'Protocolo.pdf',
          mime: 'application/pdf',
          bytes: 4096,
        },
      ],
    });
  });

  it("a lesson with a video carries the asset id, the status and the asset's seconds — never typed", () => {
    expect(
      lessonFormDefaults({ ...base, videoAssetId: A, videoStatus: 'ready', durationSeconds: 754 })
        .video,
    ).toEqual({ assetId: A, status: 'ready', durationSeconds: 754 });
    expect(
      lessonFormDefaults({
        ...base,
        videoAssetId: A,
        videoStatus: 'processing',
        durationSeconds: null,
      }).video,
    ).toEqual({ assetId: A, status: 'processing', durationSeconds: null });
  });
});

/* ── 08.3-10: the Trilhas tab and the track form (UI-D-391, UI-D-402, D-415) ─────────────────── */

describe('trackFilterFromParam / trackFilterHref (UI-D-391, E04 partial)', () => {
  it('maps the two pt-BR chips, reads anything else as Ativas, and writes the tab href', () => {
    expect(TRACK_FILTER_ORDER).toEqual(['active', 'archived']);
    expect(trackFilterFromParam(undefined)).toBe('active');
    expect(trackFilterFromParam('arquivadas')).toBe('archived');
    expect(trackFilterFromParam('ativas')).toBe('active');
    expect(trackFilterFromParam('todos')).toBe('active');
    expect(trackFilterFromParam(['arquivadas', 'ativas'])).toBe('active');
    expect(trackFilterHref('active')).toBe('/cursos?aba=trilhas');
    expect(trackFilterHref('archived')).toBe('/cursos?aba=trilhas&filtro=arquivadas');
  });
});

describe('trackFormDefaults and publishedTrackCourseIds (UI-D-402, D-415)', () => {
  const detail: TrackDetail = {
    id: C,
    title: 'Do zero ao primeiro atendimento',
    subtitle: 'Quatro cursos',
    audience: 'Para quem está começando',
    description: '',
    coverAssetId: A,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-10-13T12:00:00.000Z',
    courses: [
      { id: L1, title: 'Publicado', status: 'published', coverAssetId: null, position: 1 },
      { id: L2, title: 'Despublicado', status: 'draft', coverAssetId: A, position: 2 },
    ],
    courseCount: 1,
  };

  it('copies the fields and EVERY linked course with its current status, in position order', () => {
    const defaults = trackFormDefaults(detail);
    expect(defaults).toEqual({
      title: 'Do zero ao primeiro atendimento',
      subtitle: 'Quatro cursos',
      audience: 'Para quem está começando',
      description: '',
      coverAssetId: A,
      courses: [
        { id: L1, title: 'Publicado', coverAssetId: null, status: 'published' },
        { id: L2, title: 'Despublicado', coverAssetId: A, status: 'draft' },
      ],
      status: 'active',
    });
    // A fresh array: the form's draft never aliases the page's detail.
    expect(defaults.courses).not.toBe(detail.courses);
  });

  it('the saved ids are the published rows only, in draft order; none → []', () => {
    const defaults = trackFormDefaults(detail);
    expect(publishedTrackCourseIds(defaults.courses)).toEqual([L1]);
    expect(publishedTrackCourseIds([...defaults.courses].reverse())).toEqual([L1]);
    expect(publishedTrackCourseIds([])).toEqual([]);
    expect(
      publishedTrackCourseIds([
        { id: L2, title: 'B', coverAssetId: null, status: 'published' },
        { id: L1, title: 'A', coverAssetId: null, status: 'published' },
        { id: C, title: 'C', coverAssetId: null, status: 'archived' },
      ]),
    ).toEqual([L2, L1]);
  });
});

/* ── 08.3-11: the Lives tab and the live form (D-416, UI-D-391, UI-D-403) ────────────────────── */

describe('live filters (UI-D-391)', () => {
  it('Próximas · Passadas in that order; ?filtro= reads the two pt-BR values and nothing else', () => {
    expect(LIVE_FILTER_ORDER).toEqual(['upcoming', 'past']);
    expect(liveFilterFromParam('passadas')).toBe('past');
    expect(liveFilterFromParam('proximas')).toBe('upcoming');
    for (const value of [undefined, '', 'all', 'canceladas', ['passadas'], 'PASSADAS']) {
      expect(liveFilterFromParam(value as string | string[] | undefined)).toBe('upcoming');
    }
    expect(liveFilterHref('upcoming')).toBe('/cursos?aba=lives');
    expect(liveFilterHref('past')).toBe('/cursos?aba=lives&filtro=passadas');
  });
});

describe('the tenant wall clock and the instant (UI-D-403, UI-D-407)', () => {
  it('builds the ISO instant from the date and time in the TENANT zone, both ways, DST included', () => {
    // 19:00 in São Paulo (UTC-3) is 22:00Z.
    expect(
      tenantWallClockToInstant({ date: '2026-10-16', time: '19:00' }, 'America/Sao_Paulo'),
    ).toBe('2026-10-16T22:00:00.000Z');
    // Lisbon is UTC+1 in summer (July) and UTC+0 in winter (January).
    expect(tenantWallClockToInstant({ date: '2026-07-16', time: '19:00' }, 'Europe/Lisbon')).toBe(
      '2026-07-16T18:00:00.000Z',
    );
    expect(tenantWallClockToInstant({ date: '2026-01-16', time: '19:00' }, 'Europe/Lisbon')).toBe(
      '2026-01-16T19:00:00.000Z',
    );
    expect(tenantWallClockToInstant({ date: '2026-10-16', time: '19:00' }, 'UTC')).toBe(
      '2026-10-16T19:00:00.000Z',
    );
    // Midnight and the day boundary: 00:30 in São Paulo is 03:30Z the same date.
    expect(
      tenantWallClockToInstant({ date: '2026-10-17', time: '00:30' }, 'America/Sao_Paulo'),
    ).toBe('2026-10-17T03:30:00.000Z');
    // The reverse: the stored instant reads back as the form's two values.
    expect(instantToTenantWallClock('2026-10-16T22:00:00.000000Z', 'America/Sao_Paulo')).toEqual({
      date: '2026-10-16',
      time: '19:00',
    });
    expect(instantToTenantWallClock('2026-10-17T03:30:00.000Z', 'America/Sao_Paulo')).toEqual({
      date: '2026-10-17',
      time: '00:30',
    });
    expect(instantToTenantWallClock('2026-07-16T18:00:00.000Z', 'Europe/Lisbon')).toEqual({
      date: '2026-07-16',
      time: '19:00',
    });
    // Round trips.
    for (const [zone, date, time] of [
      ['America/Sao_Paulo', '2026-12-25', '08:05'],
      ['Europe/Lisbon', '2026-03-29', '03:30'],
      ['Asia/Tokyo', '2026-01-01', '23:59'],
    ] as const) {
      const iso = tenantWallClockToInstant({ date, time }, zone);
      expect(iso).not.toBeNull();
      expect(instantToTenantWallClock(iso ?? '', zone)).toEqual({ date, time });
    }
  });

  it('WR-05: a DST gap lands AFTER the gap on the same date, an overlap takes the EARLIER instant, and the nights around both stay exact', () => {
    // New York springs forward 2026-03-08 02:00 EST → 03:00 EDT: 02:30 does not exist and lands on
    // 03:30 EDT (07:30Z), never on 01:30 EST.
    const nyGap = tenantWallClockToInstant(
      { date: '2026-03-08', time: '02:30' },
      'America/New_York',
    );
    expect(nyGap).toBe('2026-03-08T07:30:00.000Z');
    expect(instantToTenantWallClock(nyGap ?? '', 'America/New_York')).toEqual({
      date: '2026-03-08',
      time: '03:30',
    });
    // Santiago springs forward 2026-09-06 00:00 → 01:00: 00:30 lands on 01:30 the SAME date, never on
    // 23:30 of the day before.
    const sclGap = tenantWallClockToInstant(
      { date: '2026-09-06', time: '00:30' },
      'America/Santiago',
    );
    expect(sclGap).toBe('2026-09-06T04:30:00.000Z');
    expect(instantToTenantWallClock(sclGap ?? '', 'America/Santiago')).toEqual({
      date: '2026-09-06',
      time: '01:30',
    });
    // New York falls back 2026-11-01 02:00 EDT → 01:00 EST: 01:30 happens twice; the EDT one wins.
    expect(
      tenantWallClockToInstant({ date: '2026-11-01', time: '01:30' }, 'America/New_York'),
    ).toBe('2026-11-01T05:30:00.000Z');
    // Santiago falls back 2026-04-05 00:00 → 2026-04-04 23:00: 23:30 on the 4th happens twice.
    expect(
      tenantWallClockToInstant({ date: '2026-04-04', time: '23:30' }, 'America/Santiago'),
    ).toBe('2026-04-05T02:30:00.000Z');
    // Wall clocks just around the transitions stay exact, both ways.
    for (const [zone, date, time] of [
      ['America/New_York', '2026-03-08', '01:59'],
      ['America/New_York', '2026-03-08', '03:00'],
      ['America/New_York', '2026-11-01', '00:59'],
      ['America/New_York', '2026-11-01', '02:00'],
      ['America/Santiago', '2026-09-05', '23:59'],
      ['America/Santiago', '2026-09-06', '01:00'],
      ['America/Santiago', '2026-04-04', '22:59'],
      ['America/Santiago', '2026-04-05', '00:00'],
    ] as const) {
      const iso = tenantWallClockToInstant({ date, time }, zone);
      expect(iso, `${zone} ${date} ${time}`).not.toBeNull();
      expect(instantToTenantWallClock(iso ?? '', zone)).toEqual({ date, time });
    }
  });

  it('a blank, a partial or an impossible wall clock is null (the form shows startRequired)', () => {
    for (const value of [
      { date: '', time: '' },
      { date: '2026-10-16', time: '' },
      { date: '', time: '19:00' },
      { date: '2026-02-30', time: '19:00' },
      { date: '2026-13-01', time: '19:00' },
      { date: '2026-10-16', time: '24:00' },
      { date: '16/10/2026', time: '19:00' },
      { date: '2026-10-16', time: '7pm' },
    ]) {
      expect(tenantWallClockToInstant(value, 'America/Sao_Paulo')).toBeNull();
    }
  });
});

describe('formatLiveDate and liveFormDefaults (UI-D-392, UI-D-403)', () => {
  it("the date line is the row meta's two halves in the tenant zone", () => {
    expect(formatLiveDate('2026-10-16T22:00:00.000Z', 'America/Sao_Paulo')).toBe(
      'sex, 16 de out, 19:00',
    );
    expect(formatLiveDate('2026-10-16T22:00:00.000Z', 'Europe/Lisbon')).toBe(
      'sex, 16 de out, 23:00',
    );
  });

  it('the edit defaults carry the stored instant AND its tenant wall clock, the replay and the server status (no products: the form never edits links, D-418)', () => {
    const live: LiveDetail = {
      id: C,
      title: 'Tira-dúvidas de outubro',
      description: 'Traga suas dúvidas.',
      coverAssetId: A,
      startsAt: '2026-10-16T22:00:00.000000Z',
      durationMin: 60,
      externalUrl: 'https://youtu.be/abc',
      status: 'recorded',
      cancelledAt: null,
      products: [{ id: L1, name: 'Plano anual', status: 'active' }],
      replayLesson: { id: L2, title: 'Aula 1', courseTitle: 'Curso' },
      createdAt: '2026-10-01T10:00:00.000000Z',
    };
    expect(liveFormDefaults(live, 'America/Sao_Paulo')).toEqual({
      title: 'Tira-dúvidas de outubro',
      description: 'Traga suas dúvidas.',
      coverAssetId: A,
      startsAt: '2026-10-16T22:00:00.000000Z',
      start: { date: '2026-10-16', time: '19:00' },
      durationMin: 60,
      externalUrl: 'https://youtu.be/abc',
      replayLesson: { id: L2, title: 'Aula 1', courseTitle: 'Curso' },
      status: 'recorded',
    });
  });

  it('groupLessonsForPicker keeps the API order and groups by course, first seen first (P09)', () => {
    const items = [
      { id: L1, title: 'Aula 1', courseId: C, courseTitle: 'Curso novo', videoStatus: 'ready' },
      { id: L2, title: 'Aula 2', courseId: C, courseTitle: 'Curso novo', videoStatus: 'none' },
      { id: A, title: 'Aula X', courseId: L2, courseTitle: 'Curso antigo', videoStatus: 'ready' },
    ] as const;
    expect(groupLessonsForPicker(items)).toEqual([
      {
        courseId: C,
        courseTitle: 'Curso novo',
        lessons: [
          { id: L1, title: 'Aula 1' },
          { id: L2, title: 'Aula 2' },
        ],
      },
      { courseId: L2, courseTitle: 'Curso antigo', lessons: [{ id: A, title: 'Aula X' }] },
    ]);
    expect(groupLessonsForPicker([])).toEqual([]);
  });
});
