import { z } from 'zod';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { applyPaymentEvent } from './apply';
import { PAYMENT_EVENT_QUEUE } from './types';

/**
 * `kernel.payment-event` (09.1-07, D-509) — applies ONE recorded gateway delivery. The webhook route
 * (plan 05) does the fast, safe part (verify, record once, enqueue) and answers 2xx at once, because a
 * gateway retries on anything else; this handler does the state change. It runs in the api image under
 * `ROLE=worker` and `apps/api/src/worker.ts` lists it beside `mediaProviderEventJob`; the queue registers
 * itself in `./index.ts` (the receive service imports that barrel).
 *
 * The payload is the event id ALONE, validated with a Zod mirror: it arrives as JSON from pg-boss, never
 * typed. A malformed payload is logged and DROPPED, never thrown (pg-boss would otherwise retry a job
 * that can never become valid). Every other failure propagates out of `applyPaymentEvent`, which has
 * already marked the event `failed` and logged it, so pg-boss retries and a later attempt (or the
 * gateway's manual resend) converges.
 *
 * Log lines carry ids, state and outcome and nothing else: no e-mail, no amount, no payload (PR-9).
 */
const log = moduleLogger('kernel-jobs');

/** A zod mirror of the job payload: `{ eventId }` and nothing more. */
const payloadSchema = z.object({ eventId: z.uuid() });

export const paymentEventJob: JobDefinition<{ eventId: string }> = {
  name: PAYMENT_EVENT_QUEUE,
  handler: async (payload, ctx) => {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        { event: 'payments.event.bad_payload', issues: parsed.error.issues.length },
        'kernel.payment-event received a malformed payload; dropped',
      );
      return;
    }
    const { eventId } = parsed.data;
    const t0 = Date.now();

    // The worker names the project whose queue delivered the job: the event row lives in that database.
    const result = await applyPaymentEvent(eventId, ctx?.projectId);
    if (!result) return;
    log.info(
      {
        event: 'payments.event.done',
        eventId,
        tenantId: result.tenantId,
        state: result.state,
        outcome: result.outcome,
        emitted: result.emitted.length,
        ms: Date.now() - t0,
      },
      'kernel.payment-event ran',
    );
  },
};
