import type { CoursePage } from '@rede-social/module-courses/contracts';
import { Chip, SectionTitle } from '@rede-social/ui';
import { ChevronRight, Plus, Tag } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED, getCategories, getCourses } from '@/lib/courses';
import {
  COURSE_FILTER_LABEL_KEY,
  COURSE_FILTER_ORDER,
  courseFilterFromParam,
  courseFilterHref,
  courseRowView,
} from '@/lib/courses-view';
import { CoursesList } from './CoursesList';

/** The brand create control (UI-D-391): 44px tall, `shrink-0`, the `sm` type with `Plus` 16. */
const CREATE_LINK =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) px-4 text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The hub's Cursos tab (08.3-06, UI-D-391, UI-D-392, UI-D-401), server-composed:
 *
 *  - the title row — the tab's name as a `SectionTitle` h2 16/700 and the brand "Novo curso";
 *  - the status chips (`Chip` LINKS bound to `?filtro=`, read HERE on the server; an unknown value
 *    reads as "Todos", E03 partial) in ONE non-wrapping row that scrolls at 320px with the scrollbar
 *    hidden and `-mx-4 px-4` scroll padding (E03 overflow);
 *  - the 44px "Categorias" row link with the tenant's category count (D-411: the manager lives inside
 *    the Cursos tab, not in Configurações);
 *  - the first page, handed to `CoursesList` as FINISHED row views (`courseRowView`), keyed by the
 *    filter so a chip switch starts from the server's page 1. The web never sorts (P09).
 *
 * The first read's refusals split three ways (the `loja/page.tsx` posture): a flag flip between the
 * bootstrap and this read (`MODULE_DISABLED`) is the school being off → the kernel not-found; a
 * refusal the bootstrap knows navigates OUTSIDE the try/catch (`redirect()` throws); anything else
 * is the first-load error card the list renders with its retry (`page` stays null, E03 error).
 */
export async function CoursesTab({
  filtro,
  tenantName,
}: {
  filtro: string | string[] | undefined;
  tenantName: string;
}) {
  const t = await getTranslations();
  const filter = courseFilterFromParam(filtro);

  let page: CoursePage | null = null;
  let path: string | null = null;
  let disabled = false;
  const [pageOutcome, categories] = await Promise.all([
    getCourses({ filter }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    getCategories(),
  ]);
  if (pageOutcome.ok) {
    page = pageOutcome.result;
  } else {
    const error = pageOutcome.error;
    if (error instanceof ApiClientError) {
      if (error.status === 404 && error.code === COURSES_MODULE_DISABLED) disabled = true;
      else path = bootstrapRedirectPath(error);
    }
    // Shape only: a course title is tenant content and never reaches a log line.
    if (!disabled && !path) {
      console.error('courses.list_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }
  if (categories.status === 'disabled') disabled = true;
  if (categories.status === 'redirect' && !path) path = categories.path;
  if (path) redirect(path);
  if (disabled) notFound();

  // A failed category read degrades to a row without its count (UI-D-384), never to a wrong one.
  const categoryCount = categories.status === 'ok' ? categories.categories.length : null;
  const items = (page?.items ?? []).map((row) => courseRowView(row, t));

  return (
    <section
      aria-labelledby="courses-tab-title"
      data-testid="courses-tab"
      className="flex flex-col"
    >
      <div className="px-4">
        {/* The title block is `min-w-0 flex-1` and the control `shrink-0`: the control keeps its
            44px at any width (E02 long-text). */}
        <div className="flex items-center justify-between gap-3 pb-3">
          <SectionTitle
            id="courses-tab-title"
            variant="group"
            className="min-w-0 flex-1 truncate text-base font-bold text-text"
          >
            {t('courses.hub.tabs.courses')}
          </SectionTitle>
          <a href="/cursos/novo" data-courses-create className={CREATE_LINK}>
            <Plus aria-hidden size={16} />
            {t('courses.hub.create.course')}
          </a>
        </div>

        {/* Never wraps: `shrink-0` chips in one row; four fit at 390px and scroll at 320px. */}
        <nav
          aria-label={t('courses.list.filter.label')}
          data-testid="courses-filters"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none"
        >
          {COURSE_FILTER_ORDER.map((key) => (
            <Chip
              key={key}
              href={courseFilterHref(key)}
              active={filter === key}
              className="shrink-0"
            >
              {t(COURSE_FILTER_LABEL_KEY[key])}
            </Chip>
          ))}
        </nav>
      </div>

      {/* D-411: the category manager's door, a navigation row (the Configurações `Row` geometry). */}
      <a
        href="/cursos/categorias"
        data-testid="courses-categories-row"
        aria-label={
          categoryCount === null
            ? t('courses.list.categories.label')
            : t('courses.list.categories.aria', { N: categoryCount })
        }
        className="flex min-h-11 w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <Tag aria-hidden size={20} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
          {t('courses.list.categories.label')}
        </span>
        {categoryCount === null ? null : (
          <span
            data-testid="courses-categories-count"
            className="shrink-0 text-xs font-normal text-text-tertiary tabular-nums"
          >
            {categoryCount}
          </span>
        )}
        <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
      </a>

      <CoursesList
        key={filter}
        filter={filter}
        tenantName={tenantName}
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </section>
  );
}
