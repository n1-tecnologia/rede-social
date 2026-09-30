import {
  NOTIF_PAGE_SIZE,
  type NotificationPage,
  type NotificationSection,
  notificationPageSchema,
} from '@rede-social/module-notifications/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE notifications fetch implementation (the `lib/events.ts` rule). The `/notificacoes` RSC page
 * and its load-more and refresh actions all read THIS, so the page and its pagination can never
 * disagree about the page size, the section or the tenant the request is scoped to.
 *
 * The browser never talks to Supabase for notification data: every read goes through `apiFetch` to
 * the Hono API, which re-verifies the token and re-reads the membership row on every request.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

/** The query the page and its actions send; `cursor` is OPAQUE and forwarded verbatim. */
export type NotificationQueryInput = {
  section: NotificationSection;
  cursor?: string;
  limit?: number;
};

/**
 * `GET /v1/notifications` (NOTIF-02). `section` is always sent explicitly (the API's closed enum);
 * `limit` defaults to `NOTIF_PAGE_SIZE` and the API clamps it anyway.
 */
export async function getNotifications(query: NotificationQueryInput): Promise<NotificationPage> {
  const search = new URLSearchParams();
  search.set('section', query.section);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? NOTIF_PAGE_SIZE));

  const res = await apiFetch(`/v1/notifications?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return notificationPageSchema.parse(await res.json());
}

/**
 * One page of one section, or `null` when the API could not answer — the list then renders its own
 * error state. A refusal `bootstrapRedirectPath` knows (401, blocked, suspended, host mismatch, no
 * membership) becomes a navigation, performed OUTSIDE the try/catch: `redirect()` throws in Next 16
 * and a catch would swallow it.
 */
export async function loadNotifications(
  query: NotificationQueryInput,
): Promise<NotificationPage | null> {
  let path: string | null = null;
  let page: NotificationPage | null = null;
  try {
    page = await getNotifications(query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    // Shape only: a fact is member-facing content and never reaches a log line.
    if (!path) {
      console.error('notifications.list_failed', { section: query.section, error: String(error) });
    }
  }

  if (path) redirect(path);
  return page;
}

/**
 * The three marks (D-230), each forwarded ONCE to the API by the BFF route handlers under
 * `app/api/notifications/…`. They throw `ApiClientError` on a non-2xx so the handler answers the
 * API's own status. Nothing here is a GET: a mark is a side effect, and a prefetch must never make it.
 */
async function post(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'POST' });
  if (!res.ok) throw await apiError(res);
}

/** `POST /v1/notifications/seen`: zeroes the bell, touches no tint. */
export function markNotificationsSeen(): Promise<void> {
  return post('/v1/notifications/seen');
}

/** `POST /v1/notifications/{id}/read`: one row read (and seen). A bare 404 for any foreign id. */
export function markNotificationRead(notificationId: string): Promise<void> {
  return post(`/v1/notifications/${encodeURIComponent(notificationId)}/read`);
}

/** `POST /v1/notifications/read-all`: every unread row of the caller read. */
export function markAllNotificationsRead(): Promise<void> {
  return post('/v1/notifications/read-all');
}
