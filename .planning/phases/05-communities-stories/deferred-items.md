# Deferred items — Phase 5

Out-of-scope discoveries logged rather than fixed, per the executor's scope boundary ("only
auto-fix issues DIRECTLY caused by the current task's changes"). Each entry names what was
observed, why it is out of scope, and what would close it.

## From 05-03

### 1. `media-video.spec.ts:491` is FLAKY under full-suite parallelism

- **Observed:** running the WHOLE Playwright suite, `MEDIA-03 — the player opens in a sheet on the
  phone and a centred dialog on the desktop` failed with
  `strict mode violation: locator('[role="dialog"][aria-modal="true"]') resolved to 2 elements` —
  the second element is Next.js's own dev **Console Error overlay**, which is itself a dialog.
- **Cause (not this plan's):** the overlay opens on
  `unhandledRejection: TypeError: Cannot read properties of undefined (reading 'waiting')`, raised
  by the service-worker registration path when Playwright blocks SW registration. It is visible in
  every spec's web-server log and predates 05-03.
- **Verified out of scope:** the same spec passes in isolation (`playwright test
  media-video.spec.ts` — 13/13), and nothing in 05-03 touches the video player, the SW or the
  overlay.
- **To close:** either scope the locator to the player's own dialog, or make the SW registration
  component tolerate a blocked registration (`registration?.waiting`). The second is the real fix
  and belongs to whoever owns the PWA registration component.

### 2. `platform-branding.spec.ts:130` is FLAKY under full-suite parallelism

- **Observed:** `expect(getByText(/^Baixo /)).toHaveCount(0)` received 1 — the low-contrast warning
  had not yet cleared when the assertion ran.
- **Verified out of scope:** passes in isolation (`playwright test platform-branding.spec.ts` —
  3 passed, 2 skipped). It is a Phase 2 surface 05-03 does not touch.
- **To close:** replace the bare `toHaveCount(0)` with an `expect.poll` or an explicit wait on the
  saved state, in whichever plan next touches the branding panel.

### 3. The whole-suite Playwright run is SLOW and partly serial-dependent

- **Observed:** `playwright test` (all specs) takes ~18 minutes locally, and the two smoke files
  (`phase2-smoke`, `phase4-smoke`) fail later cases when an earlier case in the same file fails —
  so one stale assertion hides the next one behind it.
- **Out of scope:** a suite-structure change, not a feature change.
- **To close:** worth a look during Phase 8's hardening; not urgent while the phase-scoped runs
  (`playwright test <spec>`) stay fast.

## From 05-08

### 4. `feed.spec.ts:321` (the double-tap like) is FLAKY under full-suite parallelism

- **Observed:** in the phase-exit `pnpm verify` run, `FEED-04 — a double tap on the gallery likes
  exactly ONCE, not twice` failed: after `dblclick()` the card's "Descurtir" control was never
  found, so the optimistic like never registered.
- **Verified out of scope:** it passes in isolation immediately afterwards
  (`playwright test feed.spec.ts -g "a double tap on the gallery likes exactly ONCE"` — 2 passed),
  and 05-08 touches neither the feed's like path, the gallery, nor `DoubleTapHeart`.
- **Cause (suspected, not confirmed):** a `dblclick` is two synthetic pointer events with no
  guaranteed spacing; under a loaded machine the second can fall outside the component's own
  double-tap window, degrading the gesture to two single taps on a gallery slide — which does
  nothing. It joins entries 1 and 2 as the third member of the same family: a gesture or a timing
  assertion that is exact enough to be right and tight enough to be fragile under parallelism.
- **To close:** give the gesture an explicit wait on the optimistic state rather than trusting the
  synthetic event pair, in whichever plan next touches the feed's like path.

### 5. `pnpm verify` had to be taught to re-seed between the integration and e2e stages

Recorded here as the CONTEXT for a change 05-08 did make, so the next reader knows why the script
grew two commands rather than assuming it was decoration.

- **Observed:** the first full `pnpm verify` of the phase failed with SIX viewer-clock e2e cases
  timing out (`the first bar fills`, the tap/hold/swipe cases, the comment sheet). 05-07 had
  already recorded the cause as a standing environment fact — a `pnpm test:integration` pass leaves
  the demo tenant's fixed-id media assets with no `storage.objects` rows, so `MediaImage` never
  reports `load` and the clock never starts — but nobody had run the FULL chain, in which
  `test:integration` runs immediately before `e2e`.
- **Fixed in 05-08 (Rule 3):** `pnpm db:reset && pnpm db:seed` now sits between `spike:supavisor`
  and `e2e` in the `verify` script. The e2e suite legitimately requires a seeded database and the
  integration suite legitimately destroys part of it; making that explicit is what the standing
  environment fact prescribes, and CI runs the same chain.
- **Still open:** the underlying asymmetry. The integration suite's own sweeps remove storage
  objects for assets it did not create. Worth narrowing in Phase 8's hardening; the re-seed makes
  the gate honest in the meantime.
