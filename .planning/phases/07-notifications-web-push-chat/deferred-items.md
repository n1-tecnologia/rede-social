# Phase 7 — Deferred Items

## Deferred Items

- Kernel `emitInTx` for durable notification fan-out (07-01, RESEARCH open question 2)
  status: open
  **What:** bus-to-enqueue is at-most-once for bell rows in V1. `emit` runs after `withTenantTx` returns and `flush` swallows handler failures, so an API instance dying between commit and the `notifications.fanout` enqueue loses that row (logged as `domain_event.handler_failed`). The D-240 refetch keeps the badge honest.
  **Upgrade path:** a kernel `emitInTx(tx, name, payload)` that writes a `kernel.dispatch-event` pg-boss job inside the PRODUCER's transaction, so the event and its fan-out commit or roll back together. Not built in 07-01 by decision (T-07-09 accepted).

- The API must deploy before the web whenever the bootstrap contract changes (07-01 note for 07-08)
  status: open
  **What:** `bootstrapSchema.counters` is a plain `z.object` that strips unknown keys, and the web parses the API's bootstrap with it. 07-08 adds `counters.conversationsBadge`; a web deploy that expects it before the API sends it would read `undefined`. Deploy order for that plan: API (Cloud Run) first, then web (Vercel), the 06-01 precedent.

- Local env hosts still carry the pre-rename `tria-*` values (07-01 execution note)
  status: open
  **What:** `pnpm db:seed` prints `platform=tria.localhost rede-demo=tria-demo.localhost rede-lab=tria-lab.localhost`, so `apps/api/.env.local` (and the web/Playwright env) still carry the old host values. Tests reading hosts from the env stay consistent, but two pre-existing tests hardcode `rede-*` hosts and fail only because of it: `apps/api/tests/integration/signup.test.ts` case 2 (`by-host?host=rede-demo.localhost` answers 404) and `apps/web/e2e/phase2-smoke.spec.ts` case 1 (the platform host defaults to `rede-social.localhost`, so the super_admin panel link is absent; cases 2-5 then do not run). Not worked around in 07-01 by instruction; the developer decides whether to regenerate the env files.

- `feed-comments.spec.ts` "a failed comment list renders the inline error…" races the Mux playback-token action (07-04 execution note)
  status: open
  **What:** the spec's `failNextActions` fails the NEXT `POST` to `/inicio`, whatever action it is. On a cold dev server (the first run after `db:reset` + `db:seed`) the video card's playback-token server action fires after the helper is armed and consumes the forced failure (`media.playback_token_failed { error: 'Error: forced failure' }` in the log), so the comment list loads normally and `[data-comments-error]` never appears. The same test passes 3/3 in isolation and in a warm full-file run. Nothing in 07-04 touches the media module, the feed card or that spec. Fix path: make the helper fail only the comment-list action (match the action id, or `route` by the request body), or keep the video card out of the viewport in that test.
