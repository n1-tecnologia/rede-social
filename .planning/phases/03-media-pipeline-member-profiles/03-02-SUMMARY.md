---
phase: 03-media-pipeline-member-profiles
plan: 02
subsystem: api
tags: [profiles, drizzle, rls, pgtap, postgres, unaccent, pg_trgm, zod, hono, media]

# Dependency graph
requires:
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: tenant/admin transaction lanes, `membershipOfRecord`, the `app.*` RLS helpers, the frozen `bootstrapSchema`
  - phase: 02-tenant-shell-branding-platform-panel
    provides: the `me.ts` route group, the error envelope + validation hook, the seed's fixture-writer conventions
  - phase: 03-media-pipeline-member-profiles
    provides: "03-01's media broker — `deleteAsset`, `mediaVariantUrl`, `PURPOSE_WIDTHS.avatar`, the private `media` bucket"
provides:
  - "`member_profiles` — one row per MEMBERSHIP (not per user), created eagerly by an `after insert on public.memberships` trigger and backfilled by the same migration"
  - "`GET /v1/me/profile` — the caller's own profile plus `email` and the server-side first-access nudge state"
  - "`PATCH /v1/me/profile { displayName?, bio?, avatarAssetId? }` — free rename (D-46), 150-char plain-text bio, photo set/replace/remove with replace-on-write"
  - "`POST /v1/me/profile/dismiss-nudge` — idempotent server-side dismissal (D-02/R-13)"
  - "`GET /v1/me/bootstrap` now serves the REAL `membership.profile`, with `bootstrapSchema` byte-identical (Pitfall 9)"
  - "`@rede-social/contracts/profiles` — caps in UTF-16 code units, `normaliseBio`, `PROFILE_ISSUES`, `ownProfileSchema`, the D-45 `.strict()` `memberProfileSchema`, `avatarSrcSet`"
  - "the 03-03 search infrastructure: `unaccent` + `pg_trgm`, `app.imm_unaccent` (IMMUTABLE), the GIN-trigram index and the keyset order index"
  - "a seeded community: nine active members in rede-demo, four in rede-lab, accented pt-BR names, two real avatars, two members with no bio"
affects: [03-03, 03-04, 03-05, 03-08, phase-04-feed, phase-07-chat, phase-08-member-management]

actuals:
  tokens: 33689
  tasks: 3
  commits: 3
plan_head_before: c988b81ed63fab297443d393152b8bde8108b8c6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural invariant by trigger: `app.ensure_member_profile` (SECURITY DEFINER, `search_path = ''`) makes 'every membership has a profile' true for call sites nobody has written yet"
    - "Split migration ownership: drizzle declares the table, its plain indexes and its policies; a hand-written custom migration owns everything drizzle cannot model (extensions, the IMMUTABLE wrapper, expression indexes, the trigger, the backfill) — so `pnpm db:generate` stays a no-op"
    - "Cap measured in UTF-16 code units via an explicit refinement next to `.max()`, because zod 4's `.max()` counts CODE POINTS — the client counter and the server cannot disagree"
    - "Normalise-before-validate inside a `z.preprocess`, avoiding the Zod 4 ordering trap 02-03 recorded"
    - "Route-level validation hook that adds a closed per-field refusal code on top of the shared `details.issues[]`"
    - "Asymmetric policy pair on one table: TENANT-WIDE select (other members are readable) + SELF-scoped update (only your own row is writable), with no insert and no delete policy"
    - "A kernel area confined to the tenant lane by omission from the Biome allow-list, grep-pinned"

key-files:
  created:
    - packages/contracts/src/profiles.ts
    - packages/core/db/schema/member-profiles.ts
    - packages/core/server/profiles/service.ts
    - packages/core/server/profiles/index.ts
    - packages/core/tests/profiles.test.ts
    - apps/api/tests/integration/profile.test.ts
    - supabase/migrations/20260921190226_member_profiles.sql
    - supabase/migrations/20260921190227_member_profiles_search.sql
    - supabase/tests/080-member-profiles.sql
  modified:
    - apps/api/src/routes/me.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - packages/contracts/package.json
    - packages/core/db/schema/index.ts
    - scripts/seed.ts
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/020-tenant-isolation.sql
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "zod 4.6.2's `z.string().max(n)` counts Unicode CODE POINTS, not UTF-16 code units — the plan assumed otherwise, so both schemas carry an explicit `withinCodeUnits` refinement that actually pins the unit the browser counter uses"
  - "`member_profiles.user_id` cascades on delete, like every other `user_id` FK in the schema: without it, deleting an identity (LGPD, and every test fixture teardown) is blocked by the profile row"
  - "`@rede-social/contracts/profiles` is a package SUBPATH export, not a root-barrel re-export — the frozen `src/index.ts` stays byte-identical (the `./media` precedent)"
  - "A composite `uploadAvatar` fixture lives in `tests/integration/setup.ts` behind DYNAMIC imports, so no other integration file pays for sharp/pg-boss just to reach `api`/`adminSql`"
  - "`020-tenant-isolation.sql` creates its second tenant-A member mid-file, after the membership assertions, so the self-update policy gets a neighbour without moving any existing pin"

patterns-established:
  - "Trigger-enforced row-per-parent: the invariant lives in Postgres, so a future insert path cannot forget it, and pgTAP proves the MECHANISM by inserting a new parent inside the test transaction"
  - "Per-field refusal codes (`PROFILE_ISSUES`) alongside the standard Zod issue list, so a form switches exhaustively instead of parsing messages"
  - "The promote invariant asserted, not assumed: 'my profile' and 'a member's profile' are one row, checked against the stored row rather than against a second endpoint"

requirements-completed: [PROF-01, TENANT-04]

coverage:
  - id: D1
    description: "Every membership has exactly one `member_profiles` row, created eagerly by the `member_profiles_from_membership` trigger, with the migration backfilling one row per pre-existing membership"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "supabase/tests/080-member-profiles.sql (assertion 1: zero memberships without a profile; assertion 2: a brand-new membership inserted inside the transaction gets exactly one row seeded from users.name)"
        status: pass
      - kind: other
        ref: "psql -Atc \"select count(*) from public.memberships m left join public.member_profiles p on p.membership_id = m.id where p.id is null\" prints 0 after a cold db:reset && db:seed"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /v1/me/profile answers the caller's own row with `avatarUrl` as the stable `/v1/media/{assetId}/w128` path (never a signed Storage URL) and `needsNudge` as server state"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#1. GET /v1/me/profile answers the row the membership trigger created, with the nudge pending"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#3. a real upload through the 03-01 broker becomes the photo, served through the stable /w128 URL"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /v1/me/bootstrap serves `membership.profile` from `member_profiles` with the contract shape unchanged — exactly `displayName`, `avatarUrl`, `bio`"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#1b. PROF-01 filled `membership.profile` WITHOUT growing it (Pitfall 9)"
        status: pass
      - kind: other
        ref: "git diff --quiet -- packages/contracts/src/bootstrap.ts (exit 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "PATCH /v1/me/profile updates only the caller's own row; a display-name change is free, leaves no history and never touches `users.name`"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#2. PATCH name + bio lands in the bootstrap, and users.name — the identity anchor — is untouched (D-46)"
        status: pass
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (a member CAN rewrite their own row; an update aimed at a NEIGHBOUR's row in the same tenant touches nothing)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Caps and empties: an empty display name answers `details.displayName = 'required'`; a bio that normalises to empty is stored as SQL NULL; normalisation runs before measurement; both caps are counted in UTF-16 code units on the server"
    requirement: PROF-01
    verification:
      - kind: unit
        ref: "packages/core/tests/profiles.test.ts#10. 75 astral-plane emoji are 150 code units and pass; 76 are 152 and fail"
        status: pass
      - kind: unit
        ref: "packages/core/tests/profiles.test.ts#4. a 160-character value whose last 12 characters are spaces is ACCEPTED at 148"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#caps and empties — every refusal carries a code the form can switch on (PROF-01)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Avatar lifecycle: an id is accepted only when it is the caller's own ready/processing `avatar` asset in their own tenant; replacing or removing a photo retires the outgoing asset; every rejection answers the same `invalid`"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#avatar lifecycle — replace-on-write retires the outgoing asset (R-07, T-03-13)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#13. every rejected avatar answers the SAME `invalid` — no existence oracle (T-03-13)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The D-02 first-access nudge is server state: it shows while EITHER the photo or the bio is missing, and a dismissal survives a new session on another device"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#4. POST /v1/me/profile/dismiss-nudge is server state and idempotent (D-02/R-13)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#the first-access nudge is server state (D-02/R-13)"
        status: pass
    human_judgment: false
  - id: D8
    description: "`member_profiles` is invisible across tenants and carries exactly two policies — a tenant-wide select and a self-scoped update, with no insert and no delete policy"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (B's profiles invisible to A's lane; A sees BOTH of its members' profiles)"
        status: pass
      - kind: integration
        ref: "supabase/tests/080-member-profiles.sql (assertion 3: the policy count is exactly 2)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#16. a tenant-B member reads B's own row and can never reach A's"
        status: pass
    human_judgment: false
  - id: D9
    description: "The 03-03 search infrastructure exists on a cold reset: `unaccent`, `pg_trgm`, the IMMUTABLE `app.imm_unaccent`, the GIN-trigram index and the keyset order index"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "supabase/tests/080-member-profiles.sql (assertions 4-7: accent folding both ways, the IMMUTABLE marking, both index names)"
        status: pass
      - kind: other
        ref: "pnpm db:generate produces no file (git status --porcelain -- supabase/migrations empty), then pnpm db:reset applies both migrations from zero"
        status: pass
    human_judgment: false
  - id: D10
    description: "The promote invariant: 'my profile' and 'a member's profile' resolve through ONE row — there is deliberately no second storage path for the caller's own profile"
    requirement: PROF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#17. PROMOTE INVARIANT: \"my profile\" and \"a member's profile\" are ONE row"
        status: pass
    human_judgment: false
  - id: D11
    description: "The seed leaves a real community: nine active members in rede-demo and four in rede-lab with accented pt-BR names, two demo members carrying a real `ready` avatar asset and two carrying no bio"
    requirement: PROF-01
    verification:
      - kind: other
        ref: "psql counts after a cold db:reset && db:seed — 9 active rede-demo members, 2 profiles with avatar_asset_id, 7 with a null bio, 0 memberships without a profile"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#11. a second run exits 0 and leaves tenant_domains unchanged with one primary per tenant (seed idempotency)"
        status: pass
    human_judgment: false

# Metrics
duration: 28 min
completed: 2026-09-21
status: complete
---

# Phase 3 Plan 02: Member Profiles Summary

**A profile that hangs off the membership rather than the user: `member_profiles` created eagerly by a database trigger (so no future call site can forget it), `GET`/`PATCH /v1/me/profile` with a free rename, a 150-code-unit bio and the media broker's first real consumer as the photo — and a bootstrap that serves the real row without the frozen contract shape moving a byte.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-09-21T18:48:59Z
- **Completed:** 2026-09-21T19:17:24Z
- **Tasks:** 3
- **Files modified:** 20 (18 source + 2 generated drizzle snapshots)

## Accomplishments

- **The identity model the whole product depends on is now real and structural.** `member_profiles` is keyed on `membership_id`, which is what `SCHEMA-CONVENTIONS.md` §(b)4 mandates and what V2's multi-tenant membership needs. Rows are created by an `after insert on public.memberships` trigger (`app.ensure_member_profile`, SECURITY DEFINER, `search_path = ''`) and backfilled in the same migration, so the four existing membership-insert sites — and Phase 8's future ones — cannot forget it. pgTAP proves the *mechanism*, not just today's state: it inserts a brand-new membership inside the test transaction and asserts exactly one profile row appeared with the user's name.
- **The first real consumer of 03-01's broker works end to end.** A member uploads a photo through `start` → direct PUT → `complete` → the worker's WebP ladder, then `PATCH /v1/me/profile { avatarAssetId }` makes it their photo. Every payload — the own-profile read and the bootstrap alike — carries the stable `/v1/media/{assetId}/w128` path, never an inline signed URL, and fetching it really 302s to a freshly signed, tenant-checked Storage URL.
- **`bootstrapSchema` did not move.** `me.ts:118`'s hardcoded `{ displayName: user.name, avatarUrl: null, bio: null }` is gone, replaced by `profileForBootstrap(tx, ctx)` computed inside the transaction the handler already opens — one round trip, no extra query. A new assertion pins the key set at exactly `displayName`, `avatarUrl`, `bio`, so the nudge state and `avatarAssetId` stay on `GET /v1/me/profile` where they belong.
- **The caps really are counted in the unit the browser counts in.** The plan assumed `z.string().max()` measures UTF-16 code units; it does not — zod 4.6.2 counts Unicode **code points**, so `z.string().max(4)` happily accepts three emoji (6 code units) that a `maxLength={4}` field would have refused. Both schemas now carry an explicit `withinCodeUnits` refinement next to `.max()`, and the unit suite pins it from both sides: 75 emoji pass at exactly 150 code units, 76 fail, and a 31-emoji display name (62 units, 31 points) is refused.
- **Every profile refusal has a machine code.** A route-level validation hook adds `details.displayName` / `details.bio` / `details.avatarAssetId` from the closed `PROFILE_ISSUES` set on top of the shared `details.issues[]`, so 03-04 maps one code to one pt-BR string. The avatar gate checks four facts (purpose, owner, status, soft-delete) plus the tenant supplied by RLS and answers the *same* `invalid` for all of them — a neighbour's asset, a tenant-B asset, a `post` image and a random uuid are indistinguishable from outside.
- **Profiles is a pure tenant-lane area.** `packages/core/server/profiles/**` is deliberately absent from Biome's privileged-lane allow-list, so every read runs under RLS scoped by `membershipOfRecord(ctx)` and every write under the self-scoped `member_profiles_self_update` policy. The one cross-area call is `deleteAsset` for replace-on-write, wrapped so a cleanup failure logs `profiles.avatar_cleanup_failed` and never fails an edit the member already saw applied.
- **The seeded communities are honest fixtures.** rede-demo has nine active members and rede-lab four, with names that genuinely need accent folding (`João Gonçalves`, `Íris Muñoz`, `Luís Ângelo Sá`, `Sofia D'Ávila`, `Helena Küster`), two demo members carrying a real `ready` avatar written under the broker's own key shape, and two carrying no bio at all — so 03-03's search, 03-04's avatar fallback and 03-05's nudge card all have something real to assert against.

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): contracts, `member_profiles` + trigger + backfill + search infrastructure, the tenant-lane service, three routes, a bootstrap that reads the row** — `112eb46` (feat)
2. **Task 2: the code-unit cap, the closed refusal vocabulary, the avatar lifecycle, the nudge, isolation, the promote invariant, and the pure-layer unit suite** — `4aa2062` (feat)
3. **Task 3 [BLOCKING]: the seeded community, pgTAP `080`, the `member_profiles` isolation cases, the drift gate and a cold reset/seed/test run** — `bd81ce4` (test)

## Files Created/Modified

- `packages/contracts/src/profiles.ts` — the client-safe contract: `MAX_DISPLAY_NAME_LENGTH`/`MAX_BIO_LENGTH`, `PROFILE_ISSUES`, `normaliseBio`, `displayNameSchema`/`bioSchema` (both code-unit capped), `updateProfileBodySchema`, `ownProfileSchema`, the D-45 `.strict()` `memberProfileSchema`, `avatarSrcSet`, `avatarUrlFor`
- `packages/contracts/package.json` — the `./profiles` subpath export (the root barrel stays frozen)
- `packages/core/db/schema/member-profiles.ts` — the table, two policies with the asymmetry documented, tenant-first plain indexes, `user_id` cascading on delete
- `packages/core/db/schema/index.ts` — exports `./member-profiles`
- `supabase/migrations/20260921190226_member_profiles.sql` — the generated schema migration
- `supabase/migrations/20260921190227_member_profiles_search.sql` — the hand-written half: `unaccent` + `pg_trgm`, `app.imm_unaccent` (IMMUTABLE, two-argument dictionary form), the GIN-trigram and keyset indexes, `app.ensure_member_profile` + its trigger, and the idempotent backfill
- `packages/core/server/profiles/service.ts` — `profileRow`, `profileForBootstrap`, `getOwnProfile`, `updateOwnProfile`, `dismissNudge`, the avatar gate, `profiles.updated` / `profiles.avatar_cleanup_failed`
- `packages/core/server/profiles/index.ts` — the barrel (03-03's search module lands here)
- `apps/api/src/routes/me.ts` — `GET`/`PATCH /profile`, `POST /profile/dismiss-nudge`, the per-field refusal hook, and the bootstrap reading the real row
- `scripts/seed.ts` — eleven new members across two tenants, their bios, and two real `ready` avatar assets; idempotent on both halves
- `supabase/tests/080-member-profiles.sql` — seven assertions (one row per membership, the trigger's mechanism, the policy count, accent folding both ways, the IMMUTABLE marking, both index names)
- `supabase/tests/020-tenant-isolation.sql` — four `member_profiles` cases with a second tenant-A member so the self policy has a neighbour
- `supabase/tests/010-rls-coverage.sql` — `member_profiles` listed in the shipped-tables guard
- `packages/core/tests/profiles.test.ts` — 17 pure cases
- `apps/api/tests/integration/profile.test.ts` — 17 cases across the tracer, caps, avatar lifecycle, nudge, isolation and the promote invariant
- `apps/api/tests/integration/setup.ts` — the shared `uploadAvatar` fixture (dynamic imports, so no other suite pays for sharp/pg-boss)
- `apps/api/tests/integration/bootstrap.test.ts` — the exact-keys assertion on `membership.profile`

## Decisions Made

- **The code-unit cap is an explicit refinement, not `.max()`.** Verified against this repo's zod 4.6.2 rather than assumed. `.max()` is kept because it produces the `too_big` issue for ordinary text; `withinCodeUnits` is the stricter of the two and is what actually pins the unit. Both carry the same `'too_long'` message so the route hook maps either to one code.
- **`member_profiles.user_id` cascades on delete.** Every other `user_id` FK in the schema does (`memberships`, `consent_records`), and without it deleting an identity is blocked — which breaks the LGPD deletion story and, immediately, every integration fixture that removes a throwaway user.
- **`@rede-social/contracts/profiles` is a package subpath.** Same reasoning as 03-01's `./media`: `src/index.ts` is a hand-written list of `export *` lines and is frozen, so a subpath is the only way to make the module reachable without touching it.
- **The composite upload fixture lives in `setup.ts` behind dynamic imports.** Exporting it from `media.test.ts` would make vitest re-run that whole suite inside `profile.test.ts`; importing sharp and pg-boss at `setup.ts` module scope would tax every other integration file, including the deliberately database-free health check. Lazy imports inside the function satisfy both.
- **`020`'s second tenant-A member is created mid-file.** A tenant with one member cannot distinguish "my row" from "a row of my tenant", so the self-scoped UPDATE policy needs a neighbour — but adding one in the fixture block would have changed the existing `memberships count = 1` pin. Creating them after the membership assertions leaves every prior assertion exactly as it was.
- **The route hook, not the shared default hook.** The shared `platformDefaultHook` is right for shape violations across the whole API; only the profile form needs a per-field code, so the specialisation is attached to that one route rather than widened globally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `z.string().max()` does not count UTF-16 code units in Zod 4**
- **Found during:** Task 2 (the encoding unit case)
- **Issue:** The plan states as fact that "`.max()` counts UTF-16 code units, i.e. `String.length`" and builds a must-have on it ("a value the counter accepts is never refused by the server"). Verified against this repo's zod 4.6.2: `.max()` counts Unicode **code points**. `z.string().max(4)` accepts three astral-plane emoji (6 code units), and `bioSchema` as the plan specified it accepted 76 emoji — 152 code units — which a `maxLength={150}` textarea would never have produced. The stated guarantee ran the wrong way: the server was *laxer* than the client, so 03-04's counter would have shown "152/150" for a value the server happily stored.
- **Fix:** Added `withinCodeUnits(max)` — an explicit `value.length <= max` refinement — next to `.max()` on both `displayNameSchema` and `bioSchema`, with the same `'too_long'` message so either issue maps to one refusal code. The plan's own acceptance number is now the assertion: 75 emoji pass, 76 fail.
- **Files modified:** packages/contracts/src/profiles.ts, apps/api/src/routes/me.ts, packages/core/tests/profiles.test.ts
- **Verification:** `packages/core/tests/profiles.test.ts#10` and `#11` (the bio and the display name); a 31-emoji name is refused even though zod's own `.max(60)` would accept it
- **Committed in:** `4aa2062`

**2. [Rule 1 - Bug] `member_profiles.user_id` blocked every identity deletion**
- **Found during:** Task 1 (the full integration gate)
- **Issue:** The plan specifies `userId: uuid('user_id').notNull().references(() => users.id)` with no `onDelete`, i.e. `no action`. Deleting an auth user then fails on `member_profiles_user_id_users_id_fk`: the GoTrue delete silently fails, the membership survives, and the follow-up tenant delete fails too. Six integration files' `afterAll` teardowns broke, leaving fixture tenants behind, which in turn failed `bootstrap.test.ts`'s seed-idempotency count. Beyond the tests, this would have blocked the LGPD deletion path the schema is supposed to support.
- **Fix:** `.references(() => users.id, { onDelete: 'cascade' })`, matching every other `user_id` FK in the schema (`memberships`, `consent_records`). The uncommitted generated migration and its snapshot were removed and regenerated so the committed SQL and the drizzle TS agree exactly — no hand-edited SQL, no drift.
- **Files modified:** packages/core/db/schema/member-profiles.ts, supabase/migrations/20260921190226_member_profiles.sql
- **Verification:** the full integration suite went from 7 failed files / 1 failed test to 18 passed files / 220 passed tests on a cold stack; `pnpm db:generate` is a no-op afterwards
- **Committed in:** `112eb46`

**3. [Rule 3 - Blocking] `@rede-social/contracts/profiles` exported as a package subpath**
- **Found during:** Task 1 (contracts)
- **Issue:** The plan says the new file is re-exported by "the existing `export *` barrel — so do NOT edit `packages/contracts/src/index.ts`", but that barrel is a hand-written per-module list; without editing it the module is unreachable. The same contradiction 03-01 hit for `./media`, and the same acceptance criterion (`git diff --quiet -- packages/contracts/src/index.ts`) points at the same resolution.
- **Fix:** Added `"./profiles": "./src/profiles.ts"` to `packages/contracts/package.json` exports. `src/index.ts` is untouched.
- **Files modified:** packages/contracts/package.json
- **Verification:** `git diff --quiet -- packages/contracts/src/index.ts` exits 0; every consumer typechecks and the whole repo builds
- **Committed in:** `112eb46`

**4. [Rule 3 - Blocking] The shared upload fixture is a dynamic import inside `setup.ts`**
- **Found during:** Task 1 (integration tracer)
- **Issue:** The plan offers two homes for the composite avatar-upload helper — "export it from `apps/api/tests/integration/media.test.ts` or lift it into `setup.ts`". The first is unworkable: importing a `.test.ts` from another test file makes vitest collect and re-run that whole suite inside the importer. The second, done naively, makes every integration file (including the deliberately database-free `health-no-db.ts`) import sharp and pg-boss at module scope.
- **Fix:** `uploadAvatar` lives in `setup.ts` as the plan prefers, but loads `variants`, `derive-job` and the app **inside** the function, so `setup.ts`'s module graph is unchanged for every other suite. A `purpose` option was added so the same helper builds the negative `post`-image fixture the avatar gate exists for.
- **Files modified:** apps/api/tests/integration/setup.ts
- **Verification:** all 18 integration files pass; `health.test.ts` and `health-no-db.ts` are unaffected
- **Committed in:** `112eb46` (extended in `4aa2062`)

**5. [Rule 2 - Missing Critical] The per-field refusal codes needed a route-level hook**
- **Found during:** Task 1 (routes)
- **Issue:** The plan requires `400 VALIDATION_FAILED { displayName: 'required' }` and `{ avatarAssetId: 'invalid' }`, but the API's shared `platformDefaultHook` answers every validation failure with `details.issues[{ path, message }]` only. Without a specialisation, "`details.displayName === 'required'`" could never be true for a body-schema failure, and 03-04 would be left parsing messages.
- **Fix:** A `profileValidationHook` passed as `openapi()`'s third argument on the PATCH route. It keeps the standard `issues[]` and adds the closed `PROFILE_ISSUES` code per field. The shared hook is untouched, so no other route's envelope changes.
- **Files modified:** apps/api/src/routes/me.ts
- **Verification:** `profile.test.ts#6`/`#7`/`#8` assert both `details.<field>` and the issue path; every other route's validation envelope is unchanged (233 integration tests green)
- **Committed in:** `112eb46` (codes finalised in `4aa2062`)

**6. [Rule 2 - Missing Critical] `PROFILE_ISSUES` landed in Task 1 rather than Task 2**
- **Found during:** Task 1 (contracts)
- **Issue:** The plan assigns `PROFILE_ISSUES` to Task 2, but Task 1's routes already had to answer `{ avatarAssetId: 'invalid' }` and `{ displayName: 'required' }`, and a refusal vocabulary split across two commits would have meant one commit shipping stringly-typed codes.
- **Fix:** Exported the constant with the contract in Task 1; Task 2 added the test that pins it closed.
- **Files modified:** packages/contracts/src/profiles.ts
- **Verification:** `packages/core/tests/profiles.test.ts#15`
- **Committed in:** `112eb46`

---

**Total deviations:** 6 auto-fixed (2 bugs, 2 blocking, 2 missing-critical).
**Impact on plan:** No scope change. Two are genuine correctness fixes the plan's own must-haves demanded (the cap unit, the FK cascade); two are the plan's instructions reconciled with what the repository actually contains (a hand-written contracts barrel, a shared validation hook); two are mechanical placement choices. No requirement was narrowed.

## Issues Encountered

- **The `user_id` FK failure surfaced as an unrelated-looking test failure.** The first full integration run reported `bootstrap.test.ts` failing on `tenant_domains` count `3 ≠ 2` plus six files with `afterAll` errors. The count assertion was a symptom: the FK blocked fixture teardown, so a `mail-test-*` tenant survived into the next file. Chasing the count would have been the wrong fix; the FK was the cause. Noted because the same shape will recur — a leftover-fixture failure in this suite is usually a broken cascade, not a flaky assertion.
- **`pnpm db:generate -- --name=X` still does not forward the flag** (03-01's finding, re-confirmed). `pnpm --filter @rede-social/api exec drizzle-kit generate --name=X` does. Regenerating after the FK fix also required deleting the stale snapshot and journal entry, or drizzle would have emitted an `ALTER` migration instead of a corrected `CREATE`.
- **`pnpm test:integration -- profile bootstrap` runs the WHOLE suite**, because vitest ORs the filters and `tests/integration` (from the package script) already matches every file. Every gate in this plan therefore ran against all 18 files — stronger than the plan asked for, but worth knowing before reading a "filtered" run's output.

## Known Stubs

None. Every deliverable this plan declares is wired to real data: the profile is a real row, the photo is a real asset served through the real broker, the nudge is a real column, and the search infrastructure the next plan queries exists on a cold reset. `memberProfileSchema` is defined here but consumed by 03-03's `GET /v1/members/{membershipId}` — that is a declared handoff, not a stub: nothing in this plan renders it, and the promote invariant test already pins the values that route must return.

## Threat Flags

None. Every surface this plan introduces is in the plan's `<threat_model>` (T-03-12 … T-03-SC), and each `mitigate` disposition has a test: the self-update policy (pgTAP 020 + the neighbour case), the avatar IDOR gate (four negative cases all answering one code), the SECURITY DEFINER trigger (`set search_path = ''` plus fully-qualified names, pgTAP 080 assertion 2), member content never reaching logs (`profiles.updated` carries field KEYS only), plain-text-only display names and bios (no HTML field anywhere in the contract), and the DoS caps (both enforced in code units, `bio` unindexed).

## User Setup Required

None - no external service configuration required. Both migrations apply through the Supabase CLI on a cold `db:reset` and on a hosted project alike.

## Next Phase Readiness

- **03-03 (directory + other member)** — the table, `app.imm_unaccent` and both search indexes already exist, so the directory is a query rather than a schema change. Order by `app.imm_unaccent(lower(display_name)) asc, member_profiles.id asc` to match `member_profiles_tenant_name_idx`; `memberProfileSchema` is already `.strict()` and is exactly what `GET /v1/members/{membershipId}` must return. Close the promote invariant by asserting that route returns the same values `GET /v1/me/profile` does for the same person — `profile.test.ts#17` is the other half.
- **03-04 (profile screens)** — `GET /v1/me/profile` → `ownProfileSchema`; `PATCH` takes `{ displayName?, bio?, avatarAssetId? }` (at least one key, `.strict()`) and answers `400 VALIDATION_FAILED` with `details.displayName`/`details.bio`/`details.avatarAssetId` from `PROFILE_ISSUES`. Use `MAX_BIO_LENGTH`/`MAX_DISPLAY_NAME_LENGTH` for `maxLength` and the counter — they are UTF-16 code units and the server now measures the same unit. Photo removal is `PATCH { avatarAssetId: null }`; replacement retires the old asset server-side, so the form never needs a delete call. Render with `avatarSrcSet(assetId)`.
- **03-05 (nudge card)** — the card's visibility rule is the server's `needsNudge`, never a client recomputation; "Agora não" posts `POST /v1/me/profile/dismiss-nudge` and gets the refreshed profile back.
- **03-08 (sweeper)** — replaced and removed avatars are soft-deleted through `deleteAsset`, so their objects are waiting for the prefix sweep exactly like 03-01's.
- **Phase 8** — member management keys on e-mail (D-46) and reads `member_profiles` through the platform lane; V2-PROF-01's per-member "hide-me" flag is one more column and one more predicate on the 03-03 query.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-21*

## Self-Check: PASSED

All nine `key-files.created` entries exist on disk; all three task commits (`112eb46`, `4aa2062`, `bd81ce4`) are present in `git log --all`. Full cold gate re-run at summary time: `pnpm db:generate` no-op → `pnpm db:reset` → `pnpm db:seed` (9 + 4 members, 2 with photo) → `pnpm supabase test db` (9 files, 118 tests) → `pnpm test:integration` (18 files, 233 tests) → `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes` — all green.
