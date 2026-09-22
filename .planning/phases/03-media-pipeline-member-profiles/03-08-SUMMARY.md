---
phase: 03-media-pipeline-member-profiles
plan: 08
subsystem: testing
tags: [media, sweeper, pg-boss, jobs, tenant-isolation, pgtap, playwright, exit-gate, mux, deploy]

# Dependency graph
requires:
  - phase: 03-01
    provides: the media broker, `mediaAssetPrefix`/`assertTenantKey`/`removeObjects`/`invalidateSignedUrl`, and the soft-delete `deleteAsset` that deliberately left the bytes behind
  - phase: 03-06
    provides: the `VideoProvider` seam with `deleteAsset`, the fake adapter and its `fakeVideoInternals` recorder
  - phase: 03-07
    provides: `GET /v1/media/{assetId}/playback`, `/configuracoes/midia` and the three-state player the smoke walks
provides:
  - "`kernel.media-sweep-orphans`: a self-re-arming deferred pg-boss job that collects abandoned uploads (24 h) and retired assets (1 h) — the lifecycle gap 03-01 left open"
  - "`purgeAsset(row)`: Storage prefix → provider asset → row, in that order, so a failure leaves a re-collectable row rather than unreferenced bytes"
  - "`armSweeper()` and the worker's single arm at start — the whole cadence, with no scheduler anywhere in the repo"
  - "`listObjects(prefix)` in the media Storage lane (storage-js has no delete-a-prefix call)"
  - "the two-tenant isolation suite grown to every surface Phase 3 added, with a positive control beside every negative"
  - "`apps/web/e2e/phase3-smoke.spec.ts`: the phase goal walked end to end on an iPhone 14 viewport"
  - "the Phase 3 runtime-state record in `docs/DEPLOY.md`, including the two known-blocked Phase 01.1 verifications"
  - "a green `pnpm verify` — the phase's exit gate — at 20m26s"
affects: [04-feed, 07-notifications-chat, 08-hardening, 01.1-cloud-provisioning]

# Actuals (#2632) — chars/4 over the files actually changed, the same instrument 03-06/03-07 used.
actuals:
  tokens: 53523
  tasks: 3
  commits: 3
plan_head_before: 40802e73f6e06640dc55b21497a4219fa0735111

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "self-re-arming deferred job (the `kernel.domain-verify` cadence) applied to a batch collector"
    - "delete-order discipline: bytes → provider → row, because the row is the only pointer to the bytes"
    - "every cross-tenant isolation case carries its positive control in the SAME test"

key-files:
  created:
    - packages/core/server/media/sweep-job.ts
    - apps/api/tests/integration/media-sweeper.test.ts
    - apps/web/e2e/phase3-smoke.spec.ts
  modified:
    - packages/core/server/media/service.ts
    - packages/core/server/media/storage.ts
    - packages/core/server/media/limits.ts
    - packages/core/server/media/index.ts
    - packages/core/server/media/video/fake.ts
    - apps/api/src/worker.ts
    - apps/api/tests/integration/isolation.test.ts
    - supabase/tests/020-tenant-isolation.sql
    - docs/DEPLOY.md
    - apps/web/e2e/login.spec.ts
    - apps/web/e2e/shell.spec.ts
    - apps/web/e2e/signup.spec.ts
    - packages/contracts/src/media.ts

key-decisions:
  - "MEDIA_SWEEP_QUEUE and MEDIA_SWEEP_SINGLETON are declared in `media/index.ts` beside MEDIA_DERIVE_QUEUE, not in `sweep-job.ts`: `service.ts` needs them for `armSweeper` and the job file imports the service, so declaring them in the job would invert the repo's 'service -> job direction only, so there is no cycle' rule"
  - "`purgeAsset` LISTS the asset prefix instead of reconstructing keys from `variant_widths`, so a ladder that changed since derivation still leaves nothing behind; `@supabase/storage-js` has no delete-a-prefix call, so `listObjects` was added to the media Storage lane"
  - "a provider refusal RETURNS EARLY and leaves the row: deleting it would leave a vendor-side asset nothing can ever find again. `fakeVideoInternals.failDeleteAsset` was added so that branch is proved rather than described"
  - "the sweeper's age windows are measured with the DATABASE's `now()` via `make_interval(secs => …)`, never a client clock (T-03-53)"
  - "the phase smoke picks the real iPhone HEIC FIRST and accepts either branch — Chromium ships no HEIC decoder, so locally it takes the honest 'could not prepare' path — then uses `large.jpg` for the photo half of the walk. The HEIC silent-success half stays a real-device check"
  - "four Phase 1/2 e2e assertions were stale because Phase 3 deliberately changed what they asserted; each is now asserted ABSENT rather than deleted, so the removal itself is pinned"

patterns-established:
  - "Batch collector: bounded `limit` in SQL, sequential purges, a `failed` counter that never aborts the batch, and a re-arm outside the try/catch so the cadence survives any failure"
  - "Isolation case shape: negative + positive control in one test, so a globally broken route cannot make the negative pass vacuously (T-03-56)"
  - "An honest e2e annotation (`testInfo.annotations.push`) naming the phase that will close what the run cannot prove"

requirements-completed: [TENANT-04, MEDIA-01, MEDIA-02, MEDIA-03, PROF-01, PROF-02, PROF-03]

coverage:
  - id: D1
    description: "`kernel.media-sweep-orphans` collects an abandoned upload — objects first, then the row — and queues the next run under a constant singletonKey, with no scheduler in the repo"
    requirement: "MEDIA-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-sweeper.test.ts#collects a pending asset 25 hours old: the objects go, then the row, and the sweeper re-arms"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-sweeper.test.ts#the queue really carries the `short` policy, which is what keeps ONE sweeper queued"
        status: pass
    human_judgment: false
  - id: D2
    description: "The sweeper never touches a live asset: a 48 h-old `processing`/`ready` row survives, a `deleted` row is kept for its first hour, and the age is the database's own clock"
    requirement: "MEDIA-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-sweeper.test.ts#safety — the sweeper touches ONLY what the two windows name (T-03-53)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One run is bounded by MEDIA_SWEEP_BATCH, re-running is free, an already-empty prefix still deletes the row, and a provider that refuses leaves a re-collectable row instead of orphaning the vendor asset"
    requirement: "MEDIA-02"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-sweeper.test.ts#bounded and idempotent — one run cannot stall the worker, and re-running is free"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-sweeper.test.ts#the provider path — a collected video does not linger at the vendor"
        status: pass
    human_judgment: false
  - id: D4
    description: "A tenant-B session cannot obtain a Storage signed URL or a Mux playback token for a tenant-A object, and each community demonstrably can reach its own (criterion 4)"
    requirement: "TENANT-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#j. Storage signed URL: tenant B cannot obtain one for tenant A's object (criterion 4)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#k. playback token: tenant B's admin cannot mint one for tenant A's ready video"
        status: pass
    human_judgment: false
  - id: D5
    description: "The rest of the Phase 3 surface is cross-tenant proof: complete, delete, the member directory, the avatar gate, and the membership-less platform identity"
    requirement: "TENANT-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#l./m./n./o./p."
        status: pass
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (plan(45), media_assets + member_profiles + media_provider_events, both lanes)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The phase goal walks end to end on a phone: a member sets a photo, renames themselves, finds another member by an unaccented fragment and opens their profile; an admin uploads a video and sees it reach Pronto"
    requirement: "PROF-01"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase3-smoke.spec.ts (mobile-chromium, 3 passed)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The repo's own exit gate (`pnpm verify`) is green end to end with the phase's new unit, pgTAP, integration and e2e suites included"
    verification:
      - kind: other
        ref: "pnpm verify — exit 0, 1226 s"
        status: pass
    human_judgment: false
  - id: D8
    description: "`docs/DEPLOY.md` records every piece of runtime state Phase 3 created outside git, and the two verifications that cannot be closed without a Mux account and a real device"
    verification:
      - kind: manual_procedural
        ref: "docs/DEPLOY.md §Phase 3 runtime state; four grep gates (media_provider_events, VIDEO_PROVIDER, supabase db push, Phase 01.1) pass"
        status: pass
    human_judgment: true
    rationale: "Whether a runbook is ACTIONABLE is only knowable when a human follows it during Phase 01.1 provisioning; the greps prove presence, not sufficiency."
  - id: D9
    description: "Real-device HLS playback: a ready video plays, with a thumbnail, on a real iPhone (Safari) and a real Android device (Chrome)"
    requirement: "MEDIA-03"
    verification: []
    human_judgment: true
    rationale: "KNOWN-BLOCKED on Phase 01.1. Playwright bundles Chromium, which cannot stand in for iOS Safari's HLS stack; the fake provider also mints non-JWT thumbnail tokens so the poster branch never runs locally (broken-windows 14). Annotated in phase3-smoke.spec.ts; re-run instructions in docs/DEPLOY.md."
  - id: D10
    description: "A real Mux transcode: an upload reaches `ready` with a playback id through a real Mux account"
    requirement: "MEDIA-03"
    verification: []
    human_judgment: true
    rationale: "KNOWN-BLOCKED on Phase 01.1. No Mux account and no GCP Secret Manager exist yet, so every automated proof in Phase 3 runs against VIDEO_PROVIDER=fake (broken-windows 12)."

# Metrics
duration: 67 min
completed: 2026-09-22
status: complete
---

# Phase 3 Plan 08: Orphan Sweeper, Isolation Suite & Exit Gate Summary

**A self-re-arming `kernel.media-sweep-orphans` that deletes bytes-then-provider-then-row, the two-tenant isolation suite grown to every Phase 3 surface with a positive control beside every negative, one mobile smoke that walks the whole phase goal, and a green `pnpm verify` at 20m26s — with the two verifications a headless browser and a missing Mux account cannot give recorded as blocked rather than passed.**

## Performance

- **Duration:** 67 min
- **Started:** 2026-09-22T03:40:04Z
- **Completed:** 2026-09-22T04:47:00Z
- **Tasks:** 3
- **Files modified:** 16

## Accomplishments

- **The broker's lifecycle is complete.** 03-01 deliberately left two holes: `DELETE /v1/media/{assetId}` marks a row and leaves the bytes, and an abandoned upload leaves a `pending` row forever. `kernel.media-sweep-orphans` closes both with two windows written as a flat SQL disjunction over `status` plus an age — `pending` older than 24 h, `deleted`/`rejected` older than 1 h — so a `processing` or `ready` asset is out of scope **by construction**, not by a runtime guard a later edit could invert.
- **A collected asset leaves nothing behind.** `purgeAsset` lists the whole `<tenant_id>/media/<assetId>/` prefix (original plus every derived `w<width>.webp`), removes it, drops the in-process signed-URL memo for that prefix, deletes the provider-side asset through `videoProvider.deleteAsset` when the row carries one, and only THEN deletes the row. The row dies last because it is the only pointer to the bytes; a Storage or provider failure returns early and leaves a row the next run collects again.
- **No scheduler was introduced.** `boss.schedule()` stays unused. The worker arms the sweeper once at start, and every run queues the next one an hour out under a CONSTANT `singletonKey`, which the `short` queue policy turns into "at most one sweeper is ever queued". One mechanism for periodic work, the one `kernel.domain-verify` already uses.
- **The two-tenant suite covers everything Phase 3 added.** `isolation.test.ts` gained cases j–p (Storage signed URL, playback token, complete, delete, the member directory, the avatar gate, and the membership-less `super_admin`), lifted from the per-feature suites rather than re-derived. **Every one asserts its positive control in the same test**, so a globally broken route cannot make an isolation assertion pass vacuously. `020-tenant-isolation.sql` went from `plan(38)` to `plan(45)`, adding `media_provider_events` (invisible AND unwritable from a tenant lane) and the media/`member_profiles` symmetry from tenant B's side.
- **One mobile spec walks the whole goal.** `phase3-smoke.spec.ts` on `mobile-chromium`: photo → rename → bio → search `goncal` → open João Gonçalves (a name and a bio, no role, no e-mail) → admin uploads `sample.mp4` → "Processando" → "Pronto" → the player opens with a credential.
- **`pnpm verify` is green end to end**, and it caught two real regressions on the way (below).

## Task Commits

1. **Task 1 (tracer): purgeAsset, the self-re-arming sweeper, the worker arm, one integration path** — `94af7ba` (feat)
2. **Task 2: the sweeper's safety predicates and the isolation suite grown to every Phase 3 surface** — `f5564c2` (test)
3. **Task 3: the phase smoke, the deploy record, the blocked UAT lines and the exit gate** — `ddd6f23` (test)

## Files Created/Modified

- `packages/core/server/media/sweep-job.ts` — the collector: two commented windows, a bounded batch, a `failed` counter that never aborts the run, and a re-arm outside the try/catch
- `packages/core/server/media/service.ts` — `purgeAsset(row)` and `armSweeper()`
- `packages/core/server/media/storage.ts` — `listObjects(prefix)`
- `packages/core/server/media/limits.ts` — `MEDIA_SWEEP_INTERVAL_S`, `MEDIA_PENDING_TTL_MS` (with the TUS-URL citation), `MEDIA_DELETED_TTL_MS`, `MEDIA_SWEEP_BATCH`
- `packages/core/server/media/index.ts` — `MEDIA_SWEEP_QUEUE`, `MEDIA_SWEEP_SINGLETON`, and the queue registration
- `packages/core/server/media/video/fake.ts` — `fakeVideoInternals.failDeleteAsset`, the forced-refusal switch
- `apps/api/src/worker.ts` — `sweepOrphansJob` in the kernel jobs list plus one best-effort `armSweeper()` at start
- `apps/api/tests/integration/media-sweeper.test.ts` — 11 cases: the tracer, the safety windows, batching, idempotency, the provider path
- `apps/api/tests/integration/isolation.test.ts` — cases j–p (18 cases total)
- `supabase/tests/020-tenant-isolation.sql` — `plan(45)`
- `apps/web/e2e/phase3-smoke.spec.ts` — the phase-goal walk
- `docs/DEPLOY.md` — the Phase 3 runtime-state section and the Phase 01.1 blocked table
- `apps/web/e2e/{login,shell,signup}.spec.ts`, `packages/contracts/src/media.ts` — deviations, below

## The exit gate

`pnpm verify` — **exit 0, 1226 s (20 m 26 s)** from a clean `.next` and no pre-existing dev server.
Against the Phase 2 baseline (02-20: 17 m 30 s):

| Suite | This run | Phase 2 baseline |
|---|---|---|
| Unit (`turbo test`) | **385 passed** (api 15, contracts 57, core 189, ui 42, web 82) | 288 |
| pgTAP (`supabase test db`) | **128 passed**, 9 files, `Result: PASS` | 98 |
| Integration | **313 passed**, 22 files | 187 |
| `spike:supavisor` | 3 passed | — |
| e2e | **271 passed / 41 skipped** (19.3 m) | 174 / 38 |
| e2e:pwa | **45 passed / 3 skipped** (20.2 s) | 45 / 3 |

The 3-minute growth over the Phase 2 baseline is the phase's own new evidence: 97 more unit, 30 more pgTAP, 126 more integration and 97 more e2e cases.

**The first two attempts at this gate were RED, and both were real.** They are recorded as deviations rather than smoothed over — the gate did its job.

## Known-blocked verifications (Phase 01.1)

Recorded as **blocked, not passed**, in `docs/DEPLOY.md`, as annotations in the smoke spec's own run output, and as coverage entries D9/D10 above. The honest analogue of Phase 2 closing at "UAT partial — 9/13 passed, 4 blocked on Phase 01.1".

1. **Real-device HLS playback.** Playwright bundles Chromium, which cannot stand in for iOS Safari's HLS stack — the same class of finding as 02-11's standalone-install check. The local fake also mints non-JWT thumbnail tokens, so `@mux/mux-player` never derives a poster and only the no-poster branch is ever exercised (broken-windows 14). **Re-run:** after step 6 of the Mux runbook, upload a phone-recorded HEVC video as `admin_tenant`, confirm the "Processando" placeholder, then confirm playback **with a thumbnail** on a real iPhone (Safari) and a real Android device (Chrome).
2. **A real Mux transcode.** No Mux account and no GCP Secret Manager exist yet, so every automated proof in Phase 3 runs against `VIDEO_PROVIDER=fake`; the Mux adapter is written and typed but has never run against a real account (broken-windows 12). **Re-run:** the seven-step Mux runbook in `docs/DEPLOY.md`, then `VIDEO_PROVIDER=mux`, then one real upload whose `video.asset.ready` lands on `POST /v1/webhooks/mux` and flips the row to `ready` with a `playback_id`.

A third, smaller one is also recorded: the **HEIC silent-success** half. Chromium has no HEIC decoder, so the smoke and `media-upload.spec.ts` both exercise the "could not prepare" branch locally; that a real iPhone Safari decodes the capture and uploads it silently is only observable on a device. 03-04 deferred this here; it belongs with check 1 above.

**The STATE blocker "[Phase 3]: Video vendor pricing is LOW confidence" is CLOSED** by published figures now recorded in `docs/DEPLOY.md`: Mux encoding free at `video_quality: 'basic'`, the first 100,000 delivery minutes/month free, storage ≈ USD 0.0028/min/month at 1080p — roughly USD 1/month for a 300-minute pilot library, against Cloudflare Stream's USD 5/month floor. Assumption A6 flags these as *published* rates to re-verify in the dashboard at account creation.

## Decisions Made

- **The queue-name constants live in `media/index.ts`, not in `sweep-job.ts`.** `service.ts` owns `armSweeper` (the plan's own placement), the job file imports the service for `purgeAsset`, and a constant declared in the job file would make that a cycle — inverting the repo's documented "service -> job direction only, so there is no cycle" rule that `MEDIA_DERIVE_QUEUE` already follows. `sweep-job.ts` re-exports them, so `import { MEDIA_SWEEP_QUEUE, sweepOrphansJob } from '…/sweep-job'` works exactly as the plan's artifact block promised.
- **`purgeAsset` lists rather than reconstructs.** Building keys from `variant_widths` would miss an object written under a ladder that has since changed. `@supabase/storage-js` has no delete-a-prefix call, so `listObjects(prefix)` was added to the Storage lane, filtering folder entries (`id === null`) and rebuilding full keys from the relative names `list` returns.
- **A provider refusal leaves the row.** The alternative — delete the row anyway — leaves a vendor-side asset that nothing can ever find again, which is strictly worse than one more sweep in an hour.
- **The smoke's HEIC pick accepts either branch and asserts the format is never named.** Forcing it to succeed under Chromium would be a fiction; forcing it to fail would break on a future Chromium that ships a decoder.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/contracts/src/media.ts` failed repo-wide `pnpm lint`**
- **Found during:** Task 3, first `pnpm verify` attempt (died at step 1 after 1 s)
- **Issue:** a single line written by 03-07 (`limit: z.coerce.number().int()…`) exceeded Biome's width and had never been formatted. 03-07 ran `pnpm --filter <pkg> lint` for the packages it touched, so the contracts package was never checked; the repo-level `pnpm lint` (which `pnpm verify` runs first) had not run since.
- **Fix:** `biome check --write` on that file (+6/-1 lines, formatting only — no behaviour change).
- **Files modified:** `packages/contracts/src/media.ts`
- **Verification:** `pnpm lint` green; the full gate then proceeded.
- **Committed in:** `ddd6f23`

**2. [Rule 1 - Bug] Four Phase 1/2 e2e assertions were stale because Phase 3 deliberately changed what they asserted**
- **Found during:** Task 3, second `pnpm verify` attempt — **8 failed / 263 passed** in e2e, being 4 distinct assertions × 2 Playwright projects
- **Issue:** `login.spec.ts:33`, `signup.spec.ts:118` and `shell.spec.ts:187` all asserted `getByText('Membro', { exact: true })` is VISIBLE on `/perfil`. 03-05 replaced that page and removed the role `StatusPill` on purpose (UI-D-01 / D-45: "a profile is a person, not a rank"). Separately, `shell.spec.ts:172` asserted exactly **two** "Em breve" pills on `/configuracoes`; 03-04 turned "Editar perfil" into a real navigating row, leaving one (broken-windows 10's Phase 3 half). Neither 03-04 nor 03-05 ran the full e2e suite, so four stale assertions shipped.
- **Fix:** each assertion updated to the Phase 3 truth **without weakening it** — the role word is now asserted `toHaveCount(0)` rather than deleted (so a re-introduced pill fails loudly), the e-mail/display-name assertions that prove WHICH identity reached `/perfil` are kept, the pill count is 1 and the `/perfil/editar` link is asserted present, and two now-misleading test titles were corrected.
- **Files modified:** `apps/web/e2e/login.spec.ts`, `apps/web/e2e/signup.spec.ts`, `apps/web/e2e/shell.spec.ts`
- **Verification:** `playwright test login.spec.ts signup.spec.ts shell.spec.ts` → 36 passed; the third full gate → exit 0.
- **Committed in:** `ddd6f23`

**3. [Rule 2 - Missing critical] The fake provider had no forced-refusal switch**
- **Found during:** Task 2
- **Issue:** the plan's behaviour list requires "when the fake is forced to throw on `deleteAsset`, the row SURVIVES the run" and refers to "its forced-throw switch", but `fakeVideoInternals` only exposed `deletedAssetIds`, `signUpload` and `scheduleReady`. Without a switch, the single most important failure mode of `purgeAsset` — a provider that says no — could only be described, not proved.
- **Fix:** added `fakeVideoInternals.failDeleteAsset` (reset by `resetFakeVideoInternals`), raised BEFORE the recorder so a forced failure leaves no trace of a delete that did not happen.
- **Files modified:** `packages/core/server/media/video/fake.ts`
- **Verification:** the case asserts the row survives, the recorder is empty, and the next run (switch off) collects it.
- **Committed in:** `f5564c2`

### Divergences from the plan's literal acceptance criteria

These are recorded because the plan's own dispatch warned that an acceptance criterion may describe something that cannot exist as written. Each intent is satisfied; each has a mechanical check that *does* hold.

**a. `sweep-job.ts` does not contain `MEDIA_SWEEP_QUEUE = 'kernel.media-sweep-orphans'` nor `startAfter: MEDIA_SWEEP_INTERVAL_S`.** The plan's action items place `armSweeper` in `service.ts` (criterion: `export async function armSweeper(` in `service.ts` — satisfied) and the queue registration in `index.ts` (satisfied). Those two placements force the queue name and the enqueue call to live below the job file in the import graph, because `sweep-job.ts` imports `service.ts` for `purgeAsset`. Satisfying both greps simultaneously would require either a duplicated constant or an import cycle the repo explicitly forbids.
- **Checks that hold:** `grep -q "MEDIA_SWEEP_QUEUE = 'kernel.media-sweep-orphans'" packages/core/server/media/index.ts` ✓; `grep -q 'startAfter: MEDIA_SWEEP_INTERVAL_S' packages/core/server/media/service.ts` ✓; `grep -q MEDIA_SWEEP_QUEUE packages/core/server/media/sweep-job.ts` ✓ (imported, used as the job's `name`, and re-exported); `grep -q MEDIA_SWEEP_SINGLETON packages/core/server/media/sweep-job.ts` ✓. Every other Task 1 criterion passes verbatim, including the `awk` delete-order check and `boss.schedule` appearing 0 times with comments stripped.

**b. The smoke's photo half is carried by `large.jpg`, not by `iphone.heic`.** The plan asks the smoke to "set a photo from `iphone.heic` … and confirm the avatar is served from `/v1/media/…` with a `srcset` naming `w128` and `w320`". Chromium ships no HEIC decoder (03-04's finding, re-observed in this run: `media.upload_prepare_failed { error: 'Error: image decode failed' }`), so a HEIC pick under Playwright can never produce an avatar. The spec picks the HEIC FIRST — exercising the real phone path and asserting the honest local answer plus "the format is never named to the member" in both branches — and then picks `large.jpg` for the assertion about the rendered avatar. `iphone.heic` is in the file, as the criterion requires, and the silent-success half is recorded as a real-device check.

**c. `020-tenant-isolation.sql` is `plan(45)`, not `plan(44)`.** A miscount on my side, caught by pgTAP itself ("you planned 44 tests but ran 45") and corrected. Mentioned only because the number is in the commit message.

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical) + 3 documented divergences.
**Impact on plan:** no scope creep. Deviations 1 and 2 are Phase 3 debt that this plan's exit gate existed to surface; deviation 3 turns a described behaviour into a proved one. Divergence (a) preserves a documented architectural rule the criteria did not account for; (b) preserves honesty about what a headless browser can witness.

## Issues Encountered

- **`pnpm test:integration -- <filter>` runs the WHOLE suite** (vitest ORs the filters) — the prior-wave note holds. `pnpm --filter @tria/api exec vitest run tests/integration/<file>` is the way to run one file.
- **The `pnpm verify` chain is strictly sequential and fails fast**, so a 1-second lint failure hides a 20-minute gate. Budget three attempts when a phase has not run the repo-level gate in a while.
- **Disk:** `.turbo/cache` had grown to 3.7 GB and `apps/web/.next` to 511 MB against 10 GB free. Both were pruned before the gate (the 02-20 ENOSPC precedent). Neither is tracked.

## Known Stubs

None introduced by this plan. Three Phase 3 items remain open in `.planning/WINDOWS.md` and are **not** closed here:

| Window | What | Why it stays open |
|---|---|---|
| 12 | The Mux adapter has never run against a real Mux account | Phase 01.1 (no account exists); recorded in `docs/DEPLOY.md` |
| 13 | `videoProvider.getAsset` is implemented on both adapters but wired to no caller | A lost-webhook reconciliation job is Phase 8 work; tracked in `deferred-items.md` |
| 14 | `VideoPlayer`'s poster/still half has never rendered a real image | The fake mints non-JWT thumbnail tokens; Phase 01.1, alongside 12 |

One new entry was recorded (id 15, `unrun-verify`): real-device HLS playback was never observed, for the reason in D9 above.

`deferred-items.md` keeps its two open entries (the unguarded service-worker registration promise, and `getAsset`'s missing caller). Neither is in this plan's scope and neither blocks the gate.

## Threat Flags

None. This plan added one privileged unattended surface — the sweeper — and every mitigation its `<threat_model>` names is implemented and tested: T-03-53 (predicates by construction + database clock + 48 h-old survivors), T-03-54 (byte→provider→row ordering, pinned by an `awk` check), T-03-55 (`assertTenantKey` before the list, prefix derived from the row's own `tenant_id`, bounded batch), T-03-56 (positive control beside every negative), T-03-57 (blocked verifications recorded, never green), T-03-58 (`MEDIA_SWEEP_BATCH` + sequential purges + constant `singletonKey`). T-03-SC holds: **this plan installed nothing.**

## User Setup Required

None — no new external service configuration. The Phase 01.1 Mux provisioning already recorded in `docs/DEPLOY.md` is unchanged in substance; this plan added the runtime-state inventory and the blocked-verification table around it.

## Next Phase Readiness

- **Phase 3 is complete.** All eight plans have summaries, `pnpm verify` is green, and the phase's requirements (TENANT-04, MEDIA-01/02/03, PROF-01/02/03) are proved by automated suites except the two device/account-blocked lines.
- **Expect a PARTIAL UAT**, the way Phase 2 closed at 9/13 with 4 blocked. The two lines above cannot be closed before Phase 01.1.
- **Phase 4 (feed)** inherits the sweeper for free: a member who opens the composer, picks an image and navigates away leaves a `pending` asset that disappears in 24 h with no further work. Widening the collector to a composer-specific window is one constant.
- **Phase 8 (hardening)** owns the tuning knobs (`MEDIA_SWEEP_BATCH`, the two TTLs), the per-tenant storage readout, and the `getAsset` reconciliation job.
- **CLAUDE.md pin drift for the user to reconcile** (carried forward from 03-06/03-07, unchanged here): the stack table pins `@mux/mux-node` 15.1.0 and `@mux/mux-player-react` 3.13.3; the tree carries 15.2.0 / 3.13.4, and `@mux/upchunk` is absent from the table.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-22*

## Self-Check: PASSED

- `packages/core/server/media/sweep-job.ts` — FOUND
- `apps/api/tests/integration/media-sweeper.test.ts` — FOUND
- `apps/web/e2e/phase3-smoke.spec.ts` — FOUND
- commit `94af7ba` — FOUND
- commit `f5564c2` — FOUND
- commit `ddd6f23` — FOUND
- `pnpm verify` — exit 0, 1226 s (verified from a clean `.next` with no pre-existing dev server)
