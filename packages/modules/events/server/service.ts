import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor, keysetComparison } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  EventFormat,
  EventInput,
  EventPage,
  EventQuery,
  EventStatus,
  EventSummary,
} from '../contracts/index';
import { generateCheckinCode } from './checkin-code';

const log = moduleLogger('module-events');

/**
 * The events service (EVENT-01 create half, EVENT-02 list) — a PURE TENANT-LANE area.
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
};

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres (the `listCommunities` rule): the
 * cursor's `n` is this exact string and is compared back as `::timestamptz`, so a JS `Date` round
 * trip would truncate to milliseconds and move a page boundary.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * THE projection, shared by the list and the create read-back so the two can never disagree about
 * what an event looks like. The cover ladder comes back in the SAME statement (the query-budget
 * rule); the `left join media_assets` carries no tenant condition because
 * `media_assets_tenant_select` decides visibility in this lane. `created_by_user_id`, `description`,
 * `address` and everything in `event_secrets` are deliberately absent from the select list.
 */
const eventProjection = sql`
    select e.id,
           e.title,
           e.format,
           e.venue_name,
           e.cover_asset_id,
           a.variant_widths as cover_variant_widths,
           e.status,
           to_char(e.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           to_char(e.ends_at at time zone 'utc', ${ISO_MICROSECONDS}) as ends_at
      from events e
      left join media_assets a on a.id = e.cover_asset_id`;

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
      ${eventProjection}
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
      ${eventProjection}
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
        ${eventProjection}
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
