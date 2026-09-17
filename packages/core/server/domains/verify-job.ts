import { z } from 'zod';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { checkDomain, rearmDomainVerification } from '../platform/domains';
import { DOMAIN_VERIFY_QUEUE, type DomainVerifyPayload } from './types';

/**
 * `kernel.domain-verify` (D-34) — the poller behind "the platform re-checks a pending host every
 * ~10 minutes". Runs in the api image under `ROLE=worker` (D-18); `apps/api/src/worker.ts` lists it
 * explicitly next to the module jobs, and the queue registers itself in `domains/index.ts`.
 *
 * The handler is a thin, never-throwing wrapper around `checkDomain` (the ONE check the route also
 * runs): pg-boss would otherwise retry a crashing job twice and then park it, leaving the host
 * without a poller. So: a malformed payload is logged and dropped; an unexpected error is logged and,
 * when the row is still pending, one deferred job is re-armed through the platform lane (a duplicate
 * is dropped by the `short` policy). Import direction is service -> job only: `platform/domains.ts`
 * takes the queue name from `./types`, never from this file, so there is no cycle.
 *
 * `SYSTEM_ACTOR` is a log-only actor id — `sendPendingInvites` logs `userId`, it never writes it
 * to `created_by`.
 */
const log = moduleLogger('kernel-jobs');

export const SYSTEM_ACTOR = 'system:domain-verify';

const payloadSchema = z.object({ domainId: z.uuid() });

export const domainVerifyJob: JobDefinition<DomainVerifyPayload> = {
  name: DOMAIN_VERIFY_QUEUE,
  handler: async (payload) => {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        { event: 'domains.verify_job.bad_payload', issues: parsed.error.issues.length },
        'kernel.domain-verify received a malformed payload; dropped',
      );
      return;
    }
    const { domainId } = parsed.data;

    try {
      const result = await checkDomain(domainId, { userId: SYSTEM_ACTOR }, { source: 'job' });
      log.info(
        { event: 'domains.verify_job.done', domainId, outcome: result.outcome },
        'kernel.domain-verify ran',
      );
    } catch (error) {
      log.error(
        {
          event: 'domains.verify_job.failed',
          domainId,
          err: error instanceof Error ? error.message : String(error),
        },
        'kernel.domain-verify failed unexpectedly',
      );
      try {
        const rearmed = await rearmDomainVerification(domainId);
        if (rearmed) {
          log.info(
            { event: 'domains.verify_job.rearmed', domainId },
            'poller re-armed after a crash',
          );
        }
      } catch (rearmError) {
        log.error(
          {
            event: 'domains.verify_job.rearm_failed',
            domainId,
            err: rearmError instanceof Error ? rearmError.message : String(rearmError),
          },
          'could not re-arm the poller; the next restart or manual check re-opens it',
        );
      }
    }
  },
};
