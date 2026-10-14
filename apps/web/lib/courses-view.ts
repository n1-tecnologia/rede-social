import type {
  CourseDetail,
  CourseFilter,
  CourseLevel,
  CourseRow,
  CourseStatus,
  LessonDetail,
  LessonVideoStatus,
  LessonView,
  Material,
  MaterialKind,
  ModuleView,
  TrackDetail,
  TrackFilter,
  TrackStatus,
} from '@rede-social/module-courses/contracts';
import { materialKind } from '@rede-social/module-courses/contracts';
import type { getTranslations } from 'next-intl/server';

/**
 * THE formatter module for the school (08.3-06, UI-D-410): every duration, size, meta line, pill
 * and accessible name a courses surface prints is built here, so the hub rows, the course page and
 * (in later plans) the curriculum editor, the lesson form and the track/live tabs can never
 * disagree. The `store-view.ts` shape.
 *
 * **Durations come from the asset, never typed** (D-409): lessons render "mm:ss", module and course
 * totals "45 min" / "2 h 15 min", hours "12 h", sizes "2,4 MB" in binary units with one decimal
 * through `Intl.NumberFormat('pt-BR')`. Nothing here rounds a count, reads the clock, fetches or
 * sorts (P09): the rows arrive in the API's order and leave in it.
 */

/** The same untyped translator every `lib/*-view` module takes. Keys are FULL (`courses.…`). */
type Translator = Awaited<ReturnType<typeof getTranslations>>;
/** Exported for client hosts that pass their root `useTranslations()`. */
export type CoursesTranslator = Translator;

/* ── Filters (UI-D-391) ──────────────────────────────────────────────────────────────────────── */

/** The pt-BR `?filtro=` values the chips write, mapped to the API's closed filter enum. */
export const COURSE_FILTER_PARAMS = {
  todos: 'all',
  rascunhos: 'draft',
  publicados: 'published',
  arquivados: 'archived',
} as const satisfies Record<string, CourseFilter>;

/** The chip query value for each filter (`all` has none: it is `/cursos`). */
export const COURSE_FILTER_QUERY: Record<CourseFilter, string | null> = {
  all: null,
  draft: 'rascunhos',
  published: 'publicados',
  archived: 'arquivados',
};

/** The chip order of UI-D-391: Todos · Rascunhos · Publicados · Arquivados (P57). */
export const COURSE_FILTER_ORDER: readonly CourseFilter[] = [
  'all',
  'draft',
  'published',
  'archived',
];

/**
 * `?filtro=` → the filter the page reads (E03 partial). Anything but one of the four exact strings
 * reads as `all` (a repeated value, an unknown one, or none).
 */
export function courseFilterFromParam(value: string | string[] | undefined): CourseFilter {
  if (typeof value !== 'string') return 'all';
  return Object.hasOwn(COURSE_FILTER_PARAMS, value)
    ? COURSE_FILTER_PARAMS[value as keyof typeof COURSE_FILTER_PARAMS]
    : 'all';
}

/** The `/cursos` href of a filter chip (the Cursos tab is the default `aba`, so it stays implicit). */
export function courseFilterHref(filter: CourseFilter): string {
  const query = COURSE_FILTER_QUERY[filter];
  return query === null ? '/cursos' : `/cursos?filtro=${query}`;
}

/** The catalog key of each chip label. */
export const COURSE_FILTER_LABEL_KEY: Record<CourseFilter, string> = {
  all: 'courses.list.filter.all',
  draft: 'courses.list.filter.drafts',
  published: 'courses.list.filter.published',
  archived: 'courses.list.filter.archived',
};

/* ── Durations, hours and sizes (UI-D-410) ───────────────────────────────────────────────────── */

/**
 * A course or module total from seconds: "45 min", "2 h 15 min", "1 h"; `''` for zero or less, so a
 * row with no ready video omits its duration rather than printing "0 min" (UI-D-392). Rounded to the
 * nearest minute, never below one minute for a positive length.
 */
export function formatCourseDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * A lesson's length from the ready asset's seconds: "mm:ss" ("12:34", "1:05"), "h:mm:ss" above an
 * hour ("1:01:01"). Never typed (D-409); the caller passes the asset's integer seconds.
 */
export function formatLessonDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mmss = `${hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)}:${String(secs).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Certificate hours as an integer with the unit: "12 h". */
export function formatHours(hours: number): string {
  return `${Math.trunc(hours)} h`;
}

const SIZE_NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * A file size from integer bytes in BINARY units labelled the way `formatMediaLimit` labels them
 * ("MB", "KB"), one decimal at most, pt-BR comma: 2 516 582 → "2,4 MB", 184 320 → "180 KB" (P29).
 */
export function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value < 1024) return `${SIZE_NUMBER.format(value)} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${SIZE_NUMBER.format(kib)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${SIZE_NUMBER.format(mib)} MB`;
  return `${SIZE_NUMBER.format(mib / 1024)} GB`;
}

/* ── Rows (UI-D-392) ─────────────────────────────────────────────────────────────────────────── */

export type RowPillTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface RowPillView {
  label: string;
  tone: RowPillTone;
}

/** The status pill of a course (UI-D-392): Rascunho `neutral`, Publicado `success`, Arquivado `neutral`. */
export function courseStatusPill(status: CourseStatus, t: Translator): RowPillView {
  return {
    label: t(`courses.status.${status}`),
    tone: status === 'published' ? 'success' : 'neutral',
  };
}

/** One finished course row: every string built here, the server's order kept by the list. */
export interface CourseRowView {
  id: string;
  href: string;
  title: string;
  /** "{N} módulos · {N} aulas" plus " · {duration}" when any video is ready. */
  meta: string;
  /** The status pill first, then "Processando" on a course whose videos are not all ready. */
  pills: RowPillView[];
  /** "{title}, {status}". */
  ariaLabel: string;
  /** Null takes the row's brand-gradient thumb (D-69). */
  coverAssetId: string | null;
  coverAlt: string;
}

/**
 * `CourseRow` (the API's row) → the finished row (UI-D-392). The meta counts are the API's, never
 * recomputed; the duration is omitted when zero; the second pill appears only while
 * `hasUnreadyVideo` (the publish-blocked badge the hub shows before the course page says why).
 */
export function courseRowView(
  row: Pick<
    CourseRow,
    | 'id'
    | 'title'
    | 'status'
    | 'coverAssetId'
    | 'moduleCount'
    | 'lessonCount'
    | 'durationSeconds'
    | 'hasUnreadyVideo'
  >,
  t: Translator,
): CourseRowView {
  const duration = formatCourseDuration(row.durationSeconds);
  const counts = { modules: row.moduleCount, lessons: row.lessonCount };
  const meta = duration
    ? t('courses.row.metaWithDuration', { ...counts, duration })
    : t('courses.row.meta', counts);
  const status = courseStatusPill(row.status, t);
  const pills: RowPillView[] = [status];
  if (row.hasUnreadyVideo) pills.push({ label: t('courses.status.processing'), tone: 'warning' });
  return {
    id: row.id,
    href: `/cursos/${encodeURIComponent(row.id)}`,
    title: row.title,
    meta,
    pills,
    ariaLabel: t('courses.row.aria', { title: row.title, status: status.label }),
    coverAssetId: row.coverAssetId,
    coverAlt: t('courses.alt.course', { title: row.title }),
  };
}

/** The track row's input (plan 10 publishes the contract type; the view is ready for it). */
export interface TrackRowInput {
  id: string;
  title: string;
  status: 'active' | 'archived';
  coverAssetId: string | null;
  /** Published courses only (D-415). */
  courseCount: number;
}

/** One finished track row (UI-D-392): meta "{N} cursos", the "Arquivada" pill only when archived. */
export function trackRowView(track: TrackRowInput, t: Translator): CourseRowView {
  const pills: RowPillView[] =
    track.status === 'archived'
      ? [{ label: t('courses.status.trackArchived'), tone: 'neutral' }]
      : [];
  const statusWord = pills[0]?.label ?? t('courses.tracks.filter.active');
  return {
    id: track.id,
    href: `/cursos/trilhas/${encodeURIComponent(track.id)}`,
    title: track.title,
    meta: t('courses.tracks.row.meta', { N: track.courseCount }),
    pills,
    ariaLabel: t('courses.row.aria', { title: track.title, status: statusWord }),
    coverAssetId: track.coverAssetId,
    coverAlt: t('courses.alt.track', { title: track.title }),
  };
}

/** The live's derived status (D-416), computed by the server and passed in — never from `Date.now()` here. */
export type LiveStatus = 'scheduled' | 'live' | 'recorded' | 'cancelled';

/** The live row's input (plan 11 publishes the contract type; the view is ready for it). */
export interface LiveRowInput {
  id: string;
  title: string;
  coverAssetId: string | null;
  startsAt: string;
  durationMin: number;
  status: LiveStatus;
}

/** The pill tones of UI-D-392: Agendada / Gravada / Cancelada `neutral`, Ao vivo `success`. */
export function liveStatusPill(status: LiveStatus, t: Translator): RowPillView {
  return {
    label: t(`courses.status.${status}`),
    tone: status === 'live' ? 'success' : 'neutral',
  };
}

/**
 * One finished live row (UI-D-392): the meta "{weekday} {day} {month}, {time} · {duration} min" in
 * the TENANT's timezone (the device's zone never enters), the derived status pill. `Intl` formats
 * the date on the server, so the same instant renders identically before and after hydration.
 */
export function liveRowView(
  live: LiveRowInput,
  { timezone }: { timezone: string },
  t: Translator,
): CourseRowView {
  const at = new Date(live.startsAt);
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(at)
    .replace(/\./g, '');
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  const status = liveStatusPill(live.status, t);
  return {
    id: live.id,
    href: `/cursos/lives/${encodeURIComponent(live.id)}`,
    title: live.title,
    meta: t('courses.lives.row.meta', { date, time, duration: live.durationMin }),
    pills: [status],
    ariaLabel: t('courses.row.aria', { title: live.title, status: status.label }),
    coverAssetId: live.coverAssetId,
    coverAlt: t('courses.alt.live', { title: live.title }),
  };
}

/* ── The course form (08.3-07, UI-D-393) ─────────────────────────────────────────────────────── */

/** The catalog key of each level chip (the prototype's `CourseLevel`, D-412's fixed enum). */
export const COURSE_LEVEL_LABEL_KEY: Record<CourseLevel, string> = {
  iniciante: 'courses.level.beginner',
  intermediario: 'courses.level.intermediate',
  avancado: 'courses.level.advanced',
};

/** The chip order of UI-D-393: Iniciante · Intermediário · Avançado. */
export const COURSE_LEVEL_ORDER: readonly CourseLevel[] = [
  'iniciante',
  'intermediario',
  'avancado',
];

/** A category as the course form's picker draws it (the API's list row, cover included). */
export interface CourseFormCategory {
  id: string;
  name: string;
  coverAssetId: string | null;
}

/**
 * A store product as the course form draws it: a selected row and a picker row share this shape
 * (D-404). `imageAssetId` is null for a product without an image AND for a saved link whose product
 * the picker no longer lists (archived): both take the gradient thumb.
 */
export interface CourseFormProduct {
  id: string;
  name: string;
  imageAssetId: string | null;
  status: 'active' | 'archived';
}

/** The edit form's starting values: the saved course as the form holds it. */
export interface CourseFormDefaults {
  title: string;
  tagline: string;
  description: string;
  categoryId: string | null;
  /** The saved category's name, so the picker row can name it even if the list no longer does. */
  categoryName: string | null;
  level: CourseLevel | null;
  coverAssetId: string | null;
  instructorName: string;
  instructorPhotoAssetId: string | null;
  outcomes: string[];
  certificateHours: number | null;
  /** The course's linked products, in the API's order (the saved link set, archived included). */
  products: CourseFormProduct[];
  status: CourseStatus;
}

/** `CourseDetail` → the edit form's defaults (UI-D-393). */
export function courseFormDefaults(course: CourseDetail): CourseFormDefaults {
  return {
    title: course.title,
    tagline: course.tagline,
    description: course.description,
    categoryId: course.category?.id ?? null,
    categoryName: course.category?.name ?? null,
    level: course.level,
    coverAssetId: course.coverAssetId,
    instructorName: course.instructorName,
    instructorPhotoAssetId: course.instructorPhotoAssetId,
    outcomes: [...course.outcomes],
    certificateHours: course.certificateHours,
    products: course.products.map((product) => ({
      id: product.id,
      name: product.name,
      imageAssetId: null,
      status: product.status,
    })),
    status: course.status,
  };
}

/* ── The course page and the curriculum editor (08.3-08, UI-D-394, UI-D-395) ─────────────────── */

/** The lesson form's route (plan 09): `/cursos/{courseId}/aulas/{lessonId}`. */
export function lessonHref(courseId: string, lessonId: string): string {
  return `/cursos/${encodeURIComponent(courseId)}/aulas/${encodeURIComponent(lessonId)}`;
}

/** The "Nova aula" route of a module (plan 09): `/cursos/{courseId}/aulas/nova?modulo={moduleId}`. */
export function newLessonHref(courseId: string, moduleId: string): string {
  return `/cursos/${encodeURIComponent(courseId)}/aulas/nova?modulo=${encodeURIComponent(moduleId)}`;
}

/** The `id` of the course page's curriculum section, where "e mais {n}" lands. */
export const CURRICULUM_SECTION_ID = 'modulos';

/**
 * "Publicado em 9 de outubro de 2026." — the date in the TENANT's timezone (the device's zone never
 * enters), formatted on the server so it renders identically before and after hydration (UI-D-407).
 */
export function formatPublishedAt(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** The words of one module card (UI-D-395), from the module and its 1-based position in the draft. */
export interface ModuleCardView {
  /** "Módulo {position}" — the numeral's accessible name. */
  positionLabel: string;
  /** "Exige o anterior" when the flag is on — never on the first module (D-406 forces it off). */
  requiresPreviousLabel: string | undefined;
  /** "{N} aulas" plus " · {duration}" when any video is ready. */
  meta: string;
  /** "Editar módulo: {module}". */
  editLabel: string;
}

export function moduleCardView(
  module: Pick<ModuleView, 'title' | 'requiresPrevious' | 'lessonCount' | 'durationSeconds'>,
  position: number,
  t: Translator,
): ModuleCardView {
  const duration = formatCourseDuration(module.durationSeconds);
  return {
    positionLabel: t('courses.curriculum.module.aria', { position }),
    requiresPreviousLabel:
      module.requiresPrevious && position > 1
        ? t('courses.curriculum.module.requiresPrevious')
        : undefined,
    meta: duration
      ? t('courses.curriculum.module.metaWithDuration', { N: module.lessonCount, duration })
      : t('courses.curriculum.module.meta', { N: module.lessonCount }),
    editLabel: t('courses.curriculum.module.edit', { module: module.title }),
  };
}

/** The thumb state of a lesson row (UI-D-395): the ready poster, or one of three glyphs. */
export type LessonThumbView =
  | { kind: 'poster'; src: string }
  | { kind: 'processing' }
  | { kind: 'practice' }
  | { kind: 'failed' };

/** One finished lesson row: every string built here, the module's order kept by the list. */
export interface LessonRowView {
  id: string;
  href: string;
  title: string;
  /** "12:34" when ready, "Prática" without video, the " · Aula aberta" suffix when `isFree`. */
  meta: string;
  thumb: LessonThumbView;
  /** Only while the video is not ready: Processando `warning`, Falhou `danger`. */
  pill: RowPillView | undefined;
  /** "{title}, {pill}" while a pill shows; the title alone otherwise. */
  ariaLabel: string;
}

/**
 * `LessonView` (the API's row) → the finished row (UI-D-395, D-407, D-409). The duration is the
 * asset's seconds, never typed; a ready video whose thumbnail could not be minted (the asset answered
 * 404 or 409) takes the `Camera` fallback; a lesson without video is "Prática"; `isFree` appends
 * " · Aula aberta" (alone, without the separator, when nothing precedes it).
 */
export function lessonRowView(
  lesson: Pick<
    LessonView,
    'id' | 'title' | 'isFree' | 'videoStatus' | 'durationSeconds' | 'videoAssetId'
  >,
  courseId: string,
  t: Translator,
  thumbnailUrl?: string,
): LessonRowView {
  let base = '';
  let thumb: LessonThumbView;
  let pill: RowPillView | undefined;
  switch (lesson.videoStatus) {
    case 'ready':
      base = lesson.durationSeconds ? formatLessonDuration(lesson.durationSeconds) : '';
      thumb = thumbnailUrl ? { kind: 'poster', src: thumbnailUrl } : { kind: 'failed' };
      break;
    case 'pending':
    case 'processing':
      thumb = { kind: 'processing' };
      pill = { label: t('courses.status.processing'), tone: 'warning' };
      break;
    case 'failed':
      thumb = { kind: 'failed' };
      pill = { label: t('courses.status.failed'), tone: 'danger' };
      break;
    default:
      base = t('courses.curriculum.lesson.practice');
      thumb = { kind: 'practice' };
  }
  const free = t('courses.curriculum.lesson.free');
  const meta = lesson.isFree ? (base ? `${base}${free}` : free.replace(/^\s*·\s*/, '')) : base;
  return {
    id: lesson.id,
    href: lessonHref(courseId, lesson.id),
    title: lesson.title,
    meta,
    thumb,
    pill,
    ariaLabel: pill
      ? t('courses.row.aria', { title: lesson.title, status: pill.label })
      : lesson.title,
  };
}

/** A lesson as the publish zone names it: the form link the notice points at. */
export interface PublishBlockedLesson {
  id: string;
  title: string;
  href: string;
}

/** The notice's words (UI-D-394, E05 overflow): the sentence, the first five links, then "e mais {n}". */
export interface PublishBlockedView {
  sentence: string;
  links: { href: string; label: string }[];
  moreHref: string | undefined;
  moreLabel: string | undefined;
}

/** How many lesson links the notice names before "e mais {n}" (the module component's cap). */
export const PUBLISH_BLOCKED_LINKS = 5;

/**
 * The blocking lesson ids (the detail's `unreadyLessonIds`, or the server's `409 video_not_ready`
 * answer — server truth wins) mapped onto the curriculum's lessons, in the curriculum's order. The
 * count is the ids' (an id the page no longer lists still blocks); `null` when nothing blocks.
 */
export function publishBlockedView(
  unreadyLessonIds: readonly string[],
  lessons: readonly PublishBlockedLesson[],
  courseId: string,
  t: Translator,
): PublishBlockedView | null {
  const blocked = new Set(unreadyLessonIds);
  if (blocked.size === 0) return null;
  const links = lessons
    .filter((lesson) => blocked.has(lesson.id))
    .map((lesson) => ({ href: lesson.href, label: lesson.title }));
  const count = Math.max(blocked.size, links.length);
  const more = count > PUBLISH_BLOCKED_LINKS;
  return {
    sentence: t('courses.course.publishBlocked', { N: count }),
    links,
    moreHref: more ? `/cursos/${encodeURIComponent(courseId)}#${CURRICULUM_SECTION_ID}` : undefined,
    moreLabel: more
      ? t('courses.course.publishBlockedMore', { n: count - PUBLISH_BLOCKED_LINKS })
      : undefined,
  };
}

/** Every live lesson of a course in the curriculum's order, as the publish zone names them. */
export function publishBlockedLessons(
  modules: readonly Pick<ModuleView, 'lessons'>[],
  courseId: string,
): PublishBlockedLesson[] {
  return modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      href: lessonHref(courseId, lesson.id),
    })),
  );
}

/* ── The lesson form and its materials (08.3-09, UI-D-398, UI-D-399, D-409, D-410) ──────────── */

/** The lesson video as the form holds it: the asset id and what the API last read from the asset. */
export interface LessonFormVideo {
  assetId: string;
  status: Exclude<LessonVideoStatus, 'none'>;
  /** The asset's integer seconds, only once `ready` (D-409: never typed). */
  durationSeconds: number | null;
}

/** One material as the form's draft holds it: a saved row (`materialId`) or a fresh upload (`null`). */
export interface MaterialDraft {
  assetId: string;
  /** The join row's id — the handle the signed open takes; `null` until the lesson is saved. */
  materialId: string | null;
  filename: string;
  mime: string;
  bytes: number;
}

/** The edit form's starting values: the saved lesson as the form holds it. */
export interface LessonFormDefaults {
  title: string;
  description: string;
  video: LessonFormVideo | null;
  isFree: boolean;
  /** The saved materials in the API's order (`position, id`). */
  materials: MaterialDraft[];
}

/** `LessonDetail` → the edit form's defaults (UI-D-398). */
export function lessonFormDefaults(lesson: LessonDetail): LessonFormDefaults {
  return {
    title: lesson.title,
    description: lesson.description,
    video:
      lesson.videoAssetId !== null && lesson.videoStatus !== 'none'
        ? {
            assetId: lesson.videoAssetId,
            status: lesson.videoStatus,
            durationSeconds: lesson.durationSeconds,
          }
        : null,
    isFree: lesson.isFree,
    materials: lesson.materials.map((material) => ({
      assetId: material.assetId,
      materialId: material.id,
      filename: material.filename,
      mime: material.mime,
      bytes: material.bytes,
    })),
  };
}

/** The catalog key of each material kind label (UI-D-399). */
export const MATERIAL_KIND_LABEL_KEY: Record<MaterialKind, string> = {
  pdf: 'courses.lesson.materials.kind.pdf',
  sheet: 'courses.lesson.materials.kind.sheet',
  slides: 'courses.lesson.materials.kind.slides',
  image: 'courses.lesson.materials.kind.image',
  other: 'courses.lesson.materials.kind.other',
};

/** The order the kinds sentence names them: PDF, planilhas, slides, imagens (the contract's order). */
const KIND_ORDER: readonly MaterialKind[] = ['pdf', 'sheet', 'slides', 'image'];

/**
 * The materials helper's "{kinds}" from the CONTRACT's mime list (A-UI-1, E10 partial): the full set
 * reads the contract's full sentence ("PDF, planilhas, slides e imagens"), a PDF-only list reads
 * "PDF", and any other subset is the present kinds' labels joined by `Intl.ListFormat('pt-BR')` — so
 * narrowing `ATTACHMENT_MIMES` changes the helper with no copy change.
 */
export function materialKindsSentence(mimes: readonly string[], t: Translator): string {
  const present = new Set(mimes.map((mime) => materialKind(mime)));
  const kinds = KIND_ORDER.filter((kind) => present.has(kind));
  if (kinds.length === KIND_ORDER.length) return t('courses.lesson.materials.kinds.full');
  if (kinds.length === 1 && kinds[0] === 'pdf') return t('courses.lesson.materials.kinds.pdfOnly');
  const labels = kinds.map((kind) => {
    const label = t(MATERIAL_KIND_LABEL_KEY[kind]);
    return kind === 'pdf' ? label : label.toLocaleLowerCase('pt-BR');
  });
  return new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(labels);
}

/** One finished material row (UI-D-399): every string built here, the draft's order kept by the list. */
export interface MaterialRowView {
  /** The reorder key: the asset id (unique within a lesson's set, P25). */
  id: string;
  assetId: string;
  materialId: string | null;
  name: string;
  /** "{kind} · {size}" — "PDF · 2,4 MB", "Planilha · 180 KB". */
  meta: string;
  /** `image` draws the `Image` glyph, everything else `FileText` (UI-D-399). */
  glyph: 'image' | 'file';
  /** "Remover {file}". */
  removeLabel: string;
}

/** A saved or drafted material → the finished row; the kind is derived from the mime (P27). */
export function materialRowView(
  material: Pick<Material, 'filename' | 'mime' | 'bytes'> & {
    assetId: string;
    materialId?: string | null;
  },
  t: Translator,
): MaterialRowView {
  const kind = materialKind(material.mime);
  return {
    id: material.assetId,
    assetId: material.assetId,
    materialId: material.materialId ?? null,
    name: material.filename,
    meta: t('courses.lesson.materials.meta', {
      kind: t(MATERIAL_KIND_LABEL_KEY[kind]),
      size: formatBytes(material.bytes),
    }),
    glyph: kind === 'image' ? 'image' : 'file',
    removeLabel: t('courses.lesson.materials.remove', { file: material.filename }),
  };
}

/* ── 08.3-10: the Trilhas tab and the track form (UI-D-391, UI-D-402, D-415) ─────────────────── */

/** The pt-BR `?filtro=` values the Trilhas chips write, mapped to the API's two-value filter. */
export const TRACK_FILTER_PARAMS = {
  ativas: 'active',
  arquivadas: 'archived',
} as const satisfies Record<string, TrackFilter>;

/** The chip query value for each filter (`active` has none: it is the tab itself). */
export const TRACK_FILTER_QUERY: Record<TrackFilter, string | null> = {
  active: null,
  archived: 'arquivadas',
};

/** The chip order of UI-D-391: Ativas · Arquivadas. */
export const TRACK_FILTER_ORDER: readonly TrackFilter[] = ['active', 'archived'];

/** `?filtro=` → the filter the tab renders; anything unknown reads as "Ativas" (E04 partial). */
export function trackFilterFromParam(value: string | string[] | undefined): TrackFilter {
  if (typeof value !== 'string') return 'active';
  return (TRACK_FILTER_PARAMS as Record<string, TrackFilter>)[value] ?? 'active';
}

/** The chip's href: the Trilhas tab, plus `&filtro=` for the archive. */
export function trackFilterHref(filter: TrackFilter): string {
  const query = TRACK_FILTER_QUERY[filter];
  return query === null ? '/cursos?aba=trilhas' : `/cursos?aba=trilhas&filtro=${query}`;
}

export const TRACK_FILTER_LABEL_KEY: Record<TrackFilter, string> = {
  active: 'courses.tracks.filter.active',
  archived: 'courses.tracks.filter.archived',
};

/**
 * A course as the track form holds it — a picker row and a selected row share this shape. `status`
 * is the course's CURRENT one: a linked course that is no longer `published` is drawn with the "Não
 * publicado" pill, stays removable and is left out of the save (UI-D-402).
 */
export interface TrackFormCourse {
  id: string;
  title: string;
  coverAssetId: string | null;
  status: CourseStatus;
}

/** The edit form's starting values: the saved track as the form holds it. */
export interface TrackFormDefaults {
  title: string;
  subtitle: string;
  audience: string;
  description: string;
  coverAssetId: string | null;
  /** EVERY linked course in `position` order, its current status included. */
  courses: TrackFormCourse[];
  status: TrackStatus;
}

/** `TrackDetail` → the edit form's defaults (UI-D-402). */
export function trackFormDefaults(track: TrackDetail): TrackFormDefaults {
  return {
    title: track.title,
    subtitle: track.subtitle,
    audience: track.audience,
    description: track.description,
    coverAssetId: track.coverAssetId,
    courses: track.courses.map((course) => ({
      id: course.id,
      title: course.title,
      coverAssetId: course.coverAssetId,
      status: course.status,
    })),
    status: track.status,
  };
}

/** The ids the track form SAVES: the published rows only, in draft order (UI-D-402, COURSE-10). */
export function publishedTrackCourseIds(courses: readonly TrackFormCourse[]): string[] {
  return courses.filter((course) => course.status === 'published').map((course) => course.id);
}
