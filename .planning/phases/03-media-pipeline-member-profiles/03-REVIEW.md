---
phase: 03-media-pipeline-member-profiles
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 124
files_reviewed_list:
  - apps/api/src/app.ts
  - apps/api/src/routes/me.ts
  - apps/api/src/routes/media.ts
  - apps/api/src/routes/members.ts
  - apps/api/src/routes/webhooks/mux.ts
  - apps/api/src/worker.ts
  - apps/api/tests/integration/bootstrap.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - apps/api/tests/integration/media-playback.test.ts
  - apps/api/tests/integration/media-sweeper.test.ts
  - apps/api/tests/integration/media.test.ts
  - apps/api/tests/integration/members.test.ts
  - apps/api/tests/integration/mux-webhook.test.ts
  - apps/api/tests/integration/profile.test.ts
  - apps/api/tests/integration/setup.ts
  - apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx
  - apps/web/app/(app)/configuracoes/midia/actions.ts
  - apps/web/app/(app)/configuracoes/midia/loading.tsx
  - apps/web/app/(app)/configuracoes/midia/page.tsx
  - apps/web/app/(app)/configuracoes/page.tsx
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/membros/MembersList.test.ts
  - apps/web/app/(app)/membros/MembersList.tsx
  - apps/web/app/(app)/membros/[membershipId]/loading.tsx
  - apps/web/app/(app)/membros/[membershipId]/not-found.tsx
  - apps/web/app/(app)/membros/[membershipId]/page.tsx
  - apps/web/app/(app)/membros/actions.ts
  - apps/web/app/(app)/membros/loading.tsx
  - apps/web/app/(app)/membros/page.tsx
  - apps/web/app/(app)/perfil/actions.ts
  - apps/web/app/(app)/perfil/editar/EditProfileForm.tsx
  - apps/web/app/(app)/perfil/editar/loading.tsx
  - apps/web/app/(app)/perfil/editar/page.tsx
  - apps/web/app/(app)/perfil/loading.tsx
  - apps/web/app/(app)/perfil/page.tsx
  - apps/web/app/v1/media/[assetId]/[variant]/route.ts
  - apps/web/components/media/AvatarUploadField.test.ts
  - apps/web/components/media/AvatarUploadField.tsx
  - apps/web/components/media/MediaAssetRow.tsx
  - apps/web/components/media/MediaImage.tsx
  - apps/web/components/media/VideoPlayer.tsx
  - apps/web/components/media/VideoUploadField.tsx
  - apps/web/components/media/useSignedUpload.ts
  - apps/web/components/profile/MemberRow.tsx
  - apps/web/components/profile/ProfileHeader.tsx
  - apps/web/components/profile/ProfileNudgeCard.tsx
  - apps/web/e2e/admin.ts
  - apps/web/e2e/login.spec.ts
  - apps/web/e2e/media-fixtures.ts
  - apps/web/e2e/media-upload.spec.ts
  - apps/web/e2e/media-video.spec.ts
  - apps/web/e2e/members-admin.ts
  - apps/web/e2e/members.spec.ts
  - apps/web/e2e/phase3-smoke.spec.ts
  - apps/web/e2e/profile.spec.ts
  - apps/web/e2e/shell.spec.ts
  - apps/web/e2e/signup.spec.ts
  - apps/web/lib/media.ts
  - apps/web/lib/profile.ts
  - apps/web/lib/upload.test.ts
  - apps/web/lib/upload.ts
  - apps/web/messages/pt-BR/app.json
  - apps/web/messages/pt-BR/media.json
  - apps/web/messages/pt-BR/members.json
  - apps/web/messages/pt-BR/profile.json
  - apps/web/package.json
  - biome.json
  - docs/DEPLOY.md
  - packages/contracts/package.json
  - packages/contracts/src/errors.ts
  - packages/contracts/src/media.ts
  - packages/contracts/src/profiles.ts
  - packages/core/db/schema/index.ts
  - packages/core/db/schema/media-assets.ts
  - packages/core/db/schema/media-provider-events.ts
  - packages/core/db/schema/member-profiles.ts
  - packages/core/package.json
  - packages/core/server/env.ts
  - packages/core/server/http/api-error.ts
  - packages/core/server/media/derive-job.ts
  - packages/core/server/media/index.ts
  - packages/core/server/media/inspect.ts
  - packages/core/server/media/keys.ts
  - packages/core/server/media/limits.ts
  - packages/core/server/media/service.ts
  - packages/core/server/media/storage.ts
  - packages/core/server/media/sweep-job.ts
  - packages/core/server/media/variants.ts
  - packages/core/server/media/video/event-job.ts
  - packages/core/server/media/video/fake.ts
  - packages/core/server/media/video/inbox.ts
  - packages/core/server/media/video/index.ts
  - packages/core/server/media/video/mux.ts
  - packages/core/server/media/video/types.ts
  - packages/core/server/media/video/wire.ts
  - packages/core/server/paging.ts
  - packages/core/server/profiles/index.ts
  - packages/core/server/profiles/search.ts
  - packages/core/server/profiles/service.ts
  - packages/core/tests/media-video.test.ts
  - packages/core/tests/media.test.ts
  - packages/core/tests/profiles-search.test.ts
  - packages/core/tests/profiles.test.ts
  - packages/core/ui/nav.ts
  - packages/ui/src/index.ts
  - packages/ui/src/primitives/Avatar.tsx
  - packages/ui/src/primitives/FileDropZone.tsx
  - packages/ui/src/primitives/PageHeader.tsx
  - packages/ui/src/primitives/SearchBar.tsx
  - packages/ui/src/primitives/Textarea.tsx
  - packages/ui/tests/button.test.tsx
  - scripts/seed.ts
  - supabase/config.toml
  - supabase/migrations/20260921182418_media_assets.sql
  - supabase/migrations/20260921182426_media_bucket.sql
  - supabase/migrations/20260921190226_member_profiles.sql
  - supabase/migrations/20260921190227_member_profiles_search.sql
  - supabase/migrations/20260922020438_media_provider_events.sql
  - supabase/migrations/20260922020621_media_bucket_video.sql
  - supabase/tests/010-rls-coverage.sql
  - supabase/tests/020-tenant-isolation.sql
  - supabase/tests/040-schema-conventions.sql
  - supabase/tests/070-media-bucket.sql
  - supabase/tests/080-member-profiles.sql
findings:
  critical: 2
  warning: 8
  info: 4
  total: 14
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-09-22
**Depth:** standard
**Files Reviewed:** 124
**Status:** issues_found

## Summary

The phase's headline isolation claims hold up under scrutiny. I traced them specifically:

- `GET /v1/media/{assetId}/{variant}` really does read zero rows: `serveVariant` builds the key from `ctx.tenantId` only (`packages/core/server/media/service.ts:587-601`), `parseVariant` refuses anything outside `original`/`w<declared width>`, and `assertTenantKey` runs before the Storage call. A tenant-B session asking for a tenant-A id lands under `<B>/media/<A-id>/…`, which cannot exist. **Cross-tenant refusal is structural, as claimed.**
- `mux.webhooks.unwrap(...)` **is** awaited (`packages/core/server/media/video/mux.ts:159`), and the route reads the raw body before any parsing (`apps/api/src/routes/webhooks/mux.ts:36`). The fake adapter's verifier is a real HMAC with a replay window applied before the compare.
- Playback tokens are minted per request against a tenant-lane read, answered `no-store`, never persisted, and the refusal vocabulary is closed (`playbackTokens`, service.ts:657-720).
- The directory/single-member asymmetry (D-47) is implemented exactly as decided, and `memberProfileSchema` is `.strict()`.
- No byte-accepting route exists anywhere in the API; every transfer path goes browser → signed target.

**Where it fails is one layer inward: same-tenant authorization.** The phase invested its whole authorization budget in *cross-tenant* isolation and left *intra-tenant* authorization to RLS, which is deliberately tenant-wide on `media_assets`. `DELETE /v1/media/{assetId}` inherits that and has no owner or role check at all, while the member directory publishes every member's `avatarAssetId` — so any member can permanently destroy any other member's photo (CR-01). The second blocker is a rendering contract that contradicts the derivation rule: profile surfaces always request `w320`, but the worker only derives widths that fit inside the original, so a small avatar renders as the neutral icon on every retina device (CR-02).

The warnings cluster around three themes: the cached-redirect lifetime math (WR-01), the upload state machine treating every `'size'` verdict as an image (WR-02/WR-03), and provider-event/sweeper robustness (WR-04..WR-06).

## Critical Issues

### CR-01: `DELETE /v1/media/{assetId}` has no owner or role check — any member can permanently destroy any asset in the community

**File:** `packages/core/server/media/service.ts:608-641` (route: `apps/api/src/routes/media.ts:212-218`)

**Issue:** `deleteAsset` loads the asset through `loadOwnAsset`, whose only scoping is the `media_assets_tenant_select` RLS policy — and that policy is deliberately **tenant-wide** (`tenant_id = app.tenant_id() and deleted_at is null`, `supabase/migrations/20260921182418_media_assets.sql:35`), not owner-scoped. The route carries `requireAuth` and nothing else. `listAssets` guards itself with `if (ctx.role !== 'admin_tenant') throw 403` (service.ts:739) and `startUpload` guards the video kind (service.ts:340); **`deleteAsset` guards nothing.**

Exploit chain, entirely within one tenant:
1. Any `member` calls `GET /v1/members` — the response is `memberProfileSchema`, which includes `avatarAssetId` for every listed member (`packages/contracts/src/profiles.ts:159-167`).
2. They call `DELETE /v1/media/<that id>`. The row is soft-deleted (`status='deleted', deleted_at=now()`), so the victim's photo leaves every read immediately.
3. One hour later (`MEDIA_DELETED_TTL_MS`) the sweeper's window-2 predicate collects it and `purgeAsset` deletes the Storage objects and the row irreversibly; the `on delete set null` FK then nulls `member_profiles.avatar_asset_id`.

The same call also works on an admin's `ready` video asset (ids are exposed to an admin session but also guessable only with the id — the avatar path needs no guessing at all). The isolation suite covers the *cross-tenant* DELETE (`apps/api/tests/integration/isolation.test.ts:512`) but there is no test for a same-tenant non-owner, so the gap is both real and unpinned.

Note the fix cannot simply be "admins only": `updateOwnProfile` calls `deleteAsset(ctx, previousAvatarAssetId)` for replace-on-write (`packages/core/server/profiles/service.ts:219`), so an ordinary member must still be able to retire **their own** asset.

**Fix:** select the owner and gate on owner-or-admin, answering the same bare 404 the miss branch answers (no new oracle):

```ts
// ASSET_COLUMNS must gain: ownerUserId: mediaAssets.ownerUserId
export async function deleteAsset(ctx: Ctx, assetId: string): Promise<MediaAsset> {
  const row = await loadOwnAsset(ctx, assetId);
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  // V1: a member may retire only what they uploaded; an admin may retire the community's assets.
  // Same bare 404 as the miss branch — a refusal must not confirm the id exists.
  if (row.ownerUserId !== ctx.userId && ctx.role !== 'admin_tenant') {
    throw new ApiError(404, 'NOT_FOUND');
  }
  ...
}
```

Add an integration case: tenant-A member B deletes tenant-A member C's avatar asset → 404, row untouched.

### CR-02: profile images always request `w320`, but the worker derives only widths that fit the original — a sub-320 px avatar renders as "no photo" on every retina device

**Files:** `packages/core/server/media/limits.ts:60-65`, `apps/web/components/profile/ProfileHeader.tsx:43-53`, `apps/web/components/media/AvatarUploadField.tsx:117-127`, `apps/web/components/media/MediaImage.tsx:66-71`

**Issue:** `widthsForPurpose('avatar', originalWidth)` filters the `[128, 320]` ladder to widths **at or below the original** (pinned by `packages/core/tests/media.test.ts:105-109`). A member who uploads a 200×200 photo — under every cap, so `normaliseImage` returns the file untouched (`apps/web/lib/upload.ts:371`) — gets exactly one derived object: `w128.webp`. No `w320.webp` is ever written.

But `ProfileHeader` and `AvatarUploadField` pass `widths={PURPOSE_WIDTHS.avatar}` (the *static* ladder, not the asset's `variantWidths`) and `baseWidth={320}`. `MediaImage` therefore emits `srcSet="…/w128 128w, …/w320 320w"` with `sizes="80px"`. At DPR ≥ 2 the browser needs ≥ 160 px and selects the `w320` candidate, which 404s (`signRead` throws → `serveVariant` → 404). `onError` fires and the component falls back to the neutral `Avatar` — **the member's photo silently disappears on the phone this PWA is built for**, with no error anywhere.

`MediaImage`'s own prop doc says `widths` is "the variant ladder the payload declares (R-06) — never a hand-written width list", but the payload the profile endpoints return (`ownProfileSchema`/`memberProfileSchema`) carries only `avatarAssetId`, so no call site on the profile path can honour that. The admin media row is the only call site that does it correctly (`MediaAssetRow.tsx:92-93` uses `asset.variants`).

**Fix:** pick one of the two coherent options.

Preferred — always derive the full ladder for the purpose (`withoutEnlargement` already prevents upscaling, so `w320` of a 200 px source is simply a 200 px file):

```ts
export function widthsForPurpose(purpose: MediaPurpose, _originalWidth: number): number[] {
  // Every rung of the ladder is derived: `sharp(...).resize({ withoutEnlargement: true })` never
  // upscales, so `w320` of a 200 px original is a 200 px WebP — present, correct and cheap. A
  // clamped ladder would make the serving URL a function of the SOURCE size, which no payload
  // carries and no <img srcSet> can know.
  return [...(PURPOSE_WIDTHS[purpose] ?? [])];
}
```

Alternative — carry the real widths in the profile payloads (`avatarWidths: number[]` on `ownProfileSchema`/`memberProfileSchema`) and thread them into `MediaImage`/`avatarSrcSet`. This is a contract change and touches D-45's strict shape, so the first option is the smaller correct fix.

Either way, add a regression case: complete an avatar upload whose original is 200 px wide, run the derive job, and assert `GET /v1/media/{id}/w320` answers 302 (or that the payload never advertises a width that was not produced).

## Warnings

### WR-01: the signed-URL memo (50 min) plus the redirect's 25-minute `max-age` can exceed the 60-minute signed URL — a cached redirect points at an expired target

**Files:** `packages/core/server/media/storage.ts:20-22`, `apps/api/src/routes/media.ts:206-210`

**Issue:** `MEDIA_SIGNED_READ_TTL_S = 3600`, `MEDIA_SIGNED_READ_MEMO_MS = 3000 * 1000` (50 min), and the 302 is answered `Cache-Control: private, max-age=1500` (25 min). A URL minted at t=0 is still served from the memo at t=2999 s; the browser may then reuse that redirect until t=4499 s, 900 s **after** the signed URL expired. Storage answers 400, `MediaImage.onError` swallows it and shows the neutral fallback. The route's own comment asserts the opposite ("1500 s sits well inside the signed URL's hour, so a cached redirect can never point at an expired target") — that reasoning ignores the memo age.

**Fix:** make the invariant arithmetic rather than prose — memo TTL + client `max-age` must be < signed TTL, with margin:

```ts
// storage.ts
export const MEDIA_SIGNED_READ_TTL_S = 3600;
/** The client may cache the redirect for this long; memo + this must stay well under the TTL. */
export const MEDIA_REDIRECT_MAX_AGE_S = 900;           // 15 min
const MEDIA_SIGNED_READ_MEMO_MS = (MEDIA_SIGNED_READ_TTL_S - MEDIA_REDIRECT_MAX_AGE_S - 300) * 1000;
```

and have the route emit `private, max-age=${MEDIA_REDIRECT_MAX_AGE_S}` instead of the literal 1500.

### WR-02: an oversized video is run through the browser's *image* re-encoder and refused with "could not prepare this image"

**Files:** `apps/web/components/media/useSignedUpload.ts:137-158`, `apps/web/components/media/VideoUploadField.tsx:60-74`

**Issue:** `classifyMediaFile` returns `'size'` for any file above the (kind, purpose) cap, including a video. The hook then enters the re-encode branch unconditionally: `` `'size'` enters the same branch because scaling to 2048 px is what rescues it`` — true for an image, nonsense for a 700 MB `.mov`. `normaliseImage` tries `document.createElement('img')` on the video, the decode rejects, and the member sees `errors.prepare` ("Não foi possível preparar esta imagem.") for a video that is simply too large. ROADMAP criterion 3 asks for a *clear* refusal at confirmation time; this is the wrong sentence and the wrong diagnosis.

Compounding it: `VideoUploadField` never passes `maxBytes` to `FileDropZone`, so the zone's `screen` size check (`FileDropZone.tsx:87`) is dead for video and nothing refuses the file earlier.

**Fix:**

```ts
// useSignedUpload.ts — the re-encode is an IMAGE rescue; a video has nothing to re-encode.
if (verdict === 'size' && kind !== 'image') return fail(messageFor('too_large'));
if (verdict === 'heic' || verdict === 'size') { /* existing preparing branch */ }
```

and pass the cap to the zone so the refusal costs no work at all:

```tsx
<FileDropZone ... accept={ACCEPT} maxBytes={MEDIA_LIMITS.video.post?.maxBytes} onReject={upload.reject} />
```

### WR-03: the tenant storage ceiling is charged from the client-declared size on `pending` rows, with no rate limit — one member can exhaust the community's quota for 24 h without uploading a byte

**File:** `packages/core/server/media/service.ts:367-401` (ceiling: `packages/core/server/media/limits.ts:36`)

**Issue:** `startUpload` sums `bytes` over all non-deleted rows — which includes `pending` ones — and inserts the new row with `bytes: body.size`, the value the **client declared**. Nothing verifies the bytes ever arrive, and nothing rate-limits `POST /v1/media/uploads`. A member can issue ~100 calls declaring `size: 8388608` (the avatar cap) and push the sum past `MEDIA_TENANT_BYTES_CEILING` (800 MB). Every subsequent upload by every member of that community answers `413 { media: 'quota_exceeded' }` until `MEDIA_PENDING_TTL_MS` (24 h) elapses and the sweeper collects. No storage is actually consumed, so the refusal is pure denial of service against a shared resource.

**Fix:** stop charging unverified bytes, and/or bound the number of in-flight uploads per member:

```ts
// Charge only what Storage has actually confirmed; a `pending` row reserves nothing.
.where(and(
  eq(mediaAssets.tenantId, ctx.tenantId),
  isNull(mediaAssets.deletedAt),
  notInArray(mediaAssets.status, ['pending', 'rejected', 'failed']),
))
```

plus a cheap per-member in-flight cap at `start` (e.g. refuse when the caller already has N `pending` rows younger than the TTL). Both are single predicates and keep the "no row exists when the ceiling refuses" property.

### WR-04: a `video.asset.ready` event without a playback id flips the asset to `ready` anyway — permanently unplayable, but shown as "Pronto"

**File:** `packages/core/server/media/video/event-job.ts:136-159`

**Issue:** `applyReady` writes `playbackId: event.playbackId` with no null check and sets `status: 'ready'`. `normaliseProviderEvent` yields `playbackId: null` whenever `data.playback_ids` is absent or empty (`wire.ts:54-58, 101`). The row then satisfies `status === 'ready'` so `MediaAssetRow` renders the success pill and the row is clickable, but `playbackTokens` refuses it forever: `if (row.status !== 'ready' || !row.playbackId) throw 404` (service.ts:678). The member gets a player frame and a generic error toast with no way forward, and the `ready` guard (`status not in ('ready','deleted')`) means a corrected redelivery can never repair it either.

**Fix:** treat a ready event with no playback id as an error, not a success:

```ts
if (!event.playbackId) {
  // A `ready` with no playback id is unplayable forever, and the `not in ('ready', …)` guard would
  // stop a corrected redelivery from repairing it. Record it as a failure instead.
  return applyErrored({ ...event, failureReason: 'missing_playback_id' }, row);
}
```

### WR-05: an unvalidated `assetId` from the provider payload reaches a uuid comparison and aborts the whole resolution, skipping the `providerAssetId` fallback

**File:** `packages/core/server/media/video/event-job.ts:64-88` (schema: line 49)

**Issue:** `payloadSchema` declares `assetId: z.string().nullable()` — not `z.uuid()`. `resolveAsset` then runs `eq(mediaAssets.id, event.assetId)` first. A non-uuid passthrough makes Postgres raise `invalid input syntax for type uuid`, the `withAdminTx` rejects, and the handler's outer catch logs `media.provider_event.failed` and returns. The `providerAssetId` fallback below it — the branch the file's own docblock says exists precisely because "the provider cannot echo it" — never executes, so the asset stays `pending` until the 24 h sweeper deletes it along with the member's upload.

**Fix:** validate the shape, and make the fallback unconditional rather than nested behind a throwing query:

```ts
const payloadSchema = z.object({
  ...
  assetId: z.uuid().nullable().catch(null),   // a passthrough we cannot use is `null`, not a crash
  ...
});
```

### WR-06: the sweeper batch is oldest-first and bounded — rows that always fail to purge occupy the head of every run and starve newer ones

**Files:** `packages/core/server/media/sweep-job.ts:67-94`, `packages/core/server/media/service.ts:931-1009`

**Issue:** `collectable()` orders by `created_at` ascending and takes `MEDIA_SWEEP_BATCH = 100`. `purgeAsset` returns `{ purged: false }` on a Storage list failure, a Storage remove failure or a provider delete refusal, deliberately leaving the row for the next sweep. Those rows are the **oldest**, so they are re-selected first every hour, forever. Once 100 assets are stuck (a Mux outage over a purge window, a permanently 500-ing asset), the sweeper collects nothing else: newly abandoned uploads and retired photos are never purged, and the tenant keeps paying for bytes that were supposed to disappear — the very failure mode 03-08 exists to close.

**Fix:** record the attempt so a poison row yields its slot, e.g. add a `purge_attempts int not null default 0` / `last_purge_at timestamptz` column, increment it on the failure paths, and order by `(last_purge_at nulls first, created_at)` with an exponential back-off predicate. A minimal variant: `order by coalesce(last_purge_at, created_at)`.

### WR-07: side effects inside a `setItems` updater can swallow the "Vídeo pronto" announcement

**File:** `apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx:115-129`

**Issue:** the updater passed to `setItems` calls `setAnnouncement(...)` and mutates `announced.current` (a ref) while React is computing the next state. React requires updater functions to be pure; in StrictMode (and any time React replays a render) the updater runs twice, so the first invocation marks every id in `announced.current` and the second finds `freshlyReady` empty — the live-region announcement for a newly ready video is dropped. The `data-testid="media-live"` assertion is therefore also order-dependent.

**Fix:** compute the next list purely, then apply the effects outside the updater:

```ts
setItems((prev) => mergeFirstPage(prev, page.items));   // pure
const freshlyReady = page.items.filter((a) => a.status === 'ready' && !announced.current.has(a.id));
for (const a of page.items) if (readyish(a)) announced.current.add(a.id);
if (freshlyReady.length > 0) setAnnouncement(t('player.ready'));
```

### WR-08: `completeUpload` can be driven by any member of the tenant, not just the uploader

**File:** `packages/core/server/media/service.ts:469-476`

**Issue:** same root cause as CR-01 — `loadOwnAsset` is tenant-scoped, not owner-scoped, so any member holding an `assetId` can call `POST /v1/media/uploads/{id}/complete` on somebody else's `pending` row. The blast radius is much smaller than the delete path (the object is validated and the state change is the one the owner wanted, or the row is flipped to `rejected` and the object removed if the bytes have not landed yet) — but "another member can force my in-flight upload to be rejected and its object deleted" is still a write a stranger should not be able to make.

**Fix:** apply the same owner-or-admin predicate proposed in CR-01 in `completeUpload` (and consider a shared `loadOwnAsset(ctx, id, { ownerOnly: true })` helper so the two paths cannot drift).

## Info

### IN-01: the Mux webhook's 403 breaks the D-09 error envelope

**File:** `apps/api/src/routes/webhooks/mux.ts:50`
**Issue:** the refusal is `{ error: { code: 'FORBIDDEN' } }` — no `message`, no `requestId` — while every other refusal in the API goes through `errorEnvelope` and always carries both. The provider does not read it, but an operator correlating a rejected delivery in Cloud Logging has no request id in the response.
**Fix:** `throw new ApiError(403, 'FORBIDDEN')` and let `app.onError` build the envelope, or construct it with `errorEnvelope(err, requestId)`.

### IN-02: `media_provider_events` grows without bound, and its docblock claims otherwise

**File:** `packages/core/db/schema/media-provider-events.ts:12-13`
**Issue:** the comment says the table's only read patterns are "'what arrived recently' during an incident, and the 03-08 sweeper", but `sweep-job.ts` never touches it — nothing in the repo ever deletes a row. Every webhook Mux ever delivers accumulates forever, and the table is the replay defence, so it can never simply be truncated blindly.
**Fix:** either correct the comment, or add a retention predicate to the existing sweeper (`delete from media_provider_events where received_at < now() - interval '30 days'`, comfortably past Mux's 24 h retry window).

### IN-03: `member_profiles.display_name` can legitimately be the empty string

**Files:** `supabase/migrations/20260921190227_member_profiles_search.sql:51-55`, `packages/core/db/schema/member-profiles.ts:69`
**Issue:** the trigger seeds `coalesce(u.name, '')` and `users.name` is `not null default ''`, so a membership created for a user whose name was never set produces a profile with an empty display name. The column has no non-empty check, `PATCH /v1/me/profile` only validates the field when it is present, and the directory would render a nameless row with a working link. The seed and normal signup always supply a name, so this is latent rather than live.
**Fix:** either `check (length(btrim(display_name)) > 0)` on the column with the trigger falling back to a placeholder, or have `ensure_member_profile` use `coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1))`.

### IN-04: the signed-read memo is per-process, so a purged object can still be handed out for up to 50 minutes

**File:** `packages/core/server/media/storage.ts:32, 60-69`
**Issue:** `invalidateSignedUrl` clears a module-level `Map`. `deleteAsset` and `purgeAsset` call it on the instance that handled the request, but every other Cloud Run instance keeps its memoised URL until the memo expires. Between a purge and that expiry, an instance can 302 a browser to an object that no longer exists (it degrades to the neutral fallback, so the impact is cosmetic).
**Fix:** none required for the pilot; worth a line in the media README so the next person does not treat `invalidateSignedUrl` as a global invalidation. If it ever matters, key the memo entry by `(key, deletedAtGeneration)` or drop the memo for `original`.

---

_Reviewed: 2026-09-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
