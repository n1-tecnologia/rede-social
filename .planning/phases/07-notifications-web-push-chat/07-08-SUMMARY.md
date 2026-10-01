---
phase: 07-notifications-web-push-chat
plan: 08
subsystem: chat
tags: [chat, support, module-package, seq, triggers, realtime-broadcast, rls, push, drizzle, pgtap, hono]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-01 app.realtime_topic_allowed (conv:/support-inbox grammar), app.realtime_signal, the notification seam and countersFor; 07-03 realtime-helpers; 07-06 push-only intents through the push channel"
  - phase: 01-foundation
    provides: "the chat stub tables (chat_conversations, chat_participants, chat_messages) with chat_conversations_one_support_per_member and chat_messages_conversation_seq_uq"
provides:
  - "@rede-social/module-chat (./module, ./contracts, ./server, ./db)"
  - "chat tables moved into the module and reshaped: last_seq, last_staff_seq, staff_last_read_seq, last_message_side, last_read_seq, author_side, body/side CHECKs, chat_conversations_inbox_idx, participant/staff-aware policies"
  - "app.chat_messages_before_insert (gapless seq under the conversation row lock) and app.chat_messages_after_insert (ids-only chat.message / chat.unread signals), both definers"
  - "routes: GET /v1/chat/support, POST /v1/chat/support/messages, GET /v1/chat/conversations/{id}, GET|POST /v1/chat/conversations/{id}/messages, POST /v1/chat/conversations/{id}/read, GET /v1/chat/inbox"
  - "chatCounters (member dot / staff count) and bootstrap.counters.conversationsBadge"
  - "chat.message_sent push-only source (chat.support_reply, chat.member_message)"
  - "chat.support moved from KERNEL_ROLE_PERMISSIONS to the chat manifest (both staff roles); members get chat.support.contact"
  - "seed: support@rede-demo.local (Carla Rocha), support@rede-lab.local (Bruno Lima), one demo support thread (1d000000-…-0001, three messages)"
affects: [07-09 chat UI (member thread, inbox, dot badge), 07-10 chat e2e, 07-11 deploy order and DEPLOY.md, 08 moderation/block]

actuals:
  tokens: 49800
  tasks: 3
  commits: 3
plan_head_before: 6d093ea53aa0ec472555865214c7e84402e16cad

tech-stack:
  added: []
  patterns:
    - "Per-conversation gapless seq from a BEFORE INSERT definer that increments a counter column under the row lock (commit order = seq order)"
    - "Trigger-published ids-only Realtime signals: every writer (API, seed, tests, psql) publishes inside its own transaction"
    - "Participant/staff-aware RLS for data private between members of the same tenant, staff role list as an inline literal pinned against permissionsFor"
    - "Manifest counters receive the caller's composed permissions, so a module picks what to count by permission"
    - "Push-only notification intents (channels: ['push']) for conversational kinds; no bell row"

key-files:
  created:
    - packages/modules/chat/package.json
    - packages/modules/chat/module.ts
    - packages/modules/chat/contracts/index.ts
    - packages/modules/chat/db/schema.ts
    - packages/modules/chat/server/index.ts
    - packages/modules/chat/server/routes.ts
    - packages/modules/chat/server/service.ts
    - packages/modules/chat/server/notifications.ts
    - packages/modules/chat/server/notification-copy.ts
    - packages/modules/chat/server/first-name.ts
    - packages/modules/chat/tests/contracts.test.ts
    - packages/modules/chat/tests/first-name.test.ts
    - packages/modules/chat/tests/notification-sources.test.ts
    - supabase/migrations/20260930190151_chat.sql
    - supabase/migrations/20260930190229_chat_functions.sql
    - supabase/tests/152-chat.sql
    - apps/api/tests/integration/chat.test.ts
  modified:
    - packages/core/db/schema/chat-stubs.ts (deleted: moved into the module)
    - packages/core/db/schema/index.ts
    - packages/core/server/rbac/require-role.ts
    - packages/core/server/modules/manifest.ts
    - packages/core/server/modules/counters.ts
    - packages/core/ui/AppShell.tsx
    - packages/core/tests/require-role.test.ts
    - packages/contracts/src/bootstrap.ts
    - apps/api/package.json
    - apps/api/src/app.ts
    - apps/api/src/modules/registry.ts
    - apps/api/src/routes/me.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/modules.test.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/realtime.test.ts
    - supabase/tests/020-tenant-isolation.sql
    - apps/web/app/(app)/layout.tsx
    - scripts/seed.ts
    - pnpm-lock.yaml

key-decisions:
  - "Signal payloads are { conversationId, seq } and the installed realtime.send adds its own message-row id, so delivered keys are conversationId, id, seq (the 07-01 finding, still ids-only)"
  - "The chat BEFORE INSERT trigger fires before the ON CONFLICT arbiter, so no writer may insert chat_messages with on conflict (a conflicting insert would burn a seq); the seed checks for an empty thread instead"
  - "Read marks move positions forward only, capped at last_seq, and signal (chat.read on support-inbox, chat.unread on the member's user topic) only when the position actually moved"
  - "GET /v1/chat/conversations/{id}/messages refuses afterSeq and beforeSeq together (400); no cursor answers the latest page"
  - "The chat package ships server-only for now (no ./ui export, no React deps); 07-09 adds the UI and its dependencies"
  - "AppShell's counters prop gains an optional conversationsBadge so the platform branch can pass 'count' before 07-09 renders the dot"
  - "The member-message push body is the whole 'Nova mensagem de {member}: {preview}' cut on a word to 100 graphemes (the feed's PUSH_BODY_MAX rule); a missing member name reads 'um membro'"

patterns-established:
  - "Counter-row seq: BEFORE INSERT definer updates the parent's counter and returns it into NEW.seq; AFTER INSERT definer publishes"
  - "pgTAP inbox EXPLAIN-by-name mirrors the service keyset predicate verbatim"
  - "Integration tests that need a member without a thread delete the seeded thread and restore it exactly (same ids, trigger-assigned seqs)"

requirements-completed: [CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, NOTIF-01]

coverage:
  - id: D1
    description: "Chat tracer: a member writes, the support user reads the same message and replies (seq 1 then 2), the member's afterSeq=1 catch-up is exactly the reply with the agent's first name only, and each insert committed one ids-only chat.message on conv: and support-inbox"
    requirement: CHAT-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#chat tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "Generic V2-ready schema (CHAT-01): kind + role-bearing participants + per-conversation seq, one support thread per member, no status column, participant/staff-aware policies"
    requirement: CHAT-01
    verification:
      - kind: other
        ref: "supabase/tests/152-chat.sql facts 1 and 5 (pnpm supabase test db)"
        status: pass
      - kind: other
        ref: "supabase/tests/020-tenant-isolation.sql (chat USING-touches-0 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Gapless ordered delivery (CHAT-04): trigger seq 1..N regardless of supplied seq, no gap after a refused insert, 20 concurrent first messages make one conversation with seqs 1..20, 20 concurrent staff replies continue 21..40, afterSeq/beforeSeq catch-up"
    requirement: CHAT-04
    verification:
      - kind: other
        ref: "supabase/tests/152-chat.sql facts 3 and 4"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#chat sequência"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live Realtime: the member hears the reply on conv: and the dot on its user topic, staff hear member messages on support-inbox and conv:, another member cannot join, chat off refuses conv:, a rolled-back staff insert delivers nothing"
    requirement: CHAT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/realtime.test.ts#realtime chat (live)"
        status: pass
      - kind: other
        ref: "supabase/tests/152-chat.sql fact 6"
        status: pass
    human_judgment: false
  - id: D5
    description: "Within-tenant and cross-tenant privacy: the lab thread is a bare 404 to demo members and demo staff, a second demo member gets a bare 404 on the first member's thread, the lab host is refused"
    requirement: CHAT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b12. chat"
        status: pass
    human_judgment: false
  - id: D6
    description: "Body rules (CHAT-02 empty/encoding): whitespace-only and all-newline bodies are body_required with no conversation created, 2,001 code points body_too_long, 2,000 emoji accepted, inner newlines stored as sent"
    requirement: CHAT-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#CHAT-02 empty and encoding"
        status: pass
      - kind: unit
        ref: "packages/modules/chat/tests/contracts.test.ts"
        status: pass
      - kind: other
        ref: "supabase/tests/152-chat.sql fact 2"
        status: pass
    human_judgment: false
  - id: D7
    description: "Staff inbox (CHAT-03): last_message_at desc, id desc with an equal-instant pair ordered by id, a limit=1 walk visiting each thread once, awaiting at the staff_last_read_seq boundary, the empty tenant, member state active/blocked/removed, blocked/removed replies refused with 409"
    requirement: CHAT-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#chat suporte (ordering, empty, blocked and departed)"
        status: pass
      - kind: other
        ref: "supabase/tests/152-chat.sql fact 7 (chat_conversations_inbox_idx by name)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Badges (CHAT-05, D-225, D-237, D-238): member dot 1 after a staff reply and 0 after the member's read, staff count cleared for every staff member by one read or reply, conversationsBadge dot/count in bootstrap and /v1/me/counters"
    requirement: CHAT-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#chat suporte (D-225, CHAT-05)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#15, #16"
        status: pass
    human_judgment: false
  - id: D9
    description: "Permissions (D-223): chat.support only from the chat manifest for both staff roles, staff get 403 on the member routes and own no thread, disabling chat revokes chat.support and 404s /v1/chat, and the TypeScript role list equals the SQL literal lists"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#chat suporte (D-223 cases, Pitfall 4)"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts, packages/core/tests/require-role.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/modules.test.ts"
        status: pass
    human_judgment: false
  - id: D10
    description: "Push-only support notifications (NOTIF-01 support replies, D-228/D-235): a staff reply enqueues one push job for the member titled for the team, a member message one for the live staff, 32-hex tag/topic, renotify, high urgency, 72 h TTL, and no notifications row"
    requirement: NOTIF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/chat.test.ts#D-228 / D-235"
        status: pass
      - kind: unit
        ref: "packages/modules/chat/tests/notification-sources.test.ts"
        status: pass
    human_judgment: false
  - id: D11
    description: "The push banners as they actually appear on a phone (title 'Equipe {tenant}', body cut, tap routing to /suporte and /suporte/{id})"
    requirement: NOTIF-01
    verification: []
    human_judgment: true
    rationale: "The OS banner and the tap routing need the 07-09 pages and a real device; real-device UAT is blocked locally until the phase UAT."

duration: 37min
completed: 2026-09-30
---

# Phase 7 Plan 08: Support Chat, Server Side Summary

**Members write to their organisation's team in one permanent thread and any staff member answers. Every message gets a gapless per-conversation seq from a row-lock trigger, and a definer trigger publishes ids-only Realtime signals. A shared staff read position drives the member's dot and the staff's awaiting count, and support messages push to the other side without touching the bell.**

## Performance

- **Duration:** 37 min
- **Started:** 2026-09-30T18:57:03Z
- **Completed:** 2026-09-30T19:34:07Z
- **Tasks:** 3 of 3
- **Files modified:** 44 (41 excluding drizzle snapshots and the lockfile)

## Accomplishments

- New module package `@rede-social/module-chat`. The three Phase 1 stub tables moved in unchanged (`pnpm db:generate` wrote nothing for the move alone) and were then reshaped with conversation counters, the team's shared `staff_last_read_seq`, `author_side`, the code-point body CHECK, the inbox index and participant/staff-aware policies.
- Two definer triggers:
  - The BEFORE trigger assigns `seq` under the conversation row lock. Seqs are gapless and unique, and commit order equals seq order.
  - The AFTER trigger publishes `chat.message` on `conv:` and `support-inbox`, plus `chat.unread` on the member's user topic for staff messages. Every writer publishes, inside its own transaction.
- Member routes:
  - Lazy creation: `GET /support` never writes, and the first `POST /support/messages` creates the conversation in its own transaction.
  - The staff reply refuses blocked and removed members with 409.
  - Seq catch-up and history.
- Staff routes: the conversation detail, the shared read mark and a keyset inbox with member state, a one-line preview and `awaiting`.
- `chat.support` moved from the kernel to the chat manifest for both staff roles, and members get `chat.support.contact`. The counters seam now receives permissions, so the chat decides between the member's dot and the staff count.
- A push-only `chat.message_sent` source: support replies go to the member, member messages go to the live staff. Neither writes a bell row.
- Proof:
  - pgTAP 152 (52 assertions) and the updated pgTAP 020.
  - Isolation case b12.
  - Five live Realtime chat cases.
  - The concurrency and catch-up proofs.
  - The full `chat suporte` battery.
- Seed: support users for both tenants and one demo support thread.

## Task Commits

1. **Task 1: chat end to end (module, schema move and reshape, triggers, lazy send, staff reply, catch-up, seed, tracer)**: `f5b21b8` (feat)
2. **Task 2 [BLOCKING schema]: pgTAP 152, 020 fixtures, isolation b12, live Realtime chat, concurrency**: `9b0801e` (test)
3. **Task 3: inbox, shared read state, counters with conversationsBadge, permission move, blocked/departed refusals, push-only source, API battery**: `09c4a33` (feat)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

See `key-files` above. The main ones:
- `packages/modules/chat/db/schema.ts`: the reshaped tables and the three `*_access` policies.
- `supabase/migrations/20260930190151_chat.sql`: the generated reshape.
- `supabase/migrations/20260930190229_chat_functions.sql`: the seq and signal triggers.
- `packages/modules/chat/server/service.ts`: the send, reply, reads, read marks, inbox and counters.
- `packages/modules/chat/server/notifications.ts` and `notification-copy.ts`: the push-only source and the pt-BR banner bodies.
- `packages/core/server/modules/{counters,manifest}.ts`, `packages/contracts/src/bootstrap.ts`, `apps/api/src/modules/registry.ts`: the widened counters seam.

## Decisions Made

See `key-decisions`. Two more:
- The realtime chat cases use a thread that `iris.munoz@rede-demo.local` opens through the API, so the seeded `member@` thread is never mutated there. The chat tracer needs `member@` without a thread, so it deletes the seeded thread and restores it exactly: same ids, with the trigger assigning seqs 1..3 again.
- The staff role list stays an inline SQL literal, as in 07-01's definer. The role-drift test reads it from `pg_policies` (`chat_conversations_access`, `chat_participants_access`) and from `pg_get_functiondef(app.realtime_topic_allowed)`, and compares it with `permissionsFor` over every module key.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Signal payload keys are `conversationId, id, seq`, not `conversationId, seq`**
- **Found during:** Task 1 (tracer)
- **Issue:** The installed `realtime.send` injects its own message-row uuid as `id` into any payload that lacks one. This is the same finding as 07-01 deviation 1.
- **Fix:** The tracer, pgTAP 152 fact 6 and the live cases assert the three keys, and they check that `payload.id` equals the `realtime.messages` row id. The payload is still ids-only, and it never carries the body.
- **Committed in:** f5b21b8, 9b0801e

**2. [Rule 3 - Blocking] drizzle-kit asks a create-or-rename question for the replaced policies**
- **Found during:** Task 1 (`pnpm db:generate --name=chat`)
- **Issue:** The generator needs a TTY to ask whether `chat_*_access` renames `chat_*_tenant_isolation`, and the agent shell has none.
- **Fix:** I ran the generator under a pseudo-TTY (`script`) and chose the default, "create", for each policy. The single migration drops the three isolation policies and creates the three access policies. `pnpm db:generate` afterwards writes nothing.
- **Committed in:** f5b21b8

**3. [Rule 1 - Bug] A conflicting insert into `chat_messages` would burn a seq**
- **Found during:** Task 1 (seed idempotency)
- **Issue:** Postgres fires BEFORE INSERT row triggers before the ON CONFLICT arbiter. A re-run seed using `on conflict (id) do nothing` would bump `last_seq` without inserting, which leaves a gap.
- **Fix:** The seed writes the three messages only when the thread is empty. The migration header states the rule: no writer may use ON CONFLICT on this table. The API never does.
- **Committed in:** f5b21b8

**4. [Rule 3 - Blocking] `modules.test.ts` updated in Task 1 instead of Task 3**
- **Found during:** Task 1 (full integration run)
- **Issue:** Registering the chat manifest immediately changed the bootstrap order (`chat`, nav order 20, ties `communities` and sorts first by key) and the member's permissions (`chat.support.contact`).
- **Fix:** Cases 1, 2 and 13 now expect the new order, the chat slot verbatim and the member's two permissions.
- **Committed in:** f5b21b8

**5. [Rule 3 - Blocking] Files outside `files_modified`**
- `packages/core/ui/AppShell.tsx`: the counters prop gains an optional `conversationsBadge`. Without it, the platform branch's `conversationsBadge: 'count'` would be an excess-property type error.
- `packages/core/tests/require-role.test.ts`: it pinned `support_tenant: ['chat.support']`. It now pins `[]` and asserts that no kernel role carries `chat.support`.
- **Committed in:** 09c4a33

**6. [Test precision] pgTAP 152: an unknown author side is refused by the conversation's CHECK first**
- **Issue:** The seq trigger copies `author_side` onto the conversation before the row's own CHECK runs, so `chat_conversations_last_side_chk` fires before `chat_messages_author_side_chk`.
- **Fix:** The fact asserts SQLSTATE 23514, and its description explains the order. Either constraint refuses the write.
- **Committed in:** 9b0801e

**7. [Rule 2 - Correctness] Read marks are forward-only and signal only on change**
- **Issue:** The plan's read statements already cap and floor the position. Signalling on every POST would make every open tab refetch for nothing.
- **Fix:** Both branches lock the row, update it, and publish (`chat.read` on `support-inbox`, `chat.unread` on the member's topic) only when the position moved. A foreign or unknown thread is a bare 404, and a negative seq is a 400.
- **Committed in:** 09c4a33

**8. [Plan detail] No `./ui` export yet**
- **Issue:** The artifacts list names `./ui`, but no UI is built in 07-08.
- **Fix:** The package exports `./module`, `./contracts`, `./server` and `./db`, with server-only dependencies. 07-09 adds `./ui`, React and the happy-dom test setup.
- **Committed in:** f5b21b8

**9. [Plan detail] 020 plan count 153 → 157, and pgTAP 152 uses 400 conversations per tenant**
- **Fix:** The four new 020 assertions are a positive control plus a USING-touches-0 case for each chat table. Fact 7's fixture is 400 support conversations in A and 400 in B, analyzed, and the planner picked the inbox index by name at that size.
- **Committed in:** 9b0801e

---

**Total deviations:** 9 (2 Rule 1, 1 Rule 2, 3 Rule 3, 3 plan-detail or test-precision)
**Impact on plan:** Deviation 3 prevents a real seq gap. Deviations 1, 2 and 6 record how the platform behaves. The rest keep the build green or follow the codebase's structure. There is no scope creep.

## Issues Encountered

- The full API integration suite passes 701 of 702 tests. The one failure is the known pre-existing `signup.test.ts` case 2, caused by the `<old-brand>-*` env hosts (see `deferred-items.md`). I did not work around it.
- Seeded hosts: `db:seed` still prints `<old-brand>-*.localhost`. Every chat test reads its hosts from the env and passes.

## Known Stubs

| File | Line | Stub | Resolved by |
|------|------|------|-------------|
| packages/modules/chat/module.ts | nav | The Suporte TopBar slot links to `/suporte`, which has no page yet. The member's `unreadConversations` still renders as a count badge; the dot for `conversationsBadge: 'dot'` is not drawn yet. | 07-09 (member thread, staff inbox, dot badge) |

## Notes for 07-11

- **Deploy order:** the API (Cloud Run) must deploy BEFORE the web (Vercel). `bootstrapSchema.counters` is a plain `z.object` that strips unknown keys and now requires `conversationsBadge`. A web build that parses it before the API sends it would fail validation. This is the 06-01 precedent, and the `deferred-items.md` entry from 07-01 applies.
- **Migrations:** `20260930190151_chat.sql` adds `chat_messages.author_side text NOT NULL` without a default. The chat tables have had no writer in production, so the column adds cleanly on the empty tables. Check that with `select count(*) from chat_messages` before `supabase db push`.
- **Seeded support users** follow the existing `SEED_PASSWORD` convention: `support@rede-demo.local` (Carla Rocha) and `support@rede-lab.local` (Bruno Lima), both `support_tenant`. The demo thread belongs to `member@rede-demo.local` (`1d000000-0000-4000-8000-000000000001`).

## User Setup Required

None. No external service configuration is needed.

## Next Phase Readiness

- 07-09 can build `/suporte` against these contracts:
  - `GET /v1/chat/support` for the member thread;
  - `GET /v1/chat/inbox` and `GET /v1/chat/conversations/{id}` for the staff split view;
  - `?afterSeq=` catch-up on every `chat.message` signal, re-join or refocus;
  - `POST /read` on open.
  - `bootstrap.counters.conversationsBadge` picks the dot or the count, and `bootstrap.permissions` (`chat.support` / `chat.support.contact`) picks the thread or the inbox.
- The service worker already shows and routes the chat push payloads (07-07). The chat tags are 32-hex conversation ids.
- Phase 8's block action affects chat as follows: a blocked member's thread stays readable, and replies answer 409 `member_blocked`.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All seventeen created key files exist on disk, and the three task commits (`f5b21b8`, `9b0801e`, `09c4a33`) are in history.
