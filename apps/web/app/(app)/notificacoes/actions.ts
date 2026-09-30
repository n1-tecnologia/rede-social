'use server';

import {
  NOTIF_SECTIONS,
  type NotificationSection,
  notificationQuerySchema,
} from '@rede-social/module-notifications/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { getNotifications } from '@/lib/notifications';
import {
  type NotificationRowView,
  type NotificationTranslator,
  notificationRowView,
} from '@/lib/notifications-view';
import { notificationRenderers } from '@/lib/registry';

/**
 * The `/notificacoes` list's two actions (NOTIF-02), in the `eventos/actions.ts` conventions: the
 * SAME Zod the API validates with runs BEFORE the request (a server action is a public endpoint), a
 * 401/403 becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()` throws), and a refusal is
 * answered with a catalog KEY rather than pt-BR copy.
 *
 * Both return FINISHED row views: every sentence and relative time is built here, on the server,
 * from ONE `Date.now()` per action, so the client list never reads a clock or a catalog in render.
 *
 * The section is threaded through (05.1 Pitfall 9): a load-more of Anteriores pages the read keyset
 * and never swaps Novas in, and the refresh answers BOTH sections labelled, so a pull cannot either.
 * Seen and read are NOT here: they are BFF route handlers (07-01 planning decision 10).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type NotificationsPageResult =
  | { ok: true; items: NotificationRowView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

export type NotificationsRefreshResult =
  | {
      ok: true;
      unread: { items: NotificationRowView[]; nextCursor: string | null };
      /** Page 1 of Anteriores, read only once Novas has no next page; `null` otherwise. */
      read: { items: NotificationRowView[]; nextCursor: string | null } | null;
    }
  | { ok: false; code: 'generic' };

/** Only the two closed values; anything else is refused before a request is built. */
const isSection = (value: unknown): value is NotificationSection =>
  typeof value === 'string' && (NOTIF_SECTIONS as readonly string[]).includes(value);

type Loaded = Awaited<ReturnType<typeof getNotifications>>;

/** One section's page, or `null` on a failure a navigation does not answer. */
async function fetchSection(
  section: NotificationSection,
  cursor?: string,
): Promise<{ page: Loaded | null; refusal: string | null }> {
  const query = notificationQuerySchema.safeParse({ section, cursor });
  if (!query.success) return { page: null, refusal: null };
  try {
    const page = await getNotifications({
      section: query.data.section,
      cursor: query.data.cursor,
      limit: query.data.limit,
    });
    return { page, refusal: null };
  } catch (error) {
    const refusal = error instanceof ApiClientError ? bootstrapRedirectPath(error) : null;
    // Shape only: a fact is member-facing content and never reaches a log line.
    if (!refusal) console.error('notifications.page_failed', { section, error: String(error) });
    return { page: null, refusal };
  }
}

/**
 * 07-05: the event and reminder rows format in the tenant's timezone, read from the bootstrap (the
 * `eventos/actions.ts` precedent). A refused bootstrap redirects like a refused section read; any
 * other failure is the generic error, never a thrown action.
 */
async function tenantTimeZone(): Promise<{ timeZone: string | null; refusal: string | null }> {
  try {
    return { timeZone: (await getBootstrap()).tenant.timezone, refusal: null };
  } catch (error) {
    const refusal = error instanceof ApiClientError ? bootstrapRedirectPath(error) : null;
    if (!refusal) console.error('notifications.bootstrap_failed', { error: String(error) });
    return { timeZone: null, refusal };
  }
}

async function toViews(
  items: Loaded['items'],
  nowMs: number,
  timeZone: string,
): Promise<NotificationRowView[]> {
  const t = (await getTranslations('notifications')) as unknown as NotificationTranslator;
  return items.map((row) =>
    notificationRowView(row, { t, nowMs, timeZone, renderers: notificationRenderers }),
  );
}

/**
 * One more page of the given section. `cursor` null asks for page 1 (how the list starts Anteriores
 * once Novas is exhausted); otherwise it is OPAQUE and forwarded untouched.
 */
export async function loadMoreNotificationsAction(
  section: NotificationSection,
  cursor: string | null,
): Promise<NotificationsPageResult> {
  if (!isSection(section)) return { ok: false, code: 'generic' };
  if (cursor !== null && typeof cursor !== 'string') return { ok: false, code: 'generic' };

  const { page, refusal } = await fetchSection(section, cursor ?? undefined);
  if (refusal) redirect(refusal);
  if (!page) return { ok: false, code: 'generic' };
  const zone = await tenantTimeZone();
  if (zone.refusal) redirect(zone.refusal);
  if (!zone.timeZone) return { ok: false, code: 'generic' };

  // ONE clock read per action.
  const nowMs = Date.now();
  return {
    ok: true,
    items: await toViews(page.items, nowMs, zone.timeZone),
    nextCursor: page.nextCursor,
  };
}

/** Page 1 of Novas again, plus page 1 of Anteriores when Novas has no next page — what a pull calls. */
export async function refreshNotificationsAction(): Promise<NotificationsRefreshResult> {
  const unread = await fetchSection('unread');
  if (unread.refusal) redirect(unread.refusal);
  if (!unread.page) return { ok: false, code: 'generic' };

  let readPage: Loaded | null = null;
  if (unread.page.nextCursor === null) {
    const read = await fetchSection('read');
    if (read.refusal) redirect(read.refusal);
    if (!read.page) return { ok: false, code: 'generic' };
    readPage = read.page;
  }
  const zone = await tenantTimeZone();
  if (zone.refusal) redirect(zone.refusal);
  if (!zone.timeZone) return { ok: false, code: 'generic' };
  const { timeZone } = zone;

  const nowMs = Date.now();
  return {
    ok: true,
    unread: {
      items: await toViews(unread.page.items, nowMs, timeZone),
      nextCursor: unread.page.nextCursor,
    },
    read: readPage
      ? { items: await toViews(readPage.items, nowMs, timeZone), nextCursor: readPage.nextCursor }
      : null,
  };
}
