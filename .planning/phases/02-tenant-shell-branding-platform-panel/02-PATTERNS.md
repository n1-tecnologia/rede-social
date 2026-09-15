# Phase 2: Tenant Shell, Branding & Platform Panel - Pattern Map

**Mapped:** 2026-09-14
**Files analyzed:** 62 new/modified files (grouped into 21 pattern families)
**Analogs found:** 54 / 62 (8 with no in-repo analog — external-API adapters, PWA plumbing, CSS token layer)

All analog paths below are git-tracked (`git ls-files` verified). The design prototype at `reference/frontend-design/` is a **git-ignored clone** and is listed only in the "Prototype port sources" section as the *visual source to port from*, never as a tracked analog; new files must live in `packages/ui`, `packages/core/ui` or `apps/web`, never edit the prototype.

---

## File Classification

### A. Contracts (`packages/contracts/src/*`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/contracts/src/hosts.ts` (extend `hostTenantSchema` + `hostBrandingSchema`) | contract/schema | request-response | itself, lines 84-91 + `platform.ts` | exact (modify) |
| `packages/contracts/src/branding.ts` (brandingSchema, contrast helpers, upload schemas) | contract + pure utility | transform | `hosts.ts` (`normalizeHost`, `createBoundedTtlCache` — pure fns beside schemas) | role-match |
| `packages/contracts/src/domains.ts` (tenantDomainSchema, dnsRecordSchema, domainStatus) | contract/schema | CRUD | `platform.ts` | exact |
| `packages/contracts/src/invites.ts` | contract/schema | CRUD | `platform.ts` | exact |
| `packages/contracts/src/platform.ts` (+detail, create/update bodies) | contract/schema | CRUD | itself | exact (modify) |
| `packages/contracts/src/errors.ts` (+`TENANT_SUSPENDED`) | contract/enum | — | itself lines 4-17 | exact (modify) |
| `packages/contracts/src/bootstrap.ts` (+`nav.placement`, `home`, `settings`) | contract/schema | request-response | itself | exact (modify) |
| `packages/contracts/tests/branding.test.ts` | test (unit) | — | `packages/contracts/tests/hosts.test.ts` | exact |

### B. Database schema + migrations

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/db/schema/tenant-invites.ts` (new, admin-lane-only, RLS no policy) | model | CRUD | `packages/core/db/schema/platform-admins.ts` (RLS, no policy) + `tenant-domains.ts` (tenant FK, citext, index order) | exact |
| `packages/core/db/schema/tenant-domains.ts` (+`verification_status`, `dns_records`, `last_checked_at`, `verify_deadline_at`, `last_error`) | model | CRUD | itself | exact (modify) |
| `packages/core/db/schema/tenants.ts` (`TenantBranding` widened) | model | CRUD | itself lines 14-18 | exact (modify) |
| `packages/core/db/schema/index.ts` (export new table) | barrel | — | itself | exact |
| `supabase/migrations/<ts>_branding_bucket.sql` (custom: `storage.buckets` insert + public select policy) | migration (custom SQL) | — | `supabase/migrations/20260914171114_membership_lookup_lifecycle.sql` (hand-written `--custom` style) | role-match |
| `supabase/tests/020-tenant-isolation.sql` (+`tenant_invites` negative cases) | test (pgTAP) | — | itself lines 1-40 | exact (modify) |

### C. Kernel server — platform lane, tenancy, domains, mail, jobs

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/server/platform/tenants.ts` (+`createTenant`, `getTenantDetail`, `updateTenant`, `setTenantStatus`) | service (admin lane) | CRUD | itself (`listPlatformTenants`) + `tenancy/signup.ts` (multi-step admin-lane write w/ compensation) | exact |
| `packages/core/server/platform/modules.ts` (`setModuleEnabled` + `moduleFlags.invalidate`) | service (admin lane) | CRUD | `scripts/seed.ts` lines 149-160 (tenant_modules upsert) + `modules/flags-cache.ts:82-84` | role-match |
| `packages/core/server/platform/branding.ts` (signed upload, complete, write branding, `invalidateTenantHost`) | service (admin lane + Storage) | file-I/O | `tenancy/signup.ts` (supabaseAdmin + withAdminTx + ApiError) | role-match |
| `packages/core/server/platform/domains.ts` (attach/check/remove/setPrimary, on-verified side effects) | service (admin lane) | CRUD + event-driven | `tenancy/signup.ts` (ordered steps, external call then tx, compensation) + `tenancy/tenant-host.ts` (invalidate) | role-match |
| `packages/core/server/platform/invites.ts` (`sendPendingInvites`, `resendInvite`, accept) | service (admin lane + GoTrue admin) | CRUD | `tenancy/signup.ts` lines 126-205 (createUser → membership tx → compensation) | exact |
| `packages/core/server/tenancy/tenant-host.ts` (verified-only, status, isPrimary/primaryHost, branding) | service (cached reader) | request-response | itself | exact (modify) |
| `packages/core/server/tenancy/mail-tenant.ts` (tenant for GoTrue user / redirect_to host) | service (admin lane reader) | request-response | `tenancy/public-tenant.ts` + `tenancy/membership.ts` | role-match |
| `packages/core/server/auth/require-auth.ts` (split `TENANT_SUSPENDED` from `MEMBERSHIP_BLOCKED`) | middleware | request-response | itself lines 57-59 | exact (modify) |
| `packages/core/server/http/api-error.ts` (+message) | utility | — | itself lines 6-19 | exact (modify) |
| `packages/core/server/domains/provider.ts`, `fake.ts`, `vercel.ts`, `auth-allow-list.ts` | adapter (external HTTP) | request-response | **no analog** — nearest shape: `server/supabase-admin.ts` (env-driven singleton) + `server/env.ts` | none (use RESEARCH Code Examples) |
| `packages/core/server/mail/transport.ts`, `resend.ts`, `local.ts`, `templates/*.ts` | adapter + template utility | transform | **no analog** — nearest: `supabase-admin.ts` (singleton), `logging.ts` (moduleLogger) | none |
| `packages/core/server/mail/hook.ts` (`sendAuthMail`) | service | event-driven | `tenancy/signup.ts` (logger injection, ApiError) | partial |
| `packages/core/server/jobs/kernel-jobs.ts` (`domain-verify`) | job definition | event-driven | `packages/modules/example/server/jobs.ts` + `jobs/boss.ts:148-167` | exact |
| `packages/core/server/modules/manifest.ts` (+`placement`, `badge`, `home`, `settings`) | type/contract | — | itself lines 11-16, 44-51 | exact (modify) |
| `packages/core/server/env.ts` (+`DOMAIN_PROVIDER`, `MAIL_TRANSPORT`, `VERCEL_*`, `SUPABASE_PAT`, `SEND_EMAIL_HOOK_SECRETS`, `RESEND_API_KEY`, `MAIL_DOMAIN`) | config | — | itself | exact (modify) |
| `packages/core/server/branding/derive-icons.ts` (sharp + png-to-ico) | utility | file-I/O / transform | **no analog** | none |
| `packages/core/package.json` (+`./ui/*` export) | config | — | itself lines 8-14 | exact (modify) |
| `packages/core/tests/{domain-provider,mail-templates,nav,icons}.test.ts` | test (unit) | — | `packages/core/tests/tenant-host.test.ts` | exact |

### D. API app (`apps/api/src/*`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/routes/platform.ts` (+tenants CRUD, status, modules PUT, branding uploads/complete, domains, invites) | controller (platform lane) | CRUD | itself + `packages/modules/example/server/routes.ts` (params, body, per-route middleware, chained `.openapi`) | exact |
| `apps/api/src/routes/public.ts` (by-host carries brand/status/primary) | controller (public) | request-response | itself lines 30-57 | exact (modify) |
| `apps/api/src/routes/hooks.ts` (`POST /auth/send-email`, raw body, standardwebhooks) | controller (webhook) | event-driven | `routes/public.ts` (unauthenticated group, `createOpenApiApp`) — but must NOT use zod-openapi body validation (Pitfall 7) | partial |
| `apps/api/src/routes/me.ts` (+`POST /accept-invite`) | controller (tenant lane) | CRUD | `packages/modules/example/server/routes.ts` (createItemRoute) | exact |
| `apps/api/src/app.ts` (mount `/v1/hooks` before auth groups) | config/composition | — | itself lines 41-48 | exact (modify) |
| `apps/api/src/worker.ts` (merge `KERNEL_JOBS`) | process entry | event-driven | itself lines 26-29 | exact (modify) |
| `apps/api/src/modules/registry.ts` (`registerJobQueues(['domain-verify'])`, nav placement passthrough) | composition | — | itself lines 31-36, 47-65 | exact (modify) |
| `apps/api/src/env.ts` (+hook/mail/domain vars if API-only) | config | — | itself | exact (modify) |
| `apps/api/tests/integration/{send-email-hook,domains,domain-verify-job,platform-tenants,suspended}.test.ts` | test (integration) | — | `apps/api/tests/integration/jobs.test.ts` + `setup.ts` | exact |

### E. Shared UI (`packages/ui`) and kernel shell (`packages/core/ui`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/ui/package.json`, `src/index.ts`, `src/cn.ts` | config + barrel + utility | — | `packages/ui/package.json` (exports map exists) ; `cn` from prototype `lib/utils.ts` | exact (modify) / port |
| `packages/ui/src/styles/tokens.css` | config (CSS tokens) | — | **no tracked analog** — port from prototype `app/globals.css` lines 11-92 (values) with `@theme inline` (RESEARCH Pattern 2) | port |
| `packages/ui/src/primitives/{Button,IconButton,Input,Avatar,Badge,Chip,Tabs,Skeleton,EmptyState,Switch,FileDropZone}.tsx` | component (presentational) | — | `packages/modules/example/ui/ExampleWidget.tsx` (props-only, strings as props) + prototype `components/ui/*` | role-match + port |
| `packages/ui/src/overlays/{BottomSheet,ConfirmDialog,Toast,ToastProvider}.tsx` | component (client) | event-driven | prototype `components/ui/{BottomSheet,ConfirmDialog,Toast}.tsx` | port |
| `packages/ui/src/layout/{PullToRefresh,SafeAreaWrapper}.tsx`, `hooks/*` | component/hook | — | prototype `components/layout/*` | port |
| `packages/core/ui/AppShell.tsx`, `AppTopBar.tsx`, `BottomNav.tsx`, `DesktopRail.tsx`, `TenantLogo.tsx` | component (shell) | — | `apps/web/app/(app)/layout.tsx` (current seam) + prototype `layout/{TopBar,BottomNav}.tsx` | role-match + port |
| `packages/core/ui/ThemeToggle.tsx`, `theme.ts` (`THEME_COOKIE`, `brandStyleVars`) | component (client) + utility | — | prototype `contexts/ThemeContext.tsx` lines 22-30 (`applyTheme`) — persistence moves to cookie | port |
| `packages/core/ui/nav.ts` (bootstrap.modules → tabs/topbar) | utility (pure) | transform | `apps/api/src/modules/registry.ts` lines 47-65 (`enabledModulesForBootstrap` sort) | exact |
| `packages/core/ui/InstallHint.tsx` (built, unmounted) | component (client) | — | **no analog** (RESEARCH Pattern 9 / Next PWA guide snippet) | none |
| `packages/ui/vitest.config.ts`, `packages/ui/tests/*.test.tsx` | test (unit, happy-dom) | — | `packages/core/tests/tenant-host.test.ts` (vitest shape) ; config via `packages/config/vitest.base.ts` | role-match |

### F. Web app (`apps/web/*`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/app/globals.css`, `postcss.config.mjs`, `next.config.ts` (withSerwist, headers, images.remotePatterns) | config | — | `apps/web/next.config.ts` | exact (modify) |
| `apps/web/app/layout.tsx` (theme cookie → `data-theme`, SerwistProvider, font) | layout (server) | request-response | itself | exact (modify) |
| `apps/web/app/(app)/layout.tsx` (AppShell, generateMetadata/Viewport from bootstrap) | layout (server) | request-response | itself | exact (modify) |
| `apps/web/app/(auth)/layout.tsx` (host brand vars, branded chrome) | layout (server) | request-response | itself + `(auth)/entrar/page.tsx` `resolveShell()` lines 28-56 | exact (modify) |
| `apps/web/lib/host-brand.ts` (`getHostBrand()` cached by host) | utility (server) | request-response | `apps/web/lib/tenant-host.ts` lines 48-88 (`resolveHostTenant`) | exact |
| `apps/web/lib/tenant-host.ts` (TTL 60 s, `HostTenant` carries `isPrimary`, `primaryHost`, `status`) | utility | — | itself | exact (modify) |
| `apps/web/lib/bootstrap.ts` (`TENANT_SUSPENDED` → `/auth/suspended`; `invited` → `/aceitar-convite`) | utility | — | itself lines 90-102 | exact (modify) |
| `apps/web/lib/platform.ts` (+`getPlatformTenantDetail`) | utility (server fetch) | request-response | itself lines 15-36 | exact |
| `apps/web/proxy.ts` (+PUBLIC entries, 308 alias → primary) | middleware (proxy) | request-response | itself lines 15-26, 71-82, 123-128 | exact (modify) |
| `apps/web/app/auth/suspended/route.ts` | route handler (sign-out redirect) | request-response | `apps/web/app/auth/blocked/route.ts` | exact |
| `apps/web/app/auth/confirm/route.ts` (`type=invite` expired branch) | route handler | request-response | itself lines 45-59 | exact (modify) |
| `apps/web/app/(auth)/comunidade-indisponivel/page.tsx`, `convite-expirado/page.tsx` | page (public, static copy) | — | `apps/web/app/(auth)/acesso-suspenso/page.tsx` | exact |
| `apps/web/app/(auth)/aceitar-convite/{page.tsx,actions.ts}` | page + server action | request-response | `(auth)/redefinir-senha/{page.tsx,actions.ts}` + `(auth)/cadastro/[slug]/{page,actions,PasswordField,RulesSheet}` | exact |
| `apps/web/app/(auth)/{entrar,cadastro,esqueci-senha,redefinir-senha}/page.tsx` (visual port to `@tria/ui`) | page | — | themselves + prototype `app/(auth)/*/page.tsx` | exact (modify) |
| `apps/web/app/(app)/inicio/page.tsx` (kernel home: welcome + EmptyState + home slots) | page | request-response | itself lines 64-110 | exact (modify) |
| `apps/web/app/(app)/configuracoes/{page.tsx,actions.ts}` (theme toggle, Sair) | page + server action | request-response | `(app)/actions.ts` (`logout`) + `(app)/inicio/page.tsx` | exact |
| `apps/web/app/(app)/plataforma/page.tsx`, `novo/page.tsx`, `[id]/(marca\|modulos\|dominios\|admins\|status)/page.tsx`, `**/actions.ts` | page + server action (platform) | CRUD | `(app)/inicio/page.tsx` lines 35-62 (platform branch) + `(app)/inicio/example-actions.ts` (apiFetch POST + revalidatePath) | exact |
| `apps/web/app/manifest.webmanifest/route.ts` | route handler (no-store JSON) | request-response | `apps/web/app/auth/blocked/route.ts` (Route Handler shape) + `lib/host-brand.ts` | role-match |
| `apps/web/app/serwist/[path]/route.ts`, `app/sw.ts`, `app/~offline/page.tsx` | PWA plumbing | — | **no analog** (RESEARCH Pattern 9) | none |
| `apps/web/messages/pt-BR.json` (+`shell`, `settings`, `home`, `invite`, `platform.*`, `offline`, `tenantSuspended`) | i18n catalog | — | itself (12 namespaces) | exact (modify) |
| `apps/web/scripts/check-no-static-routes.mjs` | build check | file-I/O | `scripts/check-boundaries.sh` (repo-level guard script) | partial |
| `apps/web/e2e/{branding,domains,invite,pwa,suspended}.spec.ts` | test (e2e) | — | `apps/web/e2e/{blocked,recovery,platform}.spec.ts` + `fixtures.ts`, `mail.ts` | exact |
| `scripts/seed.ts` (brand colors, logo placeholder, verified hosts) | script | — | itself lines 112-160 | exact (modify) |
| `supabase/config.toml` (`[auth.hook.send_email]`, `[storage.buckets.branding]`, `otp_expiry`) | config | — | itself lines 104-162, 243 | exact (modify) |

---

## Pattern Assignments

### 1. Platform-lane routes — `apps/api/src/routes/platform.ts` (controller, CRUD)

**Analog:** `apps/api/src/routes/platform.ts` (itself) + `packages/modules/example/server/routes.ts`

**Imports + app construction** (`platform.ts` lines 1-35) — copy verbatim for the group; every new route chains onto `platform.openapi(...)`:
```ts
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema, type PlatformTenants, platformTenantsSchema } from '@tria/contracts';
import { ApiError } from '@tria/core/server/http/api-error';
import { type PlatformEnv, requireSuperAdmin } from '@tria/core/server/platform/require-super-admin';
import { listPlatformTenants } from '@tria/core/server/platform/tenants';

const platform = new OpenAPIHono<PlatformEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

platform.use('*', requireSuperAdmin());
```

**Handler shape: audit log + no-store** (`platform.ts` lines 53-75) — every platform read/write logs `{ event, userId, requestId }` and sets `Cache-Control: no-store`:
```ts
async (c) => {
  const { userId, requestId } = c.get('platformCtx');
  const rows = await listPlatformTenants();
  const body: PlatformTenants = { tenants: rows.map((t) => ({ /* … */ createdAt: t.createdAt.toISOString() })) };
  c.get('logger').info(
    { event: 'platform.tenants.list', userId, requestId, count: body.tenants.length },
    'platform read',
  );
  c.header('Cache-Control', 'no-store');
  return c.json(body, 200);
}
```
New routes use event names `platform.tenants.create`, `platform.tenants.status`, `platform.modules.set`, `platform.branding.complete`, `platform.domains.attach|verify|primary|remove`, `platform.invites.resend`.

**Params + JSON body + 201 + per-route middleware** (`packages/modules/example/server/routes.ts` lines 44-83):
```ts
const getRoute = createRoute({
  method: 'get',
  path: '/items/{id}',
  request: { params: z.object({ id: z.uuid() }) },
  responses: { 200: { description: 'One example item', content: { 'application/json': { schema: exampleItemSchema } } }, 404: { description: '…' } },
});
const createItemRoute = createRoute({
  method: 'post',
  path: '/items',
  middleware: [requireRole('admin_tenant')] as const,
  request: { body: { content: { 'application/json': { schema: createExampleItemSchema } }, required: true } },
  responses: { 201: { description: 'The created item', content: { 'application/json': { schema: exampleItemSchema } } }, 403: { description: '…' } },
});
export const exampleRoutes = example
  .openapi(getRoute, async (c) => { const { id } = c.req.valid('param'); return c.json(await getItem(c.get('ctx'), id), 200); })
  .openapi(createItemRoute, async (c) => { const item = await createItem(c.get('ctx'), c.req.valid('json')); return c.json(item, 201); });
```
Keep the **chained** `.openapi()` style: `AppType` (`apps/api/src/app.ts:50`) must carry every route for `hc<AppType>()`. Route files never import `withAdminTx`; they call `packages/core/server/platform/*` functions (Biome confines the admin lane).

**`POST /accept-invite` in `apps/api/src/routes/me.ts`:** tenant lane (`requireAuth`), same `createRoute` body shape; the service writes `consent_records` + flips membership via `signupInternals`-style admin tx (see §3).

---

### 2. Public by-host route — `apps/api/src/routes/public.ts` (controller, request-response)

**Analog:** itself, lines 30-57. Keep the registration order comment (by-host FIRST). Change only the response body and description:
```ts
async (c) => {
  const host = normalizeHost(c.req.valid('query').host);
  const resolved = host ? await resolveTenantHost(host) : { kind: 'unknown' as const };
  if (resolved.kind !== 'tenant') throw new ApiError(404, 'TENANT_NOT_FOUND');
  c.header('Cache-Control', 'no-store');
  return c.json({ slug: resolved.slug, displayName: resolved.displayName }, 200); // → add status, isPrimary, primaryHost, branding
}
```
**Hook route** (`apps/api/src/routes/hooks.ts`): use `createOpenApiApp()` from `../http/openapi` like `publicRoutes` (line 30) for the group, but the send-email handler reads `await c.req.text()` and validates with Zod *after* `standardwebhooks` verification (no `request.body` in `createRoute`). Mount in `app.ts` between `/v1/health` and `/v1/me` (lines 41-45 chain).

---

### 3. Admin-lane services — `packages/core/server/platform/{tenants,invites,domains,branding,modules}.ts` (service, CRUD)

**Analog A — read shape:** `packages/core/server/platform/tenants.ts` lines 1-53
```ts
import type { ModuleKey } from '@tria/contracts';
import { asc, eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantModules, tenants } from '../../db/schema';

export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const { tenantRows, moduleRows } = await withAdminTx(async (tx) => {
    const tenantRows = await tx.select({ id: tenants.id, slug: tenants.slug, /* … */ }).from(tenants).orderBy(asc(tenants.slug));
    const moduleRows = await tx.select({ tenantId: tenantModules.tenantId, moduleKey: tenantModules.moduleKey })
      .from(tenantModules).where(eq(tenantModules.enabled, true)).orderBy(asc(tenantModules.moduleKey));
    return { tenantRows, moduleRows };
  });
  // group in TS, never a join that drops empty tenants
}
```
`getTenantDetail(id)` follows this: one `withAdminTx`, several selects (tenant, tenant_modules, tenant_domains, tenant_invites, admin memberships joined to `users`), grouped in TS.

**Analog B — multi-step write with external call + compensation:** `packages/core/server/tenancy/signup.ts`
- Imports (lines 1-10): `withAdminTx`, schema tables, `ApiError`, `moduleLogger`, `supabaseAdmin`.
- Logger injection (lines 12-13, 129): `const baseLog = moduleLogger('signup'); const log = input.logger ? input.logger.child({ name: 'signup' }) : baseLog;` — routes pass `c.get('logger')`.
- Test seam object (lines 58-88): `export const signupInternals = { async consentInsert(tx, rows) {…}, async insertMembershipAndConsents(args) { await withAdminTx(async (tx) => { /* assert public.users mirror exists */ await tx.insert(memberships).values({ tenantId, userId, role: 'member', status: 'active' }); await signupInternals.consentInsert(tx, [ {kind:'tenant_rules',…}, {kind:'tria_terms',…} ]); }); } }` — `acceptInvite` reuses **exactly** this consent-row shape with `role: 'admin_tenant'` and an `update(memberships).set({ status: 'active' })` instead of an insert.
- GoTrue admin call + error classification (lines 141-175): `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata })`; `isDuplicateEmail(error)` matched on `code`/`status`/`message`. `sendPendingInvites` mirrors this with `supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo })` and the same duplicate classification for the "Reenviar" fallback (RESEARCH Open Question 2).
- Compensation (lines 180-202): on tx failure after the external call, `supabaseAdmin.auth.admin.deleteUser(userId)` + `log.error({ event: 'signup.compensated', … })` + `throw new ApiError(500, 'INTERNAL')`. Domains: provider `addDomain` first, then the row insert; on insert failure call `provider.removeDomain` (idempotent on 404).

**Analog C — tenant_modules upsert** (`scripts/seed.ts` lines 149-160) for `setModuleEnabled`:
```ts
await withAdminTx(async (tx) => {
  for (const key of TOGGLEABLE_MODULES) {
    const enabled = t.modules.includes(key);
    await tx.insert(tenantModules).values({ tenantId, moduleKey: key, enabled })
      .onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleKey], set: { enabled, updatedAt: new Date() } });
  }
});
```
then `moduleFlags.invalidate(tenantId)` (`packages/core/server/modules/flags-cache.ts` lines 81-84). `createTenant` inserts all `TOGGLEABLE_MODULES` rows with `example` forced `false` (D-19).

**Analog D — one-primary demotion in one tx** (`scripts/seed.ts` lines 165-170): `tx.update(tenantDomains).set({ isPrimary: false }).where(and(eq(tenantDomains.tenantId, id), eq(tenantDomains.isPrimary, true)))` before promoting — reuse for `setPrimaryDomain` (partial unique index `tenant_domains_one_primary_per_tenant`).

---

### 4. Host resolution with brand — `packages/core/server/tenancy/tenant-host.ts` (cached reader)

**Analog:** itself (lines 28-54). Widen the resolution type and the select; keep the shape guard and bounded cache untouched:
```ts
export async function resolveTenantHost(rawHost: string): Promise<TenantHostResolution> {
  const host = normalizeHost(rawHost);
  if (!host || !isRegistrableHost(host)) return { kind: 'unknown' };
  const hit = cache.get(host);
  if (hit) return hit;
  const value = await withAdminTx<TenantHostResolution>(async (tx) => {
    const rows = await tx
      .select({ tenantId: tenants.id, slug: tenants.slug, displayName: tenants.displayName })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(eq(tenantDomains.host, host), eq(tenants.status, 'active')))   // → isNotNull(tenantDomains.verifiedAt); drop status filter; select status, isPrimary, branding
      .limit(1);
    const row = rows[0];
    return row ? { kind: 'tenant', ...row } : { kind: 'unknown' };
  });
  cache.set(host, value, TTL_MS);
  return value;
}
export function invalidateTenantHost(rawHost: string): void { const host = normalizeHost(rawHost); if (host) cache.delete(host); }
```
Call `invalidateTenantHost(host)` for every host of the tenant from: branding complete/update, domain attach/verify/remove/primary switch, status change. Add a second select for the primary host (`eq(isPrimary, true)` + `isNotNull(verifiedAt)`) in the same tx.

**`mail-tenant.ts`** copies `public-tenant.ts` lines 16-35 (single `withAdminTx` select returning `rows[0] ?? null`, then an explicit fallback) and `membership.ts` lines 41-59 for the "membership for user" read (or reuse `membershipForUser` directly).

---

### 5. Guard split — `packages/core/server/auth/require-auth.ts` (middleware)

**Analog:** itself lines 57-59:
```ts
if (membership.status === 'blocked' || membership.tenantStatus !== 'active') {
  throw new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName: membership.tenantDisplayName });
}
```
Becomes two checks, tenant first: `if (membership.tenantStatus !== 'active') throw new ApiError(403, 'TENANT_SUSPENDED', { tenantName })` then the `blocked` branch unchanged. `invited` must keep passing (accept-invite runs in the tenant lane). Add `'TENANT_SUSPENDED'` to `ERROR_CODES` (`packages/contracts/src/errors.ts` lines 4-17) and `ERROR_MESSAGES` (`packages/core/server/http/api-error.ts` lines 6-19: `TENANT_SUSPENDED: 'Esta comunidade está temporariamente indisponível.'`).

---

### 6. Kernel job — `packages/core/server/jobs/kernel-jobs.ts` (job, event-driven)

**Analog:** `packages/modules/example/server/jobs.ts` lines 1-31 (definition as data) + `packages/core/server/jobs/boss.ts` lines 148-167 (transactional enqueue):
```ts
import { moduleLogger } from '@tria/core/server/logging';
import type { JobDefinition } from '@tria/core/server/modules/manifest';
const log = moduleLogger('module-example');
export const exampleProcessJob: JobDefinition<ExampleProcessJob> = {
  name: EXAMPLE_PROCESS_QUEUE,
  handler: async (payload) => {
    const updated = await markProcessed(payload.tenantId, payload.itemId);
    log.info({ event: 'example.process.done', tenantId: payload.tenantId, itemId: payload.itemId, updated }, 'example item processed');
  },
};
```
```ts
// boss.ts:148 — enqueue inside the caller's tx; singletonKey is idempotent ONLY because QUEUE_POLICY = 'short'
export async function enqueueInTx(tx: Tx, name: string, payload: object, opts: { singletonKey?: string } = {}): Promise<string | null>
```
`domainVerifyJob = { name: 'domain-verify', handler: async ({ domainId }) => { const r = await checkDomain(domainId); if (r.status === 'pending') await withAdminTx((tx) => enqueueInTx(tx, 'domain-verify', { domainId }, { singletonKey: domainId, startAfter: 600 })); } }`. `enqueueInTx` needs a `startAfter` passthrough added to its `opts` type (pg-boss `send` accepts it). In the kernel use `moduleLogger('kernel-jobs')`.

**Worker wiring** (`apps/api/src/worker.ts` lines 27-29): `const jobs = [...KERNEL_JOBS, ...Object.values(MODULE_REGISTRY).flatMap((m) => m?.jobs ?? [])]`. **Registry** (`apps/api/src/modules/registry.ts` line 35): add `registerJobQueues(KERNEL_JOBS.map((j) => j.name))` next to the module loop.

---

### 7. New admin-lane-only table — `packages/core/db/schema/tenant-invites.ts` (model)

**Analog:** `packages/core/db/schema/platform-admins.ts` (RLS on, **no** policy) + `tenant-domains.ts` (tenant FK, citext, `tenant_id`-first index, CHECK):
```ts
// platform-admins.ts:13-18 — RLS with no policy: invisible to the tenant lane by construction
export const platformAdmins = pgTable('platform_admins', { userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }), createdAt: … }).enableRLS();
```
```ts
// tenant-domains.ts:16-19, 25-49
const citext = customType<{ data: string; driverData: string }>({ dataType: () => 'citext' });
export const tenantDomains = pgTable('tenant_domains', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  host: citext('host').notNull().unique('tenant_domains_host_key'),
  isPrimary: boolean('is_primary').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('tenant_domains_host_chk', sql`${t.host}::text ~ '^[a-z0-9.-]{1,253}$'`),
  index('tenant_domains_tenant_idx').on(t.tenantId),
  uniqueIndex('tenant_domains_one_primary_per_tenant').on(t.tenantId).where(sql`${t.isPrimary}`),
  pgPolicy('tenant_domains_tenant_select', { for: 'select', to: authenticatedRole, using: sql`tenant_id = app.tenant_id()` }),
]).enableRLS();
```
`tenant_invites`: same column style, `email: citext`, `check('tenant_invites_role_chk', in ('admin_tenant'))`, `check('tenant_invites_status_chk', in ('pending','sent','accepted','expired'))`, `uniqueIndex('tenant_invites_tenant_email_key').on(t.tenantId, t.email)`, **no `pgPolicy`**, `.enableRLS()`. New `tenant_domains` columns: `verificationStatus: text('verification_status').notNull().default('pending')` + CHECK, `dnsRecords: jsonb('dns_records').$type<DnsRecord[]>().notNull().default([])`, `lastCheckedAt`, `verifyDeadlineAt`, `lastError: text('last_error')`. Widen `TenantBranding` (`tenants.ts` lines 14-18) to the D-25 shape (`colors: { primary, secondary, onPrimary, primaryDark, onPrimaryDark }`, `iconUrl`, `iconUrls`, `iconVersion`). Export from `schema/index.ts`; run `pnpm db:generate`; bucket + storage policy go in a `supabase migration new --custom` file written like `20260914171114_membership_lookup_lifecycle.sql` (comment header explaining the invariant, idempotent SQL).

---

### 8. Web host-brand loader — `apps/web/lib/host-brand.ts` (utility, request-response)

**Analog:** `apps/web/lib/tenant-host.ts` lines 29-88:
```ts
const TTL_HIT_MS = 300_000; // → 60_000 (RESEARCH Pattern 1 cache bust)
const TTL_MISS_MS = 60_000; const TTL_ERROR_MS = 10_000;
const MAX_ENTRIES = 1_000;
const cache = createBoundedTtlCache<HostTenant>(MAX_ENTRIES);
export async function resolveHostTenant(rawHost) {
  const host = normalizeHost(rawHost) ?? 'localhost';
  if (env.PLATFORM_HOST && host === normalizeHost(env.PLATFORM_HOST)) return { mode: 'platform', host };
  if (isGenericFastPath(host)) return { mode: 'generic', host };
  if (!isRegistrableHost(host)) return { mode: 'generic', host };
  const hit = cache.get(host); if (hit) return hit;
  let value: HostTenant = { mode: 'generic', host }; let ttl = TTL_ERROR_MS;
  try {
    const res = await fetch(`${env.API_URL}/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
    if (res.ok) { const parsed = hostTenantSchema.safeParse(await res.json()); if (parsed.success) { value = { mode: 'tenant', host, ...parsed.data }; ttl = TTL_HIT_MS; } else console.error('tenant-host.lookup_failed', { host, reason: 'invalid_body' }); }
    else if (res.status === 404) ttl = TTL_MISS_MS;
    else console.error('tenant-host.lookup_failed', { host, status: res.status });
  } catch (error) { console.error('tenant-host.lookup_failed', { host, error: String(error) }); }
  cache.set(host, value, ttl);
  return value;
}
```
`getHostBrand()` = `getHostTenant()` (headers, lines 94-105) for mode/host, then `resolveHostTenant(host)` for the full cached answer (branding, status, primaryHost). `HostTenant['tenant']` gains `status`, `isPrimary`, `primaryHost`, `branding`; headers stay the four small ones (`proxy.ts` lines 37-47).

---

### 9. Proxy changes — `apps/web/proxy.ts` (middleware)

**Analog:** itself. Add to `PUBLIC` (lines 15-26): `/^\/aceitar-convite(?:\/|$)/, /^\/convite-expirado(?:\/|$)/, /^\/comunidade-indisponivel(?:\/|$)/, /^\/manifest\.webmanifest$/, /^\/serwist\//, /^\/~offline(?:\/|$)/`. Alias 308 copies the existing redirect shapes:
```ts
// lines 73-82 — host-based redirect preserving path+query
if (hostTenant.mode === 'generic' && hostTenant.host.endsWith('.vercel.app') && env.PLATFORM_HOST) {
  return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${env.PLATFORM_HOST}`), 307);
}
// lines 123-128 — 308 keeps method and body
return withCookies(NextResponse.redirect(target, 308), response);
```
New: `if (hostTenant.mode === 'tenant' && !hostTenant.isPrimary) return NextResponse.redirect(new URL(pathname + search, `${request.nextUrl.protocol}//${hostTenant.primaryHost}${port}`), 308)` placed in step 1 (before the Supabase client). Derive scheme/port from the request, never hardcode.

---

### 10. Layouts — `apps/web/app/layout.tsx`, `(app)/layout.tsx`, `(auth)/layout.tsx` (server layouts)

**Analog:** `apps/web/app/(app)/layout.tsx` lines 33-60 — the seam to replace with `AppShell`:
```tsx
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [hostTenant, t, tp] = await Promise.all([getHostTenant(), getTranslations('app'), getTranslations('platform')]);
  if (hostTenant.mode === 'platform') {
    await requirePlatformTenants();           // D-21/D-23: authorised by the API, never by claims
    return (<><TopBar label={tp('title')} logoutLabel={t('logout')} /><main style={{ padding: '1rem' }}>{children}</main></>);
  }
  const { tenant } = await requireBootstrap(); // 401/403 refusals redirect
  return (<><TopBar label={tenant.displayName} logoutLabel={t('logout')} /><main>{children}</main></>);
}
```
Keep both branches: platform host → `PlatformShell` (desktop side-nav, D-33), tenant host → `<AppShell bootstrap={bootstrap} style={brandStyleVars(bootstrap.tenant.branding)}>`. Add `generateMetadata`/`generateViewport` exports that call the same `requireBootstrap()` (React `cache` dedupes, `lib/bootstrap.ts` line 38). Root layout (`app/layout.tsx` lines 11-19): read `(await cookies()).get(THEME_COOKIE)` and render `<html lang="pt-BR" data-theme={theme}>`; wrap `NextIntlClientProvider` in `SerwistProvider`. `(auth)/layout.tsx` (lines 5-21): replace inline styles with `@tria/ui` classes and wrap in `<div style={brandStyleVars(brand.branding)}>` from `getHostBrand()`; the platform host keeps the neutral TRIA wordmark (`t('appName')`).

---

### 11. Auth-lane redirects — `apps/web/lib/bootstrap.ts`, `app/auth/suspended/route.ts`, public screens

**Analog:** `apps/web/lib/bootstrap.ts` lines 90-102:
```ts
export function bootstrapRedirectPath(error: ApiClientError): string | null {
  if (error.status === 401) return '/entrar';
  switch (error.code) {
    case 'MEMBERSHIP_BLOCKED': return `/auth/blocked?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}`;
    case 'TENANT_HOST_MISMATCH': return '/auth/host-mismatch';
    case 'NO_MEMBERSHIP': return '/sem-comunidade';
    default: return null;
  }
}
```
Add `case 'TENANT_SUSPENDED': return '/auth/suspended';`. `requireBootstrap()` callers: after load, `if (bootstrap.membership.status === 'invited') redirect('/aceitar-convite')` (outside try/catch — Next 16 rule in the docblock at lines 57-59).

**Route Handler:** `apps/web/app/auth/blocked/route.ts` lines 16-22 — copy for `/auth/suspended`:
```ts
export async function GET(request: NextRequest): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  const tenant = (request.nextUrl.searchParams.get('t') ?? '').slice(0, MAX_TENANT_LABEL);
  redirect(`/acesso-suspenso?t=${encodeURIComponent(tenant)}`);   // → '/comunidade-indisponivel' (no query: brand comes from the host)
}
```
**Screens:** `apps/web/app/(auth)/acesso-suspenso/page.tsx` lines 14-35 (searchParams promise + `getTranslations` + `<Link href="/entrar">{tc('back')}</Link>`) for `/comunidade-indisponivel` and `/convite-expirado`. `/auth/confirm/route.ts` line 58: branch on `type === 'invite'` → `redirect('/convite-expirado')` before the recovery fallback.

---

### 12. Accept-invite — `apps/web/app/(auth)/aceitar-convite/{page.tsx,actions.ts}`

**Analog:** `(auth)/redefinir-senha/actions.ts` lines 16-25 + `page.tsx` lines 14-39, plus the consent controls from `(auth)/cadastro/[slug]/{page.tsx,RulesSheet.tsx,PasswordField.tsx,actions.ts}`:
```ts
'use server';
export async function reset(formData: FormData): Promise<void> {
  const parsed = resetSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) redirect('/esqueci-senha?erro=link-invalido');
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect('/esqueci-senha?erro=link-invalido');
  redirect('/inicio');
}
```
`acceptInvite` action: parse `{ password, consents }` with a contracts schema → `updateUser({ password })` → `apiFetch('/v1/me/accept-invite', { method: 'POST', body })` with `X-Client-IP` from `x-real-ip` and `User-Agent` (as `cadastro/[slug]/actions.ts` does for signup) → `redirect('/inicio')`; failures → `/convite-expirado`. Page: `PasswordField` with the same `labels` object (`redefinir-senha/page.tsx` lines 22-34), two consent checkboxes + `RulesSheet`, title `invite.title` with `{tenant}` from `getHostBrand()`.

---

### 13. Platform panel pages + server actions — `apps/web/app/(app)/plataforma/**`

**Analog A (page, platform branch):** `apps/web/app/(app)/inicio/page.tsx` lines 35-62:
```tsx
if (hostTenant.mode === 'platform') {
  const [{ data }, platform] = await Promise.all([supabase.auth.getClaims(), requirePlatformTenants()]);
  return (<> … {platform.tenants.map((tenant) => (<li key={tenant.id}>{tenant.slug} — {tenant.displayName} ({tp('modulesCount', { count: tenant.enabledModules.length })})</li>))} … </>);
}
```
Every `/plataforma/*` page starts with `requirePlatformTenants()` (authorisation proof, `lib/platform.ts` lines 52-61) and, for `[id]/*`, `requirePlatformTenantDetail(id)` built like `getPlatformTenants` (lines 15-36: `apiFetch` → envelope → `ApiClientError` → `platformTenantDetailSchema.parse`) wrapped in `loadOrRedirect(…, platformRedirectPath)`.

**Analog B (server action):** `apps/web/app/(app)/inicio/example-actions.ts` lines 16-32:
```ts
'use server';
export async function createExampleItem(formData: FormData): Promise<void> {
  const parsed = createExampleItemSchema.safeParse({ title: formData.get('title') });   // SAME Zod schema the API validates with
  if (!parsed.success) throw new Error('VALIDATION_FAILED');
  const res = await apiFetch('/v1/example/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data) });
  if (!res.ok) { const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null; throw new Error(body?.error?.code ?? 'HTTP_ERROR'); }
  revalidatePath('/inicio');
}
```
Panel actions (`createTenant`, `updateBranding`, `setModule`, `attachDomain`, `verifyDomain`, `setPrimary`, `removeDomain`, `resendInvite`, `setStatus`, `startUpload`, `completeUpload`) copy this: contracts schema first, `apiFetch` with JSON, envelope code surfaced (prefer returning `{ error: code }` for `useActionState` forms instead of throwing), `revalidatePath('/plataforma/[id]', 'page')`, `redirect('/plataforma/<id>')` after create. Signed upload PUT runs in a client component (RESEARCH "Signed upload from the panel").

---

### 14. Kernel home + settings — `apps/web/app/(app)/inicio/page.tsx`, `configuracoes/*`

**Analog:** `inicio/page.tsx` lines 64-110 (bootstrap destructure, `modules.some(...)` gating, presentational widget with `labels` props) and `(app)/actions.ts` lines 11-15 (`logout`: `signOut({ scope: 'local' })` + `redirect('/entrar')`). Settings page renders `<ThemeToggle initial={theme} action={setTheme} />` + `<form action={logout}>`; `setTheme` server action: `(await cookies()).set(THEME_COOKIE, value, { path: '/', sameSite: 'lax', maxAge: 31536000, secure: prod })`. Home: replace the example widget lines 95-108 with `[BrandedWelcome, EmptyState]` rendered from a web-side home-slot list.

---

### 15. Nav composition — `packages/core/ui/nav.ts` (pure utility)

**Analog:** `apps/api/src/modules/registry.ts` lines 47-65:
```ts
export function enabledModulesForBootstrap(enabled: Set<ModuleKey>, settings: Map<…>): Bootstrap['modules'] {
  return [...enabled].map((key) => { const nav = MODULE_REGISTRY[key]?.nav; return { key, ...(nav ? { nav } : {}), settings: settings.get(key) ?? {} }; })
    .sort((a, b) => { const orderA = a.nav?.order ?? MODULE_KEY_ORDER_FALLBACK; const orderB = …; return orderA === orderB ? a.key.localeCompare(b.key) : orderA - orderB; });
}
```
`buildNav(bootstrap)` → `{ tabs: [kernel Início(0), …modules with placement !== 'topbar' sorted by order, kernel Perfil(last)], topbar: modules with placement === 'topbar' (badge → bootstrap.counters) }`. Icons are strings mapped to lucide components inside `packages/core/ui` (manifest stays serialisable). Extend `ModuleNav` (`manifest.ts` lines 11-16) additively: `placement?: 'tab' | 'topbar'; badge?: 'unreadNotifications' | 'unreadConversations'`; `ModuleManifest` (lines 44-51): `home?: { order: number }[]; settings?: { key: string; order: number }[]`. Mirror in `bootstrap.ts` schema.

---

### 16. Shared-UI primitives — `packages/ui/src/**` (presentational components)

**Tracked analog for the component contract:** `packages/modules/example/ui/ExampleWidget.tsx` lines 1-27 — presentational only, no kernel imports, strings and authorisation arrive as props:
```tsx
export type ExampleWidgetProps = { items: ExampleItem[]; canCreate: boolean; createAction?: (formData: FormData) => Promise<void>; labels: { title: string; … } };
export function ExampleWidget({ items, canCreate, createAction, labels }: ExampleWidgetProps) { … }
```
`@tria/ui` components follow this: no `next-intl` inside; `aria-label`/labels as required props (`IconButton.label` required per UI-SPEC). `packages/ui/src/index.ts` exports client-safe modules only (no `@tria/contracts` import — its index pulls `legal.ts` + `node:fs`).

**Package config:** `packages/ui/package.json` (lines 1-17) already has `exports: { ".": "./src/index.ts" }`; add `"./styles/tokens.css": "./src/styles/tokens.css"`, `peerDependencies: { react }`, deps `clsx`, `tailwind-merge`, `lucide-react`, `motion`; scripts `test: vitest run` like `packages/core/package.json` lines 15-19.

**Prototype port sources (git-ignored, read-only — port, never edit):**
- `reference/frontend-design/lib/utils.ts` → `packages/ui/src/cn.ts` verbatim (`twMerge(clsx(inputs))`).
- `reference/frontend-design/components/ui/Button.tsx` lines 7-20 (variant/size maps) → rename `primary`/`accent` → `brand` (`bg-brand text-on-brand`), `danger` → `bg-danger`; `"use client"` stays only where handlers exist.
- `components/layout/TopBar.tsx` lines 51-102 → `AppTopBar`: keep `fixed top-0 … pt-[var(--safe-top)]` + `h-12 px-4`; replace the `.brand-ig-mark` span (line 54) with `<TenantLogo>` (D-26), `Heart` → `Bell` (D-40), badge span (lines 27-31) → `Badge`, slots come from `nav.topbar`.
- `components/layout/BottomNav.tsx` lines 99-168 → `BottomNav`: keep `glass-bar fixed … rounded-full`, `bottom: calc(var(--safe-bottom) + 8px)`, active chip `var(--theme-chip)`, icon colour `var(--theme-accent)` → `var(--brand-accent)`; drop the `/reels` media mode and `/community` collapse; tabs from `nav.tabs`.
- `contexts/ThemeContext.tsx` lines 22-30 (`applyTheme`: `root.setAttribute('data-theme', theme)` + `meta[name="theme-color"]` update) → `ThemeToggle`; replace `localStorage` (lines 36-50) with `document.cookie` + server action.
- `app/globals.css` lines 11-92 (light/dark neutral values) and lines 324-345 (`--screen-h: 100dvh`, `--safe-top: max(env(safe-area-inset-top), 12px)`, `--safe-bottom`, `.app-scroll`) and lines 381-415 (`.glass-bar`) → `packages/ui/src/styles/tokens.css`; **do not** carry `--theme-gold*`, `.btn-gold`, `.pill-*`, `.text-gradient-*`, `.brand-ig-mark`.

---

### 17. Hook route + mail (no in-repo analog; nearest shapes)

- Singleton adapters selected by env: `packages/core/server/supabase-admin.ts` lines 1-7 (`createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })`) → `mailTransport = env.MAIL_TRANSPORT === 'resend' ? resendTransport : localTransport`, `domainProvider = env.DOMAIN_PROVIDER === 'vercel' ? vercelProvider : fakeProvider`.
- Env additions: `packages/core/server/env.ts` lines 5-15 (`createEnv({ server: { … }, runtimeEnv: process.env, emptyStringAsUndefined: true })`) — add `DOMAIN_PROVIDER: z.enum(['fake','vercel']).default('fake')`, `MAIL_TRANSPORT: z.enum(['local','resend']).default('local')`, optional `VERCEL_TOKEN/PROJECT_ID/TEAM_ID`, `SUPABASE_PAT`, `SUPABASE_PROJECT_REF`, `RESEND_API_KEY`, `MAIL_DOMAIN`, `SEND_EMAIL_HOOK_SECRETS`, `MAILPIT_URL`.
- Logging: `moduleLogger('mail')` / `moduleLogger('domains')` from `packages/core/server/logging.ts` (see `signup.ts` line 13).
- Template/link building and the Vercel adapter body: copy RESEARCH "Code Examples" (Vercel adapter, Send Email Hook route). Local transport posts to Mailpit `POST /api/v1/send`; `apps/web/e2e/mail.ts` lines 31-44 (`/api/v1/search?query=to:…` + `/api/v1/message/{id}`) is the read side the e2e already uses.

---

### 18. Manifest route — `apps/web/app/manifest.webmanifest/route.ts` (route handler)

**Analog shape:** `apps/web/app/auth/blocked/route.ts` (Route Handler exporting `GET`). Body: `export const dynamic = 'force-dynamic'; export async function GET() { const brand = await getHostBrand(); return Response.json(manifestFor(brand), { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/manifest+json' } }); }`. Host only, no cookies (browser fetches the manifest credential-less). Serwist route/SW/offline page: RESEARCH Pattern 9 (no repo analog).

---

### 19. Tests

- **Unit (kernel/contracts):** `packages/core/tests/tenant-host.test.ts` lines 1-18 (`describe/it`, exercise a pure seam like `cachedTenantHostCount()`), `packages/contracts/tests/hosts.test.ts`. Domain-provider contract test drives both adapters through one `DomainProvider` suite (Vercel with mocked `fetch`).
- **Integration (API):** `apps/api/tests/integration/jobs.test.ts` lines 1-49 (`adminSql` fixtures from seed tenant, `stopBoss()`/`adminSql.end()` in `afterAll`, cleanup of `pgboss.job_common` rows by payload marker) + `setup.ts` lines 22-44 (`signInAs(email, password)` for a real Bearer, `authAdmin()` for throwaway users, `adminSql`). Platform tests sign in as a `platform_admins` user (see `platform.spec.ts`/`e2e/admin.ts` for how the seed creates one).
- **pgTAP:** `supabase/tests/020-tenant-isolation.sql` lines 15-33 (fixed-uuid fixtures via `tests.tenant/auth_user/member`, `select plan(N)`) — add `tenant_invites` cross-tenant negative; `010`/`040` auto-cover RLS + index conventions.
- **e2e:** `apps/web/e2e/fixtures.ts` (`hosts.demo/lab/platform`, `login()`), `e2e/mail.ts` (`latestConfirmLink`), `blocked.spec.ts`/`recovery.spec.ts` for the flow shape. Brand isolation: `browser.newContext({ javaScriptEnabled: false })` and read `--brand-primary` via `getComputedStyle`.

---

## Shared Patterns

### Error envelope + stable codes
**Source:** `packages/core/server/http/api-error.ts` lines 22-31; `packages/contracts/src/errors.ts` lines 4-17
**Apply to:** every new API route/service; every web redirect map
```ts
throw new ApiError(403, 'TENANT_SUSPENDED');                       // message from ERROR_MESSAGES
throw new ApiError(400, 'VALIDATION_FAILED', { host: 'in_use' });  // details only when deliberate
```
Web side switches on `error.code` in `bootstrapRedirectPath` / `platformRedirectPath` (`lib/bootstrap.ts:90`, `lib/platform.ts:44`).

### Admin lane confinement
**Source:** `packages/core/server/platform/tenants.ts` lines 15-19 docblock; Biome `noRestrictedImports` (`biome.json`)
**Apply to:** all Phase 2 writes (tenants, modules, domains, invites, branding, mail-tenant lookup)
`withAdminTx` is importable only from `packages/core/server/{tenancy,platform}` and `scripts/`. Route files and `packages/core/server/{domains,mail,jobs}` call platform-lane functions; `mail-tenant.ts` therefore lives under `server/tenancy/`.

### Host-keyed bounded caches + invalidation
**Source:** `packages/contracts/src/hosts.ts` lines 51-82 (`createBoundedTtlCache`), `packages/core/server/tenancy/tenant-host.ts` lines 10-18, 51-54, `apps/web/lib/tenant-host.ts` lines 29-38
**Apply to:** API by-host resolver, web `resolveHostTenant`/`getHostBrand`
Keys are always `normalizeHost(host)`; only `isRegistrableHost` values enter; negative answers cached; `invalidateTenantHost(host)` on every branding/domain/status mutation (API side); web relies on TTL (60 s).

### Logger injection + audit lines
**Source:** `packages/core/server/tenancy/signup.ts` lines 12-13, 129; `apps/api/src/routes/platform.ts` lines 68-72
**Apply to:** all services and platform routes
`const log = input.logger ? input.logger.child({ name }) : moduleLogger(name)`; every platform mutation logs `{ event: 'platform.<area>.<verb>', userId, requestId, tenantId }`.

### Zod-once: contracts shared by API validators and web actions
**Source:** `apps/web/app/(app)/inicio/example-actions.ts` lines 17-18; `apps/api/src/routes/platform.ts` defaultHook lines 23-32
**Apply to:** every panel form + its route
Schemas live in `packages/contracts/src/{branding,domains,invites,platform}.ts`; hex `^#[0-9a-f]{6}$`, slug reuse `slugSchema`, host reuse `HOST_SHAPE`/`isRegistrableHost`.

### Server-action navigation rule
**Source:** `apps/web/lib/bootstrap.ts` lines 57-59, 61-75
**Apply to:** all new actions/layouts
`redirect()` is called after the try/catch, never inside `try`; `requireX()` helpers (not raw getters) in every concurrently rendered segment.

### Strings in the pt-BR catalog
**Source:** `apps/web/messages/pt-BR.json` (namespaces `common, login, signup, forgot, reset, suspended, hostMismatch, noCommunity, platform, app, example, legal`), `apps/web/i18n/request.ts`
**Apply to:** every new page/component
Add namespaces `shell`, `settings`, `home`, `invite`, `inviteExpired`, `tenantSuspended`, `offline`, `platform.{list,new,tenant,brand,modules,domains,admins,status}`; components in `@tria/ui`/`@tria/core/ui` receive strings as props (ExampleWidget rule).

### Seed as the fixture of record
**Source:** `scripts/seed.ts` lines 112-170
**Apply to:** two-tenant brand fixtures
Extend the `tenants` upsert `set` with `branding` (distinct `colors.primary` per tenant + derived keys + placeholder `logoUrl`), keep `verified_at = now()` on the seeded hosts (D-24), and set `verification_status = 'verified'`.

---

## No Analog Found

Planner should use RESEARCH.md §Code Examples / Patterns for these:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/server/domains/{provider,vercel,fake,auth-allow-list}.ts` | adapter | request-response (external HTTP) | No outbound HTTP adapter exists yet (only `supabaseAdmin` SDK) — RESEARCH Pattern 5 + "Vercel adapter" example |
| `packages/core/server/mail/{transport,resend,local}.ts`, `templates/*` | adapter + templates | transform | No mail sending in-repo (GoTrue SMTP only) — RESEARCH Pattern 6 |
| `apps/api/src/routes/hooks.ts` (signature verification part) | controller (webhook) | event-driven | No raw-body/HMAC route exists — RESEARCH "Send Email Hook route" example; mount pattern from `app.ts` |
| `packages/core/server/branding/derive-icons.ts` | utility | file-I/O | No image processing in-repo — RESEARCH Pattern 9 (sharp + png-to-ico) |
| `packages/ui/src/styles/tokens.css` | CSS tokens | — | `apps/web` has no CSS/Tailwind today — values from the (untracked) prototype, mechanism from RESEARCH Pattern 2 |
| `apps/web/app/serwist/[path]/route.ts`, `app/sw.ts`, `app/~offline/page.tsx` | PWA plumbing | — | No service worker yet — RESEARCH Pattern 9 / serwist docs |
| `packages/core/ui/InstallHint.tsx` | client component | — | Next PWA guide snippet (built, unmounted) |
| `apps/web/scripts/check-no-static-routes.mjs` | build check | file-I/O | Reads `.next/prerender-manifest.json`; only shell guards exist (`scripts/check-boundaries.sh`) — RESEARCH Pattern 11 |

---

## Metadata

**Analog search scope:** `apps/api/src/**`, `apps/web/{app,lib,e2e,proxy.ts,next.config.ts}`, `packages/{contracts,core,ui,modules/example}/**`, `scripts/seed.ts`, `supabase/{migrations,tests,config.toml}`, prototype `reference/frontend-design/{app/globals.css,components/{ui,layout},contexts,lib}` (port sources only)
**Files scanned:** 48 tracked source files read in full or targeted ranges; 6 prototype files
**Tracked-source gate:** every analog path verified in `git ls-files`; the prototype is git-ignored and marked as port-only
**Pattern extraction date:** 2026-09-14
