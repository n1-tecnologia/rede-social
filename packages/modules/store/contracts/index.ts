import { priceCentsSchema } from '@rede-social/contracts/money';
import { z } from 'zod';

/**
 * The store module's published contract surface (`@rede-social/module-store/contracts`). The API
 * validates bodies with these schemas and the web (plan 07 on) parses answers with them, so there is
 * exactly one definition of what a product is (MOD-01).
 *
 * Two facts a reader must not "fix":
 *
 * 1. **The purchase body carries `expectedAmountCents`, never an amount to charge** (D-361,
 *    T-08.2-04). The amount comes from the product row inside `app.store_purchase`; the body is only
 *    a staleness check that answers `409 { store: 'price_changed' }` when the price moved.
 * 2. **Money is integer cents** (`priceCentsSchema` from `@rede-social/contracts/money`, never a
 *    local copy). Formatting is the web's job at the display edge.
 */

/**
 * Field caps, measured on the TRIMMED string, the communities rule. One precision (08.2-05, P09):
 * Zod 4's `.max()` counts CODE POINTS, while the browser `maxLength` and a JS `.length` counter
 * count UTF-16 code units. The two agree on every character of the Basic Multilingual Plane; an
 * astral character (an emoji) counts twice in the browser and once here, so the form is the
 * stricter side and never sends a value the API refuses.
 */
export const STORE_MAX_NAME = 80;
export const STORE_MAX_DESCRIPTION = 2000;
/** The most communities (and, 08.4, the most courses and the most lives) one product may open. */
export const STORE_MAX_LINKS = 50;

/**
 * The closed refusal vocabulary, lifted into `details.store`:
 *  - `400 VALIDATION_FAILED`: `name_required`, `name_too_long`, `description_too_long`,
 *    `price_invalid`, `image_invalid` (an asset of THIS tenant that is not a ready `cover` image; an
 *    unknown or foreign one is a bare 404), `community_invalid` (not an active community of this
 *    tenant, or not a uuid), `too_many_communities`, `course_invalid` (not a draft or published course
 *    of this tenant nor one already linked to this product, or not a uuid), `too_many_courses`,
 *    `live_invalid` (not a non-cancelled live of this tenant nor one already linked to this product,
 *    or not a uuid), `too_many_lives` (08.4, D-418);
 *  - `409 CONFLICT`: `unavailable` (the product is archived), `price_changed` (the price moved) and
 *    `community_deleted` (09.3 WR-03: reactivating a product that links a deleted community).
 */
export const STORE_ISSUES = [
  'name_required',
  'name_too_long',
  'description_too_long',
  'price_invalid',
  'image_invalid',
  'community_invalid',
  'too_many_communities',
  'course_invalid',
  'too_many_courses',
  'live_invalid',
  'too_many_lives',
  'unavailable',
  'price_changed',
  'community_deleted',
] as const;
export type StoreIssue = (typeof STORE_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.store`. */
export const STORE_ISSUE_SET: ReadonlySet<string> = new Set(STORE_ISSUES);

/** The permission STRINGS, exported so the manifest and the web tier never retype them (D-338). */
export const STORE_PERMISSIONS = {
  manage: 'store.product.manage',
} as const;

/**
 * The product's field rules, ONE definition shared by the create body and the patch body (08.2-05),
 * so a name that passes one passes the other. Defaults live on the create body only: a patch that
 * omits a key leaves that column alone.
 */
const productNameField = z
  .string()
  .trim()
  .min(1, 'name_required')
  .max(STORE_MAX_NAME, 'name_too_long');
const productDescriptionField = z
  .string()
  .trim()
  .max(STORE_MAX_DESCRIPTION, 'description_too_long');
const productImageField = z.uuid('image_invalid').nullable();
const productCommunityIdsField = z
  .array(z.uuid('community_invalid'))
  .max(STORE_MAX_LINKS, 'too_many_communities');
const productCourseIdsField = z
  .array(z.uuid('course_invalid'))
  .max(STORE_MAX_LINKS, 'too_many_courses');
const productLiveIdsField = z.array(z.uuid('live_invalid')).max(STORE_MAX_LINKS, 'too_many_lives');
/** A SET: duplicates collapse (first occurrence kept), after the cap is checked on what was sent. */
const dedupe = (ids: string[]) => [...new Set(ids)];

/**
 * `POST /v1/store/products`. `communityIds`, `courseIds` and `liveIds` are SETS: duplicates collapse
 * (first occurrence kept), after the cap is checked on what was sent. Since 08.4 (D-418) the product
 * form is the ONLY place a course or a live is linked to a product. `.strict()`: an unknown key
 * fails loudly.
 */
export const productInputSchema = z
  .object({
    name: productNameField,
    description: productDescriptionField.default(''),
    priceCents: priceCentsSchema,
    imageAssetId: productImageField.default(null),
    communityIds: productCommunityIdsField.default([]).transform(dedupe),
    courseIds: productCourseIdsField.default([]).transform(dedupe),
    liveIds: productLiveIdsField.default([]).transform(dedupe),
  })
  .strict();
export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * `PATCH /v1/store/products/{productId}` (08.2-05, D-363): any subset of the create body's keys, at
 * least one. Built from the same field rules WITHOUT their defaults (a `.partial()` of the create
 * body would keep `description: ''`, `imageAssetId: null` and `communityIds: []` and silently wipe
 * them). `communityIds`, when present, REPLACES the product's links to ACTIVE communities (the set
 * the product read lists): the product form is the ONLY place a link is written (one write path).
 * Links to archived or removed communities are kept (08.2 review CR-02): the form cannot show or
 * re-send them, and dropping one would open that community to every member without access.
 * `courseIds` and `liveIds` (08.4, D-418), when present, each REPLACE their own set the same way:
 * a replace removes only links to linkable targets (draft or published courses, non-cancelled lives)
 * that are not in the sent set, so a link to an ARCHIVED course or a CANCELLED live is kept on every
 * replace and accepted when re-sent (the 08.3 WR-04 rule, mirrored). A new
 * `priceCents` changes only the product row; existing orders keep their snapshotted amount (D-361).
 */
export const productPatchSchema = z
  .object({
    name: productNameField.optional(),
    description: productDescriptionField.optional(),
    priceCents: priceCentsSchema.optional(),
    imageAssetId: productImageField.optional(),
    communityIds: productCommunityIdsField.transform(dedupe).optional(),
    courseIds: productCourseIdsField.transform(dedupe).optional(),
    liveIds: productLiveIdsField.transform(dedupe).optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type ProductPatch = z.infer<typeof productPatchSchema>;

/** A community a product opens, as a card needs it. */
export const productCommunitySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    coverAssetId: z.uuid().nullable(),
  })
  .strict();
export type ProductCommunity = z.infer<typeof productCommunitySchema>;

/** The course states a product may list (the linkable ones; an archived course is kept but not listed). */
export const PRODUCT_COURSE_STATUSES = ['draft', 'published'] as const;

/** A course a product opens, as the manager's product form needs it (08.4, manager-only). */
export const productCourseSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    coverAssetId: z.uuid().nullable(),
    status: z.enum(PRODUCT_COURSE_STATUSES),
  })
  .strict();
export type ProductCourse = z.infer<typeof productCourseSchema>;

/**
 * The live states a product may list: the courses module's `liveStatusAt` boundaries, projected in
 * the store's SQL (a cancelled live is kept but not listed).
 */
export const PRODUCT_LIVE_STATUSES = ['scheduled', 'live', 'recorded'] as const;

/** A live a product opens, as the manager's product form needs it (08.4, manager-only). */
export const productLiveSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    coverAssetId: z.uuid().nullable(),
    startsAt: z.iso.datetime(),
    status: z.enum(PRODUCT_LIVE_STATUSES),
  })
  .strict();
export type ProductLive = z.infer<typeof productLiveSchema>;

/**
 * A PUBLISHED course a product unlocks, as the product page and "Compra concluída" name it for
 * EVERY caller (08.5-05, D-425, STORE-06 / STORE-07 amended). Never a draft or an archived course.
 */
export const productUnlockCourseSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    coverAssetId: z.uuid().nullable(),
  })
  .strict();
export type ProductUnlockCourse = z.infer<typeof productUnlockCourseSchema>;

/**
 * A NON-CANCELLED live a product unlocks, for every caller (08.5-05, D-425): a live locked for the
 * caller is still named (it is read through the tenant-pinned card function, never the lane's live
 * select). `startsAt` is ISO 8601 UTC; the web formats it in the tenant's timezone.
 */
export const productUnlockLiveSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    coverAssetId: z.uuid().nullable(),
    startsAt: z.iso.datetime(),
  })
  .strict();
export type ProductUnlockLive = z.infer<typeof productUnlockLiveSchema>;

export const PRODUCT_STATUSES = ['active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * `PUT /v1/store/products/{productId}/status` (08.2-05, decision 3): idempotent, one verb for both
 * directions. Archiving stops NEW purchases only; it touches no link and no entitlement.
 */
export const productStatusBodySchema = z.object({ status: z.enum(PRODUCT_STATUSES) }).strict();
export type ProductStatusBody = z.infer<typeof productStatusBodySchema>;

/**
 * `POST /v1/store/products/lock-preview` (08.2-05, D-364, STORE-04): the communities the admin is
 * about to link, and the product being edited (absent for a new product). Ids are a SET.
 */
export const lockPreviewBodySchema = z
  .object({
    productId: z.uuid().optional(),
    communityIds: z
      .array(z.uuid('community_invalid'))
      .min(1)
      .max(STORE_MAX_LINKS, 'too_many_communities')
      .transform(dedupe),
  })
  .strict();
export type LockPreviewBody = z.infer<typeof lockPreviewBodySchema>;

/**
 * One row per NEWLY locking community: a sent id that is a live active community of the tenant and
 * has NO link to any product today. `membersLosingAccess` is an exact `count(*)` of live
 * `member`-role memberships holding no active entitlement to `productId` (every live member for a
 * new product); staff are never counted (P16).
 */
export const lockPreviewSchema = z
  .object({
    items: z.array(
      z
        .object({
          communityId: z.uuid(),
          membersLosingAccess: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type LockPreview = z.infer<typeof lockPreviewSchema>;

/**
 * How a product is bought in the caller's tenant (09.1-06, D-506, D-508): `gateway` when the tenant has a
 * payment integration (a purchase leaves the app through `checkoutUrl`, the stored `https:` link of the
 * product, or `null` when none is stored: such a product is not buyable), `simulated` otherwise (the
 * 08.2 purchase, `checkoutUrl` always null). The store reads the mode from the database by SQL name and
 * knows no gateway. OPTIONAL on the card and the detail on purpose (the 08.2 Pitfall 10 rule: an older
 * web never meets a new required key); an absent `purchase` means simulated.
 */
export const PURCHASE_MODES = ['gateway', 'simulated'] as const;
export type PurchaseMode = (typeof PURCHASE_MODES)[number];
export const purchaseInfoSchema = z
  .object({
    mode: z.enum(PURCHASE_MODES),
    checkoutUrl: z.url({ protocol: /^https$/ }).nullable(),
  })
  .strict();
export type PurchaseInfo = z.infer<typeof purchaseInfoSchema>;

/**
 * One product. `owned` is the CALLER's active entitlement; `communities` are its ACTIVE, live
 * linked communities in the Comunidades list order (`[]` when it opens none, D-353).
 * `holderCount` (08.2-05) is present only for a caller holding `store.product.manage`: the number
 * of active entitlements, exact (`count(*)`), for the "Compradores" sub-line. `courses` (linkable
 * linked courses, newest first) and `lives` (non-cancelled linked lives, soonest first) are present
 * only for a caller holding `store.product.manage`, like `holderCount` (08.4): they are the product
 * FORM's lists (drafts included), so a draft course's title never reaches a member.
 *
 * `unlockedCourses` and `unlockedLives` (08.5-05, D-425, STORE-06 amended) are present for EVERY
 * caller: the PUBLISHED courses the product unlocks (`published_at desc, id desc`) and its
 * NON-CANCELLED lives (`starts_at asc, id asc`), a live locked for the caller included. Both are `[]`
 * while the tenant's `courses` module is off, even when links exist. The manager-only `courses` /
 * `lives` keep the meaning 08.4 gave them.
 */
export const productDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    priceCents: z.number().int(),
    currency: z.literal('BRL'),
    imageAssetId: z.uuid().nullable(),
    status: z.enum(PRODUCT_STATUSES),
    owned: z.boolean(),
    communities: z.array(productCommunitySchema),
    holderCount: z.number().int().min(0).optional(),
    courses: z.array(productCourseSchema).optional(),
    lives: z.array(productLiveSchema).optional(),
    unlockedCourses: z.array(productUnlockCourseSchema),
    unlockedLives: z.array(productUnlockLiveSchema),
    purchase: purchaseInfoSchema.optional(),
  })
  .strict();
export type ProductDetail = z.infer<typeof productDetailSchema>;

/** One catalogue page (08.2-05): 20 cards, at most 50 when a caller asks. */
export const STORE_PAGE_SIZE = 20;
export const STORE_MAX_PAGE_SIZE = 50;
/** The longest cursor the list will look at (the `EVENT_MAX_CURSOR_LENGTH` rule). */
export const STORE_MAX_CURSOR_LENGTH = 512;

/**
 * The catalogue filters (D-352). The web maps its pt-BR `?filtro=` to these:
 *  - `all`: the tenant's ACTIVE products, newest first;
 *  - `owned`: every product the caller holds an active entitlement to, ARCHIVED ones included,
 *    newest entitlement first (a buyer's history stays whole, decision 3);
 *  - `archived`: archived products, newest first; `403` without `store.product.manage`.
 */
export const PRODUCT_FILTERS = ['all', 'owned', 'archived'] as const;
export type ProductFilter = (typeof PRODUCT_FILTERS)[number];

/**
 * `GET /v1/store/products?filter=&cursor=&limit=`. `.strict()`: an unknown query key fails loudly.
 * Every bound is a 400, never a widened read: a bad `filter`, a `limit` outside `1..50`, and a
 * cursor longer than 512 characters (a tampered cursor of the right length is refused by the
 * service, P17).
 */
export const productListQuerySchema = z
  .object({
    filter: z.enum(PRODUCT_FILTERS).default('all'),
    cursor: z.string().max(STORE_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(STORE_MAX_PAGE_SIZE).default(STORE_PAGE_SIZE),
  })
  .strict();
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/** One product on a catalogue card. `owned` is the CALLER's active entitlement. */
export const productCardSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    priceCents: z.number().int(),
    currency: z.literal('BRL'),
    imageAssetId: z.uuid().nullable(),
    status: z.enum(PRODUCT_STATUSES),
    owned: z.boolean(),
    purchase: purchaseInfoSchema.optional(),
  })
  .strict();
export type ProductCard = z.infer<typeof productCardSchema>;

/** One keyset page. `nextCursor` is non-null EXACTLY when another row exists (over-fetch by one). */
export const productPageSchema = z
  .object({
    items: z.array(productCardSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type ProductPage = z.infer<typeof productPageSchema>;

/**
 * `GET /v1/store/community-access` (STORE-12, Assumption A3): one row per GATED community (linked
 * to at least one product). An open community has NO row, so the web draws no tag for it.
 *  - `locked`: closed for the CALLER right now (`app.community_locked_ids()`; always false for
 *    staff, who read everything);
 *  - `gated`: always true here (a row exists only for a gated community);
 *  - `archivedTag`: true exactly when NONE of its linked products is active (P43).
 */
export const communityAccessItemSchema = z
  .object({
    communityId: z.uuid(),
    locked: z.boolean(),
    gated: z.boolean(),
    archivedTag: z.boolean(),
  })
  .strict();
export type CommunityAccessItem = z.infer<typeof communityAccessItemSchema>;

export const communityAccessListSchema = z
  .object({ items: z.array(communityAccessItemSchema) })
  .strict();
export type CommunityAccessList = z.infer<typeof communityAccessListSchema>;

/** A product that opens a community and can be bought today (active), for the choice sheet. */
export const buyableProductSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    priceCents: z.number().int(),
    imageAssetId: z.uuid().nullable(),
  })
  .strict();
export type BuyableProduct = z.infer<typeof buyableProductSchema>;

/** A product linked to a community, as the manager's read-only "Liberada pelos produtos" lists it. */
export const communityProductSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(PRODUCT_STATUSES),
  })
  .strict();
export type CommunityProduct = z.infer<typeof communityProductSchema>;

/**
 * `GET /v1/store/communities/{communityId}/access` (STORE-14, decision 9; D-363 read side).
 * `buyableProducts` are the community's ACTIVE linked products, newest first (P55); zero means the
 * web hides the locked page's top section. `products` (every linked product, archived included,
 * with its status) is present ONLY for a caller holding `store.product.manage`: members never
 * receive it (T-08.2-28).
 */
export const communityAccessSchema = z
  .object({
    communityId: z.uuid(),
    locked: z.boolean(),
    gated: z.boolean(),
    archivedTag: z.boolean(),
    buyableProducts: z.array(buyableProductSchema),
    products: z.array(communityProductSchema).optional(),
  })
  .strict();
export type CommunityAccess = z.infer<typeof communityAccessSchema>;

// ── 08.5-05: course and live access reads (STORE-23, D-421, D-424) ─────────────────────────────

/**
 * `GET /v1/store/course-access` (STORE-23, D-421): the community list's twin for courses. One row
 * per PUBLISHED course of the tenant linked to at least one product; an open course has NO row, so
 * the web draws no tag for it.
 *  - `locked`: closed for the CALLER right now (`app.course_locked_ids()`; always false for staff);
 *  - `gated`: always true here (a row exists only for a gated course);
 *  - `archivedTag`: true exactly when NONE of its linked products is active ("Produto arquivado").
 * Rows follow the member catalogue's order (`published_at desc, id desc`). With the tenant's
 * `courses` module off the list is `{ items: [] }`.
 */
export const courseAccessItemSchema = z
  .object({
    courseId: z.uuid(),
    locked: z.boolean(),
    gated: z.boolean(),
    archivedTag: z.boolean(),
  })
  .strict();
export type CourseAccessItem = z.infer<typeof courseAccessItemSchema>;

export const courseAccessListSchema = z.object({ items: z.array(courseAccessItemSchema) }).strict();
export type CourseAccessList = z.infer<typeof courseAccessListSchema>;

/**
 * `GET /v1/store/courses/{courseId}/access` (STORE-23, D-424): the buy section of a locked course,
 * the `communityAccessSchema` twin. `buyableProducts` are the course's ACTIVE linked products,
 * newest first (`created_at desc, id desc`): one opens the product, several open the picker, zero
 * hides the section. `products` (every linked product, archived included, with its status) is
 * present ONLY for a caller holding `store.product.manage`: members never receive it (T-08.5-11).
 * An open course answers `gated: false`, `locked: false`, `archivedTag: false`, no buyable product.
 */
export const courseAccessSchema = z
  .object({
    courseId: z.uuid(),
    locked: z.boolean(),
    gated: z.boolean(),
    archivedTag: z.boolean(),
    buyableProducts: z.array(buyableProductSchema),
    products: z.array(communityProductSchema).optional(),
  })
  .strict();
export type CourseAccess = z.infer<typeof courseAccessSchema>;

/**
 * `GET /v1/store/live-access` (STORE-23, D-421): one row per live of the tenant linked to at least
 * one product (a cancelled one included, for its agenda card), soonest first (`starts_at asc,
 * live_id asc`). `locked` comes from `app.live_locked_ids()` (always false for staff); `archivedTag`
 * as for courses. An open live has no row; with `courses` off the list is `{ items: [] }`.
 */
export const liveAccessItemSchema = z
  .object({
    liveId: z.uuid(),
    locked: z.boolean(),
    gated: z.boolean(),
    archivedTag: z.boolean(),
  })
  .strict();
export type LiveAccessItem = z.infer<typeof liveAccessItemSchema>;

export const liveAccessListSchema = z.object({ items: z.array(liveAccessItemSchema) }).strict();
export type LiveAccessList = z.infer<typeof liveAccessListSchema>;

/**
 * `GET /v1/store/lives/{liveId}/access` (STORE-23, D-424): the buy section of a locked live, the
 * `courseAccessSchema` rules over the live's linked products (`products` manager-only).
 */
export const liveAccessSchema = z
  .object({
    liveId: z.uuid(),
    locked: z.boolean(),
    gated: z.boolean(),
    archivedTag: z.boolean(),
    buyableProducts: z.array(buyableProductSchema),
    products: z.array(communityProductSchema).optional(),
  })
  .strict();
export type LiveAccess = z.infer<typeof liveAccessSchema>;

/** `POST /v1/store/products/{productId}/purchase`: the price the buyer SAW (fact 1). */
export const purchaseBodySchema = z
  .object({
    expectedAmountCents: priceCentsSchema,
  })
  .strict();
export type PurchaseBody = z.infer<typeof purchaseBodySchema>;

/**
 * A first purchase and a replay answer the same shape (P32, the likes posture): the caller owns it.
 * `communities` are the product's active communities; `courses` and `lives` (08.5-05, D-425,
 * STORE-07 amended) its published courses and non-cancelled lives, with the detail's rules and order
 * (`[]` while `courses` is off). "Compra concluída" and the return to a locked course or live steer
 * only by what this answer lists (T-08.2-37).
 */
export const purchaseResultSchema = z
  .object({
    owned: z.literal(true),
    communities: z.array(productCommunitySchema),
    courses: z.array(productUnlockCourseSchema),
    lives: z.array(productUnlockLiveSchema),
  })
  .strict();
export type PurchaseResult = z.infer<typeof purchaseResultSchema>;

// ── 08.2-06: buyers, grant and revoke (D-359, D-360, STORE-09, STORE-10) ───────────────────────

/**
 * `GET /v1/store/products/{productId}/buyers?cursor=&limit=` (D-360, STORE-10). Same bounds as the
 * catalogue: a `limit` outside 1..50, a cursor longer than 512 characters or one this list did not
 * issue are a 400, never a widened read. `.strict()`: an unknown query key fails loudly.
 */
export const buyersQuerySchema = z
  .object({
    cursor: z.string().max(STORE_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(STORE_MAX_PAGE_SIZE).default(STORE_PAGE_SIZE),
  })
  .strict();
export type BuyersQuery = z.infer<typeof buyersQuerySchema>;

/** How a holder got the product: `purchase` (an order) or `grant` (by the admin, no order). */
export const ENTITLEMENT_SOURCES = ['purchase', 'grant'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/**
 * One ACTIVE holder of a product. `displayName` and `avatarAssetId` come from the holder's
 * `member_profiles` row in THIS tenant, through their membership (D-310), never from the global
 * identity. A holder whose membership was removed keeps the row with `membershipId`, `displayName`
 * and `avatarAssetId` all null (they move together). `since` is the entitlement's `created_at`
 * (ISO 8601, UTC): a member revoked and re-buying shows the new entitlement and a new `since`.
 */
export const buyerSchema = z
  .object({
    entitlementId: z.uuid(),
    membershipId: z.uuid().nullable(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    source: z.enum(ENTITLEMENT_SOURCES),
    since: z.iso.datetime(),
  })
  .strict();
export type Buyer = z.infer<typeof buyerSchema>;

/**
 * One keyset page of holders, `(created_at desc, id desc)` of the entitlement (P37). `nextCursor` is
 * non-null EXACTLY when another row exists; `total` is the exact `count(*)` of the product's active
 * entitlements (a product nobody holds answers `{ items: [], nextCursor: null, total: 0 }`, P36).
 */
export const buyersPageSchema = z
  .object({
    items: z.array(buyerSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().min(0),
  })
  .strict();
export type BuyersPage = z.infer<typeof buyersPageSchema>;

/**
 * `POST /v1/store/products/{productId}/grants` (D-360): the membership of THIS tenant to give the
 * product to. An unknown id, another tenant's, a blocked or removed membership is the bare 404.
 */
export const grantBodySchema = z.object({ membershipId: z.uuid() }).strict();
export type GrantBody = z.infer<typeof grantBodySchema>;

/**
 * The two 200 answers of a grant: `granted` wrote a new entitlement (`source: 'grant'`, no order);
 * `already_active` wrote nothing because the member already holds the product (a purchase or an
 * earlier grant), and `entitlementId` is that active row.
 */
export const GRANT_OUTCOMES = ['granted', 'already_active'] as const;
export type GrantOutcome = (typeof GRANT_OUTCOMES)[number];

export const grantResultSchema = z
  .object({
    outcome: z.enum(GRANT_OUTCOMES),
    entitlementId: z.uuid(),
  })
  .strict();
export type GrantResult = z.infer<typeof grantResultSchema>;

/**
 * `DELETE /v1/store/products/{productId}/entitlements/{entitlementId}` (D-359): the entitlement (and,
 * for a purchase, its order) is now `revoked`. The rows stay as history; the member may buy again.
 */
export const revokeResultSchema = z.object({ outcome: z.literal('revoked') }).strict();
export type RevokeResult = z.infer<typeof revokeResultSchema>;
