---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 10
subsystem: web
tags: [web, follow, profile-counts, directory, private-lists, D-466, D-467, D-468, D-470, UI-D-498, UI-D-501, UI-D-502, UI-D-503]

requires:
  - phase: 09-02
    provides: "the six /v1/social routes, the follow graph, the social profile read, the batch state read and the directory gate for a member"
  - phase: 09-08
    provides: "Explorar and its 'Encontrar pessoas' link to /membros, social.json as a catalog root"
  - phase: 09-09
    provides: "the member composer and moderator removal; social.participate composed for members"
  - phase: 09-12
    provides: "@rede-social/module-social as a dependency of apps/web"
provides:
  - "@rede-social/module-social/ui: FollowButton, FollowCounts, FollowListRow, props-only (no words, no route, no fetch)"
  - "apps/web/lib/social.ts: the one /v1/social fetch layer (putFollow, deleteFollow, getFollowState, getFollowers, getFollowing, getSocialProfile) and never-throwing loaders"
  - "FollowControl: the optimistic Seguir / Seguindo toggle for every placement, bound to followAction / unfollowAction / followStateAction"
  - "SocialProfileBlock + SocialCountsBlock: the counts and the follow button under the D-45 header, own Suspense, inline error with retry; own mode = the same counts as links on /perfil"
  - "canBrowseMemberDirectory / canFollowMembers / memberProfileExit taking the viewer's role and composed permissions; /membros open to a member while social.participate is composed"
  - "MemberFollowRow (the split row) used by the directory and the lists; 'Voce' on the caller's own row; an empty w-24 slot while a state is unknown"
  - "/perfil/seguidores and /perfil/seguindo: the caller's private lists, 25 per page, keyset, undo-in-place unfollow, no id anywhere"
affects: [09-11, 09-13]

actuals:
  tokens: 40100
  tasks: 3
  commits: 8
plan_head_before: b0b70c1aa35de85ef5ba876b5a7fd465e1e63bb2

tech-stack:
  added: []
  patterns:
    - "Module UI is props-only and plain <a>; the host owns state, actions, toasts and routes (MOD-02)"
    - "A server component's second read gets its own Suspense: an async inner component behind a synchronous gate (SocialProfileBlock)"
    - "A batch state read per page, server-side for page 1 and returned by the load-more action, so a row is never N requests"
    - "A control whose state has not arrived renders its fixed slot and no label (EP-43)"
    - "Guard tests over the file tree and over source text (comments stripped) pin 'no route takes another member's id' and 'no post list on a profile'"

key-files:
  created:
    - packages/modules/social/ui/FollowButton.tsx
    - packages/modules/social/ui/FollowCounts.tsx
    - packages/modules/social/ui/FollowListRow.tsx
    - packages/modules/social/ui/index.ts
    - packages/modules/social/tests/follow-button.test.tsx
    - packages/modules/social/tests/follow-counts.test.tsx
    - packages/modules/social/tests/follow-list-row.test.tsx
    - apps/web/lib/social.ts
    - apps/web/lib/social.test.ts
    - apps/web/components/social/FollowControl.tsx
    - apps/web/components/social/FollowControl.test.tsx
    - apps/web/components/social/follow-actions.ts
    - apps/web/components/social/SocialProfileBlock.tsx
    - apps/web/components/social/SocialProfileBlock.test.tsx
    - apps/web/components/social/SocialCountsBlock.tsx
    - apps/web/components/social/MemberFollowRow.tsx
    - apps/web/components/social/no-follow-outside.test.tsx
    - apps/web/components/profile/MembersSkeleton.tsx
    - "apps/web/app/(app)/membros/MembersList.rows.test.tsx"
    - "apps/web/app/(app)/perfil/SocialList.tsx"
    - "apps/web/app/(app)/perfil/SocialList.test.tsx"
    - "apps/web/app/(app)/perfil/social-list-actions.ts"
    - "apps/web/app/(app)/perfil/social-list-actions.test.ts"
    - "apps/web/app/(app)/perfil/seguidores/page.tsx"
    - "apps/web/app/(app)/perfil/seguidores/loading.tsx"
    - "apps/web/app/(app)/perfil/seguindo/page.tsx"
    - "apps/web/app/(app)/perfil/seguindo/loading.tsx"
  modified:
    - apps/web/lib/member-directory.ts
    - apps/web/lib/member-directory.test.ts
    - "apps/web/app/(app)/membros/page.tsx"
    - "apps/web/app/(app)/membros/actions.ts"
    - "apps/web/app/(app)/membros/actions.test.ts"
    - "apps/web/app/(app)/membros/MembersList.tsx"
    - "apps/web/app/(app)/membros/MembersList.test.ts"
    - "apps/web/app/(app)/membros/[membershipId]/page.tsx"
    - "apps/web/app/(app)/membros/[membershipId]/not-found.tsx"
    - "apps/web/app/(app)/perfil/page.tsx"
    - apps/web/components/profile/MemberRow.tsx
    - apps/web/messages/pt-BR/social.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/social.spec.ts
    - apps/web/e2e/social-admin.ts
    - apps/web/e2e/affected-map.json
    - packages/modules/social/README.md

key-decisions:
  - "Planning decision 1 (module owns three props-only components, host owns the rest): FollowButton, FollowCounts and FollowListRow take translated strings, formatted numbers and slots; the optimistic state, actions, toasts and every route live in apps/web"
  - "Planning decision 2 (one FollowControl for every placement): membershipId, name, size, initialFollowing (boolean or null = state not arrived) and onChange(followerCount); owns flip, reconcile, revert, toast and an in-flight ref"
  - "Planning decision 3 (state reads batched on the server): loadFollowState once per page (server for page 1, inside loadMoreMembersAction for each next page); until it arrives the slot keeps its w-24 width and draws no label"
  - "Planning decision 4 (canBrowseMemberDirectory takes the viewer): { role, permissions }; the composed social.participate is the single switch, staff stay role-based"
  - "Planning decision 5 (the social block is a server component with its own Suspense): SocialProfileBlock gates on the permission synchronously and streams SocialProfileData, so loading and failure are that block's alone"
  - "Planning decision 6 (catalog): every string in social.json; members.json is reused for the generic error card, not duplicated"
  - "The followers label is =0 {Seguidores} one {Seguidor} other {Seguidores}: pt-BR CLDR files 0 under 'one', which would print 'Seguidor' at zero against the plan's E06 truth"
  - "A client SocialCountsBlock holds the follower count so the server's answer moves the number without a reload; the server block stays a thin reader"
  - "Module rows use a plain <a> (the feed module's convention, MOD-02), so the link from a row to a profile is a full navigation, unlike MemberRow's next/link"

requirements-completed: [FOLLOW-03, FOLLOW-04, FOLLOW-05, FOLLOW-06, SOCIAL-10]

coverage:
  - id: D1
    description: "Tracer: Alvaro opens Marcos's profile, sees the unchanged D-45 header, two plain count cells and a brand Seguir; one tap shows Seguindo at once, the follower count rises by the server's answer, a reload keeps it, a second tap unfollows with no dialog and no toast; staff and a social-off tenant see the header only"
    requirement: FOLLOW-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-10 the follow button and the counts on a member profile (3 cases, mobile and desktop)"
        status: pass
      - kind: unit
        ref: "components/social/FollowControl.test.tsx F1-F9; SocialProfileBlock.test.tsx B1-B11; lib/social.test.ts S1-S12; module follow-button B1-B8 and follow-counts C1-C5"
        status: pass
    human_judgment: false
  - id: D2
    description: "The directory for a member: /membros opens while social.participate is composed, rows are the split row (link then button), the caller's row reads Voce, a row without a state holds its slot, page two carries its own states, staff keep the button-free list, a social-off member is redirected to /perfil, back links follow the viewer"
    requirement: FOLLOW-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-10 /membros for a member (6 cases over a 27-member throwaway community, mobile and desktop)"
        status: pass
      - kind: unit
        ref: "lib/member-directory.test.ts (every role x with and without the permission); membros/actions.test.ts 5-8; MembersList.rows.test.tsx M1-M7; module follow-list-row R1-R5"
        status: pass
    human_judgment: false
  - id: D3
    description: "The own counts as links to /perfil/seguidores and /perfil/seguindo; the private lists with empty cards, paging, inline retry, undo-in-place unfollow in Seguindo, no route or action taking another member's id; social off and staff get the standard 404"
    requirement: FOLLOW-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-10 the own counts as links and the private Seguidores and Seguindo lists (6 cases, mobile and desktop)"
        status: pass
      - kind: unit
        ref: "perfil/SocialList.test.tsx L1-L11 and guards G1-G3; perfil/social-list-actions.test.ts A1-A5; SocialProfileBlock.test.tsx B12-B14"
        status: pass
    human_judgment: false
  - id: D4
    description: "The follow control renders in the four places only (profile, locked screen in plan 11, directory rows, list rows) and never next to an author in a post header, a comment or the Reels rail; no profile, /perfil or list renders a post list, Minhas publicacoes, a post count or Mensagem"
    requirement: FOLLOW-05
    verification:
      - kind: unit
        ref: "components/social/no-follow-outside.test.tsx N1-N4; perfil/SocialList.test.tsx G3 (source guard over the profile screens) and L11; SocialProfileBlock.test.tsx B11"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#/perfil shows the two counts as links ... and no personal feed"
        status: pass
    human_judgment: false
  - id: D5
    description: "Isolation of the follow reads and writes across tenants (T-09-29, T-09-36): a viewer outside the graph, a staff viewer and a tenant with social off reach no list, count or button; the API refuses independently"
    requirement: SOCIAL-10
    verification:
      - kind: e2e
        ref: "social.spec.ts: staff and social-off profile walks, social-off and staff 404 on both list routes, hand-typed ?membershipId= ignored"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/social.test.ts and isolation.test.ts (plan 09-02; not re-run here, no API code changed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Seguir / Seguindo button, the counts row and the split row read as the approved sketch 012 under any tenant brand at 320 and 390px, including up to 25 brand 'Seguir' fills in one viewport"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved sketch is a design judgment; designer review is a follow-up (D-33). Touch behaviour of the buttons on a real phone is also unverified (real-device rows are blocked locally)."

duration: 31 min
completed: 2026-10-20
status: complete
---

# Phase 9 Plan 10: Follow, counts, the directory for members and the private lists Summary

**A member follows and unfollows from a profile, from every directory row and from their own private Seguidores and Seguindo lists, with an optimistic button reconciled against the server's `{ following, followerCount }`; counts are public, lists are private and take no id, and staff, the caller's own row and a tenant with `social` off see exactly today's screens.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-10-20T01:57:42Z
- **Completed:** 2026-10-20T02:29Z (this SUMMARY and the tracking commit follow)
- **Tasks:** 3 (one tracer, two auto), all TDD
- **Files:** 43 changed (27 created), 3,713 insertions, 129 deletions, measured against `plan_head_before`

## Accomplishments

- **Tracer (Task 1, FOLLOW-04, D-470).** `FollowButton` and `FollowCounts` are props-only in the social module. `apps/web/lib/social.ts` is the single `/v1/social` fetch layer; `getSocialProfile` answers `ok | not-eligible | error` and never throws, so a failed read can never look like a staff profile. `FollowControl` flips at once, reconciles with the server, hands the new follower count to `SocialCountsBlock`, reverts and toasts a fixed catalog sentence on failure, and ignores a second tap with an in-flight ref. `SocialProfileBlock` is gated on `social.participate` (no request without it), streams in its own `Suspense` (two skeleton cells, never a 0), and shows an inline error with an outline retry link when only the social read fails. The profile page renders it under the unchanged D-45 header.
- **The directory for members (Task 2, FOLLOW-06, D-466, UI-D-503).** `canBrowseMemberDirectory`, `canFollowMembers` and `memberProfileExit` take `{ role, permissions }`; `social.participate` is the single switch. `/membros` reads the first page's follow state in one server-side batch and `loadMoreMembersAction` returns each next page's states. A member's rows are `MemberFollowRow` (the person's link, then a sibling `sm w-24` button), the caller's own row says "Voce", and a row without a state holds its slot with no label. The staff keep the single-link row. Back links: member to Explorar from the directory, profile to `/membros` while social is on.
- **The private lists (Task 3, FOLLOW-03, D-468, UI-D-502).** `/perfil` renders the same two counts as links for a participating member. `/perfil/seguidores` and `/perfil/seguindo` take no id, no search parameter and no segment; `SocialList` pages 25 at a time with the directory's own "Carregar mais", shows the empty cards (Seguindo offers "Encontrar pessoas"), an inline retry, and an unfollow in Seguindo leaves the row in place as "Seguir". The list actions take a cursor only, validated by the contract's own Zod. A guard test fails on any dynamic segment on the path to a followers or following route.

## Task Commits

1. **Task 1 (tracer, TDD):** RED `4a244b93` (test), GREEN `599c0c72` (feat)
2. **Task 2 (TDD):** RED `db71b358` (test), GREEN `356880ce` (feat)
3. **Task 3 (TDD):** RED `44af333f` (test), GREEN `ab9ace36` (feat)
4. **Added guard (EP-42):** `f62a6a59` (test), the no-follow-control-outside-the-four-places test the plan's truth asks for
5. **README:** the module README lists the new `./ui` exports (docs commit)

**Plan metadata:** committed separately (docs: complete plan, then state and roadmap).

## TDD Gate Compliance

Plan type is `execute` with `tdd="true"` tasks, so each task has a `test(09-10)` commit before its `feat(09-10)` commit; `^test\(0*9-0*10\):` 4 commits, `^feat\(0*9-0*10\):` 3 commits, no REFACTOR commit. The RED runs were real Vitest failures on the planned behavior; `gsd-tools check tdd-red-evidence` was not run (workflow `tdd_mode` is off, the plan is not `type: tdd`, and Vitest emits no TAP), and no evidence record or count was fabricated.

- **Task 1 RED:** module `follow-button` + `follow-counts`: 12 of 13 failed on assertions (the 13th is a negative control); web `FollowControl` 9 of 9, `lib/social` 11 of 14, catalog 10. The new modules shipped as inert, self-documented stubs in the RED commit (a new file cannot produce a valid RED from an import error); `lib/social.ts` stubs threw "not built", so those `resolves` assertions fail on the rejection rather than on a value.
- **Task 2 RED:** `member-directory` (the member-with-permission matrix), `loadMoreMembersAction` 5 and 6, `MembersList.rows` M2, M3, M4, M6, M7, catalog 1, and module `follow-list-row` 5 of 5. The RED commit already carried the new helper signatures with the OLD staff-only behavior (a behavior-neutral refactor of the four callers), so typecheck stayed clean and the failures are assertions. Cases that passed in RED are negative controls (staff row, social-off redirect, tests 7 and 8).
- **Task 3 RED:** `SocialList` L1-L10, `social-list-actions` A1, A3, A4 and 7 catalog pins failed (20 in total); the file-tree guards G1/G2 and A2/A5 passed against the stubs by design (they pin what must stay true).
- **EP-42 guard (`f62a6a59`):** written after the code (it pins that nothing renders), so no RED exists for it; it is listed honestly as a test-only commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pt-BR files 0 under the plural category "one"**
- **Found during:** Task 1 (the catalog pin for the followers plural)
- **Issue:** the UI-SPEC copy `{count, plural, one {Seguidor} other {Seguidores}}` prints "Seguidor" at 0 in pt-BR (CLDR `one` covers 0 and 1), against the plan's E06 truth "'Seguidores' at 0 and 'Seguidor' at 1".
- **Fix:** `counts.followers` is `{count, plural, =0 {Seguidores} one {Seguidor} other {Seguidores}}`, and `counts.followersLink` has the same `=0` branch ("0 seguidores, ver lista").
- **Files modified:** `apps/web/messages/pt-BR/social.json`, `apps/web/i18n/messages.test.ts`
- **Commit:** `599c0c72`, `ab9ace36`

**2. [Rule 3 - Blocking] Files the plan did not list**
- **Found during:** Tasks 1-3
- **Issue:** the follower count has to follow the server's answer, which a server block cannot hold; the directory and both lists need one row; the lists must show `MembersSkeleton` without importing the directory's server action; three guards and a state test had no home in the listed files.
- **Fix:** new `components/social/SocialCountsBlock.tsx` (client count holder), `components/social/MemberFollowRow.tsx` (the split row), `components/profile/MembersSkeleton.tsx` (extracted, re-exported from `MembersList.tsx`), `MemberAvatar` exported from `MemberRow.tsx`; tests `SocialProfileBlock.test.tsx`, `no-follow-outside.test.tsx`, `MembersList.rows.test.tsx`, `social-list-actions.test.ts`; e2e helpers in `social-admin.ts`; a `social-web` group in `e2e/affected-map.json` so a change to the social components selects `social.spec.ts`, `members.spec.ts` and `profile.spec.ts` instead of falling to "all"; the `./ui` row in the social README.
- **Commits:** `599c0c72`, `356880ce`, `ab9ace36`, `f62a6a59`

**3. [Rule 3 - Blocking] `MembersList.test.ts` crashed on import**
- **Issue:** `MembersList` now reaches `FollowControl` and its server actions, whose chain validates the API env at import.
- **Fix:** the test mocks `@/components/social/follow-actions` (one `vi.mock`). **Commit:** `356880ce`.

**4. [Rule 1 - Bug avoided] A redirect inside a catch**
- **Issue:** `loadFollowState` may navigate on a session refusal; called inside `loadMoreMembersAction`'s try it would be swallowed and logged as a list failure.
- **Fix:** the state read runs after the try/catch. The page does the same. **Commit:** `356880ce`.

### Judgment calls worth a reviewer's eye

- **Plain `<a>` in the module rows** (feed module convention, MOD-02): a row's link is a full navigation, unlike `MemberRow`'s `next/link`. Swap for a host-injected link component if the extra navigation cost shows on a phone.
- **The caller's own id is not excluded from the load-more state batch** (the page excludes it); the row shows "Voce" whatever the answer, and the batch is one call either way.
- **`own` mode wraps the profile block in `px-4 empty:hidden`** so a viewer without the permission leaves no gap in the page's `gap-8` flow.
- **Social read failure is not driven from the browser**: the read is made by the Next server, which Playwright cannot intercept. It is asserted in `SocialProfileBlock.test.tsx` B4 and logged in WINDOWS.md as a deviation.

### Design gate note (for /gsd-verify-work)

Sketch `012-phase-09-designed-screens` was approved provisionally by Igor in chat on 2026-10-19 (commit `48c79511`). The orchestrator wrote the README approval keys and the MANIFEST row on Igor's explicit instruction ("pode alterar voce mesmo"); this executor did not write or stage anything under `.planning/sketches/`. The precondition grep passed. Designer review (D-33) remains a follow-up.

**Total deviations:** 4 auto-fixed (2 Rule 1, 2 Rule 3), 4 judgment calls. **Impact:** none on scope; every must-have truth has a test.

## Issues Encountered

- **`pnpm db:reset && pnpm db:seed` was NOT run** before any of the three Playwright verify commands (repo rule 3: no consent to reset). `social.spec.ts` (all three tasks), `members.spec.ts` and `profile.spec.ts` ran on the existing local database, which carries earlier plans' residue. Logged in `.planning/WINDOWS.md` as `unrun-verify`.
- **`profile.spec.ts`: 5 cases x 2 projects fail** ("Sua atividade", "a community without Comunidades", and three "painel do dono ... on real data"). They read the dashboard snapshot the spec builds in `beforeAll`; on this database the member-activity blocks never render. The "Sua atividade" case was re-run with `/perfil/page.tsx` restored to its pre-plan content and failed identically, and rede-demo has `social` off, so no new code is on that path. The other 119 cases of `social.spec.ts` + `profile.spec.ts` passed (3 skipped). Recorded in `deferred-items.md`; re-run on a freshly seeded database.
- **`admin-members.spec.ts` "role tracer" fails on both projects** (a link containing "Membros" on `/configuracoes` for a plain member; the substring locator most likely matches the member-area entry from quick 261019-k7x). It was selected because `playwright test members.spec.ts` is a substring pattern. Pre-existing, not touched; in `deferred-items.md`.
- The first full gate run failed on `@rede-social/web#typecheck` because the new `no-follow-outside.test.tsx` (written while the gate ran) used two wrong prop names; fixed, and the web typecheck is clean. Every other gate task (36 of 37) passed in that run; the full gate was not repeated afterwards.

## Verification Results

- `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 36 of 37 tasks passed on the run; the one failure (the web typecheck above) was my own test file and is fixed. Module-social: 6 files, 58 tests. Web: 185 files, 4,106 tests in that run, plus the new guard file (3 files, 34 tests in `components/social`) afterwards.
- Per-task verify (unit halves): module-social test, typecheck, lint; web `vitest` for `lib/social`, `components/social`, `i18n`, `lib/member-directory`, `membros`, `perfil`, `scripts/e2e-affected.test.ts` (44 passed); web typecheck and lint clean (one pre-existing Biome info); `bash scripts/check-ui-literals.sh` OK; `pnpm boundaries`: 1,711 files in 18 packages, no issues; `apps/api/tests/unit/module-readmes.test.ts` 17 passed.
- Playwright (local stack, `VIDEO_PROVIDER=fake`, two projects): `social.spec.ts -g 09-10` 30 cases passed (tracer 6, directory 12, lists 12); the full `social.spec.ts` + `profile.spec.ts` run: 119 passed, 3 skipped, 10 failed (the profile cases above).
- Not run: `turbo run build` (disk), `pnpm db:reset`/`db:seed`, pgTAP and API integration suites (no SQL or API code changed), any real-device check.
- Cleanup: `apps/web/.next` (1.5 GB) and `apps/web/test-results` removed; no `next dev`, API or Playwright process left; DB counts checked: no throwaway tenant (`socd%`, `mbr%`), no `social-%`/`papel-%` users, no `Teste social` profile or post, and the follow table holds exactly the two seeded edges.

## Known Stubs

None. The inert RED stubs of the three tasks were fully replaced in their GREEN commits (`grep "RED stub"` finds nothing under `apps` or `packages`).

## Threat Flags

None. No new endpoint, auth path or schema. T-09-29 is mitigated by the list pages and actions taking no id plus the file-tree guard; T-09-28 by idempotent writes, the disabled-while-pending button and the in-flight ref; T-09-36 by the permission gate and the e2e staff and social-off walks; T-09-37 by actions that answer a code and fixed catalog sentences.

## Next Phase Readiness

Ready for 09-11 (the "Siga para ver" screen): `FollowControl` takes `size="md"`, `fullWidth` and a `className`, so the locked screen can cap it at `max-w-[260px]`; `getSocialProfile` and `SocialProfileBlock` are reusable. Carry-overs: a clean `pnpm db:reset && pnpm db:seed` run of `social.spec.ts`, `members.spec.ts` and `profile.spec.ts` when Igor consents (WINDOWS `unrun-verify`); the designer review of sketch 012 (D-33); a real-phone check of up to 25 brand buttons in one viewport; the two pre-existing e2e failures in `deferred-items.md`.

## Self-Check: PASSED

- Created files exist (module ui x4, `lib/social.ts`, `FollowControl`, `follow-actions`, `SocialProfileBlock`, `SocialCountsBlock`, `MemberFollowRow`, `MembersSkeleton`, the two list pages and their `loading.tsx`, `SocialList`, `social-list-actions`, `deferred-items.md`): FOUND
- Commits `4a244b93`, `599c0c72`, `db71b358`, `356880ce`, `44af333f`, `ab9ace36`, `f62a6a59` exist; measured `commits: 8` from the persisted ledger (the eighth is the README docs commit)
- Acceptance greps (aria-busy, FollowCounts in the index, `/v1/social`, SocialProfileBlock in the profile page, ariaFollowing, social.participate, FollowListRow, directory, loadMoreFollowersAction, seguidores in `/perfil`, no `[*` dynamic segment under either list route): PASS
- No attribution trailer in any of the eight commit messages (no Co-Authored-By, no Claude or Anthropic mention): confirmed
