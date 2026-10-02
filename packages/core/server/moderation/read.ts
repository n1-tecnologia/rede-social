import type { TenantRole } from '@rede-social/contracts';
import type {
  ModerationAction,
  ModerationLogEntry,
  ModerationLogPage,
  ModerationLogQuery,
  ModerationSubjectType,
} from '@rede-social/contracts/moderation';
import { sql } from 'drizzle-orm';
import { withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { moduleLogger } from '../logging';
import { decodeCursor, encodeCursor, keysetComparison } from '../paging';

const log = moduleLogger('moderation');

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres (the notifications rule): the
 * cursor's `n` is this exact string compared back as `::timestamptz`, so a JS `Date` round trip would
 * truncate to milliseconds and skip or repeat a row one microsecond apart.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/** A cursor's `n` must be an instant this reader could have issued before it reaches a cast. */
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function decodeInstantCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  if (!decoded || !CURSOR_INSTANT.test(decoded.n)) return null;
  return Number.isNaN(Date.parse(decoded.n)) ? null : decoded;
}

type LogDbRow = {
  id: string;
  created_at: string;
  action: ModerationAction;
  actor_membership_id: string;
  actor_display_name: string | null;
  actor_is_viewer: boolean;
  target_membership_id: string;
  target_display_name: string | null;
  subject_type: ModerationSubjectType | null;
  excerpt: string | null;
  reason: string | null;
  details: { from: TenantRole; to: TenantRole } | null;
};

const toEntry = (row: LogDbRow): ModerationLogEntry => ({
  id: row.id,
  createdAt: row.created_at,
  action: row.action,
  actor: {
    membershipId: row.actor_membership_id,
    displayName: row.actor_display_name,
    isViewer: row.actor_is_viewer,
  },
  target: { membershipId: row.target_membership_id, displayName: row.target_display_name },
  subjectType: row.subject_type,
  excerpt: row.excerpt,
  reason: row.reason,
  details: row.details,
});

/**
 * `GET /v1/admin/moderation-log` (MODER-03, UI-D-277) — one keyset page of the tenant's log, newest
 * first, optionally narrowed to one action.
 *
 * TENANT LANE: `moderation_log_tenant_select` makes another tenant's rows invisible, and the explicit
 * `tenant_id = ctx.tenantId` is what the two `(tenant_id[, action], created_at desc, id desc)` indexes
 * match on. WHO may call this is the route's `requirePermission('moderation.manage')` — the policy is
 * isolation only (FEED-08, T-08-07).
 *
 * Names are read LIVE (UI-D-24): each membership id is LEFT-joined to its membership (still live,
 * `deleted_at is null`) and its profile, so a departed party yields `displayName: null` and the web's
 * "Membro removido" label. `isViewer` is computed HERE, in SQL, so the client never compares ids.
 *
 * A tampered or stale cursor degrades to page 1 (`decodeCursor` is total). Over-fetch by one:
 * `nextCursor` is non-null EXACTLY when another row exists. The log line carries the shape only.
 */
export async function listModerationLog(
  ctx: RequestContext,
  query: ModerationLogQuery,
): Promise<ModerationLogPage> {
  const limit = query.limit;
  const after = decodeInstantCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const action = query.action ?? null;
  const cmp = keysetComparison('desc');

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<LogDbRow>(sql`
      select l.id,
             to_char(l.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
             l.action,
             l.actor_membership_id,
             case when am.id is null then null else ap.display_name end as actor_display_name,
             (l.actor_user_id = ${ctx.userId}::uuid) as actor_is_viewer,
             l.target_membership_id,
             case when tm.id is null then null else tp.display_name end as target_display_name,
             l.subject_type,
             l.excerpt,
             l.reason,
             l.details
        from moderation_log l
        left join memberships am on am.id = l.actor_membership_id and am.deleted_at is null
        left join member_profiles ap on ap.membership_id = am.id
        left join memberships tm on tm.id = l.target_membership_id and tm.deleted_at is null
        left join member_profiles tp on tp.membership_id = tm.id
       where l.tenant_id = ${ctx.tenantId}::uuid
         and (${action}::text is null or l.action = ${action}::text)
         and (
           ${afterAt}::timestamptz is null
           or (l.created_at, l.id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by l.created_at ${sql.raw(cmp.order)}, l.id ${sql.raw(cmp.order)}
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'moderation.log.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      action,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'moderation log listed',
  );

  return { items: page.map(toEntry), nextCursor };
}
