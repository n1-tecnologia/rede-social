---
phase: quick-261001-ere
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
  - apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx
  - apps/web/e2e/notifications.spec.ts
  - apps/web/e2e/feed-admin.ts
  - apps/web/e2e/feed.spec.ts
  - .planning/phases/07-notifications-web-push-chat/deferred-items.md
  - .planning/WINDOWS.md
autonomous: true
requirements: [NOTIF-02, FEED-02]
tags: [gap-closure, notifications, mark-all, keepalive, vitest, happy-dom, playwright, e2e-fixtures, UI-D-252, UI-D-20]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "While POST /api/notifications/read-all runs, the 'Marcar todas como lidas' control stays mounted with aria-busy='true' and disabled, and a click on it starts no second POST (UI-D-252, UI E04 loading; closes WINDOWS 66 and 07-VERIFICATION truth 12)"
    - "When read-all answers 2xx the control disappears and every loaded row stays untinted; when it fails, the tint comes back only on rows the mark-all alone cleared and the control returns idle (aria-busy absent, enabled) with one catalog error toast (UI-D-252, UI E04 error and empty, D-230)"
    - "A row tapped while a mark-all is in flight, that the server may still hold unread (server-unread and cleared only by that mark-all's optimistic step), sends its own keepalive POST /api/notifications/{id}/read; a row tapped before the mark-all is not posted again; a second tap during the same mark-all sends nothing new (closes WINDOWS 67 and 07-VERIFICATION truth 17)"
    - "The read-all POST is sent with keepalive: true and is still awaited, so a reload or app close right after the tap cannot abort it, and its answer still drives the busy state and the rollback (Decision A, recorded in the code comment and the SUMMARY)"
    - "NotificationsSurface.test.tsx holds no expected-failure case; all 5 cases are plain and green; case 2 asserts the control is present, disabled and aria-busy during the POST and asserts the read POST for row b (review WR-04, IN-03); the three edited cases fail against the pre-fix component at 583619c"
    - "notifications.spec.ts 'mark-all clears every tint and the control disappears' waits for the read-all response (204) before page.reload(), and the whole notifications.spec.ts passes on mobile-chromium and desktop-chromium (closes WINDOWS 68)"
    - "feed.spec.ts 'UI-D-20 — a community with nothing published' provisions its empty tenant under a slug unique per project, per run and per repeat, and feed.spec.ts passes with --repeat-each=3 on mobile-chromium and desktop-chromium (closes 07-VERIFICATION truth 20)"
    - "UI-D-252's wording is unchanged (Decision B); WINDOWS 66/67/68 are marked fixed and three deferred-items entries resolved only with run evidence; the umbrella 07-15 exit-gate entry and truth 15 stay open"
  artifacts:
    - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx"
      provides: "mark-all control mounted while markingAll; in-flight mark-all ref (added + tapped); activate posts for a server-unread row cleared only by the in-flight mark-all; read-all fetch with keepalive"
      contains: "markingAll"
    - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx"
      provides: "5 plain cases: stale page, tapped (tightened), live merge, E04 loading, own read POST"
      contains: "E04 loading"
    - path: "apps/web/e2e/notifications.spec.ts"
      provides: "mark-all case waits for the read-all response before the reload"
      contains: "/api/notifications/read-all"
    - path: "apps/web/e2e/feed-admin.ts"
      provides: "emptyFeedSlug(project, run, repeat) and deleteStaleEmptyFeedTenants(project)"
      contains: "deleteStaleEmptyFeedTenants"
    - path: "apps/web/e2e/feed.spec.ts"
      provides: "UI-D-20 beforeAll sweeps stale tenants and provisions a per-run, per-repeat slug"
      contains: "repeatEachIndex"
  key_links:
    - from: "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx (markAll)"
      to: "apps/web/app/api/notifications/read-all/route.ts (gatedMark, 204)"
      via: "fetch('/api/notifications/read-all', { method: 'POST', keepalive: true })"
      pattern: "read-all"
    - from: "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx (activate)"
      to: "apps/web/app/api/notifications/[notificationId]/read"
      via: "keepalive POST when the row looks unread OR is server-unread and cleared only by the in-flight mark-all"
      pattern: "encodeURIComponent\\(view\\.id\\)"
    - from: "NotificationsSurface markAll JSX"
      to: "@rede-social/ui Button loading (disabled + aria-busy)"
      via: "control rendered while anyUnread or markingAll, loading={markingAll}"
      pattern: "loading=\\{markingAll\\}"
    - from: "apps/web/e2e/feed.spec.ts (UI-D-20 beforeAll)"
      to: "apps/web/e2e/feed-admin.ts emptyFeedSlug"
      via: "emptyFeedSlug(testInfo.project.name, RUN, testInfo.repeatEachIndex)"
      pattern: "repeatEachIndex"
---

<objective>
Close the Phase 7 leftovers from the 07-15 gate run and the 07-VERIFICATION re-verification: truths 12, 17 and 20, and the notifications red of truth 15 (`notifications.spec.ts:228`).

1. NOTIF-02 / WINDOWS 66 + 67 in `NotificationsSurface.tsx`: the mark-all control stays mounted, busy and disabled for its whole POST; a row tapped during a mark-all sends its own read POST when the server may still hold it unread; the untrue comment above `markAll` is rewritten; the read-all fetch gets `keepalive` (Decision A). The two expected-failure unit cases become plain cases and case 2 is tightened per review WR-04 / IN-03.
2. `notifications.spec.ts:228` (WINDOWS 68): wait for the POST /api/notifications/read-all response before the reload.
3. `feed.spec.ts` UI-D-20: a tenant slug and host unique per run and per repeat, so `--repeat-each=3` passes.

Purpose: NOTIF-02's mark-as-read keeps its UI-SPEC contract (UI-D-252, D-230), the server state matches what the member sees after a failed mark-all, and two e2e cases stop depending on timing or on a 60 s host cache.

Output: one product fix, one tightened unit file, two e2e edits plus one fixture helper, and ledger updates backed by targeted run evidence.

## Recorded decisions (this quick task)

- **Decision A (keepalive on read-all): YES.** The read-all fetch is sent with `keepalive: true`, like the row reads. The member's tap has already cleared every tint on screen, so a reload, pull-to-refresh or PWA close right after it must not silently drop the mark. The 07-15 trace shows exactly that loss (status -1, reload 44 ms later). The request has no body, so the 64 KiB keepalive budget does not matter. The response is still awaited, because it drives the busy state and the rollback. The same-origin gate in `gatedMark` is unchanged; the row reads already pass it with keepalive. The e2e wait (item 2) is still needed: keepalive keeps the POST alive, but it does not order the server write before the reload's GET.
- **Decision B (UI-D-252 wording): UNCHANGED.** UI-D-252 already says the button is "`aria-busy` and disabled while the POST runs" and that "On success the button disappears". During the POST the rows are still unread on the server and only cleared on screen, so "rendered only while at least one loaded row is unread" is read as server-unread for that window. The fix keeps the control mounted while `markingAll` and implements the spec as written. The deferred-items note that UI-D-252 "contradicts itself" is answered by this reading. `07-UI-SPEC.md` is NOT edited.
- **Decision C (tapped-row rule): post, do not roll back.** Of the two fixes 07-VERIFICATION offers, this one sends the tapped row's own read. It is the premise C-WR-03's scoped rollback was written on, and the member's tap is an explicit read. A row is posted during a mark-all only when `view.unread` is true, the in-flight mark-all's optimistic step cleared it, and it has not been tapped yet during that mark-all.
- **Decision D (ledger scope).** WINDOWS 66 and 67 are marked fixed on the unit evidence. WINDOWS 68 (`notifications.spec.ts:228`, kind unrun-verify) is also marked fixed, on the targeted `notifications.spec.ts` run passing on both projects (precedent: WINDOWS 61 was closed by a targeted run). Truth 15 (`pnpm verify` exits 0), the umbrella "07-15 exit gate run" deferred entry and WINDOWS 69-71 stay open: the full gate is out of scope here.
- **Decision E (UI-D-20 slug).** The slug is `feed-empty-<project>-<run>-r<repeat>`, where run is a module-level `Date.now().toString(36)`, the reels/phase4/phase5 precedent. A per-project sweep of stale `feed-empty-<project>` tenants keeps the old delete-before-create hygiene that a unique slug would otherwise lose.

## Repo rules the executor must follow (all tasks)

- Prefix every pnpm command with `TURBO_CACHE=local:r`. No `pnpm db:reset`, no `pnpm db:seed`, no full `pnpm verify`, no `pnpm e2e` without a spec filter.
- Never read, print or edit any `.env*` file. Never run `scripts/local-env.sh --write`. The e2e fixtures read their env at runtime; leave that alone.
- Commits: stage by explicit path only (never `git add -A` or `.`). No Claude co-author trailer: this is a public repo and the user's rule overrides the default attribution. Never write the two forbidden legacy names (the old workspace name and the old health-product name) anywhere. Commit subjects use the `fix|test|docs(quick-261001-ere): …` prefix.
- Ports 3000/3100/8787/8788 must be free before each Playwright run and free again after it. Playwright's own webServers start and stop the API and web. If a port is busy before a run with a process this task did not start, do not kill it: halt and report. If one is left listening after a run by the server that run started, stop exactly that PID.
- Run only one Playwright run at a time. A run longer than about 9 minutes goes to the background with its output in the scratchpad, and you poll it.
- Never loosen, skip or retry-until-green an assertion. UI text stays pt-BR and comes from the existing catalog. No new catalog key.
- WINDOWS changes go only through `node .claude/gsd-core/bin/gsd-tools.cjs windows fixed <id>` (never edit WINDOWS.md by hand). gsd-tools JSON output can carry invalid backslash escapes, so repair them before any JSON.parse.
- Do not edit STATE.md, ROADMAP.md, 07-VERIFICATION.md or 07-UI-SPEC.md. The quick workflow and the next re-verification own them.
</objective>

<execution_context>
@.claude/gsd-core/workflows/execute-plan.md
@.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
@apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx
@.planning/phases/07-notifications-web-push-chat/deferred-items.md

Live observations at planning time (HEAD 81e1c5e; `NotificationsSurface.tsx` was last changed in 583619c and is byte-identical at HEAD):
- `NotificationsSurface.tsx:366-387` renders the control only while `anyUnread`, with `loading={markingAll}`. `@rede-social/ui` Button (`packages/ui/src/primitives/Button.tsx:52-53`) turns `loading` into `disabled` plus `aria-busy="true"` and keeps the label.
- `NotificationsSurface.tsx:203-219`: the `tappedDuringMarkAll` ref; `activate` posts only while `isUnread(view)`. Lines 221-250: `markAll`; line 234 is a plain read-all fetch with no keepalive; lines 222-223 hold the untrue comment.
- `NotificationsSurface.test.tsx`: cases 1-3 in the first describe (lines 205-358). Case 2 has the permissive disjunction at line 288 and asserts row b stays read with no b POST at lines 290-304. The second describe (lines 360-396) holds the two expected-failure cases `gap E04 loading` and `gap own read POST`. Harness: `fetchMock` answers 200 for everything except a parked `net.readAll`; `deferred()`, `flush()`, `row()`, `tn`.
- `apps/web/lib/notifications-bff.ts` `gatedMark` answers `204` on success (line 83).
- `apps/web/e2e/notifications.spec.ts:228-245`: the mark-all case clicks, checks tints, checks `toHaveCount(0)`, then reloads with no network wait. Line 178 is the `waitForResponse` precedent (POST /seen). Line 209 is the `waitForRequest` precedent for a keepalive POST.
- `apps/web/e2e/feed.spec.ts:568-617`: the UI-D-20 describe calls `createEmptyFeedTenant(emptyFeedSlug(testInfo.project.name), SEED_PASSWORD)` in `beforeAll`. `emptyFeedSlug` (`apps/web/e2e/feed-admin.ts:57-60`) is imported only by `feed.spec.ts`. `createThrowawayTenant` validates `^[a-z0-9-]{3,40}$` and throws (`apps/web/e2e/tenant-fixtures.ts:14,53`).
- `playwright.config.ts`: `workers: 1`, `retries: 0`. `pixel-chromium` matches only branding and phase2-smoke, so these specs run on `mobile-chromium` and `desktop-chromium`.
- Nothing was listening on 3000/3100/8787/8788 at planning time.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Mark-all lifecycle end to end, covering the busy control, the tapped row's own read POST, keepalive read-all and the e2e response wait (WINDOWS 66, 67, 68)</name>
  <files>apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx, apps/web/app/(app)/notificacoes/NotificationsSurface.tsx, apps/web/e2e/notifications.spec.ts, .planning/phases/07-notifications-web-push-chat/deferred-items.md, .planning/WINDOWS.md</files>
  <precondition>The local Supabase stack is running (Postgres answers on 127.0.0.1:54322), and nothing listens on ports 3000, 3100, 8787 or 8788 before the Playwright run.</precondition>
  <read_first>
    - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx (whole file, 423 lines)
    - apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx (whole file, 396 lines)
    - apps/web/e2e/notifications.spec.ts lines 170-245 (the /seen response-wait precedent, the keepalive request-wait precedent, the mark-all case)
    - packages/ui/src/primitives/Button.tsx lines 38-75 (loading gives disabled plus aria-busy)
    - apps/web/lib/notifications-bff.ts lines 1-25 and 66-92 (gates; 204 on success)
    - .planning/phases/07-notifications-web-push-chat/07-UI-SPEC.md line 31 (UI-D-252) and lines 465-467 (E04 loading/error/empty)
    - .planning/phases/07-notifications-web-push-chat/07-REVIEW.md lines 94-123 (WR-04, IN-02, IN-03)
    - .planning/phases/07-notifications-web-push-chat/deferred-items.md lines 48-63
  </read_first>
  <action>
Work in this order: tests first (red), then the product fix, then the e2e wait, then the gates, the commit, the red check against the pre-fix component, and last the ledger.

A. Unit tests in NotificationsSurface.test.tsx. Write these first, run them, and record the red result before you touch the component.
- Case 2 (title prefix `2. tapped:`). Keep its setup.
  - After the mark-all click, assert the read-all fetch was called with method POST and keepalive true. This pins Decision A.
  - Replace the permissive disjunction that accepts a withdrawn control (review IN-03) with a strict read. Get the control with `screen.getByTestId('notifications-mark-all')`, which throws when the control is absent. Assert `disabled` is true and `aria-busy` is the string "true". Then fireEvent.click it and assert the read-all URL was fetched exactly once, so no second POST can start while it runs.
  - After `b` is tapped during the mark-all, assert fetchMock was called with '/api/notifications/b/read' and an object containing method POST and keepalive true. Count the calls whose first argument is that URL and assert exactly one (review WR-04: the case now asserts the POST that backs "b stays read").
  - After the 500, keep the three tint assertions (a and b read, c unread again). Add two assertions: no call ever went to '/api/notifications/c/read', and exactly one call went to '/api/notifications/a/read' (a row tapped before the mark-all is not posted again).
  - Rewrite the comment above the old disjunction so it describes the busy control. It must not mention a gap.
  - Retitle the case: rows tapped before or during the mark-all sent their own read POST and stay read. Keep the `2. tapped:` prefix and the D-230 / UI E04 error / "no second POST while it runs" citations, and add "UI E04 loading".
- The second describe.
  - Rename it to `NotificationsSurface — mark-all lifecycle (UI-D-252, WINDOWS 66/67)`.
  - Rewrite its doc comment: 07-14 found these two behaviours and quick 261001-ere fixed them. It must not name the expected-failure API or call them expected failures.
  - Turn both expected-failure cases into plain `it` cases:
    - `E04 loading: the mark-all button stays mounted, aria-busy and disabled while its POST runs, and leaves on success (UI-D-252)`. Keep a handle on the deferred read-all and keep the two planned assertions unchanged (aria-busy "true", disabled true). Then resolve the deferred with `new Response(null, { status: 204 })` inside act and `flush()`. Assert `screen.queryByTestId('notifications-mark-all')` is null, every row has data-unread "false", and no status toast carries `tn('errors.markAll')`.
    - `own read POST: a row tapped while a mark-all is in flight sends its own keepalive read POST (the premise of the scoped rollback)`. Keep its assertion unchanged, and add that no call went to '/api/notifications/c/read'.
- Do not touch cases 1 and 3, the harness (mocks, `fetchMock`, `net`, `deferred`, `flush`, `row`, `rowIds`, `renderSurface`), or any other existing assertion.
- Run the file. Against the unchanged component, the three edited cases must fail and cases 1 and 3 must pass. Quote Vitest's real summary line in the SUMMARY. This task is not tdd-gated, so no TAP normalizer is needed, and no counts may be invented.

B. Product fix in NotificationsSurface.tsx. This implements UI-D-252 and D-230, plus Decisions A, B and C.
- Mark-all render: show the control while any loaded row looks unread OR while `markingAll` is true. The existing `loading={markingAll}` then gives aria-busy plus disabled through the shipped Button. Leave variant, size, data-testid, className, onClick and the `t('markAll')` label unchanged.
- Replace the `tappedDuringMarkAll` ref with ONE ref for the in-flight mark-all. It is null when no mark-all is running. Otherwise it holds two id sets: `added` (the ids that mark-all's optimistic step cleared, today's `added` array) and `tapped` (ids activated since it started).
  - markAll sets the ref where `tappedDuringMarkAll` is set today, before `setLocallyRead(everything)`. It nulls the ref where today's code reads and clears it, after the POST settles and before the rollback.
  - The rollback still removes from locallyRead only the ids in `added` that are not in `tapped`.
- activate sends the keepalive read POST in two cases:
  - The row looks unread (today's rule).
  - A mark-all is in flight, `view.unread` is true, the id is in that mark-all's `added`, and the id is not yet in its `tapped`. Check this before adding the id to `tapped`.
  - In either case the POST stays fire-and-forget, with `keepalive: true`, `encodeURIComponent(view.id)` and the swallowed catch. Leave the locallyRead update and the removed-row info toast unchanged. Keep the useCallback dependency list correct; the ref needs no entry.
- Add keepalive true to the read-all fetch (Decision A) and keep awaiting it.
- Comments:
  - Replace the untrue parenthetical at lines 222-223 with a true statement: a failure takes back only what the optimistic step cleared and keeps any row tapped meanwhile, because that tap sent its own keepalive read POST (activate posts for a row the in-flight mark-all cleared while the server may still hold it unread).
  - Add one comment line for keepalive on read-all: the tap already cleared every tint, so a reload or close right after it must not lose the mark (07-15 gate trace), and the request has no body.
  - Update the component JSDoc bullets "Read on tap" and "Mark all" to match: the control is visible for the whole of its own POST, aria-busy and disabled, and read-all is sent with keepalive.
- No UI copy change, no new catalog key, no literal UI text. Run the unit file: 5 passed, 0 failed.

C. E2E wait in notifications.spec.ts, case `mark-all clears every tint and the control disappears` at line 228.
- Before the click, arm `page.waitForResponse` for a POST whose URL ends with '/api/notifications/read-all' (the /seen precedent at line 178).
- After the click and the existing per-row tint assertions, await that response and assert status 204.
- Keep the existing toHaveCount(0) on the control. With the fix it also waits for the POST to answer. Then the reload follows.
- Keep the title, the inserted rows and every existing assertion.
- Contingency: Chromium may never report the response of a keepalive request to Playwright. You see this as the response wait timing out while the control still disappears. In that case keep keepalive and arm `page.waitForRequest` for the same URL and method instead (the line 209 precedent shows keepalive requests are observed). Then rely on the toHaveCount(0), which the fixed component reaches only after a 2xx answer, as the response wait. Record in the SUMMARY which path was used, with the evidence.

D. Gates, commit, red check. Run every command from the repo root.
- Typecheck, lint and the UI-literal check.
- Port check, then notifications.spec.ts on both projects, then the port check again.
- Commit the three code files by explicit path, with the subject `fix(quick-261001-ere): keep mark-all busy for its POST, post a tapped row's own read, wait for read-all in e2e`.
- First prove the three name filters each match tests and pass at HEAD. Then check out the component at 583619c (the pre-fix version), run each filter, and expect each to fail. Restore from HEAD and assert `git diff --quiet` (the 07-14 red-evidence precedent).

E. Ledger. Do this only after every step in D is green.
- Run `node .claude/gsd-core/bin/gsd-tools.cjs windows fixed 66`, then 67, then 68 (Decision D).
- In deferred-items.md, edit two entries: the entry "Mark-all's busy state is unreachable, and a row tapped during a mark-all sends no read POST" and the entry for `notifications.spec.ts:228` mobile.
  - Change `status: open` to `status: resolved` on each.
  - Add one resolution line to each, naming quick 261001-ere, the fix commit's short SHA and the real counts: unit 5/5, the red check, and notifications.spec.ts passed/skipped per project.
  - On the :228 entry, also record Decision A (keepalive yes) and which e2e wait path was used.
- Leave the umbrella "07-15 exit gate run" entry and every other entry untouched.
- Commit `.planning/phases/07-notifications-web-push-chat/deferred-items.md` and `.planning/WINDOWS.md` by explicit path, with the subject `docs(quick-261001-ere): close WINDOWS 66-68 and the mark-all deferred entries on targeted evidence`.
- If any case in notifications.spec.ts other than the mark-all case fails, do not fix or loosen it here. Record it (name, project, trace path) in the SUMMARY and as a new open deferred-items entry. Mark 68 fixed only if the mark-all case passed on both projects. Report the task as not done if the file is not green.
  </action>
  <verify>
    <automated>TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run "app/(app)/notificacoes/NotificationsSurface.test.tsx"</automated>
    <automated>! grep -q 'it\.fails' "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx" &amp;&amp; ! grep -q 'during === null' "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx" &amp;&amp; ! grep -q 'really marked it read' "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx" &amp;&amp; test "$(grep -vE '^[[:space:]]*(//|\*)' "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx" | grep -c 'keepalive: true')" -ge 2</automated>
    <automated>TURBO_CACHE=local:r pnpm --filter @rede-social/web typecheck &amp;&amp; TURBO_CACHE=local:r pnpm --filter @rede-social/web lint &amp;&amp; bash scripts/check-ui-literals.sh</automated>
    <automated>! lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8787 -iTCP:8788 -sTCP:LISTEN &amp;&amp; VIDEO_PROVIDER=fake TURBO_CACHE=local:r pnpm --filter @rede-social/web exec playwright test notifications.spec.ts --project=mobile-chromium --project=desktop-chromium; r=$?; ! lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8787 -iTCP:8788 -sTCP:LISTEN &amp;&amp; test "$r" -eq 0</automated>
    <automated>t='app/(app)/notificacoes/NotificationsSurface.test.tsx'; f='apps/web/app/(app)/notificacoes/NotificationsSurface.tsx'; for n in 'tapped' 'E04 loading' 'own read POST'; do TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run "$t" -t "$n" || exit 1; done; git checkout 583619c -- "$f" &amp;&amp; { bad=0; for n in 'tapped' 'E04 loading' 'own read POST'; do TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run "$t" -t "$n" &amp;&amp; bad=1; done; git checkout HEAD -- "$f"; git diff --quiet HEAD -- "$f" &amp;&amp; test "$bad" -eq 0; }</automated>
    <automated>for i in 66 67 68; do grep -qE "^\| $i \|.*\| fixed \|" .planning/WINDOWS.md || exit 1; done; for i in 69 70 71; do grep -qE "^\| $i \|.*\| open \|" .planning/WINDOWS.md || exit 1; done</automated>
  </verify>
  <done>
    - The unit file reports 5 passed, 0 failed, with no expected-failure case left. Case 2 asserts that during the POST the control is present, disabled and aria-busy="true", that a click on it starts no second POST, that b has exactly one keepalive read POST, that c has none, and that a has exactly one.
    - With the 583619c component, the filters `tapped`, `E04 loading` and `own read POST` each fail. At HEAD each passes. The working tree is clean afterwards.
    - NotificationsSurface.tsx renders the control while `anyUnread || markingAll` and sends read-all with keepalive (2 non-comment `keepalive: true` hits). The untrue comment is gone, and the JSDoc matches the behaviour.
    - notifications.spec.ts passes on mobile-chromium and desktop-chromium. The mark-all case waits for the read-all response (204) before reloading, or uses the documented contingency, which the SUMMARY records. Ports 3000/3100/8787/8788 are free afterwards.
    - WINDOWS 66, 67 and 68 read `fixed`. The two deferred-items entries read `status: resolved` with counts. The umbrella 07-15 entry and WINDOWS 69-71 are still open.
    - Two commits: the fix commit and the ledger commit, both staged by explicit path, with no co-author trailer.
  </done>
</task>

<task type="auto">
  <name>Task 2: UI-D-20 empty tenant gets a slug and host unique per run and per repeat, so feed.spec.ts passes with --repeat-each=3 (truth 20)</name>
  <files>apps/web/e2e/feed-admin.ts, apps/web/e2e/feed.spec.ts, .planning/phases/07-notifications-web-push-chat/deferred-items.md</files>
  <precondition>Task 1 is committed. The local Supabase stack is running, and nothing listens on ports 3000, 3100, 8787 or 8788.</precondition>
  <read_first>
    - apps/web/e2e/feed-admin.ts (whole file, about 135 lines: sql(), emptyFeedSlug, createEmptyFeedTenant, deleteEmptyFeedTenant)
    - apps/web/e2e/feed.spec.ts lines 1-25 (imports) and 568-617 (the UI-D-20 describe)
    - apps/web/e2e/tenant-fixtures.ts lines 14, 52-60 and 116-123 (slug regex, createThrowawayTenant, deleteTenantBySlug)
    - apps/web/e2e/reels.spec.ts lines 73 and 198-202 (the per-run slug precedent)
    - .planning/phases/07-notifications-web-push-chat/deferred-items.md lines 37-41
  </read_first>
  <action>
Decision E: the empty tenant's slug and host are unique per project, per run and per repeat. The web proxy and the API cache a host lookup for up to 60 s, so recreating the same host resolves it to the deleted tenant and the member lands on "Endereço incorreto" (deferred-items, 07-13 note).

- In feed-admin.ts:
  - Change `emptyFeedSlug` to take the project name, a run token and a repeat index. It returns `feed-empty-` + the project name lower-cased with non-alphanumerics stripped (today's rule) + `-` + the run token + `-r` + the repeat index. With an 8-character base-36 run token, the longest project name gives 38 characters, under the 40-character slug limit.
  - Do not slice the result. Slicing could silently drop the repeat index, and `createThrowawayTenant` already throws loudly on an invalid slug.
  - Rewrite its doc comment to give the reason above. Keep the old point that the two projects never share a host.
  - Add an exported `deleteStaleEmptyFeedTenants(project)`. It selects `public.tenants.slug` values that equal the legacy per-project slug `feed-empty-<project>` or start with `feed-empty-<project>-`, and runs `deleteEmptyFeedTenant` on each, so the GoTrue users go too.
  - Build the query with the module's postgres.js tagged template and bound parameters, never by concatenating into SQL text. The project part is the alphanumeric-only string, so it carries no LIKE wildcard.
  - Give it a one-line doc comment: it keeps the delete-before-create hygiene that a fixed slug used to give, and it sweeps runs that were interrupted before afterAll.
- In feed.spec.ts:
  - Import `deleteStaleEmptyFeedTenants`.
  - Add a module-level `RUN = Date.now().toString(36)` (the reels, phase4 and phase5 precedent).
  - In the UI-D-20 beforeAll, first await `deleteStaleEmptyFeedTenants(testInfo.project.name)`, then create the tenant with `emptyFeedSlug(testInfo.project.name, RUN, testInfo.repeatEachIndex)`.
  - Keep the `browserName` fixture placeholder, the 120 s timeout, the afterAll and both tests with every assertion unchanged. They read `tenant.slug`, so the copy follows the new slug.
- Gates, run from the repo root:
  - Typecheck and lint.
  - Port check. Then a fast targeted loop: `-g "UI-D-20" --repeat-each=3` on both projects, which must give 12 passed.
  - Then the done gate: the whole of feed.spec.ts with `--repeat-each=3` on both projects. Run it in the background if it may exceed about 9 minutes, and poll it.
  - Port check again.
- If a case outside UI-D-20 fails in the full run (for example the FEED-04 double tap, WINDOWS 64), do not fix, loosen, skip or re-run it until it goes green. Record its name, project, iteration and trace path in the SUMMARY and as a new open deferred-items entry, and report truth 20 as not met.
- Commit the two e2e files by explicit path, with the subject `test(quick-261001-ere): give the UI-D-20 empty tenant a slug unique per run and repeat`.
- Ledger: in deferred-items.md, change the `feed.spec.ts` "UI-D-20 … fails on every `--repeat-each` iteration after the first" entry from `status: open` to `status: resolved`. Do this only if all 12 UI-D-20 runs passed in the full-file run.
  - Add one resolution line with quick 261001-ere, the commit's short SHA and the real counts (passed/skipped/failed for the full file).
  - This entry has no WINDOWS row.
  - Commit deferred-items.md by explicit path, with the subject `docs(quick-261001-ere): resolve the UI-D-20 repeat-each entry on targeted evidence`.
  </action>
  <verify>
    <automated>TURBO_CACHE=local:r pnpm --filter @rede-social/web typecheck &amp;&amp; TURBO_CACHE=local:r pnpm --filter @rede-social/web lint</automated>
    <automated>grep -q 'repeatEachIndex' apps/web/e2e/feed.spec.ts &amp;&amp; grep -q 'deleteStaleEmptyFeedTenants' apps/web/e2e/feed.spec.ts &amp;&amp; grep -q 'export async function deleteStaleEmptyFeedTenants' apps/web/e2e/feed-admin.ts</automated>
    <automated>! lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8787 -iTCP:8788 -sTCP:LISTEN &amp;&amp; VIDEO_PROVIDER=fake TURBO_CACHE=local:r pnpm --filter @rede-social/web exec playwright test feed.spec.ts --project=mobile-chromium --project=desktop-chromium -g "UI-D-20" --repeat-each=3; r=$?; ! lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8787 -iTCP:8788 -sTCP:LISTEN &amp;&amp; test "$r" -eq 0</automated>
    <automated>! lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8787 -iTCP:8788 -sTCP:LISTEN &amp;&amp; VIDEO_PROVIDER=fake TURBO_CACHE=local:r pnpm --filter @rede-social/web exec playwright test feed.spec.ts --project=mobile-chromium --project=desktop-chromium --repeat-each=3; r=$?; ! lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8787 -iTCP:8788 -sTCP:LISTEN &amp;&amp; test "$r" -eq 0</automated>
  </verify>
  <done>
    - `emptyFeedSlug(project, run, repeat)` returns `feed-empty-<project>-<run>-r<repeat>` (40 characters or fewer, unsliced).
    - `deleteStaleEmptyFeedTenants(project)` sweeps only that project's legacy and suffixed `feed-empty` slugs, through bound parameters.
    - The UI-D-20 beforeAll sweeps, then provisions with `testInfo.repeatEachIndex`.
    - The `-g "UI-D-20" --repeat-each=3` run gives 12 passed.
    - The whole of feed.spec.ts with `--repeat-each=3` exits 0 on mobile-chromium and desktop-chromium. Ports are free afterwards.
    - The UI-D-20 deferred-items entry reads `status: resolved` with the real counts.
    - Two commits, staged by explicit path, with no co-author trailer.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → Next BFF `/api/notifications/*` | The member's session cookie authorises the mark POSTs. Cross-site requests are refused by `gatedMark` (same origin, no body, verified session). |
| e2e fixture → local Postgres / GoTrue admin | Superuser SQL and the service key, local stack only. They provision and delete throwaway tenants. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-q261001-01 | Spoofing/Tampering (CSRF) | read-all fetch now with keepalive | low | mitigate | `gatedMark` is unchanged: a keepalive same-origin POST still carries Origin, so the sameOrigin, no-body and session gates apply as they do for the existing keepalive row reads. No route handler changes in this plan. |
| T-q261001-02 | Denial of service | extra read POSTs during a mark-all | low | mitigate | At most one per row per in-flight mark-all: the `tapped` set blocks a second tap, and a row tapped before the mark-all is never in `added`. Case 2 asserts exactly one POST for b and a, and none for c. |
| T-q261001-03 | Integrity (UI vs server state) | scoped rollback after a failed mark-all | medium | mitigate | A row kept read after a failure now has its own keepalive read POST on the server (Decision C), so screen and server agree. Pinned by case 2 and the `own read POST` case, both proven red on 583619c. |
| T-q261001-04 | Tampering (test fixture deletes) | `deleteStaleEmptyFeedTenants` | low | mitigate | Bound parameters only. The pattern is built from the alphanumeric-only project string under the `feed-empty-` prefix, so it can match only this fixture's throwaway tenants on the local stack. Seed tenants (rede-demo, rede-lab) cannot match. |
| T-q261001-05 | Information disclosure | `.env*` secrets the fixtures load at runtime | low | accept | The executor never reads, prints or edits `.env*`. The fixtures' existing `envValue` path is unchanged. Local-only keys. |
| T-q261001-06 | Repudiation (evidence integrity) | WINDOWS 66-68 and deferred-items resolutions | low | mitigate | Changes go only through `gsd-tools windows fixed` and only after the named targeted runs pass. Each resolution line quotes real counts and the commit SHA. Truth 15 and the umbrella gate entry stay open. |
</threat_model>

<verification>
Targeted runs only, from the repo root. No `pnpm verify`, no db:reset or db:seed, no unfiltered `pnpm e2e`.
1. `TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run "app/(app)/notificacoes/NotificationsSurface.test.tsx"` gives 5 passed, 0 failed.
2. Red check: the three filters pass at HEAD and fail with the 583619c component. The working tree is clean afterwards.
3. `VIDEO_PROVIDER=fake TURBO_CACHE=local:r pnpm --filter @rede-social/web exec playwright test notifications.spec.ts --project=mobile-chromium --project=desktop-chromium` exits 0.
4. `VIDEO_PROVIDER=fake TURBO_CACHE=local:r pnpm --filter @rede-social/web exec playwright test feed.spec.ts --project=mobile-chromium --project=desktop-chromium --repeat-each=3` exits 0.
5. `pnpm --filter @rede-social/web typecheck`, `lint` and `bash scripts/check-ui-literals.sh` exit 0.
6. Ports 3000/3100/8787/8788 are free after every Playwright run.
</verification>

<success_criteria>
- 07-VERIFICATION truths 12 (E04 loading), 17 (own read POST) and 20 (feed.spec `--repeat-each=3`) now have passing automated evidence. The notifications red of truth 15 (`notifications.spec.ts:228`) passes on both projects.
- WINDOWS 66, 67 and 68 are `fixed`. Three deferred-items entries are `resolved` with counts. WINDOWS 69-71, the umbrella 07-15 entry and truth 15 are still open, because the full gate is out of scope.
- UI-D-252's wording is unchanged (Decision B). The keepalive choice (Decision A) is recorded in the code comment, the :228 deferred entry and the SUMMARY.
- No assertion was loosened, no UI string was added, and no `.env*` file was touched.
</success_criteria>

<output>
Create `.planning/quick/261001-ere-phase-7-leftovers-mark-all-busy-and-tapp/261001-ere-SUMMARY.md` when done. Include:
- the real Vitest summary lines: red before the fix, green after, and the 583619c red check
- the per-project Playwright counts for notifications.spec.ts and for feed.spec.ts `--repeat-each=3`
- which e2e wait path was used in the mark-all case, with the evidence
- Decisions A-E
- the commit SHAs
- any out-of-scope red recorded as a new deferred entry
</output>
