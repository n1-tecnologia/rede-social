# Phase 12: Formulario de perfil do tenant - Pattern Map

**Mapped:** 2026-10-29
**Files analyzed:** ~70 new/modified (grouped by layer)
**Analogs found:** all matched (all paths verified with `git ls-files`, tracked source only); the CSV writer and the pgTAP/trigger lock have only partial analogs.

12-RESEARCH.md ("Architecture Patterns", "Existing-Code Map", "Verified In-Repo Facts") already holds the SQL for `app.profile_form_missing`, the `_gate` twins, the data model, the RLS table and the CSV rules. This file adds the analog per file plus short, verified excerpts. Do not duplicate the research SQL: reference it.

## File Classification

### Layer 1: contracts (`packages/contracts`)
| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/contracts/src/profile-form.ts` (new, subpath `./profile-form`) | contract | transform | `packages/contracts/src/payments.ts` | exact |
| `packages/contracts/package.json` (export) | config | - | its own `./payments` export | exact |
| `packages/contracts/src/errors.ts` (+`PROFILE_FORM_PENDING`) | contract | - | `SUBSCRIPTION_PENDING` entry (line 43) | exact |
| `packages/contracts/src/modules.ts` (+`profile_form` last) | contract | - | `payments` last entry (lines 9-21) | exact |
| `packages/contracts/src/bootstrap.ts` (+`profileForm` optional block) | contract | request-response | its own additive rule (line 73) | exact |
| `packages/contracts/src/moderation.ts` (+`profile_form_exported`) | contract | - | `post_removed` addition | exact |
| `packages/contracts/src/platform.ts`/`tests/platform.test.ts` (count 11 to 12) | test | - | line 61 `toHaveLength(11)` | exact |

### Layer 2: database
| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/db/schema/profile-form-questions.ts` | model | CRUD | `packages/modules/store/db/schema.ts` (`TENANT_ADMIN` fragment, admin-write tables) | role-match |
| `packages/core/db/schema/profile-form-answers.ts` | model | CRUD | `packages/core/db/schema/member-profiles.ts` (asymmetric per-op policies, `membership_id` cascade) | role-match |
| `packages/core/db/schema/index.ts` (+2 exports), `member-profiles.ts` (+column), `moderation-log.ts` (CHECK) | model | - | `nudgeDismissedAt` (member-profiles.ts:77); `moderation_log_action_chk` (moderation-log.ts:86) | exact |
| migration `<ts>_profile_form_module_key.sql` | migration | - | `supabase/migrations/20261019202758_social_module_key.sql` | exact |
| migration `<ts>_profile_form_tables.sql` (drizzle-generated) + moderation CHECK widening | migration | - | `supabase/migrations/20261019225153_moderation_post_removed.sql` | exact |
| migration `<ts>_profile_form_functions.sql` (`app.profile_form_missing`, `_gate` twins, lock trigger, grants) | migration | request-response | `supabase/migrations/20261020225255_access_gate_functions.sql` | exact (functions); no analog for the BEFORE UPDATE guard trigger (use moderation_log immutability triggers as syntax reference) |
| `supabase/tests/220-profile-form.sql` | test | - | `supabase/tests/205-payments-tables.sql` | exact |
| `supabase/tests/154-moderation-log.sql` (extend) | test | - | itself | exact |

### Layer 3: core server (`packages/core/server`)
| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `auth/require-auth.ts` (allow-list + refusal) | middleware | request-response | same file, `CUT_ALLOWED_PATHS` + cut check | exact |
| `tenancy/membership.ts` (`profileFormMissing`, call `_gate` twins) | service | request-response | same file (`accessState`, lines 27-48, 95, 113) | exact |
| `profile-form/member.ts` (get/save/dismiss/bootstrapBlock) | service | CRUD | `profiles/service.ts` (`dismissNudge`, `withTenantTx`) | role-match |
| `profile-form/admin.ts` (CRUD/reorder/archive/replace/impact/summary) | service | CRUD | `payments/gate.ts` (`setupLock`, `for('update')` module row) + `payments/setup.ts` | role-match |
| `profile-form/answers.ts` | service | CRUD | `profiles/service.ts` directory half (public vs staff read) | partial |
| `profile-form/export.ts` + `csv.ts` | service/utility | streaming | `tenancy/admin-members.ts` (admin lane + keyset via `../paging`); CSV writer has no analog | partial |
| `profile-form/lock-rules.ts` | utility | transform | pure-rule modules unit-tested in `packages/core/tests` | partial |
| `http/api-error.ts` (`ERROR_MESSAGES`) | utility | - | `SUBSCRIPTION_PENDING` message (line 24) | exact |
| `moderation/log.ts` (union) | service | CRUD | same file | exact |
| `biome.json` (allow list) | config | - | `!packages/core/server/payments/**` (lines 36-41) | exact |

### Layer 4: API
| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/api/src/routes/me.ts` (+3 routes, bootstrap block) | route | request-response | same file `POST /profile/dismiss-nudge` (lines 354-383) | exact |
| `apps/api/src/routes/members.ts` (+`/:membershipId/profile-answers`) | route | request-response | same file `readRoute` (line 96, D-23 404) | exact |
| `packages/modules/profile-form/{module.ts,contracts/index.ts,server/index.ts,server/routes.ts,README.md,package.json,turbo.json,tsconfig.json,vitest.config.ts}` | module | CRUD | `packages/modules/payments/*` | exact |
| `apps/api/src/modules/registry.ts`, `apps/api/src/app.ts` (mount `/v1/profile_form`) | config | - | `paymentsModule` (registry.ts:39,65), `.route('/v1/payments', ...)` (app.ts:140) | exact |
| `apps/api/tests/isolation-inventory.ts`, `admin-lane-inventory/profile-form.ts` (+`index.ts`) | test inventory | - | `admin-lane-inventory/payments.ts` | exact |

### Layer 5: web
| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/web/lib/bootstrap.ts` (case + pending redirect) | utility | request-response | `bootstrapRedirectPath` (lines 111-137), `acceptInviteRedirectPath` (146) | exact |
| `apps/web/lib/safe-next-path.ts` (new) | utility | transform | `apps/web/lib/continue-path.ts` | role-match |
| `apps/web/proxy.ts` (forward `x-rede-path`) | middleware | request-response | header forwarding at lines 87-110 (`x-tenant-*`) | exact |
| `apps/web/app/(auth)/completar-perfil/page.tsx` (+form client component) | component | request-response | `apps/web/app/(auth)/assinatura-pendente/page.tsx` | role-match |
| `apps/web/app/(app)/configuracoes/formulario-de-perfil/{page,actions,loading,tabs,...}.tsx` | component | CRUD | `configuracoes/pagamentos/*` (page, PaymentsTabs, tabs, actions, loading, *Sheet) | exact |
| builder question editor frame | component | CRUD | `configuracoes/regras/{RulesEditor,actions,page,loading}.tsx` | role-match |
| `apps/web/app/(app)/configuracoes/page.tsx` (new Row) | component | - | `canManagePayments` row (lines 134-149, 204-211) | exact |
| `apps/web/app/api/me/counters/route.ts` (`REFUSAL_FLOWS`) | route | request-response | line 37 | exact |
| `apps/web/components/shell/LiveShell.tsx` (+`LiveShell.pending.test.ts`) | component | event-driven | itself (SUBSCRIPTION_PENDING handling) | exact |
| `/perfil` notice + "Minhas respostas" | component | request-response | `apps/web/components/profile/ProfileCompletenessCard.tsx`, `lib/profile.ts` loaders | role-match |
| `apps/web/app/(app)/membros/[membershipId]/page.tsx` (answers block) | component | request-response | itself (own `Suspense` blocks) | role-match |
| CSV Route Handler (proxy attachment) | route | streaming | `apps/web/app/api/me/counters/route.ts` (`sameOriginGet`, `no-store`); no streaming analog | partial |
| `components/platform/ModuleToggles.tsx`, platform `modulos/page.tsx` | component | - | `extras` entries for existing modules | exact |
| `components/admin/ModerationLogRow.tsx`, `lib/moderation-view.ts` | component | - | exhaustive maps in same files | exact |
| `apps/web/messages/pt-BR/profileForm.json`, `platform.profile_form.json` | config | - | `payments.json`, `platform.payments.json` | exact |
| `scripts/check-static-routes.sh`, `apps/web/e2e/affected-map.json` | config | - | existing rows | exact |

### Layer 6: tests
| New test | Analog (mould) |
|---|---|
| `packages/contracts/tests/profile-form.test.ts` | `packages/contracts/tests/platform.test.ts` and payments contract tests |
| `packages/core/tests/require-auth-form.test.ts` | `packages/core/tests/require-auth-cut.test.ts` |
| `packages/core/tests/profile-form-csv.test.ts` | no analog (pure writer; use the OWASP payload list) |
| `membership-pick.test.ts` fixtures | extend in place |
| `apps/api/tests/integration/profile-form-{admin,member,gate,answers,concurrency}.test.ts` | `apps/api/tests/integration/payments-cut.test.ts` + `withPayments`-style helper in `setup.ts` (add `withProfileForm`) |
| `apps/api/tests/unit/registry.test.ts`, `mounts.test.ts`, `module-readmes.test.ts` | edit counts (registry.test.ts:242; mounts.test.ts:20) |
| `apps/web/lib/safe-next-path.test.ts` | `apps/web/lib/continue-path.test.ts` |
| `LiveShell.pending.test.ts`, `lib/bootstrap.test.ts`, `counters/route.test.ts`, `proxy.test.ts` | extend in place |
| `apps/web/e2e/profile-form-{gate,member,admin}.spec.ts` | `apps/web/e2e/admin-rules.spec.ts` + `courses-admin.ts` style helper files |
| `supabase/tests/220-profile-form.sql` | `205-payments-tables.sql` (below) |

## Pattern Assignments

### Gate: `packages/core/server/auth/require-auth.ts` (middleware)
**Analog:** same file (lines 90-106, 185-196). Copy the allow-list shape and append the refusal LAST:
```ts
export const CUT_ALLOWED_PATHS = new Set(['/v1/me/subscription']);
...
if (membership.accessState === 'cut' && !CUT_ALLOWED_PATHS.has(c.req.path.replace(/\/+$/, ''))) {
  throw new ApiError(403, 'SUBSCRIPTION_PENDING', { tenantName: membership.tenantDisplayName });
}
```
New: `PROFILE_FORM_ALLOWED_PATHS` (bootstrap, profile-form, profile-form/answers) and `membership.profileFormMissing > 0` check after it (research Pattern 1). `membership.ts` follows the `access_state` column precedent; switch calls to `app.membership_in_tenant_gate` / `memberships_of_user_gate`.

### Module package: `packages/modules/profile-form/*`
**Analog:** `packages/modules/payments/` (module.ts, package.json exports `./module ./contracts ./server`, server/index.ts, README, turbo/tsconfig/vitest configs).
```ts
export const paymentsModule = defineModule({
  key: 'payments',
  routes: () => import('./server/routes').then((m) => m.paymentsRoutes),
  defaultRolePermissions: { admin_tenant: [PAYMENTS_PERMISSIONS.manage] },
  sweepFunctions: ['payment_events_prune'],
});
```
Copy: no `nav`, no `requires`, off by default (not in `REAL_TENANT_DEFAULT_MODULES`), permission admin-only by construction (`profile_form.manage`; add `profile_form.read` for support), tables and services in the kernel (D-501 split). Imports: `defineModule` from `@rede-social/core/server/modules/manifest`. Routes file imports (routes.ts lines 1-50): `createRoute, OpenAPIHono, z` from `@hono/zod-openapi`, `requireAuth`, `requireModule`, `requirePermission`, `ApiError`, contracts via `../contracts/index`. Mount: `.route('/v1/profile_form', profileFormRoutes)` after the payments line (app.ts:140), key with underscore (Pitfall 11, mounts.test.ts:20). Registry: add import (registry.ts:39) and `profile_form: profileFormModule` (registry.ts:65).

### Tables: `profile-form-questions.ts` / `profile-form-answers.ts`
**Analog (admin-write policies):** `packages/modules/store/db/schema.ts` lines 20-41:
```ts
const TENANT_ADMIN = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;
pgPolicy(`${table}_update_admin`, { for: 'update', to: authenticatedRole, using: TENANT_ADMIN, withCheck: TENANT_ADMIN }),
pgPolicy(`${table}_delete_admin`, { for: 'delete', to: authenticatedRole, using: TENANT_ADMIN }),
```
Copy this const (re-declare locally in the kernel schema file; do not import across packages). For answers, copy the per-operation (not `for:'all'`) style of `member_profiles` (`pgPolicy('member_profiles_self_update', ...)` at member-profiles.ts:90) and write the policy set from research Pattern 2 table. Reject `tenantIsolationPolicy` and `member_profiles_tenant_select` (research anti-pattern). Add `unique (tenant_id, id)` on questions for the composite FK, unique `(tenant_id, membership_id, question_id)` on answers.

### Migrations
- `*_profile_form_module_key.sql`: copy `20261019202758_social_module_key.sql` exactly:
```sql
ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_key_chk";--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_key_chk" CHECK (... 'social','payments','profile_form');
```
(Generated from `TOGGLEABLE_MODULES`; the key is appended LAST.) Note payments is already in the list in the repo; mirror whatever the generator emits.
- `moderation_log` widening: copy `20261019225153_moderation_post_removed.sql` (DROP + ADD of `moderation_log_action_chk`).
- Functions migration: copy header discipline and grant style from `20261020225255_access_gate_functions.sql` ("Expand-only ... NOT touched"; `grant execute on function app.membership_in_tenant_gated(uuid, uuid) to api_user;` line 203). Twin names `_gate` per research.

### pgTAP `supabase/tests/220-profile-form.sql`
**Analog:** `205-payments-tables.sql`. Skeleton to copy:
```sql
begin;
-- header comment: numbered sections 1 SHAPE, 2 CHECKs, 3 EXPOSURE, 4 CROSS-TENANT NEGATIVES, ... ; fixture id prefix unique
select plan(N);
select tests.tenant('pgtap-pay-a', 'Pay A', '20500000-0000-4000-8000-000000000001');
select tests.auth_user('admin@pay-a.local', '20500000-0000-4000-8000-0000000000a1');
```
Use a new fixture prefix (e.g. `22000000-`), two tenants, assert `support_tenant`/`member`/null role reads and writes per research policy table, FK RESTRICT, lock trigger SQLSTATEs, cascade on membership, function hardening (`revoke from public`, grants). File ROLLS BACK.

### Member routes in `apps/api/src/routes/me.ts`
**Analog:** same file lines 354-383 (`createRoute` + handler with `c.get('ctx')`, structured `logger.info({event, userId, tenantId, requestId})`, `Cache-Control: no-store`):
```ts
.openapi(createRoute({ method: 'post', path: '/profile/dismiss-nudge', responses: {200: {...}} }),
  async (c) => { const ctx = c.get('ctx'); ...; c.header('Cache-Control', 'no-store'); return c.json(profile, 200); })
```
No `requireModule` on these (kernel routes, research Pattern 3). Never log answer values. Service analog for dismissal: `profiles/service.ts:257-268`:
```ts
return withTenantTx(ctx, async (tx) => { ... update member_profiles set nudge_dismissed_at = coalesce(nudge_dismissed_at, now()), updated_at = now() where id = ${current.id}::uuid ...
```
Mirror with `profile_form_notice_dismissed_at`.

### Admin service concurrency (`profile-form/admin.ts`)
**Analog:** `packages/core/server/payments/gate.ts`:
```ts
export const setupLock = (tenantId: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${`payments:setup:${tenantId}`}, 0))`;
...
await tx.execute(setupLock(tenantId));
const [row] = await tx.select({ enabled: tenantModules.enabled }).from(tenantModules)
  .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, 'payments'))).for('update');
if (!row?.enabled) throw new ApiError(404, 'MODULE_DISABLED');
```
Use key `profile_form:${tenantId}`.

### Export (admin lane)
**Analog:** `packages/core/server/tenancy/admin-members.ts` (RLS is off in the admin lane, every statement carries `m.tenant_id = ${ctx.tenantId}`; keyset via `../paging`). Register sites in `apps/api/tests/admin-lane-inventory/profile-form.ts` using the `group(file, rows)` helper of `payments.ts` (class `T`, status `migrated`), export from `admin-lane-inventory/index.ts`, and add `!packages/core/server/profile-form/**` to `biome.json` next to line 40.

### Web: `completar-perfil/page.tsx`
**Analog:** `apps/web/app/(auth)/assinatura-pendente/page.tsx`. Copy: `(auth)` group (host brand, no shell), `searchParams: Promise<{...}>` awaited with `Promise.all` and `getTranslations`, `EmptyState` + `LogoutForm` ("Sair"), `?t=` fallback name rendered as a text node, never read from the URL for anything else, no Supabase client import. This page must NOT call `requireBootstrap` (precedent: `acceptInviteRedirectPath` in `lib/bootstrap.ts:146`). `next` is validated by the new `safe-next-path.ts`, modelled on `continue-path.ts`'s open-redirect rule: one leading slash, no `//` or backslash, no scheme, no control characters, validated at USE.

### Web: bootstrap, counters, LiveShell
`apps/web/lib/bootstrap.ts` (add before `TENANT_SUSPENDED`):
```ts
case 'SUBSCRIPTION_PENDING':
  return `/assinatura-pendente?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}`;
```
`apps/web/app/api/me/counters/route.ts:37`: `const REFUSAL_FLOWS = ['MEMBERSHIP_BLOCKED', 'SUBSCRIPTION_PENDING'] as const;` append `'PROFILE_FORM_PENDING'`. `LiveShell.tsx` handled the same way, test mould `LiveShell.pending.test.ts`. `proxy.ts`: add `x-rede-path` where the forwarded request `Headers` are built (lines 87-110, `new Headers(request.headers)`), extend `proxy.test.ts`; strip any client-sent `x-rede-path` first.

### Web: builder `/configuracoes/formulario-de-perfil`
**Analog:** `configuracoes/pagamentos/` (server `page.tsx` with permission gate, `PaymentsTabs.tsx` + pure `tabs.ts` + `tabs.test.ts`, `actions.ts` server actions, `loading.tsx`, `*Sheet.tsx` with co-located `*.test.tsx`). Editor frame: `configuracoes/regras/RulesEditor.tsx`. Settings entry: add a `Row` in the "Administração" group of `configuracoes/page.tsx` with `canManageProfileForm`, copying `canManagePayments`.

### Notice and "Minhas respostas"
Mould `components/profile/ProfileCompletenessCard.tsx` for the notice (rendered in `/perfil` under the card in the `completeness.done < completeness.total` block). Loaders in `apps/web/lib/profile.ts` as the mould for new `lib/profile-form.ts`.

### Moderation union
`packages/core/server/moderation/log.ts` (`ModerationEntry` union), `apps/web/components/admin/ModerationLogRow.tsx`, `apps/web/lib/moderation-view.ts` are exhaustive maps: the compiler lists every site once `MODERATION_ACTIONS` gains `profile_form_exported` (append last). Row uses the admin's membership as both actor and target (columns `notNull`, moderation-log.ts:57,59).

## Shared Patterns

### Error code addition (compiler-forced)
Append to `ERROR_CODES` (errors.ts:43 vicinity); `ERROR_MESSAGES: Record<ErrorCode, string>` in `http/api-error.ts` then forces `PROFILE_FORM_PENDING: '...'` (line 24 pattern: `SUBSCRIPTION_PENDING: 'Sua assinatura não está ativa.',`). Message in pt-BR.

### Guard chain for admin routes
`requireAuth -> requireModule('profile_form') -> requirePermission('profile_form.manage')` per route, owned by the module's routes file (payments precedent; mount cannot forget a guard).

### Additive bootstrap field
`.optional()`/`.default(...)` only (bootstrap.ts:73 rule); API always sends it.

### Tenant lane vs admin lane
Tenant lane (`withTenantTx(ctx, ...)`) for all member reads/writes; admin lane only for the export e-mail join, with explicit `tenant_id` predicate and an inventory row.

### Privacy
Answers never in URLs, logs, toasts, storage; check `logging-redact.test.ts` for the redaction list.

### Disk / test hygiene
Update hard-coded counts (platform.test.ts:61 to 12; registry.test.ts:242 list gains `profile_form`).

## No Analog Found
| File | Role | Data Flow | Reason |
|---|---|---|---|
| `profile-form/csv.ts` (RFC 4180 writer + neutraliser) | utility | streaming | no CSV writer in repo; follow research Pattern 4 and OWASP list |
| CSV streaming Route Handler (web) | route | streaming | no streamed attachment proxy yet; use the `apiFetch` + `res.body` pass-through from research |
| `app.profile_form_question_guard()` BEFORE UPDATE trigger | migration | event-driven | no lock-with-distinct-SQLSTATE trigger; moderation_log immutability triggers show plpgsql trigger style only |
| Sketch 016 approval (`.planning/sketches/016-phase-12-designed-screens/README.md`) | doc gate | - | process file, user pastes approval |

## Metadata
**Analog search scope:** packages/contracts, packages/core, packages/modules/{payments,store}, apps/api, apps/web, supabase/{migrations,tests}.
**Verification:** every analog path checked with `git ls-files --error-unmatch` (no untracked or mirror paths found).
**Pattern extraction date:** 2026-10-29
