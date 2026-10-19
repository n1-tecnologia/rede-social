## Deferred Items

- `apps/web/e2e/profile.spec.ts:673` ("a community without Comunidades") is flaky: it reads `[data-profile-section]` with a one-shot `evaluateAll` right after `page.goto`, while the lab `/perfil` can still be on its `loading.tsx` skeleton (cold dev compile), so it sees `[]`. Found during 08.7-01; the member path is untouched by 08.7-01 (it passed on one project and failed on the other across reruns). Fix: wait for `[data-profile-section="events"]` to be visible before the `evaluateAll`.
  status: resolved
  **Resolved:** 08.7-03 (Task 3) applied that fix; the test passed on both projects afterwards.

- `supabase/tests/110-communities-stories.sql` test 47 ("the story comment list is served by feed_comments_tenant_story_root_asc_idx BY NAME") failed after this run's integration and e2e suites, on the same local DB where the full pgTAP run had passed 1805/1805 twice earlier in 08.7-12 (right after the migration). It is a planner-choice assertion on `feed_comments`; 08.7-12 touches no `feed_comments` table, index or function, and a `vacuum analyze public.feed_comments` did not change it. Found during 08.7-12 (after Task 3); the "pgTAP before integration" residue rule. Next step: rerun pgTAP on a fresh `pnpm db:reset && pnpm db:seed` (the batched reset at phase end) before investigating.
  status: open
