# Phase 3: Media Pipeline & Member Profiles - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

> Decision numbering continues from Phase 2 (D-01..D-24 in `01-CONTEXT.md`, D-25..D-42 in `02-CONTEXT.md`) because code comments already cite those ids; this phase owns **D-43..D-50**.

<domain>
## Phase Boundary

Phase 3 gives the platform one tenant-scoped **upload broker** that every later module reuses, and gives members a **profile** and a way to find each other:

- **Media broker (MEDIA-01, TENANT-04):** `POST` to the API validates kind/mime/size against the caller's membership and records a pending `media.assets` row; the API returns a signed upload target; the browser uploads **directly to Supabase Storage** (plain `PUT` ≤ 6 MB, TUS above) or **directly to Mux** for video — bytes never transit Cloud Run (32 MiB body cap, Pitfall 8); a `complete` call verifies the object, stores mime/dimensions and enqueues the worker. Private `media` bucket, object keys `<tenant_id>/<entity>/<uuid>.<ext>`, `storage.objects` policies on the tenant prefix as defence in depth.
- **Image variants (MEDIA-02):** the Free plan has **no native transforms**, so the worker resizes/compresses with `sharp` into display sizes; original size and type limits are enforced per kind with magic-byte validation and a clear pt-BR refusal at confirmation time (criterion 3).
- **Video (MEDIA-03):** **Mux** direct upload → webhook → HLS + thumbnail, with a "processando" placeholder until ready; an `admin_tenant` can upload an iPhone-recorded HEVC video and it plays on iOS Safari and Android Chrome (criterion 4).
- **Member profile (PROF-01):** photo, display name and bio, editable by the member; the photo is the first real consumer of the broker and is served through a signed, tenant-checked URL in worker-produced display sizes (criterion 1). Wires the `/configuracoes` "Editar perfil" row and replaces the `/perfil` stub.
- **Other members (PROF-02, PROF-03):** open another member's profile, and browse a paginated, name-searchable member directory that lists only members of the caller's own tenant (criterion 2).
- **Isolation (criterion 4):** the two-tenant suite is extended so a tenant-B session cannot obtain a signed URL — Storage or Mux playback — for a tenant-A object.

Out of this phase: link unfurling (MEDIA-04, Phase 4 — user-observable only on a post); the post composer and any feed consumption of media (Phase 4); stories media and community covers (Phase 5); event covers (Phase 6); `admin_tenant` member management, role changes, blocking and moderation of profiles (Phase 8); the branding upload path, which already shipped in Phase 2 as a platform-lane kernel capability against the **public** `branding` bucket (D-27) and is **not** migrated into the media broker.

</domain>

<decisions>
## Implementation Decisions

### Video: vendor, playback and scope
- **D-43:** The video vendor is **Mux** (`@mux/mux-node` 15.1.0 server-side, `@mux/mux-player-react` 3.13.3 for playback), per the stack's recommendation and the PROJECT.md key decision. Flow: the API creates a **Mux direct upload** URL, the browser uploads straight to Mux, the `video.asset.ready` webhook writes `playback_id`, `duration`, `aspect_ratio` and thumbnail info onto the `media.assets` row and flips `status` to `ready`; until then the UI shows "processando". Cloudflare Stream stays the documented cheaper alternative with the same architecture — the provider is reached through an adapter so a swap is a new implementation, not a rewrite. — **Reversibility:** costly — the webhook contract, the asset columns (`provider`, `provider_asset_id`, `playback_id`) and the player component are consumed from Phase 4 on; swapping vendors means re-ingesting existing assets, though the adapter keeps the call sites intact.
- **D-44:** Mux playback uses the **signed playback policy**, not public. The Mux signing key lives in GCP Secret Manager; the API mints a **short-lived playback JWT per request**, authorised against the caller's membership exactly like a Storage signed URL. Rationale: TENANT-04 says media is "served only through signed, tenant-checked URLs", and criterion 4's "a tenant-B session cannot obtain a signed URL for a tenant-A object" must hold for video too — a public playback ID would make video the one media kind the isolation suite cannot defend. — **Reversibility:** costly — the playback-token endpoint and the key are part of the media contract every later video surface (feed, stories) calls; moving to public playback later would silently widen access on already-published assets.

### Member profile
- **D-45:** Another member's profile (**PROF-02**) shows **photo, display name and bio only** — no role badge, no join date, no counts, no follow/message affordances. This is the V1 answer to `PROTOTYPE.md` open question 10: there is **no admin badge on profiles**. The prototype's `ProfileHeader` is ported for its layout with follow/message/handle/website/stats removed.
- **D-46:** The **display name is freely editable** by the member after sign-up, with **no history kept** — the sign-up name is simply overwritten. The **e-mail remains the identity anchor** for staff (Phase 8 member management and support search key on e-mail, not on the display name). No moderation gate, no approval, no "nome anterior" record. — **Reversibility:** reversible — adding a retained original name later is an additive column plus a backfill from `users.name`.

### Member directory
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 3: Media Pipeline & Member Profiles" — goal, the four success criteria, research-needed list (video vendor pricing at phase start, TUS on mobile Safari, signed-URL semantics without native transforms, direct-upload + webhook → `status='ready'`), notes (`media.assets` columns, tenant-prefixed private buckets, video has no consumer until Phase 4)
- `.planning/REQUIREMENTS.md` — TENANT-04, MEDIA-01, MEDIA-02, MEDIA-03, PROF-01, PROF-02, PROF-03 (exact wording); MEDIA-04 (Phase 4) for what the broker must **not** absorb; V2-PROF-01 (hide-me) and V2-PROF-02 (account deletion / LGPD export) for what the directory query should not preclude
- `.planning/PROJECT.md` §Constraints, §Key Decisions, §Out of Scope — Supabase Free plan (worker resize, 50 MB cap), "video through a streaming vendor (Mux or Cloudflare Stream)", frontend never hits Supabase for data, V2-safe schema

### Prior decisions this phase builds on
- `.planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-CONTEXT.md` — D-02 (photo/bio deferred to **this phase's** first-access nudge), D-09 (403 envelope pattern), D-16 (**media and profiles are kernel, always on, no flag**), D-18 (`@tria/*` package layout, worker = same image with `ROLE=worker`), D-19 (module template)
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-CONTEXT.md` — **D-27** (the signed-upload shape this phase generalises: signed URL → direct browser upload → `complete` verifies; `branding` bucket is **public** and stays a platform-lane capability), D-28 (worker icon derivation with `sharp`), D-33 (UI-SPEC + mockup approval for prototype-less screens), D-40 (nav tabs; "Perfil" last), D-42 (`/inicio` home slots, `/configuracoes` with the "Editar perfil" placeholder row)
- `.planning/STATE.md` §Accumulated Context → Decisions — especially `02-13` (icon derivation never runs in the request path; stateless signed-upload id; `assertTenantKey` before every Storage call; versioned immutable derived keys), `02-18` (`membershipOfRecord` is the one where-clause for the caller's membership; `useSignedUpload` error handling), `02-09` (adapter + pg-boss job shape with idempotent side effects) — and §Blockers/Concerns "[Phase 3]: Video vendor pricing is LOW confidence" (resolved here by D-43; **still verify Mux pricing at phase start**)

### Architecture, schema and pitfalls
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — `tenant_id` first in every index, RLS on every table, admin-lane-only writes, soft-delete columns
- `.planning/research/PITFALLS.md` §Pitfall 8 (uploads through the API), §Pitfall 1 (service role kills RLS), §Pitfall 9 (V2-safe schema conventions)
- `.planning/research/STACK.md` §Stack Pattern 4 (Media pipeline: buckets, upload flow, TUS threshold, image transforms, Mux direct upload + webhook, attachments), §Stack Pattern 2 (Cloud Run 32 MiB body cap, tenant scoping), §Stack Pattern 3 (migrations, `api_user` role)
- `.claude/CLAUDE.md` §Technology Stack (`tus-js-client` 4.3.1, `sharp` 0.35.4, `@mux/mux-node` 15.1.0, `@mux/mux-player-react` 3.13.3) and §"What NOT to Use" — no uploads through Cloud Run, no raw HEVC/MOV in Storage as the playback source, no `@supabase/supabase-js` in the browser for data/storage
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (two lanes) and §Recommended Project Structure

### Design (the design team's prototype is the visual source of truth)
- `reference/frontend-design/` — the design source the user re-confirmed during this discussion; port presentational components, never refactor in place
- `reference/frontend-design/components/profile/ProfileHeader.tsx` — layout for PROF-02, minus follow/message/handle/website (D-45)
- `reference/frontend-design/components/profile/EditProfileForm.tsx` — avatar + name/bio form with the bio counter; drop username/website, wire "Alterar foto" to the media broker
- `reference/frontend-design/components/profile/UserListItem.tsx` — the member-directory row (remove the follow button)
- `reference/frontend-design/components/explore/SearchBar.tsx` — the search input for PROF-03
- `reference/frontend-design/components/create/ImagePicker.tsx` — the prototype's image picking/preview interaction for the upload UX
- `reference/frontend-design/components/ui/{Avatar,Input,Skeleton,EmptyState,BottomSheet,Toast}.tsx` — primitives already ported into `@tria/ui` in Phase 2
- `.planning/research/PROTOTYPE.md` §5 `components/profile/` and `components/explore/` port notes, §4 rows `/profile`, `/profile/edit`, `/user/[userId]`, §9 port plan (profiles row: M), §10 **open question 10** (answered here by D-45: no admin badge, no event stats), §11 "do not port" list (follow graph, reputation, ProfileStats, ProfileGrid, LMS)
- `.planning/sketches/MANIFEST.md` + `.planning/phases/02-tenant-shell-branding-platform-panel/02-UI-SPEC.md` — the design language and review pattern (D-33) this phase's prototype-less screens follow

### Deployment
- `docs/DEPLOY.md` — secrets inventory; the Mux token pair and the **Mux signing key** (D-44) are new entries for GCP Secret Manager, and a new Phase 01.1 runbook item

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/server/branding/upload.ts` — the **direct template for the media broker's pure layer**: stateless `<kind>-<uuid>.<ext>` upload ids, `brandingObjectKey`, versioned immutable derived keys, and `assertTenantKey` (refuses `..`, `//`, `\`, and any key outside `<tenant_id>/…`). Generalise, don't re-invent.
- `packages/core/server/platform/branding.ts` — the only file that talks to Storage in Phase 2: `createSignedUploadUrl`, header-only image inspection in the request path, `enqueueInTx` of the derive job, optimistic versioned write, `removeQuietly` on refusal. The media broker repeats this shape **in the tenant lane** instead of the platform lane, which is the new part.
- `packages/core/server/branding/{icons.ts,derive-icons-job.ts}` — `sharp` usage and the worker-side derivation job that MEDIA-02's variant generation mirrors.
- `apps/web/components/platform/LogoUpload.tsx` — exports `useSignedUpload` (request signed URL → `PUT` → `complete`, with the WR-07 try/catch error boundary) and the drop-zone UI; `LogoUpload.test.ts` is the existing hook-test pattern in `apps/web`.
- `packages/core/server/tenancy/membershipOfRecord` — the one where-clause for "the caller's membership in the tenant of record"; every profile and directory read reuses it (02-18, WR-05).
- `packages/core/server/jobs/boss.ts` (`enqueueInTx`, `registerJobQueues`) and `apps/api/src/worker.ts` — kernel jobs are registered explicitly before module jobs; the image-variant job and any sweeper follow the `kernel.branding-derive-icons` / `kernel.domain-verify` precedent.
- `packages/core/server/domains/*` — the **provider-adapter precedent** (interface + real implementation + env-selected local fake) that the Mux adapter should copy so the pipeline is e2e-testable without a Mux account.
- `packages/contracts/src/bootstrap.ts` — `membership.profile { displayName, avatarUrl, bio }` already exists in the contract; `apps/api/src/routes/me.ts:118` hardcodes it (`user.name`, `null`, `null`). This phase makes it real without changing the contract shape.
- `apps/web/app/(app)/perfil/page.tsx` — the stub whose docblock says "Phase 3 replaces it with the profile module UI"; already renders `Avatar`, `PageHeader`, `StatusPill` from `@tria/ui` and links to `/configuracoes`.
- `apps/web/app/(app)/configuracoes/page.tsx` — the "Editar perfil" row rendered with the `soon` badge, waiting to be wired.
- `apps/web/messages/pt-BR/app.json` — `app.profile.*` and `app.settings.rows.editProfile` keys already exist; the catalog is namespaced per kernel area and `scripts/check-ui-literals.sh` fails the lint on any hard-coded pt-BR string.
- `supabase/config.toml` — `[storage] file_size_limit = "50MiB"` and the `[storage.buckets.branding]` block are the pattern for the new private `media` bucket (mime allow-list + size cap per bucket); a matching `supabase/migrations/*_media_bucket.sql` is needed for hosted projects.
- `apps/web/e2e/*` + `playwright.config.ts` — two-tenant fixtures (`tria-demo.localhost`, `tria-lab.localhost`), mobile (iPhone 14) + desktop projects, and `apps/web/e2e/worker.ts` which spawns a `ROLE=worker` for specs that need a job to run.

### Established Patterns
- **Uploads never pass through Cloud Run** — signed target out, direct browser upload, `complete` verifies. The 32 MiB HTTP/1 body cap makes this structural, not stylistic.
- **`assertTenantKey` before every Storage call**, and the object key is always built server-side from the validated path/session tenant id — never from client input (T-02-83/T-02-84).
- **Nothing heavy runs in the request path**: the request decodes headers and enqueues; resizing, derivation and any provider round trip happen in the worker (02-13 prohibition).
- **Three-layer tenant scoping**: JWT/membership check → explicit `tenant_id` predicate (`membershipOfRecord`) → RLS under `authenticated` in a per-request transaction. Cross-tenant reads live only in `packages/core/server/platform/*` behind `withAdminTx`, which Biome confines.
- **Every API refusal is a stable machine code** in the envelope, mapped to a redirect or a toast on the web; new codes for media (oversize, bad type, not ready) follow the D-09 pattern.
- **Migrations**: Drizzle schema → `drizzle-kit generate` → `supabase/migrations` → Supabase CLI applies; `tenant_id` first in indexes; every new table gets RLS plus a select-only tenant policy unless it is admin-lane-only. `supabase/tests/010` asserts every table has at least one policy.
- **Adapters with a local fake** (domain provider, mail transport) keep provider-backed flows e2e-testable; `assertProductionEnv()` refuses a provider selection without its secrets in any environment.
- **pt-BR catalog only** — no string literals in UI, enforced by `scripts/check-ui-literals.sh` after `turbo lint`.
- `pnpm verify` is the local exit gate and `ci.yml` mirrors it step for step.

### Integration Points
- `packages/core/db/schema/` → new `media.assets` (and whatever profile table D-45/Claude's discretion settles on); `packages/core/db/schema/index.ts` exports; new `supabase/migrations/*`, `supabase/config.toml` `[storage.buckets.media]`, and pgTAP additions under `supabase/tests/`.
- `apps/api/src/routes/` → new media broker routes (create upload, complete, playback token, serve/redirect) and profile + directory routes under the tenant lane; `me.ts:118` stops hardcoding `profile`.
- `packages/contracts/src/` → new `media.ts` and `profiles.ts` Zod schemas; `bootstrap.ts` keeps its shape but is fed real data.
- `apps/api/src/worker.ts` + kernel jobs → image-variant derivation, Mux webhook follow-up, any orphan sweeper.
- New webhook route for Mux (`video.asset.ready` / `video.asset.errored`) with signature verification — the Phase 2 Send Email Hook route is the precedent for a signed inbound webhook.
- `apps/web/app/(app)/perfil/` → real profile page + edit; new other-member profile route and the directory route; `app/(app)/configuracoes/page.tsx` "Editar perfil" row wired; wherever the directory entry point lands (D-40 registry nav, `/perfil` row, or TopBar slot).
- `apps/web/components/platform/LogoUpload.tsx` → the `useSignedUpload` hook generalises into a shared upload hook (likely `@tria/core/ui` or `apps/web/components/media/`) used by both branding and member photo.
- `docs/DEPLOY.md` + GCP Secret Manager → `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, the Mux **signing key id + private key** (D-44), and a webhook signing secret; a corresponding Phase 01.1 runbook item since that phase has not run.
- `scripts/seed.ts` → seed members with and without a photo so the directory, the avatar fallback and the two-tenant smoke have something to assert.

</code_context>

<specifics>
## Specific Ideas

- The user re-anchored the design mid-discussion: *"lembrando que o design está na pasta reference"* — `reference/frontend-design/` is the visual source for the profile, edit-profile, directory row and image-picker screens; anything it lacks goes through the D-33 UI-SPEC + mockup review before coding.
- Another member's profile is deliberately plain: photo, name, bio. No badge tells a member who the admin is (D-45).
- The directory is a members-only list: the tenant's own staff are not in it (D-47).
- A member can rename themselves at will; support identifies people by e-mail (D-46).
- Criterion 4's device proof is a real iPhone-recorded (HEVC) video played back on iOS Safari and Android Chrome — keep a real iPhone-originated fixture in the repo for the image path too.

</specifics>

<deferred>
## Deferred Ideas

- **Link unfurling / embeds (MEDIA-04)** — Phase 4, where a post makes it observable; the broker must not grow an unfurl path here.
- **Admin media library as a content-reuse surface** ("pick an existing asset" when composing) — if a media screen ships in this phase it is for the criterion-4 proof; the reuse affordance belongs to Phase 4's composer.
- **Per-member "hide-me" in the directory (V2-PROF-01)** — the D-47 query is written so a visibility flag is one more predicate.
- **Self-service account deletion / data export (V2-PROF-02, LGPD Art. 18)** — V2; note that member photos will need a deletion path when it lands.
- **Retained original sign-up name / rename history** — not kept (D-46); revisit only if Phase 8 moderation proves it necessary.
- **Role badge on profiles and in the directory** — rejected for V1 (D-45); the admin is identified by their content.
- **Supabase Pro upgrade for native image transforms** — V2 per PROJECT.md; the worker-variant design must not assume it arrives.
- **Cloudflare Stream migration** — documented alternative to D-43; the provider adapter keeps the call sites stable if pilot video cost becomes the binding constraint.
- **Per-tenant storage/video quota surfaced in the platform panel** — if a ceiling ships (Claude's discretion), the `super_admin`-visible number is a Phase 8 admin-panel concern.

</deferred>

---

*Phase: 03-media-pipeline-member-profiles*
*Context gathered: 2026-09-21*
