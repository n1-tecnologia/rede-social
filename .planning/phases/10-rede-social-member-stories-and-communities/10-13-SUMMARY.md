---
phase: 10-rede-social-member-stories-and-communities
plan: 13
subsystem: web
tags: [member-communities, web, communities-list, community-form, limit-notice, tracer, escopo-seam, UI-D-706, UI-D-707, UI-D-708, D-703, D-710, D-712, D-713, D-718]

requires:
  - phase: 10-02
    provides: "the sketch 020 review gate (approved: true, provisional, D-33)"
  - phase: 10-06
    provides: "the list wire with kind, createdBy, viewer { actions } and memberQuota; the member archived read scoped to own rows"
  - phase: 10-11
    provides: "the web foundations (catalogs, member-community post wording)"
provides:
  - "/comunidades: the brand create control for a member (composed permission plus the quota the read carries), the limit notice in its place at the limit, nothing at limit 0 or with social off"
  - "the member's Ativas/Arquivadas chips only while they own an archived community; any other status lands on Ativas"
  - "CommunityCard byline (count shrink-0 tabular-nums, aria-hidden middot, byline min-w-0 truncate), one link, name as plain text"
  - "CommunityForm member mode (audience line, no store Acesso block), the limit screen replacing the form at the limit, the limit and 403 alerts keeping every value"
  - "the reorder mode over ORGANIZATION communities only; the orderable read stops at the first member row"
  - "the Escopo seam: the list loader carries viewer.actions whole, pinned by a loader test"
affects: [10-14, 10-15]

actuals:
  tokens: 31000
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "communityEntryState(canManage, canCreate, memberQuota) -> control | notice | none: one pure decision shared by the list page and /comunidades/nova"
    - "A client component with a heavy hook set is split into a thin wrapper plus a body so an early screen (the limit screen) never breaks hook order"
    - "isOrganization(community) reads the API's own kind flag; member rows follow organization rows, so a walk can stop at the first one"

key-files:
  created:
    - apps/web/app/(app)/comunidades/CommunityLimitNotice.tsx
    - apps/web/app/(app)/comunidades/page.test.tsx
    - apps/web/app/(app)/comunidades/nova/page.test.tsx
    - packages/modules/communities/tests/community-card-byline.test.tsx
  modified:
    - apps/web/app/(app)/comunidades/page.tsx
    - apps/web/app/(app)/comunidades/CommunitiesList.tsx
    - apps/web/app/(app)/comunidades/CommunitiesList.test.tsx
    - apps/web/app/(app)/comunidades/CommunityForm.tsx
    - apps/web/app/(app)/comunidades/CommunityForm.test.tsx
    - apps/web/app/(app)/comunidades/nova/page.tsx
    - apps/web/app/(app)/comunidades/actions.ts
    - apps/web/app/(app)/comunidades/actions.test.ts
    - apps/web/lib/communities.ts
    - apps/web/lib/communities.test.ts
    - apps/web/messages/pt-BR/communities.json
    - packages/modules/communities/ui/CommunityCard.tsx

key-decisions:
  - "The title-row control and the limit notice stay in page.tsx (the shipped place of the control, a server component); the list receives only canCreate for its empty-state action. The plan text said the list shows the control"
  - "The byline is derived inside CommunitiesList from createdBy and the catalog key communities.card.byline ('Criada por {name}'): lib/communities.ts pulls server-only code (apiFetch) and cannot be imported by a client component, so no separate builder lives there. The plan's key name card.postsByCreator was not used (it would have held only the second half of the sentence)"
  - "A member's archived-chips probe is one read of GET /v1/communities?status=archived&limit=1, taken by the page only for a holder of manage_own without manage; the API scopes it to the caller's own rows"
  - "CommunityForm is a thin wrapper over CommunityFormBody so the limit screen (props.limitReached) renders before any hook runs; the 403 maps to the member copy only in member mode, the organization form keeps the shipped generic error"
  - "In reorder mode member cards stay on screen below the draft, unchanged and outside the draggable list, as the plan text says (the UI-SPEC only says they are not in the draft)"
  - "getOrderableCommunities keeps organization rows only and stops at the first member row (member rows come after every organization row), so a tenant with many member communities never trips the too_many bound"

patterns-established:
  - "Page tests render the async server component to static markup with the real pt-BR catalog (createTranslator) and capture the props handed to the mocked client list"

requirements-completed: [MCOMM-01, MCOMM-02, MCOMM-03, MCOMM-04, MCOMM-05, MCOMM-06, MPUB-05, UI-04]

duration: 70min
completed: 2026-11-11
status: complete
plan_head_before: 986329e04b97f7af8c6f63102788b45a1a069c1e
commits: 7
---

# Phase 10 Plan 13: Member Communities List and Form Summary

**A member with `social` on sees "Criar comunidade" on `/comunidades` (or the limit notice at the limit), creates a community with the shipped form minus the store block and with the audience line, and finds member communities after the organization's with their "Criada por" byline; the admin's reorder now covers organization communities only.**

## Accomplishments

- **Tracer (Task 1):** `CommunityCard` takes one optional `byline` string (count `shrink-0 tabular-nums`, `aria-hidden` middot, byline `min-w-0 truncate`; one link, plain-text name). `CommunityForm` has a member mode (audience line "Todos os membros de {tenant} veem esta comunidade. Só você publica nela." under "Descrição", never the store "Acesso" block). `communityEntryState` decides control / notice / none from the composed permissions and `memberQuota`. `/comunidades/nova` opens for a holder of `communities.community.create`. The loader test proves a member entry and an organization entry keep their `viewer.actions` object unchanged (the Escopo seam); no screen of this plan reads an action flag.
- **Limit states (Task 2):** `CommunityLimitNotice` (ICU plural, no action) replaces the control at the limit; limit 0, an admin and `social` off show none. The member's chips show only while they own an archived community (one scoped read, `limit=1`); a repeated or foreign `status`, a member with none, or `social` off lands on Ativas. `/comunidades/nova` at the limit renders the limit screen instead of the form (limit 0 redirects to the list); the limit refusal and the `403` show the shipped top alert and keep every value; the actions answer a `403` with the new `forbidden` code.
- **Organization-only order (Task 3):** the "Reordenar" control and the draft count organization communities only, the save sends organization ids only, member cards stay on screen after the draft, the orderable read stops at the first member row and does not count member rows against the bound, and a store tag never lands on a member card.

## Task Commits

1. **Task 1 RED:** `b8549bf3` (test): 84 web tests with 7 failed, 5 module tests with 4 failed.
2. **Task 1 GREEN:** `3425f471` (feat).
3. **Task 2 RED:** `7cea3e0f` (test): 93 tests, 9 failed.
4. **Task 2 GREEN:** `9bc2c702` (feat).
5. **Task 3 RED:** `c1ec2541` (test): 117 tests, 7 failed.
6. **Task 3 GREEN:** `94f7b6bb` (feat).
7. **Docs note:** `05f6fe30` (docs): names `limit_reached` and `forbidden` in the write result's contract note (the plan's acceptance grep looks for the literal).

Red evidence: for each task a real Vitest `--reporter=json` run was normalised by a throwaway script kept in the session scratchpad (never committed) and `gsd-tools check tdd-red-evidence` answered `RED_EVIDENCE_OK` with the real counts above (Task 1 has two records: web and the communities module). No count was invented.

## Verification (observed)

| Gate | Result |
|------|--------|
| `apps/web` Vitest `app/(app)/comunidades` + `lib/communities.test.ts` (final) | 8 files, 117 passed |
| `@rede-social/module-communities` tests | 9 files, 78 passed |
| `apps/web` Vitest, whole app, final | 352 files: 351 passed, 1 failed; 8278 tests: 8277 passed, 1 failed (the known `highlight-actions.test.ts` case 6, plan 10-12) |
| `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-communities --concurrency=4` | 4 tasks successful (ran the web `next build` as a dependency; `.next` is 550 MB, `.next/cache` 445 MB, nothing deleted) |
| `bash scripts/check-ui-literals.sh` | OK |
| Biome on the touched paths | clean |
| sketch gate `grep -q '^approved: true' ...020.../README.md` | passes (provisional approval, commit 30ce8537) |
| Acceptance greps (`byline`, `audienceNote`, `Criada por`, `kind ===` count 0, `actions` in the loader test, `limit_reached`, `organization`, `draft`) | all pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The control and the notice are in `page.tsx`, not in `CommunitiesList.tsx`**
- **Issue:** the plan says the list shows the shipped brand control. In the shipped code the title-row control lives in the server page (the list owns only the empty-state action), and a client-side move would have changed the shipped markup.
- **Fix:** the page renders the control and the notice (`communityEntryState`); the list gets `canCreate` for its empty-state action. A new `page.test.tsx` pins the page's decisions.

**2. [Rule 3 - Blocking] The byline builder is not in `lib/communities.ts`**
- **Issue:** that module imports `apiFetch` and `next/navigation`; a client list cannot import it.
- **Fix:** the list derives the string from `createdBy` and the catalog key `communities.card.byline`. The plan's key `communities.card.postsByCreator` was not added (unused; the count and the byline are separate pieces in the card).

**3. [Rule 2 - Missing critical functionality] Four new test files**
- `page.test.tsx` and `nova/page.test.tsx` (the control, notice, chips and screen routing live in the pages), `community-card-byline.test.tsx` (the plan says "a card test"). `nova/page.test.tsx` was written after its implementation (same task commit as the GREEN, not RED-first); the behavior it pins is also covered by the form tests written red-first.

**4. [Rule 3 - Blocking] `getOrderableCommunities` was changed (in the plan's `lib/communities.ts`)**
- Without it, a tenant with many member communities would trip the `too_many` bound and the reorder would be offered a set the API refuses.

**5. [Rule 2] `CommunitiesList.test.tsx` merges `communities.store.json` into its catalog**
- Needed so the "no store tag on a member card" assertion is not vacuous (`tags.exclusive` lives in the store's file of the same namespace).

**6. `CommunityLimitNotice` serves the list page; the limit screen states the sentence from the same catalog key**
- `EmptyState.body` is a string slot, so the component itself cannot be its body.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema. T-10-48: the API answers `limit_reached` and `403`; the form tests keep every value on both. T-10-49: the draft excludes member ids and the orderable read drops them. T-10-50: names render as React text.

## Open items for the orchestrator

- **`apps/web/app/(app)/stories/highlight-actions.test.ts` case 6** is the only red test in `apps/web` (8277 of 8278 pass); it stays red until plan 10-12.
- **"sai de Explorar" carry-forward from 10-11:** not reachable from this plan's files (none renders a post delete or removal body); the decision stays open for the orchestrator.
- **Plan 14 hand-off:** `CommunityForm` already takes `memberMode` for `editar` (it also hides the Acesso block there); `editar` redirects and the header byline are plan 14's. `communities.byline.*` keys were not added here.
- **One extra read for members with `manage_own`:** the chips probe (`status=archived&limit=1`) runs on every `/comunidades` visit for such a member. Cheap, but if the orchestrator wants it gone the quota would have to carry an `ownsArchived` flag (an API change, not made).
- **Backstop rows** (E06 overflow at 320px, E08 zero-one-many desktop grid) have no unit test by design; they are for the plan 15 visual tests.
- The sketch gate is a provisional approval (30ce8537); the sketch README and `.planning/sketches` were not edited. Nothing was pushed or deployed and no database command was run.

## Self-Check: PASSED

- FOUND: `CommunityLimitNotice.tsx`, `page.test.tsx`, `nova/page.test.tsx`, `community-card-byline.test.tsx`
- FOUND commits: `b8549bf3`, `3425f471`, `7cea3e0f`, `9bc2c702`, `c1ec2541`, `94f7b6bb`, `05f6fe30`
- `git rev-list --count 986329e04b97f7af8c6f63102788b45a1a069c1e..HEAD` = 7 before this SUMMARY commit
- No `Co-Authored-By` trailer and no tool attribution in any of the seven commits; `.planning/ROADMAP.md` and `.planning/STATE.md` not staged
