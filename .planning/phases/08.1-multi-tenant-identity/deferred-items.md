# Phase 08.1 — Deferred Items

Out-of-scope discoveries logged by executors (not fixed in the plan that found them).

## Deferred Items

- `apps/web/e2e/blocked.spec.ts` "AUTH-06/D-09 — blocked on the next request" aborts intermittently at step 3
  status: open
  **Found by:** 08.1-01 Task 3 (running its verify command).
  **What:** `page.goto('/inicio')` right after `setMembershipStatus(email, 'blocked')` sometimes fails with `net::ERR_ABORTED`: the Início page still open from step 1 fires the media playback-token server action, which receives the 403 `MEMBERSHIP_BLOCKED`, throws `NEXT_REDIRECT` (`media.playback_token_failed { error: 'Error: NEXT_REDIRECT' }` in the web log) and navigates the page to the blocked flow at the same moment the test navigates. The end state is the one the test asserts; only the test's own `goto` is aborted. Observed on 1 of 2 projects in 2 of 5 runs; the next two full runs of the spec passed 6/6.
  **Why deferred:** the race lives in the playback-token action and this pre-08.1 spec step; 08.1-01 does not change the blocked path on a host where the membership exists (the host-selected membership is the same row `membership_for_user` returned). Fix candidates: tolerate `ERR_ABORTED` on that one `goto` (the next `toHaveURL` still asserts the outcome), or have the playback-token action not redirect from a background fetch.
