import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { recordInviteSendOutcome } from './domains';
import {
  classifyInviteSendError,
  INVITE_SEND_QUEUE,
  type InviteSendPayload,
  inviteSendPayloadSchema,
  runScheduledInviteSend,
} from './invite-send';

/**
 * `kernel.invite-send` handler (quick 260929-g0s) — runs in the api image under `ROLE=worker`;
 * `apps/api/src/worker.ts` lists it explicitly next to `domainVerifyJob`, and the queue registers
 * itself in `invite-send.ts`.
 *
 * Unlike `kernel.domain-verify` (a never-throwing poller), this handler THROWS ON PURPOSE when the
 * failure is transient: the retry IS the fix for the Supabase Auth allow-list propagation window
 * (a send that meets GoTrue's `site_url` fallback is refused by the Send Email Hook, GoTrue reports
 * the failure, the claim reverts to `pending`, and pg-boss tries again with `INVITE_SEND_RETRY`).
 * An identity refusal is terminal (no retry — it would only repeat). Either way the tenant's verified
 * primary domain row carries the cause in `last_error` (`invite` / `invite:<reason>`), and a later
 * successful send clears it. A failed bookkeeping write is logged and never masks the real error.
 *
 * `INVITE_SEND_SYSTEM_ACTOR` is a log-only actor id, like verify-job's `SYSTEM_ACTOR`.
 */
const log = moduleLogger('kernel-jobs');

export const INVITE_SEND_SYSTEM_ACTOR = 'system:invite-send';

async function recordOutcome(tenantId: string, lastError: string | null): Promise<void> {
  try {
    await recordInviteSendOutcome(tenantId, lastError);
  } catch (error) {
    log.error(
      {
        event: 'invites.send_job.record_failed',
        tenantId,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not record the invite send outcome on the domain row',
    );
  }
}

export const inviteSendJob: JobDefinition<InviteSendPayload> = {
  name: INVITE_SEND_QUEUE,
  handler: async (payload) => {
    const parsed = inviteSendPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        { event: 'invites.send_job.bad_payload', issues: parsed.error.issues.length },
        'kernel.invite-send received a malformed payload; dropped',
      );
      return;
    }
    const { tenantId, inviteId } = parsed.data;

    try {
      const outcome = await runScheduledInviteSend(parsed.data, {
        userId: INVITE_SEND_SYSTEM_ACTOR,
      });
      log.info(
        { event: 'invites.send_job.done', tenantId, inviteId, outcome },
        'kernel.invite-send ran',
      );
      if (outcome === 'sent') await recordOutcome(tenantId, null);
    } catch (error) {
      const verdict = classifyInviteSendError(error);
      const fields = {
        event: 'invites.send_job.failed',
        tenantId,
        inviteId,
        retry: verdict.retry,
        lastError: verdict.lastError,
        err: error instanceof Error ? error.message : String(error),
      };
      if (verdict.retry) log.error(fields, 'kernel.invite-send failed; pg-boss will retry');
      else log.warn(fields, 'kernel.invite-send refused; not retried');
      await recordOutcome(tenantId, verdict.lastError);
      if (verdict.retry) throw error;
    }
  },
};
