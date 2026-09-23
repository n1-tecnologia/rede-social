import { z } from 'zod';

/**
 * The module's published contract surface (`@tria/module-communities/contracts`). Both the API and
 * the web app import from here — the same Zod schema validates the query in Hono, the body in the
 * route and the page payload in `apps/web/lib/communities.ts`, so there is exactly one definition of
 * what a community is (MOD-01).
 */

/**
 * `COMMUNITY_PAGE_SIZE` matches the feed's 10 rather than the member directory's 25: a
 * `card-magazine` card carries a 16/7 cover, so ten of them is already several screens on a phone.
 * The server clamps `limit` to `1..COMMUNITY_MAX_PAGE_SIZE`, so a crafted `?limit=100000` cannot ask
 * for an unbounded page (T-05-04).
 */
export const COMMUNITY_PAGE_SIZE = 10;
export const COMMUNITY_MAX_PAGE_SIZE = 25;

/**
 * The longest cursor this endpoint will look at — the `FEED_MAX_CURSOR_LENGTH` rule restated. The
 * envelope (`@tria/core/server/paging`) is a base64url JSON object carrying an ISO timestamp and a
 * uuid, so 512 characters is already generous; the bound exists so a megabyte of "cursor" is refused
 * before it is decoded.
 */
export const COMMUNITY_MAX_CURSOR_LENGTH = 512;

/**
 * Name and description caps, measured in **UTF-16 code units at both ends**: the browser `maxLength`
 * attribute, the `{n}/{max}` counter and the `.max()` below all count the same unit, so a name the
 * composer's counter accepts is never refused by the API and an emoji is never silently cut into a
 * lone surrogate (edge: encoding). This is exactly the `FEED_MAX_CAPTION` rule, restated for the two
 * fields this module owns.
 */
export const COMMUNITY_MAX_NAME = 80;
export const COMMUNITY_MAX_DESCRIPTION = 280;

/**
 * The closed refusal vocabulary a community WRITE can answer with, as `details.community`. The web
 * switches on it exhaustively and maps each to pt-BR copy, exactly as it does for
 * `FEED_MEDIA_ISSUES`.
 *
 * `name_required` is the empty-name refusal (a name is the one field a card cannot render without).
 * `archived` is declared now and raised by 05-04's write paths (COMM-04: publishing into an archived
 * community). Both are MACHINE codes — the pt-BR copy lives in the catalog, never here.
 *
 * A miss (unknown id, another tenant's, soft-deleted) is deliberately NOT in this vocabulary: it is
 * a BARE 404 with no `details` at all, because a per-cause code over an enumerable uuid space would
 * be an existence oracle (D-23, T-05-02).
 */
export const COMMUNITY_ISSUES = ['name_required', 'archived'] as const;
export type CommunityIssue = (typeof COMMUNITY_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.community`. */
export const COMMUNITY_ISSUE_SET: ReadonlySet<string> = new Set(COMMUNITY_ISSUES);

/** The status vocabulary, mirrored by `communities_status_chk`. */
export const COMMUNITY_STATUSES = ['active', 'archived'] as const;
export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

/** The membership role vocabulary of the born-unused `community_members`, mirrored by its CHECK. */
export const COMMUNITY_MEMBER_ROLES = ['member', 'moderator'] as const;
export type CommunityMemberRole = (typeof COMMUNITY_MEMBER_ROLES)[number];

/**
 * `GET /v1/communities?limit=&cursor=`. `.strict()`: an unknown query key fails loudly (the 03-03
 * rule).
 *
 * **`limit` CLAMPS rather than refuses**, which is the one deliberate departure from
 * `feedQuerySchema`'s `.min(1).max(…)`. This list is reachable from a navigation TAB, so a shared or
 * hand-edited `?limit=` must land the member on a page of communities rather than on an error
 * screen; the feed's stricter posture belongs to an endpoint only its own client calls. The clamp is
 * what T-05-04 asks for either way — no client value can widen the page — and `.catch()` makes the
 * whole field TOTAL, so `limit=abc` degrades to the default instead of 400ing.
 */
export const communityQuerySchema = z
  .object({
    cursor: z.string().max(COMMUNITY_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .catch(COMMUNITY_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), COMMUNITY_MAX_PAGE_SIZE))
      .default(COMMUNITY_PAGE_SIZE),
  })
  .strict();
export type CommunityQuery = z.infer<typeof communityQuerySchema>;

/**
 * One community as the list and the detail read project it (COMM-03's four fields plus the two the
 * URL and the ordering need).
 *
 * `coverAssetId` is NULLABLE (D-69) and carries `coverVariantWidths` beside it — the ladder
 * `MediaImage` needs for its `srcSet`, hydrated in the SAME statement the community row came from
 * (the query-budget rule). The payload carries an ASSET ID and a ladder, never a URL: `MediaImage`
 * derives `/v1/media/{assetId}/{variant}` itself, so a cached payload can never outlive a signed
 * Storage URL (R-05).
 *
 * There is deliberately **no owner/author field** (D-67). The organisation owns the container and
 * each post inside it already shows a face; a second byline on the container would compete with the
 * real one and invent an authorship claim the product does not make. `created_by_user_id` is stored
 * on the row for auditing and never reaches this shape.
 *
 * `lastActivityAt` crosses the wire because it IS the ordering key and the cursor is built from it;
 * the UI-SPEC forbids printing it (UI-D-42 drops the prototype's timestamp), and no shipped surface
 * renders it.
 */
export const communitySummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    coverAssetId: z.uuid().nullable(),
    /** The variant ladder of the cover asset; `[]` when there is no cover (D-69's gradient branch). */
    coverVariantWidths: z.array(z.number().int()),
    /** Trigger-owned (05-03). Always present, always an integer, never clamped. */
    postCount: z.number().int(),
    status: z.enum(COMMUNITY_STATUSES),
    lastActivityAt: z.string(),
  })
  .strict();
export type CommunitySummary = z.infer<typeof communitySummarySchema>;

/** One keyset page. `nextCursor` is non-null EXACTLY when another row exists (the over-fetch rule). */
export const communityPageSchema = z
  .object({
    items: z.array(communitySummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type CommunityPage = z.infer<typeof communityPageSchema>;

/**
 * `POST /v1/communities` (COMM-01).
 *
 * Deliberately NOT idempotent (edge: idempotency): two identical requests create two distinct
 * communities with two ids and two distinct slugs, and neither answers 409 — a create endpoint with
 * no client-supplied key cannot distinguish a retry from a genuine second container, and two
 * communities legitimately share a display name.
 *
 * `description` defaults to `''` rather than being nullable, matching the column
 * (`not null default ''`): "no description" is one value everywhere, so no renderer has to branch on
 * null and empty separately.
 */
export const createCommunitySchema = z
  .object({
    name: z.string().trim().max(COMMUNITY_MAX_NAME).default(''),
    description: z.string().trim().max(COMMUNITY_MAX_DESCRIPTION).default(''),
    coverAssetId: z.uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The one field a card cannot render without. The MACHINE code rides as the issue `message`
    // (there is nowhere else on a Zod issue to put one) and the route's `defaultHook` lifts it into
    // `details.community`.
    if (value.name.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'name_required' });
    }
  });
export type CreateCommunity = z.infer<typeof createCommunitySchema>;

/** The permission STRINGS, exported so the manifest and the web tier never retype them. */
export const COMMUNITY_PERMISSIONS = {
  manage: 'communities.community.manage',
} as const;

/**
 * Payload of the module's first domain event (MOD-03). **Ids only** — a community NAME must not
 * enter an event payload for the same reason a caption does not (T-04-05/T-05-06): the payload is
 * what a subscriber logs, and member-authored text has no business in a log line.
 */
export interface CommunityCreated {
  tenantId: string;
  communityId: string;
  actorUserId: string;
}

/**
 * MOD-02 in one block: the module teaches the KERNEL's `EventMap` about its own event instead of the
 * kernel knowing modules exist. Anything that imports this file gets `emit`/`subscribe` typed for it.
 */
declare module '@tria/contracts' {
  interface EventMap {
    'community.created': CommunityCreated;
  }
}
