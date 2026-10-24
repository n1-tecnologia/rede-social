---
phase: quick-261023-t3x
plan: 01
subsystem: ci-integration-tests
tags: [ci, integration-tests, teardown, postgres-js, breaker, quick]
requirements: [DBT-04]
status: complete
commits: 1
plan_head_before: a498dedd5ec434854c8a9e59b9d71b73c78cee33
actuals:
  tokens: 30000
  tasks: 3
  commits: 1
key-files:
  modified:
    - apps/api/tests/integration/two-database-routing.test.ts
---

# Quick 261023-t3x: two-database-routing integration file robust on the CI runner

The breaker test of the by-host block hung in CI (run 40039284864), its cleanup never ran, and the tenant bound to the probe port stayed in the central database and failed other suites. The file now drains its teardown from hooks and the probe listener resets instead of closing cleanly. The integration suite was NOT run locally; the next CI run is the proof.

## Investigation (Task 1)

### What postgres.js 3.4.9 does with an accepted-then-closed connection

Source: `node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/connection.js`.

- `connect()` (line 335) calls `connectTimer.start()` at line 343 on EVERY attempt. The timer is built at line 77 (`timer(connectTimedOut, options.connect_timeout)`), and `connectTimedOut` (lines 261-264) only fires when one single attempt neither finishes startup nor closes within `connect_timeout` seconds.
- `closed()` (line 436) cancels the connect timer (line 445). If the first query is still pending (`initial` set), it returns `reconnect()` (lines 450-451). `reconnect()` (line 361) waits `closedTime ? max(0, closedTime + delay - now) : 0` and `closedTime` is still unset on that path, so the retry is immediate and there is no backoff. The backoff (`delay`) is only reached when no first query is pending.
- `error()` / `errored()` (lines 381-394) reject the pending first query and null `initial`. So an `error` event on the socket (RST, ECONNRESET) rejects the query once; a clean close (FIN, no error event) never does.

Consequence: a peer that completes TCP and closes cleanly makes the query hang for as long as the peer keeps accepting. `connect_timeout` does not bound it, because it is re-armed and cancelled on every attempt. A failed attempt takes milliseconds when it is an error event, and is unbounded when it is a clean close.

### Measured on this Mac (Node 24, postgres 3.4.9, `connect_timeout: 10`, one `select 1`)

| Listener behaviour on accept | Outcome | Elapsed | Accepted connections |
|---|---|---|---|
| `socket.destroy()` | rejected ECONNRESET | 4 ms | 1 |
| `socket.resetAndDestroy()` | rejected ECONNRESET | 3 ms | 1 |
| `socket.end()` (clean FIN) | PENDING at 6 s | not settled after 6000 ms | 2999 (about 500 per second) |
| `end`, then `server.close()` | rejected ECONNRESET | 2 ms after the close | 2999 |

The single number asked for: one postgres.js connect against a destroy-on-accept listener takes about 4 ms on this Mac (it rejects with ECONNRESET). In the `end` variant, the close of the listener rejected with ECONNRESET in this run (the plan had expected ECONNREFUSED; the point is the same: closing the listener ends the retry loop within milliseconds).

### Verdict on the leading hypothesis

Refuted as stated. The hypothesis was "each failed attempt waits up to `connect_timeout` (10 s), so 3 attempts take 30 s". `connect_timeout` is per attempt and is re-armed, so it never accumulates and never trips against a peer that accepts and closes. The replacement mechanism is the retry loop above: on a clean close the first query is retried at once, with no backoff, until the peer stops accepting.

It is consistent with all three CI facts (run 40039284864): the breaker test hit the 30 s limit because it hung, not because it was slow; its `finally` never started because the body was stuck awaiting the request, and the file `afterAll` hung in `closeAllPools()`, which awaits the never-settling connect; the tenant and project rows were never removed. It is NOT reproduced on Linux from this Mac. Whether destroy-on-accept reaches the client as an RST or as a clean FIN depends, on Linux, on whether the client's startup bytes were already queued when the listener closed; that is a race macOS happens to win (RST, 4 ms). The mechanism itself is proven here with the clean-close variant.

### Deferred product finding (NOT fixed here; test-file-only scope)

`packages/core/db/project-pools.ts`:

- Lines 361-369, `connectProject`: `connect_timeout: 10` (line 366) is per attempt, and `await sql\`select 1\`` (line 369) has no total deadline. An upstream that completes TCP and closes cleanly before authentication keeps the lease waiting indefinitely, and the breaker never counts a failure.
- Line 314, `closeAll`: `await entry.ready.catch(noop)` has no bound, so process shutdown and the file `afterAll` hang behind such a connect.

Exposure: any peer that completes TCP and closes without a reset before authentication. Not reproduced against a real Supabase pooler. No product code is changed. A separate product task should add a total deadline to the connect and to `closeAll`.

## Edits

All in `apps/api/tests/integration/two-database-routing.test.ts` (the only code file touched; no product code, no `setup.ts`).

- Module level: a `Teardown` type, a `teardowns` list, `onTeardown` (appends) and `drainTeardowns` (shifts one entry at a time so each entry runs once and a second drain is a no-op; a failing entry does not stop the others; the first error is rethrown after the list is empty). Registration order is run order.
- Hooks: a top-level `afterEach` drains the list (timeout 60_000). The top-level `afterAll` now drains, then `b?.cleanup()`, then `closeAllPools()` in a `try`, and a `finally` ends `adminSqlB`, `adminSql` and `sqlClient`, so the clients are ended even if a cleanup step fails (timeout 120_000).
- `listen()` (by-host block): resets every accepted connection with `socket.resetAndDestroy()`, tracks accepted sockets in a `Set<Socket>`, and resolves an extra `close()` that closes the server and destroys the tracked sockets. `net.Server` has no `closeAllConnections` (that is `http.Server`), so the tracked-socket destroy is the realisation of the requested call.
- Tests converted from in-body `try/finally` to registered teardown (probe close registered before the tenant cleanup):
  - "the breaker of a tenant project opens at the third failed connection: the 4th request touches no socket": 2 registrations, timeout 120_000 on the test.
  - "P9 empty: unknown, unverified, whitespace and no-row hosts answer 404 with no tenant database opened": 2 registrations.
  - "a tenant whose project cannot be reached answers 503 TENANT_UNAVAILABLE, not a read of the central mirror": 1 registration.
  - "a registry row for another project is not changed by it": 1 registration (outer wrapper only; the inner `try/finally` restoring `platform.projects.api_url` is a central-state restore and is unchanged).
- Titles and assertions are unchanged: `git diff -w -U0 HEAD~1` shows 0 added or removed lines containing `expect(`, `it(` or `describe(` after the commit.

Deliberately left alone: the describe-level `beforeAll`/`afterAll` fixtures, the rede-lab test, P91 and both P92 tests, `ADMIN_URL`. Known limits: `provisionTenantOnB` failing midway leaves no handle (setup.ts is out of scope); vitest does not cancel a timed-out test body, so its remaining statements may still run after the drain.

## Verification run

- `pnpm exec biome check apps/api/tests/integration/two-database-routing.test.ts`: clean (no fixes applied).
- `pnpm --filter @rede-social/api typecheck` (`tsc --noEmit`): exit 0.
- `pnpm guard:lanes`: OK.
- `pnpm boundaries`: 2045 files in 19 packages, no issues.
- Structure checks: 6 non-comment lines register a teardown (breaker 2, P9 2, unreachable 1, registry-row 1); 0 direct cleanup calls or `probe.server.close` left; 120_000 on exactly the breaker test and the top-level `afterAll`, 60_000 on the `afterEach`; whitespace-insensitive diff check prints 0.

## Integration suite NOT run locally

The integration suite was NOT run locally, not even this file, and no vitest run of any kind was made. The local central database holds a real tenant bound to the hosted project rede-demo-externo with sealed credentials, and the reseal, move-rollback and central-clean suites (or a crashed run) could mutate or break it. No build, no db reset, no Playwright either (disk nearly full). The next CI run of the API integration job is the proof that the residue no longer poisons the other suites. The Linux race behind the CI hang was not reproduced from this Mac.

## Deviations from Plan

None. One small difference from the plan text: when the `end` probe variant had its listener closed, postgres.js rejected with ECONNRESET (2 ms), not ECONNREFUSED as predicted at planning time; the conclusion is unchanged.

## Commits (code only; this SUMMARY and the PLAN are left for the orchestrator's docs commit)

- c9d0e955 test(quick-261023-t3x): drain the routing test teardown after every test and reset the unreachable-project probe

No trailer. Nothing was pushed.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

The test file and the commit c9d0e955 exist, `git rev-list --count a498dedd..HEAD` is 1, and the commit message has no Co-Authored-By line.
