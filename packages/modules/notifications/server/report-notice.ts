import { KERNEL_PERMISSIONS, REPORT_NOTIFICATION_KIND } from '@rede-social/contracts/moderation';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { KERNEL_ROLE_PERMISSIONS } from '@rede-social/core/server/rbac/require-role';
import { type SQL, sql } from 'drizzle-orm';

/**
 * The notice of a new report (Phase 11 plan 17, D-729, UI-D-876): whoever holds `moderation.manage` gets ONE bell row
 * and ONE push per report titled "Nova denúncia". Declared in THIS module's manifest, not in a producer's, as a
 * recorded exception to MOD-02: the event is the kernel's (`report.created`, ids only) and the audience is the
 * moderators, not the readers of a module's own content, so no producer module owns it.
 *
 * `resolve` runs in the WORKER, inside the tenant lane of the payload's tenant. `payload.tenantId` is DATA, not
 * authority: RLS pins every read to the lane's tenant and the statement repeats the tenant itself.
 *
 * WHO. The roles are DERIVED from `KERNEL_ROLE_PERMISSIONS` (those that include `moderation.manage`), never typed
 * here; the SQL definer of the resolve and the select policy of `content_reports` keep the literal `admin_tenant`,
 * and `apps/api/tests/unit/report-audience-drift.test.ts` fails the moment the two disagree. The live predicate is
 * the memberships' own (active, not blocked, not removed). The reporter and the reported author are excluded
 * even when they hold the permission (D-729: the reported member is never told; the reporter already knows), and when
 * nobody is left the answer is `[]`, never an intent with an empty audience.
 *
 * WHAT. Nothing. The facts are empty, the subject is the report id, there is no actor and the push is a fixed title,
 * a fixed body and the queue's path: no subject type, no excerpt, no reporter, no reported member, no reason. A tag per
 * report (the 32 hex of the id, RFC 8030's `Topic` limit) makes two reports two banners, and the dedupe key makes a
 * redelivered event one row per moderator. `notifications` off means no row and no push (the sink enqueues nothing).
 */

/** The literal push title (D-729, UI-D-876), cut and rendered by the push adapter through `titleText`. */
export const REPORT_PUSH_TITLE = 'Nova denúncia';
/** The fixed push body: it says where to look, never what was reported. */
export const REPORT_PUSH_BODY = 'Toque para ver a fila de denúncias.';
/** A tap opens the administrator's queue, never the reported item. */
export const REPORT_PUSH_URL = '/configuracoes/denuncias';
/** 72 hours: a report is still worth showing to a phone that was off for a weekend. */
export const REPORT_PUSH_TTL_SECONDS = 259_200;

/** The report's 32-hex `tag` and `topic`: its uuid without hyphens. */
export const reportTag = (reportId: string): string => reportId.replaceAll('-', '').toLowerCase();

/**
 * The roles that hold `moderation.manage` in `permissions` (the kernel's map by default). A parameter so the unit
 * test can prove the derivation on a copy, never by editing the real map.
 */
export function moderatorRoles(
  permissions: Record<string, readonly string[]> = KERNEL_ROLE_PERMISSIONS,
): string[] {
  return Object.entries(permissions)
    .filter(([, granted]) => granted.includes(KERNEL_PERMISSIONS.moderationManage))
    .map(([role]) => role);
}

type ReportCreatedPayload = {
  tenantId: string;
  reportId: string;
  reporterUserId: string;
  authorUserId: string;
};

async function resolveReportCreated(
  tx: Tx,
  payload: ReportCreatedPayload,
): Promise<NotificationIntent[]> {
  const roles = moderatorRoles();
  if (roles.length === 0) return [];

  const roleList: SQL = sql.join(
    roles.map((role) => sql`${role}`),
    sql`, `,
  );
  const rows = await tx.execute<{ user_id: string }>(sql`
    select m.user_id::text as user_id
      from memberships m
     where m.tenant_id = ${payload.tenantId}::uuid
       and m.role::text in (${roleList})
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null`);

  const excluded = new Set([payload.reporterUserId, payload.authorUserId]);
  const userIds = [...new Set(rows.map((row) => row.user_id))].filter((id) => !excluded.has(id));
  if (userIds.length === 0) return [];

  const tag = reportTag(payload.reportId);
  return [
    {
      kind: REPORT_NOTIFICATION_KIND,
      audience: { type: 'users', userIds },
      excludeUserIds: [payload.reporterUserId, payload.authorUserId],
      dedupeKey: `${REPORT_NOTIFICATION_KIND}:${payload.reportId}`,
      subject: { type: 'report', id: payload.reportId },
      object: null,
      actorUserId: null,
      facts: {},
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        titleText: REPORT_PUSH_TITLE,
        body: REPORT_PUSH_BODY,
        url: REPORT_PUSH_URL,
        tag,
        topic: tag,
        ttlSeconds: REPORT_PUSH_TTL_SECONDS,
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

export const reportCreatedNotificationSource: NotificationSource<'report.created'> = {
  event: 'report.created',
  resolve: (tx, payload) => resolveReportCreated(tx, payload),
};

/** The manifest's `notificationSources` (`module.ts`). */
export const reportNotificationSources = [reportCreatedNotificationSource] as NotificationSource[];
