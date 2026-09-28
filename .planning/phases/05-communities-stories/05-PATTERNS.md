# Phase 5: Communities & Stories - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 38 new/modified files
**Analogs found:** 36 / 38

> **Every analog path below is git-TRACKED source** (verified with `git ls-files`).
> `reference/frontend-design/**` is **gitignored** (`.gitignore:2: reference/`). It is the design
> team's read-only prototype, not code to import and not a mirror of tracked source. It appears in
> this document only under **Design References**, never as a code analog — the planner must treat it
> as a *visual* source (D-66) and port behaviour into the analogs named here.

---

## File Classification

### New — `packages/modules/communities/`

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/modules/communities/package.json` | config | — | `packages/modules/feed/package.json` | exact |
| `packages/modules/communities/module.ts` | config (manifest) | event-driven | `packages/modules/feed/module.ts` | exact |
| `packages/modules/communities/contracts/index.ts` | contract | request-response | `packages/modules/feed/contracts/index.ts` | exact |
| `packages/modules/communities/db/schema.ts` | model | CRUD | `packages/modules/feed/db/schema.ts` | exact |
| `packages/modules/communities/server/routes.ts` | route | request-response | `packages/modules/feed/server/routes.ts` | exact |
| `packages/modules/communities/server/service.ts` | service | CRUD + keyset | `packages/modules/feed/server/service.ts` (`listFeed`) | exact |
| `packages/modules/communities/ui/CommunityCard.tsx` | component | presentational | `packages/modules/feed/ui/PostHeader.tsx` (dumb-prop posture) | role-match |
| `packages/modules/communities/ui/CommunityHeader.tsx` | component | presentational | `packages/modules/feed/ui/PostHeader.tsx` | role-match |
| `packages/modules/communities/ui/HighlightsRow.tsx` | component | presentational | `packages/ui/src/primitives/Avatar.tsx` + `packages/modules/feed/ui/PostMedia.tsx` | partial |
| `packages/modules/communities/ui/index.ts` | config (barrel) | — | `packages/modules/feed/ui/index.ts` | exact |

### New — `packages/modules/stories/`

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/modules/stories/package.json` | config | — | `packages/modules/feed/package.json` | exact |
| `packages/modules/stories/module.ts` | config (manifest) | event-driven | `packages/modules/feed/module.ts` | exact |
| `packages/modules/stories/contracts/index.ts` | contract | request-response | `packages/modules/feed/contracts/index.ts` | exact |
| `packages/modules/stories/db/schema.ts` | model | CRUD + TTL predicate | `packages/modules/feed/db/schema.ts` (`feedPosts`, `feedLikes`) | exact |
| `packages/modules/stories/server/routes.ts` | route | request-response | `packages/modules/feed/server/routes.ts` | exact |
| `packages/modules/stories/server/service.ts` | service | CRUD + keyset + idempotent toggle | `packages/modules/feed/server/service.ts` (`listFeed`, `likePost`) | exact |
| `packages/modules/stories/ui/StoriesStrip.tsx` | component | presentational | `packages/modules/feed/ui/FeedList.tsx` (prop-driven list) | role-match |
| `packages/modules/stories/ui/StoryViewer.tsx` | component | event-driven (pointer + rAF) | `packages/ui/src/overlays/BottomSheet.tsx` + `packages/modules/feed/ui/PostMedia.tsx` | partial |
| `packages/modules/stories/ui/StoryComposer.tsx` | component | file-I/O | `apps/web/components/media/VideoUploadField.tsx` + `useSignedUpload.ts` | role-match |
| `packages/modules/stories/ui/index.ts` | config (barrel) | — | `packages/modules/feed/ui/index.ts` | exact |

### Modified — feed module + kernel composition

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/modules/feed/db/schema.ts` | model | CRUD | itself (lines 86–118, 272–302, 340–356) | exact |
| `packages/modules/feed/server/service.ts` (`listFeed`, new `listCommunityFeed`) | service | keyset read | itself (lines 245–288) | exact |
| `packages/modules/feed/ui/PostHeader.tsx` (D-71 "em {Comunidade}") | component | presentational | itself | exact |
| `packages/modules/feed/ui/CommentsList.tsx` (flat variant, D-82) | component | CRUD | itself (`variant` prop, lines 11–17) | exact |
| `apps/api/src/modules/registry.ts` | config | — | itself (lines 24–26) | exact |
| `apps/web/lib/registry.tsx` | config (web composition) | — | itself (`feedHome`, lines 96–120) | exact |
| `packages/contracts/src/events.ts` | contract | event-driven | itself (declaration-merge point) | exact |

### Modified/new — web app tier

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/lib/communities.ts`, `apps/web/lib/stories.ts` | service (fetch layer) | request-response | `apps/web/lib/feed.ts` | exact |
| `apps/web/app/(app)/comunidades/page.tsx` | route (RSC page) | request-response | `apps/web/app/(app)/membros/page.tsx` | exact |
| `apps/web/app/(app)/comunidades/CommunitiesList.tsx` | component (client list) | keyset paging | `apps/web/app/(app)/membros/MembersList.tsx` | exact |
| `apps/web/app/(app)/comunidades/[communityId]/page.tsx` | route (RSC page) | request-response | `apps/web/app/(app)/post/[postId]/page.tsx` | exact |
| `apps/web/app/(app)/comunidades/actions.ts` | service (server actions) | CRUD | `apps/web/app/(app)/criar/actions.ts` + `inicio/feed-actions.ts` | exact |
| `apps/web/app/(app)/comunidades/nova/page.tsx`, `.../editar/page.tsx` | route (form page) | CRUD | `apps/web/app/(app)/perfil/editar/EditProfileForm.tsx` | role-match |
| `apps/web/app/(app)/stories/publicar/page.tsx` | route (form page) | file-I/O | `apps/web/app/(app)/criar/ComposerForm.tsx` | role-match |
| `apps/web/app/(app)/stories/meus/page.tsx` (D-84) | route (RSC list) | request-response | `apps/web/app/(app)/membros/page.tsx` | role-match |
| `apps/web/app/(app)/stories/story-actions.ts` | service (server actions) | CRUD | `apps/web/app/(app)/inicio/feed-actions.ts` | exact |
| `apps/web/components/stories/StoriesSurface.tsx` | component (client shell) | — | `apps/web/components/feed/FeedSurface.tsx` | exact |
| `apps/web/messages/pt-BR/communities.json`, `stories.json` | config (catalog) | — | `apps/web/messages/pt-BR/feed.json` | exact |

### Modified/new — database + tests

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/<ts>_communities_stories.sql` (generated) | migration | — | `supabase/migrations/20260922162440_feed_interactions.sql` | exact |
| `supabase/migrations/<ts>_communities_stories_rules.sql` (`--custom`) | migration | — | `supabase/migrations/20260922162449_feed_counters.sql` | exact |
| `supabase/tests/110-communities-stories.sql` | test (pgTAP) | — | `supabase/tests/090-feed.sql` | exact |
| `supabase/tests/020-tenant-isolation.sql` (extended) | test (pgTAP) | — | itself | exact |
| `scripts/seed.ts` (extended) | utility | batch | itself | exact |

---

## Pattern Assignments

### `packages/modules/{communities,stories}/module.ts` (config, event-driven)

**Analog:** `packages/modules/feed/module.ts`

**The whole manifest shape** (lines 1–7, 27–34, 94–97):
```ts
import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { FEED_PERMISSIONS } from './contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-feed');

export const feedModule = defineModule({
  key: 'feed',
  home: [{ order: 10 }],
  routes: () => import('./server/routes').then((m) => m.feedRoutes),
  jobs: [feedUnfurlJob],
  events: [ /* … */ ],
  defaultRolePermissions: {
    admin_tenant: [FEED_PERMISSIONS.create, FEED_PERMISSIONS.manage],
  },
});
```

**Event-subscription block to copy verbatim** (lines 36–41) — payload is ids/flags only, never body text:
```ts
{
  event: 'post.published',
  handler: async (payload) => {
    // Shape only — a caption never reaches a log line (T-04-05).
    log.info({ event: 'post.published', ...payload }, 'post published');
  },
},
```

**Deltas for Phase 5:**
- `communities`: add `nav: { placement: 'tab', label…, icon…, href: '/comunidades', order }` — the feed deliberately declares none (docblock lines 16–20) precisely so this phase spends the tab.
- `stories`: `home: [{ order: 5 }]` (above the feed's `10`), **no `nav`** (D-80).
- Neither module has `jobs` in this phase; omit the key rather than passing `[]`.

---

### `packages/modules/{communities,stories}/server/routes.ts` (route, request-response)

**Analog:** `packages/modules/feed/server/routes.ts`

**Imports + guard chain** (lines 1–6, 57–74):
```ts
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';

const feed = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const media = result.error.issues
        .map((issue) => issue.message)
        .find((message) => MEDIA_ISSUE_SET.has(message));
      if (media) throw new ApiError(400, 'VALIDATION_FAILED', { media });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

feed.use('*', requireAuth, requireModule('feed'));
```

**Write-route permission pattern** (lines 105–110) — note the **string literal**, not the constant:
```ts
const createPostRoute = createRoute({
  method: 'post',
  path: '/posts',
  // The literal, not `FEED_PERMISSIONS.create`: this string is the one thing a reviewer greps for
  // when asking "what guards publishing?", and an indirection here is the kind that hides a change.
  middleware: [requirePermission('feed.post.create')] as const,
```

**404-for-a-miss contract text** (lines 98–102) — reuse the wording so the D-23 posture stays uniform:
```ts
404: {
  description:
    'No post with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
},
```

**Delta:** the `defaultHook` `details` key becomes `details.story` / `details.community` carrying the new closed vocabulary (`story_comment_no_reply`, `story_comment_not_likeable`) — same mechanism as `FEED_MEDIA_ISSUES`.

---

### `packages/modules/{communities,stories}/server/service.ts` (service, keyset read + idempotent toggle)

**Analog:** `packages/modules/feed/server/service.ts`

**The keyset list, verbatim shape** (lines 245–288) — community list (order by `last_activity_at`) and story strip (order by `expires_at`) both copy this:
```ts
export async function listFeed(ctx: RequestContext, query: FeedQuery): Promise<FeedPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<FeedRow>(sql`
      ${postProjection(ctx.userId)}
       where p.deleted_at is null
         and p.community_id is null
         and (
           ${afterAt}::timestamptz is null
           or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by p.created_at desc, p.id desc
       limit ${limit + 1}`),
  );

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info({ event: 'feed.list', tenantId: ctx.tenantId, userId: ctx.userId,
             requestId: ctx.requestId, limit, returned: page.length,
             hasNext: nextCursor !== null }, 'feed listed');

  return { items: page.map((row) => toPost(row, ctx.userId)), nextCursor };
}
```
The comment on line 254 of this file (`-- Phase 5 widens "community_id is null" to "community_id in (...)"`) is the exact line D-73/D-74 edits.

**Idempotent like toggle** (lines 1004–1032) — copy for `POST /v1/stories/{id}/likes`:
```ts
export async function likePost(ctx: RequestContext, postId: string) {
  const { likeCount, authorUserId } = await withTenantTx(ctx, async (tx) => {
    // The insert SELECTS the post rather than trusting the path parameter.
    await tx.execute(sql`
      insert into feed_likes (tenant_id, user_id, post_id)
      select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, p.id
        from feed_posts p
       where p.id = ${postId}::uuid and p.deleted_at is null
      on conflict (user_id, post_id) where post_id is not null do nothing`);

    const rows = await tx.execute<PostCounterRow>(sql`
      select p.like_count, p.author_user_id
        from feed_posts p
       where p.id = ${postId}::uuid and p.deleted_at is null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return { likeCount: row.like_count, authorUserId: row.author_user_id };
  });

  emit(ctx, 'post.liked', { tenantId: ctx.tenantId, postId,
    postAuthorUserId: authorUserId, actorUserId: ctx.userId });

  return { liked: true, likeCount } satisfies LikeResult;
}
```
**Rules carried by that excerpt:** never 409 on a repeat; `withTenantTx` around every statement; `emit(...)` after the read-back, dispatched post-commit; unlike emits **no** event when nothing was removed (lines 1034–1040).

---

### `packages/modules/{communities,stories}/db/schema.ts` (model, CRUD)

**Analog:** `packages/modules/feed/db/schema.ts`

**Imports + table shell + RLS** (lines 1–16, 51–57, 116–118):
```ts
import { tenantIsolationPolicy } from '@rede-social/core/db/rls';
import { mediaAssets, tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, smallint, text,
         timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const feedPosts = pgTable('feed_posts', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  /* … */
}, (t) => [
  /* indexes + checks */
  tenantIsolationPolicy('feed_posts_tenant_isolation'),
]).enableRLS();
```

**DESC keyset index idiom — copy `.desc().nullsFirst()` exactly** (lines 90–108):
```ts
// `.nullsFirst()` is NOT decoration (caught by `090-feed.sql`'s EXPLAIN assertion): drizzle's
// `.desc()` alone emits `DESC NULLS LAST`, while SQL's `order by x desc` means `desc NULLS FIRST`.
index('feed_posts_tenant_community_created_idx').on(
  t.tenantId, t.communityId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst(),
),
index('feed_posts_tenant_created_idx')
  .on(t.tenantId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
  .where(sql`community_id is null`),
```

**Composite-FK-as-a-rule idiom** (lines 272–289) — the template for the STORY-05 `target_kind` machinery:
```ts
unique('feed_comments_id_depth_uq').on(t.id, t.depth),
foreignKey({
  columns: [t.parentId, t.parentDepth],
  foreignColumns: [t.id, t.depth],
  name: 'feed_comments_parent_fk',
}).onDelete('cascade'),
check(
  'feed_comments_parent_shape_chk',
  sql`(parent_id is null and parent_depth is null and depth = 0)
   or (parent_id is not null and parent_depth = 0 and depth = 1)`,
),
check('feed_comments_target_chk', sql`num_nonnulls(post_id, story_id) = 1`),
```

**Nullable-typed-target + partial-unique idiom** (lines 340–356) — for `story_id` FK wiring and any new like target:
```ts
check('feed_likes_target_chk', sql`num_nonnulls(post_id, comment_id, story_id) = 1`),
// One per target, PARTIAL: a NULL target column would otherwise make every row distinct.
uniqueIndex('feed_likes_post_uq').on(t.userId, t.postId).where(sql`post_id is not null`),
uniqueIndex('feed_likes_story_uq').on(t.userId, t.storyId).where(sql`story_id is not null`),
```

**Docblock convention:** the feed schema opens with a numbered "FOUR THINGS A REVIEWER MUST NOT 'FIX'" block (lines 18–50). `communities.status`, `stories.expires_at` (not generated — see RESEARCH §Pattern 5), `community_members` born unused, and the trigger-owned counters each need the same treatment.

---

### `supabase/migrations/<ts>_communities_stories_rules.sql` (migration, `--custom`)

**Analog:** `supabase/migrations/20260922162449_feed_counters.sql`

**Header convention** (lines 1–27) — the generated/custom split is stated explicitly, then every non-obvious choice is defended:
```sql
-- feed_counters — the interaction layer's TRIGGERS, i.e. everything about `feed_comments` and
-- `feed_likes` that drizzle-kit cannot model. Its companion `20260922162440_feed_interactions.sql`
-- is the GENERATED half … so nothing was moved out of it and `pnpm db:generate` stays a no-op.
```

**Trigger function posture — copy verbatim** (lines 33–54):
```sql
create or replace function app.feed_like_count() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.post_id is not null then
      update public.feed_posts set like_count = like_count + 1 where id = new.post_id;
    elsif new.comment_id is not null then
      update public.feed_comments set like_count = like_count + 1 where id = new.comment_id;
    end if;
  elsif tg_op = 'DELETE' then
    -- There is deliberately no `greatest(0, …)` clamp: a clamp would hide drift instead
    -- of letting the pgTAP reconciliation assertion surface it.
    if old.post_id is not null then
      update public.feed_posts set like_count = like_count - 1 where id = old.post_id;
    elsif old.comment_id is not null then
      update public.feed_comments set like_count = like_count - 1 where id = old.comment_id;
    end if;
  end if;
  return null;
end
$$;--> statement-breakpoint
```
**Rules this carries into Phase 5:** `language plpgsql set search_path = ''`; fully-qualified names; **not** `security definer` (lines 21–27 give the reason); soft delete is an `after update of deleted_at` branch, never a DELETE (lines 56–58); `--> statement-breakpoint` between statements.

**Delta:** line 29–32 explicitly reserves the Phase 5 branch — "`story_id` is the Phase 5 slot: a story like matches neither branch today". Phase 5 adds that branch plus the `communities.post_count` / `last_activity_at` function on `feed_posts`.

---

### `supabase/tests/110-communities-stories.sql` (test, pgTAP)

**Analog:** `supabase/tests/090-feed.sql`

**File shell + fixture helpers** (lines 1–41):
```sql
begin;
-- 090-feed.sql — the ROADMAP's named Phase 4 acceptance checks, executed inside Postgres (04-03).
-- … The three POSITIVE controls ship in the same block — so a globally broken insert cannot make
-- the negatives pass vacuously.
-- … Like its siblings, this file rolls back, so it re-runs identically against a seeded or an
-- empty database, twice in a row, in any order.
select plan(35);

select tests.tenant('pgtap-feed', 'Comunidade Feed', '0c000000-0000-4000-8000-000000000001');
select tests.auth_user('feed@c.local', '0c000000-0000-4000-8000-000000000002');
select tests.member('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002');
```

**Negative-with-positive-control pairing** (lines 43–60):
```sql
select lives_ok(
  $$ insert into public.feed_comments (…) values (…, 'reply', 1, '…b1', 0) $$,
  'positive control: ONE reply level (depth 1, parent_depth 0) is accepted'
);
select throws_ok( $$ … $$, /* sqlstate */ , /* message */ );
```

**EXPLAIN-assertion convention:** the file builds and `analyze`s its own 250-row fixture *inside the transaction* (lines 23–28) because a 3-row table always plans a seq scan. Phase 5 adds a fourth plan assertion for the merged feed index and one for the strip's `expires_at` index the same way.

---

### `apps/web/lib/{communities,stories}.ts` (service, request-response)

**Analog:** `apps/web/lib/feed.ts`

**Error decoding + fetch + parse** (lines 32–66):
```ts
/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; details?: Record<string, unknown> } };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch { /* generic code */ }
  return new ApiClientError(res.status, code, details);
}

export async function getFeed(query: FeedQueryInput = {}): Promise<FeedPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? FEED_PAGE_SIZE));

  const res = await apiFetch(`/v1/feed?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return feedPageSchema.parse(await res.json());
}
```
**Rule (lines 22–30):** ONE fetch implementation per resource, shared by the RSC page and the load-more server action — the page and its pagination can never disagree about page size. `loadX()` (line 79) is the nullable wrapper that degrades to an error card instead of taking the page down.

---

### `apps/web/app/(app)/{comunidades,stories}/*/actions.ts` (service, server actions)

**Analog:** `apps/web/app/(app)/criar/actions.ts` (whole file, 53 lines) and `apps/web/app/(app)/inicio/feed-actions.ts` lines 39–90

**The three rules, stated in the analog's docblock** (feed-actions.ts lines 39–54):
```
1. The SAME Zod the API validates with runs BEFORE the request (a server action is a public endpoint).
2. A refusal is a catalog KEY, never pt-BR copy — the client translates.
3. `redirect()` is called OUTSIDE the try/catch. It throws in Next 16; a catch would swallow it.
```

**Action body** (criar/actions.ts lines 34–53):
```ts
export async function createPostAction(input: unknown): Promise<PostWriteResult> {
  const body = createPostSchema.safeParse(input);
  if (!body.success) {
    const media = body.error.issues.map((issue) => asMediaIssue(issue.message)).find(Boolean);
    if (media) return { ok: false, code: media };
    const empty = body.error.issues.some((issue) => issue.message === 'empty_post');
    return { ok: false, code: empty ? 'empty_post' : 'generic' };
  }

  const { result, refusal } = await attemptPostWrite(() => createPost(body.data));
  if (result.ok) {
    revalidatePath('/inicio');
    revalidatePath(`/post/${result.postId}`);
  }

  if (refusal) redirect(refusal);
  return result;
}
```

**Known trap to copy (lines 27–32):** a `'use server'` module cannot re-export (`export { x } from '…'`) — Turbopack drops it and the build fails with "The module has no exports at all". Import the action from its defining file instead.

---

### `apps/web/app/(app)/comunidades/page.tsx` + `CommunitiesList.tsx` (route + client list, keyset paging)

**Analogs:** `apps/web/app/(app)/membros/page.tsx` (whole file) and `apps/web/app/(app)/membros/MembersList.tsx` lines 60–150

**Server page shell** (membros/page.tsx lines 50–73):
```tsx
return (
  <div className="mx-auto flex w-full max-w-[680px] flex-col">
    {/* `stickyTop="0px"` pins the header at the TOP of the scroll container's padding box …
        the primitive's default pushes the header ~60px DOWN over whatever follows it. */}
    <PageHeader title={t('title')} backHref="/perfil" backLabel={t('back')}
                stickyTop="0px" className="md:static md:px-0" />
    <MembersList q={q} initialItems={page?.items ?? []}
                 initialCursor={page?.nextCursor ?? null} initialError={page === null} />
  </div>
);
```
(The `stickyTop="0px"` note is 03-05's trap, restated in CONTEXT's Reusable Assets.)

**Append-never-replace paging** (MembersList.tsx lines 110–130):
```tsx
const loadMore = () => {
  if (!cursor) return;
  const from = cursor;
  startLoadMore(async () => {
    try {
      const page = await loadMoreMembersAction(from, q || undefined);
      if (!page.ok) { setFailed(true); return; }
      setFailed(false);
      // APPEND: the rows already on screen keep their order and their DOM position.
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      console.error('members.load_more_failed', { error: String(error) });
      setFailed(true);
    }
  });
};
```
**Error state** (lines 158–170) uses `EmptyState variant="card"` + a retry `Button` — D-77's community empty state copies this with the "Criar comunidade" action swapped in.

> **D-76 delta:** the member directory uses an explicit "Carregar mais" button. The community list must use `InfiniteScroll` from `@rede-social/ui` (`packages/ui/src/layout/InfiniteScroll.tsx` + `hooks/useInfiniteScroll.ts`, whose observer root comes from `packages/ui/src/layout/ScrollContainerContext.tsx`) — see `packages/modules/feed/ui/FeedList.tsx` for the shipped sentinel usage. The *state machine* above (append, cursor, failed, retry) is what to copy.

---

### `packages/modules/feed/ui/PostHeader.tsx` (D-71 "em {Comunidade}" row)

**Analog:** itself — extend, do not fork.

**Current second row** (lines 52–66) — the `<time>` line is where the community label joins:
```tsx
<div className="min-w-0">
  <a href={profileHref}
     className="block truncate text-sm font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
    {displayName}
  </a>
  <time dateTime={createdAtIso} title={createdAtAbsolute}
        className="block truncate text-xs font-normal text-text-tertiary">
    {createdAtRelative}
  </time>
</div>
```
**Rules the new prop must respect (docblock lines 4–18):** no clock call in render (strings are formatted on the server); a plain `<a>`, never `next/link` (a module must not depend on the framework, MOD-02); the href is **built by the host** and passed in (`communityHref`), never assembled inside the module; the module ships no words — the "em {…}" template is a host label.

---

### `packages/modules/stories/ui/StoryViewer.tsx` + `CommentSheet` reuse (D-82)

**Analogs:** `packages/modules/feed/ui/CommentSheet.tsx` (whole file) and `packages/modules/feed/ui/CommentsList.tsx` lines 10–68

**Container-is-nothing-but-a-container** (CommentSheet.tsx lines 33–39):
```tsx
export function CommentSheet({ open, onClose, title, ...list }: CommentSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <CommentsList {...list} variant="sheet" />
    </BottomSheet>
  );
}
```
Its docblock (lines 6–24) is the D-82 brief already written: "two surfaces, one implementation… If this component ever grows a conditional about what a comment looks like, the drift the decision exists to prevent has started." The story's flat list is therefore a **new value on the existing prop**, not a new component.

**Outcome types to extend** (CommentsList.tsx lines 50–68) — the STORY-05 refusal joins this union rather than inventing a parallel one:
```ts
export type CommentCreateOutcome =
  | { ok: true; comment: CommentView }
  | { ok: false; code?: 'generic' | 'reply_depth_exceeded' };
```
→ becomes `… | 'story_comment_no_reply'`, with `replyDepthErrorLabel`'s sibling label added to `CommentsListLabels` (lines 78–110).

---

### `packages/modules/stories/ui/StoryComposer.tsx` (component, file-I/O)

**Analog:** `apps/web/components/media/useSignedUpload.ts` + `apps/web/components/media/VideoUploadField.tsx`

**Hook surface** (useSignedUpload.ts lines 18–22, 74–90):
```ts
export type SignedUploadState = 'idle' | 'preparing' | 'progress' | 'processing' | 'done' | 'error';
export interface UseSignedUploadOptions { kind: MediaKind; purpose: MediaPurpose; /* … */ }

export function useSignedUpload({ kind, purpose, … }) {
  const limit = MEDIA_LIMITS[kind][purpose];
  // … classifyMediaFile(file, kind, purpose) before any network call
}
```
**Delta for STORY-01:** pass `purpose: 'story'` — `MEDIA_LIMITS.image.story` and `MEDIA_LIMITS.video.story.maxDurationSeconds = 60` already exist (RESEARCH §Pattern 8), so no media plumbing is added. The Mux branch that skips `complete` and the `processing` state are already in this hook.

---

### `apps/web/lib/registry.tsx` + `apps/api/src/modules/registry.ts` (config)

**API side** (registry.ts lines 15–40):
```ts
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {
  feed: feedModule,
};

for (const manifest of Object.values(MODULE_REGISTRY)) {
  for (const subscription of manifest?.events ?? []) subscribe(subscription.event, subscription.handler);
  registerJobQueues((manifest?.jobs ?? []).map((job) => job.name));
}
```
Adding a module is **one line** in that object; the loop does the rest. Per-module settings-derived permissions go in `permissionsFor` (lines 99–105) following the `feedSettingsSchema.safeParse(...)` fail-safe pattern — `safeParse` on purpose so a malformed blob falls back to the *safe* default and never throws on a request path.

**Web side** (registry.tsx lines 96–120):
```ts
export type HomeSlotRenderer = (ctx: { bootstrap: Bootstrap }) => Promise<ReactNode>;
interface WebModule { home: HomeSlotRenderer[]; }

const feedHome: HomeSlotRenderer = async ({ bootstrap }) => { /* loads data, chooses labels */ };
```
**Rule (lines 27–42):** every decision — which data, which label, which server action, which route — is made *here on the server*; a client shell (`components/feed/FeedSurface.tsx`) exists only because two handlers need `useToast`. `StoriesSurface.tsx` copies that shell exactly.

---

## Shared Patterns

### Tenant scoping — three layers, no exceptions
**Source:** `packages/modules/feed/server/service.ts` (`withTenantTx(ctx, (tx) => …)`, every function) + `tenantIsolationPolicy(...)` in `packages/modules/feed/db/schema.ts:116,301,354`
**Apply to:** every new service function, every new table.
`withAdminTx` is Biome-confined to `server/{tenancy,platform,media}` and is unavailable to `packages/modules/**`.

### Write guards are permissions, never roles
**Source:** `packages/modules/feed/server/routes.ts:105-110`, `apps/api/src/modules/registry.ts:87-108`
**Apply to:** `communities.community.manage`, `stories.story.publish`, `stories.story.pin`.
```ts
middleware: [requirePermission('feed.post.create')] as const,
```

### Keyset cursor — one envelope, never a second
**Source:** `packages/core/server/paging.ts:28-59`
**Apply to:** community list, story strip, admin story history, story comments.
```ts
export const CURSOR_VERSION = 1;
export function encodeCursor({ n, id }: KeysetCursor): string { … }
export function decodeCursor(raw: string | undefined): KeysetCursor | null { … }  // TOTAL — never throws
```
`n` is the row's own ordered value, **read back from the projection**, so it can never disagree with the index.

### Counter columns are trigger-owned
**Source:** `supabase/migrations/20260922162449_feed_counters.sql:16-27,33-54`
**Apply to:** `stories.like_count`, `stories.comment_count`, `communities.post_count`, `communities.last_activity_at`.
No `security definer`, `set search_path = ''`, no `greatest(0, …)` clamp.

### Declarative rules over triggers
**Source:** `packages/modules/feed/db/schema.ts:272-289` (composite self-FK + shape CHECK) and the docblock at 129–140 (gallery-XOR-video)
**Apply to:** STORY-05 (`target_kind` generated column + 3-column and 2-column composite FKs, RESEARCH §Pattern 2).
Rationale to restate in the new docblock: a `before insert` trigger reading the parent row is a read-then-write with no lock; a foreign key is enforced by an index and cannot race.

### DESC keyset indexes
**Source:** `packages/modules/feed/db/schema.ts:90-100`
**Apply to:** every new `order by … desc` index. `.desc().nullsFirst()` — always both.

### Machine-code refusal vocabularies
**Source:** `packages/modules/feed/contracts/index.ts:58-75` (`FEED_MEDIA_ISSUES`) + `routes.ts:55-72` (the `defaultHook` lift)
**Apply to:** the two new STORY-05 codes. One code per rule; `asset_not_usable`'s posture (one code for many causes, no id echoed back — an existence oracle otherwise) applies to community/story 404s too.

### pt-BR catalog, module ships no words
**Source:** `apps/web/messages/pt-BR/feed.json` (nested namespace under a single top key) + `apps/web/lib/registry.tsx:59-94` (the ONE place a surface's labels are chosen)
**Apply to:** `communities.json`, `stories.json`. Enforced by `scripts/check-ui-literals.sh`.

### pgTAP: every negative carries its positive control
**Source:** `supabase/tests/090-feed.sql:1-60`
**Apply to:** all STORY-05, expiry-predicate and pin-survives-expiry cases.

### Package scaffold
**Source:** `packages/modules/feed/package.json`
**Apply to:** both new packages — copy `exports` verbatim (`./module`, `./contracts`, `./server`, `./ui`, `./db`), the three scripts, and the dependency set minus `open-graph-scraper`/`undici`.

---

## Design References (NOT code analogs)

`reference/frontend-design/` is **gitignored** and must never be imported from or edited. Per D-66 it
is the *visual* source for four ported surfaces; the planner reads it for layout and gesture model
only, and the resulting components live in the analogs above.

| Prototype file | What it supplies | Port target |
|---|---|---|
| `app/(app)/community/page.tsx` | `card-magazine` cover card, 16/7 cover, gradient, overlaid name/tagline, chevron | `packages/modules/communities/ui/CommunityCard.tsx` (drop activity badge + member count, D-75) |
| `app/(app)/community/[communityId]/page.tsx` | cover header, "Destaques" `w-16 h-16 rounded-full border-2` circle row | `CommunityHeader.tsx` + `HighlightsRow.tsx` (drop owner block, D-67) |
| `app/(app)/reels/page.tsx` | pointer pager, dominant-axis lock, 60 px threshold, `translateY(-i*100%)`, rubber-band `dy*0.35`, side progress ticks, pre-mounted neighbours, mute toggle | `packages/modules/stories/ui/StoryViewer.tsx` (axis flipped) |
| `lib/constants.ts` | `STORY_DURATION_MS = 5000`, `STORY_EXPIRY_HOURS = 24` | story contracts |

Also note RESEARCH §Pitfall 12: the prototype's imports do not exist in this tree — every port is a
rewrite against `@rede-social/ui` primitives.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/modules/stories/ui/StoryViewer.tsx` | component | event-driven (rAF clock + pointer pager) | No timed auto-advancing full-screen pager exists in the tree. Nearest shipped behaviours: `packages/ui/src/overlays/BottomSheet.tsx` (drag-dismiss + focus trap), `packages/modules/feed/ui/PostMedia.tsx` (carousel + swipe), `packages/ui/src/overlays/DoubleTapHeart.tsx`. Gesture model comes from the prototype's reels pager; the rAF clock shape is in RESEARCH §Code Examples 6. **D-33 gate applies.** |
| `packages/modules/stories/ui/StoriesStrip.tsx` | component | presentational | No horizontal circle strip exists. Closest prop-driven list is `FeedList.tsx`; `Avatar` supplies the circle. **D-33 gate applies.** |

Three more surfaces are prototype-less but *do* have code analogs: the community create/edit form
(`apps/web/app/(app)/perfil/editar/EditProfileForm.tsx`), the story publish screen
(`apps/web/app/(app)/criar/ComposerForm.tsx`), and the pin flow (`apps/web/app/(app)/membros/MembersList.tsx`
list + `packages/ui/src/overlays/ConfirmDialog.tsx`). They still need the D-33 UI-SPEC + mockup
review before being coded — the analog governs *structure*, not *design*.

---

## Metadata

**Analog search scope:** `packages/modules/feed/**`, `packages/ui/src/**`, `packages/core/server/**`,
`packages/contracts/src/**`, `apps/web/app/(app)/**`, `apps/web/lib/**`, `apps/web/components/**`,
`apps/api/src/modules/**`, `supabase/migrations/**`, `supabase/tests/**`
**Files scanned:** ~120 tracked files listed; 18 read in full or in targeted ranges
**Tracked-source check:** every analog path confirmed present in `git ls-files`; `reference/**` flagged as gitignored and quarantined to the Design References section
**Pattern extraction date:** 2026-09-23
