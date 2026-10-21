import { z } from 'zod';

/**
 * The neutral vocabulary of the payment gate (Phase 09.1, D-485, D-486). Nothing here names a
 * gateway: a provider is a FORMAT on the database side, never an enum, so a second gateway needs no
 * migration.
 */

/** Who wrote an `access_grants` row: an admin by hand, or a gateway event (D-485). */
export const ACCESS_SOURCES = ['manual', 'gateway'] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

/**
 * `access_grants.status`. A `manual` row is `active` (a release) or `blocked`; a `gateway` row is
 * `active` or `inactive` (the CHECK pins the pairing).
 */
export const ACCESS_ROW_STATUSES = ['active', 'inactive', 'blocked'] as const;
export type AccessRowStatus = (typeof ACCESS_ROW_STATUSES)[number];

/** What `app.access_effective(tenant, email)` answers: the precedence of D-489 collapsed to one word. */
export const ACCESS_EFFECTIVE_STATES = ['active', 'inactive', 'blocked', 'none'] as const;
export type AccessEffectiveState = (typeof ACCESS_EFFECTIVE_STATES)[number];

/**
 * What `app.access_state(tenant, user)` answers `requireAuth` on every request (D-496): `open` (the
 * gate is off, or the caller is staff, D-492), `granted`, `blocked` (a manual block, answered as
 * `MEMBERSHIP_BLOCKED` while the gate is on) or `cut` (answered as `SUBSCRIPTION_PENDING`).
 */
export const ACCESS_STATES = ['open', 'granted', 'cut', 'blocked'] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

/**
 * The vocabulary of a gateway-neutral payment event (Phase 09.1-05, D-486). An adapter maps whatever
 * a gateway calls its events onto THESE types, and `payment_events.type` is CHECKed against them, so
 * a new neutral type is a product decision plus a migration, never an adapter-local string.
 *
 * `purchase_*` are one-off orders, `subscription_*` are recurring ones; `boleto_generated`,
 * `pix_generated` and `cart_abandoned` are recorded but change nothing; `other` is what an unreadable
 * or unknown shape degrades to.
 */
export const PAYMENT_EVENT_TYPES = [
  'purchase_approved',
  'purchase_refused',
  'purchase_refunded',
  'chargeback',
  'subscription_renewed',
  'subscription_late',
  'subscription_canceled',
  'boleto_generated',
  'pix_generated',
  'cart_abandoned',
  'other',
] as const;
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/**
 * What an event does to access, derived from its type by the adapter (D-496, D-505): `grant` opens it
 * (or returns it), `suspend` cuts it but a later `grant` restores it, `revoke` is terminal for a
 * one-off order, `none` changes nothing.
 */
export const PAYMENT_EVENT_EFFECTS = ['grant', 'suspend', 'revoke', 'none'] as const;
export type PaymentEventEffect = (typeof PAYMENT_EVENT_EFFECTS)[number];

/**
 * `payment_events.state`: `received` when recorded, then the apply job settles it (plan 07):
 * `applied`, `no_membership` (D-490), `unknown_product`, `ignored`, or `failed` (retryable).
 */
export const PAYMENT_EVENT_STATES = [
  'received',
  'applied',
  'no_membership',
  'unknown_product',
  'ignored',
  'failed',
] as const;
export type PaymentEventState = (typeof PAYMENT_EVENT_STATES)[number];

/** `payment_events.outcome`: what the apply job did once it settled the event (plan 07). Nullable. */
export const PAYMENT_EVENT_OUTCOMES = [
  'access_granted',
  'access_cut',
  'product_granted',
  'product_revoked',
  'stale',
  'no_effect',
  'currency_unsupported',
] as const;
export type PaymentEventOutcome = (typeof PAYMENT_EVENT_OUTCOMES)[number];

/** What a gateway product id stands for (D-488): the platform door, or a store product. */
export const PAYMENT_PRODUCT_KINDS = ['access', 'store_product'] as const;
export type PaymentProductKind = (typeof PAYMENT_PRODUCT_KINDS)[number];

/**
 * `membership.access_cut` — emitted by the kernel AFTER a gateway event takes a member's access away
 * (D-496). Ids only: no e-mail, no amount. The notifications module subscribes to nudge the open
 * app; the membership itself is never written by a cut.
 *
 * Declared against `@rede-social/contracts` by name, exactly like `membership.blocked`
 * (`moderation.ts`): a relative `declare module` does not merge across the workspace.
 */
export type MembershipAccessCut = { tenantId: string; userId: string; membershipId: string };

/**
 * `payments.purchase_confirmed` — emitted AFTER a gateway-confirmed purchase of a mapped store
 * product commits. Names the product, never the money.
 */
export type PaymentsPurchaseConfirmed = {
  tenantId: string;
  userId: string;
  productId: string;
  productName: string;
};

// ── 09.1-09: the admin API's contracts (D-491, D-492, D-494, D-501, D-502) ─────────────────────

/** Field caps, measured on the TRIMMED value in code points (Zod 4 counts code points, an emoji is one). */
export const PAYMENTS_MAX_TOKEN = 512;
/**
 * The floor of a webhook token (WR-04). Deliberately modest: the gateway's own panel issues a SHORT
 * alphanumeric token (about ten characters), so a long minimum would reject a real vendor token. It only
 * keeps out `1234`, `senha` and the like, which the unauthenticated route could not otherwise tell from a
 * real secret.
 */
export const PAYMENTS_MIN_TOKEN = 8;
export const PAYMENTS_MAX_NAME = 80;
export const PAYMENTS_MAX_PRODUCT_ID = 128;
export const PAYMENTS_MAX_LINK = 2048;

/**
 * The closed refusal vocabulary of the admin API, lifted into `details.payments` by the module's route
 * `defaultHook` (the store's `details.store` shape). Every Zod message below IS one of these codes, so
 * the hook needs no lookup table:
 *  - `400 VALIDATION_FAILED`: `token_required`, `token_invalid` (under 8 characters, or whitespace or a
 *    control character inside), `provider_unavailable`, `name_required`,
 *    `name_too_long`, `product_id_required`, `product_id_too_long`, `link_invalid`,
 *    `gateway_product_id_required` (a mapping needs the gateway's product id), `nothing_to_update`;
 *  - `409 CONFLICT`: `gateway_product_taken` (another registration, of any tenant, holds that gateway
 *    id; the body never names the other tenant), `last_access_product` (the last access product cannot
 *    go while the gate is on) and `gate_requires_setup` (the gate needs an integration and a product).
 * `email_invalid`, `blocked`, `no_membership` and `not_grantable` belong to plan 10 (the Acessos list
 * and "Liberar manualmente") and are published here so the web has ONE vocabulary: `blocked` is the 409 of
 * a release under a manual block, `no_membership` and `not_grantable` the two 409s of the manual grant.
 */
export const PAYMENTS_ISSUES = [
  'token_required',
  'token_invalid',
  'provider_unavailable',
  'name_required',
  'name_too_long',
  'product_id_required',
  'product_id_too_long',
  'link_invalid',
  'gateway_product_id_required',
  'gateway_product_taken',
  'last_access_product',
  'gate_requires_setup',
  'email_invalid',
  'blocked',
  'no_membership',
  'nothing_to_update',
  'not_grantable',
] as const;
export type PaymentsIssue = (typeof PAYMENTS_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.payments`. */
export const PAYMENTS_ISSUE_SET: ReadonlySet<string> = new Set(PAYMENTS_ISSUES);

/**
 * A checkout link is an `https:` URL with a host, no userinfo, no whitespace or control character, at
 * most 2048 characters (T-09.1-45). The table CHECK (`payment_products_url_chk`) repeats the shape, so a
 * link that gets past a future route bug still cannot become `javascript:` or `http:`.
 */
export function isCheckoutLink(value: string): boolean {
  if (value.length === 0 || value.length > PAYMENTS_MAX_LINK) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  if (!value.startsWith('https://')) return false;
  // Userinfo (`https://user:pass@host`, or a bare `@`) lives before the first `/`, `?` or `#`.
  const authority = value.slice('https://'.length).split(/[/?#]/, 1)[0] ?? '';
  if (authority === '' || authority.includes('@')) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
    );
  } catch {
    return false;
  }
}

/** A token is one run of visible characters: no whitespace (the value is trimmed first), no control character. */
export function isWebhookToken(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  return [...value].length >= PAYMENTS_MIN_TOKEN && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

const tokenField = z
  .string()
  .trim()
  .min(1, 'token_required')
  .max(PAYMENTS_MAX_TOKEN, `at most ${PAYMENTS_MAX_TOKEN} characters`)
  // An empty value is `token_required` alone; the shape rule never adds a second issue to it.
  .refine((value) => value === '' || isWebhookToken(value), 'token_invalid');

/** `PUT /v1/payments/integration`: the webhook token, write-only (D-486), and an optional provider. */
export const saveIntegrationBodySchema = z
  .object({
    token: tokenField,
    provider: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,30}$/, 'provider_unavailable')
      .optional(),
  })
  .strict();
export type SaveIntegrationBody = z.infer<typeof saveIntegrationBodySchema>;

const nameField = z.string().trim().min(1, 'name_required').max(PAYMENTS_MAX_NAME, 'name_too_long');
const productIdField = z
  .string()
  .trim()
  .min(1, 'product_id_required')
  .max(PAYMENTS_MAX_PRODUCT_ID, 'product_id_too_long');
/** An empty (or whitespace) link means "no link"; anything else must be a checkout link. */
const linkField = z
  .string()
  .trim()
  .refine((value) => value === '' || isCheckoutLink(value), 'link_invalid')
  .transform((value) => (value === '' ? null : value))
  .nullable();

/** `POST /v1/payments/access-products` (D-494, D-502): what the admin calls it, the gateway's id, the link. */
export const accessProductBodySchema = z
  .object({
    name: nameField,
    externalProductId: productIdField,
    checkoutUrl: linkField.optional(),
  })
  .strict();
export type AccessProductBody = z.infer<typeof accessProductBodySchema>;

/** `PATCH /v1/payments/access-products/{id}`: every key optional, at least one required. */
export const accessProductPatchSchema = z
  .object({
    name: nameField.optional(),
    externalProductId: productIdField.optional(),
    checkoutUrl: linkField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'nothing_to_update',
  });
export type AccessProductPatch = z.infer<typeof accessProductPatchSchema>;

/**
 * `PUT /v1/payments/store-products/{productId}` (A-P12): the gateway product that sells a store product.
 * A mapping needs the gateway's id; a link without one is the field error of UI-D-524.
 */
export const storeMappingBodySchema = z
  .object({
    externalProductId: z
      .string()
      .trim()
      .max(PAYMENTS_MAX_PRODUCT_ID, 'product_id_too_long')
      .optional(),
    checkoutUrl: linkField.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.externalProductId === undefined || body.externalProductId === '') {
      ctx.addIssue({ code: 'custom', message: 'gateway_product_id_required' });
    }
  });
export type StoreMappingBody = z.infer<typeof storeMappingBodySchema>;

/** `PUT /v1/payments/gate`: the switch, and whether to release the members who already exist (D-491, PAY-31). */
export const gateBodySchema = z
  .object({ required: z.boolean(), releaseExisting: z.boolean().optional() })
  .strict();
export type GateBody = z.infer<typeof gateBodySchema>;

export const paymentsIntegrationSchema = z.object({
  provider: z.string(),
  /** The adapter's `displayName`, the `{gateway}` of the copy. */
  gatewayName: z.string(),
  connected: z.boolean(),
  /** What the admin pastes into the gateway; known before any token is saved. */
  webhookUrl: z.string(),
  lastEventAt: z.string().nullable(),
});
export type PaymentsIntegration = z.infer<typeof paymentsIntegrationSchema>;

export const accessProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  externalProductId: z.string(),
  checkoutUrl: z.string().nullable(),
  /** True on exactly one row: the OLDEST access product that has a link feeds "Assinar" (A-UI-7). */
  feedsSubscribeButton: z.boolean(),
  createdAt: z.string(),
});
export type AccessProduct = z.infer<typeof accessProductSchema>;

export const paymentsOverviewSchema = z.object({
  integration: paymentsIntegrationSchema,
  /** Creation order, oldest first. */
  accessProducts: z.array(accessProductSchema),
  gate: z.object({ required: z.boolean(), canEnable: z.boolean() }),
  serverNow: z.string(),
});
export type PaymentsOverview = z.infer<typeof paymentsOverviewSchema>;

export const saveIntegrationResultSchema = z.object({ connected: z.literal(true) });
export type SaveIntegrationResult = z.infer<typeof saveIntegrationResultSchema>;

export const removeAccessProductResultSchema = z.object({ id: z.uuid() });
export type RemoveAccessProductResult = z.infer<typeof removeAccessProductResultSchema>;

export const storeMappingSchema = z.object({
  externalProductId: z.string(),
  checkoutUrl: z.string().nullable(),
});
export type StoreMapping = z.infer<typeof storeMappingSchema>;

export const storeMappingResponseSchema = z.object({
  /** Whether the tenant has an integration (the product form warns when it does not). */
  connected: z.boolean(),
  mapping: storeMappingSchema.nullable(),
});
export type StoreMappingResponse = z.infer<typeof storeMappingResponseSchema>;

export const gatePreviewSchema = z.object({
  /**
   * The live `member`-role memberships (active, not blocked, not deleted) whose effective access is
   * `none`: exactly the members a release would admit, and the only ones it writes a row for (D-489,
   * D-492, PAY-31). Produced by one database tally, never summed or estimated in JavaScript.
   */
  count: z.number().int().min(0),
  /**
   * The live `member`-role memberships whose effective access is `inactive`: members the gateway has
   * cut, which D-489 keeps above a manual release (assumption A-P9, confirmed by the owner on
   * 2026-10-21). Counted so the screen can say they stay cut; from the same tally as `count`.
   */
  gatewayCut: z.number().int().min(0),
});
export type GatePreview = z.infer<typeof gatePreviewSchema>;

export const gateResultSchema = z.object({
  required: z.boolean(),
  /**
   * The rows the server created in the same transaction, never the preview (UI-D-516). Each row is a
   * member whose effective state changed to `active`: only `none` members are released.
   */
  released: z.number().int().min(0),
  /**
   * The members the gateway has cut as the write left them (live `member`-role memberships whose
   * effective access is `inactive`), read by the same tally inside the same transaction as the switch
   * and the release. They were not released and stay cut (D-489, A-P9 confirmed by the owner). `0` when
   * the write turns the gate off.
   */
  gatewayCut: z.number().int().min(0),
});
export type GateResult = z.infer<typeof gateResultSchema>;

// ── 09.1-10: the Acessos list and its four e-mail actions (D-489, D-504, PAY-22) ────────────────

/**
 * What the Acessos list says about an e-mail. It is `app.access_effective` renamed for the screen
 * (`active` -> `active`, `inactive` -> `subscription_pending`, `blocked` -> `blocked`): the rule exists in
 * SQL once and no TypeScript recomputes it (D-489).
 */
export const ACCESS_ITEM_STATES = ['active', 'subscription_pending', 'blocked'] as const;
export type AccessItemState = (typeof ACCESS_ITEM_STATES)[number];

export const PAYMENTS_MAX_QUERY = 200;
export const ACCESS_PAGE_SIZE = 20;
export const ACCESS_MAX_PAGE_SIZE = 50;
export const PAYMENTS_MAX_EMAIL = 254;

/**
 * One e-mail of the tenant. `id` IS the normalised e-mail (planning decision 1: the key of a row, never a
 * path segment). `source` is `manual` when the effective state is `blocked` or no gateway row exists, else
 * the gateway's provider key; `validUntil` is the latest gateway end date; `hasAccount` is whether a live
 * membership of the tenant carries the address.
 */
export const accessItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  source: z.string(),
  state: z.enum(ACCESS_ITEM_STATES),
  validUntil: z.string().nullable(),
  hasAccount: z.boolean(),
  updatedAt: z.string(),
});
export type AccessItem = z.infer<typeof accessItemSchema>;

export const accessPageSchema = z.object({
  items: z.array(accessItemSchema),
  nextCursor: z.string().nullable(),
  serverNow: z.string(),
});
export type AccessPage = z.infer<typeof accessPageSchema>;

/**
 * `GET /v1/payments/accesses`. `q` is a contains match on the e-mail (a spaces-only value filters nothing);
 * `limit` is 1 to 50 and a value outside it is a 400, not a clamp; `cursor` is opaque and a tampered one
 * reads as the first page.
 */
export const accessListQuerySchema = z
  .object({
    q: z.string().trim().max(PAYMENTS_MAX_QUERY).optional(),
    status: z.enum(ACCESS_ITEM_STATES).optional(),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(ACCESS_MAX_PAGE_SIZE).default(ACCESS_PAGE_SIZE),
  })
  .strict();
export type AccessListQuery = z.infer<typeof accessListQuerySchema>;

/**
 * The body of the four actions. The address is trimmed and lower-cased here and normalised again by SQL
 * (`lower(btrim())`) where it is written; Zod 4's e-mail rule is ASCII-only, so the two agree.
 */
export const accessEmailBodySchema = z
  .object({
    email: z
      .string({ error: 'email_invalid' })
      .trim()
      .toLowerCase()
      .max(PAYMENTS_MAX_EMAIL, 'email_invalid')
      .pipe(z.email('email_invalid')),
  })
  .strict();
export type AccessEmailBody = z.infer<typeof accessEmailBodySchema>;

/** Every write answers the updated row, or `null` when no row remains for that e-mail. */
export const accessResultSchema = z.object({ access: accessItemSchema.nullable() });
export type AccessResult = z.infer<typeof accessResultSchema>;

// ── 09.1-10: the Eventos list and "Liberar manualmente" (D-490, D-503, PAY-21) ─────────────────

/**
 * What the Eventos list says about a delivery. The apply job's `no_membership` reads `no_account` on the
 * screen; `received` (transient) and `failed` (operational) are never listed (assumption A-P29).
 */
export const EVENT_ITEM_STATES = ['applied', 'no_account', 'unknown_product', 'ignored'] as const;
export type EventItemState = (typeof EVENT_ITEM_STATES)[number];

/** How many events the list answers: the latest 50, never paged, never searchable (D-503). */
export const EVENTS_LIST_SIZE = 50;

/**
 * One delivery as a tenant admin may see it. **Strict on purpose (PR-9, T-09.1-49):** no payload, header,
 * signature or gateway message exists in this shape, so adding one is a contract change a reviewer sees.
 * `productName` is the access product's name or the store product's name; `externalProductId` is the
 * gateway's own id, kept so an unmapped product can still be recognised.
 */
export const eventItemSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(PAYMENT_EVENT_TYPES),
    state: z.enum(EVENT_ITEM_STATES),
    email: z.string().nullable(),
    productName: z.string().nullable(),
    externalProductId: z.string().nullable(),
    outcome: z.enum(PAYMENT_EVENT_OUTCOMES).nullable(),
    receivedAt: z.string(),
  })
  .strict();
export type EventItem = z.infer<typeof eventItemSchema>;

export const eventsResponseSchema = z.object({
  items: z.array(eventItemSchema),
  serverNow: z.string(),
});
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

// ── 09.1-10: the cut screen's data (D-497, UI-D-521, UI-D-532) ────────────────────────────────

/**
 * `GET /v1/me/subscription`, the one read a CUT member can reach: the tenant's name and the stored `https:`
 * checkout link (null when the tenant registered none, the module is off or the gate is off). The web
 * never takes a link from a URL: it renders this one, only when it is `https:`. Strict, so nothing else
 * (no other community, no product list) can ride along.
 */
export const subscriptionStatusSchema = z
  .object({ tenantName: z.string(), checkoutUrl: z.string().nullable() })
  .strict();
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

declare module '@rede-social/contracts' {
  interface EventMap {
    'membership.access_cut': MembershipAccessCut;
    'payments.purchase_confirmed': PaymentsPurchaseConfirmed;
  }
}
