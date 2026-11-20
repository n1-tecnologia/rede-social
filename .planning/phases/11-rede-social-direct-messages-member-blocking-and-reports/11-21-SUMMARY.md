---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 21
subsystem: ui
tags: [web, notification-rows, bell, social-followed, moderation-report, sketch-025, D-727, D-729, UI-D-875]

requires:
  - phase: 11-02
    provides: the approved sketch 025 (UI gate)
  - phase: 11-11
    provides: the `social.followed` notification kind and its `membershipId` fact
  - phase: 11-17
    provides: the `moderation.report_created` kind (ids-only facts, moderators only)
  - phase: 11-18
    provides: the catalog keys `kinds.socialFollowed` and `kinds.moderationReport`
provides:
  - web renderer for `social.followed` (follower avatar, UserPlus badge, tap opens the follower's profile)
  - web renderer for `moderation.report_created` (actor-less Flag disc, fixed sentence, tap opens the reports queue)
  - UserPlus and Flag as names in the notifications module's by-name glyph map
affects: [11-22+, the /configuracoes/denuncias queue page (a tap target only until its plan ships)]

plan_head_before: 4940c056c9caea1a25a5e8d166dd44e197fa1c60
actuals:
  tokens: 14000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A renderer builds a URL from a fact only through a canonical lowercase uuid regex, then encodeURIComponent"
    - "An actor-less moderation row reads no fact at all (constant sentence, constant href)"

key-files:
  created:
    - apps/web/lib/notification-renderers.phase11.test.tsx
  modified:
    - apps/web/lib/notification-renderers.tsx
    - packages/modules/notifications/ui/NotificationItem.tsx
    - packages/modules/notifications/tests/notification-item.test.tsx

key-decisions:
  - "The follow row's profile link requires the canonical LOWERCASE uuid form; an uppercase uuid degrades to /membros like any other non-canonical id (the plan says only the canonical form builds a URL)"
  - "The report row's tap target is the constant /configuracoes/denuncias; the queue page ships in a later plan, so until then a tap lands on the shell's not-found (no data is revealed either way)"

patterns-established:
  - "Phase 11 bell kinds are added as small per-module renderer maps (socialRenderers, moderationRenderers) spread into notificationRenderers, beside chatRenderers"

requirements-completed: [CHAT-06, MODER-05]

duration: 9min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 21: The two new bell rows Summary

**Bell rows for "{actor} começou a te seguir." (opens the follower's profile only for a canonical uuid) and "Nova denúncia para analisar." (actor-less Flag disc, reads no fact, opens the reports queue), both in the shipped notification anatomy.**

## Performance

- **Duration:** about 9 min
- **Started:** 2026-11-19T22:08Z
- **Completed:** 2026-11-19T22:15Z
- **Tasks:** 2
- **Files modified:** 4 (1 created)

## Accomplishments
- `social.followed` renders the follower's avatar with the `UserPlus` badge and the catalog sentence with the actor as bold React text; the link is `/membros/{membershipId}` for a lowercase canonical uuid and `/membros` otherwise (missing, empty, non-string, `../x`, uppercase, padded, query-suffixed ids all degrade).
- `moderation.report_created` renders the 40px `Flag` disc (stays a disc even if a forged row names an actor), the fixed sentence with `Nova denúncia` in bold, and always links to `/configuracoes/denuncias`; a test feeds forged facts and an actor name and asserts none of it reaches the output.
- `NotificationItem`'s by-name glyph map gains `UserPlus` and `Flag`; the module still names no producer; shipped glyphs, rows and the generic fallback are unchanged.

## Task Commits

1. **Task 1: follow and report renderers, glyph names (tracer)** - `eb35115a` (feat)
2. **Task 2: degradation, long RTL name, hostile ids, unchanged list** - `17c67888` (test)
3. **Type fix for Task 2's own test (scalar facts)** - `65d3dc3a` (fix)

**Plan metadata:** the commit that adds this file (docs).

## Files Created/Modified
- `apps/web/lib/notification-renderers.tsx` - `socialRenderers` and `moderationRenderers`, `followerHref`, spread into `notificationRenderers`
- `apps/web/lib/notification-renderers.phase11.test.tsx` - 13 cases on the real pt-BR catalog (rows, hrefs, hostile input, list order)
- `packages/modules/notifications/ui/NotificationItem.tsx` - `UserPlus` and `Flag` in `GLYPHS`
- `packages/modules/notifications/tests/notification-item.test.tsx` - the `Flag` disc case and the `UserPlus` badge case

## Decisions Made
- Lowercase-only uuid regex (see key-decisions). No new catalog key was added; the two keys of plan 11-18 were used.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test typed non-scalar facts**
- **Found during:** final typecheck (`next build` type-checks test files)
- **Issue:** the hostile-id loop in my own test passed an object and an array as a fact; `NotificationRow['facts']` only allows scalars
- **Fix:** limited the non-string cases to `42`, `true`, `null`
- **Files modified:** `apps/web/lib/notification-renderers.phase11.test.tsx`
- **Committed in:** `65d3dc3a`

**Test-first note:** Task 1's tests were written first and failed (4 web, 2 module) before the implementation. Task 2's added cases passed against the Task 1 implementation (the safe-degradation behaviour was built in), so the only failures there were two mistakes in the new tests themselves (an all-digit uuid whose upper case is identical, and an anchor regex that also matched the avatar `<img>` link), both fixed in the test.

**Total deviations:** 1 auto-fixed (Rule 1). **Impact:** none on scope.

## Known Stubs

None. One forward reference: `/configuracoes/denuncias` is the constant tap target of the report row; its page belongs to a later plan of this phase (the plan names it as a constant). Until then the tap lands on the app's not-found; nothing is revealed.

## Issues Encountered

None.

## Verification Run

- Guard `grep '^approved: true'` on sketch 025: passes (approved by Igor on 2026-11-19; not edited).
- `pnpm lint`: passes. `biome check` on the four touched files: clean.
- `pnpm --filter @rede-social/web exec vitest run lib "app/(app)/notificacoes"`: 123 files, 2763 tests passed.
- `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --filter=@rede-social/module-notifications --concurrency=4`: web 432 files / 10474 tests passed (the Phase 10.2 EventsSections flake did not occur); notifications module suite passed.
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-notifications --filter=@rede-social/api --concurrency=4`: 5/5 tasks, includes the web `next build` (no `node:fs` leak from the contracts imports).
- `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm guard:lanes`: all OK.
- No database command, no integration suite, no hosted project touched.

## Threat Flags

None. The mitigations for T-11-16, T-11-12 and T-11-37 are in place and asserted by tests (React-text actor, canonical-uuid-only URLs, fixed report sentence reading no fact; the queue's own `notFound()` guards the tap).

## Next Phase Readiness

Both bell kinds now render. The reports queue page at `/configuracoes/denuncias` must exist for the report row's tap to open anything. The held-out visual check (E10 overflow, a 60-character actor name at 320px) is a backstop item for a browser pass; the unit test only proves the sentence stays intact.

## Self-Check: PASSED

- Files exist: renderers file, phase11 test, `NotificationItem.tsx`, the module test.
- Commits found: `eb35115a`, `17c67888`, `65d3dc3a`.
- Acceptance greps (`UserPlus` in `NotificationItem.tsx`, `moderationReport` in the renderers) pass.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*
