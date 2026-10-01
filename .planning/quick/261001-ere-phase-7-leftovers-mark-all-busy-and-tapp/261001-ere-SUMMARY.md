---
phase: quick-261001-ere
plan: 01
subsystem: notifications, e2e fixtures
status: complete
tags: [gap-closure, notifications, mark-all, keepalive, vitest, happy-dom, playwright, e2e-fixtures, UI-D-252, UI-D-20]
requirements: [NOTIF-02, FEED-02]
requires: [07-14 unit harness, 07-15 gate evidence]
provides:
  - mark-all control mounted, aria-busy and disabled for its whole POST
  - own keepalive read POST for a row tapped during an in-flight mark-all
  - keepalive read-all POST (still awaited)
  - notifications.spec.ts mark-all case ordered after the read-all 204
  - UI-D-20 empty tenant slug unique per project, run and repeat
affects: [07-VERIFICATION truths 12, 17, 20 and the notifications red of truth 15]
tech-stack:
  added: []
  patterns: [one in-flight ref per optimistic batch (added + tapped), per-run e2e slug token plus a stale sweep]
key-files:
  created: []
  modified:
    - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
    - apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx
    - apps/web/e2e/notifications.spec.ts
    - apps/web/e2e/feed-admin.ts
    - apps/web/e2e/feed.spec.ts
    - .planning/WINDOWS.md (uncommitted, via gsd-tools windows fixed)
    - .planning/phases/07-notifications-web-push-chat/deferred-items.md (uncommitted)
decisions:
  - "Decision A: read-all is sent with keepalive: true and still awaited; it drives the busy state and the rollback"
  - "Decision B: UI-D-252 wording unchanged; the control stays mounted while markingAll and implements the spec as written"
  - "Decision C: a row tapped during a mark-all posts its own keepalive read when view.unread, cleared by that mark-all and not yet tapped; no extra rollback"
  - "Decision D: WINDOWS 66/67 fixed on unit evidence, 68 on the targeted notifications.spec.ts run; truth 15, the umbrella 07-15 entry and WINDOWS 69-71 stay open"
  - "Decision E: UI-D-20 slug feed-empty-<project>-<run>-r<repeat> plus deleteStaleEmptyFeedTenants(project)"
metrics:
  duration: 9min
  completed: 2026-10-01
  tasks: 2
  files: 5
actuals:
  tokens: 7500
  tasks: 2
  commits: 2
plan_head_before: 81e1c5e08e271b7cbb518eacefab67bd6ffeaa91
commits: 2
---

# Quick 261001-ere: Phase 7 leftovers (mark-all busy, tapped-row read, UI-D-20 repeat) Summary

The "Marcar todas como lidas" control now stays mounted, aria-busy and disabled for its whole POST. A row tapped while a mark-all is in flight sends its own keepalive read POST. The read-all POST is sent with keepalive and is still awaited. The e2e mark-all case waits for the 204 before reloading. The UI-D-20 empty tenant gets a fresh slug and host for each run and each repeat.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | a5d5d6b | fix(quick-261001-ere): keep mark-all busy for its POST, post a tapped row's own read, wait for read-all in e2e |
| 2 | c46b454 | test(quick-261001-ere): give the UI-D-20 empty tenant a slug unique per run and repeat |

The ledger files are left modified and uncommitted for the orchestrator, as instructed: `.planning/WINDOWS.md` and `.planning/phases/07-notifications-web-push-chat/deferred-items.md`. This overrides the plan's two `docs(quick-261001-ere)` ledger commits.

## Evidence (real tool output)

### Unit, `NotificationsSurface.test.tsx`
- Before the fix, with the new tests on the unchanged component: `Tests  3 failed | 2 passed (5)`. Cases 2 (`tapped`), `E04 loading` and `own read POST` failed. Cases 1 and 3 passed.
- After the fix: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.
- Red check with the 583619c component (`git checkout 583619c -- NotificationsSurface.tsx`). Every filter matches 2 cases, because case 2's title contains all three strings:
  - `-t tapped`: `Tests  2 failed | 3 skipped (5)`
  - `-t "E04 loading"`: `Tests  2 failed | 3 skipped (5)`
  - `-t "own read POST"`: `Tests  2 failed | 3 skipped (5)`
  - At HEAD each filter gave `Tests  2 passed | 3 skipped (5)`. After the restore, `git diff --quiet HEAD -- NotificationsSurface.tsx` held, so the tree was clean.
  - My first red-check attempt used a mistyped log path. The redirect failed, the runs never executed, and the loop printed a meaningless OK. I re-ran it with a valid path. The counts above come from the valid run.
- Typecheck, Biome lint and `scripts/check-ui-literals.sh` passed after each task.

### E2E, `notifications.spec.ts` (mobile-chromium and desktop-chromium)
- Exit 0, `45 passed, 1 skipped` in 3.3 min.
- mobile-chromium: 23 passed.
- desktop-chromium: 22 passed, plus 1 skipped. The skip is `:261 at 320px the mark-all label stays on one line`, a mobile-only case.
- `:228 mark-all clears every tint and the control disappears` passed on mobile (2.1 s) and on desktop (1.6 s).
- **Wait path used: the primary one.** The case arms `page.waitForResponse` for the POST `/api/notifications/read-all` before the click and asserts `status() === 204` before `page.reload()`. Playwright reported the keepalive response, so the `waitForRequest` contingency was not needed.
- Ports 3000/3100/8787/8788 were free before and after the run.

### E2E, `feed.spec.ts` (mobile-chromium and desktop-chromium)
- `-g "UI-D-20" --repeat-each=3`: exit 0, `12 passed (24.1s)`.
- Whole file with `--repeat-each=3`: exit 0, `69 passed, 9 skipped` in 1.9 min, 0 failed.
  - mobile-chromium: 39 passed.
  - desktop-chromium: 30 passed, plus 9 skipped. The skips are three mobile-only cases (`:298` pull-to-refresh, `:530` edited marker, `:547` 40-character name), 3 times each.
  - UI-D-20 passed 6 times on each project, 12 of 12.
- Ports were free before and after the run. Afterwards, `select count(*) from public.tenants where slug like 'feed-empty%'` returned 0.

## Decisions A-E (as executed)
- **A, keepalive on read-all: yes.** `fetch('/api/notifications/read-all', { method: 'POST', keepalive: true })` is still awaited. The code comment explains why: the tap already cleared every tint, a reload or close must not lose the mark (07-15 trace), and the request has no body.
- **B, UI-D-252 unchanged.** The render condition is `anyUnread || markingAll`. `07-UI-SPEC.md` was not edited.
- **C, post rather than roll back.** `inFlightMarkAll` is a ref holding `{ added, tapped }`, or null. It replaces `tappedDuringMarkAll`. `activate` posts when the row looks unread, or when `marking && view.unread && added.has(id) && !tapped.has(id)`. The post goes out before the id is added to `tapped`. The rollback still removes only the ids in `added` that are not in `tapped`.
- **D, ledger scope.** WINDOWS 66, 67 and 68 are now `fixed` (gsd-tools). Rows 69, 70 and 71 are still `open`. The umbrella "07-15 exit gate run" entry is still `status: open`, and truth 15 is untouched.
- **E, UI-D-20 slug.** The slug is `feed-empty-<project>-<run>-r<repeat>`, built from the module-level `RUN = Date.now().toString(36)`. It is not sliced, and it is at most 38 characters. `deleteStaleEmptyFeedTenants(project)` selects `slug = legacy or starts_with(slug, legacy || '-')` through bound postgres.js parameters, so no LIKE wildcard applies. It then deletes each match with `deleteEmptyFeedTenant`.

## Ledger changes (uncommitted)
- `.planning/WINDOWS.md`: rows 66, 67 and 68 changed to `fixed`. The frontmatter counts are now open 38 and fixed 33.
- `deferred-items.md`: three entries went from `status: open` to `status: resolved`, each with a resolution line naming the commit SHA and the counts:
  - the mark-all busy / tapped-row entry
  - the `notifications.spec.ts:228` entry, which also records Decision A and the wait path
  - the UI-D-20 `--repeat-each` entry

## Deviations from Plan
- **Ledger not committed.** The plan asked for `docs(quick-261001-ere)` ledger commits. The orchestrator's constraints say to leave the files modified for it, and those constraints take precedence.
- **Helper inside case 2.** I added a local `callsTo(url)` helper inside case 2 to count fetches per URL. The shared harness is unchanged.
- Otherwise the plan ran as written. No auto-fixes were needed.

## Known Stubs
None.

## Threat Flags
None. No new endpoints or trust-boundary changes. `gatedMark` is unchanged. The fixture sweep is local-only and uses bound parameters (T-q261001-04).

## Out-of-scope reds
None. Every case in both targeted files passed.

## Self-Check: PASSED
- The 5 code files exist and are committed in a5d5d6b and c46b454. Both commits are in `git log`, and neither has a co-author trailer.
- The plan's grep checks passed: no `it.fails`, no `during === null`, no "really marked it read", and at least 2 non-comment `keepalive: true` hits in the component.
- The WINDOWS check passed: 66, 67 and 68 are fixed, and 69, 70 and 71 are open.
