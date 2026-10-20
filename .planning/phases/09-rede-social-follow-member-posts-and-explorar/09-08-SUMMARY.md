---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 08
subsystem: web
tags: [web, explorar, chips, empty-states, composer-entry, admin-badge, reels-overlay, D-466, D-471, D-472, D-479, D-481, UI-D-491, UI-D-496, UI-D-509]

requires:
  - phase: 09-01
    provides: "the social module key, social.participate for the member role, social.json is new here"
  - phase: 09-02
    provides: "the follow graph and the two seeded follow edges in rede-lab"
  - phase: 09-04
    provides: "scope=explorar, followsAnyone on an empty first page, Reels 'Todos' with followed members' videos"
  - phase: 09-07
    provides: "the moderator's removal control (removal: 'moderation') and the post-removed log row the moderator's Explorar menu draws"
provides:
  - "apps/web/app/(app)/inicio/tabs.ts: INICIO_TABS (Início first), inicioTabFromParam, inicioTabHref, showsInicioTabs (composed permissions + the social module, never a role)"
  - "InicioTabs: the Início / Explorar chip row over the shipped HubTabs, with the trailing 'Encontrar pessoas' entry for social.participate only (outline sm button from 360px, 44x44 icon link below)"
  - "/inicio?aba=explorar: ExplorarBody (the SAME FeedSurface as Início through the new buildFeedSurface, fed by loadFeed({ scope: 'explorar' }) and the matching load-more and refresh server actions) under its own Suspense and skeleton, with no widgets, no stories strip and no profile nudge"
  - "three server-decided Explorar empty states (follows nobody, follows silent people, moderator) through FeedList's new optional empty node"
  - "composerEntryFor(surface, permissions): content.publish for Início, community and Reels; social.participate for Explorar; all need feed.post.create"
  - "postAdminLabel(post, tf) replacing postAuthorAdminLabel at all six call sites: the Administrador mark follows the stamped audience"
  - "social.json (root social): tabs, find and the three Explorar empty states"
  - "e2e/social.spec.ts (18 cases on two projects + the Reels and post-card rows) and e2e/social-admin.ts"
affects: [09-09, 09-10, 09-11, 09-12, 09-13]

actuals:
  tokens: 25350
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "The feed surface composition is one exported builder (buildFeedSurface) parameterised by scope, canPost rule and an empty node, never a copy per surface"
    - "A surface with several empty reasons decides on the server and hands FeedList a finished node; the list stands its own CTA suppression down when it owns the empty state"
    - "Whose-voice gating of authoring entries is one pure function over the composed permissions, tested without rendering"
    - "A tab registry plus a pure visibility predicate in a React-free module read by page, row and tests"

key-files:
  created:
    - "apps/web/app/(app)/inicio/tabs.ts"
    - "apps/web/app/(app)/inicio/tabs.test.ts"
    - "apps/web/app/(app)/inicio/InicioTabs.tsx"
    - "apps/web/app/(app)/inicio/ExplorarBody.tsx"
    - "apps/web/app/(app)/inicio/ExplorarSkeleton.tsx"
    - apps/web/messages/pt-BR/social.json
    - apps/web/e2e/social.spec.ts
    - apps/web/e2e/social-admin.ts
    - packages/modules/feed/tests/feed-list-empty.test.tsx
  modified:
    - "apps/web/app/(app)/inicio/page.tsx"
    - "apps/web/app/(app)/inicio/feed-actions.ts"
    - apps/web/lib/feed.ts
    - apps/web/lib/registry.tsx
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/feed-view.test.ts
    - "apps/web/app/(app)/comunidades/[communityId]/page.tsx"
    - "apps/web/app/(app)/comunidades/actions.ts"
    - "apps/web/app/(app)/post/[postId]/page.tsx"
    - packages/modules/feed/ui/FeedList.tsx
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/affected-map.json
    - apps/web/lib/reels.test.ts
    - apps/web/components/reels/ReelsOverlay.test.tsx
    - "apps/web/app/(app)/reels/reels-actions.test.ts"

key-decisions:
  - "Planning decision 1 (Explorar is /inicio?aba=explorar): no new route; links and shares stay stable and the BottomNav, which matches the path, keeps Início active on both chips (asserted on the phone nav and the desktop rail)"
  - "Planning decision 2 (HubTabs imported unchanged from the cursos area): InicioTabs wraps it, no lift and no edit to any cursos import"
  - "Planning decision 3 (one surface builder): feedHome is now load + buildFeedSurface(bootstrap, { scope: 'inicio', loaded }); ExplorarBody calls the same builder with scope 'explorar'; the differences are parameters (scope picks the load-more and refresh actions, composerEntryFor picks canPost, empty is a node)"
  - "Planning decision 4 (the empty node is built on the server): ExplorarBody reads the page's followsAnyone and the composed permissions and hands FeedList an EmptyState node; the client infers nothing"
  - "Planning decision 5 (content.publish marks the organization's voice, social.participate the member's): composerEntryFor encodes it once; community page, Reels host and Início use content.publish, Explorar uses social.participate"
  - "Planning decision 6 (social.json is a new root file): this plan owns tabs, find and the three explore blocks; feed.json and the other catalogs are untouched; check-ui-literals stays green"
  - "emptyStaff has no cta key: the UI-SPEC contract says the moderator's empty state has no action, so no dead string was added (the plan's {title, body, cta} triple applies to the two member blocks)"
  - "Início for a viewer who can explore renders the row and the ordinary body unchanged; with social off or for support_tenant the DOM is exactly today's and ?aba=explorar reads as Início"

requirements-completed: [EXPL-01, EXPL-02, EXPL-03, EXPL-04, EXPL-05, EXPL-06, SOCIAL-02]

coverage:
  - id: D1
    description: "Tracer: a lab member sees the Início / Explorar chip row, opens Explorar from the chip and reads the post of the person they follow with the administrator's post absent; the BottomNav keeps Início active; a rede-demo member (social off) has no row and ?aba=explorar reads as Início; unknown or repeated ?aba= reads as Início"
    requirement: EXPL-01
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/inicio/tabs.test.ts (registry order, fallback, hrefs, showsInicioTabs)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-08 Explorar - the chip row and the feed of the people you follow (3 cases, mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Explorar and its sentinel share one fetch: scope is a parameter of getFeed/loadFeed and loadMoreExplorarAction / refreshExplorarAction call the same loadPage with scope 'explorar' behind the same Zod"
    requirement: EXPL-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#a failed next page keeps every loaded card and offers a retry at the sentinel; ...share the one column (page 2 appended through loadMoreExplorarAction)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The three Explorar empty states render the catalog copy chosen by the server (follows nobody, follows a silent member, moderator with no action) and the member ones link to /membros"
    requirement: EXPL-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#a member who follows nobody meets the first empty state...; the moderator's empty state has no action"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/feed-list-empty.test.tsx (6 cases); apps/web/i18n/messages.test.ts#09-08"
        status: pass
    human_judgment: false
  - id: D4
    description: "The composer entry is offered in Início to the admin only, in Explorar to the member only, never on a community page or in the empty Reels to a member, never to support_tenant; read from composed permissions"
    requirement: SOCIAL-02
    verification:
      - kind: unit
        ref: "apps/web/lib/feed-view.test.ts#composerEntryFor (3 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#a lab member is offered the composer in Explorar only...; a member meets no composer on a community page or in the empty Reels; a rede-demo member sees no composer"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts (63 passed, 1 skipped: the older composer-entry assertions still hold)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Administrador mark follows the post's stamped audience: the admin's post keeps it, a member post never wears it, with social off every post keeps today's mark"
    requirement: EXPL-03
    verification:
      - kind: unit
        ref: "apps/web/lib/feed-view.test.ts#postAdminLabel (3 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#the Administrador mark follows the post's audience"
        status: pass
    human_judgment: false
  - id: D6
    description: "Reels over Explorar: a follower's tap on a followed member's video opens the overlay at it, the rail shows the author and no community chip and no follow control, the return arrow closes onto the same card at the same scroll position in Explorar; a moderator's tap opens a video 'Todos' does not hold through the single-post fallback"
    requirement: EXPL-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-08 Reels over Explorar (2 cases, mobile and desktop); reels.spec.ts (Início's overlay, 66 passed with social.spec, 6 skipped)"
        status: pass
      - kind: unit
        ref: "components/reels/ReelsOverlay.test.tsx, lib/reels.test.ts#a member's video as a Reel, reels-actions.test.ts#a moderator's tap"
        status: pass
    human_judgment: false
  - id: D7
    description: "Explorar post-card state rows: text, photo, video and link posts of one member are the one card in the one column, newest first, without a marker; many (sentinel page 2), one (no end-of-list copy), 320px long caption and 40-character name with no horizontal scroll, and the chip row fits at 320px"
    requirement: EXPL-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-08 the post-card rows of Explorar (4 cases, mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Held-out visual backstops: the Phase 3 processando card of a member video, a failed member image or video degrading to the neutral box, and the loading-frame parity of member media with an administrator's"
    verification: []
    human_judgment: true
    rationale: "These are visual comparisons the DOM cannot decide; they are named in the social.spec.ts header as manual checks on a phone-width window against a lab member's Explorar. The 320px DOM check (no horizontal scroll, truncated name) IS asserted."

duration: 25min
completed: 2026-10-20
plan_head_before: 48c7951143617d8201bac0a3df7434c13a3dacd1
commits: 5
status: complete
---

# Phase 9 Plan 08: Explorar in the web Summary

**A member of a tenant with `social` on gets an Início / Explorar chip row and an Explorar feed (followed members and own posts, newest first, three server-decided empty states, an "Encontrar pessoas" way to the directory, Reels over it), the composer entry now shows where its voice belongs (Início for the admin, Explorar for the member, never on a community page or in Reels for a member), and the Administrador mark follows the post's stamped audience, all read from the composed permissions.**

## Performance

- **Duration:** about 25 min
- **Started:** 2026-10-20T00:45:49Z
- **Completed:** 2026-10-20T01:11Z (this SUMMARY and the tracking commit follow)
- **Tasks:** 3 (one tracer, two TDD)
- **Files:** 24 changed in 5 production-or-test commits (1,703 insertions, 58 deletions)

## Accomplishments

- **Tracer (Task 1).** `tabs.ts` is the React-free registry (`INICIO_TABS`, `inicioTabFromParam`, `inicioTabHref`, `showsInicioTabs`). `InicioTabs` wraps the shipped `HubTabs` unchanged and appends the "Encontrar pessoas" entry for `social.participate` only. `lib/feed.ts` gained `scope`, `feed-actions.ts` gained `loadMoreExplorarAction` and `refreshExplorarAction` over the one `loadPage`, and the body of `feedHome` became the exported `buildFeedSurface`. `page.tsx` returns the Explorar body before it loads the widgets, the profile or the nudge, so Explorar opens clean.
- **Empty states, gating and badge (Task 2).** `FeedList` accepts an optional `empty` node; `ExplorarBody` builds one of three `EmptyState` cards from `followsAnyone` and the composed permissions. `composerEntryFor` is applied to Início, Explorar, the community page and the Reels host. `postAdminLabel(post, tf)` replaced `postAuthorAdminLabel` at all six call sites (registry, `feed-actions.ts`, `comunidades/actions.ts`, the community page twice, the post page); nothing in `apps/web` reads the legacy `postingPolicy` flag any more except a comment in `criar/page.tsx` (plan 12 owns it).
- **Reels and state rows (Task 3).** The overlay already preserves the query string and returns with `history.back()`, and the shared `FeedSurface` already carries the `reels` binding, so no production change was needed: the e2e proves the tap, the return to the same card and scroll position, the moderator's fallback and every post-card row.

## Task Commits

1. **Task 1 (tracer, TDD):** RED `452f01f0` (test), GREEN `9f590f96` (feat)
2. **Task 2 (TDD):** RED `6355ce32` (test), GREEN `6277dff3` (feat)
3. **Task 3 (TDD, tests only):** `3df71735` (test); no production change was required (see TDD Gate Compliance)

**Plan metadata:** committed separately (docs: complete plan, then state and roadmap).

## TDD Gate Compliance

- **Task 1:** `test(09-08)` `452f01f0` precedes `feat(09-08)` `9f590f96`. RED evidence: a real Vitest run of `tabs.test.ts` and the catalog cases failed 18 of 1,246 tests on assertions (for example `expected 'inicio' to be 'explorar'`, `expected undefined to be 'Áreas do início'`), normalized through a throwaway scratchpad script into the TAP shape and checked with `gsd-tools check tdd-red-evidence`: **RED_EVIDENCE_OK**. `tabs.ts` shipped as an inert, self-documented stub in the RED commit (a new module cannot produce a valid RED from an import failure), fully replaced in GREEN. GREEN: the same files, 1,309 passed.
- **Task 2:** `test(09-08)` `6355ce32` precedes `feat(09-08)` `6277dff3`. RED evidence for `feed-list-empty.test.tsx`: 2 of 6 failed on assertions (`Unable to find an element with the text: host-empty-node`, `expected null not to be null` for the floating composer control), the other 4 are negative controls: **RED_EVIDENCE_OK**. The `feed-view.test.ts` cases (`postAdminLabel`, `composerEntryFor`) failed 6 of 23 with `TypeError: ... is not a function` (new exports of an existing module, no stubs shipped); that is a missing-export failure rather than a value assertion, so it was not the target test of the evidence record. GREEN: module-feed 307 passed, web `lib components/feed i18n` 2,426 passed.
- **Task 3: no genuine RED.** The behaviour (Reels over Explorar, the moderator fallback, the post-card rows) is delivered by Task 1's shared surface and by the 05.3 overlay, so the new unit cases and the e2e passed the first time they ran. Per the 04-03 precedent no evidence record was invented. There is no `feat(09-08)` commit for Task 3 because no production line changed.
- Gate counts at the end: `^test\(0*9-0*8\):` 3 commits, `^feat\(0*9-0*8\):` 2 commits, no REFACTOR commit.

## Files Created/Modified

- `apps/web/app/(app)/inicio/tabs.ts`, `tabs.test.ts` - the chip registry, the pure visibility predicate and their cases
- `apps/web/app/(app)/inicio/InicioTabs.tsx` - the chip row plus "Encontrar pessoas"
- `apps/web/app/(app)/inicio/ExplorarBody.tsx`, `ExplorarSkeleton.tsx` - the Explorar body, its three empty nodes and its three-card skeleton
- `apps/web/app/(app)/inicio/page.tsx`, `feed-actions.ts` - the page branch; the scoped `loadPage` and the two Explorar actions; the per-post badge
- `apps/web/lib/feed.ts`, `registry.tsx`, `feed-view.tsx`, `feed-view.test.ts` - `scope`; `buildFeedSurface`; `postAdminLabel`, `composerEntryFor`
- `apps/web/app/(app)/comunidades/actions.ts`, `comunidades/[communityId]/page.tsx`, `post/[postId]/page.tsx` - per-post badge; the community `canPost` gate
- `packages/modules/feed/ui/FeedList.tsx`, `tests/feed-list-empty.test.tsx` - the `empty` slot
- `apps/web/messages/pt-BR/social.json`, `i18n/messages.test.ts` - the new catalog root and its pins
- `apps/web/e2e/social.spec.ts`, `social-admin.ts`, `affected-map.json` - the first social end-to-end spec, its fixtures, and the guard's map (`social.spec.ts` in `feed-web`, plus a `catalog-social` group)
- `apps/web/lib/reels.test.ts`, `components/reels/ReelsOverlay.test.tsx`, `app/(app)/reels/reels-actions.test.ts` - the Reels-over-Explorar unit cases

## Decisions Made

Planning decisions 1-6 were followed as written (see `key-decisions`). Beyond them: the moderator's empty state carries no `cta` key, and the collapsed "Encontrar pessoas" control is a link (deviation 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A new e2e fixture file the plan did not list**
- **Found during:** Task 1 (the spec needs member posts, follow edges and a photo post)
- **Issue:** `createFeedPostAs` and `createVideoPostAs` insert the organization's default audience; nothing in `e2e/admin.ts` stamps a member post, follows, or writes a gallery post. Editing the shared `admin.ts` would send nearly every spec to the "all" selection of the affected-map guard.
- **Fix:** `apps/web/e2e/social-admin.ts` with its own connection (the `feed-admin.ts` posture): `markAsMemberPost`, `followMember`, `deleteFollowsOfPrefix`, `createMemberPhotoPostAs`. The posts are still created with the shared helpers and then stamped.
- **Files modified:** `apps/web/e2e/social-admin.ts` (new)
- **Verification:** `scripts/e2e-affected.test.ts` 44 passed; fixtures are gone from the database after every run (checked with counts)
- **Commit:** `9f590f96`, `3df71735`

**2. [Rule 1 - Bug avoided] The collapsed control is an `<a>`, not an `IconButton`**
- **Found during:** Task 1 (`InicioTabs`)
- **Issue:** the plan says a 44x44 `IconButton`, which renders a `<button>`; the target is a route, and a button inside an anchor (or the reverse) nests two interactive controls.
- **Fix:** a `next/link` with the `IconButton`'s exact classes (44x44, round, hover and focus ring), `aria-label` equal to the button's text, visible below 360px only. The labelled button is the `buttonClasses` outline `sm` link from 360px.
- **Files modified:** `apps/web/app/(app)/inicio/InicioTabs.tsx`
- **Verification:** e2e asserts one visible "Encontrar pessoas" link at 390px and the icon link at 320px

**3. [Plan note] `FeedSurface.tsx` and `ExplorarBody` needed no Reels change**
- `FeedSurfaceProps` is `Omit<FeedListProps, ...>`, so the new `empty` prop flows through without an edit; the overlay already keeps the query string (`?aba=explorar&reel=`) and pops its own history entry. The plan listed `FeedSurface.tsx` and `useReelsOverlay`'s host as files "to confirm": confirmed unchanged and proved by e2e.

**4. [Scope] Two small additions to the plan's files**
- `reels-actions.test.ts` (not in `files_modified`) gained the moderator-fallback case, because that file already owns `loadReelStartAction`'s cases; `tabs.ts` and `feed-view.tsx` export two pure helpers (`showsInicioTabs`, `composerEntryFor`) so the visibility and gating rules are unit-testable without rendering a server page.

**5. [Verify commands] The `pnpm db:reset && pnpm db:seed` prefix of the three e2e verify commands was NOT run** (project rule 3: no reset without Igor's consent). The same Playwright commands ran against the already-seeded local database (65 feed posts, 2 follow edges, `social` on in rede-lab only) and passed. The commands were: `VIDEO_PROVIDER=fake playwright test social.spec.ts`, `... social.spec.ts comunidades.spec.ts`, `... social.spec.ts reels.spec.ts`. Recorded in `.planning/WINDOWS.md` as `unrun-verify`.

**6. [E2E honesty] The Explorar first-read error card is not asserted in e2e.** The first page is read on the server; Playwright can only fail the browser's own calls. What is asserted: the failed NEXT page keeps every loaded card and offers the inline retry (a server-action POST forced to 500, then a successful retry); the first-read error card is covered by the `FeedList` unit case ("a failed first read still shows the error card, never the slot") and by 04's shipped path. Recorded in `WINDOWS.md` as a deviation.

**7. [Fixtures] Two fixture simplifications.** The "link" post is a text post whose caption holds a URL (no unfurled preview row); the "photo" post has a `ready` image asset whose variant files were never uploaded, so the card shows its frame and the image request fails (the shipped neutral-box path). Both prove the card's shape and column, not Storage or the unfurl pipeline.

### Design gate (recorded for `/gsd-verify-work`)

The precondition (sketch `012-phase-09-designed-screens` approved in `.planning/sketches/MANIFEST.md`) passed. The README approval keys and the MANIFEST row were written **by the orchestrator, on Igor's explicit instruction in chat on 2026-10-19 ("pode alterar voce mesmo"), commit `48c79511`**: the approval is provisional, and the designer review is a follow-up (D-33). This plan did not touch anything under `.planning/sketches/`.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug avoided), 5 notes (plan note, scope, unrun verify prefix, e2e honesty, fixture simplifications)
**Impact on plan:** none on behaviour; every must-have truth has a test, and the three honest gaps (unrun reset prefix, first-read error card, visual backstops) are listed.

## Issues Encountered

- `timeout` does not exist on this macOS shell; the Playwright and Vitest runs were started without it.
- The community page's compose control has its own accessible name, so the first community assertions (by the feed's "Criar publicação" name) passed vacuously for a member and failed for the admin; the spec now uses `comunidades.spec.ts`'s `a[href^="/criar?comunidade="]:visible` locator with the admin as the positive control.
- The API logs `stories.highlights_list_failed ... MODULE_DISABLED` while a community page renders on a tenant without `stories` (the throwaway tenants). It is pre-existing noise from the community page, not from this plan.

## Verification Results

- Task 1 verify (automated half): `vitest run inicio/tabs lib/feed i18n scripts/e2e-affected.test.ts` 4 files, 1,309 passed; `@rede-social/web typecheck` clean; `lint` clean; `scripts/check-ui-literals.sh` OK. E2E half: `social.spec.ts` 6 passed (mobile-chromium and desktop-chromium).
- Task 2 verify: `module-feed test` 23 files, 307 passed; module `typecheck` and `lint` clean; web `lib components/feed i18n` 2,426 passed; `social.spec.ts` + `comunidades.spec.ts`: social 18 passed, comunidades 63 passed and 1 skipped (pre-existing skip).
- Task 3 verify: `vitest run components/reels lib/reels app/(app)/reels scripts/e2e-affected.test.ts` 6 files, 192 passed; `social.spec.ts` + `reels.spec.ts`: 66 passed, 6 skipped (the reels spec's own mobile-only and desktop-only skips).
- Phase-level: `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: **37 successful, 37 total** (exit 0). `pnpm boundaries`: 1,669 files in 18 packages, no issues.
- Not run: `turbo run build` (disk), `pnpm db:reset`/`db:seed`, pgTAP and API integration suites (no API or SQL changed), any real-device check.
- `apps/web/.next` (794 MB) was removed at the end; no `next dev`, API dev server or Playwright process is left running.

## Known Stubs

None. The RED commit of Task 1 ships one deliberately inert `tabs.ts`, replaced in the GREEN commit.

## Threat Flags

None new. T-09-26 (an authoring control shown where only the organization may publish) is mitigated by `composerEntryFor` and proved on Início, Explorar, a community page and the empty Reels; T-09-41 (forged scope or cursor) by the shared `feedQuerySchema` Zod in `loadPage` and the constant scope of the two Explorar actions; T-09-33 (Explorar for `social` off or `support_tenant`) by `showsInicioTabs` plus the API's own 404/403 and the silent fallback to Início, proved on rede-demo.

## Observations for later plans (not fixed here)

- **Plan 10 (directory and follow):** "Encontrar pessoas" links to `/membros`; with `social` on, the directory must be open to a member (today's `social`-off redirect to `/perfil` is a plan 10 concern, UI-D-510). The Explorar empty actions and the chip entry already point there.
- **Plan 12 (member composer):** the Explorar FAB and the desktop button link to `/criar`, which still renders the administrator composer; the member variant (no attachments, no community picker, audience line) and the post-publish redirect to `/inicio?aba=explorar` are plan 12's. `criar/page.tsx` still mentions `postingPolicy` in a comment.
- **Open from earlier phases:** the chip row for a moderator shows Explorar; a moderator's card menu "Remover publicação" is 09-07's control and is untouched here.
- **Local database residue:** the specs clean their fixtures (verified by counts); the database was not reset and carries the earlier plans' integration residue, so run `pnpm db:reset && pnpm db:seed` before the next pgTAP run.

## User Setup Required

None - no external service configuration required. `social` was never toggled on a seed tenant; the throwaway tenants were created and removed by the spec. Nothing was pushed.

## Next Phase Readiness

Ready for 09-09. Explorar, the composer-entry rule and the audience badge are in place for the follow button (plan 10), the locked screen (plan 11) and the member composer and platform sheet (plan 12).

## Self-Check: PASSED

- Created files exist (`tabs.ts`, `tabs.test.ts`, `InicioTabs.tsx`, `ExplorarBody.tsx`, `ExplorarSkeleton.tsx`, `social.json`, `social.spec.ts`, `social-admin.ts`, `feed-list-empty.test.tsx`): FOUND
- Commits `452f01f0`, `9f590f96`, `6355ce32`, `6277dff3`, `3df71735`: FOUND
- RED before GREEN for Tasks 1 and 2 (`git log --grep` on `^test\(0*9-0*8\)` and `^feat\(0*9-0*8\)`): confirmed (3 test commits, 2 feat commits)
- Acceptance criteria (greps for `inicioTabFromParam`, `scope`, `loadMoreExplorarAction`, `emptyNone`, `social.tabs`, `social.spec.ts`, `postAdminLabel`, `content.publish`, `empty`, `loadReel`, three or more `Explorar` in the spec): PASS
- No attribution trailer in the five commit messages (no Co-Authored-By, no Claude or Anthropic mention): confirmed

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
