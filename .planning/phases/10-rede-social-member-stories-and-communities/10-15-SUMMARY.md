---
phase: 10-rede-social-member-stories-and-communities
plan: 15
subsystem: testing
tags: [e2e, exit-gate, manual-proofs, tracer, throwaway-tenant, MCOMM-01, MCOMM-08, MSTORY-01, MSTORY-03, MPUB-01, MPUB-05, MPUB-07, UI-04, D-714, D-706, D-718]

requires:
  - phase: 10-10
    provides: "the backend proof, the seed rows and the social switch matrix"
  - phase: 10-12
    provides: "the Explorar story row, the viewer menus and the member publish screen"
  - phase: 10-13
    provides: "the communities list and the create form for a member"
  - phase: 10-14
    provides: "the creator's community page, composer, lifecycle and the moderator's controls"
provides:
  - "Browser journeys on a phone (Playwright, mobile-chromium): the member story journey, the member community journey, the Explorar row for the three kinds of viewer, the moderator's story and community removal, the platform limit and the social switch"
  - "10-MANUAL-PROOFS.md: nine rows (P1 to P9), all pending, that only Igor can pass"
  - "A measured exit gate run, with the red stages and their causes recorded (see Verification)"
affects: []

actuals:
  tokens: 15400
  tasks: 3
  commits: 5

key-files:
  created:
    - apps/web/e2e/member-journey.ts
    - .planning/phases/10-rede-social-member-stories-and-communities/10-MANUAL-PROOFS.md
  modified:
    - apps/web/e2e/stories.spec.ts
    - apps/web/e2e/comunidades.spec.ts
    - apps/web/e2e/social.spec.ts
    - apps/web/e2e/social-platform.spec.ts

key-decisions:
  - "The journeys run on a THROWAWAY tenant, not on rede-lab: the seed keeps `communities` and `stories` OFF in rede-lab (a member's create controls need `social` AND the owning module), and the API and web tier cache a tenant's module flags for 30 s, so flipping the shared seed tenant mid-suite would corrupt every spec after it. A throwaway tenant gets its flags written before any session exists. The plan named rede-lab and its seeded rows; the seeded member community and story are therefore not read by these specs"
  - "A shared fixture file, `apps/web/e2e/member-journey.ts`, outside the plan's file list: it provisions the tenant (author, follower, stranger, an organization community, the follow edge), writes the member story, member community and community highlight rows directly, and drops everything by the `e2e-10-` prefix (the moderation log rows with `session_replication_role = replica`, the 10-10 pattern, because the log is append-only)"
  - "The three member journeys and the moderation journeys run on mobile-chromium only (`test.skip` on the desktop project, as the plan says `mobile`): the desktop project lists them as skipped"
  - "The `three new moderation rows` are asserted across two tenants (the story row in stories.spec, the community archive and removal rows in comunidades.spec), because the two files provision their own tenants and a shared one would couple them"
  - "The `social` switch case runs on the throwaway tenant and the original state and limit are restored by dropping the tenant, not by writing values back"

patterns-established:
  - "A browser journey that needs a module the seed keeps off provisions a throwaway tenant with its flags written first and sweeps by a prefix"
  - "A dialog confirm button is scoped to the dialog: the closing sheet that opened it still holds a row of the same name for a moment"

requirements-completed: [MCOMM-01, MCOMM-08, MSTORY-01, MSTORY-03, MPUB-01, MPUB-05, UI-04]

duration: about 7h (two long runs of about 40 minutes and 2.6 hours ran in the background)
completed: 2026-11-12
status: partial
plan_head_before: d5753a94fff361a75d3c96aaae4f013adcac3ab5
commits: 5
---

# Phase 10 Plan 15: Browser Journeys, the Exit Gate and the Manual-Proofs Ledger Summary

**The member story, the member community, the moderator's removal, the platform limit and the `social` switch are each proved in a real browser on a phone (22 new cases passing, repeated three times without a flake), the owner's ledger of nine pending proofs is written, and the exit gate was run to the end: every stage before e2e is green, the full e2e stage is red with 118 failures that sit in earlier phases' specs and in the November front, none in a Phase 10 case, and the production-build e2e (`e2e:pwa`) was not reached.**

## Accomplishments

- **Tracer (Task 1, `10 member journey`, 10 cases passing on mobile, 10 skipped on desktop):**
  - `stories.spec.ts`: the author taps their own "+" circle in Explorar, picks a real photo, sees the audience line, publishes and lands on Explorar with "Story publicado."; the circle then opens their stories. A follower sees the author's circle with the unseen name, opens the viewer on the caption and the ring greys on close. A stranger who follows nobody sees no circle for the author.
  - `comunidades.spec.ts`: the author creates a community through the form (audience line visible, "Comunidade criada.", "Criada por você"), publishes a text post from the community page (destination line, "Publicação criada.", back on the community page). The follower and the stranger each see the community AFTER the organization's card with "Criada por {name}", the post on its page, no publish control (no FAB, no "Publicar nesta comunidade", no "+" circle, no edit pencil), and the post in neither Início nor Explorar (the follower's Explorar holds the author's ordinary post as the positive control). The stranger opening `/criar?comunidade={id}` lands on the plain member composer.
  - `social.spec.ts`: the follower finds the author's circle between the chip row and the feed (bounding boxes in order), unseen, beside their own "+" circle and not in Início; the author's own circle is a button that opens their stories; the stranger finds neither the circle nor the post.
- **Moderation and switch (Task 2, `10 moderation and switch`, 4 cases passing on mobile, 4 skipped on desktop):**
  - `stories.spec.ts`: the administrator sees the author's circle in the "Stories dos membros" row without following, opens the viewer, "Mais opções" then "Excluir story", reads the moderator dialog ("A pessoa não é avisada."), confirms, sees "Story excluído.", the circle leaves the row and Moderação lists "{actor} removeu um story de {target}".
  - `comunidades.spec.ts`: the administrator archives the member's community from the creator's form behind the moderator copy ("A pessoa que criou não é avisada."), deletes it from the archived page behind the moderator delete copy, sees "Comunidade excluída." and Moderação lists the removal and then the archive with their kinds.
  - `social-platform.spec.ts`: the platform sheet saves "Comunidades por membro" 2 (stored as `communities.maxPerMember`) and refuses 21 with "Informe um valor entre 0 e 20." and the sheet open; switching `social` off from the panel removes the creator's compose entry, edit pencil, "Criar comunidade" and the Explorar chip row while the community, its post and a highlight story stay readable (the viewer opens), and switching it on (the confirmation first) restores every control.
- **Ledger (Task 3):** `10-MANUAL-PROOFS.md` with P1 to P9, every row `pending`, the rule that only Igor writes `passed`, and a short list of open items recorded elsewhere. `grep -c pending` prints 21; the word `passed` appears once, in the sentence that only Igor writes it.

## Task Commits

1. **Task 1 (tracer):** `eeae4fff` (test): the three member journeys and `member-journey.ts`.
2. **Task 2:** `69675f57` (test): the moderation, switch and limit journeys, and two stale copy pins of the 09-12 limits case (see Deviations).
3. **Fix:** `cde98f2a` (test): the `communities` key of the stored settings type, caught by the web build's type check of the e2e folder (the first exit-gate run stopped on it).
4. **Task 3 ledger:** `006d28b9` (docs).
5. **Docblock:** the commit after it (test) names the byline words ("Criada por {name}") in the community journey's docblock, the artifact check of the plan.

No `Co-Authored-By` trailer and no tool attribution in any of them (`git log d5753a94..HEAD` has zero matches). Nothing was pushed or deployed and no hosted project or database command was used. `.planning/STATE.md` and `.planning/ROADMAP.md` were not touched. This SUMMARY is committed separately; `commits: 5` is measured with `git rev-list --count d5753a94..HEAD` before it.

Task 1 is a tracer and ran green end to end (10 passed) before the expansion tasks: tracer verified, expanding. The `10 member journey` and `10 moderation and switch` cases were each repeated three times (27 passed, no flake), and one real race was found and fixed on the way: the delete confirm button of the moderator dialog resolved to two elements for a moment because the menu sheet that opened it was still closing, so it is scoped to the dialog.

## Verification (observed)

The sketch gate `grep -q '^approved: true' .planning/sketches/020-phase-10-designed-screens/README.md` passed first and was the first clause of every browser verify command.

| Check | Result |
|-------|--------|
| Task 1 verify (`stories.spec.ts social.spec.ts comunidades.spec.ts -g "10 member journey"`, both projects) | 10 passed, 10 skipped (desktop), exit 0; `communities where name like 'e2e-10-%'` prints 0 and no `mj-*` tenant is left |
| Task 2 verify (`stories.spec.ts comunidades.spec.ts social-platform.spec.ts -g "10 moderation and switch"`) | 4 passed, 4 skipped (desktop), exit 0; no residue |
| `social-platform.spec.ts` whole file, both projects | 10 passed, 2 skipped (after the stale pins were fixed) |
| Exit gate, stage 1: `turbo run lint --concurrency=4` plus `check-ui-literals.sh` and `check-dashboard-fixtures.sh` | green (21 packages; two pre-existing Biome warnings in `packages/ui/src/styles/member-skin.css` and one info in `contracts/tests/text.test.ts`) |
| Exit gate, stage 2: `turbo typecheck build test --concurrency=4` | first run RED on my own `social-platform.spec.ts` (TS2339, fixed in `cde98f2a`); second run green, 41 tasks, 0 cached; web 361 files / 8426 tests, core 111 / 1796, contracts 20 / 604, dashboard 27 / 503, courses 16 / 373, feed 26 / 340, ui 17 / 306, stories 16 / 217, notifications 15 / 186, events 12 / 163, store 5 / 169, reels 7 / 152, api unit 11 / 136, payments 6 / 100, communities 9 / 79, social 7 / 67, chat 7 / 45, profile-form 1 / 3, reuse-fixture 1 / 3 |
| Stage 3 to 4: `check:static-routes`, `boundaries`, `boundaries:negative`, `guard:lanes` | green |
| Stage 6: `supabase test db` (pgTAP, after a `db:reset` and `db:seed`) | green: 65 files, 4473 tests, Result PASS |
| Stage 7: `test:integration` (after pgTAP, as the plan requires) | green: api 141 files / 2956 tests, reuse-fixture 1 / 1 |
| Stage 8: `spike:supavisor` | green, 1 test |
| Stage 10: `pnpm e2e` (after a second `db:reset` and `db:seed`) | **RED**: 1195 passed, 118 failed, 214 skipped, 103 did not run, 2.6 h |
| Stage 11: `e2e:pwa` | **not run** (the script stops at the first red stage) |

The stages were run one by one with `--concurrency=4` on the turbo ones (the root `verify` script passes no concurrency flag) behind a disk watchdog; free space never went under 11 GB, and `.next/dev`, `.next/cache`, `.turbo/cache` and the Playwright output were removed afterwards. A final `db:reset` and `db:seed` leaves the local stack seeded.

### The red e2e stage, diagnosed

None of the 118 failures is in a Phase 10 case (every `10 member journey` and `10 moderation and switch` case passed in the full run), and none is in a file this plan wrote. A rerun of the failed tests (`--last-failed`) on a freshly reset and seeded database passed 16 of them (cumulative state: a spec that fails half way leaves a member blocked or a session gone, so later logins land on `/entrar`; stories `2240` and `2370`, social `1555`, `180`, `774`, `1612`, `1653`, comunidades `1035` among them) and reproduced the rest. The reproducing failures group as follows:

- **The November front rework changed the shell and its specs were not updated** (about 35): the phone and rail navigation gained a "Membros" tab to `/area-membros`, the Loja moved out of the tab bar, and `/area-membros` replaced `/cursos`. `shell.spec.ts`, `phase4/5/6-smoke.spec.ts` (the tab list `toEqual` differs by one), `admin-members.spec.ts` (`getByRole('link', {name: 'Membros'})` now resolves to two elements), `store.spec.ts`, `courses-*.spec.ts`, `profile.spec.ts`, `signup.spec.ts`, `branding.spec.ts`.
- **`POST /v1/platform/tenants` answers 400** (about 30: `invite.spec.ts` 12, `platform-tenants.spec.ts` 15, `platform-domains.spec.ts`, `phase2-smoke.spec.ts`, `platform-branding.spec.ts`, `platform-wizard.spec.ts`): the create body requires `projectRef` when the local environment's `PROJECT_PROVIDER` is `supabase` (09.2-14, D-541). Not changed by Phase 10; the Phase 10 platform case provisions its tenant by fixture.
- **Desktop Reels stage never finds a reel page** (`reels.spec.ts` e1/e2/e4/e5/e6/e16, `social.spec.ts` 496/533/1774, `phase9-smoke.spec.ts`, `moderation.spec.ts` "removal on a reel"): `[data-reel-page]:not([inert])` never appears on desktop-chromium.
- **A few timeouts and one 504** under the long run (`events.spec.ts` sign-in 504, `courses-*` 120 s timeouts, one `ERR_CONNECTION_REFUSED` on the dev server).

No baseline run at the commit before Phase 10 was made, so "pre-existing" rests on the error text and on the files: Phase 10 touched none of the nav, the platform create route or the Reels stage. Fixing them belongs to a gap plan, not to this one (plan rule); I did not patch any of them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The journeys cannot run on rede-lab**
- **Found during:** Task 1 (reading the seed)
- **Issue:** the plan runs the tracer on rede-lab with `social` on, but the seed keeps `communities` and `stories` off there, and a member's controls need `social` AND the owning module; flipping flags on the shared tenant mid-suite would also sit in the 30 s caches of the API and the web tier for every spec after it.
- **Fix:** a throwaway tenant per describe, flags written first, swept by prefix (`member-journey.ts`). The plan's key link "relies on the seeded member community and story of rede-lab" is therefore not honoured: the specs create their own rows.
- **Files modified:** `apps/web/e2e/member-journey.ts` (new, outside the plan's file list)
- **Commit:** `eeae4fff`, `69675f57`

**2. [Rule 1 - Stale test] The 09-12 limits case pinned copy that plan 10-11 reworded**
- **Found during:** Task 2 (running the whole `social-platform.spec.ts`)
- **Issue:** the case looked for the dialog "Limites de mídia dos membros" and the footer "Vale só para novos envios. O que já foi publicado não muda."; plan 10-11 changed them to "Limites dos membros" and "Vale só para novos envios e novas comunidades. O que já existe não muda." (UI-D-715), so the case failed on both projects.
- **Fix:** the two pins updated in the plan's own file; the case passes on both projects.
- **Commit:** `69675f57`

**3. [Rule 3 - Blocking] The web build type-checks the e2e folder**
- **Found during:** Task 3 (the first exit-gate run, stage 2)
- **Issue:** `social-platform.spec.ts` read `settings.communities` from a type that did not declare it (TS2339), which failed `@rede-social/web#build`.
- **Fix:** the key added to the file's `StoredSettings` type.
- **Commit:** `cde98f2a`

**4. [Plan wording] The "three new moderation rows" are checked in two tenants**
- The story row is asserted in `stories.spec.ts` and the two community rows in `comunidades.spec.ts`, each on its own throwaway tenant.

**5. [Plan wording] `pnpm verify` was run stage by stage**
- The root script takes no `--concurrency` flag and runs `db:reset` only before e2e; the stages ran in the script's order with `--concurrency=4`, plus a `db:reset` and `db:seed` before pgTAP so integration started from a clean seed. The run therefore is `pnpm verify` in substance, not the single command, and its exit is red.

### Authentication gates

None.

## Defects found

No defect in application code. Observed and not fixed (out of this plan's scope, recorded for the orchestrator):

- The November front rework left the specs listed above stale (navigation, `/area-membros`, Loja off the tab bar).
- `POST /v1/platform/tenants` returns 400 for the platform specs under the local `PROJECT_PROVIDER` (a `projectRef` is required).
- Desktop Reels never renders a reel page in the Playwright run.
- The known Phase 10 open items stay open and unfixed, as expected: with `social` off a loose member story cannot be read or deleted by the moderator (pgTAP 231 section 3); the EP-53 empty-database literal (`db:two --reset --bare`) was never run; a deep link `/stories/[storyId]` still headers a member story with the tenant name; the store product pickers still list member communities.

## Known Stubs

None. The three new e2e helpers write fixture rows only; no application file was changed.

## Threat Flags

None. No network endpoint, auth path or schema was added; the plan changes browser specs, one fixture file and one ledger.

## Issues Encountered

- The e2e stage needs about 9 GiB of disk over its run (the Turbopack dev cache alone reached 4 GiB); free space stayed above 11 GiB with the watchdog armed and never tripped.
- The first `pnpm turbo` attempt failed with `turbo: command not found` (the binary is reached through `pnpm turbo`); the scripted stage was corrected and rerun.

## Next Phase Readiness

- The exit gate is not green, so the phase should not close on an automated pass: the e2e stage needs a gap (or an owner decision) for the stale shell, platform-create and desktop-Reels specs, and `e2e:pwa` still has to run. Every Phase 10 browser case passes, and the proofs only Igor can give are in `10-MANUAL-PROOFS.md`, all pending.

## Self-Check: PASSED

- Files: `apps/web/e2e/member-journey.ts`, the four modified specs, `10-MANUAL-PROOFS.md` and this file exist.
- Commits: `eeae4fff`, `69675f57`, `cde98f2a`, `006d28b9` and the docblock commit exist (`git log d5753a94..HEAD`), none with a trailer.
- Acceptance greps: `10 member journey` in the three specs, `10 moderation and switch` in the three specs, `Seu story` in `stories.spec.ts`, `Criada por` in `comunidades.spec.ts` (docblock), `pending` count 21 in the ledger.
- The exit gate itself is NOT green and this self-check does not say it is.
