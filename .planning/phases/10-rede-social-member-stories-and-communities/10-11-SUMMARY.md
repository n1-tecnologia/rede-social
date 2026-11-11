---
phase: 10-rede-social-member-stories-and-communities
plan: 11
subsystem: web
tags: [member-stories-communities, web, platform-panel, moderation-log, audience-badge, tracer, UI-D-714, UI-D-715, D-710, D-711]

requires:
  - phase: 10-02
    provides: "the sketch 020 review gate (approved: true, provisional, D-33)"
  - phase: 10-04
    provides: "MODERATION_ACTIONS with story_removed, community_archived, community_removed"
  - phase: 10-05
    provides: "socialSettingsPatchSchema with communities.maxPerMember, the 'community' post audience"
  - phase: 10-07
    provides: "the story wire with authorUserId nullable (A7)"
provides:
  - "platform sheet 'Limites dos membros' with the always-rendered 'Comunidades por membro' field (0 to 20, default 3), saved by the one Salvar limites action"
  - "form model and patch builder carrying communities.maxPerMember, bounds and default read from the contract"
  - "moderation log rows for story removals and community archives and removals (sentence, kind label, 80-character story excerpt, filter chips), every exhaustive map covering the three new actions"
  - "a member-community post treated as a member's post by the post menu wording and the PostDetail target; the Administrador badge asserted for the three audience values"
affects: [10-12, 10-13, 10-14, 10-15]

actuals:
  tokens: 14200
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "Form model speaks the label units and imports every bound and default from the contract (a value the form accepts is a value the API patch schema accepts)"
    - "Exhaustive Record<ModerationAction, ...> maps so a new action fails the web typecheck"
    - "Sentence parts with a bold-slot set (actor, target, community); user text inserted after the template split, never re-expanded"

key-files:
  created:
    - packages/modules/feed/tests/feed-list-member-menu.test.tsx
  modified:
    - apps/web/lib/social-limits.ts
    - apps/web/lib/social-limits.test.ts
    - apps/web/components/platform/SocialLimitsSheet.tsx
    - apps/web/components/platform/SocialLimitsSheet.test.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
    - apps/web/messages/pt-BR/platformModules.social.json
    - apps/web/i18n/messages.test.ts
    - apps/web/lib/moderation-view.ts
    - apps/web/lib/moderation-view.test.ts
    - apps/web/components/admin/ModerationLogRow.tsx
    - apps/web/messages/pt-BR/moderation.json
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/feed-view.test.ts
    - apps/web/components/feed/PostDetail.tsx
    - apps/web/components/feed/PostDetail.test.tsx
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/feed/ui/PostCard.tsx
    - packages/modules/feed/ui/PostMenu.tsx

key-decisions:
  - "The form model lives in apps/web/lib/social-limits.ts, not social-settings.ts: the plan named the wrong file (social-settings.ts is the member composer's read-only media helper)"
  - "Moderation sentences keep the existing log.rows.* catalog namespace (rows.storyRemoved, rows.communityArchived, rows.communityRemoved), the row kind labels are log.kinds.* and the filter chips log.filters.*; the plan's loose 'log.storyRemoved' naming was not followed"
  - "The row shows a kind pill ('Story removido', 'Comunidade arquivada', 'Comunidade removida') above the sentence because the sketch frames moderacao-linha-* draw it; the older kinds carry none"
  - "A community entry has no excerpt block: the stored excerpt is the community NAME and it is bold inside the sentence; a story entry clamps its caption excerpt to 80 graphemes with an ellipsis (the writer's cap is 280)"
  - "A 'community' post is a member post for the menu wording (memberPost), reusing the existing member delete body; no new feed.json key was added (see open items)"

patterns-established:
  - "memberPost is derived as audience followers OR community at both menu sites; only an organization post (tenant or no key) is not a member post"

requirements-completed: [MCOMM-05, MCOMM-08, MCOMM-10, MSTORY-04, MSTORY-09, UI-04]

duration: 25min
completed: 2026-11-11
status: complete
plan_head_before: 365a630cbd76d044864cd7766180e311760d95ea
commits: 7
---

# Phase 10 Plan 11: Web Foundations for Member Stories and Communities Summary

**The platform sheet now edits the per-member community limit (0 to 20, validated by the API's own strict patch schema), the moderation log reads story removals and community archives and removals in the existing row geometry with every action map exhaustive, and a member-community post is a member's post for the post menu while the Administrador badge stays off it.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3, each with a red commit before its green commit
- **Files:** 1 created, 18 modified (production, tests and catalogs)

## Accomplishments

- **Tracer (Task 1):** `SocialLimitsSheet` renders "Comunidades por membro" last, always (video switch off or on), behind `border-t border-divider pt-4`, with the hint "De 0 a 20. Padrão: 3." and the archived-do-not-count helper; title is "Limites dos membros" and the footer covers new communities. `social-limits.ts` carries `maxPerMember` (range from `SOCIAL_MAX_COMMUNITIES_PER_MEMBER`, default from `SOCIAL_SETTINGS_DEFAULTS`), validates it whatever the video switch says (0 valid; 21, -1, 3.5 and empty refused inline, sheet stays open) and emits `communities: { maxPerMember }` merged with the media patch. `saveSocialLimitsAction` already re-parsed the whole payload with `socialSettingsPatchSchema`, which now includes `communities`; no change was needed there, and a test proves the extreme values (0 and 20) are accepted by that schema.
- **Moderation kinds (Task 2):** `TEMPLATE_KEY`, `GLYPHS` and `MODERATION_LOG_FILTERS` cover the three new actions (removing one is now a TypeScript error); the view returns `kind`; community sentences bold the community name taken from the log excerpt; a story shows the first 80 characters of its caption; a test asserts every value of `MODERATION_ACTIONS` has a sentence with no unresolved slot and a filter chip.
- **Audience (Task 3):** both menu sites (`FeedList`, `PostDetail`) derive `memberPost` as `followers` or `community`; the badge rule (already three-valued from plan 05) is now asserted for tenant, followers, community and no audience; the story wire has no web reader of `authorUserId` (the contract types it `string | null` since 10-07), so the web that ships first tolerates the API sending null.
- **Typecheck:** `apps/web` typecheck is green again (the two exhaustive maps that plan 04 broke are fixed).

## Task Commits

1. **Task 1 RED:** `6f198806` (test): failing form-model and sheet cases (42 tests, 23 failed, 19 passed).
2. **Task 1 GREEN:** `3f5860e3` (feat): form model, sheet, catalog, host page labels.
3. **Task 2 RED:** `49821742` (test): failing moderation-view cases (27 tests, 9 failed, 18 passed).
4. **Task 2 GREEN:** `4937c0ad` (feat): view model, row, catalog.
5. **Task 3 RED:** `9588f4b7` (test): failing PostDetail target case (web: 42 tests, 1 failed) and the FeedList menu-wording file (3 tests, 1 failed).
6. **Task 3 GREEN:** `33622da7` (feat): memberPost at both sites, comments on the audience type and the badge rule.
7. **Catalog test fix:** `2a343d42` (test): `i18n/messages.test.ts` pinned the reworded title and footer.

Red evidence: for each task a real Vitest `--reporter=json` run was normalised by a throwaway script in the session scratchpad (not committed) and `gsd-tools check tdd-red-evidence` answered `RED_EVIDENCE_OK` with the real counts above. The task 3 record covers the web files; the module-feed RED was seen by running Vitest directly (1 failed of 3).

**Plan metadata:** this SUMMARY is committed separately. STATE.md and ROADMAP.md were not touched. Nothing was pushed, deployed or run against a hosted project; no database command was run.

## Verification (observed)

| Gate | Result |
|------|--------|
| `apps/web` Vitest, sheet + form model + modulos page (after Task 1) | 3 files, 51 passed |
| `apps/web` Vitest, moderation view + components/admin + moderacao (after Task 2) | 6 files, 85 passed |
| `apps/web` Vitest `lib components` (after Task 3) | 221 files, 3872 passed |
| `apps/web` Vitest, whole app, final | 350 files: 349 passed, 1 failed; 8231 tests: 8230 passed, 1 failed (the known `highlight-actions.test.ts` case 6) |
| `@rede-social/module-feed` tests | 26 files, 340 passed |
| `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-feed --concurrency=4` | 4 tasks successful |
| `bash scripts/check-ui-literals.sh` | OK |
| Biome on `apps/web` | clean (3 pre-existing infos) |
| sketch gate `grep -q '^approved: true' ...020.../README.md` | passes (provisional approval, commit 30ce8537) |

## Decisions Made

See `key-decisions`. The plan's decisions D-710, D-711, UI-D-714, UI-D-715 and Pitfall 11 are embodied as written.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan named the wrong file for the form model**
- **Found during:** Task 1 read-first
- **Issue:** `apps/web/lib/social-settings.ts` is the member composer's read-only media-limits helper; the platform form model, ranges and patch builder are in `apps/web/lib/social-limits.ts` (with `social-limits.test.ts`).
- **Fix:** the changes went to `social-limits.ts` and its test. `social-settings.ts` is untouched.
- **Commits:** `6f198806`, `3f5860e3`

**2. [Rule 3 - Blocking] The host page had to pass the two new labels**
- **Found during:** Task 1
- **Issue:** `SocialLimitsLabels` gained `fields.communities` and `communitiesHelper`; the host builds the labels in `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx`, which is not in the plan's file list.
- **Fix:** two lines added there.
- **Commit:** `3f5860e3`

**3. [Rule 1 - Bug] A catalog test pinned the old strings**
- **Found during:** the whole-web Vitest run after Task 3
- **Issue:** `apps/web/i18n/messages.test.ts` expected "Limites de mídia dos membros" and the old footer, which the plan itself rewords.
- **Fix:** the two pins updated and the two new keys pinned.
- **Commit:** `2a343d42`

**4. [Rule 2 - Missing critical functionality] The row needed its kind label**
- **Found during:** Task 2 (sketch frames `moderacao-linha-*`)
- **Issue:** the plan says the three kinds appear "in the existing row geometry", but the approved frames draw a "Story removido" / "Comunidade arquivada" / "Comunidade removida" pill above the sentence, which `ModerationLogRow` had no place for.
- **Fix:** `view.kind` plus a pill in the row for these three kinds only; the older kinds render exactly as before.
- **Commit:** `4937c0ad`

**5. Catalog key placement differs from the plan's loose names**
- The sentences are `moderation.log.rows.*` (the existing namespace the view reads), the kind labels `moderation.log.kinds.*` and the filter chips `moderation.log.filters.*` (three new keys). The plan listed `log.storyRemoved`-style keys without a namespace.

**6. The `authorUserId` step needed no code change**
- `grep -rn authorUserId apps/web packages/modules/stories/ui` finds only test fixtures; the production web never read the field, and the contract (10-07) already types it `string | null` with the A7 comment. The fixtures are typed against that contract and stay valid, so nothing was deleted or retyped. The acceptance grep prints nothing.

## Auth gates

None.

## Known Stubs

None. No hardcoded empty values reach the UI; every new string is in a host catalog.

## Threat Flags

None. No new endpoint, auth path or schema; the two new rendered strings (community name and story caption excerpt) go through React text nodes (T-10-42), the limit is re-parsed by the API's strict schema (T-10-41) and the badge rule is asserted for the three audience values (T-10-43).

## Open items for the orchestrator

- **Copy gap (not changed, needs Igor):** the author's delete confirmation for a member-community post reuses the member body "Ela sai de Explorar para todos que seguem você...", and the moderator's removal body also says "Explorar". For a post inside a community both are inaccurate. UI-SPEC gives no community-post wording, so no key was invented; a `community` variant of `post.deleteMember.body` and `post.remove.body` is a small follow-up (it also needs two optional labels threaded through the hosts that build `PostMenuLabels`).
- **`apps/web/app/(app)/stories/highlight-actions.test.ts` case 6** ("catalogue, memberships and communities are read IN PARALLEL and composed into places") is red, as expected until plan 10-12. It is the only red test in `apps/web` (8230 of 8231 pass).
- **E10 flagged rows** (no overage banner when members exceed a lowered limit; the sheet at 320px with the keyboard open) are not covered by a unit test by design; the 320px frame is for the plan 15 e2e.
- **`turbo typecheck` for `@rede-social/web` ran a `next build` as a dependency task** (the turbo graph's `^build`), no `turbo run build` was invoked by hand; the `.next` output is gitignored but large, per the disk-fill memory.
- The sketch gate is a provisional approval (30ce8537); the sketch README and `.planning/sketches` were not edited.

## Self-Check: PASSED

- FOUND: `packages/modules/feed/tests/feed-list-member-menu.test.tsx`, `apps/web/lib/social-limits.ts`, `apps/web/lib/moderation-view.ts`, `apps/web/messages/pt-BR/moderation.json`
- FOUND commits: `6f198806`, `3f5860e3`, `49821742`, `4937c0ad`, `9588f4b7`, `33622da7`, `2a343d42`
- `git rev-list --count 365a630cbd76d044864cd7766180e311760d95ea..HEAD` = 7 before this SUMMARY commit
- No `Co-Authored-By` trailer in any of the seven commits; `.planning/ROADMAP.md` and `.planning/STATE.md` not staged
