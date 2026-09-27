'use server';

import {
  EVENT_PERIODS,
  type EventPeriod,
  eventQuerySchema,
  type RsvpAnswer,
  rsvpSchema,
} from '@tria/module-events/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { getEvents, putRsvp } from '@/lib/events';
import { type EventPosterView, eventPosterView } from '@/lib/events-view';

/**
 * The `/eventos` list's two actions (EVENT-02) and the detail's RSVP action (EVENT-03, below), in the `comunidades/actions.ts` conventions: the SAME
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

/* ── EVENT-03: the member's answer (06-03) ─────────────────────────────────────────────────────── */

/**
 * What an RSVP write can answer. Every refusal is a catalog-mapped CODE, never pt-BR copy: the three
 * the database decides (D-204, via the guard trigger and the API's `details.event`) and `failed` for
 * everything else, a bare 404 included (the event vanished or was never the caller's, D-23).
 */
export type RsvpActionResult =
  | { ok: true; status: RsvpAnswer }
  | { ok: false; error: 'rsvp_closed' | 'cancelled' | 'attendance_locked' | 'failed' };

const RSVP_REFUSALS = new Set(['rsvp_closed', 'cancelled', 'attendance_locked']);

/**
 * `PUT /v1/events/{id}/rsvp` for the detail page's `SegmentedControl` (D-205, UI-D-206), in the
 * `comunidades/actions.ts` conventions:
 *
 *  1. **The SAME Zod the API validates with runs first** (`rsvpSchema`): a server action is a public
 *     endpoint, so a crafted answer (`checked_in`, say) is refused before any request is built. The
 *     member lane could not write it anyway (the self-only RLS policies, T-06-11).
 *  2. **The clock is never consulted here.** Whether the answer is still allowed is the database's
 *     call for every writer (the guard trigger, D-204); a late tap comes back as `rsvp_closed`.
 *  3. **`redirect()` sits OUTSIDE the try/catch** (Next 16: it throws), for the bootstrap refusals.
 *
 * On success the list is revalidated so a poster's count line is fresh on the way back; the island
 * refreshes the detail itself.
 */
export async function rsvpEventAction(
  eventId: string,
  answer: RsvpAnswer,
): Promise<RsvpActionResult> {
  const body = rsvpSchema.safeParse({ answer });
  if (!body.success || typeof eventId !== 'string' || eventId.length === 0) {
    return { ok: false, error: 'failed' };
  }

  let refusal: string | null = null;
  let result: RsvpActionResult = { ok: false, error: 'failed' };
  try {
    const written = await putRsvp(eventId, body.data.answer);
    result = { ok: true, status: body.data.answer };
    // The API answers the stored status; a going/not_going write can only store the answer sent.
    if (written.status !== body.data.answer) result = { ok: false, error: 'failed' };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      const code = (error.details as { event?: unknown } | undefined)?.event;
      if (!refusal && typeof code === 'string' && RSVP_REFUSALS.has(code)) {
        result = { ok: false, error: code as 'rsvp_closed' | 'cancelled' | 'attendance_locked' };
      }
    }
    // Shape only: never the event's title (member-facing content).
    if (!refusal && !result.ok && result.error === 'failed') {
      console.error('events.rsvp_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  if (result.ok) revalidatePath('/eventos');
  return result;
}
