---
phase: "09"
slug: "rede-social-follow-member-posts-and-explorar"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-19"
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The per-task map below is filled from the 13 plans (planner, 2026-10-19). `nyquist_compliant` and `wave_0_complete` were set `true` by plan 09-13 (2026-10-20) after Task 3's gate; `status` stays `draft` because the gate was not one clean `pnpm verify` exit (see Approval and the 09-13 SUMMARY).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5 (unit per package and API integration against the local stack), pgTAP via `supabase test db`, Playwright 1.63 (e2e) |
| **Config file** | `packages/modules/<pkg>/vitest.config.ts`, `packages/core/vitest.config.ts`, `apps/api` (`test` = `vitest run tests/unit`, `test:integration` = `vitest run tests/integration`), `apps/web` (`vitest`, `playwright`) |
| **Quick run command** | `pnpm --filter @rede-social/module-social test && pnpm --filter @rede-social/module-feed test && pnpm --filter @rede-social/api test` |
| **Full suite command** | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:reset && pnpm db:seed && pnpm supabase test db`, then `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`; `pnpm boundaries`; `bash scripts/check-ui-literals.sh`; at the exit gate `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` |
| **Estimated runtime** | ~60 s per package suite; ~6-10 min for the integration files of one plan; the exit gate is long (disk and one local stack: run sequentially) |

---

## Sampling Rate

- **After every task commit:** the touched package's Vitest (`pnpm --filter @rede-social/<pkg> test`) plus typecheck and lint of that package; `pnpm boundaries` when a package import changed.
- **After every plan wave:** `pnpm db:generate` must print "No schema changes", then `pnpm db:reset && pnpm db:seed && pnpm supabase test db` (pgTAP BEFORE integration: residue trips pgTAP 154), then the plan's integration files (`test:integration -- <name>` does NOT filter: use `exec vitest run <file>`), `bash scripts/check-ui-literals.sh` and the web unit suites for web plans.
- **Before `/gsd-verify-work`:** `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` green.
- **Max feedback latency:** about 120 s for a task's unit sample; integration and e2e samples are per plan.

---

## Per-Task Verification Map

Task ids are `9-<plan>-<task>`. "Threat Ref" cites the plan's `<threat_model>`. Every row has an `<automated>` command with a stated failing direction in its plan.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | SOCIAL-01, SOCIAL-02 | T-09-01, T-09-47 | `social` is the single authoring switch; `social.participate` is member-only; `requires` feed drops it | unit + integration | `pnpm --filter @rede-social/module-social test` ; `exec vitest run tests/integration/social-module.test.ts` | ✅ | ✅ green |
| 9-01-02 | 01 | 1 | SOCIAL-01, SOCIAL-02 | T-09-45, T-09-46 | the legacy posting-policy blob grants nothing; the CHECK migration is expand-only | pgTAP + integration | `pnpm db:generate ... && pnpm supabase test db && exec vitest run tests/integration/modules.test.ts` | ✅ | ✅ green |
| 9-02-01 | 02 | 2 | FOLLOW-01, FOLLOW-02 | T-09-03, T-09-05 | one idempotent member-to-member edge, tenant-pinned, staff outside the graph | integration | `exec vitest run tests/integration/social.test.ts -t "09 tracer"` | ✅ | ✅ green |
| 9-02-02 | 02 | 2 | FOLLOW-03, FOLLOW-04, FOLLOW-06 | T-09-04, T-09-06, T-09-02 | lists private, counts public, directory gate before validation | integration + unit | `exec vitest run tests/integration/social.test.ts tests/integration/members.test.ts` | ✅ | ✅ green |
| 9-02-03 | 02 | 2 | FOLLOW-01..04, SOCIAL-10 | T-09-03, T-09-05, T-09-09 | own-row policies, seam, definer posture and tenant pin | pgTAP + sweep | `pnpm supabase test db` ; `exec vitest run tests/integration/isolation.test.ts -t "phase 09 sweep"` | ✅ | ✅ green |
| 9-03-01 | 03 | 3 | SOCIAL-03, SOCIAL-04, SOCIAL-06, SOCIAL-08, EXPL-02 | T-09-07, T-09-08, T-09-10, T-09-24 | stamped audience; restrictive gate; member post notifies nobody | integration + unit | `exec vitest run tests/integration/feed-social.test.ts tests/integration/feed.test.ts tests/integration/feed-query-budget.test.ts` | ✅ | ✅ green |
| 9-03-02 | 03 | 3 | EXPL-02 | T-09-11 | the Explorar form and indexes are decided by measurement | spike | `psql ... -f 09-03-spike.sql` + `CHOSEN_FORM` line | ✅ | ✅ green |
| 9-03-03 | 03 | 3 | SOCIAL-06, SOCIAL-09, SOCIAL-10 | T-09-07, T-09-08, T-09-10 | gate truth table in Postgres | pgTAP | `pnpm supabase test db` (201) | ✅ | ✅ green |
| 9-04-01 | 04 | 4 | SOCIAL-04, EXPL-06 | T-09-12 | Reels 'Todos' mixes followed and own videos; Início excludes them | integration | `exec vitest run tests/integration/feed-social.test.ts -t "reels"` | ✅ | ✅ green |
| 9-04-02 | 04 | 4 | EXPL-02, SOCIAL-10 | T-09-11 | indexes per the record; plan pins by name; statement budget of 1 | pgTAP + integration | `pnpm supabase test db` ; `exec vitest run tests/integration/feed-query-budget.test.ts` | ✅ | ✅ green |
| 9-04-03 | 04 | 4 | SOCIAL-09, EXPL-02, EXPL-06 | T-09-12, T-09-13 | moderator Explorar; blocked and off hide and restore identically; `followsAnyone` | integration | `exec vitest run tests/integration/feed-social.test.ts tests/integration/reels.test.ts` | ✅ | ✅ green |
| 9-05-01 | 05 | 5 | SOCIAL-06 | T-09-14, T-09-09 | locked answer names only the author | integration | `exec vitest run tests/integration/feed-social.test.ts -t "09 gate"` | ✅ | ✅ green |
| 9-05-02 | 05 | 5 | SOCIAL-06, SOCIAL-09, EXPL-03 | T-09-17, T-09-15 | one guard on every interaction route; counters never move on a refusal | integration | `exec vitest run tests/integration/feed-social.test.ts tests/integration/feed-interactions.test.ts tests/integration/feed-query-budget.test.ts` | ✅ | ✅ green |
| 9-05-03 | 05 | 5 | SOCIAL-06, SOCIAL-10 | T-09-16, T-09-09 | hidden-post video yields no playback tokens; definer posture | pgTAP + sweep | `pnpm supabase test db` ; `exec vitest run tests/integration/media-playback.test.ts` | ✅ | ✅ green |
| 9-06-01 | 06 | 6 | SOCIAL-05, SOCIAL-03 | T-09-18, T-09-30 | the super_admin edits per-tenant member limits; the broker obeys them | unit + integration | `exec vitest run tests/integration/social-media.test.ts -t "09 tracer"` | ✅ | ✅ green |
| 9-06-02 | 06 | 6 | SOCIAL-05 | T-09-18, T-09-19 | duration judged against the start-time snapshot; sub-budget | pgTAP + integration | `pnpm supabase test db` ; `exec vitest run tests/integration/social-media.test.ts tests/integration/media.test.ts` | ✅ | ✅ green |
| 9-06-03 | 06 | 6 | SOCIAL-03, SOCIAL-02 | T-09-20, T-09-21 | no attachment, no community, ready-only video, own assets only | integration | `exec vitest run tests/integration/social-media.test.ts tests/integration/feed-media.test.ts tests/integration/feed-unfurl.test.ts` | ✅ | ✅ green |
| 9-07-01 | 07 | 7 | SOCIAL-07 | T-09-22, T-09-23 | moderator removal and the log row commit together; organization posts stay author-only | integration | `exec vitest run tests/integration/moderation-posts.test.ts` | ✅ | ✅ green |
| 9-07-02 | 07 | 7 | SOCIAL-08 | T-09-24, T-09-25 | one comment notice for the author, retracted on deletion | unit + integration | `exec vitest run tests/integration/moderation-posts.test.ts tests/integration/notifications.test.ts` | ✅ | ✅ green |
| 9-07-03 | 07 | 7 | SOCIAL-07, SOCIAL-10 | T-09-23 | widened CHECKs proven; log read and filter know the action | pgTAP + integration + web unit | `pnpm supabase test db` ; `pnpm --filter @rede-social/web exec vitest run lib/moderation-view` | ✅ | ✅ green |
| 9-08-01 | 08 | 8 | EXPL-01, EXPL-02 | T-09-41, T-09-33 | chip row only for participants and moderators; one scoped fetch | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run inicio/tabs` ; `playwright test social.spec.ts` | ✅ | ✅ green |
| 9-08-02 | 08 | 8 | EXPL-04, EXPL-05, SOCIAL-02 | T-09-26 | composer entry by tab; organization-voice gating; badge by audience | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/feed-view` ; `playwright test social.spec.ts comunidades.spec.ts` | ✅ | ✅ green |
| 9-08-03 | 08 | 8 | EXPL-06, EXPL-03 | T-09-26 | Reels over Explorar returns to the same place; moderator fallback | web unit + e2e | `playwright test social.spec.ts reels.spec.ts` | ✅ | ✅ green |
| 9-09-01 | 09 | 9 | EXPL-05, SOCIAL-03 | T-09-20 | member composer without PDF or community; lands in Explorar | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run criar/ComposerForm` ; `playwright test social.spec.ts` | ✅ | ✅ green |
| 9-09-02 | 09 | 9 | SOCIAL-05 | T-09-18, T-09-35 | tenant limits shown; refusals mapped to catalog copy | web unit + e2e | `playwright test social.spec.ts media-upload.spec.ts` | ✅ | ✅ green |
| 9-09-03 | 09 | 9 | SOCIAL-07, EXPL-03 | T-09-43 | moderator removal control and member delete wording | module unit + e2e | `pnpm --filter @rede-social/module-feed test` ; `playwright test social.spec.ts moderation.spec.ts` | ✅ | ✅ green |
| 9-10-01 | 10 | 10 | FOLLOW-04, FOLLOW-05 | T-09-28, T-09-36 | optimistic follow reconciled with the server; staff and self see D-45 | module + web unit + e2e | `pnpm --filter @rede-social/module-social test` ; `playwright test social.spec.ts` | ✅ | ✅ green |
| 9-10-02 | 10 | 10 | FOLLOW-05, FOLLOW-06 | T-09-36 | directory for members only while `social` is on; row follow state batched | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/member-directory membros` ; `playwright test social.spec.ts members.spec.ts` | ✅ | ✅ green |
| 9-10-03 | 10 | 10 | FOLLOW-03, SOCIAL-10 | T-09-29, T-09-37 | private lists take no id; no personal feed | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run perfil` ; `playwright test social.spec.ts profile.spec.ts` | ✅ | ✅ green |
| 9-11-01 | 11 | 11 | SOCIAL-06, FOLLOW-05 | T-09-27, T-09-38 | locked screen shows only the author; follow opens the same URL | module + web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/feed components/social` ; `playwright test social.spec.ts` | ✅ | ✅ green |
| 9-11-02 | 11 | 11 | SOCIAL-06 | T-09-27 | mid-session refusal reverts, toasts, refreshes; community-locked unchanged | module + web unit + e2e | `pnpm --filter @rede-social/module-feed test` ; `playwright test social.spec.ts reels.spec.ts comunidades.spec.ts` | ✅ | ✅ green |
| 9-11-03 | 11 | 11 | SOCIAL-09 | T-09-27, T-09-15 | blocked author and `social` off are the standard not-found | web unit + e2e | `playwright test social.spec.ts` | ✅ | ✅ green |
| 9-12-01 | 12 | 12 | SOCIAL-01 | T-09-30, T-09-31 | enable only through the confirmation; disabled while Feed is off | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run components/platform/ModuleToggles` ; `playwright test social-platform.spec.ts platform-tenants.spec.ts` | ✅ | ✅ green |
| 9-12-02 | 12 | 12 | SOCIAL-05 | T-09-30, T-09-39 | limits sheet with range errors; values reach the composer and the broker | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/social-limits components/platform` ; `playwright test social-platform.spec.ts social.spec.ts` | ✅ | ✅ green |
| 9-13-01 | 13 | 13 | SOCIAL-10 | T-09-07 | one phase walk; nothing of rede-demo reaches rede-lab | e2e + sweep | `playwright test phase9-smoke.spec.ts` ; `exec vitest run tests/integration/isolation.test.ts -t "phase 09 sweep"` | ✅ | ✅ green |
| 9-13-02 | 13 | 13 | SOCIAL-01, SOCIAL-10 | T-09-31, T-09-32, T-09-40 | release order and the go-live item written; records verified | grep + unit | `grep` checks of DEPLOY.md, PROJECT.md, README; `exec vitest run tests/unit/module-readmes.test.ts` | ✅ | ✅ green |
| 9-13-03 | 13 | 13 | SOCIAL-10 | T-09-32, T-09-07 | the whole gate, migration order, prohibition ledger | full gate | `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` | ✅ | ⚠️ gate ran in parts |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `.planning/phases/09-rede-social-follow-member-posts-and-explorar/09-03-SPIKE.md` (+ `09-03-spike.sql`) — the measured Explorar form, read by plan 04
- [x] `supabase/tests/200-social.sql`, `supabase/tests/201-feed-social-gate.sql` — policies, seam, definers, gate truth table, plan pins
- [x] `apps/api/tests/integration/{social-module,social,feed-social,social-media,moderation-posts}.test.ts` and the `withSocialEnabled` helper in `setup.ts`
- [x] `apps/web/e2e/{social,social-platform,phase9-smoke}.spec.ts` mapped in `affected-map.json`
- [x] `scripts/seed.ts`: `social` on for rede-lab and two follow fixtures; rede-demo unchanged
- [x] Rewritten tests: `registry.test.ts` matrices, `feed.test.ts` case 7, the lab pins in `modules.test.ts` and `isolation.test.ts`, `090-feed.sql` and `130-reels.sql` index pins, `isolation-inventory.ts` entries

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Design-team approval of the designed screens (chip row, empty states, "Siga para ver", counts block, lists, member composer, platform row and sheet) | EXPL-01, EXPL-04, EXPL-05, FOLLOW-04, SOCIAL-01 | The sketch gate needs the user's hand (D-33, D-365; row `012-phase-09-designed-screens`) | `/gsd-sketch 9`, review, the user pastes the approval; the web plans halt on a precondition until then |
| Real-device PWA check: composer, Explorar, "Siga para ver", Reels from Explorar, push for the comment notice | EXPL-05, EXPL-06, SOCIAL-08 | Phones cannot reach `*.localhost`; push needs the hosted stack | after the homolog deploy of this release, DEPLOY.md "Manual UAT (hosted)" |
| Real Mux duration rejection of a member video | SOCIAL-05 | Local runs use the fake provider (same `applyReady` path) | on homolog, a member uploads a video over the tenant cap and the asset ends `rejected` |
| Terms, rules and privacy policy wording for third-party content (D-478) | SOCIAL-01 | Legal text is the operator's, not code; pending | review before the `super_admin` turns `social` on for any tenant; the user is told (DEPLOY.md go-live item) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120 s per task sample
- [x] `nyquist_compliant: true` set in frontmatter (plan 09-13, 2026-10-20)

**Approval:** conditional (plan 09-13, 2026-10-20). The structural contract holds: every task has an automated command, Wave 0 exists, sampling is continuous. `status` stays `draft` until `validate-phase` sets it, because the exit gate was **not one clean `pnpm verify` exit**:

- `pnpm verify` ran lint, typecheck, build, unit, static routes, boundaries (and the negative check), lanes, pgTAP (38 files, 2057 tests PASS, run before integration), the integration suite (76 files, 1538 tests passed), the spike, reset and seed green, then **the web server ran out of disk (ENOSPC) at e2e test 244 of the mobile project**. The e2e stage was then re-run in chunks (cache cleaned between them) on the same database: mobile, pixel and desktop projects, plus `e2e:pwa` (64 passed).
- Every e2e spec that Phase 09 wrote or changed passed on both projects (`social.spec.ts`, `social-platform.spec.ts`, `phase9-smoke.spec.ts`, `platform-domains.spec.ts` after the 09-13 fix). The e2e failures that remain are all out of phase and are listed in `deferred-items.md`: `admin-branding.spec.ts:303`, `platform-branding.spec.ts:223`, `signup.spec.ts:331`, `admin-members.spec.ts` "role tracer", and the five `profile.spec.ts` dashboard cases (a same-day-seed artifact).
- Not run, said plainly: a single uninterrupted `pnpm verify`; real-device and visual checks (Manual-Only table above).

*Per-task map filled from the plans by the planner on 2026-10-19; reconciled with CONTEXT.md (the Admin-badge amendment UI-D-509 and the bullet-format re-tags do not change any entry).*
