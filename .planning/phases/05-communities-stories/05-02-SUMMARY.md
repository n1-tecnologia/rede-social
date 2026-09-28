---
phase: 05-communities-stories
plan: 02
subsystem: design-gate
tags: [design-gate, D-33, D-66, UI-01, UI-04, UI-D-46, copywriting, sketch-003, i18n]

requires:
  - phase: 04-feed
    provides: "the shipped feed catalog rows and the registry.tsx label-composition point the amendment edits"
  - phase: 03-media-profiles
    provides: "MembersList, the media catalog's upload refusals and useSignedUpload's refusal map"
  - phase: 02-tenant-shell
    provides: "getHostTenant() and the x-tenant-* headers proxy.ts writes, which the 404 surfaces now read"
provides:
  - ".planning/sketches/003-phase-05-designed-screens/ — the D-33 / UI-04 review package for the five prototype-less Phase 5 surfaces, ARMED at approved: false"
  - "sketch MANIFEST.md row 003 and the 05-UI-SPEC.md reference point"
  - "The UI-D-46 vocabulary amendment: all 10 shipped catalog rows carrying the retired sense of comunidade"
  - "apps/web/lib/tenant-host.ts tenantDisplayName(shell) — the one rule for naming the tenant from the host shell"
  - "ComposerForm and MembersList tenantName props (the CommunitiesList prop shape, extended)"
  - "apps/web/i18n/messages.test.ts UI-D-46 pins — six {tenant} placeholders and four word-drops"
affects: [05-04, 05-05, 05-06, 05-07, 05-08]

actuals:
  # chars/4 over the realized diff 4d3f6ae..HEAD (146,446 chars), the same scale the estimate used.
  tokens: 36600
  tasks: 3
  # MEASURED: git rev-list --count 4d3f6ae..HEAD was 3 at SUMMARY write (the three task commits);
  # 4 once this metadata commit lands, which is what a later `git rev-list` will read.
  commits: 4
plan_head_before: 4d3f6ae6c184cbb5b9c6f9ea9a92433264ae7008

tech-stack:
  added: []
  patterns:
    - "A review artifact under .planning/ that is ENFORCED rather than declared: the README's approved:false is the fact six downstream tasks grep, not a note a reader is trusted to honour"
    - "A one-word vocabulary change is a whole-repo change: ten catalog rows, six call sites, two new props and nine test/e2e assertions that had pinned the old sentences"
    - "tenantDisplayName(shell) — a single fallback rule for {tenant} on surfaces that hold the HOST but not the bootstrap, so no surface can render an empty interpolation"

key-files:
  created:
    - .planning/sketches/003-phase-05-designed-screens/index.html
    - .planning/sketches/003-phase-05-designed-screens/README.md
  modified:
    - .planning/sketches/MANIFEST.md
    - .planning/phases/05-communities-stories/05-UI-SPEC.md
    - apps/web/messages/pt-BR/feed.json
    - apps/web/messages/pt-BR/app.json
    - apps/web/messages/pt-BR/members.json
    - apps/web/messages/pt-BR/profile.json
    - apps/web/messages/pt-BR/media.json
    - apps/web/i18n/messages.test.ts
    - apps/web/lib/registry.tsx
    - apps/web/lib/tenant-host.ts
    - apps/web/app/(app)/inicio/page.tsx
    - apps/web/app/(app)/criar/ComposerForm.tsx
    - apps/web/app/(app)/criar/page.tsx
    - apps/web/app/(app)/post/[postId]/editar/page.tsx
    - apps/web/app/(app)/post/[postId]/not-found.tsx
    - apps/web/app/(app)/membros/page.tsx
    - apps/web/app/(app)/membros/MembersList.tsx
    - apps/web/app/(app)/membros/[membershipId]/not-found.tsx
    - apps/web/components/media/AvatarUploadField.test.ts
    - apps/web/e2e/shell.spec.ts
    - apps/web/e2e/feed.spec.ts
    - apps/web/e2e/feed-media.spec.ts
    - apps/web/e2e/feed-composer.spec.ts
    - apps/web/e2e/members.spec.ts
    - apps/web/e2e/media-video.spec.ts

key-decisions:
  - "UI-D-46 ships a 6/4 split, not the spec's 4/6. `media.errors.quota` drops the word instead of gaining `{tenant}`: it resolves in `useSignedUpload`, whose platform-panel callers (`LogoUpload`, `IconOverrideUpload`) run as `super_admin` on `app.seusistema.com`, where no tenant display name exists. USER-APPROVED at a decision checkpoint (Option C)."
  - "Two client components gain ONE `tenantName` prop each rather than reaching for the tenant themselves. `ComposerForm` takes it from `/criar` and `/post/[postId]/editar` (both already await `requireBootstrap()`); `MembersList` takes it from `membros/page.tsx` (already calls `getHostTenant()`). This is the prop shape 05-01 gave `CommunitiesList`."
  - "The two 404 components read the tenant, and their existence-oracle guarantee is unchanged. They still take no props and read no param, so the requested id can never be echoed. Only the 'reads no tenant cannot name one' clause changed, and safely: a host-derived name is byte-identical across all three (post) / five (membership) causes."
  - "`tenantDisplayName(shell)` centralises the fallback: the display name on a tenant host, the host itself otherwise. An empty string would have rendered 'entrarem em , elas aparecem aqui' — a hole in a sentence is worse than a hostname."
  - "The plan's file list named `MediaAssetRow.tsx` for `media.errors.quota` and `registry.tsx` for `app.home.soonBody`. Neither is where those strings resolve. The real sites are `useSignedUpload.ts` and `inicio/page.tsx`, verified by grep before any edit."
  - "`feed.region` becomes 'Feed principal' and is NOT reused by the community page, which gets its own `communities.region` in 05-04."

requirements-completed: []

coverage:
  - id: D1
    description: "The five prototype-less Phase 5 surfaces (stories strip, story viewer, publish flow, community create/edit/archive form, pin flow) exist as one self-contained, brand-switchable, light/dark mockup drawn from the real token values, with every state the UI-SPEC names and every string copied verbatim from the Copywriting Contract"
    verification:
      - kind: other
        ref: "Task 1 <automated>: test -f + 12 grep -qF assertions over the Copywriting-Contract strings and --brand-gradient, plus the zero-app-references assertion"
        status: pass
      - kind: other
        ref: "acceptance criteria: 0 external assets, 0 iframes, 0 DoubleTapHeart/toque duplo, 0 Compartilhar, real token #f5f7fb present"
        status: pass
    human_judgment: true
    rationale: "The automated chain proves the strings, the geometry values and the self-containment. Whether the drawing READS as the prototype's own language under two tenant brands is exactly the judgment D-33 exists to collect — it is the plan's <human-check> and is carried to end-of-phase verification by design."
  - id: D2
    description: "The D-33 / UI-04 gate is ARMED rather than declared: sketch 003's README ships status: pending / approved: false, and the six downstream tasks that code the five surfaces halt while it reads false"
    verification:
      - kind: other
        ref: "grep -n '^status:|^approved:' .planning/sketches/003-phase-05-designed-screens/README.md => 'status: pending', 'approved: false'"
        status: pass
      - kind: other
        ref: "Task 2 <automated>: README exists, MANIFEST row 003 + 05-UI-SPEC.md reference point present, D-33 / Destaques / STORY_DURATION_MS in the README"
        status: pass
    human_judgment: false
  - id: D3
    description: "The two messages the design team is owed are in writing: PROTOTYPE.md open question 1 answered YES (the Destaques circles become the real pinned-stories row and now OPEN the viewer, D-68) and the viewer deliberately ships no double-tap-to-like (UI-D-31)"
    verification:
      - kind: other
        ref: "acceptance criteria: README body contains D-33, D-68, UI-D-31, Destaques, STORY_DURATION_MS and an explicit no-double-tap statement"
        status: pass
    human_judgment: true
    rationale: "Presence is asserted; whether the design team AGREES with either call is the signature the review collects."
  - id: D4
    description: "All 10 shipped catalog rows carrying the retired sense of 'comunidade' are amended — six gaining {tenant}, four dropping the word — and no amended row still carries a retired-sense phrase"
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#UI-D-46 vocabulary amendment > <6 rows> carries the {tenant} placeholder"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#UI-D-46 vocabulary amendment > <4 rows> drops the retired sense outright"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#UI-D-46 vocabulary amendment > no amended row still says \"comunidade\" in the retired sense"
        status: pass
      - kind: other
        ref: "grep -c over the five amended catalogs for the six retired phrases => 0 for every file"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every new {tenant} placeholder is pinned by a test, so a dropped interpolation fails the suite instead of rendering a stray brace to a member (T-05-10)"
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#UI-D-46 vocabulary amendment (24/24 in the file, 6 placeholder pins + 4 drop pins + 2 boundary pins)"
        status: pass
      - kind: other
        ref: "pnpm --filter @rede-social/web typecheck — a call site that stops supplying the argument fails the build"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 27 shipped rows reconcile exactly: 10 amended, 16 out of scope with their reason, 1 already correct"
    verification:
      - kind: other
        ref: "05-UI-SPEC.md §Vocabulary amendment: the amended table has exactly 10 rows (6 with {tenant} in Becomes, 4 without); group A 10 + group B 6 = 16; platform.moduleNames.communities = 1"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#UI-D-46 vocabulary amendment > leaves the out-of-scope rows and the already-correct row untouched"
        status: pass
      - kind: other
        ref: "grep -c comunidade over signup/noCommunity/hostMismatch/platformDomains => 2/2/1/4, all non-zero"
        status: pass
    human_judgment: false
  - id: D7
    description: "bash scripts/check-ui-literals.sh still exits 0 — no literal moved into a component as part of this work"
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh => exit 0, 'no hex/legacy-class/pt-BR literals in .tsx under apps packages; catalog files valid'"
        status: pass
    human_judgment: false
  - id: D8
    description: "The mockups are review artifacts and are never imported, bundled or linked by application code"
    verification:
      - kind: other
        ref: "test \"$(grep -rl '003-phase-05-designed-screens' apps packages | wc -l)\" = \"0\""
        status: pass
    human_judgment: false

duration: 65 min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 02: Design Gate & Vocabulary Amendment Summary

**The five prototype-less Phase 5 surfaces now have a reviewable drawing that physically blocks the six tasks which would code them, and the word "comunidade" means exactly one thing inside the authenticated app — all 10 shipped rows amended, six naming the tenant and four dropping the word.**

## Performance

- **Duration:** ~65 min wall clock, including a human decision checkpoint between Task 2 and Task 3
- **Tasks:** 3 of 3
- **Files:** 27 (2 created, 25 modified)
- **Commits:** 3 task commits + this metadata commit

## Accomplishments

- **The D-33 gate is armed, not declared.** Sketch 003 ships `status: pending` / `approved: false`, and six downstream tasks (05-04 Task 2, 05-05 Tasks 1 and 3, 05-06 Task 1, 05-08 Tasks 1 and 3) each carry a `precondition` asserting `approved: true` against that file. Phase 5 stops at wave 3 until a human records the review — by design, not by accident.
- **All five surfaces are drawn in the product's own language** from the real `packages/ui/src/styles/tokens.css` values, in light and dark, under two tenant brands, with every state the UI-SPEC names and every string copied verbatim from the Copywriting Contract. The file is self-contained: no external asset, no iframe, no network fetch (T-05-08).
- **The two messages the design team is owed are in writing** — the Destaques circles become the real pinned-stories row and now OPEN the viewer (D-68, PROTOTYPE.md open question 1 answered YES), and the viewer deliberately ships no double-tap-to-like because the first tap of a double-tap would skip the story (UI-D-31).
- **The vocabulary collision is closed.** Ten shipped rows across five catalogs that used "comunidade" to mean *the tenant* are amended: six now name the tenant through `{tenant}`, four drop the word. The 16 out-of-scope rows and the 1 already-correct row are untouched and asserted untouched, so the 27 reconcile exactly.
- **The amendment reached further than a catalog edit.** Six call sites were wired, two client components gained a `tenantName` prop, two 404 components learned to read the host tenant, and **nine test/e2e assertions that had pinned the old sentences were corrected** — three in `members.spec.ts`, one each in `media-video`, `feed`, `feed-composer`, `feed-media`, two in `shell.spec.ts`, and one unit assertion in `AvatarUploadField.test.ts`. A one-word change is a whole-repo change.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Draw the five prototype-less surfaces as one static mockup | `0a6bd4c` | `.planning/sketches/003-phase-05-designed-screens/index.html` |
| 2 | Register sketch 003, write the review README, arm the D-33 / UI-04 gate | `a63c199` | `.planning/sketches/003-phase-05-designed-screens/README.md`, `.planning/sketches/MANIFEST.md` |
| 3 | Close the UI-D-46 vocabulary collision and correct the UI-SPEC | `e6f5662` | 5 catalogs, `messages.test.ts`, `registry.tsx`, `tenant-host.ts`, 6 route/component files, 7 spec files, `05-UI-SPEC.md` |

## Deviations from Plan

### 1. [USER-APPROVED DECISION] The 6/4 split, not the plan's 4/6 — `media.errors.quota` drops the word

**The plan's `must_haves` truth said:** "…all 10 shipped catalog rows carrying the retired sense are amended — `feed.json` ×4, `app.json` ×1, `members.json` ×2, `profile.json` ×1, `media.json` ×2 — **six dropping the word outright and four gaining `{tenant}`**", and "**Every one of the four newly-interpolated rows renders at a call site that ALREADY holds the tenant, so no new data is threaded to any component**".

**Why it was unsatisfiable as written.** `05-UI-SPEC.md` §Vocabulary amendment contradicted itself: its 10-row table marked **seven** rows "New interpolation? yes" while the prose beneath it (and the plan's truth) said six drop / four gain. Three of the table's Becomes values could not be reconciled with the prose. Separately, `media.errors.quota` — one of the rows the table marked `yes` — resolves in `apps/web/components/media/useSignedUpload.ts`, and two of that hook's callers (`components/platform/LogoUpload.tsx`, `components/platform/IconOverrideUpload.tsx`) run as `super_admin` on `app.seusistema.com`, **where no tenant display name exists**. `{tenant}` there would render empty or as a stray brace on the platform host — the exact failure T-05-10 exists to prevent.

**The decision taken (user-selected, Option C):** **six rows gain `{tenant}`; four drop the word.**

| Gains `{tenant}` (6) | Drops the word (4) |
|---|---|
| `feed.empty.bodyAuthor` | `feed.region` → "Feed principal" |
| `feed.notFound.body` | `profile.nudge.body` |
| `feed.composer.captionPlaceholder` | `media.confirm.removeVideo.body` |
| `app.home.soonBody` | `media.errors.quota` → "O limite de armazenamento foi atingido. Fale com o administrador." |
| `members.empty.body` | |
| `members.notFound.body` | |

Nine of the ten rows use the UI-SPEC table's `Becomes` column verbatim. `media.errors.quota` is the single changed value, and it keeps the actionable half of the sentence ("Fale com o administrador") while naming no one.

**The two props added.** The "no new data is threaded to any component" claim holds for four of the six, not all of them:

- `apps/web/app/(app)/criar/ComposerForm.tsx` gains one `tenantName` prop, passed from `/criar` and `/post/[postId]/editar` — both already `await requireBootstrap()`.
- `apps/web/app/(app)/membros/MembersList.tsx` gains one `tenantName` prop, passed from `membros/page.tsx` — which already calls `getHostTenant()`.

Both use the prop shape 05-01 gave `CommunitiesList`. No component reaches for the tenant on its own; the value is passed down from a server page that already holds it.

**How the verifier should reconcile this.** The plan's 4/6 claim and this SUMMARY's 6/4 result describe the same 10 rows; only which side of the 10 a single row falls on moved, and it moved on an explicit user decision with a stated technical cause. The `10 amended + 16 out of scope + 1 already correct = 27` reconciliation the plan's truth also asserts is **unchanged and verified**. `05-02-PLAN.md` was deliberately NOT edited — it is the historical record of intent.

### 2. [Rule 3 - Blocker] `05-UI-SPEC.md` was factually wrong and was corrected in the same commit

Three corrections, all inside §"Vocabulary amendment — the retired sense of 'comunidade' (UI-D-46)":

1. The `media.errors.quota` row's `Becomes` value and its "New interpolation?" cell, with the platform-panel reason stated in full so the next reader does not re-derive it.
2. The prose beneath the table now reads "**Four rows drop the word outright; six gain `{tenant}`**", with a note that the original read the other way and why the split moved.
3. The claim "every one of those four call sites already holds the tenant — no new data has to be threaded to any component" is replaced by a six-row table naming **where each string actually resolves** and **what each needed** — including the two props.

The 10 / 16 / 1 = 27 reconciliation was re-verified after the edit: the amended table still has exactly 10 rows (6 with `{tenant}` in `Becomes`, 4 without), group A is 10, group B is 6, and `platform.moduleNames.communities` is the 1.

### 3. [Rule 1 - Bug] The plan named two wrong call sites

The plan's `<files>` listed `apps/web/components/media/MediaAssetRow.tsx` for `media.errors.quota` and `apps/web/lib/registry.tsx` for `app.home.soonBody`. Neither is correct:

- `media.errors.quota` resolves in `apps/web/components/media/useSignedUpload.ts` (`messageFor`'s exhaustive `MediaIssue` map). `MediaAssetRow.tsx` never reads it.
- `app.home.soonBody` renders in `apps/web/app/(app)/inicio/page.tsx`'s `HomeSlots` `empty` prop, not in `registry.tsx`. (`registry.tsx` IS the site for `feed.region` and `feed.empty.bodyAuthor`, as the plan's `key_links` says.)

Verified by grep before any edit; the work was done against what the code actually does.

### 4. [Rule 2 - Missing critical] `tenantDisplayName(shell)` added to `apps/web/lib/tenant-host.ts`

Three of the newly-interpolated surfaces hold the **host shell** rather than the bootstrap (`membros/page.tsx` and both `not-found.tsx` files). `HostShell` is a union whose `platform` and `generic` arms carry no `displayName`, so every one of them needed a fallback — and three hand-written ternaries would have been three chances to pick a different one. The helper is the single rule: the display name on a tenant host, the host itself otherwise. Never an empty string, never a stray brace. Its docblock records why bootstrap-holding surfaces use `bootstrap.tenant.displayName` instead (the host selects the shell; the membership is the tenant of record) and why the two always agree (`TENANT_HOST_MISMATCH` is refused before any page renders).

### 5. [Rule 2 - Missing critical] Both 404 docblocks were rewritten, not silently changed

`post/[postId]/not-found.tsx` and `membros/[membershipId]/not-found.tsx` each carried an explicit rule — "*takes no props and reads no param on purpose … a component that reads no tenant cannot name one*" — that this task's change contradicts in its second clause. Changing the code without changing the prose would have left the next reader with a comment that forbids what the file now does.

Both docblocks now state: the "no props, no param" rule and the existence-oracle / D-23-TENANT-04 guarantee are **unchanged** (the id still never reaches the file, so it can never be echoed); only the "reads no tenant" clause changed; and it is safe because the name is **host-derived**, therefore byte-identical across all three (post) / five (membership) causes and identical to what every other screen on the host already shows. Each ends with "Do not re-litigate it."

### 6. [Rule 1 - Bug] Nine assertions had pinned the retired sentences

Out of scope for the plan's wording but squarely in scope for its change: leaving them would have shipped a red suite.

| File | What changed |
|---|---|
| `apps/web/components/media/AvatarUploadField.test.ts` | the quota refusal's exact string, with a comment on why it names no one |
| `apps/web/e2e/shell.spec.ts` (×2) | the feed region's accessible name → "Feed principal" |
| `apps/web/e2e/feed-media.spec.ts` | same |
| `apps/web/e2e/feed.spec.ts` | `F.empty.bodyAuthor` now interpolated with the fixture tenant, matching the `F.empty.body` line 3 lines above |
| `apps/web/e2e/feed-composer.spec.ts` | the caption placeholder interpolated with "Rede Demo" |
| `apps/web/e2e/members.spec.ts` (×3) | the members empty state, the one 404 body (with a comment that it stays indistinguishable across all five causes), and the profile nudge |
| `apps/web/e2e/media-video.spec.ts` | the remove-video confirmation body |

**Total deviations:** 1 user-approved decision, 5 auto-fixed (2× Rule 1 bug, 2× Rule 2 missing-critical, 1× Rule 3 blocker). **Impact:** the plan's stated outcome is delivered; one row of the ten landed on the other side of the split, on an explicit user decision, for a reason the spec now carries.

## Authentication Gates

None.

## Known Stubs

None introduced by this plan. The sketch package is a review artifact under `.planning/` by design (asserted unreferenced by `apps/` and `packages/`), not a stub in application code.

One **deliberate open state**, which is the plan's whole purpose rather than a defect: `.planning/sketches/003-phase-05-designed-screens/README.md` reads `status: pending` / `approved: false`. That is the ARMED D-33 gate. It is not something this plan failed to finish — a plan that set it to `true` would have forged a human review. Waves 3–7 of Phase 5 are blocked until a human records the outcome.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or trust-boundary schema change. The two 404 components gained a read of request headers that the same request's layout already performs, and the value they read is host-derived and identical across every cause — which is why it does not weaken D-23/TENANT-04. Per T-05-SC, **zero packages were installed**.

## Verification Results

| Check | Result |
|-------|--------|
| Task 1 `<automated>` (file, 12 Copywriting-Contract strings, gradient, zero app references) | pass |
| Task 2 `<automated>` (README, MANIFEST row 003, 05-UI-SPEC reference point, D-33/Destaques/STORY_DURATION_MS) | pass |
| Task 3 `<automated>` segment 1 — `pnpm --filter @rede-social/web test -- messages` | pass — 11 files, 94/94; `messages.test.ts` alone 24/24 including all 12 new UI-D-46 cases |
| Task 3 `<automated>` segment 2 — `pnpm --filter @rede-social/web typecheck` | pass (`next typegen && tsc --noEmit`) |
| Task 3 `<automated>` segment 3 — `pnpm --filter @rede-social/web lint` | pass — 237 files (one Biome format error was raised and fixed before the commit) |
| Task 3 `<automated>` segment 4 — `bash scripts/check-ui-literals.sh` | pass — exit 0 |
| Full chain re-run end to end | `CHAIN EXIT: 0` |

### Acceptance criteria, adjusted for Option C

| Criterion | Result |
|---|---|
| `grep -c "{tenant}" feed.json` ≥ 3 (plan) / ≥ 4 (Option C) | **4** — pass under both |
| `grep -c "{tenant}" members.json` ≥ 2 | **2** — pass |
| `feed.json` contains `"Feed principal"` | pass |
| Retired phrases across the five amended catalogs | **0 for every file** |
| `platform.json` still has `"communities": "Comunidades"` | pass |
| Out-of-scope files still carry the word (signup / noCommunity / hostMismatch / platformDomains) | **2 / 2 / 1 / 4** — all non-zero |
| `messages.test.ts` has an assertion per newly-interpolated key naming `{tenant}` | pass — 6 of 6 |
| `pnpm --filter @rede-social/web test -- messages` exits 0 | pass |
| `bash scripts/check-ui-literals.sh` exits 0 | pass |

**The one criterion that must NOT hold, and does not.** `apps/web/messages/pt-BR/media.json` carries **zero** `{tenant}` from this amendment, by the user's decision. Any reading of the plan that expects a `{tenant}` in `media.json` is reading the superseded 4/6 split; see Deviation 1. It was not forced.

## Issues Encountered

None outstanding.

One standing fact worth carrying forward: `pnpm --filter @rede-social/web test -- messages` does **not** filter — the `-- messages` argument is swallowed and vitest runs all 11 web test files (94 tests). That is harmless here (it is strictly more coverage, and the run is green), but the plan's `<fails_when>` clause "the vitest summary … does not name messages.test.ts" cannot be satisfied by that command's default reporter. The file was verified to run and pass by a separate explicit invocation: `pnpm --filter @rede-social/web exec vitest run i18n/messages.test.ts --reporter=verbose` → 24/24, every UI-D-46 case named.

## Next Phase Readiness

Ready for **05-03** and the rest of wave 2. The phase then **stops at wave 3 by design**:

- `.planning/sketches/003-phase-05-designed-screens/README.md` reads `approved: false`. Setting it to `true` after a human runs the review is what physically releases 05-04 Task 2, 05-05 Tasks 1 and 3, 05-06 Task 1, and 05-08 Tasks 1 and 3.
- The review is a `<human-check>` carried to `/gsd-verify-work` under `workflow.human_verify_mode: end-of-phase`. Because 05-04 gates wave 3 and 05-05..05-08 descend from it, nothing downstream of wave 2 can execute until it is recorded.
- 05-04 must give the community page its own `communities.region` ("Publicações de {community}") and must not reuse `feed.region`.
- Requirements `COMM-01`, `STORY-01`, `STORY-02`, `STORY-04` were **not** marked complete: `requirements.ready-ids` returned 0/4 because sibling plans in this phase also declare them and have no SUMMARY yet. That is the shared-ID gate working as intended.

## Self-Check: PASSED

- Both `key-files.created` entries exist on disk (`[ -f ]`): `index.html`, `README.md`.
- All 25 `key-files.modified` entries appear in `git diff --name-only 4d3f6ae..HEAD` (27 paths, the two created files being the remainder).
- All three task commits are reachable in `git log --all`: `0a6bd4c`, `a63c199`, `e6f5662`.
- `git diff --diff-filter=D --name-only HEAD~1 HEAD` — empty; no file was deleted.
- `.planning/sketches/003-phase-05-designed-screens/README.md` still reads `status: pending` / `approved: false` — untouched by Task 3.
