# Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening - Pattern Map

**Mapped:** 2026-10-02
**Files analyzed:** 22
**Analogs found:** 20 / 22

All analog paths below are git-tracked (checked with `git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/db/schema/moderation-log.ts` (new) + re-export in `schema/index.ts` | model | CRUD (append-only) | `packages/core/db/schema/consent-records.ts` | exact |
| `supabase/migrations/<ts>_moderation_log_immutable.sql` (custom) | migration | n/a | `supabase/migrations/20260930180227_push_subscriptions_functions.sql` | role-match |
| `supabase/tests/160-moderation-log.sql` (new), `040-schema-conventions.sql` (mod) | test (pgTAP) | n/a | `supabase/tests/153-push-subscriptions.sql`, `040-schema-conventions.sql` | exact |
| `packages/core/server/moderation/log.ts` (`recordModerationAction`) | service | CRUD write in caller tx | `packages/core/server/platform/tenants.ts` (withAdminTx writes) | role-match |
| `packages/core/server/moderation/read.ts` (`listModerationLog`) | service | keyset read | `packages/core/server/profiles/*` `listMembers` + `packages/core/server/paging.ts` | exact |
| `packages/core/server/moderation/README.md`, `packages/modules/*/README.md` | doc | n/a | none (no module README exists) | none |
| `packages/core/server/tenancy/member-admin.ts` | service | admin-lane CRUD | `packages/core/server/platform/tenants.ts` lines 114, 201 (`withAdminTx`) | role-match |
| `packages/core/server/tenancy/admin-members.ts` | service | keyset read | `listMembers` (profiles) | exact |
| `packages/core/server/rbac/require-role.ts` (mod) | config | n/a | itself, lines 14-19 | exact |
| `packages/modules/feed/server/service.ts` `deleteComment` / `toComment.canDelete` (mod) | service | CRUD | itself line 1596; stories service line 783 | exact |
| `packages/modules/stories/server/service.ts` (mod) | service | CRUD | feed `deleteComment` | exact |
| `packages/contracts/src/moderation.ts` (new subpath export) | contract | n/a | `packages/contracts/src/realtime.ts`, `@rede-social/contracts/profiles` | role-match |
| `apps/api/src/routes/admin/{index,members,moderation,branding,tenant}.ts` | route | request-response | `apps/api/src/routes/members.ts` (tenant lane) + `apps/api/src/routes/platform/branding.ts` (route shapes) | exact |
| `apps/api/src/app.ts` (mount `/v1/admin`) | config | n/a | itself lines 60-102 | exact |
| `apps/api/tests/isolation-inventory.ts` + `tests/unit/isolation-inventory.test.ts` | test | n/a | `apps/api/tests/unit/registry.test.ts` | partial |
| `apps/api/tests/unit/registry.test.ts`, `tests/integration/modules.test.ts` (perm array) | test | n/a | itself | exact |
| `apps/web/app/(app)/configuracoes/page.tsx` (new rows) | component (RSC) | request-response | itself lines 100-140 | exact |
| `apps/web/app/(app)/configuracoes/{marca,membros,regras,moderacao}/page.tsx` | page | request-response | `apps/web/app/(app)/configuracoes/midia/page.tsx` (gate) + `(platform)/plataforma/tenants/[id]/marca/page.tsx` | exact |
| `.../configuracoes/*/actions.ts` | server action | request-response | `apps/web/app/(platform)/plataforma/tenants/[id]/marca/actions.ts`, `apps/web/app/(app)/membros/actions.ts` | exact |
| `apps/web/messages/pt-BR/<admin>.json` (+ `apps/web/i18n/messages.ts`) | config | n/a | `apps/web/messages/pt-BR/platformBranding.json`, `members.json` | exact |
| `biome.json` (`noJsxLiterals`), `scripts/check-ui-literals.sh` (attr rule) | config | n/a | themselves | exact |
| `packages/reuse-fixture/` | package | n/a | none in repo | none |

## Pattern Assignments

### `packages/core/db/schema/moderation-log.ts` (model, append-only)
**Analog:** `packages/core/db/schema/consent-records.ts` (whole file, ~60 lines). Copy: imports from `drizzle-orm/pg-core` + `authenticatedRole` from `drizzle-orm/supabase`; the APPEND-ONLY docblock; `tenantId ... .references(() => tenants.id)` (no cascade); `check(..., sql\`${t.kind} in (...)\`)`; `pgPolicy(..., { for: 'select', to: authenticatedRole, using: sql\`tenant_id = app.tenant_id() ...\` })`; `.enableRLS()`.
```ts
check('consent_records_kind_chk', sql`${t.kind} in ('tenant_rules','platform_terms')`),
pgPolicy('consent_records_self_select', {
  for: 'select', to: authenticatedRole,
  using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
}),
```
Differences (RESEARCH Pattern 2): add an insert policy with `withCheck: tenant_id = app.tenant_id() and actor_user_id = app.user_id()`; NO FK on actor/target user ids (users cascade); keyset indexes `(tenant_id, created_at desc, id desc)`. Immutability trigger + revoke go in a `--custom` migration (SQL given in RESEARCH Pattern 2), function style `set search_path = ''` as in `20260930180227_push_subscriptions_functions.sql`.

### `packages/modules/feed/server/service.ts` `deleteComment` (service, CRUD) — modify
**Current** (lines 1596-1607):
```ts
export async function deleteComment(ctx: RequestContext, commentId: string): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update feed_comments set deleted_at = now()
       where id = ${commentId}::uuid and author_user_id = ${ctx.userId}::uuid
         and post_id is not null and deleted_at is null
      returning id`);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND');
  });
```
Target shape: RESEARCH Pattern 1 (select `for update`, author-or-canModerate, one bare 404, cascade replies, `deleted_by_user_id`, `recordModerationAction(tx, ...)` in the same tx, `emit` after the tx). Read `permissionsForRequest(ctx)` BEFORE `withTenantTx` (pool max 5). `canDelete` at line ~1250 (`row.author_user_id === viewerUserId`) becomes `|| canModerate`; same in `packages/modules/stories/server/service.ts:783`.

### `packages/core/server/tenancy/member-admin.ts` (service, admin lane)
**Analog:** `packages/core/server/platform/tenants.ts` — `import { withAdminTx } from '../../db/admin-tx';` (line 30), `await withAdminTx(async (tx) => {...})` (lines 114, 201). Guard shape (lock all active admins `order by id for update`, self/last_admin/not_active 409s, `tenant_id = ctx.tenantId` on every statement) is in RESEARCH Pattern 4. `withAdminTx` is allowed under `tenancy/**` (biome.json:36-38). Errors: `ApiError` from `@rede-social/core/server/http/api-error`, `new ApiError(409, 'CONFLICT', { member: 'last_admin' })`.

### `packages/core/server/moderation/read.ts`, `tenancy/admin-members.ts` (keyset reads)
**Analog:** `listMembers` in `packages/core/server/profiles/` + `packages/core/server/paging.ts` exports: `encodeCursor({ n, id })` (40), `decodeCursor(raw)` (84, tampered cursor => first page, not an error), `keysetComparison(direction)` (75), `CURSOR_VERSION` (28). Tenant lane via `withTenantTx`; `deleted_at is null` in queries, never in RLS.

### `packages/core/server/rbac/require-role.ts` (modify)
Lines 14-19:
```ts
export const KERNEL_ROLE_PERMISSIONS: Record<TenantRole, string[]> = {
  admin_tenant: ['tenant.manage', 'members.manage', 'content.publish'],
  support_tenant: [],
  member: [],
};
```
Add `'moderation.manage'`; update the exact arrays in `apps/api/tests/unit/registry.test.ts` (~222-224) and `apps/api/tests/integration/modules.test.ts` (~248-249).

### `apps/api/src/routes/admin/*.ts` (route, request-response)
**Analog A (tenant lane + guard):** `apps/api/src/routes/members.ts` lines 1-60:
```ts
import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { createOpenApiApp } from '../http/openapi';
const members = createOpenApiApp();
members.use('*', requireAuth);
const envelope = (description: string) => ({
  description, content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
const memberParams = z.object({ membershipId: z.uuid() });
```
Then per route `requirePermission('moderation.manage' | 'members.manage' | 'tenant.manage')` (mount order `requireAuth -> requirePermission`, see `packages/core/server/rbac/permissions.ts:51`).
**Analog B (branding routes):** `apps/api/src/routes/platform/branding.ts` — copy `uploadStartRoute` / `uploadCompleteRoute` / colors / icon `createRoute` definitions and the service calls (`startBrandingUpload`, `completeBrandingUpload`, `setBrandingColors`, `removeIconOverride` from `@rede-social/core/server/platform/branding`), but drop the `{id}` path param and pass `ctx.tenantId`; `Cache-Control: no-store`; log `admin.branding.<verb>`.
**Mount:** `apps/api/src/app.ts` chained `.route(...)` (line 46 comment: keep chained style for `AppType`), add `.route('/v1/admin', adminRoutes)` with a comment like those at lines 60-102.

### `apps/web/app/(app)/configuracoes/<x>/page.tsx` (RSC page)
**Gate analog:** `apps/web/app/(app)/configuracoes/midia/page.tsx`:
```ts
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
...
if (bootstrap.membership.role !== 'admin_tenant') notFound();
```
Switch to `bootstrap.permissions.includes(...)` per RESEARCH Pattern 3. **Marca analog:** `apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx` rendering `BrandingForm` (reuse as-is, D-342) + a separate display-name field.
**Settings rows:** `apps/web/app/(app)/configuracoes/page.tsx` lines 100-140 — `canManageStories = bootstrap.permissions.includes(STORY_PERMISSIONS.manage)`; admin group absent from DOM (`isTenantAdmin`), `Group`/`Row` primitives.
**Membros admin list:** extend `apps/web/app/(app)/membros/{MembersList.tsx,actions.ts,[membershipId]}` with `InfiniteScroll` from `@rede-social/ui`.

### `.../configuracoes/*/actions.ts` (server actions)
**Analog:** `apps/web/app/(platform)/plataforma/tenants/[id]/marca/actions.ts` lines 1-60: `'use server'`; validate with the same Zod contract before `apiFetch` (`@/lib/api`); typed results; `readEnvelope(res)`; `revalidatePath` after success; 401/403 mapped OUTSIDE try/catch. Differences: the `tenantId` arg of `BrandingActions` (`BrandingForm.tsx:33`) is ignored; map refusals via the tenant bootstrap error mapping (`ApiClientError` from `@/lib/bootstrap`), not `platformRedirectPath`.

### `packages/contracts/src/moderation.ts`
Copy subpath-export style of `@rede-social/contracts/profiles` (`memberListQuerySchema`, `memberListSchema`) and constants style of `packages/contracts/src/realtime.ts:34-35`. Holds the action enum, log list query/page schemas, admin member list, block/role bodies, `membership.blocked` event type.

### Tests
- pgTAP: copy `supabase/tests/153-push-subscriptions.sql` structure; assert policy shape (one select, one insert) and that update/delete/truncate raise 42501.
- Isolation inventory: build from `app.routes` (importable without DB), equality against a checked-in map; style after `apps/api/tests/unit/registry.test.ts` `expect(keys.sort()).toEqual([...])` (line 67).

## Shared Patterns
- **Errors:** `ApiError(status, code, details?)`; cross-tenant = bare 404; refusals 409 `CONFLICT` with details key (chat precedent `{ chat: 'member_blocked' }`).
- **Tenant authority:** always `ctx.tenantId` from `requireAuth`, never a path/body id; admin-lane SQL must carry `tenant_id = ctx.tenantId`.
- **Events:** emit after commit via `packages/core/server/events/bus.ts`; never for the audit write.
- **Admin UI:** absent from DOM for other roles; pages `notFound()`; copy from pt-BR catalog JSON files under `apps/web/messages/pt-BR/`.
- **Lint boundary:** modules import only kernel/contracts/tooling (`turbo.json`, `scripts/check-boundaries.sh`).

## No Analog Found
| File | Reason |
|---|---|
| `packages/reuse-fixture/` | No fixture package exists; follow RESEARCH (tag `app`, core + contracts + one module). |
| `packages/modules/*/README.md`, `packages/core/server/moderation/README.md` | No module README exists yet; the checker script `scripts/check-module-readmes` is also new (model on `scripts/check-boundaries.sh`). |

## Metadata
**Analog search scope:** packages/core, packages/modules/feed, packages/contracts, apps/api/src, apps/web/app, apps/web/components/platform, supabase/{migrations,tests}, scripts
**Pattern extraction date:** 2026-10-02
