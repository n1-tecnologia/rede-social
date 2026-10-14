import type {
  CourseDetail,
  CourseFilter,
  CourseLevel,
  CourseRow,
  CourseStatus,
} from '@rede-social/module-courses/contracts';
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
