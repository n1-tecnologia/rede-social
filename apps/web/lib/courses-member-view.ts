import {
  type LearnCategoryChip,
  type LearnCourse,
  type LearnCourseCard,
  type LearnLesson,
  type LearnLive,
  type LearnLiveCard,
  type LearnMaterial,
  type LearnOutlineLesson,
  type LearnOutlineModule,
  type LearnProgress,
  type LessonVideoStatus,
  lessonLockLabel,
  type MaterialKind,
  moduleLockLabel,
  padNumber,
} from '@rede-social/module-courses/contracts';
import type { CourseAccessItem, LiveAccessItem } from '@rede-social/module-store/contracts';
import {
  COURSE_LEVEL_LABEL_KEY,
  type CoursesTranslator,
  formatBytes,
  formatCourseDuration,
  formatLessonDuration,
  liveDateParts,
  MATERIAL_KIND_LABEL_KEY,
} from '@/lib/courses-view';

/**
 * The member side's view builders (08.5-06, D-420, D-421, D-430, UI-D-424..UI-D-426). Pure: no
 * fetch, no clock, no sort (P09) — every card leaves in the order the API sent it, and every string
 * a member card prints is built HERE, so the server's first page and the load-more action's next
 * pages share one formatter. `courses-view.ts` stays the manager's (planning decision 2); this file
 * reuses its duration and level vocabulary rather than copying it.
 *
 * Keys are FULL (`courses.member.…`): the same untyped translator every `lib/*-view` module takes.
 */

/** The `?ver=aluno` preview suffix an `admin_tenant` keeps on every member link (UI-D-437). */
export const PREVIEW_PARAM = 'ver';
export const PREVIEW_VALUE = 'aluno';

/** A `/cursos…` href with its query, keeping `?ver=aluno` while the manager previews. */
function memberHref(path: string, query: Record<string, string>, preview: boolean): string {
  const search = new URLSearchParams(query);
  if (preview) search.set(PREVIEW_PARAM, PREVIEW_VALUE);
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/* ── Category chips (UI-D-425) ───────────────────────────────────────────────────────────────── */

/**
 * `?categoria=` → the category the grid narrows to, or `null` for "Todas" (E02 error): anything but
 * the id of a chip the API listed — an unknown id, a repeated param, a non-id, none — reads as
 * "Todas". The whitelist is the API's own chip list, so a crafted value never reaches a query.
 */
export function categoryFromParam(
  value: string | string[] | undefined,
  categories: readonly Pick<LearnCategoryChip, 'id'>[],
): string | null {
  if (typeof value !== 'string') return null;
  return categories.some((category) => category.id === value) ? value : null;
}

/** A chip's href: "Todas" is `/cursos`, a category `/cursos?categoria={id}`. */
export function catalogueCategoryHref(categoryId: string | null, preview = false): string {
  return memberHref('/cursos', categoryId ? { categoria: categoryId } : {}, preview);
}

/* ── Course card (UI-D-426, D-421, D-430) ────────────────────────────────────────────────────── */

/** The store's two tags on a card; both false when the store is off or its read failed. */
export interface CourseCardTags {
  /** "Exclusivo": the store says the course is locked for this caller. */
  exclusive: boolean;
  /** "Produto arquivado": locked AND none of its linked products is active. */
  archived: boolean;
}

export interface CourseCardView {
  id: string;
  href: string;
  title: string;
  coverAssetId: string | null;
  /** "{category} · {level}", either part alone, or null when both are empty. */
  categoryLine: string | null;
  /** "{N} aulas" plus " · {duration}" when any video is ready. */
  meta: string;
  tags: CourseCardTags;
  /** Present exactly when the member completed at least one lesson (A-UI-5: locked cards too). */
  progress: { percent: number; label: string } | null;
  ariaLabel: string;
}

const NO_TAGS: CourseCardTags = { exclusive: false, archived: false };

/**
 * The store's access row → the card's tags (UI-D-426, UI-D-442). Only the store's own answer draws a
 * tag: no row (an open course), a failed or store-off read (`undefined`), or `locked: false` (staff,
 * a buyer) → no tag. "Produto arquivado" rides only under "Exclusivo" — an owner never sees it.
 */
export function courseCardTags(
  access: Pick<CourseAccessItem, 'locked' | 'archivedTag'> | null | undefined,
): CourseCardTags {
  if (!access?.locked) return NO_TAGS;
  return { exclusive: true, archived: access.archivedTag };
}

/**
 * The card's completion share, `floor(done × 100 / total)`, 0 for a course with no lesson and never
 * above 100 — the API counts, the web only divides (D-430).
 */
export function coursePercent(completedCount: number, lessonCount: number): number {
  if (lessonCount <= 0) return 0;
  return Math.min(100, Math.floor((completedCount * 100) / lessonCount));
}

/**
 * One finished card (UI-D-426): every word, the href and the accessible name — "{title}, {N} aulas",
 * plus ", exclusivo" when the tag shows and ", {percent}% concluído" when the bar shows, so the name
 * says exactly what the poster draws.
 */
export function courseCardView(
  card: LearnCourseCard,
  access: Pick<CourseAccessItem, 'locked' | 'archivedTag'> | null | undefined,
  t: CoursesTranslator,
  { preview = false }: { preview?: boolean } = {},
): CourseCardView {
  const category = card.category?.name?.trim() ? card.category.name : null;
  const level = card.level ? t(COURSE_LEVEL_LABEL_KEY[card.level]) : null;
  const categoryLine =
    category && level
      ? t('courses.member.card.categoryLevel', { category, level })
      : (category ?? level);

  const duration = formatCourseDuration(card.durationSeconds);
  const meta = duration
    ? t('courses.member.card.metaWithDuration', { N: card.lessonCount, duration })
    : t('courses.member.card.meta', { N: card.lessonCount });

  const tags = courseCardTags(access);
  const progress =
    card.completedCount >= 1
      ? (() => {
          const percent = coursePercent(card.completedCount, card.lessonCount);
          return { percent, label: t('courses.member.progress.aria', { percent }) };
        })()
      : null;

  // One ICU sentence; its `select` arguments go as 'true' / 'false' strings (next-intl types a
  // value as string | number | Date), and 'true' picks the `true` branch.
  const ariaLabel = t('courses.member.card.aria', {
    course: card.title,
    N: card.lessonCount,
    exclusive: String(tags.exclusive),
    progress: String(progress !== null),
    percent: progress?.percent ?? 0,
  });

  return {
    id: card.id,
    href: memberHref(`/cursos/${encodeURIComponent(card.id)}`, {}, preview),
    title: card.title,
    coverAssetId: card.coverAssetId,
    categoryLine,
    meta,
    tags,
    progress,
    ariaLabel,
  };
}

/** The access list → a lookup by course id (one read per render, planning decision 3). */
export function courseAccessById(
  access: { items: readonly CourseAccessItem[] } | null,
): Map<string, CourseAccessItem> | null {
  if (!access) return null;
  return new Map(access.items.map((item) => [item.courseId, item]));
}

/* ── Live card (UI-D-434, D-431, COURSE-23) ──────────────────────────────────────────────────── */

export interface LiveCardView {
  id: string;
  href: string;
  title: string;
  coverAssetId: string | null;
  /** The status in words: "Ao vivo agora", "Agendada", "Gravada", "Cancelada". */
  statusLabel: string;
  /** `radio` leads the pill only while the live is on air. */
  statusIcon: 'radio' | null;
  /** "Exclusiva": the store says the live is locked for this caller. */
  exclusive: boolean;
  /** A cancelled card keeps its colour; only its title takes the secondary ink. */
  cancelled: boolean;
  /** "{date}, {time} · {duration} min" in the TENANT's timezone. */
  meta: string;
  /** "{live}, {status}, {date}" plus ", exclusiva". */
  ariaLabel: string;
}

/**
 * One finished live card (UI-D-434). The status is the SERVER's (`liveStatusAt` on the API clock):
 * nothing here reads the clock (UI-D-288), and the date and time are formatted with `Intl` in the
 * tenant's timezone, so the same instant renders identically before and after hydration. The tag
 * comes only from the store's access row (`locked`), the course card's rule (UI-D-442).
 */
export function liveCardView(
  card: LearnLiveCard,
  access: Pick<LiveAccessItem, 'locked'> | null | undefined,
  timeZone: string,
  t: CoursesTranslator,
  { preview = false }: { preview?: boolean } = {},
): LiveCardView {
  const statusLabel =
    card.status === 'live' ? t('courses.member.lives.liveNow') : t(`courses.status.${card.status}`);
  const { date, time } = liveDateParts(card.startsAt, timeZone);
  const exclusive = access?.locked === true;
  const ariaLabel = t('courses.member.lives.aria', {
    live: card.title,
    status: statusLabel,
    date: `${date}, ${time}`,
    exclusive: String(exclusive),
  });
  return {
    id: card.id,
    href: memberHref(`/cursos/lives/${encodeURIComponent(card.id)}`, {}, preview),
    title: card.title,
    coverAssetId: card.coverAssetId,
    statusLabel,
    statusIcon: card.status === 'live' ? 'radio' : null,
    exclusive,
    cancelled: card.status === 'cancelled',
    meta: t('courses.lives.row.meta', { date, time, duration: card.durationMin }),
    ariaLabel,
  };
}

/** The live access list → a lookup by live id (one read per render, planning decision 3). */
export function liveAccessById(
  access: { items: readonly LiveAccessItem[] } | null,
): Map<string, LiveAccessItem> | null {
  if (!access) return null;
  return new Map(access.items.map((item) => [item.liveId, item]));
}

/* ── Course page (08.5-07, UI-D-427..UI-D-430, D-422, D-423, D-430, COURSE-18) ────────────────── */

/**
 * The preview flag (UI-D-437, planning decision 5, T-08.5-27): an `admin_tenant` who asked for
 * `?ver=aluno`. For a `support_tenant`, a member, or a repeated / other value the param is ignored —
 * no banner, no preview links. The API still authorises every read by its own rules; this flag only
 * decides what the page SAYS (the banner) and keeps the preview param on internal links.
 */
export function isPreview(
  bootstrap: { membership: { role: string } },
  ver: string | string[] | undefined,
): boolean {
  return bootstrap.membership.role === 'admin_tenant' && ver === PREVIEW_VALUE;
}

/** A lesson's member URL, keeping `?ver=aluno` in preview (UI-D-430). */
export function memberLessonHref(courseId: string, lessonId: string, preview: boolean): string {
  return memberHref(
    `/cursos/${encodeURIComponent(courseId)}/aulas/${encodeURIComponent(lessonId)}`,
    {},
    preview,
  );
}

/** A course's member URL, keeping `?ver=aluno` in preview. */
export function memberCourseHref(courseId: string, preview: boolean): string {
  return memberHref(`/cursos/${encodeURIComponent(courseId)}`, {}, preview);
}

/** A lead " · " left behind by an empty first part ("" + " · Aula aberta") is dropped. */
function trimLead(text: string): string {
  return text.replace(/^\s*·\s*/, '');
}

/** The live lessons' summed ready-video seconds (the API's `durationSeconds`, null when not ready). */
function lessonsSeconds(lessons: readonly Pick<LearnOutlineLesson, 'durationSeconds'>[]): number {
  return lessons.reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0);
}

/** "{N} aulas" or "{N} aulas · {duration}" — the card's words, reused by the band and the 0% line. */
function lessonsMeta(
  count: number,
  seconds: number,
  t: CoursesTranslator,
  keys: { plain: string; withDuration: string },
): string {
  const duration = formatCourseDuration(seconds);
  return duration ? t(keys.withDuration, { N: count, duration }) : t(keys.plain, { N: count });
}

export interface CourseHeroView {
  title: string;
  /** Null when empty: the line is absent, never an empty paragraph. */
  tagline: string | null;
  /** Null when empty: "Sobre o curso" is absent (UI E05 populated). */
  description: string | null;
  /** Empty → "O que você vai dominar" is absent. */
  outcomes: string[];
  coverAssetId: string | null;
  coverAlt: string;
  /** The category as an over-media pill on the hero; null without one. */
  categoryPill: string | null;
  /** The `neutral` pills: the level, then "{N} h". */
  pills: string[];
  instructorLine: string;
  instructorPhotoAssetId: string | null;
}

/** The hero and identity block (UI-D-427), every word built here. */
export function courseHeroView(course: LearnCourse, t: CoursesTranslator): CourseHeroView {
  const pills: string[] = [];
  if (course.level) pills.push(t(COURSE_LEVEL_LABEL_KEY[course.level]));
  if (course.certificateHours !== null && course.certificateHours > 0) {
    pills.push(t('courses.course.hours', { N: String(Math.trunc(course.certificateHours)) }));
  }
  return {
    title: course.title,
    tagline: course.tagline.trim() ? course.tagline : null,
    description: course.description.trim() ? course.description : null,
    outcomes: course.outcomes.filter((outcome) => outcome.trim() !== ''),
    coverAssetId: course.coverAssetId,
    coverAlt: t('courses.alt.course', { title: course.title }),
    categoryPill: course.category?.name?.trim() ? course.category.name : null,
    pills,
    instructorLine: t('courses.course.instructor', { instructor: course.instructorName }),
    instructorPhotoAssetId: course.instructorPhotoAssetId,
  };
}

export type CourseActionView =
  | {
      variant: 'start';
      /** "{N} aulas · {duration}". */
      line: string;
      label: string;
      /** The next open lesson; null → no button. */
      href: string | null;
    }
  | {
      variant: 'continue';
      percent: number;
      /** The progressbar's name, "{percent}% concluído". */
      progressLabel: string;
      /** "{percent}% concluído · {done} de {total} aulas concluídas". */
      line: string;
      label: string;
      /** Null when no open lesson is next: the button is absent and the line stays. */
      href: string | null;
    }
  | {
      variant: 'done';
      /** "Curso concluído · {total} de {total} aulas". */
      line: string;
      label: string;
      /** The first lesson ("Rever o curso"). */
      href: string | null;
    };

/**
 * The open course's action zone (UI-D-427, D-430, EP-11): `percent` 0 → "Começar o curso", 1–99 →
 * the `h-2` bar and "Continuar o curso", 100 → "Curso concluído" and the outline "Rever o curso".
 * Every number is the API's (`done`, `total`, `percent`, `nextLessonId`, `firstLessonId`); the web
 * computes nothing. A course with no live lesson (`total` 0) has no action at all (EP-13) → null.
 */
export function courseActionView(
  progress: LearnProgress,
  t: CoursesTranslator,
  {
    courseId,
    durationSeconds,
    preview = false,
  }: { courseId: string; durationSeconds: number; preview?: boolean },
): CourseActionView | null {
  if (progress.total <= 0) return null;
  const href = (lessonId: string | null) =>
    lessonId ? memberLessonHref(courseId, lessonId, preview) : null;

  if (progress.percent >= 100) {
    return {
      variant: 'done',
      line: t('courses.member.course.doneLine', { total: progress.total }),
      label: t('courses.member.course.review'),
      href: href(progress.firstLessonId),
    };
  }
  if (progress.percent <= 0) {
    return {
      variant: 'start',
      line: lessonsMeta(progress.total, durationSeconds, t, {
        plain: 'courses.member.card.meta',
        withDuration: 'courses.member.course.startLine',
      }),
      label: t('courses.member.course.start'),
      href: href(progress.nextLessonId),
    };
  }
  return {
    variant: 'continue',
    percent: progress.percent,
    progressLabel: t('courses.member.progress.aria', { percent: progress.percent }),
    line: t('courses.member.course.progressLine', {
      percent: progress.percent,
      done: progress.done,
      total: progress.total,
    }),
    label: t('courses.member.course.continue'),
    href: href(progress.nextLessonId),
  };
}

export type MemberThumbState = 'open' | 'done' | 'locked' | 'progress';

export interface MemberLessonRowView {
  id: string;
  href: string;
  title: string;
  /** The meta in words (UI-D-430); a lock reason when `metaLocked`. */
  meta: string;
  metaLocked: boolean;
  trailing: 'done' | 'locked' | 'chevron';
  thumbState: MemberThumbState;
  /** 0–100, the server's position over the ready video's length (the `progress` thumb). */
  resumePercent: number;
  /** "{lesson}, {state}", or the title alone when open. */
  ariaLabel: string;
  current: boolean;
}

/**
 * One lesson row (UI-D-430). The LOCK is the server's `lockReason`; the words come from the pure
 * `lessonLockLabel` formatter (R-Pattern 3): purchase → "{mm:ss} · Aula exclusiva", lesson rule →
 * "Libera ao concluir a aula anterior", module rule → "Libera ao concluir o Módulo {nn}" (the module
 * BEFORE this one). Open → "{mm:ss}" or "Prática" without a video, plus " · Aula aberta" when free;
 * the current row (plan 08's player list) → "Assistindo agora". A lock wins over a completion: the
 * server would not open the lesson, so the row says why.
 */
export function memberLessonRowView(
  lesson: LearnOutlineLesson,
  t: CoursesTranslator,
  {
    courseId,
    moduleNumber,
    preview = false,
    currentLessonId = null,
  }: {
    courseId: string;
    moduleNumber: number;
    preview?: boolean;
    currentLessonId?: string | null;
  },
): MemberLessonRowView {
  const length =
    lesson.durationSeconds !== null
      ? formatLessonDuration(lesson.durationSeconds)
      : lesson.hasVideo
        ? ''
        : t('courses.member.lesson.practice');
  const current = currentLessonId === lesson.id;
  const done = lesson.completedAt !== null;
  const lock = lessonLockLabel({
    lockReason: lesson.lockReason,
    previousModuleNumber: moduleNumber - 1,
    duration: length,
  });

  let meta: string;
  if (lock) meta = trimLead(t(lock.key, lock.values));
  else if (current) meta = t('courses.member.lesson.current');
  else
    meta = lesson.isFree
      ? t('courses.member.lesson.free', { hasLength: String(length !== ''), length })
      : length;

  let thumbState: MemberThumbState = 'open';
  let resumePercent = 0;
  if (lock) thumbState = 'locked';
  else if (done) thumbState = 'done';
  else if (lesson.lastPositionSeconds > 0) {
    thumbState = 'progress';
    resumePercent = lesson.durationSeconds
      ? Math.min(100, Math.floor((lesson.lastPositionSeconds * 100) / lesson.durationSeconds))
      : 0;
  }

  let state: string | null = null;
  if (lesson.lockReason === 'purchase') state = t('courses.member.lesson.stateExclusive');
  else if (lock) state = t('courses.member.lesson.stateLocked');
  else if (done) state = t('courses.member.lesson.stateDone');
  else if (thumbState === 'progress') state = t('courses.member.lesson.stateInProgress');

  return {
    id: lesson.id,
    href: memberLessonHref(courseId, lesson.id, preview),
    title: lesson.title,
    meta,
    metaLocked: lock !== null,
    trailing: lock ? 'locked' : done ? 'done' : 'chevron',
    thumbState,
    resumePercent,
    ariaLabel: state
      ? t('courses.member.lesson.aria', { lesson: lesson.title, state })
      : lesson.title,
    current,
  };
}

export type ModuleBandState =
  | { kind: 'done' }
  | { kind: 'locked' }
  | { kind: 'ring'; percent: number };

export interface ModuleBandView {
  id: string;
  /** "01". */
  numeral: string;
  /** "Módulo 01" or "Concluído". */
  pill: string;
  title: string;
  /** "{N} aulas · {duration}", or the module-rule lock sentence. */
  meta: string;
  metaLocked: boolean;
  state: ModuleBandState;
  /** "Módulo {nn}: {title}, {state}". */
  ariaLabel: string;
  lessons: MemberLessonRowView[];
}

export interface CurriculumView {
  modules: ModuleBandView[];
  moduleCount: number;
  lessonCount: number;
  /** "{M} módulos · {N} aulas". */
  countLabel: string;
}

/** The modules the curriculum shows: a module with no live lesson is not listed (E07 empty). */
function visibleModules(course: Pick<LearnCourse, 'modules'>): LearnOutlineModule[] {
  return course.modules.filter((module) => module.lessons.length > 0);
}

/**
 * The curriculum (UI-D-429, UI-D-430): one band per live module with its rows. The band's state is
 * all-complete → done, else locked (the server's module `lockReason`, purchase or rule) → the lock
 * disc, else the ring at the module's own `floor(done × 100 / total)`. Only the MODULE rule replaces
 * the meta with its lock sentence (`moduleLockLabel`).
 */
export function curriculumView(
  course: Pick<LearnCourse, 'id' | 'modules'>,
  preview: boolean,
  t: CoursesTranslator,
  { currentLessonId = null }: { currentLessonId?: string | null } = {},
): CurriculumView {
  const modules = visibleModules(course).map((module): ModuleBandView => {
    const total = module.lessons.length;
    const done = module.lessons.filter((lesson) => lesson.completedAt !== null).length;
    const numeral = padNumber(module.number);
    const allDone = total > 0 && done === total;
    const state: ModuleBandState = allDone
      ? { kind: 'done' }
      : module.lockReason !== null
        ? { kind: 'locked' }
        : { kind: 'ring', percent: coursePercent(done, total) };
    const lock = moduleLockLabel({
      lockReason: module.lockReason,
      previousModuleNumber: module.number - 1,
    });
    const stateWords =
      state.kind === 'done'
        ? t('courses.member.module.stateDone')
        : state.kind === 'locked'
          ? t('courses.member.module.stateLocked')
          : t('courses.member.module.stateProgress', { percent: state.percent });
    return {
      id: module.id,
      numeral,
      pill: allDone
        ? t('courses.member.module.done')
        : t('courses.member.module.pill', { nn: numeral }),
      title: module.title,
      meta:
        lock && !allDone
          ? t(lock.key, lock.values)
          : lessonsMeta(total, lessonsSeconds(module.lessons), t, {
              plain: 'courses.member.module.meta',
              withDuration: 'courses.member.module.metaWithDuration',
            }),
      metaLocked: lock !== null && !allDone,
      state,
      ariaLabel: t('courses.member.module.aria', {
        nn: numeral,
        title: module.title,
        state: stateWords,
      }),
      lessons: module.lessons.map((lesson) =>
        memberLessonRowView(lesson, t, {
          courseId: course.id,
          moduleNumber: module.number,
          preview,
          currentLessonId,
        }),
      ),
    };
  });
  const lessonCount = modules.reduce((sum, module) => sum + module.lessons.length, 0);
  return {
    modules,
    moduleCount: modules.length,
    lessonCount,
    countLabel: t('courses.member.course.contentCount', { M: modules.length, N: lessonCount }),
  };
}

/**
 * The curriculum's initial open set (UI-D-429, the prototype's rule over the API's per-lesson
 * state, EP-12): a LOCKED course → module 1 plus the module of the first free lesson; 0% → module 1;
 * modules part-way (some, not all, lessons complete) → those; none part-way (exactly at a module
 * boundary) → the module of `nextLessonId`; 100% → all closed. Ids, in course order.
 */
export function curriculumOpenModules(
  course: Pick<LearnCourse, 'locked' | 'modules' | 'progress'>,
): string[] {
  const modules = visibleModules(course);
  const first = modules[0];
  if (!first) return [];
  const moduleOf = (lessonId: string | null) =>
    lessonId
      ? modules.find((module) => module.lessons.some((lesson) => lesson.id === lessonId))
      : undefined;

  if (course.locked) {
    const free = moduleOf(course.progress.firstFreeLessonId);
    return free && free.id !== first.id ? [first.id, free.id] : [first.id];
  }
  if (course.progress.percent >= 100) return [];
  const anyDone = modules.some((module) => module.lessons.some((lesson) => lesson.completedAt));
  if (course.progress.percent <= 0 && !anyDone) return [first.id];

  const partway = modules.filter((module) => {
    const done = module.lessons.filter((lesson) => lesson.completedAt !== null).length;
    return done > 0 && done < module.lessons.length;
  });
  if (partway.length > 0) return partway.map((module) => module.id);
  const next = moduleOf(course.progress.nextLessonId);
  return next ? [next.id] : [];
}

/** The open course's total length: every live lesson's ready-video seconds. */
export function courseSeconds(course: Pick<LearnCourse, 'modules'>): number {
  return visibleModules(course).reduce((sum, module) => sum + lessonsSeconds(module.lessons), 0);
}

/* ── Lesson player (08.5-08, UI-D-432, D-427, D-430, COURSE-19) ───────────────────────────────── */

/** One material row of the member player (UI-D-432): every word finished here. */
export interface MemberMaterialView {
  /** The join row's id: the handle the member's signed-URL route takes (never an asset id). */
  id: string;
  name: string;
  /** "{kind} · {size}" — the shipped admin words (UI-D-399). */
  meta: string;
  kind: MaterialKind;
  /** "Baixar {file}". */
  downloadLabel: string;
}

/** An open lesson's ready materials as the member rows print them (the player and the replay). */
function memberMaterialViews(
  materials: readonly LearnMaterial[],
  t: CoursesTranslator,
): MemberMaterialView[] {
  return materials.map((material) => ({
    id: material.id,
    name: material.filename,
    meta: t('courses.lesson.materials.meta', {
      kind: t(MATERIAL_KIND_LABEL_KEY[material.kind]),
      size: formatBytes(material.bytes),
    }),
    kind: material.kind,
    downloadLabel: t('courses.member.player.download', { file: material.filename }),
  }));
}

export interface LessonPageView {
  courseId: string;
  /** The header's title (UI-D-432: the COURSE title, truncated). */
  courseTitle: string;
  /** `/cursos/{courseId}`, keeping `?ver=aluno` in preview. */
  courseHref: string;
  title: string;
  /** The `neutral` pills: "Módulo {nn}", "Aula {nn}", then "Aula aberta" and/or "Prática". */
  pills: string[];
  /** "mm:ss" of the ready video, null without one. */
  duration: string | null;
  instructorLine: string;
  instructorPhotoAssetId: string | null;
  /** Null when empty: "Sobre esta aula" is absent (E09 empty). */
  description: string | null;
  /** Null without a video: no media block at all (E09 empty). */
  video: {
    assetId: string;
    status: Exclude<LessonVideoStatus, 'none'>;
    /** The member's stored place (D-430): the player seeks there with no prompt. */
    startTime: number;
  } | null;
  /** The caller's stored one-way completion (the server's, D-427). */
  completed: boolean;
  /** The module bar under the completion zone (D-430). */
  moduleBar: { percent: number; progressLabel: string; line: string };
  materials: MemberMaterialView[];
  /** "1 arquivo" / "{n} arquivos". */
  materialsCount: string;
  moduleTitle: string;
  /** "Neste módulo": the module's titles-only rows, the current one marked (UI-D-430). */
  moduleRows: MemberLessonRowView[];
}

/**
 * The open lesson's page (UI-D-432): the identity, the media, the module bar, the materials and the
 * module list, every word built here from the API's `learnLessonSchema` answer. Pure: no clock, no
 * lock decision (the module rows label the server's `lockReason` through `memberLessonRowView`).
 */
export function lessonPageView(
  lesson: LearnLesson,
  t: CoursesTranslator,
  { preview = false }: { preview?: boolean } = {},
): LessonPageView {
  const nn = padNumber(lesson.moduleNumber);
  const pills = [
    t('courses.member.player.module', { nn }),
    t('courses.member.player.lesson', { nn: padNumber(lesson.lessonNumber) }),
  ];
  const hasVideo = lesson.videoAssetId !== null && lesson.videoStatus !== 'none';
  if (lesson.isFree) pills.push(t('courses.member.player.free'));
  if (!hasVideo) pills.push(t('courses.member.player.practice'));

  const { done, total } = lesson.moduleProgress;
  const percent = coursePercent(done, total);

  return {
    courseId: lesson.courseId,
    courseTitle: lesson.courseTitle,
    courseHref: memberCourseHref(lesson.courseId, preview),
    title: lesson.title,
    pills,
    duration: lesson.durationSeconds !== null ? formatLessonDuration(lesson.durationSeconds) : null,
    instructorLine: t('courses.course.instructor', { instructor: lesson.instructorName }),
    instructorPhotoAssetId: lesson.instructorPhotoAssetId,
    description: lesson.description.trim() ? lesson.description : null,
    video:
      hasVideo && lesson.videoAssetId !== null && lesson.videoStatus !== 'none'
        ? {
            assetId: lesson.videoAssetId,
            status: lesson.videoStatus,
            startTime: lesson.progress.lastPositionSeconds,
          }
        : null,
    completed: lesson.progress.completedAt !== null,
    moduleBar: {
      percent,
      progressLabel: t('courses.member.progress.aria', { percent }),
      line: t('courses.member.player.moduleProgress', { nn, done, total }),
    },
    materials: memberMaterialViews(lesson.materials, t),
    materialsCount: t('courses.member.player.materialsCount', { n: lesson.materials.length }),
    moduleTitle: lesson.moduleTitle,
    moduleRows: lesson.moduleLessons.map((row) =>
      memberLessonRowView(row, t, {
        courseId: lesson.courseId,
        moduleNumber: lesson.moduleNumber,
        preview,
        currentLessonId: lesson.id,
      }),
    ),
  };
}

export type LessonNextView =
  /** An open next lesson: "Próxima aula" — brand once THIS lesson is complete, outline before. */
  | { kind: 'open'; href: string; label: string }
  /** A locked next lesson: a non-interactive span with `Lock` and the reason in words. */
  | { kind: 'locked'; label: string }
  /** No next lesson: the outline "Voltar para o curso". */
  | { kind: 'end'; href: string; label: string };

export interface LessonNavView {
  /** Null → the `aria-disabled` "Aula anterior" span (no previous OPEN lesson). */
  previousHref: string | null;
  previousLabel: string;
  next: LessonNextView;
}

/**
 * The previous and next pair (UI-D-432, E07/E09 interaction truths). The player never decides a
 * lock: the next lesson's words come from the server's `lockReason` through the pure
 * `lessonLockLabel` formatter, whose key maps 1:1 onto the button's shorter words — lesson rule →
 * "Conclua esta aula", module rule → "Conclua o módulo", purchase → "Aula exclusiva".
 */
const NAV_LOCK_KEY: Record<string, string> = {
  'courses.member.lesson.lockedByPrevious': 'courses.member.player.nextLockedPrevious',
  'courses.member.lesson.lockedByModule': 'courses.member.player.nextLockedModule',
  'courses.member.lesson.exclusive': 'courses.member.player.nextExclusive',
};

export function lessonNavView(
  lesson: Pick<LearnLesson, 'courseId' | 'moduleNumber' | 'previous' | 'next'>,
  t: CoursesTranslator,
  { preview = false }: { preview?: boolean } = {},
): LessonNavView {
  const previous = lesson.previous;
  const previousHref =
    previous && previous.lockReason === null
      ? memberLessonHref(lesson.courseId, previous.id, preview)
      : null;

  let next: LessonNextView;
  if (!lesson.next) {
    next = {
      kind: 'end',
      href: memberCourseHref(lesson.courseId, preview),
      label: t('courses.member.player.back'),
    };
  } else {
    const lock = lessonLockLabel({
      lockReason: lesson.next.lockReason,
      previousModuleNumber: lesson.moduleNumber,
    });
    next = lock
      ? {
          kind: 'locked',
          label: t(NAV_LOCK_KEY[lock.key] ?? 'courses.member.player.nextExclusive'),
        }
      : {
          kind: 'open',
          href: memberLessonHref(lesson.courseId, lesson.next.id, preview),
          label: t('courses.member.player.next'),
        };
  }

  return { previousHref, previousLabel: t('courses.member.player.previous'), next };
}

/* ── Lesson lock page (08.5-08, UI-D-431, D-424, D-428, A-UI-3) ───────────────────────────────── */

export interface LessonLockView {
  courseId: string;
  /** The header's title: the course title (as the player's). */
  courseTitle: string;
  courseHref: string;
  /** The over-media pill: "Exclusiva" (purchase) or "Bloqueada" (sequence). */
  mediaPill: string;
  /** "Módulo {nn}", "Aula {nn}", plus "Prática" without a video. */
  pills: string[];
  duration: string | null;
  title: string;
  instructorLine: string;
  instructorPhotoAssetId: string | null;
  /** The sequence notice; null for a purchase lock (the buy section speaks instead). */
  sequence: {
    title: string;
    /** The lock label as a sentence ("Libera ao concluir a aula anterior."). */
    body: string;
    /** "Continuar o curso" (brand) to `nextLessonId`, or the outline "Voltar para o curso". */
    action: { href: string; label: string; brand: boolean };
  } | null;
  /** The first free lesson's URL (purchase only), for "Assistir à aula aberta". */
  freeLessonHref: string | null;
}

/** The row-meta keys of `lessonLockLabel` → the lock page's sentences (same values). */
const LOCK_SENTENCE_KEY: Record<string, string> = {
  'courses.member.lesson.lockedByPrevious': 'courses.member.lock.bodyPrevious',
  'courses.member.lesson.lockedByModule': 'courses.member.lock.bodyModule',
};

/**
 * The lock page of a lesson (UI-D-431), built from the COURSE outline only — the titles-only read
 * (D-423): the lesson's title, its numbers and its length come from there, and its description,
 * video, poster and materials are never requested (T-08.5-13). `reason` is the lesson read's refusal
 * (403 → `purchase`, 409 → `sequence`); the sentence comes from the outline row's own `lockReason`
 * through the pure `lessonLockLabel` formatter. The sequence action sends the member to the course's
 * `nextLessonId` — the lesson that unblocks the path — or back to the course when there is none.
 *
 * Null when the outline does not list the lesson (removed, another course's): the page's not-found.
 */
export function lessonLockView(
  course: Pick<
    LearnCourse,
    'id' | 'title' | 'modules' | 'progress' | 'instructorName' | 'instructorPhotoAssetId'
  >,
  lessonId: string,
  reason: 'purchase' | 'sequence',
  t: CoursesTranslator,
  { preview = false }: { preview?: boolean } = {},
): LessonLockView | null {
  const module = course.modules.find((entry) =>
    entry.lessons.some((lesson) => lesson.id === lessonId),
  );
  const lesson = module?.lessons.find((entry) => entry.id === lessonId);
  if (!module || !lesson) return null;

  const pills = [
    t('courses.member.player.module', { nn: padNumber(module.number) }),
    t('courses.member.player.lesson', { nn: padNumber(lesson.number) }),
  ];
  if (!lesson.hasVideo) pills.push(t('courses.member.player.practice'));

  let sequence: LessonLockView['sequence'] = null;
  if (reason === 'sequence') {
    const label = lessonLockLabel({
      lockReason: lesson.lockReason === 'module' ? 'module' : 'lesson',
      previousModuleNumber: module.number - 1,
    });
    const next = course.progress.nextLessonId;
    sequence = {
      title: t('courses.member.lock.title'),
      body: t(
        (label && LOCK_SENTENCE_KEY[label.key]) ?? 'courses.member.lock.bodyPrevious',
        label?.values ?? {},
      ),
      action:
        next && next !== lessonId
          ? {
              href: memberLessonHref(course.id, next, preview),
              label: t('courses.member.course.continue'),
              brand: true,
            }
          : {
              href: memberCourseHref(course.id, preview),
              label: t('courses.member.player.back'),
              brand: false,
            },
    };
  }

  const free = course.progress.firstFreeLessonId;
  return {
    courseId: course.id,
    courseTitle: course.title,
    courseHref: memberCourseHref(course.id, preview),
    mediaPill: t(
      reason === 'purchase'
        ? 'courses.member.lock.pillExclusive'
        : 'courses.member.lock.pillLocked',
    ),
    pills,
    duration: lesson.durationSeconds !== null ? formatLessonDuration(lesson.durationSeconds) : null,
    title: lesson.title,
    instructorLine: t('courses.course.instructor', { instructor: course.instructorName }),
    instructorPhotoAssetId: course.instructorPhotoAssetId,
    sequence,
    freeLessonHref:
      reason === 'purchase' && free && free !== lessonId
        ? memberLessonHref(course.id, free, preview)
        : null,
  };
}

/* ── Live page (08.5-09, UI-D-435, UI-D-436, D-431..D-434, COURSE-24) ────────────────────────── */

/** The member Lives tab, where the live page's back control and its not-found lead. */
export const MEMBER_LIVES_HREF = '/cursos?aba=lives';

/**
 * The live page's ONE state zone, every word finished here from the API's `state` (UI-D-435).
 * `locked` carries no words: the host composes the buy section from the store's access read
 * (`lockedLiveView`), so the zone's lock comes from the courses API and its buy path from the store.
 */
export type LiveZoneView =
  | { state: 'cancelled'; text: string }
  | { state: 'locked' }
  /** "Começa em {date}, às {time}." or "Começa hoje, às {time}." (the API's `startsToday`). */
  | { state: 'before'; line: string; hint: string }
  /** Inside the window: the API's `joinUrl`, never built here. */
  | { state: 'open'; href: string; label: string; helper: string }
  | {
      state: 'replay';
      lessonId: string;
      label: string;
      /** Null when the replay lesson has no video: the zone then says the recording is missing. */
      video: {
        assetId: string;
        status: Exclude<LessonVideoStatus, 'none'>;
        startTime: number;
      } | null;
      noVideoText: string;
      completed: boolean;
      materials: MemberMaterialView[];
      materialsTitle: string;
      materialsCount: string;
    }
  | { state: 'ended'; text: string };

/** The server's instants the page's refresh timer reads (UI-D-436); never the browser clock. */
export interface LiveRefreshInput {
  joinOpensAt: string;
  startsAt: string;
  endsAt: string;
  serverNow: string;
}

export interface LivePageView {
  id: string;
  title: string;
  /** `/cursos?aba=lives`. */
  backHref: string;
  coverAssetId: string | null;
  coverAlt: string;
  /** The status as an over-media pill; null in the `ended` state (no "Gravada" over "no recording"). */
  statusPill: { label: string; icon: 'radio' | null } | null;
  /** The live is locked for this caller: "Exclusiva" follows the status pill. */
  exclusive: boolean;
  /** "{weekday}, {day} de {month}, {time} · {duration} min" in the tenant timezone. */
  meta: string;
  /** Null when empty: the description block is absent. */
  description: string | null;
  zone: LiveZoneView;
  /** Set for `before` and `open` only: the edges the refresh timer waits for. */
  refresh: LiveRefreshInput | null;
}

/** "22 de outubro" (the "Começa em" date) in the tenant timezone. */
function liveDayMonth(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long' }).format(at);
}

/**
 * "quinta, 22 de outubro" (the long-form meta date, UI-D-435): pt-BR's long weekday with "-feira"
 * dropped, as the Copywriting Contract writes it ("quinta", "sábado", "domingo").
 */
function liveLongDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(at)
    .replace(/-feira/g, '');
}

function liveTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    at,
  );
}

/** Only an `https:` room link is ever rendered as a link (defense in depth over COURSE-11). */
function safeJoinUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The member live page (UI-D-435): the header, the cover's pills, the long-form date line, the
 * description and the ONE state zone, all from the API's `learnLiveSchema` answer. Pure: no clock,
 * no state decision — `state`, `status`, `startsToday` and `joinUrl` are the server's (UI-D-436), and
 * the date and time are formatted with `Intl` in the tenant's timezone so the same instant renders
 * identically before and after hydration.
 *
 *  - `open` → the API's `joinUrl` (only an `https:` one) with "A live acontece fora do app…" while
 *    the live is on air, or "A live começa às {time}. Você já pode entrar." while the server still
 *    says `scheduled`; an `open` answer without a usable link falls back to the `before` words, so a
 *    link is never invented;
 *  - `ended` → the status pill is dropped (sketch 010 finding 2: "Gravada" over "A gravação não está
 *    disponível." contradicts itself).
 */
export function livePageView(
  live: LearnLive,
  timeZone: string,
  t: CoursesTranslator,
): LivePageView {
  const startsAt = new Date(live.startsAt);
  const time = liveTime(startsAt, timeZone);

  const before: LiveZoneView = {
    state: 'before',
    line: live.startsToday
      ? t('courses.member.live.startsToday', { time })
      : t('courses.member.live.startsOn', { date: liveDayMonth(startsAt, timeZone), time }),
    hint: t('courses.member.live.joinHint'),
  };

  let zone: LiveZoneView;
  switch (live.state) {
    case 'cancelled':
      zone = { state: 'cancelled', text: t('courses.member.live.cancelled') };
      break;
    case 'locked':
      zone = { state: 'locked' };
      break;
    case 'before':
      zone = before;
      break;
    case 'open': {
      const href = safeJoinUrl(live.joinUrl);
      zone = href
        ? {
            state: 'open',
            href,
            label: t('courses.member.live.join'),
            helper:
              live.status === 'scheduled'
                ? t('courses.member.live.joinEarly', { time })
                : t('courses.member.live.joinHelper'),
          }
        : before;
      break;
    }
    case 'replay': {
      const replay = live.replay;
      if (!replay) {
        zone = { state: 'ended', text: t('courses.member.live.noReplay') };
        break;
      }
      const hasVideo = replay.videoAssetId !== null && replay.videoStatus !== 'none';
      zone = {
        state: 'replay',
        lessonId: replay.lessonId,
        label: t('courses.member.live.watchReplay'),
        video:
          hasVideo && replay.videoAssetId !== null && replay.videoStatus !== 'none'
            ? {
                assetId: replay.videoAssetId,
                status: replay.videoStatus,
                startTime: replay.progress.lastPositionSeconds,
              }
            : null,
        noVideoText: t('courses.member.live.noReplay'),
        completed: replay.progress.completedAt !== null,
        materials: memberMaterialViews(replay.materials, t),
        materialsTitle: t('courses.member.live.replayMaterials'),
        materialsCount: t('courses.member.player.materialsCount', { n: replay.materials.length }),
      };
      break;
    }
    default:
      zone = { state: 'ended', text: t('courses.member.live.noReplay') };
  }

  const statusLabel =
    live.status === 'live' ? t('courses.member.lives.liveNow') : t(`courses.status.${live.status}`);

  return {
    id: live.id,
    title: live.title,
    backHref: MEMBER_LIVES_HREF,
    coverAssetId: live.coverAssetId,
    coverAlt: t('courses.alt.live', { title: live.title }),
    statusPill:
      zone.state === 'ended'
        ? null
        : { label: statusLabel, icon: live.status === 'live' ? 'radio' : null },
    exclusive: live.locked,
    meta: t('courses.member.live.meta', {
      date: liveLongDate(startsAt, timeZone),
      time,
      duration: live.durationMin,
    }),
    description: live.description.trim() ? live.description : null,
    zone,
    refresh:
      zone.state === 'before' || zone.state === 'open'
        ? {
            joinOpensAt: live.joinOpensAt,
            startsAt: live.startsAt,
            endsAt: live.endsAt,
            serverNow: live.serverNow,
          }
        : null,
  };
}
