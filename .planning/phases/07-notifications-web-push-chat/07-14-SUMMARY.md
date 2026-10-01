---
phase: 07-notifications-web-push-chat
plan: 14
subsystem: testing
tags: [gap-closure, ride-along, C-WR-03, notifications, regression, vitest, happy-dom, D-230, D-231, truth-14]

requires:
  - phase: 07-notifications-web-push-chat
    provides: "583619c, the C-WR-03 fix in NotificationsSurface.tsx (generation ref, scoped mark-all rollback)"
provides:
  - "NotificationsSurface.test.tsx: deterministic race harness (deferred actions, stubbed fetch, real catalog and ToastProvider)"
  - "regression for the generation guard (stale load-more page dropped after a pull-to-refresh, refreshed cursor used)"
  - "regression for the scoped mark-all rollback (rows tapped before or during it stay read)"
  - "live-merge control (a visibilitychange merge during a load-more prepends, the page still appends)"
  - "two it.fails cases recording product gaps: E04 busy state unreachable, no own read POST during mark-all"
affects: [07-15, 07-VERIFICATION truth 14, verify-work 07]

actuals:
  tokens: 3745
  tasks: 2
  commits: 2
plan_head_before: 96d98dfc41652fabc421d4ca9549cb86f6d4f02c

tech-stack:
  added: []
  patterns:
    - "Race regressions as component tests: hold an action or fetch on a hand-made deferred, then pick the interleaving"
    - "Red evidence on a pre-fix commit: git checkout <fix>^ -- <file>, run with -t, restore with git checkout HEAD, then assert git diff --quiet"
    - "Product gaps found by a test-only plan: it.fails with the planned assertion unchanged, plus deferred-items and WINDOWS"

key-files:
  created:
    - "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx"
  modified: []

key-decisions:
  - "07-14: UI E04 loading ('aria-busy and disabled while the POST runs') cannot hold at HEAD. Mark-all clears every loaded row, so the anyUnread-gated button unmounts. Case 2 asserts only 'no enabled mark-all control during the POST'. The planned assertion stays unchanged in an it.fails case (WINDOWS 66)"
  - "07-14: a row tapped during a mark-all sends no read POST (activate posts only while isUnread), so C-WR-03's premise 'its own read POST really marked it' is false. It is pinned as an it.fails case (WINDOWS 67), with no product change, because the plan is test-only"

patterns-established:
  - "it.fails for a found product gap in a test-only plan: the assertion stays unchanged, and the case turns red when the fix lands"

requirements-completed: [NOTIF-02]

coverage:
  - id: D1
    description: "Generation guard (C-WR-03, D-231). A load-more that started before a pull-to-refresh drops its page, the list is exactly the refreshed rows (newest first, no duplicate), and the next load-more asks for the refreshed cursor (NOTIF-02 adjacency and ordering, UI E02)"
    requirement: NOTIF-02
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx#1. stale page"
        status: pass
      - kind: other
        ref: "red check: git checkout 583619c^ -- NotificationsSurface.tsx; vitest -t 'stale page' fails; restored byte-identical"
        status: pass
    human_judgment: false
  - id: D2
    description: "Scoped mark-all rollback (C-WR-03, D-230). A failed mark-all gives the tint back only to rows it cleared. Rows tapped before and during it stay read, and one catalog error toast fires (UI E04 error)"
    requirement: NOTIF-02
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx#2. tapped"
        status: pass
      - kind: other
        ref: "red check: git checkout 583619c^ -- NotificationsSurface.tsx; vitest -t 'tapped' fails; restored byte-identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live-merge control. A visibilitychange merge during a load-more only prepends, and the load-more page is still appended (it also passes on 583619c^)"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx#3. live merge"
        status: pass
    human_judgment: false
  - id: D4
    description: "UI E04 loading: the mark-all button is aria-busy and disabled while its POST runs. NOT MET at HEAD (the button is withdrawn), recorded as it.fails 'gap E04 loading' and WINDOWS 66"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx#gap E04 loading (it.fails)"
        status: fail
    human_judgment: true
    rationale: "Product gap (UI-D-252 contradicts itself). Either fix the component or amend the spec. A test-only plan cannot decide it."
  - id: D5
    description: "C-WR-03 premise: a row tapped during a mark-all sends its own read POST. NOT MET at HEAD, recorded as it.fails 'gap own read POST' and WINDOWS 67"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx#gap own read POST (it.fails)"
        status: fail
    human_judgment: true
    rationale: "Product gap. The UI shows the row read while the server keeps it unread after a failed mark-all. It needs a product fix outside this test-only plan."

duration: 5min
completed: 2026-10-01
status: complete
---

# Phase 7 Plan 14: C-WR-03 race regressions Summary

**Component tests on the shipped `NotificationsSurface` pin both C-WR-03 race fixes. A load-more page that started before a pull-to-refresh is dropped and the refreshed cursor is used. A failed mark-all un-reads only what it cleared. Each case fails on `583619c^` and passes at HEAD. A live-merge control shows the guard is scoped to replacing refreshes. Two product gaps found on the way are recorded as `it.fails` cases.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-10-01T11:54:40Z
- **Completed:** 2026-10-01T11:59:45Z
- **Tasks:** 2
- **Files modified:** 1 (new test file). Planning: deferred-items.md, WINDOWS.md

## Accomplishments

- **Truth 14 is automated.** `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx`, describe `NotificationsSurface — C-WR-03 races`:
  - case "1. stale page": the generation guard;
  - case "2. tapped": the scoped rollback;
  - case "3. live merge": the control.
- **Deterministic interleavings.** `loadMoreNotificationsAction` and the `/api/notifications/read-all` fetch are held on hand-made deferreds, and `refreshNotificationsAction` lands first. `InfiniteScroll` and `PullToRefresh` are buttons. Everything else is real: the pt-BR catalog through next-intl, `ToastProvider`, `Button` and `NotificationItem`. Realtime is a no-op.
- **Red evidence on the pre-fix component.** Both red checks exit 0. On `583619c^` the full file reports `2 failed | 1 passed | 2 expected fail`: cases 1 and 2 fail and the control passes. `NotificationsSurface.tsx` was restored and checked byte-identical after every swap (`git diff --exit-code HEAD` and `git diff --cached --exit-code`).
- **Two product gaps found and pinned** (see Issues Encountered). The planned assertions are unchanged in `it.fails` cases.

### Passing run at HEAD

```
 ✓ … C-WR-03 races > 1. stale page: … (D-231, NOTIF-02 adjacency and ordering, UI E02)
 ✓ … C-WR-03 races > 2. tapped: … (D-230, UI E04 error, no second POST while it runs)
 ✓ … C-WR-03 races > 3. live merge: …
 ✓ … known gaps (expected failures at HEAD) > gap E04 loading: …
 ✓ … known gaps (expected failures at HEAD) > gap own read POST: …
 Test Files  1 passed (1)
      Tests  3 passed | 2 expected fail (5)
```

`pnpm --filter @rede-social/web typecheck`, `lint` (Biome, 399 files, no diagnostics) and `bash scripts/check-ui-literals.sh` (OK) all exit 0.

### Red check 1: case "1. stale page" on `583619c^` (exit 0)

```
AssertionError: expected [ 'n', 'a', 'b', 'c', 'd' ] to deeply equal [ 'n', 'a', 'b' ]
 ❯ NotificationsSurface.test.tsx:234:22
    234|     expect(rowIds()).toEqual(['n', 'a', 'b']);
 Tests  1 failed | 1 skipped (2)
```

The pre-fix component appended the stale page (`c`, `d`) after the refreshed page 1.

### Red check 2: case "2. tapped" on `583619c^` (exit 0)

```
AssertionError: expected 'true' to be 'false' // Object.is equality
 ❯ NotificationsSurface.test.tsx:303:50
    303|     expect(row('b').getAttribute('data-unread')).toBe('false');
 Tests  1 failed | 4 skipped (5)
```

The pre-fix component restored the whole pre-request set (`setLocallyRead(before)`), so row `b`, tapped while the mark-all was in flight, was un-read again.

**For the verifier:** 07-VERIFICATION truth 14's `behavior_unverified_items` entry (C-WR-03, `PRESENT_BEHAVIOR_UNVERIFIED`) now has its automated test: cases 1 and 2 above, each with red evidence. The plan's prohibition ("a failed mark-all must never restore the tint of a tapped row; a stale load-more must never append or adopt its cursor") is exercised by those two cases. Its tapped-row half rests on the UI tint only: see gap 2 below for the server side.

## Task Commits

1. **Task 1: race harness, stale-page case, live-merge control** - `ba89661` (test)
2. **Task 2: scoped mark-all rollback case + two recorded gaps** - `7d492dc` (test)

**Plan metadata:** recorded in the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx` - the C-WR-03 race regressions, the live-merge control and the two `it.fails` gap cases (new, 396 lines)
- `.planning/phases/07-notifications-web-push-chat/deferred-items.md` - the two gaps and their fix path
- `.planning/WINDOWS.md` - entries 66 and 67 (`unmet-truth`, open)

## Decisions Made

- **The control uses `visibilitychange`.** happy-dom reports `visible`, and the case asserts it. `mergeLatest` refetches without bumping the generation, which is the planner's decision 2.
- **Rows are glyph rows with `href: null`.** They render as `<button>`, so a tap never navigates under happy-dom. Sentences are `row-<id>.`, so the row order can be read back exactly.
- **The toast is asserted as one `role="status"` node whose text equals `tn('errors.markAll')`.** `tn` is the real catalog translator, never a literal. The shipped provider shows one toast at a time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan assertion contradicts the shipped product] UI E04 loading cannot hold, so the busy-button check moved to an `it.fails` case**
- **Found during:** Task 2, step 4
- **Issue:** the plan asserts the mark-all button is busy and disabled during the POST. At HEAD `markAll` clears every loaded row, `anyUnread` turns false, and the `anyUnread ? <Button loading={markingAll}> : null` branch unmounts the button. The first run failed with `Unable to find an element by: [data-testid="notifications-mark-all"]`. UI-D-252 itself requires both "rendered only while at least one loaded row is unread" and "aria-busy and disabled while the POST runs".
- **Fix (no product change, repo rule 4):** case 2 asserts what holds and will keep holding after a fix: no ENABLED mark-all control while the POST runs (`during === null || during.disabled`). The planned assertion moved unchanged to `it.fails('gap E04 loading: …')`. Running that case once as a plain `it` (from a temporary untracked copy, deleted afterwards) failed with exactly `Unable to find an element by: [data-testid="notifications-mark-all"]`. Case 2's title now reads "UI E04 error, no second POST while it runs" instead of "UI E04 loading and error". The `-t "tapped"` filter is unaffected.
- **Files modified:** the test file only
- **Committed in:** `7d492dc`

**2. [Rule 2 - Recording a found defect] C-WR-03 premise "its own read POST really marked it" is false at HEAD**
- **Found during:** Task 2, while reading `activate` against the plan's truth 2
- **Issue:** `activate` POSTs `/api/notifications/{id}/read` only while `isUnread(view)`. During a mark-all every row is already in `locallyRead`, so a row tapped then sends NO read. After a failed mark-all, the scoped rollback keeps that row read on screen while the server keeps it unread until the next load.
- **Fix:** recorded as `it.fails('gap own read POST: …')`. Run as a plain `it`, it failed with `expected "vi.fn()" to be called with arguments: [ '/api/notifications/b/read', …(1) ]`. Case 2 makes no claim about b's POST in either direction. The gap is also in deferred-items.md and WINDOWS 67. No product change.
- **Committed in:** `7d492dc`

---

**Total deviations:** 2. Both record product gaps rather than fix them; no product file changed.
**Impact on plan:** the three planned cases are green at HEAD and red where intended on `583619c^`. Planned truth "UI E04 loading (re-lifted)" is NOT met by the product. It is recorded, not faked. The suite reports `3 passed | 2 expected fail`, which meets the "3 passed" criterion.

## Issues Encountered

- **Gap 1, UI E04 loading (WINDOWS 66).** The mark-all button is withdrawn during its POST instead of being `aria-busy`/disabled. A double submit is still impossible. Fix: keep it mounted while `markingAll` (`anyUnread || markingAll`), or amend UI-D-252. Then turn `it.fails` into `it`.
- **Gap 2, no own read POST during a mark-all (WINDOWS 67).** Fix: `activate` should POST when the row is server-unread (`view.unread`) while a mark-all is open. Then turn `it.fails` into `it`.
- Both are routed to 07-15 or the verifier as product decisions. 07-14 is test-only.

## Known Stubs

None.

## Threat Flags

None. T-07-82 is mitigated: every swap to `583619c^` was restored with `git checkout HEAD -- <file>` and checked with `git diff --quiet HEAD` plus `git diff --cached --exit-code`, and `git status --porcelain` on the component printed nothing after each task. T-07-SC: no package installed.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- Ready for 07-15 (gap-closure accounting). Truth 14 can move to VERIFIED for the two C-WR-03 races. The two gaps above are new, open and product-side.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-10-01*
