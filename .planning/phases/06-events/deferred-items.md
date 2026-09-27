## Deferred Items

- `stories.spec.ts` "the Início manage screen … create, rename, add the EXPIRED story, pick it as cover, remove it, move up by keyboard, delete" fails on `mobile-chromium` under `next dev`
  status: resolved
  **Found during:** 06-08 Task 2 (the `/inicio` regression run)
  **What:** the "Excluir destaque" tap in the "Editar destaque" dialog on `/stories/destaques` times out: `<nextjs-portal>` (Next's dev overlay) "subtree intercepts pointer events". It is the dev-overlay artifact 06-01 recorded for the BottomNav (its deviation 8), here on a 05.2 screen.
  **Why not fixed here:** pre-existing and unrelated to 06-08. It fails identically with the events home slot UNREGISTERED on a freshly reset and seeded database (A/B probe, 2026-09-27), and the screen is 05.2's, not an Eventos surface. The likely fix is the repo's `dispatchEvent('click')` workaround at that one tap in `stories.spec.ts`.
  **Resolution (06-09, commit `05507a9`):** that one tap is now `dispatchEvent('click')`, with the spec's assertions unchanged. The test passed on `mobile-chromium` in the 06-09 exit-gate run. The same commit applies the workaround to the four other taps the gate found blocked by the dev overlay (`comunidades.spec.ts`'s Comunidades tab and `reels.spec.ts`'s three Início tab taps in e1, e5 and e6). comunidades + reels then ran 83 passed / 0 failed on a fresh seed.

- `phase52-smoke.spec.ts` test 5 fails in a FULL `pnpm e2e` run (both projects): the migrated `Destaques` no longer holds the seeded story video `…d2`
  status: open
  **Found during:** 06-09 Task 2 (the exit gate).
  **What:** `media-video.spec.ts` calls `deleteTenantVideoAssets('tria-demo')`, a hard reset that deletes every story on a video asset. That includes `SEED_STORIES[1]` (`0d000000-0000-4000-8000-0000000000d2`), which test 5 expects in the community's migrated `Destaques` (received `[…d4, <the story test 2 published>]`). Playwright runs the files alphabetically, so `media-video` always runs before `phase52-smoke`. The failure is therefore deterministic in any full run, and it predates Phase 6: 05.2-12 and 05.3-09 ran subsets without `media-video.spec.ts`. On a fresh seed, `phase52-smoke.spec.ts` alone passes 12/12 (06-09 evidence run).
  **Suggested fix (spec-only):** read the expected pins from the database, the `activeReadyStoryCount` pattern `stories.spec.ts` already uses for the same reason, or have `media-video.spec.ts` restore the seeded story video in its `afterAll`.

- `phase2-smoke.spec.ts` case 1 reads the per-tenant manifest once, right after polling only the served HTML, and can see the pre-rebrand `theme_color`
  status: open
  **Found during:** 06-09 Task 2 (the exit gate, `mobile-chromium`: expected `#0e7490`, received `#b91c1c` at line 584).
  **What:** step (g) polls the first HTML for up to 70 s until the new primary appears (the 60 s web host cache), then reads `/m/{slug}/manifest.webmanifest` once without a poll. The manifest's cached branding can expire later than the HTML's, so the read races the cache. Rerun alone on a fresh seed, the spec passed 12/0 (3 project skips). It is intermittent and predates Phase 6.
  **Suggested fix (spec-only):** poll `readManifest(...).json.theme_color` with the same 70 s budget before asserting the manifest.
