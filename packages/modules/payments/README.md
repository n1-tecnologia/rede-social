# @rede-social/module-payments

The admin's setup of the payment gate (Phase 09.1, PAY-01..31): connecting a payment gateway with a
write-only webhook token, registering the gateway products that open the door (access products,
D-494), mapping a store product to the gateway product that sells it, and switching the access gate
on, with the choice to release the members who already exist (D-491, D-492). With the module off for
a tenant nothing changes for anyone: the gate is open and the store keeps its simulated purchase.

**This package holds no tables, no jobs and no ingestion.** The tables (`access_grants`,
`payment_integrations`, `payment_products`, `payment_events`), the unauthenticated webhook route, the
secret custody and the apply job are KERNEL code (`@rede-social/core/server/payments/*`), because
`requireAuth` reads the gate on every request and the ingestion has no tenant session (D-501). The
module owns the admin routes, their contracts and (plans 13-14) the props-only screens. The services
the routes call live in the kernel, where the admin-lane writes (the integration, the gate switch)
are visible to the Biome lane rule; a route never opens the admin lane.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `paymentsModule`, the manifest |
| `./contracts` | the admin API's Zod schemas and constants shared with the web app (a re-export of `@rede-social/contracts/payments` plus the permission constant) |
| `./server` | `paymentsRoutes`, `paymentsNotificationSources`, `paymentsPushCopy`, `PAYMENTS_PUSH_BODY_MAX` |
| `./ui` | props-only (MOD-02): `PaymentsSkeleton`, `AccessStatePill` (the one status pill and its tone mapping), `AccessRow`, `AccessRowSkeleton`, `EventRow`, `EventRowSkeleton`; every word, flag, clock and handler arrives from `apps/web` |

Main contract names (`./contracts`): `saveIntegrationBodySchema`, `accessProductBodySchema`,
`accessProductPatchSchema`, `storeMappingBodySchema`, `gateBodySchema`, the answers
`paymentsOverviewSchema`, `accessProductSchema`, `storeMappingResponseSchema`, `gatePreviewSchema` and
`gateResultSchema`, the Acessos and Eventos contracts `accessListQuerySchema`, `accessEmailBodySchema`,
`accessPageSchema`, `accessResultSchema`, `eventsResponseSchema` and `eventItemSchema`, the caps `PAYMENTS_MAX_TOKEN`, `PAYMENTS_MAX_NAME`, `PAYMENTS_MAX_PRODUCT_ID` and
`PAYMENTS_MAX_LINK`, the link rule `isCheckoutLink`, the permission names `PAYMENTS_PERMISSIONS`
(`payments.manage`), the notification kind `PAYMENTS_NOTIFICATION_KINDS`, and the refusal vocabulary `PAYMENTS_ISSUES` / `PAYMENTS_ISSUE_SET`.

Routes (`/v1/payments`), every one behind `requireAuth`, `requireModule('payments')` and
`requirePermission('payments.manage')` (`admin_tenant` only, by construction, see `module.ts`):

| Route | What |
|---|---|
| `GET /overview` | the integration (`provider`, `gatewayName`, `connected`, the `webhookUrl` to paste into the gateway, known before any token is saved, `lastEventAt`), the access products in creation order, the gate (`required`, `canEnable`) and `serverNow` |
| `PUT /integration` | saves the webhook token (1 to 512 characters), sealed at rest; answers `{ connected: true }`, never the token |
| `POST /access-products` | registers an access product: a name, the gateway's product id and an optional `https:` checkout link; a gateway id any tenant already holds is `409 gateway_product_taken` |
| `PATCH /access-products/{id}` | edits any subset of name, gateway id and link (`checkoutUrl: null` or an empty string removes the link); an empty body is `nothing_to_update`; the same patch twice answers the same body |
| `DELETE /access-products/{id}` | removes an access product; while the gate is on the LAST one is refused (`409 last_access_product`); a second removal is the bare 404 |
| `GET /store-products/{productId}` | `{ connected, mapping }`: the gateway product that sells a store product, or `mapping: null` |
| `PUT /store-products/{productId}` | upserts that mapping (`externalProductId` required, `checkoutUrl` optional); saved by the product form as a SEPARATE call after the store save |
| `DELETE /store-products/{productId}` | removes the mapping; removing an unmapped product answers the same `{ connected, mapping: null }` |
| `GET /gate/preview` | `{ count }`: the live members a release would admit |
| `PUT /gate` | `{ required, releaseExisting? }`: turns the gate on (needs an integration and an access product) or off; with the release, one manual access row per releasable member in the same transaction, answering `{ required, released }` |
| `GET /accesses` | one keyset page of the e-mails that hold an access row, ONE item per e-mail (`id`, `email`, `source`, `state`, `validUntil`, `hasAccount`, `updatedAt`), ordered `(updatedAt desc, email desc)`; `q` is a contains match, `status` filters the computed state, `limit` 1 to 50; the state is `app.access_effective`, never recomputed |
| `POST /accesses/release` | `{ email }`: a manual `active` row, before or after the person has an account; `409 blocked` while a manual block exists; answers `{ access }` |
| `POST /accesses/block` | `{ email }`: a manual `blocked` row beside whatever the address holds; a block outranks every other row; answers `{ access }` |
| `POST /accesses/unblock` | `{ email }`: deletes the manual block only, restoring the previous state; answers `{ access }` (`null` when no row remains), the bare 404 for an address with no row at all |
| `POST /accesses/remove-release` | `{ email }`: deletes the manual `active` row only (a gateway row is never removed by hand); the bare 404 when there is none |
| `GET /events` | the latest 50 settled events (`applied`, `no_account`, `unknown_product`, `ignored`) in `(receivedAt desc, id desc)` order, with no payload, header or signature, and `serverNow` |
| `POST /events/{eventId}/grant` | "Liberar manualmente": releases the store product of an event waiting for an account through the existing store grant; `409 no_membership` or `409 not_grantable`; idempotent |

## Events emitted

None.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: `payments.purchase_confirmed` (kernel, 09.1-12, D-506): the buyer's one
  "Compra confirmada" in-app notice and push. Nothing else the webhook does notifies anyone (D-500:
  a revocation, a cut, a return, a refund and an event waiting for an account are silent).
- Notification retractions: none, on purpose (A-P30): an archived product stays readable to its
  holder, so archiving must not blank the notice.

## Flag key

`payments` in `tenant_modules`. No `requires`: it works with the store off. Off by default: not in
`REAL_TENANT_DEFAULT_MODULES`. The gate switch is the key `gate` of the same row's `settings`; the
platform toggle upserts `enabled` alone and never touches it, so disabling and re-enabling the module
restores the integration, the products and the switch exactly as they were (a disabled module reads as
gate off). The SQL gate reads the row itself, so the routes and the gate agree (the API flag cache may
lag by up to 30 s).

## Kernel dependencies

- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/notifications/source`
- `@rede-social/core/server/payments/access`
- `@rede-social/core/server/payments/events`
- `@rede-social/core/server/payments/gate`
- `@rede-social/core/server/payments/setup`
- `@rede-social/core/server/rbac/permissions`

## Navigation

- None. The module has no shell entry: its door is a row of Configurações (UI-D-513).

## Jobs

- None of its own.
- Sweep functions: `payment_events_prune` (the 180-day prune of the event inbox, hourly, admin lane).

## Reuse

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A store product is confirmed with the store's published seam `app.store_product_exists(uuid)` by SQL
name; this package imports nothing from the store (MOD-02). A host app must provide the kernel tables and functions of
Phase 09.1 (the `*_access_grants`, `*_payments_tables`, `*_payments_functions` and
`*_store_gateway_functions` migrations), a request id and a per-request logger, an `onError`
rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus `defaultRolePermissions`
(`admin_tenant`: `payments.manage`), and `.route('/v1/payments', paymentsRoutes)`. The routes carry
their own `requireAuth`, `requireModule('payments')` and `requirePermission` chain. Without a store the
module still gates the door; without the gate the module still maps store products.
