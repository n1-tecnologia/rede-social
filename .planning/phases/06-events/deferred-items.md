## Deferred Items

- `stories.spec.ts` "the Início manage screen … create, rename, add the EXPIRED story, pick it as cover, remove it, move up by keyboard, delete" fails on `mobile-chromium` under `next dev`
  status: open
  **Found during:** 06-08 Task 2 (the `/inicio` regression run)
  **What:** the "Excluir destaque" tap in the "Editar destaque" dialog on `/stories/destaques` times out: `<nextjs-portal>` (Next's dev overlay) "subtree intercepts pointer events". It is the dev-overlay artifact 06-01 recorded for the BottomNav (its deviation 8), here on a 05.2 screen.
  **Why not fixed here:** pre-existing and unrelated to 06-08. It fails identically with the events home slot UNREGISTERED on a freshly reset and seeded database (A/B probe, 2026-09-27), and the screen is 05.2's, not an Eventos surface. The likely fix is the repo's `dispatchEvent('click')` workaround at that one tap in `stories.spec.ts`.
