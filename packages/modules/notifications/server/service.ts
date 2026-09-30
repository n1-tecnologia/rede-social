import { REALTIME_EVENTS, topicSuffix } from '@rede-social/contracts/realtime';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { decodeCursor, encodeCursor, keysetComparison } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import type { NotificationPage, NotificationQuery, NotificationRow } from '../contracts/index';

const log = moduleLogger('module-notifications');

/**
 * The notifications service (NOTIF-02): the member's own list and the bell's count. A PURE
 * TENANT-LANE area: every read is `withTenantTx(ctx, …)` (or the caller's `tx`), the tenant and the
 * user are never parameters a caller supplies, and `notifications_owner_select` makes every other
 * member's rows invisible rather than refused. The explicit `tenant_id` / `user_id` predicates below
 * are what the partial indexes match on; the policy is what actually isolates.
 *
 * Logs carry the SHAPE of a call (section, counts), never a fact or a name.
 */

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres (the `listEvents` rule): the
 * cursor's `n` is this exact string and is compared back as `::timestamptz`, so a JS `Date` round
 * trip would truncate to milliseconds and skip or repeat a row one microsecond apart.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * A cursor's `n` must be an instant this service could have issued before it reaches a
 * `::timestamptz` cast (T-06-04): a tampered `n` degrades to page 1, never a 500.
 */
const CURSOR_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;

function isCursorInstant(value: string): boolean {
  const match = CURSOR_INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1000) return false;
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second
  );
}

function decodeInstantCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  return decoded && isCursorInstant(decoded.n) ? decoded : null;
}

/** One hydrated row of the list projection, snake_case straight off `tx.execute`. */
type NotificationDbRow = {
  id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  object_type: string | null;
  object_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  seen_at: string | null;
  read_at: string | null;
  actor_user_id: string | null;
  actor_removed: boolean;
  actor_display_name: string | null;
  actor_avatar_asset_id: string | null;
  preview_asset_id: string | null;
  preview_variant_widths: number[] | null;
  removed: boolean;
};

/**
 * THE projection, shared by both sections. The actor is read LIVE (CONTEXT: text is never stored):
 * a LEFT join of the actor's membership IN THE SAME TENANT (`ms.deleted_at is null`, the
 * `membershipOfRecord` lifecycle rule) and its profile, so a departed actor yields `actor_removed`
 * and nulls in one step (the feed comment rule, UI-D-24). The avatar id is nulled when the asset is
 * gone (`media_assets_tenant_select` hides a retired one), so the web never draws a broken avatar.
 */
const notificationSource = sql`
    select n.id,
           n.kind,
           n.subject_type,
           n.subject_id,
           n.object_type,
           n.object_id,
           n.payload,
           to_char(n.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
           to_char(n.seen_at at time zone 'utc', ${ISO_MICROSECONDS}) as seen_at,
           to_char(n.read_at at time zone 'utc', ${ISO_MICROSECONDS}) as read_at,
           n.actor_user_id,
           (n.actor_user_id is not null and ms.id is null) as actor_removed,
           mp.display_name as actor_display_name,
           case when a.id is null then null else mp.avatar_asset_id end as actor_avatar_asset_id,
           pa.id as preview_asset_id,
           pa.variant_widths as preview_variant_widths,
           coalesce(n.payload->>'removed', 'false') = 'true' as removed
      from notifications n
      left join memberships ms
             on ms.tenant_id = n.tenant_id
            and ms.user_id = n.actor_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
      left join media_assets a on a.id = mp.avatar_asset_id
      -- The preview id is a FACT (jsonb text): shape-checked INSIDE a case before the cast (AND
      -- order is not guaranteed), so a malformed fact degrades to no preview instead of a 500.
      -- media_assets_tenant_select hides a retired asset.
      left join media_assets pa
             on pa.id = case
                          when n.payload->>'previewAssetId'
                               ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then (n.payload->>'previewAssetId')::uuid
                        end`;

/** Fact values are scalars; anything else a future producer stored is dropped, never forwarded. */
function toFacts(payload: Record<string, unknown> | null): NotificationRow['facts'] {
  const facts: NotificationRow['facts'] = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      facts[key] = value;
    }
  }
  return facts;
}

const toRow = (row: NotificationDbRow): NotificationRow => ({
  id: row.id,
  kind: row.kind,
  subject: { type: row.subject_type, id: row.subject_id },
  object:
    row.object_type !== null && row.object_id !== null
      ? { type: row.object_type, id: row.object_id }
      : null,
  actor:
    row.actor_user_id === null
      ? null
      : {
          removed: row.actor_removed,
          displayName: row.actor_removed ? null : row.actor_display_name,
          avatarAssetId: row.actor_removed ? null : row.actor_avatar_asset_id,
        },
  facts: toFacts(row.payload),
  preview:
    !row.removed && row.preview_asset_id !== null && (row.preview_variant_widths ?? []).length > 0
      ? { assetId: row.preview_asset_id, variantWidths: row.preview_variant_widths ?? [] }
      : null,
  removed: row.removed,
  createdAt: row.created_at,
  seenAt: row.seen_at,
  readAt: row.read_at,
});

/**
 * `GET /v1/notifications?section=&cursor=&limit=` (NOTIF-02, D-231).
 *
 * **Two branches, two COMPLETE literal statements** (planning decision 9). `query.section` picks one
 * in TypeScript and is never a bound SQL parameter, so each predicate is fixed text the planner (and
 * `151-notifications.sql`'s EXPLAIN, which copies these predicates verbatim) matches to its partial
 * index by name:
 *  - `unread`: `read_at is null`, over `notifications_unread_list_idx`;
 *  - `read`: `read_at is not null`, over `notifications_read_list_idx`.
 * Both order `created_at desc, id desc`, and ties on the instant (every row of one fan-out shares
 * one `created_at`) are broken by `id`. Over-fetch by one: `nextCursor` is non-null EXACTLY when
 * another row exists.
 */
export async function listNotifications(
  ctx: RequestContext,
  query: NotificationQuery,
): Promise<NotificationPage> {
  const limit = query.limit;
  const after = decodeInstantCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const cmp = keysetComparison('desc');

  const rows = await withTenantTx(ctx, (tx) => {
    if (query.section === 'unread') {
      return tx.execute<NotificationDbRow>(sql`
      ${notificationSource}
       where n.tenant_id = ${ctx.tenantId}::uuid
         and n.user_id = ${ctx.userId}::uuid
         and n.read_at is null
         and (
           ${afterAt}::timestamptz is null
           or (n.created_at, n.id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by n.created_at desc, n.id desc
       limit ${limit + 1}`);
    }
    return tx.execute<NotificationDbRow>(sql`
      ${notificationSource}
       where n.tenant_id = ${ctx.tenantId}::uuid
         and n.user_id = ${ctx.userId}::uuid
         and n.read_at is not null
         and (
           ${afterAt}::timestamptz is null
           or (n.created_at, n.id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by n.created_at desc, n.id desc
       limit ${limit + 1}`);
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'notifications.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      section: query.section,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'notifications listed',
  );

  return { items: page.map(toRow), nextCursor };
}

/**
 * The bell's count (D-230): the caller's rows not yet SEEN, over `notifications_unseen_idx`. Runs in
 * the caller's transaction (the bootstrap's `withTenantTx`), so the count and the rest of the
 * bootstrap are one snapshot. `count(*)::int`: a bare count is a bigint the driver hands back as a
 * string.
 */
export async function countUnseen(tx: Tx, ctx: RequestContext): Promise<number> {
  const rows = await tx.execute<{ unseen: number }>(sql`
    select count(*)::int as unseen
      from notifications n
     where n.tenant_id = ${ctx.tenantId}::uuid
       and n.user_id = ${ctx.userId}::uuid
       and n.seen_at is null`);
  return Number(rows[0]?.unseen ?? 0);
}

/**
 * The caller's OTHER tabs and devices refetch (07-03 consumes it): one ids-only signal on the
 * caller's own user topic, published by the definer inside the same transaction as the write, so a
 * rolled-back write announces nothing. The payload is `{ kind }` with a fixed marker, never a row.
 */
async function signalOwnTopic(tx: Tx, ctx: RequestContext, kind: 'seen' | 'read'): Promise<void> {
  await tx.execute(
    sql`select app.realtime_signal(${topicSuffix.user(ctx.userId)}, ${REALTIME_EVENTS.notificationsChanged}, ${JSON.stringify({ kind })}::jsonb)`,
  );
}

/**
 * `POST /v1/notifications/seen` (D-230): stamps `seen_at` on every row the caller has not SEEN yet,
 * leaving `read_at` untouched (seen and read never merge), which zeroes the bell. Signals the
 * caller's own topic only when something changed; nothing to change is a silent no-op.
 */
export async function markAllSeen(ctx: RequestContext): Promise<number> {
  const changed = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ changed: number }>(sql`
      with u as (
        update notifications
           set seen_at = now()
         where tenant_id = ${ctx.tenantId}::uuid
           and user_id = ${ctx.userId}::uuid
           and seen_at is null
        returning 1
      )
      select count(*)::int as changed from u`);
    const count = Number(rows[0]?.changed ?? 0);
    if (count > 0) await signalOwnTopic(tx, ctx, 'seen');
    return count;
  });
  log.info(
    { event: 'notifications.seen', tenantId: ctx.tenantId, userId: ctx.userId, changed },
    'notifications seen',
  );
  return changed;
}

/**
 * `POST /v1/notifications/{id}/read` (D-230, D-232): the tapped row becomes read, and seen too when it
 * was not (a read row is always seen). ONE bare 404 when no row of the caller's matched: an unknown
 * id, another tenant's, or a colleague's are indistinguishable (D-23). Re-reading a read row keeps its
 * first `read_at` and answers 204. Signals only on a real change.
 */
export async function markRead(ctx: RequestContext, notificationId: string): Promise<void> {
  const outcome = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ matched: number; changed: number }>(sql`
      with prev as (
        select n.id, (n.read_at is null or n.seen_at is null) as changing
          from notifications n
         where n.tenant_id = ${ctx.tenantId}::uuid
           and n.user_id = ${ctx.userId}::uuid
           and n.id = ${notificationId}::uuid
      ),
      u as (
        update notifications n
           set read_at = coalesce(n.read_at, now()),
               seen_at = coalesce(n.seen_at, now())
          from prev
         where n.id = prev.id
        returning 1
      )
      select (select count(*)::int from u) as matched,
             (select count(*)::int from prev where changing) as changed`);
    const matched = Number(rows[0]?.matched ?? 0);
    const changed = Number(rows[0]?.changed ?? 0);
    if (changed > 0) await signalOwnTopic(tx, ctx, 'read');
    return { matched, changed };
  });
  log.info(
    { event: 'notifications.read', tenantId: ctx.tenantId, userId: ctx.userId, ...outcome },
    'notification read',
  );
  if (outcome.matched === 0) throw new ApiError(404, 'NOT_FOUND');
}

/**
 * `POST /v1/notifications/read-all` (D-230, UI-D-252): every unread row of the caller becomes read
 * (and seen when it was not). Nothing to change answers 204 and publishes nothing.
 */
export async function markAllRead(ctx: RequestContext): Promise<number> {
  const changed = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ changed: number }>(sql`
      with u as (
        update notifications
           set read_at = now(),
               seen_at = coalesce(seen_at, now())
         where tenant_id = ${ctx.tenantId}::uuid
           and user_id = ${ctx.userId}::uuid
           and read_at is null
        returning 1
      )
      select count(*)::int as changed from u`);
    const count = Number(rows[0]?.changed ?? 0);
    if (count > 0) await signalOwnTopic(tx, ctx, 'read');
    return count;
  });
  log.info(
    { event: 'notifications.read_all', tenantId: ctx.tenantId, userId: ctx.userId, changed },
    'notifications read',
  );
  return changed;
}
