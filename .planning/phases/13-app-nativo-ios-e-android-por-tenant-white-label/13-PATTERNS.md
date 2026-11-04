# Phase 13: App nativo iOS e Android por tenant (white-label) - Pattern Map

**Mapped:** 2026-11-04
**Files analyzed:** 42 new/modified
**Analogs found:** 36 exact or role-match / 42 (6 greenfield with no analog; see "No Analog Found")
**Tracked-source gate (#3645):** every analog path below was checked with `git ls-files` (25 core paths checked in one pass, all tracked). No `.gsd/capabilities` mirror path is used.

## Discrepancies Between CONTEXT/RESEARCH and the Repo (read first)

| Claim | Reality | Consequence |
|-------|---------|-------------|
| `apps/web/app/.well-known/...` routes | No `.well-known` folder exists. A dot-folder under `app/` is routable only by `[ASSUMED]` (RESEARCH Pattern 7). Nearest routable precedent is `apps/web/app/m/[slug]/manifest.webmanifest/route.ts` (a dotted segment `manifest.webmanifest` works as a route folder) | First plan must prove the route with a build + Playwright case before anything else depends on it. Fallback: `next.config.ts` `rewrites()` from `/.well-known/x` to `/well-known/x` |
| By-host answer gets a non-secret `app` block | `hostTenantSchema` (`packages/contracts/src/hosts.ts:120-134`) is `.strict()`. A new key makes the web's parse of the by-host answer FAIL for an old web / new API pair | Add `app: z.object({...}).nullable().optional()` inside the schema in the same plan; deploy order web-tolerant first. Same for `PublicTenant` in `packages/contracts/src/auth.ts:84` if the block is added there |
| "contracts barrel must not pull `legal.ts`" | `packages/contracts/src/index.ts` re-exports server-only `legal`; client-safe things live as SUBPATHS in `packages/contracts/package.json` `exports` | `native.ts` must be a new subpath `./native` (add to `exports`), never exported from `src/index.ts` (same rule `moderation.ts` states at its header) |
| `packages/core/server/apps/` | Does not exist (new directory). Kernel server dirs are flat by capability: `projects/`, `platform/`, `secrets/`, `tenancy/` | Create it as a sibling; note `biome.json` overrides exempt `packages/core/server/{tenancy,platform,projects,secrets,...}` from `noRestrictedImports`; the new dir needs the same exemption added if it imports `db/central` |
| "tenant admin lists for the reports list" | There is no moderation module package. Moderation is a KERNEL capability (`packages/contracts/src/moderation.ts`, `packages/core/server/moderation`, log page at `apps/web/app/(app)/configuracoes/moderacao/`) | Reports list = a new sibling page under `configuracoes/` gated by `KERNEL_PERMISSIONS` `moderation.manage`; new table is a tenant-set table owned by the kernel (SCHEMA-CONVENTIONS (f).2), not a module |
| "block action" exists in Phase 8 | Phase 8 blocks a MEMBERSHIP by an admin (`memberships.blocked_at`, `membership.blocked` event). Member-to-member block (blocker stops seeing the blocked) does not exist; `packages/modules/social` has follow/graph only | D-616 member block is a NEW table + read-path filter; do not reuse `blocked_at` |
| `CommentItem` has a menu | It has ONE delete button; its comment at `packages/modules/feed/ui/CommentItem.tsx:243-247` says "Phase 11's 'Denunciar' is when it becomes a menu" | Report on comments = turn that single control into the `PostMenu` pattern |
| Worker `apps/worker` | There is none (D-18). Worker = `ROLE=worker` of `apps/api/src/worker.ts`; modules register jobs through `defineModule({ jobs })` | Anonymisation job is a `JobDefinition` in the kernel list in `worker.ts` (tenant scope) |
| `apps/mobile` fits `turbo boundaries` | Root `turbo.json` tag `app` may depend on `kernel`, `contracts`, `module`, `tooling`, `app`; `apps/web` and `apps/api` carry `"tags": ["app"]` via their own `turbo.json` | `apps/mobile/turbo.json` = `{"extends":["//"],"tags":["app"]}`; it must depend only on `@rede-social/contracts` (+ `@rede-social/config`), which also passes the rule |

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `apps/mobile/package.json`, `tsconfig.json`, `vitest.config.ts`, `turbo.json` | config | n/a | `packages/modules/notifications/{package.json,tsconfig.json,vitest.config.ts,turbo.json}` + `apps/web/turbo.json` | role-match (workspace wiring only) |
| `apps/mobile/src/bridge/*` (zod bridge messages + handlers) | utility | event-driven | `packages/modules/notifications/contracts/index.ts` (zod `.strict()` schemas, versioned payload) | role-match |
| `apps/mobile/src/shell/{host-allowlist,ua,minversion}.ts` | utility | transform | `packages/contracts/src/hosts.ts` (`normalizeHost`, `isRegistrableHost`) + `apps/web/lib/install-gate.ts` (UA parse, pure) | exact (pure functions over plain objects) |
| `apps/mobile/src/snapshot/*` (offline feed store) | utility | file-I/O | `packages/contracts/src/hosts.ts` `createBoundedTtlCache` (pure store + adapter) | partial |
| lock state machine (`apps/mobile/src/lock/*`) | utility | event-driven | `apps/web/lib/install-gate.ts` `decideInstallGate` (pure decision over an env object) | role-match |
| `apps/mobile/app/*`, `native-screens/*`, `modules/privacy-cover` | component | request-response | none | none |
| `packages/contracts/src/native.ts` (+ `exports` entry) | contract | transform | `packages/contracts/src/moderation.ts` (client-safe subpath), `packages/contracts/src/projects.ts` (strict write-only bodies/answers) | exact |
| `packages/contracts/src/hosts.ts` (modify: `app` block) | contract | request-response | itself, `bootstrap.ts:74` additive rule | exact |
| `packages/contracts/src/bootstrap.ts` (modify: `purchaseVisible`, `pendingDeletion`) | contract | request-response | `bootstrap.ts` `profileForm: ...optional()` and `conversationsBadge .default('count')` | exact |
| migration: `push_subscriptions` kind/platform/env/version (generated half) | migration | CRUD | `packages/modules/notifications/db/schema.ts:140-175` + Phase 7 generated migration | exact |
| migration: `app.push_device_upsert` + `push_subscriptions_for_v2` (hand-written) | migration | CRUD | `supabase/migrations/20260930180227_push_subscriptions_functions.sql` | exact |
| pgTAP: native devices cross-tenant | test | CRUD | `supabase/tests/153-push-subscriptions.sql` | exact |
| migration: `memberships.deletion_due_at` (+ marker) and deletion functions | migration | CRUD | `20260930180227_...` (definer + live predicate); `supabase/tests/146-event-soft-delete.sql`, `112-community-soft-delete.sql` for soft-state tests | role-match |
| migration: reports + member blocks (tenant set) | migration | CRUD | `supabase/tests/154-moderation-log.sql` + kernel `moderation-log` schema | role-match |
| migration (central): `platform.tenant_apps`, `platform.tenant_app_credentials` | migration | CRUD | `supabase/central/migrations/20261022212146_platform_registry.sql`, `20261027171040_project_owner_token.sql` | exact |
| `packages/core/db/central/apps.ts` (drizzle schema, central) | model | CRUD | `packages/core/db/central/projects.ts` | exact |
| pgTAP: central app tables exposure | test | CRUD | `supabase/tests/210-central-registry.sql` section 3 | exact |
| `packages/core/server/apps/*` (seal/validate/held reads) | service | CRUD | `packages/core/server/projects/token.ts`, `credentials.ts`, `secrets/sealed.ts` | exact |
| `apps/api/src/routes/platform/apps.ts` (+ mount in `platform/index.ts`) | route | request-response | `apps/api/src/routes/platform/projects.ts` `tokenRoute` | exact |
| `packages/modules/notifications/server/push/transport.ts` (modify: union + `transportFor`) | service | event-driven | itself (`PushTransport` seam, `fakePushTransport`) | exact |
| new `push/apns.ts`, `push/fcm.ts` | service | event-driven | `webPushTransport` in `transport.ts:118-155` | role-match |
| `packages/modules/notifications/server/push/send-job.ts` (modify) | service | batch | itself (`:152`, `:159` sections) | exact |
| `packages/modules/notifications/server/push-subscriptions.ts` + `routes.ts` + `contracts/index.ts` (device save/delete) | route | CRUD | same files (`savePushSubscription`, `pushSubscriptionInputSchema`) | exact |
| `apps/web/proxy.ts` (modify: `.well-known`) | middleware | request-response | itself (`PUBLIC` at `:28`, 2a gate at `:212`) | exact |
| `apps/web/app/.well-known/{apple-app-site-association,assetlinks.json}/route.ts` | route | request-response | `apps/web/app/m/[slug]/manifest.webmanifest/route.ts` | role-match |
| `apps/web/lib/install-gate.ts` (modify: marker first) + `InstallGate.tsx`, root layout | utility/component | transform | itself + `install-gate.test.ts` UA table | exact |
| `apps/web/lib/native-app.ts` (`isNativeApp`, bridge client) | utility | event-driven | `apps/web/lib/push.ts` (injected window slice types) | role-match |
| `apps/web/lib/push.ts`, `components/push/PushControls.tsx`, `FirstOpenAsk.tsx` (native variant) | component | event-driven | themselves | exact |
| `apps/web/app/api/push/subscriptions/route.ts` (native body union) | route (BFF) | request-response | itself | exact |
| `apps/web/components/feed/useSharePost.ts` (bridge `share`) | hook | event-driven | itself (injected surfaces) | exact |
| `apps/web/app/(app)/actions.ts` `logout` (modify) | action | request-response | itself `:18` | exact |
| `/plataforma` "App" tab: `components/platform/TenantTabs.tsx`, `app/(platform)/plataforma/tenants/[id]/app/{page,actions,loading}`, `AppCredentialsCard` etc. | component/action | CRUD | `.../banco/{page,actions}.tsx`, `TokenCard.tsx`, `ReplaceTokenSheet.tsx`, `ProjectTokenFields.tsx` | exact |
| delete-account screen + action (web) | component/action | request-response | `apps/web/app/(app)/perfil/editar`, `perfil/actions.ts`, `LogoutForm` | role-match |
| deletion routes (API) + anonymisation job | route/job | batch | `packages/modules/notifications/server/fanout-job.ts`, `packages/core/server/tenancy/daily-dispatch.ts`, `apps/api/src/worker.ts` | role-match |
| Loja purchase switch (hide price/button) | component | request-response | `apps/web/app/(app)/loja/{ProductForm,payment-actions}`, `packages/core/server/tenancy/access.ts` `accessCheckoutUrl` | role-match |
| Perfil/Configurações rows (lock switch, delete row) | component | request-response | `apps/web/app/(app)/configuracoes/page.tsx` `Row` + `PushSettingRow` | exact |
| report/block UI on post and comment | component | request-response | `packages/modules/feed/ui/PostMenu.tsx`, `CommentItem.tsx:243` | exact |
| reports list page (admin) | component | CRUD | `apps/web/app/(app)/configuracoes/moderacao/{page,ModerationLog,actions}` | exact |
| `scripts/app-release/*`, root `package.json` `platform:app-release` | utility | batch | `scripts/reseal.ts`, `scripts/reissue-credentials.ts`, root `package.json` `platform:*` | role-match |
| `.github/workflows/app-release.yml` | config | batch | `.github/workflows/deploy-api.yml` (WIF, `production` env) + `scripts/check-workflows.sh` | role-match |

## Pattern Assignments

### A. `apps/mobile` workspace wiring (package.json, tsconfig, vitest, turbo, CI)

**Analog:** `packages/modules/notifications/{package.json,tsconfig.json,vitest.config.ts,turbo.json}`, `apps/web/turbo.json`, `pnpm-workspace.yaml` (`apps/*` already covers `apps/mobile`).

**package.json shape** (notifications `package.json:1-12`): `"private": true`, `"type": "module"`, scripts exactly `typecheck: tsc --noEmit`, `lint: biome check .`, `test: vitest run`; exact-pinned versions (no carets), deps `@rede-social/contracts: workspace:*`, devDeps `@rede-social/config: workspace:*`, `@types/node: 24.13.4`, `vitest: 5.0.0`, `zod: 4.6.2`. Do NOT depend on `@rede-social/core` (kernel server code; mirrors "apps/web never imports packages/db"). Expo/RN deps are pinned exact too.

**tsconfig** (notifications `tsconfig.json`): extends `../../config/tsconfig.base.json` (for `apps/mobile` the path is `../../packages/config/tsconfig.base.json`; the notifications file uses `../../config/` because it sits at `packages/modules/x`, so recompute). Base is `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module ESNext/Bundler`, `noEmit`. Add `"jsx": "react-native"` and `"lib": ["ES2023"]`; keep `types: ["node"]` only for the pure-module tests.

**vitest.config.ts** (Vitest 5 does not walk up; copy `packages/contracts/vitest.config.ts`):
```typescript
import { vitestBase } from '@rede-social/config/vitest.base';
import { defineConfig, mergeConfig } from 'vitest/config';
export default mergeConfig(vitestBase, defineConfig({ test: { include: ['tests/**/*.test.ts'] } }));
```
The pure modules (bridge, host allow-list, id derivation, snapshot store, lock machine, UA parse) must be importable under node with NO `react-native` import; keep RN components in `app/` and `src/native-screens/` outside the `tests/**/*.test.ts` include (or mock). Native-module tests are manual/UAT.

**turbo.json:** `{ "extends": ["//"], "tags": ["app"] }` (copy `apps/web/turbo.json:1-3`). Root `turbo.json` `build.outputs` do not cover Expo; `apps/mobile` should NOT define a `build` script in the turbo graph (EAS/Gradle/Xcode are not turbo tasks), or `pnpm turbo typecheck build test` (the `verify` script, `ci.yml` line 87-88) would try to run it. Give it only `typecheck`, `lint`, `test`.

**CI:** no new `ci.yml` job is needed for the pure tests: the existing `static` job runs `pnpm turbo typecheck build test` and `pnpm boundaries` (ci.yml:87-100) and will pick `apps/mobile` up. Run `pnpm boundaries:negative` unchanged. Add `apps/mobile/**` to nothing in `deploy-api.yml` `paths` (it must not trigger an API deploy; `packages/**` already does for contracts).

**Biome:** root `biome.json` `files.includes` already covers `apps/mobile`; add `!apps/mobile/ios`, `!apps/mobile/android`, `!apps/mobile/.tenant` ignores (generated, never committed per RESEARCH anti-patterns).

### B. Pure TS modules in `apps/mobile/src/**`

**Host allow-list / url classification** - analog `packages/contracts/src/hosts.ts`. Reuse, do not rewrite, `normalizeHost` and `isRegistrableHost` (import from `@rede-social/contracts`; note `src/index.ts` also re-exports `legal`, so import host helpers from a client-safe subpath: add `./hosts` to `exports` or re-export them from `./native`):
```typescript
// packages/contracts/src/hosts.ts
export function normalizeHost(raw: string | null | undefined): string | null { ... }
export const HOST_SHAPE = /^[a-z0-9.-]{1,253}$/;
export const isRegistrableHost = (host: string): boolean => HOST_SHAPE.test(host);
```
Allow-list rule: parse with `new URL`, require `https:`, no userinfo, `normalizeHost(url.hostname) === bakedHost` exactly; everything else external.

**UA token parse** - analog `apps/web/lib/install-gate.ts:20-80`: pure functions over a plain env object, regex tokens, "UX policy, NOT an authorization boundary" docblock, and a UA fixture table in `install-gate.test.ts:14-50` (copy that table style for `RedeSocialApp/<v> (ios|android)` cases, including the real WKWebView UA with no `Safari` token and the Android `; wv)` UA).

**Lock state machine** - analog `decideInstallGate` (install-gate.ts:93-110): a pure `decide(env) -> discriminated union`, rule order written in the docblock, all inputs passed in (`now`, `backgroundedAt`, `enrolledLevel`, `switchOn`). Same for the minVersion check.

**Bridge messages** - analog `packages/modules/notifications/contracts/index.ts:235-260` and `:318-322` (`z.object({ v: z.literal(PUSH_PAYLOAD_VERSION), ... }).strict()`): one `z.discriminatedUnion('type', [...])` with `v: z.literal(1)`, every member `.strict()`, bounded strings (`.max(...)`), and path fields validated with the existing `PUSH_PATH` regex from `contracts/index.ts:269`:
```typescript
export const PUSH_PATH = /^\/(?![/\\])[^\\\s]*$/;
```
(Move or duplicate it into `native.ts`; `apps/mobile` must not import `@rede-social/module-notifications`.) Both sides parse with the SAME schema (web side `apps/web/lib/native-app.ts`).

**Snapshot store** - analog `createBoundedTtlCache` in `hosts.ts:55-` (pure store behind an interface; the file adapter is injected). Bound the snapshot with zod (max ~20 posts, string max lengths) before writing.

**Id derivation** `deriveAppIds(primaryHost)` - put in `packages/contracts/src/native.ts` per RESEARCH Pattern 6, test file `packages/contracts/tests/native.test.ts` (contracts tests dir is `tests/**/*.test.ts`, see its `vitest.config.ts`).

### C. `packages/contracts/src/native.ts` (contract, transform)

**Analog:** `packages/contracts/src/moderation.ts` (header docblock for a client-safe SUBPATH; `as const` vocabularies) and `packages/contracts/src/projects.ts`.

**Write-only body / strict answer pattern** (`projects.ts:487-497`):
```typescript
export const replaceTokenBodySchema = z
  .object({
    token: z.string().trim().min(1).max(TOKEN_MAX_LENGTH),
    tokenExpiresAt: z.string().max(10).optional(),
  })
  .strict();
export const replaceTokenAnswerSchema = z.object({ ok: z.literal(true) }).strict();
```
Copy for each App credential kind (`ascKey`, `playServiceAccount`, `apnsKey`): body `.strict()`, trimmed, `max()` bound, answer `{ ok: true }` only. The panel read is `{ held: boolean, heldAt: string | null }` `.strict()` per credential (`projects.ts:393`: `credentials: z.object({ held: z.boolean(), updatedAt: z.string().nullable() }).strict()`).

**Export wiring:** add `"./native": "./src/native.ts"` to `packages/contracts/package.json` `exports` (list at lines 14-28), keep it OUT of `src/index.ts`.

### D. Bootstrap additive fields (`purchaseVisible`, `pendingDeletion`)

**Analog:** `packages/contracts/src/bootstrap.ts:64-90`. Rule text (line ~72-74): "Every future ADDITIVE bootstrap field follows this rule: `.default(...)` or `.optional()`, never required." and the `profileForm` precedent:
```typescript
profileForm: profileFormBootstrapSchema.optional(),
```
Declare in the schema (plain `z.object` strips unknown keys); API side `apps/api/src/routes/me.ts:206-240` builds the object with conditional spread `...(profileForm ? { profileForm } : {})` - copy that. `purchaseVisible` default must be computed from the store switch and the UA marker header the API reads; absent reads as `true` for old APIs (web hides nothing).

### E. Push storage migration + functions (`push_subscriptions`)

**Analog (schema):** `packages/modules/notifications/db/schema.ts:140-175` (drizzle table with `pgPolicy` owner select/delete, unique `(tenant_id, endpoint)`). The generated half is the ALTER from RESEARCH Pattern 4 (kind default `'webpush'`, nullable `p256dh`/`auth`, CHECK `push_subscriptions_kind_chk`). Edit the drizzle table so `drizzle-kit generate` emits it; do NOT hand-edit the generated file.

**Analog (functions):** `supabase/migrations/20260930180227_push_subscriptions_functions.sql`. Copy these exact conventions for `app.push_device_upsert(kind, token, platform, environment, app_version)`:
```sql
create or replace function app.push_subscription_upsert(...)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
...
  if v_t is null or v_u is null then
    raise exception 'push_subscription_upsert: refused' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m
     where m.tenant_id = v_t and m.user_id = v_u and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null) then ...
  delete from public.push_subscriptions s
   where s.tenant_id = v_t and s.endpoint = p_endpoint and s.user_id <> v_u;   -- handoff
  insert ... on conflict (tenant_id, endpoint) do update set user_id = excluded.user_id, ...
$$;
--> statement-breakpoint
revoke all on function ... from public;--> statement-breakpoint
grant execute on function ... to authenticated;--> statement-breakpoint
```
Rules to keep: `set search_path = ''`, fully-qualified names, scope `tenant_id` to `app.tenant_id()` in every statement (owner `postgres` bypasses RLS, header Pitfall 2), `--> statement-breakpoint` separators, `#variable_conflict use_column` in table-returning functions. For `push_subscriptions_for` add columns by a NEW function (`..._for_v2`) or a `create or replace` AFTER the worker is deployed (current return is `table (id uuid, user_id uuid, role text, endpoint text, p256dh text, auth text)`; the old worker selects explicit columns). The live predicate `status='active' and blocked_at is null and deleted_at is null` is at lines 58, 115, 155 of that file and is the one to reuse for the deletion deactivation (Pattern 10).

**Analog (test):** `supabase/tests/153-push-subscriptions.sql` (41 asserts). New file: next free number after `214-route-indexes.sql` is `215`/`216`, but check `supabase/tests` for the 215/216 files named in 210's header before choosing; copy: `begin; ... select plan(N);`, fixture ids with a unique prefix (`15300000-0000-4000-8000-...`), `tests.tenant()`, `tests.auth_user()`, `tests.member()`, a blocked member and a soft-deleted member, section 0 privilege facts (`prosecdef`, `search_path=""`, `anon` cannot execute, `authenticated` can), uniqueness per tenant with an adjacency check in tenant B, handoff, cross-tenant negative (`tests.as_tenant(B, ...)` sees none of A's rows), and `rollback`. The two-tenant negative test is required by CONTEXT "Established Patterns" and D-606.

### F. Native transports in the worker

**Analog:** `packages/modules/notifications/server/push/transport.ts` (read in full).

Seam to extend (lines 18-45):
```typescript
export type PushOutcome = 'sent' | 'gone' | 'dropped' | 'retry';
export interface PushTarget { endpoint: string; p256dh: string; auth: string; }
export interface PushTransport { send(target: PushTarget, payload: string, opts: PushSendOptions): Promise<PushOutcome>; }
export function outcomeForStatus(status: number | undefined): PushOutcome { ... }   // 2xx sent; 404/410 gone; 400/413 dropped; else retry
export function pushTransport(): PushTransport {
  return env.PUSH_TRANSPORT === 'webpush' ? webPushTransport : fakePushTransport;
}
```
Change `PushTarget` to a discriminated union on `kind` (`'webpush' | 'apns' | 'fcm'`) without changing the existing webpush branch; replace `pushTransport()` with `transportFor(kind)` and keep `pushTransport()` as a deprecated alias so `send-job.ts:159` and tests keep compiling in the same commit.

**Fake transport (CI):** copy `fakeStatus` + `fakePushTransport` + `fakePushOutbox()`/`resetFakePushOutbox()` (lines 56-86). For native fakes, the token suffix decides the status the way `/status/<code>` does for the endpoint. `apps/api/vitest.config.ts` and notifications `vitest.config.ts` already pin `PUSH_TRANSPORT: 'fake'`; native kinds must be fake under the same variable (no new env switch needed; add `APNS_*`/`FCM_*` to `packages/core/server/env.ts` with `assertProductionEnv` the way VAPID is refused).

**Real transport shape:** copy the `webPushTransport` try/catch that turns any thrown error into `outcomeForStatus(status)` with a 10 s timeout (`PUSH_SEND_TIMEOUT_MS = 10_000`, lines 91-153). APNs override: 403 `InvalidProviderToken`/`ExpiredProviderToken` must map to `retry` (never `gone`), per RESEARCH Pattern 5. Use `jose` (`SignJWT`, ES256) and `node:http2` session pool per tenant; `google-auth-library` for FCM.

**Per-tenant unseal in the worker:** `open(sealed, aad)` from `packages/core/server/secrets/sealed.ts:255`; cache unsealed key in memory per tenant; never log. The AAD for the new tables is `<rowId>:<column>` (see section H).

**send-job** (`push/send-job.ts:152-196`, read above): the per-subscription loop builds the payload once via `buildPushPayload({ tenantName, iconUrl, hint: push, badge })` and calls `transport.send({ endpoint, p256dh, auth }, json, { ttlSeconds, urgency, topic })`. Change only: select `kind`/`platform`/`app_environment` from the new function, pass the union to `transportFor(row.kind)`. Keep the report path unchanged:
```typescript
await tx.execute(sql`select app.push_subscription_report(${id}::uuid, ${REPORT[outcome]})`);
```
Retry bookkeeping (`PUSH_MAX_ATTEMPTS`, `PUSH_RETRY_DELAYS_SECONDS`, `enqueueInTx(... singletonKey ...)`) is reused as is.

**Save/delete routes:** `server/push-subscriptions.ts:25-70` (`savePushSubscription` -> `withTenantTx(ctx, tx => tx.execute(sql\`select app.push_subscription_upsert(...)\`))`; `deletePushSubscription` is a plain owner-scoped DELETE) and `contracts/index.ts:235-260` (`pushSubscriptionInputSchema`, `.strict()`). Add `pushDeviceInputSchema` (new schema, same `.strict()` style) rather than loosening the old one, and a union at the route. `isAllowedPushEndpoint` (endpoint.ts) must not run for native tokens; add a separate token shape check. `pushSubscriptionDeleteSchema` (`contracts/index.ts:257`) already accepts any `endpoint` string, so a native token deletes through the existing DELETE. Route registration is in `server/routes.ts:103-134`.

**Exports:** `server/index.ts` re-exports; the kernel never imports module internals (MOD-02). Anything the web needs goes through `@rede-social/module-notifications/contracts`.

### G. `apps/web/proxy.ts` and the `.well-known` routes

**Analog:** `apps/web/proxy.ts` itself.

`PUBLIC` list (line 28), add one entry in the same style, with a dated comment like its neighbours:
```typescript
const PUBLIC = [
  /^\/entrar(?:\/|$)/,
  ...
  /^\/serwist\//,
  /^\/~offline(?:\/|$)/,
  // 08-08: browsers POST CSP violation reports without a session too (the sign-in page has one).
  /^\/api\/csp-report$/,
  // 13-xx: Apple's CDN and Android fetch the verification files with no session.
  /^\/\.well-known\//,
];
```
The 2a gate (lines 211-222) must let `/.well-known/*` through BEFORE the redirect; copy the existing allow of two paths:
```typescript
if (!coordinates) {
  const path = request.nextUrl.pathname;
  if (path === '/comunidade-indisponivel' || path === '/api/csp-report') {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  }
  ...
```
The alias 308 (`primaryHostRedirect`, lines 100-128) is correct and stays (aliases are not in the app), but it runs before everything, so the Playwright case for "alias host" must assert 308 and for "primary host" 200 with no redirect. The matcher (lines 342-346) excludes only image extensions, so `assetlinks.json` passes through the proxy: no change needed. Every early return must go through `withCsp(...)` (Pitfall 10 noted in the file).

**Route handler analog:** `apps/web/app/m/[slug]/manifest.webmanifest/route.ts`: `export const dynamic = 'force-dynamic'`, host-authoritative (`getHostBrand()`), a `notFound()` helper returning `Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': NO_STORE } })`, NO cookies read, a tenant lookup momentarily unavailable -> 404 (never a neutral body under a tenant's name). For the well-known files use `Cache-Control: public, max-age=300` (RESEARCH) and `Content-Type: application/json`; absent or partial `app` data -> 404 (no partial file). Data comes from the by-host answer through `resolveHostTenant` / `getHostBrand` (`apps/web/lib/host-brand.ts`, `lib/tenant-host.ts`), not a new direct DB read.

**By-host source:** `packages/core/server/tenancy/public-tenant.ts` reads identity through `withPlatformTx` (central mirror) and `tenant_domains` primary host; the new non-secret `app` block is read in the same transaction from `platform.tenant_apps` (a join on `tenants.id`). The by-host route handler is in `apps/api/src/routes/public.ts`; add the block to `hostTenantSchema` as optional (see Discrepancies).

### H. Control-plane tables and sealed custody (`platform.tenant_apps`, `platform.tenant_app_credentials`)

**Analog (table):** `packages/core/db/central/projects.ts` (header lines 17-22: "Every table below is born with RLS on and ZERO policies ... Adding a policy for `authenticated` here is always a bug (SCHEMA-CONVENTIONS (i))"). Sealed columns are `text` named `*_sealed` (`serviceKeySealed: text('service_key_sealed')`), formats not enums for `state`/`provider`, a CHECK for format. Migration location: `supabase/central/migrations/` with its own ledger (existing: `20261022212146_platform_registry.sql`, `20261027171040_project_owner_token.sql`, hardening files). Follow the two-file split: create + `*_hardening.sql` (grants revoke from `anon`/`authenticated`/`api_user`, `service_role` only). Generate with `pnpm db:generate:central`.

Design note from the registry: store the credential as ROWS (`kind`, `sealed`, `held_at`, `key_id`) so a new kind needs no migration; keep `held_at` plain for the panel's `held`/`heldAt` read.

**Analog (seal call + AAD):** `packages/core/server/projects/credentials.ts:116-126`:
```typescript
patch.serviceKeySealed = seal(values.serviceKey, `${row.id}:service_key`);
```
AAD = `<rowId>:<column>`; for the App tab: `${appRowId}:${kind}`. Read: `open(project.mgmtTokenSealed, \`${project.id}:mgmt_token\`)` (`projects/provider-for.ts:53`). `seal`/`open` come from `packages/core/server/secrets/sealed.ts:240-255`; every failure there throws `Error('sealed value unreadable')`, nothing logs. Never log a prefix, length or hash of a credential (`token.ts` header rule T-09.4-24).

**Analog (validate-before-replace):** `packages/core/server/projects/token.ts` and `credentials.ts:106-120`: validate against the real thing first (`validateAccess(...)` then `throw new ApiError(400, 'VALIDATION_FAILED', { access: 'invalid' })`), seal only after it works, replace in one platform transaction, then `invalidate...` caches. For the App tab validators: `.p8` via `createPrivateKey` EC P-256 header check; Google SA JSON `type === 'service_account'` + `client_email` + `private_key`; refusal is a closed code (`TokenRefusal`-style class whose message IS the code).

**Analog (route):** `apps/api/src/routes/platform/projects.ts:133-155` (route definition with `createRoute`, `requireSuperAdmin()` guard applied once in `routes/platform/index.ts`) and `:287-310` (handler):
```typescript
const { userId, requestId } = c.get('platformCtx');
const { id } = c.req.valid('param');
const body = c.req.valid('json');
await replaceProjectToken(id, { token: body.token, ... }, { userId, logger: c.get('logger') });
c.get('logger').info({ event: 'platform.projects.token', userId, requestId, tenantId: id }, 'platform write');
c.header('Cache-Control', 'no-store');
return c.json({ ok: true as const }, 200);
```
Log events carry ids only. Mount the new `apps/api/src/routes/platform/apps.ts` in `routes/platform/index.ts` next to `projects.ts`.

**Analog (pgTAP):** `supabase/tests/210-central-registry.sql` section 3 (EXPOSURE: RLS on and not forced, ZERO policies, no privilege for `anon`/`authenticated`/bare `api_user`, full for `service_role`, tenant lane gets 42501 on every read/write). Its header notes the exposure counts cover all platform tables (currently "eleven"): adding two tables changes that count assertion, so the plan must update 210's expected totals (or the new file asserts independently). Also `tenant-set-no-platform.test.ts` (referenced in `projects.ts` header) proves the platform schema never reaches a tenant set: new tables must not leak there.

### I. `/plataforma` "App" tab (web)

**Analog:** `apps/web/components/platform/TenantTabs.tsx:7-20` and `apps/web/app/(platform)/plataforma/tenants/[id]/banco/{page,actions,loading,error}.tsx`.

Tab list change:
```typescript
const TAB_KEYS = ['marca', 'modulos', 'dominios', 'admins', 'banco', 'status'] as const;   // insert 'app' before 'status'
const TAB_LABEL_KEY: Record<TabKey, 'brand'|'modules'|'domains'|'admins'|'database'|'status'> = {...}  // add app: 'app'
```
Add the `app` label to the `platform` catalog (next-intl, PWA-03: no literals in components; `scripts/check-ui-literals.sh` enforces it in `pnpm lint`). Update `TenantTabs.test.tsx` (it asserts the order).

**Server-action model** (`banco/actions.ts`, read above): `'use server'`, `const uuid = z.uuid()` checked first, `apiFetch(path, { method })`, `readEnvelope` to `ApiClientError`, 401/403 -> `platformRedirectPath(err)` with `redirect()` called AFTER the try/catch (Next 16 rule), `revalidateTenantViews(tenantId)` after a changing answer, return `{ ok }` records and catalog keys only ("Nothing here ever returns a value the operator typed or the API sealed"). Test file next to it: `actions.test.ts`.

**Components to mirror:** `TokenCard.tsx` + `TokenCardActions.tsx` (card showing held/expiry, no value), `ReplaceTokenSheet.tsx` (+ test) for the write-only paste sheet, `ProjectTokenFields.tsx` (field validation), `TokenHowTo.tsx` (how-to copy), `TokenPill.tsx` (status pill). The UI-SPEC (`13-UI-SPEC.md`, UI-D-6xx) owns layout; copy structure not styling. A sketch gate (PU-10) precedes any UI task.

### J. Install gate, in-app marker, push UI in the app

**Analog:** `apps/web/lib/install-gate.ts` (full read above) and `apps/web/lib/install-gate.test.ts` UA fixture table.

Change `decideInstallGate` so the marker is the FIRST rule (before `desktop`):
```typescript
export function decideInstallGate(env: GateEnv): GateDecision {
  const platform = detectPlatform(env);
  if (platform === 'desktop') return { gated: false };
  if (env.standalone) return { gated: false };
  if (isInAppBrowser(env.userAgent)) return { gated: true, screen: 'in-app', canContinue: true };
  ...
```
Add `isNativeApp(userAgent)` (regex `/\bRedeSocialApp\/(\d+(?:\.\d+)*) \((ios|android)\)/`) in the same file or a sibling `lib/native-app.ts`, returning `{ gated: false }` first. A browser UA never matches, so the existing test table must stay green unchanged (D-603 "test showing a browser sees no difference"). Server side: the root layout sets `data-install-gate="pending"` (`app/layout.tsx:76,91`, conditional on `gateEnabled`); write `open` server-side when the request header UA carries the marker (Pitfall 1: no 4 s blank). `globals.css` hides body while `pending`.

**Push UI:** `components/push/PushControls.tsx` (`PushSettingRow`, `SoftAskCard`, `usePushDevice`, `useEnable`), `FirstOpenAsk.tsx`, `lib/push.ts`. The web enable flow's rule (lib/push.ts header fact 1: permission prompt is the FIRST await of a tap) is for the browser; in the app the "Ativar" button posts a bridge message `push.enable` instead and the shell fires the system prompt. Keep `lib/push.ts` browser logic untouched; add `lib/push-native.ts` with the same exported state vocabulary (`PushState`) so the components switch by `isNativeApp()`, with injected `window` slices like `PushWindowLike` for tests. The BFF door `app/api/push/subscriptions/route.ts` keeps its gates (same-origin 403, 4 KiB cap 413, `getClaims()` 401, strict schema, forward once, empty `no-store` body, shape-only logs) and just accepts the union body.

**Share:** `components/feed/useSharePost.ts:44-60`: `sharePost({ url, title }, { share: nav?.share ? (data) => nav.share(data) : undefined, clipboard: ... })`. Inject a bridge-backed `share` when `isNativeApp()` (Pitfall 6); the module `sharePost` in `packages/modules/feed/ui/sharePost.ts` is untouched.

**Logout:** `apps/web/app/(app)/actions.ts:18-31` `logout()` does `signOut({ scope: 'local' })` then `redirect()` after try/catch. The device forget + snapshot/lock clear is done CLIENT-side before the action submit (see `ForgetSignedOutDevice.tsx` and `LogoutForm` in `components/shell`); add `logout.done` bridge message there, not in the server action.

### K. Account deletion (web screen, API, job)

**Screen/actions analog:** `apps/web/app/(app)/perfil/{actions.ts,editar/}` and the Configurações `Row` (`configuracoes/page.tsx:20-70`: `Row({ icon, label, trailing, href })` with the whole-row `Link`). Entry row in Configurações, screen at `/configuracoes/excluir-conta` (UI-SPEC decides the exact path). Server action shape = `logout` (try/catch, then `redirect()`).

**Soft-state analog:** Pattern 10 and the live predicate. `memberships.deleted_at` already exists (used in every list/counter/push). Test style: `supabase/tests/112-community-soft-delete.sql`, `146-event-soft-delete.sql`.

**Job analog:** `packages/modules/notifications/server/fanout-job.ts` (a `JobDefinition` with zod-validated payload; malformed payload DROPPED with a shape-only warning, never raised; a transient failure raises so pg-boss retries and the dedupe key makes it idempotent) and the kernel dispatchers `packages/core/server/tenancy/daily-dispatch.ts` (+ `armDailyTenantDispatch` registered in `apps/api/src/worker.ts`). The anonymisation is a TENANT-scope job (runs per ready project; handler receives `{ projectId }` as 2nd arg, see worker.ts header). Register the queue name through `registerJobQueues` and the job in the kernel list in `worker.ts` (imports at lines 1-37 show the kernel jobs). Enqueue inside the request transaction with `enqueueInTx(tx, QUEUE, payload, { singletonKey, startAfter })` (`boss.ts:278`; sending lane must match the queue scope or it throws before insert).

**Requirement mapping:** notifications schema already says "a departed actor renders 'Membro removido'" (`notifications.actor_user_id` set-null); the same tombstone text for posts/comments.

### L. Report and block slice (D-616)

**Post/comment menu analog:** `packages/modules/feed/ui/PostMenu.tsx` (BottomSheet rows, `canManage` driven by DATA from the API never a role, ConfirmDialog with FIXED catalog strings that quote nothing) and `CommentItem.tsx:241-259` (single delete button with `data-comment-delete`; the comment names Phase 11's "Denunciar" as the moment it becomes a menu). Add `canReport` rider data from the API the same way `canManage` rides; labels come from the app catalog (PWA-03), module components hold no strings.

**Admin list analog:** `apps/web/app/(app)/configuracoes/moderacao/{page.tsx,ModerationLog.tsx,actions.ts}`: `notFound()` (never 403) without `moderation.manage` in `bootstrap.permissions` or on the platform host, keyset paging via `InfiniteScroll`, `?acao=` chips parsed by `parseModerationAction`, pt-BR view builder in `lib/moderation-view.ts`, loader in `lib/moderation.ts`. Add a sibling `configuracoes/denuncias/`.

**Data/log analog:** `supabase/tests/154-moderation-log.sql` and `packages/contracts/src/moderation.ts` (vocabularies are CHECK constraints fixed with the table: D-337 "reversibility costly"; appended values only). Acting on a report that removes content must go through `recordModerationAction(tx, ...)` so a removal without its log row stays impossible. The planner must name Phase 11 ids covered (MODER-05 and member blocking per CONTEXT D-616) so Phase 11 is not planned twice.

**Block filter:** every read path that lists a member's content (feed, comments, search, chat) needs the blocked-by-me exclusion; start from the places that already apply `deleted_at is null` (`packages/modules/feed/server/notifications.ts:136-229`) and the social module's `can_read_for` function (`supabase/tests/203-social-can-read-for.sql`) as the existing visibility seam.

### M. Purchase switch (Loja)

**Analog:** `packages/core/server/tenancy/access.ts` `accessCheckoutUrl` (Phase 09.1), `packages/contracts/src/payments.ts` (`checkoutUrl`), `apps/web/app/(app)/loja/{ProductForm.tsx,ProductGrid.tsx,[productId]/page.tsx,payment-actions.ts}`. Hide logic keyed by `bootstrap.purchaseVisible` (section D), computed server-side from the store switch + UA platform; the web only branches on the boolean, never sniffs the store itself. Members who already have access render unchanged (access grant check is the existing one).

### N. Release script and workflow

**Script analog:** `scripts/reseal.ts`, `scripts/reissue-credentials.ts` (tsx scripts using kernel sealed helpers, wired as `"platform:reseal": "tsx scripts/reseal.ts"` in root `package.json:25-27`). Add `"platform:app-release": "tsx scripts/app-release/index.ts"`. Note `biome.json` excludes `!scripts/**` from the restricted-imports override (scripts may import kernel server code).

**Workflow analog:** `.github/workflows/deploy-api.yml`:
- WIF auth step (lines 74-79): `google-github-actions/auth@v3` with `workload_identity_provider: ${{ vars.WIF_PROVIDER }}` and `service_account: ${{ vars.DEPLOY_SA }}`; use a DEDICATED read-only service account var (D-619), not `DEPLOY_SA`.
- Required-reviewer environment (lines 108-121): `environment: { name: production }`; the new workflow uses `environment: app-release`.
- Secret Manager names `platform-master-keys-prod` and `migration-database-url-prod` (header lines 21-26).
- `permissions: { contents: read, id-token: write }` (lines 44-46).
- `concurrency` group with `cancel-in-progress: false` for a serial release.
Differences: `on: workflow_dispatch` only with inputs `tenant`, `env`, `platform`; `runs-on: macos-26` for iOS; `::add-mask::` every unsealed value; write credentials only under `$RUNNER_TEMP`, delete in an `if: always()` last step; no `upload-artifact` of build inputs; never `pilot`/`deliver` submit-for-review.
- **`scripts/check-workflows.sh` (and `--self-test`) lints workflows** (`pnpm guard:workflows`, run in CI): read it before writing the file; it enforces step ordering for `deploy-api.yml` and may reject a new workflow shape, so extend it for `app-release.yml` in the same plan. Also `.github/workflows/ci.yml` must not trigger on this workflow.

## Shared Patterns

### Additive API/contract change (old web / old API / old app coexist)
**Source:** `packages/contracts/src/bootstrap.ts:64-90`, `apps/api/src/routes/me.ts:206-240`. **Apply to:** bootstrap fields, by-host `app` block, push device body, bridge `v`, `minVersion`. Optional or defaulted, declared (plain `z.object` strips unknown), `.strict()` only on request bodies and write-only answers, never on answers the older web parses.

### Sealed, write-only credentials
**Source:** `packages/core/server/secrets/sealed.ts` (`seal`/`open`, AAD `<rowId>:<column>`, plain `Error('sealed value unreadable')`), `packages/core/server/projects/token.ts` (validate then seal, closed refusal codes). **Apply to:** App tab credentials, worker APNs key read, release script unseal. Never log, return, or hash a value.

### Tenant scoping of definers
**Source:** `20260930180227_push_subscriptions_functions.sql` header + bodies. **Apply to:** every new `app.*` function (devices, deletion, reports, blocks): `security definer set search_path = ''`, `tenant_id = app.tenant_id()` in every statement, 42501 without a claim, `revoke ... from public`, `grant execute ... to authenticated`.

### Control-plane tables
**Source:** `packages/core/db/central/projects.ts` header + `supabase/tests/210-central-registry.sql` section 3. **Apply to:** `platform.tenant_apps`, `platform.tenant_app_credentials`: RLS on, ZERO policies, service_role only.

### Platform server actions
**Source:** `apps/web/app/(platform)/plataforma/tenants/[id]/banco/actions.ts`. **Apply to:** all App-tab actions (uuid check, apiFetch, closed catalog keys, redirect after try/catch, `revalidateTenantViews`).

### Fake transports in CI
**Source:** `PUSH_TRANSPORT=fake` pinned in `packages/modules/notifications/vitest.config.ts:28-30` and `apps/api/vitest.config.ts`. **Apply to:** APNs/FCM fakes: record in the outbox, status from the token suffix; no module test may reach a real push service.

### Browser sees no difference (D-603)
**Source:** `apps/web/lib/install-gate.test.ts` UA table and `components/pwa/InstallGate.test.tsx`. **Apply to:** every web change guarded by the marker: one test asserting the browser UA path is byte-identical (gate decision, push row, share, Loja).

### UI strings and design gate
**Source:** `scripts/check-ui-literals.sh` (run by `pnpm lint`), next-intl catalogs; UI-SPEC and sketch gate. **Apply to:** all new web UI: strings in the pt-BR catalog; no UI task before the approved sketch (memory: gate approvals need Igor's hand; keep API plans flowing past a pending gate).

### Two-tenant isolation
**Source:** `supabase/tests/153-push-subscriptions.sql` + `apps/api/tests/isolation-inventory.ts` (the web test `lib/route-handlers.inventory.test.ts` reads it as text, `apps/web/turbo.json` lists it as a test input). **Apply to:** device tokens, deletion requests, reports, blocks: pgTAP cross-tenant negative + an entry in the API isolation inventory for each new route.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/mobile/app/**` (Expo Router layouts, WebView route, `+native-intent`) | component | request-response | No React Native code in the repo. Use RESEARCH Pattern 1 (WebView props) as the spec |
| `apps/mobile/src/native-screens/**` (splash, offline, update, lock, cover) | component | event-driven | Greenfield; UI-SPEC native frames are the contract. Keep components thin over the pure modules in section B |
| `apps/mobile/modules/privacy-cover` (Swift/Kotlin Expo Module) | native module | event-driven | No native code in the repo |
| `apps/mobile/app.config.ts`, `tenant.schema.ts` (`.tenant/build.json`) | config | transform | No Expo config. Model `tenant.schema.ts` on `packages/contracts/src/projects.ts` strict zod bodies; share the schema with `scripts/app-release` |
| iOS/Android signing, fastlane, store API calls in `scripts/app-release/*` | utility | batch | No store-tooling precedent; only the unseal/WIF/Secret Manager parts have analogs (section N) |
| APNs HTTP/2 provider and FCM v1 client internals | service | event-driven | Only the `PushTransport` seam and `outcomeForStatus` exist; wire format from RESEARCH Pattern 5 |

## Metadata

**Analog search scope:** `packages/modules/notifications`, `packages/contracts/src`, `packages/core/{db/central,server/{secrets,projects,tenancy,platform,jobs}}`, `apps/web/{proxy.ts,lib,components/{pwa,push,platform},app/{(app),(platform),api,auth,m}}`, `apps/api/src/{routes,worker.ts}`, `supabase/{migrations,central/migrations,tests}`, `.github/workflows`, root `package.json`/`turbo.json`/`biome.json`.
**Files read in full or by targeted range:** ~45. **Tracked check:** done for 25 named analog paths.
**Pattern extraction date:** 2026-11-04
