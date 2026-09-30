import { markNotificationRead } from '@/lib/notifications';
import { empty, gatedMark, NOTIFICATION_ID_RE, sameOrigin } from '@/lib/notifications-bff';

/**
 * `POST /api/notifications/{id}/read` (D-230, D-232, UI-D-252) — the tap's mark. The row's anchor
 * fires it with `fetch(…, { method: 'POST', keepalive: true })` WITHOUT awaiting it and navigates, so
 * the request outlives the page that sent it; a server action could not promise that.
 *
 * The path id is uuid-checked here (400) after the sameOrigin gate and before any request is built;
 * the remaining gates live in `gatedMark` (`lib/notifications-bff.ts`). A foreign or unknown id comes
 * back from the API as its one bare 404 (D-23), answered verbatim.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return empty(403);
  const { notificationId } = await params;
  if (!NOTIFICATION_ID_RE.test(notificationId)) return empty(400);
  return gatedMark(request, 'notifications.read_failed', () =>
    markNotificationRead(notificationId.toLowerCase()),
  );
}
