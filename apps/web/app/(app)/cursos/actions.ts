'use server';

import {
  type CourseFilter,
  courseListQuerySchema,
  type LiveFilter,
  liveListQuerySchema,
  type TrackFilter,
  trackListQuerySchema,
} from '@rede-social/module-courses/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { getCourses, getLives, getTracks } from '@/lib/courses';
import { type CourseRowView, courseRowView, liveRowView, trackRowView } from '@/lib/courses-view';

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

/* ── 08.3-10: the Trilhas tab's paging and refresh (COURSE-10), the same conventions ─────────── */

async function readTracksPage(filter: TrackFilter, cursor?: string): Promise<CoursesPageResult> {
  const query = trackListQuerySchema.safeParse(
    cursor === undefined ? { filter } : { filter, cursor },
  );
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CoursesPageResult = { ok: false, code: 'generic' };
  try {
    const [page, t] = await Promise.all([
      getTracks({
        filter: query.data.filter,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
      getTranslations(),
    ]);
    result = {
      ok: true,
      items: page.items.map((row) => trackRowView(row, t)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) {
      console.error('courses.tracks_page_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/** One more page of the Trilhas list, APPENDED by the client. */
export async function loadMoreTracksAction(
  filter: TrackFilter,
  cursor: string,
): Promise<CoursesPageResult> {
  return readTracksPage(filter, cursor);
}

/** Page 1 of the Trilhas list again: what `PullToRefresh` and the first-load retry call. */
export async function refreshTracksAction(filter: TrackFilter): Promise<CoursesPageResult> {
  return readTracksPage(filter);
}

/* ── 08.3-11: the Lives tab's paging and refresh (COURSE-11), the same conventions ──────────── */

/**
 * The live rows need the TENANT's timezone for their date line (UI-D-392, UI-D-407: formatted on the
 * server, never with the device's zone) — read from the cached bootstrap beside the page.
 */
async function readLivesPage(filter: LiveFilter, cursor?: string): Promise<CoursesPageResult> {
  const query = liveListQuerySchema.safeParse(
    cursor === undefined ? { filter } : { filter, cursor },
  );
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CoursesPageResult = { ok: false, code: 'generic' };
  try {
    const [page, t, bootstrap] = await Promise.all([
      getLives({
        filter: query.data.filter,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
      getTranslations(),
      requireBootstrap(),
    ]);
    const timezone = bootstrap.tenant.timezone;
    result = {
      ok: true,
      items: page.items.map((row) => liveRowView(row, { timezone }, t)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) {
      console.error('courses.lives_page_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/** One more page of the Lives list, APPENDED by the client. */
export async function loadMoreLivesAction(
  filter: LiveFilter,
  cursor: string,
): Promise<CoursesPageResult> {
  return readLivesPage(filter, cursor);
}

/** Page 1 of the Lives list again: what `PullToRefresh` and the first-load retry call. */
export async function refreshLivesAction(filter: LiveFilter): Promise<CoursesPageResult> {
  return readLivesPage(filter);
}
