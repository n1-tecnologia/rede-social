---
phase: 04-feed
reviewed: 2026-09-23T00:00:00Z
depth: standard
status: issues_found
files_reviewed: 130
partitioned: true
parts:
  - file: 04-REVIEW-part-A.md
    scope: packages/**
    files_reviewed: 58
  - file: 04-REVIEW-part-B.md
    scope: apps/api, supabase, scripts
    files_reviewed: 32
  - file: 04-REVIEW-part-C.md
    scope: apps/web/**
    files_reviewed: 40
findings:
  critical: 4
  warning: 39
  info: 26
  total: 69
critical_confirmed_by_orchestrator: 3
critical_downgraded_to_latent: 1
---

# Phase 04 (Feed): Consolidated Code Review Report

## How this review was run

Phase 04's review scope came to **130 files / 1.33 MB** after the standard three-tier
scoping (SUMMARY `key-files` union git diff from `09185d3…^`, minus planning artifacts,
deleted paths, the lockfile, drizzle-kit meta snapshots and binary fixtures). The
code-review workflow warns above 50 files that a single reviewer produces a superficial
pass, so the scope was **partitioned three ways by cohesive area** and reviewed in
parallel. No file was dropped; the three partitions sum to exactly 130.

Finding IDs are namespaced per partition (`A-`, `B-`, `C-`) so nothing collides. **The
detail lives in the three part files** — this document is the index, the merged tally and
the orchestrator's own verification of the blockers.

| Part | Scope | Files | Critical | Warning | Info |
|------|-------|-------|----------|---------|------|
| A | `packages/**` — `@tria/module-feed`, kernel, UI primitives | 58 | 2 | 12 | 9 |
| B | `apps/api/**`, `supabase/**`, `scripts/**` | 32 | 1 | 16 | 7 |
| C | `apps/web/**` | 40 | 1 | 11 | 10 |
| **Total** | | **130** | **4** | **39** | **26** |

## Orchestrator verification of the blockers

Every critical finding was re-checked against the source before being recorded here. One
was downgraded; three stand.

### Confirmed — A-CR-02: `PostCaption` truncates then linkifies

`packages/modules/feed/ui/PostCaption.tsx:27-33`. The code does the opposite of the
comment sitting directly above it:

```ts
// Truncate FIRST, then link: a URL cut in half must not become a clickable half-URL.
const shown = truncated ? caption.slice(0, truncateAt) : caption;
… {linkify(shown)}
```

`linkify` runs `FEED_URL_PATTERN` against the already-sliced string, so the surviving
prefix becomes a real `<a href>`. At `FEED_CAPTION_TRUNCATE_AT`,
`https://exemplo.com.br/artigo/2026` renders collapsed as `href="https://exemplo.com"` —
a **different registrable domain** — and the href changes when the reader taps "… mais".
The unfurl card beside it is built from `firstUrlIn` over the *full* caption, so the card
then describes a different target than the link: exactly the drift `linkify.tsx`'s
docblock says the shared matcher exists to prevent (T-04-43).

The author controls the padding, so they control where the cut lands. In V1 only
`admin_tenant` publishes, which bounds it; in V2, when members post, this is a phishing
primitive. It also splits surrogate pairs.

### Confirmed — C-CR-01: `Promise.allSettled` swallows the feed's refusal redirect

`apps/web/lib/registry.tsx:296-299` wraps home-slot renderers in `Promise.allSettled`.
`loadFeed` (`apps/web/lib/feed.ts:89`) calls `redirect(path)` **deliberately outside** its
try/catch, and its own docblock states why: *"`redirect()` throws in Next 16 and a catch
would swallow it."* `Promise.allSettled` is that catch — the `NEXT_REDIRECT` digest error
becomes a `rejected` result and renders the generic error card.

A `401` / `MEMBERSHIP_BLOCKED` / `TENANT_SUSPENDED` / `TENANT_HOST_MISMATCH` /
`NO_MEMBERSHIP` answer from `GET /v1/feed` on `/inicio` therefore strands the member on
`/inicio` reading "Algo deu errado" instead of navigating to `/entrar`, `/auth/blocked`,
`/auth/suspended`, `/auth/host-mismatch` or `/sem-comunidade`. `requireBootstrap()` covers
the common case, so the live window is the race between the bootstrap call and the feed
call — precisely the window the redirect-outside-the-catch rule exists to close, and which
every other caller closes correctly.

Fix: `unstable_rethrow(result.reason)` (or a `NEXT_`-digest check) before treating a
rejection as a slot failure.

### Confirmed — B-CR-01: media cleanup protects the rows and deletes their objects

`apps/api/tests/integration/media.test.ts:149-172`. `cleanup()` calls
`removeTenantMediaObjects(tenantId)` **first**, which removes every `storage.objects` row
under `<tenantId>/media/%` with no exclusion at all. The `media_assets` row delete
immediately below it *does* carry the 04-04 guard
(`id not in (select media_asset_id from public.feed_post_media)`) — and it is that half's
comment which promises the sweep *"must skip anything a post still points at — otherwise
it … destroys seeded content the e2e measures."* Only the row half was implemented.

Two further consequences noted in Part B: the row delete is scoped only by
`feed_post_media`, so seeded **avatar** assets are deleted, and
`member_profiles_avatar_asset_id_…_fk` is `ON DELETE set null`, so it happens silently with
no FK error; and `media.test.ts` sweeps **both** `tria-demo` and `tria-lab`. One
`pnpm test:integration` run leaves the seed with `media_assets` rows pointing at objects
that no longer exist and zero member photos. This is the most likely root cause of the
cross-spec e2e flakiness already logged in `deferred-items.md`.

### Downgraded to latent — A-CR-01: `setPostLinkPreview`

Part A reported it as a blocker: no `author_user_id` predicate (so it restamps any post in
the tenant and bumps `edited_at`), and it writes `link_preview_id = …::uuid` with no
tenant-lane re-read — the exact construct `updatePost:736-743` was rewritten to avoid,
because referential checks run as the referenced table's owner and do not see RLS.

`grep -rn setPostLinkPreview apps packages` returns **only its declaration
(`service.ts:1419`) and its re-export (`server/index.ts:17`)**. No API route wires it. It
is dead code — a loaded gun on the shelf, not an exploitable hole today. Recommended fix
is still to delete it: 04-09 folded the affordance into `updatePost`'s
`linkPreviewId === null` branch.

## The FK-bypasses-RLS class — resolved

Two executors flagged this during the phase. Part B traced it to ground and the answer is
**real at the schema layer, closed at the service layer**:

Not one foreign key on the five new tables carries `tenant_id`
(`feed_comments.post_id`, the composite `(parent_id, parent_depth)`, `feed_likes.post_id`
/ `comment_id`, `feed_post_media.media_asset_id`, the composite
`(post_id, post_media_kind)`, `feed_posts.link_preview_id`), so referential integrity —
which runs as the referenced table's owner with RLS bypassed — never validates tenancy.
Every user-supplied id was traced through `service.ts` and each one is re-read or
`insert … select`-ed inside the tenant lane. **No live leak.** Recorded as `B-WR-01` as
defense-in-depth work, together with the related observation that all five policies are
`FOR ALL … USING (tenant_id = app.tenant_id())` and say nothing about authorship — so at
the DB layer any member may update or delete any post or comment of their own tenant, with
only the statement's `author_user_id` predicate refusing. The repo already has the stronger
precedent in `member_profiles_self_update`.

## The `continue-path` audit — clean

The other flagged surface (`apps/web/lib/continue-path.ts`, `proxy.ts`, the login action,
introduced by 04-08 outside its plan's threat model) comes back with **no open redirect,
no session-fixation path and no tenant crossing**. `safeContinuePath` is applied at **use**
(`entrar/actions.ts:38`), not only at write; it rejects `//host`, `/\host`, non-`/`
prefixes, control characters and `>512` chars, and re-runs the `/post/[^/]+$` predicate.
The cookie is host-scoped (no `Domain`), tenants are distinct hosts, `primaryHostRedirect`
folds an alias to the primary origin *before* the auth bounce, and the cookie is spent on
use regardless of outcome.

The one real defect is `C-WR-01`: `proxy.ts:218-223` writes `tria_continue` without
`secure`, contradicting the repo's own `lib/supabase/cookie-options.ts` policy
(`secure: NODE_ENV === 'production'`). `TENANT_SLUG_COOKIE` (line 199, one-year lifetime)
has the same gap.

## Warnings worth reading before the next phase

Full detail in the part files. The ones with consequences beyond their own line:

- **A-WR-01/02/03 — SSRF guard gaps.** The mapped-IPv4 fix is correct for the spellings
  tested, but the IPv6 deny list omits `ff00::/8` (multicast, while IPv4 multicast *is*
  blocked), `2002::/16` (6to4 — `2002:7f00:1::` is a routable spelling of 127.0.0.1),
  `2001::/32` (Teredo) and `::/96`. Redirects are unbounded (`redirect: 'follow'` = 20
  hops) where `CLAUDE.md` specifies **≤3** — one line, `maxRedirections: 3` on the Agent.
- **A-WR-09 — a test that proves the code was written, not that it works.**
  `useInfiniteScroll` resolves `scrollRoot.current` during *render*, where it is always
  `null` on first mount, and a ref mutation never re-runs the effect — so the production
  observer is permanently built with `root: null` instead of the shell's scrollport. The
  test hides this by passing a pre-populated `{ current: element }` ref, a shape no real
  DOM ref ever has at render time.
- **A-WR-04/05 — `CommentsList` contradicts its own docblocks.** A failed "load more" sets
  `listError`, which the render chain checks *before* rows, destroying the whole loaded
  page — the header promises "APPEND: every row already on screen keeps its order", and
  `FeedList` gets this right with a separate `pageFailed`. And `confirmDelete` catches its
  own rejection then early-returns, so `ConfirmDialog.onError` is unreachable: a refused
  delete closes the dialog with zero feedback. `PostMenu.confirmDelete` does it correctly.
- **A-WR-08** — double-tap on an already-liked post *unlikes* it while animating a filled-
  heart burst.
- **B-WR-02 — `jobs.test.ts` is a binary file to git.** Verified independently: two raw
  NUL bytes at offsets 2271 and 2681, and `git diff --numstat` reports `-	-`. Its change
  in `6f7631c` shipped with **no reviewable diff** and cannot be three-way merged. Fix is
  `'nul\u0000byte'`.
- **B-WR-03** — seeded post timestamps derive from eight separate `Date.now()` snapshots
  taken across ten GoTrue round trips and ~20 uploads; if elapsed time between the 04-01
  and 04-04 blocks exceeds 60 s the seeded page-1 order changes under tests that name rows
  by position. A second candidate cause for the logged e2e flakiness.
- **B-WR-06/07** — all three query budgets use `toBeLessThanOrEqual`, so regex drift or an
  unloaded `pg_stat_statements` passes at 0; and the "cursors are not interchangeable"
  case asserts two tautologies, never checking the "degrades to page 1" half.
- **B-WR-11** — nothing in `supabase/tests/` asserts the 04-10 removal actually happened.
- **C-WR-02/03/04** — composer: multi-select past `FEED_MAX_IMAGES` uploads every file
  then silently discards the surplus; `mode === 'edit'` without a `postId` falls through to
  `createPostAction` with an update-shaped body; gallery order is never sorted by
  `position` though the contract carries it.
- **C-WR-07/08** — e2e mutate-and-undo pairs are not in `finally`, so one failed assertion
  permanently poisons the shared seed; and `deletePostAssetsSince` captures `startedAt` at
  *module* scope, so it deletes every post asset created in `tria-demo` during the whole
  run. Together with B-CR-01 these are the seed-corruption trio.

## What held up under adversarial reading

Recorded so the next phase does not re-litigate settled ground:

- **Tenant isolation in the service layer** — no tenant comparisons anywhere, bare 404s,
  `withTenantTx` on every path.
- **The declarative constraints** — gallery-XOR-video and the one-level reply cap, both
  enforced by composite FK + CHECK rather than a trigger.
- **`.desc().nullsFirst()`** on both keyset indexes, matching the emitted `order by` in all
  three directions.
- **SQL-side microsecond timestamps**, and `ms.deleted_at is null` in the JOIN condition.
- **Every pgTAP plan count matches the assertions present** (010 = 4, 020 = 73, 030 = 15,
  090 = 35), and **every `throws_ok` SQLSTATE is the one that will genuinely fire** — all
  thirteen in `090-feed.sql` traced through `CHECK` → RLS `WITH CHECK` → indexes → RI
  triggers, and the five `42501` cases in `020` confirmed as RLS, not disguised FK errors.
- **The socket-layer connector** sees IP literals and every redirect hop;
  `assertAllowedUrl` refuses non-http(s) schemes and embedded credentials.
- **Single `apiFetch`**, single feed fetch implementation, `feed-view.tsx` / `registry.tsx`
  split intact with no cycle, no `'use server'` re-export.
- **No raw-HTML sink** anywhere under `packages/modules/feed/ui/**`; no `eval`,
  `innerHTML`, `dangerouslySetInnerHTML`, hardcoded secret or debug artifact in scope.

## Next steps

This review is **advisory** — it does not block phase completion. Nothing here was fixed;
no source file was modified by any reviewer.

```
/gsd-code-review 04 --fix    # auto-apply findings (Critical + Warning by default)
cat .planning/phases/04-feed/04-REVIEW-part-A.md   # packages detail
cat .planning/phases/04-feed/04-REVIEW-part-B.md   # api/db detail
cat .planning/phases/04-feed/04-REVIEW-part-C.md   # web detail
```

`/gsd-secure-phase 04` should run regardless — `workflow.security_enforcement` is on and
the phase has no `SECURITY.md` yet.
