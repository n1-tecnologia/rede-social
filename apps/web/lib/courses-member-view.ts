import type { LearnCategoryChip, LearnCourseCard } from '@rede-social/module-courses/contracts';
import type { CourseAccessItem } from '@rede-social/module-store/contracts';
import {
  COURSE_LEVEL_LABEL_KEY,
  type CoursesTranslator,
  formatCourseDuration,
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

  let ariaLabel = t('courses.member.card.aria', { course: card.title, N: card.lessonCount });
  if (tags.exclusive) ariaLabel += t('courses.member.card.ariaExclusive');
  if (progress) ariaLabel += t('courses.member.card.ariaProgress', { percent: progress.percent });

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
