import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor, keysetComparison } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  AttendanceStatus,
  Checkin,
  CheckinResult,
  EventDetail,
  EventEdit,
  EventFormat,
  EventInput,
  EventIssue,
  EventPage,
  EventQuery,
  EventStatus,
  EventStatusUpdate,
  EventSummary,
  RsvpInput,
  RsvpResult,
} from '../contracts/index';
import { generateCheckinCode } from './checkin-code';

const log = moduleLogger('module-events');

/**
 * The events service (EVENT-01 create half, EVENT-02 list and detail, EVENT-03 RSVP) — a PURE
 * TENANT-LANE area.
 *
 * Every function is `withTenantTx(ctx, …)`: the tenant is never a parameter a caller supplies and
 * never a value this file compares. `events_tenant_isolation` supplies it under the explicit
 * `tenant_id` predicate every statement also carries, so a cross-tenant id falls out of the same code
 * path as an unknown one (D-23). The admin-lane helper is Biome-confined to the kernel and is not
 * importable here at all.
 *
 * Log lines carry the SHAPE of a call (period, counts, format, flags) and never a title, a venue, a
 * URL or a code (Pitfall 12, T-06-06).
 */

/** One hydrated row of the list projection, snake_case straight off `tx.execute`. */
type EventRow = {
  id: string;
  title: string;
  format: EventFormat;
  venue_name: string | null;
  cover_asset_id: string | null;
  cover_variant_widths: number[] | null;
  status: EventStatus;
  starts_at: string;
  ends_at: string;
  viewer_status: AttendanceStatus | null;
  viewer_checked_in_at: string | null;
  confirmed_count: number;
  present_count: number;
};

/** The detail read adds what only the detail page prints. */
type EventDetailRow = EventRow & {
  description: string;
  address: string | null;
  viewer_responded_at: string | null;
};

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres (the `listCommunities` rule): the
 * cursor's `n` is this exact string and is compared back as `::timestamptz`, so a JS `Date` round
 * trip would truncate to milliseconds and move a page boundary.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * THE projection, shared by the list, the detail and the create read-back so they can never disagree
 * about what an event looks like. Everything comes back in the SAME statement (the query-budget
 * rule):
 *  - the cover ladder, through a `left join media_assets` with no tenant condition because
 *    `media_assets_tenant_select` decides visibility in this lane;
 *  - the VIEWER's own attendance row (`me`), through the unique
 *    `event_attendances_tenant_event_user_uq`: only the caller's row, never anyone else's (D-206);
 *  - the two D-219 counts, from a lateral aggregate served by
 *    `event_attendances_tenant_event_status_idx`. `confirmed` is `going + checked_in` (every member
 *    whose recorded answer was Vou), `present` is `checked_in + walk_in`. Cast to `int`: a bare
 *    `count(*)` is a bigint, which the driver hands back as a string. The expressions are copied
 *    VERBATIM into `141-event-attendances.sql` fact 10, so edit both together.
 * `created_by_user_id`, and everything in `event_secrets`, are deliberately absent.
 */
const eventColumns = sql`
           e.id,
           e.title,
           e.format,
           e.venue_name,
           e.cover_asset_id,
           a.variant_widths as cover_variant_widths,
           e.status,
           to_char(e.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           to_char(e.ends_at at time zone 'utc', ${ISO_MICROSECONDS}) as ends_at,
           me.status as viewer_status,
           to_char(me.checked_in_at at time zone 'utc', ${ISO_MICROSECONDS}) as viewer_checked_in_at,
           c.confirmed_count,
           c.present_count`;

/** The FROM clause of the projection; `viewerId` is always `ctx.userId`, never a caller's value. */
const eventSource = (viewerId: string) => sql`
      from events e
      left join media_assets a on a.id = e.cover_asset_id
      left join event_attendances me
             on me.tenant_id = e.tenant_id
            and me.event_id = e.id
            and me.user_id = ${viewerId}::uuid
      left join lateral (
        select count(*) filter (where x.status in ('going','checked_in'))::int as confirmed_count,
               count(*) filter (where x.status in ('checked_in','walk_in'))::int as present_count
          from event_attendances x
         where x.tenant_id = e.tenant_id
           and x.event_id = e.id
      ) c on true`;

const eventProjection = (viewerId: string) => sql`
    select ${eventColumns}
    ${eventSource(viewerId)}`;

/** Row → published contract. No URL or code key exists to fill (D-207). */
const toEvent = (row: EventRow): EventSummary => ({
  id: row.id,
  title: row.title,
  format: row.format,
  venueName: row.venue_name,
  coverAssetId: row.cover_asset_id,
  coverVariantWidths: row.cover_variant_widths ?? [],
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  viewerStatus: row.viewer_status,
  viewerCheckedInAt: row.viewer_checked_in_at,
  // `?? 0` only covers a driver that returns nothing for an aggregate; `count(*)` is never null.
  confirmedCount: Number(row.confirmed_count ?? 0),
  presentCount: Number(row.present_count ?? 0),
});

/**
 * `GET /v1/events?period=&cursor=&limit=` (EVENT-02, D-200, D-201).
 *
 * **Two branches, two COMPLETE literal statements.** `query.period` picks one in TypeScript and is
 * never a bound SQL parameter, so each statement's predicate and ordering are fixed text the planner
 * (and `140-events.sql`'s EXPLAIN) can match to an index by name:
 *  - `upcoming`: `ends_at > now()`, ordered `starts_at asc, id asc` (`events_tenant_starts_idx`).
 *    An event in progress has not ended, so it stays here until it does (the check-in window runs to
 *    the end, D-209);
 *  - `past`: `ends_at <= now()`, ordered `ends_at desc, id desc` (`events_tenant_ends_idx`).
 * Each is its own keyset, and the cursor's `n` is that branch's own ordering column read back from
 * the statement, so a cursor never spans two periods and a tie on the instant is broken by `id`.
 *
 * A CANCELLED event stays in both lists wherever it would otherwise be, carrying its status (D-201):
 * in V1 nothing else tells a member who confirmed that it was cancelled.
 *
 * Every item carries the viewer's own state and the two D-219 counts from the SAME statement (06-03):
 * a page is still one statement, which `feed-query-budget.test.ts` measures with a ceiling and a floor.
 *
 * `decodeCursor` is total: a tampered envelope degrades to page 1 (T-06-04).
 */
export async function listEvents(ctx: RequestContext, query: EventQuery): Promise<EventPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const upcoming = query.period === 'upcoming';

  const rows = await withTenantTx(ctx, (tx) => {
    if (upcoming) {
      const cmp = keysetComparison('asc');
      return tx.execute<EventRow>(sql`
      ${eventProjection(ctx.userId)}
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.deleted_at is null
         and e.ends_at > now()
         and (
           ${afterAt}::timestamptz is null
           or (e.starts_at, e.id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by e.starts_at ${sql.raw(cmp.order)}, e.id ${sql.raw(cmp.order)}
       limit ${limit + 1}`);
    }
    const cmp = keysetComparison('desc');
    return tx.execute<EventRow>(sql`
      ${eventProjection(ctx.userId)}
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.deleted_at is null
         and e.ends_at <= now()
         and (
           ${afterAt}::timestamptz is null
           or (e.ends_at, e.id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by e.ends_at ${sql.raw(cmp.order)}, e.id ${sql.raw(cmp.order)}
       limit ${limit + 1}`);
  });

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const lastKey = last ? (upcoming ? last.starts_at : last.ends_at) : undefined;
  const nextCursor =
    rows.length > limit && last && lastKey ? encodeCursor({ n: lastKey, id: last.id }) : null;

  log.info(
    {
      event: 'events.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      period: query.period,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'events listed',
  );

  return { items: page.map(toEvent), nextCursor };
}

/** What the cover lookup inside the writing transaction needs to decide. */
type CoverAssetRow = { kind: string; purpose: string; status: string };

/**
 * The cover reference, resolved INSIDE the writing transaction (Pitfall 5, the 05-09 communities
 * rule cloned verbatim with the machine code under `details.event`).
 *
 * `cover_asset_id`'s foreign key runs as the table owner and bypasses RLS, so it cannot stand in for
 * this check: another tenant's asset id would persist, and a 23503-vs-201 split would be an existence
 * oracle. Two answers:
 *  - NO ROW (another tenant's, unknown, soft-deleted): ONE bare 404 with no `details`;
 *  - a row of THIS tenant that is not `purpose = 'cover'`, `kind = 'image'`, `status = 'ready'`:
 *    `400 { event: 'cover_invalid' }`, information the caller already had.
 * A null id performs no lookup: "no cover" is a first-class value (D-69).
 */
async function resolveCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  coverAssetId: string | null,
): Promise<void> {
  if (coverAssetId === null) return;
  const asset = await loadCoverAsset(tx, ctx, coverAssetId);
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (!isUsableCover(asset)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { event: 'cover_invalid' });
  }
}

/** THE cover lookup: one statement, so the throwing and boolean answers never use two queries. */
async function loadCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  coverAssetId: string,
): Promise<CoverAssetRow | undefined> {
  const rows = await tx.execute<CoverAssetRow>(sql`
    select kind, purpose, status
      from media_assets
     where id = ${coverAssetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
     limit 1`);
  return rows[0];
}

/** The accepted tuple, stated ONCE. */
function isUsableCover(asset: CoverAssetRow): boolean {
  return asset.purpose === 'cover' && asset.kind === 'image' && asset.status === 'ready';
}

/**
 * Is the STORED cover reference still usable? The non-throwing half of `resolveCoverAsset`, off the
 * SAME lookup (the communities `coverIsUsable`, CR-01): an edit that re-sends the cover it already
 * had asserts nothing new, so a stored cover the admin has since retired is self-healed to null
 * instead of bricking every later edit with a 404 about an event open on their screen.
 */
async function coverIsUsable(tx: Tx, ctx: RequestContext, coverAssetId: string): Promise<boolean> {
  const asset = await loadCoverAsset(tx, ctx, coverAssetId);
  return asset !== undefined && isUsableCover(asset);
}

/**
 * The name of the CHECK a Postgres `23514` was raised by, walked out of whatever the driver wrapped
 * it in (the `isSlugCollision` cause-chain walk, generalised). `null` for anything else.
 */
function checkViolation(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23514' && typeof candidate.constraint_name === 'string') {
      return candidate.constraint_name;
    }
    current = candidate.cause;
  }
  return null;
}

/** A trimmed, non-blank string, or null: the stored shape of an optional text field. */
const orNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * `POST /v1/events` (EVENT-01, create half).
 *
 * ONE transaction writes both halves (the EVENT-01 concurrency rule, create half): the cover is
 * resolved first, then `events`, then `event_secrets`. The two deferred FKs are checked at COMMIT,
 * so a transaction that wrote only one half could never commit, and an online event never exists
 * without its `https:` URL.
 *
 * **The wall clock becomes UTC inside the insert** (Pattern 2, locked):
 * `(date || ' ' || time)::timestamp at time zone t.timezone`, reading `tenants.timezone` in the same
 * statement through `tenants_self_select`. `2026-10-12 19:00` on an `America/Sao_Paulo` tenant is
 * stored as `22:00Z`; the device's zone never enters. A DST-fold input that passed the wall-clock
 * comparison in Zod but fails `events_window_chk` answers `end_before_start`, never a 500.
 *
 * `tenant_id` and `created_by_user_id` come from `ctx`, never from the body (T-06-05).
 *
 * **Idempotency, create half:** there is no client key, so two identical bodies create two events
 * with two ids and two codes and neither answers 409 (the `createCommunity` precedent).
 *
 * `event.published` is emitted exactly once, only after `withTenantTx` resolved, with ids and
 * instants only (MOD-03, T-06-06).
 */
export async function createEvent(ctx: RequestContext, input: EventInput): Promise<EventSummary> {
  // The service re-states the route's rule: it is reachable from handlers that assemble their own
  // input without passing through the route validator.
  if (input.title.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { event: 'name_required' });
  }

  const inPerson = input.format === 'in_person';
  const venueName = inPerson ? orNull(input.venueName) : null;
  const address = inPerson ? orNull(input.address) : null;
  const meetingUrl = inPerson ? null : orNull(input.meetingUrl);
  const coverAssetId = input.coverAssetId ?? null;

  let created: EventRow;
  try {
    created = await withTenantTx(ctx, async (tx) => {
      // FIRST statement: a refused cover writes nothing at all.
      await resolveCoverAsset(tx, ctx, coverAssetId);

      const inserted = await tx.execute<{ id: string }>(sql`
        insert into events (tenant_id, created_by_user_id, title, description, cover_asset_id,
                            format, venue_name, address, starts_at, ends_at)
        select ${ctx.tenantId}::uuid,
               ${ctx.userId}::uuid,
               ${input.title},
               ${input.description},
               ${coverAssetId}::uuid,
               ${input.format},
               ${venueName},
               ${address},
               (${input.start.date}::text || ' ' || ${input.start.time}::text)::timestamp at time zone t.timezone,
               (${input.end.date}::text || ' ' || ${input.end.time}::text)::timestamp at time zone t.timezone
          from tenants t
         where t.id = ${ctx.tenantId}::uuid
        returning id`);
      const id = inserted[0]?.id;
      if (!id) throw new ApiError(500, 'INTERNAL');

      await tx.execute(sql`
        insert into event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
        values (${id}::uuid, ${ctx.tenantId}::uuid, ${input.format}, ${generateCheckinCode()},
                ${meetingUrl})`);

      const rows = await tx.execute<EventRow>(sql`
        ${eventProjection(ctx.userId)}
         where e.tenant_id = ${ctx.tenantId}::uuid
           and e.id = ${id}::uuid
         limit 1`);
      const row = rows[0];
      if (!row) throw new ApiError(500, 'INTERNAL');
      return row;
    });
  } catch (error) {
    if (checkViolation(error) === 'events_window_chk') {
      throw new ApiError(400, 'VALIDATION_FAILED', { event: 'end_before_start' });
    }
    throw error;
  }

  emit(ctx, 'event.published', {
    tenantId: ctx.tenantId,
    eventId: created.id,
    actorUserId: ctx.userId,
    format: created.format,
    startsAt: created.starts_at,
    endsAt: created.ends_at,
  });

  log.info(
    {
      event: 'events.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId: created.id,
      // Lengths and flags, never the words themselves (Pitfall 12).
      format: created.format,
      titleLength: input.title.length,
      descriptionLength: input.description.length,
      hasCover: created.cover_asset_id !== null,
    },
    'event created',
  );

  return toEvent(created);
}

/**
 * `GET /v1/events/{eventId}` (EVENT-02): the shared projection plus the description, the address and
 * the viewer's `responded_at`. ONE statement.
 *
 * A miss is ONE bare 404 with no `details`: an unknown id, another tenant's id (RLS and the explicit
 * `tenant_id` predicate both exclude it) and a moderated one are indistinguishable (D-23, T-06-14).
 */
export async function getEvent(ctx: RequestContext, eventId: string): Promise<EventDetail> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<EventDetailRow>(sql`
      select ${eventColumns},
             e.description,
             e.address,
             to_char(me.responded_at at time zone 'utc', ${ISO_MICROSECONDS}) as viewer_responded_at
      ${eventSource(ctx.userId)}
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.id = ${eventId}::uuid
         and e.deleted_at is null
       limit 1`),
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return {
    ...toEvent(row),
    description: row.description,
    address: row.address,
    viewerRespondedAt: row.viewer_responded_at,
  };
}

/**
 * The guard trigger's refusals (`20260927154335_event_attendance_guard.sql`), by the constraint name
 * each raise carries, mapped to the closed `EVENT_ISSUES` vocabulary. `event_attendances_immutable`
 * is deliberately absent: no API path moves a row, so reaching it is a bug and stays a 500.
 */
const GUARD_ISSUES: Readonly<Record<string, EventIssue>> = {
  event_attendances_rsvp_open: 'rsvp_closed',
  event_attendances_event_active: 'cancelled',
  event_attendances_locked: 'attendance_locked',
  event_attendances_checkin_window: 'checkin_not_open',
};

/**
 * What a guard refusal means, walked out of whatever the driver wrapped it in (the `isSlugCollision`
 * cause-chain walk, generalised): the mapped machine code for a 23514, `'not_found'` for the 23503
 * `event_attendances_event_visible`, and null for anything else (which the caller rethrows).
 * `checkin_window` keeps the side the database named in its message (`checkin_not_open` before the
 * window, `checkin_closed` after it).
 */
export function guardIssue(error: unknown): EventIssue | 'not_found' | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === '23503' &&
      candidate.constraint_name === 'event_attendances_event_visible'
    ) {
      return 'not_found';
    }
    if (candidate.code === '23514' && typeof candidate.constraint_name === 'string') {
      const issue = GUARD_ISSUES[candidate.constraint_name];
      if (issue === 'checkin_not_open' && candidate.message === 'checkin_closed') {
        return 'checkin_closed';
      }
      if (issue) return issue;
    }
    current = candidate.cause;
  }
  return null;
}

/** One row of the RSVP upsert: the new status, and the snapshot taken in the same statement. */
type RsvpRow = {
  status: AttendanceStatus;
  previous_status: AttendanceStatus | null;
  starts_at: string | null;
};

/**
 * `PUT /v1/events/{eventId}/rsvp { answer }` (EVENT-03, D-204, D-205).
 *
 * ONE statement inside `withTenantTx`: a data-modifying CTE snapshots the previous status and the
 * event's `starts_at` (every CTE reads the same snapshot, taken before the write), then upserts on
 * `event_attendances_tenant_event_user_uq`. The `do update … where` does two jobs:
 *  - `status in ('going','not_going')`: a checked-in or walk-in row is never rewritten by an answer;
 *  - `status is distinct from excluded.status`: a REPEAT answer writes nothing, so `updated_at` and
 *    `responded_at` stay put and no event is emitted.
 * Zero rows back means "unchanged or locked", told apart by a follow-up read of the viewer's row
 * (for the answer only, never for the decision, which the database already made).
 *
 * **The database decides WHEN** (D-204). The guard trigger fires on the proposed tuple BEFORE the
 * arbiter, reads the event `FOR SHARE` and raises by constraint name. `guardIssue` maps each refusal:
 * `409 CONFLICT { event: 'rsvp_closed' | 'cancelled' | 'attendance_locked' }`, and an unknown or
 * foreign event is a bare 404 (the guard's 23503 comes first, so the composite FK never answers).
 *
 * `event.rsvp` is emitted after `withTenantTx` resolved, only when the status changed.
 */
export async function rsvpEvent(
  ctx: RequestContext,
  eventId: string,
  input: RsvpInput,
): Promise<RsvpResult> {
  const answer = input.answer;
  let outcome: { status: AttendanceStatus; changed: RsvpRow | null };
  try {
    outcome = await withTenantTx(ctx, async (tx) => {
      const written = await tx.execute<RsvpRow>(sql`
        with previous as (
          select status
            from event_attendances
           where tenant_id = ${ctx.tenantId}::uuid
             and event_id = ${eventId}::uuid
             and user_id = ${ctx.userId}::uuid
        ),
        ev as (
          select to_char(starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at
            from events
           where tenant_id = ${ctx.tenantId}::uuid
             and id = ${eventId}::uuid
             and deleted_at is null
        ),
        upserted as (
          insert into event_attendances (tenant_id, event_id, user_id, status, responded_at)
          values (${ctx.tenantId}::uuid, ${eventId}::uuid, ${ctx.userId}::uuid, ${answer}, now())
          on conflict (tenant_id, event_id, user_id) do update
             set status = excluded.status,
                 responded_at = now(),
                 updated_at = now()
           where event_attendances.status in ('going','not_going')
             and event_attendances.status is distinct from excluded.status
          returning status
        )
        select upserted.status,
               (select status from previous) as previous_status,
               (select starts_at from ev) as starts_at
          from upserted`);
      const row = written[0];
      if (row) return { status: row.status, changed: row };

      // Nothing written: the same answer again, or a row that has checked in.
      const current = await tx.execute<{ status: AttendanceStatus }>(sql`
        select status
          from event_attendances
         where tenant_id = ${ctx.tenantId}::uuid
           and event_id = ${eventId}::uuid
           and user_id = ${ctx.userId}::uuid
         limit 1`);
      const status = current[0]?.status;
      if (status === undefined) throw new ApiError(500, 'INTERNAL');
      if (status !== answer) {
        throw new ApiError(409, 'CONFLICT', { event: 'attendance_locked' });
      }
      return { status, changed: null };
    });
  } catch (error) {
    const issue = guardIssue(error);
    if (issue === 'not_found') throw new ApiError(404, 'NOT_FOUND');
    if (issue) throw new ApiError(409, 'CONFLICT', { event: issue });
    throw error;
  }

  const changed = outcome.changed;
  if (changed?.starts_at) {
    emit(ctx, 'event.rsvp', {
      tenantId: ctx.tenantId,
      eventId,
      userId: ctx.userId,
      status: answer,
      previousStatus: changed.previous_status,
      startsAt: changed.starts_at,
    });
  }

  log.info(
    {
      event: 'events.rsvp',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      answer,
      changed: changed !== null,
    },
    'event rsvp',
  );

  return { status: outcome.status };
}

/** One row of the edit read: the stored event in the tenant's wall clock, plus the admin's URL. */
type EventEditRow = {
  id: string;
  title: string;
  description: string;
  cover_asset_id: string | null;
  cover_variant_widths: number[] | null;
  format: EventFormat;
  venue_name: string | null;
  address: string | null;
  meeting_url: string | null;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  status: EventStatus;
  starts_at: string;
  ends_at: string;
};

/**
 * `GET /v1/events/{eventId}/edit` (06-04, D-214): the event as the edit form needs it. ONE statement.
 *
 * **The instants go back to the tenant's wall clock IN SQL** (`to_char(e.starts_at at time zone
 * t.timezone, 'YYYY-MM-DD')` / `'HH24:MI'`), the exact inverse of the create/update conversion, so a
 * São Paulo 23:30 start stored as 02:30Z the next day reads back as `{ date, time: '23:30' }` of the
 * day the admin typed. The web never converts a timezone.
 *
 * The meeting URL comes through `left join event_secrets`, which `event_secrets_staff_all` shows to
 * the `admin_tenant` lane only: the route's manage guard plus the policy are two independent gates
 * (T-06-20). A manage-holding non-admin would read a null URL, which degrades and does not leak.
 *
 * A miss is ONE bare 404 (D-23).
 */
export async function getEventForEdit(ctx: RequestContext, eventId: string): Promise<EventEdit> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<EventEditRow>(sql`
      select e.id,
             e.title,
             e.description,
             e.cover_asset_id,
             a.variant_widths as cover_variant_widths,
             e.format,
             e.venue_name,
             e.address,
             s.meeting_url,
             to_char(e.starts_at at time zone t.timezone, 'YYYY-MM-DD') as start_date,
             to_char(e.starts_at at time zone t.timezone, 'HH24:MI') as start_time,
             to_char(e.ends_at at time zone t.timezone, 'YYYY-MM-DD') as end_date,
             to_char(e.ends_at at time zone t.timezone, 'HH24:MI') as end_time,
             e.status,
             to_char(e.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
             to_char(e.ends_at at time zone 'utc', ${ISO_MICROSECONDS}) as ends_at
        from events e
        join tenants t on t.id = e.tenant_id
        left join media_assets a on a.id = e.cover_asset_id
        left join event_secrets s on s.tenant_id = e.tenant_id and s.event_id = e.id
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.id = ${eventId}::uuid
         and e.deleted_at is null
       limit 1`),
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverAssetId: row.cover_asset_id,
    coverVariantWidths: row.cover_variant_widths ?? [],
    format: row.format,
    venueName: row.venue_name,
    address: row.address,
    meetingUrl: row.meeting_url,
    start: { date: row.start_date, time: row.start_time },
    end: { date: row.end_date, time: row.end_time },
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

/** The locked current row an update starts from. */
type LockedEventRow = { cover_asset_id: string | null; starts_at: string; ends_at: string };

/**
 * `PUT /v1/events/{eventId}` (06-04, D-214): a WHOLE-EVENT REPLACEMENT with the create's own
 * `eventInputSchema` (planning decision 1: format, location and URL move together, so a partial body
 * would have to re-derive the XOR). Every field stays editable after members answered, and nothing
 * here touches `event_attendances`: answers and check-ins are kept.
 *
 * ONE `withTenantTx`, in this order:
 *  1. **Lock** the current row (`for update`), keeping its old instants for `timesChanged`. A miss
 *     (unknown, another tenant's, removed) is a bare 404 (D-23).
 *  2. **The cover** (Pitfall 5 + CR-01): an id that DIFFERS from the stored one is a new assertion
 *     and is resolved strictly (foreign -> bare 404, unusable -> `cover_invalid`, T-06-21). The SAME
 *     id re-sent, now unusable (its admin retired it), is self-healed to null.
 *  3. **`events`**, with the wall clock converted inside the statement exactly as the create does,
 *     `where (…) is distinct from (…)`: an identical body matches no row, so `updated_at` stays put.
 *  4. **`event_secrets`** `set event_format, meeting_url` under the same `is distinct from` rule.
 *     A FORMAT SWITCH is steps 3 and 4 together: `event_secrets_event_fk` is DEFERRABLE INITIALLY
 *     DEFERRED, so the half-switched state between them is legal until COMMIT, where the pair is
 *     whole again (pgTAP proves both directions under `set constraints all immediate`).
 *
 * Zero rows from both writes means the body equalled the stored event: 200, nothing written, nothing
 * emitted (EVENT-01 idempotency, edit half; T-06-26). A `23514 events_window_chk` (a DST fold Zod
 * cannot see) answers `end_before_start`. After commit, ONE `event.updated` with `timesChanged` true
 * exactly when `starts_at` or `ends_at` moved, so Phase 7 re-arms its reminders.
 *
 * The response is the member-facing summary projection, which has no URL key (T-06-20).
 */
export async function updateEvent(
  ctx: RequestContext,
  eventId: string,
  input: EventInput,
): Promise<EventSummary> {
  if (input.title.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { event: 'name_required' });
  }

  const inPerson = input.format === 'in_person';
  const venueName = inPerson ? orNull(input.venueName) : null;
  const address = inPerson ? orNull(input.address) : null;
  const meetingUrl = inPerson ? null : orNull(input.meetingUrl);
  const requestedCover = input.coverAssetId ?? null;

  let outcome: { row: EventRow; changed: boolean; timesChanged: boolean; healed: boolean };
  try {
    outcome = await withTenantTx(ctx, async (tx) => {
      const locked = await tx.execute<LockedEventRow>(sql`
        select cover_asset_id,
               to_char(starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
               to_char(ends_at at time zone 'utc', ${ISO_MICROSECONDS}) as ends_at
          from events
         where tenant_id = ${ctx.tenantId}::uuid
           and id = ${eventId}::uuid
           and deleted_at is null
         for update`);
      const before = locked[0];
      if (!before) throw new ApiError(404, 'NOT_FOUND');

      let coverAssetId = requestedCover;
      let healed = false;
      if (coverAssetId !== before.cover_asset_id) {
        await resolveCoverAsset(tx, ctx, coverAssetId);
      } else if (coverAssetId !== null && !(await coverIsUsable(tx, ctx, coverAssetId))) {
        coverAssetId = null;
        healed = true;
      }

      const updated = await tx.execute<{ starts_at: string; ends_at: string }>(sql`
        with next as (
          select ${input.title}::text as title,
                 ${input.description}::text as description,
                 ${coverAssetId}::uuid as cover_asset_id,
                 ${input.format}::text as format,
                 ${venueName}::text as venue_name,
                 ${address}::text as address,
                 (${input.start.date}::text || ' ' || ${input.start.time}::text)::timestamp at time zone t.timezone as starts_at,
                 (${input.end.date}::text || ' ' || ${input.end.time}::text)::timestamp at time zone t.timezone as ends_at
            from tenants t
           where t.id = ${ctx.tenantId}::uuid
        )
        update events e
           set title = n.title,
               description = n.description,
               cover_asset_id = n.cover_asset_id,
               format = n.format,
               venue_name = n.venue_name,
               address = n.address,
               starts_at = n.starts_at,
               ends_at = n.ends_at,
               updated_at = now()
          from next n
         where e.tenant_id = ${ctx.tenantId}::uuid
           and e.id = ${eventId}::uuid
           and e.deleted_at is null
           and (e.title, e.description, e.cover_asset_id, e.format, e.venue_name, e.address,
                e.starts_at, e.ends_at)
               is distinct from
               (n.title, n.description, n.cover_asset_id, n.format, n.venue_name, n.address,
                n.starts_at, n.ends_at)
        returning to_char(e.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
                  to_char(e.ends_at at time zone 'utc', ${ISO_MICROSECONDS}) as ends_at`);

      const secrets = await tx.execute<{ event_id: string }>(sql`
        update event_secrets
           set event_format = ${input.format},
               meeting_url = ${meetingUrl},
               updated_at = now()
         where tenant_id = ${ctx.tenantId}::uuid
           and event_id = ${eventId}::uuid
           and (event_format, meeting_url) is distinct from (${input.format}::text, ${meetingUrl}::text)
        returning event_id`);

      const moved = updated[0];
      const timesChanged =
        moved !== undefined &&
        (moved.starts_at !== before.starts_at || moved.ends_at !== before.ends_at);

      const rows = await tx.execute<EventRow>(sql`
        ${eventProjection(ctx.userId)}
         where e.tenant_id = ${ctx.tenantId}::uuid
           and e.id = ${eventId}::uuid
         limit 1`);
      const row = rows[0];
      if (!row) throw new ApiError(500, 'INTERNAL');
      return {
        row,
        changed: moved !== undefined || secrets.length > 0,
        timesChanged,
        healed,
      };
    });
  } catch (error) {
    if (checkViolation(error) === 'events_window_chk') {
      throw new ApiError(400, 'VALIDATION_FAILED', { event: 'end_before_start' });
    }
    throw error;
  }

  const { row, changed, timesChanged, healed } = outcome;
  if (changed) {
    emit(ctx, 'event.updated', {
      tenantId: ctx.tenantId,
      eventId: row.id,
      actorUserId: ctx.userId,
      format: row.format,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timesChanged,
    });
  }

  log.info(
    {
      event: 'events.updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId: row.id,
      // Flags and lengths, never the words themselves (Pitfall 12).
      changed,
      timesChanged,
      coverHealed: healed,
      format: row.format,
      titleLength: input.title.length,
      hasCover: row.cover_asset_id !== null,
    },
    'event updated',
  );

  return toEvent(row);
}

/**
 * `PATCH /v1/events/{eventId} { status }` (06-04, D-214): cancel and reactivate, the ONLY status
 * writes. There is no delete anywhere (D-214, T-06-23): a cancelled event stays in every list with
 * its `Cancelado` state until it ends (D-201).
 *
 * Each transition is ONE guarded UPDATE, so the rule and the write are the same statement:
 *  - cancel: `set status = 'cancelled', cancelled_at = now() where status = 'active' and now() <
 *    ends_at` (planning decision 2: cancelling a finished event is meaningless);
 *  - reactivate: `set status = 'active', cancelled_at = null where status = 'cancelled' and now() <
 *    starts_at`.
 * Zero rows is disambiguated by one read: a miss is a bare 404; the target status already held is
 * 200 with nothing written and nothing emitted; otherwise `409 event_ended` (cancel) or
 * `409 reactivate_started` (reactivate). The RSVP guard trigger reads the event `FOR SHARE`, so a
 * cancel serialises against an in-flight answer (06-03's held-cancel case).
 *
 * After commit, ONE `event.cancelled` or `event.reactivated` per transition.
 */
export async function setEventStatus(
  ctx: RequestContext,
  eventId: string,
  input: EventStatusUpdate,
): Promise<EventSummary> {
  const cancel = input.status === 'cancelled';
  const { row, transitioned } = await withTenantTx(ctx, async (tx) => {
    const written = cancel
      ? await tx.execute<{ id: string }>(sql`
          update events
             set status = 'cancelled', cancelled_at = now(), updated_at = now()
           where tenant_id = ${ctx.tenantId}::uuid
             and id = ${eventId}::uuid
             and deleted_at is null
             and status = 'active'
             and now() < ends_at
          returning id`)
      : await tx.execute<{ id: string }>(sql`
          update events
             set status = 'active', cancelled_at = null, updated_at = now()
           where tenant_id = ${ctx.tenantId}::uuid
             and id = ${eventId}::uuid
             and deleted_at is null
             and status = 'cancelled'
             and now() < starts_at
          returning id`);

    if (written.length === 0) {
      // The guarded UPDATE already decided; this read only names the refusal.
      const probe = await tx.execute<{ status: EventStatus }>(sql`
        select status
          from events
         where tenant_id = ${ctx.tenantId}::uuid
           and id = ${eventId}::uuid
           and deleted_at is null
         limit 1`);
      const current = probe[0];
      if (!current) throw new ApiError(404, 'NOT_FOUND');
      if (current.status !== input.status) {
        throw new ApiError(409, 'CONFLICT', {
          event: cancel ? 'event_ended' : 'reactivate_started',
        });
      }
    }

    const rows = await tx.execute<EventRow>(sql`
      ${eventProjection(ctx.userId)}
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.id = ${eventId}::uuid
       limit 1`);
    const after = rows[0];
    if (!after) throw new ApiError(500, 'INTERNAL');
    return { row: after, transitioned: written.length > 0 };
  });

  if (transitioned) {
    emit(ctx, cancel ? 'event.cancelled' : 'event.reactivated', {
      tenantId: ctx.tenantId,
      eventId: row.id,
      actorUserId: ctx.userId,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    });
  }

  log.info(
    {
      event: 'events.status',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId: row.id,
      status: input.status,
      transitioned,
    },
    'event status written',
  );

  return toEvent(row);
}

/** Every outcome `app.events_check_in` can return (its migration header is the vocabulary). */
type CheckInOutcome =
  | 'checked_in'
  | 'walk_in'
  | 'already'
  | 'wrong_code'
  | 'too_many_attempts'
  | 'not_open'
  | 'closed'
  | 'cancelled'
  | 'not_found';

/** The one row the definer returns, formatted by Postgres (the `ISO_MICROSECONDS` rule). */
type CheckInRow = {
  outcome: CheckInOutcome;
  checked_in_at: string | null;
  starts_at: string | null;
};

/** The refusals, mapped to the closed `EVENT_ISSUES` vocabulary (a `409 CONFLICT { event }`). */
const CHECKIN_REFUSALS: Readonly<Partial<Record<CheckInOutcome, EventIssue>>> = {
  wrong_code: 'wrong_code',
  too_many_attempts: 'too_many_attempts',
  not_open: 'checkin_not_open',
  closed: 'checkin_closed',
  cancelled: 'cancelled',
};

/**
 * `POST /v1/events/{eventId}/check-in { code }` (06-05, EVENT-04 in person, D-208, D-209, D-216,
 * D-217). The first module service in this repo that calls a SECURITY DEFINER function.
 *
 * **Everything is decided inside Postgres**, by `app.events_check_in(p_event_id, p_code)`: the event
 * (in person, this tenant, live), its state and window, "already present", the guess bound and the
 * comparison against `event_secrets.checkin_code`, which this lane cannot read. The code never leaves
 * the database on this path (T-06-31), and this file never compares it.
 *
 * **The function RETURNS its refusal and this service throws only AFTER `withTenantTx` resolved**
 * (Pitfall 1). A throw inside the callback would roll back the `event_checkin_attempts` increment the
 * function just wrote, and five wrong codes would never add up. So the callback returns the row, the
 * transaction commits, and only then is the outcome mapped:
 *  - `checked_in` / `walk_in` / `already` -> 200 `{ outcome, checkedInAt }`;
 *  - `wrong_code` / `too_many_attempts` / `not_open` / `closed` / `cancelled` -> `409 CONFLICT
 *    { event: 'wrong_code' | 'too_many_attempts' | 'checkin_not_open' | 'checkin_closed' |
 *    'cancelled' }`;
 *  - `not_found` (unknown, another tenant's, removed, or ONLINE) -> ONE bare 404 (D-23).
 *
 * `event.checked_in` (MOD-03) fires ONCE per member per event, on the first check-in only, after
 * commit (`already` emits nothing). Log lines carry the outcome, never the code (Pitfall 12).
 */
export async function checkInEvent(
  ctx: RequestContext,
  eventId: string,
  input: Checkin,
): Promise<CheckinResult> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<CheckInRow>(sql`
      select r.outcome,
             to_char(r.checked_in_at at time zone 'utc', ${ISO_MICROSECONDS}) as checked_in_at,
             to_char(r.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at
        from app.events_check_in(${eventId}::uuid, ${input.code}::text) r`);
    // Returned, never thrown: the transaction must commit whatever the outcome (Pitfall 1).
    return rows[0];
  });

  const outcome = row?.outcome ?? 'not_found';
  log.info(
    {
      event: 'events.check_in',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      // The outcome only: never the code the member typed (Pitfall 12).
      outcome,
    },
    'event check-in',
  );

  if (outcome === 'not_found' || !row) throw new ApiError(404, 'NOT_FOUND');
  const refusal = CHECKIN_REFUSALS[outcome];
  if (refusal) throw new ApiError(409, 'CONFLICT', { event: refusal });
  if (!row.checked_in_at) throw new ApiError(500, 'INTERNAL');

  if ((outcome === 'checked_in' || outcome === 'walk_in') && row.starts_at) {
    emit(ctx, 'event.checked_in', {
      tenantId: ctx.tenantId,
      eventId,
      userId: ctx.userId,
      walkIn: outcome === 'walk_in',
      via: 'code',
      startsAt: row.starts_at,
    });
  }

  return {
    outcome: outcome === 'walk_in' ? 'walk_in' : outcome === 'already' ? 'already' : 'checked_in',
    checkedInAt: row.checked_in_at,
  };
}
