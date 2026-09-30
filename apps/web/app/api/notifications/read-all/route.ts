import { markAllNotificationsRead } from '@/lib/notifications';
import { gatedMark } from '@/lib/notifications-bff';

/**
 * `POST /api/notifications/read-all` (D-230, UI-D-252) — "Marcar todas como lidas". The surface clears
 * every tint optimistically and restores them (with the error toast) when this answers non-2xx.
 *
 * The gates live in `gatedMark` (`lib/notifications-bff.ts`): sameOrigin (403), no body (413), a
 * verified session (401), then ONE forward answering the API's status.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return gatedMark(request, 'notifications.read_all_failed', markAllNotificationsRead);
}
