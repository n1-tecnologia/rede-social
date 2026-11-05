import type { CoursePage } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED, getCourses } from '@/lib/courses';
import { courseFilterFromParam, courseRowView } from '@/lib/courses-view';
import { ADMIN_SCREEN_TITLE_ID } from './admin-styles';
import { CoursesList } from './CoursesList';

/**
 * The body of the admin's Cursos screen (08.3-06, UI-D-391, UI-D-392, UI-D-401), server-composed:
 * the first page, handed to `CoursesList` as FINISHED row views (`courseRowView`), keyed by the
 * filter so a chip switch starts from the server's page 1. The web never sorts (P09).
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): the screen's frame
 * (`AdminListScreen`) now draws the h1, the brand "Novo curso" and the status chips OUTSIDE this
 * body's `Suspense`, so the old h2 title row and chips left this file; the section is named by the
 * screen's h1.
 *
 * 2026-10-23: the "Categorias" card above the list left too. The category manager's door is its own
 * card in "Gerenciar" (`/cursos/gerenciar`, D-411 still holds: it lives with the courses, not in
 * Configurações), so this body reads the courses only.
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
  try {
    page = await getCourses({ filter });
  } catch (error) {
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
  if (path) redirect(path);
  if (disabled) notFound();

  const items = (page?.items ?? []).map((row) => courseRowView(row, t));

  return (
    <section
      aria-labelledby={ADMIN_SCREEN_TITLE_ID.cursos}
      data-testid="courses-tab"
      className="flex flex-col gap-3 px-4"
    >
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
