---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 12
subsystem: web
tags: [web, platform-panel, confirm-enable, limits-sheet, D-474, D-478, D-482, UI-D-505]

requires:
  - phase: 09-01
    provides: "the social module key in TOGGLEABLE_MODULES and the Rede social name and description in the platform catalog"
  - phase: 09-06
    provides: "GET and PUT /v1/platform/tenants/{id}/modules/social/settings, the socialSettings contracts and the member media policy the broker reads"
  - phase: 09-07
    provides: "the moderation removal path the module ships with (no dependency in code; ordering only)"
provides:
  - "ModuleToggles extras (ModuleRowExtras: note, disabled, confirmEnable, trailing): a list-agnostic row extension; a confirmEnable row opens the shipped ConfirmDialog (Users icon, default tone) instead of calling the action, off never confirms"
  - "the social row of the Módulos tab: requires-Feed note and locked switch, the enable confirmation naming the tenant and the DEPLOY.md go-live item, and the limits button only while social is on"
  - "apps/web/lib/social-limits.ts: SOCIAL_LIMIT_RANGES from the contract caps, validateSocialLimits, socialLimitsToPatch and socialLimitsFromSettings (MB and bytes both ways, integers only)"
  - "SocialLimitsSheet: the limits form in a BottomSheet (desktopCard from 768px, initialFocus title), saved values on open, video fields only while video is allowed, inline range errors, pending, failed save keeps the sheet open"
  - "saveSocialLimitsAction (re-parses with socialSettingsPatchSchema, PUTs the settings route, 401/403 navigate) and getSocialSettings (never throws, defaults on any failure)"
  - "platformModules.requiresFeed and platformModules.social.{confirm,limits}.* in the catalog, pinned in messages.test.ts"
  - "e2e/social-platform.spec.ts: confirm, cancel, off, Feed-off row, the limits sheet end to end, 320px, a failed save, and the upload broker honoring a cap saved in the sheet"
affects: [09-13]

actuals:
  tokens: 21300
  tasks: 2
  commits: 4

plan_head_before: 21a3db9a9b73f2d7981e3c0d984f4b4b0eb41265
commits: 4

tech-stack:
  added: []
  patterns:
    - "A shared list component stays module-agnostic by taking an optional per-key extras map built on the server from facts and catalog strings"
    - "Pure unit-conversion helper (form units to contract bytes and back) with the bounds taken from the same constants the API validates with"
    - "A read that feeds a form never throws: any failure answers the contract defaults so the form always has values"

key-files:
  created:
    - apps/web/lib/social-limits.ts
    - apps/web/lib/social-limits.test.ts
    - apps/web/components/platform/SocialLimitsSheet.tsx
    - apps/web/components/platform/SocialLimitsSheet.test.tsx
    - apps/web/components/platform/ModuleToggles.test.tsx
    - apps/web/messages/pt-BR/platformModules.social.json
    - apps/web/e2e/social-platform.spec.ts
  modified:
    - apps/web/components/platform/ModuleToggles.tsx
    - "apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx"
    - "apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts"
    - apps/web/lib/platform.ts
    - apps/web/messages/pt-BR/platformModules.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/affected-map.json
    - apps/web/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Planning decision 1 (list-agnostic toggles): ModuleToggles takes an optional extras map keyed by module key; rows without an entry render exactly as before"
  - "Planning decision 2 (confirmation is the component's, the copy is the page's): ModuleToggles opens the ConfirmDialog for a confirmEnable row and holds no social string; the page supplies every label"
  - "Planning decision 3 (pure conversion helper): socialLimitsToPatch, socialLimitsFromSettings and validateSocialLimits live in lib/social-limits.ts and are unit-tested at every boundary and one step either side without a DOM"
  - "Planning decision 4 (ranges from the shared constants): SOCIAL_LIMIT_RANGES derives from SOCIAL_MAX_PHOTOS_PER_POST, SOCIAL_MAX_PHOTO_BYTES, SOCIAL_MAX_VIDEO_SECONDS and SOCIAL_MAX_VIDEO_BYTES, and a unit case proves the patch schema accepts both extremes"
  - "Planning decision 5 (no new column or route): everything called already existed from plan 09-06"
  - "Planning decision 6 (sketch gate): the social row, its confirmation and the sheet follow sketch 012 (approved provisionally 2026-10-19), including the limits button under the description"
  - "The lock on the social switch applies only while it would TURN ON: with Feed off the note always shows, but a tenant that already has social on can still switch it off"

patterns-established:
  - "extras map from the server page: note, disabled flag, confirmation labels and a trailing node, built from enabled-module facts and catalog strings"
  - "A failed-save e2e answers the server action with a 500 rather than aborting it: Next 16.3 holds an action whose request fails at the network level until the browser is back online"

requirements-completed: [SOCIAL-01, SOCIAL-05]

coverage:
  - id: D1
    description: "Tracer: the super_admin turns Rede social on only through the ConfirmDialog (exact title with the tenant name, body pointing at the DEPLOY.md item, 'Ativar Rede social' / 'Cancelar'); Cancel leaves the switch off and writes nothing; Confirm turns it on with the 'Alterações salvas.' toast and the social flag reads on; turning it off needs no dialog"
    requirement: SOCIAL-01
    verification:
      - kind: unit
        ref: "apps/web/components/platform/ModuleToggles.test.tsx (8 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social-platform.spec.ts#1. enabling confirms first, cancel writes nothing, confirm turns it on, off is immediate (mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D2
    description: "With Feed off the social switch is disabled (aria-disabled) and the row note reads 'Ative Feed para usar a Rede social.'; the catalog strings are pinned"
    requirement: SOCIAL-01
    verification:
      - kind: unit
        ref: "apps/web/components/platform/ModuleToggles.test.tsx#a disabled row shows its note, a disabled switch and calls nothing; apps/web/i18n/messages.test.ts#09-12"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social-platform.spec.ts#2. with Feed off the switch is disabled and the row says why"
        status: pass
    human_judgment: false
  - id: D3
    description: "Limits helper: ranges from the contract caps, MB to bytes both ways, per-field range errors at each boundary and one step either side, integers only, video fields skipped while video is off, and the patch is accepted by the API schema at both extremes"
    requirement: SOCIAL-05
    verification:
      - kind: unit
        ref: "apps/web/lib/social-limits.test.ts (17 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Limits sheet: opens on the saved values (defaults for an empty blob), video fields only while 'Permitir vídeo' is on, inline range error per field with the sheet staying open, byte patch on save, 'Salvando…' while pending, closes with 'Limites salvos.', a failed save keeps the sheet open with the generic error toast, no horizontal scroll at 320px"
    requirement: SOCIAL-05
    verification:
      - kind: unit
        ref: "apps/web/components/platform/SocialLimitsSheet.test.tsx (13 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social-platform.spec.ts#3. the button follows the module, the sheet shows saved values, refuses bad ones and saves bytes (mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SOCIAL-05 through the panel to the upload broker: a 1 MB photo cap saved in the sheet on the seeded lab refuses a lab member's 2 MB post photo with the tenant cap and accepts 500 KB; saving 5 MB again accepts the 2 MB photo"
    requirement: SOCIAL-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social-platform.spec.ts#4. a cap saved in the sheet reaches the upload broker (mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The member composer showing 'Até 4 fotos de 1 MB cada.' and refusing a 2 MB photo at pick time, and the visual fit of the row, the dialog and the sheet in light and dark under a tenant brand on a real phone"
    requirement: SOCIAL-05
    verification: []
    human_judgment: true
    rationale: "The composer is plan 09-09, so its half of the walk is not built yet. The visual and real-device check is not something the suite asserts (real-device UAT is blocked locally); the 320px no-scroll check is asserted."
  - id: D7
    description: "D-478: the terms of use, community rules and privacy wording for third-party content stays pending and must be flagged to the user before social is turned on for any tenant"
    requirement: SOCIAL-01
    verification: []
    human_judgment: true
    rationale: "Legal wording is the operator's and is not code; the confirmation only points at the go-live item (written by plan 09-13)."

duration: 15min
completed: 2026-10-20
status: complete
---

# Phase 09 Plan 12: Platform Panel Side of Rede social Summary

**The platform panel turns Rede social on only through a confirmation that points at the go-live checklist and only while Feed is on, and edits a tenant's member media limits in a BottomSheet whose byte values the upload broker then enforces.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-10-20T01:13:07Z
- **Completed:** 2026-10-20T01:28:30Z
- **Tasks:** 2 (a tracer and an auto task, both TDD)
- **Files modified:** 16 (7 created, 9 modified)

## Accomplishments

- `ModuleToggles` gained a per-row extras map and stayed list-agnostic. The `social` row now shows the requires-Feed note with a locked switch, opens the shipped `ConfirmDialog` before turning on (cancel writes nothing, off never asks), and carries the limits button only while the module is on.
- `lib/social-limits.ts` holds the one conversion between the form (photo counts, MB, seconds) and the contract (bytes), with the bounds taken from the same constants the API validates with, so the form and the API cannot disagree.
- `SocialLimitsSheet` opens on the saved values with no skeleton, hides the video fields (and skips their validation) while video is off, shows each range error under its own field and keeps itself open on any failure.
- The e2e spec walks the tracer, the limits sheet, a failed save, 320px, and proves the number saved in the sheet is the number the upload broker enforces for a lab member.

## Task Commits

1. **Task 1 (tracer): confirm-enable, requires-Feed note, trailing control**
   - RED `f65edf10` (test): 5 of 8 cases failed on assertions for the planned behavior, 3 pre-existing behaviors passed
   - GREEN `4d8ece6d` (feat): component, page extras, catalog, spec and affected map
2. **Task 2: the limits sheet, helper, action and the walk to the broker**
   - RED `0ba63083` (test): 29 of 30 cases failed on assertions against an export-only skeleton (the one pass is "the empty skeleton patch is accepted by the schema")
   - GREEN `c635e48f` (feat): helper, sheet, action, fetch, catalog, page wiring and the e2e cases

**Plan metadata:** the docs commit that follows this file (SUMMARY, STATE, ROADMAP, REQUIREMENTS, WINDOWS).

## TDD Gate Compliance

RED then GREEN for both tasks (`test(9-12)` precedes `feat(9-12)` each time). `workflow.tdd_mode` is not enabled in `.planning/config.json`, so `check tdd-red-evidence` was not run; Vitest does not emit the TAP the checker expects and none was fabricated. The RED evidence is the failing run itself: assertion failures on the target tests, not import errors. For Task 2 the RED commit carries a minimal export-only skeleton of the helper and the sheet so the tests fail on assertions rather than on a missing module; the skeleton returns obviously wrong values. No REFACTOR commit (no behavior-neutral cleanup was needed).

## Files Created/Modified

- `apps/web/components/platform/ModuleToggles.tsx` - extras (note, disabled, confirmEnable, trailing) and the confirmation flow
- `apps/web/components/platform/SocialLimitsSheet.tsx` - the limits form in a BottomSheet
- `apps/web/lib/social-limits.ts` - ranges, validation and the form/contract conversion
- `apps/web/lib/platform.ts` - `getSocialSettings` (never throws)
- `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx` - builds the social extras and the sheet
- `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts` - `saveSocialLimitsAction`, `SaveSocialLimitsResult`
- `apps/web/messages/pt-BR/platformModules.json`, `platformModules.social.json`, `apps/web/i18n/messages.test.ts` - the copy and its pins
- `apps/web/e2e/social-platform.spec.ts`, `apps/web/e2e/affected-map.json` - the platform walks, mapped into the platform-panel and catalog-platform groups
- `apps/web/package.json`, `pnpm-lock.yaml` - the workspace link to `@rede-social/module-social`

## Decisions Made

See `key-decisions` (planning decisions 1 to 6 plus the lock rule). One more: a limit saved in whole MB is the only precision the form edits; a stored value that is not a whole MiB (set through the API) reads rounded to the nearest MB in the sheet.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The web app did not depend on `@rede-social/module-social`**
- **Found during:** Task 2 (the plan imports the contracts from `@rede-social/module-social/contracts`)
- **Issue:** `apps/web/package.json` had no entry for the package, so the import could not resolve; plan 09-09 had planned to add it later.
- **Fix:** added `"@rede-social/module-social": "workspace:*"` and ran `pnpm install --offline`; the lockfile gained one workspace `link:` entry and no external package.
- **Files modified:** `apps/web/package.json`, `pnpm-lock.yaml` (outside the plan's `files_modified`)
- **Commit:** `0ba63083`. Plan 09-09's identical edit will be a no-op.

**2. [Rule 1 - Bug avoidance] The social switch is locked only while it would turn ON**
- **Found during:** Task 1 (page extras)
- **Issue:** the plan locks the switch whenever Feed is off. A tenant that already has `social` on and later loses Feed would have a stuck switch it could not turn off.
- **Fix:** with Feed off the note always shows, and `disabled` is set only when `social` is currently off.
- **Files modified:** `modulos/page.tsx`
- **Commit:** `4d8ece6d`

### Design and scope notes (not rule deviations)

- **Limits button position.** The plan text says the trailing control goes "before the pill"; the approved sketch and UI-D-505 put it under the description inside the text column (finding F-6, so it fits at 390px). The sketch won.
- **Per-field hint copy.** The plan asks for a 12/400 helper per field without giving the words. The sheet uses the sketch's proposal, "De {min} a {max}. Padrão: {default}." (`limits.hint`), which sketch 012 marks as not in the Copywriting Contract (finding F-3). Confirm or replace it with the user.
- **Bootstrap check.** The tracer's "the bootstrap lists social" is asserted through the stored `tenant_modules` flag (what the bootstrap reads), because the throwaway tenant has no host to bootstrap from.
- **Failed-save injection.** The plan says "the route aborted". A network-level abort never settles in Next 16.3 (the action waits for the browser to be online again and the button stays on "Salvando…"), so the spec answers the server action with a 500, which rejects the call as the component handles.
- **Composer half of the SOCIAL-05 walk is not asserted.** The member composer is plan 09-09 (repo rule 6), so "Até 4 fotos de 1 MB cada." and the pick-time refusal of a 2 MB photo cannot be tested here. The spec proves the layer under it, the upload broker, with a real lab member token and a cap saved through the sheet. The composer assertion belongs in `social.spec.ts` with 09-09 (recorded in `.planning/WINDOWS.md`).
- **Design-gate approval.** Sketch `012-phase-09-designed-screens` was approved provisionally by the product owner in chat on 2026-10-19 (commit 48c79511); the orchestrator wrote the README approval keys and the MANIFEST row on his explicit instruction ("pode alterar voce mesmo"), not the user's own edit. A designer review is a follow-up (D-33). This plan did not edit anything under `.planning/sketches/`.

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1) plus the notes above. **Impact:** none on scope; the workspace link is the only file outside the plan's list.

## Verification

- `pnpm --filter @rede-social/web exec vitest run lib/social-limits components/platform i18n`: 26 files, 1529 passed.
- `pnpm --filter @rede-social/web typecheck`, `lint` (clean; one pre-existing `info` in `components/dashboard/AlertsBell.test.tsx`, not mine), `bash scripts/check-ui-literals.sh`, `vitest run scripts/e2e-affected.test.ts` (44 passed): green.
- `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 37 of 37 tasks successful (turbo's typecheck depends on the web build, so the build ran; `apps/web/.next` was removed afterwards).
- Playwright against the local stack (Chromium mobile and desktop projects): `social-platform.spec.ts` 8 passed, `social.spec.ts` 30 passed in the same run, `platform-tenants.spec.ts` 17 passed and 1 skipped (the skip is the existing desktop-only case 6).
- **Not run, said plainly:** the `pnpm db:reset && pnpm db:seed &&` prefix of both e2e verify commands. Igor has not consented to a reset in this run, so the specs ran on the existing local database (which carries earlier plans' residue). Logged in `.planning/WINDOWS.md` as `unrun-verify`. The spec restores the lab's `social` settings blob (verified `{}` after the run), removes its pending assets and throwaway tenants.
- Local servers started by Playwright's `webServer` were gone after each run; nothing was left listening on 3000, 8787 or 8788.

## Issues Encountered

None blocking.

## Flag for the user (D-478, T-09-31)

**The legal wording of the terms of use, the community rules and the privacy policy for third-party content is still PENDING and is not code.** The confirmation dialog only points the platform operator at the "Ativar a Rede social" item of `docs/DEPLOY.md` (written by plan 09-13). Flag this to the user before `social` is turned on for any tenant, in production most of all. Members see no re-acceptance screen.

## Known Stubs

None. No placeholder text or empty data flows to the UI from this plan.

## Threat Flags

None new. T-09-30 (a non-`super_admin` editing limits or enabling `social`) stays mitigated by the API's `requireSuperAdmin` on both routes and by the actions going through the platform lane with the same 401/403 navigation; T-09-39 (out-of-range limits through a hand-built request) is held by the form's range check, `saveSocialLimitsAction` re-parsing with the strict `socialSettingsPatchSchema`, and the API validating again; T-09-31 is transferred to the operator as planned.

## Next Phase Readiness

Ready for 09-09 (the member composer, which should add the `module-social` dependency as a no-op and the composer half of the SOCIAL-05 e2e) and for 09-13 (the DEPLOY.md "Ativar a Rede social" item the dialog points to).

## Self-Check: PASSED

- Created files exist (`social-limits.ts`, `social-limits.test.ts`, `SocialLimitsSheet.tsx`, `SocialLimitsSheet.test.tsx`, `ModuleToggles.test.tsx`, `platformModules.social.json`, `social-platform.spec.ts`): FOUND
- Commits `f65edf10`, `4d8ece6d`, `0ba63083`, `c635e48f`: FOUND; `commits: 4` measured from the persisted ledger (`git rev-list --count 21a3db9a..HEAD`)
- RED before GREEN for both tasks (`git log --grep` on `^test\(0*9-0*12\)` and `^feat\(0*9-0*12\)`): confirmed (2 test commits, 2 feat commits)
- Acceptance criteria (greps for `confirmEnable`, `requiresFeed`, `confirm`, `social-platform.spec.ts`, `socialLimitsToPatch`, `saveSocialLimitsAction`, `limits`, `Limites salvos`): PASS
- No attribution trailer in the four commit messages (no Co-Authored-By, no Claude or Anthropic mention): confirmed

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
