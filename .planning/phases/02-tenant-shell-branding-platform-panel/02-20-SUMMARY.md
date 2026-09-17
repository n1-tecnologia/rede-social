---
phase: 02-tenant-shell-branding-platform-panel
plan: 20
subsystem: ui (platform panel) + verification gate
tags: [platform-panel, catalog, e2e, exit-gate, gap-closure, invites, next-intl, playwright]

# Dependency graph
requires:
  - phase: 02-19
    provides: 400 VALIDATION_FAILED { adminEmail: 'in_use' } on POST /v1/platform/tenants; 409 INVITE_STATE_INVALID { reason } with email_in_use / user_in_other_tenant; refused invite = status 'expired' + sent_at null (D-A)
  - phase: 02-10
    provides: resendInviteAction forwarding details.reason as ResendInviteResult.reason; ResendInviteButton + AdminsCard resend slot; invite.spec.ts helpers (superAdminToken, platformApi, createTenant, attachAndVerify, waitForInviteStatus, signIn)
  - phase: 02-12
    provides: createTenantAction 400 mapping (slug 'taken' → field error), NewTenantForm rendering t(`new.errors.${key}`), the "server actions return catalog KEYS" rule, platform-tenants.spec.ts (slugsFor / suffixFor / signInSuperAdmin)
  - phase: 02-16
    provides: pnpm verify as the local exit gate; the `pnpm --filter @tria/web exec playwright test <spec>` rule; the 60 s web host cache polling convention
  - phase: 02-17, 02-18
    provides: CR-01/WR-01 and WR-05/WR-06/WR-07 closures whose suites the exit gate re-runs together with this plan
provides:
  - "createTenantAction maps details.adminEmail === 'in_use' to fieldErrors.adminEmail = 'emailInUse' (independent of slug 'taken' and issues[]; all three may arrive together)"
  - "InviteView.status widened with the view-only 'refused' state (danger tone, inviteRefused label) — derived in the Admins page from status 'expired' && sentAt null; contracts and API untouched"
  - "ResendInviteButton labels.reasons map (email_in_use, user_in_other_tenant) with the generic resendFailed fallback for every other refusal"
  - "Catalog keys platform.new.errors.emailInUse, platform.admins.inviteRefused, platform.admins.resendEmailInUse, platform.admins.resendUserInOtherTenant"
  - "e2e proofs: platform-tenants.spec.ts case 8 (create-time refusal as a field error) and invite.spec.ts case 4 (refused pill + reason toast + foreign membership untouched)"
  - "Phase 2 exit gate re-run over the four gap-closure plans (02-17..02-20): every affected suite and the full pnpm verify one-shot green"
affects: [/gsd-verify-work for Phase 2, Phase 8 hardening (IN-01..IN-07), any later panel surface that renders an API refusal (reason → catalog key pattern)]

# Actuals (#2632) — chars/4 over the 7 files actually changed (diff-only chars/4 = 4447)
actuals:
  tokens: 17240
  tasks: 3
  commits: 2
plan_head_before: b13d7c37d57f425615bdb9abb615dcc8c5ba47ff

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Refusal reason → catalog key: a client component maps a closed set of API reason codes to catalog strings and falls back to the generic copy for anything else; nothing from the response body is rendered raw"
    - "View-only derived state: a UI-only status (`refused`) is computed in the server page from contract fields (status + sentAt) and exists only in the web view type, never in @tria/contracts"
    - "Field-error accumulation from a 400 envelope: build fieldErrors incrementally from every documented detail key, then merge issues[] without overriding a more specific key"

key-files:
  created: []
  modified:
    - apps/web/messages/pt-BR/platform.json
    - apps/web/app/(platform)/plataforma/actions.ts
    - apps/web/components/platform/AdminsCard.tsx
    - apps/web/components/platform/ResendInviteButton.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx
    - apps/web/e2e/platform-tenants.spec.ts
    - apps/web/e2e/invite.spec.ts

key-decisions:
  - "02-20: the refused invite state is derived in the Admins page (`status === 'expired' && sentAt === null` → 'refused') and lives only in the web InviteView type; a refused row keeps the resend control (canResend stays true for a non-pending row) so the super_admin can retry after fixing the identity elsewhere"
  - "02-20: the resend toast knows exactly two reasons (email_in_use, user_in_other_tenant) mapped to fixed catalog copy that names no tenant; every other refusal (already_accepted, no_verified_primary, not_invited, network) keeps the generic 'Não foi possível reenviar o convite.' toast"
  - "02-20: createTenantAction accumulates fieldErrors from slug 'taken', adminEmail 'in_use' and issues[] independently (a more specific key wins over issues[]) instead of the former if/else-if chain"
  - "02-20: the exit gate is recorded from the second pnpm verify attempt — the first died at the build step with ENOSPC (disk at 96 %, the repo's 14 GB .turbo/cache); pruning gitignored caches (.turbo/cache, apps/web/.next) is an environment fix, not a code change, and the one-shot re-run was green in 17 min 30 s (02-16 baseline 17 min 27 s)"

patterns-established:
  - "Panel refusal copy comes from the catalog by key; the reason map is a closed set with a generic fallback (T-02-160)"
  - "Exit-gate recipe: affected suites in order (lint → typecheck+test → boundaries → integration → touched e2e specs on desktop) and only then the full pnpm verify one-shot, with every stage's exit code, duration and counts recorded"

requirements-completed: [ROLE-03, PWA-03]

coverage:
  - id: D1
    description: "WR-03 panel half (E11 error): an adminEmail that already has an identity on the platform is refused by the API and the form shows the field error under #adminEmail, keeps every typed value, stays on /plataforma/novo and creates no tenant row"
    requirement: ROLE-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#8. an admin e-mail that already exists on the platform is refused as a field error (WR-03) — desktop-chromium + mobile-chromium (pnpm verify)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-02/WR-03 panel half (E17 error, widened): a refused invite renders the danger pill 'Convite recusado — o e-mail já está em uso' (never 'Convite expirado'), still offers 'Reenviar convite', and the resend toast names the cause (user_in_other_tenant copy) while the foreign membership stays { member, active }"
    requirement: ROLE-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/invite.spec.ts#4. an invite for an e-mail that belongs to another tenant is refused: \"Convite recusado\" pill, reason toast on resend, the other membership untouched (WR-02/WR-03) — desktop-chromium + mobile-chromium (pnpm verify)"
        status: pass
    human_judgment: false
  - id: D3
    description: "email_in_use resend copy ('Este e-mail já possui uma conta na plataforma e não pode receber o convite.') and the generic fallback for every other reason"
    requirement: ROLE-03
    verification:
      - kind: unit
        ref: "pnpm --filter @tria/web typecheck (labels.reasons typed as Partial<Record<'email_in_use' | 'user_in_other_tenant', string>>; reasonCopy narrows before lookup) + grep 'labels.resendFailed' fallback kept"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#refusals > R2 (409 email_in_use envelope the button consumes) — pnpm test:integration 187/187"
        status: pass
    human_judgment: true
    rationale: "The email_in_use branch of the resend toast is not driven end to end in the browser (case 4 exercises user_in_other_tenant; producing email_in_use on resend needs an identity without any membership, which the e2e admin helpers do not create) — the mapping is a two-key lookup verified by type and by the API contract; a human can confirm the copy in the panel if desired"
  - id: D4
    description: "PWA-03 (catalog): every new string lives in apps/web/messages/pt-BR/platform.json; no pt-BR literal was added to any .tsx"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh → 'check-ui-literals: OK' (part of pnpm lint, green in Stage A and in pnpm verify); node catalog-key probe for the four keys exits 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phase exit gate over the four gap-closure plans: affected suites + the full pnpm verify one-shot green, recorded"
    requirement: ROLE-03
    verification:
      - kind: other
        ref: "pnpm lint && pnpm turbo typecheck test; rm -rf apps/api/dist && pnpm boundaries && pnpm boundaries:negative; pnpm test:integration; five-spec desktop e2e; DOCKER_CONFIG=/tmp/dockercfg pnpm verify — all exit 0 (see ## Exit gate)"
        status: pass
    human_judgment: false

# Metrics
duration: 32 min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 20: Panel refusal surfaces (WR-02/WR-03) + phase exit gate Summary

**The platform panel now tells the super_admin why a first-admin e-mail was refused — a catalog field error under `#adminEmail` at creation, a "Convite recusado — o e-mail já está em uso" pill on the Admins tab (never "Convite expirado"), and a resend toast that names `email_in_use` / `user_in_other_tenant` with the generic copy as fallback — pinned by two e2e cases, and the Phase 2 exit gate (`pnpm verify`) is green one shot over the four gap-closure plans.**

## Performance

- **Duration:** 32 min (of which the exit-gate stages ~26 min: five-spec desktop e2e 6 min 22 s, `pnpm verify` 17 min 30 s)
- **Started:** 2026-09-17T14:02:26Z
- **Completed:** 2026-09-17T14:35:09Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- **WR-03 panel half:** `createTenantAction` maps the API's `400 VALIDATION_FAILED { adminEmail: 'in_use' }` (02-19) to `fieldErrors.adminEmail = 'emailInUse'`; the 400 branch now accumulates `slug: 'slugTaken'`, `adminEmail: 'emailInUse'` and `issues[]` independently (a specific key is never overridden by `issues[]`). `NewTenantForm` needed no change — it already renders `t(\`new.errors.${key}\`)` for any `CreateFieldError`.
- **WR-02/WR-03 panel half:** `InviteView.status` gains the view-only `'refused'` state (`inviteTone.refused = 'danger'`, label `inviteRefused`), derived in the Admins page from `raw.status === 'expired' && raw.sentAt === null` (02-19 D-A). The refused row keeps "Reenviar convite" enabled; `ResendInviteButton` takes `labels.reasons` and toasts the reason copy for the two documented refusals, `labels.resendFailed` otherwise. The API and `@tria/contracts` are untouched (prohibition honoured).
- **PWA-03:** four catalog keys added next to their siblings (`new.errors.emailInUse`, `admins.inviteRefused`, `admins.resendEmailInUse`, `admins.resendUserInOtherTenant`), UTF-8 literal accents; `check-ui-literals.sh` OK.
- **Proof:** `platform-tenants.spec.ts` case 8 (seeded `member@tria-lab.local` as adminEmail → field error, values kept, still on `/plataforma/novo`, `getTenantModuleFlag(slug, 'feed')` null; slug `e2e-recusado-*` added to `slugsFor` for `afterAll`) and `invite.spec.ts` case 4 (create → `createMember` in `tria-lab` → attach + verify → invite `expired` with `sentAt` null → refused pill, "Convite expirado" count 0, resend enabled, `user_in_other_tenant` toast, `membershipForEmail` still `{ member, active }`, invite still `expired`). Both green on desktop and mobile inside the full suite.
- **Exit gate:** the union of the affected suites and then the full `pnpm verify` one-shot — green (details below).

## Task Commits

1. **Task 1: Panel surfaces — adminEmail field error, refused-invite pill, reason-aware resend toast, catalog keys** - `def07e9` (feat)
2. **Task 2: e2e proofs — platform-tenants case 8 + invite case 4** - `03e7481` (test)
3. **Task 3: Phase exit gate** - no code commit (verification only; recorded here)

**Plan metadata:** see the `docs(02-20)` commit that follows this summary.

## Files Created/Modified

- `apps/web/messages/pt-BR/platform.json` - the four new keys (`new.errors.emailInUse`, `admins.inviteRefused`, `admins.resendEmailInUse`, `admins.resendUserInOtherTenant`).
- `apps/web/app/(platform)/plataforma/actions.ts` - `CreateFieldError` gains `'emailInUse'`; the 400 branch builds `fieldErrors` incrementally from `details.slug`, `details.adminEmail` and `details.issues[]`; docblock updated.
- `apps/web/components/platform/AdminsCard.tsx` - `InviteView.status` widened with `'refused'` (docblock names the derivation and that the contract has no such status); `AdminsCardLabels.inviteRefused`; `inviteTone.refused = 'danger'`; label map entry.
- `apps/web/components/platform/ResendInviteButton.tsx` - optional `labels.reasons` (`Partial<Record<'email_in_use' | 'user_in_other_tenant', string>>`); `reasonCopy()` narrows the reason before lookup; toast = reason copy ?? `resendFailed`; docblock.
- `apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx` - derives `'refused'`; passes `inviteRefused` and the `reasons` labels; docblock.
- `apps/web/e2e/platform-tenants.spec.ts` - `slugsFor.refused`; case 8.
- `apps/web/e2e/invite.spec.ts` - `createMember` import; header note; case 4.

## Exit gate

All commands ran from the repo root on 2026-09-17 against the running local stack (pinned Supabase CLI 2.117.0 via `DOCKER_CONFIG=/tmp/dockercfg`; API dev server reused on :8787 by the integration globalSetup and Playwright's `reuseExistingServer`; ports 3000 / 3100 / 8790 free before each Playwright stage and free again afterwards).

### Stage-by-stage (the plan's Task 3 union, in order, stop-at-first-failure)

| # | Command | Exit | Duration | Counts |
|---|---------|------|----------|--------|
| A1 | `pnpm lint` (Biome per package + `scripts/check-ui-literals.sh`) | 0 | 1 s (turbo cache) | `check-ui-literals: OK` |
| A2 | `pnpm turbo typecheck test` | 0 | 3 s (turbo cache) | unit **288**: ui 34, core 119 (16 files), contracts 57, api 15, web 63 (9 files); module-example 0 (`--passWithNoTests`) — ≥ 278 + the 02-17/02-18 files |
| B | `rm -rf apps/api/dist && pnpm boundaries && pnpm boundaries:negative` | 0 / 0 | 1 s | 337 files / 7 packages, no issues; negative fixture rejected by both layers. **`apps/api/dist` was present (stale) and removed first** |
| C | `pnpm test:integration` | 0 | 28 s | **16 files / 187 tests** (the acceptance figure: 176 + 11 new `it` blocks from 02-17/02-19) |
| D | `pnpm --filter @tria/web exec playwright test invite.spec.ts platform-tenants.spec.ts platform-domains.spec.ts platform-branding.spec.ts phase2-smoke.spec.ts --project=desktop-chromium` | 0 | 6 min 22 s | **25 passed / 3 skipped** (the three skips are the phone-viewport-only guards: platform-branding 4-5, platform-tenants 6) |
| E | `DOCKER_CONFIG=/tmp/dockercfg pnpm verify` — **second attempt, the recorded one-shot** | **0** | **17 min 30 s** (14:16:34Z → 14:34:04Z) | see the step table below |

Task 2's own gate (`pnpm --filter @tria/web exec playwright test platform-tenants.spec.ts invite.spec.ts --project=desktop-chromium`) ran earlier: exit 0, 37 s, 11 passed / 1 skipped (case 6 phone-only).

### `pnpm verify` one-shot (11 steps, 02-16 composition) — GREEN

| Step | Result |
|------|--------|
| `pnpm lint` | OK (7 tasks; `check-ui-literals: OK`) |
| `pnpm turbo typecheck build test` | 15 tasks successful, 15.97 s; unit 288 as in A2 |
| `pnpm check:static-routes` | OK — 25 guarded routes checked, no authenticated or host-branded route is static |
| `pnpm boundaries` | 337 files / 7 packages, no issues |
| `pnpm boundaries:negative` | OK — both layers reject the fixture |
| `pnpm guard:lanes` | OK — no non-LOCAL role switch or session-scoped claims |
| `pnpm supabase test db` (pgTAP) | **Files=7, Tests=98, Result: PASS** |
| `pnpm test:integration` | **16 files / 187 tests passed** |
| `pnpm spike:supavisor` | 1 file / 3 tests passed |
| `pnpm e2e` (three projects, 212 tests) | **174 passed / 38 skipped / 0 failed**, 16.4 min — the skips are the PWA spec's production-build-only cases (`@tracer/@offline/@install`, annotated as in 02-16) and the viewport-scoped guards; cases 8 and 4 green on both `mobile-chromium` and `desktop-chromium` |
| `pnpm --filter @tria/web e2e:pwa` (production build, 48 tests) | **45 passed / 3 skipped**, 17.3 s (the standalone-install backstop skips of 02-11) |

**First attempt (not the recorded run):** `pnpm verify` exited 1 at `pnpm turbo typecheck build test` with `WARNING IO error: No space left on device (os error 28)` — the disk was at 96 % (533 MiB free) because the repo's gitignored `.turbo/cache` had grown to 14 GB (plus a 2 GB stale `apps/web/.next`). Both caches were pruned (`rm -rf .turbo/cache apps/web/.next`; 16 GiB free afterwards, 13 GiB after the run), nothing tracked changed, and the one-shot was re-run. This is an **environment finding, not a gap-closure regression**: no test, build or lint step failed on code. Recorded as a deviation below.

**Regression check against the four gap-closure plans:** nothing red anywhere; every suite 02-17/02-18/02-19 reported green (core 119, api 15, contracts 57, integration 187, web 63) reports the same numbers here, plus this plan's two e2e cases.

### Review items → plan / task / test (closing statement for the verifier)

| Item | Plan / task | Pinned by |
|------|-------------|-----------|
| CR-01 poller dies after a provider error | 02-17 Task 1 | `packages/core/tests/domains-fake.test.ts#provider-fails-once`; `apps/api/tests/integration/platform-domains.test.ts` cases 17-19 |
| WR-01 `last_error` never cleared after a successful re-run | 02-17 Task 2 | `platform-domains.test.ts` case 20 |
| WR-02 membership `onConflictDoNothing` hides the one-tenant-per-user conflict | 02-19 Task 1 (API) + 02-20 Task 1/2 (panel) | `apps/api/tests/integration/invites.test.ts` R1, R3; `apps/web/e2e/invite.spec.ts` case 4 |
| WR-03 GoTrue `email_exists` → opaque 500 / permanent `last_error`; no create-time check | 02-19 Tasks 1 + 3 (API) + 02-20 Task 1/2 (panel) | `invites.test.ts` R2; `platform-tenants.test.ts` case 21; `platform-domains.test.ts` case 21; `apps/web/e2e/platform-tenants.spec.ts` case 8; `invite.spec.ts` case 4 |
| WR-04 resend answers a false `already_accepted` | 02-19 Task 2 | `invites.test.ts` R4, R5 |
| WR-05 bootstrap membership select scoped by `user_id` alone | 02-18 Task 1 | `packages/core/tests/membership-scope.test.ts`; `bootstrap.test.ts` (integration) |
| WR-06 unbounded by-host lookup in `proxy.ts` | 02-18 Task 2 | `apps/web/lib/tenant-host.test.ts` (2 s timeout, fail-open) |
| WR-07 upload hook stranded in `progress` on a rejected step | 02-18 Task 3 | `apps/web/components/platform/LogoUpload.test.tsx`; `platform-branding.spec.ts` case 3 |

**IN-01..IN-07 deferred to hardening** (Phase 8; product-owner decision 2026-09-17 recorded by 02-17). IN-07 (`FlashToast` strips every query param) was explicitly not touched here even though this plan edits the panel.

## Decisions Made

See `key-decisions` in the frontmatter: the page-side derivation of `refused` (view-only, resend kept), the closed two-reason map with the generic fallback, the accumulating 400 field-error mapping, and the environment-caused first `pnpm verify` attempt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] First `pnpm verify` attempt died with ENOSPC (disk 96 % full)**
- **Found during:** Task 3 (Stage E, the one-shot)
- **Issue:** `pnpm turbo typecheck build test` inside `pnpm verify` aborted with `IO error: No space left on device (os error 28)`; `df` showed 533 MiB free, the gitignored `.turbo/cache` at 14 GB and a stale 2 GB `apps/web/.next`.
- **Fix:** `rm -rf .turbo/cache apps/web/.next` (both gitignored, both regenerated by the gate itself); Docker images and the Supabase stack were not touched. 16 GiB free afterwards.
- **Files modified:** none (no tracked file changed; `git status` clean)
- **Verification:** the re-run `pnpm verify` one-shot exit 0 in 17 min 30 s (table above)
- **Committed in:** n/a

**2. [Rule 1 - Bug] Docblock wording so the acceptance grep counts one call site**
- **Found during:** Task 1 acceptance (`grep -c "adminEmail === 'in_use'"` was 2)
- **Issue:** the new docblock sentence repeated the code expression verbatim.
- **Fix:** docblock says `` `details.adminEmail` = `'in_use'` `` instead; behaviour unchanged.
- **Files modified:** `apps/web/app/(platform)/plataforma/actions.ts`
- **Verification:** grep == 1; lint/typecheck green
- **Committed in:** `def07e9`

---

**Total deviations:** 2 auto-fixed (1 blocking environment fix, 1 wording fix). **Impact on plan:** none on behaviour or scope; the environment fix is what let the exit gate run at all.

## Issues Encountered

- Biome formatting of the new multi-line ternary in `actions.ts` and of one locator chain in `platform-tenants.spec.ts` (`biome format --write` before the commits) — tooling only.
- The `pnpm verify` e2e stage leaves `test-results/` empty and no dev server behind; ports 3000 / 3100 / 8790 were verified free after the run, so no process had to be stopped.
- The `email_in_use` resend toast is verified by type + the API contract rather than by a browser case (coverage D3 flagged `human_judgment: true` with the reason).

## Known Stubs

None — every new string is wired to a real data path; the reason map is a closed lookup with a documented fallback. (No `WINDOWS.md` entry added: no stub, skipped test or unrun `<verify>` was introduced by this plan.)

## Threat Flags

None beyond the plan's register: T-02-160 (no raw API message, no tenant named — the two fixed catalog strings name none), T-02-161 (`refused` exists only in `InviteView`; contracts untouched), T-02-162 (`created.emails` / `created.slugs` pushed before any create call; `deleteUserByEmail` cascades the lab membership), T-02-163 (stale `apps/api/dist` removed before boundaries; ports checked before and after each Playwright stage; commands, counts and durations recorded above).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 2 is complete: all 20 plans have a SUMMARY; the exit gate (`pnpm verify`) is green one shot after the four gap-closure plans. Ready for `/gsd-verify-work 02` (the consolidated UAT list lives in 02-16-SUMMARY.md; this plan adds coverage D3 as the only human-judgment item).
- Operational note for whoever runs the gate next: keep an eye on `.turbo/cache` — at 14 GB it filled the disk on this machine; `rm -rf .turbo/cache` is safe at any time.
- IN-01..IN-07 remain open for Phase 8 hardening.

## Self-Check: PASSED

- Files: all 7 modified paths exist on disk (`[ -f ]` on each).
- Commits: `def07e9`, `03e7481` present in `git log`.
- `commits: 2` measured from `plan_head_before` `b13d7c3` (`git rev-list --count`).
- Acceptance criteria of Tasks 1-3 re-run: catalog keys present, greps at the required counts, 187 integration cases, five-spec desktop e2e 25/3/0, `pnpm verify` exit 0 recorded under `## Exit gate`, CR/WR mapping table and the IN-01..IN-07 line present.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*
