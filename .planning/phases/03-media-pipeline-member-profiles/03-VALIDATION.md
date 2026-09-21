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
- **Max feedback latency:** 60 seconds (per-package quick run)

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
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
