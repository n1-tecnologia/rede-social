# @rede-social/module-store

The tenant's store (Phase 08.2, STORE-01..21): products priced in integer cents that open one or
more communities. A community linked to a product is locked for every member who holds no active
entitlement to any of its products: they see only its newest post until they buy (D-354, D-356).
Staff (`admin_tenant`, `support_tenant`) always read every community. Orders and entitlements are
written only through SECURITY DEFINER functions; no tenant lane has a write policy on them
(STORE-20). Products and their community links (the gate itself) are read by every lane of the
tenant and written only by the `admin_tenant` claim, with TRUNCATE revoked (08.2 review CR-01): a
member's own token cannot unlink a community or reprice a product, whatever path reaches SQL. With
the store off for a tenant, nothing changes for anyone.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `storeModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `storeRoutes` and the service functions (`createProduct`, `purchaseProduct`, `listProducts`, `getProduct`, `listCommunityAccess`, `getCommunityAccess`, `updateProduct`, `setProductStatus`, `lockPreview`, `listBuyers`, `grantAccess`, `revokeAccess`) |
| `./db` | Drizzle tables `storeProducts`, `storeProductCommunities`, `storeProductCourses`, `storeProductLives` (08.4), `storeOrders`, `storeEntitlements` with their RLS policies |

Main contract names (`./contracts`): `productInputSchema`, `productDetailSchema` (with the
manager-only `holderCount`, `courses` and `lives`), `productCommunitySchema`, `productCourseSchema`
(`status` from `PRODUCT_COURSE_STATUSES`), `productLiveSchema` (`status` from
`PRODUCT_LIVE_STATUSES`), `purchaseBodySchema`, `purchaseResultSchema`,
the catalogue `productListQuerySchema` (`filter` from `PRODUCT_FILTERS`, `cursor`, `limit`),
`productCardSchema` and `productPageSchema`, the access reads `communityAccessListSchema`,
`communityAccessSchema`, `buyableProductSchema` and `communityProductSchema`, the admin writes
`productPatchSchema`, `productStatusBodySchema`, `lockPreviewBodySchema` and `lockPreviewSchema`, the
holders and escape hatches (08.2-06) `buyersQuerySchema`, `buyerSchema`, `buyersPageSchema`
(`source` from `ENTITLEMENT_SOURCES`), `grantBodySchema`, `grantResultSchema` (`outcome` from
`GRANT_OUTCOMES`) and `revokeResultSchema`, the caps
`STORE_MAX_NAME`, `STORE_MAX_DESCRIPTION`, `STORE_MAX_LINKS`, `STORE_PAGE_SIZE`,
`STORE_MAX_PAGE_SIZE` and `STORE_MAX_CURSOR_LENGTH`, the permission names `STORE_PERMISSIONS`
(`store.product.manage`), and the refusal vocabulary `STORE_ISSUES` / `STORE_ISSUE_SET`. Prices use
`priceCentsSchema` from `@rede-social/contracts/money`.

Routes (`/v1/store`), every one behind `requireAuth` and `requireModule('store')`:

| Route | Who | What |
|---|---|---|
| `GET /products?filter=&cursor=&limit=` | everyone; `filter=archived` needs `store.product.manage` (403) | `all` (active, newest first), `owned` (the caller's active entitlements, archived products included, newest entitlement first), `archived` |
| `GET /products/{productId}` | everyone | the product with `owned` and its active linked communities; `holderCount`, `courses` (draft or published linked courses) and `lives` (non-cancelled linked lives, with their status) for a manager only; archived and not held nor managed is the bare 404 |
| `POST /products` | `store.product.manage` | create, with the community, course and live links (`communityIds`, `courseIds`, `liveIds`) |
| `PATCH /products/{productId}` | `store.product.manage` | edit any subset of the fields; `communityIds`, `courseIds` and `liveIds`, when present, each REPLACE their own set in one transaction under the product row lock (links to archived or removed communities, archived courses and cancelled lives are kept, so a save never opens them, and an already linked one is accepted when re-sent); a new price leaves existing orders alone |
| `PUT /products/{productId}/status` | `store.product.manage` | `active` / `archived`, idempotent; archiving refuses new purchases and touches no link and no entitlement |
| `POST /products/lock-preview` | `store.product.manage` | for the communities about to be linked that no product gates today, the exact number of live members who would lose access |
| `POST /products/{productId}/purchase` | everyone | buy; the body carries `expectedAmountCents`, a staleness check, never the amount to charge; a caller who already holds the product always gets the same 200 (`owned`), even after an archive or a price edit |
| `GET /products/{productId}/buyers?cursor=&limit=` | `store.product.manage` | the product's ACTIVE holders, newest entitlement first, with `total`; name and photo from the holder's profile in this tenant (through the membership); a removed member's row keeps `membershipId`/`displayName` null |
| `POST /products/{productId}/grants` | `store.product.manage` (and the `admin_tenant` claim, re-checked in SQL) | `{ membershipId }` of THIS tenant (live, not blocked): `granted` or `already_active`; any other membership id is the bare 404 |
| `DELETE /products/{productId}/entitlements/{entitlementId}` | `store.product.manage` (and the `admin_tenant` claim, re-checked in SQL) | the active entitlement of this product becomes `revoked` (and its order, for a purchase); rows stay as history and the member may buy again |
| `GET /community-access` | everyone | one row per gated community: `locked` (for the caller), `gated`, `archivedTag` |
| `GET /communities/{communityId}/access` | everyone | `locked`, `gated`, `archivedTag`, `buyableProducts` (active, newest first); `products` (all linked, read only) for a manager |

A link between a product and a community, a course or a live is written ONLY through the product
(create and edit); no communities or courses route writes one (D-363; D-418 for courses and lives,
08.4). Archiving or editing a product, unlinking a community and
turning the store off never delete, revoke or alter an order or an entitlement: a member who bought
something keeps it until an admin revokes it (`DELETE …/entitlements/{entitlementId}`, the only
path that ends access). The store reads community, course and live rows by SQL in its own
statements and imports nothing from the communities or courses packages (MOD-02).

SQL the module implements (migration `supabase/migrations/*_store_functions.sql`):

- the store bodies of the kernel community gate seam declared by `*_community_gate_seam.sql`
  (see `packages/core/db/README.md`): `app.community_locked_ids()`,
  `app.community_locked_ids_for(uuid)` and `app.community_viewer_ids(uuid)`;
- `app.store_purchase(uuid, integer)`, the only purchase writer: it copies the price from the
  product row into the order (D-361), is idempotent and race-safe on the partial unique arbiters
  `store_orders_live_uq` and `store_entitlements_active_uq`;
- `app.store_grant(uuid, uuid)` and `app.store_revoke(uuid, uuid)` (migration
  `*_store_grants.sql`, 08.2-06): the admin's grant (an entitlement `source 'grant'`, no order) and
  revoke (entitlement and, for a purchase, its order set to `revoked`, never deleted). Both pin
  `app.tenant_id()` and answer `forbidden` unless the `tenant_role` claim is `admin_tenant`;
- the hand-written `store_product_communities_community_fk` to `communities(id) on delete cascade`;
- the store bodies of the kernel COURSE gate seam declared by `*_course_gate_seam.sql` (08.3-01;
  since 08.4 migration `*_store_course_links_functions.sql`, which carried the 08.3 links over and
  re-pointed the bodies; see `packages/core/db/README.md`): `app.course_locked_ids()`,
  `app.course_locked_ids_for(uuid)`, `app.live_locked_ids()` and `app.live_locked_ids_for(uuid)` —
  the same rule as the community gate over the store-owned `store_product_courses` and
  `store_product_lives` (hand FKs `store_product_courses_course_fk` → `courses(id)` and
  `store_product_lives_live_fk` → `course_lives(id)`, both `on delete cascade`): a course
  (live) linked to at least one product for which the user holds no active entitlement is locked;
  staff by claim (lane form) or by `memberships` row (`_for` form) are never locked; the tenant's
  `store` row missing or disabled answers `'{}'`; a null or unknown `tenant_role` claim takes the
  member branch. The courses module imports nothing from this package; the seam is the only tie.

## Events emitted

None.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: none.
- Notification retractions: none.

## Flag key

`store` in `tenant_modules`. No `requires`. Off by default: not in `REAL_TENANT_DEFAULT_MODULES`, and
no migration backfills a row (a missing row reads as disabled, STORE-01). The SQL gate reads the
same row itself, so content gating and the routes agree (the API flag cache may lag by up to 30 s).

## Kernel dependencies

- `@rede-social/core/db/community-gate`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`

## Navigation

- Top-bar entry "Loja": placement `topbar`, href `/loja`, icon `shopping-bag`, order 5 (D-350,
  UI-D-366). The screens arrive in later 08.2 plans.

## Jobs

- None.
- Sweep functions: none.

## Reuse

UI (`./ui`, props only, no words of their own, no other module imported): `ProductCard`,
`ProductCardSkeleton`, `PurchaseDialog`, `ExclusiveBadge`, `LockedSection`, `LockedCount`,
`LockedPostPlaceholder` and `ProductChoiceSheet`. The host supplies every string, href and action;
the UI imports only `@rede-social/ui`, `lucide-react`, `motion/react` and React.

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide: a request id and a per-request
logger, an `onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant`: `store.product.manage`), the kernel migration
`*_community_gate_seam.sql` applied before this module's migrations, and
`.route('/v1/store', storeRoutes)`. The routes carry their own `requireAuth`, `requireModule('store')`
and `requirePermission` chain. Linking a product to a community needs the communities table (the
hand-written FK); a store without communities still sells products that open none.
