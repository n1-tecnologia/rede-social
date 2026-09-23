---
phase: 05-communities-stories
plan: 03
subsystem: api
tags: [feed, merged-feed, keyset, index, explain, drizzle, foreign-key, composer, bottom-sheet, D-71, D-72, D-73, D-74]

requires:
  - phase: 05-communities-stories
    provides: "05-01's communities table (the FK's target), its contracts and the Comunidades tab; 05-02's UI-D-46 vocabulary amendment and the ComposerForm tenantName prop"
  - phase: 04-feed
    provides: "feed_posts with its reserved community_id and two indexes, postProjection, the ONE cursor envelope, the query-budget harness, PostHeader/PostCard/FeedList and the /criar composer"
  - phase: 03-media-profiles
    provides: "MediaImage and the variant ladder the picker's 32×32 cover thumb renders through"
provides:
  - "feed_posts_community_fk — feed_posts.community_id finally references public.communities(id)"
  - "feed_posts_tenant_created_all_idx — the third, non-partial index the MEASURED merged-feed plan needs"
  - "listFeed's D-73/D-74 predicate switch, chosen from the tenant's module flags — one query, one ordering expression, two predicates"
  - "listCommunityFeed(ctx, communityId, query) exposed as GET /v1/feed?communityId= — same projection, same cursor envelope"
  - "COMM-04's two-check write: requirePermission('feed.post.create') plus an in-transaction destination validation (bare 404 / 400 { community: 'archived' })"
  - "FeedPost.community ({ id, name, slug } | null) hydrated by a left join inside the SAME statement"
  - "PostHeader's D-71 em {Comunidade} segment, absent when null and suppressible; FeedList.suppressCommunity"
  - "CommunityPickerSheet — the shared community row list whose trailing control is a prop (UI-D-45 today, UI-D-41 in 05-08)"
  - "The Publicar em picker inside /criar, pre-filled from ?comunidade= on the server and read-only in edit mode"
  - "090-feed.sql's fourth EXPLAIN assertion and the FK's negative + positive control (plan 35 -> 39)"
  - "Six seeded posts inside communities per tenant, interleaved with the tenant-wide fixtures"
affects: [05-04, 05-05, 05-07, 05-08, 06-events, 07-realtime]

actuals:
  # chars/4 over the realized diff fb8bc2b..HEAD (260,153 chars). ~25,190 of those tokens are the
  # drizzle-kit migration SNAPSHOT json, which is generated rather than written; the authored half
  # is ~39,800. Reported whole, on the same scale the estimate used, rather than flattered down.
  tokens: 65038
  tasks: 3
  # MEASURED: git rev-list --count fb8bc2b..HEAD was 5 at SUMMARY write (the five task commits);
  # 6 once this metadata commit lands, which is what a later `git rev-list` will read.
  commits: 6
plan_head_before: fb8bc2b7734a0f7acb321e087647d35b1b9a8601

tech-stack:
  added: []
  patterns:
    - "A predicate chosen from a MODULE FLAG rather than from a route: one query, one ordering expression, two `where` fragments — the D-73/D-74 switch"
    - "A measured index claim: the plan assertion names the index BY NAME on a volume fixture, so a future `drop index` is a red pgTAP run instead of a silent sequential scan"
    - "A cross-module foreign key declared as hand-written SQL because the boundary allowlist denies the TS import the ORM would need — the constraint is the same, the boundary survives"
    - "A shared list body whose trailing CONTROL is an injected prop: one component for two sheets that differ only in what sits at the end of each row"

key-files:
  created:
    - packages/modules/communities/ui/CommunityPickerSheet.tsx
    - packages/modules/feed/tests/community-contract.test.ts
    - packages/modules/feed/tests/post-header.test.tsx
    - packages/modules/communities/tests/community-picker-sheet.test.tsx
    - supabase/migrations/20260923185730_feed_communities.sql
    - .planning/phases/05-communities-stories/deferred-items.md
  modified:
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/server/index.ts
    - packages/modules/feed/ui/PostHeader.tsx
    - packages/modules/feed/ui/PostCard.tsx
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/communities/ui/index.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/feed-write.ts
    - apps/web/lib/communities.ts
    - apps/web/app/(app)/criar/ComposerForm.tsx
    - apps/web/app/(app)/criar/page.tsx
    - apps/web/app/(app)/criar/actions.ts
    - apps/web/messages/pt-BR/feed.json
    - apps/web/messages/pt-BR/communities.json
    - supabase/tests/090-feed.sql
    - scripts/seed.ts
    - apps/api/tests/integration/feed.test.ts
    - apps/api/tests/integration/communities.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - apps/web/e2e/comunidades.spec.ts
    - apps/web/e2e/fixtures.ts
    - apps/web/e2e/feed.spec.ts
    - apps/web/e2e/shell.spec.ts
    - apps/web/e2e/phase2-smoke.spec.ts
    - apps/web/e2e/phase4-smoke.spec.ts

key-decisions:
  - "`feed_posts_community_fk` is HAND-WRITTEN SQL inside the generated migration, not a drizzle `.references(() => communities.id)`. Verified empirically: adding `@tria/module-communities` to the feed package makes `turbo boundaries` report `Package @tria/module-communities found without any tag listed in allowlist for @tria/module-feed` — a `module -> module` dependency is denied outright (the allowlist is kernel/contracts/tooling, and `packages/boundary-fixture` exists to prove it bites). The plan's own acceptance criteria asked for BOTH the dependency and a green `pnpm boundaries`, which are mutually exclusive. The constraint is identical either way and drizzle never diffs it away, because it is absent from the TS schema and therefore from the snapshot."
  - "`postCommunitySchema` ({ id, name, slug }) is declared IN the feed's own contracts rather than imported from `@tria/module-communities/contracts` — same boundary, and it is also the honest shape: a cover, a post count, a status and an ordering timestamp on every post of the merged feed would be payload nobody renders."
  - "`listCommunityFeed` is exposed as `GET /v1/feed?communityId=` rather than as a sibling path. Both pages are built by one `feedPage` helper from the identical `(created_at, id)` tuple, so a cursor is meaningful in either and there is one `FeedQuery` to extend rather than two to keep in step."
  - "The D-71 segment's whole visible string arrives as ONE interpolated `label` prop and the anchor wraps it, so the module never learns the word \"em\". UI-D-36's letter says only the NAME is the link text; the plan's `<action>` says the template is a host label passed in as a prop. The plan won, and the practical effect is a slightly larger tap target with an explicit `aria-label`."
  - "`listAllCommunities()` walks the existing keyset with a 10-page ceiling and NEVER throws: an unreadable list returns `[]`, the picker offers only `Feed principal`, and the composer still publishes. Losing the destination chooser must not cost the admin the post."
  - "The picker's `Feed principal` entry is a `leadingRow` the HOST renders, not a row the module invents. That is what keeps `CommunityPickerSheet` shippable to 05-08's pin sheet, which has no such default and whose empty state carries a CTA only the host can route."
  - "`resolveCommunityTarget` runs BEFORE `validateAssets` and before the link-preview upsert: a refused destination must cost neither an asset validation nor an outbound-fetch cache row, and it must be the first thing the caller is told."

patterns-established:
  - "When a plan's acceptance criteria contradict each other, the ARCHITECTURAL invariant wins and the contradiction is recorded — here MOD-02's package-graph boundary beat a `.references()` grep"
  - "An EXPLAIN assertion that names the index rather than matching `Index Scan`: a shape match would pass on the partial index plus a filter, which is a different plan at a different cost"
  - "A query budget gains a SECOND filtered measure when a projection grows a join into another module's table — the ceiling proves the join is inside the statement, the floor proves it is there at all"
  - "Seed fixtures for an interleaving guarantee must be placed BETWEEN the existing ones (fractional offsets included), because a fixture where every new row is older than every old one would let an implementation that simply appended the two sources pass"

requirements-completed: [COMM-02, COMM-04]

coverage:
  - id: D1
    description: "The main feed shows tenant-wide posts PLUS every community post, strictly chronological and newest first, from ONE query with ONE ordering expression (roadmap criterion 1, D-73)"
    requirement: COMM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#13. D-73: community posts and tenant-wide posts are ONE chronological list, interleaved"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#2. walking the cursors returns every post exactly once, in a strictly descending order"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#a community post in the MAIN feed says where it came from, and links there"
        status: pass
    human_judgment: false
  - id: D2
    description: "That merged query is served by a NEW third index `feed_posts_tenant_created_all_idx`, pinned BY NAME inside Postgres on a 500-row interleaved volume fixture, with the no-sequential-scan half in the same captured plan"
    verification:
      - kind: integration
        ref: "supabase/tests/090-feed.sql#D-73: the MERGED feed (no community_id predicate) is served by feed_posts_tenant_created_all_idx"
        status: pass
      - kind: integration
        ref: "supabase/tests/090-feed.sql#…and never a sequential scan of feed_posts — the plan 05-RESEARCH measured without the index"
        status: pass
      - kind: other
        ref: "pnpm supabase test db => Files=11, Tests=211, Result: PASS (was 207)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-74: turning the `communities` module OFF reverts the same endpoint to `community_id is null`, leaves every community post's row untouched, and turning it back ON restores them with no migration and no backfill"
    requirement: COMM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#17. OFF: the feed carries no community post, and every one of those rows still exists"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#18. …and turning it back ON restores them, with no migration and no backfill"
        status: pass
    human_judgment: false
  - id: D4
    description: "`feed_posts.community_id` carries a real foreign key to `communities.id`, enforced by the database with its positive control in the same block"
    verification:
      - kind: integration
        ref: "supabase/tests/090-feed.sql#COMM-04: a post naming a community that does not exist is refused by feed_posts_community_fk"
        status: pass
      - kind: integration
        ref: "supabase/tests/090-feed.sql#positive control: a post naming an EXISTING community of this tenant is accepted"
        status: pass
      - kind: other
        ref: "pnpm db:generate against the committed migration => \"No schema changes, nothing to migrate\"; git status --porcelain -- supabase/migrations empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-71: a community post in the main feed carries a tappable `em {Comunidade}` segment rendered as `<time> · em {community}`, 12/700 text-text-secondary (not brand), the middot aria-hidden, absent when null and suppressible on the community page"
    requirement: COMM-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/post-header.test.tsx#1. renders the time, a middot and the community link when a community is supplied"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-header.test.tsx#3. a tenant-wide post renders the time ALONE — no middot, no empty node"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-header.test.tsx#4. suppressCommunity renders the time alone even when a community IS supplied"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#a community post in the MAIN feed says where it came from, and links there"
        status: pass
    human_judgment: false
  - id: D6
    description: "The community summary reaches the post header through a left join inside the existing projection, so D-71's label costs ZERO extra statements"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#hydrates the D-71 community label inside the SAME statement (at most 1)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#costs at most 1 statement against the feed tables"
        status: pass
    human_judgment: false
  - id: D7
    description: "COMM-04's write is TWO checks: `requirePermission('feed.post.create')` plus a service validation that answers `400 { community: 'archived' }` for an archived community and a BARE 404 with no details for an unknown or other-tenant id"
    requirement: COMM-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#15. COMM-04: posting into an ACTIVE community lands in both the merged feed and that community"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#16. COMM-04: an ARCHIVED community answers 400 with details.community === \"archived\""
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#17. COMM-04: an unknown or other-tenant community is a BARE 404 with no details key"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-72: a published post cannot be moved between communities — `communityId` is on the create schema only, and an edit body carrying one is REFUSED rather than ignored"
    requirement: COMM-04
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/community-contract.test.ts#4. updatePostSchema REFUSES communityId — a published post cannot move (D-72)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#18. D-72: a published post cannot be moved between communities"
        status: pass
    human_judgment: false
  - id: D9
    description: "D-72 / COMM-04: the admin chooses a destination in ONE optional `Publicar em` picker inside the existing /criar composer, defaulting to `Feed principal` and pre-selected when opened as /criar?comunidade={id} — with no second composer anywhere"
    requirement: COMM-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#the admin’s composer opens on “Feed principal”, and pre-filled from ?comunidade="
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/community-picker-sheet.test.tsx#4. choosing a row hands the caller back the row it chose"
        status: pass
    human_judgment: false
  - id: D10
    description: "UI-D-45 partial: in edit mode the picker row renders READ-ONLY with its helper rather than vanishing, so D-72's rule is taught instead of concealed"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#the EDIT screen renders the destination read-only with its helper (UI-D-45)"
        status: pass
    human_judgment: false
  - id: D11
    description: "UI-D-45 empty / overflow: the sheet always carries at least `Feed principal` so it is never empty, and the picker row is three flex children so truncation can only ever fall on the destination name"
    verification:
      - kind: unit
        ref: "packages/modules/communities/tests/community-picker-sheet.test.tsx#5. zero communities renders an empty list rather than a crash — the caller owns the copy"
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/community-picker-sheet.test.tsx#3. the name truncates beside its control, so a long name never pushes the control out"
        status: pass
      - kind: other
        ref: "acceptance grep: shrink-0 / min-w-0 / truncate / min-h-14 all present on the ComposerForm destination row"
        status: pass
    human_judgment: true
    rationale: "The STRUCTURE that guarantees the geometry is asserted (three flex children, the only min-w-0 child is the value). Whether the row actually stays one line with the trailing glyph in place at a 40-character community name on a 320px viewport is a rendered-pixel judgement no assertion here makes — UI-SPEC E14/overflow asks for it explicitly, and it should be exercised at end-of-phase verification."
  - id: D12
    description: "UI error/E14: choosing a community that was archived between render and submit lands on the composer's role=\"alert\" card with the archived copy, and the typed caption is not cleared"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed.test.ts#16. COMM-04: an ARCHIVED community answers 400 with details.community === \"archived\" (the refusal the composer maps)"
        status: pass
    human_judgment: true
    rationale: "The API half is proved and the client mapping is typechecked and exhaustive (`messageFor`'s `archived` arm plus `asCommunityIssue`), but no automated case archives a community BETWEEN a composer render and its submit — that race needs a second actor. A human should archive a community in one tab and submit a draft naming it in another."

duration: 79min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 03: The Merged Feed Summary

**`feed_posts.community_id` became real on both sides — a foreign key plus the third index the measured plan actually needs on the read, and a permission-plus-validation write behind one optional `Publicar em` picker inside the composer that already existed.**

## Performance

- **Duration:** 79 min
- **Started:** 2026-09-23T18:49:56Z
- **Completed:** 2026-09-23T20:09:26Z
- **Tasks:** 3 of 3
- **Files modified:** 37

## Accomplishments

- **Criterion 1's second half is true, and it is ONE query.** `listFeed` chooses its predicate from the tenant's enabled-module set: enabled → no filter on `community_id` at all (D-73), disabled → Phase 4's `community_id is null`, unchanged (D-74). Everything below the predicate — the projection, the cursor comparison, the ordering expression, the over-fetch — is written once in a shared `feedPage` helper, so the merged feed, the module-off fallback and a community's own page cannot drift apart on any of them.
- **The falsified index claim was replaced by a measured one, and then pinned inside Postgres.** D-73 assumed the Phase 4 composite index served the merged feed; 05-RESEARCH measured `Sort` + `Seq Scan`. `feed_posts_tenant_created_all_idx` now exists, and `090-feed.sql` grew from 35 to 39 assertions — the fourth EXPLAIN block builds its own 500-row fixture (250 tenant-wide interleaved with 250 across four communities), `analyze`s it, and asserts the captured plan NAMES the index and does NOT contain `Seq Scan on feed_posts`. Naming it rather than matching `Index Scan` is the difference between an assertion and a shape that the partial index plus a filter would also satisfy.
- **The foreign key landed without breaking MOD-02.** `feed_posts_community_fk` is declared as hand-written SQL inside the generated migration, because a drizzle `.references()` would need a `module -> module` package dependency that `turbo boundaries` denies. `pnpm db:generate` remains a byte-for-byte no-op against the committed file, `pnpm boundaries` is green over 498 files, and `pnpm boundaries:negative` still proves both layers bite.
- **D-71's label costs nothing, and that is measured too.** The community summary rides a `left join public.communities` inside `postProjection`, constrained by `c.tenant_id = p.tenant_id` — the one join condition in that statement that carries a tenant predicate, because it is the one whose failure mode is a foreign tenant's name inside a post card. A second filtered budget assertion holds the community tables at ONE statement for a full feed page, with a floor that turns a silently-unhydrated label red.
- **COMM-04's write is two checks and three answers.** The permission is the route's literal `requirePermission('feed.post.create')`; the destination is resolved inside the post's own `withTenantTx` transaction, before the assets and before the link-preview row. Not visible → a bare 404 with no `details` at all (an unknown id, another tenant's and a soft-deleted one are one answer). Archived → `400 { community: 'archived' }`, the only distinguishable community refusal, and safely so. Active → the insert.
- **A published post cannot move, and the rule is REFUSED rather than ignored.** `communityId` is on `createPostSchema` only; `updatePostSchema` is `.strict()` and has no such key, so an edit body carrying one gets a 400 — and the `update feed_posts set …` statement never names the column even for a caller that assembled its own input.
- **One picker, one composer, and the rule is taught rather than hidden.** `CommunityPickerSheet` is a single list body over the shipped `BottomSheet` whose trailing control is an injected prop — a `Check` here, UI-D-41's `Switch` when 05-08 reuses it — so the two sheets cannot drift on the 44px row, the 32×32 gradient-fallback thumb or the truncation. `/criar` resolves `?comunidade=` on the SERVER, so the row is filled on first paint with no client fetch, and `/post/[id]/editar` renders the same row read-only with its helper.
- **The merged ordering is a visible mix in the seed, not two blocks.** Six posts per tenant are published inside communities at 4, 5, 8, 9, 62.5 and 64.5 minutes back — chosen to fall BETWEEN the tenant-wide fixtures, including two with a half-minute offset inside the filler block so the interleaving is still visible on page 2. A fixture where every community post were older than every tenant-wide one would let an implementation that simply appended the two sources pass the ordering assertion.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 (RED) | The failing community-contract tests | `dc14501` | `packages/modules/feed/tests/community-contract.test.ts` |
| 1 (GREEN) | Third index, the D-73/D-74 switch, the join, `listCommunityFeed`, COMM-04's write | `c82b443` | `packages/modules/feed/{db/schema.ts,contracts/index.ts,server/{service,routes,index}.ts}` |
| 2 | Migration, the fourth EXPLAIN assertion, the community-post seed | `e51465a` | `supabase/migrations/20260923185730_feed_communities.sql`, `supabase/tests/090-feed.sql`, `scripts/seed.ts` |
| 3 (RED) | The failing D-71 label and picker tests | `0f0cae2` | `packages/modules/feed/tests/post-header.test.tsx`, `packages/modules/communities/tests/community-picker-sheet.test.tsx` |
| 3 (GREEN) | The label, the shared sheet, the composer row, the integration and e2e cases | `a343449` | `packages/modules/{feed/ui,communities/ui}/**`, `apps/web/**`, `apps/api/tests/integration/**`, `apps/web/e2e/**` |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `dc14501` `test(05-03)` | Pass — `gsd-tools check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| RED | `0f0cae2` `test(05-03)` | Pass — **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| GREEN | `c82b443`, `a343449` `feat(05-03)` | Pass — 111/111 module-feed, 11/11 module-communities, 400/400 integration, 211/211 pgTAP, 16/16 `comunidades.spec.ts` |
| REFACTOR | — | Not performed; no cleanup was warranted, and the reference commits REFACTOR only on change |

**RED evidence for Task 1, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/community-contract.test.ts --reporter=tap-flat` (cwd `packages/modules/feed`)
- **Exit code:** 1 — 8 tests, 3 pass, 5 fail
- **Target test:** `tests/community-contract.test.ts > D-72 — a destination is chosen at publication and never after > 1. createPostSchema ACCEPTS communityId and keeps the value`
- **Expected:** `createPostSchema` accepts an optional `communityId` and keeps the uuid
- **Actual:** `AssertionError: createPostSchema must accept communityId: expected false to be true` — the `.strict()` schema had no `communityId` key, so the field was an unrecognized key

**RED evidence for Task 3, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/post-header.test.tsx --reporter=tap-flat` (cwd `packages/modules/feed`)
- **Exit code:** 1 — 4 tests, 2 pass, 2 fail
- **Target test:** `tests/post-header.test.tsx > PostHeader — the D-71 community segment (UI-D-36) > 1. renders the time, a middot and the community link when a community is supplied`
- **Expected:** `PostHeader` renders `<time>` + an `aria-hidden` middot + an anchor to the host-built community href, named by the host `aria-label`
- **Actual:** `TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "community-aria-label"` — `PostHeader` had no community segment at all

**Note on the TAP normalizer (a standing environment fact, not a plan artifact).** `check tdd-red-evidence` parses a `node --test` TAP summary; Vitest never emits `# tests` / `# pass` / `# fail`. Both records were built from the REAL captured runs: Vitest's own `tap-flat` reporter supplied the `ok` / `not ok` lines verbatim, and a throwaway script DERIVED the three summary lines by counting those lines. No count was typed by hand.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] The plan's FK mechanism is forbidden by the MOD-02 boundary; the constraint landed as hand-written SQL instead**

- **Found during:** Task 1, before any edit (the plan's `<action>` names the mechanism explicitly)
- **Issue:** The plan says to give `feedPosts.communityId` a `.references(() => communities.id)` and to add `"@tria/module-communities": "workspace:*"` to `packages/modules/feed/package.json`. Verified empirically rather than assumed: with that dependency added, `pnpm turbo boundaries --filter=@tria/module-feed` reports `x Package @tria/module-communities found without any tag listed in allowlist for @tria/module-feed`, pointing at `turbo.json`'s `"module": { "dependencies": { "allow": ["kernel", "contracts", "tooling"] } }`. `packages/boundary-fixture` exists precisely to prove that rule bites, and its own package.json says so ("a `module` depending on another `module` is itself forbidden by turbo.json's tag allowlist"). The plan's acceptance criteria therefore ask for two mutually exclusive facts: the dependency present AND `pnpm boundaries` exit 0.
- **Fix:** The architectural invariant won. `feed_posts_community_fk` is declared in `supabase/migrations/20260923185730_feed_communities.sql` as hand-written SQL appended to the generated half, with a header stating why. The community summary reaches the projection through raw SQL (`left join public.communities`), and the `{ id, name, slug }` shape is declared in the feed's own contracts as `postCommunitySchema` rather than imported from the other module. Loosening `turbo.json`'s allowlist was considered and rejected: Biome's `@tria/module-*/server/*` pattern does not match the published `@tria/module-communities/server` entry point, so the package-graph rule is currently the ONLY thing stopping a module from reaching into another module's server, and weakening it is a Rule-4 architectural change this plan has no mandate for.
- **Files modified:** `packages/modules/feed/db/schema.ts` (docblock + index only), `supabase/migrations/20260923185730_feed_communities.sql`, `packages/modules/feed/contracts/index.ts`
- **Verification:** `feed_posts_community_fk` exists in `pg_constraint` as `FOREIGN KEY (community_id) REFERENCES communities(id)`; `090-feed.sql` asserts it in both directions; `pnpm db:generate` is a no-op; `pnpm boundaries` green (498 files, 8 packages); `pnpm boundaries:negative` green.
- **Unmet acceptance criteria (recorded, not skipped):** `packages/modules/feed/db/schema.ts` contains no `.references(` on `communityId`, and `packages/modules/feed/package.json` does not contain `"@tria/module-communities"`. Both are the direct consequence of this fix, and the `must_haves` truth they served — "`feed_posts.community_id` finally carries a real foreign key to `communities.id`" — is satisfied.
- **Commits:** `c82b443`, `e51465a`

**2. [Rule 1 - Bug] A feed paging assertion still encoded the Phase 4 predicate**

- **Found during:** Task 3, the first integration run
- **Issue:** `feed.test.ts` case 2 closed with "the walk really did see the whole tenant's feed", counted as `… and community_id is null`. That clause was not describing the feed — it was describing the predicate D-73 replaced. The walk returned 56 rows against an expected 50.
- **Fix:** Dropped the clause. The count stays a count of ROWS rather than a literal, so it keeps measuring the walk and not the fixture.
- **Files modified:** `apps/api/tests/integration/feed.test.ts`
- **Verification:** `pnpm test:integration` — 400/400.
- **Commit:** `a343449`

**3. [Rule 1 - Bug] Four e2e cases had pinned page-1 fixture POSITIONS the merged feed moved**

- **Found during:** Task 3, the full Playwright run
- **Issue:** Six new community posts per tenant pushed the demo feed from 27 to 33 posts and moved three fixtures off page 1. `feed.spec.ts`'s sentinel case asserted three pages, and the two like cases plus the 40-character-name case located posts that were now on page 2.
- **Fix:** `seededFeedPaging.total` 27 → 33 with the arithmetic restated in its docblock; the sentinel walk gained its fourth intersection; the three relocated cases scroll once first. The FIXTURE CHOICES were deliberately left alone — `firstFiller` is still the post with no likes and no media, which is what makes "a post nobody has touched shows its time alone" assertable at all.
- **Files modified:** `apps/web/e2e/{fixtures.ts,feed.spec.ts}`
- **Verification:** `playwright test feed.spec.ts` — 23 passed, 3 skipped.
- **Commit:** `a343449`

**4. [Rule 1 - Bug, INHERITED from 05-01] Five nav-array assertions still pinned the kernel-only navigation**

- **Found during:** Task 3, the full Playwright run
- **Issue:** `shell.spec.ts:86`, `phase4-smoke.spec.ts:137` and `:228`, and `phase2-smoke.spec.ts:611` and `:768/:788/:803` asserted `['Início', 'Perfil']`. 05-01 shipped the `Comunidades` tab (D-40, `nav.order: 20`) and updated neither — 05-01's own e2e verification ran `comunidades.spec.ts` alone. Six cases across three files were red BEFORE this plan's first commit and fail identically with or without its diff.
- **Fix:** Updated to `['Início', 'Comunidades', 'Perfil']` at exactly the sites where the tenant has the module on, with the reasoning restated in each docblock. Strictly this is outside 05-03's scope boundary; it was fixed rather than deferred because it is the SAME phase's regression, the correction is mechanical, and leaving three specs red would have made the suite useless as a signal for 05-04 onward. The lab-tenant assertions (`shell.spec.ts:124`, `phase4-smoke.spec.ts:165/:210`) are untouched and still read the kernel-only pair — which now makes the pair a second witness for the module flag.
- **Files modified:** `apps/web/e2e/{shell.spec.ts,phase4-smoke.spec.ts,phase2-smoke.spec.ts}`
- **Verification:** `playwright test shell.spec.ts phase4-smoke.spec.ts phase2-smoke.spec.ts` — 30 passed.
- **Commit:** `a343449`

### Additions beyond the plan's literal wording

- **`FeedList.suppressCommunity`.** The plan asks `PostHeader` for the suppression flag and says the community page passes it. That page renders a LIST, so the flag is threaded through `FeedList` → `PostCard` → `PostHeader` and is a list-level decision: on that page every card shares one community, so a per-item choice would be the same choice repeated and could drift for a single card. 05-04 sets it.
- **`listAllCommunities()` in `apps/web/lib/communities.ts`.** The plan says `/criar/page.tsx` "resolves the community through `apps/web/lib/communities.ts`"; the picker also needs the whole list. It walks the existing keyset (never a second endpoint), caps at 10 pages, and swallows failures into `[]`.
- **`ComposerDraft.community`.** The edit screen's read-only row needs the post's OWN community, not a lookup against the active list — a post whose community has since been archived still has to show where it lives, and an archived container is deliberately absent from that list.
- **A `404` response documented on the feed list route.** `GET /v1/feed?communityId=` can miss, so the OpenAPI document says so.

**Total deviations:** 4 auto-fixed (3× Rule 1 bugs, 1× Rule 3 blocker) plus 4 documented additions. **Impact:** one unmet pair of acceptance-criteria greps, recorded above with the reason; everything else is net-positive — three of the four fixes repaired assertions that had stopped measuring what they name.

## Authentication Gates

None. Everything ran against the local Supabase stack, whose health was verified read-only before Task 2 began (its `<precondition>`).

## Known Stubs

None from this plan. Two absences are deliberate and owned elsewhere, and neither is a stub this plan claims to have closed:

- **`/comunidades/[communityId]` does not exist yet.** D-71's label links to it and the link is correct; the SCREEN is 05-04's. The e2e asserts the href rather than the landing, and says so.
- **`communities.post_count` / `last_activity_at` are still at their insert-time defaults.** 05-01's SUMMARY says "await 05-03's function on `feed_posts`" — that is a mis-attribution: the trigger is 05-04 Task 3's (`supabase/migrations/*_communities_counters.sql`, named in that plan's `<files>` and acceptance criteria). This plan installs no trigger and writes neither column, which is exactly what the schema docblock declares.

## Threat Flags

None. Every file this plan touched sits inside the threat model the plan registered (T-05-12 … T-05-17), and each mitigation is implemented and asserted:

| Threat | Mitigation shipped | Asserted by |
|--------|--------------------|-------------|
| T-05-12 tampering with `communityId` | resolved inside the same `withTenantTx`, with the FK and the tenant predicate beneath it | `feed.test.ts#17` (other-tenant id → 404) |
| T-05-13 id enumeration through the composer | one bare 404 for unknown / foreign / removed, byte-identical apart from the request id | `feed.test.ts#17` |
| T-05-14 a foreign tenant's community name in the label | the left join carries `c.tenant_id = p.tenant_id` | `feed.test.ts#14` (every name matches this tenant's own row) |
| T-05-15 the merged feed at volume | the non-partial index, pinned by name on a volume fixture | `090-feed.sql` (two assertions) |
| T-05-16 posting into a community | the route literal `requirePermission('feed.post.create')`, unchanged | `feed.test.ts#6` (member 403) |
| T-05-17 moving a published post | `communityId` on the create schema only; the edit body is refused | `feed.test.ts#18`, `community-contract.test.ts#4` |

Per T-05-SC, **zero external packages were installed** — and, per deviation 1, not even the first-party `workspace:*` link the plan proposed.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @tria/module-feed typecheck && lint` | pass (39 files) |
| `pnpm --filter @tria/module-feed test` | pass — 111/111 (7 files) |
| `pnpm --filter @tria/module-communities typecheck && lint` | pass (15 files) |
| `pnpm --filter @tria/module-communities test` | pass — 11/11 |
| `pnpm --filter @tria/api typecheck && lint` | pass (60 files) |
| `pnpm --filter @tria/web typecheck && lint` | pass (237 files) |
| `pnpm db:generate` against the committed migration | no-op ("No schema changes"), `git status --porcelain -- supabase/migrations` empty |
| `pnpm db:reset && pnpm db:seed` | pass — FK and all three indexes applied; 6 community posts per tenant |
| `pnpm supabase test db` | pass — 11 files, **211** tests (was 207), `Result: PASS` |
| `pnpm test:integration` | pass — 28 files, **400/400** |
| `pnpm --filter @tria/web exec playwright test comunidades.spec.ts` | pass — 16/16 (mobile + desktop) |
| `pnpm --filter @tria/web exec playwright test feed.spec.ts` | pass — 23 passed, 3 skipped |
| `pnpm --filter @tria/web exec playwright test shell.spec.ts phase4-smoke.spec.ts phase2-smoke.spec.ts` | pass — 30/30 |
| `pnpm boundaries` | pass — 498 files, 8 packages, no issues |
| `pnpm boundaries:negative` | pass — both layers reject the fixture |
| `bash scripts/check-ui-literals.sh` | pass |

## Issues Encountered

Two Playwright cases are FLAKY under full-suite parallelism and pass in isolation. Both are recorded in `.planning/phases/05-communities-stories/deferred-items.md` with the reason they are out of this plan's scope:

- `media-video.spec.ts:491` — a strict-mode violation where the second `[role="dialog"]` is Next.js's own dev Console Error overlay, opened by an `unhandledRejection` in the service-worker registration path when Playwright blocks SW registration. Pre-dates this plan and appears in every spec's web-server log. Passes alone (13/13).
- `platform-branding.spec.ts:130` — a low-contrast warning that had not cleared when a bare `toHaveCount(0)` ran. A Phase 2 surface this plan does not touch. Passes alone (3 passed, 2 skipped).

## Next Phase Readiness

Ready for **05-04** (wave 3), which this plan unblocks on three fronts:

- `feed_posts.community_id` is a real foreign key with real values, so 05-04's `post_count` / `last_activity_at` trigger has something to count. The seed already publishes two posts inside the 60-character community, so archiving it is a real test rather than a no-op.
- `listCommunityFeed` is the statement 05-04's community page reads, `FeedList.suppressCommunity` is the flag it passes, and `communities.region` is still its to add (this plan deliberately did not reuse `feed.region`, per UI-D-46).
- The `400 { community: 'archived' }` branch 05-04's archive semantics need is already shipped and asserted; 05-04 adds the write that produces an archived community.

**D-33 design gate still armed:** sketch 003 reads `approved: false`. This plan is wave 2 and is not gated by it; 05-04 Task 2 is, and its precondition will halt there.

## Self-Check: PASSED

All 6 `key-files.created` entries exist on disk (`[ -f ]`), and all five task commits are reachable in `git log --all`: `dc14501`, `c82b443`, `e51465a`, `0f0cae2`, `a343449`.
