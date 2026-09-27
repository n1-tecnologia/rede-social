import { z } from 'zod';

/**
 * The module's published contract surface (`@tria/module-events/contracts`). Both the API and the
 * web app import from here: the same Zod schema validates the query in Hono, the body in the route
 * and the page payload in `apps/web/lib/events.ts`, so there is exactly one definition of what an
 * event is (MOD-01).
 *
 * Two facts a reader must not "fix":
 *
 * 1. **Times cross the wire IN as wall-clock pairs and OUT as UTC instants.** The admin types
 *    `{ date: '2026-10-12', time: '19:00' }` in the TENANT's timezone, whatever the device's zone is,
 *    and the service converts it inside the insert statement (`… at time zone t.timezone`). The read
 *    side answers ISO instants, and the web formats them with `Intl` pinned to
 *    `bootstrap.tenant.timezone`. No JavaScript `Date` arithmetic ever touches a wall clock.
 * 2. **Neither the meeting URL nor the check-in code is a key of `eventSummarySchema`** (D-207,
 *    D-208, D-217). Both live in the admin-only `event_secrets` table, and a member payload has no
 *    field to carry them in. The input schema accepts the URL because the admin writes it; nothing a
 *    member reads can echo it back.
 */

/** Ten 4/5 posters is already several screens on a phone (the communities 10/25 split). */
export const EVENT_PAGE_SIZE = 10;
export const EVENT_MAX_PAGE_SIZE = 25;

/** The longest cursor this endpoint will look at (the `COMMUNITY_MAX_CURSOR_LENGTH` rule). */
export const EVENT_MAX_CURSOR_LENGTH = 512;

/**
 * Field caps, measured in UTF-16 code units at both ends (the `COMMUNITY_MAX_NAME` rule): the
 * browser `maxLength`, the counter and the `.max()` below all count the same unit.
 */
export const EVENT_MAX_TITLE = 120;
export const EVENT_MAX_DESCRIPTION = 4000;
export const EVENT_MAX_VENUE = 120;
export const EVENT_MAX_ADDRESS = 300;
export const EVENT_MAX_URL = 2048;

/** D-213: the end the form prefills when the admin picks a start. Editable; the API never invents it. */
export const EVENT_DEFAULT_DURATION_MINUTES = 120;

/** D-209: the check-in window opens this long before `starts_at` and closes at `ends_at`. */
export const EVENT_CHECKIN_OPENS_BEFORE_MINUTES = 60;

/**
 * D-208 / D-217: the venue code. 31 symbols with no 0/O/1/I/L, so a code read aloud or written on a
 * board is never ambiguous; 31^4 = 923,521 codes. Mirrored by `event_secrets_code_chk`.
 */
export const EVENT_CHECKIN_CODE_LENGTH = 4;
export const EVENT_CHECKIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Mirrored by `events_format_chk`. */
export const EVENT_FORMATS = ['in_person', 'online'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

/** Mirrored by `events_status_chk`. There is no delete (D-214): cancel is a status, reversible. */
export const EVENT_STATUSES = ['active', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * D-216: the attendance row's status vocabulary, mirrored by `event_attendances_status_chk`. One
 * column, never boolean pairs: `going` and `not_going` are RSVP answers, `checked_in` is a `going`
 * that checked in (its `respondedAt` is kept), and `walk_in` is a check-in with no prior `going`.
 */
export const ATTENDANCE_STATUSES = ['going', 'not_going', 'checked_in', 'walk_in'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** D-205: the two answers a member may give (`Vou` / `Não vou`). A recorded `Não vou` is a value. */
export const RSVP_ANSWERS = ['going', 'not_going'] as const;
export type RsvpAnswer = (typeof RSVP_ANSWERS)[number];

/**
 * D-200: the two list chips. `upcoming` is `ends_at > now()` (an event in progress stays here until
 * it ends) and `past` is `ends_at <= now()`. Each is its own keyset: a cursor never spans two.
 */
export const EVENT_PERIODS = ['upcoming', 'past'] as const;
export type EventPeriod = (typeof EVENT_PERIODS)[number];

/**
 * The closed refusal vocabulary, carried as `details.event`. It is declared in full now, although
 * this plan raises only the create-path codes, so the web's switch is exhaustive from day one (the
 * `COMMUNITY_ISSUES` `archived` precedent). Input problems are `400 VALIDATION_FAILED`, state and
 * time refusals are `409 CONFLICT`. A miss is never in here: it is a bare 404 with no `details`,
 * because a per-cause code over an enumerable uuid space is an existence oracle (D-23).
 */
export const EVENT_ISSUES = [
  'name_required',
  'end_before_start',
  'location_required',
  'url_required',
  'url_invalid',
  'cover_invalid',
  'rsvp_closed',
  'cancelled',
  'attendance_locked',
  'checkin_not_open',
  'checkin_closed',
  'wrong_code',
  'too_many_attempts',
  'reactivate_started',
  'event_ended',
] as const;
export type EventIssue = (typeof EVENT_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.event`. */
export const EVENT_ISSUE_SET: ReadonlySet<string> = new Set(EVENT_ISSUES);

/** The permission STRINGS, exported so the manifest and the web tier never retype them. */
export const EVENT_PERMISSIONS = {
  manage: 'events.event.manage',
  attendanceRead: 'events.attendance.read',
  respond: 'events.attendance.respond',
} as const;

/** `true` when `date` is a real calendar day (no 2026-02-30) and `time` a real clock time. */
function isRealWallClock(date: string, time: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  if (hh === undefined || mm === undefined || hh > 23 || mm > 59) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * One wall-clock instant as the admin typed it, in the tenant's timezone. Validated as a REAL day
 * and time here, so a `2026-02-30` never reaches the `::timestamp` cast (which would be a 500).
 * The UTC calendar is only a validity probe for the date string: no instant is computed in JS.
 */
export const wallClockSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .strict()
  .refine((value) => isRealWallClock(value.date, value.time), { error: 'invalid_wall_clock' });
export type WallClock = z.infer<typeof wallClockSchema>;

/** `'2026-10-12T19:00'`: fixed-width, so a string comparison IS a chronological one (same zone). */
const wallClockKey = (value: WallClock) => `${value.date}T${value.time}`;

/** A present, non-blank string after trimming. */
const filled = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * `POST /v1/events` now, and the edit `PUT` in 06-04: ONE schema for both, `.strict()`, so an
 * unknown key (a forged `tenantId`, a `checkinCode`) fails loudly.
 *
 * The refinement carries MACHINE codes as issue messages (there is nowhere else on a Zod issue to
 * put one) and the route's `defaultHook` lifts the first into `details.event`:
 *  - `name_required`: an empty title;
 *  - `end_before_start`: the end does not sort strictly after the start (D-213);
 *  - `location_required`: an in-person event without a non-blank venue AND address, or carrying a
 *    meeting URL;
 *  - `url_required`: an online event without a URL, or carrying a venue or an address;
 *  - `url_invalid`: a URL that is not `https:` (D-217), or longer than `EVENT_MAX_URL`.
 * Refusing the inactive side's fields is what keeps the D-213 XOR honest: only the visible side of
 * the form is ever stored.
 */
export const eventInputSchema = z
  .object({
    title: z.string().trim().max(EVENT_MAX_TITLE).default(''),
    description: z.string().trim().max(EVENT_MAX_DESCRIPTION).default(''),
    coverAssetId: z.uuid().nullable().optional(),
    format: z.enum(EVENT_FORMATS),
    venueName: z.string().trim().max(EVENT_MAX_VENUE).nullable().optional(),
    address: z.string().trim().max(EVENT_MAX_ADDRESS).nullable().optional(),
    meetingUrl: z
      .url({ protocol: /^https$/, error: 'url_invalid' })
      .max(EVENT_MAX_URL, { error: 'url_invalid' })
      .nullable()
      .optional(),
    start: wallClockSchema,
    end: wallClockSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.title.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'name_required' });
    }
    // Only two REAL wall clocks are compared: an impossible one already raised its own (generic)
    // issue, and an `end_before_start` beside it would hide it behind a machine code.
    const comparable =
      isRealWallClock(value.start.date, value.start.time) &&
      isRealWallClock(value.end.date, value.end.time);
    if (comparable && wallClockKey(value.end) <= wallClockKey(value.start)) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'end_before_start' });
    }
    if (value.format === 'in_person') {
      if (!filled(value.venueName) || !filled(value.address) || filled(value.meetingUrl)) {
        ctx.addIssue({ code: 'custom', path: ['venueName'], message: 'location_required' });
      }
    } else if (!filled(value.meetingUrl) || filled(value.venueName) || filled(value.address)) {
      ctx.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'url_required' });
    }
  });
export type EventInput = z.infer<typeof eventInputSchema>;

/**
 * `GET /v1/events?period=&cursor=&limit=`. `.strict()`: an unknown query key fails loudly.
 *
 * **`period` is a closed enum that does NOT clamp**, and `limit` clamps (the communities
 * `status`/`limit` split). The web translates its own pt-BR `?periodo=passados` and sends `past`
 * only for that exact value, so a bad `period` can only come from a crafted call and an explicit 400
 * is the honest answer: `PAST` and `soon` are 400, never a widened read. `limit` is reachable from a
 * shared link, so it degrades instead (`.catch`, then a clamp to `1..EVENT_MAX_PAGE_SIZE`).
 */
export const eventQuerySchema = z
  .object({
    period: z.enum(EVENT_PERIODS).default('upcoming'),
    cursor: z.string().max(EVENT_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .catch(EVENT_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), EVENT_MAX_PAGE_SIZE))
      .default(EVENT_PAGE_SIZE),
  })
  .strict();
export type EventQuery = z.infer<typeof eventQuerySchema>;

/**
 * One event as the list projects it. `.strict()` and deliberately WITHOUT a URL or a code key
 * (D-207, D-217): the secrets live in `event_secrets`, which no member lane can read, and a payload
 * shape with no field for them cannot leak them by accident.
 *
 * `startsAt` / `endsAt` are UTC ISO strings with microsecond precision, formatted by Postgres (the
 * `ISO_MICROSECONDS` rule): the keyset cursor is built from them, so a JS `Date` round trip would
 * move a page boundary. `coverAssetId` is nullable (D-69) with its variant ladder beside it, never a
 * URL.
 *
 * **The viewer's OWN state and two COUNTS, never anyone else's row (D-206, T-06-13).** 06-03 adds:
 *  - `viewerStatus` / `viewerCheckedInAt`: the caller's own attendance row, or null;
 *  - `confirmedCount` (D-219): every member whose recorded answer was `Vou`, i.e. `going` plus
 *    `checked_in`, excluding `walk_in` and `not_going`. What the poster and the detail print as
 *    "N confirmados" while the event is upcoming;
 *  - `presentCount`: `checked_in` plus `walk_in`, printed as "N presentes" once the event is past.
 * Staff answers count like anyone's, and rows of members who have since left still count. The
 * organiser's Participantes chip `Confirmados` (`going` only) is a DIFFERENT number with its own name
 * (Pitfall 11), which 06-07 adds as `pendingConfirmedCount`. No key here names, pictures or ids another
 * member.
 */
export const eventSummarySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    format: z.enum(EVENT_FORMATS),
    venueName: z.string().nullable(),
    coverAssetId: z.uuid().nullable(),
    /** The cover's variant ladder; `[]` when there is no cover (the D-69 gradient branch). */
    coverVariantWidths: z.array(z.number().int()),
    startsAt: z.string(),
    endsAt: z.string(),
    status: z.enum(EVENT_STATUSES),
    viewerStatus: z.enum(ATTENDANCE_STATUSES).nullable(),
    viewerCheckedInAt: z.string().nullable(),
    confirmedCount: z.number().int().nonnegative(),
    presentCount: z.number().int().nonnegative(),
  })
  .strict();
export type EventSummary = z.infer<typeof eventSummarySchema>;

/**
 * `GET /v1/events/{eventId}` (EVENT-02): the list item plus what only the detail page prints: the
 * description, the address (null for an online event) and when the viewer last answered. Still NO
 * URL and NO code key (D-207, D-208), and still no other member's identity (D-206). `.strict()` so
 * a key added by mistake fails the contract test rather than reaching a member.
 */
export const eventDetailSchema = eventSummarySchema
  .extend({
    description: z.string(),
    address: z.string().nullable(),
    viewerRespondedAt: z.string().nullable(),
  })
  .strict();
export type EventDetail = z.infer<typeof eventDetailSchema>;

/**
 * `PUT /v1/events/{eventId}/rsvp` (EVENT-03, D-205). `.strict()`: a forged `status: 'checked_in'`
 * or `userId` fails loudly. The database is still the authority on WHEN an answer is allowed
 * (D-204): the guard trigger refuses it from `starts_at` on, for every writer.
 */
export const rsvpSchema = z.object({ answer: z.enum(RSVP_ANSWERS) }).strict();
export type RsvpInput = z.infer<typeof rsvpSchema>;

/** The viewer's attendance status after the call (unchanged on a repeat answer). */
export const rsvpResultSchema = z.object({ status: z.enum(ATTENDANCE_STATUSES) }).strict();
export type RsvpResult = z.infer<typeof rsvpResultSchema>;

/** One keyset page. `nextCursor` is non-null EXACTLY when another row exists (the over-fetch rule). */
export const eventPageSchema = z
  .object({
    items: z.array(eventSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type EventPage = z.infer<typeof eventPageSchema>;

/**
 * Payload of `event.published` (MOD-03), emitted once per create after the transaction commits.
 * **Ids and instants only** (T-06-06, Pitfall 12): no title, no venue, no URL and no code, because a
 * payload is what a subscriber logs. Phase 7's reminders read `startsAt`; the reminder text needs the
 * title through a read, not through this payload (see the 06-01 SUMMARY, "Notes for Phase 7").
 */
export interface EventPublished {
  tenantId: string;
  eventId: string;
  actorUserId: string;
  format: EventFormat;
  startsAt: string;
  endsAt: string;
}

/**
 * Payload of `event.rsvp` (MOD-03), emitted after commit and ONLY when the answer changed (a repeat
 * answer writes nothing and emits nothing). Ids, statuses and one instant: enough for Phase 7 to
 * schedule a reminder from the payload alone (`startsAt`), with `previousStatus` null on the first
 * answer. Never a title and never another member.
 */
export interface EventRsvp {
  tenantId: string;
  eventId: string;
  userId: string;
  status: RsvpAnswer;
  previousStatus: AttendanceStatus | null;
  startsAt: string;
}

/**
 * MOD-02: the module teaches the KERNEL's `EventMap` about its own events. Nothing goes into
 * `packages/contracts/src/events.ts`, which is the bus contract and knows no module.
 */
declare module '@tria/contracts' {
  interface EventMap {
    'event.published': EventPublished;
    'event.rsvp': EventRsvp;
  }
}
