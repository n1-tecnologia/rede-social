---
phase: 03-media-pipeline-member-profiles
plan: 05
subsystem: ui
tags: [web, directory, search, keyset, pagination, nudge, next, playwright, pt-BR, accessibility]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "@rede-social/ui primitives (Avatar, Button, Card, EmptyState, Skeleton, IconButton, PageHeader, PullToRefresh, useDebounce), the pt-BR catalog loader + literal gate, the search-into-the-URL pattern of TenantToolbar, the keyset load-more pattern of TenantTable, the Playwright projects and throwaway-tenant fixtures"
  - phase: 03-media-pipeline-member-profiles
    provides: "03-03's GET /v1/members and GET /v1/members/{membershipId} with the opaque keyset cursor and one bare 404 for every miss; 03-04's ProfileHeader, MediaImage, the /v1/media BFF route, the profile pt-BR catalog (which already carried the nudge copy) and the 'Membros' row on /perfil"
provides:
  - "`/membros` — the tenant's active members, searchable by name with `?q=` as the source of truth and paginated by keyset 25 at a time, reached from a row on `/perfil` rather than a fifth nav tab"
  - "`/membros/[membershipId]` — another member's photo, display name and bio and NOTHING else, with the caller's own id redirecting to `/perfil` and one indistinguishable 404 for every miss"
  - "`SearchBar` in @rede-social/ui — the ported pill at 16px/`h-11`, controlled, caller-owned debounce; Phase 8's member management reuses it unchanged"
  - "`MemberRow` — the directory row (avatar + name + bio snippet + chevron), the author-row geometry Phase 4's post header inherits"
  - "`ProfileNudgeCard` + `dismissNudgeAction` — the D-02 first-access nudge with a server-state dismissal that cannot fail silently"
  - "`getMembers`/`loadMembers`/`loadMemberProfile` in `apps/web/lib/profile.ts` — the ONE members fetch, shared by the page and the pagination action"
  - "`PageHeader` gained an optional title (a screen whose only h1 is in its body) and `ProfileHeader` an optional `headingLevel`"
  - "`apps/web/e2e/members-admin.ts` — a throwaway community of 27 active members on a per-run host, plus a blocked and a soft-deleted membership for the 404 matrix"
affects: [03-06, 03-07, 03-08, phase-04-feed, phase-07-chat, phase-08-member-management]

actuals:
  tokens: 23567
  tasks: 3
  commits: 3
plan_head_before: d1ca877d8cfaf5c6ce4bc039e3c10467a98ff201

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sticky offsets are measured from the scrollport's PADDING box: `PageHeader`'s default `top` therefore pushes it down over the content below, so a screen that stacks two sticky bars must pin the first at `0px` and the second at the first's height"
    - "URL-as-source-of-truth search: the field is local state, debounced 300 ms into `router.replace` inside a transition; the transition's pending flag IS the loading state, and the server's fresh page re-seeds the list by adjusting state during render rather than in an effect"
    - "One fetch implementation shared by a page and its server action, so the first page and the 'load more' button cannot disagree about page size or query encoding"
    - "A malformed identifier is a MISS, not a server error: a 400 joins the 404s so every way of failing to reach a person renders one screen"
    - "No optimistic removal for a dismissal whose whole value is that it persists — the card leaves because the server re-rendered without it"
    - "Playwright fixtures that re-use a tenant HOST must give each run a fresh one: web and API both cache host→tenant for 60 s, and a re-used host points a fresh session at a deleted tenant"
    - "`test.use({ serviceWorkers: 'block' })` is required before any GET interception in this PWA — the service worker's own fetches are outside `page.route`"

key-files:
  created:
    - packages/ui/src/primitives/SearchBar.tsx
    - apps/web/components/profile/MemberRow.tsx
    - apps/web/components/profile/ProfileNudgeCard.tsx
    - apps/web/app/(app)/membros/page.tsx
    - apps/web/app/(app)/membros/loading.tsx
    - apps/web/app/(app)/membros/MembersList.tsx
    - apps/web/app/(app)/membros/MembersList.test.ts
    - apps/web/app/(app)/membros/actions.ts
    - apps/web/app/(app)/membros/[membershipId]/page.tsx
    - apps/web/app/(app)/membros/[membershipId]/loading.tsx
    - apps/web/app/(app)/membros/[membershipId]/not-found.tsx
    - apps/web/messages/pt-BR/members.json
    - apps/web/e2e/members.spec.ts
    - apps/web/e2e/members-admin.ts
  modified:
    - apps/web/lib/profile.ts
    - apps/web/app/(app)/inicio/page.tsx
    - apps/web/app/(app)/perfil/actions.ts
    - apps/web/components/profile/ProfileHeader.tsx
    - apps/web/e2e/admin.ts
    - packages/ui/src/index.ts
    - packages/ui/src/primitives/PageHeader.tsx
    - packages/ui/tests/button.test.tsx

key-decisions:
  - "`/membros` and `/membros/[id]` pass `stickyTop=\"0px\"` to `PageHeader`: CSS shrinks a sticky element's constraint rectangle by the scrollport's padding, so the primitive's default `calc(var(--safe-top) + 3rem)` pins the header 60px BELOW its natural position — over the content that follows. The literal UI-SPEC offset for the search pill would have put the z-40 header on top of the field."
  - "The members fetch has ONE implementation (`getMembers` in `lib/profile.ts`), shared by the page and `loadMoreMembersAction`, so the first page and 'Carregar mais' cannot drift on page size or on how `q` is encoded"
  - "A 400 from `GET /v1/members/{id}` maps to `notFound()`, not to the error screen: an id that is not a uuid is what a truncated URL produces, and D-23 wants one indistinguishable screen for every way of failing to reach a person"
  - "The E5/error backstop is closed with 'no optimistic removal + the generic error toast': a card that vanishes on click and returns on the next load reads as a bug AND re-nags"
  - "e2e throwaway tenants get a per-RUN host, because web and API each cache host→tenant for 60 s and a re-used host points a fresh session at a deleted tenant (`TENANT_HOST_MISMATCH` on every request)"
  - "The directory specs set `serviceWorkers: 'block'`: the PWA's service worker handles navigations itself and those requests are outside `page.route`, so GET interception silently no-ops without it"
  - "The 8-row skeleton SHAPE is pinned in a component test rather than in the browser: Next prefetches the `/membros` link, so the route-level `loading.tsx` never renders on a soft navigation from `/perfil`"
  - "`MembersList` re-seeds from the server's page by adjusting state during render (React's documented alternative to an effect), so a query change never paints the previous query's rows"

patterns-established:
  - "Pattern 1 (URL is the source of truth): the search field is local state debounced into `router.replace` inside a transition; the transition's pending flag is the loading state and the server's page is the list"
  - "Pattern 2 (opaque cursor): the cursor crosses the client boundary and comes back verbatim — never parsed, decoded or rebuilt on the web side"
  - "Pattern 3 (one screen per class of outcome): six ways to miss a member render one 404; a transport failure renders a different screen, and neither is ever dressed up as the other"

requirements-completed: [PROF-02, PROF-03, PROF-01]

coverage:
  - id: D1
    description: "`/membros` is reached from the 'Membros' row on `/perfil`, lists the tenant's active members and hides the community's staff entirely (D-47)"
    requirement: PROF-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#is reached from the \"Membros\" row on /perfil and hides the community staff (D-47)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Search is accent- and case-insensitive substring matching with `?q=` as the source of truth — `goncal` finds `João Gonçalves`, clearing restores the list and drops `q`, and nothing is highlighted (R-10, PROF-03)"
    requirement: PROF-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#an unaccented fragment finds an accented name, and the query lives in the URL (R-10)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#a member without a bio keeps a one-line row, and long values truncate inside it (asserts no `mark` element)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pagination is keyset at 25: 'Carregar mais' renders exactly while a cursor exists, APPENDS without re-ordering or replacing, and a real 27-member community proves page two carries no duplicate and skips nobody (R-11)"
    requirement: PROF-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#\"Carregar mais\" appends a real second page without duplicating, skipping or re-ordering"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#while \"Carregar mais\" is pending it says \"Carregando…\" and keeps the rows visible"
        status: pass
    human_judgment: false
  - id: D4
    description: "`/membros/[membershipId]` shows a photo, a display name (the screen's only 24px element and only h1) and a bio — no e-mail, no role, no follow, no message (PROF-02, D-45)"
    requirement: PROF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#opens from the directory row and shows a photo, a name and a bio — nothing else (D-45)"
        status: pass
      - kind: other
        ref: "grep -vE '^\\s*(//|\\*|/\\*)' 'apps/web/app/(app)/membros/[membershipId]/page.tsx' | grep -ci 'email' prints 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "The caller's own membershipId redirects to `/perfil` while the caller still appears unfiltered in their own directory list (UI-D-03)"
    requirement: PROF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#the caller's own membershipId redirects to /perfil (UI-D-03)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every miss — unknown uuid, a non-uuid, another tenant's id, a blocked and a soft-deleted membership — renders the SAME 'Membro não encontrado' screen, and the page text never names the other community (D-23, TENANT-04)"
    requirement: PROF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#every miss is ONE screen that never names the other community (D-23, TENANT-04) — five causes"
        status: pass
      - kind: other
        ref: "grep -vE '^\\s*(//|\\*|/\\*)' 'apps/web/app/(app)/membros/[membershipId]/not-found.tsx' | grep -cE 'searchParams|params|useSearchParams' prints 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "The directory renders every state the contract enumerates: two DISTINCT empties, eight skeleton rows on a query change, a retryable generic error that keeps the rows already on screen, single-line rows for members without a bio, CSS truncation for the longest allowed values, and a polite count in both singular and plural"
    requirement: PROF-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#the two empty states are distinct screens, not one string with a condition"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#a debounced query change renders exactly 8 skeleton rows over the previous list"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#a failed list request renders the generic error, and \"Tentar novamente\" re-issues it"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#the result count is announced politely, in the singular and in the plural"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/membros/MembersList.test.ts#renders EXACTLY eight rows, each an avatar circle over two text bars"
        status: pass
    human_judgment: false
  - id: D8
    description: "The route-level `loading.tsx` of both new routes renders the screen's shape rather than a spinner"
    requirement: PROF-03
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/membros/MembersList.test.ts#is what the route-level loading.tsx renders — one skeleton, not two lookalikes"
        status: pass
      - kind: other
        ref: "ls 'apps/web/app/(app)/membros/loading.tsx' 'apps/web/app/(app)/membros/[membershipId]/loading.tsx' — both present, both Skeleton-shaped"
        status: pass
    human_judgment: true
    rationale: "The eight-row shape and the fact that `loading.tsx` renders it are asserted deterministically, but a route-level loading UI only appears during a real navigation delay — and Next prefetches the `/membros` link, so on this app it does not appear at all on a soft navigation from `/perfil`. Whether it reads as the screen's shape on a slow connection is a visual judgment for the phase UAT."
  - id: D9
    description: "The D-02 nudge renders on `/inicio` BETWEEN the welcome block and `HomeSlots` while the member owes a photo or a bio, without suppressing the 'Em breve' empty state; 'Completar perfil' goes to the edit form and 'Agora não' writes server state that survives a new browser context (R-13, D-42)"
    requirement: PROF-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#is shown to a member who owes a photo or a bio, between the welcome block and the slots"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#is shown to a member who has only a bio (E5/partial), and never to one who has both"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#\"Agora não\" writes server state: it is gone on a NEW browser context too (R-13)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#\"Completar perfil\" goes to the edit form"
        status: pass
    human_judgment: false
  - id: D10
    description: "A FAILED dismissal leaves the card on screen and surfaces the generic error — the UI-SPEC's E5/error backstop, closed with an explicit behaviour instead of a silent optimistic removal"
    requirement: PROF-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/members.spec.ts#a FAILED dismissal keeps the card and says so — it never vanishes silently (E5/error)"
        status: pass
    human_judgment: false
  - id: D11
    description: "The `SearchBar` field is 16px at `h-11` (44px) with a clear control shown only when non-empty, and is fully controlled so the caller owns the debounce (UI-D-04)"
    verification:
      - kind: unit
        ref: "packages/ui/tests/button.test.tsx#SearchBar (3 cases: 44px/16px geometry, clear only when non-empty, controlled)"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/button.test.tsx#PageHeader (renders NO heading when the title is omitted)"
        status: pass
    human_judgment: false
  - id: D12
    description: "Every string on these screens comes from the pt-BR catalog, another member's name and bio are plain React text (no `dangerouslySetInnerHTML` anywhere on the path), and the repo's web gates stay green"
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh && pnpm --filter @rede-social/web build && bash scripts/check-static-routes.sh && pnpm boundaries"
        status: pass
      - kind: other
        ref: "grep -rn dangerouslySetInnerHTML apps/web/components/profile/ 'apps/web/app/(app)/membros/' — one hit, in a docblock saying there is none"
        status: pass
    human_judgment: false

# Metrics
duration: 57 min
completed: 2026-09-22
status: complete
---

# Phase 03 Plan 05: Member Directory, Member Profile and the D-02 Nudge Summary

**A member opens `/membros` from their own profile, types `goncal` into a 44px search pill whose value lives in the URL, finds `João Gonçalves` among their community's active members with the staff absent, loads the next 25 by cursor, and taps through to a screen that shows a photo, a name and a bio and nothing else — while a member who has not finished their own profile is invited once, from a card on `/inicio` whose "Agora não" writes server state and cannot fail silently.**

## Performance

- **Duration:** 57 min
- **Started:** 2026-09-22T00:44:01Z
- **Completed:** 2026-09-22T01:40:43Z
- **Tasks:** 3
- **Files modified:** 22

## Accomplishments

- **The directory is real, not a list.** `?q=` is the source of truth (back/forward restore it), matching is the API's accent- and case-insensitive substring, pagination is keyset at 25 with an opaque cursor the web side never parses, and a throwaway 27-member community proves page two appends without a duplicate, a gap or a re-order.
- **Every enumerated state ships.** Two distinct empties, eight skeleton rows on a query change, a retryable error that keeps the rows already on screen, single-line rows for members without a bio, CSS truncation for the longest name and bio the edit form allows, and a polite result count in both singular and plural.
- **Six ways to miss a member render one screen.** Unknown id, a non-uuid, another tenant's id, invited, blocked, soft-deleted — `not-found.tsx` takes no props and reads no param, so it cannot echo an id or name a tenant. A transport failure renders a *different* screen, so "we could not reach the server" is never dressed up as "this person is not in your community".
- **The nudge closes its own backstop.** The UI-SPEC left "what happens when the dismissal fails" unspecified. The card removes nothing optimistically: a failed "Agora não" leaves it on screen with the generic error toast, and a held-out Playwright case forces the 500 and asserts both halves.
- **Two ported components later phases inherit.** `SearchBar` is Phase 8's member-management search as shipped; `MemberRow`'s avatar+name+snippet geometry is the author row Phase 4's post header reuses, and `MembersList`'s cursor loop is the pagination shape the feed inherits.
- **The one-wave dead link is closed.** `/perfil`'s "Membros" row now goes somewhere (`.planning/WINDOWS.md` entry 11 → `fixed`).

## Task Commits

1. **Task 1 (tracer): SearchBar, MemberRow, `/membros`, `/membros/[membershipId]`, the members catalog and the first Playwright path** — `526593b` (feat)
2. **Task 2: every directory state, the 27-member fixture, both loading shells and the one 404** — `bfa090e` (feat)
3. **Task 3: the D-02 nudge, `dismissNudgeAction` and the held-out failure test** — `9a81916` (feat)

**Plan metadata:** see the `docs(03-05)` commit.

## Files Created/Modified

- `packages/ui/src/primitives/SearchBar.tsx` — the ported pill: 16px text at `h-11`, leading `Search` 18, a 44×44 clear `IconButton` shown only when the value is non-empty, controlled with a caller-owned debounce
- `packages/ui/src/primitives/PageHeader.tsx` — `title` is now optional, for a screen whose single `h1` lives in its body
- `apps/web/components/profile/MemberRow.tsx` — `UserListItem` minus `FollowButton` and minus the `@handle` line, whose slot carries the bio's first line (UI-D-02); the whole row is one `<Link>`
- `apps/web/components/profile/ProfileHeader.tsx` — optional `headingLevel` so the member profile's name is its `h1`
- `apps/web/components/profile/ProfileNudgeCard.tsx` — the D-02 card: brand "Completar perfil", one ghost "Agora não", no `X` glyph, no optimistic removal
- `apps/web/app/(app)/membros/{page,loading,MembersList,actions}.tsx|ts` — the directory and its cursor action
- `apps/web/app/(app)/membros/MembersList.test.ts` — the eight-row skeleton shape, shared by `loading.tsx` and the pending state
- `apps/web/app/(app)/membros/[membershipId]/{page,loading,not-found}.tsx` — the member profile, its skeleton and the one 404
- `apps/web/app/(app)/inicio/page.tsx` — the nudge's composition point, between the welcome block and `HomeSlots`
- `apps/web/app/(app)/perfil/actions.ts` — `dismissNudgeAction`
- `apps/web/lib/profile.ts` — `getMembers`, `loadMembers`, `loadMemberProfile` and a shared `apiError` reader
- `apps/web/messages/pt-BR/members.json` — the `members` root key
- `apps/web/e2e/{members.spec.ts,members-admin.ts,admin.ts}` — 25 browser cases across both projects plus the 27-member fixture

## Decisions Made

See `key-decisions` in the frontmatter. The three a later reader will need:

1. **`PageHeader`'s default sticky offset pushes it DOWN over the content below it.** CSS shrinks a sticky element's constraint rectangle by the scrollport's padding, so `top: calc(var(--safe-top) + 3rem)` against a scroll container already padded by `3.5rem` pins the header 60px below its natural position. On `/perfil` that is invisible; on `/membros`, where a second sticky bar follows, it put the z-40 header on top of the search field and made "Limpar busca" untappable the moment the list was scrolled. Both new routes pass `stickyTop="0px"` and the pill pins at the header's height.
2. **A Playwright fixture must not re-use a tenant HOST across runs.** Web and API each cache host→tenant for 60 s, so re-creating one slug under a new tenant id points a fresh session at the tenant the previous run deleted, and every request is refused with `TENANT_HOST_MISMATCH` — which the screens turn into a bounce to `/entrar`. Which tests survive then depends on where the 60 s window falls. Every run now gets a fresh host, and a sweep removes leftovers.
3. **`page.route` cannot see a request this app's service worker makes.** Every GET interception in the directory specs silently no-opped until `test.use({ serviceWorkers: 'block' })` was added; POSTs (the server actions) were never affected, which is why the forced-500 case worked while the timing ones did not.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The pinned `PageHeader` covered the sticky search field**

- **Found during:** Task 1 (the first Playwright run)
- **Issue:** The UI-SPEC specifies the search block as `sticky top-[calc(var(--safe-top)+3rem)]` — the same offset `PageHeader` already uses. Because sticky offsets are measured from the scrollport's *padding* box, both bars pin to the same y and the z-40 header sits on top of the z-30 field: "Limpar busca" is unclickable on any scrolled phone. Measured in the browser: header `[128, 180]`, search `[180, 244]`, row `[184, 248]`.
- **Fix:** both new routes pass `stickyTop="0px"` to `PageHeader` (pinning it where it already sits in normal flow) and the search pill pins at `top-[3.25rem]`, the header's exact height. `PageHeader` gained an optional `title` for the member profile at the same time.
- **Files modified:** `packages/ui/src/primitives/PageHeader.tsx`, `apps/web/app/(app)/membros/page.tsx`, `apps/web/app/(app)/membros/MembersList.tsx`, `apps/web/app/(app)/membros/[membershipId]/page.tsx`
- **Verification:** the search/clear case passes on `mobile-chromium` and `desktop-chromium`.
- **Committed in:** `526593b`

**2. [Rule 2 - Missing critical] A malformed `membershipId` had its own screen**

- **Found during:** Task 2 (the 404 matrix)
- **Issue:** `GET /v1/members/{id}` answers `400 VALIDATION_FAILED` for an id that is not a uuid — which is exactly what a truncated or hand-typed URL produces. That fell through to "Algo deu errado", so the member could tell a well-formed-but-unknown id (404) from a malformed one (400). D-23 asks for ONE indistinguishable screen.
- **Fix:** `loadMemberProfile` maps 400 to `not-found` alongside the 404. The error screen is now reserved for a transport or 5xx failure, which is a genuinely different thing.
- **Files modified:** `apps/web/lib/profile.ts`
- **Verification:** the 404 matrix covers five causes including `nao-e-um-id` and asserts the body names no tenant.
- **Committed in:** `bfa090e`

**3. [Rule 3 - Blocking] The e2e fixture's tenant host collided with the 60 s host caches**

- **Found during:** Task 2 (six of eight new cases failed, deterministically by position, landing on `/entrar`)
- **Issue:** `beforeAll` re-created one fixed slug per project, so a fresh session minted for the new tenant id met a cached mapping for the deleted one → `TENANT_HOST_MISMATCH` on every request.
- **Fix:** `membersTenantSlug()` stamps the slug per run, and `sweepMembersTenants()` removes leftovers from crashed runs.
- **Files modified:** `apps/web/e2e/members-admin.ts`, `apps/web/e2e/members.spec.ts`
- **Verification:** 5 of the 6 recovered immediately; the remaining two were the separate issues below.
- **Committed in:** `bfa090e`

**4. [Rule 3 - Blocking] `page.route` never saw the RSC navigations**

- **Found during:** Task 2 (the skeleton assertions saw zero rows even with a 3 s delay installed)
- **Issue:** the PWA's service worker handles navigations, and requests a service worker makes are outside `page.route`. The interception silently no-opped, so the "loading state" assertions were passing or failing by luck rather than by behaviour.
- **Fix:** `test.use({ serviceWorkers: 'block' })` on both new describes.
- **Files modified:** `apps/web/e2e/members.spec.ts`
- **Verification:** the query-change skeleton now renders exactly 8 rows for the full 2 s the response is held.
- **Committed in:** `bfa090e`

**5. [Rule 1 - Bug] The throwaway-tenant teardown could not delete a tenant with a photo**

- **Found during:** Task 3 (the nudge fixture gives one member an avatar)
- **Issue:** `media_assets.tenant_id` does not cascade, so `delete from tenants` failed and every later run would have inherited the leftovers.
- **Fix:** `deleteMembersTenant` clears `member_profiles.avatar_asset_id` and the tenant's `media_assets` first.
- **Files modified:** `apps/web/e2e/members-admin.ts`
- **Committed in:** `9a81916`

### Plan assumptions corrected

**6. [Rule 1] The first-load skeleton is not observable in a browser on this app**

- The plan asks the e2e to prove "8 skeleton rows on the FIRST load". Next prefetches the `/membros` link on `/perfil`, so the payload is already in the router cache when the member clicks and the route-level `loading.tsx` never renders; delaying the prefetch just makes the router hold the old page instead. The eight-row shape and the fact that `loading.tsx` renders *that* skeleton (rather than a lookalike that can drift) are pinned deterministically in `MembersList.test.ts`; the browser proves the query-change skeleton, which is genuinely reachable. Recorded as `human_judgment: true` on coverage D8.

**7. [Rule 1] A 60-character name does not overflow a 680px desktop column**

- The plan asks for `scrollWidth > clientWidth` on BOTH row spans. The 150-character bio overflows at every breakpoint; the 60-character name only overflows on the phone — on desktop it fits, and asserting otherwise would be asserting that the desktop column is too narrow for a value the edit form explicitly allows. The case now asserts that *neither* line wraps (each stays one line tall, at both breakpoints) and that the bio really is clipped.

### Acceptance criteria read for intent

Two criteria were satisfied for intent rather than byte-literally, and both are recorded here rather than silently passed:

- **`MemberRow` "grep -cE 'FollowButton|Seguir|@[a-z]' prints 0".** The criterion's own parenthetical says the pattern is written "so `@rede-social/ui` imports are not matched", but `@[a-z]` matches `@rede-social`. The two hits in the file are the `@rede-social/contracts/media` and `@rede-social/ui` import lines and nothing else; with import lines stripped as well as comments the count is **0**. There is no `FollowButton`, no "Seguir" and no handle slot.
- **`actions.ts` "contains `apiFetch(`".** The same plan requires ONE shared implementation of the members fetch, which lives in `lib/profile.ts`. The action calls it through `getMembers`; the literal `apiFetch('/v1/members?…')` appears in the action's docblock naming where the request is made. Duplicating the call to satisfy the grep would have broken the stronger requirement.
- **`SearchBar` "contains `text-16`".** `text-16` is the UI-SPEC's shorthand for 16px, not a utility this repo defines — `Input` and `Textarea` ship 16px as `text-base`. The field uses `text-base` and the docblock names the spec token; the companion criterion (`text-sm` count is 0, comments stripped) confirms it is not the prototype's 14px.

---

**Total deviations:** 7 (2 bugs, 1 missing-critical, 2 blocking test-harness issues, 2 plan assumptions corrected)
**Impact on plan:** No scope creep. Items 1–2 are member-visible correctness — a search field that cannot be cleared and a 404 that leaks whether an id was well-formed. Items 3–5 are the difference between a suite that proves the feature and one that passes by luck. Items 6–7 replace assertions whose premises are unreachable or false with assertions that are true at both breakpoints.

## Issues Encountered

- **The verify chain hid a lint failure once.** `pnpm ... lint 2>&1 | tail -2 && …` takes the exit status of `tail`, not of `lint`, so a formatting error slipped into the first Task 1 commit and was caught only when lint was re-run alone. The commit was amended before anything downstream depended on it; every gate after that was run for its exit code, never through a pipe.
- **Next's dev server logs a recurring `unhandledRejection: Cannot read properties of undefined (reading 'waiting')`** whenever a spec runs with `serviceWorkers: 'block'`. It comes from the service-worker registration path in the app shell and does not fail any assertion; noted for 03-08 rather than fixed here (it is Phase 2 PWA code, outside this plan's blast radius).

## Known Stubs

None. Every surface this plan declares renders real data from the 03-03 routes.

## Threat Flags

None. The plan's own register covers this surface: another member's name and bio are plain React text (T-03-31 — the only `dangerouslySetInnerHTML` occurrence on the path is a docblock saying there is none), `not-found.tsx` takes no props and reads no param (T-03-32), the cursor is forwarded verbatim and never parsed on the web side (T-03-34), staff are absent by predicate and no row is conditioned on a role because the payload has none (T-03-35), and the nudge dismissal cannot fail silently (T-03-36). No package was installed (T-03-SC).

## User Setup Required

None — no external service configuration.

## Next Phase Readiness

- **03-06** runs next (wave 5) and does `pnpm db:reset && pnpm db:seed`; this plan's specs provision and tear down their own tenants, so nothing here depends on surviving that.
- **03-07 (admin media)** reuses `useSignedUpload` and the media catalog unchanged; its list can reuse `MembersList`'s cursor loop shape (`E6/zero-one-many` names the same contract).
- **03-08 (phase exit gate):** `members.spec.ts` adds 25 browser cases (~50 s across both projects) and `members-admin.ts` provisions ~34 identities per project in `beforeAll` — budget roughly two minutes for this spec alone.
- **Phase 4 (feed):** `MemberRow`'s geometry is the post author row; swapping "Carregar mais" for infinite scroll needs no contract change.
- **Watch:** `PageHeader`'s default `stickyTop` pushes the header 60px over the content on every screen that uses it. `/perfil`, `/perfil/editar` and the platform tabs all inherit that today; only `/membros` was affected enough to matter. Worth a deliberate look in 03-08's UI review rather than a silent global change here.

## Self-Check: PASSED

- All 14 files in `key-files.created` exist on disk (`[ -f ]`), and all 8 in `key-files.modified`.
- All three task commits exist in `git log` (`526593b`, `bfa090e`, `9a81916`); `git rev-list --count d1ca877..HEAD` = 3, matching `actuals.commits`.
- Every task's `<acceptance_criteria>` re-run mechanically: green, with the three intent-level readings documented above.
- Plan-level `<verification>` re-run at HEAD: `@rede-social/ui` typecheck + test (42), `@rede-social/web` typecheck + lint + test (82), `check-ui-literals`, `next build`, `check-static-routes`, `pnpm boundaries`, `@rede-social/core` typecheck, and `playwright test members.spec.ts profile.spec.ts` — **50 passed** across `mobile-chromium` and `desktop-chromium`.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-22*
