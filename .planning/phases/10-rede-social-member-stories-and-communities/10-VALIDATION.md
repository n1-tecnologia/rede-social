---
phase: "10"
slug: "rede-social-member-stories-and-communities"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-10"
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `10-RESEARCH.md` "Validation Architecture"; the planner replaces the requirement-level rows below with task ids (`10-<plan>-T<task>`) once the plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit per package; API integration against the local stack), pgTAP via `supabase test db`, Playwright 1.63.0 (mobile viewports) |
| **Config file** | `packages/modules/<pkg>/vitest.config.ts`, `packages/core/vitest.config.ts`, `apps/api/vitest.config.ts` (`test` = unit, `test:integration` needs the local stack), `apps/web/vitest.config.ts`, `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @rede-social/module-communities test` (or `…module-stories`, `…module-feed`, `…module-social`, `@rede-social/core`, `@rede-social/api` unit, `@rede-social/web`) — the package the task touched |
| **Full suite command** | `pnpm db:reset && pnpm db:seed && pnpm supabase test db`, then per touched integration file `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`; exit gate `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` |
| **Static gates** | `pnpm db:generate 2>&1 \| grep -q "No schema changes"`, `bash scripts/check-ui-literals.sh`, `pnpm boundaries`, `pnpm lint` |
| **Estimated runtime** | ~30 s per task (single package or file); several minutes for the pgTAP + integration wave gate |

Quirks: pgTAP runs BEFORE the integration files (residue trips `154-moderation-log.sql`); `pnpm test:integration -- x` does NOT filter, use the per-file form; `db:reset` needs `pnpm db:seed` after it or `isolation.test.ts` aborts; `db:reset` only with Igor's word; `isolation-inventory.test.ts` (unit, no DB) is the first red a new mounted route produces; turbo runs need `--concurrency=4`; a `COVERAGE.md` reason must be 200 characters or fewer.

---

## Sampling Rate

- **After every task commit:** the touched package's Vitest + typecheck/lint of that package; `pnpm boundaries` when an import changed; `bash scripts/check-ui-literals.sh` for web tasks.
- **After every plan wave:** `pnpm db:generate` prints "No schema changes"; then (with Igor's consent for the reset) `pnpm db:reset && pnpm db:seed && pnpm supabase test db`; then the wave's integration files one at a time.
- **Before `/gsd-verify-work`:** `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` green; real-device and homolog rows stay `pending` until Igor writes `passed`.
- **Max feedback latency:** 30 seconds for the per-task check.

---

## Per-Task Verification Map

Requirement-level seed (task ids, threat refs and waves are filled by the planner). Requirement ids are the DRAFT ids of `10-RESEARCH.md` "Phase Requirements".

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | MCOMM-01, MPUB-02 | — | kind stamped from role never body; member-only permission composition | unit + integration + pgTAP | `registry.test.ts`, `communities.test.ts`, `230-member-communities.sql` | ❌ W0 (extend) | ⬜ pending |
| TBD | — | — | MCOMM-02, MCOMM-08 | — | whole tenant reads; a community post is in no Início / Explorar / Reels "Todos" | integration | `feed-social.test.ts`, `reels.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MCOMM-03, MCOMM-09 | — | org-first order, sentinel kept after admin reorder; reorder is org-only | integration + pgTAP EXPLAIN | `communities.test.ts`, `order.test.ts`, `110`/`111` | ✅ extend | ⬜ pending |
| TBD | — | — | MCOMM-04 | — | `createdBy` key set exact, no user id | unit + integration | `packages/modules/communities/tests/contracts.test.ts`, `communities.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MCOMM-05 | — | limit counts active only; `Promise.all` race; reactivation re-checks; 0 = none | integration | `member-communities.test.ts` | ❌ W0 | ⬜ pending |
| TBD | — | — | MCOMM-06, MPUB-01 | — | creator everything; other member 403; admin cannot publish in a member community, can in an organization one | integration | `member-communities.test.ts`, `stories.test.ts` | ❌ W0 / ✅ | ⬜ pending |
| TBD | — | — | MCOMM-07, MSTORY-08 | — | blocked or removed creator → bare 404 everywhere, restored on unblock | pgTAP + integration | `230-member-communities.sql`, `member-communities.test.ts`, `reports-blocks.test.ts` | ❌ W0 | ⬜ pending |
| TBD | — | — | MCOMM-10, MSTORY-09 | — | moderation action + log row in one transaction, rollback on log failure, works with `social` off | integration + pgTAP | `moderation-member-content.test.ts`, `154-moderation-log.sql`, `packages/core/tests/moderation-log.test.ts` | ❌ W0 / ✅ | ⬜ pending |
| TBD | — | — | MPUB-03 | — | owner posts under the limits, `'community'` stamped, non-owner 403, PDF refused | integration | `feed-social.test.ts`, `feed-media.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MPUB-04 | — | forged kind/visibility/owner → 42501; a negative test per new policy | pgTAP | `230`, `231`, `232`, `201-feed-social-gate.sql` | ❌ W0 | ⬜ pending |
| TBD | — | — | MPUB-05 | — | `social` off/on matrix incl. the 30 s flags-cache window (42501 → 403) | integration | `social-module.test.ts`, `member-communities.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MPUB-06 | — | admin pickers and catalog exclude member communities | integration | `stories.test.ts`, `communities.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MPUB-07 | — | inventory entries + sweep with positive control + wrong-host 403; no schema diff; expand-only | unit + integration + static | `isolation-inventory.test.ts`, `isolation.test.ts` ("phase 10 sweep"), `pnpm db:generate` | ✅ extend | ⬜ pending |
| TBD | — | — | MSTORY-01, MSTORY-07 | — | member story limits, video must be ready, owner asset only, minutes share counts stories | integration | `social-media.test.ts`, `media.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MSTORY-02 | — | `GET /v1/stories` org-only; Início highlights unchanged | integration | `stories.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MSTORY-03 | — | authors read: member vs moderator scope, order, paging, statement budget | integration + pgTAP EXPLAIN | `member-stories.test.ts`, `feed-query-budget.test.ts`, `231-member-stories.sql` | ❌ W0 | ⬜ pending |
| TBD | — | — | MSTORY-04 | — | audience gate truth table (author, follower, non-follower, moderator, support, system lane, other tenant, highlight branch, `social` off) on read/like/comment | pgTAP + integration | `231-member-stories.sql`, `member-stories.test.ts` | ❌ W0 | ⬜ pending |
| TBD | — | — | MSTORY-05 | — | zero notifications on a member publish; comment notice unchanged | unit + integration | `stories/tests/notification-sources.test.ts`, `notifications.test.ts` | ✅ extend | ⬜ pending |
| TBD | — | — | MSTORY-06 | — | own story into own highlight only; foreign story 404; readable by all after 24 h | integration + pgTAP (`120` clock control) | `member-stories.test.ts`, `120-story-highlights.sql` | ✅ / ❌ W0 | ⬜ pending |
| TBD | — | — | UI (entry points, Explorar row, forms, notices, flags) | — | web behavior on mobile viewports | unit + e2e | `StoriesSurface.test.tsx`, `CommunitiesList.test.tsx`, `CommunityForm.test.tsx`, `SocialLimitsSheet.test.tsx`, `stories.spec.ts`, `social.spec.ts`, `comunidades.spec.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/230-member-communities.sql` — kind CHECK, sentinel CHECK, insert/update/delete gates (forged kind/owner/position, non-owner, other tenant, null role, `social` off), hidden-creator definer truth table (live, blocked, removed, unblocked restores), counter reconciliation with a member-lane insert and soft-delete, order EXPLAIN unchanged, widened `moderation_log` CHECKs
- [ ] `supabase/tests/231-member-stories.sql` — story audience gate truth table incl. the highlight branch under a controlled clock, insert gate, EXPLAIN for the authors read on a volume fixture
- [ ] `supabase/tests/232-feed-community-audience.sql` — the `'community'` audience: CHECKs, insert branch (owner vs non-owner vs admin vs support), `social` gate off, partial index pins by name, the `feed_posts_member_update_guard` allow-list case
- [ ] `apps/api/tests/integration/member-communities.test.ts`, `member-stories.test.ts`, `moderation-member-content.test.ts`
- [ ] Extend `isolation-inventory.ts` (new routes `GET /v1/stories/authors`, `GET /v1/stories/authors/:membershipId`, the member `mine` variant; changed guards keep their keys) and `isolation.test.ts` "phase 10 sweep"
- [ ] Extend `registry.test.ts` (member permission pins, off by default, requires) and `feed-query-budget.test.ts`
- [ ] Seed: `scripts/seed.ts` adds one member community and one member story for the isolation tenant (`social` on there; the real tenant stays off)
- [ ] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Member story composer and create-community entry points on a real phone, installed PWA | UI | phones cannot reach `*.localhost`; needs a homolog/prod host | Igor opens the tenant on a phone with `social` on, creates a community and a story, checks Explorar's per-author row and the grouped viewer |
| `social` toggled off then on in a live tenant project | MPUB-05 | needs a tenant project with the migration applied | Igor flips the switch in the platform panel and confirms member writes stop and existing member communities stay readable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30 s per task
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
