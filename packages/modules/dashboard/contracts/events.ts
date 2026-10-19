import { z } from 'zod';
import { bandCountsSchema } from './members';
import { preparingSchema, snapshotMetaSchema } from './shared';

/**
 * The owner's "Eventos" contract (08.7-08, D-455, D-460, D-461, UI-D-489 c, INSIGHT-11): the
 * tenant's active events, built once a day by `app.dashboard_area_events`. The area exists only
 * while the `events` module is on (the route answers 404 `MODULE_DISABLED` otherwise, D-460).
 *
 * - **Upcoming.** Active, non-deleted events starting at or after the snapshot's `untilAt` (local
 *   midnight after D), soonest first (`startsAt asc, id asc`), at most
 *   `OWNER_UPCOMING_EVENTS_LIMIT`. `confirmed` is the RSVPs "vou" (`going` or `checked_in`) at build
 *   time, every attendee row counted, which is the same count the capacity guard and the attendee
 *   list use (D-219).
 * - **Past.** Events starting in Window30 (local days D-29..D), most recent first (`startsAt desc,
 *   id desc`), with `confirmed`, `checkIns` (`checked_in`) and `walkIns` (`walk_in`). A walk-in is a
 *   presence, never a confirmed RSVP (EP-33). Durations are whole minutes,
 *   `round((ends_at - starts_at) / 60 s)` (EP-36).
 * - **Totals.** `attendanceTotals` of Window30 and Prev30 (D-59..D-30): confirmed, presences
 *   (`checked_in` + `walk_in`) and walk-ins. Visão geral reads these, so its card and Eventos never
 *   disagree (planning decision 3).
 * - **Who comes.** `attendanceByBand`: the window's presences by active role members, each under
 *   the member's band on the local day BEFORE the event (UI-D-489 c), not today's. Exact counts, not
 *   floored: the admin lists the attendees on `/eventos/[eventId]/participantes` (planning
 *   decision 2).
 * - **Not measured (D-455).** No ticket price, no event revenue and no waiting list is recorded:
 *   `ticketCents`, `revenue` and `waitlist` are `{ measured: false, reason }`, never a number.
 * - **Ids and numbers only in the stored payload (PR-1).** Titles and covers are joined live by
 *   the service; an event deleted or cancelled since the build is dropped from the answer.
 *
 * Every object is `.strict()`, so a key nobody declared (an `example`, a title in the payload)
 * fails the parse instead of travelling.
 */

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();

/** An event's format, as `events_format_chk` allows it. */
export const EVENT_FORMATS = ['in_person', 'online'] as const;
export const eventFormatSchema = z.enum(EVENT_FORMATS);
export type EventFormatId = z.infer<typeof eventFormatSchema>;

/** Próximos eventos lists at most this many events, soonest first (EP-32). */
export const OWNER_UPCOMING_EVENTS_LIMIT = 6;

/** `events_capacity_chk`: a limit of at least one seat; null is "no limit" (EP-34). */
const capacitySchema = z.number().int().positive().nullable();

const eventPayloadBase = {
  id: z.uuid(),
  startsAt: instant,
  endsAt: instant,
  format: eventFormatSchema,
  capacity: capacitySchema,
  /** RSVPs "vou" (`going` + `checked_in`), every attendee row; a walk-in never counts here. */
  confirmed: count,
  durationMinutes: count,
};

export const upcomingEventPayloadSchema = z.object(eventPayloadBase).strict();
export type UpcomingEventPayload = z.infer<typeof upcomingEventPayloadSchema>;

export const pastEventPayloadSchema = z
  .object({ ...eventPayloadBase, checkIns: count, walkIns: count })
  .strict();
export type PastEventPayload = z.infer<typeof pastEventPayloadSchema>;

/** One window's attendance: confirmed RSVPs, presences (`checked_in` + `walk_in`) and walk-ins. */
const attendanceWindowSchema = z
  .object({ confirmed: count, present: count, walkIns: count })
  .strict();

export const attendanceTotalsSchema = z
  .object({ current: attendanceWindowSchema, previous: attendanceWindowSchema })
  .strict();
export type AttendanceTotals = z.infer<typeof attendanceTotalsSchema>;

/** `payload.events` as the builder stores it (v5). */
export const eventsPayloadSchema = z
  .object({
    upcoming: z.array(upcomingEventPayloadSchema).max(OWNER_UPCOMING_EVENTS_LIMIT),
    past: z.array(pastEventPayloadSchema),
    attendanceTotals: attendanceTotalsSchema,
    attendanceByBand: bandCountsSchema,
  })
  .strict();
export type EventsPayload = z.infer<typeof eventsPayloadSchema>;

// ── the area answer (`GET /v1/dashboard/owner/events`) ─────────────────────────────────────────

const notMeasuredAs = <R extends string>(reason: R) =>
  z.object({ measured: z.literal(false), reason: z.literal(reason) }).strict();

/** What every event of the answer adds: its live title and cover, and the unmeasured ticket. */
const eventAnswerLive = {
  title: z.string(),
  coverAssetId: z.uuid().nullable(),
  ticketCents: notMeasuredAs('needs_event_tickets'),
  revenue: notMeasuredAs('needs_event_tickets'),
};

export const ownerUpcomingEventSchema = upcomingEventPayloadSchema.extend(eventAnswerLive).strict();
export type OwnerUpcomingEventAnswer = z.infer<typeof ownerUpcomingEventSchema>;

export const ownerPastEventSchema = pastEventPayloadSchema.extend(eventAnswerLive).strict();
export type OwnerPastEventAnswer = z.infer<typeof ownerPastEventSchema>;

export const ownerEventsReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    upcoming: z.array(ownerUpcomingEventSchema).max(OWNER_UPCOMING_EVENTS_LIMIT),
    past: z.array(ownerPastEventSchema),
    attendanceTotals: attendanceTotalsSchema,
    attendanceByBand: bandCountsSchema,
    waitlist: notMeasuredAs('needs_waitlist'),
  })
  .strict();
export type OwnerEventsReady = z.infer<typeof ownerEventsReadySchema>;

export const ownerEventsAnswerSchema = z.discriminatedUnion('state', [
  ownerEventsReadySchema,
  preparingSchema,
]);
export type OwnerEventsAnswer = z.infer<typeof ownerEventsAnswerSchema>;
