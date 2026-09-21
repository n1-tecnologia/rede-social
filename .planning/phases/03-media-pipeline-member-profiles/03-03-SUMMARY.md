---
phase: 03-media-pipeline-member-profiles
plan: 03
subsystem: api
tags: [profiles, directory, search, keyset, pagination, unaccent, pg_trgm, hono, zod, rls]

# Dependency graph
requires:
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "the tenant transaction lane (`withTenantTx`), `requireAuth`, `ApiError` + the stable error envelope, the `app.*` RLS helpers"
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "the `createOpenApiApp` route-group style, the shared validation hook, the throwaway-fixture conventions in `tests/integration`"
  - phase: 03-media-pipeline-member-profiles
    provides: "03-01's `mediaVariantUrl` serving path; 03-02's `member_profiles` table + trigger, `app.imm_unaccent`, the GIN-trigram and keyset indexes, and the `.strict()` `memberProfileSchema`"
provides:
  - "`GET /v1/members?q=&cursor=&limit=` — a keyset-paginated, accent- and case-insensitive, name-searchable list of the tenant's ACTIVE members with staff hidden (D-47)"
  - "`GET /v1/members/{membershipId}` — another member's photo, display name and bio and nothing else (D-45), with NO role predicate so a staff profile stays openable by direct link"
  - "one indistinguishable `404 NOT_FOUND` for unknown / other-tenant / invited / blocked / soft-deleted, with no details payload and no tenant name (D-23)"
  - "`packages/core/server/profiles/search.ts` — the TOTAL pure module: `normaliseQuery`, `likeEscape`, `encodeCursor`, `decodeCursor`"
  - "the keyset pagination convention Phase 4's feed inherits: opaque base64url `{ v, n, id }`, order by the expression the index is built on, over-fetch `limit + 1`, clamp `limit` server-side"
  - "`@tria/contracts/profiles` gains `MEMBERS_PAGE_SIZE` (25), `MEMBERS_MAX_PAGE_SIZE` (50), `MEMBERS_MAX_QUERY_LENGTH` (80), `memberListQuerySchema`, `memberListSchema`"
affects: [03-05, phase-04-feed, phase-07-chat, phase-08-member-management]

actuals:
  tokens: 13384
  tasks: 2
  commits: 2
plan_head_before: 78703f3bade89c221b39bed3b16c7213355595fb

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Keyset pagination with an OPAQUE versioned cursor: base64url `{ v: 1, n, id }` where `n` is read BACK from the projection (`app.imm_unaccent(lower(display_name)) as sort_key`), never re-folded in JavaScript, so the cursor can never disagree with the index"
    - "A TOTAL pure module: `decodeCursor` has no path that raises — a tampered, truncated or stale cursor degrades to the first page, and the grep `no `throw` outside comments` is an acceptance criterion, not a comment"
    - "Two routes over one table with deliberately DIFFERENT predicates, each citing the decision at its own call site rather than sharing a helper that would erase the distinction (D-47)"
    - "The D-47 filter kept a FLAT conjunction on one line so the deferred V2-PROF-01 hide-me flag lands as one more `and` — the deferral is encoded in the code shape"
    - "Search terms escaped as literals (`%`, `_`, `\\`) with an explicit `escape '\\'` clause, proven by an integration case asserting `?q=%25` returns ZERO rather than the whole directory"
    - "One bare `404 NOT_FOUND` with NO details for every miss reason, asserted by comparing the refusal bodies (minus `requestId`) across five different causes and requiring a set size of exactly 1"

key-files:
  created:
    - packages/core/server/profiles/search.ts
    - apps/api/src/routes/members.ts
    - packages/core/tests/profiles-search.test.ts
    - apps/api/tests/integration/members.test.ts
  modified:
    - packages/contracts/src/profiles.ts
    - packages/core/server/profiles/service.ts
    - packages/core/server/profiles/index.ts
    - apps/api/src/app.ts

key-decisions:
  - "The keyset tiebreaker is `member_profiles.id`, not `membership_id` — it is the column `member_profiles_tenant_name_idx` actually carries, so the page stays index-ordered; `membershipId` remains the item's public identity"
  - "`likeEscape` is re-derived in `search.ts` rather than imported from `platform/tenants.ts`: that repo's `likeContains` is a private const inside the PRIVILEGED lane, which `profiles/**` may not import at all (Biome, 'Admin lane is kernel-only')"
  - "`memberListQuerySchema` is `.strict()`, so `?role=admin_tenant` is a loud 400 rather than a silently ignored filter — the existing `platformTenantsQuerySchema` is not strict, so this is a deliberate tightening for the member-facing surface"
  - "`members.list` is logged by the kernel service (where the normalised term is known) and `members.read` by the route; the route does not duplicate the list line with a weaker payload, and its docblock says so"
  - "The D-47 matrix tenant is provisioned with direct `adminSql` inserts rather than `POST /v1/platform/tenants`: that route mints exactly ONE invited `admin_tenant`, so the support seat and the invited/blocked/soft-deleted rows need `adminSql` regardless, and the route would add a GoTrue invite e-mail per run for no extra coverage"

patterns-established:
  - "Opaque versioned cursor: `v` exists so a future ordering change retires old cursors by bumping it — an unrecognised version fails validation and the caller restarts from the top instead of receiving a wrong page"
  - "Over-fetch `limit + 1` to decide `nextCursor`, so the button is rendered exactly when a next page exists and never returns empty"
  - "TENANT-05 adjacency applied to the directory: the SAME display name (`Ana Paula Ferreira`) exists in two communities, so a leak that matched on a value rather than on `tenant_id` could not pass by looking plausible"

requirements-completed: [PROF-02, PROF-03, TENANT-04]

coverage:
  - id: D1
    description: "`GET /v1/members/{membershipId}` answers 200 with EXACTLY { membershipId, displayName, bio, avatarAssetId, avatarUrl } and nothing else (D-45)"
    requirement: PROF-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#4. GET /v1/members/{membershipId} answers EXACTLY photo, name and bio (D-45)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#9. both staff profiles ARE openable by direct link (D-47) and carry no role field"
        status: pass
      - kind: unit
        ref: "packages/core/tests/profiles.test.ts#memberProfileSchema — D-45 is enforced by .strict(), not by convention (03-02, feeds a `role` key and asserts refusal)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unknown, other-tenant, invited, blocked and soft-deleted all answer ONE identical 404 NOT_FOUND with no details payload and no tenant name (D-23, TENANT-04)"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#10. invited, blocked, soft-deleted, unknown and another tenant answer ONE identical 404 (D-23) — five causes, `new Set(bodies).size === 1`, `details` undefined"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#24. opening A's membershipId from B is 404, and the body names neither tenant"
        status: pass
    human_judgment: false
  - id: D3
    description: "A staff member's profile is openable by direct link while being absent from the directory listing — the two routes apply different predicates and each says why"
    requirement: PROF-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#5. D-47: the admin's profile IS openable by direct link and is NOT in the listing"
        status: pass
      - kind: other
        ref: "awk '/export async function getMemberProfile/,/^}/' packages/core/server/profiles/service.ts | grep -c 'role' prints 0, while the same range over listMembers matches `role = 'member'`"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/members lists ONLY `role = 'member'`, `status = 'active'`, `deleted_at is null` — staff, invited, blocked and soft-deleted never appear (PROF-03, D-47)"
    requirement: PROF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#7. the listing is EXACTLY the three active `member` rows (throwaway tenant with all eight role × status combinations)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#8. admin_tenant, support_tenant, invited, blocked and soft-deleted are all absent"
        status: pass
    human_judgment: false
  - id: D5
    description: "Search equality is `app.imm_unaccent(lower(x))` — `goncal` finds `João Gonçalves`, `MUNOZ` finds `Íris Muñoz`, an accented query still matches — and `%`, `_`, `\\` are escaped as literals (PROF-03, R-10, T-03-21)"
    requirement: PROF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#15. goncal, GONCAL, Gonçal and çal all find João Gonçalves"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#12. `%` and `_` are LITERALS — `?q=%25`, `?q=_` and `?q=%5C` each return zero, not the whole directory"
        status: pass
      - kind: unit
        ref: "packages/core/tests/profiles-search.test.ts#5/6/7 likeEscape('100%'), ('a_b'), ('a\\b') and ('%_\\')"
        status: pass
    human_judgment: false
  - id: D6
    description: "`q` absent, `q=''` and a blank `q` are the SAME request; a term matching nothing is 200 with an empty page; exactly one match answers one item and a null cursor (PROF-03 / edge: empty)"
    requirement: PROF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#11. absent, empty and whitespace-only `q` are the SAME request"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#13/#14 nothing-matching is 200 `{ items: [], nextCursor: null }`; one match is one item with a null cursor"
        status: pass
      - kind: unit
        ref: "packages/core/tests/profiles-search.test.ts#1. undefined, an empty string and whitespace-only all become null"
        status: pass
    human_judgment: false
  - id: D7
    description: "Two members whose normalised names are EXACTLY equal occupy two stable adjacent slots; a page boundary between them neither duplicates nor skips either row (PROF-03 / edge: adjacency)"
    requirement: PROF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#16. both homonyms appear, adjacent, in the same order across two consecutive requests"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#17. paging with limit=1 across the boundary returns each homonym exactly once"
        status: pass
    human_judgment: false
  - id: D8
    description: "Order is total and stable, and a member renamed between two page fetches cannot produce an error or an invalid cursor (PROF-03 / edge: ordering, R-11)"
    requirement: PROF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#18. a rename between page 1 and page 2 still answers a well-formed page with no duplicate"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#1. ordering asserted against `app.imm_unaccent(lower(...))` computed in Postgres, not re-derived in JS"
        status: pass
    human_judgment: false
  - id: D9
    description: "Pagination is keyset, not offset: `limit` defaults to 25 and is clamped to 1..50, `nextCursor` is present exactly when another row exists, and paging twice yields every member exactly once (PROF-03, R-11)"
    requirement: PROF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#3. ?limit=3 pages with an opaque cursor — every member exactly once, no gap, no duplicate"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#19/#20 limit 0, 51 and abc are 400 on the `limit` path; limit=1 is one item; limit=50 never exceeds the clamp"
        status: pass
      - kind: unit
        ref: "packages/core/tests/profiles-search.test.ts#15. limit defaults to MEMBERS_PAGE_SIZE and is clamped to 1..50"
        status: pass
    human_judgment: false
  - id: D10
    description: "A tampered, stale or garbage cursor degrades to the first page rather than erroring — `decodeCursor` is total (T-03-21)"
    requirement: PROF-03
    verification:
      - kind: unit
        ref: "packages/core/tests/profiles-search.test.ts#11/#12/#13/#14 — not-base64, `{}`, `v: 2` and a non-uuid id all answer null WITHOUT raising"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#21. cursor=garbage is page one, not a 500 — a shared link must not explode"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(//|\\*|/\\*)' packages/core/server/profiles/search.ts | grep -c 'throw' prints 0"
        status: pass
    human_judgment: false
  - id: D11
    description: "Both routes are tenant-lane only: a tenant-B session can never list, search or open a tenant-A member (TENANT-04)"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#23. B's full listing contains none of A's names and none of A's ids"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#25. searching B for a name only A has returns zero items, not a leak"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#26. TENANT-05 adjacency: `Ana Paula Ferreira` exists in BOTH communities and only ids tell them apart"
        status: pass
      - kind: other
        ref: "grep -rn 'admin-tx|supabase-admin' packages/core/server/profiles/ is empty; pnpm --filter @tria/core lint green"
        status: pass
    human_judgment: false
  - id: D12
    description: "The promote invariant holds end to end: `GET /v1/me/profile` and `GET /v1/members/{own membershipId}` return identical displayName, bio and avatarUrl, because both resolve the same `member_profiles` row"
    requirement: PROF-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#6. PROMOTE INVARIANT: my own profile and my profile as a member are the same row"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile.test.ts#17. PROMOTE INVARIANT (03-02, the other half — asserted against the stored row)"
        status: pass
    human_judgment: false
  - id: D13
    description: "The member directory is discoverable in the API contract: `/v1/openapi.json` lists both routes with the `q`/`cursor`/`limit` parameters and their clamps"
    requirement: PROF-03
    verification:
      - kind: other
        ref: "curl -s http://localhost:8787/v1/openapi.json | jq -e '.paths[\"/v1/members\"].get and .paths[\"/v1/members/{membershipId}\"].get' exits 0; `limit` emits minimum 1, maximum 50, default 25"
        status: pass
    human_judgment: false

# Metrics
duration: 17 min
completed: 2026-09-21
status: complete
---

# Phase 3 Plan 03: Member Directory and Member Profile Summary

**A keyset-paginated, accent- and case-insensitive member directory that lists a community's active members and hides its staff, plus `GET /v1/members/{membershipId}` returning photo, name and bio and nothing else — with one indistinguishable 404 for every miss and an opaque `{ v, n, id }` cursor that Phase 4's feed inherits.**

## Performance

- **Duration:** 17 min of execution
- **Started:** 2026-09-21T19:24:50Z
- **Completed:** 2026-09-21T23:38:36Z
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

> The wall-clock span is ~4 h because the session was interrupted by an API spend cap between the Task 2 commit and this metadata step. No work happened during the gap; the 17 min figure is execution time (≈12 min through both task commits, ≈5 min re-running every gate on resume). Every number in this summary was re-measured after the resume, not carried over.

## Accomplishments

- **The directory is a query, not a schema change** — exactly as 03-02 set it up. `listMembers` orders by `app.imm_unaccent(lower(mp.display_name)), mp.id`, which is the literal expression `member_profiles_tenant_name_idx` is built on, and matches with `like '%' || app.imm_unaccent(lower($1)) || '%'` against the GIN-trigram index. `goncal` finds `João Gonçalves`, `MUNOZ` finds `Íris Muñoz`, `Gonçal` and `çal` find the same row, and all four are asserted against the really-seeded pt-BR names rather than ASCII stand-ins.
- **D-47 is two predicates in two places, each citing the decision, on purpose.** The list carries `role = 'member' and status = 'active' and deleted_at is null`; `getMemberProfile` carries only the lifecycle half and no role predicate at all, because a staff profile must stay openable by direct link from Phase 4 content and the Phase 7 support conversation. Collapsing them into a shared helper would erase exactly the distinction the decision is about, so the acceptance criteria pin the asymmetry mechanically: `awk` over `getMemberProfile`'s body matches `role` zero times.
- **One refusal, five causes, provably identical.** An unknown uuid, another tenant's real membershipId, an invited membership, a blocked one and a soft-deleted one all take the same branch — the tenant predicate comes from the `member_profiles_tenant_select` RLS policy, so a foreign row is invisible rather than denied. The test collects all five bodies, strips only `requestId`, and asserts the set has exactly one element and `details` is `undefined`. A `{ member: 'blocked' }` payload here would be the existence oracle D-23 forbids, and the code says so at the raise site.
- **The search term is a literal, and that is proven by a case that would pass trivially if it were not.** `?q=%25` returns ZERO items. Unescaped, `like '%%%'` would have returned the whole directory — so the assertion distinguishes a wired escape clause from an unwired one, rather than merely observing "no crash".
- **The cursor is total, opaque and versioned.** `decodeCursor` base64url-decodes inside a try/catch and validates `{ v: 1, n: string, id: uuid }` with zod; not-base64, `{}`, `v: 2` and a non-uuid id all answer `null` — the first page — without raising, and an acceptance criterion greps the module for a `throw` outside comments and requires zero. `n` is read back from `app.imm_unaccent(lower(mp.display_name)) as sort_key` in the projection, never re-folded in JavaScript, so the cursor cannot disagree with the index it pages on.
- **Adjacency and rename are asserted, not hoped for.** The throwaway tenant contains two members literally named `Ana Paula Ferreira`; the unpaginated list places them adjacent in a `member_profiles.id` order identical across two requests, `limit=1` walks the boundary returning each exactly once, and renaming the second one to sort earlier while a cursor points past it still yields a well-formed page 2 with no duplicate of page 1 — with a comment recording that a moved row may be skipped and that this is accepted keyset behaviour.
- **The keyset convention Phase 4 inherits is now concrete.** Opaque base64url `{ v, n, id }`; order by the expression the index carries; over-fetch `limit + 1` so `nextCursor` is non-null exactly when another row exists; clamp `limit` server-side to 1..50 with a default of 25. Swapping "Carregar mais" for infinite scroll changes no part of that contract.
- **Member search behaviour stays out of the logs.** `members.list` carries `hasQuery: boolean`, `limit`, `returned` and `hasNext` — never the term. What a member looked for is member behaviour (T-03-24).

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): contracts, the pure search module, two tenant-lane service functions, the members router mounted on the app, and the integration tracer** — `c26bb8f` (feat)
2. **Task 2: the D-47 filter matrix, search escaping and encoding edges, adjacency and rename stability, limits, cross-tenant, and the pure cursor unit suite** — `4a9fdba` (test)

**Plan metadata:** see the `docs(03-03)` commit that carries this file.

## Files Created/Modified

- `packages/core/server/profiles/search.ts` — **created.** The pure, total half: `normaliseQuery` (trim, collapse whitespace runs, truncate at 80, empty → `null`), `likeEscape` (`\`, `%`, `_` in one pass), `encodeCursor`/`decodeCursor` (base64url `{ v: 1, n, id }`, zod-validated, never raises).
- `apps/api/src/routes/members.ts` — **created.** `GET /` (query `memberListQuerySchema`, 200 `memberListSchema`, 400 envelope) and `GET /{membershipId}` (params uuid, 200 `memberProfileSchema`, 404 envelope documented as one identical body for five causes). Both behind `requireAuth`, both `Cache-Control: no-store`.
- `packages/core/tests/profiles-search.test.ts` — **created.** 17 pure cases: normalisation, escaping, the cursor round-trip and four tamper shapes, the query schema's clamps, and `memberListSchema` refusing a row that carries a role.
- `apps/api/tests/integration/members.test.ts` — **created.** 27 cases across the tracer, the D-47 matrix on a throwaway tenant, search edges, adjacency/ordering/rename, limits, cross-tenant isolation and the membership cascade.
- `packages/contracts/src/profiles.ts` — `MEMBERS_PAGE_SIZE` (25), `MEMBERS_MAX_PAGE_SIZE` (50), `MEMBERS_MAX_QUERY_LENGTH` (80), `memberListQuerySchema` (`.strict()`), `memberListSchema`, and the inferred `MemberListQuery` / `MemberList`. `packages/contracts/src/index.ts` is byte-identical (`git diff --quiet` exits 0).
- `packages/core/server/profiles/service.ts` — `getMemberProfile(ctx, membershipId)` and `listMembers(ctx, { q, cursor, limit })` added next to the 03-02 own-profile functions; the `members.list` log event.
- `packages/core/server/profiles/index.ts` — now re-exports `./search` alongside `./service`.
- `apps/api/src/app.ts` — `.route('/v1/members', membersRoutes)` chained after `/v1/media`, so `AppType` carries the directory routes for `hc<AppType>()`.

## Decisions Made

- **The keyset tiebreaker is `member_profiles.id`, not `membership_id`.** The order index 03-02 created is `(tenant_id, app.imm_unaccent(lower(display_name)), id)`, so the cursor must carry the column the index carries or the page stops being index-ordered. `membershipId` remains the item's public identity (it is what `/membros/[membershipId]` routes on); the cursor's internals are never a public contract.
- **`likeEscape` is re-derived rather than imported.** The plan offered to reuse `likeContains` from `packages/core/server/platform/tenants.ts` "if that helper is already exported". It is not — it is a module-private const — and, more decisively, it lives in the PRIVILEGED platform lane, which `profiles/**` may not import from at all (Biome's "Admin lane is kernel-only" group). The rule is identical and the docblock names the sibling so the two can be kept in step.
- **`memberListQuerySchema` is `.strict()`.** The existing `platformTenantsQuerySchema` is not, so this is a deliberate tightening on the member-facing surface: `?role=admin_tenant` must fail loudly rather than be silently ignored, which is exactly the shape of mistake D-47 is about. An integration case and a unit case both pin it.
- **`members.list` is logged once, by the service.** The route emits `members.read` for the single-member path and deliberately does NOT duplicate the list line: only the service knows the normalised term, so only it can report `hasQuery` honestly. The route docblock records where the line comes from, so the absence is not mistaken for an omission.
- **The D-47 matrix tenant is built with direct `adminSql` inserts.** The plan suggested "the platform routes plus `adminSql`". `POST /v1/platform/tenants` mints exactly one invited `admin_tenant` and nothing else, so the support seat and the invited / blocked / soft-deleted rows need `adminSql` regardless — and routing the tenant creation through the panel would add a GoTrue invite e-mail per run for zero extra coverage. `isolation.test.ts` in the same directory already establishes the direct-insert convention. The fixture's `member_profiles` rows are still created by the 03-02 trigger, which is itself part of what the matrix exercises.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A backtick inside a `sql` template literal broke the parse**
- **Found during:** Task 1 (the `listMembers` query)
- **Issue:** The D-47 comment written inside the drizzle `sql` tagged template used backticks around the word `and` (markdown habit). A backtick inside a template literal terminates it — `tsc` reported `TS1005: ',' expected` at the line, with no hint that the cause was a comment.
- **Fix:** Plain quotes inside SQL comments. Recorded here because the same shape will recur every time a decision citation is written inside a `sql` template.
- **Files modified:** packages/core/server/profiles/service.ts
- **Verification:** `pnpm --filter @tria/core typecheck` green
- **Committed in:** `c26bb8f`

**2. [Rule 1 - Bug] A cross-tenant assertion rested on a name that is not unique**
- **Found during:** Task 2 (the cross-tenant describe)
- **Issue:** The first version of case 26 asserted that tria-demo's search for `Ana Paula Ferreira` returns zero items, on the assumption that the name existed only in the throwaway tenant. It does not: `Ana Paula Ferreira` is one of 03-02's seeded tria-demo members, so the case failed with one row. Had the assertion been written the other way round (expecting one row) it would have passed while proving nothing.
- **Fix:** Turned the collision into the point. The case now asserts that the SAME display name exists in both communities and that each side sees only its own rows by id — TENANT-05's adjacency rule (`both tenants get items with the SAME title … every assertion compares IDS, never contents`) applied to the directory. A leak that matched on a value rather than on `tenant_id` can no longer pass by looking plausible.
- **Files modified:** apps/api/tests/integration/members.test.ts
- **Verification:** `apps/api/tests/integration/members.test.ts#26` passes and now fails for the right reason if the tenant predicate is removed
- **Committed in:** `4a9fdba`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug).
**Impact on plan:** No scope change and no requirement narrowed. The second fix made a cross-tenant assertion strictly stronger than the plan specified.

## Issues Encountered

- **The session was interrupted by an API spend cap between the Task 2 commit and the metadata step.** Both task commits had landed and the working tree was clean, so the plan was in the legal "mid-close-out" state rather than a partial one. On resume, every acceptance criterion and every verification gate was RE-RUN rather than assumed, and the numbers in this summary are from that second run.
- **`pnpm test:integration -- members profile bootstrap` runs the WHOLE suite** (03-02's finding, re-confirmed): vitest ORs the filters against the script's own `tests/integration` argument, so every gate in this plan ran against all 19 files. Stronger than asked, but worth knowing before reading a "filtered" run's output.
- **`biome check` formats aggressively enough to fail `lint` on hand-written code that typechecks fine.** Three files needed `biome check --write` after being written. Running the package's own `lint` before committing is cheaper than discovering it at the repo-wide gate.

## Verification Results

Re-measured on resume, against the live local stack:

| Gate | Result |
|---|---|
| `pnpm --filter @tria/core exec vitest run tests/profiles-search.test.ts` | 1 file, **17 passed**, 100 ms |
| `pnpm --filter @tria/core test -- profiles-search` (whole unit suite) | 19 files, **168 passed** |
| `pnpm --filter @tria/api exec vitest run tests/integration/members.test.ts` | 1 file, **27 passed**, 2.2 s |
| `pnpm test:integration -- members profile bootstrap` (whole suite) | 19 files, **260 passed**, 32.7 s |
| `pnpm --filter @tria/core typecheck` / `lint` | green |
| `pnpm --filter @tria/api typecheck` / `lint` | green |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` (repo-wide) | green |
| `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes` | green |
| `grep -rn 'admin-tx\|supabase-admin' packages/core/server/profiles/` | empty |
| `curl /v1/openapi.json \| jq -e '.paths["/v1/members"].get and .paths["/v1/members/{membershipId}"].get'` | exits 0; `limit` emits `minimum 1, maximum 50, default 25` |
| All 53 acceptance-criteria greps from both tasks | **ALL-PASS** |

## Known Stubs

None. Every deliverable this plan declares is wired to real data: the directory reads the real `member_profiles` rows the 03-02 trigger created, the search runs against the real `app.imm_unaccent` + trigram index on really-accented seeded names, the photo URLs are the real 03-01 serving paths, and the D-47 matrix is a real tenant with all eight role × status combinations. `memberListSchema` is consumed by the routes shipped here; 03-05's `/membros` screens are a declared handoff, not a stub.

## Threat Flags

None. Every surface this plan introduces is in the plan's `<threat_model>` (T-03-19 … T-03-SC) and each `mitigate` disposition has a test: the IDOR / existence-oracle pair (five miss causes, one identical body, asserted as a set of size 1), cross-tenant enumeration (three cases from a tenant-B session plus the adjacency case), the `like` pattern and cursor tampering (`?q=%25` → zero, four tamper shapes → `null`, zero `throw` in the module), role leakage (`.strict()` schemas plus 03-02's `role`-key rejection case), unbounded pages (`limit` clamped, `q` capped, keyset instead of `offset`), and search text in logs (`hasQuery` boolean only). This plan installs nothing (T-03-SC).

## User Setup Required

None — no external service configuration required. This plan adds a query, two routes and tests; it ships no migration and no environment variable.

## Next Phase Readiness

- **03-05 (directory screens)** — `GET /v1/members?q=&cursor=&limit=` → `{ items: MemberProfile[], nextCursor: string | null }`. Send `limit = MEMBERS_PAGE_SIZE` (25) and show "Carregar mais" exactly while `nextCursor !== null`, appending rather than replacing. The cursor is OPAQUE: pass it back verbatim, never parse or build one. An empty `q` may be omitted or sent empty — both mean "no filter" — but note the query schema is `.strict()`, so no extra parameter may ride along. `GET /v1/members/{membershipId}` answers one identical 404 for unknown / other tenant / blocked / invited / removed, so the screen renders a single "Membro não encontrado" `EmptyState` for every miss and never names a tenant. The caller's own membershipId IS returned in the list unfiltered (UI-D-03); `/membros/{own id}` redirects to `/perfil` on the web, not in the API.
- **Phase 4 (feed)** — inherit this keyset convention verbatim: opaque base64url `{ v, n, id }`, order by the same expression the index is built on, read the ordered key BACK from the projection rather than re-deriving it, over-fetch `limit + 1` to decide `nextCursor`, and clamp `limit` server-side. `packages/core/server/profiles/search.ts` is the reference implementation, and its totality (no `throw`) is the property to copy.
- **Phase 8 (moderation / member management)** — the D-47 predicate is a flat conjunction on one line, so V2-PROF-01's per-member hide-me flag and any moderation-driven visibility rule land as one more `and` in the same place, with no helper to unpick first.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-21*

## Self-Check: PASSED

All four `key-files.created` entries exist on disk (`[ -f ]` confirmed). Both task commits (`c26bb8f`, `4a9fdba`) are present in `git log --all`. `git rev-list --count 78703f3..HEAD` = 2, matching the `commits: 2` recorded above. All 53 acceptance-criteria greps re-ran ALL-PASS on resume, and every verification gate in the table above was re-executed against the live local stack rather than carried over from the interrupted session.
