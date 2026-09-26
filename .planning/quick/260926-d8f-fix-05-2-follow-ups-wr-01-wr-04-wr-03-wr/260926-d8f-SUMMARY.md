---
phase: quick-260926-d8f
plan: 01
subsystem: stories
status: complete
tags: [postgres, hono, nextjs, route-handler, server-actions, vitest, testing-library, i18n, stories, highlights]
requires: [05.2 story highlights (shipped)]
provides:
  - item cap counts live stories only; ghost items removable (WR-01)
  - one bounded seen batch per action call (WR-04, T-05.2-48)
  - page-hide seen flush via sendBeacon / fetch keepalive to POST /api/stories/views (WR-07, T-05.2-57)
  - place-cap and item-cap copy for `full` refusals (WR-03)
  - "Criar destaque" CTA as next/link to the origin place's manage screen
affects: [05.2-VALIDATION.md, 05.2-SECURITY.md]
tech-stack:
  added: []
  patterns:
    - "one shared dedupe-then-cap helper (parseSeenBatch) for both public doors to the same API write"
    - "same-origin route handler: Origin host vs x-forwarded-host ?? host, then getClaims, then size + schema"
key-files:
  created:
    - apps/web/lib/seen-batch.ts
    - apps/web/lib/seen-batch.test.ts
    - apps/web/app/api/stories/views/route.ts
    - apps/web/app/api/stories/views/route.test.ts
    - apps/web/components/stories/HighlightManager.test.tsx
  modified:
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/tests/events.test.ts
    - apps/api/tests/integration/stories.test.ts
    - apps/web/app/(app)/stories/story-actions.ts
    - apps/web/app/(app)/stories/story-actions.test.ts
    - apps/web/components/stories/StoriesSurface.tsx
    - apps/web/components/stories/StoriesSurface.test.tsx
    - apps/web/components/stories/HighlightManager.tsx
    - apps/web/components/stories/StoryViewerHost.tsx
    - apps/web/components/stories/StoryViewerHost.test.tsx
    - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
    - apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/messages/pt-BR/stories.json
    - apps/web/i18n/messages.test.ts
    - .planning/phases/05.2-story-highlights/05.2-VALIDATION.md
    - .planning/phases/05.2-story-highlights/05.2-SECURITY.md
decisions:
  - "The highlight item cap counts LIVE stories (join stories, count filter deleted_at is null); `present` stays over all rows so a repeat add is still the idempotent 200"
  - "removeStoryFromHighlight resolves the story tenant-scoped without the liveness predicate, so a ghost item is removable; deleteStory unchanged"
  - "markStoriesSeenAction refuses more than STORY_SEEN_BATCH_MAX unique ids instead of chunking; the page-hide route shares the same parseSeenBatch"
  - "The page-hide flush uses sendBeacon (text/plain Blob) with fetch keepalive as fallback, to a same-origin route handler that forwards via markStoriesSeen/apiFetch"
metrics:
  duration: "~10 min"
  completed: 2026-09-26
actuals:
  tokens: 21253
  tasks: 3
  commits: 6
plan_head_before: 786cd45ec70ef429d9be27544741127f1983ea1b
---

# Quick 260926-d8f: 05.2 follow-ups WR-01 / WR-04 / WR-07 / WR-03 / Criar destaque Summary

Fixed five 05.2 findings, each with a test observed red before its fix. The highlight item cap now counts only live stories, and a ghost item can be removed (integration 05.2-33/34). The seen action makes at most one API call. The page-hide seen flush goes through `sendBeacon` to a new same-origin, session-checked `POST /api/stories/views`. Both `full` refusals now show their own cap in pt-BR. "Criar destaque" is a `next/link` to the manage screen of the place the viewer was opened from.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 RED | f3e3b79 | test(quick-260926-d8f): add red WR-01 cases 05.2-33 and 05.2-34 for ghost highlight items |
| 1 GREEN | fb5c5ca | fix(quick-260926-d8f): count only live stories against the highlight item cap and let a ghost item be removed (+ 05.2-VALIDATION.md) |
| 2 RED | 72b21c6 | test(quick-260926-d8f): add red WR-04/WR-07 cases for the bounded seen batch and the page-hide beacon |
| 2 GREEN | acf2201 | fix(quick-260926-d8f): bound the seen action to one API call and send the page-hide flush by beacon (+ 05.2-SECURITY.md) |
| 3 RED | 732d39a | test(quick-260926-d8f): add red WR-03 and Criar destaque cases |
| 3 GREEN | 1a23355 | fix(quick-260926-d8f): name the place and item caps on full refusals and send Criar destaque to the origin place |

## RED evidence (before each fix)

- **Task 1**, `pnpm --filter @tria/api exec vitest run tests/integration/stories.test.ts -t "05.2-3[34] "` gave 2 failed / 74 skipped:
  - 05.2-33 failed at `expect(accepted.status).toBe(200)`: it received **400** (full) for a live story added to 100 rows holding 1 ghost.
  - 05.2-34 failed at `expect(removed.status).toBe(200)`: it received **404** when removing the ghost item.
- **Task 2** (4 files): 4 failed files, 2 failed tests / 3 passed.
  - A3 expected false and received true (the old code chunked the list).
  - A5 expected 1 apiFetch call and got 2.
  - `seen-batch.test.ts`, `route.test.ts` and `StoriesSurface.test.tsx` failed on the missing modules `./seen-batch`, `./route` and `@/lib/seen-batch`.
- **Task 3** (4 files): 6 failed / 244 passed.
  - The `placeFull` key was missing (2 cases).
  - M1 had no placeFull toast.
  - P9 and P10 received `publish.errors.failed`.
  - Case 26 received `/stories/destaques` where `/comunidades/{id}/destaques` was expected.
  - M2 and M3 passed from the start, as intended: they pin the existing archived and generic behaviour.
- The raw Vitest output is in the session scratchpad (`t1-red.txt`, `t2-red.txt`, `t3-red.txt`). It is not committed, and no TAP counts were fabricated.

## Green runs (after)

| Command | Result |
|---------|--------|
| `vitest run tests/integration/stories.test.ts -t "05.2-3[0-9]"` (api) | 5 passed (05.2-30..34) |
| `vitest run tests/integration/stories.test.ts -t "05.2-(9\|12\|29) "` (api) | 3 passed |
| `vitest run tests/integration/isolation.test.ts -t "b7. highlights"` (api) | 1 passed |
| `@tria/module-stories` typecheck + lint + test | pass; 135/135 |
| `@tria/api` typecheck + lint; `pnpm --filter @tria/api test` (unit) | pass; 16/16 |
| `@tria/web` typecheck + lint | pass |
| `vitest run lib/seen-batch.test.ts app/api/stories/views/route.test.ts "app/(app)/stories/story-actions.test.ts" components/stories` (web) | 51/51 |
| `vitest run components/stories "app/(app)/stories" lib/story-view.test.ts i18n/messages.test.ts` (web) | 337/337 |
| `pnpm --filter @tria/web test` (all web unit) | 441/441 in 25 files |
| `bash scripts/check-ui-literals.sh` | OK |
| `TURBO_CACHE=local:r pnpm lint` | exit 0 |
| `TURBO_CACHE=local:r pnpm boundaries` | no issues (580 files, 9 packages) |
| `git diff --stat 786cd45..HEAD -- '**/package.json' pnpm-lock.yaml` | empty |
| `git status --porcelain -- supabase/migrations` | empty |

The full integration suite and e2e were not re-run. That needs `pnpm db:reset`, which the plan forbids because it wipes local data. No failure outside this plan's cases was seen.

## Phase-doc reconciliation

- **05.2-VALIDATION.md**
  - The WR-01 row is now green, with the `05.2-3[0-9]` command and 05.2-33/34.
  - The escalated manual-only row was removed.
  - A follow-up audit section was added (gaps 0, resolved 1, escalated 0).
  - `nyquist_compliant: true`; the sign-off is ticked and the approval line updated. `grep -c '| ❌'` now returns 0.
- **05.2-SECURITY.md**
  - T-05.2-48 is closed, with the new evidence.
  - A trust-boundary row was added for the beacon route.
  - T-05.2-57 is registered and closed.
  - Frontmatter is now 58/58/0/0.
  - The WR-01 and WR-07 residuals are marked resolved, and a new audit-trail row was added.

## Deviations from Plan

1. **[Rule 1 - Bug] The room-count regex in `events.test.ts` was pulled out into a `ROOM_COUNT` const.** Biome wrapped the long inline regex into an unreadable multi-line `if`. The regex text is exactly what the plan specifies. Files: `packages/modules/stories/tests/events.test.ts`. Commit: fb5c5ca.
2. **Test detail: the Blob type is asserted lower-cased (`text/plain;charset=utf-8`).** The Blob constructor normalises `type` to lower case under the File API spec. The code sends `text/plain;charset=UTF-8` as the plan says, and the fetch-fallback header is asserted with the original casing.
3. **The route's actual-body size check uses UTF-8 byte length (`TextEncoder`), not `text.length`.** This makes the 4 KiB cap a real byte cap for non-ASCII bodies (hardening, Rule 2). Files: `apps/web/app/api/stories/views/route.ts`. Commit: acf2201.
4. **`next/link` needed no mock under happy-dom.** Case 26 renders the real `Link`, and the plan's optional `vi.mock('next/link')` was not added.
5. **The `markStoriesSeenAction` docblock header was also updated.** It said the action flushes "when the page hides", which is no longer true; the page-hide flush now goes through the beacon route.

Everything else was executed as written. `deleteStory` is untouched; ROADMAP, VERIFICATION, UAT, REVIEW and UI-REVIEW are untouched; no package installs; no migrations.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. The one new network endpoint, `POST /api/stories/views`, is registered as T-05.2-57 in 05.2-SECURITY.md, with tests R1-R6.

## Self-Check: PASSED

- All five created files exist on disk.
- Commits f3e3b79, fb5c5ca, 72b21c6, acf2201, 732d39a and 1a23355 are present in `git log`.
- `git rev-list --count 786cd45..HEAD` = 6.
