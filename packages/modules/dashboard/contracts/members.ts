import { z } from 'zod';
import { preparingSchema, snapshotMetaSchema } from './shared';

/**
 * The owner's "Membros" contract (08.7-02, D-465, D-440 [informational], UI-D-484, UI-D-486,
 * UI-D-487, INSIGHT-08): the engagement model every owner area stands on. One band definition lives
 * in SQL (`app.dashboard_member_rows`); these schemas carry its numbers, ids and numbers only in the
 * stored payload (PR-1), the live labels joined at read time in the answer.
 *
 * The bands (exclusive, the first that matches wins), over tenant-local days, D = the snapshot day:
 * `new` joined less than 30 days before D; `superfan` 12+ active days in D-29..D and 3+ strong
 * actions; `engaged` 4+ active days; `occasional` 1-3; `at_risk` none in D-29..D and at least one in
 * D-59..D-30; `inactive` none in D-59..D. Counted actions: like, comment, post, RSVP "vou", check-in
 * or walk-in, paid order, by role `member` only (UI-D-484).
 */

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();
/** Twelve 7-day blocks ending at the snapshot day, oldest first. */
const twelveWeeks = z.array(count).length(12);

/** The six bands in evaluation order: the same order as `ENGAGEMENT_BAND_ORDER` of the `ui` entry. */
export const ENGAGEMENT_BANDS = [
  'new',
  'superfan',
  'engaged',
  'occasional',
  'at_risk',
  'inactive',
] as const;
export const engagementBandSchema = z.enum(ENGAGEMENT_BANDS);
export type EngagementBandId = z.infer<typeof engagementBandSchema>;

/** Members per band: exact counts, small ones included (UI-D-486: bands are never floored). */
export const bandCountsSchema = z
  .object({
    new: count,
    superfan: count,
    engaged: count,
    occasional: count,
    at_risk: count,
    inactive: count,
  })
  .strict();

/** The bands of one scope plus `newActivated`: novos with at least one counted action. */
export const engagementBandsSchema = z
  .object({ counts: bandCountsSchema, newActivated: count })
  .strict();
export type EngagementBandsAnswer = z.infer<typeof engagementBandsSchema>;

/**
 * Band at D against band at D-30 on the ladder superfan > engaged > occasional > at_risk > inactive,
 * members new at either end left out (UI-D-487). `flows` lists every changed pair, most first.
 */
export const bandMovementSchema = z
  .object({
    up: count,
    down: count,
    flows: z.array(
      z.object({ from: engagementBandSchema, to: engagementBandSchema, members: count }).strict(),
    ),
  })
  .strict();
export type BandMovement = z.infer<typeof bandMovementSchema>;

/**
 * One joining month (`YYYY-MM`, tenant time) of the last 6 complete ones: the rounded percent of the
 * cohort with a counted action in each calendar month after joining, month 0 = 100 (UI-D-487).
 */
export const cohortRowSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    values: z.array(z.number().int().min(0).max(100)).min(1),
  })
  .strict();
export type CohortRow = z.infer<typeof cohortRowSchema>;

/**
 * One active community as the snapshot stores it: ids and numbers only. The base is
 * `app.community_viewer_ids` (an exclusive community's buyers) or every active member; `bands`
 * count only actions on that community's posts; `activeWeek` = members with such an action in
 * D-6..D; `posts` and `interactions` (member likes and comments) are of D-29..D.
 */
export const communityEngagementPayloadSchema = z
  .object({
    id: z.uuid(),
    bands: engagementBandsSchema,
    atRiskWithPush: count,
    members: count,
    activeWeek: count,
    posts: count,
    interactions: count,
  })
  .strict();

/** The answer's entry: the stored numbers plus the community's LIVE labels, read at request time. */
export const communityEngagementSchema = communityEngagementPayloadSchema
  .extend({
    name: z.string(),
    description: z.string(),
    coverAssetId: z.uuid().nullable(),
    /** Linked to a store product (`store_product_communities`): the base is its buyers. */
    exclusive: z.boolean(),
  })
  .strict();
export type CommunityEngagement = z.infer<typeof communityEngagementSchema>;

/** One panel event as stored: today's whole-base band of each RSVP "vou" (going or checked in). */
export const eventEngagementPayloadSchema = z
  .object({ id: z.uuid(), bands: engagementBandsSchema, atRiskWithPush: count })
  .strict();

/** The answer's entry: the stored numbers plus the event's LIVE labels. */
export const eventEngagementSchema = eventEngagementPayloadSchema
  .extend({
    title: z.string(),
    startsAt: instant,
    endsAt: instant,
    format: z.enum(['in_person', 'online']),
    coverAssetId: z.uuid().nullable(),
  })
  .strict();
export type EventEngagement = z.infer<typeof eventEngagementSchema>;

/**
 * The `members` key of a snapshot's payload, exactly as `app.dashboard_area_members` writes it. The
 * Membros answer reads most of it; the Visão geral answer reads `engagement`, `previousEngagement`,
 * `actions30`, `activeMembers30` and `weeklyInteracting` (raw counts, the web divides).
 */
export const membersPayloadSchema = z
  .object({
    growth: z.object({ joined: count, weeklyJoined: twelveWeeks }).strict(),
    engagement: engagementBandsSchema,
    /** Today's members by their band at D-30 (members not joined yet left out). */
    previousEngagement: engagementBandsSchema,
    movement: bandMovementSchema,
    cohorts: z.array(cohortRowSchema),
    atRiskWithPush: count,
    /** Counted actions of D-29..D, and the members with at least one. */
    actions30: count,
    activeMembers30: count,
    /** Distinct members with a counted action per 7-day block: 12 blocks ending D, and the 12 before. */
    weeklyInteracting: z.object({ current: twelveWeeks, previous: twelveWeeks }).strict(),
    communityEngagement: z.array(communityEngagementPayloadSchema),
    eventEngagement: z.array(eventEngagementPayloadSchema),
  })
  .strict();
export type MembersPayload = z.infer<typeof membersPayloadSchema>;

/**
 * "Saíram" and the balance (D-465): `memberships.deleted_at` is never written (no leave or removal
 * flow exists), so neither is ever a number; the answer says why instead.
 */
export const memberExitNotMeasuredSchema = z
  .object({ measured: z.literal(false), reason: z.literal('needs_member_exit') })
  .strict();

export const ownerMembersReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    growth: z
      .object({
        /** Members joined in D-29..D: the Visão geral's `newMembers`. */
        joined: count,
        weeklyJoined: twelveWeeks,
        left: memberExitNotMeasuredSchema,
        balance: memberExitNotMeasuredSchema,
      })
      .strict(),
    engagement: engagementBandsSchema,
    movement: bandMovementSchema,
    cohorts: z.array(cohortRowSchema),
    atRiskWithPush: count,
    /** Present only while `communities` is on (D-460). */
    communityEngagement: z.array(communityEngagementSchema).optional(),
    /** Present only while `events` is on (D-460). */
    eventEngagement: z.array(eventEngagementSchema).optional(),
  })
  .strict();
export type OwnerMembersReady = z.infer<typeof ownerMembersReadySchema>;

/** `{ state: 'preparing' }` (no number key at all) or the ready Membros answer. */
export const ownerMembersAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  ownerMembersReadySchema,
]);
export type OwnerMembersAnswer = z.infer<typeof ownerMembersAnswerSchema>;
