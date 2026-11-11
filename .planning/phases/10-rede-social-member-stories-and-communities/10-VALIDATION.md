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

> Per-phase validation contract for feedback sampling during execution. Seeded from `10-RESEARCH.md` "Validation Architecture"; the planner replaced the requirement-level rows below with task ids (`10-<plan>-T<task>`) when the plans were written.

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

Task ids, waves and threat refs filled by the planner on 2026-11-10 (15 plans, 43 tasks). Requirement ids are the final ids written to `REQUIREMENTS.md` (MCOMM-01..11, MSTORY-01..09, MPUB-01..07, plus UI-04 as a gate reference). Plans 01 and 02 are the sketch gate, 03 to 10 the backend (waves 1 to 8) (never waiting for the gate), 11 to 15 the web (each waits for the approval of sketch 020).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 1 | UI-04 | T-10-01, T-10-02 | sketch frames of groups 1 to 5 drawn at the real tokens | static grep | `F=.planning/sketches/020-phase-10-designed-screens/index.html; grep -qF 'data-frame="explorar-fila-320"' $F` | ❌ W0 | ⬜ pending |
| 10-01-T2 | 01 | 1 | UI-04 | T-10-01 | frames of groups 6 to 10, exactly 55 frames | static grep | `test "$(grep -c 'data-frame=' $F)" = 55` | ❌ W0 | ⬜ pending |
| 10-02-T1 | 02 | 2 | UI-04 | T-10-03 | README ships `approved: false` and the manifest row | static grep | `grep -q '^approved: false' .planning/sketches/020-phase-10-designed-screens/README.md` | ❌ W0 | ⬜ pending |
| 10-02-T2 | 02 | 2 | UI-04 | T-10-03 | Igor records the approval (blocking human) | manual gate | `grep -q '^approved: true' .planning/sketches/020-phase-10-designed-screens/README.md` | ❌ W0 | ⬜ pending |
| 10-03-T1 | 03 | 1 | MCOMM-01, MPUB-04 | T-10-04, T-10-05, T-10-06 | tracer: a member creates a community and a second member cannot (RLS) | pgTAP | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/230-member-communities.sql` | ❌ W0 | ⬜ pending |
| 10-03-T2 | 03 | 1 | MCOMM-08, MPUB-04 | T-10-05, T-10-07 | third post audience, gates and the allow-list guard generate no drift | static | `pnpm db:generate 2>&1 | grep -q 'No schema changes'` | ❌ W0 | ⬜ pending |
| 10-03-T3 | 03 | 1 | MCOMM-07, MPUB-04, MPUB-07 | T-10-04..T-10-08 | kind, sentinel, hidden creator, community audience, allow-list, counters (BLOCKING push) | pgTAP | `pnpm db:generate 2>&1 | grep -q 'No schema changes' && pnpm db:reset && pnpm db:seed && pnpm supabase test db` | ❌ W0 | ⬜ pending |
| 10-04-T1 | 04 | 2 | MSTORY-04 | T-10-09, T-10-10 | tracer: author, live follower and moderator read a member story, a stranger does not | pgTAP | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/231-member-stories.sql` | ❌ W0 | ⬜ pending |
| 10-04-T2 | 04 | 2 | MSTORY-04, MSTORY-08, MPUB-04 | T-10-09, T-10-11, T-10-13 | branch 3 measured (A10), story media gate (A5), full 231 truth table (BLOCKING push) | spike + pgTAP | `psql ... -f 10-04-spike.sql && grep -Eq '^CHOSEN_FORM: (EXISTS_JOIN|IDS_DEFINER)$' 10-04-SPIKE.md && pnpm supabase test db` | ❌ W0 | ⬜ pending |
| 10-04-T3 | 04 | 2 | MCOMM-10, MSTORY-09 | T-10-12 | moderation log accepts the three new actions bound to their subjects | unit + pgTAP | `pnpm --filter @rede-social/core exec vitest run tests/moderation-log.test.ts && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/154-moderation-log.sql` | ✅ extend | ⬜ pending |
| 10-05-T1 | 05 | 3 | MCOMM-01, MPUB-01, MPUB-02, MPUB-03 | T-10-14, T-10-15, T-10-18 | tracer: creator creates and posts, Marcos and the admin get 403 | unit + integration | `pnpm --filter @rede-social/api test && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-communities.test.ts tests/integration/feed-social.test.ts` | ❌ W0 | ⬜ pending |
| 10-05-T2 | 05 | 3 | MCOMM-05 | T-10-16 | per-member limit, advisory lock, reactivation, limiters | unit + integration | `pnpm --filter @rede-social/core exec vitest run tests/member-community-policy.test.ts && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-communities.test.ts` | ❌ W0 | ⬜ pending |
| 10-05-T3 | 05 | 3 | MCOMM-06, MCOMM-10, MPUB-05 | T-10-14, T-10-17 | owner predicates on update and delete, moderator log rows in one transaction | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-communities.test.ts tests/integration/moderation-member-content.test.ts` | ❌ W0 | ⬜ pending |
| 10-06-T1 | 06 | 4 | MCOMM-02, MCOMM-03, MCOMM-04, MCOMM-08, MCOMM-09 | T-10-20, T-10-21 | tracer: list order, safe creator projection, leak negatives, Reels lanes | unit + integration | `pnpm --filter @rede-social/module-communities test && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-communities.test.ts tests/integration/reels.test.ts` | ❌ W0 | ⬜ pending |
| 10-06-T2 | 06 | 4 | MCOMM-03, MCOMM-07 | T-10-22, T-10-23 | org-only reorder, blocked creator and viewer-block hidden, restore on unblock | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-communities.test.ts tests/integration/reports-blocks.test.ts` | ❌ W0 | ⬜ pending |
| 10-06-T3 | 06 | 4 | MCOMM-11 | T-10-24 | separable A3: moderator removes one community post with its log row | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/moderation-member-content.test.ts` | ❌ W0 | ⬜ pending |
| 10-07-T1 | 07 | 5 | MSTORY-01, MSTORY-02, MSTORY-05 | T-10-26 | tracer: member story stamped followers-only, org-only Início, zero notifications | unit + integration | `pnpm --filter @rede-social/module-stories test && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts tests/integration/stories.test.ts` | ❌ W0 | ⬜ pending |
| 10-07-T2 | 07 | 5 | MSTORY-07, MSTORY-01 | T-10-25, T-10-27 | member media seam for story and cover, 60 s cap, owner assets | unit + integration | `pnpm --filter @rede-social/core exec vitest run tests/member-media-policy.test.ts && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/social-media.test.ts` | ✅ extend | ⬜ pending |
| 10-07-T3 | 07 | 5 | MSTORY-09, MSTORY-04 | T-10-28, T-10-29 | author and moderator delete with the log row, A7 author projection | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts tests/integration/moderation-member-content.test.ts` | ❌ W0 | ⬜ pending |
| 10-08-T1 | 08 | 6 | MSTORY-03, MSTORY-04 | T-10-30 | tracer: follower sees the circle and opens the group, stranger gets 404 | unit + integration | `pnpm --filter @rede-social/module-stories test && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts` | ❌ W0 | ⬜ pending |
| 10-08-T2 | 08 | 6 | MSTORY-03, MPUB-07 | T-10-32 | authors read measured (A10), index built as recorded (BLOCKING push) | spike + pgTAP | `psql ... -f 10-08-spike.sql && grep -Eq '^CHOSEN_FORM: (GROUPED|LATERAL)$' 10-08-SPIKE.md && pnpm db:generate 2>&1 | grep -q 'No schema changes' && pnpm supabase test db` | ❌ W0 | ⬜ pending |
| 10-08-T3 | 08 | 6 | MSTORY-03, MSTORY-08, MPUB-07 | T-10-30, T-10-31, T-10-33 | moderator cursor row, block filters, one statement per page, isolation inventory | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts tests/integration/isolation.test.ts tests/integration/feed-query-budget.test.ts` | ❌ W0 | ⬜ pending |
| 10-09-T1 | 09 | 7 | MSTORY-06, MPUB-01 | T-10-34 | tracer: creator saves own story in own highlight, everyone reads it after 24 h | pgTAP + integration | `pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/120-story-highlights.sql && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts` | ✅ extend | ⬜ pending |
| 10-09-T2 | 09 | 7 | MSTORY-06, MCOMM-06, MPUB-01 | T-10-34, T-10-35 | IDOR guards on items and covers, any-of guards, place-dependent curator | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts tests/integration/stories.test.ts` | ❌ W0 | ⬜ pending |
| 10-09-T3 | 09 | 7 | MPUB-06, MPUB-05 | T-10-36 | org-only catalog and pickers, off, blocked and empty cases | integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/member-stories.test.ts tests/integration/stories.test.ts tests/integration/social-module.test.ts` | ❌ W0 | ⬜ pending |
| 10-10-T1 | 10 | 8 | MPUB-07 | T-10-37 | tracer: seed member rows idempotent, two-tenant sweep and inventory | unit + integration | `pnpm db:reset && pnpm db:seed && pnpm db:seed && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/isolation.test.ts` | ❌ W0 | ⬜ pending |
| 10-10-T2 | 10 | 8 | MPUB-05 | T-10-38 | social off and on matrix, nothing deleted, registry pins | unit + integration | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/social-module.test.ts` | ✅ extend | ⬜ pending |
| 10-10-T3 | 10 | 8 | MPUB-07 | T-10-39, T-10-40 | migrations on an empty project and re-runnable, DEPLOY release order | static | `pnpm db:two && pnpm db:migrate-all -- --dry-run && grep -q authorUserId docs/DEPLOY.md` | ✅ extend | ⬜ pending |
| 10-11-T1 | 11 | 4 | MCOMM-05, UI-04 | T-10-41 | tracer: platform sheet saves the community limit through the strict patch schema | web unit | `grep -q '^approved: true' .planning/sketches/020-phase-10-designed-screens/README.md && pnpm --filter @rede-social/web exec vitest run components/platform/SocialLimitsSheet.test.tsx` | ✅ extend | ⬜ pending |
| 10-11-T2 | 11 | 4 | MCOMM-10, MSTORY-09 | T-10-42 | three moderation log kinds, exhaustive maps | web unit | `pnpm --filter @rede-social/web exec vitest run lib/moderation-view.test.ts` | ✅ extend | ⬜ pending |
| 10-11-T3 | 11 | 4 | MCOMM-08, MSTORY-04 | T-10-43 | third audience in the badge and menu, null authorUserId tolerated | web unit | `pnpm --filter @rede-social/module-feed test && pnpm --filter @rede-social/web exec vitest run lib components` | ✅ extend | ⬜ pending |
| 10-12-T1 | 12 | 8 | MSTORY-03, UI-04 | T-10-44, T-10-45 | tracer: member Explorar row, own circle, lazy groups | web unit | `pnpm --filter @rede-social/module-stories test && pnpm --filter @rede-social/web exec vitest run components/stories lib/stories.test.ts` | ✅ extend | ⬜ pending |
| 10-12-T2 | 12 | 8 | MSTORY-09, MPUB-02 | T-10-44 | moderator row, viewer menus and delete dialogs, Início tightening | web unit | `pnpm --filter @rede-social/web exec vitest run components/stories lib 'app/(app)/stories'` | ✅ extend | ⬜ pending |
| 10-12-T3 | 12 | 8 | MSTORY-01, MSTORY-06 | T-10-44, T-10-46, T-10-47 | member publish screen, destination, checklist confirm, Seus stories | web unit | `pnpm --filter @rede-social/web exec vitest run 'app/(app)/stories' components/stories` | ✅ extend | ⬜ pending |
| 10-13-T1 | 13 | 5 | MCOMM-01, MCOMM-02, MCOMM-04 | T-10-48 | tracer: member form without products, audience line, member card after org cards | web unit | `pnpm --filter @rede-social/module-communities test && pnpm --filter @rede-social/web exec vitest run 'app/(app)/comunidades' lib/communities.test.ts` | ✅ extend | ⬜ pending |
| 10-13-T2 | 13 | 5 | MCOMM-05, MPUB-05 | T-10-48 | limit notice and screen, chips, stale-tab alerts, module-off redirects | web unit | `pnpm --filter @rede-social/web exec vitest run 'app/(app)/comunidades'` | ✅ extend | ⬜ pending |
| 10-13-T3 | 13 | 5 | MCOMM-03, MCOMM-06 | T-10-49 | organization-only reorder draft, archived byline, no store tags | web unit | `pnpm --filter @rede-social/web exec vitest run 'app/(app)/comunidades' && pnpm --filter @rede-social/module-communities test` | ✅ extend | ⬜ pending |
| 10-14-T1 | 14 | 9 | MPUB-01, MPUB-03 | T-10-51, T-10-52 | tracer: creator controls from viewer flags, member composer with community line | web unit | `pnpm --filter @rede-social/module-communities test && pnpm --filter @rede-social/web exec vitest run 'app/(app)/comunidades' 'app/(app)/criar'` | ✅ extend | ⬜ pending |
| 10-14-T2 | 14 | 9 | MPUB-01, MPUB-05, MPUB-06, MCOMM-07 | T-10-51 | matrix for every other viewer, social off and blocked creator states | web unit | `pnpm --filter @rede-social/web exec vitest run 'app/(app)/comunidades' 'app/(app)/criar'` | ✅ extend | ⬜ pending |
| 10-14-T3 | 14 | 9 | MCOMM-06, MCOMM-10 | T-10-53 | lifecycle confirmation variants, moderator controls, curation | web unit | `pnpm --filter @rede-social/web exec vitest run 'app/(app)/comunidades' components/stories` | ✅ extend | ⬜ pending |
| 10-15-T1 | 15 | 10 | MCOMM-01, MCOMM-08, MSTORY-01, MSTORY-03, MPUB-01 | T-10-56 | tracer: the member journey in a browser | e2e | `pnpm --filter @rede-social/web exec playwright test stories.spec.ts social.spec.ts comunidades.spec.ts -g '10 member journey'` | ✅ extend | ⬜ pending |
| 10-15-T2 | 15 | 10 | MPUB-05, MCOMM-10, MSTORY-09 | T-10-56 | moderation, social switch and platform limit in a browser | e2e | `pnpm --filter @rede-social/web exec playwright test stories.spec.ts comunidades.spec.ts social-platform.spec.ts -g '10 moderation and switch'` | ✅ extend | ⬜ pending |
| 10-15-T3 | 15 | 10 | MPUB-07 | T-10-55 | exit gate and the owner's manual-proofs ledger | gate | `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` | ❌ W0 | ⬜ pending |

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

<!-- Reconciled 2026-11-10 with CONTEXT.md: only the bullet format of the carried-forward D-466 and D-473 changed, no decision text. -->
