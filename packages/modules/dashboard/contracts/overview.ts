import { z } from 'zod';
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

export const ownerOverviewReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    members: ownerOverviewMembersSchema,
  })
  .strict();
export type OwnerOverviewReady = z.infer<typeof ownerOverviewReadySchema>;

/** `{ state: 'preparing' }` (no number key at all, never zeros) or the ready answer. */
export const ownerOverviewAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  ownerOverviewReadySchema,
]);
export type OwnerOverviewAnswer = z.infer<typeof ownerOverviewAnswerSchema>;
