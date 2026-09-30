---
phase: "07"
slug: "notifications-web-push-chat"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-29"
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `07-RESEARCH.md` §Validation Architecture; threat references come from its security section.
> The Per-Task Verification Map lists requirement rows only; task IDs are bound when the plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (module, web, API suites) · pgTAP via `pnpm supabase test db` · Playwright 1.63.0 (e2e + PWA production build) |
| **Config file** | per-package `vitest.config.ts` (new ones for `module-notifications` and `module-chat`, cloned from `packages/modules/events`), `apps/api/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/playwright.pwa.config.ts`, `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @rede-social/module-notifications typecheck && pnpm --filter @rede-social/module-notifications lint && pnpm --filter @rede-social/module-notifications test` (likewise `module-chat`, `module-events`) |
| **API integration command** | `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts` (`pnpm test:integration -- <name>` does NOT filter) |
| **DB command** | `pnpm supabase test db` |
| **Migration hygiene command** | `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)"` |
| **Full suite command** | `TURBO_CACHE=local:r pnpm verify` |
| **Estimated runtime** | quick ~3–5 s per package; one integration file ~5–15 s after reset+seed; whole integration folder ~50 s+; full suite several minutes (e2e dominated) |

**Plan-file rule:** `<automated>` commands inside PLAN.md XML-escape `&&` as `&amp;&amp;`.

**Video-provider rule:** Playwright runs are prefixed `VIDEO_PROVIDER=fake`; no command depends on real Mux, a tunnel or the hosted projects.

**Local DB rule:** the first plan carries a developer-approved `pnpm db:reset && pnpm db:seed` (the local DB still has the pre-rename slugs and the seed gains a `support_tenant` user).

---

## Sampling Rate

- **After every task commit:** the touched package's `typecheck && lint && test` plus the one integration file it touches
- **After every migration task:** `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)" && pnpm db:reset && pnpm db:seed && pnpm supabase test db`
- **After every plan wave:** `pnpm test:integration` (whole folder) and the plan's Playwright spec
- **Before `/gsd-verify-work`:** `TURBO_CACHE=local:r pnpm verify` green; real-device UAT recorded honestly (blocked until run against production)
- **Max feedback latency:** ~60 seconds per task

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | NOTIF-01 | — | Sources yield correct intents/audience/dedupe | unit | `pnpm --filter @rede-social/module-feed test` (+ stories, events) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-01 | tenant isolation | Fan-out: one row per live `member`, excludes author/staff/blocked, idempotent, unlike/re-like no dup, retraction on delete | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/notifications.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-02 | — | Keyset list (Novas/Anteriores), seen-on-open, tap read, read-all, counters | integration | same file | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-02 | — | Live bell increments without reload | e2e | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test notifications.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-02 / SC4 | realtime authz | Join allowed on own topics; refused cross-tenant / other user / inbox as member / after block / malformed / module off; no browser INSERT; rollback publishes nothing | pgTAP + integration | `pnpm supabase test db` ; `pnpm --filter @rede-social/api exec vitest run tests/integration/realtime.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-03 | — | Push headers, 404/410 deletes row, 5xx retries, blocked member skipped + subs deleted | unit + integration | `pnpm --filter @rede-social/module-notifications test` ; `pnpm --filter @rede-social/api exec vitest run tests/integration/push.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-03 | — | SW push/click logic (focus suppression, badge, navigate/openWindow) | unit | `pnpm --filter @rede-social/web test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-03 / PWA-02 | — | Subscribe flow with mocked PushManager; iOS non-standalone opens InstallHint | unit + e2e | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test push.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-04 | — | Channel registry: unknown key throws; in_app then push | unit | `pnpm --filter @rede-social/module-notifications test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-07 | — | Arm in-tx on create/edit/reactivate; skip past windows; no-op on moved/cancelled/deleted; only `going`; one per (event, window, user) | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/events-reminders.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CHAT-01 | — | seq contiguous under concurrent inserts; body CHECK | pgTAP + integration | `pnpm supabase test db` ; `pnpm --filter @rede-social/api exec vitest run tests/integration/chat.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CHAT-02 / CHAT-03 | tenant isolation | Lazy creation, one support conversation per member, inbox order + awaiting count, shared read state, staff never get own thread, blocked read-only | integration | `chat.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CHAT-04 | realtime authz | Signal on conv + inbox topics; catch-up after seq N returns exactly the missed messages | integration + e2e | `realtime.test.ts`, `playwright test chat.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CHAT-05 | — | Member dot after staff reply; clears on read | integration + e2e | `chat.test.ts`, `chat.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TENANT-05 | tenant isolation | Every new table and endpoint in the isolation suites | pgTAP + integration | `pnpm supabase test db` ; `pnpm --filter @rede-social/api exec vitest run tests/integration/isolation.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/150-realtime-authorization.sql` (+ `tests.as_realtime_user` helper)
- [ ] `supabase/tests/151-notifications.sql`, `152-chat.sql`; isolation fixture updates
- [ ] `apps/api/tests/integration/realtime.test.ts` (real `RealtimeClient` helper with timeouts)
- [ ] `apps/api/tests/integration/notifications.test.ts`, `push.test.ts`, `events-reminders.test.ts`, `chat.test.ts`; a `runNotificationJobs(tenantId)` helper in `setup.ts`
- [ ] Fake push transport seam + header unit tests
- [ ] `apps/web/lib/push-sw.ts` + unit tests; `apps/web/e2e/notifications.spec.ts`, `push.spec.ts`, `chat.spec.ts`
- [ ] Seed: one `support_tenant` per tenant; notifications/chat enabled on `rede-demo`, off on `rede-lab`
- [ ] TDD red-evidence normaliser if any plan is TDD (Vitest emits no TAP)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real iPhone (standalone, iOS 16.4+) and Android: enable push, receive with tenant name/icon, tap opens the target screen, focused suppression on Android | NOTIF-03, PWA-02 | Real phones cannot reach the local stack; push needs HTTPS and real OS delivery | Run the real-device test plan (a phase deliverable) against production after deploy; record blocked until run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
