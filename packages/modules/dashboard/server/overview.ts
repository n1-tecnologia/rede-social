import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import {
  contentPayloadSchema,
  type EventsPayload,
  financePayloadSchema,
  type OwnerAlert,
  type OwnerOverviewAccount,
  type OwnerOverviewAnswer,
  type OwnerOverviewReady,
  overviewPayloadSchema,
  type SupportPayload,
} from '../contracts/index';
import { readEventsPayload } from './events';
import { readMembersPayload } from './members';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';
import { readSupportPayload } from './support';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** The module flags Visão geral reads (D-460), before the lane opens (the A-WR-03 order). */
export type OverviewFlags = {
  feed: boolean;
  stories: boolean;
  events: boolean;
  store: boolean;
  chat: boolean;
  notifications: boolean;
};

async function overviewFlags(ctx: Ctx): Promise<OverviewFlags> {
  const { keys } = await moduleFlags.flags(ctx);
  return {
    feed: keys.has('feed'),
    stories: keys.has('stories'),
    events: keys.has('events'),
    store: keys.has('store'),
    chat: keys.has('chat'),
    notifications: keys.has('notifications'),
  };
}

/**
 * `event_soon` (UI-D-489 a, EP-18): seats left at most 10% of the capacity and at least one. With
 * capacity 100: 90 confirmed (10 left) raises it, 89 (11 left) and 100 (0 left) do not; an event
 * with no capacity never does.
 */
export function eventIsSoonFull(event: { capacity: number | null; confirmed: number }): boolean {
  if (event.capacity === null) return false;
  const left = event.capacity - event.confirmed;
  return left >= 1 && left * 10 <= event.capacity;
}

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * The `event_soon` alert: among the build's upcoming events (soonest first) that have not started
 * by `nowMs` and are nearly full, the first one still live (active, not deleted: its title is read
 * LIVE, PR-1), or none. An event of another tenant can never be named: the candidates come from
 * the tenant's own payload and the title read pins `tenant_id` beside RLS (T-08.7-01).
 */
async function eventSoonAlert(
  tx: Tx,
  tenantId: string,
  events: EventsPayload,
  nowMs: number,
): Promise<OwnerAlert | null> {
  const candidates = events.upcoming.filter(
    (event) => Date.parse(event.startsAt) > nowMs && eventIsSoonFull(event),
  );
  if (candidates.length === 0) return null;
  const rows = await tx.execute<{ id: string; title: string }>(sql`
    select e.id::text as id, e.title
      from public.events e
     where e.id = any (${uuidArray(candidates.map((event) => event.id))}::uuid[])
       and e.tenant_id = ${tenantId}::uuid
       and e.status = 'active'
       and e.deleted_at is null`);
  const titles = new Map(rows.map((row) => [row.id, row.title]));
  for (const event of candidates) {
    const title = titles.get(event.id);
    if (title === undefined || event.capacity === null) continue;
    return {
      kind: 'event_soon',
      eventId: event.id,
      title,
      startsAt: event.startsAt,
      confirmed: event.confirmed,
      capacity: event.capacity,
    };
  }
  return null;
}

/**
 * The account card, read LIVE in the admin's lane (explicit tenant predicates beside RLS): the
 * stored plan and the current team — active, unblocked, undeleted admins and support staff.
 */
async function readAccount(tx: Tx, tenantId: string): Promise<OwnerOverviewAccount | null> {
  const [row] = await tx.execute<{ plan: string; admins: number; staff: number }>(sql`
    select t.plan,
           (select count(*) from public.memberships m
             where m.tenant_id = t.id and m.role = 'admin_tenant' and m.status = 'active'
               and m.blocked_at is null and m.deleted_at is null)::int as admins,
           (select count(*) from public.memberships m
             where m.tenant_id = t.id and m.role = 'support_tenant' and m.status = 'active'
               and m.blocked_at is null and m.deleted_at is null)::int as staff
      from public.tenants t
     where t.id = ${tenantId}::uuid`);
  if (!row || row.plan.length === 0) return null;
  return { plan: row.plan, admins: Number(row.admins), staff: Number(row.staff) };
}

/**
 * `GET /v1/dashboard/owner/overview` (08.7-01, completed by 08.7-12; D-459, D-460, D-461, D-464,
 * INSIGHT-06, INSIGHT-07, INSIGHT-16): the Visão geral of the tenant's newest snapshot, read in the
 * admin's own lane (one transaction, RLS admin-only). The module flags are read first.
 *
 * - No row → `{ state: 'preparing' }` (EP-15): never a 404, never zeros, no number key at all. The
 *   read has no side effect (it never enqueues a build); the hourly dispatcher covers it.
 * - The overview COMPOSES, it does not recompute (planning decision 1): each KPI is read from the
 *   area key that owns it, so the card and its area can never disagree — `perPost` from
 *   `payload.content.kpis` (`feed` on, as Conteúdo shows it), `attendance` from
 *   `payload.events.attendanceTotals` (`events`), `orderValue` from the paid cents of
 *   `payload.finance.totals` (`store`), `awaiting` from `payload.support.awaiting` (`chat`). A key
 *   of a module that is off is left out of the answer (D-460, UI-D-472).
 * - `preparing` while the `overview` or `members` key, or the key of any ENABLED module, is missing
 *   or fails its contract (an older payload version, INSIGHT-16): the API never compares versions.
 * - `alerts` (UI-D-489 a, d): `support_waiting` while someone waits (chat on), `event_soon` for the
 *   next nearly full upcoming event (events on), `entered_at_risk` from `overview.enteredAtRisk`,
 *   its `withPush` only while `notifications` is on. An empty list means no bell.
 * - `account`: read live (plan and the team's counts).
 */
export async function getOwnerOverview(ctx: Ctx): Promise<OwnerOverviewAnswer> {
  const flags = await overviewFlags(ctx);
  return withTenantTx(ctx, (tx) => readOverview(tx, ctx.tenantId, flags, Date.now()));
}

async function readOverview(
  tx: Tx,
  tenantId: string,
  flags: OverviewFlags,
  nowMs: number,
): Promise<OwnerOverviewAnswer> {
  const row = await readLatestSnapshot(tx, tenantId);
  if (!row) return { state: 'preparing' };
  const snapshot = snapshotMetaOf(row);
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const overview = overviewPayloadSchema.safeParse(payload.overview);
  const members = readMembersPayload(payload);
  if (!snapshot || !overview.success || !members) return { state: 'preparing' };

  // `kpis` counts feed posts only (the Conteúdo area emits it with `feed` on, D-460): a tenant with
  // stories on and the feed off gets no "interações por post" here either (WR-03). The content key
  // is still required while `stories` is on, as Conteúdo reads it.
  let perPost: OwnerOverviewReady['perPost'];
  if (flags.feed || flags.stories) {
    const content = contentPayloadSchema.safeParse(payload.content);
    if (!content.success) return { state: 'preparing' };
    if (flags.feed) {
      const { kpis } = content.data;
      perPost = {
        posts: kpis.posts.current,
        interactions: kpis.interactions.current,
        previousPosts: kpis.posts.previous,
        previousInteractions: kpis.interactions.previous,
      };
    }
  }

  let events: EventsPayload | null = null;
  if (flags.events) {
    events = readEventsPayload(payload);
    if (!events) return { state: 'preparing' };
  }

  let orderValue: OwnerOverviewReady['orderValue'];
  if (flags.store) {
    const finance = financePayloadSchema.safeParse(payload.finance);
    if (!finance.success) return { state: 'preparing' };
    orderValue = {
      current: finance.data.totals.current.cents,
      previous: finance.data.totals.previous.cents,
    };
  }

  let support: SupportPayload | null = null;
  if (flags.chat) {
    support = readSupportPayload(payload);
    if (!support) return { state: 'preparing' };
  }

  const account = await readAccount(tx, tenantId);
  if (!account) return { state: 'preparing' };

  const alerts: OwnerAlert[] = [];
  if (support && support.awaiting.count > 0) {
    alerts.push({
      kind: 'support_waiting',
      conversations: support.awaiting.count,
      oldestHours: support.awaiting.oldestHours ?? 0,
    });
  }
  if (events) {
    const soon = await eventSoonAlert(tx, tenantId, events, nowMs);
    if (soon) alerts.push(soon);
  }
  const { enteredAtRisk } = overview.data;
  if (enteredAtRisk.members > 0) {
    alerts.push({
      kind: 'entered_at_risk',
      members: enteredAtRisk.members,
      ...(flags.notifications ? { withPush: enteredAtRisk.withPush } : {}),
    });
  }

  return {
    state: 'ready',
    snapshot,
    members: overview.data.members,
    engagement: members.engagement,
    previousEngagement: members.previousEngagement,
    actions30: members.actions30,
    activeMembers30: members.activeMembers30,
    weeklyInteracting: members.weeklyInteracting,
    ...(perPost ? { perPost } : {}),
    ...(events ? { attendance: events.attendanceTotals } : {}),
    ...(orderValue ? { orderValue } : {}),
    ...(support ? { awaiting: support.awaiting } : {}),
    alerts,
    account,
  };
}
