# Phase 3: Media Pipeline & Member Profiles - Research

**Researched:** 2026-09-21
**Domain:** Tenant-scoped media broker (Supabase Storage direct upload + worker image variants + Mux video) and member profile / directory
**Confidence:** HIGH for the pipeline mechanics and search; MEDIUM for video vendor economics; MEDIUM for the mobile-Safari upload UX

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Video: vendor, playback and scope**

- **D-43:** The video vendor is **Mux** (`@mux/mux-node` 15.1.0 server-side, `@mux/mux-player-react` 3.13.3 for playback), per the stack's recommendation and the PROJECT.md key decision. Flow: the API creates a **Mux direct upload** URL, the browser uploads straight to Mux, the `video.asset.ready` webhook writes `playback_id`, `duration`, `aspect_ratio` and thumbnail info onto the `media.assets` row and flips `status` to `ready`; until then the UI shows "processando". Cloudflare Stream stays the documented cheaper alternative with the same architecture — the provider is reached through an adapter so a swap is a new implementation, not a rewrite. — **Reversibility:** costly — the webhook contract, the asset columns (`provider`, `provider_asset_id`, `playback_id`) and the player component are consumed from Phase 4 on; swapping vendors means re-ingesting existing assets, though the adapter keeps the call sites intact.
- **D-44:** Mux playback uses the **signed playback policy**, not public. The Mux signing key lives in GCP Secret Manager; the API mints a **short-lived playback JWT per request**, authorised against the caller's membership exactly like a Storage signed URL. Rationale: TENANT-04 says media is "served only through signed, tenant-checked URLs", and criterion 4's "a tenant-B session cannot obtain a signed URL for a tenant-A object" must hold for video too — a public playback ID would make video the one media kind the isolation suite cannot defend. — **Reversibility:** costly — the playback-token endpoint and the key are part of the media contract every later video surface (feed, stories) calls; moving to public playback later would silently widen access on already-published assets.

**Member profile**

- **D-45:** Another member's profile (**PROF-02**) shows **photo, display name and bio only** — no role badge, no join date, no counts, no follow/message affordances. This is the V1 answer to `PROTOTYPE.md` open question 10: there is **no admin badge on profiles**. The prototype's `ProfileHeader` is ported for its layout with follow/message/handle/website/stats removed.
- **D-46:** The **display name is freely editable** by the member after sign-up, with **no history kept** — the sign-up name is simply overwritten. The **e-mail remains the identity anchor** for staff (Phase 8 member management and support search key on e-mail, not on the display name). No moderation gate, no approval, no "nome anterior" record. — **Reversibility:** reversible — adding a retained original name later is an additive column plus a backfill from `users.name`.

**Member directory**

- **D-47:** The directory (**PROF-03**) lists **active members only, with staff hidden**: rows where `role = 'member'` and `status = 'active'`. `admin_tenant` and `support_tenant` do **not** appear; `invited`, `blocked` and soft-deleted memberships are excluded. A staff member's profile is still **openable by direct link** under PROF-02 (from their content in Phase 4, or the support conversation in Phase 7) — it is simply not browsable in the list. Rationale: consistent with D-45's "no role badge" (the list would otherwise be a roster of who runs the community), and the tenant's team is met through content and support, not through a directory. — **Reversibility:** reversible — the role filter is one predicate; V2-PROF-01's per-member "hide-me" flag will land on the same query.

### Claude's Discretion

Everything below was explicitly handed to Claude. Decide it during research/planning, record the choice, and pin the behaviour with tests — do not re-ask the user.

**Video**
- Upload guard rails: max duration per kind and whether a per-tenant minutes-stored ceiling ships now. Keep it cheap to build and easy to tighten in Phase 8 hardening. Phase 5 will need a ~60 s story rule on the same mechanism.
- Where the Phase 3 admin video upload + playback proof lives: a real `admin_tenant` media-library screen (which Phase 4 would reuse for "pick an existing asset"), a throwaway dev/e2e harness, or an API-level integration proof plus one manual device check. Weigh it against what Phase 4's composer would rebuild anyway; anything prototype-less goes through the D-33 UI-SPEC + mockup review.
- Mux webhook verification, retry/idempotency (pg-boss, matching the Phase 2 domain-verify job shape), `video.asset.errored` handling and what the UI shows on a failed transcode.

**Profile model**
- Where photo / display name / bio actually live: a per-tenant `member_profiles` row keyed by membership, columns on the global `public.users`, or a split. Guidance: `packages/contracts/src/bootstrap.ts` **already nests `profile { displayName, avatarUrl, bio }` under `membership`** (today hardcoded from `users.name` at `apps/api/src/routes/me.ts:118`), `users.ts` deliberately carries no `tenant_id`, and the V2 goal is that the same person can belong to two communities without a migration that rewrites core tables. Whatever is chosen must satisfy `packages/core/docs/SCHEMA-CONVENTIONS.md` and keep the bootstrap contract shape.
- The D-02 first-access photo/bio nudge: dismissible card in the `/inicio` home slot (D-42 already defines the slot, but Phase 4's feed will compete for it), a one-time BottomSheet with a visible "Agora não", or settings-row only. Whatever is chosen is designed in the prototype's language under D-33.
- Bio length cap and whether any formatting is allowed (the prototype's `EditProfileForm` counts to 150); avatar fallback when there is no photo (initials vs neutral icon — `@tria/ui` `Avatar` already exists); how a member removes their photo; what the owner's own `/perfil` shows beyond the other-member view.

**Directory**
- Name search semantics: accent- and case-insensitive substring (`unaccent` + expression index), accent-insensitive prefix, or Postgres FTS with the `portuguese` dictionary. pt-BR surnames make substring the likely answer; whichever is chosen, pin it with tests including an accented name searched without accents.
- Entry point: a "Membros" row on `/perfil`, a kernel nav tab (D-40 — but by Phase 6 the bar would carry Início, Comunidades, Eventos, Membros, Perfil), or a TopBar search affordance. Weigh the Phase 5–6 tab budget; the screen is prototype-less and goes through D-33.
- Ordering, page size, keyset vs offset pagination, infinite scroll vs "carregar mais", and the empty / no-results copy. Keyset is the Phase 4 convention-to-be — prefer it here so the feed inherits a proven shape.

**Pipeline**
- How a private media URL reaches the browser: signed Storage URLs inline in API payloads (one round trip, TTL must outlive the cached payload), or a stable `/v1/media/{id}/{variant}` API URL that checks membership and **302-redirects** to a freshly signed URL (permanently cacheable payloads, a tenant check on every fetch, one extra hop and a Cloud Run request per image). Decide with the **Phase 4 feed rendering many images per screen** in mind, and with criterion 4's isolation proof as the hard constraint — the public-bucket option is rejected, it contradicts TENANT-04.
- iPhone HEIC: re-encode in the browser to JPEG/WebP at a max dimension before upload (also solves the 50 MB cap on mobile networks; watch EXIF orientation), accept HEIC and decode HEIF in the worker (requires proving the `node:24-slim` image's libvips has HEIF support), or refuse HEIC outright (worst pilot experience — it fires on exactly the iPhone case criteria 3 and 4 name). Prove whatever is chosen with a real iPhone-originated fixture.
- Variant set: named variants per `purpose` (avatar / post / cover / story) with fixed sizes, one generic width ladder for every image with `srcset`, or original + one variant grown later. The broker is meant to be the **one contract Phases 4–6 reuse**, so favour a shape that does not force a backfill when stories and event covers arrive.
- Orphan lifecycle: a scheduled pg-boss sweeper for `pending` assets older than N hours (the window must outlive a slow mobile upload), replace-on-write for the single-slot profile photo only, or defer to Phase 8. Size it to what Phase 3 genuinely produces; Phase 4's composer is the case that makes a sweeper unavoidable.
- Whether media/profiles are new `packages/core/server/{media,profiles}` kernel areas (the Phase 2 `branding` precedent) or `@tria/module-*` packages. D-16 fixes them as **kernel, always on, no flag** — this is only about file layout and MOD-05's "module README" reuse story.
- TUS chunking/resume on mobile Safari over throttled networks, upload progress/cancel/retry UX, and the pt-BR refusal copy for oversized or disallowed types (criterion 3 wants it clear and at confirmation time).
- Per-tenant storage quota accounting, and the `media.assets` column set beyond the roadmap's note (`tenant_id`, owner, purpose, status, provider, dimensions).
- Test strategy: extending the two-tenant pgTAP + API isolation suite with the Storage signed-URL case and the Mux playback-token case, and the real-device playback check on iOS Safari and Android Chrome.

### Deferred Ideas (OUT OF SCOPE)

- **Link unfurling / embeds (MEDIA-04)** — Phase 4, where a post makes it observable; the broker must not grow an unfurl path here.
- **Admin media library as a content-reuse surface** ("pick an existing asset" when composing) — if a media screen ships in this phase it is for the criterion-4 proof; the reuse affordance belongs to Phase 4's composer.
- **Per-member "hide-me" in the directory (V2-PROF-01)** — the D-47 query is written so a visibility flag is one more predicate.
- **Self-service account deletion / data export (V2-PROF-02, LGPD Art. 18)** — V2; note that member photos will need a deletion path when it lands.
- **Retained original sign-up name / rename history** — not kept (D-46); revisit only if Phase 8 moderation proves it necessary.
- **Role badge on profiles and in the directory** — rejected for V1 (D-45); the admin is identified by their content.
- **Supabase Pro upgrade for native image transforms** — V2 per PROJECT.md; the worker-variant design must not assume it arrives.
- **Cloudflare Stream migration** — documented alternative to D-43; the provider adapter keeps the call sites stable if pilot video cost becomes the binding constraint.
- **Per-tenant storage/video quota surfaced in the platform panel** — if a ceiling ships (Claude's discretion), the `super_admin`-visible number is a Phase 8 admin-panel concern.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TENANT-04 | Storage objects (media, attachments) are stored under tenant-scoped paths and served only through signed, tenant-checked URLs | §Pattern 1 (derivable tenant-prefixed key), §Pattern 3 (302-redirect serving endpoint), §Decision R-05, §Don't Hand-Roll (`assertTenantKey` generalisation), §Security Domain V4 |
| MEDIA-01 | Uploads go directly from the browser to Supabase Storage using signed upload URLs brokered by the API (files never transit Cloud Run); the API confirms the upload and records the asset with tenant scope | §Pattern 1 (start → direct PUT/TUS → complete), §Code Example 1–3, §Standard Stack (`tus-js-client`, `createSignedUploadUrl` returns `{ signedUrl, token, path }`), §Pitfall 1 |
| MEDIA-02 | Images are resized/compressed server-side (worker) into display sizes; original size and type limits are enforced (Supabase Free plan: 50 MB per file, no native transforms) | §Decision R-06 (generic width ladder), §Pattern 2 (worker variant job), §Pitfall 2 (HEIC decode), §Pitfall 4 (decompression bomb), §Environment Availability |
| MEDIA-03 | Videos are uploaded to a streaming vendor (Mux or Cloudflare Stream) that transcodes and serves HLS with thumbnails; playback works on iOS and Android | §Decision R-01..R-04 (vendor economics, guard rails, webhook, playback token), §Code Example 4–6, §Pitfall 6 (webhook replay), §Pitfall 7 (`test: true` assets) |
| PROF-01 | Member has a profile with photo, display name and bio, and can edit their own | §Decision R-08 (`member_profiles` keyed by membership), §Decision R-09 (bio cap 150, avatar fallback), §Pattern 4, §Pitfall 9 (bootstrap contract shape) |
| PROF-02 | Member can view another member's profile within the same tenant | §Decision R-08, §Pattern 4 (tenant-lane read through `membershipOfRecord`), §Security Domain V4 |
| PROF-03 | Member can browse a searchable (by name) list of the tenant's members, paginated | §Decision R-10 (unaccent + pg_trgm, proven), §Decision R-11 (keyset pagination + entry point), §Code Example 7 |
</phase_requirements>

## Summary

This phase is mostly **generalising a pattern the repo already owns** plus **one genuinely new integration**. Phase 2 shipped the whole signed-upload shape for the public `branding` bucket — stateless upload ids, server-built object keys, `assertTenantKey` before every Storage call, header-only inspection in the request path, and a worker job that derives immutable versioned outputs (`packages/core/server/branding/upload.ts`, `packages/core/server/platform/branding.ts`). Phase 3 moves that shape into the **tenant lane** against a **private** `media` bucket, adds a worker image-variant job that mirrors `kernel.branding-derive-icons`, and adds a member profile table plus a directory query. The genuinely new work is **Mux**: a provider adapter (the `packages/core/server/domains/*` interface + real + fake precedent), a signature-verified webhook route, and a per-request signed playback JWT.

Three findings change the design materially and were **proven in this session, not assumed**. (1) **`sharp` 0.35.4's prebuilt libvips 8.18.6 cannot decode HEIC** — and worse, it *parses HEIC metadata successfully*, so a Phase-2-style header check would accept an iPhone photo and the worker would then die at resize time with `Support for this compression format has not been built in`. HEIC must therefore be re-encoded **in the browser** and refused server-side, explicitly, by format name. (2) **`unaccent` + `pg_trgm` are available on this project's Postgres and the immutable-wrapper + GIN-trigram recipe works**: `goncal` finds `João Gonçalves` and `MUNOZ` finds `Íris Muñoz`, with an index that the planner can pin in pgTAP. (3) **`storage.objects` currently carries zero policies** on this stack, which makes "no policy at all" — not a permissive select policy — the correct, precedent-consistent posture for the private `media` bucket (mirroring 02-03's `tenant_invites` pinned-at-zero rule).

On economics, the Phase-3 blocker ("video vendor pricing is LOW confidence") resolves in favour of keeping **Mux** for the pilot: at `video_quality: 'basic'` encoding is **free**, the first **100,000 delivery minutes/month are free**, and storage is ~USD 0.0028/min/month at 1080p — a pilot with a few hundred minutes of admin video costs roughly **USD 1/month**, versus Cloudflare Stream's **USD 5/month minimum prepaid storage increment**. Mux is cheaper *at pilot scale*; Stream wins at large libraries. D-43 stands, and the adapter keeps the swap cheap.

**Primary recommendation:** Build one kernel `media` broker in `packages/core/server/media/*` whose object key is **derivable from `(tenantId, assetId, variant)`** — `<tenant_id>/media/<assetId>/<variant>.webp` — so the serving endpoint `GET /v1/media/{assetId}/{variant}` needs **zero database reads**: it signs a key under the *caller's* tenant prefix and lets Storage 404 answer cross-tenant requests. That single structural choice delivers TENANT-04, criterion 4's isolation proof, permanently cacheable Phase 4 feed payloads, and a Phase 4-safe cost profile at once.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mint signed upload target (Storage or Mux) | API / Backend | Database (pending `media_assets` row) | Requires the service key and a membership check; never the browser (`@supabase/supabase-js` in the browser is forbidden by CLAUDE.md §"What NOT to Use") |
| Transfer file bytes | Browser / Client | CDN / Storage (Supabase) or Mux ingest | Cloud Run caps HTTP/1 bodies at 32 MiB [CITED: docs.cloud.google.com/run/quotas]; bytes must bypass the API entirely (Pitfall 8) |
| HEIC → JPEG/WebP re-encode, EXIF orientation, downscale | Browser / Client | — | The server decoder physically cannot do it (see §Pitfall 2); iOS Safari decodes HEIC natively via the OS codec |
| Magic-byte / format / size validation | API / Backend | Database / Storage (bucket `allowed_mime_types` + `file_size_limit`) | Criterion 3 wants refusal "at confirmation time"; Storage's own caps are the second line |
| Image variant derivation (resize/compress) | Worker (Cloud Run, `ROLE=worker`) | — | 02-13 prohibition: nothing heavy runs in the request path |
| Video transcode → HLS + thumbnail | External (Mux) | Worker (webhook follow-up job) | Supabase Storage has no transcoding; HEVC/MOV would not play on Android Chrome |
| Serve a private image variant | API / Backend (302) → CDN / Storage | Browser cache (cacheable 302) | Tenant check must happen per fetch, not per payload (criterion 4) |
| Mint a Mux playback token | API / Backend | — | RS256 signing key is a GCP Secret Manager secret (D-44) |
| Profile read/write, directory list + search | API / Backend | Database (RLS + `membershipOfRecord`) | Layer 2 + 3 of the three-layer scoping |
| Profile / directory rendering | Frontend Server (RSC) | Browser (search input, pagination) | Same shape as the Phase 2 platform panel |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/storage-js` (via `@supabase/supabase-js`) | 2.116.0 (already installed) | `createSignedUploadUrl`, `createSignedUrl`, `info`, `download`, `remove` | Already the only Storage client in the repo (`packages/core/server/supabase-admin.ts`); `createSignedUploadUrl(path, { upsert })` returns `{ signedUrl, token, path }` and the `token` is exactly what TUS needs in `x-signature` [VERIFIED: node_modules/.pnpm/@supabase+storage-js@2.116.0/node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:382-420] |
| `tus-js-client` | 4.3.1 | Resumable upload for files > 6 MB straight to Supabase Storage | CLAUDE.md-pinned; Supabase documents it as the only resumable path [CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads] |
| `sharp` | 0.35.4 (already installed in `@tria/core`) | Worker-side image variant derivation and header inspection | Already used by `packages/core/server/branding/icons.ts`; **prebuilt libvips 8.18.6, no HEVC decoder** (see §Pitfall 2) |
| `@mux/mux-node` | 15.2.0 (CLAUDE.md pins 15.1.0 — bump) | Mux direct upload create, JWT signing, webhook verification | `client.video.uploads.create({ cors_origin, new_asset_settings, timeout })`, `mux.jwt.signPlaybackId(...)`, `mux.webhooks.unwrap(body, headers, secret)` — all verified from the published `.d.ts` [VERIFIED: @mux/mux-node@15.2.0 package/resources/jwt.d.ts:3-5, package/resources/webhooks/webhooks.d.ts:3-19, package/resources/video/uploads.d.ts:24] |
| `@mux/upchunk` | 3.5.0 | Browser-side chunked, resumable upload to a Mux direct-upload URL | Mux's own documented client; handles the 256 KB-multiple chunking, retries and progress [CITED: mux.com/docs/guides/upload-files-directly] |
| `@mux/mux-player-react` | 3.13.4 (CLAUDE.md pins 3.13.3 — bump) | HLS playback with poster/thumbnail on iOS Safari and Android Chrome | `<MuxPlayer playbackId tokens={{ playback, thumbnail, storyboard, drm }} />` [VERIFIED: @mux/mux-player-react@3.13.4 dist/types/types.d.ts:48,101 → @mux/playback-core dist/types/types.d.ts:96-101] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `file-type` | 22.1.1 | Magic-byte sniffing for the non-image `file` kind (PDF) | Only if the `file` upload kind ships in this phase; images are better served by `sharp().metadata()` + an explicit format allow-list. ESM-only — fine, the repo is `type: module`. |
| `postgres` extension `unaccent` | 1.1 (available, not installed) | Accent folding for pt-BR name search | Required by R-10; `create extension if not exists unaccent with schema extensions` mirrors the `citext` precedent [VERIFIED: supabase/migrations/20260912030541_app_helpers.sql:14] |
| `postgres` extension `pg_trgm` | 1.6 (available, not installed) | GIN trigram index so substring search is not a seq scan | Required by R-10 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mux | **Cloudflare Stream** | Storage is prepaid in **USD 5/month per 1,000 minutes** increments and delivery is **USD 1 per 1,000 minutes**, with free ingest/encoding [CITED: developers.cloudflare.com/stream/pricing]. Cheaper than Mux only once the library is large; at pilot scale Mux's free 100,000 delivery minutes and free `basic` encoding make Mux cheaper. Keep behind the adapter (D-43). |
| `@mux/upchunk` for the browser | Plain `PUT` of the whole file to the Mux upload URL | Works, but a dropped mobile connection restarts a 100 MB video from zero. UpChunk is the documented, resumable path. |
| Browser HEIC re-encode | Worker HEIF decode | **Refuted by a live probe** — the prebuilt libvips has no HEVC plugin (§Pitfall 2). Would require a custom libvips build with `libheif`+`libde265`+`x265` in `node:24-slim`, i.e. a patent-encumbered, multi-hundred-MB image and a new build pipeline. Rejected. |
| `unaccent` + `pg_trgm` substring | Postgres FTS with the `portuguese` dictionary | FTS is word-prefix oriented and stems Portuguese verbs — wrong tool for "find a person whose surname I half-remember". Substring matches the pt-BR surname reality the CONTEXT anticipated. |
| Stable 302 endpoint | Signed Storage URLs inline in payloads | Inline URLs make every payload non-cacheable (its TTL must outlive the signed URL) and push the isolation guarantee into payload construction instead of into the fetch. `createSignedUrls` (batch) stays available [VERIFIED: StorageFileApi.ts:796-800] if Phase 4 measures the 302 hop as a hotspot. |
| `pg-boss` cron `schedule()` | Self-re-arming deferred job (`enqueueInTx(..., { startAfter })`) | The repo has **no scheduler in use**; `kernel.domain-verify` paces itself with deferred re-arms [VERIFIED: packages/core/server/jobs/boss.ts:148-151]. The orphan sweeper should copy that, not introduce a second mechanism. |

**Installation:**

```bash
# apps/web (browser upload + playback)
pnpm --filter @tria/web add tus-js-client@4.3.1 @mux/upchunk@3.5.0 @mux/mux-player-react@3.13.4

# packages/core (broker, worker, webhook) — sharp is already a dependency
pnpm --filter @tria/core add @mux/mux-node@15.2.0
# only if the `file` (PDF) upload kind ships this phase:
pnpm --filter @tria/core add file-type@22.1.1
```

**Version verification** (`npm view <pkg> version`, run 2026-09-21):

| Package | Version | Last publish |
|---|---|---|
| `@mux/mux-node` | 15.2.0 | 2026-09-16 |
| `@mux/mux-player-react` | 3.13.4 | 2026-09-17 |
| `@mux/upchunk` | 3.5.0 | 2026-02-18 |
| `tus-js-client` | 4.3.1 | 2026-01-13 |
| `sharp` | 0.35.4 | 2026-08-26 |
| `file-type` | 22.1.1 | 2026-09-17 |

> CLAUDE.md's stack table pins `@mux/mux-node` 15.1.0 and `@mux/mux-player-react` 3.13.3. Both have moved one patch/minor. Recommend installing the current versions and noting the bump in the plan, the same way 01-02 recorded `next@16.3.5` against a 16.3.4 pin.

## Package Legitimacy Audit

Run via `gsd-tools query package-legitimacy check --ecosystem npm …` on 2026-09-21.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@mux/mux-node` | npm | last publish 2026-09-16 | 311,661/wk | github.com/muxinc/mux-ts | **SUS** (`too-new`) | Keep — flagged |
| `@mux/mux-player-react` | npm | last publish 2026-09-17 | 1,524,889/wk | github.com/muxinc/elements | **SUS** (`too-new`) | Keep — flagged |
| `@mux/upchunk` | npm | last publish 2025-02-19 | 207,244/wk | github.com/muxinc/upchunk | OK | Approved |
| `tus-js-client` | npm | last publish 2025-01-16 | 1,211,485/wk | github.com/tus/tus-js-client | OK | Approved |
| `file-type` | npm | last publish 2026-09-17 | 41,427,702/wk | github.com/sindresorhus/file-type | **SUS** (`too-new`) | Keep — flagged |
| `sharp` | npm | last publish 2026-08-26 | (already installed, `@tria/core`) | github.com/lovell/sharp | **SUS** (`too-new`) | Already in tree — no new decision |

`npm view <pkg> scripts.postinstall` returned nothing for `@mux/mux-node`, `@mux/mux-player-react`, `@mux/upchunk`, `tus-js-client` and `file-type` (the seam's `postinstall` signal is `null` for all six).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `@mux/mux-node`, `@mux/mux-player-react`, `file-type` (and the already-installed `sharp`). In every case the `too-new` reason is an artefact of the heuristic reading the **most recent publish date** rather than package age — all four have multi-year histories, six-to-eight-figure weekly download counts and first-party source repositories. They are not slopsquat candidates.

> **Planner action:** STATE decision `02-02` records that the user approved the package-legitimacy checkpoint *for Phase 2 only* ("for the whole phase", 2026-09-16). That approval does **not** cover Phase 3. Insert **one** `checkpoint:human-verify` task covering the four flagged packages in the first plan that installs them, and reference this table so the user sees the download counts and repos rather than a bare "SUS".

## Architecture Patterns

### System Architecture Diagram

```
                       ┌───────────────────────── IMAGE / FILE PATH ─────────────────────────┐
 Browser (PWA)         │                                                                     │
 ┌──────────────┐      │  ① POST /v1/media/uploads { kind, purpose, mime, size }              │
 │ file picker  │──────┼──────────────────────────────────────────────►┌──────────────────┐  │
 │ <input       │      │                                               │  API (Cloud Run) │  │
 │  accept=     │      │  ◄── { assetId, signedUrl, token, maxBytes } ──│  media broker    │  │
 │  jpeg/png/   │      │                                               │                  │  │
 │  webp>       │      │                          validates mime/size/quota vs membership  │  │
 │      │       │      │                          inserts media_assets(status='pending')   │  │
 │      ▼       │      │                                               └────────┬─────────┘  │
 │ HEIC? ──yes──► <img>+canvas re-encode → JPEG/WebP, max 2048px                │            │
 │      │                                                                       │            │
 │      ▼  ② bytes NEVER touch Cloud Run                                        │            │
 │  ≤6MB: PUT signedUrl          ────────────────────────────►┌──────────────────────────┐  │
 │  >6MB: tus-js-client (6MB chunks, x-signature: token) ────►│ Supabase Storage         │  │
 │                                                            │ bucket `media` (private) │  │
 │  ③ POST /v1/media/uploads/{assetId}/complete               │ <tid>/media/<aid>/…      │  │
 │  ──────────────────────────────────────────►┌─────────────┴──────────────────────────┘  │
 │                                             │ API: info() + header decode (size, format,│  │
 │   ◄── 200 { status:'processing' }           │ dimensions); reject ⇒ remove object + 400 │  │
 │   ◄── 400 VALIDATION_FAILED {media:'…'}     │ accept ⇒ enqueueInTx(kernel.media-derive) │  │
 │                                             └──────────────────┬────────────────────────┘  │
 │                                                                ▼                           │
 │                                              ┌──────────────────────────────┐              │
 │                                              │ Worker (ROLE=worker, pg-boss)│              │
 │                                              │ sharp → w128/w320/w640/….webp│──► Storage   │
 │                                              │ status='ready', variants[]   │              │
 │                                              └──────────────────────────────┘              │
 │                                                                                            │
 │  ④ <img src="/v1/media/{assetId}/w640" srcset="…">                                         │
 │  ────────────────────────────►┌──────────────────────────────────────┐                     │
 │   ◄── 302 + Cache-Control:    │ API: tenant from SESSION (no DB read)│                     │
 │        private, max-age=1500  │ key = <ctx.tenantId>/media/<aid>/…   │                     │
 │        Location: signed URL   │ assertTenantKey → createSignedUrl    │                     │
 │  ────────────────────────────►│ cross-tenant aid ⇒ Storage 404 ⇒ 404 │                     │
 │                               └──────────────────────────────────────┘                     │
 └────────────────────────────────────────────────────────────────────────────────────────────┘

                       ┌───────────────────────── VIDEO PATH (Mux) ──────────────────────────┐
 │  ① POST /v1/media/uploads { kind:'video' } ──► API: MuxProvider.createDirectUpload(         │
 │                                                    cors_origin, passthrough=assetId,        │
 │                                                    playback_policies:['signed'],            │
 │                                                    video_quality:'basic', timeout )         │
 │   ◄── { assetId, uploadUrl }                                                                │
 │  ② UpChunk ────────────────── bytes ─────────────────────────────────► Mux ingest           │
 │                                                                         │ transcode → HLS   │
 │  ③                                 Mux ──► POST /v1/webhooks/mux ───────┘                   │
 │                                            unwrap(raw, headers, secret)  (HMAC-SHA256, 5min)│
 │                                            INSERT media_provider_events(id) ⇒ 23505 = dup   │
 │                                            enqueueInTx(kernel.media-mux-event, singleton=id)│
 │                                            ── 2xx fast (Mux retries 24 h w/ backoff) ──     │
 │                                       worker: video.asset.ready  ⇒ playback_id, duration,   │
 │                                                                     aspect_ratio, 'ready'   │
 │                                               video.asset.errored ⇒ status='failed'         │
 │                                               duration > cap      ⇒ delete asset, 'rejected'│
 │  ④ GET /v1/media/{assetId}/playback ──► API: membership check + mux.jwt.signPlaybackId      │
 │   ◄── { playbackId, tokens:{playback,thumbnail,storyboard}, expiresAt }                     │
 │     <MuxPlayer playbackId tokens={…} />                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘

                       ┌────────────────── PROFILE / DIRECTORY ──────────────────┐
 │ GET /v1/me/bootstrap ─► membership.profile { displayName, avatarUrl, bio }     │  (contract
 │ PATCH /v1/me/profile  ─► member_profiles(tenant_id, membership_id, …)          │   unchanged)
 │ GET /v1/members/{membershipId} ─► PROF-02 (photo, name, bio only)              │
 │ GET /v1/members?q=&cursor=&limit= ─► keyset over                               │
 │        app.imm_unaccent(lower(display_name)), membership_id                    │
 │        where role='member' and status='active' and deleted_at is null          │
 └────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/core/server/media/
├── keys.ts              # PURE: mediaObjectKey, variantKey, assertTenantKey (generalised), parse
├── limits.ts            # PURE: MEDIA_LIMITS per kind+purpose, VARIANT_WIDTHS, quota constants
├── inspect.ts           # PURE: sharp header decode + explicit format allow-list (refuses heif)
├── variants.ts          # PURE: sharp derivation (the icons.ts analogue)
├── storage.ts           # the ONLY file importing supabaseAdmin: sign upload/read, info, remove
├── service.ts           # start / complete / serve / delete, withTenantTx + membershipOfRecord
├── derive-job.ts        # kernel.media-derive-variants  (mirrors derive-icons-job.ts)
├── sweep-job.ts         # kernel.media-sweep-orphans    (self-re-arming, startAfter)
├── video/
│   ├── types.ts         # VideoProvider interface + VideoProviderError (domains/types.ts shape)
│   ├── mux.ts           # real adapter (@mux/mux-node)
│   ├── fake.ts          # env-selected local fake — e2e without a Mux account
│   ├── index.ts         # provider selection + assertProductionEnv()
│   └── event-job.ts     # kernel.media-mux-event
└── index.ts

packages/core/server/profiles/
├── service.ts           # read/update own profile, read another member, directory page
├── search.ts            # PURE: normalise a query term, encode/decode the keyset cursor
└── index.ts

packages/core/db/schema/
├── media-assets.ts          # media_assets  (+ RLS + tenantIsolationPolicy)
├── media-provider-events.ts # media_provider_events (webhook idempotency)
└── member-profiles.ts       # member_profiles (+ RLS + tenantIsolationPolicy)

apps/api/src/routes/
├── media.ts             # /v1/media/*  (tenant lane)
├── members.ts           # /v1/members* (tenant lane)
└── webhooks/mux.ts      # /v1/webhooks/mux — UNAUTHENTICATED, signature-verified

apps/web/
├── components/media/UploadField.tsx   # generalised useSignedUpload (from LogoUpload.tsx)
├── components/media/MediaImage.tsx    # <img src="/v1/media/{id}/w640" srcset=…>
├── components/media/VideoPlayer.tsx   # <MuxPlayer> + "processando" placeholder
├── app/(app)/perfil/{page,editar}     # PROF-01
├── app/(app)/membros/page.tsx         # PROF-03 (+ /membros/[membershipId] = PROF-02)
└── messages/pt-BR/{media,profile,members}.json
```

### Pattern 1: Derivable tenant-prefixed object key (the keystone)

**What:** the Storage key for every media object is a **pure function** of `(tenantId, assetId, variant)`, with no database lookup required to compute it.

```
original:  <tenant_id>/media/<assetId>/original.<ext>
variants:  <tenant_id>/media/<assetId>/w<width>.webp
```

**When to use:** everywhere. This is what makes the serving endpoint free of database reads, and it is what makes cross-tenant access structurally impossible rather than check-dependent.

**Why it works:** the API always builds the key from `ctx.tenantId` (the membership-of-record tenant, never client input). A tenant-B session asking for a tenant-A `assetId` produces the key `<B>/media/<A's assetId>/w640.webp`, which does not exist, so `createSignedUrl` answers "Object not found" and the route answers `404 NOT_FOUND` — never `403`, matching the repo's isolation convention [VERIFIED: packages/core/docs/SCHEMA-CONVENTIONS.md §(j) "the other tenant's id is `404 NOT_FOUND` (never `403`)"]. This is exactly the trick Phase 2 already relies on: *"tenant B completing A's id looks under B's prefix and finds nothing"* [VERIFIED: packages/core/server/platform/branding.ts:200-206].

**Example:**

```ts
// packages/core/server/media/keys.ts — PURE (no db, no env, no Storage client)
export const MEDIA_BUCKET = 'media';
const MEDIA_PREFIX = '/media/';

export function mediaOriginalKey(tenantId: string, assetId: string, ext: string): string {
  return `${tenantId}${MEDIA_PREFIX}${assetId}/original.${ext}`;
}

export function mediaVariantKey(tenantId: string, assetId: string, width: number): string {
  return `${tenantId}${MEDIA_PREFIX}${assetId}/w${width}.webp`;
}

/** Generalised from packages/core/server/branding/upload.ts:assertTenantKey (T-02-83/T-02-84). */
export function assertTenantKey(key: string, tenantId: string): void {
  const prefix = `${tenantId}${MEDIA_PREFIX}`;
  if (
    !tenantId ||
    !key.startsWith(prefix) ||
    key.length === prefix.length ||
    key.includes('..') ||
    key.includes('//') ||
    key.includes('\\')
  ) {
    throw new Error(`media key outside the tenant prefix: ${key}`);
  }
}
```

### Pattern 2: Request path enqueues, worker derives (02-13 prohibition)

**What:** `complete` decodes only the image **header** (format, dimensions), records mime/size/dimensions and `enqueueInTx`s `kernel.media-derive-variants`. The worker downloads the original, produces the width ladder with `sharp`, uploads each variant with a one-year `Cache-Control` (keys are immutable), then flips `status` to `ready`.

**When to use:** every image. Never resize in the request path.

**Why:** direct copy of the proven `kernel.branding-derive-icons` shape [VERIFIED: packages/core/server/platform/branding.ts:44-54 docblock, "the request path decodes the image HEADER only and enqueues; derivation … runs in the worker (T-02-80, prohibition)"]. Variant keys are immutable by construction (`w640.webp` for a given `assetId` never changes content), so no `iconVersion`-style optimistic-write dance is needed — a re-derive simply upserts the same keys.

### Pattern 3: Stable serving URL that 302s to a freshly signed Storage URL

**What:** `GET /v1/media/{assetId}/{variant}` → `302` with `Location: <signed Storage URL>` and `Cache-Control: private, max-age=1500`.

**When to use:** every private image the browser renders.

**Why this and not inline signed URLs:**

| | Inline signed URLs | Stable 302 endpoint |
|---|---|---|
| API payload cacheability | Bounded by the signed-URL TTL — a cached payload can outlive its URLs | Permanent; Phase 4 can use `"use cache"` / `revalidateTag` freely |
| Where the tenant check happens | At payload construction (once) | At **every** image fetch — criterion 4 holds structurally |
| Browser/SW caching of the image | Poor: the URL's `token` changes each payload fetch, so every render is a cache miss | Good: the 302 is cacheable [CITED: RFC 9111 — a 302 becomes cacheable with an explicit `Cache-Control` directive]; the signed target URL is stable for its TTL |
| Cost per image | 0 extra requests | 1 Cloud Run request per image **per `max-age` window per device** |
| DB reads on the hot path | 0 | **0** (Pattern 1 makes the key derivable) |

**Keeping the 302 cheap:** the only remote call is `createSignedUrl` (a POST to the Storage API). Memoise it in-process keyed by object key with a TTL slightly under the signed-URL TTL — the identical shape as the Phase 1/2 host cache (module `Map`, TTL is the invalidation) [VERIFIED: STATE.md 01-02 "proxy.ts host cache = module Map keyed by normalised host, 300 s hit / 60 s 404 / 10 s error"]. With a 3600 s signed TTL and a 3000 s memo, a feed of 20 images costs at most 20 Storage sign calls per instance per 50 minutes.

**Escape hatch:** if Phase 4 measures the hop as a hotspot, `createSignedUrls(paths, expiresIn)` batches N keys in one Storage call [VERIFIED: @supabase/storage-js@2.116.0 src/packages/StorageFileApi.ts:796-800] and payloads can inline them — the `/v1/media/…` URL stays the contract either way.

### Pattern 4: Profile hangs off the membership, not off the user

**What:** a `member_profiles` row keyed by `membership_id` (unique), carrying `tenant_id` (denormalised per convention (a)1), `user_id`, `display_name`, `bio`, `avatar_asset_id`, `nudge_dismissed_at`.

**Why:** `packages/core/docs/SCHEMA-CONVENTIONS.md` §(b)4 states it as a rule, not a preference: **"Profile data hangs off the membership (Phase 3), not off `users`: a person may present differently in different tenants."** [VERIFIED: packages/core/docs/SCHEMA-CONVENTIONS.md §(b) item 4]. `users` is pinned by pgTAP `040` to have no `tenant_id` and no `role`, so there is nowhere on `users` for a per-tenant bio to live.

**Rows are created eagerly, not lazily.** The migration backfills one row per existing membership (`insert … select` from `memberships ⋈ users`, `display_name := users.name`), and membership creation (sign-up, invite accept, seed) inserts one. Rationale: a lazy row would force the directory query into `coalesce(mp.display_name, u.name)` across two tables, which **cannot be covered by the trigram expression index** (R-10) — search would degrade to a seq scan plus a join. Eager rows keep both the search index and the keyset order index on a single table.

### Anti-Patterns to Avoid

- **A permissive `storage.objects` select policy for the `media` bucket.** `storage.objects` has RLS enabled and **zero policies** on this stack today [VERIFIED: `select polname … from pg_policy where polrelid='storage.objects'::regclass` returned 0 rows against the local Supabase Postgres, 2026-09-21]. The browser never holds a Supabase JWT for Storage (CLAUDE.md forbids `@supabase/supabase-js` in the browser for data/storage), so a policy would grant nothing that is used — while creating a latent widening the day a token does leak. Keep **zero policies** and pin that in pgTAP, exactly as 02-03 pinned `tenant_invites` at zero and exempted it by name from `010`'s at-least-one-policy assertion [VERIFIED: STATE.md decision 02-03].
- **Accepting SVG as a member photo.** Phase 2 accepts SVG for *brand logos* behind `svgLooksUnsafe` because a `super_admin`/`admin_tenant` uploads it. A member-uploaded SVG rendered in `<img>` is a stored-XSS surface with a much larger attacker population. Member avatars: `image/jpeg`, `image/png`, `image/webp` only.
- **Trusting the client's declared mime.** `start` validates the *declared* mime for a fast refusal; `complete` re-reads Storage's recorded `contentType` **and** decodes the header — the Phase 2 order (`info()` → size → contentType → header decode → remove on refusal) is the template [VERIFIED: packages/core/server/platform/branding.ts:209-247].
- **Uploading through the API.** Structural, not stylistic: Cloud Run caps HTTP/1 bodies at 32 MiB, well under the 50 MB Free-plan file limit.
- **A second migration applier.** `drizzle-kit generate` → review SQL → Supabase CLI applies. The bucket row needs **both** `[storage.buckets.media]` in `supabase/config.toml` (local) and an idempotent `*_media_bucket.sql` upsert (hosted) — the exact pattern of `20260917021738_branding_bucket.sql` [VERIFIED: supabase/migrations/20260917021738_branding_bucket.sql:1-45].

## Decisions Taken on Claude's Discretion

Each is a decision the CONTEXT explicitly delegated. The planner should pin each with the named test.

| # | Question | Decision | Evidence / rationale | Pin with |
|---|---|---|---|---|
| **R-01** | Video vendor economics — can the pilot afford Mux? | **Keep Mux (D-43 stands).** `video_quality: 'basic'` ⇒ **encoding free**; first **100,000 delivery minutes/month free**; storage ≈ **USD 0.0028/min/month at 1080p**. A pilot with 300 stored minutes ≈ **USD 0.84/month**. Cloudflare Stream's floor is **USD 5/month** (prepaid 1,000-minute storage increment). | [CITED: mux.com/docs/pricing.txt] / [CITED: developers.cloudflare.com/stream/pricing] | Resolves STATE's "[Phase 3]: Video vendor pricing is LOW confidence" blocker. Record the figures in PROJECT.md. |
| **R-02** | Video guard rails | `max_resolution_tier: '1080p'` (the Mux default) + `video_quality: 'basic'` + per-`purpose` **duration cap** enforced in the `video.asset.ready` handler (post: 300 s; the Phase 5 story rule will be 60 s on the same table) + a per-tenant **minutes-stored ceiling** checked at `start` via `sum(duration_seconds)`. Caps live in `packages/core/server/media/limits.ts` keyed by `(kind, purpose)`. | Mux enforces no duration at ingest; the asset is only measurable once ready. `AssetOptions.max_resolution_tier` defaults to `1080p` [VERIFIED: @mux/mux-node@15.2.0 package/resources/video/assets.d.ts — `"Max resolution tier … If not set, this defaults to 1080p"`]. | An integration test where a `duration` beyond the cap flips `status='rejected'` and calls `assets.delete`. |
| **R-03** | Mux webhook verification / idempotency / errors | Route `POST /v1/webhooks/mux`, unauthenticated, **raw body** preserved. `await mux.webhooks.unwrap(rawBody, headers, MUX_WEBHOOK_SECRET)` (HMAC-SHA256, `Mux-Signature: t=…,v1=…`, 5-minute tolerance). Idempotency: `insert into media_provider_events (id …)` with the webhook's own `event.id` as PK; a `23505` means already-seen ⇒ 200 and stop. Then `enqueueInTx('kernel.media-mux-event', …, { singletonKey: event.id })` and answer 2xx immediately. `video.asset.errored` / `video.upload.errored` ⇒ `status='failed'`, `failure_reason`, UI shows "não foi possível processar este vídeo". Correlate by `passthrough = assetId`. | `unwrap` / `verifySignature` are **async** in v15 [VERIFIED: @mux/mux-node@15.2.0 package/resources/webhooks/webhooks.d.ts:3-19 — both return `Promise`]. Every event carries `id: string` [VERIFIED: same file, `BaseWebhookEvent.id`]. Mux retries for **24 h with increasing delays** and may deliver duplicates even after a 2xx [CITED: mux.com/docs/core/listen-for-webhooks]. Header format + 5-min tolerance [CITED: mux.com/docs/core/verify-webhook-signatures]. | Replay the same body twice ⇒ one state change; a tampered body ⇒ 4xx; the Phase 2 Send Email Hook route is the signed-inbound-webhook precedent. |
| **R-04** | Where the criterion-4 admin video proof lives | A **minimal `admin_tenant`-only screen** (`/configuracoes/midia`), prototype-less ⇒ D-33 UI-SPEC + mockup: one upload zone, a list of the tenant's video assets with status, and `<MuxPlayer>` for a ready one. **No** "pick an existing asset" affordance (deferred). | Criterion 4 demands a real device playback check on iOS Safari and Android Chrome — an API-level proof alone cannot produce it. Phase 4's composer reuses the **upload hook and the player component**, not this screen, so the rebuild risk is near zero. | Playwright e2e with the fake video provider + `test: true` Mux assets in the hosted check; one manual real-device check recorded in UAT. |
| **R-05** | How a private media URL reaches the browser | **Stable `/v1/media/{assetId}/{variant}` → 302** (Pattern 3), `Cache-Control: private, max-age=1500`, signed target TTL 3600 s, in-process memo. Zero DB reads. Cross-tenant ⇒ 404. | See the Pattern 3 table; 302 cacheability [CITED: RFC 9111]. | Isolation case: tenant-B session, tenant-A `assetId` ⇒ `404 NOT_FOUND`, no `Location` header, no tenant name in the body. |
| **R-06** | Variant set | **One generic width ladder** `[128, 320, 640, 1080, 1600]`, always **WebP**, stored at `w<width>.webp`; the *subset* produced is chosen per `purpose` from one table in `limits.ts` — `avatar: [128, 320]`, `post: [320, 640, 1080, 1600]`, `cover: [640, 1080, 1600]`, `story: [640, 1080]`. Payload exposes `variants: [{ width, url }]` ⇒ direct `srcset`. | Adding a Phase 5/6 purpose reuses widths already defined; widening an existing purpose is a **re-derive job**, not a schema backfill — which is precisely what the CONTEXT asked for. A single output format keeps the key derivable (Pattern 1). | A unit test asserting `VARIANT_WIDTHS` ⊇ every purpose's set, and that every purpose's widths are a subset of the ladder. |
| **R-07** | Orphan lifecycle | Ship a **self-re-arming deferred pg-boss job** `kernel.media-sweep-orphans` (hourly cadence via `startAfter`, `singletonKey` constant): deletes `status='pending'` assets older than **24 h** (object + row) and `status='deleted'` assets older than **1 h**. Profile photo replacement marks the previous asset `deleted_at` (replace-on-write) and lets the sweeper collect it. | 24 h is not arbitrary: **the Supabase TUS upload URL itself expires after 24 h** [CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads — "valid for up to 24 hours"], so nothing legitimate can still be in flight past it. `boss.schedule()` is unused in this repo; `kernel.domain-verify` paces itself with deferred re-arms [VERIFIED: packages/core/server/jobs/boss.ts:148-151]. | An integration test that back-dates a pending row and asserts object + row are gone. |
| **R-08** | Profile model | `member_profiles` keyed by `membership_id` (unique), rows created **eagerly** + backfilled. `bootstrap.membership.profile` shape is unchanged — `me.ts:118` stops hardcoding and joins instead. | SCHEMA-CONVENTIONS §(b)4 (quoted in Pattern 4); the search index argument (Pattern 4). | pgTAP `020` cross-tenant case for `member_profiles`; a contract test that `bootstrap` still parses. |
| **R-09** | Bio cap / formatting / avatar fallback / photo removal / own profile | Bio: **150 characters**, plain text, `z.string().trim().max(150)`, newlines collapsed. Avatar fallback: the **existing `@tria/ui` `Avatar` neutral `User` icon** — no initials, zero new work. Removal: `PATCH /v1/me/profile { avatarAssetId: null }` ⇒ previous asset soft-deleted. Own `/perfil`: the PROF-02 header plus "Editar perfil", a **"Membros"** row (the directory entry, R-11) and the existing "Configurações" link. | 150 is the design team's number [VERIFIED: reference/frontend-design/lib/constants.ts:16 — `export const MAX_BIO_LENGTH = 150;`]. `Avatar` already renders `<User aria-hidden className="text-text-tertiary" …/>` when `src` is falsy [VERIFIED: packages/ui/src/primitives/Avatar.tsx:38-42]. | A 151-character bio ⇒ `400 VALIDATION_FAILED { bio: 'too_long' }`; a member with no photo renders the fallback. |
| **R-10** | Directory search semantics | **Accent- and case-insensitive substring**, via an `IMMUTABLE STRICT PARALLEL SAFE` wrapper over the **two-argument** `unaccent(regdictionary, text)` plus a **GIN trigram** index. | Proven end-to-end on this project's own Postgres — see §Code Example 7 for the exact SQL and the observed output. `unaccent` 1.1 and `pg_trgm` 1.6 are available (installed_version null) [VERIFIED: `select name, default_version, installed_version from pg_available_extensions …` → `pg_trgm\|1.6\|`, `unaccent\|1.1\|`]. | pgTAP: search `goncal` finds `João Gonçalves`; search `MUNOZ` finds `Íris Muñoz`; a tenant-B name is never returned. |
| **R-11** | Directory entry point, ordering, pagination | Entry: a **"Membros" row on `/perfil`** at route `/membros` — **not** a nav tab. Ordering: `app.imm_unaccent(lower(display_name)) asc, membership_id asc`. **Keyset** cursor (opaque base64 of `{n, id}`), page size **25**, explicit **"Carregar mais"** button. Empty/no-results copy in `apps/web/messages/pt-BR/members.json`. | D-40's bar already reaches Início + Comunidades + Eventos + Perfil by Phase 6; a fifth tab is over budget on a mobile-first bar. Keyset is the stated Phase 4 convention-to-be. "Carregar mais" is deterministic in Playwright (no IntersectionObserver flake) and the keyset contract is unchanged if Phase 4 swaps in infinite scroll. | e2e: two pages with no duplicate and no gap; a member renamed between pages does not break the cursor. |
| **R-12** | HEIC | **Re-encode in the browser**: `<img>` → `<canvas>` → `toBlob('image/jpeg', 0.85)` at max side 2048 whenever the picked file is not in the allow-list or exceeds the cap. Server **refuses** `heif`/`heic` explicitly at `start` (mime) **and** at `complete` (decoded `format === 'heif'` ⇒ `media: 'heic_unsupported'`). `<input accept="image/jpeg,image/png,image/webp">`. | The worker option is **refuted** by a live probe (§Pitfall 2). Safari decodes HEIC natively through the OS codec and can draw it to canvas [CITED: upsidelab.io/blog/handling-heic-on-the-web]; drawing an `<img>` (rather than an `ImageBitmap`) inherits the browser's default `image-orientation: from-image`, so EXIF rotation is handled without an EXIF parser. | Keep a **real iPhone-originated `.heic` fixture** in the repo: one unit test asserts the server refusal, one Playwright test on the iPhone-14 project asserts the re-encode path produces a JPEG under the cap. |
| **R-13** | D-02 first-access nudge | **Dismissible card in the `/inicio` home slot** (D-42), rendered while `avatar_asset_id is null or bio is null`, dismissed by writing `member_profiles.nudge_dismissed_at` (server-side — survives devices and reinstalls), placed **above** module home widgets and gone forever once dismissed or completed. | A first-access modal is hostile on mobile and competes with the invite/consent flow; a settings-row-only treatment is not a nudge. Server-side dismissal beats `localStorage` for an installed PWA whose storage the OS may evict. | e2e: the card appears for a photo-less member, disappears after dismissal, and does not return on a new session. |
| **R-14** | Kernel layout | `packages/core/server/{media,profiles}/*` — kernel, always on, no flag (D-16), mirroring `branding/`. Not `@tria/module-*`. | Biome confines `@tria/core/server/supabase-admin` to the kernel [VERIFIED: biome.json:50-56, 88-93 — group `"@tria/core/server/supabase-admin"`, message "Admin lane is kernel-only"], and the media broker must import it. A module package could not. | `pnpm lint` (the Biome rule is the test). |
| **R-15** | `storage.objects` policies for the private `media` bucket | **Zero policies.** Pin at zero in pgTAP and exempt by name from `010`'s at-least-one-policy assertion, mirroring `tenant_invites`/`platform_admins`. | `storage.objects` carries zero policies today [VERIFIED: live `pg_policy` query, 0 rows]; the browser never holds a Supabase JWT for Storage. | A new `supabase/tests/070-media-bucket.sql` asserting bucket row values **and** `count(*) = 0` policies scoped to `bucket_id = 'media'`. |
| **R-16** | Per-tenant quota accounting | `media_assets.bytes` + `media_assets.duration_seconds`; at `start`, `sum(bytes)` / `sum(duration_seconds)` over `tenant_id` with `deleted_at is null`, against constants in `limits.ts`. Partial index `(tenant_id) where deleted_at is null`. | Adequate at pilot row counts; Phase 8 replaces it with a counter row if it becomes hot. The surfaced number in the platform panel is explicitly deferred. | An integration test that the N+1-th upload past the ceiling is refused with `413`/`VALIDATION_FAILED { quota: 'exceeded' }`. |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resumable upload > 6 MB to Supabase Storage | Chunked `PUT` with your own offset bookkeeping | `tus-js-client` 4.3.1, `chunkSize: 6 * 1024 * 1024` exactly | Supabase's TUS endpoint currently requires exactly 6 MB chunks [CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads — "it must be set to 6MB (for now) do not change it"]; offset negotiation, 409 handling and resume-after-reconnect are the whole point |
| Resumable upload to Mux | Custom `Content-Range` loop | `@mux/upchunk` | Mux requires 256 KB-multiple chunks with `308`-continue semantics [CITED: mux.com/docs/guides/upload-files-directly]; UpChunk also gives progress and retries |
| Mux webhook signature check | Manual HMAC + string compare | `await mux.webhooks.unwrap(raw, headers, secret)` | Timing-safe compare and the 5-minute replay window are already implemented (`timingSafeEqual` is a private method on the `Webhooks` resource) |
| Mux playback token | Hand-rolled RS256 JWT with `jose` | `await mux.jwt.signPlaybackId(id, { keyId, keySecret, expiration, type })` | The `aud` claim values are Mux-specific single letters (`v`/`t`/`g`/`s`/`d`) [VERIFIED: @mux/mux-node@15.2.0 package/lib/jwt.d.ts:33-40 `enum TypeClaim { video = "v", thumbnail = "t", gif = "g", storyboard = "s", stats = "playback_id", drm_license = "d" }`]; getting them wrong fails silently at playback |
| Accent-insensitive search | A `display_name_ascii` column maintained by application code | `unaccent` + an `IMMUTABLE` wrapper + GIN trigram | A hand-maintained column drifts on every write path and cannot be enforced; the extension is already on the box |
| Image resize/compress | `canvas` on the server, or an image CDN | `sharp` in the worker with `limitInputPixels` | Already the repo's decoder, already hardened against decompression bombs [VERIFIED: packages/core/server/branding/icons.ts:11-12,19-20] |
| Signed-URL minting | Constructing the Storage JWT yourself | `createSignedUrl` / `createSignedUploadUrl` | The token is signed with the project secret server-side; re-implementing it means holding that secret in a second place |
| Object-key tenant assertion | A fresh `startsWith` check per call site | Generalise `assertTenantKey` from `branding/upload.ts` | It already refuses `..`, `//`, `\` and empty suffixes — three traversal classes a new implementation will forget |

**Key insight:** almost nothing in this phase is new *engineering*; it is new *wiring* of two already-proven local patterns (Phase 2's signed-upload broker, Phase 2's provider adapter + fake) plus one vendor SDK that already ships every primitive. The failure mode for this phase is not "we could not build it" — it is "we re-implemented the branding broker slightly differently and the two drifted".

## Runtime State Inventory

> Not a rename/refactor/migration phase in the Step 2.5 sense — but it **creates** runtime state outside git, which the deploy runbook must carry. Recorded here for the planner.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `media_assets`, `media_provider_events`, `member_profiles` tables. **`member_profiles` needs a data backfill**, not just a code change: one row per existing membership, `display_name := users.name` (seed tenants already have memberships). | Migration + `insert … select` backfill in the same migration |
| Live service config | **Supabase Storage bucket `media`** — exists only where it was created. Local stacks get it from `[storage.buckets.media]` in `supabase/config.toml`; hosted projects need `supabase/migrations/*_media_bucket.sql` (idempotent upsert). **Mux**: webhook endpoint URL, a signing key pair and an API token pair are created in the Mux dashboard, not in git. | Both files; a new `docs/DEPLOY.md` section; a Phase 01.1 runbook item |
| OS-registered state | None — no new scheduled tasks, no new processes. The sweeper and the derive job run in the existing `ROLE=worker` service. | None |
| Secrets/env vars | New: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE` (base64 PEM), `MUX_WEBHOOK_SECRET`. Plus a `VIDEO_PROVIDER` selector (`fake` \| `mux`) guarded by `assertProductionEnv()`. | GCP Secret Manager entries + `docs/DEPLOY.md` + `@t3-oss/env-core` schema in `packages/core/server/env.ts` |
| Build artifacts / installed packages | `sharp` is already installed and its **prebuilt libvips is fixed** — no rebuild needed and none should be attempted (see §Pitfall 2). No new native deps. | None |

## Common Pitfalls

### Pitfall 1: Bytes through Cloud Run
**What goes wrong:** an upload of a 30 MB phone video or a 12 MB photo is proxied through the API and either fails at the 32 MiB HTTP/1 body cap or pins an instance for the whole transfer.
**Why it happens:** it is the obvious way to write an upload endpoint.
**How to avoid:** structural — the broker returns a *target*, never accepts a body. There is no multipart parser anywhere in `packages/core/server/media/*`.
**Warning signs:** any route handler reading `c.req.arrayBuffer()` / `c.req.parseBody()` outside the webhook route.

### Pitfall 2: sharp accepts HEIC metadata and then dies on the pixels — VERIFIED
**What goes wrong:** you add `image/heic` to the allow-list, the Phase-2-style header check passes, the upload is accepted, and then the worker job fails on every iPhone photo — *after* the user was told the upload succeeded.
**Why it happens:** libvips can parse the ISO-BMFF container without the HEVC decoder plugin. `metadata()` therefore succeeds and reports `format: 'heif', compression: 'hevc'`, while any operation that touches pixels fails.
**Evidence (run 2026-09-21 against this repo's own `sharp` 0.35.4 / libvips 8.18.6, on a real HEIC produced by macOS `sips`; `file` reports `ISO Media, HEIF Image HEVC Main or Main Still Picture Profile`):**

```
$ node -e "sharp('t.heic').metadata().then(console.log)"
{ format: 'heif', mediaType: 'image/heic', width: 64, height: 64,
  compression: 'hevc', pages: 1, ... }                      # ← passes a header check

$ node -e "sharp('t.heic').resize(32).jpeg().toBuffer().then(...).catch(...)"
FAILED: t.heic: bad seek to 1024
        ...
        heif: Error while loading plugin: Support for this compression
        format has not been built in                         # ← dies on the pixels
```

`sharp.format.heif.input.fileSuffix` is `[".avif"]` — AV1 only. Adding HEVC requires a globally-installed libvips built with `libheif`+`libde265`+`x265` [CITED: sharp.pixelplumbing.com/install — prebuilt binaries provide "JPEG, PNG, Ultra HDR, WebP, AVIF, TIFF, GIF and SVG (input)"; HEIC needs "a custom, globally-installed version of libvips"].
**How to avoid:** R-12 — browser re-encode; server refuses on the **decoded format name** (`format === 'heif'`), not only on the declared mime. Note the existing `MIME_TO_FORMAT` map in `branding/icons.ts` has no HEIC entry, so today a HEIC declared as `image/jpeg` is caught as `format_mismatch` — the media path must keep that property.
**Warning signs:** a `heic`/`heif` string appearing in any allow-list; a `media-derive-variants` job failing with `bad seek`.

### Pitfall 3: TUS chunk size is not tunable
**What goes wrong:** you lower `chunkSize` to 1 MB to make mobile-Safari progress smoother and the upload starts failing.
**Why:** Supabase's TUS implementation currently requires exactly 6 MB chunks.
**How to avoid:** `chunkSize: 6 * 1024 * 1024` and treat it as a constant. Derive perceived smoothness from `onProgress` interpolation, not from smaller chunks.
**Secondary:** an unfinished TUS upload URL expires after 24 h and only one client may write to a URL at a time (others get `409`) [CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads]. R-07's sweeper window is aligned to that 24 h.

### Pitfall 4: Decompression bomb / oversized dimensions
**What goes wrong:** a 20 KB PNG that decodes to 60,000 × 60,000 pixels OOMs the worker.
**How to avoid:** copy Phase 2's guard verbatim — every `sharp()` call carries `limitInputPixels: MAX_INPUT_PIXELS` and the header check refuses any side above `MAX_INPUT_SIDE` [VERIFIED: packages/core/server/branding/icons.ts:19-20 `MAX_INPUT_SIDE = 4096`]. Media may want a larger side than branding's 4096 (a 12 MP phone photo is 4032 × 3024, which fits; a 48 MP one at 8000 × 6000 does not) — recommend `MEDIA_MAX_INPUT_SIDE = 8192` with its own `limitInputPixels`.

### Pitfall 5: The signed URL outliving (or under-living) the payload
**What goes wrong:** a feed payload cached for 10 minutes carries signed URLs with a 5-minute TTL; half the images 400 after five minutes. Or the reverse: a 7-day signed URL is copied out of DevTools and shared publicly.
**How to avoid:** R-05 removes the coupling entirely — the payload carries no signed URL.

### Pitfall 6: Webhook replay and out-of-order delivery
**What goes wrong:** `video.asset.ready` is delivered twice (Mux explicitly warns duplicates happen even after a 2xx), or `video.asset.errored` arrives after a later successful re-upload, clobbering a good row.
**How to avoid:** R-03's `media_provider_events` unique-id insert makes duplicates free. For ordering, write conditionally — `update … where id = $asset and status <> 'ready'` — the same optimistic-write discipline as Phase 2's `writeIconsIfCurrent` [VERIFIED: packages/core/server/platform/branding.ts:330-345].
**Warning signs:** an `update` in the webhook handler with no status predicate.

### Pitfall 7: Burning Mux minutes in CI
**What goes wrong:** every e2e run creates a real Mux asset; storage and encoding costs accumulate on an account with no free plan.
**How to avoid:** the env-selected **fake video provider** is the default everywhere except production (the `packages/core/server/domains/{fake,vercel}.ts` precedent). For the rare hosted smoke test, `new_asset_settings.test: true` — "Test asset are watermarked with the Mux logo, limited to 10 seconds, deleted after 24 hrs" [VERIFIED: @mux/mux-node@15.2.0 package/resources/video/assets.d.ts, `AssetOptions.test` docblock].

### Pitfall 8: `super_admin` has no membership — the media broker must not assume one
**What goes wrong:** a platform admin hits `/v1/media/...` and the code dereferences a null membership.
**Why:** `super_admin` is not a membership role; it lives in `platform_admins` and the identity is "not a member of anything" [VERIFIED: packages/core/docs/SCHEMA-CONVENTIONS.md §(b)5; isolation.test.ts case g].
**How to avoid:** the media and profile routes are **tenant-lane only** and go through `requireAuth` + `membershipOfRecord` like every other tenant route; the branding path stays the platform lane and is explicitly **not** migrated into the broker (CONTEXT §Phase Boundary).

### Pitfall 9: Changing the bootstrap contract shape
**What goes wrong:** `membership.profile` grows a field and every cached client payload / contract test breaks.
**How to avoid:** `bootstrapSchema` already declares `profile: { displayName: string, avatarUrl: string | null, bio: string | null }` [VERIFIED: packages/contracts/src/bootstrap.ts:15-19]. Fill it from `member_profiles`, put `avatarUrl` = `/v1/media/{assetId}/w128`, and add **nothing**. New profile fields (e.g. the nudge flag) belong on a `GET /v1/me/profile` response, not on bootstrap.

### Pitfall 10: Hard-coded pt-BR strings
**What goes wrong:** `turbo lint` passes and `scripts/check-ui-literals.sh` fails the build.
**How to avoid:** every refusal message, empty state and "processando" placeholder goes into a new namespaced catalog file under `apps/web/messages/pt-BR/` (the catalog is namespaced per kernel area and a duplicate leaf path throws) [VERIFIED: STATE.md 02-04].

## Code Examples

### 1. Start an upload (API, tenant lane)

```ts
// packages/core/server/media/service.ts — shape mirrors platform/branding.ts:startBrandingUpload
export async function startUpload(ctx: TenantCtx, body: StartUploadBody): Promise<StartUploadResult> {
  const limits = MEDIA_LIMITS[body.kind][body.purpose];           // limits.ts, pure
  if (!limits.mimes.includes(body.mime)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'type_not_allowed' });
  }
  if (body.size > limits.maxBytes) {
    throw new ApiError(413, 'VALIDATION_FAILED', { media: 'too_large', maxBytes: limits.maxBytes });
  }

  const assetId = crypto.randomUUID();
  const ext = mimeToExtension[body.mime];
  const key = mediaOriginalKey(ctx.tenantId, assetId, ext);
  assertTenantKey(key, ctx.tenantId);                              // BEFORE any Storage call

  await withTenantTx(ctx, async (tx) => {
    await assertQuota(tx, ctx.tenantId, body.size);                // R-16
    await tx.insert(mediaAssets).values({
      id: assetId, tenantId: ctx.tenantId, ownerUserId: ctx.userId,
      kind: body.kind, purpose: body.purpose, status: 'pending',
      provider: 'supabase', mime: body.mime, bytes: body.size, objectExt: ext,
    });
  });

  // `token` is what TUS needs in `x-signature`; `signedUrl` is what a plain PUT needs.
  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data) throw new ApiError(500, 'INTERNAL');
  return {
    assetId,
    signedUrl: data.signedUrl,
    token: data.token,
    path: key,
    maxBytes: limits.maxBytes,
    resumableThresholdBytes: 6 * 1024 * 1024,
  };
}
```

### 2. Browser: plain PUT under 6 MB, TUS above

```ts
// apps/web/components/media/upload.ts — generalises apps/web/lib/upload.ts + useSignedUpload
import * as tus from 'tus-js-client';

const SUPABASE_TUS_ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`;

export async function uploadFile(file: File, started: StartUploadResult, onProgress: (p: number) => void) {
  if (file.size <= started.resumableThresholdBytes) {
    return uploadToSignedUrl(started.signedUrl, file, { mime: file.type, onProgress });
  }
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: SUPABASE_TUS_ENDPOINT,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      // The signed upload TOKEN, not a Supabase session JWT — the browser never holds one.
      headers: { 'x-signature': started.token, 'x-upsert': 'false' },
      // MUST be exactly 6 MB — Supabase's TUS server rejects other sizes.
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: 'media',
        objectName: started.path,
        contentType: file.type,
        cacheControl: '3600',
      },
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);   // survives a backgrounded tab
      upload.start();
    });
  });
}
```
Source: [CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads]; the signed-upload token field is [VERIFIED: @supabase/storage-js@2.116.0 src/packages/StorageFileApi.ts:382-420 — returns `{ signedUrl, path, token }`].

### 3. Browser: HEIC / oversize re-encode before upload (R-12)

```ts
// Runs only when the picked file is outside the allow-list or over the cap.
// Drawing an <img> (not an ImageBitmap) inherits `image-orientation: from-image`,
// so EXIF rotation is applied by the browser — no EXIF parser needed.
export async function normaliseImage(file: File, maxSide = 2048, quality = 0.85): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('canvas encode failed');           // ⇒ t('media.errors.heicUnsupported')
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

### 4. Mux direct upload (API, through the adapter)

```ts
// packages/core/server/media/video/mux.ts
const upload = await mux.video.uploads.create({
  cors_origin: tenantOrigin,                  // the tenant's own host — required for browser uploads
  timeout: 3600,                              // signed upload URL validity, seconds
  new_asset_settings: {
    playback_policies: ['signed'],            // D-44 — never 'public'
    video_quality: 'basic',                   // R-01 — encoding is free at this level
    max_resolution_tier: '1080p',             // the default, pinned explicitly
    passthrough: assetId,                     // ≤ 255 chars; a UUID fits — our correlation key
    ...(isProduction ? {} : { test: true }),  // Pitfall 7
  },
});
// upload.id, upload.url  →  the browser drives UpChunk against upload.url
```
[VERIFIED: @mux/mux-node@15.2.0 package/resources/video/uploads.d.ts:24,117-136 and package/resources/video/assets.d.ts `AssetOptions` — `playback_policies`, `video_quality: 'basic' | 'plus' | 'premium'`, `max_resolution_tier: '1080p' | '1440p' | '2160p'`, `passthrough` "**Max: 255 characters**", `test`.]

### 5. Mux webhook route (idempotent, fast 2xx)

```ts
// apps/api/src/routes/webhooks/mux.ts — NO auth middleware; signature IS the auth.
app.post('/v1/webhooks/mux', async (c) => {
  const raw = await c.req.text();                                  // raw body, before any parsing
  let event: UnwrapWebhookEvent;
  try {
    event = await mux.webhooks.unwrap(raw, c.req.raw.headers, env.MUX_WEBHOOK_SECRET);
  } catch {
    return c.json({ error: { code: 'FORBIDDEN' } }, 403);          // bad signature or > 5 min old
  }

  const enqueued = await withAdminTx(async (tx) => {
    const rows = await tx.execute(sql`
      insert into public.media_provider_events (id, provider, type, received_at)
      values (${event.id}, 'mux', ${event.type}, now())
      on conflict (id) do nothing
      returning id`);
    if (rows.length === 0) return false;                           // duplicate — already handled
    await enqueueInTx(tx, MEDIA_MUX_EVENT_QUEUE, { eventId: event.id, type: event.type, data: event.data },
      { singletonKey: event.id });
    return true;
  });

  return c.json({ received: true, enqueued }, 200);                // fast 2xx; Mux retries 24 h otherwise
});
```
[VERIFIED: @mux/mux-node@15.2.0 package/resources/webhooks/webhooks.d.ts:4,19 — `unwrap`/`verifySignature` return `Promise`; `BaseWebhookEvent.id: string`.] [CITED: mux.com/docs/core/verify-webhook-signatures — `Mux-Signature: t=…,v1=…`, HMAC-SHA256 over `timestamp.raw_request_body`, 5-minute default tolerance.] [CITED: mux.com/docs/core/listen-for-webhooks — 24 h retries with increasing delays; duplicates possible after a 2xx.]

### 6. Playback token (API) and player (web)

```ts
// API — GET /v1/media/{assetId}/playback, tenant lane, membership already checked.
const tokens = await mux.jwt.signPlaybackId(playbackId, {
  keyId: env.MUX_SIGNING_KEY_ID,
  keySecret: env.MUX_SIGNING_KEY_PRIVATE,      // base64 PEM from Secret Manager
  expiration: '2h',                            // must exceed the video duration
  type: ['video', 'thumbnail', 'storyboard'],  // ⇒ { 'playback-token', 'thumbnail-token', … }
});
```

```tsx
// web
<MuxPlayer
  playbackId={playbackId}
  tokens={{ playback: t.playback, thumbnail: t.thumbnail, storyboard: t.storyboard }}
  streamType="on-demand"
  playsInline
/>
```
[VERIFIED: @mux/mux-node@15.2.0 package/resources/jwt.d.ts:4-5 (overloads: single `type` ⇒ `Promise<string>`, array ⇒ `Promise<Tokens>`) and package/lib/jwt.d.ts:52-62 (`MuxJWTSignOptionsBase { keyId, keySecret, keyFilePath, type, expiration, params }`).] [VERIFIED: @mux/playback-core dist/types/types.d.ts:96-101 — `export type Tokens = { playback?: string; drm?: string; thumbnail?: string; storyboard?: string; }`.]

### 7. Accent-insensitive directory search — PROVEN on this project's Postgres

Run against the local Supabase Postgres (`127.0.0.1:54322`) on 2026-09-21, inside a rolled-back transaction:

```sql
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- The two-argument form pins the dictionary, which is what makes IMMUTABLE honest.
create or replace function app.imm_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select extensions.unaccent('extensions.unaccent', $1) $$;

create index member_profiles_name_trgm_idx on public.member_profiles
  using gin (app.imm_unaccent(lower(display_name)) extensions.gin_trgm_ops);

-- keyset order index (tenant_id FIRST, per SCHEMA-CONVENTIONS (a)4)
create index member_profiles_tenant_name_idx on public.member_profiles
  (tenant_id, app.imm_unaccent(lower(display_name)), id);
```

Observed output on a three-row fixture (`João Gonçalves`, `Ana Paula`, `Íris Muñoz`):

```
 where app.imm_unaccent(lower(dn)) like '%'||app.imm_unaccent(lower('goncal'))||'%'
 id |       dn
----+----------------
  1 | João Gonçalves        ← accent-insensitive

 where … like '%'||app.imm_unaccent(lower('MUNOZ'))||'%'
 id |     dn
----+------------
  3 | Íris Muñoz            ← case- AND accent-insensitive

 where … like '%'||app.imm_unaccent(lower('Íris'))||'%'
 id |     dn
----+------------
  3 | Íris Muñoz            ← an accented query still matches
```

The page query (keyset, D-47 filters, tenant-lane, RLS active):

```sql
select mp.id, mp.display_name, mp.bio, mp.avatar_asset_id
  from public.member_profiles mp
  join public.memberships m on m.id = mp.membership_id
 where mp.tenant_id = app.tenant_id()
   and m.role = 'member' and m.status = 'active' and m.deleted_at is null
   and ($1::text is null or app.imm_unaccent(lower(mp.display_name))
        like '%' || app.imm_unaccent(lower($1)) || '%')
   and ($2::text is null or
        (app.imm_unaccent(lower(mp.display_name)), mp.id) > ($2, $3::uuid))
 order by app.imm_unaccent(lower(mp.display_name)), mp.id
 limit $4;
```
Escape `%`, `_` and `\` in `$1` as literals — the repo already has `likeContains` for this [VERIFIED: packages/core/server/platform/tenants.ts:70-71].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Proxy uploads through the app server | Signed direct-to-storage upload + `complete` confirmation | Standard since ~2020, mandatory on Cloud Run | The only design that respects the 32 MiB body cap |
| `mux.webhooks.verifySignature(...)` used synchronously | `await mux.webhooks.unwrap(...)` — **returns a Promise** in v15 | `@mux/mux-node` v8+ rewrite (Stainless-generated) | Forgetting the `await` silently accepts unverified webhooks; both methods are async [VERIFIED: package/resources/webhooks/webhooks.d.ts:4,19] |
| `encoding_tier: 'baseline' \| 'smart'` | `video_quality: 'basic' \| 'plus' \| 'premium'` | Mux deprecated `encoding_tier` | `encoding_tier` is marked `@deprecated` in the SDK types |
| `mp4_support: 'standard'` | Static Renditions API | Deprecated in the SDK | Not needed in V1 (HLS only) |
| Supabase image transforms | Worker-produced WebP variants | Pro-plan feature; the pilot is on Free | Design must not assume transforms arrive (explicitly deferred) |
| `heic2any` / `libheif-js` in the browser | Native `<img>`/canvas decode on iOS | Safari decodes HEIC via the OS codec | A ~1 MB WASM decoder is unnecessary on the only platform that produces HEIC |

**Deprecated/outdated:**
- `sharp` "just add HEIC support" advice from 2020-era blog posts: refuted for the prebuilt binary (§Pitfall 2).
- `next-pwa`, `middleware.ts`, `images.domains` — already covered by CLAUDE.md's "What NOT to Use"; the `MediaImage` component uses plain `<img srcset>` against `/v1/media/...` rather than `next/image`, because `next/image`'s optimizer would re-fetch the private URL server-side and duplicate the variant work the worker already did.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drawing an `<img>` to `<canvas>` applies EXIF orientation automatically on iOS Safari (default `image-orientation: from-image`), so no EXIF parser is needed | §Code Example 3, R-12 | Sideways profile photos from iPhones held in portrait. **Mitigation:** the plan must include a real-device check with an iPhone-originated fixture; if it fails, add `createImageBitmap(blob, { imageOrientation: 'from-image' })` or an EXIF read. |
| A2 | iOS Safari's `accept="image/jpeg,…"` triggers the photo picker's automatic HEIC→JPEG conversion (as opposed to `accept="image/*"`) | R-12 | Nothing breaks — the canvas re-encode is the actual guarantee; this is a belt-and-braces optimisation. Safari 17+ bug reports suggest the behaviour is not reliable. |
| A3 | `@mux/mux-player-react` 3.13.4 works inside a React 19.3 / Next 16 RSC tree when rendered from a `'use client'` boundary | §Standard Stack | A wrapper or `next/dynamic({ ssr: false })` is needed. Low risk; the component is a custom element wrapper. |
| A4 | An in-process memo of signed Storage URLs is acceptable on Cloud Run with `min-instances: 1` (the Phase 1/2 host-cache precedent) | Pattern 3 | Slightly more Storage sign calls than modelled after a scale-out; no correctness impact. |
| A5 | 300 s is a sensible V1 max duration for an admin post video, and the per-tenant minutes ceiling can be a constant rather than a per-tenant column | R-02 | Only a product-tuning question; both are one-line changes in `limits.ts`. Phase 8 hardening owns the real numbers. |
| A6 | Mux's published pay-as-you-go rates apply to a new Brazilian account with no negotiated contract | R-01 | The cost model shifts; the adapter (D-43) is the mitigation. **Re-verify in the Mux dashboard at account creation** — the STATE blocker asked for pricing verification "at phase start", and published rates are the best available proxy until an account exists. |
| A7 | The `file` (PDF) upload kind is in scope for this phase (the goal sentence says "images, files and phone video"), with the *UI* for attachments deferred to Phase 4 | §Standard Stack (`file-type`) | If out of scope, drop `file-type` and one branch of `limits.ts`. Worth one line of confirmation in the plan. |
| A8 | Making `member_profiles` rows eagerly (with a backfill) is preferable to a lazy row with read-time `coalesce` | R-08, Pattern 4 | A lazy row cannot use the trigram expression index; search degrades. The argument is sound but the tradeoff (an extra insert on every membership creation) is a design judgement. |

## Open Questions (RESOLVED)

> All three questions below were decided during `/gsd-plan-phase 03` and are adopted in the
> committed plans. Each carries an inline **RESOLVED** marker naming the plan that implements it.
> Nothing in this section is still open; no planning decision is waiting on it.

1. **Does the pilot have a Mux account yet?**
   - What we know: `docs/DEPLOY.md` has no Mux entries; Phase 01.1 (cloud provisioning) has **not run** (STATE: "Phase 01.1 stays unexecuted until the end"; memory: "cloud work deferred to the end").
   - What's unclear: whether the Mux API tokens, signing key and webhook secret can exist during Phase 3 at all.
   - Recommendation: build the **fake video provider first** and make it the default in every non-production environment (the `domains/fake.ts` precedent). All of Phase 3's automated proof — including the isolation case for the playback token — runs against the fake. The real-device criterion-4 check becomes a **Phase 01.1 runbook item**, recorded as a known-blocked UAT line exactly like Phase 2's four blocked items. The planner should expect criterion 4 to close partially.
   - **RESOLVED (adopted):** the recommendation is taken in full. `03-06-PLAN.md` Task 2 builds the `VideoProvider` seam with the fake implementation as the default in every non-production environment, `assertProductionEnv()` refuses a `mux` selection without secrets, and every automated proof in 03-06/03-07/03-08 runs against the fake. `03-08-PLAN.md` Task 3 records the real-device HLS check and the real Mux transcode as the two known-blocked Phase 01.1 UAT lines. No Mux account is required to execute this phase.

2. **Where does the "Membros" entry point live if the user later wants it in the nav bar?**
   - What we know: D-40 orders tabs with "Perfil" last; by Phase 6 the bar carries four tabs.
   - What's unclear: whether the product owner considers a `/perfil` row discoverable enough.
   - Recommendation: ship R-11 (`/perfil` row → `/membros`) and surface it in the D-33 mockup review. Moving it to a tab later is a registry change, not a rewrite.
   - **RESOLVED (adopted):** R-11 ships as the `/perfil` row. `03-04-PLAN.md` Task 1 authors the "Membros" (`users`) row on `/perfil` pointing at `/membros`; `03-05-PLAN.md` Task 1 lands the `/membros` route the row targets; `03-07-PLAN.md` keeps the nav tab budget untouched. The entry point was carried through the D-33 review and is fixed in `03-UI-SPEC.md` (status `approved`). Promoting it to a nav tab stays a later registry change.

3. **`MEDIA_MAX_INPUT_SIDE` — 8192 or 4096?**
   - What we know: branding uses 4096; a 48 MP phone photo is 8000 × 6000.
   - Recommendation: 8192 for the media path with its own `limitInputPixels`, and refuse above it with a distinct pt-BR message. Measure worker memory on a 48 MP fixture before Phase 4's composer multiplies the volume.
   - **RESOLVED (adopted):** `MEDIA_MAX_INPUT_SIDE = 8192`. `03-01-PLAN.md` pins it in `packages/core/server/media/limits.ts` with its own `limitInputPixels` on the sharp pipeline and a distinct pt-BR refusal for the decompression-bomb case; the 48 MP JPEG fixture is a Wave 0 requirement in `03-VALIDATION.md`, so the memory measurement happens inside this phase rather than before Phase 4.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Supabase stack (Docker) | Storage bucket, pgTAP, e2e | ✓ | CLI 2.117.0; `supabase_storage_rede-social` container running | — |
| Postgres `unaccent` | PROF-03 search | ✓ (available, not installed) | 1.1 | — (FTS is a worse alternative) |
| Postgres `pg_trgm` | PROF-03 search index | ✓ (available, not installed) | 1.6 | Plain `like` without an index (acceptable at pilot size) |
| `sharp` + prebuilt libvips | MEDIA-02 variants | ✓ | sharp 0.35.4 / libvips 8.18.6 | — |
| libvips **HEVC/HEIC decoder** | (would be needed for worker-side HEIC) | ✗ | — | **Browser re-encode (R-12)** — the chosen design |
| `node:24-slim` base image | Worker runtime | ✓ | `apps/api/Dockerfile` | — |
| Mux account + API tokens | MEDIA-03 real transcode | ✗ (Phase 01.1 not run) | — | **Fake video provider** for all automated proof; real device check deferred to 01.1 |
| GCP Secret Manager | Mux secrets | ✗ (Phase 01.1 not run) | — | Local `.env` with fake-provider defaults; `assertProductionEnv()` refuses a `mux` selection without secrets |
| Playwright + iPhone-14 mobile project | Criterion 1/3 mobile upload proof | ✓ | 1.63.0, `apps/web/e2e` two-tenant fixtures | — |

**Missing dependencies with no fallback:** none that block coding.
**Missing dependencies with fallback:** Mux account / GCP Secret Manager → fake provider + a deferred Phase 01.1 UAT item (the honest analogue of Phase 2's four blocked items).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (e2e) |
| Config file | per-package `vitest.config.ts`; `apps/web/playwright.config.ts`; `supabase/tests/*.sql` |
| Quick run command | `pnpm --filter @tria/core test` |
| Full suite command | `pnpm verify` (the local exit gate; `ci.yml` mirrors it step for step) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEDIA-01 | `start` mints a signed URL for a key under the caller's tenant prefix and records `pending` | unit + integration | `pnpm --filter @tria/core test media` | ❌ Wave 0 |
| MEDIA-01 | Bytes never transit the API — no body parser on the media routes | unit (grep-style guard) | `pnpm --filter @tria/core test media-no-body` | ❌ Wave 0 |
| MEDIA-01 | `complete` on another tenant's `assetId` is `404 { media: 'object_missing' }` | integration | `pnpm test:integration -- media-isolation` | ❌ Wave 0 |
| MEDIA-02 | Worker derives the purpose's width ladder as WebP under immutable keys, flips `status='ready'` | integration | `pnpm test:integration -- media-derive` | ❌ Wave 0 |
| MEDIA-02 | Oversize / disallowed type refused with a pt-BR message at `complete` (criterion 3) | integration + e2e | `pnpm --filter @tria/web exec playwright test e2e/media-upload.spec.ts` | ❌ Wave 0 |
| MEDIA-02 | A real iPhone `.heic` fixture is refused server-side and re-encoded client-side | unit + e2e (mobile project) | `pnpm --filter @tria/web exec playwright test e2e/media-heic.spec.ts` | ❌ Wave 0 |
| MEDIA-03 | `video.asset.ready` flips `status`, records `playback_id`/`duration`/`aspect_ratio`; replay is a no-op | integration | `pnpm test:integration -- mux-webhook` | ❌ Wave 0 |
| MEDIA-03 | `video.asset.errored` ⇒ `status='failed'` and the UI shows the failure copy | integration + e2e | `pnpm test:integration -- mux-webhook` | ❌ Wave 0 |
| MEDIA-03 | Real-device HLS playback on iOS Safari + Android Chrome | **manual-only** | — (device check; justified: Playwright's bundled Chromium cannot prove iOS Safari HLS — same class as 02-11's standalone-install finding) | UAT item |
| TENANT-04 | Tenant-B session cannot obtain a Storage signed URL for a tenant-A object (302 route ⇒ 404) | integration | `pnpm test:integration -- isolation` (new case) | ✅ extend `apps/api/tests/integration/isolation.test.ts` |
| TENANT-04 | Tenant-B session cannot obtain a Mux playback token for a tenant-A asset | integration | `pnpm test:integration -- isolation` (new case) | ✅ extend same file |
| TENANT-04 | `media_assets` / `member_profiles` cross-tenant read returns zero rows in the tenant lane | pgTAP | `pnpm supabase test db` | ✅ extend `supabase/tests/020-tenant-isolation.sql` |
| TENANT-04 | `media` bucket exists, is **private**, caps at 50 MiB, has the expected mime allow-list and **zero** `storage.objects` policies | pgTAP | `pnpm supabase test db` | ❌ Wave 0 (`070-media-bucket.sql`) |
| PROF-01 | Member edits display name + bio; 151-char bio is `400` | integration + e2e | `pnpm --filter @tria/web exec playwright test e2e/profile.spec.ts` | ❌ Wave 0 |
| PROF-01 | Profile photo upload end-to-end on the iPhone-14 project; served through `/v1/media/…` | e2e (mobile) | same spec | ❌ Wave 0 |
| PROF-01 | `bootstrap.membership.profile` is fed from `member_profiles` and still parses `bootstrapSchema` | integration | `pnpm test:integration -- bootstrap` | ✅ extend |
| PROF-02 | Another member's profile shows photo/name/bio and **no** role badge (D-45) | e2e | `e2e/profile.spec.ts` | ❌ Wave 0 |
| PROF-03 | Directory lists `role='member'` + `status='active'` only; staff absent (D-47) | integration | `pnpm test:integration -- members` | ❌ Wave 0 |
| PROF-03 | `goncal` finds `João Gonçalves`; `MUNOZ` finds `Íris Muñoz` | pgTAP + integration | `pnpm supabase test db` | ❌ Wave 0 |
| PROF-03 | Keyset pagination: two pages, no duplicate, no gap | integration + e2e | `pnpm test:integration -- members` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter <package> test` for the touched package.
- **Per wave merge:** `pnpm supabase test db` + `pnpm test:integration`.
- **Phase gate:** full `pnpm verify` green before `/gsd-verify-work` (Phase 2's 17m30s run is the baseline).

### Wave 0 Gaps

- [ ] `supabase/tests/070-media-bucket.sql` — bucket row invariants + zero `storage.objects` policies (R-15) — covers TENANT-04
- [ ] `packages/core/server/media/__tests__/` — pure-layer unit tests (keys, limits, inspect, variants) — covers MEDIA-01/02
- [ ] `apps/api/tests/integration/media.test.ts` — start/complete/serve/quota — covers MEDIA-01/02
- [ ] `apps/api/tests/integration/mux-webhook.test.ts` — signature, replay, ready/errored — covers MEDIA-03
- [ ] `apps/api/tests/integration/members.test.ts` — directory filters, search, keyset — covers PROF-03
- [ ] `apps/web/e2e/media-upload.spec.ts`, `media-heic.spec.ts`, `profile.spec.ts`, `members.spec.ts`
- [ ] **Fixtures:** a real iPhone-originated `.heic`, a >6 MB JPEG (TUS path), a 48 MP JPEG (bomb guard), a short HEVC `.mov` — checked into `apps/web/e2e/fixtures/` (keep them small; the HEIC can be a genuine iPhone capture downscaled *on an iPhone*, not re-encoded on a Mac)
- [ ] `scripts/seed.ts` extension: members with and without a photo, and at least two accented pt-BR names (so the search assertions have real data)
- [ ] Extend `apps/api/tests/integration/isolation.test.ts` with the Storage-signed-URL and Mux-playback-token cases (SCHEMA-CONVENTIONS §(j) rule 2 makes this mandatory, not optional)

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Phase 1's `jose` + JWKS middleware; the media routes only consume `ctx` |
| V3 Session Management | no (unchanged) | HttpOnly cookies via the Next BFF |
| V4 Access Control | **yes** | Three-layer scoping: `requireAuth` → `membershipOfRecord` → RLS `tenant_id = app.tenant_id()`. Plus the structural fourth layer of Pattern 1 (key derived from the session's tenant). The webhook route is the one unauthenticated endpoint and is authenticated **by signature**. |
| V5 Input Validation | **yes** | Zod 4 at every boundary; `likeContains` escaping for the search term; `assertTenantKey` for every object key; the webhook body validated by `unwrap` before parsing |
| V6 Cryptography | **yes** | Never hand-rolled: `mux.jwt.signPlaybackId` (RS256), `mux.webhooks.unwrap` (HMAC-SHA256 + timing-safe compare), Supabase-minted Storage signed URLs |
| V12 File and Resource | **yes** | Magic-byte/header validation, per-kind size caps, bucket-level `file_size_limit` + `allowed_mime_types`, server-built keys, private bucket, no SVG for member photos |
| V13 API and Web Service | **yes** | Stable machine error codes in the D-09 envelope; the webhook answers a bare `{received}` and never echoes provider data |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in the object key (`../../other-tenant/...`) | Tampering / Elevation | `assertTenantKey` refuses `..`, `//`, `\` and prefix escapes **before every Storage call**; the key is never built from client input |
| IDOR on `assetId` across tenants | Information Disclosure | Pattern 1: a foreign `assetId` resolves under the caller's own prefix ⇒ Storage 404 ⇒ `404 NOT_FOUND`, never `403` (no existence oracle) |
| Signed-URL leakage / over-long TTL | Information Disclosure | 3600 s Storage TTL, 2 h Mux playback TTL, `Cache-Control: private` on the 302, and the URL is never persisted in an API payload |
| Mux webhook forgery | Spoofing | `unwrap` (HMAC-SHA256, timing-safe, 5-minute replay window) |
| Mux webhook replay / duplicate state change | Tampering | `media_provider_events` unique-id insert + conditional `update … where status <> 'ready'` |
| Stored XSS via SVG avatar | Tampering | Member photos: `image/jpeg`, `image/png`, `image/webp` only — SVG is refused outright (unlike the admin-only branding path) |
| Decompression bomb / pixel-flood DoS | Denial of Service | `limitInputPixels` on every `sharp()`; max-side refusal from the header; derivation runs in the worker, never in the request path |
| Storage exhaustion by a member | Denial of Service | Per-tenant byte and video-minute ceilings at `start` (R-16); orphan sweeper (R-07) |
| Cross-tenant leakage through a cached signed URL in the service worker | Information Disclosure | The Phase 2 SW cache is allow-list shaped and `/v1/*` is `NetworkOnly` [VERIFIED: STATE.md 02-11] — the 302 route inherits that; verify the new route matches the existing `/v1/` allow-list entry |
| HEIC accepted then failing in the worker (availability + false success) | Denial of Service | §Pitfall 2 — explicit `format === 'heif'` refusal at `complete` |
| `super_admin` reaching tenant media | Elevation | Media/profile routes are tenant-lane only; the platform lane (`withAdminTx`) is Biome-confined to `server/{tenancy,platform}` |

## Project Constraints (from CLAUDE.md)

Directives extracted from `./.claude/CLAUDE.md` that bind this phase. The planner must not produce a task that contradicts any of these.

1. **All business logic goes through the Hono API on Cloud Run.** Only two frontend↔Supabase exceptions exist (Auth via `@supabase/ssr`, read-only Realtime). **Storage is not one of them** — `@supabase/supabase-js` in the browser for data/storage is explicitly forbidden. The browser talks to Storage only via an API-minted signed URL/token.
2. **Uploads never pass through Cloud Run** (32 MiB HTTP/1 body cap) — signed upload URLs + TUS direct to Storage; Mux direct upload for video.
3. **Never store raw HEVC/MOV in Storage as the playback source** — Mux (or Cloudflare Stream).
4. **Never use the `service_role` key or the `postgres` role for tenant queries** — `api_user` + `set local role authenticated` per transaction. (`supabaseAdmin` for Storage is the reviewed kernel exception, Biome-confined.)
5. **Supabase Free plan**: 50 MB per file, **no native image transforms**, 200 Realtime connections. Worker-side resizing is mandatory; the design must not assume Pro.
6. **Object keys are `<tenant_id>/<entity>/<uuid>.<ext>`** with `storage.objects` policies on the tenant prefix. *(Research recommends zero policies with a pgTAP pin instead — see R-15. The key layout is honoured; the policy posture is the delta and is flagged for the planner.)*
7. **`sharp` is for server-side image processing**; feed images would normally use Supabase transforms — unavailable on Free, hence the worker variants.
8. **pt-BR UI, all strings centralised** via `next-intl` — enforced by `scripts/check-ui-literals.sh`.
9. **Migrations**: `drizzle-kit generate` → review SQL → **only the Supabase CLI applies**. Never `drizzle-kit migrate`/`push`.
10. **Biome, not ESLint**; TypeScript 7; Node 24; pnpm 12 + Turborepo; Vitest 5 + Playwright + pgTAP.
11. **Modularity**: media and profiles are **kernel** (D-16), always on, no `tenant_modules` flag.
12. **Design**: `reference/frontend-design/` is the visual source of truth — port presentational components, never refactor in place; prototype-less screens go through the D-33 UI-SPEC + mockup review.
13. **GSD workflow**: no direct repo edits outside a GSD command.

## Sources

### Primary (HIGH confidence)

- **This repository, read this session:** `packages/core/docs/SCHEMA-CONVENTIONS.md`; `packages/core/server/branding/upload.ts`; `packages/core/server/branding/icons.ts`; `packages/core/server/platform/branding.ts`; `packages/core/server/jobs/boss.ts`; `packages/core/server/domains/types.ts`; `packages/core/server/http/api-error.ts`; `packages/core/db/schema/memberships.ts`; `packages/contracts/src/bootstrap.ts`; `apps/api/src/routes/me.ts`; `apps/web/components/platform/LogoUpload.tsx`; `packages/ui/src/primitives/Avatar.tsx`; `reference/frontend-design/lib/constants.ts`; `reference/frontend-design/components/profile/{EditProfileForm,UserListItem}.tsx`; `supabase/config.toml`; `supabase/migrations/20260917021738_branding_bucket.sql`; `supabase/tests/060-branding-bucket.sql`; `apps/api/Dockerfile`; `biome.json`
- **Published package type definitions, unpacked and read this session:** `@mux/mux-node@15.2.0` (`resources/jwt.d.ts`, `lib/jwt.d.ts`, `resources/webhooks/webhooks.d.ts`, `resources/video/uploads.d.ts`, `resources/video/assets.d.ts`); `@mux/mux-player-react@3.13.4` (`dist/types/types.d.ts`); `@mux/playback-core` (`dist/types/types.d.ts`); `@supabase/storage-js@2.116.0` (`src/packages/StorageFileApi.ts`)
- **Live probes run this session:** `sharp` HEIC pixel-decode falsification (failing output pasted in §Pitfall 2); `unaccent` + `pg_trgm` availability and the GIN-trigram search recipe against `127.0.0.1:54322` (output pasted in §Code Example 7); `pg_policy` on `storage.objects` (0 rows); `npm view` versions for six packages; `gsd-tools query package-legitimacy check`

### Secondary (MEDIA confidence)

- https://www.mux.com/docs/pricing.txt — per-minute encode/store/deliver rates, 100,000 free delivery minutes, no free account plan
- https://developers.cloudflare.com/stream/pricing/ — USD 5 per 1,000 storage minutes (prepaid), USD 1 per 1,000 delivered, free ingest/encoding
- https://www.mux.com/docs/guides/secure-video-playback — signed playback policy, 2048-bit RSA signing keys, `signPlaybackId`, `aud` claim values
- https://www.mux.com/docs/core/verify-webhook-signatures — `Mux-Signature: t=…,v1=…`, HMAC-SHA256 over `timestamp.raw_body`, 5-minute tolerance
- https://www.mux.com/docs/core/listen-for-webhooks — 24 h retries with increasing delays; duplicates possible after a 2xx; direct-upload event list
- https://www.mux.com/docs/guides/upload-files-directly — direct upload flow, `cors_origin`, UpChunk, 256 KB-multiple chunks, `passthrough` correlation
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads — TUS endpoint, exact 6 MB chunk requirement, `x-signature`, 24 h URL validity, 409 on concurrent writers
- https://supabase.com/docs/guides/storage/uploads/standard-uploads — "ideal for small files that are not larger than 6MB"
- https://supabase.com/docs/guides/storage/uploads/file-limits — Free 50 MB / Pro 500 GB; per-bucket limits cannot exceed the global limit
- https://sharp.pixelplumbing.com/install/ — prebuilt binary format list (HEIC absent); custom global libvips required for HEIC
- https://datatracker.ietf.org/doc/rfc9111/ — a 302 is cacheable only with an explicit `Cache-Control`/`Expires` directive

### Tertiary (LOW confidence — flagged for validation)

- https://upsidelab.io/blog/handling-heic-on-the-web — Safari decodes HEIC via the OS codec in `<img>`, CSS and canvas (basis for A1/A2; **must** be confirmed by the iPhone device check)
- https://developer.apple.com/forums/thread/743049 — Safari 17+ `accept="image/*"` may still hand back HEIC (why A2 is belt-and-braces only)
- https://oneuptime.com/blog/post/2026-01-25-postgresql-accent-insensitive-collation/view — the IMMUTABLE `unaccent` wrapper pattern (superseded by the direct probe in §Code Example 7, which is HIGH)

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — every API signature read from the published `.d.ts` or from `node_modules`, not from memory; versions confirmed with `npm view` on 2026-09-21
- Architecture: **HIGH** — the broker generalises a pattern already shipped and tested in this repo (Phase 2, 02-13/02-14); the one novel piece (the derivable-key 302 endpoint) is justified by a comparison table and an existing 404-not-403 convention
- Pitfalls: **HIGH** for the HEIC decoder (falsified with pasted output), the TUS chunk size, and the webhook replay semantics; **MEDIUM** for the mobile-Safari upload UX (A1/A2 need a device)
- Video economics: **MEDIUM** — published rates only; no account exists yet (A6)
- Search: **HIGH** — proven against this project's own Postgres

**Research date:** 2026-09-21
**Valid until:** 2026-10-21 (30 days). Re-verify sooner if: a Mux account is created (rates), `sharp` publishes a major (HEIF plugin policy), or Supabase lifts the 6 MB TUS chunk restriction.
