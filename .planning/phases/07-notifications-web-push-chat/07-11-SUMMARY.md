---
phase: 07-notifications-web-push-chat
plan: 11
subsystem: testing
tags: [phase-gate, isolation, smoke, deploy, device-test-plan, realtime-quota, vapid, private-only, D-235, D-239]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-01..07-10: the notifications, push and chat routes, tables and topics; the live bell, push switch, soft-ask and InstallHint; the member thread, staff inbox and staff thread; the realtime.test.ts topic negatives; the 020/150-153 pgTAP cases"
provides:
  - "isolation.test.ts case 'phase 7 sweep': every Phase 7 route not already covered by b10-b12, each beside its demo positive control and the lab-host 403, with the route inventory as a comment table"
  - "apps/web/e2e/phase7-smoke.spec.ts: the four ROADMAP Phase 7 criteria on the local stack (8/8 on both projects)"
  - "apps/web/e2e/push-fake.ts: the mocked push stack shared by push.spec.ts and phase7-smoke.spec.ts"
  - "docs/DEPLOY.md 'Phase 7 release': ten user-run steps plus the Free-plan Realtime quota and its Pro upgrade trigger; Secret Manager rows vapid-*-prod and the Vercel row NEXT_PUBLIC_VAPID_PUBLIC_KEY"
  - ".github/workflows/deploy-api.yml: PUSH_TRANSPORT=webpush and the three VAPID secrets on api and worker"
  - "apps/api/.env.example (new): the API env template with PUSH_TRANSPORT=fake and empty VAPID values"
  - "docs/phase-07-device-test-plan.md: 17 real-device rows (iPhone, iPad, Android, desktop), every one 'Status: blocked — not run'"
affects: [07 phase verification and UAT, 01.1-style production release of Phase 7 (user-run), 08 moderation (blocking stops pushes, device row 14), 08.1 multi-tenant identity]

actuals:
  tokens: 22400
  tasks: 3
  commits: 6
plan_head_before: 4b2539f56757aee3eb40e387193e99334a0ac369

tech-stack:
  added: []
  patterns:
    - "A phase witness flips module flags on a THROWAWAY tenant, never on rede-demo/rede-lab (tenant-fixtures.ts rule: seed flags sit in the API's 30 s cache)"
    - "Shared Playwright fakes live in a plain helper module (push-fake.ts); a spec file is never imported by another spec"
    - "Release steps for a live production are written as ordered user-run steps; the executor references secrets by name only"

key-files:
  created:
    - apps/web/e2e/phase7-smoke.spec.ts
    - apps/web/e2e/push-fake.ts
    - apps/api/.env.example
    - docs/phase-07-device-test-plan.md
  modified:
    - apps/api/tests/integration/isolation.test.ts
    - apps/web/e2e/push.spec.ts
    - docs/DEPLOY.md
    - .github/workflows/deploy-api.yml
    - apps/web/e2e/blocked.spec.ts
    - apps/web/e2e/profile.spec.ts
    - apps/web/e2e/shell.spec.ts
    - apps/web/e2e/media-video.spec.ts
    - packages/modules/notifications/tests/channels.test.ts
    - .planning/phases/07-notifications-web-push-chat/deferred-items.md
    - .planning/WINDOWS.md

key-decisions:
  - "Criterion 4 of the witness runs on a throwaway tenant (p7off-<run>-<project>) with notifications and chat on, then off, then on, not on rede-demo as the plan text says. The tenant-fixtures rule forbids flipping seed flags."
  - "The Phase 7 release ships behind a staged Vercel promotion. Production domains are not auto-assigned for the push, and the web deployment is promoted only after deploy-api.yml is green. A push to master starts Vercel and the gated API workflow at once, and counters.conversationsBadge requires the API first."
  - "The pre-push empty-table check covers notifications too, not only chat_messages: 20260930123126_notifications.sql adds three NOT NULL columns without a default."

requirements-completed: [NOTIF-01, NOTIF-03, NOTIF-04, EVENT-07, PWA-02, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05]

duration: 153min
completed: 2026-09-30
---

# Phase 7 Plan 11: Phase close (isolation gate, witness, release steps, device plan) Summary

**The Phase 7 isolation sweep covers every Phase 7 route next to its positive control (31/31). A serial witness spec covers the four ROADMAP criteria (8/8). The production release is written as ten user-run steps with the VAPID secrets mounted by name. The 17-row real-device plan is honestly blocked. The local gate is green except for one desktop feed like case outside Phase 7 and one env value the developer must regenerate.**

## Performance

- **Duration:** about 153 min (18:48-21:21 -03, mostly four full `pnpm verify` runs)
- **Completed:** 2026-09-30
- **Tasks:** 3
- **Files:** 4 created, 11 modified

## Accomplishments

- **Isolation sweep (`phase 7 sweep`).** It covers `POST /v1/notifications/{id}/read`, `/seen`, `/read-all`, `GET /v1/me/counters`, `GET /v1/chat/support`, `POST /v1/chat/support/messages`, `GET /v1/chat/conversations/{id}`, the staff `GET`/`POST …/messages`, `POST …/read`, the full `GET /v1/chat/inbox` walk, and `GET /v1/feed/comments/{id}/thread`. The `GET /v1/notifications` sections, push subscriptions and the member messages lane stay in b10-b12. A throwaway demo member carries the demo side, so seeded rows are untouched. rede-lab gets `notifications` and `chat` on for the case and is restored in `finally`. Every block has a demo positive control and a lab-host `403 TENANT_HOST_MISMATCH`. The Realtime topic negatives stay in `realtime.test.ts`.
- **pgTAP recount.** `020-tenant-isolation.sql` already held every reshaped or new table (notifications, push_subscriptions, the three chat tables) with its B-invisible and USING-touches-0 cases. `plan(157)` has no drift, so nothing changed. pgTAP is 21 files and 705 tests, all PASS. The Phase 7 files plan 150=44, 151=47, 152=52 and 153=35 tests.
- **Witness `phase7-smoke.spec.ts`.** Passed 8/8 on mobile-chromium and desktop-chromium, standalone and inside `pnpm verify`:
  1. An admin publish reaches the bell with no reload. The row opens the post, an actor-less reminder row sits on the clock disc, and mark-all clears every tint.
  2. With the mocked `PushManager`, the switch prompts once and a `push_subscriptions` row exists. An iPhone UA outside standalone gets the InstallHint from the soft-ask CTA, with no permission call and no subscribe.
  3. A member message appears live in the staff inbox, the staff reply appears live in the member thread, and a later reply turns the member's slot into the dot on Início.
  4. On a throwaway tenant, both slots vanish and `/v1/notifications` plus `/v1/chat/support` answer 404 `MODULE_DISABLED`. Flipped back on, both return. The observed flag delay is annotated, under 35 s.
- **Release written, never run.** The DEPLOY.md "Phase 7 release" has ten steps (listed below), plus "Realtime quota (Free plan)". `deploy-api.yml` mounts the three VAPID secrets and sets `PUSH_TRANSPORT=webpush` on both services. The new `apps/api/.env.example` is local-only, with empty VAPID values.
- **Device plan.** `docs/phase-07-device-test-plan.md` has prerequisites, a push-state reset per device, and 17 rows covering E07 (iPhone and iPad), the Home Screen prompt, the banner's tenant name and icon, the tag replacement, the Android foreground quiet (E14/partial), the app closed, the 1 h reminder, the "Equipe {tenant}" cut preview (E14/long-text), the staff "Nova mensagem", the app-icon badge (D-239), the composer above the keyboard (E10/partial), logout, blocking, the expired subscription, the push-host allow-list (07-06 [ASSUMED]), and the staff screens on a phone.

## User-run release steps (docs/DEPLOY.md → "Phase 7 release")

1. `npx web-push generate-vapid-keys` on the developer's own machine. Rotating the pair is a one-way door.
2. Create `vapid-public-key-prod`, `vapid-private-key-prod` and `vapid-subject-prod` (`mailto:`, never localhost) in Secret Manager, and confirm `RUNTIME_SA` can read them. This must happen **before** pushing.
3. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel Production before the build.
4. Turn Realtime "Allow public access" off (`private_only: true`) in the Dashboard or with the Management API `PATCH`.
5. Confirm the hosted access-token expiry is at most 3600 s, and re-check after the push.
6. Check `notifications` and `chat_messages` are both 0 rows in production (read-only SQL).
7. Push `master` with the API and worker live **before** the web. Turn off Vercel's automatic domain assignment, approve `production`, then promote the web once the workflow is green.
8. Optional: run `scripts/arm-event-reminders.ts --dry-run`, then the real run, with only the production `DATABASE_URL` in the shell.
9. Production has no `support_tenant`, so `admin_tenant` answers support (D-223) until Phase 8.
10. Run `docs/phase-07-device-test-plan.md` and record every row in the Phase 7 UAT.

## Exit gate (Task 3)

Four full runs on a fresh `db:reset` + `db:seed` (`TURBO_CACHE=local:r VIDEO_PROVIDER=fake`):

| Run | Result | What stopped it |
|---|---|---|
| verify1 | stage 2 failed | `channels.test.ts` cold-import case timed out at Vitest's 5 s default under the parallel turbo run (0.4 s alone). Fixed with an explicit 30 s bound; no assertion changed |
| verify2 | e2e 585 passed / 46 failed / 119 skipped (59.2 m) | 34 platform-host cases (web `PLATFORM_HOST`, see below); 9 stale specs (fixed, deviation 3); the desktop double tap; the known feed-comments mobile cold-run flake |
| verify3 (`PLATFORM_HOST=rede-social.localhost` inline) | stage 2 failed | `next build` `ENOTEMPTY rmdir .next/types`: web `typecheck` (`next typegen`) races web `build` in turbo (pre-existing, logged) |
| verify4 (same inline value) | **e2e 654 passed / 2 failed / 124 skipped (45.1 m)** | desktop `feed.spec.ts` double tap, and "a failed like reverts" right after it (open, below) |

verify4 stage timings: lint and UI literals in 1 s; typecheck/build/test (27 tasks, cache empty) 42 s; static routes, boundaries and their negative, lanes guard and pgTAP done by 46 s. The integration folder ran 124 s with **42/42 files and 703/703 tests**, including `realtime`, `notifications`, `notifications-prune`, `push`, `events-reminders`, `chat`, `isolation` and `signup`. The Supavisor spike passed 3/3, then reset and seed, then e2e (45.1 m). `pnpm verify` stops at e2e, so its last stage ran separately: **`e2e:pwa` 46 passed / 5 skipped (30.8 s)**.

Phase 7 specs in verify4 had no failures; the skips are each spec's by-design project skips:

| Spec | Passed | Skipped |
|---|---|---|
| `notifications.spec.ts` | 45 | 1 |
| `push.spec.ts` | 19 | 1 |
| `chat.spec.ts` | 29 | 3 |
| `phase7-smoke.spec.ts` | 8 | 0 |

**`pnpm verify` did NOT exit 0 in any run.** The remaining items are honest, not papered over:

- **Web `PLATFORM_HOST`.** The developer's `apps/web/.env.local` still does not name `rede-social.localhost`, so the web serves the generic `/entrar` on the platform host. Without the inline override, 34 platform-host cases fail on both projects. With `PLATFORM_HOST=rede-social.localhost` exported, all of them pass: platform, platform-tenants 15, invite 8, phase2-smoke 12 including pixel, and signup case 8. The executor did not read or edit the file. **Developer action:** `bash scripts/local-env.sh --write`, or fix that one value. WINDOWS 59 stays open for this.
- **Desktop feed double tap (WINDOWS 64, deferred-items).** It failed in both full runs and 1 time in 3 alone; mobile always passes. The failing trace shows the gesture firing only `unlikePostAction`. The feed like path has not changed since 06-09's green gate. The only new code on `/inicio` is Phase 7's `LiveShell` (token and counters fetch about 500 ms before the gesture; no child remount). Not fixed (outside this plan's files, fix-attempt limit); routed to `/gsd-debug`. "A failed like reverts" failed once, right after it in the same file, and passed in verify2 and in the isolated rerun.
- **Turbo race (WINDOWS 65, deferred-items).** Web `typecheck` and `build` both write `.next/types`. It happened once; the fix path is recorded.
- **Known flake.** `feed-comments.spec.ts` mobile "a failed comment list…" failed in verify2 and passed in verify4, unchanged (07-04 entry).
- **Env-host items now fixed.** `signup.test.ts` case 2 and `events.spec.ts` "ONE not-found screen" pass, so WINDOWS 60 and 61 are fixed.

**Real-device rows.** Every row in the device plan and every E07/E10/E14 backstop stays `blocked — not run` for `/gsd-verify-work`. No automated run counts for any of them.

## Task Commits

1. **Task 1: isolation sweep and witness spec** - `44a310d` (test)
2. **Task 2: release steps, VAPID mounts, env template, device plan** - `c4efe1a` (docs)
3. **Task 3: exit-gate fixes** - `140e1ee` (fix)

`commits: 6` is measured as `git rev-list --count 4b2539f..HEAD`. It includes the developer's three concurrent 08.1 planning commits (`6c55e26`, `f78edb4`, `58d6c46`); this plan made 3, plus the metadata commit after this SUMMARY.

## Decisions Made

See `key-decisions`. In short: the criterion-4 flag flip uses a throwaway tenant, the web is held back by a staged Vercel promotion so the API ships first, and the empty-table check covers `notifications` as well as `chat_messages`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The mocked push stack moved to `apps/web/e2e/push-fake.ts`**
- **Found during:** Task 1
- **Issue:** `installFakePush`, `pushLog` and `fakeEndpoint` lived inside `push.spec.ts`. A spec cannot import another spec, because Playwright would register its tests twice.
- **Fix:** I lifted them verbatim, exported, and `push.spec.ts` now imports them. I made no logic change.
- **Files:** `apps/web/e2e/push-fake.ts`, `apps/web/e2e/push.spec.ts`
- **Commit:** `44a310d`

**2. [Plan text vs house rule] Criterion 4 runs on a throwaway tenant, not rede-demo**
- **Found during:** Task 1
- **Issue:** The plan says "with notifications and chat off for rede-demo". `tenant-fixtures.ts` forbids flipping a seed tenant's flags: they sit in the API's 30 s cache, so every later spec in the run would read a disabled module.
- **Fix:** A per-run, per-project throwaway tenant from `createEventsTenant(…, ['feed','notifications','chat'])`. It starts ON, which proves the slots existed before the flip.
- **Commit:** `44a310d`

**3. [Rule 1 - Bug] Specs the exit gate caught asserting pre-Phase-7 or pre-rename state**
- **Found during:** Task 3 (verify2)
- **Issue:**
  - `profile.spec.ts` E7, `shell.spec.ts` D-08 and `media-video.spec.ts` still expected the Notificações "Em breve" pill that 07-07 replaced with the push row.
  - `profile.spec.ts` UI-D-01 counted the chat slot's "Suporte" label (07-08) as a role word.
  - `blocked.spec.ts` expected `t=Rede Social%20Demo`, a mangle from the 2026-09-28 rename; the seed tenant is "Rede Demo".
- **Fix:** Assert the push row and zero pills, scope the role-word check to `main` where the pill lived, and correct the tenant name. No assertion was loosened: each one now checks the current truth.
- **Files:** `apps/web/e2e/{profile,shell,media-video,blocked}.spec.ts`
- **Commit:** `140e1ee`

**4. [Rule 3 - Blocking] `channels.test.ts` cold-import timeout**
- **Found during:** Task 3 (verify1)
- **Issue:** The `vi.resetModules()` + whole-entry import case exceeded Vitest's 5 s default under verify's parallel turbo run. It takes 0.4 s alone.
- **Fix:** A per-test 30 s bound with a comment. The assertions are unchanged.
- **Commit:** `140e1ee`

### Notes

- The plan's no-secret acceptance grep prints `2` for `deploy-api.yml`. Its pattern `VAPID_PRIVATE_KEY=[A-Za-z0-9_-]{20,}` matches the secret NAME reference `VAPID_PRIVATE_KEY=vapid-private-key-prod:latest`, which the plan itself requires on both services. No key material exists in any of the four files; the other three print 0.
- `scripts/check-static-routes.sh` already listed `/notificacoes`, `/suporte` and `/suporte/[conversationId]` (3/3), so I did not change it.
- WINDOWS entries 2, 5, 6, 10, 56 and 58 were stubs Phase 7 resolved (the counters, the chat and notification stub tables, the Configurações placeholder, the generic row, the push channel). I marked them fixed after checking the code.

## Issues Encountered

- Disk went from 9.5 GiB to 5.9 GiB during the runs. I removed `.turbo/cache` before each run and `apps/web/.next` (3.7 GiB) at the end. Free space is now about 12 GiB.

## Known Stubs

None added.

## Threat Flags

None. `deploy-api.yml` gains secret mounts by name only (T-07-72 mitigated). The Realtime private-only toggle and the JWT expiry are user steps 4 and 5 (T-07-73, T-07-74). Every device row defaults to blocked (T-07-76).

## User Setup Required

The ten release steps above, all run by the developer against production, plus the device plan. Also, locally: regenerate `apps/web/.env.local` so its `PLATFORM_HOST` is `rede-social.localhost`.

## Next Phase Readiness

- Phase 7 is ready for `/gsd-verify-work`. The open items are the user-run release steps, the 17 device rows (blocked), the web `PLATFORM_HOST` env value, the desktop double-tap investigation (WINDOWS 64) and the turbo race (WINDOWS 65).

## Self-Check: PASSED

- FOUND: apps/web/e2e/phase7-smoke.spec.ts, apps/web/e2e/push-fake.ts, apps/api/.env.example, docs/phase-07-device-test-plan.md
- FOUND commits: 44a310d, c4efe1a, 140e1ee

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*
