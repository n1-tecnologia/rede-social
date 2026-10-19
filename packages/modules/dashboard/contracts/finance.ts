import { z } from 'zod';
import { ENGAGEMENT_BANDS } from './members';
import { flooredCountSchema, preparingSchema, snapshotMetaSchema } from './shared';

/**
 * The owner's "Financeiro" contract (08.7-09, D-455, D-460, D-462, D-465, UI-D-470, UI-D-490,
 * INSIGHT-12, INSIGHT-14): the tenant's store orders, built once a day by
 * `app.dashboard_area_finance`. The area exists only while the `store` module is on (the routes
 * answer 404 `MODULE_DISABLED` otherwise, D-460).
 *
 * - **Who counts.** The orders of ACTIVE ROLE MEMBERS (UI-D-484's counted set), so the band split
 *   adds up to the totals and every buyers list's total is its number. Money is integer cents.
 * - **Paid as of `untilAt`.** An order counts when `paid_at < untilAt` and it was not revoked
 *   before `untilAt` (EP-41: an order paid or revoked after the build's end changes nothing until
 *   the next day's build). A revoked order is never revenue; it counts in `revoked` only (EP-37).
 * - **Primary and secondary.** Each member's first paid order of the tenant (by `paid_at, id`) is
 *   primary, every later one secondary; computed by the builder, never stored on the order.
 * - **Product, not offer (planning decision 1).** No offer table exists (`needs_offers`): every
 *   path, purchase and list is keyed by PRODUCT id; offers are "Em breve".
 * - **Not measured (D-455, D-465).** `offers`, `attention.expiring` (no `expires_at` is ever
 *   written), paid events and `attention.fullEvents` are `{ measured: false, reason }`.
 * - **The floor (D-462, INSIGHT-14).** The stored payload keeps raw numbers (admin-only RLS); the
 *   answer carries every group of 1-4 people — by band, a product's buyers by band (merged), per
 *   ladder path, never-again, revoked, per post or event association — as `{ belowFloor: true }`
 *   with no count and no cents. A group of 0 is the value 0 (UI-D-470).
 * - **Ids and numbers only in the stored payload (PR-1).** Product, community and event names are
 *   joined live by the service.
 *
 * Every object is `.strict()`, so a key nobody declared (an `example`, an offer id, a name in the
 * payload) fails the parse instead of travelling.
 */

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();
/** A median or an average of whole local days, rounded to one decimal by the builder. */
const days = z.number().nonnegative();

/** A product with no paid order for longer than this many days is stalled ("Parado"). */
export const FINANCE_STALLED_DAYS = 60;
/** An order counts as associated with a post or an event within this many days after the touch. */
export const FINANCE_ASSOCIATION_DAYS = 7;
/** Below this many people a ladder path is summed into "outros caminhos" (the privacy floor). */
export const FINANCE_PATH_FLOOR = 5;

/**
 * The buyers lists behind Financeiro's numbers (D-462, admin only). There is no `expiring` list
 * (D-465) and no `offer` list (no offer table): both are "Em breve".
 */
export const FINANCE_BUYER_LISTS = [
  'band',
  'never',
  'primary',
  'secondary',
  'rebought',
  'time-to-second',
  'lifetime',
  'vip-fading',
  'product',
] as const;
export type FinanceBuyerListId = (typeof FINANCE_BUYER_LISTS)[number];

/** Orders and their cents. */
export const financeAmountSchema = z.object({ orders: count, cents: count }).strict();
export type FinanceAmount = z.infer<typeof financeAmountSchema>;

/** Orders, cents and the distinct buyers behind them. */
export const financeTotalsSchema = z
  .object({ orders: count, cents: count, buyers: count })
  .strict();
export type FinanceTotals = z.infer<typeof financeTotalsSchema>;

const pair = <T extends z.ZodType>(value: T) =>
  z.object({ current: value, previous: value }).strict();

const bandRecord = <T extends z.ZodType>(value: T) =>
  z
    .object({
      new: value,
      superfan: value,
      engaged: value,
      occasional: value,
      at_risk: value,
      inactive: value,
    })
    .strict();

/** Cents per 7-day block, oldest first: the 12 blocks ending at D and the 12 before them. */
export const financeWeeksSchema = z
  .object({ current: z.array(count).length(12), previous: z.array(count).length(12) })
  .strict();
export type FinanceWeeks = z.infer<typeof financeWeeksSchema>;

/** The overview's numbers on one day (as of `untilAt`, and as of `from30At` for the comparison). */
export const financeSummarySchema = z
  .object({
    /** Active members who had joined by then. */
    base: count,
    /** Members with two or more paid orders by then. */
    rebought: count,
    /** Median local days from the first to the second paid order; null when nobody bought twice. */
    timeToSecondDays: days.nullable(),
    /** Every paid order's cents by then (÷ `base` is the revenue per member for life). */
    lifetimeCents: count,
  })
  .strict();
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

/** One product's Window30 numbers: entries (primary orders) and add-ons (secondary) included. */
const productWindowSchema = financeTotalsSchema.extend({ entry: count, addon: count }).strict();

/** One product as the builder stores it: ids and numbers only. */
export const financeProductPayloadSchema = z
  .object({
    productId: z.uuid(),
    current: productWindowSchema,
    previous: financeTotalsSchema,
    /** The last paid order's instant (as of `untilAt`); null when it never sold. */
    lastSaleAt: instant.nullable(),
    /** The product's orders revoked in Window30. */
    revoked: financeTotalsSchema,
    weekly: financeWeeksSchema,
    /** Window30 orders by the buyer's band of today. */
    byBand: bandRecord(financeTotalsSchema),
  })
  .strict();
export type FinanceProductPayload = z.infer<typeof financeProductPayloadSchema>;

/** One ladder path: the first paid product, the second, how many people, their average days. */
export const financePathPayloadSchema = z
  .object({
    entryProductId: z.uuid(),
    nextProductId: z.uuid(),
    people: count,
    averageDays: days,
  })
  .strict();
export type FinancePathPayload = z.infer<typeof financePathPayloadSchema>;

/** An active product with no paid order for more than `FINANCE_STALLED_DAYS` days. */
const stalledPayloadSchema = z
  .object({ productId: z.uuid(), days: count, lastSaleAt: instant.nullable() })
  .strict();

const vipFadingSchema = z.object({ atRisk: count, inactive: count, withPush: count }).strict();

/**
 * UI-D-490: the exclusive community (linked to a product) with the most active holders, its
 * holders fading (band `at_risk` / `inactive` today; `withPush` of those with push on), the most
 * common first product among the superfãs and engajados who do not hold it and how many they are.
 */
const vipPayloadSchema = z
  .object({
    communityId: z.uuid(),
    entryProductId: z.uuid().nullable(),
    holders: count,
    fading: vipFadingSchema,
    prospects: count,
    /** Window30 paid cents of the products linked to the community. */
    revenueCents: count,
  })
  .strict();

const productSalesPayloadSchema = financeTotalsSchema.extend({ productId: z.uuid() }).strict();

/** Window30 paid orders within 7 days after the buyer's like or comment on a post (association). */
const contentSalesPayloadSchema = z
  .object({
    posts: z.array(
      financeTotalsSchema
        .extend({ postId: z.uuid(), products: z.array(productSalesPayloadSchema) })
        .strict(),
    ),
    /** Distinct orders: one order tied to two posts counts once. */
    total: financeTotalsSchema,
  })
  .strict();

/** Window30 paid orders within 7 days after the buyer's check-in at an event (association). */
const eventSalesPayloadSchema = z
  .object({
    events: z.array(financeTotalsSchema.extend({ eventId: z.uuid() }).strict()),
    total: financeTotalsSchema,
  })
  .strict();

/** `payload.finance` as the builder stores it (v6). */
export const financePayloadSchema = z
  .object({
    totals: pair(financeTotalsSchema),
    primary: pair(financeAmountSchema),
    secondary: pair(financeAmountSchema),
    revoked: pair(financeTotalsSchema),
    byProduct: z.array(financeProductPayloadSchema),
    byBand: bandRecord(financeTotalsSchema),
    weekly: z.object({ primary: financeWeeksSchema, secondary: financeWeeksSchema }).strict(),
    summary: pair(financeSummarySchema),
    ladder: z.array(financePathPayloadSchema),
    /** Members with exactly one paid order, by today's band. */
    neverAgain: bandRecord(count),
    attention: z.object({ stalled: z.array(stalledPayloadSchema) }).strict(),
    vip: vipPayloadSchema.nullable(),
    contentSales: contentSalesPayloadSchema,
    eventSales: eventSalesPayloadSchema,
  })
  .strict();
export type FinancePayload = z.infer<typeof financePayloadSchema>;

// ── the floored answer pieces ──────────────────────────────────────────────────────────────────

/**
 * A money group through the floor (D-462, EP-48): orders, cents and buyers travel TOGETHER, or not
 * at all. A group of 1-4 buyers is `{ belowFloor: true }` with no number; zero is the value 0.
 */
export const flooredMoneySchema = z.discriminatedUnion('belowFloor', [
  z.object({ belowFloor: z.literal(true) }).strict(),
  z.object({ belowFloor: z.literal(false), orders: count, cents: count, buyers: count }).strict(),
]);
export type FlooredMoney = z.infer<typeof flooredMoneySchema>;

/** One row of a product's buyers by band: adjacent bands merged under the floor (UI-D-470). */
export const flooredMoneyBandGroupSchema = z
  .object({ bands: z.array(z.enum(ENGAGEMENT_BANDS)).min(1), sales: flooredMoneySchema })
  .strict();
export type FlooredMoneyBandGroup = z.infer<typeof flooredMoneyBandGroupSchema>;

/**
 * The ladder through the floor: paths of 5 or more people, most people first; the smaller ones
 * summed into "outros caminhos" (`others`), itself floored when that sum is still under 5.
 */
export const financeLadderAnswerSchema = z
  .object({
    paths: z.array(financePathPayloadSchema),
    others: z
      .discriminatedUnion('belowFloor', [
        z.object({ belowFloor: z.literal(true), paths: count }).strict(),
        z
          .object({ belowFloor: z.literal(false), people: count, paths: count, averageDays: days })
          .strict(),
      ])
      .nullable(),
  })
  .strict();
export type FinanceLadderAnswer = z.infer<typeof financeLadderAnswerSchema>;

export const financeContentSalesAnswerSchema = z
  .object({
    posts: z.array(
      z
        .object({
          postId: z.uuid(),
          sales: flooredMoneySchema,
          products: z.array(z.object({ productId: z.uuid(), sales: flooredMoneySchema }).strict()),
        })
        .strict(),
    ),
    total: flooredMoneySchema,
  })
  .strict();
export type FinanceContentSalesAnswer = z.infer<typeof financeContentSalesAnswerSchema>;

export const financeEventSalesAnswerSchema = z
  .object({
    events: z.array(
      z.object({ eventId: z.uuid(), title: z.string(), sales: flooredMoneySchema }).strict(),
    ),
    total: flooredMoneySchema,
  })
  .strict();
export type FinanceEventSalesAnswer = z.infer<typeof financeEventSalesAnswerSchema>;

// ── the area answer (`GET /v1/dashboard/owner/finance`) ────────────────────────────────────────

const notMeasuredAs = <R extends string>(reason: R) =>
  z.object({ measured: z.literal(false), reason: z.literal(reason) }).strict();

/** A product card: the stored numbers plus the live name, price and status. */
export const ownerFinanceProductSummarySchema = z
  .object({
    productId: z.uuid(),
    name: z.string(),
    priceCents: count,
    status: z.enum(['active', 'archived']),
    current: productWindowSchema,
    previous: financeTotalsSchema,
    lastSaleAt: instant.nullable(),
  })
  .strict();
export type OwnerFinanceProductSummary = z.infer<typeof ownerFinanceProductSummarySchema>;

export const ownerFinanceReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    totals: pair(financeTotalsSchema),
    primary: pair(financeAmountSchema),
    secondary: pair(financeAmountSchema),
    revoked: pair(flooredMoneySchema),
    /** Every product of the tenant, cents desc, then the live name, then the id (EP-39). */
    byProduct: z.array(ownerFinanceProductSummarySchema),
    /** Window30 orders by the buyer's band of today, each band floored (UI-D-470). */
    byBand: bandRecord(flooredMoneySchema),
    weekly: z.object({ primary: financeWeeksSchema, secondary: financeWeeksSchema }).strict(),
    summary: pair(financeSummarySchema),
    ladder: financeLadderAnswerSchema,
    neverAgain: bandRecord(flooredCountSchema),
    attention: z
      .object({
        /** The VIP holders fading; null with no VIP (UI-D-490). */
        vipFading: vipFadingSchema.nullable(),
        /** Longest unsold first; live names (an archived or deleted product leaves). */
        stalled: z.array(stalledPayloadSchema.extend({ name: z.string() }).strict()),
        expiring: notMeasuredAs('needs_access_expiry'),
        fullEvents: notMeasuredAs('needs_waitlist'),
      })
      .strict(),
    /** UI-D-490: null when no product opens an exclusive community or `communities` is off. */
    vip: vipPayloadSchema
      .extend({ communityName: z.string(), entryProductName: z.string().nullable() })
      .strict()
      .nullable(),
    offers: notMeasuredAs('needs_offers'),
    paidEvents: notMeasuredAs('needs_event_tickets'),
    /** Present while `feed` is on. */
    contentSales: financeContentSalesAnswerSchema.optional(),
    /** Present while `events` is on; titles live. */
    eventSales: financeEventSalesAnswerSchema.optional(),
  })
  .strict();
export type OwnerFinanceReady = z.infer<typeof ownerFinanceReadySchema>;

export const ownerFinanceAnswerSchema = z.discriminatedUnion('state', [
  ownerFinanceReadySchema,
  preparingSchema,
]);
export type OwnerFinanceAnswer = z.infer<typeof ownerFinanceAnswerSchema>;
