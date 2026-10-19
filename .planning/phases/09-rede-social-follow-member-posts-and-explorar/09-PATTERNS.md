# Phase 9: Rede Social - Follow, Member Posts and Explorar - Pattern Map

**Mapped:** 2026-10-19
**Files analyzed:** 34 (new/modified)
**Analogs found:** 33 / 34
**Path check:** every analog path below was confirmed with `git ls-files` or a direct read (HEAD 66824bdc era; member area is `/area-membros`, `/cursos` is the admin hub). No gitignored mirror paths.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/modules/social/module.ts` | module manifest | config | `packages/modules/store/module.ts` | exact |
| `packages/modules/social/package.json`, `tsconfig.json`, `turbo.json`, `vitest.config.ts` | config | config | `packages/modules/courses/*` (same files) | exact |
| `packages/modules/social/README.md` (MOD-05 headings) | docs | n/a | `packages/modules/store/README.md` | exact |
| `packages/modules/social/contracts/index.ts` (settings schema, follow/summary/list schemas, `SOCIAL_PERMISSIONS`) | contract | request-response | `packages/modules/store/contracts/index.ts` + `feedSettingsSchema` in `@rede-social/module-feed/contracts` (tolerant settings) | role-match |
| `packages/modules/social/db/schema.ts` (`socialFollows` + policies) | model + RLS | CRUD | `packages/modules/store/db/schema.ts` (`tenantReadAdminWritePolicies`, composite tenant checks) | role-match |
| `packages/modules/social/server/{routes,service,index}.ts` | route + service | CRUD | `packages/modules/store/server/routes.ts` / `service.ts` / `index.ts` | exact |
| `packages/modules/social/ui/*` (FollowButton, FollowCounts, LockedPost) | component (props-only) | request-response | `packages/modules/store/ui/LockedPostPlaceholder.tsx`, `LockedCount.tsx` | role-match |
| `packages/core/db/social-gate.ts` | kernel seam consts | transform | `packages/core/db/community-gate.ts` | exact |
| `packages/core/server/media/member-policy.ts` (`setMemberMediaPolicy`) | kernel seam | request-response | `setPermissionResolver` in `packages/core/server/rbac/permissions` | role-match |
| `supabase/migrations/*_social_gate_seam.sql` (stubs) | migration (hand SQL) | config | `supabase/migrations/20261008171502_community_gate_seam.sql` | exact |
| `supabase/migrations/*_social_module.sql` (generated: CHECK widen, `social_follows`, `feed_posts.visibility`, `deleted_by_user_id`, indexes, restrictive policy, moderation CHECKs) | migration (generated) | CRUD | `20261008175334_feed_community_gate_policies.sql`, `20261013205601_store_course_gate.sql` | role-match |
| `supabase/migrations/*_social_functions.sql` (seam bodies, `app.social_counts`, `app.feed_social_locked_author`, `app.media_asset_hidden` re-body) | migration (hand SQL, `--custom`) | request-response | `20261008171645_store_functions.sql`, `20261008174609_feed_gate_lookups.sql` | exact |
| `packages/modules/feed/db/schema.ts` (visibility col, `feed_posts_social_gate`, insert policy, partial indexes) | model + RLS | CRUD | same file, `feed_comments_community_gate` (lines ~455-480) and `feed_posts_community_gate` | exact |
| `packages/modules/feed/server/service.ts` (visibility fragment, audiences, `getPost` locked branch, `assertPostInteractive`, member rules, `softDeletePost` moderator branch) | service | CRUD | same file: `softDeletePost` (~1201), comment removal (~1775), `postProjection` (127), `feedPage` (325) | exact |
| `packages/modules/feed/contracts` (`scope`, `removal`, `access: follow_required`; all `.optional()`) | contract | request-response | `feedPostSchema.access` docblock (08.2 Pitfall 10 rule) | exact |
| `packages/contracts/src/modules.ts` (append `'social'` LAST) | contract | config | same file (`'courses'` appended in 08.3) | exact |
| `packages/contracts/src/access.ts` (`ACCESS_REFUSALS` append `follow_required` LAST) | contract | config | same file | exact |
| `packages/contracts/src/moderation.ts` + `packages/core/db/schema/moderation-log.ts` CHECKs + `core/server/moderation/log.ts` | contract + model | CRUD | same files (`comment_removed`) | exact |
| `apps/api/src/modules/registry.ts` (entry, `permissionsFor` branch swap, seam registration) | composition | config | same file lines 190-221 | exact |
| `apps/api/src/routes/members.ts` (social-conditional role gate) | route | request-response | same file (`staffOnly`, line ~53) | exact |
| `apps/api/src/routes/platform/tenants.ts` (settings edit route) | route | CRUD | same file (module toggle) | role-match |
| `packages/modules/feed/server/notifications.ts` + `notification-copy.ts` (`feed.post_commented`) | worker source | event-driven | same file `resolveCommentCreated` (~276, retraction ~372) | exact |
| `packages/core/server/media/service.ts` + `video/event-job.ts` (member cap, `duration_cap_seconds`) | service | file-I/O | same files (`startUpload` ~387, `completeUpload` ~623, `applyReady` ~109) | exact |
| `supabase/tests/200-social.sql`, `201-feed-social-gate.sql` | test (pgTAP) | CRUD | `supabase/tests/180-store.sql` (gate truth table + negatives) | exact |
| `supabase/tests/010-rls-coverage.sql`, `020-tenant-isolation.sql`, `160-shared-identity.sql`, `090-feed.sql`, `130-reels.sql` (edits) | test | CRUD | themselves (090/130 pin plans by index NAME) | exact |
| `apps/api/tests/integration/social.test.ts`, `feed-social.test.ts`, `social-media.test.ts` | test | request-response | `apps/api/tests/integration/store.test.ts`, `store-gate.test.ts` | exact |
| `apps/api/tests/integration/isolation.test.ts` (inventory + cases) | test | request-response | same file (TENANT-05 block, line ~551) | exact |
| `apps/api/tests/integration/setup.ts` (`withSocialEnabled`) | test helper | config | same file line 623 `withStoreEnabled` | exact |
| `scripts/seed.ts` (social on rede-lab) | seed | batch | same file line ~155 (`modules: [...REAL_TENANT_DEFAULT_MODULES, 'store', 'courses']`) | exact |
| `apps/web/app/(app)/inicio/page.tsx` + new `inicio/tabs.ts` (Início/Explorar chips) | page + registry | request-response | `apps/web/app/(app)/cursos/tabs.ts` + `HubTabs.tsx` | exact |
| `apps/web/lib/registry.tsx` (canPost gating, Reels CTA, FeedSurface props) | composition | request-response | same file ~236 | exact |
| `apps/web/app/(app)/criar/page.tsx` (member variant) | page | request-response | same file | exact |
| `apps/web/components/feed/*` (locked screen, chips, ComposeFab variant) | component | request-response | `apps/web/components/feed/community-locked.ts`, `FeedSurface.tsx`, `PostDetail.tsx` | role-match |
| `apps/web/app/(app)/membros/{page,actions}.tsx`, `[membershipId]/{page,not-found}.tsx`, `MembersList.tsx`, `lib/member-directory.ts` | page + action | CRUD | themselves (`canBrowseMemberDirectory`) | exact |
| `apps/web/app/(app)/perfil/*` (counts, private lists pages) | page | CRUD | `perfil/ProfileCommunitiesRail.tsx`, `perfil/actions.ts` | role-match |
| `apps/web/components/platform/ModuleToggles.tsx` (+ settings form, confirm) | component | CRUD | same file | role-match |
| `apps/web/lib/notification-renderers.tsx`, `apps/web/messages/pt-BR/*.json`, `i18n/messages.test.ts` | component + catalog | transform | themselves + `app.store.json` (per-module catalog) | exact |
| `apps/web/lib/feed-view.tsx` (Admin badge follows `social`) | utility | transform | same file | exact |
| `docs/DEPLOY.md` ("turning on `social`", release order) | docs | n/a | `## Phase 08.7 release` section (line ~1919) | exact |
| Tenant-isolation of brand-new `social_follows` own-row policy | model | CRUD | none for "own-row select, member-only insert" shape | no analog (use RESEARCH Pattern 1 + `feed_likes` policies) |

## Pattern Assignments

### `packages/modules/social/module.ts` (manifest, config)

**Analog:** `packages/modules/store/module.ts` (whole file, 45 lines).

```typescript
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { STORE_PERMISSIONS } from './contracts/index';

export const storeModule = defineModule({
  key: 'store',
  nav: { placement: 'topbar', label: 'Loja', icon: 'shopping-bag', href: '/loja', order: 5 },
  routes: () => import('./server/routes').then((m) => m.storeRoutes),
  defaultRolePermissions: {
    admin_tenant: [STORE_PERMISSIONS.manage],
  },
});
```

Social differences: no `nav` (D-479 adds no tab; chip lives in the web), add `requires: ['feed']`, `defaultRolePermissions: { member: ['social.participate'] }` (its own string; never import feed). Copy the store docblock style: state off-by-default (not in `REAL_TENANT_DEFAULT_MODULES`, no backfill) and the "permission composed for member only" warning. `requires` is NOT enforced by `requireModule` (registry docblock lines 129-133), so routes must chain both guards (below).

Wiring to copy: `"@rede-social/module-store": "workspace:*"` in `apps/api/package.json:32` and `apps/web/package.json:36`; registry import `import { storeModule } from '@rede-social/module-store/module';` and `MODULE_REGISTRY` entry in `apps/api/src/modules/registry.ts` (lines ~35, ~53-60); web composition in `apps/web/lib/registry.tsx` (the `store` entries). Both apps' registry entries are required. Append `'social'` LAST in `TOGGLEABLE_MODULES` (`packages/contracts/src/modules.ts:8-18`, generated `tenant_modules_key_chk` follows list order) and do NOT add it to `REAL_TENANT_DEFAULT_MODULES`.

### `packages/modules/social/server/routes.ts` (route, request-response)

**Analog:** `packages/modules/store/server/routes.ts` (imports lines 1-30) + feed `routes.ts:92` shape.

```typescript
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv, RequestContext } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { permissionsForRequest, requirePermission } from '@rede-social/core/server/rbac/permissions';
```

Guard order (ROLE-06): `social.use('*', requireAuth, requireModule('feed'), requireModule('social'))`, then per-route `requireRole('member')` / `requirePermission('social.participate')`. Routes: `PUT/DELETE /v1/social/follows/{membershipId}` (idempotent via `insert ... on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`), `GET /v1/social/me/followers|following`, `GET /v1/social/members/{membershipId}`, `POST /v1/social/follows/state`. Errors: closed `ApiError(code)` vocabulary, bare `ApiError(404,'NOT_FOUND')` for unknown/other-tenant/staff/blocked target.

### `packages/modules/social/db/schema.ts` (model + RLS, CRUD)

**Analog:** `packages/modules/store/db/schema.ts` lines 1-40 (imports, `SAME_TENANT`, `pgPolicy(..., { to: authenticatedRole })` helpers, `.enableRLS()`). Policy list for `social_follows`: select own rows (`follower_user_id = app.user_id()` or followee for counts via definer), insert only for `app.tenant_role() = 'member'` with tenant pin, delete own row. `tenant_id` first in every index; unique `(tenant_id, follower_user_id, followee_user_id)`. Plus `tenantIsolationPolicy('social_follows_tenant_isolation')` (see feed_comments, schema.ts:~458).

### `packages/core/db/social-gate.ts` (kernel seam constants)

**Analog:** `packages/core/db/community-gate.ts`.

```typescript
export const LOCKED_COMMUNITY_IDS: SQL = sql`coalesce((select app.community_locked_ids()), '{}'::uuid[])`;
export const mediaAssetHidden = (assetId: string): SQL =>
  sql`app.media_asset_hidden(${assetId}::uuid)`;
```

Copy the docblock incl. the MANDATORY coalesce rule (`x = any ((select f()))` parses as a subquery form). Exports: `SOCIAL_VISIBLE_AUTHOR_IDS = sql\`coalesce((select app.social_visible_author_ids()), '{}'::uuid[])\``, `SOCIAL_ENABLED = sql\`(select app.social_enabled())\``.

### `*_social_gate_seam.sql` (kernel stubs)

**Analog:** `supabase/migrations/20261008171502_community_gate_seam.sql`, lines 29-40: stub `create or replace function ... language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$; revoke all ... from public; grant execute ... to authenticated;` each followed by `--> statement-breakpoint`. Must sort BEFORE the generated social migration (the policy resolves the function at `CREATE POLICY`). Stubs: `app.social_enabled()` false, `app.social_visible_author_ids()` `'{}'`. RESEARCH "Code Examples" has exact bodies; bodies go in `*_social_functions.sql` (hand SQL, `--custom`).

### `*_social_functions.sql` (seam bodies + definers)

**Analog:** `supabase/migrations/20261008171645_store_functions.sql` (tenant pin to `app.tenant_id()`, `when app.tenant_role() in ('admin_tenant','support_tenant') then '{}'` staff branch, fail closed) and `20261008174609_feed_gate_lookups.sql` (the locked-link definer `app.feed_locked_post_community`, which `app.feed_social_locked_author` copies: tenant-pinned, answers one fact). Re-body `app.media_asset_hidden` (feed body) to also hide assets attached only to hidden member posts. Hardening on every function: SECURITY DEFINER, `search_path = ''`, revoke public, grant `authenticated`.

### `packages/modules/feed/db/schema.ts` (restrictive policy + indexes)

**Analog:** same file, `feed_comments_community_gate` (lines ~463-473):

```typescript
pgPolicy('feed_comments_community_gate', {
  as: 'restrictive',
  for: 'select',
  to: authenticatedRole,
  using: sql`post_id is null or exists (
    select 1 from public.feed_posts p
     where p.id = feed_comments.post_id
       and (p.community_id is null or p.community_id <> all (${LOCKED_COMMUNITY_IDS})))`,
}),
```

New `feed_posts_social_gate` (restrictive select): `visibility = 'tenant' or app.tenant_role() in ('admin_tenant','support_tenant') or author_user_id = any (${SOCIAL_VISIBLE_AUTHOR_IDS})`, plus a restrictive INSERT check forbidding a member from inserting `'tenant'` (precedent: `feed_likes_community_gate` insert check, schema.ts ~568-578). Comments and likes need NO new policy (inner `exists` over `feed_posts` runs under RLS). Indexes: visibility-partial siblings of `feed_posts_tenant_created_all_idx`, `feed_posts_tenant_created_idx`, `feed_posts_tenant_video_created_idx` (schema.ts:118-177) with LITERAL `visibility = 'tenant'` (never bound params); update name-pinned plan asserts in `090-feed.sql`/`130-reels.sql` in the same plan.

### `packages/modules/feed/server/service.ts` (service, CRUD)

**Analog:** same file.

Moderator removal (Pattern 7) extends `softDeletePost` (line 1201):

```typescript
const rows = await tx.execute<{ author_user_id: string }>(sql`
  update feed_posts set deleted_at = now()
   where id = ${postId}::uuid and author_user_id = ${ctx.userId}::uuid and deleted_at is null
  returning author_user_id`);
if (!row) throw new ApiError(404, 'NOT_FOUND');
```

Add `deleted_by_user_id`, `(author_user_id = me or (canModerate and visibility = 'followers'))`, and, when actor != author, copy the comment-removal block (~1785):

```typescript
if (!isAuthor) {
  await recordModerationAction(tx, ctx, {
    action: 'comment_removed', targetUserId: target.author_user_id,
    subjectType: 'post_comment', subjectId: commentId,
    excerptSource: target.body, reason: null,
  });
}
```
with `action: 'post_removed'`, `subjectType: 'feed_post'`. `canModerate` is computed by the ROUTE from `permissionsForRequest` before opening the tx (T-08-08). Reads: add the shared visibility fragment (RESEARCH Pattern 2) to `postProjection` (127) callers at lines 342, 599, 909, 1147; three audiences are predicates on `feedPage` (325) and must keep `FEED_LIST_STATEMENT_BUDGET = 1`. `validateAssets` (~700): a member's video must be strictly `ready`.

### `packages/modules/feed/server/notifications.ts` (event-driven)

**Analog:** same file. `post.published` resolver adds `p.visibility` and returns `[]` unless `'tenant'`; `resolveCommentCreated` (line ~276 `if (payload.parentCommentId === null) return [];`) gets a root-comment branch producing `feed.post_commented` (`channels: ['in_app','push']`, `excludeUserIds: [actor]`, `subject: post`, `object: comment` so existing retractions at ~372-381 match). Use `for share of c, p` locking (B-WR-01). Touchpoints: `FEED_NOTIFICATION_KINDS`, `notification-copy.ts`, `apps/web/lib/notification-renderers.tsx`, catalog `notifications.json` (`kinds.postCommented`), `messages.test.ts`, `notification-sources.test.ts`.

### `apps/api/src/modules/registry.ts` (composition)

**Analog:** same file, lines 197-221. Replace the `postingPolicy` block:

```typescript
if (effective.has('feed') && role === 'member') {
  const parsed = feedSettingsSchema.safeParse(settings.get('feed') ?? {});
  ...
  if (policy === 'members') permissions.add(FEED_PERMISSIONS.create);
}
```
with `if (effective.has('social') && role === 'member') { add FEED_PERMISSIONS.create; add FEED_PERMISSIONS.manage; }`. Register `setMemberMediaPolicy(...)` here (same inversion as `setPermissionResolver`, MOD-02: kernel must not import social settings). Tests to rewrite: `apps/api/tests/unit/registry.test.ts` (6b, 446-456, 470-480, case 14), `feed.test.ts` case 7 (287-328), `feed-view.test.ts`.

### `apps/api/src/routes/members.ts` (route gate)

**Analog:** same file, `const staffOnly = requireRole('admin_tenant','support_tenant');` line ~53 used as `middleware: [staffOnly] as const`. Replace with a middleware that allows staff always and `member` only when `social.participate` is in `permissionsForRequest`; keep the 403 `FORBIDDEN` BEFORE query validation. Web twin: `canBrowseMemberDirectory` in `apps/web/lib/member-directory.ts` (consumers: `membros/page.tsx:58`, `membros/actions.ts:59`, `[membershipId]/not-found.tsx:39`).

### Media (`packages/core/server/media/service.ts`, `video/event-job.ts`, `limits.ts`)

**Analog:** same files. `startUpload` line 387: `if (body.kind === 'video' && ctx.role !== 'admin_tenant') throw new ApiError(403, 'FORBIDDEN');` becomes seam-aware for `post`-purpose video only. `completeUpload` (623/656) re-judges bytes with the member cap. `applyReady` (event-job 109-134) uses `coalesce(row.duration_cap_seconds, limit.maxDurationSeconds)`; expand-only nullable `media_assets.duration_cap_seconds` snapshot at start. Pools: `MEDIA_TENANT_BYTES_CEILING`, `MEDIA_TENANT_VIDEO_SECONDS_CEILING` (limits.ts:36,41); see RESEARCH open question.

### pgTAP `supabase/tests/200-social.sql`, `201-feed-social-gate.sql`

**Analog:** `supabase/tests/180-store.sql` (begins with `begin;`, numbered header comment: truth table of the gate, off-switch case, feed_posts visibility in lane, read-only/negative writes per role incl. null-role lane, definer grants). Required cases: follower/non-follower/author/moderator/support matrix on `feed_posts`, comment and like inheritance, `social` off = nothing visible, blocked author hidden, cross-tenant negatives on `social_follows`, member cannot insert `visibility='tenant'`. Update `010-rls-coverage.sql`, `020-tenant-isolation.sql`, `160-shared-identity.sql` lists.

### Integration tests

**Analog:** `apps/api/tests/integration/store-gate.test.ts` and `store.test.ts`; helper `withSocialEnabled` modeled on `export const withStoreEnabled = (host) => withModuleEnabled(host, 'store');` (`setup.ts:623`). Isolation: add inventory entries and cases in `isolation.test.ts` (TENANT-05 block at ~551; pattern: assert 404 and also a positive control in the other tenant "so the 404s are isolation, not a broken route"). Include a `support_tenant` session case per read route (RLS exempts staff by claim, Pitfall 2). Seed: enable `social` on rede-lab only (`scripts/seed.ts:~155` shows the `modules:` array form); rede-demo stays off (e2e `comunidades.spec.ts` asserts members hold no `feed.post.create`).

### Web: chips and Explorar (`apps/web/app/(app)/inicio/`)

**Analog:** `apps/web/app/(app)/cursos/tabs.ts` + `HubTabs.tsx` (`?aba=` registry; plain `.ts` with no React; `hubTabFromParam`, `hubTabHref`; order is the contract; unknown value falls back to default). Create `inicio/tabs.ts` with `{ key:'inicio' }`, `{ key:'explorar' }` and show chips only when `bootstrap.modules` has `social` and role is `member` or the caller holds `moderation.manage`; with `social` off render today's Início with no chips.

### Web: gating the organization-voice surfaces (Pitfall 1)

**Analog:** `apps/web/lib/registry.tsx:236` `canPost={bootstrap.permissions.includes('feed.post.create')}`. Change to `feed.post.create` AND `content.publish` for Início FAB, community page `canPost` (`comunidades/[communityId]/page.tsx:467`), Reels empty CTA (`registry.tsx:~423`), `/criar` picker/attachments (`criar/page.tsx:45`); the member composer entry gates on `social.participate`. `createHref="/criar"` stays the only route (module never assembles routes, MOD-02).

### Web: locked screen

**Analog:** `apps/web/components/feed/community-locked.ts` + `packages/modules/store/ui/LockedPostPlaceholder.tsx`. Note `apps/web/app/(app)/inicio/feed-actions.ts:60` reads `ACCESS_REFUSALS[0]` as community_locked, so append `follow_required` LAST. UI is props-only inside the module; strings from host catalog `apps/web/messages/pt-BR/*.json` (new `app.social.json` modeled on `app.store.json`), checked by `bash scripts/check-ui-literals.sh`.

### Web: platform panel settings

**Analog:** `apps/web/components/platform/ModuleToggles.tsx` and `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts`, API `apps/api/src/routes/platform/tenants.ts`. Panel exposes only `{key, enabled}` today; settings editing and a "turning on social" confirmation are NEW. Settings contract: tolerant `safeParse` with defaults (photos 5 MiB x 4, video off, 60 s / 100 MiB), same tolerant style as `feedSettingsSchema`.

### `docs/DEPLOY.md`

**Analog:** `## Phase 08.7 release` section (~1919): sub-headings "What ships", "Order: migrations, then the API and the worker together, then the web", "Turning it on", "Smoke checks", "Rollback limit", "Manual UAT". Add `## Phase 09 release` plus the D-478 "turning on `social`" item (terms/rules/privacy review, flag to user before enabling).

## Shared Patterns

### Tenant lane and RLS posture
**Source:** `withTenantTx` (`packages/core/db/tenant-tx.ts`), `packages/core/db/rls.ts`. **Apply to:** all new services. Never `service_role`/`postgres` for tenant queries; every new table `.enableRLS()` with `tenant_id` first in indexes and a pgTAP cross-tenant negative.

### Gate seam (stub in kernel, body in module)
**Source:** `community-gate.ts` + `20261008171502_community_gate_seam.sql`. **Apply to:** social-gate.ts, seam migration, media-policy seam. Same OIDs via `create or replace`; flag cache (30 s) is for UI/permissions only, the SQL gate reads `tenant_modules` directly.

### Idempotent writes and keyset paging
`on conflict ... do nothing` on the unique index (as `feed_likes_post_uq`); `feedPage` with `encodeCursor/decodeCursor` on `(created_at, id)`.

### Bare 404 vs locked answer
Unknown/other tenant/removed/blocked/social-off: bare `ApiError(404,'NOT_FOUND')`. Locked: `ApiError(403,'FORBIDDEN',{ access:'follow_required', author })` only after the definer confirms the one case.

### Additive contract changes
Feed contracts are `.strict()`; new fields `.optional()` (08.2 Pitfall 10 docblock on `feedPostSchema.access`); `memberProfileSchema` stays unchanged, social fields come from a separate variant.

### Module boundary
Social must not import `@rede-social/module-feed` (turbo boundaries); share through `@rede-social/contracts` and kernel seams. `pnpm boundaries` and `pnpm db:generate` ("No schema changes") stay green.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `social_follows` own-row select / member-only insert policies | model | CRUD | Store tables are tenant-read/admin-write; nearest shape is `feed_likes` (user-owned rows) plus `tenantIsolationPolicy`. Use RESEARCH Pattern 1 text. |
| API rate limiter (D-474 premise) | middleware | request-response | None exists in `apps/api/src`; see RESEARCH Open Question 1. |

## Metadata

**Analog search scope:** `packages/modules/{store,courses,feed}`, `packages/core/{db,server}`, `packages/contracts`, `supabase/{migrations,tests}`, `apps/api/{src,tests}`, `apps/web/{app,components,lib,messages}`, `scripts/seed.ts`, `docs/DEPLOY.md`
**Files scanned:** ~45 read or grepped
**Pattern extraction date:** 2026-10-19

*Reconciled 2026-10-19 with CONTEXT.md after a bullet-format-only change (two carried-forward bullets re-tagged so the decision-coverage gate parses them); no decision changed.*
