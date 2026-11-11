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
 * uuid (the active list's timestamp prefixed by its position since 2026-10-03, a few characters more),
 * so 512 characters is already generous; the bound exists so a megabyte of "cursor" is refused
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
 *
 * 2026-10-03 adds one, and it is the only STATE refusal here (the events vocabulary's split: input
 * problems are `400 VALIDATION_FAILED`, state refusals are `409 CONFLICT`):
 *  - `order_stale` (`409`): a reorder named a set of ids that is not exactly the tenant's current
 *    ACTIVE communities. It is one code for every way the set can differ — a community created,
 *    archived or removed since the admin's screen loaded, and an id that is unknown or another
 *    tenant's — so it is not an existence oracle either: a foreign id and a random uuid answer the
 *    same bytes. The client's move is always the same one: reload the list and start again.
 *
 * 10-05 (D-710, MCOMM-05) appends `limit_reached`: the member already owns as many ACTIVE communities as the
 * tenant's `social` setting `communities.maxPerMember` allows (default 3), so a create, or a write that
 * REACTIVATES an archived one, is refused `400 VALIDATION_FAILED`. It is an input-class refusal the creator
 * can fix (archive or delete one), decided under the member's advisory lock so it cannot be raced.
 *
 * 2026-10-26 (09.3) adds the two STATE refusals of the delete (`409 CONFLICT`, D-553 and D-554):
 *  - `not_archived`: only an ARCHIVED community can be deleted. It is decided AFTER the
 *    tenant-scoped locking read, so a foreign community is the bare 404 and never this code.
 *  - `unlock_active`: an ACTIVE Loja product still unlocks the community. The answer carries
 *    `products` (at most `COMMUNITY_UNLOCK_NAMES_MAX` names) and `count` (the total), see
 *    `communityUnlockRefusalSchema`. Only a manager can reach it: the permission guard runs first.
 */
export const COMMUNITY_ISSUES = [
  'name_required',
  'archived',
  'cover_invalid',
  'order_stale',
  'not_archived',
  'unlock_active',
  'limit_reached',
] as const;
export type CommunityIssue = (typeof COMMUNITY_ISSUES)[number];

/**
 * The most product names the `unlock_active` refusal lists (D-554, assumption A2). The service and the
 * web read this one number: the screen says "e mais N" from `count`, the TOTAL of active products
 * that link the community.
 */
export const COMMUNITY_UNLOCK_NAMES_MAX = 5;

/**
 * `error.details` of `409 CONFLICT` when `community` is `unlock_active`: the active Loja products
 * that still unlock the community, newest first, at most `COMMUNITY_UNLOCK_NAMES_MAX` of them, and the
 * total. A plain (non-strict) object: the web parses `error.details` with it. Never an empty list.
 */
export const communityUnlockRefusalSchema = z.object({
  community: z.literal('unlock_active'),
  products: z
    .array(z.object({ id: z.uuid(), name: z.string() }))
    .min(1)
    .max(COMMUNITY_UNLOCK_NAMES_MAX),
  count: z.number().int().min(1),
});
export type CommunityUnlockRefusal = z.infer<typeof communityUnlockRefusalSchema>;

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
 * The most ids one reorder may carry (2026-10-03). Communities have no creation cap, so this bound
 * exists for the request rather than for the table: a body of 200 uuids is a few kilobytes, and a
 * crafted body of a million is refused by the contract before any lookup. It also bounds the screen
 * that sends it: the web loads the WHOLE active set before it offers a reorder (the order is one
 * permutation of every active community), and a tenant past this bound is told so instead of being
 * handed a partial list that every save would refuse as `order_stale`.
 */
export const COMMUNITY_MAX_ORDER = 200;

/** Whose a community is (10-03): the organization's, or a member's. Mirrors `communities_kind_chk`. */
export const COMMUNITY_KINDS = ['organization', 'member'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

/**
 * The creator of a MEMBER community as every member sees it (D-703): the membership id (what the profile
 * route takes), the display name and the avatar asset. Nothing else, ever: no user id, no e-mail. `.strict()`.
 */
export const communityCreatorSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string(),
    avatarAssetId: z.uuid().nullable(),
  })
  .strict();
export type CommunityCreator = z.infer<typeof communityCreatorSchema>;

/**
 * The Escopo seam (10-06): the five actions a viewer may take in a community, in ONE object so the per-product
 * action scope built after Phase 11 refines them at one site. Phase 10 values: `post` and `story` equal
 * `canPublish`; `like`, `comment` and `share` are `true` (no per-route permission guards them, D-701).
 */
export const communityActionsSchema = z
  .object({
    like: z.boolean(),
    comment: z.boolean(),
    share: z.boolean(),
    post: z.boolean(),
    story: z.boolean(),
  })
  .strict();
export type CommunityActions = z.infer<typeof communityActionsSchema>;

/** What THIS viewer may do in this community, computed on the server (10-06). */
export const communityViewerSchema = z
  .object({
    isOwner: z.boolean(),
    canPublish: z.boolean(),
    canEdit: z.boolean(),
    canCurate: z.boolean(),
    actions: communityActionsSchema,
  })
  .strict();
export type CommunityViewer = z.infer<typeof communityViewerSchema>;

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
 * **The creator (10-06, D-703; this REWRITES D-67).** D-67 said there is no owner/author field: the
 * organisation owns the container and each post inside it already shows a face. That still holds for an
 * ORGANIZATION community (`createdBy` is `null`, and `created_by_user_id` is never selected for it). A MEMBER
 * community is somebody's: `createdBy` is projected for those rows ONLY, as exactly three safe fields,
 * `{ membershipId, displayName, avatarAssetId }`, resolved in the same statement from the creator's LIVE
 * membership and profile (a blocked or departed creator hides the whole community instead, D-708). Never a
 * user id, an e-mail or any other profile field: the object is `.strict()` so a fourth key cannot be added by
 * accident, and `createdByUserId` has no field here at all (PR-2b).
 *
 * **The viewer's flags (10-06).** `viewer` is computed on the server from the route's permission flags and
 * the row, so the host never compares a role or an id: `isOwner` (the creator of a MEMBER community),
 * `canPublish` (may publish posts there), `canEdit` (may edit, archive, delete) and `canCurate` (may publish
 * stories for it). `viewer.actions` is the Escopo seam: the five actions the per-product action scope that is
 * built after Phase 11 will refine, `{ like, comment, share, post, story }`, required and `.strict()`, so
 * the five can never be silently absent. Today `post` and `story` equal `canPublish`, and `like`, `comment`
 * and `share` are `true` for every caller the community is returned to.
 *
 * `lastActivityAt` crosses the wire because it is an ordering key and the cursor is built from it;
 * the UI-SPEC forbids printing it (UI-D-42 drops the prototype's timestamp), and no shipped surface
 * renders it. Since 2026-10-03 it orders the ACTIVE list INSIDE the admin's `position` (see
 * `listCommunities`), and the position itself deliberately does not cross: the array order IS the
 * answer, and a number a client could sort by would be a second, stale copy of it.
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
    /** 10-06 (D-701): whose community this is. The wire never says more than this. */
    kind: z.enum(COMMUNITY_KINDS),
    /** 10-06 (D-703): the creator of a MEMBER community, exactly three safe keys; `null` for an organization one. */
    createdBy: communityCreatorSchema.nullable(),
    /** 10-06: what THIS viewer may do here, computed on the server (see the docblock above). */
    viewer: communityViewerSchema,
  })
  .strict();
export type CommunitySummary = z.infer<typeof communitySummarySchema>;

/**
 * One keyset page. `nextCursor` is non-null EXACTLY when another row exists (the over-fetch rule).
 *
 * `memberQuota` (10-06, D-710) is the caller's own allowance: `{ ownedActive, limit }` for a caller who may
 * create communities (a member of a `social` tenant), `null` for everybody else and for the answer of a
 * reorder. It is the one key a list of a tenant with no member community gains.
 */
export const communityPageSchema = z
  .object({
    items: z.array(communitySummarySchema),
    nextCursor: z.string().nullable(),
    memberQuota: z
      .object({ ownedActive: z.number().int(), limit: z.number().int() })
      .strict()
      .nullable(),
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

/**
 * `PUT /v1/communities/order` (2026-10-03) — the admin's order of the ACTIVE list, as ONE full
 * permutation: `ids` is every active community of the tenant, first to last.
 *
 * - **The whole set, never a move.** "Put X above Y" would be a second vocabulary to keep in step
 *   with the list, and two admins' moves would interleave into an order neither of them chose. A
 *   permutation is checked against the current set under a lock and either lands whole or not at
 *   all; when the set changed in between it is `409 { community: 'order_stale' }` (the service
 *   decides that, because only the database knows the current set).
 * - **Bounded** (`1..COMMUNITY_MAX_ORDER`): an empty body has nothing to order, and an oversized one
 *   is refused before any lookup.
 * - **No duplicates — refused HERE, as malformed input (400), not as a stale set (409).** A list
 *   naming one community twice is not a permutation of anything, whatever the database holds, so
 *   reloading could never fix it. Compared case-insensitively: `z.uuid()` accepts upper-case hex,
 *   and two spellings of one uuid are one community (uuid equality is Postgres', integration case
 *   32). The message is deliberately NOT a `COMMUNITY_ISSUES` code, so the route's `defaultHook`
 *   answers the plain `issues` list rather than inventing a `details.community` for it.
 * - `.strict()`: an unknown key fails loudly (the 03-03 rule).
 */
export const reorderCommunitiesSchema = z
  .object({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(COMMUNITY_MAX_ORDER)
      .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
        message: 'Cada comunidade aparece uma vez só.',
      }),
  })
  .strict();
export type ReorderCommunities = z.infer<typeof reorderCommunitiesSchema>;

/**
 * The permission STRINGS, exported so the manifest and the web tier never retype them.
 *
 * **`create` and `manageOwn` are MEMBER-ONLY BY CONSTRUCTION (10-05, D-707, assumption A2).** The app-tier
 * registry composes them for the role `member` only, and only while `social` and `communities` are
 * effective; no static role grant (the manifest's `defaultRolePermissions`) holds them and no staff role
 * ever does. The route guards authorise a write by ANY of `manage` or the member key, and then the
 * statement tests OWNERSHIP (`created_by_user_id = ctx.userId`) itself, never the role: the key says "may
 * try", the locked row says "may do". `manage` stays the organization's (admin) permission and keeps
 * reorder, the archived list of every creator and the store form to the admin.
 * `apps/api/tests/unit/registry.test.ts` (cases 23 to 25) pins the composition.
 */
export const COMMUNITY_PERMISSIONS = {
  manage: 'communities.community.manage',
  create: 'communities.community.create',
  manageOwn: 'communities.community.manage_own',
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
