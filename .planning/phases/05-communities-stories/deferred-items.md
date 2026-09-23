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
