import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { enqueueInTx } from '../jobs/boss';
import { type NeutralPaymentEvent, PAYMENT_EVENT_QUEUE } from './types';

/**
 * The kernel half of `POST /v1/webhooks/{provider}/{integrationId}`: record a VERIFIED, NORMALISED
 * delivery EXACTLY once and enqueue its state change in the SAME admin transaction (09.1-05, D-486,
 * PAY-03; the `recordProviderEvent` shape).
 *
 * It lives here rather than in the route because the admin transaction lane is kernel-only (Biome's
 * override lists `server/payments/**`), and because it is the whole replay defence, which deserves one
 * implementation a test can point at.
 *
 * The idempotency key is `dedupe_key = sha256(the AUTHENTICATED bytes)`, computed by the caller from what
 * `verify` returned (CR-01; for a delivery signed as received that is the received bytes): the
 * gateways send no event id of their own, a retry re-sends identical bytes, and two genuinely different
 * events cannot share a body. `insert … on conflict (integration_id, dedupe_key) do nothing returning id`
 * returns a row for the FIRST delivery only. That one inserts the event, advances the integration's
 * `last_event_at` and enqueues `kernel.payment-event` with `{ eventId }` as its ENTIRE payload
 * (`singletonKey = eventId`, queue policy `short`) — row and job commit or roll back together, so a
 * crash can never leave a row without its job or a job without its row. Eight simultaneous identical
 * deliveries block on the unique index, and the seven losers find the committed row.
 *
 * A DUPLICATE whose stored row is still `received` or `failed` re-enqueues (the gateway's manual
 * "resend" then recovers a failed apply); the singleton key makes that a no-op while the original job
 * is still waiting. Any other duplicate enqueues nothing and touches nothing.
 *
 * The e-mail is normalised again IN SQL with `lower(btrim())`, the rule the table CHECK uses, because
 * JavaScript's lower-casing is not byte-for-byte SQL's for every non-ASCII letter: a mismatch would
 * violate the CHECK and answer 500, and the gateway would retry the same body forever.
 *
 * No payload column, no buyer name, CPF, phone, address or IP reaches this function: `event` is the
 * adapter's neutral shape (PR-9).
 */
export type RecordedPaymentEvent = { eventId: string; enqueued: boolean };

export async function recordPaymentEvent(input: {
  integration: { id: string; tenantId: string; provider: string };
  event: NeutralPaymentEvent;
  dedupeKey: string;
}): Promise<RecordedPaymentEvent> {
  const { integration, event, dedupeKey } = input;
  return withAdminTx(async (tx) => {
    const inserted = (await tx.execute(sql`
      insert into public.payment_events
        (tenant_id, integration_id, provider, dedupe_key, type, effect, external_ref, order_ref,
         external_product_id, email, amount_cents, currency, recurring, valid_until, occurred_at)
      values
        (${integration.tenantId}::uuid, ${integration.id}::uuid, ${integration.provider},
         ${dedupeKey}, ${event.type}, ${event.effect}, ${event.externalRef}::text,
         ${event.orderRef}::text, ${event.externalProductId}::text,
         lower(btrim(${event.email}::text)), ${event.amountCents}::integer, ${event.currency}::text,
         ${event.recurring}::boolean,
         ${event.validUntil?.toISOString() ?? null}::timestamptz,
         ${event.occurredAt?.toISOString() ?? null}::timestamptz)
      on conflict (integration_id, dedupe_key) do nothing
      returning id`)) as unknown as { id: string }[];

    const first = inserted[0];
    if (first) {
      await tx.execute(sql`
        update public.payment_integrations
           set last_event_at = now(), updated_at = now()
         where id = ${integration.id}::uuid`);
      const jobId = await enqueueInTx(
        tx,
        PAYMENT_EVENT_QUEUE,
        { eventId: first.id },
        { singletonKey: first.id },
      );
      return { eventId: first.id, enqueued: jobId !== null };
    }

    const existing = (await tx.execute(sql`
      select id, state from public.payment_events
       where integration_id = ${integration.id}::uuid and dedupe_key = ${dedupeKey}`)) as unknown as {
      id: string;
      state: string;
    }[];
    const row = existing[0];
    // Only reachable if the 180-day sweep removed the row between the two statements; the gateway retries.
    if (!row) throw new Error('payment event vanished between insert and read');
    if (row.state !== 'received' && row.state !== 'failed') {
      return { eventId: row.id, enqueued: false };
    }
    const jobId = await enqueueInTx(
      tx,
      PAYMENT_EVENT_QUEUE,
      { eventId: row.id },
      { singletonKey: row.id },
    );
    return { eventId: row.id, enqueued: jobId !== null };
  });
}
