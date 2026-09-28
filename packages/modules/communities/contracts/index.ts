import { z } from 'zod';

/**
 * The module's published contract surface (`@rede-social/module-communities/contracts`). Both the API and
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
 * envelope (`@rede-social/core/server/paging`) is a base64url JSON object carrying an ISO timestamp and a
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
 * community). `cover_invalid` (05-09) is a REAL asset of THIS tenant that cannot serve as a cover —
 * the wrong `purpose`, the wrong `kind`, or a `status` that is not yet `ready`. All three are
 * MACHINE codes — the pt-BR copy lives in the catalog, never here.
 *
 * A miss (unknown id, another tenant's, soft-deleted) is deliberately NOT in this vocabulary: it is
 * a BARE 404 with no `details` at all, because a per-cause code over an enumerable uuid space would
 * be an existence oracle (D-23, T-05-02). That paragraph is now load-bearing TWICE — for a missing
 * COMMUNITY and for a missing COVER ASSET — which is why `cover_invalid` covers only the case the
 * caller can see and fix, and never the case that would tell them whose asset it is.
 */
export const COMMUNITY_ISSUES = ['name_required', 'archived', 'cover_invalid'] as const;
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
 * `GET /v1/communities?limit=&cursor=&status=`. `.strict()`: an unknown query key fails loudly (the 03-03
 * rule).
 *
 * **`limit` CLAMPS rather than refuses**, which is the one deliberate departure from
 * `feedQuerySchema`'s `.min(1).max(…)`. This list is reachable from a navigation TAB, so a shared or
 * hand-edited `?limit=` must land the member on a page of communities rather than on an error
 * screen; the feed's stricter posture belongs to an endpoint only its own client calls. The clamp is
 * what T-05-04 asks for either way — no client value can widen the page — and `.catch()` makes the
 * whole field TOTAL, so `limit=abc` degrades to the default instead of 400ing.
 *
 * **`status` is the list's status filter (05.1, D-88/D-89).** ABSENT means `active`, which is today's
 * list byte for byte: every member keeps receiving exactly the page they received before this field
 * existed. `archived` pages the archived set instead — most recently archived first (D-91) — and is
 * answered ONLY to a caller holding `communities.community.manage`; the route refuses anybody else
 * with 403 rather than serving or coercing (D-89). Each value is its own keyset, so a cursor never
 * spans two statuses.
 *
 * Unlike `limit`, `status` does NOT clamp or catch. No navigation tab ever sends it — the web
 * translates its own pt-BR URL value and sends `archived` only for a manager — so a bad value can
 * only come from a crafted call, and an explicit 400 is the honest answer. The comparison is the
 * closed enum, exact and case-sensitive: `ARCHIVED` and `deleted` are 400, never a widened read.
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
    status: z.enum(COMMUNITY_STATUSES).default('active'),
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

/**
 * `PATCH /v1/communities/{communityId}` (COMM-01, 05-04) — edit, archive and reactivate, in ONE
 * schema and ONE endpoint.
 *
 * **Archive is a STATUS WRITE, not a separate verb.** `POST /{id}/archive` +
 * `POST /{id}/reactivate` would be two routes, two guards and two service functions for one
 * column, and the pair would eventually disagree about what an already-archived community answers.
 * Here the answer falls out of the shape: `status` is just another optional field.
 *
 * **Every field is optional and `.strict()`.** A PATCH carries only what changes, an absent field
 * means "leave it", and an unknown key fails loudly. `coverAssetId` is `.nullable()` so `null` is
 * the REMOVE affordance ("no cover" is a value the admin can choose, D-69/UI-D-38) — which is also
 * why it cannot be merged with "absent".
 *
 * `slug` is deliberately NOT here. It is derived from the name at creation and then frozen: a
 * rename must not break a link somebody already sent (D-56's precedent), and the URL is the id.
 */
export const updateCommunitySchema = z
  .object({
    name: z.string().trim().max(COMMUNITY_MAX_NAME).optional(),
    description: z.string().trim().max(COMMUNITY_MAX_DESCRIPTION).optional(),
    coverAssetId: z.uuid().nullable().optional(),
    status: z.enum(COMMUNITY_STATUSES).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The SAME rule the create path states, for the same reason: a community with no name has
    // nothing for a card to render. The MACHINE code rides as the issue `message` and the route's
    // `defaultHook` lifts it into `details.community`.
    if (value.name !== undefined && value.name.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'name_required' });
    }
  });
export type UpdateCommunity = z.infer<typeof updateCommunitySchema>;

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
 * A content change (name, description or cover) landed. Ids only, for the same reason
 * `CommunityCreated` is: the payload is what a subscriber logs, and member-facing text has no
 * business in a log line (T-05-06). There is deliberately no "what changed" field — a diff in an
 * event payload is the shortest path to a NAME in a log.
 */
export interface CommunityUpdated {
  tenantId: string;
  communityId: string;
  actorUserId: string;
}

/**
 * The TRANSITION into `archived`, announced exactly once. Archiving an already-archived community
 * answers 200 and emits nothing: a subscriber counting these is counting transitions, and a second
 * announcement of a state that never changed would be a lie it cannot detect.
 *
 * The reverse transition has no event in V1 — nothing subscribes to it, and an event nobody reads is
 * a payload shape frozen for free. Adding `community.reactivated` later is one line here.
 */
export interface CommunityArchived {
  tenantId: string;
  communityId: string;
  actorUserId: string;
}

/**
 * MOD-02 in one block: the module teaches the KERNEL's `EventMap` about its own events instead of
 * the kernel knowing modules exist. Anything that imports this file gets `emit`/`subscribe` typed
 * for them.
 */
declare module '@rede-social/contracts' {
  interface EventMap {
    'community.created': CommunityCreated;
    'community.updated': CommunityUpdated;
    'community.archived': CommunityArchived;
  }
}
