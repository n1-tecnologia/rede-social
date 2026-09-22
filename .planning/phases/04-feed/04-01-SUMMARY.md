---
phase: 04-feed
plan: 01
subsystem: feed
tags: [feed, module, drizzle, rls, keyset-pagination, domain-events, rbac, home-slot, hono, zod]

requires:
  - phase: 01-foundation
    provides: the module manifest contract, the tenant lane (`withTenantTx`), the event bus, `tenant_modules` flags + settings, and `@tria/module-example` as the worked template
  - phase: 02-tenant-shell-branding-platform-panel
    provides: the D-42 home-slot mechanism (`homeSlotsFor`, `HomeSlots` on `/inicio`), the web module registry and the pt-BR catalog loader
  - phase: 03-media-pipeline-member-profiles
    provides: `member_profiles` (display name + `avatar_asset_id`), `avatarUrlFor`, the ONE keyset cursor envelope in `packages/core/server/paging.ts`, and the `lib/profile.ts` web-fetch posture
provides:
  - "`@tria/module-feed` — the first REAL feature module, with the same five-subpath exports map as the throwaway example"
  - "`public.feed_posts` under RLS: generic `author_user_id`, reserved `community_id`, soft delete, `edited_at`, trigger-owned counters"
  - "`GET /v1/feed` — one keyset page over the kernel cursor envelope, ONE statement per page"
  - "`GET /v1/feed/posts/{postId}` — one bare 404 for unknown / foreign-tenant / removed"
  - "`POST /v1/feed/posts` — guarded by the composed `feed.post.create` permission, never by a role"
  - "`packages/core/server/rbac/permissions.ts` — the kernel RBAC seam (`setPermissionResolver`, `permissionsForRequest`, `requirePermission`)"
  - "FEED-08 posting policy as ONE value: `tenant_modules['feed'].settings.postingPolicy`"
  - "`post.published` declared on `EventMap` and emitted after commit"
  - "`apps/web/lib/feed.ts` — the ONE feed fetch implementation (`getFeed`/`loadFeed`/`loadPost`)"
  - "The D-55 home-slot widget (`FeedList`/`PostCard`/`PostHeader`/`PostCaption`) and the `feed` pt-BR namespace"
  - "The two-tenant isolation gate and the lane-privilege gate, both now proving themselves against a feed table"
affects: [04-02, 04-03, 04-04, 04-05, 04-06, 04-07, 04-08, 04-09, 04-10, 05-communities, 06-events, 07-notifications, 08-moderation]

actuals:
  tokens: 46770
  tasks: 3
  commits: 5

plan_head_before: aab84df62e9633d873ce28f3333155856460b1a6

tech-stack:
  added: []
  patterns:
    - "Kernel seam fed by the app tier: `setPermissionResolver` is `registerJobQueues` applied to RBAC, so a module's route can say `requirePermission('feed.post.create')` while the composition stays in `apps/api` and `packages/core` still imports no module (MOD-02)"
    - "Timestamps formatted in SQL (`to_char(... 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')`) so the keyset cursor keeps `timestamptz` microsecond precision instead of being truncated by a JS `Date`"
    - "One hydrated statement per list: the author's display name and avatar asset id join into the SAME statement, pinned by a filtered `pg_stat_statements` `sum(calls)` budget"
    - "A module's UI is presentational: it formats no date, resolves no URL and knows no route table — the web composition point maps the wire contract into a view model"

key-files:
  created:
    - packages/modules/feed/package.json
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/module.ts
    - packages/modules/feed/server/{index,routes,service}.ts
    - packages/modules/feed/ui/{FeedList,PostCard,PostHeader,PostCaption,index}.tsx
    - packages/core/server/rbac/permissions.ts
    - apps/web/lib/feed.ts
    - apps/web/messages/pt-BR/feed.json
    - supabase/migrations/20260922152230_feed_posts.sql
    - apps/api/tests/integration/feed.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - packages/modules/feed/tests/events.test.ts
    - apps/web/e2e/feed.spec.ts
  modified:
    - apps/api/src/modules/registry.ts
    - apps/api/src/app.ts
    - apps/api/src/routes/me.ts
    - apps/web/lib/registry.tsx
    - scripts/seed.ts
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/030-lanes.sql
    - supabase/tests/010-rls-coverage.sql

key-decisions:
  - "The write guard is `requirePermission('feed.post.create')`, never `requireRole('admin_tenant')` — the V1 rule lives in `tenant_modules['feed'].settings.postingPolicy`, so V2 member posting is one UPDATE with no migration and no route edit (FEED-08)"
  - "The kernel gains a permission SEAM rather than knowledge of modules: `setPermissionResolver` is called once, at import time, by `apps/api/src/modules/registry.ts`; a missing registration throws rather than failing open"
  - "Feed timestamps are formatted by Postgres with microsecond precision and never round-trip through a JS `Date`, because ms truncation would move the page boundary earlier than the row it came from and silently skip same-millisecond posts"
  - "The projection writes NO tenant predicate at all — not on `feed_posts`, not on the `memberships`/`member_profiles` joins — because all three are RLS-scoped to the lane; a written predicate would be dead weight a reader could mistake for the isolation"
  - "`limit` above `FEED_MAX_PAGE_SIZE` is REFUSED with 400, not silently reduced — the repo's established posture from `GET /v1/media` (03-07)"
  - "`scripts/seed.ts` writes `public.feed_posts` with raw SQL instead of importing `@tria/module-feed/db`: a root-workspace dependency on a `module`-tagged package makes `turbo boundaries` 2.10.12 mis-report the kernel packages as violating the MOD-02 denylist"

patterns-established:
  - "Module package: copy `packages/modules/example/` structure verbatim, change the name, keep the five-subpath exports map, and give the package its own `vitest.config.ts` (Vitest 5 no longer walks up)"
  - "Keyset page: decode → one `tx.execute` with the row-value predicate → over-fetch `limit + 1` → slice → `encodeCursor` from the last row's own projected ordering value"
  - "Cross-tenant refusal: never compare tenant ids; let RLS hide the row so unknown-id and foreign-tenant take one code path and answer a bare 404 with no `details`"
  - "Every new isolation case ships its POSITIVE control in the same test, in pgTAP and in the integration suite"

requirements-completed: [FEED-02, FEED-08, MOD-03, UI-02]

coverage:
  - id: D1
    description: "`@tria/module-feed` exists as a real module package, registered under `feed` and mounted at `/v1/feed`, importing only the kernel and the shared contracts"
    requirement: MOD-03
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/mounts.test.ts#2b. the feed module exposes its three routes under /v1/feed (04-01)"
        status: pass
      - kind: other
        ref: "pnpm boundaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "`GET /v1/feed` pages by keyset: 10 items + a non-null cursor, a full walk returning every post exactly once in strictly descending `(createdAt, id)` order, and a concurrent insert that neither duplicates nor skips"
    requirement: FEED-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#2. walking the cursors returns every post exactly once, in a strictly descending order"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#3. an insert BETWEEN two pages neither duplicates nor skips a pre-existing post"
        status: pass
    human_judgment: false
  - id: D3
    description: "Paging is total under hostile input: a tampered or stale cursor degrades to page 1, `limit` is bounded server-side, and an unknown query key is refused"
    requirement: FEED-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#5. a tampered or stale cursor degrades to page 1 rather than 500 (T-04-06)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#4. limit is bounded server-side and validated; an unknown query key is refused"
        status: pass
    human_judgment: false
  - id: D4
    description: "A feed page costs at most ONE statement against the feed tables — the author's name and avatar come back hydrated, never per row"
    requirement: FEED-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#costs at most 1 statement against the feed tables"
        status: pass
    human_judgment: false
  - id: D5
    description: "`POST /v1/feed/posts` is 201 for a caller holding `feed.post.create` and 403 for one who does not; tenant and author come from the request context, never from the body"
    requirement: FEED-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#6. the admin publishes (201) and the post heads the feed; a member is refused (403)"
        status: pass
      - kind: other
        ref: "supabase/tests/020-tenant-isolation.sql — WITH CHECK: A cannot write a post stamped with B's tenant_id"
        status: pass
    human_judgment: false
  - id: D6
    description: "The posting policy is ONE value with ONE composition point: flipping `settings.postingPolicy` to `members` turns a member into an author with no migration and no route edit, and `GET /v1/me/bootstrap` reports the same composed set"
    requirement: FEED-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#7. flipping settings.postingPolicy to \"members\" makes the SAME member an author"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#6b. FEED-08: the posting policy is ONE value, composed here and nowhere else"
        status: pass
    human_judgment: false
  - id: D7
    description: "A foreign-tenant post id answers a bare 404 with no `details`, byte-identical to an unknown id's, naming neither tenant — with the positive control in the same test"
    requirement: FEED-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#9. a lab session never sees a demo post, by list or by id — and demo still does"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#10. an unknown uuid produces the byte-identical 404 body"
        status: pass
      - kind: other
        ref: "pnpm supabase test db (020-tenant-isolation.sql, 030-lanes.sql)"
        status: pass
    human_judgment: false
  - id: D8
    description: "`post.published` is declared on `EventMap` and reaches a subscriber exactly once after commit, and zero times when the handler throws before commit"
    requirement: MOD-03
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/events.test.ts#2. a create whose transaction throws queues NOTHING and delivers nothing"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#12. one successful create delivers one event; a refused create delivers none"
        status: pass
    human_judgment: false
  - id: D9
    description: "`feed_posts` carries tenant-first indexes, RLS with the standard isolation policy, and is covered by all five isolation cases plus the lane-privilege suite"
    requirement: FEED-02
    verification:
      - kind: other
        ref: "pnpm db:reset && pnpm db:seed && pnpm supabase test db (136 assertions, 9 files)"
        status: pass
      - kind: other
        ref: "pnpm db:generate produces no diff under supabase/migrations"
        status: pass
    human_judgment: false
  - id: D10
    description: "`/inicio` renders the feed through the D-55 home slot: the seeded posts appear as cards newest-first, the author links to `/membros/{membershipId}`, no navigation tab is added, and a tria-lab member never sees the tria-demo feed"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts (3 tests × mobile-chromium + desktop-chromium, 6 passed)"
        status: pass
    human_judgment: false
  - id: D11
    description: "Captions render as plain text with newlines preserved and URLs auto-linked at render time into real `<a rel=\"noopener noreferrer nofollow\" target=\"_blank\">` elements, with no HTML-injection sink anywhere in the feed UI"
    requirement: UI-02
    verification:
      - kind: other
        ref: "grep -rc dangerouslySetInnerHTML packages/modules/feed/ui/ → 0 for every file"
        status: pass
    human_judgment: true
    rationale: "The absence of a sink is grep-provable, but that a hostile caption RENDERS as inert text — and that an auto-linked URL looks and behaves right on a phone — has no assertion in this plan. 04-05's composer is where a human can type one; flagged so the verifier asks rather than assumes."
  - id: D12
    description: "Every string the feed UI renders comes from `apps/web/messages/pt-BR/feed.json` under the single root key `feed`"
    requirement: UI-02
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false

duration: 31 min
completed: 2026-09-22
status: complete
---

# Phase 4 Plan 01: Feed Tracer Summary

**One thin path is wired through every layer the phase will touch: a post created in the tenant lane lands in `feed_posts` under RLS, publishes `post.published` after commit, comes back through a one-statement keyset page, and renders as a `PostCard` in the D-55 home slot on `/inicio` — with the write guarded by a composed permission rather than by a role.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-09-22T15:10:23Z
- **Completed:** 2026-09-22T15:41:30Z
- **Tasks:** 3 of 3
- **Files modified:** 39 (36 excluding the lockfile and drizzle snapshots)

## Accomplishments

- **`@tria/module-feed` is the first real feature module.** Same five-subpath exports map as the throwaway example, registered under `feed`, mounted at `/v1/feed`, and green under `pnpm boundaries` — it reaches `@tria/core`, `@tria/ui` and `@tria/contracts` and nothing else.
- **`feed_posts` exists under RLS with a V2-ready shape.** Generic `author_user_id`, a nullable `community_id` reserved for Phase 5 that already participates in the list index, soft delete + `edited_at`, and trigger-owned counters declared now so 04-03 changes no contract. No title, no post-kind column (D-51). No admin-flavoured authorship column anywhere (FEED-08).
- **Paging is total, and proven to be.** The kernel's single cursor envelope, an over-fetch of `limit + 1`, and a walk under a concurrent insert that returns every pre-existing post exactly once. A tampered or stale cursor degrades to page 1; `limit` is bounded server-side.
- **A feed page costs ONE statement.** Pinned in CI by a filtered `pg_stat_statements` `sum(calls)` delta with a named budget, so the day 04-03's `viewerLiked` join arrives it must land in the same statement or the test goes red.
- **FEED-08 has exactly one composition point.** `tenant_modules['feed'].settings.postingPolicy` feeds both the route guard and `GET /v1/me/bootstrap`'s `permissions`; the integration suite flips it and watches the same member become an author with no migration and no route edit.
- **The kernel gained an RBAC seam, not a dependency.** `setPermissionResolver` is `registerJobQueues` applied to RBAC: the kernel declares the shape, the app tier fills it, and `packages/core` still imports no module.
- **The exit gate now proves itself against a feed table.** The five isolation cases and the lane-privilege suite were extended/moved onto `feed_posts` BEFORE 04-10 removes the example module, so that removal cannot silently weaken the gate (RESEARCH Pitfall 4).

## Task Commits

1. **Task 1 (tracer): module package, schema, kernel RBAC seam, routes, service, web fetch, home slot, catalog** — `649c9a1` (feat)
2. **Task 2: generate and apply the `feed_posts` migration, extend the isolation gate, seed the posts** — `054c8f6` (feat)
3. **Task 3 (tdd): the six specs** — `f1b6680` (test) → `a0385d6` (fix, the GREEN)
4. **Deviation fix: seed `feed_posts` with raw SQL to keep `pnpm boundaries` honest** — `5443dc4` (fix)

## Files Created/Modified

- `packages/modules/feed/contracts/index.ts` — page-size pair, caption cap in UTF-16 code units, `feedQuerySchema`/`createPostSchema`/`feedPostSchema`/`feedPageSchema` (all `.strict()`), `FEED_POSTING_POLICIES` + `feedSettingsSchema`, `FEED_PERMISSIONS`, and the `EventMap` declaration merge for `post.published`
- `packages/modules/feed/db/schema.ts` — `feed_posts` with its two indexes, the `media_kind` CHECK, RLS and the standard isolation policy; a docblock naming the four things a reviewer must not "fix"
- `packages/modules/feed/server/service.ts` — `listFeed`/`getPost`/`createPost`, all `withTenantTx`, one shared projection, after-commit emit
- `packages/modules/feed/server/routes.ts` — `requireAuth → requireModule('feed')` plus `requirePermission('feed.post.create')` on the write only
- `packages/modules/feed/ui/*` — `FeedList` (the home-slot widget with its own empty and error cards), `PostCard`, `PostHeader` (server-formatted timestamps, UI-D-14), `PostCaption` (plain text, newlines preserved, render-time auto-linking)
- `packages/core/server/rbac/permissions.ts` — `PermissionResolver`, `setPermissionResolver`, `permissionsForRequest`, `requirePermission`
- `apps/api/src/modules/registry.ts` — the `feed` entry, the widened `permissionsFor(role, enabled, settings)`, and the single `setPermissionResolver(permissionsFor)` call
- `apps/web/lib/feed.ts` — `getFeed`/`loadFeed`/`loadPost`, the `lib/profile.ts` posture with `redirect()` outside every catch
- `apps/web/lib/registry.tsx` — the `feedHome` renderer, the `FeedPost → PostCardView` mapper and the server-side relative/absolute time formatting
- `supabase/migrations/20260922152230_feed_posts.sql`, `supabase/tests/{010,020,030}*.sql`, `scripts/seed.ts` — the schema, its isolation cases, and two identically-captioned posts per seeded tenant

## Decisions Made

Recorded in the frontmatter `key-decisions`. The two that will be quoted most often downstream:

- **The write guard is a permission, not a role.** `requireRole('admin_tenant')` is grep-banned from the module's routes; the V1 restriction lives in one settings value.
- **Feed timestamps never round-trip through a JS `Date`.** Postgres formats them with microsecond precision, because ms truncation moves the keyset boundary earlier than the row it came from and skips same-millisecond posts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `GET /v1/feed` and `POST /v1/feed/posts` answered 500 — `tx.execute` returns driver rows, not Drizzle's column-mapped ones**

- **Found during:** Task 3 (the RED run of the integration suite)
- **Issue:** `tx.execute<FeedRow>(sql…)` returns the postgres.js row objects, where `created_at` is TEXT rather than a `Date`. `toPost` called `.toISOString()` on it, so every list and every create threw a `TypeError` after its transaction had already committed. The tracer's own proof caught it; nothing in Task 1's static verification could have.
- **Fix:** the projection now formats both timestamps in SQL with `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. This is deliberately more than a cast: it keeps `timestamptz`'s MICROSECOND precision in the cursor's `n`, where a JS `Date` round-trip would have truncated to milliseconds and silently skipped any post written in the same millisecond but a later microsecond — a paging defect that only appears under load.
- **Files modified:** `packages/modules/feed/server/service.ts`
- **Verification:** `pnpm --filter @tria/api exec vitest run tests/integration/feed.test.ts tests/integration/feed-query-budget.test.ts` → 13 passed; full suite 330 passed
- **Committed in:** `a0385d6`

**2. [Rule 3 - Blocker] `pnpm boundaries` reported three MOD-02 violations for an import nobody wrote**

- **Found during:** Task 3 (plan-level verification)
- **Issue:** `scripts/seed.ts` belongs to the ROOT workspace package. Declaring `@tria/module-feed` as a root devDependency so the seed could import `@tria/module-feed/db` made `turbo boundaries` 2.10.12 report `@tria/core` and `@tria/ui` as depending on a `module`-tagged package — the same mis-attribution class `turbo.json` already documents for `@tria/config` on the `contracts`/`tooling` tags.
- **Fix:** the seed inserts `public.feed_posts` through `withAdminTx` + raw `sql` (the migration is a committed, stable contract), and the root keeps no module dependency.
- **Files modified:** `scripts/seed.ts`, `package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm boundaries` → "Checked 435 files in 8 packages, no issues found"; `pnpm db:reset && pnpm db:seed && pnpm supabase test db` green from a cold stack
- **Committed in:** `5443dc4`

**3. [Rule 2 - Missing critical] The integration suites sweep by caption prefix, not only by recorded id**

- **Found during:** Task 3
- **Issue:** deviation 1 produced rows whose ids the suite never learned (the insert committed, the response was a 500), and those orphans then broke the e2e ordering assertion on the shared local stack. A cleanup that only deletes ids it recorded cannot survive the exact failure mode this plan just hit.
- **Fix:** both feed integration files sweep their own caption prefixes in `afterAll`; the e2e asserts the seeded posts' RELATIVE order rather than "the first card", so a sibling suite's leftover cannot read as an ordering regression.
- **Files modified:** `apps/api/tests/integration/feed.test.ts`, `apps/api/tests/integration/feed-query-budget.test.ts`, `apps/web/e2e/feed.spec.ts`
- **Verification:** `pnpm test:integration` → 330 passed; `playwright test feed.spec.ts` → 6 passed
- **Committed in:** `f1b6680` / `a0385d6`

### Planner-instruction adjustments

**4. `FEED_LIST_STATEMENT_BUDGET` needed a lint suppression to stay where the plan put it.** Biome's `lint/suspicious/noExportsInTest` refuses exports from a test file. The plan explicitly asks for the constant to be exported from the budget spec "so the number has a name", and colocating it with the only assertion that can prove it is the right call — so the export carries a one-line `biome-ignore` with that reason instead of moving to a shared module where it could drift.

**5. `FeedList`'s admin empty-state CTA is behind an optional `createHref`.** UI-D-20 gives the admin variant a "Criar publicação" button, but `/criar` does not exist until 04-05. The component renders the admin COPY (the UI-D-20 distinction) and omits the button unless the host supplies a href, so nothing links to a 404 today and 04-05 wires it with a prop.

**6. The seeded-caption fixture lives in `apps/web/e2e/fixtures.ts`, not imported from `scripts/seed.ts`.** The plan asks the e2e to take the caption "from the seed module"; `scripts/seed.ts` is a top-level-await script that requires `SEED_PASSWORD` and opens a database connection at import time, so importing it from a spec is not possible. The values are mirrored in `e2e/fixtures.ts` with a pointer back to the seed — the same convention `members.spec.ts`'s `SEEDED` block already uses.

---

**Total deviations:** 3 auto-fixed (1 × Rule 1 bug, 1 × Rule 3 blocker, 1 × Rule 2 missing-critical) + 3 recorded planner-instruction adjustments.
**Impact on plan:** No scope creep. Deviation 1 is the single most valuable thing this plan produced — the tracer existed precisely to surface a defect like it after one commit rather than after ten, and the fix it forced (SQL-side microsecond formatting) is stronger than the idiom the plan told us to copy.

## Issues Encountered

**Two stated acceptance criteria could not be satisfied literally, and were satisfied in substance:**

1. `ls supabase/migrations/*_feed_posts.sql … contains \`create table\` with \`"feed_posts"\`` — drizzle-kit emits `CREATE TABLE "feed_posts"` in upper case, as every other migration in `supabase/migrations/` does. Hand-lowercasing generated SQL would break the repo's "read the emitted SQL, never edit it" convention for no gain. The table, the RLS enable, both indexes, the CHECK and the policy are all present and verified.
2. `?limit=999` "clamps to `FEED_MAX_PAGE_SIZE`" — the repo's established posture (03-07's `GET /v1/media`, asserted in `media-playback.test.ts`) is that an over-cap `limit` is REFUSED with `400 VALIDATION_FAILED`, and the plan's own contracts step specifies `.max(FEED_MAX_PAGE_SIZE)`, which rejects. The test asserts the refusal AND that the largest accepted page really is the cap. Either reading satisfies the underlying truth — no request can ask for an unbounded page — but the wording should be settled before 04-02 copies it.

## Known Stubs

| Stub | File:line | Why, and who resolves it |
|---|---|---|
| `viewerLiked` is hard-`false` for every post | `packages/modules/feed/server/service.ts:98` | Declared in the contract NOW so 04-03 adds likes without a contract change. 04-03 adds `left join feed_likes … on l.user_id = app.user_id()` to the SAME statement — the query budget test forces it to stay one statement. |
| `hasMedia` is hard-`false` in the `post.published` payload | `packages/modules/feed/server/service.ts:221` | 04-04 sets it from `media_kind` once `feed_post_media` exists. Phase 7 is the first consumer that reads it. |
| `FeedList`'s admin empty-state CTA renders only when the host passes `createHref` | `packages/modules/feed/ui/FeedList.tsx` | `/criar` (the D-57 composer) ships in 04-05, which supplies the href. Rendering it today would link to a 404. |

None of these prevent the plan's goal: a member sees the tenant's posts as cards, an author can publish, and neither tenant can see the other.

## Threat Flags

None. Every surface this plan added — `GET /v1/feed`, `GET /v1/feed/posts/{id}`, `POST /v1/feed/posts`, `feed_posts` and the `feed.post.create` permission — is named in the plan's `<threat_model>`, and each `mitigate` disposition has an assertion behind it (T-04-01 in tests 9/10, T-04-02 in test 6 plus the pgTAP WITH CHECK case, T-04-03 in test 6/7 plus the grep ban on `requireRole` in the module's routes, T-04-04 in the `PostCaption` sink ban, T-04-05 in the log-shape review, T-04-06 in tests 4/5).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 04-02.** The conventions every later plan in the phase copies are now fixed and executable:

- the keyset idiom (kernel envelope, over-fetch, projected ordering value, SQL-side microsecond formatting)
- the one-hydrated-statement rule, with a CI budget that will go red if a later join fans out
- the after-commit event shape and its unit harness (`withTenantTx` as the mockable seam)
- the permission seam, for every later "who may do this" question in the phase
- the single web fetch implementation and the module-UI-is-presentational split

**One thing 04-02 should settle first:** the `limit`-over-cap wording (see Issues Encountered #2), so the infinite-scroll sentinel and the composer agree with the API about what an over-large page request means.

**No blockers.**

---
*Phase: 04-feed*
*Completed: 2026-09-22*

## Self-Check: PASSED

- All 20 `key-files` entries verified present on disk (`[ -f ]`).
- All 5 commits verified present in `git log --oneline --all`: `649c9a1`, `054c8f6`, `f1b6680`, `a0385d6`, `5443dc4`.
- Plan-level `<verification>` re-run at close-out: module/api/core/web typecheck + lint green, `pnpm --filter @tria/module-feed test` 3 passed, `pnpm --filter @tria/api test` 17 passed, `pnpm test:integration` 330 passed (24 files), `bash scripts/check-ui-literals.sh` OK, `pnpm boundaries` no issues, `pnpm db:generate` no diff, `pnpm db:reset && pnpm db:seed && pnpm supabase test db` green from a cold stack (136 assertions), `playwright test feed.spec.ts` 6 passed.
