import { z } from 'zod';
import { preparingSchema, snapshotMetaSchema } from './shared';

/**
 * The owner's "Atendimento" contract (08.7-11, D-455, D-460, D-461, D-465, INSIGHT-13, EP-42,
 * EP-43): the tenant's support numbers, built once a day by `app.dashboard_area_support`. The area
 * exists only while the `chat` module is on (the route answers 404 `MODULE_DISABLED` otherwise, and
 * its Moderação block leaves with it, D-460 / UI-D-474).
 *
 * - **Queue (`awaiting`).** At BUILD time ("Fila na última atualização", UI-D-480): support
 *   conversations whose latest message is the member's and is past the team's shared read mark
 *   (`last_message_side = 'member' and last_seq > staff_last_read_seq`, the inbox rule of the chat
 *   module). `oldestHours` = whole hours from the first unread member message of the longest wait
 *   to the build instant; null exactly when nobody waits.
 * - **One turn definition (planning decision 1).** A member turn starts at the first member message
 *   after the last staff message (or the conversation's first message); its response time is the
 *   minutes to the next staff message. Unanswered turns count in `awaiting`, never in the medians.
 *   The member detail's support counts use the same turn (08.7-04).
 * - **Weeks.** `SUPPORT_WEEKS` blocks of 7 tenant-local days ending D, oldest first:
 *   `weeklyMedianMinutes` is the median minutes per block of the turns STARTED in it
 *   (`percentile_cont(0.5)`, rounded), null for a block with no answered turn (never 0, UI-D-481);
 *   `weeklyConversations` the support conversations CREATED in each block.
 * - **Team (planning decision 3).** `answeredByStaff`: the distinct support conversations with a
 *   message by each user holding a current `admin_tenant` or `support_tenant` membership, in
 *   Window30, most first. The payload carries the user id only; the answer adds the name exactly as
 *   stored in the staff member's profile, read live.
 * - **Moderação.** `moderation_log` rows of Window30 (`comment_removed`, `member_blocked`,
 *   `member_unblocked`; `role_changed` ignored) and `comments30`, the tenant's live comments of
 *   Window30, the removal rate's denominator.
 * - **Not measured (D-465).** No subject is ever written on a support conversation: `bySubject` is
 *   `{ measured: false, reason: 'needs_support_subject' }` and nothing else ("Em breve").
 *
 * EP-43: no message text, member name or member id travels in the payload or the answer. Every
 * object is `.strict()`, so an undeclared key fails the parse instead of travelling.
 */

const count = z.number().int().nonnegative();

/** Atendimento's weekly charts read this many blocks of 7 tenant-local days ending D. */
export const SUPPORT_WEEKS = 8;

/** The queue at build time; the oldest wait is a number exactly when someone waits. */
export const supportAwaitingSchema = z
  .object({ count, oldestHours: count.nullable() })
  .strict()
  .refine((queue) => (queue.count === 0) === (queue.oldestHours === null), {
    message: 'oldestHours is null exactly when nobody waits',
  });
export type SupportAwaiting = z.infer<typeof supportAwaitingSchema>;

export const supportModerationSchema = z
  .object({ removedComments: count, blocks: count, unblocks: count, comments30: count })
  .strict();
export type SupportModeration = z.infer<typeof supportModerationSchema>;

const weeklyMediansSchema = z.array(count.nullable()).length(SUPPORT_WEEKS);
const weeklyCountsSchema = z.array(count).length(SUPPORT_WEEKS);

/** `payload.support` as the builder stores it (v7): counts, minutes and staff user ids only. */
export const supportPayloadSchema = z
  .object({
    awaiting: supportAwaitingSchema,
    weeklyMedianMinutes: weeklyMediansSchema,
    weeklyConversations: weeklyCountsSchema,
    answeredByStaff: z.array(z.object({ userId: z.uuid(), conversations: count }).strict()),
    moderation: supportModerationSchema,
  })
  .strict();
export type SupportPayload = z.infer<typeof supportPayloadSchema>;

// ── the area answer (`GET /v1/dashboard/owner/support`) ────────────────────────────────────────

/** One staff member of the team: their user id, their name as stored, their conversations. */
export const ownerSupportStaffSchema = z
  .object({ userId: z.uuid(), name: z.string(), conversations: count })
  .strict();
export type OwnerSupportStaff = z.infer<typeof ownerSupportStaffSchema>;

export const ownerSupportReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    awaiting: supportAwaitingSchema,
    weeklyMedianMinutes: weeklyMediansSchema,
    weeklyConversations: weeklyCountsSchema,
    answeredByStaff: z.array(ownerSupportStaffSchema),
    bySubject: z
      .object({ measured: z.literal(false), reason: z.literal('needs_support_subject') })
      .strict(),
    moderation: supportModerationSchema,
  })
  .strict();
export type OwnerSupportReady = z.infer<typeof ownerSupportReadySchema>;

export const ownerSupportAnswerSchema = z.discriminatedUnion('state', [
  ownerSupportReadySchema,
  preparingSchema,
]);
export type OwnerSupportAnswer = z.infer<typeof ownerSupportAnswerSchema>;
