import type { TenantRole } from '@rede-social/contracts';
import {
  MODERATION_EXCERPT_MAX,
  type ModerationSubjectType,
} from '@rede-social/contracts/moderation';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { moduleLogger } from '../logging';

const log = moduleLogger('moderation');

/**
 * THE moderation-log writer (MODER-03, D-337) — the ONE function every moderator action calls, inside
 * the transaction that performs the action.
 *
 * WHY A PUBLISHED KERNEL FUNCTION AND NOT A DOMAIN EVENT (RESEARCH Pattern 1, T-08-05). The bus
 * flushes after commit and never rethrows (`../events/bus.ts`): a log written from a subscriber could
 * be lost while the removal stands. Called with the caller's `tx`, the row commits with the action or
 * not at all — a removal without its log row is impossible, and a failed log insert rolls the removal
 * back.
 *
 * BOTH LANES. In the tenant lane (feed and story comment removals) the `moderation_log_tenant_insert`
 * policy pins `tenant_id` and `actor_user_id` to the lane's claims; in the admin lane (08-04's block,
 * 08-05's role change) the explicit `ctx` values written below are the only source, and they come
 * from `requireAuth`, never from input.
 *
 * ANCHORED, OR NOTHING. The actor's membership and (unless the caller already holds it) the target's
 * are resolved from `memberships` of `ctx.tenantId` in the SAME transaction, and a missing one THROWS
 * — so the caller's transaction rolls back and no un-anchored row can exist (the assumption-delta
 * invariant: every row's two membership ids belong to the row's own tenant).
 *
 * PRIVACY (prohibition, T-08-06). The log line carries ids only. The excerpt and the reason live in
 * `moderation_log` and are read only through permission-guarded routes; they never reach pino.
 */

/** One moderator action, discriminated by `action`. Every variant names the TARGET user. */
export type ModerationEntry =
  | {
      action: 'comment_removed';
      targetUserId: string;
      subjectType: ModerationSubjectType;
      subjectId: string;
      /** The removed comment's body, read under the row lock; cut by `moderationExcerpt`. */
      excerptSource: string;
      reason: null;
    }
  | {
      action: 'member_blocked' | 'member_unblocked';
      targetUserId: string;
      targetMembershipId: string;
      /** Optional, internal (D-331). Trimmed; an empty value is stored as null. */
      reason: string | null;
    }
  | {
      action: 'role_changed';
      targetUserId: string;
      targetMembershipId: string;
      details: { from: TenantRole; to: TenantRole };
    };

const ELLIPSIS = '…';
const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

/**
 * The snapshot of a removed comment (D-337, UI-D-278): the trimmed body when it fits
 * `MODERATION_EXCERPT_MAX` UTF-16 code units (the `withinCodeUnits` rule), otherwise cut on the last
 * whitespace inside the budget with `…` appended INSIDE the cap. A body with no whitespace in the
 * budget is hard-cut. Segmentation is by grapheme, so a surrogate pair — or an emoji ZWJ sequence —
 * is never split. Line breaks are KEPT: the log renders the excerpt `whitespace-pre-line`.
 *
 * The DB CHECK counts code points, never more than code units, so a value from here always passes it.
 */
export function moderationExcerpt(body: string): string {
  const text = body.trim();
  if (text.length <= MODERATION_EXCERPT_MAX) return text;

  // Room for the ellipsis (one code unit) inside the cap.
  const budget = MODERATION_EXCERPT_MAX - ELLIPSIS.length;
  let used = 0;
  let lastSpaceEnd = -1;
  let hardEnd = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (used + segment.length > budget) {
      // A boundary that falls exactly at the cut counts as a word boundary.
      if (/\s/.test(segment)) lastSpaceEnd = index;
      break;
    }
    used += segment.length;
    hardEnd = index + segment.length;
    if (/\s/.test(segment)) lastSpaceEnd = index;
  }
  const onWord = lastSpaceEnd > 0 ? text.slice(0, lastSpaceEnd).trimEnd() : '';
  const kept = onWord !== '' ? onWord : text.slice(0, hardEnd).trimEnd();
  return `${kept}${ELLIPSIS}`;
}

/** `select id from memberships` of THIS tenant for one user, in the caller's transaction. */
async function membershipIdOf(tx: Tx, tenantId: string, userId: string): Promise<string> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from memberships
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid
     limit 1`);
  const id = rows[0]?.id;
  if (!id) throw new Error('moderation log: no membership of this tenant for a log party');
  return id;
}

/**
 * Append ONE row for `entry`, in `tx`. Throws (rolling the caller back) when either party has no
 * membership in `ctx.tenantId` or when the insert is refused. Returns the new row's id.
 */
export async function recordModerationAction(
  tx: Tx,
  ctx: Pick<RequestContext, 'tenantId' | 'userId' | 'requestId'>,
  entry: ModerationEntry,
): Promise<string> {
  const actorMembershipId = await membershipIdOf(tx, ctx.tenantId, ctx.userId);
  const targetMembershipId =
    'targetMembershipId' in entry
      ? entry.targetMembershipId
      : await membershipIdOf(tx, ctx.tenantId, entry.targetUserId);

  const subjectType = entry.action === 'comment_removed' ? entry.subjectType : null;
  const subjectId = entry.action === 'comment_removed' ? entry.subjectId : null;
  const excerpt =
    entry.action === 'comment_removed' ? moderationExcerpt(entry.excerptSource) : null;
  const rawReason = entry.action === 'role_changed' ? null : entry.reason;
  const reason = rawReason === null ? null : rawReason.trim() === '' ? null : rawReason.trim();
  const details = entry.action === 'role_changed' ? JSON.stringify(entry.details) : null;

  const rows = await tx.execute<{ id: string }>(sql`
    insert into moderation_log (
      tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
      subject_type, subject_id, reason, excerpt, details
    ) values (
      ${ctx.tenantId}::uuid, ${entry.action}, ${ctx.userId}::uuid, ${actorMembershipId}::uuid,
      ${entry.targetUserId}::uuid, ${targetMembershipId}::uuid,
      ${subjectType}, ${subjectId}::uuid, ${reason}, ${excerpt}, ${details}::jsonb
    )
    returning id`);
  const id = rows[0]?.id;
  if (!id) throw new Error('moderation log: the insert returned no row');

  // Ids only — never the excerpt, never the reason (the MODER-03 privacy prohibition).
  log.info(
    {
      event: 'moderation.recorded',
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      action: entry.action,
      id,
    },
    'moderation action recorded',
  );
  return id;
}
