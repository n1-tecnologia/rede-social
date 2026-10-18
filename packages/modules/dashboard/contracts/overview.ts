import { z } from 'zod';
import { engagementBandsSchema } from './members';
import { preparingSchema, snapshotMetaSchema } from './shared';

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

/** The `overview` key of a snapshot's payload, as the builder writes it. */
export const overviewPayloadSchema = z.object({ members: ownerOverviewMembersSchema }).strict();
export type OverviewPayload = z.infer<typeof overviewPayloadSchema>;

const count = z.number().int().nonnegative();
const twelveWeeks = z.array(count).length(12);

/**
 * The ready Visão geral (08.7-01, extended by 08.7-02 for INSIGHT-07). Besides the members KPI it
 * carries, from the snapshot's `members` key (the overview is `preparing` while that key is missing):
 * - `engagement` and `previousEngagement`: today's bands and today's members by their band at D-30,
 *   from which the web derives the engaged share and its change in points (`engagedPercent`);
 * - `actions30` and `activeMembers30`: counted actions of D-29..D and the members with at least one,
 *   raw (the web divides for "ações por membro ativo");
 * - `weeklyInteracting`: distinct members with a counted action per 7-day block, 12 blocks ending D
 *   (`current`) and the 12 before (`previous`), oldest first.
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
  })
  .strict();
export type OwnerOverviewReady = z.infer<typeof ownerOverviewReadySchema>;

/** `{ state: 'preparing' }` (no number key at all, never zeros) or the ready answer. */
export const ownerOverviewAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  ownerOverviewReadySchema,
]);
export type OwnerOverviewAnswer = z.infer<typeof ownerOverviewAnswerSchema>;
