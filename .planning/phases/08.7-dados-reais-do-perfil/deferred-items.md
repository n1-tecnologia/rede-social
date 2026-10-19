## Deferred Items

- `apps/web/e2e/profile.spec.ts:673` ("a community without Comunidades") is flaky: it reads `[data-profile-section]` with a one-shot `evaluateAll` right after `page.goto`, while the lab `/perfil` can still be on its `loading.tsx` skeleton (cold dev compile), so it sees `[]`. Found during 08.7-01; the member path is untouched by 08.7-01 (it passed on one project and failed on the other across reruns). Fix: wait for `[data-profile-section="events"]` to be visible before the `evaluateAll`.
  status: resolved
  **Resolved:** 08.7-03 (Task 3) applied that fix; the test passed on both projects afterwards.

- `supabase/tests/110-communities-stories.sql` test 47 ("the story comment list is served by feed_comments_tenant_story_root_asc_idx BY NAME") failed after this run's integration and e2e suites, on the same local DB where the full pgTAP run had passed 1805/1805 twice earlier in 08.7-12 (right after the migration). It is a planner-choice assertion on `feed_comments`; 08.7-12 touches no `feed_comments` table, index or function, and a `vacuum analyze public.feed_comments` did not change it. Found during 08.7-12 (after Task 3); the "pgTAP before integration" residue rule. Next step: rerun pgTAP on a fresh `pnpm db:reset && pnpm db:seed` (the batched reset at phase end) before investigating.
  status: resolved
  **Resolved (08.7-13):** the gate's first pgTAP run failed it again, and its EXPLAIN showed the planner on `feed_comments_tenant_created_idx`, the index 08.7-02 added (`20261018222400_feed_dashboard_indexes.sql`). With the fixture tenant holding only the story's 400 comments, that index delivers the same `created_at` order behind a story filter, and other tenants' residue tips the estimate. The fixture now gives the tenant 2,000 interleaved post comments, so the story index is again the one that reads only the rows it returns (`5294af5a`). pgTAP 1805/1805 before integration, and 110 stayed green after the integration run.

- Fourteen api integration cases fail on the current local database only because its seed (2026-10-16) has aged (found during 08.7-13's gate)
  status: open
  **What:** `stories.test.ts` (8 cases: 1, 2, 4, 5, 6, 7, 8 and 05.2-7), `stories-author-photo.test.ts` (1, 2), `isolation.test.ts` b3 and b8, `feed-query-budget.test.ts` ("costs at most 1 statement against the story tables") and `events.test.ts` 3 ("the in-progress event is upcoming", missing 'Semana de integracao'). The first lines read "expected [] to have a length of 3", "the seed has live demo stories by the admin: expected 0 to be greater than 0", "seeded labStory: expected '' not to be ''". A read-only count shows no rede-demo or rede-lab story with `expires_at > now()` (newest `published_at` 2026-10-16 23:09 UTC).
  **Why out of scope:** seed-pinned and time-relative fixtures (Phase 5, 05.2 and 7 files); no 08.7 commit touches stories, events or their seed. The project memory records the same drift ("UAT rows break seed-pinned tests; reset needs seed").
  **Next step:** the developer's reset batch, `pnpm db:reset && pnpm db:seed`, then `VIDEO_PROVIDER=fake pnpm test:integration`.

- pgTAP `154-moderation-log.sql` test 28 fails when pgTAP runs AFTER the integration suite (found during 08.7-13's gate, a known residue trip)
  status: open
  **What:** "fact 5: every log row is anchored to two memberships of its own tenant, matching its user ids" lists two unexpected `moderation_log` rows left by the integration run. pgTAP before integration (the verify order, EP-61) passed 1805/1805.
  **Why out of scope:** residue, not code; the project memory already records "run pgTAP before integration (154 trips on residue)".
  **Next step:** none beyond the reset batch, which runs pgTAP on a fresh database.

- `apps/web/e2e/profile.spec.ts:184` (PROF-01 photo, "derived widths") failed once on both projects in the gate run, then passed 2/2 alone (found during 08.7-13)
  status: resolved
  **What:** the `/v1/media/{id}/w320` poll got 404 for 30 s: the worker `ensureWorker()` spawned was still draining 20 `kernel.media-derive-variants` jobs the integration run had just queued. After the backlog completed, the case passed on both projects.
  **Resolved:** a load trip, not a defect; the reset batch's full `pnpm e2e` reruns it.

