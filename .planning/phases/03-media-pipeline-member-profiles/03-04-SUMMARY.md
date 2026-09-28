---
phase: 03-media-pipeline-member-profiles
plan: 04
subsystem: ui
tags: [web, profile, upload, tus, canvas, next, playwright, pt-BR, accessibility]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "@rede-social/ui primitives, the pt-BR catalog loader + literal gate, the signed-upload posture of LogoUpload (WR-07), the server-action conventions of marca/actions.ts, the Playwright projects"
  - phase: 03-media-pipeline-member-profiles
    provides: "03-01's media broker (start/complete/serve, MEDIA_LIMITS, classifyMediaFile, PURPOSE_WIDTHS) and 03-02's member_profiles + GET/PATCH /v1/me/profile"
provides:
  - "`/perfil` — the real profile screen: photo, name, e-mail, bio and three rows, with no role badge (UI-D-01)"
  - "`/perfil/editar` — name (60) and bio (150 under a live counter) saved through PATCH /v1/me/profile"
  - "`Textarea` in @rede-social/ui — Input geometry plus a {n}/{max} counter that turns danger at the cap"
  - "`MediaImage` — the ONE way a private image renders: /v1/media/{assetId}/{variant} with the payload's srcSet ladder and a neutral fallback"
  - "`useSignedUpload({ kind, purpose })` — the six-state upload machine Phase 4's composer and 03-07's video zone reuse unchanged"
  - "`AvatarUploadField` — pick, silent re-encode, monotonic progress, cancel, remove behind a confirmation"
  - "`uploadResumable`/`uploadBytes`/`normaliseImage` in apps/web/lib/upload.ts (TUS at the signed endpoint, the 6 MiB threshold router, the canvas re-encode)"
  - "`app/v1/media/[assetId]/[variant]` — the BFF redirect that makes the stable media path reachable from an <img>"
  - "the `profile` and `media` pt-BR catalogs, authored once for 03-05 and 03-07"
  - "`/configuracoes` 'Editar perfil' is a real link; `Row` gained an optional href"
affects: [03-05, 03-06, 03-07, 03-08, phase-04-feed, phase-05-stories]

actuals:
  tokens: 37259
  tasks: 3
  commits: 3
plan_head_before: 1b0022c4752869fe603b7d0c459dcb85d703973b

# Tech tracking
tech-stack:
  added: [tus-js-client@4.3.1]
  patterns:
    - "Signed resumable upload: the `/storage/v1/upload/resumable/sign` endpoint with the upload token in `x-signature` — the browser never holds a Supabase session JWT"
    - "Browser-side normalisation as a rescue, not a refusal: an over-cap or phone-format photo is re-encoded through <img> → canvas → toBlob before the server is ever asked"
    - "EXIF orientation without an EXIF parser: drawing an <img> ELEMENT (never an ImageBitmap) inherits the browser's default image-orientation: from-image"
    - "Same-origin BFF redirect for private media: an <img> cannot carry an HttpOnly session, so /v1/media/* is a Next route handler that forwards the API's 302 — bytes still come straight from Storage"
    - "Image failure is read from the ELEMENT on mount (`complete && naturalWidth === 0`), not only from onError, because a server-rendered image can fail before hydration"
    - "A shipped primitive gains an opt-out (`FileDropZone screen={false}`) rather than a fork, when a caller owns the verdict"
    - "The photo commits independently of the form's submit: complete → setAvatarAction, so a member who only changes their photo never presses Salvar"

key-files:
  created:
    - packages/ui/src/primitives/Textarea.tsx
    - apps/web/components/media/MediaImage.tsx
    - apps/web/components/media/useSignedUpload.ts
    - apps/web/components/media/AvatarUploadField.tsx
    - apps/web/components/media/AvatarUploadField.test.ts
    - apps/web/components/profile/ProfileHeader.tsx
    - apps/web/lib/profile.ts
    - apps/web/app/(app)/perfil/actions.ts
    - apps/web/app/(app)/perfil/loading.tsx
    - apps/web/app/(app)/perfil/editar/page.tsx
    - apps/web/app/(app)/perfil/editar/EditProfileForm.tsx
    - apps/web/app/(app)/perfil/editar/loading.tsx
    - apps/web/app/v1/media/[assetId]/[variant]/route.ts
    - apps/web/messages/pt-BR/profile.json
    - apps/web/messages/pt-BR/media.json
    - apps/web/e2e/profile.spec.ts
    - apps/web/e2e/media-upload.spec.ts
    - apps/web/e2e/media-fixtures.ts
    - apps/web/e2e/fixtures/{iphone.heic,large.jpg,huge.jpg,README.md}
  modified:
    - apps/web/app/(app)/perfil/page.tsx
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/lib/upload.ts
    - apps/web/lib/upload.test.ts
    - apps/web/e2e/admin.ts
    - packages/ui/src/index.ts
    - packages/ui/src/primitives/Avatar.tsx
    - packages/ui/src/primitives/FileDropZone.tsx
    - packages/ui/tests/button.test.tsx
    - apps/web/package.json
    - pnpm-lock.yaml

key-decisions:
  - "The signed TUS endpoint is `/storage/v1/upload/resumable/sign`, not the bare `/upload/resumable` RESEARCH §Code Example 2 shows — only the /sign variant reads `x-signature`; the bare one wants a session JWT and answers 400 Invalid Compact JWS"
  - "`/v1/media/{assetId}/{variant}` needed a Next BFF route: an <img> cannot carry the HttpOnly session, so without it NO photo could render anywhere — including the shell avatar 03-02 already pointed at that path"
  - "Image failure is detected on mount as well as through onError: an image that 404s before hydration never delivers its error event to React"
  - "`FileDropZone` gained `screen` (default true, 02-14 unchanged) so the photo zone can hand a dropped phone-format or over-cap file to the re-encode instead of refusing it"
  - "`Avatar` now falls back to its neutral icon on a failed fetch — E9 has to hold for the shell avatar too, not only for MediaImage"
  - "`useSignedUpload` imports the two media server actions directly (the plan's key_link) and takes only `{ kind, purpose }` from its caller; 03-07 reuses it with `kind: 'video'`"
  - "The upload's `error` is a first-class state; the field renders it as the idle zone plus one `role=\"alert\"` message shared by both breakpoints"
  - "The cancel control is a ghost `Button size=\"md\"` (44px, in the tab order, with a visible label) rather than an icon-only IconButton"
  - "`LogoUpload` keeps its own copy of the hook deliberately — converging the branding zone here would have put an unrelated Phase 2 screen in this plan's blast radius"
  - "'Salvar alterações' adopted over the UI-SPEC's bare 'Salvar' (non-blocking recommendation 1), matching Phase 2's Marca tab"

patterns-established:
  - "Pattern 1 (stable media path): MediaImage builds src/srcSet from the payload's ladder via mediaVariantUrl — never a hand-written width list, never an inline signed URL"
  - "Pattern 2 (rescue before refusal): classifyMediaFile's 'heic'/'size' verdicts enter `preparing` and re-encode; only 'type' is refused at pick time"
  - "Pattern 3 (hydration-proof e2e): the specs drive the real affordance (tap → file chooser) and gate on React state, so a click on server-rendered HTML can never pass silently"

requirements-completed: [PROF-01, MEDIA-01, MEDIA-02]

coverage:
  - id: D1
    description: "`/perfil` is the real profile screen — photo, 24/700 name, e-mail, bio and the three rows — with the Phase 2 role pill gone (UI-D-01)"
    requirement: PROF-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/profile.spec.ts#the profile screen shows the member, three rows and no role badge (UI-D-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A member renames themselves and writes a bio under a live {n}/150 counter, saves with 'Salvar alterações' (disabled until dirty) and lands back on /perfil with the new values, which persist"
    requirement: PROF-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/profile.spec.ts#a member renames themselves and writes a bio, and it persists"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/button.test.tsx#Textarea (counter linkage, danger at the cap, announced error)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The photo goes browser → signed Supabase Storage target directly: plain PUT at or below 6 MiB, TUS with a fixed 6 MiB chunk above it, and no byte reaches the API or the Next server"
    requirement: MEDIA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-upload.spec.ts#a 7 MiB photo travels over TUS in 6 MiB chunks, and no byte passes through our servers"
        status: pass
      - kind: unit
        ref: "apps/web/lib/upload.test.ts#uploadBytes — the 6 MiB threshold router (MEDIA-01, RESEARCH Pitfall 3)"
        status: pass
      - kind: other
        ref: "grep -vE '^\\s*(//|\\*|/\\*)' 'apps/web/app/(app)/perfil/actions.ts' | grep -cE 'FormData|Blob|arrayBuffer|new File\\(' prints 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "A photo the picker never offered (an iPhone capture) is re-encoded in the browser instead of being refused, and no format word ever reaches the member"
    requirement: MEDIA-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-upload.spec.ts#a photo from the phone is re-encoded silently — no format word ever reaches the member"
        status: pass
      - kind: unit
        ref: "apps/web/lib/upload.test.ts#normaliseImage — the invisible HEIC/oversize re-encode (R-12)"
        status: pass
    human_judgment: true
    rationale: "Chromium has no HEIC decoder, so the browser case asserts the correct branch for the browser under test (prepare-failed copy) plus format silence in BOTH branches. The SILENT-SUCCESS half is observable only on a device whose decoder reads HEIC (iOS Safari) — RESEARCH A1's real-device check, which 03-08's UAT owns."
  - id: D5
    description: "An over-cap photo is rescued by the re-encode; a disallowed type is refused at pick time with the pt-BR copy and makes no request; a confirmation-time refusal renders the limit interpolated"
    requirement: MEDIA-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-upload.spec.ts#a photo above the cap is rescued by the re-encode instead of being refused"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-upload.spec.ts#a disallowed type is refused at pick time, before any upload is started"
        status: pass
      - kind: unit
        ref: "apps/web/components/media/AvatarUploadField.test.ts#a confirmation refused with { media: 'too_large' } renders the limit INTERPOLATED"
        status: pass
    human_judgment: false
  - id: D6
    description: "The photo commits on its own (no form submit), renders from /v1/media in the worker's derived widths, and 'Remover foto' puts the neutral icon back behind a confirmation"
    requirement: PROF-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/profile.spec.ts#a photo renders from /v1/media in the derived widths, and \"Remover foto\" puts the icon back"
        status: pass
    human_judgment: false
  - id: D7
    description: "An in-flight upload can always be cancelled: the transfer aborts, the zone returns to idle with no message and no toast, and the next pick is accepted immediately"
    requirement: MEDIA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-upload.spec.ts#\"Cancelar envio\" aborts the transfer and leaves the member free to pick again"
        status: pass
      - kind: unit
        ref: "apps/web/components/media/AvatarUploadField.test.ts#cancelling aborts the transfer and returns to idle with NO message and no toast"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every state the UI contract enumerates for E1/E2/E9 is real: empty profile and empty form, loading skeletons, the generic error state, the longest allowed values wrapping instead of truncating, the announced field error, and a photo that cannot be fetched degrading to the neutral icon with no broken glyph"
    requirement: PROF-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/profile.spec.ts#PROF-01 — the states of the profile screens (5 cases)"
        status: pass
      - kind: other
        ref: "ls 'apps/web/app/(app)/perfil/loading.tsx' 'apps/web/app/(app)/perfil/editar/loading.tsx' — both present, both Skeleton-shaped"
        status: pass
    human_judgment: true
    rationale: "The loading skeletons are asserted to EXIST and to be shaped from Skeleton, but a route-level loading.tsx only appears during a real navigation delay; whether it reads as the screen's shape is a visual judgment for the phase UAT."
  - id: D9
    description: "Every string on these screens comes from the pt-BR catalog, and the repo's web gates stay green (literal scan, build, static-route allow-list, module boundaries)"
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh && pnpm --filter @rede-social/web build && bash scripts/check-static-routes.sh && pnpm boundaries"
        status: pass
    human_judgment: false

# Metrics
duration: 1h 2m
completed: 2026-09-21
status: complete
---

# Phase 03 Plan 04: Member Profile Screens & the Browser Upload Path Summary

**A member renames themselves, writes a bio under a live counter, and puts a photo on their profile straight from their phone — the bytes going browser → signed Supabase Storage (plain PUT under 6 MiB, TUS in fixed 6 MiB chunks above it), an unsupported phone format re-encoded in the browser before the server is ever asked, and the result served back through the stable `/v1/media/{assetId}/{variant}` path in the worker's display sizes.**

## Performance

- **Duration:** 1h 2m
- **Started:** 2026-09-21T23:36:00Z
- **Completed:** 2026-09-22T00:38:00Z
- **Tasks:** 3
- **Files modified:** 33 (29 authored + 3 binary fixtures + the lockfile)

## Accomplishments

- **`/perfil` is a real screen.** The Phase 2 stub's own docblock said "Phase 3 replaces it": it now renders `ProfileHeader` (80px photo, 24/700 name, e-mail, centred bio) over three rows, with the role `StatusPill` removed — no brand fill appears on this screen at all (UI-D-01).
- **The photo path works end to end on a phone.** Pick → (silent re-encode when needed) → signed Storage target → plain PUT or TUS → `complete` → `setAvatarAction`, with a local preview the instant a file is picked and a monotonic progress bar that can be cancelled. A 7 MiB photo really travels over TUS, and the spec proves the API received nothing from the browser at all.
- **`useSignedUpload` and `MediaImage` are the two components later phases inherit unchanged.** The hook is `{ kind, purpose }`-generic with the full six-state machine and an exhaustive `MEDIA_ISSUES` → catalog map; `MediaImage` is the only way a private image renders anywhere.
- **The stable media path became reachable.** `/v1/media/...` had no web-side route at all: an `<img>` cannot carry the HttpOnly session, so nothing could have rendered a photo — including the shell avatar 03-02 already pointed at that path. A Next route handler now forwards the API's 302, so the bytes still come straight from Storage.
- **Two pt-BR catalogs authored once** (`profile.json`, `media.json`) covering this plan, 03-05's nudge and 03-07's video copy, with `{limit}`/`{percent}`/`{duration}` interpolated rather than hard-coded.

## Task Commits

1. **Task 1 (tracer): Textarea, ProfileHeader, MediaImage, the real /perfil, /perfil/editar + saveProfileAction, both catalogs, the first Playwright path** — `e3bc8e5` (feat)
2. **Task 2: the photo path — tus-js-client, uploadResumable/uploadBytes/normaliseImage, useSignedUpload, AvatarUploadField, the media actions, the BFF media route, fixtures + media-upload.spec.ts** — `68de77d` (feat)
3. **Task 3: every enumerated state, the /configuracoes link, the accessibility contract and the web gates** — `93df1c4` (feat)

## Files Created/Modified

- `packages/ui/src/primitives/Textarea.tsx` — the multiline field: Input geometry, `resize-none`, `{n}/{max}` counter (`tabular-nums`, `aria-live="off"`, danger at the cap), `maxLength` passthrough
- `packages/ui/src/primitives/Avatar.tsx` — neutral-icon fallback when a photo cannot be fetched, detected on mount as well as through `onError`
- `packages/ui/src/primitives/FileDropZone.tsx` — optional `screen` so a caller that re-encodes can receive the file the zone would have refused
- `apps/web/lib/upload.ts` — `SUPABASE_TUS_ENDPOINT` (the `/sign` variant), `uploadResumable`, `uploadBytes`, `normaliseImage`; every 02-14 export intact
- `apps/web/components/media/useSignedUpload.ts` — the state machine with the WR-07 boundary, the one-in-flight `busy` ref and cancel
- `apps/web/components/media/AvatarUploadField.tsx` — the photo block: preview, progress, cancel, remove-with-confirmation, quartile live region
- `apps/web/components/media/MediaImage.tsx` — `<img>` over the stable path with the payload's `srcSet`, an aspect-ratio box and the neutral fallback
- `apps/web/components/profile/ProfileHeader.tsx` — the ported header minus handle/website/follow/message (D-45)
- `apps/web/app/(app)/perfil/{page,loading}.tsx`, `apps/web/app/(app)/perfil/editar/{page,EditProfileForm,loading}.tsx` — the two screens
- `apps/web/app/(app)/perfil/actions.ts` — `saveProfileAction`, `startMediaUploadAction`, `completeMediaUploadAction`, `setAvatarAction`, `removeAvatarAction`, all returning catalog keys
- `apps/web/app/v1/media/[assetId]/[variant]/route.ts` — the BFF redirect
- `apps/web/lib/profile.ts` — `getOwnProfile` (React-cached) and `loadOwnProfile` (redirect known refusals, `null` otherwise)
- `apps/web/messages/pt-BR/{profile,media}.json` — the two catalogs
- `apps/web/app/(app)/configuracoes/page.tsx` — `Row` gained `href`; "Editar perfil" is a link with a chevron
- `apps/web/e2e/{profile,media-upload}.spec.ts`, `media-fixtures.ts`, `admin.ts`, `fixtures/*` — 26 browser cases across both projects

## Decisions Made

See `key-decisions` in the frontmatter. The three that will matter to a later reader:

1. **The signed TUS endpoint is `/storage/v1/upload/resumable/sign`.** `03-RESEARCH.md` §Code Example 2 shows the bare `/upload/resumable`, which is the SESSION-JWT path: it answered `400 Invalid Compact JWS` for every upload above 6 MiB. Verified against this project's own storage service (`dist/http/routes/tus/lifecycle.js`: `SIGNED_URL_SUFFIX = '/sign'`, and only a URL starting with `/upload/resumable/sign` reads `x-signature`).
2. **An image failure must be read from the element, not only from `onError`.** A server-rendered `<img>` that 404s before hydration never delivers its error event to React, so the broken glyph survived on a warm load. Both `MediaImage` and `Avatar` now also check `complete && naturalWidth === 0` on mount.
3. **`FileDropZone` must not pre-screen a file the caller intends to rescue.** On desktop the zone refused an iPhone-format or over-cap photo before `normaliseImage` could run, which contradicts R-12 outright. The new `screen` prop defaults to `true`, so the 02-14 branding zone is byte-identical in behaviour.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `/v1/media/{assetId}/{variant}` had no web-side route**
- **Found during:** Task 2 (the first photo that actually rendered)
- **Issue:** The contract says every private image renders over the stable `/v1/media/...` path, but `apps/web` had no such route and no rewrite. An `<img>` cannot carry the HttpOnly session cookie as a Bearer, so nothing could ever have fetched one — and 03-02's bootstrap already hands the shell that path for any member with a photo.
- **Fix:** `apps/web/app/v1/media/[assetId]/[variant]/route.ts` — validates the id and the variant against the ladder, forwards through `apiFetch`, and hands the API's 302 straight to the browser (bytes still come from Storage). Refusals pass through so `onError` degrades to the neutral state.
- **Verification:** `profile.spec.ts` polls `/v1/media/{id}/w320` to a 200 and then asserts the rendered `naturalWidth > 0`.
- **Committed in:** `68de77d`

**2. [Rule 1 - Bug] The TUS endpoint in the research example is the session-JWT path**
- **Found during:** Task 2 (every >6 MiB upload failed)
- **Issue:** `endpoint: ${SUPABASE_URL}/storage/v1/upload/resumable` + `x-signature` → `400 Invalid Compact JWS`. That path authenticates with a Supabase session JWT, which this browser never holds by design.
- **Fix:** `/storage/v1/upload/resumable/sign`, verified against the storage service's own source rather than guessed.
- **Verification:** `media-upload.spec.ts` observes the 201 create and the 204 chunk PATCHes on the `/sign` path.
- **Committed in:** `68de77d`

**3. [Rule 1 - Bug] The drop zone refused the files the re-encode exists to rescue**
- **Found during:** Task 2 (the desktop project failed the HEIC and over-cap cases)
- **Issue:** `FileDropZone` screens every file against `accept`/`maxBytes` before `onFile`, so on `md:` a phone-format or over-cap photo was refused with "Formato não suportado" — the exact outcome R-12 forbids.
- **Fix:** `screen?: boolean` (default `true`, so 02-14 is unchanged); the photo zone passes `screen={false}` and lets `classifyMediaFile` + `normaliseImage` decide. `accept` still narrows the OS picker.
- **Verification:** the HEIC and `huge.jpg` cases now pass on `desktop-chromium` as well as `mobile-chromium`.
- **Committed in:** `68de77d`

**4. [Rule 1 - Bug] A pre-hydration image failure showed a broken glyph**
- **Found during:** Task 3 (the E9 case passed alone and failed in a full run)
- **Issue:** React attaches `onError` at hydration; an image that already failed during HTML parsing never reports it, so the failed `<img>` stayed on screen.
- **Fix:** a mount-time `complete && naturalWidth === 0` check in `MediaImage` and in `Avatar`.
- **Verification:** `profile.spec.ts#E9 error` passes in a full-file run on both projects.
- **Committed in:** `93df1c4`

**5. [Rule 2 - Missing critical] `Avatar` had no failure fallback at all**
- **Found during:** Task 2
- **Issue:** UI-SPEC E9 says a broken-image glyph is never shown, but the shipped `Avatar` rendered a bare `<img>` — so the shell avatar showed the glyph whenever a variant was missing or expired.
- **Fix:** the neutral `User` icon fallback, keyed by `src` so pointing it at another photo retries.
- **Verification:** `pnpm --filter @rede-social/ui test` (37) plus the E9 e2e.
- **Committed in:** `68de77d` / `93df1c4`

**6. [Rule 2 - Missing critical] A failed transfer was invisible in the console**
- **Found during:** Task 2 (debugging the TUS failure)
- **Issue:** `uploadResumable` mapped every failure to `{ reason: 'transfer' }` and dropped the reason, so an operator had nothing to look at.
- **Fix:** `console.error('media.resumable_failed', { error })` — console only, never rendered (T-02-147).
- **Committed in:** `68de77d`

### Plan assumptions corrected

**7. [Rule 1] `large.jpg` had to be 6.98 MiB, not "about 9 MiB"**
- A 9 MiB photo is ABOVE the 8 MiB avatar cap, so `normaliseImage` re-encodes it to about a megabyte and it would never take the TUS branch the case exists to prove. The fixture sits between the 6 MiB threshold and the cap, so it survives normalisation untouched and must go resumable.

**8. [Rule 1] `huge.jpg` cannot surface the over-cap copy in a browser**
- The plan's premise ("a 12 MiB JPEG already at 2048 px cannot be re-encoded smaller") is false: a 2048 px JPEG at quality 0.85 lands around a megabyte, which is exactly the rescue R-12 asks for. The browser case therefore asserts the RESCUE (the true member-visible behaviour), and the confirmation-time `too_large` copy with its interpolated limit is pinned by `AvatarUploadField.test.ts`, where a server refusal can be injected deterministically.

**9. [Rule 1] The HEIC silent success is not observable on Chromium**
- Chromium ships no HEIC decoder, so the browser re-encode cannot succeed there and the contract's correct answer is the prepare-failed copy. The spec probes the browser's decode capability and asserts the matching branch; the format-silence assertion ("no HEIC, no 'Formato não suportado'") runs in BOTH branches. The silent-success half stays RESEARCH A1's real-device check, which 03-08's UAT owns.

**10. [Rule 3 - Blocking] Playwright raced React hydration**
- `setInputFiles` on a not-yet-hydrated field is silently lost. `e2e/media-fixtures.ts` gates on React state (the submit button flipping to enabled) and then drives the real affordance — the phone taps "Alterar foto" and answers the OS picker, the desktop hands the file to the zone.

---

**Total deviations:** 10 auto-fixed (4 bugs, 2 missing-critical, 1 blocking route, 1 blocking test harness, 2 plan assumptions corrected)
**Impact on plan:** No scope creep. Items 1–4 were prerequisites for the plan's own truths — without them no photo renders, no large upload completes, the desktop zone contradicts R-12 and E9's "never a broken glyph" is false. Items 7–9 replace assertions whose premises were physically unreachable with assertions that are true and deterministic.

## Issues Encountered

- **The seed had not been re-run since 03-02 added avatars,** so no member had a photo at all. `pnpm db:seed` (idempotent) was run to satisfy the task's precondition before any code was written.
- **`getByRole('alert')` always resolves in Next 16:** the App Router renders a permanent empty `role="alert"` route announcer, so every alert assertion in these specs is scoped (`[data-photo-field]`, `main`).

## Known Stubs

| Item | File | Why |
|---|---|---|
| The "Membros" row points at `/membros`, which does not exist yet | `apps/web/app/(app)/perfil/page.tsx` | The row is part of this screen's approved contract (UI-SPEC §Own profile, R-11) and 03-05 lands the route in the next wave. A known ONE-WAVE dead link, recorded in `.planning/WINDOWS.md`. |
| `media.json` carries video and duration copy nothing renders yet | `apps/web/messages/pt-BR/media.json` | Authored once on purpose (the plan's Task 1.7) so 03-07 adds only video-specific keys; the catalog is data, not dead UI. |

## Threat Flags

None. The surface this plan adds is covered by the plan's own register: the upload token never leaves the transfer closure (T-03-25), the client checks are UX with the server re-validating at `complete` (T-03-28), every failure renders a catalog string with the raw value console-only (T-03-29), and no `dangerouslySetInnerHTML` exists anywhere in the new files. The one NEW route — `app/v1/media/[assetId]/[variant]` — adds no authorization of its own: it validates the id and the variant against the closed ladder and forwards to the API, which runs the tenant check on every fetch.

## User Setup Required

None — no external service configuration.

## Next Phase Readiness

- **03-05 (directory + nudge):** `MediaImage`, `ProfileHeader` (`email` omitted for another member) and the `profile.nudge.*` copy are ready; add only the `members` root key. Landing `/membros` closes this plan's one-wave dead link.
- **03-07 (admin media):** reuse `useSignedUpload({ kind: 'video', purpose: 'post' })` — it already routes through `startMediaUploadAction`/`completeMediaUploadAction`, and `media.json` already carries the drop-zone, progress and refusal copy. Do NOT fork the hook. `FileDropZone`'s `screen` default stays `true` for the video zone (nothing re-encodes a video in the browser).
- **Phase 4 (composer):** `useSignedUpload({ kind: 'image', purpose: 'post' })` and `MediaImage` with the post ladder need no change.
- **Watch:** `apps/web/e2e/fixtures/` carries about 19 MiB of deliberately incompressible JPEGs; its README has the exact regenerator, so they never need to be re-invented.

## Self-Check: PASSED

- All 21 files listed in `key-files.created` exist on disk (`[ -f ]`).
- All three task commits exist in `git log` (`e3bc8e5`, `68de77d`, `93df1c4`).
- Every task's `<acceptance_criteria>` re-run mechanically and green (greps, `node -e` catalog root-key checks, `git ls-files` on the fixtures).
- Plan-level `<verification>` re-run at HEAD: `@rede-social/ui` typecheck + test (37), `@rede-social/web` typecheck + lint + test (80), `check-ui-literals`, `next build`, `check-static-routes`, `pnpm boundaries`, and `playwright test profile.spec.ts media-upload.spec.ts` (26 passed across `mobile-chromium` and `desktop-chromium`). `@rede-social/core` typecheck + test (168) re-run as a cross-package guard for the two `@rede-social/ui` primitive changes.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-21*
