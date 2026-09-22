---
phase: "04"
slug: "feed"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-22"
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `04-RESEARCH.md` §Validation Architecture.
> The Per-Task Verification Map is filled by `/gsd-validate-phase` once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (e2e) |
| **Config file** | per-package `vitest.config.ts`; `apps/web/playwright.config.ts` + `playwright.pwa.config.ts`; `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @tria/module-feed test` (new package) / `pnpm --filter @tria/api test` |
| **Full suite command** | `pnpm verify` (the local exit gate; `ci.yml` mirrors it step for step) |
| **Estimated runtime** | ~1230 seconds full suite (Phase 3 baseline: 20m26s); quick run seconds-scale |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @tria/module-feed test && pnpm --filter @tria/api test`
- **After every plan wave:** Run `pnpm lint && pnpm turbo typecheck test && pnpm supabase test db && pnpm test:integration`
- **Before `/gsd-verify-work`:** Full `pnpm verify` must be green

### Feedback Latency Ceiling (tiered)

Phase 4 inherits Phase 3's tiered ceiling for the same reason: a large share of this phase's
user-observable behaviour — double-tap-to-like, the swipe carousel, infinite scroll,
pull-to-refresh, the comment sheet, the share sheet and the logged-out deep-link round trip —
is **only** observable in a browser, so a targeted Playwright spec is the *primary* signal for
those behaviours, not a slow substitute for a faster one. Every task's `<automated>` chain is
ordered fast-tier-first so `&&` short-circuits on the cheapest gate that can fail.

| Tier | What runs | Declared ceiling | Where it is the primary signal |
|------|-----------|------------------|--------------------------------|
| **T1 — inner loop** | `pnpm --filter <pkg> typecheck`, `lint`, `test`, `bash scripts/check-ui-literals.sh`, `test -z "$(git status --porcelain …)"`, targeted `grep -q` artifact gates | **≤ 60 s** | Every task. T1 is the first segment of every `<automated>` chain, so any type, lint, contract, drift or copy error reports inside 60 s without the later tiers running at all. |
| **T2 — behaviour gate** | `pnpm test:integration -- <filters>`, `pnpm supabase test db`, one or two **targeted** Playwright spec files (never the full e2e suite) | **≤ 5 min per task** | The browser-only and DB-only behaviours listed above, plus the `EXPLAIN` plan assertions and the `pg_stat_statements` query budget. If a single spec file exceeds 5 minutes, split the spec — do not relax the tier. |
| **T3 — phase exit gate** | `pnpm verify` | **≤ 25 min, run once** | The final plan's last task only. Phase 3's baseline run was 20m26s; ~1230 s is the expected cost and is budgeted, not an overrun. No other task may put `pnpm verify` in its `<automated>`. |

- **Nyquist reading:** sampling continuity is satisfied at T1 (every task, ≤60 s) and confirmed at
  T2. T3 is a gate, not a sample.

---

## Per-Task Verification Map

<!-- Filled by /gsd-validate-phase after planning; task IDs do not exist at plan-seed time. -->
<!-- Requirement → behavior → command rows are already derived in 04-RESEARCH.md §Validation Architecture → "Phase Requirements → Test Map"; map them onto task IDs there. -->

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/modules/feed/vitest.config.ts` + `package.json` test script — the new package has no test runner yet
- [ ] `packages/modules/feed/tests/unfurl-guard.test.ts` — local `node:http` fixture servers (no internet); covers MEDIA-04 private-IP, IP-literal, redirect-to-private and body-cap refusals
- [ ] `packages/modules/feed/tests/events.test.ts` — after-commit emission, once-only, none-on-rollback; covers MOD-03
- [ ] `apps/api/tests/integration/feed.test.ts` — create/edit/soft-delete, gallery XOR video, like idempotency, comment depth mapping; covers FEED-01/03/04/05/06
- [ ] `apps/api/tests/integration/feed-query-budget.test.ts` — `pg_stat_statements` `sum(calls)` delta filtered by `query ~ 'feed_(posts|comments|likes|...)'`; covers FEED-02 criterion 4
- [ ] `supabase/tests/0xx-feed.sql` — reply-depth negative (FK + CHECK refusals), counter reconciliation, `EXPLAIN` index-scan assertions
- [ ] `supabase/tests/020-tenant-isolation.sql` — substitute feed tables for `example_items`, keeping the positive control per case (**must land before the D-19 `@tria/module-example` removal**, or the exit gate silently weakens)
- [ ] `supabase/tests/030-lanes.sql` — substitute a feed table for `example_items`
- [ ] `apps/web/e2e/feed.spec.ts`, `feed-composer.spec.ts`, `feed-share.spec.ts` — mobile project; set `serviceWorkers: 'block'` on any spec that intercepts GET (03-05 precedent)
- [ ] `apps/web/e2e/phase4-smoke.spec.ts` — the per-phase smoke, extending 02-16's feed-tab witness with a real feed slot
- [ ] `scripts/seed.ts` — seeded posts of each media shape plus comments, replies and likes, in **both** demo tenants with identical-looking content (SCHEMA-CONVENTIONS §(j))
- [ ] Port `InfiniteScroll` into `@tria/ui` taking the IntersectionObserver root from `useScrollContainer()` — the one prototype primitive not yet ported, needed by Phases 5 and 7 too

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native share sheet on a real device | FEED-07 | `navigator.share()` opens an OS-level sheet Playwright cannot enter; only the desktop copy-link fallback is automatable | As a member on a real iPhone (Safari) and a real Android (Chrome), tap share on a post, confirm the OS sheet opens with the `/post/[id]` link; on desktop confirm "Copiar link" writes to the clipboard |
| Double-tap-to-like and swipe carousel feel on a real phone | FEED-04, UI-02 | Playwright can dispatch the events but cannot prove the gesture/animation reads correctly under a real touch digitiser | On a real phone, double-tap a post image (heart animates, likes once — not twice), swipe the gallery through all slides and back, confirm dots track |
| Package approval for `open-graph-scraper@6.12.0` and `undici` | MEDIA-04 | Supply-chain approval is a human decision; `undici` is flagged SUS (release-cadence artefact, not a supply-chain signal) | One blocking `checkpoint:human-verify` before the first install, per the 02-02 / 03-06 precedent. Recommend pinning `undici@7.29.1` (the version exercised in the research probes), not `^7` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Every task's `<automated>` chain is ordered T1 → T2 (→ T3 only in the final plan's last task)
- [ ] T1 primary signal < 60s on every task; T2 < 5 min per task; T3 run once, ≤ 25 min
- [ ] Feed isolation cases land in `020-tenant-isolation.sql` **before** `@tria/module-example` is removed (D-19)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
