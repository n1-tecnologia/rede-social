---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 26
subsystem: testing
tags: [web, e2e, playwright, written-not-run, direct-chat, safety, ui-gated, sketch-025, D-719, D-722, D-729, D-732]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plans 19 to 25 (Conversas, the report and block screens, the bell rows, the direct thread, the entry points, the story, story-comment and community menus, the administrator's queue)"
provides:
  - "direct-chat.spec.ts: ten cases for the direct conversation, the block, Conversas states and the refusals, listed on both Chromium projects"
  - "safety.spec.ts: thirteen cases walking a report of each subject to the administrator's queue, listed on both Chromium projects"
  - "direct-admin.ts: throwaway-tenant fixtures, real-API helpers and scoped cleanup for both specs"
  - "affected-map.json: both specs registered for the plan selector"
affects: [11-28]

plan_head_before: efd83a93f1e4a99e0b771c32b8a56d8e0b88f1d7
actuals:
  tokens: 36000
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "a Phase 11 spec runs on a THROWAWAY tenant with the modules on before any session exists; the seed tenants and the seeded threads are never touched"
    - "fixtures that are not the case under test are filed through the real API (reports, blocks, direct sends), so the riders, excerpts and bell rows are the API's"
    - "a shipped spec that clicked a comment's trash now opens the row's menu first and finds the same delete row inside it"

key-files:
  created:
    - apps/web/e2e/direct-chat.spec.ts
    - apps/web/e2e/safety.spec.ts
    - apps/web/e2e/direct-admin.ts
  modified:
    - apps/web/e2e/affected-map.json
    - apps/web/e2e/feed-comments.spec.ts
    - apps/web/e2e/moderation.spec.ts
    - apps/web/e2e/phase8-smoke.spec.ts
    - apps/web/e2e/stories.spec.ts

key-decisions:
  - "A throwaway tenant per project and run (not rede-demo): the seed keeps social off in rede-demo and chat off in rede-lab, and the 30 s module-flag cache makes flipping a shared tenant unsafe; a second throwaway tenant with social off covers the social-off case"
  - "The plan's 'enable the modules and restore them' became 'enable them before any session exists and drop the whole tenant', which is the same isolation without ever writing a seeded flag"
  - "Reports, blocks and first direct sends that are only set-up are made through the real API as a member; the cases under test are driven through the screens"
  - "The affected map names the specs in the existing chat, social, members, notifications, moderation, feed, stories and communities groups and adds one safety-web group for the queue, Membros bloqueados, their reads and the safety catalog"

patterns-established:
  - "direct-admin.ts: provisionDirectTenant, dropDirectTenant (foreign-key order, moderation log through session_replication_role = replica), resetDirectState and resetSafetyState between cases"

requirements-completed: [CHAT-06, CHAT-07, MODER-04, MODER-05]

coverage:
  - id: D1
    description: "A direct conversation walked through two browser contexts: profile, empty thread, first send in place with no toast, B's badge count, Conversas with the support row first, the reply seen live"
    requirement: CHAT-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/direct-chat.spec.ts#1. direct tracer (listed on both Chromium projects, typechecked, NOT run)"
        status: unknown
    human_judgment: true
    rationale: "Written and listed only, by the project rule; the run is a manual ledger row of plan 11-28 on Igor's word"
  - id: D2
    description: "The block through the screens: from the incoming message menu, B's closed strip and empty profile zone with no hint of why, A's blocker strip and one-tap Desbloquear, follow pair gone, a refused send and a refused directory follow, the administrator's block, social off, blank Conversas, staff, the lazy start, a voice message heard by the other participant only"
    requirement: CHAT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/direct-chat.spec.ts#2 to 10 (listed, typechecked, NOT run)"
        status: unknown
    human_judgment: true
    rationale: "Written and listed only; the run is a ledger row of plan 11-28"
  - id: D3
    description: "A report from each subject's menu to the queue: comment (ignore and remove), story, member community (archived), direct message (copy only, no link, ignore and block only), author block, the Nova denuncia bell row, two administrators, already-reported, staff, Membros bloqueados, and the not-found screens for a non-moderator and the platform host"
    requirement: MODER-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/safety.spec.ts#1 to 13 (listed, typechecked, NOT run)"
        status: unknown
    human_judgment: true
    rationale: "Written and listed only; the run is a ledger row of plan 11-28"
  - id: D4
    description: "Both specs are registered for the plan selector and the map stays valid"
    requirement: MODER-04
    verification:
      - kind: unit
        ref: "apps/web/scripts/e2e-affected.test.ts"
        status: pass
    human_judgment: false

duration: about 3h of wall clock including two interruptions
completed: 2026-11-20
status: complete
---

# Phase 11 Plan 26: Direct chat and safety end-to-end specs Summary

**Two Playwright specs (ten direct-conversation cases and thirteen report-and-block cases) plus a throwaway-tenant fixture module, written, listed on both Chromium projects, typechecked and registered in the affected map; nothing was run.**

## Performance

- **Tasks:** 3 (one tracer, two auto)
- **Commits:** 7 task commits
- **Files:** 3 created, 5 modified

## Accomplishments

- `direct-chat.spec.ts` (10 cases): the tracer through two contexts; the lazy start and its single not-found screen; the block from the incoming message menu with the `social`-on dialog body, the closed strip (one sentence) and A's `Desbloquear`; the neutral screens of the blocked member (strip, profile zone, directory row with a refused follow that reverts and loses its controls); a send refused mid-session; the administrator's block hiding and restoring the row; `social` off; the blank Conversas card; staff; and a voice message heard by the other participant only (skipped with a reason when ffmpeg is missing).
- `safety.spec.ts` (13 cases): a comment reported and ignored; a comment reported and removed (it leaves the post, the log shows the removal); a story reported from the viewer menu; a community reported and archived; a direct message reported (copy only, no link, only ignore and block, the helper line); the author of a post blocked from the queue; the `Nova denúncia` bell row; two administrators with one winner; a repeated report; the staff viewer without `Bloquear`; Membros bloqueados and the settings rows; the non-moderator and the platform host meeting the not-found screen.
- `direct-admin.ts`: `provisionDirectTenant`, `dropDirectTenant` (foreign-key order, the append-only log through `session_replication_role = replica`), `resetDirectState`, `resetSafetyState`, real-API helpers (`sendDirectAs`, `reportAs`, `blockAs`, `unblockAs`) and read helpers.
- Every string is read from the real catalogs; no pt-BR sentence is written in a spec.

## Task Commits

1. **Task 1 (tracer): the direct conversation tracer** - `6abb5306` (test)
2. **Task 2: block, closed strip, Conversas states, refusals** - `d5e4bf9e` (test)
3. **Task 3: safety spec** - `0fe14994`, `6b80dc8f`, `5dcf27eb` (test); shipped-spec updates `d968f145`; affected map `7932c7b6`

**Plan metadata:** the docs commit that carries this file.

## Deviations from Plan

### Shipped specs updated because a new menu changes a step (extends D-616's rule, listed as a deviation)

- **`feed-comments.spec.ts`** (Rule 1): `deleteOwnComment` first taps `[data-comment-more]`; the reply-has-no-delete assertion opens the menu first so it still reads the menu's rows.
- **`moderation.spec.ts`** (Rule 1): the tracer, the story removal, `removeAsModerator`, the support/member "no delete control" case and the own-dialog parity case each tap `[data-comment-more]` first and read `[data-comment-delete]` inside the row's sheet (the old `:scope > div > div` scoping was dropped because the sheet is a child of the article).
- **`phase8-smoke.spec.ts`** (Rule 1): the moderator removal taps the menu first (this extends the plan's rule to this file, as the orchestrator directed).
- **`stories.spec.ts`** (Rule 1): "a MEMBER's viewer offers the share but no Mais opções" is now "...a Mais opções holding only Denunciar story", because plan 24 shows the control to every viewer of someone else's story; it asserts no delete, highlight or block row. `comunidades.spec.ts` needed no change (the edit-control assertions are about the edit link, not the new menu).

### Other deviations

- **[Rule 3] Throwaway tenants instead of toggling flags on a shared tenant.** The plan says to enable the modules on "the spec's tenant and restore them". The seed tenants are shared and their flags sit in a 30 s cache, so both specs run on throwaway tenants whose flags are written before any session exists and which are dropped whole; nothing seeded is ever written.
- **[Process] The computer slept twice while Task 3 was being written.** The work was resumed from disk and committed in small steps; no content was lost.
- **[Rule 2] `safety.spec.ts` starts the worker (`ensureWorker`)** because the bell row and notification fan-out run off the request path; it is stopped in `afterAll`.

**Total deviations:** 4 shipped-spec edits, 1 fixture-strategy change, 1 process note. **Impact:** none on scope.

## Issues Encountered

- A shipped-spec locator guess I could not verify without running: the `:scope > div > div` scoping the old specs used for comment controls does not necessarily reach into the new sheet, so the edits use the row-level locator. If a run shows a strict-mode violation (the same row's menu opened twice), the row locator is the place to tighten.
- Nothing was run, so every selector is checked only against the component source and the catalogs. Likely first-run adjustments: the toast locator (`[role="status"][style*="safe-top"]`), the dialog names of the block and resolve steps, and radio selection in the report sheet by its label text.

## Known Stubs

None.

## Threat Flags

None. T-11-38 (fixtures left behind) is mitigated by per-case resets and whole-tenant drops; T-11-39 (credentials) by throwaway `.local` accounts, the seed password read from the environment and no printed token; T-11-17 by the sketch guard run before every task.

## Verification

- Sketch guard `grep -q '^approved: true' .planning/sketches/025-phase-11-designed-screens/README.md` passed before each listing.
- `playwright test --list` on `mobile-chromium` and `desktop-chromium`: `direct-chat.spec.ts` (10 cases) and `safety.spec.ts` (13 cases) load, together with the four edited shipped specs (162 entries). **No spec was executed.**
- `grep -c "test("`: 10 in `direct-chat.spec.ts`, 13 in `safety.spec.ts`.
- Affected map: valid JSON naming both specs; `apps/web/scripts/e2e-affected.test.ts` 44 passed; `vitest run e2e scripts` 54 passed.
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --concurrency=4`: 3 tasks passed, including `next build`; `apps/web/.next/cache` removed after.
- `pnpm lint` exit 0; `pnpm boundaries` (2721 files) no issues; `bash scripts/check-ui-literals.sh` OK; `pnpm guard:lanes` OK; `biome check` on every touched file clean.
- Not run: any Playwright spec, the API, the web app, the worker, any `supabase` command, `pnpm db:reset`, `pnpm db:seed`, the whole web unit suite (no file a unit test reads was touched except `affected-map.json`, whose test was run). One read-only catalog query against the local database listed the foreign keys that point at `tenants` so the cleanup order is right.

## Next Phase Readiness

Plan 11-28's ledger can run both specs on Igor's word: `pnpm --filter @rede-social/web exec playwright test e2e/direct-chat.spec.ts e2e/safety.spec.ts` on a seeded local stack with `SEED_PASSWORD`, `SUPER_ADMIN_PASSWORD` (for the platform-host case) and free disk.

## Self-Check: PASSED

- Created files exist: `direct-admin.ts`, `direct-chat.spec.ts`, `safety.spec.ts`.
- Commits `6abb5306`, `d5e4bf9e`, `0fe14994`, `6b80dc8f`, `5dcf27eb`, `d968f145`, `7932c7b6` exist; `git rev-list --count efd83a93..HEAD` was 7 before this SUMMARY; no commit carries a Co-Authored-By line.
- ROADMAP, STATE and REQUIREMENTS were not touched; sketch 025 was only read.
