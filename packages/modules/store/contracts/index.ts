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
 * `POST /v1/store/products`. `communityIds` is a SET: duplicates collapse (first occurrence kept),
 * after the cap is checked on what was sent. `.strict()`: an unknown key fails loudly.
 */
export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, 'name_required').max(STORE_MAX_NAME, 'name_too_long'),
    description: z.string().trim().max(STORE_MAX_DESCRIPTION, 'description_too_long').default(''),
    priceCents: priceCentsSchema,
    imageAssetId: z.uuid('image_invalid').nullable().default(null),
    communityIds: z
      .array(z.uuid('community_invalid'))
      .max(STORE_MAX_LINKS, 'too_many_communities')
      .default([])
      .transform((ids) => [...new Set(ids)]),
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

/** One product. `owned` is the CALLER's active entitlement; `communities` are its active links. */
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
  })
  .strict();
export type ProductDetail = z.infer<typeof productDetailSchema>;

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
