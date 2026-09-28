## Deferred Items

- `stories.spec.ts` "the Início manage screen … create, rename, add the EXPIRED story, pick it as cover, remove it, move up by keyboard, delete" fails on `mobile-chromium` under `next dev`
  status: resolved
  **Found during:** 06-08 Task 2 (the `/inicio` regression run)
  **What:** the "Excluir destaque" tap in the "Editar destaque" dialog on `/stories/destaques` times out: `<nextjs-portal>` (Next's dev overlay) "subtree intercepts pointer events". It is the dev-overlay artifact 06-01 recorded for the BottomNav (its deviation 8), here on a 05.2 screen.
  **Why not fixed here:** pre-existing and unrelated to 06-08. It fails identically with the events home slot UNREGISTERED on a freshly reset and seeded database (A/B probe, 2026-09-27), and the screen is 05.2's, not an Eventos surface. The likely fix is the repo's `dispatchEvent('click')` workaround at that one tap in `stories.spec.ts`.
  **Resolution (06-09, commit `05507a9`):** that one tap is now `dispatchEvent('click')`, with the spec's assertions unchanged. The test passed on `mobile-chromium` in the 06-09 exit-gate run. The same commit applies the workaround to the four other taps the gate found blocked by the dev overlay (`comunidades.spec.ts`'s Comunidades tab and `reels.spec.ts`'s three Início tab taps in e1, e5 and e6). comunidades + reels then ran 83 passed / 0 failed on a fresh seed.

- `phase52-smoke.spec.ts` test 5 fails in a FULL `pnpm e2e` run (both projects): the migrated `Destaques` no longer holds the seeded story video `…d2`
  status: resolved
  **Found during:** 06-09 Task 2 (the exit gate).
  **What:** `media-video.spec.ts` calls `deleteTenantVideoAssets('rede-demo')`, a hard reset that deletes every story on a video asset. That includes `SEED_STORIES[1]` (`0d000000-0000-4000-8000-0000000000d2`), which test 5 expects in the community's migrated `Destaques` (received `[…d4, <the story test 2 published>]`). Playwright runs the files alphabetically, so `media-video` always runs before `phase52-smoke`. The failure is therefore deterministic in any full run, and it predates Phase 6: 05.2-12 and 05.3-09 ran subsets without `media-video.spec.ts`. On a fresh seed, `phase52-smoke.spec.ts` alone passes 12/12 (06-09 evidence run).
  **Suggested fix (spec-only):** read the expected pins from the database, the `activeReadyStoryCount` pattern `stories.spec.ts` already uses for the same reason, or have `media-video.spec.ts` restore the seeded story video in its `afterAll`.
  **Fix landed (06-09, commit `d5f5ee0`, developer-authorized):** the first option. `admin.ts` gains `memberVisibleStoryIds` / `memberVisibleHighlightStoryIds` (the stories service's `MEMBER_VISIBLE`, verbatim). Test 5 conditions the video pin on the STORY still existing (a live story missing its item still fails), keeps the expired pin first, and now also asserts the API read equals the database's member-visible items in play order. Restoring the seed was rejected: the helper's total reset is what media-video's empty-library assertions measure, `phase3-smoke.spec.ts` is a second destructive caller that also runs earlier, and a faithful restore would rebuild eight tables' rows through their triggers. Verified: alone on a fresh seed 12/12; `media-video` then `phase52-smoke` on a fresh seed 46/46 with the "seeded story video absent" annotation on both projects; passed in all three full `pnpm e2e` runs of 06-09. Flip to resolved when `pnpm verify` is green.
  **Resolved:** passed on both projects in the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped).

- `phase2-smoke.spec.ts` case 1 reads the per-tenant manifest once, right after polling only the served HTML, and can see the pre-rebrand `theme_color`
  status: resolved
  **Found during:** 06-09 Task 2 (the exit gate, `mobile-chromium`: expected `#0e7490`, received `#b91c1c` at line 584).
  **What:** step (g) polls the first HTML for up to 70 s until the new primary appears (the 60 s web host cache), then reads `/m/{slug}/manifest.webmanifest` once without a poll. The manifest's cached branding can expire later than the HTML's, so the read races the cache. Rerun alone on a fresh seed, the spec passed 12/0 (3 project skips). It is intermittent and predates Phase 6.
  **Suggested fix (spec-only):** poll `readManifest(...).json.theme_color` with the same 70 s budget before asserting the manifest.
  **Fix landed (06-09, commit `9f19c67`, developer-authorized):** exactly that poll, every assertion unchanged. Verified alone on a fresh seed (12 passed, 3 project skips) and in all three full `pnpm e2e` runs of 06-09. Flip to resolved when `pnpm verify` is green.
  **Resolved:** passed on all three projects in the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped).

- `stories.spec.ts` "a LEFT swipe on the tenant circle's first story" failed once (gate run 1, mobile): a late seen-write from the previous case
  status: resolved
  **Found during:** 06-09 exit gate, run 1.
  **What:** the viewer opened on the SECOND tenant story (resume at the first unseen, D-105), played it 5 s, auto-advanced into Bastidores (index 0, so the precondition passed late), and the swipe then ran past the row's last group and closed the viewer. The previous case's viewer delivers its seen buffer on close or page hide through a keepalive request that outlives the page (WR-07); it can land after this case's `beforeEach` cleared the views. It is timing-dependent: it did not reproduce in suite order or in 5 repeats.
  **Fix landed (06-09, commit `d0cc21f`, test-only):** `openTenantCircleAtFirst` pins every live tenant story as seen before login (a late write can only ADD views, and all-seen restarts at the first story) and checks the pushed URL, group 0 and index 0 before the gesture; used by the tap-right and left-swipe cases. Verified: stories.spec 60 passed / 18 skipped on a fresh seed; the grouped-viewer describe 20/20 with `--repeat-each=5`. Flip to resolved when `pnpm verify` is green.
  **Resolved:** passed in the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped).

- `media-video.spec.ts` "the player opens in a sheet … centred dialog on the desktop" failed once (gate run 2, desktop): Next's dev-overlay dialog matched the player locator
  status: resolved
  **What:** `[role="dialog"][aria-modal="true"]` matched our sheet AND the dev overlay's "Console Error" dialog. The console error is expected under `VIDEO_PROVIDER=fake` (stream.mux.com answers 400 to the fake token and mux-player logs it); whether the overlay mounts before the geometry read depends on that latency.
  **Fix landed (06-09, commit `cb84d43`, test-only):** the locator excludes `[data-nextjs-dialog]`; assertions unchanged. Verified: media-video + platform-branding 42 passed / 2 skipped on a fresh seed. Flip to resolved when `pnpm verify` is green.
  **Resolved:** passed on both projects in the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped).

- `platform-branding.spec.ts` test 2 failed once (gate run 2, desktop): the "Remover ícone quadrado?" dialog detached mid-click (180 s timeout)
  status: resolved
  **What:** the status poll renders "ready" and THEN calls `router.refresh()`; the Marca page keys `BrandingForm` on `formKey(view)`, so the refreshed server view REMOUNTS the form and drops anything begun in that window.
  **Fix landed (06-09, commit `836995f`, test-only):** `reopenSettled()` navigates to the Marca tab again once the icons are ready, before the icon upload and before Remover. Verified with media-video (42 passed / 2 skipped). Flip to resolved when `pnpm verify` is green.
  **Resolved:** passed in the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped). The product-side race stays open as its own item below.

- PRODUCT (Phase 2 platform panel, out of Phase 6 scope): a background `router.refresh()` remount of `BrandingForm` can close an admin's open confirm dialog or drop an upload begun in the same few hundred milliseconds
  status: open
  **What:** `apps/web/components/platform/BrandingForm.tsx` (the poll's `if (result.view.iconsReady) router.refresh()`) plus `formKey(view)` in `apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx`. Found through the test above; a real admin who taps Remover right as the icons finish sees the dialog vanish.
  **Suggested fix:** hold the refresh while a dialog is open or an upload is in flight, or hoist the ConfirmDialog state above the keyed form. For the platform-panel owner (Phase 8 settings or a quick task).

- Seeded events straddled the tenant's midnight when the seed ran after 22:00 São Paulo
  status: resolved
  **Found during:** 06-09 exit gate, run 3 (seeded at 22:0x São Paulo): nine failures (events lista/detalhe timezone cases, the seeded detail's info grid, phase6-smoke 1, both projects). `Encontro de boas-vindas` ran 22:00–00:00, ended on the next calendar day, and printed as a multi-day range.
  **Fix landed (06-09, commit `eceb0c2`):** the seed anchors events to the tenant-local NOON of the seed day, computed in Postgres from the tenant's timezone. Verified: reseeded at 22:42 São Paulo, every event within one local day; events.spec + phase6-smoke then passed those nine cases. NOT yet verified: the integration suite on the new anchor. Flip to resolved when `pnpm verify` is green.
  **Resolved:** the integration suite on the noon anchor is green (35 files / 590 tests, seeded at 23:10 São Paulo), and the anchor held through the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped).

- Now-relative e2e fixtures in `events.spec.ts` straddle the tenant's midnight in the evening
  status: resolved
  **Found during:** 06-09, the post-seed-fix check run at 22:4x São Paulo: "events check-in 1" creates its event at now+30 min .. now+150 min, which ended after midnight, printed as a range, and cut the Data cell at 320px (`Data cut at 320px`). Other fixtures in the file use 150–300 minute windows and share the exposure between roughly 19:00 and 24:00 São Paulo.
  **Suggested fix (spec-only):** give each format-sensitive fixture a window that cannot cross the tenant's midnight (for example clamp the end to 23:59 local, or pin the start to a fixed local hour the next day where the test does not need "inside the window now"), or run the gate before ~19:00 São Paulo. Not attempted: the disk ran out (below).
  **Fix landed (06-09, commit `c3c05e1`, developer-authorized):** `events-admin.ts` gains `sameDayWindowAt` (pure) / `sameDayWindow` (the tenant's stored zone): the requested window, else its end pulled back before local midnight, else the earliest allowed start likewise, else a start just after midnight, within the bounds the case needs; it throws rather than bend a case. The check-in `live` fixture asks for 30..150 min within a start of 10..55 min and at least 30 min. It was the only format-sensitive fixture: the 23:06 São Paulo run of events.spec + phase6-smoke failed only check-in 1 (56 passed); every other now-relative fixture asserts no local-day copy or accepts both variants. Proof: a sweep over every 37 s of two days in four zones (DST switches included) never left the bounds or the day (branches hit: as requested, end clamped, earliest start, next day); check-in 1-4 passed at 23:09 (earliest-start branch), inside the gate (e2e started 23:14:58; the cases were 67-70 of 674, so between 23:15 and 23:25), and after midnight (requested branch, see SUMMARY).
  **Resolved:** the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped).

- Intermittent in gate run 3, not diagnosed: `feed-comments.spec.ts:298` (mobile, the failed-list error never appeared) and `media-video.spec.ts:460` (desktop, "Atualizar" never appeared after the clock fast-forward)
  status: open
  **What:** both passed in gate runs 1 and 2 and in the targeted media-video runs. No mechanism identified; not touched.
  **Update:** both passed in the green 06-09 exit gate (`pnpm verify`, reset + seed at 23:12 São Paulo, exit 0: e2e 555 passed / 119 skipped / 0 failed, e2e:pwa 46 passed / 5 skipped). Still undiagnosed, so the item stays open.

- ENVIRONMENT: the local disk reached 0 bytes (ENOSPC) during the 06-09 events check run, and a stale `apps/web/.next/dev` made `next dev` answer 404 on every admin and platform route
  status: open
  **What:** the repo's caches were small at the time (`.next` 894 MB, `.turbo/cache` empty), so the space went outside the repo (most likely Docker Desktop's disk image growing across repeated `db:reset`), and free space came back to ~6.9 GB afterwards. Separately, running a dev e2e right after a `pnpm verify` without deleting `apps/web/.next/dev` produced 32 failures, every one a Next default 404. Clearing it fixed that (42/0).
  **Rule for the next run:** `rm -rf .turbo/cache apps/web/.next/dev` before every gate AND before every dev e2e run that follows one; free host disk before a gate.
  **Update:** `docker image prune -a -f` reclaimed 713.6 MB inside Docker but host free space stayed at 7.9 GB (the Docker Desktop VM disk does not shrink on the host). Later free space was 10.88 GiB after clearing the repo caches. The green gate started there and bottomed out at 5.58 GiB free (a ~5.3 GB peak), with a watchdog ready to stop it under 2 GiB. Kept open: the host margin is still thin for the next gate.
