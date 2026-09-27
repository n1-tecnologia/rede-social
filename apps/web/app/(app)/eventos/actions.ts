'use server';

import { EVENT_PERIODS, type EventPeriod, eventQuerySchema } from '@tria/module-events/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { getEvents } from '@/lib/events';
import { type EventPosterView, eventPosterView } from '@/lib/events-view';

/**
 * The `/eventos` list's two actions (EVENT-02), in the `comunidades/actions.ts` conventions: the SAME
 * Zod the API validates with runs BEFORE the request (a server action is a public endpoint), a
 * 401/403 becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()` throws), and a refusal is
 * answered with a catalog KEY rather than pt-BR copy.
 *
 * Both return FINISHED poster views: every string is formatted here, on the server, in the tenant's
 * timezone from ONE `Date.now()` per action, so the client list never formats an instant and never
 * reads the clock in render (UI-D-203).
 *
 * The period is threaded through both actions (05.1 Pitfall 9): a pull or a scroll on Passados pages
 * the past keyset and never swaps the upcoming list in.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type EventsPageResult =
  | { ok: true; items: EventPosterView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/** Only the two closed values; anything else is refused before a request is built. */
const isPeriod = (value: unknown): value is EventPeriod =>
  typeof value === 'string' && (EVENT_PERIODS as readonly string[]).includes(value);

async function eventsPage(period: EventPeriod, cursor?: string): Promise<EventsPageResult> {
  const query = eventQuerySchema.safeParse({ period, cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let loaded: Awaited<ReturnType<typeof getEvents>> | null = null;
  let tz = '';
  try {
    const [bootstrap, page] = await Promise.all([
      getBootstrap(),
      getEvents({ period: query.data.period, cursor: query.data.cursor, limit: query.data.limit }),
    ]);
    tz = bootstrap.tenant.timezone;
    loaded = page;
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('events.page_failed', { period, error: String(error) });
  }

  if (refusal) redirect(refusal);
  if (!loaded) return { ok: false, code: 'generic' };

  const t = await getTranslations('events');
  // ONE clock read per action: every relative label on the page comes from the same instant.
  const nowMs = Date.now();
  return {
    ok: true,
    items: loaded.items.map((event) => eventPosterView(event, { tz, nowMs, t })),
    nextCursor: loaded.nextCursor,
  };
}

/** One more page of the given period. The cursor is OPAQUE and forwarded untouched. */
export async function loadMoreEventsAction(
  period: EventPeriod,
  cursor: string,
): Promise<EventsPageResult> {
  if (!isPeriod(period)) return { ok: false, code: 'generic' };
  return eventsPage(period, cursor);
}

/** Page 1 of the given period again — what `PullToRefresh` calls. */
export async function refreshEventsAction(period: EventPeriod): Promise<EventsPageResult> {
  if (!isPeriod(period)) return { ok: false, code: 'generic' };
  return eventsPage(period);
}
