---
phase: quick-261117-jke
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/app/(app)/suporte/SupportInbox.tsx
  - apps/web/app/(app)/suporte/SupportInbox.test.tsx
autonomous: true
requirements: []
tags: [bugfix, support-inbox, phase-12.4, WR-06, quick]

estimate:
  tokens: 35000
  raw_tokens: 35000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A page-1 refetch that lands while a load-more is in flight drops no row the server still lists. Repro (the verifier's R3): the list holds [R1, R2, R3] with cursor 'c1', the load-more for 'c1' is held open, a fresh page 1 [NEW, R1, R2] (cursor 'cX') lands, then the load-more answers [R4, R5] (cursor 'c2'); the screen ends as [NEW, R1, R2, R3, R4, R5]. Before the fix it ends as [NEW, R1, R2, R4, R5] (R3 is in neither the fresh page nor the loaded page)."
    - "The refetch that lands during a load-more takes the NOT-whole path of reconcileInboxPage: rows deeper than the fresh tail stay and the cursor is left alone, so the cursor the NEXT load-more is called with is the load-more answer's ('c2'), never the refetch's ('cX')."
    - "With nothing in flight nothing changes: a list that holds only page 1 is still replaced by the fresh page and takes its cursor (the existing WR-01 / T7 tests stay green, unchanged)."
    - "The in-flight mark is cleared on EVERY exit of loadMore (page appended, refused page { ok: false }, a thrown or rejected call, the answer dropped because the view changed). Proof: after a refused or rejected load-more, where pagesRef stays at 1, a refetch is the whole view again (list = fresh page, next load-more uses the fresh cursor)."
    - "reconcileInboxPage and apps/web/lib/chat-view.ts are NOT changed (the pure rule is correct, its input was wrong). No UI string is added, no cross-package import is added."
    - "Out of scope and left alone: WR-07 (AssignSheet baseline), every other 12.4 review item, REQUIREMENTS.md / ROADMAP.md / VERIFICATION.md / STATE.md (editing them makes the phase verification stale; the orchestrator reports CASE-16 to the developer), any API, migration or i18n change."
  artifacts:
    - path: "apps/web/app/(app)/suporte/SupportInbox.tsx"
      provides: "loadingMoreRef (a boolean useRef) set true right before the load-more server action is awaited and cleared in a finally; refreshPage1 passes holdsOnlyPage1 as pagesRef.current <= 1 && !loadingMoreRef.current"
      contains: "loadingMoreRef"
    - path: "apps/web/app/(app)/suporte/SupportInbox.test.tsx"
      provides: "a nested WR-06 describe inside the WR-01 / T7 block: the repro (red first), a second-refetch pin, and a refused/rejected-page test that proves the mark is cleared"
      contains: "WR-06"
    - path: ".planning/quick/261117-jke-fix-wr-06-supportinbox-a-page-1-refetch-/261117-jke-SUMMARY.md"
      provides: "status: complete; real RED and GREEN output, mutation check result, gate results, commit SHAs, the observations listed in Task 3"
  key_links:
    - from: "SupportInbox.tsx refreshPage1"
      to: "apps/web/lib/chat-view.ts reconcileInboxPage"
      via: "the holdsOnlyPage1 input, now pagesRef.current <= 1 && !loadingMoreRef.current (the pure function is untouched)"
    - from: "SupportInbox.tsx loadMore"
      to: "loadingMoreRef"
      via: "set true as the first statement inside the try, cleared in the finally that every return and the catch pass through"
---

<objective>
Close WR-06 of Phase 12.4 (12.4-REVIEW.md "WR-06", 12.4-VERIFICATION.md gap, CASE-16 caveat): a page-1 refetch that
lands while "load more" is in flight replaces the whole staff inbox list and permanently hides one case the server
still lists. `refreshPage1` decides "the list is the whole view" from `pagesRef.current <= 1`, but `pagesRef` is
incremented only after the load-more answer is appended, so during the round trip it still says one page while the
cursor already belongs to a page that is on its way. The fix treats a read in flight as "more than page 1" (about ten
lines: one ref, one `finally`, one extra condition), with the repro written first as a failing test.

Purpose: UI-D-830 and plan 21 of Phase 12.4 promise "the refetch never drops a row the server still lists"; a realtime
signal during a scroll is the normal case on a busy inbox, and a hidden case is a member waiting on support whom the
staff cannot see until a reload.

Output: one failing-then-passing regression test, the three-line-class fix in `SupportInbox.tsx`, two pins (a second
refetch after the late page, and the in-flight mark cleared after a refused or rejected page), green gates, SUMMARY.

Coverage audit (quick task, no CONTEXT.md decisions, no new requirement ids): GOAL = WR-06 fixed (Tasks 2 and 1);
REQ = none edited here (CASE-16 stays pending in REQUIREMENTS.md; the orchestrator reports it); RESEARCH = none;
CONTEXT = the standing contract UI-D-830 / A-12.4-GAP-DEEP (honoured, rule untouched); Deferred = WR-07 and the other
review items (not planned). Nothing is missing.
</objective>

<repo_rules>
These are the developer's standing rules for this repository. They apply to every task below.

1. Commits carry NO `Co-Authored-By: Claude` trailer and no "Generated with Claude" line (public repo; the developer's standing rule). Author/committer is the repo's local git identity; do not touch git config.
2. Commit with explicit paths: `git commit -m "<msg>" -- <paths>` (never `git add -A` / `git add .`); the working tree holds many unrelated untracked files (`.claude/*`, `.planning/**`). After each commit check `git show --stat HEAD` lists only the intended files.
3. Do not run db:reset / db:seed / the integration suites / Playwright, and do not start dev servers.
4. Verification commands: `pnpm --filter @rede-social/web exec vitest run "app/(app)/suporte/SupportInbox.test.tsx"` (run the file; if it fails, rerun that file alone twice before calling it real, the machine is shared and load can cause flakes), `pnpm exec biome check` on the two touched files, and a web typecheck (`pnpm --filter @rede-social/web typecheck`, which is `next typegen && tsc --noEmit`; NOT `next build`). Also `bash scripts/check-ui-literals.sh` and `pnpm boundaries` (both exist at the repo root; this change adds no strings and no cross-package imports, so they should stay green).
5. If a verification command is unavailable or fails for reasons unrelated to the change, record it in the SUMMARY; never fabricate output.

Extra, from the orchestrator: do NOT commit PLAN.md, SUMMARY.md or STATE.md (the orchestrator commits docs). The scope is the two named files only. The Phase 12.4 gap round is closed, but the working tree is shared with unrelated untracked files, so only ever stage the paths named in a task.
</repo_rules>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.planning/STATE.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/AGENTS.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.planning/phases/12.4-abertura-de-chamado-no-suporte/12.4-REVIEW.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/(app)/suporte/SupportInbox.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/(app)/suporte/SupportInbox.test.tsx

Facts verified against the files while planning (do not re-derive):

- `SupportInbox.tsx`: `pagesRef` is declared at ~212 (`useRef(1)`); `refreshPage1` (~266-304) calls `reconcileInboxPage(itemsRef.current, page.items, { holdsOnlyPage1: pagesRef.current <= 1, hasMore: page.nextCursor !== null })` and, only when the result is `whole`, resets `pagesRef.current = 1` and `setCursor(page.nextCursor)`; `loadMore` (~322-344) is `try { await loadMoreInboxAction(cursor, ...); early return when the view changed; early return + setPageFailed(true) when !page.ok; pagesRef.current += 1; append with id de-duplication; setCursor(page.nextCursor) } catch { console.error; setPageFailed(true) }`.
- `chat-view.ts reconcileInboxPage` (~341-353): `holdsOnlyPage1 || !hasMore || tail === undefined` returns `{ items: fresh, whole: true }`; otherwise it keeps loaded rows that sort strictly after the fresh tail (`sortsBefore(tail, row)`) after the fresh rows and returns `whole: false`. With the fix, the repro goes through the second branch: tail = R2, R3 sorts after R2, so R3 stays: [NEW, R1, R2, R3]; the late page then appends R4 and R5.
- Test file harness: `view()` builds rows whose `lastMessageAt` descends with creation order (R1 newest), so rows created in order R1..R5 are already in server order; a row that must sort FIRST needs an explicit later `lastMessageAt` (the WR-01 block uses `'2026-09-30T18:00:00.000000Z'`). `signal()` and `links()` are consts local to the `describe('WR-01 / T7: ...')` block (~430-538); `inboxAnswer` sets the BFF page-1 answer; `mocks.loadMore` is the server action; the `InfiniteScroll` stub is a `load-more` test-id button that exists only while `hasMore && enabled` (`enabled` is false while the page-error line shows, which is why a refused page needs the "Tentar novamente" button before the next load-more can be clicked).
- `useInfiniteScroll` (packages/ui) lets ONE page be in flight at a time through its own `loadingRef`, and `loadMore` is only called from that sentinel, so a boolean mark has a single writer at a time (no counter needed).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write the WR-06 repro test and see it fail RED against the unfixed component</name>
  <files>apps/web/app/(app)/suporte/SupportInbox.test.tsx</files>
  <read_first>
    - apps/web/app/(app)/suporte/SupportInbox.test.tsx (harness lines 20-170; the WR-01 / T7 block ~430-538, especially "several pages loaded" ~468 and "an answer that ends the view after a failed page" ~493)
    - apps/web/app/(app)/suporte/SupportInbox.tsx (`refreshPage1` ~266, `loadMore` ~322)
    - .planning/phases/12.4-abertura-de-chamado-no-suporte/12.4-REVIEW.md (WR-06, lines ~94-113)
  </read_first>
  <behavior>
    - Test 1 (red now, green after Task 2): list [R1, R2, R3] with cursor 'c1'; the load-more for 'c1' is held open; a fresh page 1 [NEW, R1, R2] (cursor 'cX') lands; the load-more then answers [R4, R5] (cursor 'c2'); the rows are exactly [NEW, R1, R2, R3, R4, R5] and the next load-more is called with 'c2'.
  </behavior>
  <action>
    Before touching anything, record `git rev-parse HEAD` as BASE (it goes in the SUMMARY; Task 3 uses it to prove chat-view.ts was never touched). Obey the repo_rules block above.

    In `apps/web/app/(app)/suporte/SupportInbox.test.tsx` add, INSIDE the existing `describe('WR-01 / T7: a row that left the tab leaves on the next refetch ...')` block, after its last test (`the payload is never read: any payload refetches`) and before that block closes, a NESTED `describe` titled `WR-06: a page-1 refetch that lands while a load-more is in flight drops no row`. Nesting is deliberate: the block-local `signal` and `links` helpers are then in scope, so no new helper is added. Keep the file's existing style (rows from `view({ name })`, `renderInbox`, `rowNames()`, `waitFor`, `act`).

    The one test in it, named `a refetch during a load-more keeps the row between the fresh tail and the old cursor (WR-06)`, does this in order:
    (a) create R1, R2, R3 with `view({ name })` in that order, then R4 and R5; create a NEW row with `view({ name: 'NEW', lastMessageAt: '2026-09-30T18:00:00.000000Z' })` so it sorts before R1 in the server order (same literal the WR-01 block already uses for `newer`);
    (b) `renderInbox({ initialItems: [R1, R2, R3], initialCursor: 'c1' })`;
    (c) hold the load-more open: a local `gates` array of resolvers (`Array<(answer: unknown) => void>`) and `mocks.loadMore.mockImplementationOnce(() => new Promise((resolve) => gates.push(resolve)))`, the same gate style the file already uses for fetches;
    (d) click the `load-more` test-id button, wait until `mocks.loadMore` was called once, and assert its first argument is `'c1'`;
    (e) while it is pending set `inboxAnswer` to a `Response.json` of items [NEW, R1, R2] with `nextCursor: 'cX'`, `await signal()`, and wait with `waitFor(() => expect(rowNames()).toContain('NEW'))` (that condition holds both before and after the fix, so it only proves the refetch landed; do not wait on the exact list here);
    (f) release the held load-more inside `await act(async () => { ... })` with `{ ok: true, items: [R4, R5], nextCursor: 'c2' }`, wait with `waitFor(() => expect(rowNames()).toContain('R4'))` (fails fast with a readable diff instead of a long timeout), then assert `rowNames()` toEqual NEW, R1, R2, R3, R4, R5 in that order;
    (g) assert the cursor pin: `mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null })`, click `load-more` again, wait for a second `mocks.loadMore` call, assert its first argument is `'c2'` (the late page's cursor, not the refetch's `'cX'`). Note for the SUMMARY: this cursor pin passes before AND after the fix (the late page always sets its own cursor); the discriminating assertion is the row list in (f).

    RED run: with the component UNCHANGED run `pnpm --filter @rede-social/web exec vitest run "app/(app)/suporte/SupportInbox.test.tsx" -t "WR-06"`. It MUST fail, and it must fail on the assertion in (f) with the received list [NEW, R1, R2, R4, R5] (R3 missing), the same list the verifier reproduced. A failure for any other reason (a timeout in (d) or (e), a harness error, a typo) means the test is wrong, not the component: fix the test and rerun until it fails for R3 only. Run it twice to show it is deterministic. Paste the real failing lines (test name, expected vs received) into the SUMMARY; never invent counts. Then run `pnpm exec biome check "apps/web/app/(app)/suporte/SupportInbox.test.tsx"` from the repo root (if biome is not resolvable there, use `pnpm --filter @rede-social/web exec biome check "app/(app)/suporte/SupportInbox.test.tsx"`); if it reports only formatting, apply `biome check --write` to that one file and rerun.

    Commit (RED is committed on purpose, the repo's test-then-fix pattern; nothing is pushed): `git commit -m "test(quick-261117-jke): WR-06 repro, a page-1 refetch during a load-more hides a listed row (red)" -- "apps/web/app/(app)/suporte/SupportInbox.test.tsx"`. No Claude trailer. Then `git show --stat HEAD` must list only that file.
  </action>
  <verify>
    <automated>! pnpm --filter @rede-social/web exec vitest run "app/(app)/suporte/SupportInbox.test.tsx" -t "WR-06"</automated>
  </verify>
  <done>The new test exists inside the WR-01 / T7 block, fails twice in a row against the unchanged component on the row-list assertion with R3 missing from [NEW, R1, R2, R4, R5], biome is clean on the file, one path-scoped commit contains only the test file, and the real failing output is kept for the SUMMARY.</done>
</task>

<task type="auto">
  <name>Task 2: Treat a load-more in flight as "more than page 1" (the WR-06 fix)</name>
  <files>apps/web/app/(app)/suporte/SupportInbox.tsx</files>
  <read_first>
    - apps/web/app/(app)/suporte/SupportInbox.tsx (declarations ~202-231, `refreshPage1` ~263-304, `loadMore` ~321-344)
    - apps/web/lib/chat-view.ts lines ~325-353 (read only; `reconcileInboxPage` must not change)
  </read_first>
  <action>
    Obey the repo_rules block above. Edit ONLY `apps/web/app/(app)/suporte/SupportInbox.tsx`; do not touch `apps/web/lib/chat-view.ts`, `reconcileInboxPage`, any catalog, or any other file. Make exactly these three edits (WR-06, UI-D-830):

    1. Next to `pagesRef` (~212) declare `const loadingMoreRef = useRef(false);` with a short doc comment in the file's style: a load-more is in flight, its page is not appended yet so `pagesRef` still counts one page while the cursor already belongs to a page on its way; a refetch that lands now must not read the list as the whole view (WR-06). A boolean is enough because the sentinel keeps one page in flight at a time.
    2. In `refreshPage1`, change the `holdsOnlyPage1` input of `reconcileInboxPage` to `pagesRef.current <= 1 && !loadingMoreRef.current`, and extend the nearby comment by one sentence saying a read in flight counts as "more than page 1" so the refetch takes the not-whole path (deeper rows stay, the cursor is left alone, the late page is appended with the existing id de-duplication).
    3. In `loadMore`, set `loadingMoreRef.current = true` as the FIRST statement inside the existing `try`, immediately before `await loadMoreInboxAction(...)`, and add a `finally` block to the existing `try/catch` that sets it back to `false`, with a one-line comment that every exit (the page appended, the changed-view return, the refused page return, the catch) passes through it. Leave the `if (!cursor) return;` and the `key` read before the `try`, and leave every other line of `loadMore` as it is.

    Verify and write down in the SUMMARY (it is a plan requirement, not optional) that the mark cannot stay stuck true: (a) every path out of the `try` body, including both early returns and the catch, runs the `finally`; (b) the awaited server action always settles (resolve or reject), so the `finally` always runs; (c) a view switch does not need to reset the mark: the old call's `finally` clears it when the old call settles, and until then a refetch on the new view only takes the conservative not-whole path (it keeps rows deeper than the fresh tail and leaves the cursor, never drops a row the server lists, and the next refetch after the old call settles is exact again); (d) the server re-seed block (`seed !== initialItems`) and the view effect deliberately do NOT touch the mark, for the same reason (resetting it there could clear the mark of a newer call while the old one still pends). Do not add resets in those places.

    Decision on the known edge (explicit, per the orchestrator): `reconcileInboxPage` still returns `whole: true` when the fresh answer has `hasMore` false or is empty, even with `holdsOnlyPage1` false. If that lands while a load-more is in flight, the list becomes the fresh page and the cursor null, and the late page is then appended, possibly resurrecting rows that left the view until the next refetch heals it. That does NOT drop a row the server lists, so it is outside WR-06. There is no one-line guard in `SupportInbox.tsx` that avoids it without discarding the late page (an epoch design) and the pure function must not change, so NO guard is added. Record it in the SUMMARY as an observation, not a fix.

    Run: the whole `SupportInbox.test.tsx` file (the WR-06 test must now pass and every existing test must stay green; on a failure rerun the file alone twice before calling it real) and `pnpm exec biome check "apps/web/app/(app)/suporte/SupportInbox.tsx"` (fallback to `pnpm --filter @rede-social/web exec biome check "app/(app)/suporte/SupportInbox.tsx"`; if only formatting is reported, apply `biome check --write` to that one file and rerun). Check `git diff --stat` shows only SupportInbox.tsx changed and the hunk count matches the three edits above.

    Commit: `git commit -m "fix(quick-261117-jke): a page-1 refetch during a load-more keeps every loaded row (WR-06)" -- "apps/web/app/(app)/suporte/SupportInbox.tsx"`. No Claude trailer. Then `git show --stat HEAD` must list only that file.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run "app/(app)/suporte/SupportInbox.test.tsx"</automated>
  </verify>
  <done>The Task 1 repro is green, the whole SupportInbox.test.tsx file passes, biome is clean on the component, the diff touches SupportInbox.tsx only (one ref, one extra condition, one `finally`), chat-view.ts is untouched, and one path-scoped commit holds only the component.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Pin the in-flight mark (cleared after a refused or rejected page), prove the pins have teeth, run the gates, write the SUMMARY</name>
  <files>apps/web/app/(app)/suporte/SupportInbox.test.tsx, apps/web/app/(app)/suporte/SupportInbox.tsx</files>
  <read_first>
    - apps/web/app/(app)/suporte/SupportInbox.test.tsx (the WR-06 describe added in Task 1; "a failed page keeps its rows and shows the inline retry line" ~649)
    - apps/web/app/(app)/suporte/SupportInbox.tsx (the fix from Task 2)
  </read_first>
  <behavior>
    - Test 2: after the late page lands (list [NEW, R1, R2, R3, R4, R5], cursor 'c2'), a SECOND refetch [NEW, R1, R3] (cursor 'cY') drops R2 (it left the window), keeps the deeper R4 and R5, and leaves the cursor, so the next load-more is called with 'c2' (the WR-01 removal still works after the WR-06 fix).
    - Test 3 (two cases, a refused page `{ ok: false }` and a rejected call): after the load-more fails, `pagesRef` is still 1, so a refetch [R1, R2] with cursor 'c9' is the WHOLE view again: the list is exactly [R1, R2] (R3 is gone) and the next load-more is called with 'c9'.
  </behavior>
  <action>
    Obey the repo_rules block above. Add the two tests inside the nested WR-06 describe from Task 1 (after the repro). No new helper; reuse `signal`, `rowNames`, `inboxAnswer`, `mocks.loadMore`, `gates` style.

    Test 2, named `a second refetch after the late page still drops a row that left its window and leaves the cursor (WR-01 still holds)`: repeat the Task 1 setup compactly (R1 to R5 and NEW built the same way, load-more held open and answered with [R4, R5] and cursor 'c2' after the first refetch [NEW, R1, R2] landed; wait until `rowNames()` contains 'R4'). Then set `inboxAnswer` to [NEW, R1, R3] with `nextCursor: 'cY'`, `await signal()` and wait for `rowNames()` to equal NEW, R1, R3, R4, R5; then click `load-more` with `mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null })` and assert the call's first argument is `'c2'`. Be honest in the test comment: after a successful append `pagesRef` is 2, so this is a regression pin for the WR-01 behaviour, NOT the proof that the mark is cleared.

    Test 3, a table of two cases through `it.each` (case names: `a refused page` answering `{ ok: false }` through a resolved promise, and `a rejected call` through a rejected promise created at call time inside `mockImplementationOnce`), titled so the case name shows, e.g. `%s clears the in-flight mark: the next refetch is the whole view again (WR-06)`. This is the real proof the mark is cleared, because on these exits `pagesRef` stays at 1 and only the mark could keep a refetch from being the whole view. Body: `const spy = vi.spyOn(console, 'error').mockImplementation(() => {})` (the catch logs) with the rest inside `try { ... } finally { spy.mockRestore(); }`; render [R1, R2, R3] with cursor 'c1'; `mocks.loadMore.mockImplementationOnce(<the case>)`; click `load-more`; wait for `[data-inbox-page-error]` to exist (the file already queries it that way); set `inboxAnswer` to [R1, R2] with `nextCursor: 'c9'`, `await signal()`, wait for `rowNames()` toEqual R1, R2 (with the mark stuck true R3 would be kept as a "deeper" row, so this is the discriminating assertion); then click the "Tentar novamente" button inside `[data-inbox-page-error]` (the page-error line stays because a whole answer with a cursor does not clear it, and the sentinel is disabled until it is dismissed), `mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null })`, click `load-more`, wait for the second `mocks.loadMore` call and assert its first argument is `'c9'`.

    Run the file; both new tests pass against the Task 2 fix (they are non-regression pins, so they are green now and are not expected to be red before the fix; say so in the SUMMARY).

    Mutation check (proves test 3 has teeth), on the WORKING TREE only and never committed: in `SupportInbox.tsx` temporarily remove the reset inside the `finally` of `loadMore` (comment out the line that sets the mark back to false), run `-t "WR-06"`, and confirm the two test-3 cases FAIL on the `[R1, R2]` assertion (received [R1, R2, R3]) while the repro and test 2 stay green. Paste the real result in the SUMMARY. Then restore the line with Edit (not `git checkout`) and confirm `git diff --stat -- "apps/web/app/(app)/suporte/SupportInbox.tsx"` prints nothing, so the component equals the Task 2 commit. If the mutation does NOT make test 3 fail, the test is wrong: fix it before committing.

    Gates (repo_rules item 4): the whole `SupportInbox.test.tsx` file (rerun alone twice if red); `pnpm exec biome check` on the two touched files (same fallback as before; `--write` only for formatting, on those two files); `pnpm --filter @rede-social/web typecheck`; `bash scripts/check-ui-literals.sh`; `TURBO_CACHE=local:r pnpm boundaries` (the local-read-only cache keeps turbo from filling the disk on this machine). Record each command with its real exit status and last lines; a command that is unavailable or fails for an unrelated reason is recorded as such, never replaced by invented output. Also run `git diff --quiet BASE HEAD -- apps/web/lib/chat-view.ts` with the BASE recorded in Task 1 and note exit 0 in the SUMMARY.

    Commit the tests: `git commit -m "test(quick-261117-jke): WR-06 pins, a second refetch and the in-flight mark cleared after a refused or rejected page" -- "apps/web/app/(app)/suporte/SupportInbox.test.tsx"`. No Claude trailer. Then `git show --stat HEAD` must list only the test file, and `git status --short -- "apps/web/app/(app)/suporte/"` must be empty.

    Write the SUMMARY at `.planning/quick/261117-jke-fix-wr-06-supportinbox-a-page-1-refetch-/261117-jke-SUMMARY.md` with `status: complete` in the frontmatter (follow the summary template), and do NOT commit it, PLAN.md or STATE.md. It must contain: BASE and the three commit SHAs; the real RED output (Task 1), the real GREEN counts for the file (Task 2 and Task 3); the mutation-check result; every gate with its exit status; the stuck-mark verification (a to d from Task 2); and these observations, each as an observation and NOT a fix: (1) the known whole-answer edge (`hasMore` false or an empty fresh page while a load-more is in flight can resurrect rows that left the view until the next refetch; decision: out of scope, no guard); (2) the cursor assertion in the repro and test 2 is a pin that also holds before the fix, the discriminating assertion is the row list; (3) test 2 cannot prove the mark is cleared because `pagesRef` is 2 after a successful append, the refused/rejected cases of test 3 do; (4) possible, UNVERIFIED and pre-existing, a different trigger than WR-06: a server re-seed (`router.refresh()` changing `initialItems`) while a load-more is pending on the default view looks like it would append the late page, read from the pre-seed cursor, to the re-seeded list and replace the cursor, because the view guards in `loadMore` pass on the default view; not touched here, offer it to the developer as a separate item if wanted; (5) the orchestrator should report CASE-16 as ready to flip to complete (no REQUIREMENTS.md edit was made).
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run "app/(app)/suporte/SupportInbox.test.tsx" && pnpm exec biome check "apps/web/app/(app)/suporte/SupportInbox.tsx" "apps/web/app/(app)/suporte/SupportInbox.test.tsx" && pnpm --filter @rede-social/web typecheck && bash scripts/check-ui-literals.sh</automated>
  </verify>
  <done>Tests 2 and 3 (two cases) exist and pass, the mutation check showed both test-3 cases fail without the reset and the component was restored byte for byte to the Task 2 commit, the whole test file, biome, web typecheck, check-ui-literals and boundaries are green or honestly recorded, chat-view.ts is unchanged since BASE, three path-scoped commits exist (test red, fix, pins) with no Claude trailer, the shared working tree has no leftover change under apps/web/app/(app)/suporte, and the SUMMARY (status: complete, uncommitted) holds the real evidence and the five observations.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser list state | Client-only React state of the staff inbox; no new input, no new endpoint, no new data crosses a boundary. The BFF `GET /api/chat/inbox` and the `loadMoreInboxAction` server action are called exactly as before. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261117-jke-01 | Denial of Service | SupportInbox `refreshPage1` against `loadMore` | medium | mitigate | A case a member waits on must not be hidden from staff: the in-flight mark makes a refetch during a load-more take the not-whole path; the repro test fails before and passes after (Tasks 1 and 2). |
| T-261117-jke-02 | Denial of Service | `loadingMoreRef` stuck true | low | mitigate | Cleared in a `finally` that every exit passes through; the refused and rejected cases of test 3 plus the mutation check prove it (Task 3). A stuck mark would only make refetches conservative, never drop a row. |
| T-261117-jke-03 | Information Disclosure | list shows rows of another view or tenant | low | accept | Unchanged: the view guards in `loadMore` and `refreshPage1` and the server-side tenant scoping are not modified; the fix adds a boolean only. |
| T-261117-jke-04 | Tampering | whole-answer edge can resurrect a row that left the view until the next refetch | low | accept | Does not hide a listed row; heals on the next refetch; recorded as an observation in the SUMMARY, out of scope (reconcileInboxPage must not change). |
</threat_model>

<verification>
- `pnpm --filter @rede-social/web exec vitest run "app/(app)/suporte/SupportInbox.test.tsx"` is green after Task 2 and again after Task 3; before Task 2 the WR-06 repro was red on the row list only.
- `git log --oneline -3` shows the three commits (test red, fix, pins), each `git show --stat HEAD` listing one file, none with a Claude trailer.
- `git diff --quiet BASE HEAD -- apps/web/lib/chat-view.ts` exits 0 (the pure rule is untouched).
- biome on the two files, `pnpm --filter @rede-social/web typecheck`, `bash scripts/check-ui-literals.sh` and `pnpm boundaries` pass or are recorded as unavailable for an unrelated reason.
</verification>

<success_criteria>
WR-06 is closed in code and test: the verifier's repro (R3 missing from [NEW, R1, R2, R4, R5]) is a committed regression test that went red on the unfixed component and is green on the fixed one; a refetch during a load-more keeps every loaded row and leaves the late page's cursor; the in-flight mark is proven cleared on a refused and on a rejected page; no other file changed; the SUMMARY carries the real evidence and the observations for the orchestrator.
</success_criteria>

<output>
Create `.planning/quick/261117-jke-fix-wr-06-supportinbox-a-page-1-refetch-/261117-jke-SUMMARY.md` when done (status: complete; not committed by the executor).
</output>
