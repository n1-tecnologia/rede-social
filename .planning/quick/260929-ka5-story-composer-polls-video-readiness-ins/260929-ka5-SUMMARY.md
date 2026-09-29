---
phase: quick-260929-ka5
plan: 01
status: complete
subsystem: media / stories
tags: [hono, zod-openapi, drizzle, rls, nextjs, server-actions, react-hooks, next-intl, vitest, mux]
requires: [MEDIA-03 media broker, STORY-01 composer]
provides:
  - "GET /v1/media/{assetId} (owner-or-admin, no-store, one bare 404)"
  - "getAsset(ctx, assetId) in packages/core/server/media/service.ts"
  - "getMediaAsset + fetchAssetStatusAction (web)"
  - "useAssetReadiness polling hook"
affects: [apps/web story composer]
tech-stack:
  added: []
  patterns:
    - "setTimeout-chain poll with 1.5x backoff capped at 10 s; stored answer keyed by id as the stale-answer guard"
key-files:
  created:
    - apps/web/components/media/useAssetReadiness.ts
    - apps/web/components/media/useAssetReadiness.test.tsx
  modified:
    - packages/core/server/media/service.ts
    - apps/api/src/routes/media.ts
    - apps/api/tests/integration/media-playback.test.ts
    - apps/web/lib/media.ts
    - apps/web/app/(app)/configuracoes/midia/actions.ts
    - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
    - apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx
    - apps/web/messages/pt-BR/stories.json
decisions:
  - "Single-asset read is owner-or-admin with the delete lane's one-404 vocabulary (isOwnerOrAdmin shared with assertMayRetire)"
  - "Only history.processingNote is left unchanged: 'Você já pode publicar' applies to the composer only, not to the published-stories list"
metrics:
  duration: "~6 min"
  completed: 2026-09-29
actuals:
  tokens: 9900
  tasks: 3
  commits: 3
plan_head_before: a17fa77ffac11f953088500b8768b8aefcabff27
---

# Quick 260929-ka5: Story composer polls video readiness Summary

The story composer now re-reads an uploaded video's status through a new tenant-scoped `GET /v1/media/{assetId}`. It uses a 2 s → 10 s backoff poll (`useAssetReadiness`). The "Processando o vídeo…" row disappears at `ready`. A failed or rejected video shows the media catalog's error and blocks Publicar. The note now tells the admin they can already publish. This fixes the 2026-09-29 production incident, where the row stayed up forever.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Readiness read end-to-end: `getAsset` → `GET /v1/media/{assetId}` → `getMediaAsset` → `fetchAssetStatusAction` + integration matrix R1-R6 | f354318 |
| 2 | `useAssetReadiness` hook + fake-timer suite H1-H7 | b603bb4 |
| 3 | Composer wiring: processing row follows real status, failure alert, Publicar disabled on failure, new processing note + R1-R5 | c1773a3 |

## Verification

- `media-playback.test.ts`: 22/22 passed (16 existing + 6 new). RED first: 6 new failed, 16 passed.
  Run through a throwaway copy with `rede-` → `tria-` substitution (see Deviations). The copy was deleted after each run.
- `useAssetReadiness.test.tsx`: 8/8 passed, with no act/unmounted warnings in the output.
- `StoryComposer.test.tsx`: 25/25 passed (20 existing + 5 new). RED first: 4 failed. R2 already held under the old code.
- Full web unit suite: 41 files, 969/969 passed.
- API unit suite: 3 files, 19/19 passed.
- Typecheck: core, api and web clean. Biome: core, api and web clean. `scripts/check-ui-literals.sh` OK.
- `git diff --name-only a17fa77 -- packages/core/server/media/video apps/api/src/routes/webhooks apps/api/src/worker.ts apps/web/components/media/VideoUploadField.tsx` prints nothing.
- `grep -c "Você já pode publicar" apps/web/messages/pt-BR/stories.json` prints 1.

## Deviations from Plan

**1. [Rule 3 - Blocking] Local seed drift: integration suite run against a `tria-*` copy**
- **Found during:** Task 1 RED run.
- **Issue:** the local DB still carries the pre-rename seed. The tenants are `tria-demo`/`tria-lab` and the users are `*@tria-*.local`, because the 2026-09-28 rename was never followed by a local `db:reset`. Every seed-dependent integration file fails at sign-in (`member@rede-lab.local: Invalid login credentials`) before any test runs.
- **Fix:** no DB change, and no `db:reset` per instructions. Each run used a throwaway copy of the test file with `rede-demo`/`rede-lab` replaced by `tria-*`, plus `TENANT_DEMO_HOST`/`TENANT_LAB_HOST=tria-*.localhost`. The copy was deleted right after the run. The committed test file keeps the `rede-*` names.
- **Files modified:** none (scratch only).

**2. [Rule 1 - Bug] Catalog replace hit a second key**
- **Found during:** Task 3 grep gate (it printed 2).
- **Issue:** `history.processingNote` (the published-stories list) had the same old sentence, and the replace changed it too. "Você já pode publicar" is wrong there.
- **Fix:** restored `history.processingNote`. Only `publish.processingNote` changed.
- **Commit:** c1773a3

## Deferred Issues

- `apps/api/tests/integration/media.test.ts` (plan verification) could not be run green locally. Its `beforeAll` cleanup SQL fails with `events_cover_asset_id_media_assets_id_fk`: local events reference image assets that the sweep tries to delete. This happens before any API request, so it is unrelated to this change. The new route is one segment, and `media-playback.test.ts` proves that `/playback` still routes. Re-run after the user decides on a local `db:reset`.
- A local `db:reset` (user decision) would clear both the `tria-*` seed drift and the events FK drift.

## Known Stubs

None.

## Threat Flags

None. The new endpoint is the planned T-ka5-01..06 surface. The mitigations are in place:
- RLS tenant lane
- `isOwnerOrAdmin` with the same bare 404
- closed `MediaIssue` only, with `no-store`
- non-overlapping backoff poll
- Publicar disabled on failure
- uuid gates in both the action and the route

## Self-Check: PASSED

- FOUND: apps/web/components/media/useAssetReadiness.ts
- FOUND: apps/web/components/media/useAssetReadiness.test.tsx
- FOUND: f354318, b603bb4, c1773a3
