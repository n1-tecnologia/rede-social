import { z } from 'zod';
import { engagementBandSchema } from './members';
import { preparingSchema, snapshotMetaSchema } from './shared';

/**
 * The named lists behind Membros (08.7-04, D-462, D-461, D-460, INSIGHT-09): a band's members (the
 * whole base, one community's base, one event's RSVPs "vou"), one member's detail, and the rows
 * behind each of that member's numbers. Read by `admin_tenant` of the same tenant ONLY (D-462): the
 * routes answer 403 to `member` and `support_tenant`, and a membership, community or event id of
 * another tenant is the bare 404, indistinguishable from an unknown one (EP-17).
 *
 * Band membership and the detail's numbers come from the latest build's member rows (the band list
 * holds exactly its band's count); names, avatars, titles and captions are read LIVE in the admin's
 * lane (PR-1: snapshots hold ids and numbers only). The rows behind a member's numbers are read live
 * between the snapshot's `from30At` and `untilAt`, never `now()`, so they agree with the numbers.
 *
 * Never on these schemas: a comment body, a support message text, an email, an offer id. Every
 * object is `.strict()`, so a key nobody declared fails the parse instead of travelling (T-08.7-14).
 */

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** What a band list counts: the whole base, one community's base, or one event's RSVPs "vou". */
export const OWNER_BAND_SCOPES = ['base', 'community', 'event'] as const;
export type OwnerBandScopeId = (typeof OWNER_BAND_SCOPES)[number];

/** The lists behind a member's measured numbers (D-461). "Publicações vistas" has none. */
export const OWNER_MEMBER_LISTS = ['active-days', 'likes', 'comments', 'strong-actions'] as const;
export type OwnerMemberListId = (typeof OWNER_MEMBER_LISTS)[number];

/** `limit` is clamped to 1..50 on every owner list (EP-21, T-08.7-15). */
export const OWNER_LIST_MAX_PAGE_SIZE = 50;
/** A band list's default page. */
export const OWNER_BAND_PAGE_SIZE = 10;
/** A member list's default page. */
export const OWNER_MEMBER_LIST_PAGE_SIZE = 20;
/** A cursor longer than this is not one of ours: it reads page 1 (EP-24). */
export const OWNER_LIST_MAX_CURSOR_LENGTH = 512;
/** A post's caption excerpt on a list row, cut on a word boundary server-side. */
export const OWNER_POST_EXCERPT_GRAPHEMES = 120;

/** A post's kind on the panel: the same split the member rows' `postTypes` use. */
export const OWNER_POST_TYPES = ['video', 'gallery', 'link', 'text'] as const;
export type OwnerPostType = (typeof OWNER_POST_TYPES)[number];

/** A metric the app does not collect yet, pinned to its one reason (D-455). */
const notMeasuredAs = <R extends string>(reason: R) =>
  z.object({ measured: z.literal(false), reason: z.literal(reason) }).strict();

/** Average minutes a day in the app: no usage sessions are recorded yet. */
export const dailyMinutesNotMeasuredSchema = notMeasuredAs('needs_usage_sessions');

/**
 * `GET /v1/dashboard/owner/members/bands/{band}?scope=&scopeId=&cursor=&limit=`. `scope` is a
 * closed enum (an unknown one is a 400, never a widened read); `scopeId` is required for
 * `community` and `event` (absent → the bare 404) and ignored for `base`. `cursor` and `limit` stay
 * raw strings: the paging helper degrades a bad one to page 1 or the default (EP-21, EP-24).
 */
export const ownerBandListQuerySchema = z
  .object({
    scope: z.enum(OWNER_BAND_SCOPES).default('base'),
    scopeId: z.uuid().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict();
export type OwnerBandListQuery = z.infer<typeof ownerBandListQuerySchema>;

/** `GET …/members/{membershipId}/lists/{list}?cursor=&limit=`. */
export const ownerMemberListQuerySchema = z
  .object({ cursor: z.string().optional(), limit: z.string().optional() })
  .strict();
export type OwnerMemberListQuery = z.infer<typeof ownerMemberListQuerySchema>;

export const ownerBandParamSchema = z.object({ band: engagementBandSchema }).strict();
export const ownerMemberParamSchema = z.object({ membershipId: z.uuid() }).strict();
export const ownerMemberListParamSchema = z
  .object({ membershipId: z.uuid(), list: z.enum(OWNER_MEMBER_LISTS) })
  .strict();

/** The member's top community (most actions since joining), its name read live. */
export const ownerTopCommunitySchema = z.object({ id: z.uuid(), name: z.string() }).strict();

/**
 * One member of a band list. `displayName` is sent exactly as stored (EP-24); `lastActiveAt` is the
 * member's latest counted action up to the snapshot's end (null: none ever); `topCommunity` is null
 * when the member acts on no community or `communities` is off.
 */
export const ownerBandMemberRowSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string(),
    avatarAssetId: z.uuid().nullable(),
    joinedAt: instant,
    lastActiveAt: instant.nullable(),
    topCommunity: ownerTopCommunitySchema.nullable(),
    dailyMinutes: dailyMinutesNotMeasuredSchema,
  })
  .strict();
export type OwnerBandMemberRow = z.infer<typeof ownerBandMemberRowSchema>;

/**
 * A page of a band list, ordered `last_active_at desc nulls last, membership_id desc` (EP-25).
 * `total` is the band count of that scope in the same build (EP-26): the rows of every page add up
 * to it. `nextCursor` is null on the last page (a band of exactly `limit` members included, EP-21).
 */
export const ownerBandListReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    total: count,
    rows: z.array(ownerBandMemberRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type OwnerBandListReady = z.infer<typeof ownerBandListReadySchema>;

export const ownerBandListAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  ownerBandListReadySchema,
]);
export type OwnerBandListAnswer = z.infer<typeof ownerBandListAnswerSchema>;

/**
 * One member's detail (the port of the fixtures' `OwnerMemberInsights`): relative moments became
 * ISO instants, the offer id is gone (no offer table) and `expiresAt` is never a date
 * (`needs_access_expiry`). The module-gated parts are OMITTED, never zeroed, when their module is
 * off (planning decision 3): `topCommunity` and `communities` (communities), `events` (events),
 * `purchases` (store), `support` (chat).
 */
export const ownerMemberDetailReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    member: z
      .object({
        membershipId: z.uuid(),
        displayName: z.string(),
        avatarAssetId: z.uuid().nullable(),
        joinedAt: instant,
        lastActiveAt: instant.nullable(),
        band: engagementBandSchema,
      })
      .strict(),
    topCommunity: ownerTopCommunitySchema.nullable().optional(),
    /** The bands at D-60, D-30 and D (`YYYY-MM` of each anchor, oldest first); null before joining. */
    bandHistory: z
      .array(z.object({ month, band: engagementBandSchema.nullable() }).strict())
      .length(3),
    /** The member row's numbers of D-29..D. Strong actions = comments, check-ins, paid orders. */
    last30: z
      .object({
        activeDays: count,
        likes: count,
        comments: count,
        checkIns: count,
        orders: count,
        strongActions: count,
        dailyMinutes: dailyMinutesNotMeasuredSchema,
        postsSeen: notMeasuredAs('needs_post_views'),
      })
      .strict(),
    /** Active days per 7-day block ending D, oldest first. */
    weeklyActiveDays: z.array(count).length(12),
    /** Actions since joining per community (the tenant-wide feed as `communityId: null`), most first. */
    communities: z
      .array(
        z
          .object({ communityId: z.uuid().nullable(), name: z.string().nullable(), actions: count })
          .strict(),
      )
      .optional(),
    /** Likes and comments since joining per post kind, most first. */
    postTypes: z.array(z.object({ type: z.enum(OWNER_POST_TYPES), interactions: count }).strict()),
    /** RSVPs "vou" and walk-ins, oldest first: attended true, false, or null for one still to come. */
    events: z
      .array(
        z
          .object({
            eventId: z.uuid(),
            title: z.string(),
            startsAt: instant,
            attended: z.boolean().nullable(),
          })
          .strict(),
      )
      .optional(),
    /** Paid orders before the snapshot's end, oldest first; `primary` = the member's first one. */
    purchases: z
      .array(
        z
          .object({
            orderId: z.uuid(),
            productId: z.uuid(),
            productName: z.string(),
            kind: z.enum(['primary', 'secondary']),
            paidAt: instant,
            cents: count,
            expiresAt: notMeasuredAs('needs_access_expiry'),
          })
          .strict(),
      )
      .optional(),
    /** Support turns of the last 8 weeks: counts and minutes only, never a word of a message. */
    support: z
      .object({
        conversations: count,
        lastDaysAgo: count.nullable(),
        medianResponseMinutes: count.nullable(),
      })
      .strict()
      .optional(),
    /** What to do next: the band, and days since joining (`new`) or since the last action. */
    suggestion: z.object({ kind: engagementBandSchema, days: count }).strict(),
  })
  .strict();
export type OwnerMemberDetailReady = z.infer<typeof ownerMemberDetailReadySchema>;

export const ownerMemberDetailAnswerSchema = z.discriminatedUnion('state', [
  preparingSchema,
  ownerMemberDetailReadySchema,
]);
export type OwnerMemberDetailAnswer = z.infer<typeof ownerMemberDetailAnswerSchema>;
