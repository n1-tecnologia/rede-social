---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 31
subsystem: store-listing
tags: [native-app, store-listing, reviewer-account, review-notes, age-rating, app-review, play-console, sealed-credentials, D-607, D-604, D-617, tracer]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-09 App tab routes, readAppTab, sealed credential custody (CredentialStore, readAppCredential) and the platform lane"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-05 tenant_apps.reviewer_email / reviewer_user_id and the reviewer_password credential kind"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-29 the release command, the App Store Connect and Play clients and the loopback fake stores"
provides:
  - "createReviewer / rotateReviewer in packages/core/server/apps/reviewer.ts: one confirmed plain member per tenant with a sealed rotatable password"
  - "POST /v1/platform/tenants/{id}/app/reviewer and .../reviewer/rotate"
  - "packages/core/server/apps/listing.ts: buildStoreDescription, buildReviewNotes, buildKeywords, buildStoreTitle, buildShortDescription, AGE_RATING_ANSWERS, PLAY_QUESTIONNAIRE_ANSWERS, cutToLimit, STORE_LIMITS"
  - "App tab listing.description and listing.ageRating now filled (the 13-09 stub is closed)"
  - "scripts/app-release/listing.ts pushListing, wired into publish (--skip-listing, --contact-email/--contact-name/--contact-phone)"
  - "Listing endpoints on both store clients and both fake stores; closed reasons privacy_url_missing, reviewer_missing, contact_missing, tenant_name_empty"
affects: [13-22 listing card, 13-30 protected workflow, 13-32 first real release]

plan_head_before: 0cdf08fe8e8f9accb5ae121d284552df4f3a9722
actuals:
  tokens: 36700
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "reviewer account over three seams (ReviewerStore, ReviewerAuth, ReviewerMembers): rules run in unit tests on in-memory stand-ins, the real stack in the integration test"
    - "per-tenant advisory lock inside one platform transaction that also holds the tenant_apps row, so two concurrent creations queue and the loser returns the winner's address"
    - "pure text builders returning { text, cut }, code points for every field and UTF-8 bytes for the App Store keywords, cut at a word boundary"
    - "Play changes staged per edit in the fake and applied only on commit, so a failed listing push leaves nothing half-done"

key-files:
  created:
    - packages/core/server/apps/reviewer.ts
    - packages/core/server/apps/listing.ts
    - packages/core/tests/apps-reviewer.test.ts
    - packages/core/tests/apps-listing.test.ts
    - apps/api/tests/integration/platform-reviewer.test.ts
    - scripts/app-release/listing.ts
    - scripts/app-release/listing.test.ts
  modified:
    - packages/core/server/apps/index.ts
    - packages/core/server/apps/credentials.ts
    - packages/core/server/apps/tenant-app.ts
    - packages/contracts/src/native.ts
    - packages/core/tests/apps-tab.test.ts
    - apps/api/src/routes/platform/apps.ts
    - apps/api/tests/admin-lane-inventory/platform.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/integration/app-release.test.ts
    - scripts/app-release/fake-stores.ts
    - scripts/app-release/store-apple.ts
    - scripts/app-release/store-google.ts
    - scripts/app-release/index.ts
    - scripts/app-release/publish.ts
    - scripts/app-release/report.ts
    - scripts/app-release/config.ts
    - scripts/app-release/sources.ts

key-decisions:
  - "no_primary_host and reviewer_missing travel as 409 CONFLICT with details.reason, not as new error codes: the closed vocabulary of the contracts' ErrorCode list stays untouched, and the closed reason is machine-readable for the plan 22 card."
  - "The reviewer membership writes no consent row: the account is not a person accepting the community rules, and nothing reads a consent as a gate (only written by sign-up, join and accept-invite)."
  - "readAppCredential and the CredentialStore take every credential row kind (AppCredentialRowKind), so the release script unseals reviewer_password through the one existing door; the route layer still never calls it."
  - "The store contact is an operator input (--contact-email, --contact-name, --contact-phone), refused with contact_missing before any call, because no tenant support contact is stored anywhere in the control plane."
  - "The Review Notes interpolate the tenant name cut to 100 code points; the description and the store text use the whole cleaned name and are cut by the store limit."
  - "The age rating shown in the App tab is the template value 13+ (minimum age 13, A-13-12); the sketch's 12+ is only a marker (README finding F-2)."

patterns-established:
  - "A store-side client method name never contains review or submit (plan 29's guard test): the App Review detail is set through upsertDemoAccount."

requirements-completed: []

coverage:
  - id: D1
    description: "Tracer: a super_admin creates the reviewer through the real route; it is a confirmed plain member named 'Revisor do app' on the tenant host, the password is sealed under <rowId>:reviewer_password and appears in no response, header, log line or plain column, and it signs in"
    requirement: NATIVE-29
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-reviewer.test.ts#tracer: a reviewer member is created with a sealed password, idempotently, and rotated"
        status: pass
    human_judgment: false
  - id: D2
    description: "Creating twice yields one user and one sealed row; rotating twice keeps the same user and sealed row id with a new value each time; the old password stops signing in"
    requirement: NATIVE-29
    verification:
      - kind: unit
        ref: "packages/core/tests/apps-reviewer.test.ts#rotateReviewer"
        status: pass
      - kind: integration
        ref: "platform-reviewer.test.ts#rotating replaces the password in Auth and in the sealed row"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two simultaneous creations leave exactly one Auth user, one membership and one sealed row; the loser returns the winner's address"
    requirement: NATIVE-29
    verification:
      - kind: integration
        ref: "platform-reviewer.test.ts#concurrency"
        status: pass
    human_judgment: false
  - id: D4
    description: "Refusals: tenant admin, member and anonymous on both routes; no_primary_host; reviewer_missing on rotate; unknown tenant 404; the two gate warnings (profile form, payment gate) reported, nothing granted"
    requirement: NATIVE-29
    verification:
      - kind: integration
        ref: "platform-reviewer.test.ts#the reviewer routes: refusals and closed reasons / the two gates are reported, not bypassed"
        status: pass
    human_judgment: false
  - id: D5
    description: "Listing text: description from a fixed module table with no word about buying, English Review Notes with the five statements, frozen age-rating and Play answers, every field inside its store limit (200 generated names), UTF-8 byte cut for keywords"
    requirement: NATIVE-29
    verification:
      - kind: unit
        ref: "packages/core/tests/apps-listing.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Listing push through the plan 29 clients and fakes: exactly the specified fields, idempotent, early refusals, encoding round trip, demo password masked first and never printed, no review-submission, price, territory or track call"
    requirement: NATIVE-29
    verification:
      - kind: unit
        ref: "scripts/app-release/listing.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/app-release.test.ts#publish pushes the store listing before the upload and refuses early"
        status: pass
    human_judgment: false
  - id: D7
    description: "The store listing endpoints against the real Apple and Google hosts"
    verification: []
    human_judgment: true
    rationale: "Paths and attributes were checked against Apple's published OpenAPI document (4.6) and Google's API discovery document, and the fakes enforce store-side limits, but only the first real run in plan 32 proves the push against the live hosts (an app version in PREPARE_FOR_SUBMISSION is assumed to exist after the tenant creates the app record)."

duration: 33min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 31: The store listing and the reviewer account Summary

**A `super_admin` creates one least-privilege reviewer member per tenant (confirmed address `app-review+<8 hex>@<primary host>`, random 24-character password sealed as `reviewer_password`, idempotent under a per-tenant lock, rotatable), the pt-BR store description, English Review Notes, age-rating and Play answers are built as pure data within every store limit, and `publish` pushes them to App Store Connect and Google Play through the plan 29 clients, refusing with closed reasons before any store call and never reaching a review-submission, price or territory endpoint.**

## Performance

- **Duration:** about 33 min (start not clock-stamped; reconstructed from the first and last test runs)
- **Completed:** 2026-11-05
- **Tasks:** 3 (one tracer, one TDD, one gate)
- **Files:** 24 (7 created, 17 modified)

## Accomplishments

- Tracer: `POST .../app/reviewer` creates the Auth user (confirmed, random password) in the tenant's own project, the `member` membership named "Revisor do app", seals the password under `<rowId>:reviewer_password`, records the address and user id on `tenant_apps` and answers `{ ok: true, warnings }`. The read shows `reviewerEmail` and `reviewerHeld: true`, never the password. A second call creates nothing; `.../reviewer/rotate` replaces the password in Auth and in the sealed row (same row id, same user) and puts the old password back if sealing fails.
- Concurrency and compensation: the lock is `pg_advisory_xact_lock` inside the platform transaction that holds the `tenant_apps` row, so two creations queue; a failure after the Auth user exists removes the user again.
- Gate warnings (A-13-09): `profile_form_required` and `access_grant_required` are read in SQL (`app.profile_form_missing`, `app.access_gate_on` and `app.access_effective`) and reported; the reviewer is granted nothing and answers nothing.
- Listing text: `buildStoreDescription` (UI-SPEC standard text plus one sentence per enabled module from a fixed table; no sentence exists for `store`, `payments` or `social`), `buildReviewNotes` (the five statements, the tenant name escaped and interpolated in one pass), keywords counted in UTF-8 bytes, title 30, short description 80, description 4000, all through `cutToLimit` (word boundary, never a split code point, `cut: true`).
- The 13-09 stub is closed: the App tab now reads `listing.description` and `listing.ageRating` (`13+`) from the builders; the WINDOWS ledger row 145 is marked fixed.
- `pushListing`: App Store version localization (description, keywords, support URL), privacy-policy URL on the app info localization, age-rating declaration answers, App Review detail with the demo account unsealed from `reviewer_password`; one Play edit with the listing, the details and the high-resolution icon, validated and committed (deleted on failure). `publish` runs it before the upload unless `--skip-listing`.

## Task Commits

1. **Task 1 tracer:** the reviewer account, routes, inventories and tests - `2cd609c7` (feat)
2. **Task 2 RED:** failing listing tests over inert stubs - `99eead3d` (test)
3. **Task 2 GREEN:** builders, answers, cuts, App tab fields - `afe22937` (feat)
4. **Task 3:** listing push, client and fake endpoints, publish wiring - `2847f83f` (feat)

**Plan metadata:** the docs commit that carries this file.

## Store endpoint paths used for the listing (the record the plan asks for)

Fetched now: Apple's published OpenAPI document (App Store Connect API 4.6, `developer.apple.com/sample-code/app-store-connect/...openapi-specification.zip`, read into the scratchpad) and Google's API discovery document (`androidpublisher.googleapis.com/$discovery/rest?version=v3`). Both are public documentation downloads; no store endpoint was called and no credential was sent.

- App Store Connect: `GET /v1/apps/{id}/appStoreVersions` (`filter[platform]=IOS`, `filter[appStoreState]=PREPARE_FOR_SUBMISSION`), `GET /v1/apps/{id}/appInfos`, `GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations` (`filter[locale]`), `POST /v1/appStoreVersionLocalizations` (locale, description, keywords, supportUrl), `PATCH /v1/appStoreVersionLocalizations/{id}`, `GET /v1/appInfos/{id}/appInfoLocalizations`, `POST /v1/appInfoLocalizations` (locale, name, privacyPolicyUrl), `PATCH /v1/appInfoLocalizations/{id}`, `GET /v1/appInfos/{id}/ageRatingDeclaration`, `PATCH /v1/ageRatingDeclarations/{id}` (userGeneratedContent, messagingAndChat, unrestrictedWebAccess, advertising, parentalControls, ageAssurance, ageRatingOverrideV2), `GET /v1/appStoreVersions/{id}/appStoreReviewDetail`, `POST /v1/appStoreReviewDetails` and `PATCH /v1/appStoreReviewDetails/{id}` (contactFirstName, contactLastName, contactPhone, contactEmail, demoAccountName, demoAccountPassword, demoAccountRequired, notes).
- Google Play: `PUT /androidpublisher/v3/applications/{package}/edits/{id}/listings/{language}`, `PUT .../edits/{id}/details`, `DELETE .../edits/{id}/listings/{language}/icon` (deleteall), `POST /upload/androidpublisher/v3/applications/{package}/edits/{id}/listings/{language}/icon?uploadType=media`, then the existing `:validate` and `:commit`.

## Decisions Made

See `key-decisions`. Two with downstream effect: plan 22's card reads `listing.ageRating` (`13+`) from the tab rather than the sketch's `12+` marker, and plan 30's workflow must either pass `--contact-email`, `--contact-name` and `--contact-phone` to `publish` or pass `--skip-listing`, because there is no stored tenant support contact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The unique constraint on the stored reviewer address was not added**
- **Found during:** Task 1
- **Issue:** the truth asks for "an advisory lock plus a unique constraint on the stored address". A unique constraint on `tenant_apps.reviewer_email` is a migration, and the plan lists none (its files and the executor notes: no migration here). `tenant_apps` is already one row per tenant (primary key), the address carries a random 8-hex part and the tenant's own host, and the advisory lock plus the locked row serialise the creation, so the constraint would add nothing the lock does not already give.
- **Fix:** none beyond the lock; proved by the concurrency tests (unit with a queueing store, integration against the database): one Auth user, one membership, one sealed row.
- **Committed in:** `2cd609c7`

**2. [Rule 3 - Blocking] Files outside the plan's list had to change**
- **Found during:** Tasks 1 and 3
- **Issue:** the listing endpoints could only live next to the private `call` helper of each store client, so `store-apple.ts` and `store-google.ts` changed (typed methods, no generic request method, so the "no review-submission, price or territory call" guarantee stays structural); `report.ts` carries the new closed reasons; `config.ts` and `sources.ts` carry the enabled modules into the tenant record; `packages/contracts/src/native.ts` carries the reviewer answer schema; `credentials.ts` and `tenant-app.ts` widened/filled for the unseal door and the App tab fields; `isolation-inventory.ts` classifies the two routes (13-09 found that this, not the admin-lane file, is the route inventory; the admin-lane file takes the two `withAdminTx` sites of `reviewer.ts`).
- **Fix:** minimal, additive changes; every one is covered by the tests above.
- **Committed in:** `2cd609c7`, `afe22937`, `2847f83f`

**3. [Rule 1 - Bug] The listing could not run in a dry run before the app record existed**
- **Found during:** Task 3 (integration test of publish)
- **Issue:** the dry run's fake App Store knows an app record only after the build upload that `beforePublish` stands in for, which `publish` ran after the listing.
- **Fix:** `beforePublish` now runs right after the credentials are unsealed, before the listing (a real run has no such hook; the workflow uploads the build before `publish`).
- **Files modified:** `scripts/app-release/publish.ts`
- **Committed in:** `2847f83f`

**4. [Rule 3 - Blocking] Existing publish tests only upload a build**
- **Found during:** Task 3
- **Issue:** with the listing on by default, the five existing publish cases of plan 29 (`app-release.test.ts`) would need a privacy URL, a reviewer and a contact they do not care about.
- **Fix:** they pass `--skip-listing` (`skipListing: true` in the option fixture); a new describe covers the listing inside `publish`.
- **Committed in:** `2847f83f`

**5. [Rule 2 - Missing critical] A contact the stores can show**
- **Found during:** Task 3
- **Issue:** the plan says the contact comes "from the tenant's support data", but nothing stores a support contact (e-mail, name, phone) in the control plane, and Apple requires all three while Play publishes the e-mail.
- **Fix:** the contact is an operator input (`--contact-email`, `--contact-name`, `--contact-phone`); a missing one is the closed reason `contact_missing` before any store call (a Play-only push needs the e-mail only). Recorded for plan 30 and plan 32.
- **Committed in:** `2847f83f`

**6. [Plan wording] `pnpm db:reset && pnpm db:seed` skipped on purpose**
- The reset is not allowed for this plan (Igor is testing front-end work against the local database and a reset needs his explicit word), so exactly those two commands of Task 1's verify line were skipped and every other command ran against the existing local database. **A reset and seed are owed to Igor.** No migration was added, so pgTAP was not run; the whole-suite `supabase test db` was not run (known single failure `154-moderation-log` test 48 is orphan-row residue, "154 residue only", not this phase's code).

---

**Total deviations:** 5 auto-fixed (1 Rule 1, 1 Rule 2, 3 Rule 3) plus the wording note above.
**Impact on plan:** none on the truths; deviation 1 replaces a redundant constraint with the lock the plan already requires, deviation 5 adds one refusal and three flags.

## TDD Gate Compliance

Task 2 is the `tdd="true"` task. RED commit `99eead3d` precedes GREEN commit `afe22937`; no refactor commit. The tracer (Task 1) and the gate task (Task 3) are not TDD.

- RED evidence from real Vitest output: `pnpm --filter @rede-social/core exec vitest run tests/apps-listing.test.ts` exited 1 with 18 tests, 4 passed and 14 failed on assertions, among them the target test `buildStoreDescription ... with events, communities and courses on it adds exactly those three sentences, in the fixed table order` (the stub returned an empty string). The JSON report was normalised to TAP by a throwaway script kept outside the repository (scratchpad, real names and counts) and `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK / target_test_failed`.
- The RED commit carries `listing.ts` as inert stubs so the tests fail on assertions and not on a missing module; the four tests that passed at RED pass vacuously over empty strings (two "adds nothing" cases and the vacuous property case) and become real at GREEN.
- GREEN: the same file passes 18 of 18.

## Verification

- `pnpm --filter @rede-social/core exec vitest run tests/apps-reviewer.test.ts tests/apps-listing.test.ts tests/apps-tab.test.ts tests/apps-credentials.test.ts`: 72 passed; whole core suite 103 files / 1524 tests passed; contracts 18 files / 451 passed.
- `apps/api`: unit 11 files / 131 passed (admin-lane inventory and route inventory included); integration `platform-reviewer` 10 passed, `platform-apps` and `app-release` 34 passed (44 in one run with the three files).
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release`: 5 files, 71 passed.
- `TURBO_CACHE=local:r pnpm lint` 20 tasks successful; `pnpm boundaries` no issues in 2253 files; `pnpm guard:lanes` OK; `pnpm guard:workflows` and both self-tests ok; `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core --filter=@rede-social/api --filter=@rede-social/contracts` 3 successful; `tsc --noEmit` over `scripts/app-release/*.ts` with the scratchpad config exit 0.
- Acceptance greps: `role` in `reviewer.ts` only names `member` (no `admin_tenant` or `support_tenant`); `grep -c reviewer apps/api/tests/admin-lane-inventory/platform.ts` = 4; `grep -c "comprar\\|preço" packages/core/server/apps/listing.ts` = 0; `grep -rn "submit\\|reviewSubmissions\\|price\\|availab" scripts/app-release/listing.ts | grep -v "^.*://" | wc -l` = 0; the sentinel password is asserted absent from every response, header, log line, plain column, the command's output and the fakes' request log.
- Local database after the runs: 0 leftover `pr-`, `ar-` or `pa-` tenants, 0 `app-review+` users, 0 reviewer credential rows. Disk 8.2 GiB free before and after; no `.next` or turbo cache created. Nothing under `.planning/sketches/` touched.

## Issues Encountered

- The Write tool turned the escape sequence for the Unicode line separator in a test string into the raw character, which broke a regex literal; the control-character checks are now numeric (`hasForbiddenControl`) and the hostile name is built with `String.fromCharCode`.
- `GET /v1/openapi.json` returning 500 is pre-existing and was not touched.

## Known Stubs

None. The 13-09 stub (`listing.description` / `listing.ageRating` read `null`) is closed and its WINDOWS ledger row (145) is marked fixed.

## Threat Flags

None beyond the plan's register. T-13-55 (reviewer account as staff, password leaking or lingering) is mitigated and tested: `member` role only (asserted in the database, no platform-admin row), sealed rotatable password, address on the tenant host that cannot collide with a member, sentinel scans over responses, headers, logs, plain columns, stdout and the fakes' request log. T-13-56 (a listing advertising a purchase or being sent for review) is mitigated and tested: a description table with no purchase sentence (a test over every module), Review Notes stating that purchases happen outside the app, and no review-submission, price, territory or track request in any push (path scan of the fakes' log, plus the client method guard of plan 29).

## User Setup Required

None for this plan. For Igor: a `pnpm db:reset` and `pnpm db:seed` is owed (skipped on purpose here). Before a real release the operator creates the reviewer from the App tab (plan 22), gives the privacy URL, and passes the store contact to `publish` (or `--skip-listing`).

## Next Phase Readiness

- Plan 22 (the listing card) calls `POST .../app/reviewer` and `.../reviewer/rotate`, parses `reviewerCreatedAnswerSchema` (`warnings` are the closed reasons `profile_form_required` and `access_grant_required`), and shows `listing.description` and `listing.ageRating` (`13+`) from the tab; `no_primary_host` and `reviewer_missing` arrive as 409 `CONFLICT` with `details.reason`.
- Plan 30 (the workflow) must pass the three `--contact-*` flags to `publish` (or `--skip-listing` for a build-only run) and keep `--out` pointing at the folder where `prepare` wrote `play-icon.png`, which the Play listing uploads.
- Plan 32 confirms at its decision checkpoint: minimum age 13 and "Unrestricted Web Access = No" (A-13-12), the contact data, that the tenant's app record has an App Store version in `PREPARE_FOR_SUBMISSION` (otherwise the iOS listing reports `skipped no_editable_version`), and that the pt-BR locale matches the app record's primary language.
- Requirements: NATIVE-29 stays Pending: plan 22 also declares it and has no SUMMARY yet (`requirements.ready-ids` answered 0 of 1).
- Nothing was pushed or deployed; no real store or hosted project was called.

## Self-Check: PASSED

- Files exist: the seven created files (checked with `[ -f ]`).
- Commits found: `2cd609c7`, `99eead3d`, `afe22937`, `2847f83f`; `git rev-list --count 0cdf08fe..HEAD` = 4 before this SUMMARY.
