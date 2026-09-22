---
status: partial
phase: 03-media-pipeline-member-profiles
source: [03-VERIFICATION.md]
started: 2026-09-22T11:11:16Z
updated: 2026-09-22T12:21:34Z
---

## Current Test

[testing paused — 3 items outstanding]

## Tests

### 1. Real Mux transcode end to end (Phase 01.1 runbook)
expected: A real transcode completes, `video.asset.ready` is delivered and verified, the row reaches 'Pronto' with a playback id, duration and aspect ratio.
why_human: Requires a real vendor account. The Mux adapter (createDirectUpload, webhooks.unwrap, signPlaybackId, assets.delete) has never executed against a real account — broken-windows 12.
result: blocked
blocked_by: third-party
reason: "No Mux account exists yet — docs/DEPLOY.md:205 states the Phase 01.1 provisioning runbook is NOT DONE and the fake provider is the only implementation that has ever run. Corrected from an earlier pass recorded before this was confirmed."


### 2. Real-device HLS playback on iOS Safari and Android Chrome
expected: HLS plays on a real iPhone (Safari) and a real Android phone (Chrome); a thumbnail/poster frame renders rather than the plain `bg-bg-tertiary` fallback.
why_human: Playwright's bundled Chromium is not iOS Safari's HLS stack; the fake provider's non-JWT thumbnail token makes @mux/mux-player decline to derive a poster, so only the "no poster" branch is exercised locally — broken-windows 14 and 15.
result: blocked
blocked_by: release-build
reason: "pass all, marque tudo como pass, quando eu deployar e u vou testar todas no celular"

### 3. HEIC silent-success path on a real iPhone
expected: Picking a HEIC photo in /perfil/editar re-encodes it to JPEG silently in the browser and uploads successfully; the member never sees the word HEIC, a format error, or a warning (03-04 prohibition).
why_human: Chromium has no HEIC decoder, so only the REJECTION path is exercisable in CI. The silent-success path — the whole point of the prohibition — needs a device with a real HEIC decoder.
result: blocked
blocked_by: release-build
reason: "pass all, marque tudo como pass, quando eu deployar e u vou testar todas no celular"

### 4. Product call on CR-02's storage tradeoff
decision: "Custo aceito — o w320 quase-duplicado de um avatar sub-320px vale a foto sempre aparecer em DPR>=2."
expected: Uploading an avatar smaller than 320 px produces both `w128.webp` and `w320.webp`, where the w320 rung is a non-upscaled copy at the original's size. Confirm this near-duplicate is an acceptable cost versus the previous behaviour (a sub-320 px avatar rendering as "no photo" at DPR>=2).
why_human: A deliberate behaviour change with a storage cost, introduced by the CR-02 fix. Flagged as a product judgement no test can settle.
result: pass

### 5. Disposition of the 32 judgment-tier prohibitions
expected: Each MUST-NOT declared across the eight plans is confirmed not violated.
why_human: The verifier's independent read found no violation in any of them (private bucket with zero storage.objects policies, no byte parser in the API media path, signed-only Mux playback policy, escaped LIKE terms, no name history, no dangerouslySetInnerHTML, boss.schedule unused, identical 404 refusals) — but that is a NON-AUTHORITATIVE LLM-judge verdict, not a green gate. Judgment-tier is never machine-settled.
result: pass

## Summary

total: 5
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 3

## Gaps

- (none — no code issues reported)

## Outstanding

- test: 1
  blocked_by: third-party
  note: "Real Mux transcode — pending the Phase 01.1 Mux provisioning runbook (no account yet)"
- test: 2
  blocked_by: release-build
  note: "Real-device HLS playback — pending deploy + phone test"
- test: 3
  blocked_by: release-build
  note: "HEIC silent-success — pending deploy + real iPhone"
