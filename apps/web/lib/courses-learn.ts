import {
  COURSE_PAGE_SIZE,
  type LearnCataloguePage,
  learnCataloguePageSchema,
} from '@rede-social/module-courses/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED } from '@/lib/courses';

/**
 * The member side's courses fetchers (08.5-06, D-419, D-420, COURSE-17): the `/v1/courses/learn/*`
 * reads every role of a tenant with `courses` on may call. `lib/courses.ts` stays the manager's
 * (planning decision 2), so a member surface never imports an admin fetcher by accident.
 *
 * Each read answers a result union and NEVER throws: `ok` with the parsed page (the contract's
 * strict schema, so a drifted API shape fails here, not in a component), `disabled` when the module
 * was switched off between the bootstrap and the read (`404 MODULE_DISABLED` → the kernel
 * not-found), `redirect` for a refusal the bootstrap knows (401, blocked, suspended…; the CALLER
 * navigates, because `redirect()` throws), and `error` for anything else (the first-load error card
 * with its retry).
 *
 * **The web never sorts** (P09): pages render in the API's order. **The cursor is opaque**:
 * forwarded exactly as the previous page returned it. Logs carry `{ status, code }` only — a course
 * title is tenant content.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function readError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    if (typeof body?.error?.code === 'string') code = body.error.code;
  } catch {
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code);
}

export type LearnReadResult<T> =
  | { status: 'ok'; page: T }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/** The shared mapping of one learn read's answer; `op` names the log line, never a title. */
async function learnRead<T>(
  path: string,
  parse: (body: unknown) => T,
  op: string,
): Promise<LearnReadResult<T>> {
  try {
    const res = await apiFetch(path);
    if (res.ok) return { status: 'ok', page: parse(await res.json()) };
    const error = await readError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    console.error(op, { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error(op, { error: String(error) });
    return { status: 'error' };
  }
}

export interface LearnCatalogueInput {
  /** A category id the caller already whitelisted; omitted for "Todas". */
  categoryId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * `GET /v1/courses/learn/courses?categoryId=&cursor=&limit=` (08.5-04, COURSE-17): the member
 * catalogue — published courses newest first, locked and open in one list, the caller's own
 * `completedCount`, and the category chips (only categories holding a published course, whatever
 * the filter).
 */
export async function getLearnCatalogue(
  input: LearnCatalogueInput = {},
): Promise<LearnReadResult<LearnCataloguePage>> {
  const search = new URLSearchParams();
  if (input.categoryId) search.set('categoryId', input.categoryId);
  if (input.cursor) search.set('cursor', input.cursor);
  search.set('limit', String(input.limit ?? COURSE_PAGE_SIZE));
  return learnRead(
    `/v1/courses/learn/courses?${search.toString()}`,
    (body) => learnCataloguePageSchema.parse(body),
    'courses.learn_catalogue_failed',
  );
}
