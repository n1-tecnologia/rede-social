---
phase: 04-feed
plan: 08
subsystem: ui
tags: [feed, post-page, share, deep-link, routing, tenant-isolation, web-share-api, clipboard, tdd]

requires:
  - phase: 04-07
    provides: "CommentsList with initialItems/initialCursor/initialError + variant='inline', CommentsListSkeleton, the six comment server actions"
  - phase: 04-06
    provides: "PostActions' present-but-inert onShare seam, lib/feed-view.tsx's postCardView/commentView, the four feed server actions"
  - phase: 04-01
    provides: "lib/feed.ts as the ONE feed fetch implementation, loadPost's 404/400 collapse"
  - phase: 03-05
    provides: "the /membros/[membershipId] three-file route shape and the D-23 one-screen-per-miss precedent"
  - phase: 02-08
    provides: "the alias-to-primary 308 fold (D-35) and resolveHostTenant's primaryHost"
provides:
  - "/post/[postId] — the D-56 share target: sticky header, the FULL PostCard, CommentsList inline, with loading and not-found siblings"
  - "primaryHostOrigin() — the one server-side source of a link that leaves the app (https://{primaryHost})"
  - "PostCardView.shareUrl + PostShareTarget — the composed URL carried to the control, never derived in the browser"
  - "sharePost() — the four-outcome share helper with injected surfaces (shared | dismissed | copied | failed)"
  - "useSharePost() — the client composition point owning the four-result branch table"
  - "the FEED-07 logged-out round trip: a /post/ bounce is remembered and spent at login"
  - "isolation.test.ts case q — post detail: cross-tenant, unknown and removed as one byte-identical 404"
affects: [04-09, phase-05-communities, phase-06-events, phase-07-notifications]

actuals:
  tokens: 18259
  tasks: 3
  commits: 5

plan_head_before: 093a60d26d299275400dbe5fe8d58b732c3470e9

tech-stack:
  added: []
  patterns:
    - "Server-composed outbound URLs: anything a member can send outside the app is built from the VERIFIED primary host in a server context and handed down as a prop"
    - "Injected browser surfaces: a helper that must not reach for the browser's origin takes share/clipboard as parameters, which also makes it provable without a DOM"
    - "Client composition shells: a server composition point may cross into one thin 'use client' shell per surface purely to bind a hook-backed handler, deciding nothing itself"
    - "Indistinguishable-miss assertions are EQUALITIES between two renderings, not two checks against a literal"

key-files:
  created:
    - "apps/web/app/(app)/post/[postId]/page.tsx"
    - "apps/web/app/(app)/post/[postId]/loading.tsx"
    - "apps/web/app/(app)/post/[postId]/not-found.tsx"
    - "apps/web/components/feed/PostDetail.tsx"
    - "apps/web/components/feed/FeedSurface.tsx"
    - "apps/web/components/feed/useSharePost.ts"
    - "apps/web/lib/continue-path.ts"
    - "packages/modules/feed/ui/sharePost.ts"
    - "packages/modules/feed/tests/share.test.ts"
    - "apps/web/e2e/feed-share.spec.ts"
  modified:
    - "apps/web/lib/tenant-host.ts"
    - "apps/web/lib/feed-view.tsx"
    - "apps/web/lib/feed.ts"
    - "apps/web/lib/registry.tsx"
    - "apps/web/proxy.ts"
    - "apps/web/app/(auth)/entrar/actions.ts"
    - "apps/web/app/(app)/inicio/feed-actions.ts"
    - "apps/web/messages/pt-BR/feed.json"
    - "packages/modules/feed/ui/PostCard.tsx"
    - "packages/modules/feed/ui/FeedList.tsx"
    - "packages/modules/feed/ui/index.ts"
    - "apps/api/tests/integration/isolation.test.ts"
    - "apps/web/e2e/admin.ts"

key-decisions:
  - "The share URL is https://{primaryHost}/post/{id} composed server-side per request — resolved independently in the home slot, the load-more action and the post page, so a card appended by the sentinel carries the same link a server-rendered one does"
  - "The share scheme is https unconditionally (UI-SPEC), so on the local stack the copied link is https://tria-demo.localhost/post/{id} while the tab sits on :3000 — correct about the tenant, deliberately not a dev convenience"
  - "A post with no share URL keeps its control present but INERT rather than removing it, preserving 04-06's fixed three-control action-row geometry; the security property (no wrong-origin link) is fully preserved either way"
  - "The FEED-07 round trip needed a return-path mechanism that did not exist: an HttpOnly, 10-minute cookie scoped to /post/ paths only, re-validated at use by safeContinuePath"
  - "The byte-identical 404 assertion strips requestId — the one field that legitimately differs between two calls — which is what makes the rest of the comparison meaningful rather than always-false"
  - "postCardLabels and feedCommentsProps are exported from registry.tsx as the shared label blocks; the DATA mapping stays in lib/feed-view.tsx so the registry ↔ feed-actions cycle 04-06 broke is not recreated"

patterns-established:
  - "Outbound-URL composition: primaryHostOrigin() is the only source; a null origin yields a null shareUrl and no affordance, never a guessed host"
  - "Four-outcome interaction helpers: a dismissal is a first-class resolved value, not a rejection, so the caller's branch table is total and needs no catch"
  - "Deep-link return path: only routes meant to travel outside the app are remembered across login, and the stored value is re-validated against that same predicate at use"

requirements-completed: [FEED-07, UI-02]

coverage:
  - id: D1
    description: "/post/[postId] renders the same PostCard the feed renders, with CommentsList inline beneath it and a sticky header at stickyTop=0px"
    requirement: "UI-02"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-share.spec.ts#2. the post page renders the full card with its comments inline (the positive control)"
        status: pass
      - kind: other
        ref: "pnpm --filter @tria/web build && bash scripts/check-static-routes.sh (route builds as ƒ, absent from the static list)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A cross-tenant post and a post carrying a soft-delete stamp render one byte-identical not-found screen; an id that is not a uuid takes the same screen"
    requirement: "UI-02"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-share.spec.ts#4. another tenant and a removed post render the byte-identical not-found screen"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-share.spec.ts#5. an id that is not a uuid takes the same not-found screen"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#q. the post detail: cross-tenant, unknown and removed are ONE byte-identical 404 (T-04-49)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A shared /post/{id} link opened logged out routes through login and lands back on the post"
    requirement: "FEED-07"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-share.spec.ts#1. a logged-out visitor is routed through login and lands on the post"
        status: pass
    human_judgment: false
  - id: D4
    description: "The share control resolves to one of four outcomes, with the dismissal silent and the clipboard untouched on it"
    requirement: "UI-02"
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/share.test.ts (8 cases: shared, dismissed x2, share-fails-copy, share-fails-copy-denied, no-share-copy, no-share-denied, neither-surface)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The copied link carries the tenant's verified primary-host origin, never the browser's current one, and raises the copied toast"
    requirement: "FEED-07"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-share.spec.ts#3. the share control copies the tenant primary-host link and toasts (real clipboard permissions, both projects)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The NATIVE OS share sheet carries the /post/{id} link on the tenant's own host, on a real iPhone and a real Android device"
    requirement: "FEED-07"
    verification: []
    human_judgment: true
    rationale: "An OS-level share sheet is outside the browser-automation boundary — Playwright cannot enter it. The clipboard fallback half IS automated (D5); only the native sheet needs a device."

duration: 26 min
completed: 2026-09-23
status: complete
---

# Phase 04 Plan 08: The post page, the share link and the one 404 — Summary

**`/post/[postId]` ships as the FEED-07 share target: the same `PostCard` the feed renders with its comments inline, a share control resolving to four outcomes with the dismissal silent, a URL composed server-side from the tenant's verified primary host, and one byte-identical not-found screen for an unknown id, another tenant's post and a removed one.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-09-23T02:30:40Z
- **Completed:** 2026-09-23T02:56:45Z
- **Tasks:** 3 of 3
- **Files modified:** 23 (10 created, 13 modified)

## Accomplishments

- **The route exists and is permanent-shaped.** `/post/[postId]` is a three-file copy of `/membros/[membershipId]`'s proven shape: the sticky `PageHeader` at `stickyTop="0px"`, the FULL `PostCard` (identical component, no detail variant) and `CommentsList` inline beneath it, plus a loading boundary built from the module's own `FeedCardSkeleton` + `CommentsListSkeleton` so the boundary and the first paint share one geometry. It builds as `ƒ` and `check-static-routes.sh` still reports zero offenders.
- **Every way of missing is one screen.** An unknown id, a post of another tenant and a post carrying a soft-delete stamp all arrive as `loadPost`'s single `not-found`. The e2e asserts the two renderings EQUAL to each other rather than each against a literal, and `isolation.test.ts` case q asserts the three API bodies equal once `requestId` is stripped, with `details` absent and no tenant, caption or id named.
- **The share URL cannot carry an alias host.** `primaryHostOrigin()` composes `https://{primaryHost}` from the verified `tenant_domains` row, in a server context, and is resolved independently by the home slot, the load-more action and the post page — so a card the sentinel appends carries the same link a server-rendered one does. `grep -cE "navigator|window\.|location"` is 0 across `sharePost.ts` and 0 for `location.origin|window.location` across `registry.tsx` and every module UI file.
- **The four outcomes, one of them silent.** `sharePost` resolves `shared | dismissed | copied | failed` and never throws; the dismissal is matched on `error.name` (platforms localise the message) and is the one early return, so a link somebody just declined to share is never copied behind their back. 8 unit cases prove the table without a browser.
- **The link survives the logged-out round trip** — which required building the return path the plan assumed already existed (see Deviations).
- **The isolation suite grew the post-detail matrix** with its positive control in the same test: 370 integration tests pass.

## Task Commits

1. **Task 1: the `/post/[postId]` route and the one not-found screen** — `a0a958a` (feat)
2. **Task 2: the share helper and the server-derived share URL** (TDD)
   - RED — `4a3ca4e` (test): 8 cases, exit 1, 5 failing on assertions about planned behaviour
   - GREEN — `466acfd` (feat): the branch table; 99 module tests pass
   - Wiring — `079874b` (feat): `primaryHostOrigin`, `shareUrl`, the composition point
3. **Task 3: the deep-link e2e and the isolation cases** — `d80744c` (test)

**Plan metadata:** see the `docs(04-08)` commit that follows this file.

## Files Created/Modified

**Created**
- `apps/web/app/(app)/post/[postId]/page.tsx` — the D-56 share target; resolves host, session, share origin and post, collapses every miss to `notFound()`, keeps the transport failure a distinct screen
- `apps/web/app/(app)/post/[postId]/not-found.tsx` — the one miss screen; takes no props and reads no param, so it cannot echo an id or name a tenant
- `apps/web/app/(app)/post/[postId]/loading.tsx` — header chrome + one card skeleton + comment rows, all from the module's own exports
- `apps/web/components/feed/PostDetail.tsx` — the client shell that binds the failed-like toast and the share handler around `PostCard` + inline `CommentsList`
- `apps/web/components/feed/FeedSurface.tsx` — the same shell for `/inicio`'s `FeedList`; adds `onShare` and nothing else
- `apps/web/components/feed/useSharePost.ts` — THE composition point: real surfaces bound, four-result branch table, two toasts
- `apps/web/lib/continue-path.ts` — the `/post/`-scoped deep-link memory and its open-redirect validator
- `packages/modules/feed/ui/sharePost.ts` — the four-branch helper with injected surfaces
- `packages/modules/feed/tests/share.test.ts` — 8 cases, no DOM
- `apps/web/e2e/feed-share.spec.ts` — 5 cases × 2 projects, 10 passed, none skipped

**Modified**
- `apps/web/lib/tenant-host.ts` — `primaryHostOrigin()`
- `apps/web/lib/feed-view.tsx` — `postCardView` takes the origin and emits `shareUrl`
- `apps/web/lib/feed.ts` — `loadPostComments` through the same `getComments` the sheet uses
- `apps/web/lib/registry.tsx` — exports `postCardLabels` / `feedCommentsProps`; renders `FeedSurface`; the "only file that imports module ui" note amended to what still holds
- `apps/web/proxy.ts`, `apps/web/app/(auth)/entrar/actions.ts` — the deep-link bounce and its spend
- `apps/web/app/(app)/inicio/feed-actions.ts` — the sentinel's page resolves its own share origin
- `packages/modules/feed/ui/PostCard.tsx`, `FeedList.tsx`, `index.ts` — `shareUrl`, `PostShareTarget`, the skeleton exports
- `apps/api/tests/integration/isolation.test.ts`, `apps/web/e2e/admin.ts` — the post fixtures and case q

## Decisions Made

1. **`https` unconditionally in the share origin**, per UI-SPEC §Post page contract. On the local stack the copied value is `https://tria-demo.localhost/post/{id}` while the tab sits on `:3000`. Deriving the scheme/port from the request headers would have made dev links clickable, but the value a member sends is for another device, and every registrable host is served over TLS. Correct about the tenant beats convenient in dev.
2. **A post with no share URL keeps an inert control rather than losing it.** The plan's truth says "omit the share control"; 04-06's shipped contract says the action row is always exactly three controls and an absent handler leaves a control present-but-inert. The security property — no link to a wrong origin — holds identically either way, and honouring the shipped geometry contract avoided a layout change nobody asked for. Recorded here because it is a deliberate reading, not an oversight.
3. **The shared item mapping stayed split.** The plan asked for the item-to-props mapping to be exported from `registry.tsx`; the prior-wave rule says a view mapping there recreates the `registry ↔ feed-actions` cycle 04-06 broke. Resolution: the LABEL blocks (`postCardLabels`, `feedCommentsProps`) are exported from `registry.tsx` and read by both surfaces, while the DATA mapping (`postCardView`) stays in `lib/feed-view.tsx`. One source for each, no cycle.
4. **Two thin client shells instead of one.** `FeedSurface` and `PostDetail` exist only because `useToast` is a hook and a server composition point cannot hold one. Neither chooses a label, a route or a datum. `registry.tsx`'s header comment was amended to say precisely which part of "the only file that imports a module's ui package" still holds.
5. **`requestId` is stripped before the byte-identical comparison.** It identifies the call, not the row, and is legitimately unique per request. The test caught this itself on first run — the raw comparison failed — which is a good sign the assertion is measuring something.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] The logged-out round trip had no return path**

- **Found during:** Task 1 (and required by Task 3's first behaviour).
- **Issue:** The plan's FEED-07 truth states that a logged-out visitor "is routed through login by the existing authenticated-layout redirect and lands back on the post" and that "the existing bootstrap-refusal redirect table needs no new entry". The first half is true — `proxy.ts` bounces every private path to `/entrar`. The second half is not: `proxy.ts` clears the query (`target.search = ''`) and `login()` has always ended `redirect('/inicio')`. A shared post link therefore routed through login and dropped the member on the home feed, one navigation short of the post they were sent. Task 3's first behaviour ("lands on that same post page with the post's caption visible") was unsatisfiable as the code stood.
- **Fix:** `apps/web/lib/continue-path.ts` — an `HttpOnly; SameSite=Lax`, 10-minute cookie (`tria_continue`). `proxy.ts` writes it on the unauthenticated bounce, but ONLY for paths matching `^/post/[^/]+$`; the login action reads it, spends it, and redirects there.
  - **Scoped to `/post/` deliberately.** Remembering every private path would silently change where an ordinary login lands (a member who once bounced off `/configuracoes` would later be teleported there) and could have destabilised existing session specs. `/post/{id}` is the only route in the product meant to travel outside it. Widening the predicate is a one-line change.
  - **Open-redirect closed at USE, not at write.** `safeContinuePath` requires a single leading slash, rejects `//host` and `/\host` (both protocol-relative URLs in a browser), rejects control characters and anything over 512 chars, and re-runs the `/post/` predicate — so even an attacker who could set a cookie on this origin cannot steer the login anywhere but that one route shape.
- **Files modified:** `apps/web/lib/continue-path.ts` (new), `apps/web/proxy.ts`, `apps/web/app/(auth)/entrar/actions.ts`
- **Verification:** `feed-share.spec.ts` case 1 on both projects; the 11 existing web unit suites (82 tests) and `logout`/`session` e2e behaviour unchanged.
- **Committed in:** `a0a958a`

**2. [Rule 3 — Blocking issue] `FeedCardSkeleton` was not on the module's public surface**

- **Found during:** Task 1 (the loading boundary).
- **Issue:** `packages/modules/feed/ui/index.ts` exported neither `FeedCardSkeleton` nor `FeedListSkeleton`, so the route's loading boundary could not reuse the card geometry and would have had to hand-draw a second one — the drift the module exports exist to prevent.
- **Fix:** Added both to the barrel.
- **Files modified:** `packages/modules/feed/ui/index.ts`
- **Verification:** `pnpm --filter @tria/web typecheck`; the boundary renders the module's own skeleton.
- **Committed in:** `a0a958a`

**3. [Rule 1 — Test correctness] The byte-identical assertion compared a per-request correlation id**

- **Found during:** Task 3 (first run of isolation case q).
- **Issue:** The first version compared raw response bodies and failed: the error envelope carries `requestId`, which differs on every call by design. Left as written the assertion was always-false and would have been "fixed" later by weakening it to "both are 404" — losing the whole point.
- **Fix:** Compare the envelopes with `requestId` removed, keeping key order and every other field in scope.
- **Files modified:** `apps/api/tests/integration/isolation.test.ts`
- **Verification:** `pnpm test:integration -- isolation` → 370 passed.
- **Committed in:** `d80744c`

**4. [Rule 2 — Coverage] The share case runs on the mobile project too, instead of skipping**

- **Found during:** Task 3.
- **Issue:** The first version skipped the clipboard case on `mobile-chromium`, leaving the plan's mobile clause ("where the Web Share API is not available, the same control falls back to the clipboard rather than failing") unproven and a skipped entry in the report.
- **Fix:** Probed both projects (`typeof navigator.share === 'undefined'` on each, including the iPhone-emulated one) and removed the project skip. The mobile run now IS the fallback proof, on the device profile that would otherwise have taken the native path.
- **Files modified:** `apps/web/e2e/feed-share.spec.ts`
- **Verification:** 10 passed, 0 skipped, both projects.
- **Committed in:** `d80744c`

---

**Total deviations:** 4 auto-fixed (1× Rule 1, 2× Rule 2, 1× Rule 3).
**Impact on plan:** No scope creep. Deviation 1 is the only material addition and it is what makes FEED-07's headline claim true; it is deliberately the narrowest mechanism that does so. The other three are correctness of the plan's own verification.

## Prohibitions — verification status

All five of the plan's `must_haves.prohibitions` moved from `unverified` to verified:

| Prohibition | How it is now held |
|---|---|
| The share URL must never be derived from the browser's own location | `primaryHostOrigin()` is the only source and runs server-side; `grep -cE "navigator\|window\.\|location"` = 0 in `sharePost.ts`, and `location.origin\|window.location` = 0 across `registry.tsx` and every module UI file. Asserted end to end by e2e case 3 (the copied value is `https://tria-demo.localhost/...`, not the `:3000` origin the tab is on). |
| A cross-tenant and a removed post must not render distinguishable screens | e2e case 4 asserts the two renderings EQUAL; isolation case q asserts the three API bodies equal (minus `requestId`), `details` absent, and no tenant/caption/id named. |
| A dismissed native share must not raise an error toast | `sharePost` returns `'dismissed'` as its own value (2 unit cases, one of them proving the clipboard stub was NOT called); `useSharePost` toasts only on `'copied'` and `'failed'`. |
| The post page must not render a different card component from the feed | The page renders `PostCard` through `PostDetail`; `grep -c "PostCardDetail\|DetailCard\|variant=\"detail\""` = 0; both surfaces read one `postCardLabels` block and one `postCardView`. |
| The post page must not be publicly readable | The route is inside `(app)`; `proxy.ts` bounces a session-less visitor (e2e case 1 asserts the `/entrar` redirect); `check-static-routes.sh` reports 0 offenders, so it is never prerendered. |

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: auth-path | `apps/web/lib/continue-path.ts`, `apps/web/proxy.ts`, `apps/web/app/(auth)/entrar/actions.ts` | New post-login redirect target, not present in the plan's `<threat_model>`. Mitigated in-place: `HttpOnly`/`SameSite=Lax`, 10-minute lifetime, written only for `^/post/[^/]+$`, and re-validated at USE against the same predicate plus a same-origin path check (rejects `//host`, `/\host`, schemes, control characters, >512 chars). Worth a second pair of eyes at `/gsd-secure-phase` since it is an authentication-adjacent mechanism introduced as a deviation. |

## TDD Gate Compliance

`type="auto" tdd="true"` on Task 2. Gates present and in order:

- **RED** — `4a3ca4e` `test(04-08): add failing tests for the four-branch share helper`. Genuine, intentional RED: `ui/sharePost.ts` carried the signature and the result union with a stub returning `'failed'`, so 5 of the 8 target tests failed on assertions about the PLANNED behaviour (`expected 'failed' to be 'shared'`), not on a module that could not load. Evidence record classified by `gsd-tools check tdd-red-evidence`: **`RED_EVIDENCE_OK` (`target_test_failed`)** — exit 1, 8 tests, 3 pass, 5 fail, target test `sharePost (FEED-07, UI-SPEC E16) calls the share surface once with the url and title, and resolves "shared"`.
  - *Evidence mechanics, recorded honestly:* the gate parses `node --test` TAP and Vitest emits none, so the run's own `--reporter=json` output was normalised to TAP in the session scratchpad (real test names, real counts, nothing invented, nothing committed) — the same approach 04-02/04-04/04-05/04-06 used.
- **GREEN** — `466acfd` `feat(04-08): implement the four-branch share helper`. Minimal implementation; 8/8 share cases and 99/99 module tests pass.
- **REFACTOR/wiring** — `079874b`. Production wiring of the proven helper (server-composed origin, the module seam, the composition point); tests stayed green throughout.

No gate violations.

## Issues Encountered

None beyond the four deviations above. Two pre-existing `feed-comments.spec.ts` entries report as skipped on `desktop-chromium` — that is 04-07's intentional `mobile-chromium`-only guard ("UI-02 is a phone contract (04-08 owns desktop)"), not a regression; the regression run of `feed.spec.ts` + `feed-comments.spec.ts` + `feed-media.spec.ts` was 40 passed, 0 failed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 04-09** (the composer, the overflow menu's destructive rows and the mobile FAB):

- The post overflow menu's `nav E03` half is wired at the seam only: `PostCard` already raises `onMore(postId)` and `labels.moreOptions` is composed. 04-09 builds the sheet itself.
- `feed.share.copyLink` ("Copiar link") is in the catalog, unused, waiting for 04-09's menu row. The row must call the SAME `useSharePost` handler with the same `post.shareUrl` so the two entry points cannot disagree — the seam is already shaped for it (`PostShareTarget` carries the url with the event).
- `/post/[postId]/editar` (D-57) slots beside this route; `postCardLabels` and `feedCommentsProps` are the blocks it should read.

**Carried to phase UAT (manual):** the NATIVE share sheet on a real iPhone (Safari) and a real Android (Chrome) — open a post, tap share, confirm the sheet carries the `/post/{id}` link on the tenant's own host, send it to yourself and open it logged out. Coverage entry `D6`.

**No blockers.** `FEED_DETAIL_STATEMENT_BUDGET` is untouched (the post page adds no API query beyond `loadPost` + `loadPostComments`, each going through the existing clients), and `seededFeedPaging.total` is unchanged — this plan seeds no new post outside the integration suite's own fixtures, which clean up after themselves.

---
*Phase: 04-feed*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All 10 `key-files.created` paths exist on disk (`[ -f ]`).
- All 5 task commits resolve in `git log --all`: `a0a958a`, `4a3ca4e`, `466acfd`, `079874b`, `d80744c`.
- Plan `<verification>` re-run green: module-feed typecheck/lint/test (99), web typecheck/lint/build, `check-ui-literals.sh`, `check-static-routes.sh` (0 offenders, `/post/[postId]` absent from the static list), `pnpm test:integration -- isolation` (370), `playwright test feed-share.spec.ts` (10 passed, 0 skipped).
