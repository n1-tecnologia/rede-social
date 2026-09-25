# Phase 6: Events - Pattern Map

**Mapped:** 2026-09-25
**Files analyzed:** ~30 (new + modified)
**Analogs found:** 25 / 30 (5 partial-only)

> Files marked **RE-READ AT EXECUTION** are also touched by 05.2 / 05.3, which run before this phase. Excerpts below are the state on 2026-09-25.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/modules/events/{package.json,tsconfig.json,turbo.json,vitest.config.ts}` | config | - | `packages/modules/communities/` same files | exact |
| `packages/modules/events/module.ts` | manifest | event-driven | `packages/modules/communities/module.ts` | exact |
| `packages/modules/events/contracts/index.ts` | contracts | transform | `packages/modules/communities/contracts/index.ts` (EventMap merge L256-267) | exact |
| `packages/modules/events/db/schema.ts` (events, event_attendances) | model | CRUD | `packages/modules/communities/db/schema.ts` L59-106 | exact |
| `event_secrets` (role-claim RLS) | model | CRUD | none; `app.tenant_role()` in `supabase/migrations/20260912030541_app_helpers.sql:30-33` | partial |
| `packages/modules/events/server/routes.ts` | route | request-response | `packages/modules/communities/server/routes.ts` | exact |
| `packages/modules/events/server/service.ts` | service | CRUD | `packages/modules/communities/server/service.ts` (+ feed `service.ts:1114-1115` author join) | exact |
| `packages/modules/events/server/index.ts` | barrel | - | `packages/modules/communities/server/index.ts` | exact |
| `packages/modules/events/ui/*` (EventCover, EventPoster, EventHero, EventInfoGrid, EventTicket, NextEventCard, AttendeeRow, CheckinCodeCard) | component | - | `packages/modules/communities/ui/{CommunityCover,CommunityCard,CommunityHeader}.tsx` | role-match |
| `packages/modules/events/tests/*` | test | - | `packages/modules/communities/tests/{events.test.ts,community-page-ui.test.tsx}` | exact |
| `packages/ui/src/primitives/SegmentedControl.tsx` + test | component | - | `packages/ui/src/primitives/Tabs.tsx` | role-match |
| `supabase/migrations/<ts>_events.sql` | migration | - | `supabase/migrations/20260923171503_communities.sql` (generated) | exact |
| `supabase/migrations/<ts>_events_functions.sql` (guard trigger, definer fns, grants) | migration | - | `20260921190227_member_profiles_search.sql` L42-63; `20260924005427_story_comment_rules.sql` header style | partial |
| `supabase/tests/130-events.sql`, `020-tenant-isolation.sql` (RE-READ) | test | - | `supabase/tests/110-communities-stories.sql` | exact |
| `apps/api/src/app.ts`, `apps/api/src/modules/registry.ts` (RE-READ) | config | - | communities lines (app.ts:5,75; registry.ts:12,27) | exact |
| `apps/api/tests/unit/registry.test.ts:53` (RE-READ) | test | - | itself | exact |
| `apps/api/tests/integration/events.test.ts`, `isolation.test.ts` | test | request-response | existing communities integration test + `setup.ts adminSql` | exact |
| `apps/api/src/routes/me.ts`, `packages/contracts/src/bootstrap.ts` | contract | request-response | `bootstrap.ts:22-28` tenant object | exact |
| `apps/web/lib/feed-view.tsx:39`, `apps/web/components/media/MediaAssetRow.tsx:18` | utility | transform | themselves (replace pinned tz) | exact |
| `apps/web/lib/events.ts` | utility (fetcher) | request-response | `apps/web/lib/communities.ts` | exact |
| `apps/web/lib/events-view.ts` | utility | transform | `apps/web/lib/feed-view.tsx` (Intl formatter L39-42) | role-match |
| `apps/web/lib/events-calendar.ts` (.ics + Google link) | utility | transform | none | no analog |
| `apps/web/app/(app)/eventos/{page,loading,EventsList,EventForm,actions}.tsx`, `novo/`, `[eventId]/{page,editar,not-found}` | page/component | request-response | `apps/web/app/(app)/comunidades/*` (page, CommunitiesList, CommunityForm, actions.ts, nova/, [communityId]/, ReactivateCommunity) | exact |
| `apps/web/app/(app)/eventos/[eventId]/entrar/route.ts` (GET with side effect + redirect) | route handler | request-response | `apps/web/app/m/[slug]/manifest.webmanifest/route.ts`, `apps/web/app/auth/*/route.ts` | partial |
| `.../entrar/aviso/page.tsx` | page | - | `apps/web/app/(app)/comunidades/[communityId]/not-found.tsx` | role-match |
| `.../agenda.ics/route.ts` | route handler | file-I/O | `manifest.webmanifest/route.ts` (force-dynamic, no-store, 404 helper) | partial |
| `apps/web/lib/registry.tsx` (eventsHome, RE-READ) | provider | - | `storiesHome` L339-398 | exact |
| `apps/web/lib/continue-path.ts:32-34` | utility | - | itself | exact |
| `apps/web/messages/pt-BR/events.json` (+ index, RE-READ) | config | - | `messages/pt-BR/communities.json` | exact |
| `apps/web/e2e/{events.spec.ts,events-admin.ts,phase6-smoke.spec.ts}`, `shell.spec.ts` (RE-READ) | test | - | communities e2e spec + `e2e/admin.ts` | exact |
| `apps/{api,web}/package.json` (RE-READ), seed (RE-READ) | config | - | `@tria/module-communities` lines | exact |

## Pattern Assignments

### `packages/modules/events/module.ts` (analog `packages/modules/communities/module.ts`)
```ts
import { moduleLogger } from '@tria/core/server/logging';
import { defineModule } from '@tria/core/server/modules/manifest';
import { COMMUNITY_PERMISSIONS } from './contracts/index';
const log = moduleLogger('module-communities');
export const communitiesModule = defineModule({
  key: 'communities',
  nav: { placement: 'tab', label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
  routes: () => import('./server/routes').then((m) => m.communitiesRoutes),
  events: [
    { event: 'community.created',
      handler: async (payload) => { log.info({ event: 'community.created', ...payload }, 'community created'); } },
  ],
  defaultRolePermissions: { admin_tenant: [COMMUNITY_PERMISSIONS.manage] },
});
```
Events: `key: 'events'`, `icon: 'calendar-days'` (already in `ICONS`), `href: '/eventos'`, order after Reels (RESEARCH proposes 40 — confirm vs 05.3), `home: [{ order: 7 }]`. Payloads shape-only (no titles/URLs in logs).

### `contracts/index.ts` — EventMap merge (communities contracts L256-267)
```ts
declare module '@tria/contracts' {
  interface EventMap {
    'community.created': CommunityCreated;
    ...
  }
}
```
Also copy the `COMMUNITY_ISSUE_SET` pattern (refinement messages are machine codes). Do NOT put anything in `packages/contracts/src/events.ts` (bus contract).

### `db/schema.ts` (analog communities schema L1-106)
Imports:
```ts
import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { mediaAssets, tenants, users } from '@tria/core/db/schema';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```
Table pattern:
```ts
export const communities = pgTable('communities', {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    status: text().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: ..., deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('communities_tenant_activity_idx')
      .on(t.tenantId, t.lastActivityAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`status = 'active' and deleted_at is null`),
    uniqueIndex('communities_tenant_slug_uq').on(t.tenantId, t.slug),
    check('communities_status_chk', sql`${t.status} in ('active','archived')`),
    tenantIsolationPolicy('communities_tenant_isolation'),
  ],
).enableRLS();
```
Rules: tenant-first indexes; `.desc().nullsFirst()` when desc (upcoming list is asc — `starts_at asc, id asc`); named CHECKs because the service maps constraint names. `events`/`event_attendances` keep `tenantIsolationPolicy` (FOR SHARE in guard trigger needs the `for: 'all'` policy).

**`event_secrets` (partial):** no role-gated table exists. Use `pgPolicy` with `using: sql\`tenant_id = app.tenant_id() and app.tenant_role() in ('admin_tenant','support_tenant')\`` (verify helper names in `20260912030541_app_helpers.sql:30-33`); must still pass `010-rls-coverage.sql`.

### `server/routes.ts` (analog communities routes L1-60)
```ts
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { permissionsForRequest, requirePermission } from '@tria/core/server/rbac/permissions';

const communities = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const community = result.error.issues.map((i) => i.message).find((m) => COMMUNITY_ISSUE_SET.has(m));
      if (community) throw new ApiError(400, 'VALIDATION_FAILED', { community });
      throw new ApiError(400, 'VALIDATION_FAILED', { issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'), message: issue.message })) });
    }
  },
});
communities.use('*', requireAuth, requireModule('communities'));
```
Writes: `requirePermission('events.event.manage')` per route (never `requireRole`). State/time refusals → `ApiError(409, 'CONFLICT', { event: <code> })`.

### `server/service.ts` (analog communities service)
- Every function `withTenantTx(ctx, (tx) => …)` (`import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx'`, L1, L167).
- Paging: `decodeCursor`/`encodeCursor` from `@tria/core/server/paging` (L6, L202); add `keysetComparison('asc')`.
- Emit only after tx resolves (L421-435):
```ts
created = await withTenantTx(ctx, (tx) => insertCommunity(tx, ctx, input, slug));
...
emit(ctx, 'community.created', { tenantId: ctx.tenantId, communityId: created.id, actorUserId: ctx.userId });
```
- Constraint → machine code, copy `isSlugCollision` (L280-292):
```ts
function isSlugCollision(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint_name === 'communities_tenant_slug_uq') return true;
    current = candidate.cause;
  }
  return false;
}
```
Generalize to return `constraint_name` for `23514` raised by the guard trigger (e.g. `event_attendances_rsvp_open`).
- Cover validation: copy `CoverAssetRow` lookup (service L297+) for the cover tuple / foreign-asset 404.
- Attendee rows: feed `service.ts:1114-1115` join, adding `ms.tenant_id = a.tenant_id`.

### `supabase/migrations/<ts>_events_functions.sql` (partial; analog `20260921190227_member_profiles_search.sql` L42-58)
```sql
create or replace function app.ensure_member_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.member_profiles (...) select ... from public.users u where u.id = new.user_id
  on conflict (membership_id) do nothing;
  return new;
end
$$;--> statement-breakpoint
create trigger member_profiles_from_membership after insert on public.memberships
  for each row execute function app.ensure_member_profile();--> statement-breakpoint
```
Copy: `set search_path = ''`, fully-qualified names, `--> statement-breakpoint`, long rationale header (style of `20260924005427_story_comment_rules.sql`). New: guard trigger is INVOKER with `raise ... using errcode = '23514', constraint = '...'`; check-in functions are DEFINER, callable RPC-style, with explicit `revoke all ... from public; grant execute ... to authenticated` (grant precedent: `20260912031029_app_membership_lookup_and_grants.sql`). No existing API calls a SQL function via `tx.execute(sql\`select app.fn(...)\`)` — partial.

### `supabase/tests/130-events.sql` (analog `110-communities-stories.sql`)
`begin; ... plan(N); ... finish(); rollback;` with numbered facts in the header, each assertion paired with a positive control; index usage pinned by name via EXPLAIN. Helpers in `000-helpers.sql` (`tests.as_tenant`). Number 130 assumes 05.2 takes 120 — RE-READ. `020-tenant-isolation.sql` currently `plan(100)` — recount.

### `apps/api` wiring (RE-READ)
`app.ts:5` `import { communitiesRoutes } from '@tria/module-communities/server';` and `:75` `.route('/v1/communities', communitiesRoutes)` → add `.route('/v1/events', eventsRoutes)`. `registry.ts:12,27` → `events: eventsModule`. `registry.test.ts:53` `expect(keys.sort()).toEqual(['communities', 'feed', 'stories'])` gains `events` (+ 05.3 key).

### Bootstrap timezone
`packages/contracts/src/bootstrap.ts:22-28`:
```ts
tenant: z.object({ id: z.uuid(), slug: z.string(), displayName: z.string(), branding: tenantBrandingSchema }),
```
Add `timezone: z.string()`; select `tenants.timezone` in `apps/api/src/routes/me.ts`; replace `feed-view.tsx:39` `const TENANT_TIME_ZONE = 'America/Sao_Paulo';` and `MediaAssetRow.tsx:18` default with the bootstrap value.

### `apps/web/lib/events.ts` (analog `apps/web/lib/communities.ts`)
```ts
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> { ... }
```
One fetch implementation shared by the RSC page and its actions; parse with the module's Zod page schema.

### `apps/web/app/(app)/eventos/actions.ts` (analog `comunidades/actions.ts` L1-40)
`'use server'`; validate with the same Zod before calling; `redirect()` outside try/catch; return catalog KEYS not copy; **no re-exports** (Turbopack). Imports `revalidatePath`, `getTranslations`, `ApiClientError`, `bootstrapRedirectPath`.

### Pages/components
Copy `comunidades/page.tsx`, `CommunitiesList.tsx` (+ `.test.tsx`), `CommunityForm.tsx`, `nova/page.tsx`, `[communityId]/{page,editar,not-found}.tsx`, `ReactivateCommunity.tsx` (+test) for Reativar.

### `entrar/route.ts` and `agenda.ics/route.ts` (partial; analog `apps/web/app/m/[slug]/manifest.webmanifest/route.ts`)
```ts
export const dynamic = 'force-dynamic';
const NO_STORE = 'private, no-store';
function notFound(): Response {
  return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': NO_STORE } });
}
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  ...
}
```
No existing handler performs a write on GET and redirects (check-in side effect → `NextResponse.redirect` to meeting URL or `aviso`). Auth redirect helpers: `apps/web/app/auth/*/route.ts`. SW already routes navigations `NetworkOnly` (`app/sw.ts:54-60`). `.ics`: `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment`.

### `continue-path.ts:32-34`
```ts
export function isContinuablePath(path: string): boolean {
  return /^\/post\/[^/]+$/.test(path);
}
```
Widen with `/^\/eventos\/[0-9a-f-]{36}(\/entrar)?$/`; update its tests.

### `apps/web/lib/registry.tsx` eventsHome (RE-READ; 05.2 rewrites `storiesHome`)
Pattern at L339-402: `const storiesHome: HomeSlotRenderer = async ({ bootstrap }) => { const [page, t] = await Promise.all([loadX(), getTranslations('x')]); const now = Date.now(); ... }` and `WEB_MODULE_REGISTRY = { feed: {home:[feedHome]}, stories: {home:[storiesHome]} }`. Renderer must swallow its own errors (render nothing) — `homeSlotsFor` would show a generic error card on reject.

### `packages/ui/src/primitives/SegmentedControl.tsx` (analog `Tabs.tsx`)
```ts
'use client';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '../cn';
export interface TabsProps { items: TabItem[]; value: string; onChange: (key: string) => void; label: string; ... }
```
Reuse roving tabindex + Arrow/Home/End handling; use `role="radiogroup"`/`radio` per UI-SPEC; export from the `@tria/ui` barrel; test under `packages/ui/tests/`.

## Shared Patterns
- **Guard chain:** `requireAuth → requireModule('events') → requirePermission(...)` (communities routes).
- **Tenant tx:** all DB via `withTenantTx`; no `withAdminTx` from modules (Biome-confined).
- **Errors:** `ApiError(status, code, details)`; constraint names → machine codes via cause-chain walk.
- **Events:** `emit` after tx resolves; payloads IDs only (+ `startsAt` on RSVP).
- **Timestamps:** `to_char(... at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, never JS `Date` for cursors.
- **Strings:** everything in `messages/pt-BR/events.json`; `scripts/check-ui-literals.sh` gate; module UI ships no words.
- **Migrations:** generated file via `pnpm db:generate`; hand SQL in `--custom`; RE-READ snapshot chain after 05.2/05.3.

## No Analog Found
| File | Reason |
|---|---|
| `apps/web/lib/events-calendar.ts` | No ICS/Google Calendar builder exists; use RESEARCH.md |
| `event_secrets` role-claim policy | No role-gated table yet (partial: `app.tenant_role()`) |
| DEFINER check-in functions called from API | Existing definers are trigger functions only |
| Guard trigger raising named 23514 | Existing rules use CHECK/FK, not raise |
| GET route with side effect (`entrar/route.ts`) | Existing handlers are read-only |

## Metadata
**Search scope:** packages/modules/{communities,stories,feed}, packages/ui, packages/contracts, apps/api/src, apps/web/{app,lib}, supabase/{migrations,tests}
**Date:** 2026-09-25
