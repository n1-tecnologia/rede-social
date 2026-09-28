---
phase: 06-events
fixed_at: 2026-09-28T09:10:00Z
review_path: .planning/phases/06-events/06-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-09-28T09:10:00Z
**Source review:** .planning/phases/06-events/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01, WR-01..WR-05; Info IN-01..05 out of scope)
- Fixed: 6. WR-05 is fixed for the event-length half only; the account-count half needs a product decision (see WR-05).
- Skipped: 0

**Where verification ran:** edits and commits were made in an isolated worktree (`.claude/worktrees/rf-06-*`, branch `gsd-reviewfix/06-*`). Every gate ran in the **main checkout**, which has `node_modules`, `.env*` and the local Supabase stack. Before each commit, the finding's uncommitted files were mirrored into main and the gates were run there. The mirror was then reverted, the fix was committed in the worktree, and `master` was fast-forwarded. The tree the gates saw is the tree that was committed, and every number below can be reproduced from `master`. The worktree has since been removed.

## Fixed Issues

### CR-01: The check-in guess bound can be bypassed with concurrent requests

**Files modified:** `supabase/migrations/20260928083828_event_check_in_lock.sql` (new, hand-written `--custom`), `supabase/migrations/meta/20260928083828_snapshot.json` (new, drizzle-kit), `supabase/migrations/meta/_journal.json`, `supabase/tests/142-event-checkin.sql`, `apps/api/tests/integration/events-checkin.test.ts`
**Commit:** 41975d9
**Status:** fixed: requires human verification (concurrency logic)
**Applied fix:** A new migration replaces `app.events_check_in`. The committed 06-05 migration was not edited. At the top of step 4, before the already-present check and the counter read, the function now takes `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app.events_check_in:' || tenant || ':' || event || ':' || member, 0))`.
- **Why an advisory lock rather than inserting the row first:** it needs no row and writes nothing. A right first code still leaves no attempts row, so integration case 3 and pgTAP fact 4 are unchanged.
- **Waiters:** a waiter behind a successful check-in answers `already` without spending a guess.
- **Lifetime:** the lock is released at commit or rollback, so it is safe on the Supavisor transaction pooler.
- **Hardening unchanged:** SECURITY DEFINER, `search_path ''`, fully qualified names (`pg_catalog.` included), tenant and user filters, EXECUTE revoked from PUBLIC and granted to `authenticated` only.

**Tests:**
- **Integration case 8:** the member's first wrong guess is held open on its own connection, so no attempts row is committed. Twenty parallel wrong codes are then fired through the API.
  - Expected: 4 more `wrong_code`, 16 `too_many_attempts`, counter 5, and the right code refused.
  - Red against the old function: 5 burst `wrong_code` and a counter of 6.
  - A plain unheld parallel burst did not reproduce the race in-process (pool of 5, fast transactions), which is why the case holds the first guess.
- **pgTAP 142 fact 21 (plan 65 → 68):** a member's first call on a fresh event holds the keyed advisory lock, read from `pg_locks`, and writes no attempts row.
- **Other gates:** `pnpm supabase test db` passes 518/518 at the end state. `events-checkin`, `events-attendance` and `isolation` integration pass. `pnpm db:generate` writes nothing. API typecheck and Biome are clean.

### WR-01: `GET /v1/events` returns 500 on a well-formed cursor whose `n` is not a timestamp

**Files modified:** `packages/modules/events/server/service.ts`, `apps/api/tests/integration/events.test.ts`
**Commit:** 3675a6b
**Applied fix:** `listEvents` now goes through `decodeInstantCursor`, the same guard `listAttendance` had, which is now a single shared helper.
- The guard also rejects cursors that match the shape but are not real instants, such as `2026-02-30…` or hour `99`. These passed the old `CURSOR_INSTANT` regex and still failed the `::timestamptz` cast, so `listAttendance` was also affected.
- Case 4 of `events.test.ts` adds three hostile `n` values. Red before: a 500. `events`, `events-attendance`, the module unit tests (89), typecheck and Biome are green.

### WR-02: The code input's `maxLength` counts separators that the backend strips

**Files modified:** `apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.tsx`, `CheckinForm.test.tsx`, `apps/web/e2e/events.spec.ts`
**Commits:** 427bffd, f41d960 (follow-up for the e2e pin)
**Applied fix:**
- `onChange` now normalises the value (uppercase, spaces and hyphens stripped) and clips it to `EVENT_CHECKIN_CODE_LENGTH`.
- The raw `maxLength` is now `checkinSchema`'s 16. The browser applies `maxLength` before `onChange`, so a cap of 4 truncated a pasted "K7-QM".

**Tests:**
- New claim 1b in `CheckinForm.test.tsx` covers "K7 Q", "k7-qm", " K7 QM " and a 5th symbol, and checks that the submit sends `K7QM`.
- `events.spec.ts` check-in 1 had pinned `maxlength="4"`. The first e2e run caught it, and the follow-up commit updates it to 16 and adds a separator-typed code.
- Web vitest (942/942), web typecheck, Biome and `check-ui-literals.sh` pass.

### WR-03: The boundary refresh misses its transition when the device clock runs ahead of the server

**Files modified:** `apps/web/components/events/useBoundaryRefresh.ts` (**new file**), `apps/web/components/events/NextEventRefresh.tsx`, `apps/web/app/(app)/eventos/[eventId]/EventActions.tsx`, `EventActions.test.tsx`
**Commit:** 99bde24
**Status:** fixed: requires human verification (timer logic)
**Applied fix:** One `useBoundaryRefresh(boundaries, phase)` hook replaces the two identical effects. This also resolves the boundary-refresh half of IN-03. The `normalizeCheckinCode` half of IN-03 is untouched.
- **Retry chain:** after the boundary refresh, the hook retries at +2, +5, +15 and +30 s for as long as the server returns the same `phase`. That covers roughly 52 s of device clock running ahead.
- **Stopping:** a phase change re-runs the effect, which clears the pending retry and arms the next boundary. Unmount clears everything. In the normal, synced case the phase changes on the first refresh and no retry fires.
- **Tests:** new `EventActions.test.tsx` case 5d covers the retries, the phase change stopping them, and the bounded chain of 5 refreshes. Existing cases 5a to 5c are unchanged and pass. Web vitest, typecheck, Biome and `check-ui-literals` pass.
- **Not covered:** a page first loaded inside the skew window, where the device thinks the boundary already passed but the server does not, still schedules nothing for that boundary. Handling it would mean refreshing after every boundary seen in the past, which costs extra refreshes on every normal load. The review's alternative, a server-sent `serverNowMs`, would close this gap. It conflicts with prefetched and cached RSC payloads, so it was not attempted.

### WR-04: A soft-deleted cover asset renders as an empty dark box instead of the gradient fallback

**Files modified:** `packages/modules/events/server/service.ts`, `apps/api/tests/integration/events-admin.test.ts`
**Commit:** a9e43cd
**Applied fix:** In both `eventColumns` (list, detail, next, create read-back) and `getEventForEdit`, `cover_asset_id` is now `case when a.id is null then null else e.cover_asset_id end`. Members get the D-69 gradient, and the edit form shows no cover. The stored row is untouched, and the existing self-heal on the next save still applies.
- **Tests:** `events-admin.test.ts` case 5 now asserts that, after the cover is retired, the member detail and the edit read return `coverAssetId: null` with an empty ladder while the stored row still holds the id. Red before: the dead uuid.
- **Other gates:** `events-admin`, `events` and `feed-query-budget` integration pass. Module unit tests, typecheck and Biome are green.

### WR-05: The guess budget scales with event length and account count

**Files modified:** `packages/modules/events/db/schema.ts`, `packages/modules/events/contracts/index.ts`, `supabase/migrations/20260928085138_event_checkin_attempts_total.sql` (generated by `pnpm db:generate --name=…`, with a header added), `supabase/migrations/20260928085140_event_check_in_ceiling.sql` (hand-written `--custom`), `supabase/migrations/meta/20260928085138_snapshot.json`, `supabase/migrations/meta/20260928085140_snapshot.json`, `supabase/migrations/meta/_journal.json`, `supabase/tests/142-event-checkin.sql`, `apps/api/tests/integration/events-checkin.test.ts`
**Commit:** c130a4d
**Status:** fixed: requires human verification (partial: the event-length half; the account-count half needs a product decision)
**Chosen limit:** at most **20 wrong codes per member per event against the current venue code**, across all windows (`EVENT_CHECKIN_MAX_FAILED_PER_CODE = 20`). The contracts constant is a mirror; the literal lives in `app.events_check_in`, which is the only enforcer.
- **Mechanism:** `event_checkin_attempts` gains `total_failed` and `total_since`.
- **Refusal:** at 20, the function returns `too_many_attempts` even for the right code and even in a fresh 15-minute window.
- **Reset:** "Gerar novo código" stamps `code_rotated_at` after `total_since`, and the next wrong guess restarts the count at 1.
- **CR-01:** the advisory lock from CR-01 is kept.

**Rationale:**
- **Four windows:** 20 is four full D-217 windows. A member who keeps mistyping is stopped by the 15-minute bound three times before this ceiling can matter, so an honest member practically never reaches it.
- **Effect on long events:** per account, the budget no longer depends on how long the event runs. On the seed's 72-hour event it drops from about 1,460 guesses (0.16% of the 923,521 codes) to 20 (about 0.002%).
- **Recovery path:** an honest member who does reach it goes to the staff, who regenerate the code. A suspected brute force calls for that anyway, and it already exists in the product (06-07). No new admin UI or copy was needed.

**Tests:**
- **pgTAP fact 22 (plan 68 → 73):** the 20th wrong code in an expired window is counted, with the window restarting at 1 and the total reaching 20. The right code is then refused. After a regeneration it checks in.
- **Integration case 9:** at 20 wrong codes against the current code, the right code gets 409 `too_many_attempts`. After `POST /v1/events/{id}/checkin-code`, the new code gets 200 `walk_in`.
- **Other gates:** `pnpm db:generate` writes nothing afterwards. pgTAP passes 518/518. Integration `events-checkin`, `events-attendance`, `isolation`, `events-admin` and `events` pass (82 tests). Module unit tests, typecheck and Biome are clean.

**Not fixed (needs a product decision):** with self-service signup, the total budget still grows with the number of accounts, at 20 guesses each.
- **Per-event aggregate limit:** it must refuse right codes to have any effect. About ten throwaway accounts could then lock every honest member out at the door, and there is no manual admin check-in to fall back on in V1.
- **Other options, each a product call:**
  - require an RSVP before a code check-in;
  - use a longer code for multi-day events;
  - cap event duration;
  - add an alarm the admin can see, for example highlighting "Gerar novo código" when an event's wrong-guess rate spikes.
- **Where this is recorded:** the migration header. It should also be added as an accepted or open risk next to T-06-27 in the threat register at `/gsd-secure-phase`. The 06-05 PLAN threat table was not edited.
- **Copy follow-up (design):** the `tooManyAttempts` line says "Aguarde alguns minutos e tente de novo." For a member at the ceiling, waiting does not help until the code is regenerated. The string is pinned by `06-UI-SPEC.md`, the approved sketch and `messages.test.ts`, so it was not changed. The design team may want wording such as "…ou fale com a organização do evento."

## End-state verification (main checkout, `master` at f41d960)

- `pnpm db:reset && pnpm db:seed`, then `pnpm supabase test db`: 17 files, 518 tests, PASS.
- `pnpm db:generate`: "No schema changes, nothing to migrate".
- API integration: `events-checkin` (16), `events-attendance`, `isolation`, `events-admin`, `events` and `feed-query-budget` all pass.
- `@rede-social/module-events` vitest: 89/89. `@rede-social/web` vitest: 942/942. API, module and web typecheck are clean. Biome is clean on every touched file. `scripts/check-ui-literals.sh` reports OK.
- `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test events.spec.ts` on a fresh reset and seed: 51 passed and 27 skipped (the skips are project-scoped by design). The first run caught the `maxlength="4"` pin, fixed in f41d960.
- Cleanup: only `rede-demo` and `rede-lab` tenants remain, and nothing is listening on :3000, :3100, :8787, :8788 or :8790.

## Out of scope (Info)

IN-01, IN-02, IN-04 and IN-05 were not touched. IN-03 is half covered by WR-03: the refresh hook is now shared. The `normalizeCheckinCode` duplication and the JS `\s` vs SQL `[[:space:]]` difference remain.

---

_Fixed: 2026-09-28T09:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
