import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { sql } from 'drizzle-orm';
import {
  type EventsPayload,
  eventsPayloadSchema,
  type OwnerEventsAnswer,
  type OwnerPastEventAnswer,
  type OwnerUpcomingEventAnswer,
} from '../contracts/index';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** D-455: no ticket price, no event revenue and no waiting list is recorded. */
const NOT_MEASURED = {
  ticket: { measured: false, reason: 'needs_event_tickets' },
  waitlist: { measured: false, reason: 'needs_waitlist' },
} as const;

/**
 * The snapshot's `events` key parsed with its contract, or `null` when it is missing or invalid (an
 * older payload version): the caller answers `preparing`, never zeros (R-Pitfall 3).
 */
export function readEventsPayload(payload: unknown): EventsPayload | null {
  const area = (payload ?? {}) as Record<string, unknown>;
  const parsed = eventsPayloadSchema.safeParse(area.events);
  return parsed.success ? parsed.data : null;
}

type EventLabel = { title: string; coverAssetId: string | null };

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * The live title and cover of the given events of `tenantId` (explicit predicate beside RLS), read
 * in the admin's lane. An event deleted or cancelled since the build has no label, so the caller
 * drops it (PR-1: the snapshot never stores a title).
 */
async function liveEventLabels(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, EventLabel>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; title: string; cover_asset_id: string | null }>(sql`
    select e.id::text as id, e.title, e.cover_asset_id::text as cover_asset_id
      from public.events e
     where e.id = any (${uuidArray(ids)}::uuid[])
       and e.tenant_id = ${tenantId}::uuid
       and e.status = 'active'
       and e.deleted_at is null`);
  return new Map(
    rows.map((row) => [row.id, { title: row.title, coverAssetId: row.cover_asset_id }]),
  );
}

/** The stored numbers of one event plus its live label and the unmeasured ticket (D-455). */
function withLabel<T extends { id: string }>(
  event: T,
  labels: Map<string, EventLabel>,
): (T &
  EventLabel & { ticketCents: typeof NOT_MEASURED.ticket; revenue: typeof NOT_MEASURED.ticket })[] {
  const label = labels.get(event.id);
  if (!label) return [];
  return [
    {
      ...event,
      title: label.title,
      coverAssetId: label.coverAssetId,
      ticketCents: NOT_MEASURED.ticket,
      revenue: NOT_MEASURED.ticket,
    },
  ];
}

/**
 * `GET /v1/dashboard/owner/events` (08.7-08, D-455, D-460, D-461, INSIGHT-11): the Eventos area of
 * the tenant's newest snapshot, read in the admin's own lane (the admin-only policy of
 * `dashboard_snapshots` applies). The route's chain already refused a tenant without `events`
 * (404 `MODULE_DISABLED`) and any role but `admin_tenant` (403), in that order (EP-16).
 *
 * - No snapshot, or a snapshot whose `events` key is missing or fails its contract → `preparing`.
 * - Titles and covers are joined LIVE; an event deleted or cancelled since the build is dropped.
 * - `ticketCents`, `revenue` (every event) and `waitlist` are `{ measured: false, reason }`.
 * - The order is the builder's: upcoming `startsAt asc, id asc`, past `startsAt desc, id desc`
 *   (EP-35), so two renders of one snapshot show the same rows in the same order.
 */
export async function getOwnerEvents(ctx: Ctx): Promise<OwnerEventsAnswer> {
  return withTenantTx(ctx, async (tx) => {
    const row = await readLatestSnapshot(tx, ctx.tenantId);
    if (!row) return { state: 'preparing' } as const;
    const snapshot = snapshotMetaOf(row);
    const events = readEventsPayload(row.payload);
    if (!snapshot || !events) return { state: 'preparing' } as const;

    const labels = await liveEventLabels(tx, ctx.tenantId, [
      ...events.upcoming.map((event) => event.id),
      ...events.past.map((event) => event.id),
    ]);
    const upcoming: OwnerUpcomingEventAnswer[] = events.upcoming.flatMap((event) =>
      withLabel(event, labels),
    );
    const past: OwnerPastEventAnswer[] = events.past.flatMap((event) => withLabel(event, labels));
    return {
      state: 'ready',
      snapshot,
      upcoming,
      past,
      attendanceTotals: events.attendanceTotals,
      attendanceByBand: events.attendanceByBand,
      waitlist: NOT_MEASURED.waitlist,
    };
  });
}
