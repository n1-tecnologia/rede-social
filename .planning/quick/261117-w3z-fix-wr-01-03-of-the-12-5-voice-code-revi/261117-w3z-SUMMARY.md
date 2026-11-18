---
phase: quick-261117-w3z
plan: 01
subsystem: chat-voice
tags: [bugfix, voice, phase-12.5, WR-01, WR-02, WR-03, quick]
requirements: [VOICE-23, VOICE-37]
status: complete
plan_head_before: 307c28002b14560844cb1ccf75e6ee147ce986b1
commits: 4
key-files:
  modified:
    - apps/web/lib/voice-send.ts
    - apps/web/lib/voice-send.test.ts
    - apps/web/app/(app)/suporte/ThreadPane.tsx
    - apps/web/app/(app)/suporte/ThreadPane.voice.test.tsx
    - packages/core/server/media/service.ts
    - apps/api/tests/integration/media-sweeper.test.ts
  created:
    - packages/core/tests/media-purge-tombstone.test.ts
actuals:
  tasks: 3
  commits: 4
---

# Quick 261117-w3z: close WR-01..WR-03 of the Phase 12.5 voice code review

A voice send now stops when the member leaves the screen, the purge tombstone is kept for recordings only, and a take that ends closed or not_found toasts an existing catalog sentence before it disappears.

BASE (`plan_head_before`): `307c28002b14560844cb1ccf75e6ee147ce986b1`.

## Commits (nothing pushed, no trailer, no `.planning` file)

| Task | SHA | Message |
| ---- | --- | ------- |
| 1 WR-01 | `001775b1` | fix(quick-261117-w3z): a voice send stops when the member leaves the screen (WR-01) |
| 2 WR-02 | `d4d9d9cd` | fix(quick-261117-w3z): the purge tombstone is only for a voice recording (WR-02) |
| 3 WR-03 | `bedc24c7` | fix(quick-261117-w3z): a voice take that ends closed or not found says why before it goes (WR-03) |
| fix-up  | `0ec0441b` | test(quick-261117-w3z): type the mock implementations of the WR-01 cancellation cases |

`0ec0441b` is a fourth commit the plan did not list: the web typecheck gate (which only shows web type errors) flagged two
`TS2349` errors in the WR-01 test I wrote in `001775b1` (`getMockImplementation()` result was not callable). It only adds a cast.
`git diff --stat BASE..HEAD` lists exactly the seven `files_modified`; no `supabase/` path; no `apps/web/messages` or
`apps/web/i18n` change; `git log --format=%B BASE..HEAD | grep -ci co-authored` prints 0.

## WR-01 - the send stops when the pane is gone

**RED** (`vitest run lib/voice-send.test.ts "app/(app)/suporte/ThreadPane.voice.test.tsx" -t "WR-01"`): 7 failed, 1 passed
(the "always false" pin, as expected).

```
× WR-01: cancelled from the start runs no stage, no send and no sleep          (expected true to be false)
× WR-01: the flag flipping after start stops before the PUT                    (expected true to be false)
× WR-01: the flag flipping after the PUT stops before complete                 (expected true to be false)
× WR-01: the flag flipping after complete never sends, and the unsent asset is the resume
    AssertionError: expected { ok: true, sent } to deeply equal { ok: false, kind: 'retriable', resume }
× WR-01: the flag flipping on a not_ready answer arms no sleep and sends no more   (same assertion)
× WR-01: the flag flipping inside the sleep stops before the next send             (same assertion)
× WR-01: a send that keeps answering not_ready is not repeated once the pane is gone
    AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
 Tests  7 failed | 1 passed | 71 skipped (79)
```

The pane test alone, run twice more: `1 failed`, same `called 1 times, but got 2 times` both times (deterministic).

**GREEN** same command: `Test Files 2 passed, Tests 8 passed | 71 skipped`. Whole pane voice file three runs in a row:
`30 passed` x3 at this stage (32 after WR-03). `lib/voice-send.test.ts` + `ThreadPane.first-send`, `.member`, `.staff`
and `voice-deps.test.ts`: `5 files, 114 passed`.

**Mutation**: deleting the top-of-loop `if (gone()) return failed('retriable')` made 3 cases red (flag flipping after
complete, flag flipping inside the sleep, and the pane unmount-while-polling test: `996ms`, i.e. the stray second send),
restoring it gave `8 passed` again. (The `not_ready` case survives that single mutation because the post-answer check also
covers it; the two checks overlap on purpose.)

Change: `VoiceSendDeps.cancelled?: () => boolean`, read (only a `true` answer counts) at the entry, after `start`, after
`put`, at the top of every send iteration and right after a `not_ready` answer before the wait is armed. It returns the
existing `failed('retriable')` (with `resume` once complete succeeded); `VoiceFailureKind`, `classifyVoiceFailure` and
`failVoice` are not widened. The pane passes `{ ...voiceSendDeps(sendAction), cancelled: () => !alive() }`. The docblocks of
`voice-send.ts` and the `aliveRef` effect now state the limit: a request already on the wire is not aborted, and an asset a
cancelled take already uploaded and completed stays unsent for the 24 hour orphan sweep (D-856). No `next/*` import and no
`console` in `voice-send.ts` (grep prints nothing).

## WR-02 - tombstone for audio only

**RED** unit (`pnpm --filter @rede-social/core exec vitest run tests/media-purge-tombstone.test.ts`):

```
× WR-02: a 23503 on a image row propagates and opens ONE admin transaction (no tombstone)
× WR-02: a 23503 on a file row propagates ...
× WR-02: a 23503 on a video row propagates ...
AssertionError: promise resolved "{ purged: true, objects: 1 }" instead of rejecting
 Tests  3 failed | 3 passed (6)      (audio tombstone pin and the two non-23503 cases pass)
```

**RED** integration (`pnpm --filter @rede-social/api exec vitest run tests/integration/media-sweeper.test.ts -t "WR-02"`):
`× WR-02: a retired image a link preview references is NOT tombstoned ...` with
`AssertionError: expected 'failed' to be 'deleted'`.

**GREEN** after the one-line guard `if (sqlstateOf(error) !== '23503' || row.kind !== 'audio') throw error;`:
unit `Tests 6 passed (6)`; integration `-t "WR-02"` `1 passed | 14 skipped`; whole `media-sweeper.test.ts` `15 passed`;
`chat-voice-sweep.test.ts` `6 passed` (the audio tombstone still holds); `pnpm --filter @rede-social/core test`
`116 files, 1855 passed`; `admin-lane-inventory` + `module-readmes` `2 files, 40 passed` (no inventory row needed, no
`withAdminTx(` site added). The diff of `service.ts` is the guard line, its comment and the docblock paragraph only.

## WR-03 - closed and not_found say why

**RED** (`... ThreadPane.voice.test.tsx -t "WR-03"`): 4 failed (member closed, member not_found, staff closed, staff
not_found), each `TestingLibraryElementError: Unable to find an element with the text: <sentence>`.

**GREEN**: `4 passed | 28 skipped`; whole pane voice file three runs `32 passed` x3; `ThreadPane.first-send`, `.member`,
`.staff`, `[conversationId]/page.test.tsx`, `lib/chat-view.test.ts`, `lib/filled-cta.test.ts`,
`i18n/chat-cases-messages.test.ts`: `7 files, 188 passed`, with zero edits to the last three.

Sentences (existing catalog keys only, no key added): `not_found` toasts `toast.failed` ("Não foi possível concluir. Tente
de novo.") for both viewers; `closed` toasts `staffCase.closedNotice` for the team and `case.closedNotice` for the member.
The toast comes first, then the existing bubble removal, staff `refreshCase` and `router.refresh()`.

## Final gates (real results)

| Gate | Result |
| ---- | ------ |
| `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --concurrency=4` | 415 files, 9995 tests passed (run twice; both exit 0; the EventsSections flake did not show) |
| web typecheck | first run found 2 TS2349 in my own test, fixed in `0ec0441b`; rerun: 3 tasks successful (the `Dynamic server usage` lines in its log are Next prerender notes of existing routes, not errors; the build step succeeded) |
| core + api typecheck | 2 successful |
| `pnpm --filter @rede-social/core test` | 1855 passed (run after the service change) |
| `pnpm --filter @rede-social/module-chat test` | 15 files, 288 passed |
| `pnpm boundaries` | no issues (2624 files, 20 packages) |
| `check-ui-literals.sh` | OK |
| `pnpm guard:lanes` | OK |
| `module-readmes` + `admin-lane-inventory` | 40 passed |
| integration, one at a time, docker up, 13 GiB free | `media` 43 passed; `media-voice` 17 passed; `media-sweeper` 15 passed; `chat-voice-sweep` 6 passed; `chat-voice` 23 passed |
| pgTAP | not run: no SQL changed |

No known red (pgTAP 120/141/154/232, isolation b3/b8, move-copy, EventsSections flake) appeared in any file this task ran.
Build residue (`.turbo/cache`, `apps/web/.next/cache`, `apps/web/.next/dev`) removed.

## Deviations from Plan

**[Rule 1 - Bug] Type errors in my own WR-01 test.** Found by the web typecheck gate after the three commits; fixed in a
separate commit `0ec0441b` (cast of `getMockImplementation()` in two cases). No behaviour change.

Otherwise the plan ran as written.

## Observations for Igor

- The `not_found` toast ("Não foi possível concluir. Tente de novo.") says "try again" although a dropped `not_found` take
  cannot be retried from the bubble (it is gone); the plan fixed the mapping so I did not change copy. If it reads wrong for a
  recording, a dedicated key is a follow-up (it would need the chat-cases key-set pin and the 44-string voice guard edited).
- A cancelled take that already completed leaves one unsent asset until the 24 hour orphan sweep (T-w3z-04, accepted).
- The WR-01 mutation of the top-of-loop check alone leaves the `not_ready` case green because the post-answer check overlaps it.

## Known Stubs

None.

## Untouched

STATE.md, ROADMAP.md, REQUIREMENTS.md, VERIFICATION.md, UAT, the review file, IN-01..IN-06, every SQL file and migration, every
sketch, `chat.json` and the catalog pins. This SUMMARY and the PLAN are not committed.

## Self-Check: PASSED

Files exist (the seven above); commits `001775b1`, `d4d9d9cd`, `bedc24c7`, `0ec0441b` are in `git log` on `master`.
