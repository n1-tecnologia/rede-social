---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 23
subsystem: web
tags: [web, profile-zone, member-row, enviar-mensagem, desbloquear, ui-gated, sketch-025, D-720, D-722, D-723, D-724, D-725, UI-D-867, UI-D-868]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plan 02 (approved sketch 025), plan 11 (canFollow, canMessage, blockedByViewer on the social reads), plan 18 (social catalog keys), plan 20 (unblockMember), plan 22 (/conversas/com/{membershipId}), plan 27 (membership-keyed unblock route)"
provides:
  - "the profile action zone: Seguir beside an outline Enviar mensagem link to /conversas/com/{membershipId}, stacked below 360px"
  - "the blocker's one-tap Desbloquear and the blocked member's empty zone"
  - "the /membros row message control (44px round outline link, MessageCircle) and the pair-closed row without controls"
  - "loadFollowStateWithFacts: one follow-state read answering the id -> boolean map and the finished facts per id"
affects: [11-24, 11-25]

plan_head_before: db1b4eae8948ce69422b3ce4e86e0d6826c96ab7
actuals:
  tokens: 60000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "The zone is driven by finished facts (canFollow, canMessage, blockedByViewer) plus the viewer's composed chat.direct; absent facts read as the shipped zone"
    - "A client component that needs the router for one branch isolates it in a child component (UnblockButton), so the shipped tests of the parent keep rendering without a router mock"
    - "A row control is an opt-in prop of the shared row (message, hideControls), so the two private follow lists are unchanged by construction"

key-files:
  created:
    - apps/web/components/social/MemberFollowRow.test.tsx
  modified:
    - apps/web/components/social/SocialCountsBlock.tsx
    - apps/web/components/social/SocialCountsBlock.test.tsx
    - apps/web/components/social/SocialProfileBlock.tsx
    - apps/web/components/social/SocialProfileBlock.test.tsx
    - apps/web/components/social/MemberFollowRow.tsx
    - apps/web/components/social/FollowControl.tsx
    - apps/web/components/social/FollowControl.test.tsx
    - apps/web/components/social/follow-actions.ts
    - apps/web/lib/social.ts
    - apps/web/lib/social.test.ts
    - apps/web/app/(app)/membros/MembersList.tsx
    - apps/web/app/(app)/membros/MembersList.rows.test.tsx
    - apps/web/app/(app)/membros/page.tsx
    - apps/web/app/(app)/membros/actions.ts
    - apps/web/app/(app)/membros/actions.test.ts

key-decisions:
  - "chat.direct is derived inside SocialProfileBlock from the composed permissions it already receives, so the profile page needs no edit"
  - "Seguir-only keeps the shipped structure byte for byte (full-width control with md:max-w-[400px]); the flex pair appears only when both controls apply"
  - "The pair-closed row (canFollow false) shows no controls and no slot content, so a blocked pair reads like a staff row; a missing or failed facts read keeps the shipped row with its w-24 slot"
  - "FollowControl gained an optional onFollowRefused, called only for a refused follow; the directory passes its shipped router refresh"
  - "The profile does not refresh after a refused follow (the plan names the directory row only); after Desbloquear it does, and the pair shows at once from local state until the facts arrive"

requirements-completed: [CHAT-06, CHAT-07]

duration: 55 min
completed: 2026-11-20

coverage:
  - id: D1
    description: "Another member's profile shows Seguir (brand) beside Enviar mensagem (outline link to /conversas/com/{membershipId}, aria-label naming the person), stacked below 360px with Seguir first, only with chat.direct and canMessage not false; facts absent reads as the shipped zone"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/components/social/SocialCountsBlock.test.tsx#Z1..Z7"
        status: pass
      - kind: unit
        ref: "apps/web/components/social/SocialProfileBlock.test.tsx#P1..P7"
        status: pass
    human_judgment: false
  - id: D2
    description: "The pending read draws skeleton blocks where the pair will be and a failed read keeps the inline line with no button"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/components/social/SocialProfileBlock.test.tsx#P5, P6"
        status: pass
    human_judgment: false
  - id: D3
    description: "The blocker sees one full-width outline Desbloquear (one request for a double tap, Desbloqueando… while pending, one success toast, then the pair as Seguir; changed false re-renders without a second toast; a failure keeps the button and toasts the generic error); the blocked member's zone renders no element, no text and no label"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/components/social/SocialCountsBlock.test.tsx#U1..U7"
        status: pass
      - kind: unit
        ref: "apps/web/components/social/SocialProfileBlock.test.tsx#P8"
        status: pass
    human_judgment: false
  - id: D4
    description: "The /membros row gets a 44px round outline message link left of Seguir for a chat.direct viewer; absent (not disabled) on the own row and on a pair with a block, where the row keeps its link; the two private follow lists get no control; a refused follow reverts, toasts the shipped sentence and refreshes"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/membros/MembersList.rows.test.tsx#R1..R9"
        status: pass
      - kind: unit
        ref: "apps/web/components/social/MemberFollowRow.test.tsx#F1..F4"
        status: pass
      - kind: unit
        ref: "apps/web/components/social/FollowControl.test.tsx#R1, R2"
        status: pass
      - kind: unit
        ref: "apps/web/components/social/no-follow-outside.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "The follow-state read carries the pair facts for the first page and for each Carregar mais page, one request per page, and an empty or failed answer leaves the shipped rows"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/lib/social.test.ts#S13..S16"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/membros/actions.test.ts#5..8"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual fidelity to sketch frames perfil-enviar-mensagem(-320), perfil-voce-bloqueou, perfil-sem-botoes, membros-linha-mensagem, membros-linha-320 and membros-linhas-estados (the 128px name link at 320px, the 148px cluster, the stacked pair below 360px)"
    verification: []
    human_judgment: true
    rationale: "Pixel geometry at 320 and 360px is a layout fact happy-dom cannot measure; the classes follow the UI-SPEC (min-[360px]:flex-row, size-11, w-24, min-w-0 flex-1) but no browser run was made. Joins the owed real-device walk."
---

# Phase 11 Plan 23: The two entry points to a conversation, the blocker's Desbloquear and the blocked member's silence Summary

A member now starts a direct conversation from another member's profile (an outline "Enviar mensagem" link beside Seguir, stacked below 360px) or from a round message control on each `/membros` row, the blocker lifts the block in one tap from the profile, and the blocked member's profile and directory row show nothing about it.

## What was built

- **Task 1 (3acc4e34, tracer).** `SocialCountsBlock` takes the optional `canFollow`, `canMessage`, `blockedByViewer` and `canChat` and draws the zone as `flex flex-col gap-2 min-[360px]:flex-row` with `md:max-w-[400px]`: the shipped `FollowControl` (`md`) and an outline `<a>` to `/conversas/com/{membershipId}` with `aria-label` "Enviar mensagem para {nome}". `SocialProfileBlock` derives `canChat` from the composed `chat.direct` permission it already receives, passes the facts through, and the Suspense fallback now draws two skeleton blocks where the pair will be. Facts absent reads as the shipped zone; Seguir-only keeps the shipped markup exactly.
- **Task 2 (23b0d81e).** `UnblockButton` (a child component, so the shipped parent tests keep rendering without a router): one outline full-width "Desbloquear", a ref guard plus the Button's loading state for the double tap, "Desbloqueando…", a success toast only when the API says `changed`, the pair back as "Seguir" (D-724) and a route refresh; a failure keeps the button and fires the generic feed error toast. The blocked member's answer (`canFollow` false, `canMessage` false, `blockedByViewer` false) renders no zone element at all. `follow-actions.ts` exposes `unblockMemberAction`, a thin wrapper over plan 20's `unblockMember`.
- **Task 3 (5381c356).** `loadFollowStateWithFacts` returns the follow map and the finished facts from one read (`loadFollowState` keeps its plain map for other callers); the `/membros` page and the load-more action carry the facts. `MemberFollowRow` gains the opt-in `message` (44px round outline link with `MessageCircle` 20, in a `flex shrink-0 items-center gap-2` cluster left of Seguir), `hideControls` (a pair with a block: the link only, no slot content) and `onFollowRefused`. `FollowControl` gained `onFollowRefused`, fired only for a refused follow; `MembersList` passes its shipped refresh, so a pair that became blocked loses its controls. The two private follow lists never pass `message`.

## Verification run

| Gate | Result |
|------|--------|
| UI gate `grep -q '^approved: true'` sketch 025 README | pass before each task |
| Targeted vitest (components/social, app/(app)/membros, lib/social) | 140/140 after Task 3 |
| `turbo test --filter=@rede-social/web` (TURBO_CACHE=local:r, concurrency 4) | 440 files, 10604 tests, all pass (EventsSections did not flake) |
| `turbo typecheck` web + module-social (runs `next build`) and api | clean |
| `pnpm lint` | 20/20 tasks; two pre-existing Biome format warnings in a feed test and a ui file, not touched here |
| `pnpm boundaries`, `scripts/check-ui-literals.sh`, `pnpm guard:lanes` | OK |
| `biome check` on every touched file | clean |
| `no-follow-outside.test.tsx` | passes unchanged |
| pgTAP, integration suites, db reset | not run: web-only plan, no SQL or API file changed |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `loadFollowState` could not carry the facts without breaking its callers' contract**
- **Found during:** Task 3
- **Issue:** the plan says the row reads "loadFollowState's facts", but the function returns an id -> boolean map used by the load-more action and its test (which pinned `following: { [ID]: true }` and mocked only `loadFollowState`).
- **Fix:** added `loadFollowStateWithFacts` (one read, `{ following, facts }`) and made `loadFollowState` a thin view over it; the page and the load-more action call the new function. `actions.test.ts` (listed neither in the plan's files nor as "unchanged" for Task 3's explicit criteria beyond "shipped membros tests") had its mock and four expectations updated to the new function and the added `facts` key.
- **Files modified:** `apps/web/lib/social.ts`, `apps/web/app/(app)/membros/actions.ts`, `apps/web/app/(app)/membros/actions.test.ts`
- **Commit:** 5381c356

**2. [Rule 3 - Scope] the plan named `page.tsx` of the profile for passing `chat.direct`; it was not edited**
- **Found during:** Task 1
- **Issue:** `SocialProfileBlock` already receives the composed `permissions`, so the boolean is derived there; editing the page would only add a redundant prop.
- **Fix:** derive `canChat` inside `SocialProfileBlock` from `CHAT_PERMISSIONS.direct`; the profile page and its test are untouched.

**3. [Rule 2 - Missing wiring] `FollowControl` had no refresh on a refused follow**
- **Found during:** Task 3
- **Issue:** UI-D-868 requires the revert, the shipped toast "and the shipped refresh", but the shipped control only reverted and toasted.
- **Fix:** an optional `onFollowRefused` callback (follow only, also for an action that never reached the server); `MembersList` passes its existing `refresh`.
- **Commit:** 5381c356

**Total deviations:** 3 (2 Rule 3, 1 Rule 2). **Impact:** none on behaviour beyond what the plan asked; the shipped tests of the social components and `no-follow-outside` pass unchanged, and only `actions.test.ts` of the membros tests was edited.

## Known limits

- The profile does not refresh after a refused follow (the plan scopes the refresh to the directory row); a pair that became blocked while the profile was open shows its buttons until the next navigation, and the API still refuses the follow with the bare 404.
- The rows of a member whose facts entry is missing (a failed batch read or an old API) show no message control; a present entry without the keys (an old API) shows it to a `chat.direct` viewer, as the profile does.
- Pixel geometry at 320 and 360px (D6) has no browser proof.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema: the screens read finished booleans the API already sends, and the unblock goes through plan 20's existing action. T-11-03 (no hint for the blocked member) is pinned by the empty-zone tests and the blocked-row test; T-11-16 holds because names appear only in `aria-label` and React text.

## Self-Check: PASSED

- Files exist: `apps/web/components/social/MemberFollowRow.test.tsx` and the 14 modified files listed above.
- Commits exist: 3acc4e34, 23b0d81e, 5381c356 (`git rev-list --count db1b4eae..HEAD` is 3 before this SUMMARY).
- Acceptance: `grep -c '^approved: true'` on the sketch README prints 1; `MessageCircle` is in `MemberFollowRow.tsx`; `canMessage` is in `lib/social.ts`; the blocked-zone tests assert no child, no text and no label; the double-tap test asserts one request.
