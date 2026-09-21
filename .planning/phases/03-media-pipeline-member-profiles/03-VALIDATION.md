---
phase: "03"
slug: "media-pipeline-member-profiles"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-21"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `03-RESEARCH.md` §Validation Architecture.
> The Per-Task Verification Map is filled by `/gsd-validate-phase` once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (e2e) |
| **Config file** | per-package `vitest.config.ts`; `apps/web/playwright.config.ts`; `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @tria/core test` |
| **Full suite command** | `pnpm verify` (the local exit gate; `ci.yml` mirrors it step for step) |
| **Estimated runtime** | ~1050 seconds full suite (Phase 2 baseline: 17m30s); quick run seconds-scale |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter <package> test` for the touched package
- **After every plan wave:** Run `pnpm supabase test db` + `pnpm test:integration`
- **Before `/gsd-verify-work`:** Full `pnpm verify` must be green

### Feedback Latency Ceiling (tiered)

A single flat ceiling is not true for this phase and was never what the 60-second figure meant.
Roughly half of Phase 3's user-observable behaviour — the silent HEIC re-encode, the >6 MiB TUS
path, resumable video transfer, the HLS player's three states, keyset "Carregar mais" — is
**only** observable in a browser, so a targeted Playwright spec is the *primary* signal for those
behaviours, not a slow substitute for a faster one that exists. Declaring a 60-second universal
ceiling would force either a dishonest command or a dishonest claim. The phase therefore declares
three tiers, and every task's `<automated>` chain is ordered fast-tier-first so `&&` short-circuits
on the cheapest gate that can fail:

| Tier | What runs | Declared ceiling | Where it is the primary signal |
|------|-----------|------------------|--------------------------------|
| **T1 — inner loop** | `pnpm --filter <pkg> typecheck`, `lint`, `test`, `bash scripts/check-ui-literals.sh`, `test -z "$(git status --porcelain …)"`, targeted `grep -q` artifact gates | **≤ 60 s** | Every task. T1 is the first segment of every `<automated>` chain, so any type, lint, contract, drift or copy error reports inside 60 s without the later tiers running at all. |
| **T2 — behaviour gate** | `pnpm test:integration -- <filters>`, `pnpm supabase test db`, one or two **targeted** Playwright spec files (never the full e2e suite) | **≤ 5 min per task** | The browser-only and DB-only behaviours listed above. If a single spec file exceeds 5 minutes, split the spec — do not relax the tier. |
| **T3 — phase exit gate** | `pnpm verify` | **≤ 20 min, run once** | `03-08` Task 3 only. Phase 2's baseline run was 17m30s; ~1050 s is the expected cost and is budgeted, not an overrun. No other task may put `pnpm verify` in its `<automated>`. |

- **Nyquist reading:** sampling continuity is satisfied at T1 (every task, ≤60 s) and confirmed at
  T2. T3 is a gate, not a sample.

---

## Per-Task Verification Map

<!-- Filled by /gsd-validate-phase after planning; task IDs do not exist at plan-seed time. -->
<!-- Requirement → behavior → command rows are already derived in 03-RESEARCH.md §Validation Architecture → "Phase Requirements → Test Map"; map them onto task IDs there. -->

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/070-media-bucket.sql` — bucket row invariants + zero `storage.objects` policies (R-15) — covers TENANT-04
- [ ] `packages/core/server/media/__tests__/` — pure-layer unit tests (keys, limits, inspect, variants) — covers MEDIA-01/02
- [ ] `apps/api/tests/integration/media.test.ts` — start/complete/serve/quota — covers MEDIA-01/02
- [ ] `apps/api/tests/integration/mux-webhook.test.ts` — signature, replay, ready/errored — covers MEDIA-03
- [ ] `apps/api/tests/integration/members.test.ts` — directory filters, search, keyset — covers PROF-03
- [ ] `apps/web/e2e/media-upload.spec.ts`, `media-heic.spec.ts`, `profile.spec.ts`, `members.spec.ts`
- [ ] **Fixtures** in `apps/web/e2e/fixtures/`: a real iPhone-originated `.heic` (downscaled *on an iPhone*, not re-encoded on a Mac), a >6 MB JPEG (TUS path), a 48 MP JPEG (bomb guard), a short HEVC `.mov`
- [ ] `scripts/seed.ts` extension: members with and without a photo, and at least two accented pt-BR names (so the search assertions have real data)
- [ ] Extend `apps/api/tests/integration/isolation.test.ts` with the Storage-signed-URL and Mux-playback-token cases (SCHEMA-CONVENTIONS §(j) rule 2 makes this mandatory, not optional)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device HLS playback with thumbnail on iOS Safari + Android Chrome | MEDIA-03 | Playwright's bundled Chromium cannot prove iOS Safari HLS — same class as 02-11's standalone-install finding | Upload a phone-recorded HEVC video as `admin_tenant`; confirm the "processando" placeholder, then playback with thumbnail on a real iPhone (Safari) and a real Android device (Chrome) |
| Mux-backed transcode against a real account | MEDIA-03 | No Mux account and no GCP Secret Manager exist yet — Phase 01.1 is deferred to the end | Phase 01.1 runbook item; automated proof runs against the fake video provider until then |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Every task's `<automated>` chain is ordered T1 → T2 (→ T3 only in `03-08` Task 3)
- [ ] T1 primary signal < 60s on every task; T2 < 5 min per task; T3 run once, ≤ 20 min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
