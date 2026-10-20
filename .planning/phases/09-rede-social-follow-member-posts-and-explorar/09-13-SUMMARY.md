---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 13
subsystem: exit-gate
tags: [exit-gate, e2e-smoke, isolation-sweep, deploy-notes, records, validation, D-466, D-467, D-468, D-469, D-470, D-471, D-472, D-473, D-474, D-475, D-476, D-477, D-478, D-479, D-480, D-481, D-482, D-483, D-484]

requires:
  - phase: 09-01..09-12
    provides: "the social module, the follow graph, the stamped audience and the Explorar scope, the locked answer, member media limits, the moderator's removal, the comment notice, the chip row, the member composer, the follow screens and the platform panel row"
provides:
  - "apps/web/e2e/phase9-smoke.spec.ts: the phase's one walk on a fresh reset (platform on, Helena publishes a real photo from Explorar, Alvaro reads it there and not in Inicio, Marcos meets the locked card then follows and reads it, the admin removes it, rede-demo shows none of it), on mobile and desktop"
  - "isolation.test.ts 'phase 09 sweep: explorar and directory': Explorar, Reels Todos, post reads and the directory name nothing of the other tenant, with the wrong-host 403 and a positive control beside every negative"
  - "docs/DEPLOY.md '## Phase 09 release (Rede social)' and the 'Ativar a Rede social' go-live item with five open decisions"
  - "PROJECT.md Key Decisions rows for D-466..D-484 (five groups), the social and feed READMEs as built, the VALIDATION map and sign-off"
affects: [phase-09-verification]

actuals:
  tokens: 28500
  tasks: 3
  commits: 4

plan_head_before: c6d47b99720921da7bdea23758dab6a3368f9c71
commits: 4

tech-stack:
  added: []
  patterns:
    - "A phase smoke walks every ROADMAP success criterion once with a different actor per step on one page, clearing cookies between actors, and checks 'nobody was told' by counting notification rows"
    - "An exit gate that cannot run in one piece (disk) is re-run by project in chunks, with the build cache removed between chunks, and says so"

key-files:
  created:
    - apps/web/e2e/phase9-smoke.spec.ts
  modified:
    - apps/api/tests/integration/isolation.test.ts
    - apps/web/e2e/affected-map.json
    - apps/web/e2e/platform-domains.spec.ts
    - docs/DEPLOY.md
    - .planning/PROJECT.md
    - packages/modules/social/README.md
    - packages/modules/feed/README.md
    - .planning/phases/09-rede-social-follow-member-posts-and-explorar/09-VALIDATION.md
    - .planning/phases/09-rede-social-follow-member-posts-and-explorar/deferred-items.md
    - .planning/WINDOWS.md

key-decisions:
  - "Planning decision 1: the smoke is one file with one walk that reuses the per-plan helpers (social-admin, admin, worker), so a selector changes in one place"
  - "Planning decision 2: the DEPLOY section copies migration names and queue facts from ls and the SUMMARY files, not from the plan"
  - "Planning decision 3: the open decisions sit in the go-live checklist where the operator reads them"
  - "Planning decision 4: VALIDATION nyquist_compliant and wave_0_complete are true, status stays draft with the reason, following the 08.7-13 precedent, because the gate was not one clean pnpm verify exit"
  - "The smoke checks the platform step by state, not by toggling: the seed leaves social on for rede-lab, so it asserts the switch is on and drives the confirmation only if it is off; the confirmation itself is proven by social-platform.spec.ts"

requirements-completed: [SOCIAL-01, SOCIAL-10]

duration: 1h 58m
completed: 2026-10-20
status: complete
---

# Phase 09 Plan 13: Exit Gate Summary

**One walk through every layer of Rede social on a fresh reset, a two-tenant sweep over Explorar, Reels and the directory, the release order and the go-live item written for the developer, and a gate that ran green everywhere Phase 09 is involved, with six out-of-phase e2e failures recorded rather than hidden.**

## Performance

- **Duration:** 1h 58m (09:07Z to 11:05Z)
- **Tasks:** 3 (a tracer, a records task, the gate)
- **Files:** 1 created, 10 modified

## Accomplishments

- `phase9-smoke.spec.ts` walks ROADMAP criteria 1 to 7 in order: the `super_admin` finds Rede social on for rede-lab with its limits button; Helena publishes a real photo through the member composer (worker-derived variants, stamped `followers`); Alvaro reads it in Explorar with like and comment and not in Início, and Helena's video heads his Reels "Todos"; Marcos, a stranger, sees no card in Explorar or Reels, meets only the locked card (the HTML holds the author and not the caption), follows, reads the post and sees Helena's counts and his follow; nobody is notified by the post or the follow; the admin removes the post through the menu and the confirmation, and Alvaro and Marcos get the standard not-found; rede-demo shows no chip row, no composer and a bare not-found for a rede-lab post id.
- The sweep case enables `social` on both tenants and shows each side's Explorar, Reels "Todos", post reads (bare 404, no details) and directory (every membership id, tenant id and display name of the other side searched in the raw body) naming nothing of the other tenant, with the lab follower's 200 beside each negative and the wrong-host 403 `TENANT_HOST_MISMATCH` on the scope read, the Reels read and the directory in both directions.
- `docs/DEPLOY.md` gets the Phase 09 release: the ten migrations in `ls` order, the routes, the API and worker together, the web last, turning it on, smoke checks, the connection-budget note (no new queue), the rollback limit and the manual UAT. The rollback step that matters: turn `social` off for every tenant before rolling the API back, because the restrictive policy then hides member posts even from an older API.
- The "Ativar a Rede social" go-live item and five open decisions are in the Production gate checklist.

## Task Commits

1. **Task 1 (tracer): the walk and the sweep** `96d59d31` (test)
2. **Task 2: DEPLOY.md, PROJECT.md, the two READMEs** `99bf7f7e` (docs)
3. **Task 3: the gate** `c21fe595` (fix: platform-domains case 6) and `c4ad7f18` (docs: VALIDATION, deferred-items, WINDOWS)

**Plan metadata:** the docs commit that follows this file (SUMMARY, STATE, ROADMAP).

## TDD Gate Compliance

Task 1 is a tracer whose deliverable is the test itself; it adds no production code, so there is no RED commit. Both new tests passed on their first run against the shipped code, and they are not vacuous: the smoke asserts the locked card, the removal and the demo not-found against real state, and the sweep carries a positive control beside each negative (the first run of the sweep failed on a bad `limit=50` in my own query, 400, which proves the route is live). `workflow.tdd_mode` is not enabled, so `check tdd-red-evidence` was not run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `platform-domains.spec.ts` case 6 counted two "Desativado" switches**
- **Found during:** Task 3 (the gate, mobile chunk 4)
- **Issue:** Rede social ships OFF (09-01), so a new tenant has three off switches (store, courses, social) and four once Feed is turned off. 09-01 updated the switch count to ten but not these two counts.
- **Fix:** counts 2 to 3 and 3 to 4, title now "ten switches".
- **Files modified:** `apps/web/e2e/platform-domains.spec.ts` (outside the plan's `files_modified`)
- **Verification:** platform-domains plus platform-wizard 18 passed on both projects
- **Commit:** `c21fe595`

**2. [Rule 3 - Blocking] The e2e stage ran out of disk and was re-run in chunks**
- **Found during:** Task 3
- **Issue:** `pnpm verify` reached e2e after db:reset and db:seed, then the web dev server hit ENOSPC (its turbopack cache grew past 4 GB on 6 GB free) at mobile test 244.
- **Fix:** removed `.next/dev`, `.next/cache` and `test-results`, then ran the remaining e2e by project (`mobile-chromium` from `events.spec.ts`, `pixel-chromium`, `desktop-chromium` in full) in chunks of about seven spec files, cleaning between chunks, on the same database, plus `e2e:pwa`.
- **Impact:** there is no single uninterrupted `pnpm verify` exit. This is said in VALIDATION and below.

**3. [Planning-time gap] The plan asks the platform step to turn Rede social on "through the confirmation"**
- The seed leaves `social` on for rede-lab, so the smoke asserts the on state and the limits button and drives the confirmation only if the switch is off. The confirmation is proven by `social-platform.spec.ts` (passes on both projects).

**Total deviations:** 1 Rule 1, 1 Rule 3, 1 note. **Impact:** one file outside `files_modified`; the gate is chunked.

## Gate Results (honest)

`TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify`, with `rm -rf .turbo/cache` and the build caches removed first:

| Stage | Result |
|---|---|
| lint (with `check-ui-literals.sh`) | passed |
| `turbo typecheck build test` | 37 of 37 tasks successful |
| static routes, boundaries, boundaries:negative, lanes | passed |
| pgTAP (`supabase test db`, before integration) | 38 files, 2057 tests, PASS |
| integration (`test:integration`, includes the `phase 09 sweep` cases) | 76 files, 1538 tests passed; reuse-fixture and the root spike passed |
| `db:reset`, `db:seed` | done (authorized for this plan) |
| e2e | **aborted by ENOSPC at test 244**; re-run in chunks, see below |
| `e2e:pwa` | 64 passed, 5 skipped |

**e2e re-run in chunks, same database.** Mobile: first pass through test 243 (3 failures, below) then `events.spec.ts` onward in six chunks; pixel: 11 passed; desktop: all 55 files in eight chunks. Phase 09 specs passed on both projects: `social.spec.ts`, `social-platform.spec.ts`, `phase9-smoke.spec.ts`, `platform-domains.spec.ts` after the fix.

**Failures left, none Phase 09's** (details and proof in `deferred-items.md`):

| Spec | Cause | Recorded in |
|---|---|---|
| `admin-branding.spec.ts:303` (both) | `setTenantLook` stores the look as a jsonb string | 08.6 deferred-items, WINDOWS 88 |
| `platform-branding.spec.ts:223` (both; 3 later cases do not run) | app-icon editor "unreachable logo" step | 08.6 deferred-items |
| `signup.spec.ts:331` (both) | generic-host signup link re-homed by 261012-s0v | 08.3 deferred-items, WINDOWS 84 |
| `admin-members.spec.ts` "role tracer" (both) | substring locator matches "Área de membros" (261019-k7x) | 09-10 deferred-items |
| `profile.spec.ts` x5 (both) | database seeded the same calendar day: the nightly builder counts up to yesterday, so no member snapshot rows exist | deferred-items (this plan) |

For the `profile.spec.ts` cases, moving `joined_at` back two days on the local database (restored exactly afterwards, from a saved copy) made four of five pass on both projects (50 passed). The fifth ("Conteúdo on real data") also needs older posts and likes; the auto-mode classifier refused the bulk update of the feed tables, so that one is the same cause by reading, not by run. Say so before attesting.

## Migration order and expand-only check (EP-29)

The `ls supabase/migrations` order of the ten Phase 9 files matches `social_module_key, social_gate_seam, social_follows, social_functions, feed_social_visibility, feed_social_indexes, feed_social_locked, feed_social_media_gate, media_duration_cap, moderation_post_removed` (diff empty), all after `20261019152008_email_allowlist_hooks.sql`. The `drop table|drop column|rename|alter column .* type` grep over the ten files counts 0. The only `DROP` statements are three `DROP CONSTRAINT` lines (files 1 and 10), each re-added wider. pgTAP ran before integration (EP-31).

## Prohibition ledger (checked once; stays flagged-unverified for the verifier)

- **PR-1** (no route or log exposes another member's follow relations): the social routes are `PUT/DELETE /follows/{membershipId}`, `POST /follows/state`, `GET /me/followers`, `GET /me/following`, `GET /members/{membershipId}` (counts only); `/perfil/seguidores` and `/perfil/seguindo` take no id. The isolation sweep searches the raw list bodies for every id of the other tenant. No log line was audited line by line.
- **PR-2** (the locked answer discloses only the author): `postLockedAuthorSchema` is `.strict()` with exactly `membershipId`, `displayName`, `avatarAssetId`; the smoke asserts the served HTML holds the author's name and not the caption.
- **PR-3** (no notice for a member post or a follow beyond the comment notice): `grep emit(` over `packages/modules/social/server` finds nothing; `feed.post_commented` has one producer (`notifications.ts`); `post.published` returns no intent for `visibility != 'tenant'`; the smoke counts notification rows for Alvaro and Helena before and after the post, the follow and the removal and they do not move.
- **PR-4** (Explorar chronological, following-only): no `like_count desc` or `comment_count desc` in the feed or social server code.
- **PR-5** (a member post never speaks in the organization's voice): the stamped-audience guard is in the post-published resolver and `postAdminLabel` follows the audience (`feed-view.test.ts`); the smoke asserts no Administrador mark on the member card.
- **PR-6** (no personal feed, post count or message placeholder on a profile): the catalog has no "Minhas publicações" (`git grep` over `apps/web/messages` is empty; `SocialList.test.tsx` L11 asserts the lists carry none).

## Consents and notes

- **Design gate.** Sketch `012-phase-09-designed-screens` was approved provisionally by Igor in chat on 2026-10-19 (commit 48c79511); the orchestrator wrote the README approval keys and the MANIFEST row on his explicit instruction ("pode alterar voce mesmo"). Nothing under `.planning/sketches/` was touched or staged. A designer review is still a follow-up (D-33).
- **Database reset.** Igor answered "Yes, reset and run 09-13" on 2026-10-20. The reset and seed ran only on the local Supabase (the first before the smoke, the second inside `pnpm verify`). No remote project, no `supabase db push`, no push to any remote. The reset consent covers nothing else.
- **WINDOWS.** The four social `unrun-verify` rows that waited for this reset (110, 113, 115, 118) are marked fixed; 116 stays open for `profile.spec.ts`; two gate rows were added.
- Nothing is left running (no `next dev`, Playwright server, API or worker); free disk 6.7 GB at the end.

## Flag for the user (D-478, T-09-31) and the open decisions

**The legal wording of the terms of use, the community rules and the privacy policy for third-party content is still PENDING with Igor and is not code.** `docs/DEPLOY.md` now carries "Ativar a Rede social" in the Production gate checklist as a human prerequisite before `social` is turned on for any tenant, production most of all; this plan wrote no legal text. The checklist also records five choices for Igor to accept or overturn: no API rate limiter exists; member uploads draw from half of each tenant media ceiling (`MEDIA_MEMBER_SHARE_OF_CEILING`, 0.5); the owner dashboard's Conteúdo counts member posts while `social` is on; a blocked author's posts are hidden from the moderator too; the comment notice's push banner carries the actor in the body.

## Known Stubs

None. No placeholder text or empty data flows to the UI from this plan.

## Threat Flags

None new. T-09-32 is held by the release order in DEPLOY.md and the migration-order check; T-09-31 is transferred to the operator through the go-live item; T-09-40 is accepted and written down; T-09-07 is held by the sweep, pgTAP 200/201 and the amended files, and the walk.

## Self-Check: PASSED

- Created file exists (`apps/web/e2e/phase9-smoke.spec.ts`): FOUND
- Commits `96d59d31`, `99bf7f7e`, `c21fe595`, `c4ad7f18`: FOUND; `commits: 4` measured from the persisted ledger (`git rev-list --count c6d47b99..HEAD` before this file)
- Acceptance criteria: `Explorar` in the smoke and the smoke in `affected-map.json` PASS; `phase 09 sweep` appears 3 times in `isolation.test.ts` PASS; DEPLOY.md mentions social 116 times and `rate limit` PASS; the Task 2 verify command PASS (including `module-readmes.test.ts`, 17 passed); the Task 3 migration-order, expand-only, `Minhas publicações`, engagement-order and `emit(` checks PASS; `pnpm verify` as a single command did NOT exit 0 (said above)
- No attribution trailer in the four commit messages: confirmed

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
