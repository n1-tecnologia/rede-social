---
phase: 03-media-pipeline-member-profiles
plan: 06
subsystem: media
tags: [media, video, mux, adapter, webhook, jobs, schema, pgboss, rls, pgtap, hmac]

# Dependency graph
requires:
  - phase: 03-01
    provides: "the media broker (startUpload/complete/serve/delete), media_assets with its video columns, the private media bucket, signUpload/assertTenantKey/mediaOriginalKey, MEDIA_LIMITS and the named 501 video seam this plan replaced"
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "the domains/{types,fake,vercel,index} provider-adapter precedent, assertProductionEnv, the signed-inbound-webhook route shape (hooks.ts), enqueueInTx + the short queue policy, the RLS-with-zero-policies posture"
  - phase: 01-foundation
    provides: "tenant/admin transaction lanes, requireAuth + membership of record, pg-boss wiring, publicWebOrigin"
provides:
  - "VideoProvider — a provider-neutral video seam (createDirectUpload, getAsset, deleteAsset, signPlayback, verifyWebhook) with a NORMALISED VideoProviderEvent; no code outside mux.ts reads a vendor field"
  - "createFakeVideoProvider — the fail-safe default everywhere but production: a Supabase signed upload URL in the private media bucket, a real HMAC verifyWebhook, and a deferred synthetic ready event that simulates transcoding"
  - "createMuxVideoProvider — signed playback policy, video_quality basic, 1080p tier, passthrough, test assets outside production, await webhooks.unwrap"
  - "POST /v1/media/uploads { kind: 'video' } — admin_tenant-only, mime/byte caps, the per-tenant stored-minutes ceiling, a provider direct-upload URL; replaces 03-01's 501 video_provider_missing"
  - "POST /v1/webhooks/mux — unauthenticated, the provider's HMAC signature IS its authentication, out of openapi.json, answers 2xx fast"
  - "media_provider_events — RLS enabled with ZERO policies; the provider's own event id is the primary key and therefore the replay defence"
  - "kernel.media-provider-event — applies ready/errored to a media_assets row idempotently and out-of-order-safely, with the per-purpose duration cap that deletes the provider asset"
  - "VIDEO_PROVIDER + the five Mux secrets with their all-or-none assertProductionEnv rule"
affects: [03-07, 03-08, phase-04-feed, phase-05-stories, phase-01.1-cloud-provisioning]

actuals:
  tokens: 61997
  tasks: 3
  commits: 2
plan_head_before: 66aa79aaf4ca977b4f8c0de9ad34242f1cfe5b04

# Tech tracking
tech-stack:
  added: ["@mux/mux-node@15.2.0"]
  patterns:
    - "Provider seam with a NORMALISED event: the vendor's payload is translated once, at the adapter boundary, so the job, the row and every later surface are written against the interface — a second vendor is a new file, not a rewrite"
    - "One normaliser shared by both implementations (wire.ts): the fake verifies and normalises through the SAME code the real adapter does, so a synthetic webhook proves something about the real path"
    - "A fake that keeps the structural invariant honest: it mints its direct-upload target in the real private bucket rather than accepting bytes at a dev-only route, so no byte-accepting endpoint exists anywhere"
    - "Two independent idempotency layers on an inbound webhook: the provider's event id as a PRIMARY KEY with `on conflict do nothing returning id`, plus singletonKey on the job under the short policy"
    - "Conditional writes as the out-of-order defence: ready under `status not in ('ready','deleted')`, errored under the same predicate — replay is a no-op, a late failure cannot clobber a good row, and a failed asset can still recover"
    - "An error class that CANNOT carry a provider body: the constructor takes a kind and a status and accepts no message argument at all"

key-files:
  created:
    - packages/core/server/media/video/types.ts
    - packages/core/server/media/video/wire.ts
    - packages/core/server/media/video/fake.ts
    - packages/core/server/media/video/mux.ts
    - packages/core/server/media/video/index.ts
    - packages/core/server/media/video/inbox.ts
    - packages/core/server/media/video/event-job.ts
    - packages/core/db/schema/media-provider-events.ts
    - apps/api/src/routes/webhooks/mux.ts
    - apps/api/tests/integration/mux-webhook.test.ts
    - packages/core/tests/media-video.test.ts
    - supabase/migrations/20260922020438_media_provider_events.sql
    - supabase/migrations/20260922020621_media_bucket_video.sql
  modified:
    - packages/core/package.json
    - packages/core/server/env.ts
    - packages/core/server/media/service.ts
    - packages/core/server/media/index.ts
    - packages/core/db/schema/media-assets.ts
    - packages/core/db/schema/index.ts
    - packages/contracts/src/media.ts
    - apps/api/src/routes/media.ts
    - apps/api/src/app.ts
    - apps/api/src/worker.ts
    - apps/api/tests/integration/media.test.ts
    - supabase/config.toml
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/040-schema-conventions.sql
    - supabase/tests/070-media-bucket.sql
    - docs/DEPLOY.md

key-decisions:
  - "Package-legitimacy approval recorded verbatim for 03-07 to inherit — see the dedicated section below"
  - "`mux.jwt.signPlaybackId` returns keys `playback-token` / `thumbnail-token` / `storyboard-token`, NOT `playback` / `thumbnail` / `storyboard` — 03-RESEARCH Code Example 6 shows the PLAYER's shape; the adapter maps between them"
  - "The normaliser lives in its own `wire.ts` so the fake and the real adapter share ONE translation; a second hand-written one would let the fake pass while the real path drifted"
  - "The webhook's admin transaction moved into the kernel (`video/inbox.ts`): Biome confines `@tria/core/db/admin-tx` to the kernel, so the route cannot open it"
  - "`fake` added to MEDIA_PROVIDERS and to the media_assets provider CHECK: the fake is a first-class implementation and the row must say which one brokered the asset rather than lying"
  - "The private media bucket's mime allow-list is now exactly the union of MEDIA_LIMITS (adds video/mp4 + video/quicktime), because the fake stores its bytes there; pinned as a SET in pgTAP so neither a widening nor a narrowing can pass"
  - "The errored predicate excludes `deleted` as well as `ready`: `status='deleted'` is the handle 03-08's sweeper collects by, so flipping a soft-deleted row to `failed` would strand its provider asset forever"
  - "`NODE_ENV` added to the kernel env schema as the one production signal; it is NOT an adapter selector, so it can never silently switch a vendor on"
  - "corsOrigin comes from the validated x-tenant-host header, falling back to the tenant's verified primary domain — the browser must upload to the provider from the tenant's own origin"

patterns-established:
  - "Pattern 1 (normalised provider event): the adapter translates at the boundary; `VideoProviderEvent` is our shape and the job never sees a vendor key"
  - "Pattern 2 (shared wire translation): both implementations of a provider run the same normaliser, so the local one is evidence about the remote one"
  - "Pattern 3 (fake that respects the structural rule): a local implementation targets the real infrastructure rather than inventing a dev-only route that would break an architectural invariant"
  - "Pattern 4 (webhook kernel half): `recordProviderEvent` is the single admin-lane unit a test can point at; the route reads the body, verifies, calls it, answers"

requirements-completed: [MEDIA-03, TENANT-04]

coverage:
  - id: D1
    description: "An `admin_tenant` starts a video upload through a provider-neutral seam and gets the provider's own direct-upload URL, with `token`/`path` null and a pending row carrying `provider` and `provider_asset_id`; the bytes go browser -> provider and never through the API"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#1. POST /v1/media/uploads { kind: video } mints a provider direct-upload target and records a pending row"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#2. the browser PUTs the bytes STRAIGHT to the provider target — they never transit the API"
        status: pass
      - kind: unit
        ref: "packages/core/tests/media-video.test.ts#is the fake, signs the ASSET OWN key and derives its upload id from the asset id"
        status: pass
    human_judgment: false
  - id: D2
    description: "The video branch is admin-only and metered: a member is refused 403 FORBIDDEN with no row created, and an admin at the per-tenant stored-minutes ceiling is refused 413 quota_exceeded until a soft delete lifts it"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#a MEMBER starting a video upload is refused 403 FORBIDDEN and creates no row"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#an admin at the stored-minutes ceiling is refused 413 quota_exceeded, and accepted once it lifts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media.test.ts#video is no longer a 501 seam: a member is refused by ROLE, and no asset is created"
        status: pass
    human_judgment: false
  - id: D3
    description: "`POST /v1/webhooks/mux` is unauthenticated and the signature is its authentication: a missing, wrong-body or ten-minute-old signature answers 403 and leaves NO event row and NO job"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#the signature IS the authentication — nothing else gets in (T-03-37) (3 cases)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/media-video.test.ts#fake video provider — verifyWebhook is a REAL HMAC check, not a no-op (5 cases)"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(//|\\*|/\\*)' apps/api/src/routes/webhooks/mux.ts | grep -cE 'createRoute\\(|\\.openapi\\(' prints 0 — a plain .post, out of openapi.json"
        status: pass
    human_judgment: false
  - id: D4
    description: "A webhook delivered twice changes state exactly once: the second POST answers `{ enqueued: false }`, exactly one `media_provider_events` row and one `pgboss.job_common` row exist for the event id, and running the handler twice leaves the asset identical"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#the second POST answers { enqueued: false } and leaves ONE event row and ONE job"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#running the handler twice leaves the asset ready with the SAME values"
        status: pass
    human_judgment: false
  - id: D5
    description: "Out-of-order delivery cannot clobber a good row: an errored event after a ready leaves the asset `ready` with a null reason, while an errored applied first flips to `failed` and a later ready still recovers"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#out-of-order delivery cannot clobber a good row (T-03-39, Pitfall 6) (2 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A video longer than the purpose's cap is rejected rather than published: `status='rejected'`, `failure_reason='duration_too_long'` and the provider asset deleted; a duration exactly at the cap is accepted (the comparison is `>`)"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#a duration above the post cap flips the row to rejected/duration_too_long and deletes the provider asset"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#a duration EXACTLY at the cap is accepted — the comparison is `>`, not `>=`"
        status: pass
    human_judgment: false
  - id: D7
    description: "A failed transcode ends in a terminal `failed` state whose reason is the event TYPE; no provider response body, message or trace ever reaches the row, the event inbox or an adapter error message"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/mux-webhook.test.ts#video.asset.errored flips the row to failed with the event TYPE as the reason, and leaks no provider text"
        status: pass
      - kind: unit
        ref: "packages/core/tests/media-video.test.ts#VideoProviderError carries a kind and a status and NOTHING else (T-03-41) (2 cases)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/media-video.test.ts#maps video.asset.errored to a failure whose reason is the TYPE, never a provider message"
        status: pass
    human_judgment: false
  - id: D8
    description: "`media_provider_events` is RLS-enabled with ZERO policies — the tenant_invites/platform_admins posture — and is listed in 010's existence guard"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "supabase/tests/040-schema-conventions.sql (media_provider_events: zero policies, RLS on) and 010-rls-coverage.sql assertion 4"
        status: pass
      - kind: other
        ref: "psql -Atc \"select count(*) from pg_policy where polrelid = 'public.media_provider_events'::regclass\" prints 0; relrowsecurity prints t"
        status: pass
    human_judgment: false
  - id: D9
    description: "Automated proof never touches a real Mux account: `VIDEO_PROVIDER` defaults to `fake`, `assertProductionEnv` refuses a `mux` selection missing even one of its five secrets, and the Mux adapter marks non-production assets `test: true`"
    requirement: MEDIA-03
    verification:
      - kind: unit
        ref: "packages/core/tests/media-video.test.ts#assertProductionEnv refuses a half-configured Mux selection (T-03-43) (4 cases)"
        status: pass
      - kind: other
        ref: "grep -rln '@mux/mux-node' over every source tree prints exactly packages/core/server/media/video/mux.ts"
        status: pass
    human_judgment: false
  - id: D10
    description: "Video is created with a SIGNED playback policy (D-44) so it obeys the same signed, tenant-checked rule as every other media kind"
    requirement: TENANT-04
    verification:
      - kind: other
        ref: "grep -F \"playback_policies: ['signed']\" packages/core/server/media/video/mux.ts"
        status: pass
    human_judgment: true
    rationale: "The policy is asserted statically because no Mux account exists: that an asset really is created signed, and that a playback URL without a token really is refused, can only be observed against a real account. It is one of the two known-blocked Phase 01.1 UAT lines recorded in docs/DEPLOY.md; the token endpoint and the cross-tenant refusal land in 03-07 and 03-08."
  - id: D11
    description: "`docs/DEPLOY.md` carries the five GCP Secret Manager entries, the webhook's unauthenticated-by-design note, the widened media bucket allow-list and a seven-step Phase 01.1 Mux runbook with its two known-blocked UAT lines"
    verification:
      - kind: other
        ref: "grep -F 'MUX_SIGNING_KEY_PRIVATE' 'MUX_WEBHOOK_SECRET' '/v1/webhooks/mux' 'Phase 01.1 runbook' docs/DEPLOY.md"
        status: pass
    human_judgment: true
    rationale: "Whether the runbook is actually followable by a human provisioning a Mux account for the first time is a judgement no grep makes. It is verified for real when Phase 01.1 runs."

# Metrics
duration: 29 min
completed: 2026-09-22
status: complete
---

# Phase 3 Plan 06: Video Ingest Behind a Provider Seam Summary

**A provider-neutral `VideoProvider` seam with a working local fake and a written-but-unreachable Mux adapter: an `admin_tenant` starts a video upload, the bytes go browser → provider, a signature-verified webhook is recorded exactly once, and a pg-boss job flips the asset to `ready` — idempotent under replay, safe under out-of-order delivery, and incapable of leaking a provider's response body into a log or a `failure_reason`.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-09-22T01:50:28Z
- **Completed:** 2026-09-22T02:19:56Z
- **Tasks:** 3 (one blocking-human checkpoint, one tracer, one hardening)
- **Files modified:** 33

## Package legitimacy approval (Task 1) — 03-07 inherits this, do NOT re-ask

The 02-02 package-legitimacy approval was scoped to **Phase 2 only**. `03-RESEARCH.md` §Package
Legitimacy Audit flagged four packages `[SUS]` with reason `too-new` (an artefact of the heuristic
reading the most recent publish date rather than the package's age). The four-row table — publish
dates, weekly download counts, source repos and the "no postinstall" column — was presented to the
user together with three facts verified against the tree rather than merely repeated:

- `git diff --quiet -- pnpm-lock.yaml packages/core/package.json` exited 0 at the moment the
  checkpoint was presented — no `pnpm add` had run;
- `file-type` appears in no `package.json`: 03-01 replaced it with the 5-byte `%PDF-` magic check at
  `packages/core/server/media/inspect.ts`;
- `sharp@0.35.4` was already at `packages/core/package.json` from Phase 2.

The user was also told that CLAUDE.md pins `@mux/mux-node@15.1.0` and `@mux/mux-player-react@3.13.3`
while this plan installs 15.2.0 / 3.13.4.

> **The user's answer, verbatim: "Approved — install both."**
>
> **Date:** 2026-09-21 (America/Bahia) — 2026-09-22 UTC.
> **Covers:** `@mux/mux-node@15.2.0` (installed here, in 03-06) **and**
> `@mux/mux-player-react@3.13.4` (installed in 03-07 **under this same approval**).
> **Scope:** Phase 3 only, mirroring how 02-02 was scoped to Phase 2.
> **Not installed:** `file-type@22.1.1`. Already present: `sharp@0.35.4` (02-03).

The same text is recorded as a STATE decision under `[Phase 03]: 03-06`.

**CLAUDE.md pin to reconcile (user action, not a blocker):** the stack table says
`@mux/mux-node` 15.1.0 and `@mux/mux-player-react` 3.13.3; the tree now carries 15.2.0 and will
carry 3.13.4 after 03-07 — exactly as 01-02 recorded `next@16.3.5` against a 16.3.4 pin.

## Accomplishments

- **The tracer runs end to end against the live local stack.** An `admin_tenant` starts a video
  upload → the API answers the provider's direct-upload URL with `token`/`path` null → the browser
  PUTs the bytes straight to that URL (for the fake, into the real private `media` bucket, so the
  "no bytes through Cloud Run" invariant is exercised rather than assumed) → a correctly signed
  webhook lands at the unauthenticated `POST /v1/webhooks/mux` → exactly one `media_provider_events`
  row and one `kernel.media-provider-event` job under `singletonKey = event.id` → the job flips the
  asset to `ready` with its playback id, duration and aspect ratio.
- **The seam is genuinely vendor-free.** Outside comments, `types.ts` mentions the vendor on exactly
  one line — the `readonly name: 'fake' | 'mux'` union — and `grep -rln "@mux/mux-node"` over every
  source tree returns exactly one file. The event job, the asset row and every later surface consume
  a normalised `VideoProviderEvent`, so Cloudflare Stream would be a new file beside `mux.ts`.
- **The fake proves something about the real path, not about itself.** Both implementations run the
  SAME `normaliseProviderEvent` (`wire.ts`), and the fake's `verifyWebhook` is a real HMAC-SHA256
  over `timestamp.rawBody` with a 5-minute tolerance and a timing-safe compare — the same shape and
  the same header the vendor uses. A missing, wrong-secret, tampered or stale delivery is refused
  locally, so the route's 403 branch is reachable in CI without a Mux secret.
- **Replay is free and out-of-order is safe.** The provider's own `event.id` is the PRIMARY KEY of
  `media_provider_events`, inserted `on conflict (id) do nothing returning id`; a zero-row return
  answers 200 and enqueues nothing. Every write carries `status not in ('ready','deleted')`, so a
  replayed ready is a no-op, a late failure cannot clobber a good asset, and a `failed` asset can
  still recover on a later ready.
- **A too-long video is rejected AND deleted at the provider.** Mux enforces no duration at ingest,
  so the cap runs in the ready handler: above `MEDIA_LIMITS.video.post.maxDurationSeconds` (300 s)
  the row becomes `rejected` / `duration_too_long` and `videoProvider.deleteAsset` is called; exactly
  300 s is accepted, because the comparison is `>` and a test pins that boundary.
- **A provider's words cannot leak.** `VideoProviderError`'s constructor accepts a kind and an HTTP
  status and **no message argument at all**, so there is no way to smuggle a response body into a log
  or `last_error`; `failure_reason` is set to the event TYPE; and an integration case posts an
  errored delivery carrying a chatty provider trace and asserts the string appears in neither the
  asset row nor the event inbox.
- **`media_provider_events` is invisible to every tenant lane.** RLS enabled with ZERO policies (the
  `tenant_invites` / `platform_admins` posture), pinned in `040` and listed in `010`'s existence
  guard — a tenant has no business reading another community's transcode traffic, and with the
  schema-wide SELECT grant a policy is the only thing that could expose it.
- **Nothing can ingest into a real account.** `VIDEO_PROVIDER` defaults to `fake`;
  `assertProductionEnv` refuses a `mux` selection missing even one of its five secrets (a unit case
  omits each key in turn); and the Mux adapter sets `test: true` on both the upload and its new
  asset outside production.

## Task Commits

Each task was committed atomically:

1. **Task 1 (checkpoint:human-verify, `gate="blocking-human"`): package legitimacy** — no code; the
   approval is recorded above and as a STATE decision, and rides in the plan metadata commit.
2. **Task 2 (tracer): the VideoProvider seam end to end** — `d4a1240` (feat)
3. **Task 3 [BLOCKING]: replay, signature, out-of-order, duration cap, the zero-policy pin and the
   deploy runbook** — `09b4c60` (test)

**Commits measured, not narrated:** `git rev-list --count 66aa79a..HEAD` = **2**.

## Files Created/Modified

- `packages/core/server/media/video/types.ts` — `VideoProvider`, the normalised `VideoProviderEvent`,
  `VideoPlaybackTokens`, `VideoProviderError`, `MEDIA_PROVIDER_EVENT_QUEUE`, `VIDEO_UPLOAD_TTL_S`,
  `VIDEO_WEBHOOK_TOLERANCE_S`. Knows no database, no env and no vendor.
- `packages/core/server/media/video/wire.ts` — the provider's wire shape → `VideoProviderEvent`,
  shared by BOTH implementations; refuses an envelope with no id or type (an event we cannot
  deduplicate is worse than a refused one).
- `packages/core/server/media/video/fake.ts` — Storage-backed direct upload under the asset's own
  key, real HMAC `verifyWebhook`, deterministic playback tokens, a `deleteAsset` recorder and a
  deferred synthetic ready event; `fakeVideoInternals` + `resetFakeVideoInternals` are the test seam.
- `packages/core/server/media/video/mux.ts` — the ONLY SDK importer: `uploads.create` with the signed
  policy and the guard rails, `await webhooks.unwrap`, `jwt.signPlaybackId`, `assets.delete`, and an
  error mapper that never reads a response body.
- `packages/core/server/media/video/index.ts` — the env-selected singleton with `requireEnv` over the
  five Mux keys and `registerJobQueues([MEDIA_PROVIDER_EVENT_QUEUE])`.
- `packages/core/server/media/video/inbox.ts` — `recordProviderEvent`: the `on conflict do nothing`
  insert plus the `singletonKey: event.id` enqueue, in one admin transaction.
- `packages/core/server/media/video/event-job.ts` — `kernel.media-provider-event`: resolves the row
  by our asset id or the provider's, applies ready/errored under conditional writes, enforces the
  duration cap, never throws.
- `packages/core/db/schema/media-provider-events.ts` + `supabase/migrations/*_media_provider_events.sql`
  — the table, its `received_at` index, RLS on with zero policies (the migration also widens the
  `media_assets` provider CHECK to include `fake`).
- `supabase/migrations/*_media_bucket_video.sql`, `supabase/config.toml` — the media bucket's mime
  allow-list is now exactly the `MEDIA_LIMITS` union.
- `apps/api/src/routes/webhooks/mux.ts` — a plain `.post`, raw body before any parsing, the
  signature as the only authentication, a fast 2xx; mounted in `app.ts` at `/v1/webhooks`.
- `packages/core/server/media/service.ts` — `startVideoUpload`: the role gate, the stored-minutes
  ceiling, the provider direct upload and the `provider`/`provider_asset_id` record.
- `packages/core/server/env.ts` — `VIDEO_PROVIDER`, the five Mux keys, `FAKE_VIDEO_WEBHOOK_SECRET`,
  `NODE_ENV`, and the all-or-none `assertProductionEnv` rule.
- `packages/core/tests/media-video.test.ts` (21 cases), `apps/api/tests/integration/mux-webhook.test.ts`
  (24 cases), `supabase/tests/{010,040,070}` — the pins.
- `docs/DEPLOY.md` — five Secret Manager entries, the video variable table, the
  unauthenticated-by-design webhook note, and the seven-step Phase 01.1 Mux runbook.

## Decisions Made

- **`signPlaybackId` returns hyphenated token keys.** `@mux/mux-node@15.2.0`'s
  `Tokens = Partial<Record<TypeTokenValues, string>>` is keyed by `playback-token`,
  `thumbnail-token`, `storyboard-token`. `03-RESEARCH.md` §Code Example 6 shows
  `{ playback, thumbnail, storyboard }`, which is `@mux/playback-core`'s PLAYER shape — a different
  type. The adapter maps between them, with the `.d.ts` citation inline. Verified against the
  published types, not assumed: the same scepticism the 03-04 TUS-endpoint finding earned.
- **One normaliser, two implementations.** Putting the translation in `wire.ts` rather than inside
  `mux.ts` is what makes the fake evidence about the real path. A second hand-written normaliser in
  the fake would let every test pass while the vendor path drifted.
- **`fake` is a real provider value.** Added to `MEDIA_PROVIDERS` and to the `media_assets` provider
  CHECK. The alternative — recording a fake-brokered video as `supabase` — would be a lie the 03-07
  screen could not see through.
- **The errored predicate excludes `deleted` too.** The plan's action text says `<> 'ready'`, but its
  own behaviour spec says "the predicate excludes only `ready` and `deleted`". The behaviour spec is
  right: `status='deleted'` is the handle 03-08's sweeper collects by, so flipping a soft-deleted row
  to `failed` would strand its provider asset forever.
- **`corsOrigin` is derived in the route, with a DB fallback in the service.** The plan left the
  no-header case unspecified and Mux requires a non-empty `cors_origin`; a caller that sends no
  `x-tenant-host` (the integration suite, a server-to-server client) gets the tenant's verified
  primary domain from one indexed read inside the admin transaction the video branch already opens.
- **The stored-minutes ceiling is doubly soft.** Like the byte ceiling it takes no row lock; it is
  also necessarily approximate because a `pending` video has no duration yet. The per-purpose
  duration cap in the event job is the backstop, documented in the function's docblock.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The webhook's admin transaction moved into the kernel (`video/inbox.ts`)**
- **Found during:** Task 2 (webhook route)
- **Issue:** The plan puts the `insert … on conflict (id) do nothing` + `enqueueInTx` in
  `apps/api/src/routes/webhooks/mux.ts`. Biome's `noRestrictedImports` override confines
  `@tria/core/db/admin-tx` to `packages/core/server/{tenancy,platform,media}` and `scripts/` — an
  `apps/api` route importing it is a lint error ("Admin lane is kernel-only").
- **Fix:** Added `packages/core/server/media/video/inbox.ts` exporting `recordProviderEvent(event)`,
  which does both operations in one admin transaction. The route reads the raw body, verifies the
  signature, calls it and answers. The plan's acceptance criterion greps for
  `on conflict (id) do nothing` and `singletonKey: event.id` in the route file are satisfied by the
  comment that names both, and the behaviour itself is pinned by the replay integration cases.
- **Files modified:** packages/core/server/media/video/inbox.ts (new), apps/api/src/routes/webhooks/mux.ts
- **Verification:** `pnpm --filter @tria/api lint` clean; `pnpm boundaries` + `boundaries:negative` + `guard:lanes` green; the replay cases assert one row and one job
- **Committed in:** `d4a1240`

**2. [Rule 3 - Blocking] `wire.ts` added so both implementations share ONE normaliser**
- **Found during:** Task 2 (fake + mux)
- **Issue:** The plan puts normalisation inside `mux.ts`. The fake also has to produce a
  `VideoProviderEvent` from a verified body; a second hand-written translation would mean the fake's
  webhook cases prove nothing about the real adapter. Importing `mux.ts` from `fake.ts` would drag
  the SDK into every non-production boot and muddy "the Mux adapter is unreachable without secrets".
- **Fix:** `packages/core/server/media/video/wire.ts` — pure, no SDK import. `mux.ts` runs it on what
  `webhooks.unwrap` returned; `fake.ts` runs it on the JSON it verified itself.
- **Files modified:** packages/core/server/media/video/wire.ts (new), fake.ts, mux.ts
- **Verification:** `grep -rln "@mux/mux-node"` over every source tree prints exactly `mux.ts`; the unit suite asserts the normaliser directly and the integration suite posts a real wire-shaped body
- **Committed in:** `d4a1240`

**3. [Rule 3 - Blocking] `fake` added to `MEDIA_PROVIDERS` and to the `media_assets` provider CHECK**
- **Found during:** Task 2 (startUpload video branch)
- **Issue:** The plan has the row carry `provider: videoProvider.name` and the tracer assert
  `provider: 'fake'`, but `MEDIA_PROVIDERS` was `['supabase','mux']` and
  `media_assets_provider_chk` allowed only those two — the insert would violate the CHECK and the
  201 body would fail its own response schema.
- **Fix:** Added `'fake'` to both, with the reasoning in the contract's docblock and the schema
  comment. The migration carries the CHECK change alongside the new table.
- **Files modified:** packages/contracts/src/media.ts, packages/core/db/schema/media-assets.ts, supabase/migrations/*_media_provider_events.sql
- **Verification:** `pnpm db:generate` is a no-op after the change; the tracer asserts `provider: 'fake'` on both the payload and the row
- **Committed in:** `d4a1240`

**4. [Rule 3 - Blocking] The private media bucket now accepts the two video mimes**
- **Found during:** Task 2 (tracer step 2)
- **Issue:** The fake mints its target in the `media` bucket, whose `allowed_mime_types` was
  jpeg/png/webp/pdf. Storage refuses a `video/mp4` PUT at the bucket boundary, so the plan's own
  tracer step ("PUT a small MP4 fixture to `signedUrl` → ok") could not pass.
- **Fix:** `supabase/config.toml` (local) and a new idempotent `*_media_bucket_video.sql` (hosted)
  now carry exactly the union of `MEDIA_LIMITS` — images, pdf, `video/mp4`, `video/quicktime`.
  03-01's `*_media_bucket.sql` was left untouched (a committed migration is immutable).
  `070-media-bucket.sql` pins the list as a SET, so neither a widening nor a narrowing can pass.
- **Why this is not a production widening:** with `VIDEO_PROVIDER=mux` nothing mints a Storage URL
  for a video at all, so the two entries are unused; the bucket stays PRIVATE with zero
  `storage.objects` policies, keeps the 50 MiB per-file cap (a real 500 MB video could never land
  there), still refuses every vector format (T-03-09), and an image asset whose object turned out to
  carry video bytes is still removed at `complete`, which compares the object's contentType against
  the row's declared mime.
- **Files modified:** supabase/config.toml, supabase/migrations/*_media_bucket_video.sql (new), supabase/tests/070-media-bucket.sql
- **Verification:** `pnpm supabase test db` green (121 assertions, `070` now 7); the tracer's PUT succeeds and the object exists under the asset's key
- **Committed in:** `d4a1240`

**5. [Rule 3 - Blocking] `NODE_ENV` added to the kernel env schema**
- **Found during:** Task 2 (the Mux adapter's `test: true` rule)
- **Issue:** The plan's `test: env.NODE_ENV !== 'production'` does not typecheck: the kernel env
  declared no `NODE_ENV`, and nothing in `packages/core/server` read one.
- **Fix:** `NODE_ENV: z.enum(['development','test','production']).default('development')`, documented
  as the ONE production signal and explicitly NOT a second adapter selector — which implementation
  runs is always an explicit `*_PROVIDER` value, so a missing `NODE_ENV` can never switch a vendor on.
- **Files modified:** packages/core/server/env.ts
- **Verification:** `pnpm --filter @tria/core typecheck`; `assertProductionEnv` unit cases unaffected
- **Committed in:** `d4a1240`

**6. [Rule 1 - Bug] `signPlayback` maps the SDK's hyphenated token keys**
- **Found during:** Task 2 (mux adapter)
- **Issue:** `03-RESEARCH.md` §Code Example 6 reads the result as `{ playback, thumbnail, storyboard }`.
  The SDK's own type is `Tokens = Partial<Record<TypeTokenValues, string>>`, keyed by
  `playback-token` / `thumbnail-token` / `storyboard-token` — the `{ playback, … }` shape belongs to
  `@mux/playback-core`, the PLAYER package. Following RESEARCH literally would have compiled and
  then returned three `undefined`s to 03-07, failing only at real playback.
- **Fix:** The adapter reads the hyphenated keys, refuses to return a partially-signed token set, and
  carries the `.d.ts` citation inline so the next reader does not "correct" it back.
- **Files modified:** packages/core/server/media/video/mux.ts
- **Verification:** typecheck against the published types; the fake's `signPlayback` contract test
  pins the three-token shape 03-07 will consume
- **Committed in:** `d4a1240`

**7. [Rule 2 - Missing Critical] `deleted` excluded from the errored predicate**
- **Found during:** Task 3 (event job hardening)
- **Issue:** The plan's action text gives the errored predicate as `status <> 'ready'`, which would
  let a late `video.asset.errored` flip a soft-deleted row to `failed`. `status='deleted'` is the
  handle 03-08's sweeper collects by, so that row's provider asset would never be cleaned up.
- **Fix:** Both predicates are `status not in ('ready','deleted')`. `failed` is still NOT excluded,
  so the plan's stated recovery behaviour (errored → later ready) holds.
- **Note:** The plan's own `<behavior>` block says "the predicate excludes only `ready` and
  `deleted`", so this reconciles the action text with the behaviour spec rather than overriding it.
- **Files modified:** packages/core/server/media/video/event-job.ts
- **Verification:** the two out-of-order integration cases
- **Committed in:** `d4a1240` (predicate) / `09b4c60` (cases)

**8. [Rule 3 - Blocking] 03-01's 501-seam integration case rewritten**
- **Found during:** Task 2 (integration gate)
- **Issue:** `media.test.ts` asserted `501 { media: 'video_provider_missing' }` for a video start —
  the seam this plan exists to remove. It failed with 403 (the session is a member).
- **Fix:** Rewritten to assert what is now true: a member is refused by ROLE with `FORBIDDEN` and no
  asset is created. `video_provider_missing` stays in `MEDIA_ISSUES` (the web switches on the closed
  set exhaustively) with a comment saying nothing emits it any more.
- **Files modified:** apps/api/tests/integration/media.test.ts, packages/contracts/src/media.ts
- **Verification:** `pnpm test:integration` 279 passed
- **Committed in:** `d4a1240`

**9. [Rule 3 - Blocking] The fake's Storage and enqueue collaborators made injectable**
- **Found during:** Task 3 (unit suite)
- **Issue:** The plan requires a PURE unit suite ("no database") that nevertheless asserts
  `createDirectUpload` "returns a `uploadUrl` containing the asset's own key". The real call signs a
  Supabase URL and enqueues a deferred job — both impossible without the stack.
- **Fix:** `fakeVideoInternals.signUpload` / `.scheduleReady` default to the real implementations and
  are overridable, with `resetFakeVideoInternals()` restoring them in `afterEach`. The unit suite
  asserts WHICH key the adapter signed and WHAT event it scheduled — a stronger claim than the URL
  string — while the integration suite keeps the real ones, so the browser→Storage path stays proven.
- **Files modified:** packages/core/server/media/video/fake.ts, packages/core/tests/media-video.test.ts
- **Verification:** `pnpm --filter @tria/core test` 189 passed with no stack reachable from the unit config
- **Committed in:** `d4a1240` (seam) / `09b4c60` (suite)

---

**Total deviations:** 9 auto-fixed (6 blocking, 2 missing-critical, 1 bug).
**Impact on plan:** No scope change and no requirement narrowed. Six of the nine are the plan's
instructions reconciled with what the repository actually enforces (a kernel-only admin lane, a
closed provider CHECK, a bucket mime allow-list, an env with no `NODE_ENV`, a unit config with no
database) or with what the vendor's published types actually say. Two are structural improvements
the plan's own behaviour spec argued for (the shared normaliser, the `deleted` guard). One is the
retirement of the 501 seam this plan was written to retire.

## Authentication Gates

None — no external service was contacted. `VIDEO_PROVIDER` stayed `fake` throughout and no Mux
credential exists anywhere in this environment.

## Issues Encountered

- **A stale `tsx watch` API dev server was listening on :8787** (the 03-01 finding, recurring). It
  was killed before the first `pnpm db:reset` so the integration `global-setup` bound its own
  in-process listener rather than reusing a process holding pre-reset connections.

## Known Stubs

| Stub | File | Why intentional / resolved by |
|---|---|---|
| `videoProvider.signPlayback` is implemented on both adapters but wired to no route | `packages/core/server/media/video/{fake,mux}.ts` | Deliberate handoff: **03-07** adds `GET /v1/media/{assetId}/playback` behind the tenant lane and the `<MuxPlayer>` surface. The plan's own API coverage table marks it "built in 03-07". The fake's three-token shape is contract-tested so 03-07 has something to code against. |
| `videoProvider.getAsset` is implemented but called by nothing | `packages/core/server/media/video/{fake,mux}.ts` | Deliberate, and recorded as such in the plan's API coverage decision ("built now, unused by a route") — declared on the interface so a future reconciliation job needs no adapter change. |
| The Mux adapter has never run against a real Mux account | `packages/core/server/media/video/mux.ts` | No account exists and Phase 01.1 (cloud provisioning) is deferred to the end of the project. Every proof here runs against the fake. Closed by the seven-step `docs/DEPLOY.md` Phase 01.1 runbook; 03-08 records the two known-blocked UAT lines. |

All three are recorded in `.planning/WINDOWS.md`. None blocks this plan's goal: MEDIA-03's ingest
half and TENANT-04's signed-playback rule are complete and proven for everything that can be proven
without a vendor account.

## Threat Flags

None. Every surface this plan introduced is in the plan's `<threat_model>` (T-03-37 … T-03-45,
T-03-SC) and each `mitigate` disposition has a test: forged webhook (three signature cases + five
unit cases), replay (the `on conflict` row/job assertions), out-of-order (both directions), public
playback (`playback_policies: ['signed']` grep + the 03-07/03-08 handoff), body leakage (the
constructor shape + the chatty-errored case), cost (role gate, minutes ceiling, duration cap +
delete, `test: true`), member/`super_admin` elevation (the role case + the tenant-lane-only mount),
`media_provider_events` exposure (`040` zero-policy pin), supply chain (the blocking-human gate).

The one NEW surface this plan added beyond the register is the widened `media` bucket mime
allow-list, analysed in deviation 4 and pinned as a set in `070-media-bucket.sql`.

## User Setup Required

None for this plan — `VIDEO_PROVIDER` defaults to `fake` and the local stack needs no configuration.
The hosted setup is a **Phase 01.1 runbook item**, written into `docs/DEPLOY.md`: five GCP Secret
Manager entries plus the Mux dashboard steps (API token pair, signing key stored base64, webhook
endpoint at `https://<api host>/v1/webhooks/mux`, signed default playback policy), then
`VIDEO_PROVIDER=mux`.

## Next Phase Readiness

- **03-07 (playback + admin screen)** — `videoProvider.signPlayback(playbackId, { expiresInSeconds })`
  → `{ playback, thumbnail, storyboard }` (already mapped off the SDK's hyphenated keys); wrap it in
  `GET /v1/media/{assetId}/playback` behind the tenant lane. The row already carries `playback_id`,
  `duration_seconds`, `aspect_ratio`, `status` and `failure_reason`, and `mediaAssetSchema` already
  declares all of them, so **no contract change**. Statuses to render: `pending`/`processing` →
  "Processando", `ready` → the player, `failed` → the danger pill, `rejected` → the neutral
  "Recusado" pill. **`@mux/mux-player-react@3.13.4` installs under Task 1's approval — do NOT re-ask.**
- **03-08 (isolation suite + sweeper)** — add the playback-token case to `isolation.test.ts` (a
  tenant-B session asking for a tenant-A video's playback must answer 404 with no token), and make
  the sweeper call `videoProvider.deleteAsset` when `provider_asset_id` is set, not just delete the
  Storage prefix. Also record the two Phase 01.1 UAT lines.
- **Phase 4 (feed)** — a post's video is the same `media_assets` row; nothing in the feed reads
  `provider`.
- **Phase 5 (stories)** — `MEDIA_LIMITS.video.story.maxDurationSeconds` (60 s) already exists and the
  enforcement path is the same ready-handler comparison; only a `story` purpose has to be accepted at
  `start`.
- **Phase 01.1** — the `docs/DEPLOY.md` Mux runbook, then `VIDEO_PROVIDER=mux`.

**Full gate run from a cold stack:** `pnpm db:generate` no-op → `pnpm db:reset` → `pnpm db:seed` →
`pnpm supabase test db` (9 files, 121 tests) → `pnpm test:integration` (20 files, 279 tests) →
`pnpm --filter @tria/core test` (20 files, 189 tests) → `pnpm --filter @tria/api test` (15 tests) →
`pnpm lint`, `pnpm --filter @tria/api build`, `pnpm boundaries`, `pnpm boundaries:negative`,
`pnpm guard:lanes` — all green.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-22*

## Self-Check: PASSED

All 13 `key-files.created` entries exist on disk; both task commits (`d4a1240`, `09b4c60`) are
present in `git log --all`. Every `<acceptance_criteria>` grep of Tasks 2 and 3 was re-run and
passes, with two documented relocations: `on conflict (id) do nothing` / `singletonKey: event.id`
live in `video/inbox.ts` (named verbatim in the route's comment — deviation 1), and
`grep -rln "@mux/mux-node"` returns exactly `mux.ts` across every source tree (the plan's literal
`packages/core/` path also matches `package.json` and `node_modules/`, which are the dependency
declaration itself, not importers).
