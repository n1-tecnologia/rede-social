# @rede-social/module-store

The tenant's store (Phase 08.2, STORE-01..21): products priced in integer cents that open one or
more communities. A community linked to a product is locked for every member who holds no active
entitlement to any of its products: they see only its newest post until they buy (D-354, D-356).
Staff (`admin_tenant`, `support_tenant`) always read every community. Orders and entitlements are
written only through SECURITY DEFINER functions; no tenant lane has a write policy on them
(STORE-20). With the store off for a tenant, nothing changes for anyone.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `storeModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `storeRoutes`, `createProduct`, `purchaseProduct` |
| `./db` | Drizzle tables `storeProducts`, `storeProductCommunities`, `storeOrders`, `storeEntitlements` with their RLS policies |

Main contract names (`./contracts`): `productInputSchema`, `productDetailSchema`,
`productCommunitySchema`, `purchaseBodySchema`, `purchaseResultSchema`, the caps `STORE_MAX_NAME`,
`STORE_MAX_DESCRIPTION` and `STORE_MAX_LINKS`, the permission names `STORE_PERMISSIONS`
(`store.product.manage`), and the refusal vocabulary `STORE_ISSUES` / `STORE_ISSUE_SET`. Prices use
`priceCentsSchema` from `@rede-social/contracts/money`.

Routes (`/v1/store`): `POST /products` (`store.product.manage`) and
`POST /products/{productId}/purchase` (every role; the body carries `expectedAmountCents`, a
staleness check, never the amount to charge).

SQL the module implements (migration `supabase/migrations/*_store_functions.sql`):

- the store bodies of the kernel community gate seam declared by `*_community_gate_seam.sql`
  (see `packages/core/db/README.md`): `app.community_locked_ids()`,
  `app.community_locked_ids_for(uuid)` and `app.community_viewer_ids(uuid)`;
- `app.store_purchase(uuid, integer)`, the only purchase writer: it copies the price from the
  product row into the order (D-361), is idempotent and race-safe on the partial unique arbiters
  `store_orders_live_uq` and `store_entitlements_active_uq`;
- the hand-written `store_product_communities_community_fk` to `communities(id) on delete cascade`.

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

- `@rede-social/core/db/rls`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/rbac/permissions`

## Navigation

- Top-bar entry "Loja": placement `topbar`, href `/loja`, icon `shopping-bag`, order 5 (D-350,
  UI-D-366). The screens arrive in later 08.2 plans.

## Jobs

- None.
- Sweep functions: none.

## Reuse

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide: a request id and a per-request
logger, an `onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant`: `store.product.manage`), the kernel migration
`*_community_gate_seam.sql` applied before this module's migrations, and
`.route('/v1/store', storeRoutes)`. The routes carry their own `requireAuth`, `requireModule('store')`
and `requirePermission` chain. Linking a product to a community needs the communities table (the
hand-written FK); a store without communities still sells products that open none.
