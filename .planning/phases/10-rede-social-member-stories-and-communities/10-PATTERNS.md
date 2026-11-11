# Phase 10: Rede Social - Member Stories and Communities - Pattern Map

**Mapped:** 2026-11-10
**Files analyzed:** 34 (new or modified)
**Analogs found:** 34 / 34 (every file extends a sibling in the same package; excerpts below were read this session, other line ranges are cited from RESEARCH.md and need a quick re-read by the executor)

All analog paths below were checked as git-tracked source (no `.gsd/capabilities` mirror paths). Line numbers are from files read on 2026-11-10.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `supabase/migrations/*_member_communities.sql` (generated: `communities.kind`, `stories.visibility`, widened `feed_posts` CHECKs, restrictive policies) | migration | CRUD / RLS | `feed/db/schema.ts` policies (lines 270-320) + 09-03 `feed_posts_social_insert_gate` | exact |
| `supabase/migrations/*_member_communities_functions.sql` (custom: `app.member_community_hidden_ids()`, story highlight-readable helper) | migration (definer fn) | request-response | `20261026213756_community_soft_delete_gate.sql` | exact |
| `supabase/migrations/*_moderation_member_content.sql` (custom: widen `moderation_log` CHECKs) | migration | transform | `20261019225153_moderation_post_removed.sql` | exact |
| `supabase/tests/230+*.sql` (new pgTAP: kind gate, hidden creator, story audience, moderation vocab) | test (pgTAP) | RLS negatives | `112-community-soft-delete.sql`, `201-feed-social-gate.sql`, `154-moderation-log.sql` | exact |
| `supabase/tests/110`, `112`, `120`, `154`, `201` (extend pins/counters) | test | RLS | themselves | exact |
| `packages/modules/communities/db/schema.ts` (+ `kind`, CHECK, policies) | model | CRUD | `packages/modules/feed/db/schema.ts` | role-match |
| `packages/modules/stories/db/schema.ts` (+ `visibility`, gates) | model | CRUD | `packages/modules/feed/db/schema.ts` (stamped `visibility`) | exact |
| `packages/modules/feed/db/schema.ts` (widen CHECK + `'community'` insert branch + hidden-community gate) | model | CRUD | same file lines 245-249, 270-320 | exact |
| `packages/core/db/schema/moderation-log.ts` | model | transform | itself (mirror CHECKs) | exact |
| `packages/contracts/src/moderation.ts` | contract | transform | itself (append values lines 41, 55) | exact |
| `packages/core/server/moderation/log.ts` | service (kernel) | CRUD | itself (`post_removed` branch) | exact |
| `packages/core/server/media/member-policy.ts` + `media/service.ts`, `member-share.ts` | service (kernel seam) | request-response | `setMemberMediaPolicy` seam | exact |
| new kernel seam `memberCommunityPolicyFor` (same dir as member-policy.ts) | service (kernel seam) | request-response | `member-policy.ts` | exact |
| `packages/modules/communities/contracts/index.ts` | contract | request-response | itself (`.strict()` schemas, `COMMUNITY_ISSUES`) | exact |
| `packages/modules/communities/server/service.ts` | service | CRUD | itself (`createCommunity`, `updateCommunity` archivedNow, `reorderCommunities`) | exact |
| `packages/modules/communities/server/routes.ts` | route | request-response | itself (lines 107-135) | exact |
| `packages/modules/stories/contracts/index.ts` | contract | request-response | itself (`storySummarySchema`) | exact |
| `packages/modules/stories/server/service.ts` (`resolveHighlightPlace`, `publishStory`, `deleteStory`, authors read, highlight item inserts) | service | CRUD | itself lines 1195-1235, 560-576 | exact |
| `packages/modules/stories/server/routes.ts` | route | request-response | itself | exact |
| `packages/modules/stories/server/notifications.ts` | service | event-driven | `feed/server/notifications.ts:149` (`visibility !== 'tenant'` guard) | exact |
| `packages/modules/feed/server/service.ts` (`memberRules`, `resolveCommunityTarget`, `toPost`, Reels predicate) | service | CRUD | itself lines 930-942, 1155-1176 | exact |
| `packages/modules/feed/contracts/index.ts` (`FEED_AUDIENCES`) | contract | transform | itself line 56 | exact |
| `packages/modules/social/contracts/index.ts` (`maxPerMember` in settings, patch, answer) | contract | CRUD | itself (`socialSettingsSchema` `.prefault({})`) | exact |
| `apps/api/src/modules/registry.ts` (`permissionsFor`, new policy seam) | config | request-response | itself lines 222-236, 300-316 | exact |
| `apps/api/tests/isolation-inventory.ts` + `tests/integration/isolation.test.ts` | test | request-response | existing entries (`'GET /v1/communities': { case: 'b2' }`) | exact |
| `apps/api/tests/integration/{communities,stories,feed-social,moderation-posts,social-media}.test.ts` + new member files | test | request-response | `moderation-posts.test.ts`, `feed-social.test.ts` | exact |
| `apps/api/tests/unit/registry*.test.ts` | test | unit | existing case 16 twin | exact |
| `apps/web/app/(app)/inicio/ExplorarBody.tsx` + `lib/registry.tsx` (Explorar row) | component (RSC) | request-response | `ExplorarBody.tsx`, `lib/registry.tsx:688` | role-match |
| `packages/modules/stories/ui/StoriesStrip.tsx`, `StoryCircle.tsx`, `apps/web/components/stories/StoriesSurface.tsx`, `StoryViewerHost.tsx` | component | event-driven (viewer, seen state) | 05.2 grouped viewer (same files) | exact |
| `apps/web/app/(app)/stories/publicar/StoryComposer.tsx` | component | request-response | itself (member variant) | exact |
| `apps/web/app/(app)/comunidades/CommunityForm.tsx` | component | request-response | itself (drop products field) | exact |
| `apps/web/app/(app)/comunidades/CommunitiesList.tsx` + `comunidades/page.tsx` | component | request-response | itself (line 40 `canManage`) | exact |
| `apps/web/lib/feed-view.tsx` (badge line 266), `FeedList.tsx:498`, `PostDetail.tsx:211` | component | transform | themselves | exact |
| `apps/web/lib/moderation-view.ts`, `components/admin/ModerationLogRow.tsx` | component | transform | `post_removed` rows (lines 62, 128, 208) | exact |
| `docs/DEPLOY.md`, seed | config | batch | Phase 9 "Ativar a Rede social" section | exact |

## Pattern Assignments

### Migration: hidden-creator definer (`*_member_communities_functions.sql`)
**Analog:** `supabase/migrations/20261026213756_community_soft_delete_gate.sql` (lines 1-80)

Header convention: a long comment block (task id, decisions, "Expand-only", hardening note), `--> statement-breakpoint` between statements, hand-written file is named so it sorts BEFORE the generated file whose CREATE POLICY calls it.

```sql
create or replace function app.community_deleted_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.communities c
   where c.tenant_id = app.tenant_id()
     and c.deleted_at is not null
$$;
--> statement-breakpoint
revoke all on function app.community_deleted_ids() from public;--> statement-breakpoint
grant execute on function app.community_deleted_ids() to authenticated;
```
Copy: swap the body for `kind = 'member'` and `not exists (live membership of created_by_user_id)` (RESEARCH "Code Examples"). No `limit` or single-row pick clause (pgTAP 040 pins the set of such functions). Do not fold into `community_deleted_ids()` (pgTAP 112 pins its meaning). Policy form reads it as an InitPlan: `coalesce((select app.member_community_hidden_ids()), '{}'::uuid[])`, never `<> all (subquery)`.

### Migration: moderation vocabulary widening (`*_moderation_member_content.sql`)
**Analog:** `supabase/migrations/20261019225153_moderation_post_removed.sql` (lines 1-18)

```sql
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_action_chk";--> statement-breakpoint
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_subject_chk";--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_action_chk" CHECK ("moderation_log"."action" in (...));--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_subject_chk" CHECK ((("moderation_log"."action" in ('comment_removed','post_removed')) = ("moderation_log"."subject_type" is not null and "moderation_log"."subject_id" is not null))
        and ("moderation_log"."subject_type" is null or "moderation_log"."subject_type" in ('post_comment','story_comment','feed_post'))
        and (coalesce("moderation_log"."subject_type" = 'feed_post', false) = ("moderation_log"."action" = 'post_removed')));
```
Pitfall: the CURRENT action list is the later one in `20261029232606_profile_form_tables.sql:63` (adds `profile_form_exported`), not this file's. Start from that list. Full target SQL is in RESEARCH "Moderation vocabulary widening". Also mirror in `packages/core/db/schema/moderation-log.ts` so `pnpm db:generate` prints "No schema changes".

### Drizzle policies for `communities` / `stories` / `feed_posts`
**Analog:** `packages/modules/feed/db/schema.ts` lines 270-320

```ts
pgPolicy('feed_posts_social_insert_gate', {
  as: 'restrictive', for: 'insert', to: authenticatedRole,
  withCheck: sql`(app.tenant_role() = 'member' and visibility = 'followers' and community_id is null and ${SOCIAL_ENABLED}) or (app.tenant_role() <> 'member' and visibility = 'tenant')`,
}),
pgPolicy('feed_posts_deleted_community_gate', {
  as: 'restrictive', for: 'select', to: authenticatedRole,
  using: sql`community_id is null or community_id <> all (${DELETED_COMMUNITY_IDS})`,
}),
// select social gate:
using: sql`visibility = 'tenant' or (${SOCIAL_ENABLED} and (${SOCIAL_STAFF_EXEMPT} or author_user_id = any (${SOCIAL_VISIBLE_AUTHOR_IDS})))`,
```
Imports: kernel seams from `@rede-social/core/db/social-gate` (`SOCIAL_ENABLED`, `SOCIAL_VISIBLE_AUTHOR_IDS`, `SOCIAL_STAFF_EXEMPT`) and `core/db/community-gate`. Reuse for: `stories_audience_gate` (add the highlight branch and live-author test, RESEARCH Pattern 2), `communities_kind_insert_gate`, `communities_member_hidden_gate`, and the new `'community'` branch on `feed_posts_social_insert_gate`. The CHECK widening goes at `feed/db/schema.ts:245-249` (`feed_posts_visibility_chk`, `feed_posts_visibility_shape_chk`). Member UPDATE policy must NOT include `app.social_enabled()` in WITH CHECK (counter trigger `app.community_post_stats()` runs as invoker, Pitfall 4).

### pgTAP files (new 230+)
**Analog:** `supabase/tests/112-community-soft-delete.sql` (header block, `begin; select plan(N);`, fixture ids with a numeric prefix such as `11200000-...`, rolls back at the end), plus `201-feed-social-gate.sql` for the member/follower/moderator matrix and `154-moderation-log.sql` for the log. Required matrix per policy: owner, non-owner member, follower, non-follower, moderator, support, system lane, other tenant, with positive control before negatives. Last existing file is `229-profile-form-professional-id.sql`, so start at 230. Extend 110 (counter reconciliation with member-lane insert and soft delete), 120 (EXPLAIN pin for `viewer_seen`, keep constant `v.tenant_id` form), 154, 201.

### Kernel seam: member community limit
**Analog:** `setMemberMediaPolicy` in `apps/api/src/modules/registry.ts` lines 300-316, defined in `packages/core/server/media/member-policy.ts`

```ts
setMemberMediaPolicy(async (ctx) => {
  const flags = await moduleFlags.flags(ctx);
  if (!effectiveKeys(flags.keys).has('social')) return null;
  const parsed = socialSettingsSchema.safeParse(flags.settings.get('social') ?? {});
  return (parsed.success ? parsed.data : SOCIAL_SETTINGS_DEFAULTS).media;
});
```
Copy for `setMemberCommunityPolicy` (returns `{ maxActive }` or null). Read BEFORE `withTenantTx`. Unit pin: `packages/core/tests/member-media-policy.test.ts`. Media extension (`purpose in ('post','story')` for video, `('post','story','cover')` for image cap, owner check on story/cover assets) lands in `core/server/media/service.ts` (~442-470) and `member-share.ts` (`memberPostSecondsUsed`).

### `apps/api/src/modules/registry.ts` `permissionsFor`
**Analog:** same file lines 222-236

```ts
if (effective.has('social') && role === 'member') {
  permissions.add(FEED_PERMISSIONS.create);
  permissions.add(FEED_PERMISSIONS.manage);
}
```
Extend with the RESEARCH snippet (create, manage_own, `stories.story.publish`, each also requiring `effective.has('communities'|'stories')`). Pin member-only by construction in registry unit tests.

### Route guards (communities, stories)
**Analog:** `packages/modules/communities/server/routes.ts` lines 107-135

```ts
const createCommunityRoute = createRoute({
  method: 'post', path: '/',
  // The literal, not `COMMUNITY_PERMISSIONS.manage` ...
  middleware: [requirePermission('communities.community.manage')] as const,
  request: { body: { content: { 'application/json': { schema: createCommunitySchema } }, required: true } },
  responses: { 201: {...}, 400: {...}, 403: {...} },
});
```
`requirePermission` takes several names (ANY-of): spell the literals out, e.g. `requirePermission('communities.community.manage', 'communities.community.create')`. Imports at lines 1-30: `createRoute, OpenAPIHono, z`, `requireAuth`, `ApiError`, `requireModule`, `permissionsForRequest, requirePermission`. Add new machine codes (`limit_reached`) to `COMMUNITY_ISSUES` so the route `defaultHook` and the web switch stay exhaustive. Same approach for `packages/modules/stories/server/routes.ts` (guards at lines 135, 199, 214, 257, 286, 317, 344, 363, 463, 611; `canModerateComments` precedent at ~713 for computing `canModerate` from `permissionsForRequest`).

### Owner seam: `resolveHighlightPlace` (stories) and `resolveCommunityTarget` (feed)
**Analog:** `packages/modules/stories/server/service.ts` lines 1195-1235 (its docblock says Phase 10 extends THIS function) and `packages/modules/feed/server/service.ts` lines 1155-1176

```ts
const rows = await tx.execute<{ status: string; locked: boolean }>(sql`
  select c.status, (c.id = any (${LOCKED_COMMUNITY_IDS})) as locked
    from communities c
   where c.id = ${communityId}::uuid and c.tenant_id = ${ctx.tenantId}::uuid and c.deleted_at is null
   ${lock}`);
const community = rows[0];
if (!community) throw new ApiError(404, 'NOT_FOUND');
if (intent === 'curate' && community.status !== 'active') {
  throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'archived' });
}
```
```ts
// feed resolveCommunityTarget: select c.status from public.communities c where ... limit 1
if (!community) throw new ApiError(404, 'NOT_FOUND');
if (community.status === 'archived') throw new ApiError(400, 'VALIDATION_FAILED', { community: 'archived' });
```
Add `c.kind, c.created_by_user_id` to both selects, 403 for non-owner, order 404 -> 403 -> 400. Pass permission flags in `gate` instead of reading `ctx.role` (T-05-03). Drop the `member_no_community` line at `feed/server/service.ts:938` (`if (input.communityId !== null) throw refuse('member_no_community');`) for owners. Keep reading `moduleFlags` BEFORE `withTenantTx` (`readPlaceGate`, ~1157-1169). Map 42501 to 403 for members as at `feed/server/service.ts:1277`.

### Story delete / moderator branch + log row
**Analog:** `packages/modules/stories/server/service.ts` lines 560-576 (`deleteStory`: `update stories set deleted_at = now() where tenant_id and id and deleted_at is null returning id, author_user_id`) and `packages/core/server/moderation/log.ts` (`recordModerationAction(tx, ctx, entry)`, `removal` branch at line 157, `ModerationEntry` union at 38-82). Move into one transaction: lock row `for update`, apply author/moderator/manager predicate, call `recordModerationAction` only when actor is not the author and the story is a member story. Community side: `communities/server/service.ts` `archivedNow` (~771) and `deleteCommunity` (~938).

### Notifications source guard
**Analog:** `packages/modules/feed/server/notifications.ts:149` `if (row.visibility !== 'tenant') return [];`. Apply the same literal in `packages/modules/stories/server/notifications.ts` (55-103) so member stories produce zero notifications; unit test in `stories/tests/notification-sources.test.ts`.

### Social settings (`maxPerMember`)
**Analog:** `packages/modules/social/contracts/index.ts` `socialSettingsSchema` (`.prefault({})` chain), `socialSettingsPatchSchema`, `socialSettingsAnswerSchema` (both `.strict()`), `SOCIAL_SETTINGS_DEFAULTS`. Add `communities: { maxPerMember: int 0..20 default 3 }` to all four. Create-time lock: `pg_advisory_xact_lock(hashtextextended('communities:own:' || tenant || ':' || user, 0))` (precedents `core/server/profile-form/admin.ts:88`, `payments/gate.ts:30`). Rate ceiling: `createAttemptLimiter` as `reportLimiter` in `core/server/safety/limits.ts`.

### Explorar row (web)
**Analogs:** `apps/web/app/(app)/inicio/ExplorarBody.tsx` (RSC, takes `permissions`, `buildFeedSurface` from `@/lib/registry`, no role comparisons, empty states chosen server-side), `lib/registry.tsx:688` (`canPublish: bootstrap.permissions.includes('stories.story.publish')`, must change to `content.publish` for Início and key member surfaces on `social.participate`, Pitfall 12), 05.2 grouped viewer `packages/modules/stories/ui/StoriesStrip.tsx`, `StoryCircle.tsx`, `apps/web/components/stories/StoriesSurface.tsx`, `StoryViewerHost.tsx` (lazy groups with `items: null` then `loadHighlightItemsAction`). New API: `GET /v1/stories/authors` (cursor by `(max(expires_at), author)`) and `/authors/{membershipId}`. Server actions follow `comunidades/actions.ts` (`createCommunityAction` etc.).

### Community form and list (web)
**Analogs:** `apps/web/app/(app)/comunidades/CommunityForm.tsx` (imports lines 1-30: `createCommunitySchema, updateCommunitySchema`, `CommunityCover`, `FileDropZone`, `CoverSizeHint`; reuse without the products field) and `CommunitiesList.tsx` (props: `canManage` is "the composed permission, never a role comparison"; add per-item `viewer { isOwner, canPublish, canEdit, canCurate }` and `createdBy`, so the host never compares ids). `comunidades/page.tsx:27` and `CommunitiesList.tsx:40` read `communities.community.manage` for reorder/archived/store form; members get `manage_own`, so these sites must stay keyed on `manage`.

### Moderation log web rows
**Analog:** `apps/web/lib/moderation-view.ts` (`{ action: 'post_removed', key: 'posts' }` line 62; `post_removed: 'postRemoved'` line 128; branch line 208) and `components/admin/ModerationLogRow.tsx`. Exhaustive maps: add three kinds, update `moderation-view.test.ts`.

### Post audience badge
**Analog:** `apps/web/lib/feed-view.tsx:266` (`post.audience === 'followers' ? null : tf('post.adminBadge')`), `feed/contracts/index.ts:56` `FEED_AUDIENCES`, `FeedList.tsx:498`, `PostDetail.tsx:211`. Widen to the third value `'community'`; badge only for organization posts.

### Isolation inventory
**Analog:** `apps/api/tests/isolation-inventory.ts` (keys `"<METHOD> <path>"` with `:param`, value `{ case: '<it-title prefix>' }`, e.g. `'GET /v1/communities': { case: 'b2' }` line 214). Write the cross-tenant `it()` first in `tests/integration/isolation.test.ts` (negative beside positive control, plus wrong-host 403), then add entries for each new route (`GET /v1/stories/authors`, `GET /v1/stories/authors/:membershipId`, any member variants). The unit check `tests/unit/isolation-inventory.test.ts` goes red otherwise.

## Shared Patterns

### Stamp, then gate
**Source:** `feed/db/schema.ts` (`visibility` stamp, 124-135) + `feed/server/service.ts:1250` (`ctx.role === 'member' ? 'followers' : 'tenant'`).
**Apply to:** `communities.kind`, `stories.visibility`, `feed_posts.visibility='community'`. Written from `ctx`/target row, never from the body (request schemas stay `.strict()`); RLS insert gate refuses mismatch with 42501.

### Tenant lane and one connection per request
**Source:** `withTenantTx` (`packages/core/db/tenant-tx.ts`); read `moduleFlags.isEnabled/flags` before opening the tx.
**Apply to:** every new service function.

### Bare 404 / 403 split
**Source:** D-23 plus existing `ApiError(404, 'NOT_FOUND')` / `ApiError(403, 'FORBIDDEN')` / `ApiError(400, 'VALIDATION_FAILED', { module: code })`.
**Apply to:** all member-facing reads (hidden creator, foreign story) = bare 404; non-owner writes = 403.

### Cursor paging
**Source:** `@rede-social/core/server/paging` (`decodeCursor`, `encodeCursor`, `keysetComparison`), total decoders.
**Apply to:** the authors read and the community list ordering (sentinel `position = 1000000` for member communities, reorder limited to `kind = 'organization'`).

### Block filter
**Source:** `NOT_BLOCKED_AUTHOR` using `app.is_blocked_by_viewer(author)` at `feed/server/service.ts:360`.
**Apply to:** Explorar row and community lists (MSTORY-08).

### Logging
`moduleLogger`, ids only (never captions or names).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `GET /v1/stories/authors` (paged-by-author read) | route/service | request-response | No paging-by-author read exists; combine the 05.2 grouped viewer, `viewer_seen` subplan form and `09-03-SPIKE.md` method. Use RESEARCH Pattern 5. |
| Member-lane `communities` restrictive insert/update/delete policies | model | RLS | `communities` has only a tenant-isolation policy today; adapt `feed_posts` gates. |
| Highlight-branch of the stories audience gate (D-716) | model | RLS | New; no existing gate joins `story_highlight_items` to community visibility. Measure it (RESEARCH A10). |

## Metadata

**Analog search scope:** `supabase/migrations`, `supabase/tests`, `packages/core`, `packages/contracts`, `packages/modules/{communities,stories,feed,social}`, `apps/api/src/modules`, `apps/api/tests`, `apps/web/app/(app)`, `apps/web/lib`, `apps/web/components`
**Files read in full or by range this session:** 10-RESEARCH.md (lines 1-516 of 755), the two migration analogs, stories/feed service ranges, registry.ts ranges, communities routes, ExplorarBody, CommunityForm/CommunitiesList heads, isolation-inventory header.
**Pattern extraction date:** 2026-11-10
