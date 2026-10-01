---
phase: 07-notifications-web-push-chat
plan: 12
subsystem: testing
tags: [gap-closure, exit-gate, e2e-harness, playwright, platform-host, server-actions, WINDOWS-59, truth-15]

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-11's exit-gate run and the 07-VERIFICATION truth 15 gap items 1 and 3"
provides:
  - "apps/web/e2e/hosts.ts: e2eHosts() and e2ePlatformHostname(), the one source of the e2e origins"
  - "playwright.config.ts harness PLATFORM_HOST rule: exported wins, else the e2e platform hostname, with a value-free warning"
  - "feed-comments failNextActions(page, targetId, count) matching next-action + target id, with failedCount()"
affects: [07-13, 07-14, 07-15, pnpm verify exit gate]

actuals:
  tokens: 3216
  tasks: 2
  commits: 2
plan_head_before: 7b5981b3ab7c2c1afd1c2c496fc6f130afb5a8f3

tech-stack:
  added: []
  patterns:
    - "The e2e harness decides process.env values for the servers it launches before Playwright spawns webServer entries (exported values always win)"
    - "A forced server-action failure is aimed by the next-action header plus the target id in postData(), and the case asserts the failed-request count"

key-files:
  created:
    - apps/web/e2e/hosts.ts
  modified:
    - apps/web/e2e/fixtures.ts
    - apps/web/playwright.config.ts
    - apps/web/e2e/feed-comments.spec.ts

key-decisions:
  - "07-12: the e2e harness owns PLATFORM_HOST for the servers it launches (exported value wins, else the hostname of the e2e platform URL); the developer's apps/web/.env.local is never read for output, rewritten or regenerated, and local-env.sh --write is not the remedy"
  - "07-12: feed-comments' forced failure matches a server action (next-action header) whose arguments carry the post id or root comment id, never by ordering or by build-generated action ids"

patterns-established:
  - "One source for e2e origins: specs read hosts through fixtures.ts, the config reads e2ePlatformHostname(), both from e2e/hosts.ts at call time"

requirements-completed: [NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, EVENT-07, PWA-02, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05]

coverage:
  - id: D1
    description: "With nothing exported and apps/web/.env.local untouched, the servers Playwright launches serve the platform shell on rede-social.localhost, so platform.spec.ts passes on both projects"
    verification:
      - kind: e2e
        ref: "VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test platform.spec.ts (8 passed, twice)"
        status: pass
      - kind: other
        ref: "PLATFORM_HOST=other.localhost playwright test --list platform.spec.ts prints no [e2e] warning (exported value wins); without it the warning prints once naming only the harness host"
        status: pass
    human_judgment: false
  - id: D2
    description: "e2e hosts have one source (e2e/hosts.ts) read by fixtures.ts and playwright.config.ts with the same four defaults"
    verification:
      - kind: other
        ref: "pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint"
        status: pass
    human_judgment: false
  - id: D3
    description: "feed-comments fails only the comment-list or replies action under test and asserts exactly one failed request; green on two cold dev-server starts and a warm --repeat-each=3"
    verification:
      - kind: e2e
        ref: "rm -rf apps/web/.next && playwright test feed-comments.spec.ts --project=mobile-chromium (cold 1: 9 passed; cold 2: 9 passed)"
        status: pass
      - kind: e2e
        ref: "playwright test feed-comments.spec.ts --project=mobile-chromium -g failed --repeat-each=3 (6 passed)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-10-01
status: complete
---

# Phase 7 Plan 12: e2e harness platform host and targeted feed-comments failure Summary

**Playwright now tells the API, web and worker it launches that the platform host is the one the specs browse (`rede-social.localhost`), so it no longer reads that value from the developer's `.env.local`. feed-comments' forced failure hits only the comment-list or replies server action, matched by the `next-action` header and the target id.**

## Performance

- **Duration:** about 5 min
- **Started:** 2026-10-01T11:16:31Z
- **Completed:** 2026-10-01T11:21:47Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **Step 1 reproduction (before any edit), with nothing exported:** `platform.spec.ts --project=desktop-chromium` gave **2 failed, 2 passed**. Case 1 (super_admin on the platform host) and case 2 failed. In case 2 the member landed on `/inicio` instead of `/endereco-invalido`, because the web served the generic shell on `rede-social.localhost`. Gap item 1 was reproduced locally.
- **After Task 1:** `platform.spec.ts` on all projects gave **8 passed** with nothing exported. It passed again on the tracer re-run after the commit (8 passed). The config printed one warning line: `[e2e] this run serves the platform shell on rede-social.localhost (the host the specs browse) instead of the PLATFORM_HOST in apps/web/.env.local; a hand-run 'next dev' still reads that file.` The line never contains the file's value.
- **Exported value wins:** with `PLATFORM_HOST=other.localhost` exported, `playwright test --list` printed no warning, so the override branch was not taken. Without the export, the warning printed once.
- **feed-comments:** cold start 1 gave **9 passed** and cold start 2 gave **9 passed** (`apps/web/.next` was removed before each). The warm `-g failed --repeat-each=3` gave **6 passed**. No run logged `media.playback_token_failed`. Each failure case now asserts `failedCount()` is exactly 1. No assertion was removed or weakened.

## Task Commits

1. **Task 1: harness PLATFORM_HOST + one source of e2e hosts** - `dba8214` (fix)
2. **Task 2: targeted failNextActions** - `aad22df` (fix)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `apps/web/e2e/hosts.ts` (new): `e2eHosts()` and `e2ePlatformHostname()`. Both read the four `PLAYWRIGHT_*_URL` values at call time with the old defaults. The file imports nothing from the e2e folder.
- `apps/web/e2e/fixtures.ts`: `export const hosts = e2eHosts();`. The shape and values are unchanged for every spec.
- `apps/web/playwright.config.ts`: the config notes whether `PLATFORM_HOST` was exported before `loadEnvFile`. If it was not, the config sets it to `e2ePlatformHostname()`. When the file supplied a different value, it prints one warning that names only the harness host. The docblock records planning decisions 1 and 2.
- `apps/web/e2e/feed-comments.spec.ts`: `failNextActions(page, targetId, count = 1)` now returns `{ restore, failedCount }`. The comment-list case arms it with `feedPostIdFor(firstPost, 'rede-demo')` and the replies case with the root's `data-comment-id`. Both assert exactly one failed request. A file-level `afterAll` calls `closeAdmin()`.

## Decisions Made

- The harness owns `PLATFORM_HOST` for the servers it launches, and an exported value always wins. This follows planning decision 1: the gate stops measuring the developer's machine.
- The forced failure is aimed by the `next-action` header plus the target id in `postData()`. Ordering and build-generated action ids are not used (planning decision 4).

## Deviations from Plan

None. The plan was executed exactly as written.

## Issues Encountered

None. No `.env*` file was read or changed. No database reset or seed ran. Disk free space stayed at 12-13 GiB, so `.turbo/cache` was not touched.

## Note for 07-15

The developer's hand-run `next dev` (outside Playwright) still reads `PLATFORM_HOST` from `apps/web/.env.local`, and that value differs from `rede-social.localhost`, as both the Step 1 reproduction and the warning show. Changing that one line is still worth doing for hand-run sessions, but the gate no longer needs it. Do not recommend `bash scripts/local-env.sh --write` for this: it rewrites both env files from the template and drops hand-set values such as the Mux keys.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- Gap items 1 and 3 of truth 15 are closed in the harness. Items 2 (the desktop double tap) and 4 (the turbo `.next/types` race) belong to 07-13 and 07-14, and the consented reset and full `pnpm verify` re-run belong to 07-15.
- Ports 3000, 8787 and 8788 are free. Playwright stopped every server it launched.

## Self-Check: PASSED

- FOUND: apps/web/e2e/hosts.ts
- FOUND: dba8214, aad22df (`git rev-list --count 7b5981b..HEAD` = 2)
