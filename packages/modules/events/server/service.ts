import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor, keysetComparison } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  AttendanceStatus,
  EventDetail,
  EventFormat,
  EventInput,
  EventIssue,
  EventPage,
  EventQuery,
  EventStatus,
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
