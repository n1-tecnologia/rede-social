import {
  PAYMENT_EVENT_EFFECTS,
  PAYMENT_EVENT_OUTCOMES,
  PAYMENT_EVENT_STATES,
  PAYMENT_EVENT_TYPES,
} from '@rede-social/contracts/payments';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { paymentIntegrations } from './payment-integrations';
import { paymentProducts } from './payment-products';
import { tenants } from './tenants';

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(','));

/**
 * Phase 09.1-05 (D-486, PAY-02, PAY-03): every delivery a payment gateway made to a tenant's
 * integration, kept as its NORMALISED neutral fields. This table is the inbox and the replay memory:
 * `dedupe_key = sha256(received bytes)` with `unique (integration_id, dedupe_key)` makes an exact
 * resend a no-op for as long as the row exists (retention 180 days, assumption A-P21, swept by
 * `app.payment_events_prune`), because the gateways sign no timestamp.
 *
 * **NO PAYLOAD COLUMN EXISTS, ON PURPOSE (PR-9, T-09.1-24).** A gateway body carries the buyer's CPF,
 * phone, address and IP. Only what the access decision and the admin's Eventos list need is stored:
 * the neutral type and effect, the references, the product id, the buyer's e-mail (normalised, the one
 * personal datum, which the admin needs to answer a buyer), the amount in cents and the currency. A
 * "last raw body" column added for debugging would turn the inbox into a PII store that the sweeper,
 * the backups and every tenant admin reach. The job payload is the event id alone.
 *
 * `received_at` plus `id` give the total order `(tenant_id, received_at desc, id desc)` the Eventos
 * list pages by (P6): two events received in the same instant keep a stable order. The apply job's own
 * ordering rule (rank for one-off orders, arrival for subscriptions) is plan 07's. `state` starts at
 * `received`; `outcome` and `applied_at` are written by that job.
 *
 * RLS is enabled with **no policy at all** and `anon` / `authenticated` hold no privilege: the webhook
 * route, the apply job and the admin screens use the admin lane only, with an explicit
 * `tenant_id = $ctx` predicate. Adding a policy for `authenticated` is always a bug.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => paymentIntegrations.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    /** `sha256(received bytes)` hex: the idempotency key when the gateway sends no event id. */
    dedupeKey: text('dedupe_key').notNull(),
    type: text().notNull(),
    effect: text().notNull(),
    /** The gateway's order or subscription reference (the access key and the terminal check). */
    externalRef: text('external_ref'),
    /** The reference a buyer would quote (a display aid, not a key). */
    orderRef: text('order_ref'),
    externalProductId: text('external_product_id'),
    /** Normalised with `lower(btrim())`. The only personal datum kept. */
    email: text(),
    amountCents: integer('amount_cents'),
    currency: text(),
    /** The access end the gateway reports, for display only. */
    validUntil: timestamp('valid_until', { withTimezone: true }),
    /** The gateway's own timestamp when it is reliable; null otherwise. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    state: text().notNull().default('received'),
    outcome: text(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    /** The mapping the apply job resolved. Set null when the mapping is deleted. */
    mappingId: uuid('mapping_id').references(() => paymentProducts.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('payment_events_type_chk', sql`${t.type} in (${list(PAYMENT_EVENT_TYPES)})`),
    check('payment_events_effect_chk', sql`${t.effect} in (${list(PAYMENT_EVENT_EFFECTS)})`),
    check('payment_events_state_chk', sql`${t.state} in (${list(PAYMENT_EVENT_STATES)})`),
    check(
      'payment_events_outcome_chk',
      sql`${t.outcome} is null or ${t.outcome} in (${list(PAYMENT_EVENT_OUTCOMES)})`,
    ),
    check(
      'payment_events_email_chk',
      sql`${t.email} is null or ${t.email} = lower(btrim(${t.email}))`,
    ),
    check('payment_events_amount_chk', sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
    uniqueIndex('payment_events_dedupe_uq').on(t.integrationId, t.dedupeKey),
    // The Eventos list and its total order (P6). `.nullsFirst()` matches SQL's `order by x desc`.
    index('payment_events_tenant_received_idx').on(
      t.tenantId,
      t.receivedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // The terminal check: "was this order already refunded?" (plan 07).
    index('payment_events_tenant_ref_idx').on(t.tenantId, t.externalRef),
  ],
).enableRLS();
