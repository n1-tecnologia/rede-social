## Deferred Items

- `apps/web/e2e/profile.spec.ts:673` ("a community without Comunidades") is flaky: it reads `[data-profile-section]` with a one-shot `evaluateAll` right after `page.goto`, while the lab `/perfil` can still be on its `loading.tsx` skeleton (cold dev compile), so it sees `[]`. Found during 08.7-01; the member path is untouched by 08.7-01 (it passed on one project and failed on the other across reruns). Fix: wait for `[data-profile-section="events"]` to be visible before the `evaluateAll`.
  status: resolved
  **Resolved:** 08.7-03 (Task 3) applied that fix; the test passed on both projects afterwards.
