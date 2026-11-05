import type { TenantRole } from '@rede-social/contracts';
import {
  REPORT_RESOLVE_ACTIONS,
  type ReportCreateBody,
  type ReportItem,
  type ReportListAnswer,
  type ReportListQuery,
  type ReportReason,
  type ReportResolution,
  type ReportResolveAction,
  type ReportResolveAnswer,
  type ReportStatus,
  type ReportSubjectType,
} from '@rede-social/contracts/moderation';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { emit } from '../events/bus';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { decodeCursor, encodeCursor, keysetComparison } from '../paging';
import { changeAccessInTx } from '../tenancy/member-admin';
import { sqlstateOf } from './sqlstate';

const log = moduleLogger('reports');

/**
 * Reports of posts and comments, the API half (Phase 13, plan 14, D-616; NATIVE-31; T-13-32, T-13-33, T-13-34).
 * The RULES are SQL (plan 08: `app.content_report_create`, `app.content_report_resolve`); this file calls them in
 * the caller's tenant transaction, maps their SQLSTATEs to the stable API errors, lists the admin's queue and
 * orchestrates a resolution so the removal or the block and the report's new state commit together.
 *
 * NOTHING HERE REMOVES OR BLOCKS BY ITSELF (T-13-33). A report only records what a member saw. Only `resolveReport`
 * (an admin holding `moderation.manage`, checked by the route AND by the SQL definer) removes content or blocks a
 * person, and it does so through the shipped paths: the removal function the moderation routes call, and the
 * admin block of Phase 8, each writing its own log row through `recordModerationAction` in the resolution's
 * transaction. This file never writes the log itself.
 *
 * NOBODY IS TOLD (T-13-32). No notification is created for the author, no event names a report, and no answer a
 * member can read carries the reporter's identity: `createReport` answers the new id and nothing else. The
 * reporter's name appears only in the admin queue.
 */

const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function decodeInstantCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  if (!decoded || !CURSOR_INSTANT.test(decoded.n)) return null;
  return Number.isNaN(Date.parse(decoded.n)) ? null : decoded;
}

/* ── create ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `POST /v1/reports`. One tenant transaction, one SQL definer. The caller, the tenant and the author come from the
 * claims and the subject row, never from the body.
 *
 * SQLSTATE to API error: `RP001` (own content) 403 `CANNOT_REPORT_OWN`; `RP002` (missing, deleted or another
 * tenant's subject) 404 `NOT_FOUND`, the same body for all three, so the route is no existence oracle; `23505`
 * (this reporter already reported this item) 409 `ALREADY_REPORTED`; `22023` (an unknown subject type, which the
 * schema already refuses) 400 `VALIDATION_FAILED`; `42501` (a caller who is not a live member) 403 `FORBIDDEN`.
 * A note over 500 characters would hit the table CHECK (23514); the body schema refuses it first.
 */
export async function createReport(
  ctx: RequestContext,
  input: ReportCreateBody,
): Promise<{ id: string }> {
  try {
    const rows = await withTenantTx(ctx, (tx) =>
      tx.execute<{ id: string }>(sql`
        select app.content_report_create(
          ${input.subjectType}::text, ${input.subjectId}::uuid, ${input.reason}::text, ${input.note ?? null}::text
        ) as id`),
    );
    const id = rows[0]?.id;
    if (!id) throw new ApiError(500, 'INTERNAL');
    // Ids and the closed vocabulary only: never the note, never the excerpt.
    log.info(
      {
        event: 'report.created',
        tenantId: ctx.tenantId,
        requestId: ctx.requestId,
        reportId: id,
        subjectType: input.subjectType,
        reason: input.reason,
      },
      'report filed',
    );
    return { id };
  } catch (error) {
    throw mapReportError(error);
  }
}

/** One mapping for every SQLSTATE the report and block definers raise. */
export function mapReportError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  switch (sqlstateOf(error)) {
    case 'RP001':
      return new ApiError(403, 'CANNOT_REPORT_OWN');
    case 'RP002':
      return new ApiError(404, 'NOT_FOUND');
    case 'RP004':
      return new ApiError(409, 'REPORT_ALREADY_RESOLVED');
    case '23505':
      return new ApiError(409, 'ALREADY_REPORTED');
    case 'BL001':
      return new ApiError(400, 'CANNOT_BLOCK');
    case '22023':
      return new ApiError(400, 'VALIDATION_FAILED');
    case '42501':
      return new ApiError(403, 'FORBIDDEN');
    default:
      return error;
  }
}

/* ── list ─────────────────────────────────────────────────────────────────────────────────────────── */

type ReportRow = {
  id: string;
  created_at: string;
  subject_type: ReportSubjectType;
  subject_id: string;
  reason: ReportReason;
  note: string | null;
  excerpt: string;
  status: ReportStatus;
  resolved_at: string | null;
  content_available: boolean;
  reporter_name: string | null;
  reporter_avatar: string | null;
  author_name: string | null;
  author_avatar: string | null;
  author_is_member: boolean;
};

const toItem = (row: ReportRow): ReportItem => ({
  id: row.id,
  createdAt: row.created_at,
  subjectType: row.subject_type,
  subjectId: row.subject_id,
  reason: row.reason,
  note: row.note,
  excerpt: row.excerpt,
  status: row.status,
  resolvedAt: row.resolved_at,
  contentAvailable: row.content_available,
  reporter: { displayName: row.reporter_name, avatarAssetId: row.reporter_avatar },
  author: {
    displayName: row.author_name,
    avatarAssetId: row.author_avatar,
    isMember: row.author_is_member,
  },
});

/**
 * `GET /v1/admin/reports` — one keyset page of the tenant's reports, newest first, `(created_at desc, id desc)`
 * (the index `content_reports_tenant_status_created_idx` carries both). The caller is an admin: the route guards the
 * permission and the select policy admits the tenant's reports to `admin_tenant` only.
 *
 * `estado` is a closed list: `abertas` is `status = 'open'` (served by the status-first index), `resolvidas` is
 * every other state, `todas` is no filter. Over-fetch by one, so `nextCursor` is non-null EXACTLY when another row
 * exists; the cursor's `n` is the microsecond text Postgres produced, compared back as `timestamptz`, so a page
 * boundary that falls inside a tie of identical `created_at` neither repeats nor skips a row (`id` breaks the tie).
 * A tampered cursor degrades to page 1.
 *
 * Names are read LIVE and a departed member reads `null` (the web's "Membro removido"). `content_available` is the
 * live predicate of the subject (`deleted_at is null`) read through the caller's lane, so an item the lane cannot
 * see or that was removed reads false. The log line carries the shape only.
 */
export async function listReports(
  ctx: RequestContext,
  query: ReportListQuery,
): Promise<ReportListAnswer> {
  const limit = query.limit;
  const after = decodeInstantCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const cmp = keysetComparison('desc');
  const filter =
    query.estado === 'abertas'
      ? sql`and r.status = 'open'`
      : query.estado === 'resolvidas'
        ? sql`and r.status <> 'open'`
        : sql``;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<ReportRow>(sql`
      select r.id,
             to_char(r.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
             r.subject_type,
             r.subject_id,
             r.reason,
             r.note,
             r.excerpt,
             r.status,
             to_char(r.resolved_at at time zone 'utc', ${ISO_MICROSECONDS}) as resolved_at,
             (case r.subject_type
                when 'feed_post' then exists (
                  select 1 from feed_posts p where p.id = r.subject_id and p.deleted_at is null)
                else exists (
                  select 1 from feed_comments c where c.id = r.subject_id and c.deleted_at is null)
              end) as content_available,
             case when rm.id is null then null else rp.display_name end as reporter_name,
             case when rm.id is null then null else rp.avatar_asset_id end as reporter_avatar,
             case when am.id is null then null else ap.display_name end as author_name,
             case when am.id is null then null else ap.avatar_asset_id end as author_avatar,
             coalesce(am.role = 'member', false) as author_is_member
        from content_reports r
        left join memberships rm
               on rm.tenant_id = r.tenant_id and rm.user_id = r.reporter_user_id and rm.deleted_at is null
        left join member_profiles rp on rp.membership_id = rm.id
        left join memberships am
               on am.tenant_id = r.tenant_id and am.user_id = r.author_user_id and am.deleted_at is null
        left join member_profiles ap on ap.membership_id = am.id
       where r.tenant_id = ${ctx.tenantId}::uuid
         ${filter}
         and (
           ${afterAt}::timestamptz is null
           or (r.created_at, r.id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by r.created_at ${sql.raw(cmp.order)}, r.id ${sql.raw(cmp.order)}
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'report.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      estado: query.estado,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'reports listed',
  );
  return { items: page.map(toItem), nextCursor };
}

/* ── resolve ──────────────────────────────────────────────────────────────────────────────────────── */

/** The verbs of the API to the states of the table. */
const STATUS_OF: Record<ReportResolveAction, ReportResolution> = {
  dismiss: 'dismissed',
  remove_content: 'content_removed',
  block_author: 'author_blocked',
};

/** What the module that owns the content hands the kernel (the kernel never imports a module, MOD-02). */
export type ReportContentRemover = (
  tx: Tx,
  ctx: RequestContext,
  subject: { type: ReportSubjectType; id: string },
) => Promise<{ outcome: 'removed' | 'already_gone' | 'not_removable'; afterCommit: () => void }>;

export type ReportResolveDeps = { removeContent: ReportContentRemover };

type Resolved = { subject_type: ReportSubjectType; subject_id: string; author_user_id: string };

/** `app.content_report_resolve` in the caller's tenant claims; maps `RP002` (a missing report) and `RP004`. */
async function recordResolution(
  tx: Tx,
  reportId: string,
  status: ReportResolution,
): Promise<Resolved> {
  const rows = await tx.execute<Resolved>(
    sql`select * from app.content_report_resolve(${reportId}::uuid, ${status}::text)`,
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return row;
}

/**
 * `POST /v1/admin/reports/{id}/resolve` — the admin's decision, in ONE transaction (T-13-33):
 *
 * - `dismiss`: the report becomes `dismissed`; nothing else changes.
 * - `remove_content`: the report becomes `content_removed` and the post or comment is taken down by the removal
 *   function of the module that owns it (`deps.removeContent`: the SAME one the moderation routes call, with its
 *   `post_removed` / `comment_removed` log row written in this transaction). An item already removed by someone
 *   else is not removed twice and writes no second row; an item the moderation path may not take (an organization
 *   post of another administrator) refuses the whole resolution with 409 and the report stays open.
 * - `block_author`: the report becomes `author_blocked` and the author's membership is blocked through the admin
 *   block of Phase 8 (`changeAccessInTx`: the lock on the admin set, `member_blocked` log row, the live predicate
 *   that cuts the session). Only a `member` author can be blocked (AD-1); a staff, departed or invited author is a
 *   409 `CONFLICT` with `details.report`. The optional `reason` is the internal reason of that block (D-331).
 *
 * A block writes `memberships`, which the tenant lane refuses by design, so this branch opens the ADMIN lane for
 * the tenant of record and runs the SQL definer under the caller's own claims (`asTenantLane`), exactly the role
 * the definer's checks expect, then returns to the admin lane for the block. Everything is one transaction, so a
 * block without the report's new state, or the reverse, cannot be committed.
 *
 * `RP004` (another admin resolved it first) is 409 `REPORT_ALREADY_RESOLVED`; the report row is locked
 * `for update` by the definer, so two admins at once leave exactly one winner and one log row. The events and log
 * lines of the removal or block run after the commit.
 */
export async function resolveReport(
  ctx: RequestContext,
  reportId: string,
  input: { resolution: ReportResolveAction; reason?: string | undefined },
  deps: ReportResolveDeps,
): Promise<ReportResolveAnswer> {
  if (!REPORT_RESOLVE_ACTIONS.includes(input.resolution))
    throw new ApiError(400, 'VALIDATION_FAILED');
  const status = STATUS_OF[input.resolution];
  let afterCommit: () => void = () => undefined;

  try {
    if (input.resolution === 'block_author') {
      const blocked = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
        const subject = await asTenantLane(tx, ctx, () => recordResolution(tx, reportId, status));
        const author = await tx.execute<{ id: string; role: TenantRole }>(sql`
          select id, role from memberships
           where tenant_id = ${ctx.tenantId}::uuid
             and user_id = ${subject.author_user_id}::uuid
             and deleted_at is null
           limit 1`);
        const target = author[0];
        if (!target) throw new ApiError(409, 'CONFLICT', { report: 'author_unavailable' });
        if (target.role !== 'member') {
          throw new ApiError(409, 'CONFLICT', { report: 'author_not_member' });
        }
        const result = await changeAccessInTx(tx, ctx, target.id, 'block', input.reason);
        return { changed: result.changed, userId: result.userId, membershipId: target.id };
      });
      afterCommit = () => {
        if (blocked.changed) {
          emit(ctx, 'membership.blocked', {
            tenantId: ctx.tenantId,
            userId: blocked.userId,
            membershipId: blocked.membershipId,
          });
        }
      };
    } else {
      const done = await withTenantTx(ctx, async (tx) => {
        const subject = await recordResolution(tx, reportId, status);
        if (input.resolution !== 'remove_content') return () => undefined;
        const removal = await deps.removeContent(tx, ctx, {
          type: subject.subject_type,
          id: subject.subject_id,
        });
        if (removal.outcome === 'not_removable') {
          throw new ApiError(409, 'CONFLICT', { report: 'not_removable' });
        }
        return removal.afterCommit;
      });
      afterCommit = done;
    }
  } catch (error) {
    throw mapReportError(error);
  }

  afterCommit();
  // Ids and the closed vocabulary only: never the reason, never the excerpt.
  log.info(
    {
      event: 'report.resolved',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      reportId,
      resolution: input.resolution,
    },
    'report resolved',
  );
  return { id: reportId, status };
}

/**
 * Runs `fn` as the tenant lane for `ctx` INSIDE an admin-lane transaction: the claims the SQL definers read
 * (`app.tenant_id()`, `app.user_id()`, `app.tenant_role()`) are set for the transaction, the role is switched to
 * `authenticated` for the call, and the admin lane's role is restored afterwards. Both settings die with the
 * transaction (`is_local`), so nothing leaks to the next request on the pooled connection.
 */
async function asTenantLane<T>(tx: Tx, ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({
    sub: ctx.userId,
    role: 'authenticated',
    tenant_id: ctx.tenantId,
    tenant_role: ctx.role,
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role authenticated`);
  const result = await fn();
  await tx.execute(sql`set local role service_role`);
  return result;
}
