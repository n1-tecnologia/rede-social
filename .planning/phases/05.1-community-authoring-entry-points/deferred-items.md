## Deferred Items

- A running `next dev` never picks up new catalog keys, because `loadMessages()` memoizes the pt-BR catalog per process
  status: open
  **Found during:** 05.1-03 Task 3 (the comunidades e2e)
  **What:** `apps/web/i18n/messages.ts` caches the assembled catalog in a module-level `Map` read through `node:fs`, so a long-running dev server serves new page code through HMR but still holds the catalog it read at start. A page that calls `t()` with a key added after the server started throws `MISSING_MESSAGE` in dev (by design: `onError` throws outside production) and renders the `(app)` error boundary. In 05.1-03, the developer's `next dev` on :3000 (running since 2026-09-24 22:28) rendered "Algo deu errado." for an admin on `/comunidades` because `communities.list.filter.label` was new.
  **Workaround used:** the e2e ran against a production `next start -p 3100` (the `playwright.pwa.config.ts` pattern), with `PLAYWRIGHT_{DEMO,LAB,PLATFORM,GENERIC}_URL` pointing at :3100. A restart of the dev server also clears it.
  **Possible fix (not in scope):** skip the memo when `NODE_ENV !== 'production'`, or key it on the catalog directory's mtimes. `T-02-12` (production reads the directory once per process) is unaffected either way.
