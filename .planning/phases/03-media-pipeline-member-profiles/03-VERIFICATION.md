---
phase: 03-media-pipeline-member-profiles
verified: 2026-09-22T11:07:34Z
status: human_needed
score: 3/4 must-haves verified
behavior_unverified: 1
overrides_applied: 0
covered_digest: "v1:sha256:5f4e45438c06410adf9b4767fc75eaaeb6a42015df5227dabeeba9f08dc0780d"
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-01-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-01-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-02-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-02-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-03-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-03-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-04-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-04-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-05-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-05-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-06-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-06-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-07-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-07-SUMMARY.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-08-PLAN.md"
  - ".planning/phases/03-media-pipeline-member-profiles/03-08-SUMMARY.md"
  - "apps/api/src/app.ts"
  - "apps/api/src/routes/me.ts"
  - "apps/api/src/routes/media.ts"
  - "apps/api/src/routes/members.ts"
  - "apps/api/src/routes/webhooks/mux.ts"
  - "apps/api/src/worker.ts"
  - "apps/api/tests/integration/bootstrap.test.ts"
  - "apps/api/tests/integration/isolation.test.ts"
  - "apps/api/tests/integration/media-playback.test.ts"
  - "apps/api/tests/integration/media-sweeper.test.ts"
  - "apps/api/tests/integration/media.test.ts"
  - "apps/api/tests/integration/members.test.ts"
  - "apps/api/tests/integration/mux-webhook.test.ts"
  - "apps/api/tests/integration/profile.test.ts"
  - "apps/api/tests/integration/setup.ts"
  - "apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx"
  - "apps/web/app/(app)/configuracoes/midia/actions.ts"
  - "apps/web/app/(app)/configuracoes/midia/loading.tsx"
  - "apps/web/app/(app)/configuracoes/midia/page.tsx"
  - "apps/web/app/(app)/configuracoes/page.tsx"
  - "apps/web/app/(app)/inicio/page.tsx"
  - "apps/web/app/(app)/membros/MembersList.test.ts"
  - "apps/web/app/(app)/membros/MembersList.tsx"
  - "apps/web/app/(app)/membros/[membershipId]/loading.tsx"
  - "apps/web/app/(app)/membros/[membershipId]/not-found.tsx"
  - "apps/web/app/(app)/membros/[membershipId]/page.tsx"
  - "apps/web/app/(app)/membros/actions.ts"
  - "apps/web/app/(app)/membros/loading.tsx"
  - "apps/web/app/(app)/membros/page.tsx"
  - "apps/web/app/(app)/perfil/actions.ts"
  - "apps/web/app/(app)/perfil/editar/EditProfileForm.tsx"
  - "apps/web/app/(app)/perfil/editar/loading.tsx"
  - "apps/web/app/(app)/perfil/editar/page.tsx"
  - "apps/web/app/(app)/perfil/loading.tsx"
  - "apps/web/app/(app)/perfil/page.tsx"
  - "apps/web/app/v1/media/[assetId]/[variant]/route.ts"
  - "apps/web/components/media/AvatarUploadField.test.ts"
  - "apps/web/components/media/AvatarUploadField.tsx"
  - "apps/web/components/media/MediaAssetRow.tsx"
  - "apps/web/components/media/MediaImage.tsx"
  - "apps/web/components/media/VideoPlayer.tsx"
  - "apps/web/components/media/VideoUploadField.tsx"
  - "apps/web/components/media/useSignedUpload.ts"
  - "apps/web/components/profile/MemberRow.tsx"
  - "apps/web/components/profile/ProfileHeader.tsx"
  - "apps/web/components/profile/ProfileNudgeCard.tsx"
  - "apps/web/e2e/admin.ts"
  - "apps/web/e2e/fixtures/README.md"
  - "apps/web/e2e/fixtures/huge.jpg"
  - "apps/web/e2e/fixtures/iphone.heic"
  - "apps/web/e2e/fixtures/large.jpg"
  - "apps/web/e2e/fixtures/sample.mp4"
  - "apps/web/e2e/login.spec.ts"
  - "apps/web/e2e/media-fixtures.ts"
  - "apps/web/e2e/media-upload.spec.ts"
  - "apps/web/e2e/media-video.spec.ts"
  - "apps/web/e2e/members-admin.ts"
  - "apps/web/e2e/members.spec.ts"
  - "apps/web/e2e/phase3-smoke.spec.ts"
  - "apps/web/e2e/profile.spec.ts"
  - "apps/web/e2e/shell.spec.ts"
  - "apps/web/e2e/signup.spec.ts"
  - "apps/web/lib/media.ts"
  - "apps/web/lib/profile.ts"
  - "apps/web/lib/upload.test.ts"
  - "apps/web/lib/upload.ts"
  - "apps/web/messages/pt-BR/app.json"
  - "apps/web/messages/pt-BR/media.json"
  - "apps/web/messages/pt-BR/members.json"
  - "apps/web/messages/pt-BR/profile.json"
  - "apps/web/package.json"
  - "biome.json"
  - "docs/DEPLOY.md"
  - "packages/contracts/package.json"
  - "packages/contracts/src/errors.ts"
  - "packages/contracts/src/media.ts"
  - "packages/contracts/src/profiles.ts"
  - "packages/core/db/schema/index.ts"
  - "packages/core/db/schema/media-assets.ts"
  - "packages/core/db/schema/media-provider-events.ts"
  - "packages/core/db/schema/member-profiles.ts"
  - "packages/core/package.json"
  - "packages/core/server/env.ts"
  - "packages/core/server/http/api-error.ts"
  - "packages/core/server/media/derive-job.ts"
  - "packages/core/server/media/index.ts"
  - "packages/core/server/media/inspect.ts"
  - "packages/core/server/media/keys.ts"
  - "packages/core/server/media/limits.ts"
  - "packages/core/server/media/service.ts"
  - "packages/core/server/media/storage.ts"
  - "packages/core/server/media/sweep-job.ts"
  - "packages/core/server/media/variants.ts"
  - "packages/core/server/media/video/event-job.ts"
  - "packages/core/server/media/video/fake.ts"
  - "packages/core/server/media/video/inbox.ts"
  - "packages/core/server/media/video/index.ts"
  - "packages/core/server/media/video/mux.ts"
  - "packages/core/server/media/video/types.ts"
  - "packages/core/server/media/video/wire.ts"
  - "packages/core/server/paging.ts"
  - "packages/core/server/profiles/index.ts"
  - "packages/core/server/profiles/search.ts"
  - "packages/core/server/profiles/service.ts"
  - "packages/core/tests/fixtures/iphone.heic"
  - "packages/core/tests/media-video.test.ts"
  - "packages/core/tests/media.test.ts"
  - "packages/core/tests/profiles-search.test.ts"
  - "packages/core/tests/profiles.test.ts"
  - "packages/core/ui/nav.ts"
  - "packages/ui/src/index.ts"
  - "packages/ui/src/primitives/Avatar.tsx"
  - "packages/ui/src/primitives/FileDropZone.tsx"
  - "packages/ui/src/primitives/PageHeader.tsx"
  - "packages/ui/src/primitives/SearchBar.tsx"
  - "packages/ui/src/primitives/Textarea.tsx"
  - "packages/ui/tests/button.test.tsx"
  - "pnpm-lock.yaml"
  - "scripts/seed.ts"
  - "supabase/config.toml"
  - "supabase/migrations/20260921182418_media_assets.sql"
  - "supabase/migrations/20260921182426_media_bucket.sql"
  - "supabase/migrations/20260921190226_member_profiles.sql"
  - "supabase/migrations/20260921190227_member_profiles_search.sql"
  - "supabase/migrations/20260922020438_media_provider_events.sql"
  - "supabase/migrations/20260922020621_media_bucket_video.sql"
  - "supabase/migrations/meta/20260921182418_snapshot.json"
  - "supabase/migrations/meta/20260921182426_snapshot.json"
  - "supabase/migrations/meta/20260921190226_snapshot.json"
  - "supabase/migrations/meta/20260921190227_snapshot.json"
  - "supabase/migrations/meta/20260922020438_snapshot.json"
  - "supabase/migrations/meta/20260922020621_snapshot.json"
  - "supabase/migrations/meta/_journal.json"
  - "supabase/tests/010-rls-coverage.sql"
  - "supabase/tests/020-tenant-isolation.sql"
  - "supabase/tests/040-schema-conventions.sql"
  - "supabase/tests/070-media-bucket.sql"
  - "supabase/tests/080-member-profiles.sql"
behavior_unverified_items:
  - truth: "SC4 (vendor half) — `admin_tenant` uploads a phone-recorded video (including iPhone HEVC) that is transcoded by the chosen streaming vendor and plays back as HLS with a thumbnail on iOS Safari and Android Chrome"
    test: "After the Phase 01.1 Mux runbook in docs/DEPLOY.md (create account, webhook endpoint, signing key, signed playback policy, five GCP secrets, VIDEO_PROVIDER=mux): sign in as admin_tenant, upload a video recorded on an iPhone (HEVC/.mov) from /configuracoes/midia, watch the row, then open the player on a real iPhone (Safari) and a real Android device (Chrome)."
    expected: "Mux accepts the direct upload, the row shows the 'Processando' pill, the signed webhook lands, the row flips to 'Pronto', and <mux-player> plays HLS with a visible thumbnail/poster on BOTH real device stacks."
    why_human: "No Mux account exists (Phase 01.1 is deferred by user decision); every automated proof in the phase runs on VIDEO_PROVIDER=fake, whose direct-upload target is Supabase Storage and whose tokens are deterministic non-JWTs. Playwright bundles Chromium, which cannot stand in for iOS Safari's HLS stack. Broken-windows 12, 14 and 15 record exactly this."
human_verification:
  - test: "Run the Phase 01.1 Mux runbook (docs/DEPLOY.md) and upload an iPhone-recorded HEVC video end to end with VIDEO_PROVIDER=mux."
    expected: "A real transcode completes, `video.asset.ready` is delivered and verified, the row reaches 'Pronto' with a playback id, duration and aspect ratio."
    why_human: "Requires a real vendor account. The Mux adapter (createDirectUpload, webhooks.unwrap, signPlaybackId, assets.delete) has never executed against a real account — broken-windows 12."
  - test: "On a real iPhone (Safari) and a real Android phone (Chrome), open a `ready` video and confirm playback and the poster still."
    expected: "HLS plays; a thumbnail/poster frame renders rather than the plain bg-bg-tertiary fallback."
    why_human: "Playwright's bundled Chromium is not iOS Safari's HLS stack; and the fake provider's non-JWT thumbnail token makes @mux/mux-player decline to derive a poster, so only the 'no poster' branch is ever exercised locally — broken-windows 14 and 15."
  - test: "On a real iPhone, pick a HEIC photo in /perfil/editar and complete the avatar upload."
    expected: "The photo is silently re-encoded to JPEG in the browser and uploads successfully; the member never sees the word HEIC, a format error, or a warning (03-04 prohibition)."
    why_human: "Chromium has no HEIC decoder, so only the REJECTION path is exercisable in CI. The silent-success path — the whole point of the prohibition — needs a device with a real HEIC decoder."
  - test: "Product call on CR-02's storage tradeoff: upload an avatar smaller than 320 px and inspect the derived objects."
    expected: "Both `w128.webp` and `w320.webp` exist; the `w320` rung is a non-upscaled copy at the original's size. Confirm this near-duplicate is an acceptable cost versus the previous behaviour (a sub-320 px avatar rendering as 'no photo' at DPR>=2)."
    why_human: "A deliberate behaviour change with a storage cost. The fixer flagged it as a product judgement no test can settle."
  - test: "Review and dispose of the 32 judgment-tier prohibitions declared across the eight plans (all marked `status: resolved`)."
    expected: "Each MUST-NOT is confirmed not violated. This verifier's independent read found no violation in any of them (private bucket with zero storage.objects policies, no byte parser in the API media path, signed-only Mux playback policy, escaped LIKE terms, no name history, no dangerouslySetInnerHTML, boss.schedule unused, identical 404 refusals), but a judgment-tier prohibition is never machine-settled."
    why_human: "verification: judgment on all 32 — a NON-AUTHORITATIVE LLM-judge verdict is recorded here, not a green gate."
advisory:
  - finding: "WR-02 — an oversized VIDEO is routed through the browser's IMAGE re-encoder (`normaliseImage`) in `useSignedUpload.pick`, so the member is told 'Não foi possível preparar esta imagem. Tente outra foto.' and is never shown the size limit. `errors.size` with its `{limit}` interpolation is never reached for the video kind."
    category: other
    reason: "Found by 03-REVIEW, explicitly deferred by the user with the other seven warnings. It does not breach SC3's literal wording (the confirmation-time server refusals are correct, specific and clear), but it is the one place in the phase where a refusal message is wrong for the kind of file the member picked."
    evidence_status: "confirmed by reading apps/web/components/media/useSignedUpload.ts:145-158 and apps/web/messages/pt-BR/media.json; user-deferred, not a gap"
  - finding: "WR-08 — `completeUpload` is still drivable by any member of the tenant holding a `pending` asset id: it calls `loadOwnAsset` (tenant-scoped via RLS) and never `assertMayRetire`. Shares CR-01's root cause; CR-01 was fixed on DELETE only."
    category: security
    reason: "Explicitly left open by the fixer and deferred by the user. Intra-tenant only — no cross-tenant consequence, and the isolation suite still holds. The close is a one-line `assertMayRetire(ctx, row)` in `completeUpload` plus a test."
    evidence_status: "confirmed by reading packages/core/server/media/service.ts:512-530; user-deferred, not a gap"
  - finding: "WR-04 — `applyReady` writes `status: 'ready'` with `playbackId: event.playbackId` and no null guard, so a `video.asset.ready` carrying no playback id shows 'Pronto' in the admin list while `GET /{assetId}/playback` answers 404."
    category: other
    reason: "Degraded honesty on criterion 4's own surface, not a leak: `playbackTokens` refuses a null playbackId explicitly. Deferred by the user with the other warnings."
    evidence_status: "confirmed by reading packages/core/server/media/video/event-job.ts:135-159 and service.ts:727; user-deferred, not a gap"
  - finding: "Broken-windows ledger hygiene: entry 13 says `signPlayback` is 'wired to no route yet: 03-07 adds GET /v1/media/{assetId}/playback' — that route now exists and is tested, so only the `getAsset` half of the entry is still true. Entry 10 says '/configuracoes Editar perfil is an Em breve placeholder' — 03-04 made it a real link, so only the 'Notificações' half is still true."
    category: other
    reason: "Two ledger entries are now half-stale. Cosmetic, but a stale ledger is what makes `windows_enforce` noise."
    evidence_status: "confirmed against apps/api/src/routes/media.ts and apps/web/app/(app)/configuracoes/page.tsx:124"
---

# Phase 3: Media Pipeline & Member Profiles Verification Report

**Phase Goal:** Members have a profile with photo, name and bio and can find each other inside their tenant; the platform accepts images, files and phone video safely under tenant scope through a single upload broker that every later module reuses.
**Verified:** 2026-09-22T11:07:34Z
**Status:** human_needed
**Re-verification:** No — initial verification

> Every result below was produced by this verifier running the commands itself against the live local
> Supabase stack at `22cf838`, on the tree as it stands. No number is copied from a SUMMARY.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Member uploads a profile photo from a phone (browser → Storage via an API-brokered signed URL; bytes never transit Cloud Run), edits display name and bio, and sees the photo through a signed, tenant-checked URL in worker-produced display sizes | ✓ VERIFIED | `startUpload` returns `{signedUrl, token, path}` and inserts a `pending` row keyed `<tenantId>/media/<assetId>/original` (`service.ts:334-400`); **no byte parser exists** — `grep -rn "arrayBuffer()\|formData()\|multipart"` over `apps/api/src/routes/media.ts` + `packages/core/server/media/` returns nothing; the browser transfers via XHR `PUT` ≤ 6 MiB and `tus-js-client` above (`apps/web/lib/upload.ts`, deps pinned `tus-js-client@4.3.1`); `PATCH /v1/me/profile` writes name+bio under the `member_profiles_self_update` RLS policy; `MediaImage` renders only `/v1/media/{assetId}/{variant}`, which 302s to a freshly signed URL with **zero DB reads** (`serveVariant`). Live worker logs during the integration run: `media.variants_derived widths:[128,320] ms:25`. **`phase3-smoke.spec.ts` test 1 passed on the iPhone-14 `mobile-chromium` project.** |
| 2 | Member opens another member's profile and browses a paginated, name-searchable directory that only ever lists members of their own tenant | ✓ VERIFIED | `GET /v1/members` runs inside `withTenantTx` (`set local role authenticated` + LOCAL claims) against `member_profiles_tenant_select` (`tenant_id = app.tenant_id()`); keyset paging over `app.imm_unaccent(lower(display_name)), mp.id`; `q` escaped as a literal with `escape '\'`; `role='member' and status='active' and deleted_at is null`. **Live: isolation case `n` — tenant B gets 404 on A's membershipId and A's name never appears in B's list, with positive controls both ways. `members.spec.ts` 74 tests passed; `phase3-smoke` test 2 (`goncal` → João Gonçalves) passed.** |
| 3 | An over-cap or disallowed-type upload is rejected with a clear message at confirmation time (magic-byte + size validation); valid images are resized into display sizes within seconds; original limits are enforced per kind | ✓ VERIFIED | `complete` re-reads size and contentType from Storage, decodes the **header only** with sharp, and on refusal removes the object and answers a machine code from `MEDIA_ISSUES` (`not_an_image` / `format_mismatch` / `heic_unsupported` / `too_large`) mapped to pt-BR copy. `inspect.ts` checks `heif` FIRST (before the declared-mime compare) and gates PDFs on the `%PDF-` magic bytes; `limitFor(kind, purpose)` is the per-kind cap; the bucket is pinned PRIVATE at 52 428 800 bytes with no `image/svg+xml` by `070-media-bucket.sql`. Resize latency measured live at 20–26 ms. See Advisory WR-02 for the one place a refusal message is wrong for the picked kind (client pick-time, video only). |
| 4 | `admin_tenant` uploads a phone HEVC video, the vendor transcodes it, it plays as HLS with a thumbnail on iOS Safari and Android Chrome, showing "processando" until ready; **the isolation suite proves a tenant-B session cannot obtain a signed URL for a tenant-A object** | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | **Isolation half: ✓ proven live.** `isolation.test.ts` 18/18 passed under this verifier: case `j` asserts a tenant-B session gets **404 with no `Location` header** and a body containing neither tenant slug, name nor id, with positive controls showing each tenant reaching its own `…/w320.webp`; case `k` does the same for playback tokens. **Vendor/device half: not behaviourally proven.** The full path is present and wired (admin-only gate at `startUpload`, UpChunk resumable direct upload, `playback_policies:['signed']`, signature-verified webhook with `event.id` as PK, `applyReady`, the three-state `VideoPlayer` with the "Processando o vídeo…" frame) and `media-video.spec.ts` + `phase3-smoke` test 3 passed — but **every one of those proofs runs on `VIDEO_PROVIDER=fake`**. No real transcode, no real signed thumbnail, no real-device HLS has ever been observed (broken-windows 12, 14, 15). Routed to Human Verification. |

**Score:** 3/4 truths verified (1 present, behaviour-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| 03-01 (14 artifacts) | media broker kernel, schema, routes, pgTAP, tests | ✓ VERIFIED | `verify.artifacts` 14/14; `service.ts` 1061 lines, `media.ts` routes 218 lines — substantive, not stubs |
| 03-02 (7) | profiles contract, schema, service, `/v1/me/profile`, pgTAP 080 | ✓ VERIFIED | 6/7 by tool; the 7th (`supabase/migrations/*_member_profiles_search.sql`) is a **glob the tool cannot expand** — `20260921190227_member_profiles_search.sql` exists on disk |
| 03-03 (6) | directory search + `/v1/members` | ✓ VERIFIED | 6/6 |
| 03-04 (11) | profile screens, upload hook, `MediaImage` | ✓ VERIFIED | 11/11 |
| 03-05 (9) | `/membros`, `MemberRow`, nudge card | ✓ VERIFIED | 9/9 |
| 03-06 (9) | video seam, Mux + fake adapters, webhook | ✓ VERIFIED | 9/9; `mux.ts` is a complete real adapter (166 lines), not a stub |
| 03-07 (8) | playback route, `VideoPlayer`, admin media screen | ✓ VERIFIED | 8/8 |
| 03-08 (6) | sweeper, isolation suite, phase smoke, DEPLOY.md | ✓ VERIFIED | 6/6 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/api/src/app.ts` | `routes/media.ts` | `.route('/v1/media', mediaRoutes)` | ✓ WIRED | |
| `media/service.ts` | `jobs/boss.ts` | `enqueueInTx(..., { singletonKey: assetId })` in the same tx as `status='processing'` | ✓ WIRED | |
| `media/derive-job.ts` | `media/service.ts` | `deriveAssetVariants(tenantId, assetId)` | ✓ WIRED | job→service direction only |
| `media/service.ts` | `media/keys.ts` | `assertTenantKey(key, ctx.tenantId)` before every Storage call | ✓ WIRED | 6 call sites: start, complete, serve, derive ×2, purge ×2 |
| `media/index.ts` | `jobs/boss.ts` | `registerJobQueues([...])` at import time | ✓ WIRED | tool reported a miss on the literal `registerJobQueues([MEDIA_DERIVE_QUEUE])`; the actual line is `registerJobQueues([MEDIA_DERIVE_QUEUE, MEDIA_SWEEP_QUEUE])` — **false positive** |
| `apps/api/src/worker.ts` | `media/derive-job.ts` | `deriveVariantsJob` in the job list | ✓ WIRED | |
| `biome.json` | `packages/core/server/media/**` | admin-lane exclusion | ✓ WIRED | `pnpm boundaries` + `:negative` + `guard:lanes` all green |
| `media/sweep-job.ts` | `jobs/boss.ts` | `startAfter: MEDIA_SWEEP_INTERVAL_S` | ✓ WIRED | tool looked in the job file; the re-arm is in `service.ts:942-952` (`armSweeper`) by design — **false positive** |
| 03-03/04/05/06/07 links | — | — | ✓ WIRED | 20/20 verified by tool |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ProfileHeader` / `/perfil` | `displayName`, `bio`, `avatarAssetId` | `GET /v1/me/profile` → `member_profiles` row via `withTenantTx` | Yes (live e2e + integration) | ✓ FLOWING |
| `MembersList` / `/membros` | `items`, `nextCursor` | `GET /v1/members` → keyset SQL over `member_profiles ⋈ memberships` | Yes (4 rows returned in the live run) | ✓ FLOWING |
| `MediaImage` | `src`, `srcSet` | `/v1/media/{id}/w{n}` → 302 → signed Storage URL | Yes (live 302 with `…/media/…/w320.webp`) | ✓ FLOWING |
| `MediaLibrary` / `/configuracoes/midia` | `items` | `GET /v1/media` (admin-only) → `media_assets` keyset | Yes | ✓ FLOWING |
| `VideoPlayer` (ready) | `tokens.playback/thumbnail/storyboard` | `GET /{assetId}/playback` → `videoProvider.signPlayback` | Yes under `fake`; **never under `mux`** | ⚠️ see truth 4 |

### Behavioural Spot-Checks

| Behaviour | Command | Result | Status |
|-----------|---------|--------|--------|
| Cross-tenant signed-URL refusal + full Phase-3 isolation surface | `npx vitest run tests/integration/isolation.test.ts` | 18/18 passed (2.14 s) | ✓ PASS |
| Whole API integration surface | `npx vitest run tests/integration` | 22 files, **317/317 passed** (34.13 s) | ✓ PASS |
| RLS / bucket / schema invariants | `bash scripts/supabase.sh test db` | 9 files, **128/128 passed** | ✓ PASS |
| Workspace unit tests | `pnpm turbo test` | **386 passed** (contracts 57, ui 42, core 190, api 15, web 82) | ✓ PASS |
| Full web e2e (incl. every Phase-3 spec) | `npx playwright test` | **271 passed / 41 skipped** (19.3 m), exit 0 | ✓ PASS |
| The phase-goal walk on a phone | `npx playwright test phase3-smoke.spec.ts --project=mobile-chromium` | **3/3 passed** (18.4 s) | ✓ PASS |
| Schema ↔ migrations agree | `pnpm db:generate && git status --porcelain -- supabase/migrations` | "No schema changes"; porcelain empty | ✓ PASS |
| Lint / typecheck | `pnpm lint`, `pnpm turbo typecheck` | 7 + 8 tasks green; `check-ui-literals` OK | ✓ PASS |
| Module boundaries + lane guard | `pnpm boundaries`, `:negative`, `guard:lanes` | 417 files / 7 packages clean; both layers reject the fixture | ✓ PASS |
| Real Mux transcode | — | no account (`VIDEO_PROVIDER=fake` everywhere) | ? SKIP → human |
| Real-device iOS/Android HLS + poster | — | Playwright bundles Chromium | ? SKIP → human |

**This closes the orchestrator's stated concern:** the full test chain *has* now been re-run against the tree that includes `d3e4d81` (CR-01) and `86c0b14` (CR-02). Unit 386, pgTAP 128, integration 317 and e2e 271/41 all match the pre-fix `ddd6f23` gate numbers except where the fixes deliberately added cases (integration 313 → 317).

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| — | — | No `scripts/*/tests/probe-*.sh` exists; the phase declares none | SKIPPED (no probes in this repo) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| TENANT-04 | 03-01, 02, 03, 06, 07, 08 | Storage objects under tenant-scoped paths, served only through signed, tenant-checked URLs | ✓ SATISFIED | Keys are a pure function of `ctx.tenantId`; `assertTenantKey` before every Storage call; private bucket with **zero** `storage.objects` policies (pgTAP 070); isolation cases j/k/l/m/n/o/p green |
| MEDIA-01 | 03-01, 04, 08 | Direct browser→Storage via API-brokered signed URLs; API confirms and records with tenant scope | ✓ SATISFIED | No byte parser in the API media path; `complete` verifies, re-reads and records |
| MEDIA-02 | 03-01, 04, 08 | Worker-side resize into display sizes; size/type limits enforced (50 MB) | ✓ SATISFIED | `kernel.media-derive-variants` in `worker.ts`; bucket pinned at 52 428 800; `MEDIA_LIMITS` per kind+purpose |
| MEDIA-03 | 03-06, 07, 08 | Video to a streaming vendor that transcodes and serves HLS with thumbnails; playback works on iOS and Android | ? NEEDS HUMAN | Every code path exists and is wired; the "works on iOS and Android" clause has never been observed — see truth 4 |
| PROF-01 | 03-02, 04, 05, 08 | Profile with photo, display name and bio, member-editable | ✓ SATISFIED | `member_profiles` + `/perfil`, `/perfil/editar`, `PATCH /v1/me/profile` |
| PROF-02 | 03-03, 05, 08 | View another member's profile within the same tenant | ✓ SATISFIED | `GET /v1/members/{membershipId}`, `.strict()` shape, `/membros/[membershipId]` |
| PROF-03 | 03-03, 05, 08 | Searchable, paginated member list of the tenant | ✓ SATISFIED | Accent-folded substring search + keyset paging, page size 25 |

**Orphans:** none. All 7 IDs the phase declares are claimed by at least one plan, and no other ID in REQUIREMENTS.md maps to Phase 3.

**Note on REQUIREMENTS.md:** all 7 rows are already marked `Complete`. That is a claim written during execution, not evidence; this report is the evidence. MEDIA-03's "playback works on iOS and Android" clause is **not** yet true-by-observation and its `Complete` marking is optimistic.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` across all 138 changed source files | — | **None found.** Debt-marker gate passes clean |
| — | — | `TODO` / `HACK` / `PLACEHOLDER` | — | **None found** |
| `apps/web/components/profile/MemberRow.tsx` | 39 | `dangerouslySetInnerHTML` | ℹ️ Info | Appears only inside a docblock asserting its absence — **not a violation** |
| `apps/web/app/(app)/configuracoes/page.tsx` | — | "Em breve" pill | ℹ️ Info | One pill remains, on "Notificações" (Phase 7, broken-windows 10). "Editar perfil" is now a real `<Link href="/perfil/editar">` — verified at line 124 and pinned by `shell.spec.ts:174` (`toHaveCount(1)`) |

### Prohibitions (32 declared across 8 plans, all `verification: judgment`)

Judgment-tier, therefore a **NON-AUTHORITATIVE LLM-judge verdict** — never a green gate. This verifier independently read the code behind the load-bearing ones and found **no violation**:

| Prohibition | Judge verdict | What was read |
|-------------|---------------|---------------|
| No media object reachable without a fetch-time membership re-check | not violated | Private bucket, zero `storage.objects` policies (pgTAP 070), every read a per-request 302 |
| A foreign-asset refusal never discloses existence or owner | not violated | Isolation cases j/k/n/o assert the body contains no tenant slug/name/id |
| File bytes never in an API request body | not violated | `grep` for `arrayBuffer()`/`formData()`/`multipart` over the media path returns nothing |
| Derivation never in the request path | not violated | `deriveVariantsJob` registered in `worker.ts`; `complete` calls only `inspectMediaImage` |
| No SVG avatar, no escape hatch | not violated | `MIME_TO_FORMAT` has no vector entry; bucket allow-list excludes `image/svg+xml` |
| Search term never a pattern | not violated | `likeEscape` + `escape '\'` in the statement |
| No display-name history / approval | not violated | No `previous_name`/`name_history` column anywhere in `packages/core/db/schema/` |
| Nudge is server state, not device state | not violated | `member_profiles.nudge_dismissed_at`; `members.spec.ts:522` proves it survives a new browser context |
| Video never published with a public playback policy | not violated | `playback_policies: ['signed']` in `mux.ts`, the only file importing `@mux/mux-node` |
| Playback token never cached or persisted | not violated | Route sets `Cache-Control: no-store`; log line carries the asset id only |
| Name/bio never rendered as markup | not violated | No `dangerouslySetInnerHTML` outside a docblock; no Markdown renderer |
| No second scheduling mechanism | not violated | `grep` for `boss.schedule` / `.schedule(` over `jobs/` and `apps/api/src/` returns nothing |
| The other 20 | not violated | Read in context while verifying the four criteria |

⚠️ **`unverified-prohibition — human review recommended`** for all 32: a judgment-tier MUST-NOT is never machine-settled.

### Human Verification Required

#### 1. Real Mux transcode (blocks the vendor half of criterion 4)
**Test:** Run the Phase 01.1 Mux runbook in `docs/DEPLOY.md` (account, webhook endpoint, signing key, signed playback policy, the five GCP Secret Manager entries, `VIDEO_PROVIDER=mux`), then upload an iPhone-recorded HEVC `.mov` from `/configuracoes/midia` as `admin_tenant`.
**Expected:** Mux accepts the direct upload; the row carries the "Processando" pill; the signed `video.asset.ready` webhook is verified and the row flips to "Pronto" with a playback id, duration and aspect ratio.
**Why human:** No Mux account exists. `packages/core/server/media/video/mux.ts` has **never executed** against a real account (broken-windows 12).

#### 2. Real-device HLS playback with a thumbnail
**Test:** Open a `ready` video on a real iPhone (Safari) and a real Android phone (Chrome).
**Expected:** HLS plays; a poster/thumbnail still renders instead of the plain `bg-bg-tertiary` fallback.
**Why human:** Playwright bundles Chromium, which is not iOS Safari's HLS stack; and the fake provider's non-JWT thumbnail token makes `@mux/mux-player@3.13.4` decline to derive a poster, so only the "no poster" branch is ever exercised locally (broken-windows 14, 15).

#### 3. The HEIC silent-success path
**Test:** On a real iPhone, pick a HEIC photo in `/perfil/editar`.
**Expected:** Silent browser re-encode to JPEG and a successful upload — the member never sees the word HEIC, a format error, or a warning.
**Why human:** Chromium has no HEIC decoder, so CI can only exercise the *rejection* path. The silent-success path is the whole point of the 03-04 prohibition.

#### 4. CR-02 product call
**Test:** Upload an avatar smaller than 320 px and inspect the derived objects.
**Expected:** Both `w128.webp` and `w320.webp` exist, the `w320` rung being a non-upscaled copy at the original's size. Confirm the near-duplicate is an acceptable cost against the alternative (a sub-320 px avatar rendering as "no photo" at DPR ≥ 2).
**Why human:** A deliberate behaviour change with a storage tradeoff; no test can settle a product call.

#### 5. Judgment-tier prohibition disposition
**Test:** Review the 32 `verification: judgment` prohibitions and their judge verdicts in the table above.
**Expected:** Each confirmed not violated, or a specific one challenged.
**Why human:** Judgment-tier by declaration.

### Advisory (WARNING-level, user-deferred — not counted against the score)

These are **category (c)**: found by `03-REVIEW.md`, and the user explicitly chose "Fix CR-01 + CR-02 now" and deferred the eight warnings and four info items. Recorded here so the deferral stays visible, not as gaps.

| # | Finding | Severity | Why it matters to this phase's criteria |
|---|---------|----------|------------------------------------------|
| 1 | **WR-02** — an oversized *video* is run through the browser's *image* re-encoder, so the member reads "Não foi possível preparar esta imagem. Tente outra foto." and is never shown the limit. `errors.size` with `{limit}` is never reached for the video kind. | ⚠️ Warning | The one place in the phase where a refusal message is wrong for the picked kind. SC3's literal clause ("at confirmation time") is still met — the *server* refusals are correct and specific — but the pick-time copy is not. Confirmed at `useSignedUpload.ts:145-158`. |
| 2 | **WR-08** — `completeUpload` is still drivable by any member of the tenant holding a `pending` asset id (`loadOwnAsset` is tenant-scoped, not owner-scoped; `assertMayRetire` is not called). | ⚠️ Warning | Shares CR-01's root cause; CR-01 was closed on `DELETE` only. **Intra-tenant only** — no cross-tenant consequence, and criterion 4's isolation half is untouched. The close is one line plus a test. |
| 3 | **WR-04** — `applyReady` sets `status:'ready'` with a possibly-null `playbackId`, so a ready-without-playback-id asset shows "Pronto" while `/playback` answers 404. | ⚠️ Warning | Degraded honesty on criterion 4's own surface. Not a leak: `playbackTokens` refuses a null `playbackId` explicitly (`service.ts:727`). |
| 4 | Broken-windows ledger entries **13** and **10** are half-stale (the `signPlayback` route now exists; "Editar perfil" is now a real link). | ℹ️ Info | Ledger hygiene only. |

### Deferred Items (addressed in later phases — not actionable gaps)

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Real Mux account, secrets, webhook endpoint, signing key | Phase 01.1 (deferred cloud work) | `docs/DEPLOY.md` Phase 01.1 Mux runbook; broken-windows 12, 14, 15; user memory "cloud work deferred to the end" |
| 2 | `videoProvider.getAsset` has no caller (lost-webhook reconciliation) | Phase 8 (hardening) | `deferred-items.md`; broken-windows 13; "not required by criterion 4" |
| 3 | Service-worker `register()` rejection unhandled (`.waiting` on a rejected promise) | Phase 7 or 8 | `deferred-items.md`; pre-existing Phase 2 file, not user-visible in normal browsing |
| 4 | "Notificações" settings row still an "Em breve" pill | Phase 7 (push) | broken-windows 10 |
| 5 | Media-library "pick an existing asset" affordance | Phase 4 (composer) | 03-07 prohibition, CONTEXT §Deferred |

### Gaps Summary

**No gaps.** Nothing the phase promised is missing from the code, and nothing declared as done is a stub.

The one criterion that is **not fully proven** is criterion 4, and it is honest about why: the isolation
half — the half this product's core value depends on, and the half the criterion names explicitly —
is proven live by an 18/18 suite with positive controls on both sides. The vendor half is fully
implemented and fully wired but has only ever run against `VIDEO_PROVIDER=fake`. Calling that
"verified" would be rounding up: a written Mux adapter that has never authenticated, an
`unwrap()` that has never verified a real signature, and a `<mux-player>` that has never derived a
real poster are three distinct things a fake cannot stand in for, and the phase's own broken-windows
entries 12, 14 and 15 say so in the executor's own words.

Three warnings the user deliberately deferred touch this phase's criteria and are recorded above
rather than buried: WR-02 (wrong refusal copy for an oversized video), WR-08 (`completeUpload` still
open to any member of the tenant — CR-01's untreated sibling), and WR-04 ("Pronto" on a video that
cannot play). None is a cross-tenant concern; none was hidden; all three are one-line-ish closes
whenever the user wants them.

---

_Verified: 2026-09-22T11:07:34Z_
_Verifier: Claude (gsd-verifier)_
