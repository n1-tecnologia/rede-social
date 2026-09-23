---
phase: "05"
slug: "communities-stories"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-23"
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `05-RESEARCH.md` §Validation Architecture.
> The Per-Task Verification Map is filled by `/gsd-validate-phase` once PLAN.md task IDs exist.

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

<!-- Filled by /gsd-validate-phase after planning; task IDs do not exist at plan-seed time. -->
<!-- Requirement → behavior → command rows are already derived in 05-RESEARCH.md §Validation Architecture → "Phase Requirements → Test Map"; map them onto task IDs there. -->

| Requirement | Plans | Behavior verified | Test Type | Automated Command | Status |
|-------------|-------|-------------------|-----------|-------------------|--------|
| COMM-01 | TBD | Create / edit / archive a community; archived refused for writes, still readable by link, absent from the list | integration | `npx vitest run tests/integration/communities.test.ts` (apps/api) | ⬜ pending |
| COMM-01 | TBD | Cover optional → brand-gradient fallback renders | e2e | `comunidades.spec.ts` | ⬜ pending |
| COMM-02 | TBD | Every member sees every community; `community_members` exists with RLS + policy and a cross-tenant case | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`, `020-tenant-isolation.sql`) | ⬜ pending |
| COMM-03 | TBD | List shows cover/name/description/post count; keyset pages; ordering by `last_activity_at` is index-served | integration + pgTAP | `npx vitest run tests/integration/communities.test.ts` · `pnpm supabase test db` (EXPLAIN block) | ⬜ pending |
| COMM-03 | TBD | Community page shows its posts **and** its pinned stories | e2e | `comunidades.spec.ts` | ⬜ pending |
| COMM-04 | TBD | Posting into a community from its page; the post appears in both the community and the merged feed | integration + e2e | `npx vitest run tests/integration/communities.test.ts` · `comunidades.spec.ts` | ⬜ pending |
| D-73 / FEED-02 | TBD | Merged feed is **index-served** (not Seq Scan + Sort) and strictly chronological across both sources | pgTAP + integration | `pnpm supabase test db` (`090-feed.sql` new plan assertion) · `feed.test.ts` | ⬜ pending |
| D-74 | TBD | Turning `communities` off reverts the predicate; posts survive; re-enabling restores | integration | `npx vitest run tests/integration/communities.test.ts` (module-flag witness, both directions) | ⬜ pending |
| STORY-01 | TBD | Publish image and video stories with optional caption; `purpose: 'story'`; >60 s video ends `rejected`/`duration_too_long` | integration | `npx vitest run tests/integration/stories.test.ts` · existing `mux-webhook.test.ts` pattern | ⬜ pending |
| STORY-02 | TBD | Strip renders active stories newest-first; viewer advances, tap-navigates, holds-to-pause; comment sheet pauses it | e2e (mobile project) | `stories.spec.ts` | ⬜ pending |
| STORY-02 | TBD | Progress clock unit behaviour (pause/resume/skip preserves elapsed) | unit | `pnpm --filter @tria/module-stories test` (`story-clock.test.ts`) | ⬜ pending |
| STORY-03 | TBD | Active/expired split under a controlled clock; the expired **row is retained** | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`) | ⬜ pending |
| STORY-04 | TBD | Pin/unpin; a pinned expired story still renders on the community page; unpin removes it | pgTAP + integration | `pnpm supabase test db` · `npx vitest run tests/integration/stories.test.ts` | ⬜ pending |
| STORY-05 | TBD | Reply to a story comment and like of a story comment refused by the **DB** (honest + lying), with positive controls | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`) | ⬜ pending |
| STORY-05 | TBD | The same two refusals at the **API**, as stable machine codes | integration | `npx vitest run tests/integration/stories.test.ts` | ⬜ pending |
| Pitfall 1 | TBD | The 3-valued CHECK hole is closed: `depth = 1` with `parent_depth` null is refused | pgTAP | `pnpm supabase test db` (`090-feed.sql` or `110-…`) | ⬜ pending |
| TENANT-05 | TBD | Cross-tenant: `communities`, `community_members`, `stories`, `story_community_pins` each see own rows and **zero** of tenant B, with identical-looking content | pgTAP + integration | `pnpm supabase test db` (`020-tenant-isolation.sql`) · `npx vitest run tests/integration/isolation.test.ts` | ⬜ pending |
| MOD-03 | TBD | New domain events typed, emitted after commit, once, none on rollback | unit | `pnpm --filter @tria/module-stories test` (`events.test.ts`) | ⬜ pending |
| MOD-04 | TBD | Two modules mount/unmount by flag; a disabled module's routes 404 | integration | `npx vitest run tests/integration/isolation.test.ts` | ⬜ pending |
| Query budget | TBD | `/v1/communities` and `/v1/stories` each execute ≤ N statements per page, with a **floor** as well as a ceiling | integration | `npx vitest run tests/integration/feed-query-budget.test.ts` (extended) | ⬜ pending |
| UI-01 / UI-04 | TBD | Five prototype-less surfaces approved through the D-33 UI-SPEC + mockup | manual | — | manual-only |
| ADMIN-04 | TBD | Every admin creation flow usable from a phone | e2e (mobile viewport) | `comunidades.spec.ts` · `stories.spec.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

15 gaps, transcribed from `05-RESEARCH.md` §Validation Architecture → "Wave 0 Gaps".

- [ ] `packages/modules/communities/{vitest.config.ts, package.json test script}` — new package has no runner
- [ ] `packages/modules/stories/{vitest.config.ts, package.json test script}` — new package has no runner
- [ ] `packages/modules/stories/tests/story-clock.test.ts` — the rAF progress clock's pause/resume/skip contract, with an injected clock (no timers in the assertion)
- [ ] `packages/modules/stories/tests/events.test.ts` — after-commit emission, once-only, none-on-rollback (the `@tria/module-feed/tests/events.test.ts` copy)
- [ ] `apps/api/tests/integration/communities.test.ts` — CRUD, archive semantics, COMM-04 write path, the D-74 module-flag witness in **both** directions
- [ ] `apps/api/tests/integration/stories.test.ts` — publish (image + video), expiry visibility, pin/unpin, story like/comment, and the two STORY-05 API refusals by machine code
- [ ] `supabase/tests/110-communities-stories.sql` — STORY-05 negatives + positive controls, the Pitfall-1 probe, the controlled-clock expiry pair, the pinned-survives-expiry case, counter reconciliation for `post_count` / `last_activity_at` / story counters, and an `EXPLAIN` block for the community list ordering
- [ ] `supabase/tests/020-tenant-isolation.sql` — a case per new table, identical-looking content in both tenants, positive control in the same test
- [ ] `supabase/tests/090-feed.sql` — a fourth plan assertion for the **merged feed** index (D-73), on its own volume fixture
- [ ] `apps/api/tests/integration/isolation.test.ts` — cross-tenant 404 for a community id, a story id and a pin; `403 TENANT_HOST_MISMATCH` on the new routes
- [ ] `apps/api/tests/integration/feed-query-budget.test.ts` — budgets for `/v1/communities` and `/v1/stories`, each with ceiling **and** floor
- [ ] `apps/web/e2e/comunidades.spec.ts` — tab → list → page → post path, cover-less gradient fallback, admin FAB pre-fills `/criar`, archived read-only state
- [ ] `apps/web/e2e/stories.spec.ts` — mobile project: strip order, viewer advance/tap/hold, comment sheet pauses, admin "+" circle invisible to members, "Seus stories" pin flow. Set `serviceWorkers: 'block'` on any spec that intercepts GET (03-05 precedent)
- [ ] `apps/web/e2e/phase5-smoke.spec.ts` — the per-phase two-direction module-flag witness for `communities` and `stories`
- [ ] `scripts/seed.ts` — communities with and without covers, active + expired stories, ≥1 pinned expired story, story likes and flat story comments, in **both** demo tenants with identical-looking content

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Story viewer gesture feel on a real phone (tap-to-navigate, hold-to-pause, progress-bar tracking) | STORY-02, UI-02 | Playwright can dispatch the events but cannot prove the gesture and the 5 s progress animation read correctly under a real touch digitiser | On a real iPhone (Safari) and a real Android (Chrome), open the strip, confirm auto-advance at ~5 s, tap right/left to navigate, hold to pause and confirm the bar freezes then resumes from the same elapsed position |
| Five prototype-less surfaces approved through the D-33 UI-SPEC + mockup | UI-01, UI-04 | Design sign-off is a human decision; the stories strip, story viewer, story publish, community create/edit form and pin flow have no prototype to port from | One blocking `checkpoint:human-verify` on the `05-UI-SPEC.md` + mockups before any of the five surfaces is coded (02-02 / 03-06 / 04 precedent). Includes the open question of whether the community "Destaques" circles become interactive |
| Terminal `rejected` / `duration_too_long` state after "processando" on a >60 s story video | STORY-01 | The ~60 s limit is enforced asynchronously in the Mux webhook worker, so the wall-clock path from upload → processing → rejection depends on a real vendor round trip | Publish a >60 s video story from a phone, confirm the publish screen shows "processando" then reaches a terminal rejected state with a pt-BR reason, and that no story row becomes visible in the strip |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references — 15 items
- [ ] No watch-mode flags
- [ ] Every task's `<automated>` chain is ordered T1 → T2 (→ T3 only in the final plan's last task)
- [ ] T1 primary signal < 60 s on every task; T2 < 5 min per task; T3 run once, ≤ 25 min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
