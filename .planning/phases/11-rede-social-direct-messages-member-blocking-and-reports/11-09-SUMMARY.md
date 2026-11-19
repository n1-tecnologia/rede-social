---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 09
subsystem: database
tags: [reports, content-reports, check-widening, one-way, definer, media-gate, security-invoker, rls, D-730, D-731, D-732, MODER-05, MODER-04]
requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "the paired direct (plan 03: direct_low/high_user_id, app.direct_pair_readable), the send guard and the block effects (plans 06, 07)"
provides:
  - "REPORT_SUBJECT_TYPES = feed_post, post_comment, story, story_comment, community, direct_message (four appended, one-way)"
  - "content_reports.media_asset_id / voice_seconds (nullable, no FK) with content_reports_voice_pair_chk and content_reports_voice_subject_chk, the widened content_reports_subject_type_chk and a partial index (tenant_id, media_asset_id)"
  - "app.content_report_create with the story, story_comment, community and direct_message branches (snapshot of exactly one item)"
  - "app.chat_asset_hidden with the report clause: the administrator plays a reported recording only through its report"
  - "app.chat_conversation_is_support + chat_participants_select narrowed: staff read the participant rows of support threads only"
  - "pgTAP 239-reports-new-subjects.sql (107 assertions) and 240-direct-realtime-media.sql (49)"
affects: [11-14, 11-16, 11-17, 11-release]
requirements-completed: [MODER-05, MODER-04]
key-files:
  created:
    - supabase/migrations/20261119194425_report_subjects.sql
    - supabase/migrations/20261119194436_report_subjects_functions.sql
    - supabase/migrations/20261119194821_chat_support_conversation_gate.sql
    - supabase/migrations/20261119194838_direct_participants_policy.sql
    - supabase/migrations/20261119195211_report_voice_gate.sql
    - supabase/tests/239-reports-new-subjects.sql
    - supabase/tests/240-direct-realtime-media.sql
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/db/schema/content-reports.ts
    - packages/modules/chat/db/schema.ts
    - supabase/tests/223-reports-blocks.sql
    - apps/api/tests/integration/reports-blocks.test.ts
    - supabase/migrations/meta/_journal.json
key-decisions:
  - "D-730 confirmed, no objection from Igor, 2026-11-19 ~16:37 local: the list is appended, never inserted, and the one-way CHECK step went ahead"
  - "The administrator hears a reported recording through the invoker policy content_reports_select, not through a definer that restates it; the clause also repeats r.tenant_id = a.tenant_id so a forged row of another tenant unhides nothing"
  - "Staff stop reading the participant rows of a direct conversation (who talks to whom); the policy calls a definer DIRECTLY because a (select f()) wrapper raises 42P17 on every participant insert"
  - "app.realtime_topic_allowed is NOT changed (accepted residual, see below)"
patterns-established:
  - "A policy that must ask about the sibling table of a mutually-referencing pair reads it through a stable security definer called directly, never wrapped in (select ...)"
duration: 25 min
completed: 2026-11-19
status: complete
commits: 2
plan_head_before: f0ca8b3bff2e78f09682fe4e239c19d9d0b78cc0
actuals:
  tokens: 30000
  tasks: 3
  commits: 2
coverage:
  - id: D1
    description: "A member reports a story, a story comment, a community, a text message and a voice message; the row snapshots exactly that one item (author, excerpt cut at 280 code points, the voice columns, status open)"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "supabase/tests/239-reports-new-subjects.sql (sections 1, 5, 6)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The refusals: own item RP001, missing/deleted/other-tenant/unreadable/non-participant/support-conversation/retired-recording RP002, unknown type 22023, repeat 23505, non-live 42501, forged type or voice column refused by the table"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "supabase/tests/239-reports-new-subjects.sql (sections 2, 4, 7)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A message report stores only the message: no column can hold the conversation or the counterpart, and admin_tenant, support_tenant and a third member read no message, conversation or participant row of the reported direct"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "supabase/tests/239-reports-new-subjects.sql (sections 0 and 3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The administrator hears a reported recording only through its report; a third member, the support staff and another tenant are unchanged; a retired recording is hidden from everyone"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "supabase/tests/240-direct-realtime-media.sql (section 2) and 236-chat-voice.sql unchanged"
        status: pass
    human_judgment: false
  - id: D5
    description: "Local schema push: both drift gates answer No schema changes and no statement is destructive"
    verification:
      - kind: other
        ref: "pnpm db:generate; pnpm db:generate:central; grep -inE 'drop (table|column)|rename|set not null|alter column .* type' over the five migrations"
        status: pass
    human_judgment: false
---

# Phase 11 Plan 09: Reports of a story, a story comment, a community and a message Summary

**Four report subjects appended one-way to the CHECK, a snapshot definer with four new branches, two nullable voice columns that keep a reference to the recording (never the conversation), and a read seam that lets the administrator play a reported recording only through its report.**

## Performance

- **Duration:** about 25 min (start 16:37 local, end about 17:02)
- **Tasks:** 3 (one checkpoint already answered, one tracer, one blocking auto task)
- **Files:** 7 created, 7 modified (plus the generated drizzle snapshots)

## D-730 confirmation (Task 1, checkpoint:decision)

D-730 confirmed, no objection from Igor, 2026-11-19 ~16:37 local. The order `story`, `story_comment`, `community`, `direct_message` was appended after `post_comment`.

## Accomplishments

- **The append (one-way).** `REPORT_SUBJECT_TYPES` has the six values in order; `content_reports_subject_type_chk` is dropped and re-added wider from the same constant; every existing row satisfies it. Expand-only.
- **The voice columns.** `media_asset_id uuid` and `voice_seconds smallint`, both nullable, no foreign key (the report outlives the asset), `content_reports_voice_pair_chk` (both null, or both set with 1..300) and `content_reports_voice_subject_chk` (only a `direct_message` carries an asset).
- **The definer.** `app.content_report_create` replaced from its newest body; the four branches resolve the subject in the claim's tenant with the live predicate. `direct_message` requires the reporter to be one of the two users of a paired direct, the author to be the other side, `app.direct_pair_readable`, a live message and a live asset. A voice message stores `excerpt = ''` plus the asset id and the stored length. RP001 own, RP002 for every miss (one code, no oracle).
- **The gate.** `app.chat_asset_hidden` keeps `security invoker`; one more `not exists` over `content_reports` lets whoever reads a report of the tenant carrying the asset (the reporter, `admin_tenant`) hear it. Retired recordings stay hidden from everyone.
- **Staff no longer read who talks to whom** (deviation 3 below).

## Task Commits

1. **Task 1: confirm the one-way append (checkpoint:decision)** - no commit (answered, D-730 above)
2. **Task 2: contract append, widened CHECK, columns, four-branch definer (tracer)** - `b91ea0d8`
3. **Task 3: recording read seam, matrix, schema push, drift gates** - `a5034390`

**Plan metadata:** the SUMMARY commit that follows this file.

The tracer gate: the tracer `<verify>` (migration up, contract test, pgTAP 223 + 239) passed at Task 2 and again inside Task 3's run; no expansion started on a red foundation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `content_reports_voice_pair_chk` let an asset id through with no seconds**
- **Found during:** Task 2 (pgTAP 239 assertion "an asset id without the seconds is refused")
- **Issue:** `(asset is not null and seconds between 1 and 300)` is NULL, not false, when `seconds` is null, and a CHECK passes on NULL. The first migration would have shipped a hole.
- **Fix:** the second branch now reads `asset is not null and seconds is not null and seconds between 1 and 300`, in the schema, the migration and the two snapshots (nothing was committed before the fix; the local constraint was dropped and re-added).
- **Commit:** b91ea0d8

**2. [Rule 2 - Missing critical / security] staff could read the participant rows of every direct conversation**
- **Found during:** Task 2 (the plan's own truth "admin and support read NO participant row of a direct", pgTAP 239 section 3 failed with `0/0/2`)
- **Issue:** `chat_participants_select` allowed staff "any row of your tenant" (written when only support threads existed), so `admin_tenant` and `support_tenant` could learn which two members share a direct and its conversation id from a report, the exact thing T-11-09 forbids. Plan 03's summary believed the policy was "own rows only".
- **Fix:** new definer `app.chat_conversation_is_support(uuid)` (`*_chat_support_conversation_gate.sql`) and `chat_participants_select` narrowed so the staff term holds only for `kind = 'support'` (`*_direct_participants_policy.sql`, schema in `packages/modules/chat/db/schema.ts`). The function must be called directly: wrapped as `(select app.chat_conversation_is_support(...))` the rewriter raises `42P17 infinite recursion` on every participant insert (probed; recorded in the migration and the schema comment).
- **Verification:** pgTAP 152, 235, 236, 237, 238, 239, 240 green; `chat.test.ts`, `direct-chat.test.ts`, `chat-cases-*.test.ts`, `chat-voice.test.ts` green.
- **Commit:** b91ea0d8

**3. [Rule 1 - Bug in the shipped test] pgTAP 223 used `story` and `story_comment` as "unknown" types**
- **Found during:** Task 2. The plan says 223 "passes unchanged", but two assertions probe the very values this plan appends.
- **Fix:** both probe `reel` now (assertion count unchanged, 147).
- **Commit:** b91ea0d8

**4. [Rule 1 - outside files_modified] the API integration suite pinned the old list**
- **Found during:** Task 2/3. `apps/api/tests/integration/reports-blocks.test.ts` pinned `['feed_post','post_comment']`, expected `story_comment`, `community` and `direct_message` bodies to be 400, and used `story_comment` as the 400 probe in the rate-limit test.
- **Fix:** three unknown probes (`reel`, `chat_message`, `Direct_Message`), the 400 probe is `reel`, the boundary test pins the six. 22/22 green.
- **Commit:** b91ea0d8

**5. [Rule 2 - missing index] partial index `content_reports_tenant_asset_idx (tenant_id, media_asset_id) where media_asset_id is not null`**
- The gate asks "is there a report of this tenant carrying this asset" on every voice `/original` request; the index keeps that a lookup. Generated with the schema, expand-only.

### Plan wording interpreted

- "Hidden for another tenant's user after the report" (Task 3): `app.chat_asset_hidden` has always answered `false` for another tenant's asset (T-12.5-25, "the gate adds nothing, the route 404s from the missing row"). 240 asserts that the answer is unchanged by the report AND that the other tenant's administrator reads neither the asset row nor any report row; a forged report row of tenant B naming tenant A's asset unhides nothing for tenant A.
- "Two transactions at once": pgTAP cannot open two sessions. The arbiter is the table key `content_reports_reporter_subject_uq`; 239 asserts its definition, `23505` for each of the four subjects and exactly one row after the repeats. Real concurrency is by construction, not exercised.

**Total deviations:** 5 auto-fixed (2 bugs in my own/shipped tests and CHECK, 1 security gap in a shipped policy, 1 shipped test outside the list, 1 index). **Impact:** all necessary for correctness or for the plan's own truth; no scope outside reports and the participant read.

## Verification run

| Gate | Result |
|------|--------|
| pgTAP 223 (147), 239 (107), 240 (49), 236, 152, 235, 237, 238 | PASS |
| full `supabase test db` (73 files) | 4 files red, none mine: 120 #37, 141 #21, 232 #56 (EXPLAIN "by name" index probes now see a Seq Scan on small local tables), 154 #65 (local residue rows) |
| `pnpm db:generate`, `pnpm db:generate:central` | both `No schema changes` |
| shape grep (drop table/column, rename, set not null, alter column type) over the five migrations | no match |
| contracts suite | 623/623 |
| `@rede-social/core` suite | 1858/1858 |
| `@rede-social/module-chat` suite | 296/296 |
| web suite via turbo (`--concurrency=4`) | 415/416 files; `EventsSections.test.tsx` red once at load average 23, green alone (18/18) |
| `typecheck` api, web, core, contracts, module-chat | PASS (web ran its build) |
| api `tests/unit` (inventories, module readmes) | 138/138 |
| integration, one file each after pgTAP: `chat-voice-gate`, `reports-blocks`, `chat`, `direct-chat`, `chat-cases-staff/actions/notices`, `chat-voice`, `moderation-member-content` | all green |
| `pnpm boundaries`, `check-ui-literals.sh`, `pnpm guard:lanes`, biome on the changed files | OK |

## Accepted residual (Open Question 4)

`app.realtime_topic_allowed` is **not changed**. The `social` term for paired directs lives in `chat_conversations_select` (plan 03) and covers the messages and this plan's gate by inheritance. At the topic level a participant of a pair is still allowed its `conv:` topic while `social` is off (240 asserts it so the residual is visible): a signal carries ids only and the API refuses everything while `social` is off (D-483). Low value, recorded, not fixed.

## Issues Encountered

- The first `docker exec psql -f -` without `-i` silently applied nothing; caught by the policy catalog read, redone with `-i`.
- Local disk free went from 13 to 11 GiB across the web build and the suites (above the 10 GiB floor); `apps/web/.next/cache` is 326 MB and was left.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: rls-narrowing | supabase/migrations/20261119194838_direct_participants_policy.sql | `chat_participants_select` no longer lets staff read participant rows of non-support conversations (a narrowing at a trust boundary, intended, deviation 2) |

## Known Stubs

None.

## Next Phase Readiness (for plans 14, 16, 17 and the release)

- `createReport` in `packages/core/server/safety/reports.ts` still has a Phase 13 read check whose `else` branch joins `feed_comments` to `feed_posts`, so a `story`, `story_comment`, `community` or `direct_message` body now passes the contract and answers 404 until plan 14 adds the per-type readable check (the definer itself does not check followers-only visibility of a story or community, as for posts). Fail-closed today.
- The hosted push of the five migrations is the release plan's and Igor's; nothing was pushed or applied to a hosted project, and every `supabase` call used `--local`.

## Self-Check: PASSED

- Files present: the five migrations, `239-reports-new-subjects.sql`, `240-direct-realtime-media.sql`, this file.
- Commits `b91ea0d8` and `a5034390` are in `git log`; `rev-list --count f0ca8b3b..HEAD` before this commit was 2.
- ROADMAP.md, STATE.md and REQUIREMENTS.md were not touched.
