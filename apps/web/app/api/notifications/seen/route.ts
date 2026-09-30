import { markNotificationsSeen } from '@/lib/notifications';
import { gatedMark } from '@/lib/notifications-bff';

/**
 * `POST /api/notifications/seen` (D-230, UI-D-252) — the list's "the member looked" mark: posted ONCE
 * by `NotificationsSurface` after mount while the document is visible, never by the page's server
 * render (prefetch-safe, the 06-06 rule). It zeroes the bell and touches no tint.
 *
 * The gates live in `gatedMark` (`lib/notifications-bff.ts`): sameOrigin (403), no body (413), a
 * verified session (401), then ONE forward answering the API's status.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return gatedMark(request, 'notifications.seen_failed', markNotificationsSeen);
}
