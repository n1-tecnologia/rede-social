---
phase: 02-tenant-shell-branding-platform-panel
plan: 13
subsystem: platform branding (signed Storage uploads, sharp icon derivation job, colours contrast gate)
tags: [branding, platform, api, jobs, storage, sharp, png-to-ico, pwa-icons, pg-boss, pgtap, seed]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel (02-01)
    provides: "@tria/contracts/branding tenantBrandingSchema (iconUrl/iconUrls/iconVersion keys), deriveBrandColors, contrastReport, resolveBranding; resolveTenantHost cache + invalidateTenantHost; seed SVG wordmarks under apps/web/public/seed-logos"
  - phase: 02-tenant-shell-branding-platform-panel (02-03)
    provides: "sharp@0.35.4 + png-to-ico@3.0.2 in packages/core (legitimacy gate passed in 02-02), custom-migration prefix `supabase`, pgTAP harness under supabase/tests"
  - phase: 02-tenant-shell-branding-platform-panel (02-05)
    provides: "platform lane (requireSuperAdmin, PlatformEnv, platformDefaultHook), getTenantDetail/updateTenant, tenantsRoutes, PlatformActor + logFor"
  - phase: 02-tenant-shell-branding-platform-panel (02-09)
    provides: "kernel-job pattern (queue self-registration in a barrel, never-throwing handler, worker job list), enqueueInTx startAfter/singletonKey, invalidate-every-host loop"
  - phase: 02-tenant-shell-branding-platform-panel (02-11)
    provides: "apps/web/lib/manifest.ts isAllowedIconUrl accepts exactly `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/…` — the URL shape this plan persists"
provides:
  - "POST /v1/platform/tenants/{id}/branding/uploads (201 { uploadId, signedUrl, path, maxBytes 2097152, expiresInSeconds 7200 }; 400 mime/kind/size issues, 404, 413 { size: 'too_large', maxBytes })"
  - "POST /v1/platform/tenants/{id}/branding/uploads/{uploadId}/complete (200 platformTenantDetailSchema; 400 VALIDATION_FAILED { upload: 'not_an_image' | 'format_mismatch' | 'svg_unsafe' | 'too_large' } with the object removed; 404 NOT_FOUND { upload: 'object_missing' })"
  - "PUT /v1/platform/tenants/{id}/branding/colors (200 detail; 400 { confirmLowContrast: 'required', contrastReport } unless confirmLowContrast: true — no pair refused outright, confirmed saves logged lowContrastConfirmed: true)"
  - "DELETE /v1/platform/tenants/{id}/branding/icon (200 detail, idempotent)"
  - "kernel.branding-derive-icons pg-boss queue (policy short, singletonKey = tenantId) + deriveIconsJob registered in apps/api/src/worker.ts; derivation never runs in the request path"
  - "packages/core/server/branding/{icons,upload,index,derive-icons-job}.ts — pure deriveIconSet / inspectBrandingImage / readPixel, key/id helpers with assertTenantKey, svgLooksUnsafe"
  - "packages/core/server/platform/branding.ts — startBrandingUpload, completeBrandingUpload, setBrandingColors, removeIconOverride, applyBrandColors (shared with updateTenant), deriveTenantIcons (optimistic iconVersion write → 'superseded'), uploadIconSet, requeueIconDerivation, invalidateAllTenantHosts, brandingInternals seam"
  - "Public `branding` bucket: [storage.buckets.branding] in supabase/config.toml (local) + 20260917021738_branding_bucket.sql (hosted, idempotent upsert) + pgTAP 060-branding-bucket.sql"
  - "Seed: tria-demo and tria-lab at iconVersion 1 with faviconUrl + iconUrls derived from their seed SVGs (10 objects under <tenant>/branding/icons/1/), logoUrl still root-relative"
  - "@tria/contracts/branding additions: BRANDING_UPLOAD_MIMES, BRANDING_MAX_BYTES, BRANDING_UPLOAD_KINDS, mimeToExtension, brandingUploadBodySchema, brandingUploadSchema, BRANDING_UPLOAD_ID_RE, brandingUploadIdSchema, brandingUploadParamsSchema, BRANDING_UPLOAD_ISSUES, brandingColorsBodySchema, contrastPasses, iconsUpToDate"
affects: [02-14 Marca tab (consumes the four routes + details vocabulary + iconsUpToDate), 02-15 (panel tabs), 02-16 smoke (manifest icons per host, DEPLOY.md note about config.toml buckets being local-only), Phase 3 media pipeline (reuses the start → PUT → complete signed-upload shape), Phase 8 ADMIN-01 (reuses the endpoints under admin_tenant)]

# Actuals (#2632) — chars/4 over the realized diff (git diff e7b8f60..HEAD, migration snapshot excluded)
actuals:
  tokens: 27871
  tasks: 3
  commits: 4
plan_head_before: e7b8f605dcdea607a68169fa253ab17f8ebe42e4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stateless signed-upload id `<kind>-<uuid>.<ext>`: `start` writes nothing to the DB; the object's existence under `<tenant_id>/branding/` is the proof of a legitimate upload, and `assertTenantKey` guards every Storage call"
    - "Request path decodes the image HEADER only (sharp metadata) and enqueues; the worker derives (resize/composite/ICO/five uploads) — CPU off the request path"
    - "Versioned immutable icon keys `/icons/<iconVersion>/` with a one-year cache; optimistic `where coalesce((branding->>'iconVersion')::int, 0) = $version returning` so a racing older derivation reports `superseded` and writes nothing"
    - "One colour persistence path (`applyBrandColors` inside the caller's tx) shared by the panel's PUT and 02-05's PATCH; the primary-change check decides whether `iconVersion` bumps"
    - "Contrast gate that warns, never blocks: report computed BEFORE any write, 400 with the report unless `confirmLowContrast: true`"

key-files:
  created:
    - packages/core/server/branding/upload.ts
    - packages/core/server/branding/icons.ts
    - packages/core/server/branding/index.ts
    - packages/core/server/branding/derive-icons-job.ts
    - packages/core/server/platform/branding.ts
    - apps/api/src/routes/platform/branding.ts
    - apps/api/tests/integration/platform-branding.test.ts
    - packages/core/tests/icons.test.ts
    - supabase/migrations/20260917021738_branding_bucket.sql
    - supabase/tests/060-branding-bucket.sql
  modified:
    - packages/contracts/src/branding.ts
    - packages/core/server/platform/tenants.ts
    - apps/api/src/routes/platform/index.ts
    - apps/api/src/worker.ts
    - supabase/config.toml
    - supabase/migrations/meta/_journal.json
    - scripts/seed.ts

key-decisions:
  - "Colours have two doors and one persistence path: PUT …/branding/colors is the panel's endpoint (both-modes report, confirmLowContrast gate, iconVersion bump); 02-05's PATCH keeps its ungated contract but now calls the same applyBrandColors so a primary change through either door re-derives the maskable icon"
  - "Icon source order in the worker: square override (iconUrl) → logo → the previous transparent i512 render — the fallback is what lets a seed tenant with a root-relative logo re-derive after a colour change; no source at all clears faviconUrl/iconUrls"
  - "Removing the override with no override set is a no-op (unchanged detail) rather than a harmless bump — fewer jobs, same contract"
  - "Storage cleanup in tests goes through the Storage API (a service-key client built in the test file like setup.ts's authAdmin): the Storage schema forbids direct deletes from storage.objects"
  - "Custom migration guarded with to_regclass('storage.buckets') so the migration set still applies on a Postgres without the storage schema"

patterns-established:
  - "Kernel capability split: pure helpers under server/branding/* (no env, no Storage, no DB — unit-testable with sharp fixtures), admin-lane service under server/platform/branding.ts (the ONLY importer of supabaseAdmin/withAdminTx, Biome-enforced), job wrapper importing the service (service → job direction only)"
  - "Test seam object (`brandingInternals.beforeIconWrite`) to inject a concurrent mutation between derivation and the optimistic write"

requirements-completed: [ROLE-03, TENANT-02]

coverage:
  - id: D1
    description: "A super_admin starts a logo upload, PUTs the file straight to the signed Storage URL, completes it (logoUrl recorded, iconVersion 1, ONE created kernel.branding-derive-icons job, no icons yet), the worker handler derives favicon.ico (2 frames) + 192 + 512 + maskable-on-primary + apple-180 under /icons/1/, and by-host reflects the icons on the very next request"
    requirement: "ROLE-03"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-branding.test.ts#tracer — upload a logo, complete, the worker derives the icons, by-host carries them"
        status: pass
    human_judgment: false
  - id: D2
    description: "Colours: low contrast → 400 { confirmLowContrast: 'required', contrastReport } persisting nothing; confirmed → persisted, contrast report carried, iconVersion +1, re-derived maskable is yellow, by-host shows the new primary immediately; good pair saves without confirmation; secondary-only leaves iconVersion; PATCH shares applyBrandColors"
    requirement: "TENANT-02"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-branding.test.ts#colours — contrast gate in both modes, one persistence path with PATCH"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts (PATCH colours case 16 still green)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Square-icon override: kind 'icon' sets iconUrl, the next derivation renders from the override; DELETE …/branding/icon clears it, removes the object, bumps iconVersion and re-derives from the logo; idempotent"
    requirement: "ROLE-03"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-branding.test.ts#square-icon override — set, derive from it, remove, derive from the logo again"
        status: pass
    human_judgment: false
  - id: D4
    description: "Upload edges: image/gif → 400 issues.mime, 3 MiB → 413 too_large, unknown tenant 404, never-uploaded id → 404 object_missing, traversal id → 400, HTML-as-PNG → not_an_image (object removed, branding untouched), SVG-as-PNG → format_mismatch, <script> SVG → svg_unsafe"
    requirement: "ROLE-03"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-branding.test.ts#upload edges — validation, size, missing objects, spoofed and unsafe files"
        status: pass
    human_judgment: false
  - id: D5
    description: "Isolation + auth: tenant B completing A's uploadId → 404 (B's prefix), every derived key under A's prefix, member Bearer → 403 FORBIDDEN; supersede: a version bump between derivation and write → 'superseded' with the old set intact, the next run derives at the bumped version; the handler swallows bad payloads and deleted tenants"
    requirement: "ROLE-03"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-branding.test.ts#isolation and auth / supersede protection and job resilience"
        status: pass
    human_judgment: false
  - id: D6
    description: "Derivation maths pinned: sizes, maskable primary corners + 80 % safe zone (≥ 51 px margin), transparent contain, ICO header, JPEG input, header-only rejections (not_an_image, format_mismatch, svg_unsafe ×4, too_large), key/id helpers and the tenant-prefix guard"
    verification:
      - kind: unit
        ref: "packages/core/tests/icons.test.ts (15 cases, < 1 s)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Bucket + seed gate: db:generate no-op, db:reset applies *_branding_bucket.sql, db:seed derives icons for both seed tenants (idempotent, 10 objects), pgTAP 060 green, by-host answers for tria-demo/tria-lab carry distinct /icons/1/ URLs with the maskable served as image/png"
    requirement: "TENANT-02"
    verification:
      - kind: other
        ref: "pnpm db:generate && pnpm db:reset && pnpm db:seed && pnpm supabase test db (98/98) && curl by-host probes (recorded below)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/hosts.test.ts (strict host shape with non-null iconUrls)"
        status: pass
    human_judgment: false
  - id: D8
    description: "End-of-phase human check: on tria-demo.localhost and tria-lab.localhost the browser tab shows the derived favicon and `/m/<slug>/manifest.webmanifest` lists that host's /icons/1/ URLs (distinct per tenant); an installed PWA shows the maskable icon on the tenant's primary colour"
    verification: []
    human_judgment: true
    rationale: "Favicon/manifest rendering and the maskable icon's look on a home screen are visual facts the API tests cannot see (human_verify_mode end-of-phase)"

# Metrics
duration: 21min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 13: Platform branding — signed uploads, worker-derived icon set, colours contrast gate Summary

**A super_admin now uploads a tenant's logo (and optional square icon) straight to the public `branding` bucket through API-minted signed URLs, `complete` validates the object header-only and records it, a `kernel.branding-derive-icons` worker job derives favicon + 192 + 512 + maskable-on-primary + apple-180 under versioned immutable keys with `sharp` + `png-to-ico`, and `PUT …/branding/colors` recomputes the persisted derivations behind a both-modes contrast gate that warns and requires explicit confirmation instead of blocking — every mutation invalidating the host cache so the branded login page and the per-tenant manifest see the new brand on the next request. Both seed tenants ship with real, distinct icon sets at `iconVersion` 1.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-17T02:10:15Z
- **Completed:** 2026-09-17T02:31:16Z
- **Tasks:** 3 (Task 2 as TDD: RED → GREEN)
- **Files modified:** 18 (10 created, 8 modified incl. the journaled migration snapshot)

## Accomplishments

- **D-27 signed-upload capability**: stateless `uploadId = <kind>-<uuid>.<ext>`, keys `<tenant_id>/branding/<uuid>.<ext>` built server-side from the validated path tenant id and asserted with `assertTenantKey` before every Storage call; the browser PUTs to Storage — the API never accepts file bytes.
- **D-28 icon derivation off the request path**: `complete`/`colors` bump `iconVersion` and enqueue ONE job (`singletonKey = tenantId`, policy `short`); the worker derives from override → logo → previous i512, uploads under `/icons/<iconVersion>/` (one-year cache) and writes `faviconUrl` + `iconUrls` only if the version is still current (`superseded` otherwise).
- **D-25/D-41 colours**: one `applyBrandColors` path for PUT and PATCH; the report is evaluated in both modes before any write; low contrast answers 400 with the report unless `confirmLowContrast: true`; a confirmed save is audited with `lowContrastConfirmed: true`.
- **Hard refusals with a stable `details.upload` vocabulary**: `not_an_image`, `format_mismatch`, `svg_unsafe`, `too_large` (object removed), `object_missing` (404); mime/size at start (400 / 413).
- **Bucket everywhere**: `[storage.buckets.branding]` locally + an idempotent `storage.buckets` upsert migration for hosted projects, pinned by pgTAP; `pnpm db:generate` stays a no-op (no schema change — everything lives in the existing `tenants.branding` jsonb).
- **Seed icons**: `tria-demo` and `tria-lab` carry distinct `/icons/1/` sets; `hosts.test.ts` strict-shape assertions still pass with non-null `iconUrls`.

## Task Commits

1. **Task 1: Tracer — upload → complete → job → icons → by-host** - `87cde0f` (feat)
2. **Task 2 (TDD RED): failing tests for the colours gate, PATCH unification, icon removal; derivation maths + edges pinned** - `6759c13` (test) — RED evidence `RED_EVIDENCE_OK` (25 tests, 7 failing on the target assertions: PUT colours 404 → expected 400, DELETE icon 404, PATCH iconVersion unchanged)
3. **Task 2 (TDD GREEN): colours contrast gate shared by PUT/PATCH, override removal** - `ac81829` (feat)
4. **Task 3: Seed derives icons for both seed tenants + pgTAP bucket test + blocking stack gate** - `ab195ea` (feat)

**Plan metadata:** see the final docs commit.

## TDD Gate Compliance

| Gate | Command | Result |
|------|---------|--------|
| RED | `pnpm exec vitest run tests/integration/platform-branding.test.ts --reporter=tap-flat` (apps/api) | exit 1, 25 tests / 18 pass / 7 fail — target `colours … 1. a low-contrast pair without confirmation answers 400 …` failed on `expected 404 to be 400`; verdict `RED_EVIDENCE_OK` (`gsd_run check tdd-red-evidence`) |
| GREEN | same file + `platform-tenants.test.ts` | 45/45 |
| REFACTOR | — | not needed (no separate commit) |

## Files Created/Modified

- `packages/contracts/src/branding.ts` — upload/colour contracts appended (02-01/02-03 exports intact; `index.ts` untouched).
- `packages/core/server/branding/upload.ts` — `BRANDING_BUCKET`, `buildUploadId`, `parseUploadId`, `brandingObjectKey`, `iconObjectKeys`, `assertTenantKey`, `objectKeyFromPublicUrl`, `svgLooksUnsafe`.
- `packages/core/server/branding/icons.ts` — `deriveIconSet`, `inspectBrandingImage`, `readPixel`, `BrandingImageError`, `ICON_SIZES`, `MASKABLE_SAFE_ZONE`, `MAX_INPUT_PIXELS` (every `sharp()` carries `limitInputPixels`; SVGs rasterised at a density that avoids upscaling).
- `packages/core/server/branding/index.ts` — queue name/constants/payload schema, `registerJobQueues([BRANDING_DERIVE_ICONS_QUEUE])`, re-exports.
- `packages/core/server/branding/derive-icons-job.ts` — `deriveIconsJob` (never throws, bounded re-arm via `requeueIconDerivation`).
- `packages/core/server/platform/branding.ts` — the admin-lane service (only importer of `supabaseAdmin`/`withAdminTx`).
- `packages/core/server/platform/tenants.ts` — `updateTenant` routes colours through `applyBrandColors`.
- `apps/api/src/routes/platform/branding.ts` — four routes; `index.ts` chains `.route('/', brandingRoutes)`; `worker.ts` lists `deriveIconsJob`.
- `supabase/config.toml` — `[storage.buckets.branding]` (storage block only; auth blocks byte-identical).
- `supabase/migrations/20260917021738_branding_bucket.sql` (+ journal/snapshot) — hosted bucket upsert.
- `supabase/tests/060-branding-bucket.sql` — 5 pgTAP assertions.
- `scripts/seed.ts` — icon derivation at `SEED_ICON_VERSION = 1`; icon fields moved out of the upsert `set`.
- `apps/api/tests/integration/platform-branding.test.ts` (25 cases), `packages/core/tests/icons.test.ts` (15 cases).

## Decisions Made

- PUT vs PATCH colours: kept both doors, unified persistence (`applyBrandColors`), gate only on PUT (02-03's PATCH contract has no confirmation field; 02-05's test pins the ungated rebrand). 02-14 must use PUT.
- `removeIconOverride` short-circuits when there is no override (no write, no job) — the plan offered both options; chose the cheaper one.
- Optimistic write uses `coalesce((branding->>'iconVersion')::int, 0)` so a `{}` branding row (no `iconVersion` key) still matches version 0 instead of always reading as superseded.
- Storage object cleanup in tests uses the Storage API with a service-key client built in the test file (mirrors `setup.ts`'s `authAdmin()`): the local Storage schema raises "Direct deletion from storage tables is not allowed".
- Migration guarded with `to_regclass('storage.buckets')`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pnpm db:generate -- --custom --name=…` rejects the `--` separator**
- **Found during:** Task 1 (custom migration)
- **Issue:** `pnpm db:generate` wraps `pnpm --filter @tria/api exec drizzle-kit generate`; the extra `--` reaches drizzle-kit and fails with "Unrecognized options for command 'generate': --".
- **Fix:** Ran `pnpm --filter @tria/api exec drizzle-kit generate --custom --name=branding_bucket` directly (same tool, same config, same journal).
- **Files modified:** none beyond the generated migration + journal + snapshot.
- **Verification:** `pnpm db:generate` afterwards prints "No schema changes"; `git status --porcelain -- supabase/migrations` empty after commit.
- **Committed in:** `87cde0f`

**2. [Rule 1 - Bug] Test cleanup used `delete from storage.objects` — forbidden by the Storage schema**
- **Found during:** Task 1 (integration suite)
- **Issue:** The plan's `afterAll` deleted `storage.objects` rows via `adminSql`; the Storage container installs a trigger refusing direct deletes.
- **Fix:** Cleanup lists the tenant's object names via SQL and removes them through `storage.from('branding').remove(names)` with a service-key client.
- **Files modified:** `apps/api/tests/integration/platform-branding.test.ts`
- **Verification:** suite green; `objectNames()` assertions still read `storage.objects` directly (selects are allowed).
- **Committed in:** `87cde0f`

**3. [Rule 3 - Blocking] `pnpm test:integration -- platform-branding` does not scope the run**
- **Found during:** Task 1 verification
- **Issue:** The `--` filter is swallowed and all 16 files run (fine for the exit gate, slow for the loop).
- **Fix:** Scoped runs use `pnpm exec vitest run tests/integration/<file>.test.ts` inside `apps/api` (the `tests/integration` path keeps the global setup attached). Exit gates still ran the whole suite (176/176).
- **Committed in:** n/a (command usage only)

---

**Total deviations:** 3 auto-fixed (1 × Rule 1, 2 × Rule 3)
**Impact on plan:** No scope change; every deviation is tooling/harness. The declared `files_modified` list was respected — no file outside it was touched.

## Issues Encountered

- `sharp` namespace types (`sharp.Metadata`) are not reachable through the default import under the ESM/NodeNext config; switched to named type imports (`Metadata`, `Sharp`, `SharpOptions`).
- The `tsx watch` dev server on `:8787` (pid 30105) stayed up and was reused by the integration global setup (no collision, no restart needed); it hot-reloaded the new routes, which is how the OpenAPI probe passed.

## Blocking gate output (Task 3)

```
pnpm db:generate                → "No schema changes, nothing to migrate"; git status --porcelain -- supabase/migrations: (empty)
pnpm db:reset                   → Applying migration 20260917021738_branding_bucket.sql… Updating Storage bucket: branding … Finished
pnpm db:seed                    → seed: tenant tria-demo icons derived (v1) → …/9feac769-…/branding/icons/1/icon-512.png
                                  seed: tenant tria-lab  icons derived (v1) → …/1653aeae-…/branding/icons/1/icon-512.png
pnpm db:seed (again)            → 2 × "icons derived (v1)"; storage.objects under %/branding/icons/1/% = 10 (idempotent)
pnpm supabase test db           → 7 files, 98 tests, PASS (060-branding-bucket.sql ok)
by-host tria-demo.localhost     → iconUrls.i512 …/icons/1/icon-512.png, faviconUrl …/icons/1/favicon.ico, maskable …/maskable-512.png (jq -e true)
by-host tria-lab.localhost      → same shape, DIFFERENT tenant prefix (jq -e true)
curl -sI <maskable512>          → Content-Type: image/png; cache-control: max-age=31536000
psql pgboss.queue               → kernel.branding-derive-icons | short
psql storage.buckets            → branding | t | 2097152
```

Exit gates: `pnpm lint` 7/7, `pnpm typecheck` 8/8, `pnpm build` green, core unit 111/111 (96 + 15), integration 176/176 (151 + 25), pgTAP 98/98 (93 + 5).

## Human verification notes (end-of-phase)

1. Open `http://tria-demo.localhost:3000/login` (and `tria-lab`): the tab favicon should be the tenant's derived `favicon.ico` (purple "TRIA Demo" wordmark vs. teal "TRIA Lab"), not TRIA's neutral icon.
2. Fetch `/m/tria-demo/manifest.webmanifest`: `icons[].src` must be the three `/icons/1/` URLs the by-host answer carries (`icon-192.png`, `icon-512.png`, `maskable-512.png` with `purpose: maskable`); `tria-lab`'s manifest must list a different tenant prefix.
3. Install the PWA on a phone: the home-screen icon is the wordmark centred on the tenant's primary colour (maskable), and the splash uses the same colour.
4. In the panel (once 02-14 lands): upload a PNG logo → "Gerando ícones…" until the worker (`ROLE=worker pnpm --filter @tria/api dev`) runs → icons refresh; save `#ffff00 / #ffffaa` → the three contrast pills warn and "Salvar mesmo assim" is required.

## User Setup Required

None — no external service configuration required. Hosted projects get the bucket from the migration via `supabase db push`; the worker must run (`ROLE=worker`) for icons to be derived at runtime.

## Next Phase Readiness

- **02-14 (Marca tab)**: build on `POST …/branding/uploads` → browser `PUT signedUrl` (`content-type` + `x-upsert: false`, no auth header) → `POST …/complete`; `PUT …/branding/colors` with the `confirmLowContrast` re-submit; `DELETE …/branding/icon`; show "Gerando ícones…" while `iconsUpToDate(tenant.branding) === false` and re-fetch the detail. Map `details.upload` to pt-BR copy. Never use PATCH `colors` from the panel.
- **02-16 (smoke)**: after `pnpm db:seed` both seed hosts answer distinct `iconUrls`/`faviconUrl` under `/icons/1/`; `docs/DEPLOY.md` should note that `[storage.buckets.*]` in `config.toml` is local-only and the migration is the hosted source of truth.
- **Phase 3 (media)**: reuse the start → PUT → complete shape with a private bucket and TUS above 6 MB.
- No blockers. `apps/api` gained no dependency (lockfile untouched).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 10 created files exist on disk and all 4 task commits (87cde0f, 6759c13, ac81829, ab195ea) are in `git log`.
