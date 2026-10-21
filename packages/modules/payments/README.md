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
| `GET /gate/preview` | `{ count, gatewayCut }`: the live members a release would admit (effective access none), and the members the gateway has cut, who stay cut |
| `PUT /gate` | `{ required, releaseExisting? }`: turns the gate on (needs an integration and an access product) or off; with the release, one manual access row per `none` member in the same transaction (never one for a gateway-cut member), answering `{ required, released, gatewayCut }` |
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

## What the package owns and what the kernel owns

The split is deliberate (D-501): the gate is read by `requireAuth` on every request and the webhook has
no tenant session, so both live below the module line.

| Owner | What |
|---|---|
| This package | the `/v1/payments` admin routes, their Zod contracts, the notification source and push copy of the buyer's confirmation, the props-only rows and pills (`./ui`) |
| `apps/web` | the Pagamentos screens (`/configuracoes/pagamentos`), the cut screen (`/assinatura-pendente`), the no-access notice, the Membros pill and chip, the product form block and the gateway product page; every word is in the pt-BR catalog (`payments.json`, `store.payments.json`, `platform.payments.json`) |
| The kernel (`packages/core`) | the four tables (`access_grants`, `payment_integrations`, `payment_products`, `payment_events`) and their RLS, the SQL that decides who has access (`app.access_effective`), the Auth hook functions, the sealed-secret custody (`secret.ts`), the webhook inbox (`receive.ts`, `inbox.ts`), the apply job and its pure order-of-events policy (`apply.ts`, `policy.ts`, `event-job.ts`), the store definers that create and revoke gateway orders (`app.store_gateway_purchase`, `app.store_gateway_revoke`) and the adapter list (`adapters.ts`) |
| `apps/api` | the unauthenticated route `POST /v1/webhooks/{provider}/{integrationId}`, `GET /v1/me/subscription` (reachable while a member is cut), and the worker registration of the `kernel.payment-event` queue |

## The provider seam and how to add a gateway

A gateway is reached only through the `GatewayProvider` interface of `packages/core/server/payments/types.ts`:
`verify` (throws `GatewayError('invalid_signature')`; a return means the delivery is genuine) and
`normalise` (never throws; degrades an unreadable shape to type `other`, effect `none`). Both are pure
functions of the received bytes, the signature query value and the opened secret. The adapter holds no
state, makes no outbound call and logs nothing from the delivery. The adapter is resolved from the
integration row's `provider`, never from the environment.

To add a gateway, in code, with no migration (the provider name is data, the set of adapters is code):

1. Add one file next to `fake.ts` under `packages/core/server/payments/` exporting a `GatewayProvider`.
   Take the effect of an event from the shared `EFFECT_BY_TYPE` table, so two gateways can never
   disagree on what a late subscription does.
2. Register it with ONE line in `packages/core/server/payments/adapters.ts`.
3. Write the capability matrix for the gateway (what each of its triggers and payload shapes becomes,
   and why the ones that change nothing are ignored) and pin it to fixture files with a coverage test,
   as the first real adapter does; capture real deliveries before any tenant that charges real money
   turns the gate on.
4. Keep the gateway's name inside the adapter file, its fixtures and `adapters.ts`.
   `packages/core/tests/payments-neutral.test.ts` greps the neutral layer (tables, columns, queue, jobs,
   contracts, routes, logs, this package and every message catalog) and fails on a brand name anywhere
   else; the admin copy reaches the display name only through the `{gateway}` placeholder.
5. List it in `PAYMENTS_PROVIDERS` for the environments that should accept it. The local default
   registers every adapter; production lists only the real one.

The neutral event vocabulary is a PRODUCT decision, not an adapter's: adding a type or an effect means
changing `PAYMENT_EVENT_TYPES` / `PAYMENT_EVENT_EFFECTS` in `@rede-social/contracts/payments`, the
table CHECKs, the Eventos catalog and the policy table together.

## Neutral event vocabulary

| Neutral type | Effect | What the apply job does |
|---|---|---|
| `purchase_approved`, `subscription_renewed` | `grant` | opens (or returns) the access of the sale, or buys the store product at the amount the gateway reported |
| `subscription_late`, `subscription_canceled` | `suspend` | cuts the access of the sale; a later grant restores it |
| `purchase_refunded`, `chargeback` | `revoke` | final for a one-off sale (a late approval of the same reference is stale); suspends a recurring one |
| `purchase_refused`, `boleto_generated`, `pix_generated`, `cart_abandoned`, `other` | `none` | recorded, changes nothing |

An event settles into one of `applied`, `no_membership` (a store purchase whose e-mail has no live
membership, kept for "Liberar manualmente"), `unknown_product`, `ignored` or `failed` (only an exception;
retried). A sale is keyed by `(tenant, provider, externalRef)`, never by the person.

## Environment and secret custody

| Variable | Meaning |
|---|---|
| `PAYMENTS_PROVIDERS` | comma list of the adapters this process accepts (a deny list over the registered ones); unset registers all of them. Hosted deploys list only the real adapter; the Playwright config sets `fake` |
| `PAYMENTS_SECRET_KEY` | base64, exactly 32 bytes; seals every tenant's webhook token (AES-256-GCM bound to the integration id). Required whenever the list names a real adapter; without a list or with `fake` a fixed development key is derived |
| `PAYMENTS_SECRET_KEY_ID` | the key's number, for rotation |
| `API_PUBLIC_URL` | the origin the Pagamentos screen prints in the webhook URL; without it the request's own origin (wrong behind Cloud Run) |

The token is write-only: the admin pastes it, the API seals it, no answer, log line, error message or
rendered page ever holds it. The integration id is derived from tenant and provider, so the screen can
show the webhook URL before any token exists.

## Invariants

- No gateway brand name outside an adapter, its fixtures and `adapters.ts` (PAY-02, grep-tested).
- No payload, header, signature or buyer data is stored or shown: `payment_events` keeps the neutral
  fields and one e-mail; the Eventos list and its rows are strict schemas with no payload key.
- The webhook token is write-only and sealed at rest (PAY-04).
- The admin lane (the connection that bypasses RLS) is kernel-only; every statement in it names the
  tenant. A route of this package never opens it.
- A cut never changes `memberships.status`, never revokes the Supabase session and never notifies the
  admin; a manual block outranks every payment state (D-489, D-496, D-499, D-500).
- A delivery signed with tenant A's token can only touch tenant A's mappings and rows (PAY-29).
- With the module off, or the gate off, sign-up, join and every request behave exactly as before.

## Test layout

- Unit: `packages/core/tests/payments-*.test.ts` (adapters, ids, secret, neutral-name guard, order
  policy), `packages/modules/payments/tests/*`, the web `lib/payments*.test.ts`, the screens' component
  tests under `apps/web/app/(app)/configuracoes/pagamentos/`.
- Integration (`apps/api/tests/integration/`): `payments-webhook`, `payments-apply`,
  `payments-order-policy`, `payments-cut`, `payments-admin`, `payments-access`, `payments-events`,
  `payments-member-reads`, `payments-members`, `payments-notifications`, `payments-hooks-report`,
  `store-gateway`, `access-hooks`, `first-admin-access`, plus the isolation sweeps.
- Database: pgTAP `204-access-gate`, `205-payments-tables`, `206-store-gateway`, `207-dashboard-cut`.
- Browser (`apps/web/e2e/`): `payments-gate.spec.ts` (the access story), `payments-admin.spec.ts`
  (the hub and the 320px backstops), `payments-store.spec.ts` (the store purchase through the
  gateway), with the helpers in `payments.ts`. They run against the test gateway only, start the worker
  themselves, touch only what carries their prefix and put the module rows back as they were.

## Requirement map

Where each requirement of Phase 09.1 is proved. `gate`, `admin` and `store` are the three browser specs.

| Requirement | Proved by |
|---|---|
| PAY-01 one mapping per (provider, product id) | `payments-webhook`, `payments-admin`, pgTAP `205-payments-tables` |
| PAY-02 provider-neutral seam | `payments-neutral.test.ts`, `payments-fake.test.ts` |
| PAY-03 webhook answers (404, 403, 200, once) | `payments-webhook`, the real adapter's webhook integration test |
| PAY-04 token sealed, never returned | `payments-secret.test.ts`, `payments-admin`, `IntegrationCard.test.tsx` |
| PAY-05 `access_grants` per e-mail | `access-grant.test.ts`, pgTAP `204-access-gate`, `signup`, `join`, `invites` |
| PAY-06 effective access state in SQL | pgTAP `204-access-gate`, `payments-cut` |
| PAY-07 event before the account exists | `payments-apply` |
| PAY-08 gate preconditions | `payments-admin`, `payments-cut`, `GateSwitchRow.test.tsx` |
| PAY-09 staff and first admin exempt | `first-admin-access`, `invites` |
| PAY-10 one sentence everywhere | `signup`, `join`, `payments-member-reads`, `gate` |
| PAY-11 several access products | `payments-apply`, `payments-admin` |
| PAY-12 Auth hooks answer one question | `access-hooks`, pgTAP `175-access-hooks` |
| PAY-13 cut and return | `payments-apply`, `payments-cut`, `gate` |
| PAY-14 `SUBSCRIPTION_PENDING` | `payments-cut`, `lib/bootstrap.test.ts` |
| PAY-15 the cut screen and its link | `payments-member-reads`, `assinatura-pendente/page.test.tsx`, `gate` |
| PAY-16 Membros pill, filter, counts | `payments-members`, pgTAP `207-dashboard-cut`, `AdminMemberRow.test.tsx`, `gate` |
| PAY-17 devices forgotten, session kept | `payments-notifications`, pgTAP `153-push-subscriptions`, `gate` |
| PAY-18 nothing notifies the admin | `payments-notifications` (the silence cases) |
| PAY-19 the module package and its switches | `payments-admin`, `module.ts`, `ModuleToggles.test.tsx` |
| PAY-20 access products and the store mapping | `payments-admin`, `AccessProductsCard.test.tsx`, `ProductForm.test.tsx`, `admin`, `store` |
| PAY-21 Eventos | `payments-events`, `EventsList.test.tsx`, `admin` |
| PAY-22 Acessos | `payments-access`, `AccessList.test.tsx`, `admin` |
| PAY-23 refund and renewal on the store | `store-gateway`, `payments-apply`, pgTAP `206-store-gateway`, `store` |
| PAY-24 Comprar opens the checkout, the webhook creates the order | `payments-apply`, `payments-notifications`, `GatewayPurchase.test.tsx`, `store` |
| PAY-25 the amount the gateway reports | `store-gateway`, pgTAP `206-store-gateway`, `store` |
| PAY-26 the simulated purchase refused, Indisponível | `store-gateway`, `GatewayPurchase.test.tsx`, `store` |
| PAY-27 orders only through definers | pgTAP `206-store-gateway`, `payments-apply` |
| PAY-28 hooks rollout safety | `scripts/guard-auth-hooks.test.sh`, `payments-hooks-report` |
| PAY-29 tenant isolation | pgTAP `205-payments-tables`, the isolation sweeps, `payments-apply` |
| PAY-30 idempotency and order of events | `payments-order-policy` (unit and integration) |
| PAY-31 the preview and the release | `payments-admin`, `GateSwitchRow.test.tsx` |
| PAY-32 the platform row and its confirmation | `ModuleToggles.test.tsx`, `modulos/page.test.tsx` |
| PAY-33 every trigger of the real gateway | the real adapter's coverage test over its fixtures; the capture of real deliveries is a human step |
| PAY-34 the open product page unlocks itself | `GatewayPurchase.test.tsx`, `store` |
