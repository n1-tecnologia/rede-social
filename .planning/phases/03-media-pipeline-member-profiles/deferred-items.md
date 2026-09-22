# Deferred Items

Out-of-scope discoveries made while executing phase 03. Each entry is open unless it carries an
explicit `status: resolved`.

- Service-worker registration rejects unhandled
  status: open
  **Found during:** 03-07 Task 3, while investigating a Playwright failure.
  **What:** With `test.use({ serviceWorkers: 'block' })`, the browser console shows
  `unhandledRejection: TypeError: Cannot read properties of undefined (reading 'waiting')` on every
  page load. The Serwist registration component (02-11) calls
  `navigator.serviceWorker.register(...)` and then reads `.waiting` off the result without guarding
  a REJECTED registration — which is what any browser that refuses the worker (Playwright's block,
  a private window, an enterprise policy, an insecure origin) produces.
  **Why deferred:** pre-existing, in a Phase 2 file, and unrelated to this plan's task. It is not
  user-visible today because the registration succeeds in normal browsing.
  **Where it belongs:** Phase 7 (push) touches this component, or Phase 8 (hardening). The fix is a
  `.catch()` on the register promise plus a guard before reading `.waiting`.

- `getAsset` on the video provider seam is still wired to no caller
  status: open
  **Found during:** 03-07 Task 1, closing the `signPlayback` half of broken-windows entry 13.
  **What:** 03-06 declared `videoProvider.getAsset(providerAssetId)` so a future reconciliation job
  would need no adapter change. 03-07 routes `signPlayback` (`GET /v1/media/{assetId}/playback`),
  but `getAsset` still has no caller, so windows entry 13 is only half closed.
  **Why deferred:** a reconciliation job (re-reading a provider asset whose webhook was lost) is not
  in this plan's scope and is not required by criterion 4.
  **Where it belongs:** Phase 8 (hardening), or whenever a lost-webhook recovery path is needed.
