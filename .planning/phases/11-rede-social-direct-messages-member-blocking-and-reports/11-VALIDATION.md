---
phase: "11"
slug: "rede-social-direct-messages-member-blocking-and-reports"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-19"
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `11-RESEARCH.md` § Validation Architecture. The planner fills the Per-Task Verification Map as plans are written.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit, module, web), API integration (Vitest against the live local stack), pgTAP via `supabase test db`, Playwright 1.63.0 |
| **Config file** | per-package `vitest.config.ts` (`apps/api`, `apps/web`, `packages/modules/*`, `packages/core`), `apps/web/playwright.config.ts` |
| **Quick run command** | the one command of the touched layer: `pnpm --filter @rede-social/module-chat test` / `pnpm --filter @rede-social/module-social test` / `pnpm --filter @rede-social/contracts test` / `bash scripts/supabase.sh test db supabase/tests/237-direct-conversations.sql` / `pnpm --filter @rede-social/api exec vitest run tests/integration/direct-chat.test.ts` / `pnpm --filter @rede-social/web exec vitest run lib/chat-view.test.ts lib/reports-view.test.ts` |
| **Full suite command** | `pnpm lint && pnpm turbo typecheck build test --concurrency=4`, then `pnpm boundaries && pnpm check:static-routes`, then `bash scripts/supabase.sh test db` (BEFORE) `pnpm test:integration`, then `pnpm e2e` |
| **Estimated runtime** | quick ~10-60 seconds per layer; full suite ~25-40 minutes (disk is tight: 16 GiB free, clear `.turbo/cache` and `apps/web/.next/dev` when idle) |

---

## Sampling Rate

- **After every task commit:** Run the one quick command of the touched layer
- **After every plan wave:** `pnpm turbo typecheck test --concurrency=4` with `TURBO_CACHE=local:r`, plus `bash scripts/supabase.sh test db` once the wave touched SQL
- **Before `/gsd-verify-work`:** Full suite must be green, in the order of the full-suite command (pgTAP before integration; reset and seed in between if pgTAP follows)
- **Max feedback latency:** 120 seconds for a quick command

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-XX-XX | — | — | CHAT-06, D-720 | cross-tenant reach of a direct | one conversation per pair; concurrent first sends create one; the lane cannot create a direct; other tenant unreachable | pgTAP | `bash scripts/supabase.sh test db supabase/tests/237-direct-conversations.sql` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | CHAT-06, D-720, D-719 | enumeration of member ids | lazy creation, redirect to the existing one; staff/self/other tenant/removed/unknown = same bare 404; `/conversas` list with support pinned | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/direct-chat.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | D-721 | admin block leak | admin block or removal hides the list, 404 on read, send refused, returns on unblock; anonymised stays read-only | pgTAP + integration | `238-direct-block-effects.sql`, `direct-chat-block.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | CHAT-07, D-722, D-723 | blocked member learns of the block | neutral refusal, no "bloqueado" in code or body, the blocked reads the history, the blocker sees the closed state, unblock restores | integration + unit | `direct-chat-block.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | CHAT-07, D-724 | send races a block (TOCTOU) | block deletes follows both ways in one tx; follow across a block = bare 404 identical to unknown; unblock restores nothing | pgTAP + integration | `238-direct-block-effects.sql`, `social-block.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | D-726, D-727 | notification flood | member post notifies nobody (D-477 intact); follow = one bell row per pair, none for a blocked pair or `social` off, no push | integration (worker lane) | `direct-notifications.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | D-728 | push to a pair blocked after enqueue; lock-screen content | message push: one per conversation (tag), title is the writer's name, voice `Mensagem de voz · 0:42`, none to a blocked pair / `social` off, no bell row, badge counts | integration + module unit | `direct-notifications.test.ts`, `packages/modules/chat/tests/direct-notification-copy.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | D-729 | notice names the subject; reported admin notified | new report → bell + push to `moderation.manage` holders only, never the author or reporter, never names the subject | integration | `reports-notice.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | MODER-05, D-730 | report snapshot drift | CHECK + contract append order; five reasons, note, duplicate and own-content rules unchanged | pgTAP + contracts | `239-reports-new-subjects.sql`, `packages/contracts` moderation test | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | MODER-05, D-731 | report of a message exposes the other side | message report stores only the message; admin cannot read any chat row; voice copy playable by the admin only through the report | pgTAP + integration | `239-reports-new-subjects.sql`, `240-direct-realtime-media.sql`, `reports-new-subjects.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | MODER-04, D-732 | two admins race | story → `story_removed`, story comment → `comment_removed`, community → `community_archived`, message → only dismiss / block author; log row in the same tx; one winner | integration | `reports-new-subjects.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | D-733 | staff blocked or reported through the rider | `canReport` / `canBlock` riders; staff never `canBlock`; entries work with `social` off | integration + web unit | `reports-new-subjects.test.ts`, `reports-view.test.ts` | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | D-734 | third member plays a recording | voice send in a direct: idempotent per take, only the two participants play, a third member gets 404 | integration | `direct-chat-voice.test.ts` (reuses `chat-voice-fixtures.ts`) | ❌ W0 | ⬜ pending |
| 11-XX-XX | — | — | UI contract | — | menus, strips, profile zone, row control, queue rows, bell rows; 320 and 390 backstops | web component + Playwright | `pnpm --filter @rede-social/web exec vitest run <files>`, `e2e/direct-chat.spec.ts`, `e2e/safety.spec.ts` | ❌ W0 (web plans, gated on sketch 025) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/237-direct-conversations.sql` — pair uniqueness, lane insert refused, definer eligibility, cross-tenant, case columns null, triggers leave directs alone, unread flag
- [ ] `supabase/tests/238-direct-block-effects.sql` — block deletes follows both ways, follow-policy refusal, send guard (block either way, `social` off, removed or blocked other), lock-order race, unpaired fixtures untouched
- [ ] `supabase/tests/239-reports-new-subjects.sql` — CHECK append, per-subject snapshot, own content, cross-tenant, message copy-only, no chat row readable by admin
- [ ] `supabase/tests/240-direct-realtime-media.sql` — topic for a paired direct, `chat_asset_hidden` with the report clause (admin, reporter, third member, other tenant)
- [ ] `apps/api/tests/integration/{direct-chat,direct-chat-block,direct-chat-voice,direct-notifications,reports-new-subjects,reports-notice}.test.ts`, a `phase 11 sweep` block in `isolation.test.ts` and an entry in `apps/api/tests/isolation-inventory.ts` for every new route
- [ ] `packages/modules/chat/tests/direct-*.test.ts`, `packages/modules/social/tests/*` additions, `apps/web/lib/{chat-view,reports-view}.test.ts` additions
- [ ] Fixture helper: both `chat` and `social` (and `notifications` for push cases) enabled on demo and lab for the test span (`withModuleEnabled`), two more seeded members with a profile each
- [ ] Existing suites that pin touched seams updated deliberately: `registry.test.ts`, `isolation-inventory.test.ts`, `module-readmes.test.ts`, `mounts.test.ts`, web `notification-renderers` and `moderation-view` tests

No framework install is needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two real phones exchange a direct message, push arrives on each, tap opens the conversation | CHAT-06, D-728 | phones cannot reach `*.localhost`; real push needs the deployed homolog | After the homolog deploy, two members on two phones: send, receive the push, tap it |
| VoiceOver / TalkBack phrases on the new menus, strips and queue rows | UI contract | needs a real screen reader on a device | Walk the UI-SPEC accessibility list on one iPhone and one Android |
| Queue row for a reported voice message plays only through the report | D-731 | needs a real recording and the deployed media gate | Report a voice message, open it from the queue as the admin |
| Sketch 025 approval (`approved: true`) | UI gate | written only by Igor | Igor reviews the frames and pastes the frontmatter |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
