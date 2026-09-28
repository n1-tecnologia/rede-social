# Phase 4: Feed - Pattern Map

**Mapped:** 2026-09-22
**Files analyzed:** 31 new/modified files
**Analogs found:** 29 / 31 (2 with no in-repo analog)

> **Tracked-source note.** Every analog path below is git-tracked (`git ls-files` verified this session).
> `reference/frontend-design/**` is **gitignored** (`.gitignore:2 → reference/`). The design prototype's
> `components/feed/*` and `components/comments/*` are a **visual** source of truth only — they are NOT a
> tracked code analog, must never be cited as "copy this file", and nothing in the build may import them.
> Where this document says "port the prototype's X", the **code** pattern to copy is the tracked analog named
> alongside it.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/modules/feed/package.json` | config | — | `packages/modules/example/package.json` | exact |
| `packages/modules/feed/module.ts` | config (manifest) | event-driven | `packages/modules/example/module.ts` | exact |
| `packages/modules/feed/contracts/index.ts` | contract | request-response | `packages/modules/example/contracts/index.ts` + `packages/contracts/src/media.ts` (query/page-size shape) | exact |
| `packages/modules/feed/db/schema.ts` (`feed_posts`) | model | CRUD | `packages/core/db/schema/media-assets.ts` (checks + partial unique + policy) | exact |
| `packages/modules/feed/db/schema.ts` (`feed_comments`, depth FK) | model | CRUD | `packages/core/db/schema/media-assets.ts` (shape) — composite self-FK has **no analog** | partial |
| `packages/modules/feed/db/schema.ts` (`feed_likes`) | model | CRUD | `packages/core/db/schema/media-assets.ts` `uniqueIndex().where()` | role-match |
| `packages/modules/feed/server/index.ts` | barrel | — | `packages/modules/example/server/index.ts` | exact |
| `packages/modules/feed/server/routes.ts` | controller | request-response | `packages/modules/example/server/routes.ts` | exact |
| `packages/modules/feed/server/service.ts` (lists) | service | CRUD + keyset | `packages/core/server/media/service.ts` `listAssets` (L787-839) | exact |
| `packages/modules/feed/server/service.ts` (writes/events) | service | CRUD + event-driven | `packages/modules/example/server/service.ts` `createItem`/`getItem` | exact |
| `packages/modules/feed/server/jobs.ts` | job def | batch | `packages/modules/example/server/jobs.ts` | exact |
| `packages/modules/feed/server/unfurl/job.ts` | worker handler | file-I/O (outbound HTTP) | `packages/modules/example/server/jobs.ts` (shape) | role-match |
| `packages/modules/feed/server/unfurl/guard.ts` | utility (pure) | transform | `packages/core/server/paging.ts` (PURE-module posture) | role-match |
| `packages/modules/feed/ui/PostCard.tsx` + family | component | presentational | `packages/modules/example/ui/ExampleWidget.tsx` (props-only posture) | exact |
| `packages/modules/feed/ui/FeedList.tsx` (home-slot widget) | component | request-response | `apps/web/app/(app)/membros/MembersList.tsx` (client list + load-more) | exact |
| `packages/ui/src/layout/InfiniteScroll.tsx` | component | event-driven | `packages/ui/src/layout/PullToRefresh.tsx` + `ScrollContainerContext.tsx` | role-match |
| `packages/ui/src/hooks/useInfiniteScroll.ts` | hook | event-driven | `packages/ui/src/hooks/usePullToRefresh.ts` | exact |
| `apps/web/lib/feed.ts` | service (BFF fetch) | request-response | `apps/web/lib/profile.ts` `getMembers`/`loadMembers`/`loadMemberProfile` | exact |
| `apps/web/app/(app)/inicio/feed-actions.ts` (load-more) | server action | request-response | `apps/web/app/(app)/membros/actions.ts` | exact |
| `apps/web/app/(app)/post/[postId]/page.tsx` | route (page) | request-response | `apps/web/app/(app)/membros/[membershipId]/page.tsx` | exact |
| `apps/web/app/(app)/post/[postId]/not-found.tsx`, `loading.tsx` | route | — | `apps/web/app/(app)/membros/[membershipId]/{not-found,loading}.tsx` | exact |
| `apps/web/app/(app)/criar/page.tsx` (composer) | route (page + form) | file-I/O + CRUD | `apps/web/components/media/{AvatarUploadField,VideoUploadField,useSignedUpload}.tsx` | role-match |
| `apps/web/app/(app)/post/[postId]/editar/page.tsx` | route (page) | CRUD | same as `/criar` (one shared form component) | role-match |
| `apps/web/lib/registry.tsx` (modified) | config | — | itself, L41-61 (`exampleHome` → replace with `feedHome`) | exact |
| `apps/web/messages/pt-BR/feed.json` | config (i18n) | — | `apps/web/messages/pt-BR/members.json` | exact |
| `apps/api/src/modules/registry.ts` (modified `permissionsFor`) | config | — | itself, L75-83 | exact |
| `supabase/migrations/*_feed.sql` (generated) | migration | — | prior generated migrations in `supabase/migrations/` | exact |
| `supabase/migrations/*_feed_constraints.sql` (custom: triggers, depth FK, partial uniques) | migration | — | `supabase/migrations/20260921190227_member_profiles_search.sql` | exact |
| `supabase/tests/0xx-feed.sql` | test (pgTAP) | — | `supabase/tests/020-tenant-isolation.sql` | exact |
| `supabase/tests/020-tenant-isolation.sql`, `030-lanes.sql` (modified) | test | — | themselves (substitute `feed_*` for `example_items`) | exact |
| `apps/api/tests/integration/feed*.test.ts` | test | — | `apps/api/tests/integration/example.test.ts` | exact |
| `apps/web/e2e/feed*.spec.ts` | test (e2e) | — | `apps/web/e2e/members.spec.ts`, `phase3-smoke.spec.ts` | exact |

---

## Pattern Assignments

### `packages/modules/feed/package.json` (config)

**Analog:** `packages/modules/example/package.json` (whole file, 38 lines)

Copy the exports map verbatim — the five subpaths are what Biome's boundary lint enforces:

```json
"exports": {
  "./module": "./module.ts",
  "./contracts": "./contracts/index.ts",
  "./server": "./server/index.ts",
  "./ui": "./ui/index.ts",
  "./db": "./db/schema.ts"
},
"scripts": { "typecheck": "tsc --noEmit", "lint": "biome check .", "test": "vitest run --passWithNoTests" },
"dependencies": { "@hono/zod-openapi": "1.6.3", "@rede-social/contracts": "workspace:*", "@rede-social/core": "workspace:*",
  "drizzle-orm": "0.45.2", "hono": "4.13.7", "pino": "10.3.1", "zod": "4.6.2" },
"peerDependencies": { "react": "19.3.0" }
```

Additions for feed: `open-graph-scraper@6.12.0`, `undici@7.29.1` (pinned, per RESEARCH package audit), and a real `test` script (drop `--passWithNoTests`) plus `vitest.config.ts`. Also copy `turbo.json` and `tsconfig.json` from the example package.

---

### `packages/modules/feed/module.ts` (config, manifest)

**Analog:** `packages/modules/example/module.ts` (lines 1-32, whole file)

```ts
import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { exampleProcessJob } from './server/jobs';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-example');

export const exampleModule = defineModule({
  key: 'example',
  nav: { label: 'Exemplo', icon: 'sparkles', href: '/inicio#exemplo', order: 90 },
  home: [{ order: 90 }],
  routes: () => import('./server/routes').then((m) => m.exampleRoutes),
  jobs: [exampleProcessJob],
  events: [
    { event: 'example.item.created', handler: async (payload) => { log.info({ event: 'example.item.created', ...payload }, 'example item created'); } },
  ],
  defaultRolePermissions: { admin_tenant: ['example.create'] },
});
```

**Deltas for feed (D-55):** **omit the `nav` key entirely** — the feed is a home slot only; keep `home: [{ order: 10 }]`; `routes` stays a lazy import (the worker reads `jobs` without building the router); `defaultRolePermissions: { admin_tenant: ['feed.post.create', 'feed.post.manage'] }`.

---

### `packages/modules/feed/contracts/index.ts` (contract, request-response)

**Analog A — declaration merging + queue consts:** `packages/modules/example/contracts/index.ts` (lines 27-52)

```ts
/** Payload of the module's single domain event, published for any consumer (MOD-03). */
export interface ExampleItemCreated { tenantId: string; itemId: string; userId: string; }

/** The pg-boss queue this module owns. One name, exported so the registry and tests never retype it. */
export const EXAMPLE_PROCESS_QUEUE = 'example.process';

/** `tenantId` is data, not authority: the handler re-enters the tenant lane with it and RLS decides (T-07-03). */
export interface ExampleProcessJob { tenantId: string; itemId: string; }

declare module '@rede-social/contracts' {
  interface EventMap {
    'example.item.created': ExampleItemCreated;
  }
}
```

**Analog B — the keyset query/page-size shape:** `packages/contracts/src/media.ts` lines 235-248

```ts
export const mediaListQuerySchema = z
  .object({
    kind: z.enum(MEDIA_KINDS).optional(),
    purpose: z.enum(MEDIA_PURPOSES).optional(),
    cursor: z.string().max(MEDIA_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(MEDIA_LIST_MAX_PAGE_SIZE).default(MEDIA_LIST_PAGE_SIZE),
  })
  .strict();
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
```

Copy the `.strict()` + `z.coerce…default(PAGE_SIZE)` + capped-cursor-string shape for `feedQuerySchema`, `commentsQuerySchema`, `repliesQuerySchema`, and export the `FEED_PAGE_SIZE` / `FEED_MAX_PAGE_SIZE` constant pairs beside them (`packages/contracts/src/media.ts:221-222` and `packages/contracts/src/profiles.ts:198-199` are the two existing pairs).

---

### `packages/modules/feed/db/schema.ts` (model, CRUD)

**Analog A — the module table checklist:** `packages/modules/example/db/schema.ts` (lines 1-40, whole file)

```ts
import { tenantIsolationPolicy } from '@rede-social/core/db/rls';
import { tenants, users } from '@rede-social/core/db/schema';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const exampleItems = pgTable(
  'example_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('example_items_tenant_created_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    tenantIsolationPolicy('example_items_tenant_isolation'),
  ],
).enableRLS();
```

Note the tie-breaker in the index (`createdAt.desc(), id.desc()`) — the feed's index is the same shape with `community_id` inserted: `(tenantId, communityId, createdAt.desc(), id.desc())`.
FEED-08's generic column is `authorUserId` here, replacing `createdByUserId`.

**Analog B — CHECK constraints, partial unique indexes, extra policies:** `packages/core/db/schema/media-assets.ts` lines 73-99

```ts
  (t) => [
    index('media_assets_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
    index('media_assets_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    uniqueIndex('media_assets_provider_asset_uq')
      .on(t.provider, t.providerAssetId)
      .where(sql`provider_asset_id is not null`),
    check('media_assets_kind_chk', sql`${t.kind} in ('image','video','file')`),
    check('media_assets_status_chk', sql`${t.status} in ('pending','processing','ready','failed','rejected','deleted')`),
    pgPolicy('media_assets_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and deleted_at is null`,
    }),
  ],
).enableRLS();
```

- `uniqueIndex(...).where(sql\`… is not null\`)` is exactly the `feed_likes` partial-unique idiom (one per target: post / comment / story).
- `check('…_chk', sql\`…\`)` is the idiom for `num_nonnulls(post_id, comment_id, story_id) = 1`, the `media_kind in ('none','gallery','video')` discriminator (D-53) and the `feed_comments_parent_shape_chk`.
- Note this table adds an *extra* `select` policy with `deleted_at is null`; for feed, PITFALL 6 in RESEARCH says the opposite — keep `deleted_at` out of the policy and filter in the read queries, so Phase 8 moderation can see removed rows.
- `deletedAt`/`readyAt` nullable timestamps show the soft-delete column convention; `feed_posts` adds `editedAt` alongside.

**No analog:** the composite self-referencing FK `(parent_id, parent_depth) → (id, depth)` + `unique (id, depth)`. Nothing in the tree uses `foreignKey({ columns, foreignColumns, name })`. Use the RESEARCH Pattern 4 block verbatim, and if `pnpm db:generate` will not emit it, fall back to the custom-migration precedent below.

---

### `packages/modules/feed/server/routes.ts` (controller, request-response)

**Analog:** `packages/modules/example/server/routes.ts` (lines 1-83, whole file)

**Imports + `defaultHook`** (lines 1-29):
```ts
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requireRole } from '@rede-social/core/server/rbac/require-role';

const example = new OpenAPIHono<AppEnv>({
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
```

**Guard chain** (line 31) — the ROLE-06 order, owned by the module so the mount cannot forget it:
```ts
example.use('*', requireAuth, requireModule('example'));
```
Feed: `feed.use('*', requireAuth, requireModule('feed'));`

**Per-route write guard** (lines 57-72):
```ts
const createItemRoute = createRoute({
  method: 'post',
  path: '/items',
  // V1: only the tenant's admin writes (ROLE-06). V2 member posting is this line plus a flag.
  middleware: [requireRole('admin_tenant')] as const,
  request: { body: { content: { 'application/json': { schema: createExampleItemSchema } }, required: true } },
  responses: { 201: { … }, 403: { description: 'Members may not create items' } },
});
```
**Delta (FEED-08/Pattern 8):** replace `requireRole('admin_tenant')` with a **permission** guard on `feed.post.create`, so V2 is a settings value change, not a route edit.

**Chained export** (lines 74-83) — keep the single fluent `.openapi(...)` chain; `AppType` inference depends on it:
```ts
export const exampleRoutes = example
  .openapi(listRoute, async (c) => c.json({ items: await listItems(c.get('ctx')) }, 200))
  .openapi(getRoute, async (c) => { const { id } = c.req.valid('param'); return c.json(await getItem(c.get('ctx'), id), 200); });
```

---

### `packages/modules/feed/server/service.ts` (service, CRUD + keyset + events)

**Analog A — keyset list:** `packages/core/server/media/service.ts` `listAssets`, lines 787-839

```ts
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.select(ASSET_COLUMNS).from(mediaAssets)
      .where(and(
        // The tenant predicate is RLS, never the cursor (T-03-52): a tampered envelope can only
        // move the page boundary inside what this lane may already read.
        afterAt
          ? sql`(${mediaAssets.createdAt}, ${mediaAssets.id}) < (${afterAt}::timestamptz, ${afterId}::uuid)`
          : undefined,
      ))
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists.
      .limit(limit + 1),
  );

  const page = (rows as AssetRow[]).slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.createdAt.toISOString(), id: last.id }) : null;

  log.info({ event: 'media.list', tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId,
             limit, returned: page.length, hasNext: nextCursor !== null }, 'media assets listed');
  return { items: page.map(assetView), nextCursor };
```

Copy verbatim for the feed list and the two comment lists (replies invert to `>` / `asc()`). Copy the **log line shape too**: `{ event, tenantId, userId, requestId, limit, returned, hasNext }` — counts and shapes, never caption or comment text (V7, T-03-24).

**Analog B — cursor envelope (do not re-implement):** `packages/core/server/paging.ts` lines 28-59
```ts
export const CURSOR_VERSION = 1;
const cursorSchema = z.object({ v: z.literal(CURSOR_VERSION), n: z.string(), id: z.uuid() });
export type KeysetCursor = { n: string; id: string };
export function encodeCursor({ n, id }: KeysetCursor): string { … }
export function decodeCursor(raw: string | undefined): KeysetCursor | null { … }  // TOTAL: bad cursor → null → page 1
```

**Analog C — 404 posture (FEED-07 cross-tenant):** `packages/modules/example/server/service.ts` lines 41-53
```ts
/**
 * T-07-02: there is ONE code path for "does not exist" and "belongs to another tenant" — RLS hides
 * the foreign row, the query returns nothing, and the caller gets 404 `NOT_FOUND`. Nothing here
 * compares tenant ids …
 */
export async function getItem(ctx: RequestContext, id: string): Promise<ExampleItem> {
  const [row] = await withTenantTx(ctx, (tx) =>
    tx.select().from(exampleItems).where(eq(exampleItems.id, id)).limit(1));
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toItem(row);
}
```
Bare `404 NOT_FOUND` with **no `details`** — a details key would reintroduce an existence oracle.

**Analog D — write + transactional enqueue + after-commit event:** same file, lines 67-98
```ts
export async function createItem(ctx: RequestContext, input: CreateExampleItem): Promise<ExampleItem> {
  const row = await withTenantTx(ctx, async (tx) => {
    const [inserted] = await tx.insert(exampleItems).values({
      tenantId: ctx.tenantId,          // from ctx, NEVER from the body (T-07-01)
      title: input.title,
      createdByUserId: ctx.userId,
    }).returning();
    if (!inserted) throw new ApiError(500, 'INTERNAL');

    await enqueueInTx(tx, EXAMPLE_PROCESS_QUEUE,
      { tenantId: ctx.tenantId, itemId: inserted.id },
      { singletonKey: inserted.id });   // retried request is idempotent at the queue (T-07-04)
    return inserted;
  });

  // `emit` runs only after `withTenantTx` RESOLVES, and even then only queues the event.
  emit(ctx, 'example.item.created', { tenantId: ctx.tenantId, itemId: row.id, userId: ctx.userId });
  return toItem(row);
}
```
The unfurl enqueue on `POST /v1/feed/posts` is this block with `FEED_UNFURL_QUEUE` and `singletonKey: previewId`.

**Analog E — the worker re-entering the tenant lane:** same file, lines 100-122
```ts
export async function markProcessed(tenantId: string, itemId: string): Promise<number> {
  const ctx: RequestContext = {
    userId: '00000000-0000-0000-0000-000000000000',   // no human behind the job
    tenantId, role: 'member', requestId: 'job', events: [],
  };
  const updated = await withTenantTx(ctx, (tx) => tx.update(exampleItems)
    .set({ processedAt: new Date() })
    .where(and(eq(exampleItems.id, itemId), eq(exampleItems.tenantId, tenantId)))
    .returning({ id: exampleItems.id }));
  return updated.length;
}
```
The unfurl worker writes its `feed_link_previews` row through exactly this shape.

**Row → contract mapper** (lines 14-23): timestamps cross the wire as `.toISOString()`, never as `Date`.

---

### `packages/modules/feed/server/jobs.ts` + `server/unfurl/job.ts` (job definition, batch)

**Analog:** `packages/modules/example/server/jobs.ts` (lines 1-31, whole file)

```ts
import { moduleLogger } from '@rede-social/core/server/logging';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
const log = moduleLogger('module-example');

export const exampleProcessJob: JobDefinition<ExampleProcessJob> = {
  name: EXAMPLE_PROCESS_QUEUE,
  handler: async (payload) => {
    const updated = await markProcessed(payload.tenantId, payload.itemId);
    log.info({ event: 'example.process.done', tenantId: payload.tenantId, itemId: payload.itemId, updated },
             'example item processed');
  },
};
```
Feed: `feedUnfurlJob: JobDefinition<FeedUnfurlJob>` with `name: FEED_UNFURL_QUEUE`. The kernel creates the queue from the manifest; the module never touches pg-boss.

---

### `packages/modules/feed/server/unfurl/guard.ts` (utility, pure)

**Analog (posture, not content):** `packages/core/server/paging.ts` docblock, lines 11-17

```
 * PURE MODULE: no database, no `env`, no logger — the `branding/upload.ts` posture, so every rule
 * here is unit-testable without a stack.
 *
 * THIS MODULE IS TOTAL: no function here has a failure path that raises. …
 */
```

Copy the posture: URL policy + `net.BlockList` + connector factory in one dependency-free file, unit-tested against local `node:http` fixture servers. The concrete implementation is RESEARCH §Code Examples 1 (no in-repo analog for the undici connector).

---

### `packages/modules/feed/ui/*` (components, presentational)

**Analog:** `packages/modules/example/ui/ExampleWidget.tsx` (lines 1-47)

```tsx
/**
 * - **Presentational only.** It fetches nothing and imports nothing from the kernel — the host page
 *   owns data loading and authorisation.
 * - **Authorisation arrives as a prop.** `canCreate` is computed from `bootstrap.permissions`
 *   server-side; the component never decides who may write, and the API re-checks it anyway.
 * - **Strings arrive as props.** All copy lives in the web app's pt-BR catalog.
 */
export type ExampleWidgetProps = {
  items: ExampleItem[];
  canCreate: boolean;
  createAction?: (formData: FormData) => Promise<void>;
  labels: { title: string; empty: string; add: string; placeholder: string; processed: string };
};
```

Every `PostCard` / `CommentSheet` prop type follows this: data in, `labels: {…}` in, actions in, zero imports from `@rede-social/core/server/*`. `cn` comes from `@rede-social/ui`; animation uses `motion` (already in `@rede-social/ui`), **not** `framer-motion`.

---

### `packages/modules/feed/ui/FeedList.tsx` (component, client list + pagination)

**Analog:** `apps/web/app/(app)/membros/MembersList.tsx` (lines 1-130)

**Imports / client boundary** (lines 1-18):
```tsx
'use client';
import { Button, Card, EmptyState, PullToRefresh, SearchBar, Skeleton, useDebounce } from '@rede-social/ui';
import { CircleAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState, useTransition } from 'react';
import { loadMoreMembersAction } from './actions';
```

**Server-seeded props** (lines 20-28):
```tsx
export interface MembersListProps {
  /** The first page the SERVER rendered … the list is seeded from it. */
  initialItems: MemberProfile[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI-SPEC E4/error). */
  initialError?: boolean;
}
```

**Skeleton exported for reuse by `loading.tsx`** (lines 30-51) — copy this split so the feed's first load and its route-level loading state look identical.

**Load-more via server action, cursor opaque** (lines 110-121):
```tsx
const loadMore = () => {
  if (!cursor) return;
  const from = cursor;
  startLoadMore(async () => {
    const page = await loadMoreMembersAction(from, q || undefined);
    if (!page.ok) { setFailed(true); return; }
    setFailed(false);
    …
  });
};
```
**Delta for D-58:** the button becomes an `InfiniteScroll` sentinel calling the same action, plus `PullToRefresh` (already imported in this analog) around the list. Nothing else changes.

---

### `packages/ui/src/layout/InfiniteScroll.tsx` + `hooks/useInfiniteScroll.ts` (kernel primitive)

**Analog:** `packages/ui/src/hooks/usePullToRefresh.ts` (lines 1-45) and `packages/ui/src/layout/ScrollContainerContext.tsx` (lines 1-26)

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScrollContainer } from '../layout/ScrollContainerContext';

export function usePullToRefresh({ onRefresh, threshold = 80, enabled = true }: UsePullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRoot = useScrollContainer();
  …
  const scroller = scrollRoot?.current ?? container;   // ← the root-resolution idiom to copy
```

```ts
/** The scroll root ref, or `null` when rendered outside the shell (the document scrolls). */
export function useScrollContainer(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollContainerContext);
}
```

`useInfiniteScroll` takes its IntersectionObserver `root` from `useScrollContainer()?.current ?? null` — never `document.getElementById('app-scroll')` (the prototype's hardcoded lookup). Mirror the options shape (`{ onLoadMore, enabled, rootMargin }`) and export both from `packages/ui/src/index.ts`.

---

### `apps/web/lib/feed.ts` (BFF fetch, one implementation)

**Analog:** `apps/web/lib/profile.ts` (lines 67-149)

**The one-implementation rule** (lines 70-88):
```ts
/**
 * `GET /v1/members` (03-03) — ONE implementation shared by the `/membros` page and the
 * `loadMoreMembersAction` server action, so the list and its pagination can never disagree …
 * The cursor is passed through untouched (T-03-34).
 */
export async function getMembers(query: MembersQuery = {}): Promise<MemberList> {
  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? MEMBERS_PAGE_SIZE));

  const res = await apiFetch(`/v1/members?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return memberListSchema.parse(await res.json());
}
```

**The `load*` wrapper: redirect OUTSIDE the try/catch** (lines 95-107):
```ts
export async function loadMembers(query: MembersQuery = {}): Promise<MemberList | null> {
  let path: string | null = null;
  let page: MemberList | null = null;
  try { page = await getMembers(query); }
  catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('members.list_failed', { error: String(error) });
  }
  if (path) redirect(path);   // redirect() throws (Next 16) — never inside the catch
  return page;
}
```

**The detail-read result union (the `/post/[id]` 404 collapse)** (lines 109-141):
```ts
export type MemberProfileResult =
  | { status: 'ok'; member: MemberProfile }
  | { status: 'not-found' }
  | { status: 'error' };
…
    } else if (res.status === 404 || res.status === 400) {
      result = { status: 'not-found' };   // unknown / other tenant / blocked / soft-deleted: ONE screen
    }
```
`loadPost` copies this exactly — D-56's cross-tenant 404 and a soft-deleted post both land in `not-found`, while transport/5xx stays a distinct `error` screen.

**Also copy** the private `apiError(res)` helper (lines 51-65): reads `error.code` without ever throwing on a non-JSON body.

---

### `apps/web/app/(app)/inicio/feed-actions.ts` (server action)

**Analog:** `apps/web/app/(app)/membros/actions.ts` (lines 1-62, whole file)

```ts
'use server';
…
export type LoadMoreMembersResult =
  | { ok: true; items: MemberProfile[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

export async function loadMoreMembersAction(cursor: string, q?: string): Promise<LoadMoreMembersResult> {
  const query = memberListQuerySchema.safeParse({ cursor, ...(q ? { q } : {}) });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreMembersResult = { ok: false, code: 'generic' };
  try {
    const page = await getMembers({ cursor: query.data.cursor, q: query.data.q, limit: query.data.limit });
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('members.load_more_failed', { error: String(error) });
  }
  if (refusal) redirect(refusal);
  return result;
}
```
Three rules encoded here and required for every feed action (load more, like, comment, delete): the **same Zod the API uses** runs before the request; refusals return a catalog **key**, never pt-BR copy; the fetch goes through `lib/feed.ts`, never a second `apiFetch`.

---

### `apps/web/app/(app)/post/[postId]/page.tsx` (route, request-response)

**Analog:** `apps/web/app/(app)/membros/[membershipId]/page.tsx` (lines 1-60)

```tsx
import { EmptyState, PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

export default async function MemberProfilePage({ params }: { params: Promise<{ membershipId: string }> }) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { membershipId } = await params;               // Next 16: params is async
  const [t, own, result] = await Promise.all([
    getTranslations('members'), loadOwnProfile(), loadMemberProfile(membershipId),
  ]);

  if (result.status === 'not-found') notFound();
  if (result.status === 'error') { /* distinct "Algo deu errado" EmptyState + PageHeader */ }
```
Plus its sibling files `loading.tsx` and `not-found.tsx` — copy both for `/post/[postId]`.
Header idiom from `apps/web/app/(app)/membros/page.tsx` lines 58-64 (sticky back header):
```tsx
<PageHeader title={t('title')} backHref="/perfil" backLabel={t('back')}
            stickyTop="0px" className="md:static md:px-0" />
```
Note the `stickyTop="0px"` comment (lines 52-57) explaining why the default offset double-counts the scrollport padding — the same applies to the post page's sticky back header.

---

### `apps/web/app/(app)/criar/page.tsx` + `/post/[postId]/editar/page.tsx` (composer)

**Analogs:** `apps/web/components/media/AvatarUploadField.tsx`, `VideoUploadField.tsx`, `useSignedUpload.ts`, `MediaImage.tsx`, `VideoPlayer.tsx` (all tracked, Phase 3).

**Image rendering contract** — `apps/web/components/media/MediaImage.tsx` lines 31-56:
```tsx
/**
 * Every private image renders through here (UI-SPEC §Media rendering contract, R-05): an `<img>` over
 * the STABLE `/v1/media/{assetId}/{variant}` endpoint, which 302s to a freshly signed, tenant-checked
 * Storage URL on every fetch. An inline signed Storage URL never reaches a payload or the DOM.
 * … `onError` clears `src`: an expired, deleted or cross-tenant asset degrades to EXACTLY the
 * "no photo" state … A server-rendered image can fail BEFORE React hydrates … the fallback is
 * applied on mount as well.
 */
```
`PostMedia`'s gallery slides are `<MediaImage widths={PURPOSE_WIDTHS.post} sizes={…} ratio={…} />`. The composer's upload layer is `useSignedUpload` + the existing field components — **no new upload code** (D-53 composer rules are validation on top).

**This is a prototype-less screen (D-33/D-57):** the UI-SPEC + mockup gate comes before any code.

---

### `apps/web/lib/registry.tsx` (modified)

**Analog:** itself, lines 30-61 — replace the `example` entry in place.

```tsx
/** The reference module's data, fetched only when the tenant HAS the module (D-19). */
async function getExampleItems() {
  const res = await apiFetch('/v1/example/items');
  if (!res.ok) return [];
  return exampleItemsSchema.parse(await res.json()).items;
}

const exampleHome: HomeSlotRenderer = async ({ bootstrap }) => {
  const [items, te] = await Promise.all([getExampleItems(), getTranslations('example')]);
  return <ExampleWidget items={items}
    canCreate={bootstrap.permissions.includes('example.create')}   // ← FAB visibility idiom
    createAction={createExampleItem}
    labels={{ title: te('title'), … }} />;
};

export const WEB_MODULE_REGISTRY: Partial<Record<ModuleKey, WebModule>> = {
  example: { home: [exampleHome] },
};
```
Feed: `feed: { home: [feedHome] }`, `canPost={bootstrap.permissions.includes('feed.post.create')}` (never a role comparison in the web tier — Pattern 8), data via `lib/feed.ts`. `homeSlotsFor` (lines 78-121) already wraps every renderer in `Promise.allSettled` with a per-slot error card — no change needed.

**Host page:** `apps/web/app/(app)/inicio/page.tsx` lines 80-99 shows where the slot lands relative to the D-02 nudge and the "Em breve" `EmptyState`; the feed slot needs no page edit.

---

### `apps/api/src/modules/registry.ts` (modified)

**Analog:** itself, lines 75-83

```ts
export function permissionsFor(role: TenantRole, enabled: Set<ModuleKey> = new Set()): string[] {
  const permissions = new Set<string>(KERNEL_ROLE_PERMISSIONS[role]);
  for (const key of enabled) {
    for (const permission of MODULE_REGISTRY[key]?.defaultRolePermissions?.[role] ?? []) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}
```
FEED-08 extends this signature with the settings map so `member` gains `feed.post.create` when `tenant_modules['feed'].settings.postingPolicy === 'members'`. One composition point, two readers (route guard + bootstrap permissions).

---

### `supabase/migrations/*_feed_constraints.sql` (custom migration)

**Analog:** `supabase/migrations/20260921190227_member_profiles_search.sql` (lines 1-60)

The header documents *why* a hand-written file exists beside the generated one — copy that discipline for the counter triggers, the composite depth FK (if drizzle-kit will not emit it) and the partial unique indexes:

```sql
-- member_profiles_search — everything about `member_profiles` that drizzle-kit cannot model
--   * `create extension` — drizzle-kit does not emit extensions.
--   * expression indexes … declaring them in the drizzle TS as well as here would make
--     `pnpm db:generate` non-idempotent … so the schema file declares the PLAIN indexes and this
--     file the expression ones, with a comment in each pointing at the other.
```

Trigger + hardening idiom (lines 44-60) for the `like_count` / `comment_count` triggers:
```sql
create or replace function app.ensure_member_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.member_profiles (...) select ... on conflict (membership_id) do nothing;
  return new;
end
$$;--> statement-breakpoint
drop trigger if exists member_profiles_from_membership on public.memberships;--> statement-breakpoint
```
Note `--> statement-breakpoint` after every statement, `set search_path = ''` + fully-qualified names, `drop … if exists` before `create trigger`, and explicit `grant execute … to authenticated, service_role, api_user`. Counter triggers do **not** need `security definer` (they run as the table owner's trigger on the writer's own row) — but they **must** fire on `after insert or delete or update of deleted_at` (RESEARCH Pitfall 5).

---

### `supabase/tests/0xx-feed.sql` and the `020` / `030` substitutions

**Analog:** `supabase/tests/020-tenant-isolation.sql` lines 98-140

```sql
select tests.as_tenant('0a…01', '0a…02');
select is(current_user::text, 'authenticated', 'the lane runs as authenticated, never as the connection role');

select results_eq(
  $$ select count(*)::int from public.example_items where tenant_id = '0a…01' $$,
  ARRAY[1], 'A sees its own example_items row');                       -- ← the POSITIVE control (03-08)
select results_eq(
  $$ select count(*)::int from public.example_items where title = 'x' $$,
  ARRAY[1], 'adjacency: both tenants have an item titled x, the lane returns exactly one');
select is_empty(
  $$ select id from public.example_items where id = '0b…03' $$,
  'detail by id: B''s item is not found through A''s lane');
select throws_ok(
  $$ insert into public.example_items (tenant_id, title, created_by_user_id) values ('0b…01', 'y', '0a…02') $$,
  '42501', null, 'WITH CHECK: A cannot write a row stamped with B''s tenant_id');
select results_eq(
  $$ with u as (update public.example_items set title = 'y' where tenant_id = '0b…01' returning 1)
     select count(*)::int from u $$,
  ARRAY[0], 'USING: an update aimed at B''s rows touches nothing');
```
Five cases per table — positive control, adjacency, detail-by-id miss, WITH CHECK write refusal, USING update no-op. Substitute `feed_posts` / `feed_comments` / `feed_likes` here and in `030-lanes.sql`, **in the same PR that drops `example_items`**, and sequence the feed schema before the example removal (RESEARCH Pitfall 4).

---

### `apps/api/tests/integration/feed.test.ts`

**Analog:** `apps/api/tests/integration/example.test.ts` (lines 1-55)

```ts
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const events: ExampleItemCreated[] = [];
let unsubscribe: () => void = () => {};

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, { ...init, headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'content-type': 'application/json' } : {}), … } });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** Insert straight through the admin connection: a row this tenant's lane must never return. */
async function seedItem(tenantId: string, title: string, createdAt?: string): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`insert into public.example_items (...) returning id`;
  …
}
```
Copy the three-token fixture (demo admin / demo member / lab admin), the `adminSql` cross-tenant seeding helper, the `subscribe`/`unsubscribe` event collector (MOD-03 criterion 4) and the `code(res)` envelope reader. The `pg_stat_statements` budget test uses the same `adminSql` superuser connection.

---

## Shared Patterns

### Three-layer tenant scoping (every service function)
**Source:** `packages/core/db/tenant-tx.ts` (`withTenantTx`), used at `packages/modules/example/server/service.ts:31,48,71,114`
**Apply to:** every read and write in `packages/modules/feed/server/service.ts`
```ts
const rows = await withTenantTx(ctx, (tx) => tx.select()…);
```
The tenant is **never** a parameter and **never** a written predicate; RLS supplies it. `withAdminTx` is Biome-confined to `server/{tenancy,platform,media}` and is unavailable to `packages/modules/**`.

### Module guard chain
**Source:** `packages/modules/example/server/routes.ts:31` + its docblock lines 10-17
**Apply to:** `packages/modules/feed/server/routes.ts`
```ts
feed.use('*', requireAuth, requireModule('feed'));   // 401 → 404 (never 403 for a missing module)
```
Write routes add a per-route `middleware: [...] as const` guard (permission-based for FEED-08).

### Stable machine error codes, no oracle
**Source:** `packages/modules/example/server/routes.ts:20-27` (`VALIDATION_FAILED` + `issues[]`), `service.ts:51` (`throw new ApiError(404, 'NOT_FOUND')` — no `details`)
**Apply to:** all feed routes/services. Every miss (unknown id, foreign tenant, soft-deleted) is the same bare 404.

### Keyset cursor envelope
**Source:** `packages/core/server/paging.ts:40-59`
**Apply to:** feed list, root comments, replies. Import `encodeCursor`/`decodeCursor`; **do not write a second envelope** (the file's own docblock names this phase).

### After-commit domain events
**Source:** `packages/modules/example/server/service.ts:91-95`, `packages/modules/example/contracts/index.ts:48-52`
**Apply to:** every feed write.
```ts
declare module '@rede-social/contracts' { interface EventMap { 'post.published': PostPublished; } }
…
emit(ctx, 'post.published', { … });   // after withTenantTx resolves; the bus flushes after the handler
```

### Log the shape, never the content
**Source:** `packages/core/server/media/service.ts:823-836`
**Apply to:** every feed service function.
```ts
log.info({ event: 'media.list', tenantId, userId, requestId, limit, returned: page.length, hasNext: nextCursor !== null }, 'media assets listed');
```
Post captions and comment bodies must never reach a log line (V7).

### pt-BR strings as props / catalog
**Source:** `packages/modules/example/ui/ExampleWidget.tsx:16-27` (`labels: {…}`), `apps/web/lib/registry.tsx:42-54` (`getTranslations('example')`)
**Apply to:** all `packages/modules/feed/ui/*` and the new `apps/web/messages/pt-BR/feed.json`. `scripts/check-ui-literals.sh` fails the build on a pt-BR literal in JSX.

### Redirect outside the try/catch (Next 16)
**Source:** `apps/web/lib/profile.ts:95-107`, `apps/web/app/(app)/membros/actions.ts:46-61`
**Apply to:** `apps/web/lib/feed.ts` and every feed server action. `redirect()`/`notFound()` throw; a catch would swallow them.

### Private image rendering
**Source:** `apps/web/components/media/MediaImage.tsx:31-60`
**Apply to:** post gallery slides, avatars in `PostHeader`, link-preview and oEmbed thumbnails. Always `/v1/media/{assetId}/{variant}`; never a signed Storage URL in a payload.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/modules/feed/server/unfurl/guard.ts` (undici connector + `net.BlockList`) | utility | outbound HTTP | No outbound-HTTP-to-untrusted-host code exists in the tree. Use RESEARCH §Code Examples 1 verbatim; copy only the *posture* of `packages/core/server/paging.ts` (pure, total, unit-testable without a stack). |
| `feed_comments` composite self-FK `(parent_id, parent_depth) → (id, depth)` | model | CRUD | No `foreignKey({ columns, foreignColumns })` usage anywhere in `packages/**/db/schema*`; no self-referencing table in the tree. Use RESEARCH Pattern 4; fall back to the custom-migration precedent `supabase/migrations/20260921190227_member_profiles_search.sql` if `pnpm db:generate` will not emit it. |

Partially-covered (analog gives shape, not substance):
- `packages/ui/src/layout/InfiniteScroll.tsx` — no IntersectionObserver primitive exists; `usePullToRefresh` supplies the scroll-root resolution idiom only.
- Counter triggers — no counter trigger exists in the tree; `member_profiles_search.sql` supplies the custom-migration/trigger authoring conventions only.

## Metadata

**Analog search scope:** `packages/modules/**`, `packages/core/{db,server,ui}/**`, `packages/ui/src/**`, `packages/contracts/src/**`, `apps/web/{app/(app),lib,components}/**`, `apps/api/{src,tests}/**`, `supabase/{migrations,tests}/**`
**Files scanned:** ~40 read or grepped; 18 read in full or in targeted ranges
**Tracked-source verification:** `git ls-files` run on every analog path; `reference/**` confirmed gitignored and excluded as a code analog
**Pattern extraction date:** 2026-09-22
