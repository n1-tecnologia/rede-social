import { z } from 'zod';
import { preparingSchema } from './shared';

/**
 * The member's own "Sua atividade" contract (08.7-03, D-455, D-456, D-457, D-458, D-463, D-464,
 * UI-D-475, UI-D-483, UI-D-485, INSIGHT-01..05, INSIGHT-16). The nightly build writes one `activity`
 * per member row (`app.dashboard_member_activity`); `GET /v1/dashboard/activity` serves the caller's
 * OWN row only and never takes a parameter (T-08.7-09).
 *
 * The report describes the member's own activity and never compares them with anyone (PR-3): no
 * rank, percentile, average or "membros como você" key exists here, and every object is strict, so
 * none can be added by accident.
 *
 * Windows (tenant-local days, D = the snapshot day): likes, comments, stories seen and communities
 * over D-6..D (`count`) against D-13..D-7 (`previous`); attendance over the events starting in
 * D-29..D; the week streak over Monday-first calendar weeks. Today never counts.
 */

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();

/** A count of the last 7 days and of the 7 before (the web derives the change, never the API). */
const windowPairSchema = z.object({ count, previous: count }).strict();

/** `attended` of `events` (UI-D-485): an integer pair, never a percent. */
const attendanceSchema = z
  .object({ attended: count, events: count })
  .strict()
  .refine((value) => value.attended <= value.events, {
    message: 'attended cannot exceed events',
  });

/** A metric the app does not collect yet, for ONE named reason (D-455): no value field exists. */
const notMeasuredFor = <R extends string>(reason: R) =>
  z.object({ measured: z.literal(false), reason: z.literal(reason) }).strict();

/**
 * The `activity` jsonb of a `dashboard_member_snapshots` row as the builder writes it: ids and
 * numbers only (PR-1). A row whose activity is null or fails this schema (an older builder) is
 * served as `preparing`.
 */
export const memberActivityPayloadSchema = z
  .object({
    likes: windowPairSchema,
    comments: windowPairSchema,
    storiesSeen: count,
    /** Likes and live comments on posts of D-6..D per community; `null` = the tenant-wide feed. */
    byCommunity: z.array(
      z.object({ communityId: z.uuid().nullable(), interactions: count }).strict(),
    ),
    attendance: attendanceSchema,
    weekStreak: count,
  })
  .strict();
export type MemberActivityPayload = z.infer<typeof memberActivityPayloadSchema>;

/**
 * One row of "Onde você mais participa" in the answer: the community's LIVE name, or `null` for the
 * tenant-wide feed (`communityId: null`, rendered "Início", UI-D-475). An id never travels without
 * its name and a name never without an id (EP-07): an unreadable community is dropped.
 */
export const memberActivityCommunitySchema = z
  .object({
    communityId: z.uuid().nullable(),
    name: z.string().min(1).nullable(),
    interactions: count,
  })
  .strict()
  .refine((row) => (row.communityId === null) === (row.name === null), {
    message: 'a community row carries both its id and its name, the tenant feed neither',
  });
export type MemberActivityCommunity = z.infer<typeof memberActivityCommunitySchema>;

/**
 * The ready answer. `byCommunity` is absent while `communities` is off and `attendance` while
 * `events` is off (planning decision 4): the web renders absence, never zeros. Usage, saves, shares,
 * posts seen and videos are always "Em breve" (D-455, D-458).
 */
export const memberActivityReadySchema = z
  .object({
    state: z.literal('ready'),
    /** The snapshot day and its build instant: the freshness line (D-464, UI-D-468). */
    snapshot: z.object({ day: z.iso.date(), builtAt: instant }).strict(),
    likes: windowPairSchema,
    comments: windowPairSchema,
    saves: notMeasuredFor('needs_saves'),
    shares: notMeasuredFor('needs_shares'),
    usage: notMeasuredFor('needs_usage_sessions'),
    seen: z
      .object({
        stories: count,
        posts: notMeasuredFor('needs_post_views'),
        videos: notMeasuredFor('needs_video_playback'),
      })
      .strict(),
    byCommunity: z.array(memberActivityCommunitySchema).optional(),
    attendance: attendanceSchema.optional(),
    weekStreak: count,
  })
  .strict();
export type MemberActivityReady = z.infer<typeof memberActivityReadySchema>;

/** `GET /v1/dashboard/activity`: `preparing` before the member's first build, else ready. */
export const memberActivityAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  memberActivityReadySchema,
]);
export type MemberActivityAnswer = z.infer<typeof memberActivityAnswerSchema>;

/** The five "Em breve" metrics of the member report, exactly as the answer carries them. */
export const MEMBER_ACTIVITY_NOT_MEASURED = {
  saves: { measured: false, reason: 'needs_saves' },
  shares: { measured: false, reason: 'needs_shares' },
  usage: { measured: false, reason: 'needs_usage_sessions' },
  posts: { measured: false, reason: 'needs_post_views' },
  videos: { measured: false, reason: 'needs_video_playback' },
} as const;
