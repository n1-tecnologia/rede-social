'use server';

import { type CourseFilter, courseListQuerySchema } from '@rede-social/module-courses/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getCourses } from '@/lib/courses';
import { type CourseRowView, courseRowView } from '@/lib/courses-view';

/**
 * The Cursos tab's paging and refresh (08.3-06, COURSE-14), in the `loja/actions.ts` conventions:
 * the SAME Zod the API validates with (`courseListQuerySchema`) runs BEFORE the request — a server
 * action is a public endpoint, so a crafted cursor or filter is refused here first and by the API's
 * own cursor validation second (T-08.3-23) — a 401/403 refusal the bootstrap knows becomes a
 * navigation OUTSIDE the try/catch (Next 16: `redirect()` throws), and any other refusal is a code
 * the client maps to catalog copy.
 *
 * Both return FINISHED row views (the meta, the pills, the accessible names), so the client list
 * formats nothing and the first page and every next page share one formatter.
 *
 * The cursor is OPAQUE: forwarded exactly as the previous page returned it (the API refuses a
 * tampered one). Logs carry `{ status, code }` only — a course title is tenant content (T-08.3-24).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type CoursesPageResult =
  | { ok: true; items: CourseRowView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

async function readPage(filter: CourseFilter, cursor?: string): Promise<CoursesPageResult> {
  const query = courseListQuerySchema.safeParse(
    cursor === undefined ? { filter } : { filter, cursor },
  );
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CoursesPageResult = { ok: false, code: 'generic' };
  try {
    const [page, t] = await Promise.all([
      getCourses({
        filter: query.data.filter,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
      getTranslations(),
    ]);
    result = {
      ok: true,
      items: page.items.map((row) => courseRowView(row, t)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) {
      console.error('courses.page_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/** One more page of the list, APPENDED by the client (never replaces, P09). */
export async function loadMoreCoursesAction(
  filter: CourseFilter,
  cursor: string,
): Promise<CoursesPageResult> {
  return readPage(filter, cursor);
}

/** Page 1 again: what `PullToRefresh` and the first-load retry call. */
export async function refreshCoursesAction(filter: CourseFilter): Promise<CoursesPageResult> {
  return readPage(filter);
}
