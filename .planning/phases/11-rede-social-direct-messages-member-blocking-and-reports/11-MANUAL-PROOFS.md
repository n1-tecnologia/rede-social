---
phase: "11"
status: pending
---

# Phase 11 manual proofs (P1 to P41)

This file is the ledger of the proofs only the owner can run: two real phones (an iPhone with the installed app and an
Android phone) exchanging a direct message with a push on each, the banner replaced per conversation and suppressed in
the foreground, voice sent and heard by the two participants only, the blocked member's strip and refused send on a
device, the report of every subject and the `Nova denúncia` push on the administrator's phone, the queue's voice row
heard only through its report, the VoiceOver and TalkBack walks, the held-out visual rows, the 40 px gutter trigger at
320 px, the two Playwright runs, the sketch 025 approval kind and its defaults, the planner's assumptions, every hosted
release step and the first-day checks, the `social` toggle on a hosted tenant, and the full `pnpm verify` (it resets and
seeds the local database, so it is his). Everything an agent could build is built and proved on the local stack (plans
01 to 27: pgTAP, API integration, unit and component tests, and two Playwright specs that are written and listed but
were never run); what is left here cannot be faked, so nothing in this file is ever recorded as done by an agent.

**The rule.** Every row ships `pending`. A row becomes `passed` only when Igor pastes the evidence of its steps and the
date, in the row, himself. An agent never edits a Status line and never writes evidence it did not see. A phase whose
ledger has a `pending` row closes `human_needed`, never green. (Project memory: a blanket UAT pass is checked against
`docs/DEPLOY.md` before it is recorded, and a phone cannot reach `*.localhost`, so a row that needs a phone needs a
homolog or production host.)

**The evidence rule.** Paste shapes, counts, statuses, HTTP codes, exit codes and the words the screens show. **Never**
a key, a password, a token, a connection string, a webhook token, an e-mail address of a member, a project ref, a signed
link or a recording (not the file, not a link to it). Replace a ref by `<ref>` and a host by `<host>` in what you paste;
name a tenant "tenant 1", "tenant 2".

**The procedures** for the release rows are in `docs/DEPLOY.md`, "Phase 11 release (direct messages, block effects and
reports)". The release order is: migrations, then the WEB, then the API and the WORKER together (it inverts the
API-first rule because an old web refuses the new API's optional keys, and the push hint schema is strict).

**The design approval is yours.** Sketch `025` (the design gate) carries `approved: true`, `approved_by: Igor`,
`approved_at: 2026-11-19` and `approval_kind: provisional`: it was recorded on your approval of 2026-11-19, with no
line-by-line answers, and read as "keep every default as drawn" (A-UI-1 to A-UI-22 included). It stays provisional until
you walk the built screens (rows P12 to P20 and P23).

## What was NOT run (read this before any row)

- **`direct-chat.spec.ts` (10 cases) and `safety.spec.ts` (13 cases) were never run.** Plan 26 wrote them, listed them
  and typechecked them. Their likely first-run adjustments: the toast locator (`[role="status"][style*="safe-top"]`),
  the dialog names of the block and resolve steps, the radio selection by label in the report sheet, and the
  `[data-comment-delete]` locators of the four shipped specs it edited. The platform-host case needs
  `SUPER_ADMIN_PASSWORD`; the voice case needs ffmpeg (rows P21 and P22).
- **The full Playwright suite is red outside this phase** (118 failures with no baseline at the Phase 10 closure), so a
  full run proves nothing about this phase; run the two files.
- **Nothing was applied to a hosted project, pushed or deployed.** The thirteen migrations are local only.
- **No real device was used for anything.** Every menu, strip, sheet and player test is a fake in happy-dom.
- **The local database residue** (pgTAP `120 #37`, `141 #21`, `232 #56`, `154 #65`; integration `stories`,
  `feed-query-budget`, four cases of `isolation` and cases 1 and 9 of `modules`) is not this phase's and was never
  fixed by a reseed (row P40).

## The rows

| Row | Proof | Requirement | Needs | Status |
|-----|-------|-------------|-------|--------|
| P1 | Two real phones exchange a direct text message: the badge, the row in Conversas and one push on each phone | CHAT-06 | an iPhone with the installed app, an Android phone, a homolog or production host, two member accounts | pending |
| P2 | The banner is replaced per conversation and not shown while the app is visible (assumption A5, the global service-worker rule) | CHAT-06 | the two phones of P1, the deployed push | pending |
| P3 | Tapping the push opens the right conversation on the iPhone app and on Android | CHAT-06 | the two phones of P1 | pending |
| P4 | A voice message in a direct chat is sent, played by the two participants and by nobody else (a third member and the administrator get the bare 404) | CHAT-06, CHAT-07 | the two phones, a third member, an administrator | pending |
| P5 | The blocked member's view on a device: the neutral strip, the refused send with its one word, the history kept | CHAT-07 | two phones, a homolog or production host | pending |
| P6 | The blocker's view on a device: the strip with `Desbloquear` (no confirmation), the unblock restores the composer, the follows stay gone | CHAT-07 | the two phones of P5 | pending |
| P7 | The administrator's block or removal of a member on a hosted tenant: the conversation leaves the other member's list and returns on unblock | CHAT-06, CHAT-07 | a hosted tenant with `social` and `chat` on, an administrator | pending |
| P8 | A report of each of the six subjects (post, comment, story, story comment, community, direct message) from a phone: sheet, reasons, note, the confirmation, the repeated report | MODER-05 | a member phone, a homolog or production host | pending |
| P9 | The `Nova denúncia` bell row and push on the administrator's phone, and how the banner reads on a phone | MODER-05 | an administrator's phone with the push on | pending |
| P10 | The queue's voice row is heard only through its report (the administrator reads no chat row) | MODER-05, MODER-04 | a reported voice message, an administrator | pending |
| P11 | Resolve per subject on a hosted tenant: remove, archive the community, ignore, block the author, and the log row each writes | MODER-04 | a hosted tenant, an administrator | pending |
| P12 | The VoiceOver walk of Conversas, the thread, the menus, the strips, the queue rows and the bell rows | CHAT-06, CHAT-07, MODER-05 | an iPhone with VoiceOver | pending |
| P13 | The TalkBack walk of the same screens | CHAT-06, CHAT-07, MODER-05 | an Android phone with TalkBack | pending |
| P14 | The focus returns where the user was after a sheet or a row moves, in iOS Safari and in Firefox (happy-dom cannot show the blur) | CHAT-06, CHAT-07 | an iPhone, desktop Firefox | pending |
| P15 | E2 overflow: the report sheet and the thread with a 2,000-character text and a long unbroken URL at 320 and 390 px | MODER-05, CHAT-06 | a 320 px phone or window | pending |
| P16 | E2 long-text: a 60-character member name in the list row, the header, the bell row and the queue row at 320 px | CHAT-06, MODER-05 | a 320 px phone or window | pending |
| P17 | E7 overflow: the voice-message sheet with a 500-character note and its counter inside the sheet, the send button reachable at 320 px | MODER-05 | a 320 px phone or window | pending |
| P18 | E10 overflow: the bell rows with a 60-character actor name at 320 px | MODER-05, CHAT-07 | a 320 px phone or window | pending |
| P19 | The 40 px gutter trigger of the message menu at 320 px and the 44 px targets elsewhere | CHAT-06, MODER-05 | a 320 px phone | pending |
| P20 | The story sheet at 320 px, the community sheet stacking, and the ellipsis chip on a photographic cover | MODER-05, CHAT-07 | a phone, a tenant with a photographic community cover | pending |
| P21 | The Playwright run of `direct-chat.spec.ts` (10 cases) | CHAT-06, CHAT-07 | Igor's word, the local stack, `SEED_PASSWORD` exported, ffmpeg, one file at a time | pending |
| P22 | The Playwright run of `safety.spec.ts` (13 cases) | MODER-04, MODER-05 | Igor's word, the local stack, `SEED_PASSWORD` and `SUPER_ADMIN_PASSWORD` exported | pending |
| P23 | The sketch 025 approval kind (provisional) and the defaults A-UI-1 to A-UI-22 | CHAT-06, CHAT-07, MODER-04, MODER-05 | Igor's reading of `.planning/sketches/025-phase-11-designed-screens/` against the built screens | pending |
| P24 | A-11-ROLE: staff never see `Bloquear {name}`; the rider and the screen enforce it, the database function does not | CHAT-07 | Igor's decision | pending |
| P25 | A-11-COPY: a reported voice message's "copy" is a reference to the recording plus the stored duration | MODER-05 | Igor's decision | pending |
| P26 | A-11-SC: story comments gain the blocker's filter | CHAT-07 | Igor's decision | pending |
| P27 | A-11-ORG: removing an organization's story or community from the queue writes no moderation log row | MODER-04 | Igor's decision | pending |
| P28 | The push suppression and once-per-pair assumptions: one follow bell row per pair, never retracted; one push per conversation | CHAT-06, CHAT-07 | Igor's reading, two phones | pending |
| P29 | The read-only check on every hosted project and the pending-version count (`pnpm db:migrate-all -- --dry-run`) | CHAT-06, CHAT-07, MODER-04, MODER-05 | the hosted projects, read-only SQL | pending |
| P30 | The homolog deploy of the release, in the release order, and its smoke checks | CHAT-06, CHAT-07, MODER-04, MODER-05 | the homolog environment | pending |
| P31 | Production step 1: the thirteen migrations on every tenant database (the ledgered fan-out) and the after-check SQL | CHAT-06, MODER-05 | the production environment | pending |
| P32 | Production step 2: the web | CHAT-06, MODER-05 | the production environment | pending |
| P33 | Production step 3: the API and the worker together, in the same sitting as P32 | CHAT-06, MODER-05 | the production environment | pending |
| P34 | The first-day checks in production: the new entries on a tenant without `social`, a real exchange, a real report | CHAT-06, MODER-05 | production, throwaway members | pending |
| P35 | The `social` toggle on a hosted tenant (off hides Conversas and follows, on restores them) and the administrator's block | CHAT-06, CHAT-07 | a hosted tenant | pending |
| P36 | A deleted or retired recording reads `Mensagem de voz apagada` in a direct thread and in a report | CHAT-06, MODER-05 | a throwaway member, a hosted tenant | pending |
| P37 | The Phase 13 hand-over: plan 13-20's screens are built here from sketch 025, so 13-20 shrinks to an in-app check and its sketch guard points at 017 until the orchestrator re-points it | MODER-04, MODER-05 | the orchestrator's ROADMAP and STATE wording | pending |
| P38 | The full `pnpm verify` run (it resets and seeds the local database) | CHAT-06, CHAT-07, MODER-04, MODER-05 | Igor's word and his local database | pending |
| P39 | The review of the replaced security-relevant functions: `app.chat_messages_before_insert`, `app.member_block_create`, `app.content_report_create`, `app.chat_asset_hidden` | CHAT-07, MODER-05 | Igor's reading of the diffs | pending |
| P40 | The local residue unrelated to the phase (pgTAP `120 #37`, `141 #21`, `232 #56`, `154 #65`; the integration reds listed above) | CHAT-06 | Igor's word to clear the residue (a seeded reset) | pending |
| P41 | The residuals to confirm: no signal on a block or unblock, the thread header keeps the old name, `unreadCount` capped at 100 (`99+`), the realtime topic stays allowed while `social` is off | CHAT-06, CHAT-07 | Igor's reading | pending |

## P1 - Two phones exchange a direct message (CHAT-06)

- **Proves:** that a direct message travels between two real devices with the badge, the list row and one push each.
- **Needs:** a homolog or production tenant with `social`, `chat` and `notifications` on, two member accounts, an
  installed iPhone app and an Android phone, each with the push permission given.
- **Steps:** as member A open member B's profile and tap `Enviar mensagem`; send a text. On B's phone: the badge on the
  bubble counts one conversation, Conversas shows the row, one push titled with A's name arrives. Reply from B.
- **Evidence to paste:** the devices and OS versions, whether the push arrived on each, its title words, the badge count.
- **Status:** pending

## P2 - The banner per conversation and the foreground (CHAT-06, assumption A5)

- **Proves:** that two messages in one conversation replace one banner (one tag per conversation) and that no banner
  shows while the app is visible (the global service-worker rule, not a per-conversation presence).
- **Steps:** with B's app in the background, send two messages in one conversation and one in another; with the app
  in the foreground on the open conversation, send another.
- **Evidence to paste:** how many banners showed, whether the second replaced the first, whether the foreground showed one.
- **Status:** pending

## P3 - The push tap opens the conversation (CHAT-06)

- **Steps:** tap the push on the iPhone app and on Android with the app closed and with it open.
- **Evidence to paste:** where each tap landed (`/conversas/<id>` or elsewhere).
- **Status:** pending

## P4 - Voice in a direct chat, heard by the two only (CHAT-06, CHAT-07)

- **Proves:** that the 12.5 recording machinery works in a direct thread and that the read gate keeps it to the two
  participants. The staff and a third member are not participants.
- **Steps:** A records and sends; B plays it. As a third member and as the administrator, try the recording's address:
  the same bare 404 as a miss. A report of the recording does not open it for other members.
- **Evidence to paste:** the status codes and what the screens showed; never the link or the file.
- **Status:** pending

## P5 - The blocked member's view (CHAT-07)

- **Proves:** that the blocked member learns nothing beyond one neutral word: the composer becomes the strip on the next
  read of the conversation, a refused send shows the toast and the strip, and the history stays for both sides.
- **Steps:** B blocks A from a message menu on one phone; on A's phone send a message. Note that no signal tells A until
  the next message signal, subscribe or refocus.
- **Evidence to paste:** the words of the toast and of the strip, whether the history stayed.
- **Status:** pending

## P6 - The blocker's view and the unblock (CHAT-07)

- **Steps:** on B's phone the strip offers `Desbloquear`; tap it (no confirmation); the composer returns; A can write
  again. The two follows deleted by the block stay deleted.
- **Evidence to paste:** the strip words, whether the composer returned, whether the follows stayed gone.
- **Status:** pending

## P7 - The administrator's block or removal on a hosted tenant (CHAT-06, CHAT-07)

- **Steps:** as the administrator block (then remove) a member who has a conversation with another; the conversation
  leaves the other member's list, the counter and the reads; unblock and it returns. An anonymised member's thread stays
  read only.
- **Evidence to paste:** the list before, during and after, with counts only.
- **Status:** pending

## P8 - A report of each of the six subjects (MODER-05)

- **Steps:** as a member report a post, a comment, a story, a story comment, a community and a direct message; try a
  repeated report and an own item. Staff see `Denunciar` but never `Bloquear {name}`.
- **Evidence to paste:** the confirmation words per subject, the repeated-report word, the own-item behaviour.
- **Status:** pending

## P9 - The `Nova denúncia` bell row and push (MODER-05)

- **Steps:** after a report, the administrator's bell shows one `Nova denúncia` row (never naming the subject) that opens
  the open queue, and the administrator's phone gets one push. Read how the banner reads on the phone: that wording is
  yours to approve.
- **Evidence to paste:** the row title, where the tap landed, the banner words.
- **Status:** pending

## P10 - The queue's voice row (MODER-05, MODER-04)

- **Steps:** report a direct voice message; the administrator opens the queue row and plays it through the report's
  player; the administrator can read no chat row and no other recording.
- **Evidence to paste:** whether it played, the status code of an attempt outside the report.
- **Status:** pending

## P11 - Resolve per subject (MODER-04)

- **Steps:** on a hosted tenant resolve one report per subject: remove content, archive the community (it reads
  `Arquivar comunidade` with the `Comunidade arquivada` badge), ignore, block the author of a message; two administrators
  racing on one report give one winner. Check the log row each member-content removal writes (an organization's story or
  community writes none, A-11-ORG).
- **Evidence to paste:** counts and the words of each confirmation.
- **Status:** pending

## P12 - The VoiceOver walk and P13 - the TalkBack walk (CHAT-06, CHAT-07, MODER-05)

- **Proves:** the phrases a screen reader speaks on the Conversas rows and the bubble count, the thread, the message
  menu, the strips, the report sheet, `Membros bloqueados`, the queue rows and the bell rows. Only a real reader can
  settle it (UI-D-879).
- **Steps:** walk the UI-SPEC accessibility list on one iPhone (P12) and one Android phone (P13).
- **Evidence to paste:** the device, the reader, what was spoken per screen, anything spoken assertively.
- **Status:** pending

## P14 - Focus return in iOS Safari and Firefox (CHAT-06, CHAT-07)

- **Proves:** that focus returns to the trigger after a sheet closes and after a row moves (happy-dom keeps the focus of
  a moved subtree, so the unit tests cannot discriminate).
- **Evidence to paste:** per browser, where the focus landed.
- **Status:** pending

## P15 to P18 - The four held-out visual rows (MODER-05, CHAT-06, CHAT-07)

- **P15 E2 overflow:** the report sheet and a thread bubble with a 2,000-character text and a long unbroken URL stay
  inside the screen at 320 and 390 px.
- **P16 E2 long-text:** a 60-character name keeps the row, the header, the bell row and the queue row intact at 320 px.
- **P17 E7 overflow:** the voice-message sheet with a 500-character note and its counter stays inside the sheet and the
  send button stays reachable at 320 px.
- **P18 E10 overflow:** the bell rows with a 60-character actor name keep the sentence intact at 320 px.
- **Evidence to paste:** per row, the viewport and whether anything overflowed or hid.
- **Status (P15):** pending
- **Status (P16):** pending
- **Status (P17):** pending
- **Status (P18):** pending

## P19 - The 40 px gutter trigger and the 44 px targets (CHAT-06, MODER-05)

- **Steps:** at 320 px the ellipsis trigger beside a received bubble measures 40 by 44 and from 390 px 44 by 44; every
  other target measures at least 44 px; no long press is needed.
- **Evidence to paste:** the measured sizes per viewport.
- **Status:** pending

## P20 - Story sheet, community sheet and the cover chip (MODER-05, CHAT-07)

- **Steps:** the story sheet at 320 px, the community sheet stacking, and the ellipsis chip on a photographic cover stay
  legible and reachable.
- **Evidence to paste:** per surface, the viewport and whether anything was hidden.
- **Status:** pending

## P21 - The run of `direct-chat.spec.ts` (CHAT-06, CHAT-07)

- **Proves:** the 10 cases of the spec that an agent only wrote and listed.
- **Needs:** Igor's word, the seeded local stack, `SEED_PASSWORD` exported, ffmpeg on PATH. Run the one file:
  `pnpm --filter @rede-social/web exec playwright test e2e/direct-chat.spec.ts`.
- **Expect to adjust:** the toast locator, the dialog names of the block step, the voice case if ffmpeg is missing.
- **Evidence to paste:** the pass and fail counts and the names of failing cases.
- **Status:** pending

## P22 - The run of `safety.spec.ts` (MODER-04, MODER-05)

- **Proves:** the 13 cases of the safety spec and the four shipped specs it edited (the `[data-comment-delete]`
  locators).
- **Needs:** as P21 plus `SUPER_ADMIN_PASSWORD` for the platform-host case.
- **Expect to adjust:** the resolve dialog names and the radio selection by label in the report sheet.
- **Evidence to paste:** the pass and fail counts and the names of failing cases.
- **Status:** pending

## P23 - The sketch 025 approval and its defaults

- **Proves:** that the provisional approval (your word of 2026-11-19, `approval_kind: provisional`) is confirmed as
  final against the built screens, together with the 22 defaults A-UI-1 to A-UI-22 (one sketch for the Phase 13 frames
  and the new screens, A-UI-22, included). The agent does not edit the sketch README.
- **Evidence to paste:** per default, "manter" or "trocar".
- **Status:** pending

## P24 to P27 - The planner's assumptions (CHAT-07, MODER-05, MODER-04)

- **P24 A-11-ROLE:** `canBlock` is false for staff, decided on the server by the request's registered role; the database
  function is not narrowed by role. Alternative: narrow the function too (one more check and a test).
- **P25 A-11-COPY:** the "copy" of a reported voice message is a reference to the recording plus the stored duration,
  not a second file; it reads `Mensagem de voz apagada` once the recording is retired. Alternative: copy the file.
- **P26 A-11-SC:** the list of story comments gains the blocker's filter, so `Bloquear {name}` on a story comment hides
  something. Alternative: no filter.
- **P27 A-11-ORG:** removing an organization's story or community from the queue writes no moderation log row; the report
  keeps who resolved it. Alternative: a row for every queue action.
- **Answer:** "manter" or "trocar" per row.
- **Status (P24):** pending
- **Status (P25):** pending
- **Status (P26):** pending
- **Status (P27):** pending

## P28 - Push suppression and once-per-pair (CHAT-06, CHAT-07)

- **Proves:** that a follow undone before the worker runs still rings the follow bell once, that the row is never
  retracted, that no push goes with a follow notice, and that a pair that is closed at fan-out time gets nothing.
- **Evidence to paste:** counts of rows and pushes per case.
- **Status:** pending

## P29 - The read-only check and the dry run (hosted)

- **Steps:** run the four read-only queries of "Read-only check on EVERY hosted project" in `docs/DEPLOY.md` on each
  hosted project (before: A and B return no row, C answers f) and `pnpm db:migrate-all -- --dry-run`.
- **Evidence to paste:** shapes and counts only, never a ref.
- **Status:** pending

## P30 - The homolog deploy (hosted)

- **Steps:** migrations, web, then API and worker together, as in the release section; then its smoke checks.
- **Evidence to paste:** the order, the exit status of each step, the smoke outcomes.
- **Status:** pending

## P31 - Production step 1: the migrations (hosted)

- **Steps:** `pnpm db:migrate-all`, one project at a time, never two runs at once; then the after-check queries E to I of
  the release section. They are read-only; two of them for reference:

```sql
select (select count(*) from pg_indexes where indexname = 'chat_conversations_direct_pair_uq') as pair_index,
       (select pg_get_constraintdef(oid) ilike '%direct_message%' from pg_constraint
         where conname = 'content_reports_subject_type_chk') as wider_check;
-- expected: 1, t
select count(*) from public.chat_conversations
 where kind = 'direct' and (direct_low_user_id is null or direct_high_user_id is null);
-- expected: 0
```

- **Evidence to paste:** the pending count per project before and after, and the answers above.
- **Status:** pending

## P32 and P33 - Production steps 2 and 3: the web, then the API and the worker (hosted)

- **Steps:** the web second; the API and the worker last, from one image build and in the same sitting. Confirm the new
  worker revision before the API takes traffic (the push hint schema is strict).
- **Evidence to paste:** the revision names (no secrets) and the time between the two steps.
- **Status (P32):** pending
- **Status (P33):** pending

## P34 - The first-day checks in production

- **Steps:** on a tenant without `social` the entries of the report and block slice and the two settings rows appear
  and nothing about conversations or follows; on a tenant with `social` and `chat` a real exchange and a real report.
- **Evidence to paste:** per tenant, what showed.
- **Status:** pending

## P35 - The `social` toggle and the administrator's block on a hosted tenant

- **Steps:** turn `social` off: Conversas and follows go; turn it on: they return. Block as an administrator and watch the
  conversation leave and return.
- **Evidence to paste:** per state, what the member saw.
- **Status:** pending

## P36 - `Mensagem de voz apagada`

- **Steps:** delete a throwaway member who sent a direct recording; the thread keeps the message with no player and the
  words `Mensagem de voz apagada`; the report row of that recording reads the same.
- **Evidence to paste:** the words shown.
- **Status:** pending

## P37 - The Phase 13 hand-over (stated, not edited)

- **Records:** plan 13-20's screens are built by this phase from sketch 025; plan 13-20 shrinks to an in-app check and
  its sketch guard points at 017 until the orchestrator re-points it. No file under `.planning/phases/13-*` was touched
  by any plan of this phase. Confirm the ROADMAP and STATE wording the orchestrator writes.
- **Status:** pending

## P38 - The full `pnpm verify`

- **Steps:** on your word, run it on your local database (it resets and seeds, so no agent does).
- **Evidence to paste:** the exit status and the names of any failing step.
- **Status:** pending

## P39 - The review of the replaced security-relevant functions

- **Steps:** read the diff of each replaced body against its previous newest version (only added lines expected):
  `app.chat_messages_before_insert` and `app.chat_messages_after_insert` (item 5), `app.member_block_create` (item 7),
  `app.content_report_create` (item 10) and `app.chat_asset_hidden` (item 13).
- **Status:** pending

## P40 - The local residue

- **Records:** the failures already present before this phase on the local database (a stale seed): pgTAP `120 #37`,
  `141 #21`, `232 #56` (EXPLAIN by name, Seq Scan) and `154 #65` (local residue); the integration files `stories`,
  `feed-query-budget`, four cases of `isolation` (stories b3 and b8, two events cases) and cases 1 and 9 of `modules`.
  Clearing them needs a seeded reset, which is your word.
- **Status:** pending

## P41 - Residuals to confirm

- **Records:** the API emits no signal on a block or unblock (an open thread learns on the next message signal,
  subscribe or refocus); the header of an open thread keeps a removed member's old name until the next navigation;
  `unreadCount` is capped at 100 in the strict contract (the plan said 120) and shows `99+`; `app.realtime_topic_allowed`
  is not changed, so a participant of a pair keeps its `conv:` topic while `social` is off (a signal carries ids only
  and the API refuses everything).
- **Status:** pending

## Assumptions and residuals to confirm

- **A-11-ROLE, A-11-COPY, A-11-SC and A-11-ORG** (rows P24 to P27) and the **22 defaults A-UI-1 to A-UI-22** (row P23).
- **A5:** the banner is suppressed in the foreground by the global service-worker rule (row P2).
- **The follow notice** reads `Começou a te seguir` and is never retracted (A-UI-16); the report notice reads
  `Nova denúncia` and opens the open queue.
- **The staff-participants policy fix of plan 11-09:** staff no longer read the participant rows of a direct
  conversation (migration item 12 of the release section); confirm that no staff screen relied on them.
- **The report subject list is appended and one-way** (D-730, migration item 9).
- **The e2e specs** carry the likely first-run adjustments listed in "What was NOT run".
- **The first-day effect to tell the tenants (decision):** every tenant gets the report and block entries and the two new
  settings rows, whether or not `social` is on (D-616). Whether to warn the tenants' administrators is yours.

