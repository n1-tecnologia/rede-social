# Phase 8 — Deferred Items

## Deferred Items

### D-348 verdicts

The inherited reds from the Phase 7 exit gate (07-15, 07-11) and the never-run `e2e:pwa`, each with a verdict (flake or product bug), the evidence, and the outcome: fixed and proven green, or quarantined with a reason. A WINDOWS row flips only on a green run of its own spec. DB resets in 08-02 ran on the LOCAL stack only, under the developer's consent of 2026-10-02 (backup `~/rede-social-local-backups/pre-08-reset.sql`).

- WINDOWS #71 — `phase2-smoke.spec.ts:378` desktop, the Marca rebrand ("Salvar alterações" re-rendered disabled after `#primary` was filled)
  status: resolved
  **Verdict:** product bug (RESEARCH A3 holds), plus a separate test-design defect that only `--repeat-each` exposes.
  **Cause:** `TenantBrandingPage` keyed `BrandingForm` on `formKey(view)` = icon version, icons ready, logo URL, icon URL and both colours. Once the 3 s status poll sees `iconsReady`, the form calls `router.refresh()`. When that refresh lands, the server view has a new key (`iconsReady` false→true, `logoUrl` null→URL, `iconVersion` 0→1), so React remounts the form. Every action's `revalidatePath(layout)` does the same. A colour typed while the refresh is in flight is dropped, `dirty` becomes false, and "Salvar alterações" comes back disabled. 07-15's error says the button was "detached and re-rendered disabled". A re-render alone does not detach an element, but a key change does.
  **Trace evidence (08-02 reproduction, `--repeat-each=3 --trace=on`, first iteration, which passed):** the status action `POST …/marca` at 12:46:01.499Z returned `iconsReady`. `[data-icons-status="ready"]` became visible at test time 71 359 ms, and `fill #primary` started 14 ms later (71 373 ms). The poll's refresh `GET …/marca?_rsc=…` started at 12:46:01.577Z, during the fill and the click (71 384–71 424 ms). The save action was only sent at 12:46:02.044Z, queued behind that refresh by the router's sequential action queue. The pass and 07-15's failure differ only in whether the refresh lands before or after the click. In this run it landed between the click and the save. In 07-15 it landed between the fill and the click, which is exactly the observed failure.
  **Fix (08-02 Task 1):** the page keys the form on the tenant id only (`formKey(id)`). `BrandingForm` adopts a new `view` prop during render with its existing `applyView` rule: take the server view, and follow the server colours only when the user has not touched them. "Untouched" now also requires the raw fields to equal the persisted colours, so a half-typed invalid hex is never overwritten. A view older than the one on screen (lower `iconVersion`) is dropped, like a stale poll answer. Keying on the persisted colours too (the plan's first suggestion) was rejected: the refresh after a colour save carries the new colours, so the same remount would come back one save later. No markup, copy or `BrandingActions` change (D-342: 08-06 reuses the form).
  **Test-design defect:** `phase2-smoke.spec.ts` built one throwaway slug and host for every `--repeat-each` iteration. Repeat 2 then met the previous repeat's deleted host still answered by the API's host lookup (step (c): by-host 200 where the pre-verification 404 is asserted; the SQL fixture delete bypasses the API's host-cache invalidation). The suffix now carries `testInfo.repeatEachIndex` (the quick 261001-ere remedy). Repeat 0 keeps the old names.
  **Proof:** `BrandingForm.test.tsx` (new): 4/4 with the fix; against the pre-fix form, 2 failed (typed colour kept across the icons-ready refresh with "Salvar" enabled; untouched colours follow the refresh). Green run: `pnpm db:reset && pnpm db:seed && VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test phase2-smoke.spec.ts --project=desktop-chromium --repeat-each=3` gave exit 0, 15 passed (5 desktop cases x 3), 0 failed, 12.8 min. No timeout widened, no retry, no expectation removed. WINDOWS 71 fixed.

- WINDOWS #69 — `phase52-smoke.spec.ts:294` mobile, "Novo destaque" tapped but the create sheet never opened
  status: resolved
  **Verdict:** test-timing flake. The test taps before React hydrated the button. No product change.
  **Evidence:** in the 08-02 traces the "Gerenciar destaques do início" tap reaches `/stories/destaques` by a full document load (a `GET` with no `_rsc`). The heading is visible in the server HTML, and the test tapped "Novo destaque" 81 ms after that navigation. A throwaway probe held every `/_next/static/**` chunk for 4 s on that load. The tap landed on the button with no React props key (`hydrated at tap: false`), and after hydration finished, 0 create dialogs had opened: the tap was lost and never replayed. That is the 07-15 failure snapshot exactly (manage screen, no dialog). On a warm, lightly loaded dev server hydration beats the tap, which is why the case passed 18/18 in the 08-02 reproduction (`--repeat-each=3 --trace=on`) and failed once in the 788-test 07-15 run.
  **Fix (spec):** `createOnManageScreen` waits for React's hydration mark (the `__reactProps` key, the 02-14 `waitForHydration` signal) on "Novo destaque" before the tap. `stories.spec.ts` gets the same wait on its create tap after `page.goto`, which has the same latent race. No assertion loosened, no retry, no sleep. The 30 s bound is the 02-14 helper's bound for a cold compile.
  **Proof:** after a reset and seed, `playwright test phase52-smoke.spec.ts stories.spec.ts --project=mobile-chromium` gave exit 0, 44 passed and 1 skipped (stories.spec.ts:258, the desktop-only geometry case, skipped on mobile by design). After a second reset, `phase52-smoke.spec.ts --project=mobile-chromium --repeat-each=3` gave 18 passed, exit 0. WINDOWS 69 fixed.

- WINDOWS #70 — `stories.spec.ts:1636` mobile, Escape did not close "Editar destaque" after the remove step
  status: resolved
  **Verdict:** product bug in `HighlightEditSheet`, surfaced as a timing-dependent test failure.
  **Cause:** the remove is optimistic (`setRemoved` before `onRemove`), so the tapped "Remover" control unmounts in the click's own render and the browser drops focus to `<body>`. The sheet's focus trap (`useFocusTrap` in `BottomSheet`) listens for Escape on the panel only, so a key pressed while focus sits on `<body>` never reaches it. Escape only came back because the host's follow-up re-read (`loadHighlightEditAction`) calls `setEdit`. That changes `HighlightManager`'s `closeEdit` identity (it is not the STABLE callback the sheet's prop contract asks for), which re-arms the trap and moves focus back into the panel. The window is one server round trip.
  **Evidence:** 08-02 passing trace: "Remover" tapped at 13:10:18.21–.24Z, the re-read action at 18.287Z (24.6 ms), Escape at 18.330Z, about 18 ms after the re-read answered. A throwaway probe slowed every server action by 1.5 s: focus after the tap was `body`, and Escape pressed after the "Story removido do destaque." toast left the sheet open (`toHaveCount(0)` received 1 for 5 s), the 07-15 symptom. With the fix, the same probe showed focus on "Adicionar stories" and the sheet closed.
  **Fix (product, `packages/modules/stories/ui/HighlightEditSheet.tsx`):** a layout effect after an optimistic remove. When focus fell to `<body>`, it moves focus to "Adicionar stories", or to the sheet panel itself when that control is absent (archived). No markup or copy change (a ref on the main step's root). Unit case E8 in `highlight-edit-sheet.test.tsx` fails on the pre-fix sheet and passes with the fix (8/8), for both the active and the archived sheet.
  **Proof:** the mobile run above (exit 0, 44 passed, 1 skipped). `stories.spec.ts -g "create, rename, add the EXPIRED" --project=mobile-chromium --repeat-each=3` gave 3 passed, exit 0. WINDOWS 70 fixed.
  **Not changed (observation):** `HighlightManager` still passes an unstable `closeEdit`, so every edit re-read re-arms the trap and moves focus to the sheet's first control. That is a pre-existing focus jump for keyboard users after a cover change or a remove. It is out of this plan's scope and recorded here only.

- WINDOWS #64 — `feed.spec.ts:321` desktop double-tap like
  status: resolved
  **Verdict:** a like left over from an earlier run (07-13 verdict T), not a product bug. 07-13 made every FEED-04 case clear its own like before login and in `finally`.
  **Proof (08-02):** after a reset and seed, `feed.spec.ts -g "double tap" --project=desktop-chromium --repeat-each=5` gave exit 0, 15 passed. The grep also matches the describe title "…by tap and by double tap", so the three FEED-04 cases ran; "a double tap on the gallery likes exactly ONCE" passed 5 of 5. WINDOWS 64 fixed.

- WINDOWS #65 — the web `next typegen` / `next build` race on `apps/web/.next/types` (`ENOTEMPTY`)
  status: resolved
  **Verdict:** pipeline race, fixed by 07-15's `apps/web/turbo.json` override (`typecheck` depends on the package's own `build`). No further change.
  **Proof (08-02):** with the dev servers stopped, `rm -rf apps/web/.next && TURBO_CACHE=local:r pnpm turbo typecheck build --filter=@rede-social/web` ran twice in a row: both exit 0, 3/3 tasks each, 0 `ENOTEMPTY` lines. In both logs the web `build` (`next build`, 41 routes) finishes before `typecheck` (`next typegen && tsc --noEmit`) starts. WINDOWS 65 fixed.

- `e2e:pwa` — the production-build PWA suite, never run before 08-02
  status: resolved
  **Verdict:** green on its first run; nothing to triage.
  **Run (08-02, for the 08-12 gate report):** after a reset and seed, with no dev server running, `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web e2e:pwa` (`next build && next start -p 3100`, iPhone 14, Pixel 7 and desktop projects) gave exit 0: 46 passed, 5 skipped, 0 failed, 0 flaky. The five skips are by design: `pwa.spec.ts:104` "data-display-mode follows display-mode: standalone" on all three projects (desktop by project; on the two phones it skips at runtime with an annotation because Chromium ignores `display-mode` in `Emulation.setEmulatedMedia`, and real-device install stays the manual proof) and `events-prefetch.spec.ts:65` on pixel and desktop (it runs on one phone project only).

- 08-08 — browser `unhandledRejection: TypeError: Cannot read properties of undefined (reading 'waiting')` in the dev-server log
  status: open
  **What:** forwarded by `next dev` from the browser on feed pages during the e2e. It is not a CSP effect: the same feed case prints it once under `CSP_MODE=report-only` and once under `enforce`. No app source reads `.waiting`, so it comes from a dependency (the service-worker registration path is the likely reader). No test fails on it. Out of 08-08's scope; recorded only.

- 08-08 — `/_global-error` is the one prerendered HTML page, so its scripts carry no nonce
  status: open
  **What:** Next prerenders `/_global-error` (the root-layout crash page) at build time, so its framework scripts cannot carry the per-request nonce. Under `CSP_MODE=enforce` that page still renders its static HTML, but its scripts are blocked and report as violations. It is served only when the root layout itself throws. Revisit if Next lets this page render dynamically, or if a real-device report shows it.

- 08-08 — a `page.goto` issued right after `/plataforma/tenants/{id}` loads is aborted (`net::ERR_ABORTED`)
  status: open
  **What:** seen while writing the CSP walk; identical under `report-only`, so not a policy effect. The walk visits the tenant detail page last. Not investigated further (test-ordering only, no user-visible symptom known).

- 08-08 — full dev e2e under `CSP_MODE=enforce`: 8 desktop-only failures late in a 1.1 h run, 7 green on a fresh rerun, 1 order-dependent
  status: open
  **Run:** after a reset and seed, `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web e2e` (every spec enforced since 08-08) gave 735 passed, 125 skipped, 8 failed, all on `desktop-chromium`: platform-tenants 1 (status dialog not opened), push 1-2 (login never left `/entrar`), reels e6/e7 (30 s timeouts), stories 507/1332/1387/1440 (timeouts and a missing toast). The same cases passed on `mobile-chromium` in that run, and a CSP effect would fail on both projects alike.
  **Rerun:** after a fresh reset and seed, those four files on desktop gave 55 passed, 21 skipped, 1 failed: `stories.spec.ts:1440` ("Story publicado." toast not seen; the publish itself succeeded and landed on `/inicio`). Run alone it passes 3/3 under `enforce` and 3/3 under `report-only`. Verdict: dev-server load and order flakes, not a policy regression. Recorded for the 08-12 gate run.
