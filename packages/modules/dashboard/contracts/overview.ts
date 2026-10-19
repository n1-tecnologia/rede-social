import { z } from 'zod';
import { attendanceTotalsSchema } from './events';
import { engagementBandsSchema } from './members';
import { preparingSchema, snapshotMetaSchema } from './shared';
import { supportAwaitingSchema } from './support';

/**
 * The owner's "Visão geral" answer (`GET /v1/dashboard/owner/overview`, 08.7-01, D-464, D-462,
 * INSIGHT-06, INSIGHT-07). Raw non-negative integers only: the web derives every percent and chip
 * from them with the shipped `changeDelta` (planning decision 4), so the API sends no delta.
 *
 * Members KPI (planning decision 5), all over the snapshot's windows (`untilAt` = end of day D):
 * - `count`: role `member`, `status = 'active'`, never blocked or deleted, joined before `untilAt`;
 * - `newMembers`: the same, joined at or after `from30At` (local midnight of D-29);
 * - `previous`: the base 30 days before — role `member`, not `invited`, not deleted, joined before
 *   `from30At`, and not blocked before `from30At`.
 */
export const ownerOverviewMembersSchema = z
  .object({
    count: z.number().int().nonnegative(),
    newMembers: z.number().int().nonnegative(),
    previous: z.number().int().nonnegative(),
  })
  .strict();
export type OwnerOverviewMembers = z.infer<typeof ownerOverviewMembersSchema>;

/**
 * `enteredAtRisk` (08.7-12, builder v8): members whose band is `at_risk` and whose last counted
 * action's local day is in D-36..D-30 (they crossed into "em risco" in the last 7 days), and those of
 * them with a push subscription — read from the member rows of the same build.
 */
export const enteredAtRiskSchema = z
  .object({
    members: z.number().int().nonnegative(),
    withPush: z.number().int().nonnegative(),
  })
  .strict();

/** The `overview` key of a snapshot's payload, as the builder writes it (v8: `enteredAtRisk`). */
export const overviewPayloadSchema = z
  .object({ members: ownerOverviewMembersSchema, enteredAtRisk: enteredAtRiskSchema })
  .strict();
export type OverviewPayload = z.infer<typeof overviewPayloadSchema>;

const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const twelveWeeks = z.array(count).length(12);

/**
 * "Interações por publicação" (08.7-12): `payload.content.kpis` of the same build — the window's
 * live posts and their member likes + live comments, and the same over Prev30 — raw, so the Visão
 * geral card and Conteúdo never disagree (planning decision 1). Present while `feed` or `stories`
 * is on.
 */
export const ownerOverviewPerPostSchema = z
  .object({ posts: count, interactions: count, previousPosts: count, previousInteractions: count })
  .strict();
export type OwnerOverviewPerPost = z.infer<typeof ownerOverviewPerPostSchema>;

/** "Vendas do mês": the paid cents of Window30 and Prev30 (`payload.finance.totals`), raw. */
export const ownerOverviewOrderValueSchema = z.object({ current: count, previous: count }).strict();
export type OwnerOverviewOrderValue = z.infer<typeof ownerOverviewOrderValueSchema>;

/**
 * The bell's alerts (UI-D-489 a, D-460, UI-D-480), each read from the tenant's own snapshot, never a
 * sample (D-459). Counts, ids and the event's live title only: no member is named (PR-1).
 * - `support_waiting` (chat on, someone waits): the queue at build time and its oldest wait in hours;
 * - `event_soon` (events on): the next upcoming event with a capacity whose seats left are at most
 *   10% of it and at least 1 — its id (the attendee list's link), live title, start and seats;
 * - `entered_at_risk`: members whose band is `at_risk` and whose last counted action falls in
 *   D-36..D-30 (they crossed into "em risco" in the last 7 days); `withPush` (those with a push
 *   subscription) only while `notifications` is on (UI-D-489 d).
 */
export const ownerAlertSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('support_waiting'), conversations: positive, oldestHours: count })
    .strict(),
  z
    .object({
      kind: z.literal('event_soon'),
      eventId: z.uuid(),
      title: z.string(),
      startsAt: z.iso.datetime(),
      confirmed: count,
      capacity: positive,
    })
    .strict(),
  z
    .object({ kind: z.literal('entered_at_risk'), members: positive, withPush: count.optional() })
    .strict(),
]);
export type OwnerAlert = z.infer<typeof ownerAlertSchema>;
export type OwnerAlertKind = OwnerAlert['kind'];

/**
 * The account card (D-464: read LIVE, it is cheap): `tenants.plan` as stored (free text, `pilot` by
 * default) and the tenant's current team — active, unblocked, undeleted `admin_tenant` (`admins`)
 * and `support_tenant` (`staff`) memberships. Billing stays the shipped "Cobrança: em breve".
 */
export const ownerOverviewAccountSchema = z
  .object({ plan: z.string().min(1), admins: count, staff: count })
  .strict();
export type OwnerOverviewAccount = z.infer<typeof ownerOverviewAccountSchema>;

/**
 * The ready Visão geral (08.7-01, extended by 08.7-02 and completed by 08.7-12 for INSIGHT-07).
 * Besides the members KPI it carries, from the snapshot's `members` key:
 * - `engagement` and `previousEngagement`: today's bands and today's members by their band at D-30,
 *   from which the web derives the engaged share and its change in points (`engagedPercent`);
 * - `actions30` and `activeMembers30`: counted actions of D-29..D and the members with at least one,
 *   raw (the web divides for "ações por membro ativo");
 * - `weeklyInteracting`: distinct members with a counted action per 7-day block, 12 blocks ending D
 *   (`current`) and the 12 before (`previous`), oldest first.
 * 08.7-12 (planning decision 1: the overview composes, it does not recompute), each key only while
 * its module is on (D-460), read from the area key that owns the number:
 * - `perPost` (`feed` or `stories`): `payload.content.kpis`;
 * - `attendance` (`events`): `payload.events.attendanceTotals` (presences ÷ (confirmed + walk-ins));
 * - `orderValue` (`store`): `payload.finance.totals` paid cents;
 * - `awaiting` (`chat`): `payload.support.awaiting`;
 * and always `alerts` (possibly empty: no bell) and `account`.
 */
export const ownerOverviewReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    members: ownerOverviewMembersSchema,
    engagement: engagementBandsSchema,
    previousEngagement: engagementBandsSchema,
    actions30: count,
    activeMembers30: count,
    weeklyInteracting: z.object({ current: twelveWeeks, previous: twelveWeeks }).strict(),
    perPost: ownerOverviewPerPostSchema.optional(),
    attendance: attendanceTotalsSchema.optional(),
    orderValue: ownerOverviewOrderValueSchema.optional(),
    awaiting: supportAwaitingSchema.optional(),
    alerts: z.array(ownerAlertSchema).max(3),
    account: ownerOverviewAccountSchema,
  })
  .strict();
export type OwnerOverviewReady = z.infer<typeof ownerOverviewReadySchema>;

/** `{ state: 'preparing' }` (no number key at all, never zeros) or the ready answer. */
export const ownerOverviewAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  ownerOverviewReadySchema,
]);
export type OwnerOverviewAnswer = z.infer<typeof ownerOverviewAnswerSchema>;
