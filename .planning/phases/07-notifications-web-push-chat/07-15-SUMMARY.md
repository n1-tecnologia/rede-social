---
phase: 07-notifications-web-push-chat
plan: 15
subsystem: testing
tags: [gap-closure, exit-gate, turbo, typegen, pnpm-verify, consent, WINDOWS-59, WINDOWS-64, WINDOWS-65, truth-15]

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-12 (harness PLATFORM_HOST, targeted feed-comments failure), 07-13 (self-restoring FEED-04 cases, verdict T), 07-14 (C-WR-03 race regressions)"
provides:
  - "apps/web/turbo.json: tasks.typecheck.dependsOn [^build, build], so web typecheck runs after web build in pnpm verify and CI"
  - "One consented full exit-gate run (backup-then-reset). It was red at e2e: 4 cases failed, each recorded with its evidence"
  - "deferred-items.md: five open entries for the run and its four reds; WINDOWS 68-71"
affects: [07-VERIFICATION truth 15, verify-work 07, gap re-plan for the exit gate]

actuals:
  tokens: 2089
  tasks: 3
  commits: 2
plan_head_before: ba0c587ac1f84fbeec7b1e56b266291b1c46b16a

tech-stack:
  added: []
  patterns:
    - "A turbo package-task override that orders two writers of one output directory (typecheck after the same package's build) without touching the build-only graph"

key-files:
  created: []
  modified:
    - apps/web/turbo.json
    - .planning/phases/07-notifications-web-push-chat/deferred-items.md
    - .planning/WINDOWS.md

key-decisions:
  - "07-15: web typecheck depends on web build (package override in apps/web/turbo.json). Vercel's turbo build graph is unchanged. Root pnpm typecheck now builds the web first"
  - "07-15: the exit gate ran exactly once after the developer chose backup-then-reset. It exited 1 at e2e (4 failed). No re-run, skip, loosened assertion or override was used. WINDOWS 59/64/65, the four gap entries and the STATE blocker 'Phase 7 local gate' stay open, because the plan writes those records only after a green run"

patterns-established:
  - "An exit-gate run is recorded with stage timings, per-spec counts and a trace-level reading of each red, and no 'fixed' record is written unless the run exits 0"

requirements-completed: [NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, EVENT-07, PWA-02, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05]

coverage:
  - id: D1
    description: "Web typecheck runs after web build, so next typegen and next build never write apps/web/.next/types at the same time"
    verification:
      - kind: other
        ref: "TURBO_CACHE=local:r pnpm --silent turbo run typecheck build --filter=@rede-social/web --dry=json: @rede-social/web#typecheck lists @rede-social/web#build and @rede-social/ui#build (Task 1, exit 0)"
        status: pass
      - kind: other
        ref: "head of verify (lint through guard:lanes), twice in Task 1: exit 0, no ENOTEMPTY"
        status: pass
      - kind: other
        ref: "07-15 gate run, stage 2: pnpm turbo typecheck build test 27/27 tasks, 0 cached, 28.3 s; web:build started 09:20:14 and web:typecheck at 09:20:21; 0 ENOTEMPTY in the whole log"
        status: pass
    human_judgment: false
  - id: D2
    description: "The local exit gate is green: pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify exits 0"
    verification:
      - kind: e2e
        ref: "07-15 gate run: exit 1 at e2e (651 passed, 4 failed, 124 skipped, 9 did not run); e2e:pwa did not run"
        status: fail
    human_judgment: true
    rationale: "The gate is red. Four e2e cases failed, and none is one of truth 15's four gap items. Whether each is a regression or a timing flake needs a re-plan or debug session. The developer may also weigh the 07-VERIFICATION override; the executor does not write it"
  - id: D3
    description: "Records follow evidence only: the four gap entries, WINDOWS 59/64/65 and the STATE blocker are resolved only after a green run"
    verification:
      - kind: other
        ref: "WINDOWS 59, 64 and 65 still open; the four gap entries unchanged; the four reds recorded as open (deferred-items, WINDOWS 68-71); 07-VERIFICATION.md last changed in c6e03b6, before 07-12"
        status: pass
    human_judgment: true
    rationale: "The plan's record-check command expects 'fixed' rows, which this red run must not write. A human confirms the records match the run"

duration: 1h 13m
completed: 2026-10-01
status: halted
---

# Phase 7 Plan 15: Turbo typecheck/build ordering and the consented exit-gate run Summary

**Web typecheck now waits for web build, and the gate's compile stage passed with no `ENOTEMPTY`. The one consented full `pnpm verify` run still exited 1 at e2e: 4 of 788 cases failed (`notifications.spec.ts:228` mobile, `phase52-smoke.spec.ts:294` mobile, `stories.spec.ts:1636` mobile, `phase2-smoke.spec.ts:378` desktop). None of them is one of truth 15's four gap items, and all four gap items held in this run. Truth 15 stays failed.**

## Performance

- **Duration:** about 1h 13m, including the consent checkpoint wait (gate run itself: 53.5 min)
- **Started:** 2026-10-01T12:03:13Z
- **Completed:** 2026-10-01T13:16Z
- **Tasks:** 3 (Task 1 by the first executor, Task 2 answered by the developer, Task 3 here)
- **Files modified:** 3 (`apps/web/turbo.json`, `deferred-items.md`, `WINDOWS.md`)

## Consent (Task 2)

The developer answered **"Back up, then reset (Recommended)"**, which is option `backup-then-reset`. Before the run:
- Ports 3000, 3100, 8787 and 8788 had no listener.
- Free disk was 11 GiB. `.turbo/cache` was 156 KB, so there was nothing to prune.
- HEAD was `6dbc035`.

The backup is `$HOME/rede-social-local-backups/pre-07-15-reset.sql`, 1,925,856 bytes, written by `pnpm supabase db dump --local --data-only`. It is outside the repository, and its contents were not read.

## Exit gate

One run, started 12:19:20Z and ended 13:12:49Z: `pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify`. **Exit code 1.** The full log is in the executor scratchpad (`gate.log`), outside the repo.

| Stage | Time (local) | Result |
|---|---|---|
| pre-run `db:reset` + `db:seed` | 09:19:20-09:19:52 (32 s) | ok; the seed printed the `rede-*` hosts |
| lint + UI literals | 09:19:52-09:19:53 | 13/13 lint tasks (cache hits), `check-ui-literals: OK` |
| `turbo typecheck build test` | 09:19:53-09:20:21 (28.3 s) | **27/27 tasks, 0 cached**. `web:build` started 09:20:14 and `web:typecheck` started 09:20:21, after it. **0 `ENOTEMPTY`** anywhere in the log |
| static routes, boundaries, boundaries:negative, lanes guard | 09:20:21-09:20:22 | all OK (54 guarded routes, 0 offenders; 868 files in 13 packages; both layers reject the fixture) |
| pgTAP (`supabase test db`) | 09:20:22-09:20:26 | **21 files, 731 tests, PASS**, including `150-realtime-authorization`, `151-notifications`, `152-chat` and `153-push-subscriptions` |
| integration | 09:20:26-09:22:28 (121.6 s) | **42/42 files, 708/708 tests**. The folder includes `realtime`, `notifications`, `notifications-prune`, `push`, `events-reminders` and `chat` |
| Supavisor spike | 09:22:28-09:22:31 | 1 file, 3/3 |
| `db:reset` + `db:seed` | 09:22:31-09:23:01 | ok |
| **e2e** | 09:23:01-10:12:49 (49.8 min) | **651 passed, 4 failed, 124 skipped, 9 did not run** (788 tests, 1 worker, `retries: 0`) |
| `e2e:pwa` | — | **did not run**, because `pnpm e2e` failed first |

### Per-spec e2e counts (passed / failed / skipped / did not run)

Phase 7 specs:

| Spec | Passed | Failed | Skipped |
|---|---|---|---|
| `notifications.spec.ts` | 44 | **1** | 1 |
| `push.spec.ts` | 25 | 0 | 1 |
| `chat.spec.ts` | 31 | 0 | 3 |
| `phase7-smoke.spec.ts` | 8 | 0 | 0 |

The gap-item specs:

| Spec | Passed | Failed | Skipped | Did not run |
|---|---|---|---|---|
| `platform.spec.ts` | 8 | 0 | 0 | 0 |
| `platform-tenants.spec.ts` | 15 | 0 | 1 | 0 |
| `platform-branding.spec.ts` | 8 | 0 | 2 | 0 |
| `platform-domains.spec.ts` | 12 | 0 | 0 | 0 |
| `invite.spec.ts` | 8 | 0 | 0 | 0 |
| `signup.spec.ts` | 16 | 0 | 0 | 0 |
| `phase2-smoke.spec.ts` | 7 | **1** | 3 | 4 |
| `feed.spec.ts` | 23 | 0 | 3 | 0 |
| `feed-comments.spec.ts` | 9 | 0 | 9 | 0 |
| `feed-media.spec.ts` | 8 | 0 | 0 | 0 |

The other two reds are in `phase52-smoke.spec.ts` (6 passed, **1 failed**, 5 did not run) and `stories.spec.ts` (59 passed, **1 failed**, 18 skipped). Every other spec had 0 failures.

The 9 "did not run" cases are the rest of two serial describes after a failure: `phase52-smoke` cases 2-6 on mobile, and `phase2-smoke` cases 2-5 on desktop.

### Gap items in this run

1. **Platform host (gap 1, WINDOWS 59). Held, but WINDOWS 59 is not closed.**
   - The gate command exported nothing except `TURBO_CACHE` and `VIDEO_PROVIDER`.
   - The 07-12 harness printed its one warning line, which names only `rede-social.localhost` and never the env file's value.
   - With no export, these all passed: `platform` 8/8, `platform-tenants` 15, `platform-branding` 8, `platform-domains` 12, `invite` 8/8 (cases 2-4 on both projects), and `signup` 16/16 (case 8 on mobile and desktop).
   - `phase2-smoke` case 1 passed on mobile and pixel. On desktop it failed **after** every platform-host step had passed (see red 4).
2. **Desktop feed double tap (gap 2, WINDOWS 64). Held.**
   - `feed.spec.ts:391` "a double tap on the gallery likes exactly ONCE" passed on desktop (1.8 s) and on mobile.
   - "a failed like reverts…" (`:483`) and the tap case (`:339`) also passed on both projects.
3. **feed-comments on the cold post-reset server (gap 3). Held.**
   - The mobile cases `feed-comments.spec.ts:327` (failed comment list) and `:361` (failed replies load) passed. They were the first feed-comments run after the reset.
   - Desktop skips them by design.
   - `media.playback_token_failed` appears in the log only for `media-video.spec.ts:375`'s intentional 404, never with `forced failure`.
4. **Turbo race (gap 4, WINDOWS 65). Held**, in the compile stage above: no cache, web typecheck ran after web build, and the log has 0 `ENOTEMPTY`.
5. **Re-run `pnpm verify` to exit 0 (gap 5). NOT met:** see the four reds below.

**07-14's two `it.fails` cases** (`NotificationsSurface.test.tsx` "gap E04 loading" and "gap own read POST", WINDOWS 66/67) count as passing inside `@rede-social/web:test` (50/50 files). They record open product gaps. They are not green behaviour.

### The four reds (stage: e2e)

1. **`notifications.spec.ts:228` [mobile-chromium] "mark-all clears every tint and the control disappears"** (Phase 7, NOTIF-02).
   - Error: `expect(getByRole('heading', { name: 'Novas', level: 2 })).toHaveCount(0)` received 1 for 10 s, after `page.reload()`.
   - Trace: `POST /api/notifications/read-all` started at 12:31:21.552Z and has no response (status -1). The reload's `GET /notificacoes` started 44 ms later.
   - Reading: the case reloads without waiting for the mark-all response. `markAll` uses a plain `fetch` with no `keepalive` (`NotificationsSurface.tsx:234`), so the reload aborted the POST before the server marked the rows read.
   - It passed on desktop in this same run, and on both projects in 07-11's verify4.
2. **`phase52-smoke.spec.ts:294` [mobile-chromium] case 1, "an admin creates an Início highlight and a community highlight from their manage screens"** (05.2).
   - Error at line 255: after the click on "Novo destaque", `getByRole('dialog', { name: 'Novo destaque' }).getByText('Em Início')` was not found within 10 s. The failure snapshot shows the manage screen with no dialog.
   - Cases 2-6 did not run.
   - It passed on desktop in this run. The cause is not established.
3. **`stories.spec.ts:1636` [mobile-chromium] "create, rename, add the EXPIRED story, pick it as cover, remove it, move up by keyboard, delete"** (05.2, mobile-only).
   - Error at line 1707: after `Escape`, the "Editar destaque" sheet was still present (`toHaveCount(0)` received 1 for 10 s).
   - Like red 2, it is a sheet interaction on a highlight manage screen. A shared cause is not established.
4. **`phase2-smoke.spec.ts:378` [desktop-chromium] case 1, the panel tracer with the Marca rebrand** (Phase 2).
   - Error: test timeout of 300 s at line 532.
   - After `#primary` was filled, "Salvar alterações" was detached, re-rendered disabled, and stayed disabled (438 retries).
   - Everything before that line passed: panel create, verified host, invite mail, branded login, logo upload, "Alterações salvas." and icons ready. So this is not the PLATFORM_HOST cause.
   - Desktop cases 2-5 did not run.

The only page errors in the three mobile traces are the Serwist `register` TypeError. Every page logs it under Playwright's blocked service worker.

**Why these were not fixed here.** Plan Step 4 forbids fix-forward in the gate task, and the repo rule allows one run only. None of the four was re-run, skipped or loosened. Each is recorded `status: open` in `deferred-items.md`, together with a run entry, and as WINDOWS 68-71 (`unrun-verify`).

All four passed in 07-11's verify4. Code has changed since then (`git diff --stat 8b7415e 6dbc035 -- apps packages`: 53 files, including the 07 code-review fixes and the 07-12..07-14 e2e edits), so one run cannot tell a regression from a timing flake.

**Records not written, by the plan's rule.** The gate did not exit 0, so the following stay as they were:
- WINDOWS 59, 64 and 65 stay `open`.
- The four gap entries in `deferred-items.md` keep their status (the double-tap entry was already `resolved` by 07-13).
- The STATE blocker "Phase 7 local gate" is not resolved.
- `07-VERIFICATION.md` is untouched (last changed in `c6e03b6`, before 07-12).
- `requirements.mark-complete` was not run, so REQUIREMENTS.md keeps "Gaps Found". The frontmatter list copies the plan's `requirements` per the template. It is not a completion claim.

## Accomplishments

- The turbo `.next/types` race can no longer happen in `pnpm verify` or CI. The edge is in the dry-run graph, and the gate's uncached compile stage ran web typecheck after web build with no `ENOTEMPTY`.
- The consented gate ran end to end, once, on a backed-up and freshly reset database. Every stage before e2e is green, and so are all four truth-15 gap items.
- The remaining red is named exactly: stage, spec, project, line, error and trace reading. It is recorded in deferred-items and in WINDOWS 68-71.

## Task Commits

1. **Task 1: web typecheck runs after web build (tracer)** - `6dbc035` (fix), first executor
2. **Task 2: consent checkpoint** - no commit (developer chose backup-then-reset)
3. **Task 3: run the gate and record it** - `ad3c176` (docs)

**Plan metadata:** the docs commit that adds this SUMMARY.

`commits: 2` is measured as `git rev-list --count ba0c587..HEAD` before the metadata commit.

## Files Created/Modified

- `apps/web/turbo.json`: a `tasks.typecheck.dependsOn: ["^build", "build"]` override with the JSONC rationale (Task 1).
- `.planning/phases/07-notifications-web-push-chat/deferred-items.md`: a run entry plus one open entry per red, each with its evidence.
- `.planning/WINDOWS.md`: rows 68-71 (`unrun-verify`, phase 7), added through `gsd-tools windows append`.

## Decisions Made

- **Backup before reset.** This was the developer's choice. The dump is outside the repository.
- **No record is flipped on a red run.** This follows the plan's acceptance rule. New open records were added only for reds this run proved.
- **SUMMARY `status: halted`.** The plan reached its designed stop for a red gate (Step 4: "record it and stop; a re-plan follows").

## Deviations from Plan

**1. [Plan text] The plan's record-check command cannot pass on a red run.**
- The second `<verify>` command expects WINDOWS 59/64/65 `fixed` and the four entries `status: fixed`. The acceptance criteria forbid writing those after a red run, so the check fails by design.
- Separately, the deferred-items scanner treats only `status: resolved` as closed (07-13 used `resolved`). A future green run should write `resolved` and note that the plan's `status: fixed` grep expects otherwise.

**2. [Records] Open entries and WINDOWS rows were added for the four reds.**
- Plan Step 4 asks for a deferred-items entry for a red unrelated to Phase 7. I recorded all four reds, including the Phase 7 notifications case, because a red the run proved must be visible at ship time.
- No existing entry was changed.

**Total deviations:** 2, both about records; no code changed. **Impact:** none on product code.

## Issues Encountered

- **Disk** fell from 11 GiB to about 5.3 GiB free during e2e: `apps/web/.next/dev` grew to 2.5 GiB and `test-results` to 570 MB. It recovered to 6.8 GiB at the end. `.turbo/cache` stayed at 156 KB, so pruning it would have freed nothing. Nothing was deleted.
- **No `.env*` file** was read or changed. `local-env.sh --write` was not run.
- **Ports:** 3000, 3100, 8787 and 8788 have no listener after the run.

## Still with the developer

These were not touched:
- the real-device rows (Phase 8 go-live);
- the open-socket block residual;
- the C-WR-02 policy decision;
- the flagged-prohibition sign-off;
- the truth 15 override that the verifier suggested.

The developer's own `apps/web/.env.local` `PLATFORM_HOST` matters only for a hand-run `next dev`. The gate no longer reads it.

## Next Phase Readiness

- **Next step:** re-verify Phase 7 (`/gsd-verify-work 7` or the verifier). Truth 15 is expected to stay **failed**, with these four reds as its remaining gap instead of the 07-11 items. The status therefore stays `gaps_found` and does not reach `human_needed`, unless the developer accepts the override.
- **For a re-plan:**
  - `notifications.spec.ts:228` needs a decision first: either the test waits for `read-all`, or the product sends it with `keepalive`.
  - The two 05.2 highlight-sheet reds and the desktop phase2-smoke Marca case need a `/gsd-debug` look at their traces in `apps/web/test-results/`. Those traces are kept until the next Playwright run.

## Self-Check: PASSED

- FOUND: `apps/web/turbo.json` (contains `"dependsOn": ["^build", "build"]`, `"extends": ["//"]` and `"tags": ["app"]`)
- FOUND: commits `6dbc035` and `ad3c176` (`git rev-list --count ba0c587..HEAD` = 2)
- FOUND: WINDOWS rows 68-71 `open`; rows 59, 64 and 65 still `open`
- FOUND: `$HOME/rede-social-local-backups/pre-07-15-reset.sql`, 1,925,856 bytes
- `07-VERIFICATION.md` unchanged by this plan (last commit `c6e03b6`, 2026-09-30)
