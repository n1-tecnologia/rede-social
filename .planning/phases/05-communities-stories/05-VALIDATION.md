---
phase: "05"
slug: "communities-stories"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: false
validated: "2026-09-23"
automated: 21
manual_only: 1
escalated: 0
created: "2026-09-23"
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `05-RESEARCH.md` §Validation Architecture.
> The Per-Task Verification Map was bound to real plan + task IDs on 2026-09-23, during the
> post-check revision of the eight Phase 5 plans — not by a `/gsd-validate-phase` run. Everything
> below that is a *planning* fact (bindings, coverage, chain ordering) is now reconciled; everything
> that is an *execution* fact (test results, files on disk, wall-clock tier timings) is explicitly
> left open, because no Phase 5 task has run.
>
> **Frontmatter reading.** `status: validated` = the map is bound and reconciled.
> `nyquist_compliant: true` asserts the four properties that are provable by reading the plans:
> all 24 tasks carry an `<automated>` verify (25 blocks / 25 `<fails_when>`), every chain opens on a
> T1 segment, `pnpm verify` appears exactly once (05-08 Task 3, the last task of the last plan), and
> no command carries a watch-mode flag. It does **not** assert that any test has run, nor that the
> declared wall-clock ceilings were measured. `wave_0_complete: false` is correct and stays false:
> it describes disk state after execution, and none of the 15 Wave 0 artifacts exists yet — all 15
> are, however, bound below to the task that creates them.
> Counts: 21 automated map rows, 1 manual-only map row, 0 escalated.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (e2e) |
| **Config file** | per-package `vitest.config.ts`; `apps/web/playwright.config.ts` + `playwright.pwa.config.ts`; `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @tria/module-communities test && pnpm --filter @tria/module-stories test` (new packages) / `pnpm --filter @tria/api test` |
| **Full suite command** | `pnpm verify` (the local exit gate; `ci.yml` mirrors it step for step) |
| **Estimated runtime** | Phase 4 baseline ~21m51s (unit 512, pgTAP 195, integration 373, e2e 328); Phase 5 adds ~2 pgTAP files' worth and 3–4 specs |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @tria/module-communities test && pnpm --filter @tria/module-stories test && pnpm --filter @tria/api test` (T1, ≤ 60 s)
- **After every plan wave:** `pnpm lint && pnpm turbo typecheck test && pnpm supabase test db && pnpm test:integration` (T2, ≤ 5 min per task when filtered)
- **Before `/gsd-verify-work`:** Full `pnpm verify` must be green (T3, run once, ≤ 25 min)

### Feedback Latency Ceiling (tiered)

Phase 5 inherits Phase 4's tiered ceiling for the same reason: the stories strip, the viewer's
tap / hold / auto-advance gestures and the comment sheet pausing playback are **only** observable in
a browser, so a targeted Playwright spec is the *primary* signal for those behaviours, not a slow
substitute for a faster one. Order every task's `<automated>` chain T1 → T2 so `&&` short-circuits on
the cheapest gate that can fail.

| Tier | What runs | Declared ceiling | Where it is the primary signal |
|------|-----------|------------------|--------------------------------|
| **T1 — inner loop** | `pnpm --filter <pkg> typecheck`, `lint`, `test`, `bash scripts/check-ui-literals.sh`, `test -z "$(git status --porcelain …)"`, targeted `grep -q` artifact gates | **≤ 60 s** | Every task. T1 is the first segment of every `<automated>` chain, so any type, lint, contract, drift or copy error reports inside 60 s without the later tiers running at all. |
| **T2 — behaviour gate** | `pnpm test:integration -- <filters>`, `pnpm supabase test db`, one or two **targeted** Playwright spec files (never the full e2e suite) | **≤ 5 min per task** | The browser-only and DB-only behaviours above, plus the `EXPLAIN` plan assertions and the `pg_stat_statements` query budgets. If a single spec file exceeds 5 minutes, split the spec — do not relax the tier. |
| **T3 — phase exit gate** | `pnpm verify` | **≤ 25 min, run once** | The final plan's last task only. No other task may put `pnpm verify` in its `<automated>`. |

- **Nyquist reading:** sampling continuity is satisfied at T1 (every task, ≤ 60 s) and confirmed at T2. T3 is a gate, not a sample.

---

## Per-Task Verification Map

<!-- Bound to real plan + task IDs on 2026-09-23 during the post-check plan revision. -->
<!-- Requirement → behavior → command rows are derived in 05-RESEARCH.md §Validation Architecture → "Phase Requirements → Test Map"; the Plans column below names the task that makes each row true. -->

**How to read the two right-hand columns.** *Plans* is a planning fact and is now bound: every row
names the `{plan} T{n}` task(s) whose `<automated>` chain executes that command. *Status* is an
execution fact and therefore stays `⬜ pending` on every automated row — nothing in Phase 5 has run.
It is filled by `/gsd-execute-phase 05` and closed by `/gsd-verify-work 05`; a row flipped to ✅
before then would be a fabricated result, not a validated one.

| Requirement | Plans | Behavior verified | Test Type | Automated Command | Status |
|-------------|-------|-------------------|-----------|-------------------|--------|
| COMM-01 | 05-01 T1, 05-04 T2, 05-04 T3 | Create / edit / archive a community; archived refused for writes, still readable by link, absent from the list | integration | `npx vitest run tests/integration/communities.test.ts` (apps/api) | ⬜ pending |
| COMM-01 | 05-04 T1, 05-04 T3 | Cover optional → brand-gradient fallback renders | e2e | `comunidades.spec.ts` | ⬜ pending |
| COMM-02 | 05-01 T1, 05-01 T2 | Every member sees every community; `community_members` exists with RLS + policy and a cross-tenant case | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`, `020-tenant-isolation.sql`) | ⬜ pending |
| COMM-03 | 05-01 T1, 05-01 T3, 05-04 T3 | List shows cover/name/description/post count; keyset pages; ordering by `last_activity_at` is index-served | integration + pgTAP | `npx vitest run tests/integration/communities.test.ts` · `pnpm supabase test db` (EXPLAIN block) | ⬜ pending |
| COMM-03 | 05-04 T1, 05-08 T1, 05-08 T3 | Community page shows its posts **and** its pinned stories | e2e | `comunidades.spec.ts` | ⬜ pending |
| COMM-04 | 05-03 T1, 05-03 T3, 05-04 T1 | Posting into a community from its page; the post appears in both the community and the merged feed | integration + e2e | `npx vitest run tests/integration/communities.test.ts` · `comunidades.spec.ts` | ⬜ pending |
| D-73 / FEED-02 | 05-03 T1, 05-03 T2 | Merged feed is **index-served** (not Seq Scan + Sort) and strictly chronological across both sources | pgTAP + integration | `pnpm supabase test db` (`090-feed.sql` new plan assertion) · `feed.test.ts` | ⬜ pending |
| D-74 | 05-03 T1, 05-03 T3 | Turning `communities` off reverts the predicate; posts survive; re-enabling restores | integration | `npx vitest run tests/integration/communities.test.ts` (module-flag witness, both directions) | ⬜ pending |
| STORY-01 | 05-05 T1, 05-05 T3 | Publish image and video stories with optional caption; `purpose: 'story'`; >60 s video ends `rejected`/`duration_too_long` | integration | `npx vitest run tests/integration/stories.test.ts` · existing `mux-webhook.test.ts` pattern | ⬜ pending |
| STORY-02 | 05-05 T1, 05-06 T3, 05-07 T3 | Strip renders active stories newest-first; viewer advances, tap-navigates, holds-to-pause; comment sheet pauses it | e2e (mobile project) | `stories.spec.ts` | ⬜ pending |
| STORY-02 | 05-06 T1 | Progress clock unit behaviour (pause/resume/skip preserves elapsed) | unit | `pnpm --filter @tria/module-stories test` (`story-clock.test.ts`) | ⬜ pending |
| STORY-03 | 05-05 T1, 05-05 T2 | Active/expired split under a controlled clock; the expired **row is retained** | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`) | ⬜ pending |
| STORY-04 | 05-08 T1, 05-08 T2, 05-08 T3 | Pin/unpin; a pinned expired story still renders on the community page; unpin removes it | pgTAP + integration | `pnpm supabase test db` · `npx vitest run tests/integration/stories.test.ts` | ⬜ pending |
| STORY-05 | 05-07 T1, 05-07 T2 | Reply to a story comment and like of a story comment refused by the **DB** (honest + lying), with positive controls | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`) | ⬜ pending |
| STORY-05 | 05-07 T1, 05-07 T3 | The same two refusals at the **API**, as stable machine codes | integration | `npx vitest run tests/integration/stories.test.ts` | ⬜ pending |
| Pitfall 1 | 05-07 T1, 05-07 T2 | The 3-valued CHECK hole is closed: `depth = 1` with `parent_depth` null is refused | pgTAP | `pnpm supabase test db` (`090-feed.sql` or `110-…`) | ⬜ pending |
| TENANT-05 | 05-01 T2, 05-01 T3, 05-05 T2, 05-05 T3, 05-08 T2 | Cross-tenant: `communities`, `community_members`, `stories`, `story_community_pins` each see own rows and **zero** of tenant B, with identical-looking content | pgTAP + integration | `pnpm supabase test db` (`020-tenant-isolation.sql`) · `npx vitest run tests/integration/isolation.test.ts` | ⬜ pending |
| MOD-03 | 05-01 T3, 05-05 T3 | New domain events typed, emitted after commit, once, none on rollback | unit | `pnpm --filter @tria/module-stories test` (`events.test.ts`) | ⬜ pending |
| MOD-04 | 05-01 T3, 05-05 T3, 05-08 T3 | Two modules mount/unmount by flag; a disabled module's routes 404 | integration | `npx vitest run tests/integration/isolation.test.ts` · `phase5-smoke.spec.ts` | ⬜ pending |
| Query budget | 05-01 T3, 05-03 T3, 05-05 T3 | `/v1/communities` and `/v1/stories` each execute ≤ N statements per page, with a **floor** as well as a ceiling | integration | `npx vitest run tests/integration/feed-query-budget.test.ts` (extended) | ⬜ pending |
| UI-01 / UI-04 | produced by 05-02 T1 + 05-02 T2; **gates** 05-04 T2, 05-05 T1, 05-05 T3, 05-06 T1, 05-08 T1, 05-08 T3 | Five prototype-less surfaces approved through the D-33 UI-SPEC + mockup | manual, machine-gated | the review itself is a human judgement, but its *outcome* is machine-read: each gated task's `precondition` runs `grep -q '^approved: true' .planning/sketches/003-phase-05-designed-screens/README.md` and halts while it is false, and 05-04 T2's `<automated>` chain re-asserts it as its first segment | ⬜ gate armed, review not run |
| ADMIN-04 | 05-04 T3, 05-05 T3, 05-08 T3 | Every admin creation flow usable from a phone | e2e (mobile viewport) | `comunidades.spec.ts` · `stories.spec.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

15 gaps, transcribed from `05-RESEARCH.md` §Validation Architecture → "Wave 0 Gaps", each now bound
to the plan + task that creates it. **The boxes stay unchecked on purpose:** they record disk state
after execution, and no Phase 5 task has run, so none of these files exists yet. Coverage — the
planning fact — is complete: every one of the 15 appears in the `files_modified` of the plan named
beside it, and 15/15 are claimed by a task.

- [ ] `packages/modules/communities/{vitest.config.ts, package.json test script}` — new package has no runner → **05-01 T1**
- [ ] `packages/modules/stories/{vitest.config.ts, package.json test script}` — new package has no runner → **05-05 T1**
- [ ] `packages/modules/stories/tests/story-clock.test.ts` — the rAF progress clock's pause/resume/skip contract, with an injected clock (no timers in the assertion) → **05-06 T1**
- [ ] `packages/modules/stories/tests/events.test.ts` — after-commit emission, once-only, none-on-rollback (the `@tria/module-feed/tests/events.test.ts` copy) → **05-05 T3**
- [ ] `apps/api/tests/integration/communities.test.ts` — CRUD, archive semantics, COMM-04 write path, the D-74 module-flag witness in **both** directions → created **05-01 T3**, extended **05-03 T3** (D-74 + COMM-04) and **05-04 T3** (archive semantics)
- [ ] `apps/api/tests/integration/stories.test.ts` — publish (image + video), expiry visibility, pin/unpin, story like/comment, and the two STORY-05 API refusals by machine code → created **05-05 T3**, extended **05-06 T2** (likes), **05-07 T3** (STORY-05 codes), **05-08 T2** (pins)
- [ ] `supabase/tests/110-communities-stories.sql` — STORY-05 negatives + positive controls, the Pitfall-1 probe, the controlled-clock expiry pair, the pinned-survives-expiry case, counter reconciliation for `post_count` / `last_activity_at` / story counters, and an `EXPLAIN` block for the community list ordering → created **05-04 T3** (counters + EXPLAIN), extended **05-05 T2** (expiry), **05-06 T2** (like counters), **05-07 T2** (STORY-05 + Pitfall 1), **05-08 T2** (pin survives expiry)
- [ ] `supabase/tests/020-tenant-isolation.sql` — a case per new table, identical-looking content in both tenants, positive control in the same test → **05-01 T2** (communities, community_members), **05-05 T2** (stories), **05-08 T2** (story_community_pins)
- [ ] `supabase/tests/090-feed.sql` — a fourth plan assertion for the **merged feed** index (D-73), on its own volume fixture → **05-03 T2**; the Pitfall-1 probe may land here or in `110-…` per **05-07 T2**
- [ ] `apps/api/tests/integration/isolation.test.ts` — cross-tenant 404 for a community id, a story id and a pin; `403 TENANT_HOST_MISMATCH` on the new routes → **05-01 T3** (community), **05-05 T3** (story), **05-08 T2** (pin)
- [ ] `apps/api/tests/integration/feed-query-budget.test.ts` — budgets for `/v1/communities` and `/v1/stories`, each with ceiling **and** floor → **05-01 T3** (`/v1/communities`), **05-03 T3** (merged feed), **05-05 T3** (`/v1/stories`)
- [ ] `apps/web/e2e/comunidades.spec.ts` — tab → list → page → post path, cover-less gradient fallback, admin FAB pre-fills `/criar`, archived read-only state → created **05-01 T3**, extended **05-03 T3** (picker path), **05-04 T3** (page → archive walk), **05-08 T3** (Destaques)
- [ ] `apps/web/e2e/stories.spec.ts` — mobile project: strip order, viewer advance/tap/hold, comment sheet pauses, admin "+" circle invisible to members, "Seus stories" pin flow. Set `serviceWorkers: 'block'` on any spec that intercepts GET (03-05 precedent) → created **05-05 T3**, extended **05-06 T3** (gestures), **05-07 T3** (comment sheet pauses), **05-08 T3** (pin flow)
- [ ] `apps/web/e2e/phase5-smoke.spec.ts` — the per-phase two-direction module-flag witness for `communities` and `stories` → **05-08 T3**
- [ ] `scripts/seed.ts` — communities with and without covers, active + expired stories, ≥1 pinned expired story, story likes and flat story comments, in **both** demo tenants with identical-looking content → **05-01 T2**, **05-03 T2**, **05-04 T3**, **05-05 T2**, **05-06 T2**, **05-07 T2**, **05-08 T2**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Story viewer gesture feel on a real phone (tap-to-navigate, hold-to-pause, progress-bar tracking) | STORY-02, UI-02 | Playwright can dispatch the events but cannot prove the gesture and the 5 s progress animation read correctly under a real touch digitiser | On a real iPhone (Safari) and a real Android (Chrome), open the strip, confirm auto-advance at ~5 s, tap right/left to navigate, hold to pause and confirm the bar freezes then resumes from the same elapsed position |
| Five prototype-less surfaces approved through the D-33 UI-SPEC + mockup | UI-01, UI-04 | Design sign-off is a human decision; the stories strip, story viewer, story publish, community create/edit form and pin flow have no prototype to port from | Open `.planning/sketches/003-phase-05-designed-screens/index.html` in a browser, work through the six-point checklist in 05-02 Task 2's `human-check` (light + dark, two tenant brands), then record the outcome in that package's `README.md` frontmatter (`status`, `approved`, `approved_by`, `approved_at`, `approval_kind`, `changes_requested`). Includes the open question of whether the community "Destaques" circles become interactive (D-68) and the removal of double-tap-to-like (UI-D-31). **This is manual but not un-gated:** `workflow.human_verify_mode` is `end-of-phase`, so it is not a mid-flight `checkpoint:human-verify`; instead the six tasks that code the five surfaces (05-04 T2, 05-05 T1, 05-05 T3, 05-06 T1, 05-08 T1, 05-08 T3) each carry a `precondition` asserting `approved: true` in that README and halt while it reads `false`, and 05-04 T2's `<automated>` chain re-asserts it first. 05-04 is wave 3 and 05-05..05-08 all descend from it, so an un-run review stops Phase 5 after wave 2 |
| Terminal `rejected` / `duration_too_long` state after "processando" on a >60 s story video | STORY-01 | The ~60 s limit is enforced asynchronously in the Mux webhook worker, so the wall-clock path from upload → processing → rejection depends on a real vendor round trip | Publish a >60 s video story from a phone, confirm the publish screen shows "processando" then reaches a terminal rejected state with a pt-BR reason, and that no story row becomes visible in the strip |

---

## Validation Sign-Off

Verified by reading the eight Phase 5 plans on 2026-09-23 (planning-time facts, ticked) and
separated from the execution-time facts (left open, with the reason).

**Planning facts — verified:**

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 24/24 tasks; 25 `<automated>` blocks and 25 `<fails_when>`
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — every task carries one, so the worst gap is 0
- [x] Wave 0 covers all MISSING references — 15 items, each bound above to the task that creates it
- [x] No watch-mode flags — no `--watch` / `--ui` in any `<automated>` across the eight plans
- [x] Every task's `<automated>` chain is ordered T1 → T2 (→ T3 only in the final plan's last task) — every chain opens on a T1 segment (`typecheck`, `test`, `db:generate`, `grep -q` / `test -f` artifact gate); `pnpm verify` appears exactly once, in 05-08 Task 3
- [x] The D-33 / UI-04 design gate is enforced, not merely declared — 05-02 writes sketch 003's README with `approved: false`, and all six tasks that code one of the five prototype-less surfaces halt on a `precondition` reading `approved: true` from it
- [x] `nyquist_compliant: true` set in frontmatter — asserting the five planning properties above and nothing about runtime (see the frontmatter reading at the top of this file)

**Execution facts — deliberately still open:**

- [ ] T1 primary signal < 60 s on every task; T2 < 5 min per task; T3 run once, ≤ 25 min — *declared and budgeted, not measured. The tiers are a design rule the plans obey structurally (T1-first ordering, targeted spec files, one `pnpm verify`), but the wall clock can only be read during `/gsd-execute-phase 05`. Ticking this before then would report a measurement nobody took.*
- [ ] `wave_0_complete` — *stays `false`: all 15 Wave 0 artifacts are planned and bound, and none exists on disk yet. This box describes execution, not planning.*
- [ ] The three Manual-Only Verifications performed — *the two real-device checks and the D-33 design review are carried to `/gsd-verify-work 05` per `workflow.human_verify_mode: end-of-phase`. The design review additionally blocks execution at wave 3 (see the Manual-Only table).*

**Approval:** map bound and reconciled 2026-09-23 during the post-check revision of the Phase 5
plans. Test results, disk state and the manual checks are recorded by `/gsd-execute-phase 05` and
closed by `/gsd-verify-work 05`.
