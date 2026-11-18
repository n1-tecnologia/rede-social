---
phase: quick-261118-glh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/components/media/useSignedUpload.ts
  - apps/web/components/media/useSignedUpload.test.tsx
  - packages/contracts/src/media.ts
  - packages/contracts/tests/media.test.ts
  - apps/web/components/media/VideoUploadField.tsx
  - packages/core/server/media/video/types.ts
  - packages/core/server/media/limits.ts
  - packages/core/tests/media-video-mux.test.ts
  - apps/api/tests/integration/media-sweeper.test.ts
autonomous: true
requirements: []
tags: [temporary, media, video, feed, upload-window, pick-time-gate, quick]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "BUG. A video (or any non-image file) picked over its purpose cap is refused at pick time with the existing too-large sentence, which names the cap, makes NO request and never calls normaliseImage. Today `pick` in apps/web/components/media/useSignedUpload.ts sends every kind whose classify verdict is 'size' into the photo re-encode, the decode of a video fails and the screen says the photo-prepare sentence (the console line media.upload_prepare_failed with kind video, purpose post, error image decode failed). After the fix only the `image` kind may enter the re-encode for a 'size' verdict."
    - "The image path and the HEIC path are unchanged: an image over its cap is still re-encoded once and goes on to start; a HEIC photo is still re-encoded once. The member-cap branch (capOverride) is untouched."
    - "The refusal reuses `messageFor('too_large')`, i.e. the catalog sentence `media.errors.size` (apps/web/messages/pt-BR/media.json, 'Arquivo muito grande. O limite é {limit}.') with the limit from `formatMediaLimit`. No catalog key is added, so no exact-key-set test moves. For the 8 GiB post cap the person reads 'O limite é 8192 MB.' (formatMediaLimit prints megabytes above 10); a GB wording is NOT part of this plan."
    - "TEMPORARY limit, applies to every tenant. The post entry of MEDIA_LIMITS.video in packages/contracts/src/media.ts becomes 8 GiB (8 * 1024 * 1024 * 1024) and stays 9000 s. The TEMPORARY comment above it names the current values (8 GiB, 9000 s), the first raise (4 GiB, quick 261117-d1o) and the ORIGINAL values (500 MiB and 300 s), keeps the revert instruction and says the 8 GiB is unverified against Mux. The story and lesson entries do not move."
    - "The explicit TEMPORARY pin in packages/contracts/tests/media.test.ts moves to 8 GiB and 9000 s (seen red against the old constant first). Every other pin of the post cap already DERIVES from MEDIA_LIMITS, SOCIAL_MAX_VIDEO_* or SOCIAL_LIMIT_RANGES (quick 261117-d1o): packages/modules/social/tests/contracts.test.ts, apps/web/lib/social-limits.test.ts, apps/web/components/platform/SocialLimitsSheet.test.tsx, apps/api/tests/integration/media.test.ts, mux-webhook.test.ts, social-media.test.ts and apps/web/e2e/social-platform.spec.ts. Planning-time grep found no 4 GiB, 4294967296 or 4096 literal in them for the post cap (the lesson's 4 GiB in media.test.ts stays), so they are expected to need NO edit; the executor re-greps and edits only a real hit."
    - "VIDEO_UPLOAD_TTL_S (packages/core/server/media/video/types.ts) becomes 10800 (3 h). Its ONLY consumer is the Mux direct-upload `timeout` in packages/core/server/media/video/mux.ts (createDirectUpload); the fake provider ignores it (its target is a Supabase signed upload URL with Supabase's own fixed life) and no test pinned it before. Mux documents the timeout range as 60 to 604800 seconds."
    - "A 3 h upload is not swept, rejected or marked failed mid-way: the sweeper's abandoned-upload window is the TypeScript constant MEDIA_PENDING_TTL_MS (24 h, packages/core/server/media/limits.ts) built into the Drizzle predicate in sweep-job.ts; the reconcile pass only asks the provider and a 'waiting' answer applies nothing; no SQL function holds a one-hour interval for pending video assets (planning-time grep of supabase/migrations: the only pending-asset interval is the chat voice orphan sweep, 24 hours, on audio). A unit pin proves 3 h is below the 24 h window and inside Mux's range; an integration case (S4) proves a pending video as old as the window survives a sweep. If the executor finds a SQL function with a one-hour literal for pending video assets it STOPS and reports it as a blocker (no SQL or migration is planned)."
    - "No migration: media_assets.bytes is bigint (mode number), the start body size schema is int().positive() (a 8 GiB number is a safe integer) and there is no CHECK on bytes."
    - "Scope is the nine files of files_modified plus, only on a real grep hit, a derived-pin file named above. No new dependency, no SQL, no new catalog key, no new withAdminTx( site (so no admin-lane-inventory row), no class change (filled-cta pins untouched). apps/web/AGENTS.md was read: no Next.js API is touched, the change is hook logic."
    - "No push, no deploy, no pnpm db:reset, no pnpm db:seed, no hosted project, no Playwright, no .env* read. Path-scoped commits only (`git commit -m ... -- <paths>`, one `git add <file>` first for a brand-new untracked file), NO Co-Authored-By trailer and no tool attribution of any kind (public repository, identity igor.vboas noreply), never `git add -A` or `git commit -a`, never stage .planning/sketches/ or the unrelated untracked files (root ACESSOS-LOCAIS.md, locais.md, docs/LOCAL-SETUP.md, the FRONT PDF, zz_* scripts, .claude/*, .planning/debug), never edit STATE.md, ROADMAP.md or REQUIREMENTS.md."
  artifacts:
    - path: "apps/web/components/media/useSignedUpload.ts"
      provides: "pick() refuses a 'size' verdict of a non-image kind with messageFor('too_large') before busy is set, before any request and before normaliseImage"
    - path: "apps/web/components/media/useSignedUpload.test.tsx"
      provides: "red-first cases: video, lesson video and attachment over the cap refuse and never call normaliseImage; video at the cap goes to start; image over the cap still re-encodes; HEIC still re-encodes"
    - path: "packages/contracts/src/media.ts"
      provides: "MEDIA_LIMITS.video.post at 8 GiB and 9000 s with a rewritten TEMPORARY comment"
      contains: "8 * 1024 * 1024 * 1024"
    - path: "packages/contracts/tests/media.test.ts"
      provides: "the explicit TEMPORARY post pin at 8 GiB / 9000 s, the pick-time boundary at the post cap and the start-body size pin"
    - path: "packages/core/server/media/video/types.ts"
      provides: "VIDEO_UPLOAD_TTL_S at 3 h with a docblock naming the old one-hour value, the Mux range and the 24 h sweeper window"
    - path: "packages/core/tests/media-video-mux.test.ts"
      provides: "the Mux upload timeout pinned to 10800, inside 60..604800 and below MEDIA_PENDING_TTL_MS"
    - path: "apps/api/tests/integration/media-sweeper.test.ts"
      provides: "S4: a pending video as old as the upload window, still waiting at the provider, is asked about and left pending"
    - path: ".planning/quick/261118-glh-oversize-video-message-and-raise-the-tem/261118-glh-SUMMARY.md"
      provides: "what ran with real counts, what was NOT run, the commit SHAs, the unverified-against-Mux statement and the revert recipe"
  key_links:
    - from: "packages/contracts/src/media.ts classifyMediaFile"
      to: "apps/web/components/media/useSignedUpload.ts pick()"
      via: "the 'size' verdict now routes by kind: image keeps the re-encode, every other kind refuses with messageFor('too_large') at the table cap"
    - from: "packages/contracts/src/media.ts MEDIA_LIMITS.video.post"
      to: "packages/core/server/media/limits.ts limitFor() and service.ts startVideoUpload (413 too_large with the cap), video/event-job.ts duration cap, packages/modules/social/contracts/index.ts adminLimit() (D-474)"
      via: "one table entry read by the API start, the ready-event job and the derived member-video range"
    - from: "packages/core/server/media/video/types.ts VIDEO_UPLOAD_TTL_S"
      to: "packages/core/server/media/video/mux.ts createDirectUpload `timeout`"
      via: "the only consumer; mux.ts needs no edit"
    - from: "packages/core/server/media/limits.ts MEDIA_PENDING_TTL_MS"
      to: "packages/core/server/media/sweep-job.ts collectable()"
      via: "pending rows older than 24 h are collected; 24 h stays far above the 3 h upload window"
---

<objective>
Fix the misleading error on an oversize post video and raise the TEMPORARY post-video limits, as Igor decided on 2026-11-18 after uploading a 7.2 GB / about 1 h video in the feed composer and reading "Não foi possível preparar esta imagem. Tente outra foto." (console: media.upload_prepare_failed, kind video, purpose post, error image decode failed).

Purpose: (A) the pick-time gate must tell a person that a video or a file is too big, naming the limit, instead of feeding it to a photo re-encode; (B) the one video Igor needs to post (7.2 GB, about 1 h) must fit the post cap (8 GiB, 9000 s) and its upload must not die on the provider's one-hour direct-upload timeout (3 h window), with every consumer of that window kept consistent.

Output: one fix in the upload hook with its tests, one constant raise with its pin, one constant raise for the upload window with its pins, three path-scoped trailer-free commits, and a SUMMARY.

Decomposition note (tracer first): Task 1 is the leading slice and the user-visible bug: red tests, then the pick-time fix, proven by the hook tests. Tasks 2 and 3 then expand from the proven table: Task 2 the 8 GiB cap with its pins, Task 3 the 3 h window with every consumer, then the full gate sequence. The three tasks share no file.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@apps/web/AGENTS.md
@.planning/quick/261117-d1o-liberar-video-de-2h-como-post-do-feed-te/261117-d1o-PLAN.md
@.planning/quick/261117-d1o-liberar-video-de-2h-como-post-do-feed-te/261117-d1o-SUMMARY.md
@apps/web/components/media/useSignedUpload.ts
@packages/contracts/src/media.ts

Facts verified while planning (2026-11-18), so the executor does not re-derive them. Re-grep only where a task says so.

The bug:
- `pick` calls `classifyMediaFile(file, kind, purpose)` (packages/contracts/src/media.ts). It returns 'heic' for any heic/heif mime before looking at the table, then 'type' (pair missing or mime not allowed), then 'size' (file.size over the pair's maxBytes), else null.
- In useSignedUpload.ts the branch `if (verdict === 'heic' || verdict === 'size')` runs `normaliseImage` for every kind. `normaliseImage` (apps/web/lib/upload.ts) decodes through an <img> element, so a video or a PDF rejects with 'image decode failed' and the catch shows `t('errors.prepare')`.
- The existing member-cap branch (capOverride) already refuses a non-heic file over the member cap with `messageFor('too_large')`. The table-cap case for a non-image has no such refusal.
- `messageFor('too_large')` builds `t('errors.size', { limit })` (or the caller's `tooLargeMessage`) with `formatMediaLimit(answeredMaxBytes ?? maxBytes)`; `maxBytes` is `capOverride ?? MEDIA_LIMITS[kind][purpose].maxBytes`. `formatMediaLimit(8 GiB)` is "8192 MB" and the catalog sentence is 'Arquivo muito grande. O limite é {limit}.'.
- Single caller of `classifyMediaFile`: useSignedUpload.ts. Other callers of `normaliseImage`: apps/web/lib/app-icon-image.ts (an image-only icon source), and the tests. The branding pickers (LogoUpload, BrandImagePicker, branding-upload) use `classifyFile`, which is image-only and never re-encodes a non-image. The hook is used with kind video by VideoUploadField (composer, stories, lessons) and with kind file by MaterialsList and the composer's attachment zone, so the fix also repairs an oversize PDF attachment (same wrong sentence today). Consequence to REPORT: an attachment whose mime is an image and that is over 50 MiB used to be rescued by the photo re-encode and is now refused with the 50 MB sentence (the rule is "only the image kind re-encodes").
- apps/web/components/media/useSignedUpload.test.tsx already mocks next-intl (the translator returns the key, plus `:<limit>` when the call has a `limit`), @rede-social/ui, the two server actions and `@/lib/upload` (`normalise` and `send` are hoisted mocks). It builds files with `new File([new Uint8Array(bytes)], ...)`. An 8 GiB buffer cannot be allocated, so the new cases fake the size: `classifyMediaFile` and `pick` read only `type` and `size`, so override `size` on a tiny File with `Object.defineProperty` (fall back to a plain `{ name, type, size }` object cast to File if happy-dom refuses it).

The limits:
- `MEDIA_LIMITS.video.post` (packages/contracts/src/media.ts, about line 174) is `{ mimes: VIDEO_MIMES, maxBytes: 4 * 1024 * 1024 * 1024, maxDurationSeconds: 9000 }` under a TEMPORARY comment naming quick 261117-d1o, the old 500 MiB and 300 s and the revert recipe. The story entry (500 MiB, 60 s) and the lesson entry (4 GiB, 4 h) must not change. Commits ecd30e18 and e4042a91 are the d1o work; its SUMMARY has the revert recipe.
- `packages/contracts/tests/media.test.ts` (about lines 51-57) holds the explicit TEMPORARY pin (post 4 * 1024 ** 3 and 9000, story 500 MiB and 60, lesson 14 400); `mediaStartBodySchema` and `classifyMediaFile` are already imported there.
- Derived pins (grep over apps and packages for the literal forms 4 * 1024, 4294967296, 4 GiB, 4096, 1024 ** 3 on 2026-11-18): none for the post cap in the seven derived files. The lesson's 4 GiB legitimately appears in packages/contracts/tests/media.test.ts (about line 46) and apps/api/tests/integration/media.test.ts (the P24/P46 lesson case, about line 610). The platform form range follows SOCIAL_LIMIT_RANGES (videoMb max = floor(cap / MiB) = 8192, videoSeconds max = 9000), all read from the shared constants. The saved-blob values 300 and 500 MiB in social-limits.test.ts and SocialLimitsSheet.test.tsx are arbitrary valid blobs and stay.
- The only stale hard-coded post numbers left in product code is a DOC comment in apps/web/components/media/VideoUploadField.tsx (line ~20, "500 MiB / 5 min pair"), left by d1o. This plan rewrites it without numbers.
- Accepted side effect (D-474): SOCIAL_MAX_VIDEO_BYTES and SOCIAL_MAX_VIDEO_SECONDS derive from the post entry through adminLimit(), so the range a super_admin may set for MEMBER video in the platform form widens to 1..8192 MB and 1..9000 s; defaults (60 s, 100 MiB) and every saved tenant value are unchanged.
- Mux documents a 12 h maximum duration per asset and NO file-size cap that could be confirmed: the 8 GiB is UNVERIFIED against Mux (a refusal would show as a failed upload) and a real 7 GB upload is Igor's check. The tenant video-minutes budget (MEDIA_TENANT_VIDEO_SECONDS_CEILING, 3 h, shared by every non-lesson video) is untouched; a 1 h video fits inside it.

The upload window:
- `VIDEO_UPLOAD_TTL_S` is declared in packages/core/server/media/video/types.ts (line ~21, one hour today), re-exported by video/index.ts, imported and passed as `timeout` to `mux.video.uploads.create` in video/mux.ts createDirectUpload (line ~97). `grep -rn VIDEO_UPLOAD_TTL_S apps packages docs` finds only those four places; no test, no doc and no SQL pins it.
- The fake provider (video/fake.ts) mints a Supabase signed upload URL through `signUpload` and never reads the constant; that URL has Supabase's own fixed life and the fake is non-production only. Report it, do not change it.
- The sweeper (packages/core/server/media/sweep-job.ts) collects `pending` rows older than MEDIA_PENDING_TTL_MS (24 h, limits.ts) through a Drizzle predicate with `make_interval(secs => ...)`; its reconcile pass (video/reconcile.ts) asks the provider about pending/processing videos older than five minutes and applies nothing for a `waiting` answer (a Mux `timed_out` or `cancelled` upload also maps to waiting). The registered sweep functions (payments, chat, notifications modules) never touch pending video assets: the chat voice orphan sweep (supabase/migrations/20261117230510_chat_voice_orphans_sweep.sql) is 24 hours on audio. docs/DEPLOY.md lines ~3112 and ~3121 (a one-hour margin on platform.video_asset_routes in an orphan-route runbook) concern route creation, not the upload window; lines ~4551 and ~5634 name the 24 h sweeper. None of them pins the upload window.
- Existing media-sweeper.test.ts cases S2 and S3 use a one-hour-old pending video for the reconcile age; they do not pin the TTL and stay as they are.

Tooling facts:
- Vitest 5 does not walk up for configs: run `pnpm --filter <name> exec vitest run <path relative to that package>`. Names: `@rede-social/web`, `@rede-social/contracts`, `@rede-social/core`, `@rede-social/module-social`, `@rede-social/api`.
- CI env for the gates (the VAPID value is the public local-test key from .github/workflows/ci.yml, not a secret): `API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-build-placeholder NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k TURBO_CACHE=local:r`.
- Known reds that are NOT ours (do not chase, do not mask): pgTAP 120, 141, 154, 232; isolation b3, b8 and the phase-10 sweep; move-copy's stale rede-demo avatar row; the web EventsSections flake under load (passes alone).
- Disk: at planning time `df -g /` showed about 7 GiB free, below the 10 GiB integration gate, and Docker answered. Re-check at execution. The web build and .next fill the disk (memory: turbo cache, apps/web/.next/cache and apps/web/.next/dev reach several GB): before the build run `pgrep -f "next dev"` and, only if nothing runs, remove `.turbo/cache`, `apps/web/.next/cache` and `apps/web/.next/dev`; remove them again after the build.
- Lessons baked in: apps/web/lib/filled-cta.test.ts pins class fragments by substring and the i18n tests pin exact catalog key sets (this plan changes neither); a new `withAdminTx(` site would need a row in apps/api/tests/admin-lane-inventory (this plan adds none); a web type error only shows in the build (the turbo build gate covers it).
- The git tree is shared with other work: many untracked files and possibly staged ones from another agent. Check `git status --short` before each commit so nothing foreign rides along.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: A video or file over its cap is refused at pick time with the too-large sentence, never sent to the photo re-encode (red first)</name>
  <files>apps/web/components/media/useSignedUpload.test.tsx, apps/web/components/media/useSignedUpload.ts</files>
  <behavior>
    - A video picked over the post cap (default hook, no member cap): the error is the shared size sentence at the table cap (`errors.size` with the limit from formatMediaLimit), the state is 'error', `startMediaUploadAction` is not called, `normaliseImage` is not called, nothing is logged to the console.
    - The same for a lesson video over its 4 GiB cap and for a PDF attachment over 50 MiB (kind file).
    - A video EXACTLY at the cap passes the gate: start is called once, normaliseImage never.
    - An image over its cap (kind image, purpose post, 15 MiB cap, a 16 MiB photo) is still re-encoded once with `{ maxBytes: <the cap> }` and then goes on to start.
    - A HEIC photo on the default hook is still re-encoded once and goes on to start.
  </behavior>
  <action>
This is the tracer and a TDD task: the smallest real fix, proven by the hook's own tests before it is written.

1. apps/web/components/media/useSignedUpload.test.tsx. Add a new `describe` block after the existing member-cap block, titled so it names the pick-time gate by kind (quick 261118-glh). Reuse the file's hoisted mocks (`start`, `normalise`, `send`), its `MIB`, `photo` and `video` helpers and its beforeEach, which already makes `start` answer a generic failure. Import `MEDIA_LIMITS` from '@rede-social/contracts/media' and read `formatMediaLimit` from the dynamically imported './useSignedUpload' module the file already awaits. Add a small helper that returns a file whose `size` is overridden to a given byte count (`Object.defineProperty` on a one-byte File; plain-object fallback described in the context), because an 8 GiB buffer cannot be allocated and the hook and `classifyMediaFile` read only `type` and `size`. Write the six cases in the behavior list. Compute every expected sentence from the table and `formatMediaLimit` (for example the post cap read from `MEDIA_LIMITS.video.post`, the lesson cap from `MEDIA_LIMITS.video.lesson`, the attachment cap from `MEDIA_LIMITS.file.attachment`) so the cases survive the later revert of the TEMPORARY cap; the mocked translator returns the key followed by a colon and the limit, so the expected error is `errors.size:` plus the formatted limit. Spy on `console.error` (mockImplementation, restored after) in the video case and assert it was not called, which is how the 'media.upload_prepare_failed' line is proven absent.

2. SEE RED. Run the new file BEFORE touching the hook: `pnpm --filter @rede-social/web exec vitest run components/media/useSignedUpload.test.tsx`. The three over-cap cases (post video, lesson video, attachment) must fail (they reach normaliseImage, which is a bare mock returning undefined, so the hook ends in its generic error); the video-at-cap, image-over-cap and HEIC cases are regression guards and must already pass. Record the failing and passing counts for the SUMMARY. If an over-cap case passes before the fix, the case is wrong: fix the test, not the hook.

3. apps/web/components/media/useSignedUpload.ts. In `pick`, right after the member-cap check and before `busy.current = true`, add a refusal for a 'size' verdict whose kind is not `image`: it returns `fail(messageFor('too_large'))`. `fail` already settles the machine to idle and then sets the error state, so no request is made and `busy` is never taken. Do not touch the 'heic' signal, the image re-encode branch, the member-cap branch, `reject`, `messageFor` or the catalog (no new key; the existing `errors.size` sentence at `formatMediaLimit(maxBytes)` is the copy). Reword the comment above the re-encode branch: the 'size' verdict reaches it for the image kind only because scaling to 2048 px is what rescues a photo, and a video or a file has no such rescue and is refused above (per the decision of 2026-11-18). Keep the WR-07 rule: `pick` stays try plus catch only, no `finally`. Per the decision (only the image kind re-encodes), a HEIC verdict is deliberately left exactly as it is for every kind.

4. Grep apps/web for the same pattern and report what was found (planning found none to fix): `grep -rn "normaliseImage(" apps/web --include='*.ts' --include='*.tsx'` and `grep -rn "classifyMediaFile" apps/web packages --include='*.ts' --include='*.tsx'`, excluding tests. Expected: the single caller is this hook; app-icon-image.ts is an image-only icon source; the branding pickers use `classifyFile`. If any other caller routes a non-image through a re-encode, fix it the same way with a test, add its files to this commit and say so in the SUMMARY.

5. SEE GREEN: run the same test file, then the sibling media component tests that exercise the hook: `pnpm --filter @rede-social/web exec vitest run components/media`. Then `pnpm exec biome format --write apps/web/components/media/useSignedUpload.ts apps/web/components/media/useSignedUpload.test.tsx`, re-read `git diff` for only the intended hunks, check `git status --short`, and commit those two paths only: `git commit -m "fix(web): refuse an oversize video or file at pick time instead of sending it to the photo re-encode" -- apps/web/components/media/useSignedUpload.ts apps/web/components/media/useSignedUpload.test.tsx` with a short body (the verdict now routes by kind; the sentence and the limit are the existing too-large copy; image and HEIC paths unchanged). No trailer of any kind. Do not push.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/media</automated>
  </verify>
  <done>
The hook refuses a non-image 'size' verdict at pick time with the existing too-large sentence at the table cap, no request, no normaliseImage, no console error; image and HEIC unchanged.

Evidence required in the SUMMARY (real numbers from the Vitest output):
(a) the red run: how many of the new cases failed before the hook edit and that the three guards passed;
(b) the green run counts for the new file and for `components/media`;
(c) `git show --stat HEAD` lists exactly the two paths and `git status --short` shows nothing of this task uncommitted;
(d) the grep for other callers and its result, stated plainly (including the attachment consequence: a >50 MiB image attachment is now refused instead of re-encoded);
(e) the exact sentence a person now reads for the 8 GiB post cap ("O limite é 8192 MB.") quoted from the test's inputs, so Igor sees it.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Raise the TEMPORARY post video cap to 8 GiB (9000 s kept) and keep every pin in step</name>
  <files>packages/contracts/tests/media.test.ts, packages/contracts/src/media.ts, apps/web/components/media/VideoUploadField.tsx</files>
  <behavior>
    - MEDIA_LIMITS.video.post: maxBytes is 8 GiB, maxDurationSeconds is 9000, mimes unchanged; story (500 MiB, 60 s) and lesson (4 GiB, 14 400 s) did not move.
    - classifyMediaFile for a video/mp4 post: a file of exactly the cap gives null, one byte more gives 'size'.
    - mediaStartBodySchema accepts a post video start whose size is the cap and the cap plus one (the size schema judges positivity and integrality, the table judges the cap) and the cap is a safe integer.
  </behavior>
  <action>
Test first, then the constant, per the d1o pattern.

1. packages/contracts/tests/media.test.ts. In the existing explicit pin (the `it` titled TEMPORARY raise, quick 261117-d1o), change the byte expectation of the post entry to 8 GiB written as `8 * 1024 ** 3`, keep 9000, and retitle it to name both quick ids (261117-d1o raised it to four GiB, 261118-glh to eight) and the new values; update its inline comment to say that flipping the constant back means 500 MiB and 300 s. Keep the story and lesson assertions in that case exactly. Add one new `it` right after it that derives from the table: classifyMediaFile on a `video/mp4` file of the post entry's maxBytes for kind video and purpose post returns null and one byte more returns 'size'; `mediaStartBodySchema.safeParse` of `{ kind: 'video', purpose: 'post', mime: 'video/mp4', size }` succeeds for size equal to the cap and for the cap plus one; and `Number.isSafeInteger` holds for the cap. Only the explicit pin may use the literal; the new case reads the table so it survives the revert.

2. SEE RED: `pnpm --filter @rede-social/contracts exec vitest run tests/media.test.ts`. The explicit pin must fail (it expects eight GiB and receives the four-GiB value); record the counts. The derived case passes either way.

3. packages/contracts/src/media.ts. On the post line of `MEDIA_LIMITS.video`, set `maxBytes` to `8 * 1024 * 1024 * 1024` and keep `maxDurationSeconds: 9000`, same key order and `mimes: VIDEO_MIMES` (Biome may wrap the entry; accept its layout). Rewrite the TEMPORARY comment directly above it (keep it a comment block in the style of the lesson entry's): TEMPORARY, applies to every tenant; current values 8 GiB and 9000 s; the first raise (quick 261117-d1o, to four GiB and 9000 s, for ONE 2 h post by the tenant admin) and this one (quick 261118-glh, to 8 GiB, for a 7.2 GB video of about one hour); the ORIGINAL values 500 MiB and 300 s; the revert instruction (put the original values back and flip the explicit post pin in packages/contracts/tests/media.test.ts); one clause that the member-video range in the platform social form follows this entry through D-474; one clause that Mux documents no file-size cap that could be confirmed, so 8 GiB is unverified and a refusal would show as a failed upload. Do not touch the story entry, the lesson entry, the docblocks of other constants or any other product file in this edit.

4. apps/web/components/media/VideoUploadField.tsx. Rewrite ONLY the doc-comment sentence of the `purpose` prop (line ~20) so it states no numbers: `post` is the feed's pair read from `MEDIA_LIMITS.video.post` (raised for now, see the TEMPORARY comment there) and `lesson` is the school's long-form pair under its own tenant ceiling. No code, no JSX, no class changes.

5. Pin sweep (read-only unless a hit): re-run the old-pin sweep gate written in the done section below (it greps the literal forms of the four-GiB cap and of its derived range) over packages/modules/social/tests/contracts.test.ts, apps/web/lib/social-limits.test.ts, apps/web/components/platform/SocialLimitsSheet.test.tsx, apps/api/tests/integration/mux-webhook.test.ts, apps/api/tests/integration/social-media.test.ts and apps/web/e2e/social-platform.spec.ts (expected: no hit), and over apps/api/tests/integration/media.test.ts (expected: only the lesson case P24/P46). A hit that pins the POST cap is replaced by a value derived from MEDIA_LIMITS, SOCIAL_MAX_VIDEO_* or SOCIAL_LIMIT_RANGES the way d1o did, and that file joins this commit; a hit that pins the lesson stays. Then run the derived runnable ones: `pnpm --filter @rede-social/module-social exec vitest run`, `pnpm --filter @rede-social/web exec vitest run lib/social-limits.test.ts components/platform/SocialLimitsSheet.test.tsx`.

6. SEE GREEN: `pnpm --filter @rede-social/contracts exec vitest run` and `pnpm --filter @rede-social/contracts exec tsc --noEmit`. Then `pnpm exec biome format --write packages/contracts/src/media.ts packages/contracts/tests/media.test.ts apps/web/components/media/VideoUploadField.tsx`, re-read `git diff`, check `git status --short`, and commit those paths only: `git commit -m "feat(quick-261118-glh): temporarily allow an 8 GiB feed post video" -- packages/contracts/src/media.ts packages/contracts/tests/media.test.ts apps/web/components/media/VideoUploadField.tsx` with a short body (only the post entry moved; story, lesson, the 3 h tenant ceiling untouched; the platform member-video range widens through D-474; the 8 GiB is unverified against Mux; revert recipe is the original 500 MiB and 300 s). No trailer of any kind. Do not push.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/contracts exec vitest run tests/media.test.ts && pnpm --filter @rede-social/module-social exec vitest run && pnpm --filter @rede-social/web exec vitest run lib/social-limits.test.ts components/platform/SocialLimitsSheet.test.tsx</automated>
  </verify>
  <done>
The post video cap is 8 GiB and 9000 s at its single source with a TEMPORARY comment naming 8 GiB / 9000 s, the first raise and the original 500 MiB / 300 s; story and lesson did not move; every pin derives except the one explicit TEMPORARY pin.

Evidence required in the SUMMARY (real counts, not estimates):
(a) the explicit pin failed once against the 4 GiB constant before the edit (counts), then the whole contracts package passes (Test Files and Tests), plus the module-social and the two web files' counts;
(b) `pnpm --filter @rede-social/contracts exec tsc --noEmit` exits 0;
(c) positive check, expected exactly one match: `grep -c "8 \* 1024 \* 1024 \* 1024" packages/contracts/src/media.ts` (if Biome wrapped the entry, check the two values on their own lines inside the post entry and say so); and `grep -n "TEMPORARY" packages/contracts/src/media.ts` shows the comment with the strings 500 MiB and 300 s;
(d) sweep gate over the six derived files, expected to print nothing: `grep -nE "4 \* 1024 \*\* 3|4 \* 1024 \* 1024 \* 1024|4294967296|4096 MB|entre 1 e 4096|4 GiB" packages/modules/social/tests/contracts.test.ts apps/web/lib/social-limits.test.ts apps/web/components/platform/SocialLimitsSheet.test.tsx apps/api/tests/integration/mux-webhook.test.ts apps/api/tests/integration/social-media.test.ts apps/web/e2e/social-platform.spec.ts`; and for apps/api/tests/integration/media.test.ts the only hits are inside the lesson case;
(e) the stale doc comment in VideoUploadField.tsx no longer carries the old numbers: `grep -c "500 MiB / 5 min" apps/web/components/media/VideoUploadField.tsx` prints 0;
(f) `git show --stat HEAD` lists exactly the paths of this task and `git status --short` shows nothing of this task uncommitted;
(g) the SUMMARY states plainly: the 8 GiB is UNVERIFIED against Mux (no confirmed file-size cap in Mux's docs; a refusal would show as a failed upload) and a real 7 GB upload is Igor's check.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Raise the video upload window to 3 h, keep every consumer consistent, then run the full gate sequence</name>
  <files>packages/core/tests/media-video-mux.test.ts, packages/core/server/media/video/types.ts, packages/core/server/media/limits.ts, apps/api/tests/integration/media-sweeper.test.ts</files>
  <behavior>
    - The `timeout` handed to Mux `uploads.create` equals VIDEO_UPLOAD_TTL_S and equals 10 800 seconds (3 h).
    - 10 800 is inside Mux's documented range, 60 to 604 800 seconds.
    - The sweeper's abandoned-upload window outlives the upload window: VIDEO_UPLOAD_TTL_S * 1000 is below MEDIA_PENDING_TTL_MS.
    - A pending video as old as the whole upload window and still waiting at the provider is asked about and left pending by a sweep (integration case S4).
  </behavior>
  <action>
Test first, then the constant, then the consistency sweep, then the gates.

1. packages/core/tests/media-video-mux.test.ts. Add a new `describe` at the end, titled for the upload window (quick 261118-glh), reusing the file's hoisted `uploadsCreate`, its `provider` and its tenant and asset constants. Case 1: call `createDirectUpload` once with the same input shape the passthrough cases use, read the first argument of the first `uploadsCreate` call, and expect its `timeout` to equal `VIDEO_UPLOAD_TTL_S` and to equal 10_800 (the explicit number is the pin, with a comment that it is the upload window raised from one hour for a multi-GiB post video). Case 2: the constant lies between 60 and 604_800 inclusive (Mux's documented range). Case 3: `VIDEO_UPLOAD_TTL_S * 1000` is below `MEDIA_PENDING_TTL_MS`, importing the first from '../server/media/video/types' and the second from '../server/media/limits' with the file's dynamic-import style. Run `pnpm --filter @rede-social/core exec vitest run tests/media-video-mux.test.ts` and SEE case 1 RED against the old one-hour value (record counts); cases 2 and 3 pass either way.

2. packages/core/server/media/video/types.ts. Set `VIDEO_UPLOAD_TTL_S` to three hours written as `3 * 60 * 60`. Rewrite its docblock: how long a direct-upload target stays valid, that Mux marks the upload timed out after it and documents the range 60 to 604 800 seconds, that it was one hour (write the old value in words, not digits) and was raised with the TEMPORARY post video cap (quick 261118-glh) so a multi-GiB upload on a slow link is not cut off, that it must stay far below `MEDIA_PENDING_TTL_MS` (the 24 h abandoned-upload window in limits.ts, pinned by a test), and that the fake provider ignores it. Do not edit `video/mux.ts` (it already passes the constant as `timeout`) or `video/index.ts` (it already re-exports it).

3. packages/core/server/media/limits.ts. Docblock only: in the comment of `MEDIA_PENDING_TTL_MS`, add one sentence that a video's live upload target is `VIDEO_UPLOAD_TTL_S` (3 h, `video/types.ts`), far shorter than this window, so a pending video is never collected while its provider upload can still finish, and that the two numbers are pinned against each other in packages/core/tests/media-video-mux.test.ts. No code, no constant change.

4. apps/api/tests/integration/media-sweeper.test.ts. In the 'convergence' describe, after S3, add S4: a pending video whose `ageHours` is the upload window in hours, computed from the constant divided by the seconds in an hour (import `VIDEO_UPLOAD_TTL_S` from '@rede-social/core/server/media/video/types', next to the file's other core imports), seeded exactly as S3 seeds its row (kind video, status pending, a fresh fake upload id), left at the default `waiting` provider answer; after `sweepOrphansJob.handler({})` the row is still `pending` and the fake recorded the lookup of its upload id. This file needs the local stack: write it carefully, keep its helpers and style, and run it only under the gate in step 7.

5. Consistency sweep (grep, report each finding; edit only on a real pin of the upload window). Run `grep -rn "VIDEO_UPLOAD_TTL_S" apps packages docs` (expected: types.ts, index.ts, mux.ts and the new tests only); `grep -rniE "interval '(1 hour|60 minutes)'|make_interval\(hours => 1\)" supabase/migrations supabase/central/migrations` and read every hit that mentions media_assets or video (expected: no pending-video hit; if there is one, STOP, do not write SQL or a migration, and report it as a BLOCKER for the orchestrator with the file, the line and the function name); `grep -rnE "3[6]00|one hour|1 h\b" packages/core/server/media apps/web/components/media` (expected: only the unrelated signed-read TTL in storage.ts, the Storage cache-control and the sweeper's deleted-asset window, none about a pending video upload); `grep -nE "upload window|timed_out|1 hour" docs/DEPLOY.md` (expected: only the orphan-route margin and the 24 h sweeper lines named in the context, none pinning the window). Edit docs/DEPLOY.md only if a line really pins the upload window, and then add it to this commit. The negative gate in the done section prints nothing when no digit form of the old one-hour value is left in the video folder.

6. SEE GREEN for the unit side: `pnpm --filter @rede-social/core exec vitest run tests/media-video-mux.test.ts tests/media-video.test.ts tests/media.test.ts`, then `pnpm --filter @rede-social/core exec tsc --noEmit` and `pnpm --filter @rede-social/api exec tsc --noEmit` (the api tsconfig covers the integration files). Then `pnpm exec biome format --write` on exactly the files of this task (plus docs only if edited).

7. GATES, in this order, with the CI env of the context (prefix every pnpm command with it; clear the caches as the context says before the build, and again after). a) The new red-first tests are the three green runs above. b) The WHOLE lint, not a filtered one (the last CI run failed on a Biome FORMAT error that a gate without lint missed): `pnpm lint`. c) `pnpm turbo typecheck build test --concurrency=4`. d) `pnpm check:static-routes`. e) `pnpm boundaries`. f) `pnpm boundaries:negative`. g) `pnpm guard:lanes`. h) `pnpm guard:hooks`. i) `pnpm guard:workflows`. j) The integration suites, ONE AT A TIME, only if `docker info` answers and `df -g /` shows over 10 GiB free and the local stack is already up and seeded (never run `pnpm db:reset` or `pnpm db:seed` to make it so): `pnpm --filter @rede-social/api exec vitest run tests/integration/media.test.ts`, then `.../social-media.test.ts`, then `.../mux-webhook.test.ts`, then `.../media-sweeper.test.ts`. pgTAP is NOT run (no SQL changes). If a precondition fails, mark the suite NOT run with the reason; never reset the database to force it. Triage any red against the known list in the context; a red outside it is ours until proven otherwise. A gate that fails on a file already committed by Task 1 or Task 2 is fixed in a separate path-scoped `fix` commit naming that file (never an amend, never a blanket add).

8. Commit the Task 3 files only: `git commit -m "feat(quick-261118-glh): widen the video direct-upload window to 3 h and pin it against the sweeper" -- packages/core/server/media/video/types.ts packages/core/server/media/limits.ts packages/core/tests/media-video-mux.test.ts apps/api/tests/integration/media-sweeper.test.ts` with a short body (the only consumer is the Mux upload timeout; the 24 h abandoned-upload window is far above it; S4 and the unit pins added; no SQL). No trailer of any kind. Do not push.

9. Write `.planning/quick/261118-glh-oversize-video-message-and-raise-the-tem/261118-glh-SUMMARY.md` (the orchestrator commits planning artifacts; do not stage it, STATE.md, ROADMAP.md or REQUIREMENTS.md). Required content: the three commit SHAs (and any fix commit); the real counts of every run (red then green per task, lint, turbo typecheck build test, each guard, each integration file or why it was NOT run, with the `df -g /` and `docker info` values you saw); what was NOT run (Playwright, pgTAP, any hosted project, the integration suites if gated out); the sentence a person now reads ("Arquivo muito grande. O limite é 8192 MB."); the unverified-against-Mux statement and that a real 7 GB upload is Igor's check; the consistency findings of step 5 (no SQL blocker, the fake provider's signed URL has Supabase's own life and ignores the constant, DEPLOY.md lines reviewed and unrelated); the attachment consequence; the accepted D-474 side effect (member-video range now 1..8192 MB and 1..9000 s, defaults and saved values unchanged); the REVERT RECIPE (media.ts post entry back to 500 MiB and 300 s and the comment deleted, the explicit pin in contracts/tests/media.test.ts flipped, VIDEO_UPLOAD_TTL_S back to one hour with its media-video-mux pin flipped, found by `grep -rn "261118-glh\|TEMPORARY" packages`); and the release note: the cap and the 3 h window take effect on the API through the Deploy API gate after Igor's approval (the start refusal and the Mux upload timeout are both API code paths, the worker image rides the same workflow), the pick-time fix ships with the web on Vercel; nothing was pushed or deployed.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core exec vitest run tests/media-video-mux.test.ts && pnpm --filter @rede-social/core exec tsc --noEmit && pnpm --filter @rede-social/api exec tsc --noEmit</automated>
  </verify>
  <done>
VIDEO_UPLOAD_TTL_S is 3 h and is the only thing that decides the Mux direct-upload timeout; the 24 h sweeper window, the reconcile pass and the SQL sweep functions were checked and nothing sweeps, rejects or fails a pending video before 3 h; the full gate sequence ran in the stated order.

Evidence required in the SUMMARY:
(a) the unit case on the Mux timeout failed against the one-hour value before the edit (counts), then passes; counts for the three core test files;
(b) tsc --noEmit exits 0 for core and api; `pnpm lint` exits 0 (whole repo); `pnpm turbo typecheck build test --concurrency=4` exits 0 or every red is on the known list and named; `pnpm check:static-routes`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, `pnpm guard:hooks`, `pnpm guard:workflows` each exit 0;
(c) negative gate, expected to print nothing: `grep -rn "3600" packages/core/server/media/video`;
(d) positive gate, expected one match: `grep -n "VIDEO_UPLOAD_TTL_S = 3 \* 60 \* 60" packages/core/server/media/video/types.ts`;
(e) the SQL check result stated plainly (no function holds a one-hour literal for pending video assets, so no blocker), or the blocker report if one was found;
(f) each integration file listed as run (with counts and any known-list reds) or NOT run (with the reason);
(g) `git show --stat HEAD` lists exactly the Task 3 paths, `git status --short` shows nothing of this plan uncommitted, and `git log -4 --format=%B | grep -ci "co-authored\|generated with"` prints 0;
(h) the SUMMARY file exists with the content of step 9.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser pick-time gate to the broker API | the gate is UX only; `POST /v1/media/uploads` re-validates kind, purpose, mime and size and answers 413 with the cap, so a stale or tampered tab is judged again |
| tenant admin browser to the video provider | the admin uploads straight to the provider's signed direct-upload target; the API brokers the start and judges the duration at the ready event; no bytes cross Cloud Run |
| super_admin platform form to a tenant's social settings | the only place member-video limits are set; validated against SOCIAL_MAX_VIDEO_*, which follow the raised admin cap |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-glh-01 | Denial of Service | a very large or very long post video consuming provider minutes or storage | medium | mitigate | the start path is admin-only for posts (member video stays off unless enabled), the tenant video-minutes ceiling (3 h, untouched) bounds the total, the ready-event job still rejects and deletes a video past the 9000 s duration cap, and the raise carries a TEMPORARY comment with a one-line revert |
| T-quick-glh-02 | Tampering | a direct-upload URL staying valid for 3 h instead of 1 h | low | accept | the URL is minted per upload after the broker authenticated the caller and the tenant, is bound to one asset (passthrough tenant:asset) and to the tenant's browser origin (cors_origin), and a leaked URL can only add bytes to that one pending asset whose duration is judged at the ready event; the longer window is the point of the change |
| T-quick-glh-03 | Denial of Service | the abandoned-upload sweeper collecting a live 3 h upload, or failing to collect a dead one | medium | mitigate | MEDIA_PENDING_TTL_MS (24 h) is pinned above VIDEO_UPLOAD_TTL_S by a unit test, the sweeper predicate and the reconcile pass were read, integration case S4 proves a window-old pending video survives, and a one-hour SQL literal for pending video assets is a stop-and-report blocker |
| T-quick-glh-04 | Elevation of Privilege | a member reaching the wider member-video ceiling | low | accept | only a super_admin can set member video limits (range now 1..8192 MB and 1..9000 s per D-474); defaults (60 s, 100 MiB) and every saved tenant value are unchanged, so no member gets more than before until a super_admin chooses it |
| T-quick-glh-05 | Information Disclosure | the too-large message naming the limit | low | accept | the cap is public product behaviour already shown by the composer and the platform form; the message carries no tenant data and no raw error (the raw error stays in the console, T-02-147) |
| T-quick-glh-06 | Tampering | the temporary caps and the 3 h window staying in production after the video is published | low | mitigate | the TEMPORARY comment names the original values, an explicit TEMPORARY pin and the TTL pin fail on a silent revert mismatch, and the SUMMARY records the revert recipe |
| T-quick-glh-07 | Repudiation | a Claude attribution trailer in a public-repo commit | low | mitigate | every commit is path-scoped, authored by the configured git identity, with no Co-Authored-By or generated-with line; the gate greps the last four commit messages |
</threat_model>

<verification>
- Task 1 red then green on `components/media`, Task 2 red then green on contracts (plus module-social and the two web files), Task 3 red then green on the core Mux test file.
- `pnpm lint` (whole), `pnpm turbo typecheck build test --concurrency=4`, `pnpm check:static-routes`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, `pnpm guard:hooks`, `pnpm guard:workflows` pass under the CI env, in that order, with only the known reds allowed.
- Integration files media, social-media, mux-webhook and media-sweeper run one at a time when Docker answers and more than 10 GiB is free; otherwise they are reported NOT run with the reason.
- `git diff --name-only <base>..HEAD` lists only this plan's files; `git status --short` shows nothing of this plan left uncommitted; no commit has a trailer; nothing is pushed.
- The SUMMARY states: 8 GiB unverified against Mux and a real 7 GB upload is Igor's check; the sentence shown for an oversize video; the SQL check; the revert recipe; the release path.
</verification>

<success_criteria>
- A video or file over its cap is refused at pick time with "Arquivo muito grande. O limite é ..." and the limit, with no request and no photo re-encode; images and HEIC behave as before.
- A tenant admin can start a feed post video of up to 8 GiB and 9000 s, and its Mux direct upload has a 3 h window that the sweeper, the reconcile pass and the SQL sweep functions never cut short.
- The raises are marked TEMPORARY in code with the original values and a revert recipe; story, lesson, the 3 h tenant ceiling and the 24 h sweeper window did not move.
- Three atomic, path-scoped, trailer-free commits on master, unpushed, with the full gate sequence recorded in the SUMMARY.
</success_criteria>

<output>
Create `.planning/quick/261118-glh-oversize-video-message-and-raise-the-tem/261118-glh-SUMMARY.md` when done
</output>
