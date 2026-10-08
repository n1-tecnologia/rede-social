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
 * Field caps, measured as the TRIMMED JS string length (UTF-16 code units), the communities rule:
 * the browser `maxLength`, the counter and the `.max()` below all count the same unit.
 */
export const STORE_MAX_NAME = 80;
export const STORE_MAX_DESCRIPTION = 2000;
/** The most communities one product may open. */
export const STORE_MAX_LINKS = 50;

/**
 * The closed refusal vocabulary, lifted into `details.store`:
 *  - `400 VALIDATION_FAILED`: `name_required`, `name_too_long`, `description_too_long`,
 *    `price_invalid`, `image_invalid` (an asset of THIS tenant that is not a ready `cover` image; an
 *    unknown or foreign one is a bare 404), `community_invalid` (not an active community of this
 *    tenant, or not a uuid), `too_many_communities`;
 *  - `409 CONFLICT`: `unavailable` (the product is archived) and `price_changed` (the price moved).
 */
export const STORE_ISSUES = [
  'name_required',
  'name_too_long',
  'description_too_long',
  'price_invalid',
  'image_invalid',
  'community_invalid',
  'too_many_communities',
  'unavailable',
  'price_changed',
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
/** A SET: duplicates collapse (first occurrence kept), after the cap is checked on what was sent. */
const dedupe = (ids: string[]) => [...new Set(ids)];

/**
 * `POST /v1/store/products`. `communityIds` is a SET: duplicates collapse (first occurrence kept),
 * after the cap is checked on what was sent. `.strict()`: an unknown key fails loudly.
 */
export const productInputSchema = z
  .object({
    name: productNameField,
    description: productDescriptionField.default(''),
    priceCents: priceCentsSchema,
    imageAssetId: productImageField.default(null),
    communityIds: productCommunityIdsField.default([]).transform(dedupe),
  })
  .strict();
export type ProductInput = z.infer<typeof productInputSchema>;

/** A community a product opens, as a card needs it. */
export const productCommunitySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    coverAssetId: z.uuid().nullable(),
  })
  .strict();
export type ProductCommunity = z.infer<typeof productCommunitySchema>;

export const PRODUCT_STATUSES = ['active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * One product. `owned` is the CALLER's active entitlement; `communities` are its ACTIVE, live
 * linked communities in the Comunidades list order (`[]` when it opens none, D-353).
 * `holderCount` (08.2-05) is present only for a caller holding `store.product.manage`: the number
 * of active entitlements, exact (`count(*)`), for the "Compradores" sub-line.
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

/** `POST /v1/store/products/{productId}/purchase`: the price the buyer SAW (fact 1). */
export const purchaseBodySchema = z
  .object({
    expectedAmountCents: priceCentsSchema,
  })
  .strict();
export type PurchaseBody = z.infer<typeof purchaseBodySchema>;

/** A first purchase and a replay answer the same shape (P32, the likes posture): the caller owns it. */
export const purchaseResultSchema = z
  .object({
    owned: z.literal(true),
    communities: z.array(productCommunitySchema),
  })
  .strict();
export type PurchaseResult = z.infer<typeof purchaseResultSchema>;
