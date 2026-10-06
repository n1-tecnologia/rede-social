import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenantInvites } from '../../db/schema';
import { authAllowList } from '../domains/index';
import { ApiError } from '../http/api-error';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { logFor, type PlatformActor, sendPendingInvites } from './invites';

/**
 * `kernel.invite-send` — the DEFERRED first-admin invite (quick 260929-g0s).
 *
 * Why this exists (production, 2026-09-29, AUTH_ALLOW_LIST=supabase): the verified transition
 * PATCHed the Supabase Auth `uri_allow_list` and called `sendPendingInvites` ~5 s later. GoTrue had
 * not applied the new entry yet, dropped the invite's `redirect_to` and fell back to `site_url` (the
 * platform host), so the admin received a pathless link on the wrong origin. The verify path now only
 * SCHEDULES one job per pending invite; the job waits out the propagation window and retries, and
 * sends through the ONE sender (`sendPendingInvites`, claim-before-send — D-30), so a re-run, a
 * duplicate job or a racing manual resend can never mail twice. The manual "Enviar/Reenviar convite"
 * (`resendInvite`) stays immediate.
 */

/** Kernel-owned queue name; the worker lists `inviteSendJob` explicitly next to `domainVerifyJob`. */
export const INVITE_SEND_QUEUE = 'kernel.invite-send';

// Registered at import, the `domains/index.ts` contract for `kernel.domain-verify`: `domains.ts`
// imports this file at module top, so the API's lazy `startedBoss()` creates the queue before the
// first `send` from a "Verificar agora"; the worker creates it from its explicit job list.
registerJobQueues([INVITE_SEND_QUEUE]);

/**
 * Seconds between the allow-list PATCH and the first send attempt: the Supabase Auth config
 * propagation window after a Management API write (production 2026-09-29: GoTrue still rejected the
 * redirect 5 s after the PATCH and accepted it minutes later — the retries below cover the tail).
 * It is also ≥ the 60 s host cache TTL of `tenancy/tenant-host.ts`, so every API instance resolves
 * the freshly verified host by the time the admin clicks.
 */
export const INVITE_SEND_DELAY_S = 60;

/**
 * pg-boss retry options for the job: 5 retries, 30 s doubling, capped at 600 s — roughly fifteen
 * minutes of attempts in total. Bounded on purpose: a permanently failing send (hook down, GoTrue
 * rate limit) must not storm GoTrue's e-mail budget (T-g0s-05). After the last retry the invite is
 * still `pending` and the Admins tab offers "Enviar convite".
 */
export const INVITE_SEND_RETRY = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 600,
} as const;

/**
 * The local allow-list adapter writes nothing (local GoTrue reads `supabase/config.toml`), so there
 * is nothing to wait for: 0 lets the integration suite and the e2e run the job immediately. Only the
 * real Management API adapter pays the propagation window.
 */
export function inviteSendDelaySeconds(adapter: 'local' | 'supabase'): number {
  return adapter === 'supabase' ? INVITE_SEND_DELAY_S : 0;
}

/**
 * `singletonKey = inviteId` + the `short` queue policy: at most ONE waiting job per invite, so two
 * verifies (the poller racing "Verificar agora", a promotion right after a verify) schedule once.
 */
export function inviteSendJobOptions(inviteId: string, delayS: number) {
  return { singletonKey: inviteId, startAfter: delayS, ...INVITE_SEND_RETRY };
}

/**
 * Ids only — the address is re-read from `tenant_invites` by the sender. Job rows are readable by the
 * worker and retained for days, so the e-mail never enters the payload (T-g0s-03).
 */
export const inviteSendPayloadSchema = z.object({ tenantId: z.uuid(), inviteId: z.uuid() });
export type InviteSendPayload = z.infer<typeof inviteSendPayloadSchema>;

/**
 * Retry or give up. A state refusal (`email_in_use` — the address is a platform account, D-316 —
 * or `already_accepted` / `not_invited` for an existing identity's membership here, D-314) is a fact
 * about the address, not a transient failure — retrying would only repeat it, so it is terminal and
 * recorded with its cause (`invite:<reason>`, the Domínios card names it). Everything else — the
 * 500 `INTERNAL` of a GoTrue or Send Email Hook failure (including the hook's
 * `redirect_host_not_tenant` refusal of a site_url fallback), a database error — is retried.
 */
export function classifyInviteSendError(error: unknown): { retry: boolean; lastError: string } {
  if (
    error instanceof ApiError &&
    error.code === 'INVITE_STATE_INVALID' &&
    typeof error.details?.reason === 'string'
  ) {
    return { retry: false, lastError: `invite:${error.details.reason}` };
  }
  return { retry: true, lastError: 'invite' };
}

export type ScheduleInviteSendsResult = { scheduled: number; reason?: 'no_verified_primary' };

/**
 * Enqueues one `kernel.invite-send` job per `pending` invite of the tenant, in ONE admin transaction
 * (the same verified-primary predicate as `sendPendingInvites`: without a verified primary there is
 * no origin for the link, so nothing is scheduled and the documented `invite.deferred` line is
 * logged). A `null` job id is the `short` policy dropping a duplicate of a job still waiting — not
 * counted. `opts.delayS` overrides the adapter default (tests prove the delay reaches pg-boss).
 */
export async function scheduleInviteSends(
  tenantId: string,
  actor: PlatformActor,
  opts?: { delayS?: number },
): Promise<ScheduleInviteSendsResult> {
  const log = logFor(actor, 'platform.invites');
  const delayS = opts?.delayS ?? inviteSendDelaySeconds(authAllowList.name);

  const result = await withAdminTx(async (tx) => {
    const hosts = await tx
      .select({ id: tenantDomains.id })
      .from(tenantDomains)
      .where(
        and(
          eq(tenantDomains.tenantId, tenantId),
          eq(tenantDomains.isPrimary, true),
          isNotNull(tenantDomains.verifiedAt),
        ),
      )
      .limit(1);
    if (!hosts[0]) return null;
    const pending = await tx
      .select({ id: tenantInvites.id })
      .from(tenantInvites)
      .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending')))
      .orderBy(asc(tenantInvites.createdAt));
    let scheduled = 0;
    for (const invite of pending) {
      const jobId = await enqueueInTx(
        tx,
        INVITE_SEND_QUEUE,
        { tenantId, inviteId: invite.id } satisfies InviteSendPayload,
        inviteSendJobOptions(invite.id, delayS),
      );
      if (jobId !== null) scheduled += 1;
    }
    return { inviteIds: pending.map((invite) => invite.id), scheduled };
  });

  if (!result) {
    log.info(
      { event: 'invite.deferred', userId: actor.userId, tenantId },
      'no verified primary host yet; invites stay pending',
    );
    return { scheduled: 0, reason: 'no_verified_primary' };
  }
  log.info(
    {
      event: 'invite.scheduled',
      userId: actor.userId,
      tenantId,
      inviteIds: result.inviteIds,
      delayS,
      scheduled: result.scheduled,
    },
    'first-admin invite send scheduled',
  );
  return { scheduled: result.scheduled };
}

export type ScheduledInviteSendOutcome =
  | 'sent'
  | 'not_pending'
  | 'gone'
  | 'no_verified_primary'
  | 'claimed_elsewhere';

/**
 * The job body. The invite is re-read by `id AND tenant_id` (a payload can never reach another
 * tenant's row — T-g0s-04): missing -> `gone` (tenant or invite deleted); anything but `pending` ->
 * `not_pending` (already sent by a re-run or a manual send, accepted, lapsed or refused — those are
 * the human resend's business, never the automatic path's). A pending row goes through the ONE
 * sender with `inviteId`, whose claim decides the race with a concurrent manual send
 * (`claimed_elsewhere`). Errors propagate untouched — the job classifies them.
 */
export async function runScheduledInviteSend(
  payload: InviteSendPayload,
  actor: PlatformActor,
): Promise<ScheduledInviteSendOutcome> {
  const rows = await withAdminTx((tx) =>
    tx
      .select({ status: tenantInvites.status })
      .from(tenantInvites)
      .where(
        and(eq(tenantInvites.id, payload.inviteId), eq(tenantInvites.tenantId, payload.tenantId)),
      )
      .limit(1),
  );
  const row = rows[0];
  if (!row) return 'gone';
  if (row.status !== 'pending') return 'not_pending';

  const result = await sendPendingInvites(payload.tenantId, actor, { inviteId: payload.inviteId });
  if (result.reason === 'no_verified_primary') return 'no_verified_primary';
  return result.sent === 1 ? 'sent' : 'claimed_elsewhere';
}
