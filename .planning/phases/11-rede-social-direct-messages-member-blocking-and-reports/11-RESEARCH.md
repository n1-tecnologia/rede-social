# Phase 11: Rede Social - Direct Messages, Member Blocking and Reports - Research

**Researched:** 2026-11-19
**Domain:** brownfield extension of Phase 7 chat, Phase 9 follow graph, Phase 10 member content and the Phase 13 report and block slice (Postgres RLS/definers, Hono API, pg-boss worker, Next.js web)
**Confidence:** HIGH on the existing-code facts (every discrete value below was read from source this session); MEDIUM on the proposed names and numbers (they are the planner's to fix, tagged `[ASSUMED]`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Decision ids D-719..D-739 are this phase's block (reserved by Phase 10.1 and 10.2). Igor chose every default option offered below in the discussion of 2026-11-19, in plain pt-BR, one question at a time.

**Conversations (where they live and how they start)**
- **D-719:** With `social` effective for the tenant, the top-bar chat bubble opens a list "Conversas". The support chat is its first, pinned row (it opens the member's active case exactly as today) and the direct conversations follow, newest activity first. With `social` off the bubble keeps opening the active case directly, so D-220 and D-803 hold unchanged for every tenant without `social`. The bubble's unread number (`bootstrap.counters.unreadConversations`) adds the unread direct conversations. Staff are untouched, they have the inbox and no direct conversations (D-482).
- **D-720:** A direct conversation starts from two places only. The "Enviar mensagem" button on another member's profile and a message control on each `/membros` row, the same places as the Seguir button (D-470). It is created lazily on the first message, the way the support case is. A conversation with no message does not exist and does not show in the list. There is at most one conversation per pair of members, so the button opens the existing one. Following is not required, and a member cannot message staff, themselves, a removed member or a member of another tenant. — **Reversibility:** costly — the one-per-pair rule is a unique constraint over the two participants, and lifting it later means deciding which of several conversations survives.
- **D-721:** When the administrator blocks a member (`memberships.blocked_at`) or the membership is removed, a direct conversation with that member leaves the other participant's list and refuses new messages, nothing is deleted, and it returns whole when the administrator unblocks, the same behavior as posts and the directory (D-484). When the account is deleted for good (Phase 13 anonymisation) the conversation stays for the other participant, read only, with the other side shown as "Membro removido".

**What a member block changes**
- **D-722:** A blocked member (B) who writes in a conversation with the member who blocked (A) finds the composer closed with the plain sentence "Esta conversa não aceita novas mensagens." and no reason. B still reads the history. Nothing is sent, nothing is delivered, nobody is told, and the refusal code and wording never say "bloqueado" or name A. The same neutral refusal applies when B tries to start a conversation. A's profile does not offer B the "Enviar mensagem" button or the Seguir button, as the roadmap says.
- **D-723:** On A's side the existing conversation stays in the list and the history stays readable (it is the evidence for a later report). The composer is replaced by "Você bloqueou {nome}" and a "Desbloquear" button, and A cannot send while the block stands. Unblocking restores the composer. Neither side gets a notice.
- **D-724:** Blocking deletes the follow rows between the two members in both directions, in the same transaction as the block. Unblocking does not bring them back, whoever wants to follow again follows again. A new follow between a blocked pair is refused (the roadmap's criterion 2), with a neutral refusal. — **Reversibility:** costly — the follow rows are removed, so a later "restore on unblock" needs a different model that keeps them as soft state.
- **D-725:** Nothing else changes for the blocked member. B keeps seeing A's profile and public posts and may like and comment on them. A keeps not seeing B's posts and comments, through the filter Phase 13 shipped (`app.is_blocked_by_viewer`). The block adds no new feed, Explorar, community, story or directory filter.

**Notices**
- **D-726:** A member's post keeps notifying nobody. D-476 is now the decision and not an interim answer, and followers find the post in Explorar. The author is still told of first-level comments on their own post (D-477).
- **D-727:** "Começou a te seguir" is a new in-app kind, a row in the bell and no push, like a like (D-235). It is sent once per pair, so a follow, unfollow and follow again does not notify twice. It exists only with `social` on and never reaches a blocked pair. — **Reversibility:** costly — notification kinds are stored strings and renderers grow around them (D-448).
- **D-728:** "Nova mensagem" lights the unread number on the bubble and the Conversas row, and sends one push per conversation (the push `tag`), with no row in the bell, the same shape as the support reply (D-228). The push title is the name of whoever wrote and the body is the start of the message, about 100 characters, and a voice message reads "Mensagem de voz" with its duration as `m:ss` (D-860). No push goes to a blocked pair, when `social` is off, or to a participant who is looking at the conversation (D-236).
- **D-729:** A new report notifies the people who hold `moderation.manage` with a row in the bell and a push titled "Nova denúncia". It never says what was reported or by whom, there is one per report, and it applies to every subject type including the posts and comments Phase 13 already accepts. The report's author and the reported member are never told (D-616 holds). — **Reversibility:** costly — a new kind that the admin bell renders and the worker fans out.

**Reports of the new subjects**
- **D-730:** `REPORT_SUBJECT_TYPES` and the `content_reports_subject_type_chk` CHECK are appended with `story`, `story_comment`, `community` and `direct_message`, never inserted, as the contract header already plans (`packages/contracts/src/moderation.ts`). The five reasons, the 500-character note, one report per reporter and item, no report of one's own content and the exclusion of other tenants' items stay as in Phase 13 (AD-5..AD-7). Staff content can be reported (AD-1). — **Reversibility:** one-way — the CHECK list is fixed with the table and grows only by appending.
- **D-731:** A report of a direct message stores a copy of only the reported message (the 280-character excerpt already in the contract, or the recording for a voice message). The administrator reads that copy and nothing else of the conversation, and the rest stays private. A reported voice message is audible to a holder of `moderation.manage` only through that report (a new read seam beside D-867's `app.chat_asset_hidden`, and nobody outside the conversation and the report can play it). — **Reversibility:** costly — widening the stored context later (the messages around it) changes the report row and every reader of it.
- **D-732:** The administrator's actions depend on the subject. For a message the sheet offers "Ignorar" and "Bloquear autor" only, because the chat is append only (D-859) and a hidden message is not built. "Bloquear autor" is the administrator's tenant-level block of Phase 8, for every subject. For a member community "Remover conteúdo" archives it (the `community_archived` log row of MCOMM-10), reversible, and removing it for good stays outside the queue. For a story it is the existing `story_removed` path (MSTORY-09), and for a story comment the existing `comment_removed` path. Every action that removes or blocks writes its `moderation_log` row in the same transaction, as Phase 13's resolve already does.
- **D-733:** The "Denunciar" entry sits in the context menu of each subject, the story viewer, the community header, the story comment and the message bubble, next to "Bloquear {nome}" where the author is a member, the pattern of UI-D-632..UI-D-638 drawn in sketch 017. The entry follows where the content is shown, so it works with `social` on or off for whatever is still visible (AD-8). Exact placement and copy are the UI phase's call.

**Voice and inherited surfaces**
- **D-734:** A direct conversation uses the same composer, message model, bubble and player as the support chat, so voice messages (up to 5 minutes, Phase 12.5) work in it without a new recorder or player. Phase 11's acceptance names "voice in direct chats", including that only the two participants play the recording (D-858, D-867), and the plan must not rebuild any of it.

**Carried forward, not discussed again** (informational)
- D-482 (09): only `member` takes part in the social surfaces, staff have no direct conversation.
- D-483 (09): with `social` off everything social hides and nothing is deleted, so direct conversations and follows return when it is turned back on.
- D-484 (09): a member the administrator blocked disappears until unblocked.
- D-467 (09): the follow graph is member to member only.
- D-470 (09): the Seguir button sits on the profile, the "Siga para ver" screen, each `/membros` row and the two private lists, nowhere else.
- D-476 (09): answered finally by D-726 above.
- D-616 (13): the minimum report and block slice, nobody told, staff cannot be blocked by a member, the block is not gated by `social`.
- D-220 (07): the bubble opens the support thread directly with no help hub, kept for tenants without `social` by D-719.
- D-228 (07): support replies light the chat badge and push without a bell row, the model for D-728.
- D-235 (07): every in-app kind except likes is pushed, the baseline D-727 departs from on purpose.
- D-800 (12.4): `direct` and `group` conversations keep every rule they had, the case columns stay null for them.
- D-846 (12.5): a message is text or one recording, and everyone who may send text may send voice.
- D-859 (12.5): nobody edits or deletes a sent message, text or voice.
- D-860 (12.5): a voice message reads "Mensagem de voz" plus its duration wherever a preview shows.

### Claude's Discretion
- The UI-gate path. The default is one new sketch (next free number after 024) that carries the Phase 13 report and block frames forward (`post-menu-denunciar`, `denunciar-*`, `bloquear-dialogo`, `bloqueados-*`, `denuncias-*`) together with the new surfaces (the Conversas list, the conversation with its closed and blocked composer states, the profile button, the message and story and community report entries, the "Nova denúncia" bell row), approved once by Igor's pasted frontmatter (D-417). Plan 13-20 then shrinks to an in-app check, as the roadmap says. Igor did not decide this in the discussion and confirms or overturns it at the sketch review.
- Abuse limits on direct messages. A text message keeps the support chat's 1 to 2000 characters after trim, and the per-member send rate reuses the attempt limiter Phase 13 added (13-13). The numbers are the planner's.
- The error codes and exact pt-BR wording of the neutral refusals (D-722), the "Membro removido" label, empty states, and how the blocker's profile shows "Desbloquear" in place of the message and Seguir buttons.
- Whether the "começou a te seguir" row is retracted when the follow is undone (the keep-and-mark path of D-448..D-454), and how "once per pair" is stored.
- Which routes and RLS policies carry the member lane of direct messages (the chat triggers and the case transitions of Phase 12.4 must be proved to leave `direct` rows alone, as `supabase/tests/235-chat-cases.sql` already pins for the case columns).
- The reading order and paging of the Conversas list, the unread counting, and the realtime topic per conversation (`tenant:<tenant_id>:conv:<conversation_id>` already exists).

### Deferred Ideas (OUT OF SCOPE)
- Group chats (`kind = 'group'`), message requests ("Solicitações"), muting, archiving or deleting a conversation, and a setting for who may message me. Not asked, and each is a new capability.
- Context around a reported message (the messages before and after) and an administrator action that hides a message. Considered and not chosen, revisit if a pilot tenant's moderation shows the need.
- A "Nova conversa" button with a member search in the Conversas list.
- A notice to followers when a member posts, and a push for a new follower. Both stay off, and per-kind notification switches are V2-NOTIF-01.
- Read and played receipts (V2-CHAT-02).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-06 | With `social` on, a member sends direct 1:1 messages to any other member of the same tenant (no follow required), `kind = 'direct'`, one conversation per pair, other tenant unreachable | §1 (schema, policy hole, pair columns, definer), §3 (list, unread, counters, signals), §7 (worker RLS blindness), §10 (isolation tests) |
| CHAT-07 | The member block's effects on messaging, follow and the profile message button (block, unblock, list and blocker's filter are NATIVE-33, shipped by 13) | §4 (follow graph: policy, definer, neutral refusal), §1.6 (message guard), §2.4 (profile facts), §5 |
| MODER-04 | "Block the author" from a report, for the new subjects; the story and community removal rows are MSTORY-09 and MCOMM-10 (shipped by 10) and are now reachable from the queue | §6 (resolve dispatcher, in-tx removal extraction), §2.3 |
| MODER-05 | A member reports story, story comment, community and direct message; `admin_tenant` works them in the queue Phase 13 ships | §2 (enum, definers, columns, contracts, queue), §6, §8 (voice read seam) |

Proposed new requirement id families (planner's call, written at planning): `DMSG-nn` (conversations, list, unread, notices), `BLKX-nn` (block effects), `RPTX-nn` (new subjects, queue, voice seam), `NTCX-nn` (the three notices). [ASSUMED]
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Stack is fixed: Next.js 16.3 PWA on Vercel, Hono API plus pg-boss worker on Cloud Run, Supabase Postgres/Auth/Storage/Realtime, Drizzle schema with RLS policies in TS, migrations applied by the Supabase CLI. `[CITED: .claude/CLAUDE.md "Technology Stack"]`
- The frontend never talks to Supabase for data. Two exceptions only: Auth via `@supabase/ssr`, and read-only Realtime Broadcast subscriptions (signals only, data always fetched through the API). Direct conversations obey this: messages are fetched through `/v1/chat/...`, Realtime carries ids only. `[CITED: .claude/CLAUDE.md "Constraints"]`
- Multi-tenant from day one: `tenant_id` plus RLS on every table, defense in depth, one pgTAP cross-tenant negative per policy. `[CITED: .claude/CLAUDE.md "Architecture" and "Tests"]`
- Modules are self-contained packages that depend on the kernel and other modules' published contracts only (MOD-01..05); the kernel never imports a module. Phase 11 touches the chat, social, notifications, feed, stories and communities modules, so every cross-module move goes through the app tier (`apps/api/src/modules/registry.ts`, `apps/api/src/routes/*`) or a kernel seam. `[CITED: .claude/CLAUDE.md "Modularity"]` and `[VERIFIED: packages/core/server/safety/reports.ts:289-293]` ("What the module that owns the content hands the kernel (the kernel never imports a module, MOD-02)")
- UI follows the design team's prototype; prototype-less screens go through a numbered sketch approved by Igor before any web plan runs (D-33, D-417, UI-04). `[CITED: 11-UI-SPEC.md "Sketch gate"]`
- pt-BR UI, every string in the host catalogs, `scripts/check-ui-literals.sh` fails the build on literals in TSX. `[CITED: 11-UI-SPEC.md UI-D-880]`
- Next.js here is NOT the one in training data: read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing web code. `[VERIFIED: apps/web/AGENTS.md]`
- No Claude co-author trailer in commits is a recorded owner preference for this repo (public GitHub history); the harness reminder asks for one, the user memory and CLAUDE.md-equivalent notes win. `[CITED: user memory "No Claude co-author, no autonhealth"]`
- GSD workflow enforcement: edits go through a GSD command (`/gsd-execute-phase`). Research writes only this file.
- Igor wants UI-first, short plain pt-BR answers, test scripts first, no per-tenant env or code. Real-device proofs are his (UI-SPEC lists them). `[CITED: user memory]`

## Summary

Phase 11 is almost entirely an extension of shipped seams, and the shipped seams were built with this phase in mind (`kind in ('support','direct','group')`, participant-aware policies, `app.chat_asset_hidden` documenting direct participants, `REPORT_SUBJECT_TYPES` "Phase 11 appends"). The model needs **no new table**. It needs three groups of changes: (1) the member lane of a direct conversation, which today is half there and half a latent hole; (2) the block's effects, which are two SQL definers and one policy plus a neutral error path; (3) four more report subjects, which are a CHECK widening, new definer branches, two nullable columns for the voice copy, one new kernel read seam and an API-tier removal dispatcher.

The research found ten facts that change how the plans must be cut, none of which CONTEXT or the UI-SPEC states:

1. **The worker cannot read a direct message.** Notification sources run as `support_tenant` with the zero user (`system-context.ts`), and `chat_conversations_select` admits staff only on `kind = 'support'`. The shipped message source returns `[]` for any other kind. The new-message push therefore needs a security-definer read function, not a policy widening (widening would let staff read directs).
2. **The `chat_conversations_insert` policy already admits `kind <> 'support'` rows** from a member lane (state null, no case columns). A lane can today create an orphan `direct` row and enrol itself. Phase 11 must tighten it to `support` only and create directs through a definer that also enrols the second participant (the participant insert policy lets a lane enrol only itself).
3. **`NotificationPushHint.title` is the closed union `'tenant' | 'team'`** in three places (kernel type, the zod hint schema, the payload builder). D-728 (title = writer's name) and D-729 (title "Nova denúncia") need a literal title: a coordinated widening of the kernel type, `notificationPushHintSchema` and `buildPushPayload`, with the 3072-byte payload bound in mind.
4. **A refused follow cannot reuse the shipped error path.** `followMember` maps a policy refusal (`42501`) to `404 MODULE_DISABLED`, which is the wrong word for a block. The neutral refusal must be raised before the insert, from the same lookup that gives the bare 404.
5. **Existing pgTAP fixtures insert and send in unpaired `direct` rows** (`236-chat-voice.sql` lines 321-334, 388-417, 525-529; `235-chat-cases.sql`; `152-chat.sql`). Any database guard for direct conversations must apply only to *paired* rows (the ones a definer created, with the pair columns set), or those suites break.
6. **Story comments are not filtered by `app.is_blocked_by_viewer`** (`listStoryComments`). The UI-SPEC puts "Bloquear {nome}" on a story comment, so the block must hide that author's story comments from the blocker, which is a one-predicate fix outside the files CONTEXT names.
7. **`content_report_resolve` and the `content_reports_select` policy hard-code `admin_tenant`** while the API route and CONTEXT say `moderation.manage`. Today only `admin_tenant` holds that permission, so behavior agrees; the new "Nova denúncia" audience and the voice read seam must use the same single answer.
8. **The web screens that Phase 13's plan 13-20 planned do not exist** (no `configuracoes/denuncias`, `configuracoes/bloqueados`, `ReportAndBlock`, `PostMenu` report rows, `safety.json`). 13-20 has no SUMMARY. Phase 11 builds all of them, not just the new subjects.
9. **The seed fixture is split**: `rede-lab` has `social` on and `chat` off, `rede-demo` has `chat` on and `social` off. Every direct-conversation test needs both modules on in the tenant it uses (the `withModuleEnabled` helper exists) and a second tenant with both on for the cross-tenant negatives.
10. **Removal paths for stories, story comments and communities are not extractable as shipped**: `deleteStory`, `deleteStoryComment` and the archive branch of `updateCommunity` own their transactions. Phase 13 solved the same problem for posts and comments by extracting `...InTx` forms plus an after-commit half; the same extraction is needed for the three new subjects.

**Primary recommendation:** cut the work into DB-first plans (one kernel migration set for blocks, reports and the follow graph; one chat migration set for pair columns, definers, triggers and policies), then contracts, then API and worker, then web behind the sketch gate. Reuse Phase 13's `...InTx` extraction pattern and the Phase 12.5 `app.chat_asset_hidden` invoker seam. Add no table, no package and no new kernel concept.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| One conversation per pair, eligibility (live, same tenant, not staff, not blocked, `social` on) | Database (definer + unique index) | API (maps the neutral refusal) | The rule must hold even if an API bug drops a predicate; `chat_participants_insert` lets a lane enrol only itself, so only a definer can enrol both |
| Send refusal after a block (D-722, D-723) | Database (BEFORE INSERT guard on paired rows) | API (`409 direct_closed`) | "The database refuses what the API no longer does" (UI-D-881); serialised with the block through the conversation row lock |
| Block deletes follows both ways (D-724) | Database (`member_block_create` replaced) | API (unchanged route) | One transaction, and the blocker cannot delete the other direction's row through RLS (`social_follows_delete_own` is follower-only) |
| Refuse a follow across a block | Database (insert policy term) + API lookup | Web (button absent) | Neutral 404 before the insert; policy is the backstop |
| Conversas list, unread counts, composer state enum | API (`/v1/chat/direct...`) | Database (one-row unread flag) | The UI reads finished facts (UI-D-881) |
| Bubble destination and badge style | API (counters) + web layout (nav rewrite from a permission) | — | `chat.direct` composed in the app-tier registry; the web never compares roles |
| New-message push, follow bell row, report bell row and push | Worker (notification sources) | Database (definer reads, `notifications_fanout`) | Fan-out never runs inside the producing request |
| Report of a message (copy only) | Database (definer snapshots) | API (readability precheck) | The admin must never be able to read the conversation |
| Voice copy playable by the admin through the report | Database (`app.chat_asset_hidden`, invoker) | Kernel media route (already ORs it) | One definition of "who may read", no restatement |
| Resolve: remove / archive / block author | API tier (dispatcher injected into the kernel resolve) | Modules (`...InTx` removers) | Kernel never imports a module |
| Menus, sheets, strips, queue rows | Browser (components) | Web server (BFF, catalogs) | Props-only module UI; every string from host catalogs |

## Standard Stack

No new dependency. Every capability below is built from packages already in the repo; versions from the project stack table `[CITED: .claude/CLAUDE.md]`, `lucide-react@1.46.0` `[CITED: 11-UI-SPEC.md "Design System"]`.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono + `@hono/zod-openapi` | 4.13.7 / 1.6.3 | New `/v1/chat/direct/*` routes in the chat module router | The chat router already owns its guard chain `requireAuth, requireModule('chat')` `[VERIFIED: packages/modules/chat/server/routes.ts:79]` |
| Zod | 4.6.2 | Contracts (`.strict()`, additive `.optional()` keys) | Existing convention (fact 6 of the chat contracts) |
| Drizzle ORM + drizzle-kit | 0.45.2 / 0.31.10 | Columns, CHECKs, indexes, policies generated; definers hand-written `--custom` | Existing convention: generated half plus hand-written functions file |
| postgres.js via Supavisor | 3.4.9 | Unchanged | — |
| pg-boss | 12.31.0 | Fan-out and push-send jobs (unchanged queues) | Notification sources run inside `notifications.fanout` |
| Vitest | 5.0.0 | Unit, module and web tests | — |
| pgTAP via `supabase test db` | CLI 2.117.0 | RLS, definers, triggers | Non-negotiable per CLAUDE.md |
| Playwright | 1.63.0 | e2e on phone viewports | — |
| next-intl | 4.14.4 | New catalog keys (`chat.json`, `social.json`, `notifications.json`, `moderation.json`, new `safety.json`) | UI-D-880 |

### Supporting / Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `chat_direct_pairs` table | Two nullable pair columns on `chat_conversations` | The columns follow the 12.4 "expand-only nullable columns" precedent and need no RLS, move-engine or 010/040 coverage change; a table would |
| Widening `chat_conversations_select` for the worker | A `security definer` read function for the notice | Widening exposes directs to staff; the definer returns only the notice facts |
| `social_follow_notices` table for "once per pair" | The natural `dedupe_key` of `notifications` | The key is unique per `(tenant_id, user_id, dedupe_key)` but `notifications_prune` removes rows older than 90 days, so a re-follow after 90 days would notify again. Accept and record it, or add a one-row table. Planner's call (Open Question 3) |
| Per-conversation push suppression | The shipped service-worker rule (suppress when a window is focused and visible) | D-236 as written is a global foreground rule; per-conversation presence would be a new capability |

**Installation:** none. **Version verification:** no package is added, so no registry check applies; `lucide-react@1.46.0` glyph files were checked by the UI-SPEC session.

## Package Legitimacy Audit

This phase installs no external package. `pnpm-lock.yaml` and every `package.json` stay untouched except workspace-internal `exports`/dependency edges if a module needs a new subpath (none expected). Audit table not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Member A (browser)                                    Member B (browser)
   |  profile "Enviar mensagem" / /membros row           |
   v                                                     |
Next.js BFF  /conversas/com/{membershipId}  --server-->  API  GET /v1/chat/direct/with/{membershipId}
   |   (redirect to existing id, or empty thread)            |  requireAuth > requireModule('chat') > requireModule('social')
   |                                                         |  > requirePermission('chat.direct')           [chat.direct composed in registry]
   | first send                                              v
   +--> POST /v1/chat/direct/messages --> withTenantTx --> app.direct_conversation_open(other_user)   (definer, one tx)
                                                         |    eligibility: live, member role, same tenant, not self,
                                                         |    social on, no block either way -> neutral DM refusal
                                                         |    unique (tenant, low, high) + on conflict -> existing id
                                                         |    enrols BOTH participants
                                                         v
                                                  insert chat_messages (member lane, RLS)
                                                         |  BEFORE trigger: seq under row lock; paired-direct guard
                                                         |  (social on, both live, no block) else DM refusal;
                                                         |  advance author's last_read_seq
                                                         |  AFTER trigger: realtime chat.message on conv topic
                                                         |                 realtime chat.unread on RECIPIENT user topic (new)
                                                         v
                                              emit('chat.message_sent') after commit  --> pg-boss notifications.fanout (worker)
                                                         |
                                  chat source (support_tenant, zero user) --> app.direct_message_notice(message) (definer)
                                       drops: social off, block either way, recipient not live; builds push-only intent
                                       title = writer name (new literal title), tag = conversation, url /conversas/{id}
                                                         v
                                      push channel -> notifications.push-send -> device (SW: quiet if a focused window)

Block:  POST /v1/blocks -> app.member_block_create (replaced): lock paired direct row, insert block,
        delete social_follows both directions, same tx  ->  later sends hit the guard (DM refusal)

Report: POST /v1/reports -> createReport precheck through the reporter's lane (stories, comments, communities RLS;
        message = participant) -> app.content_report_create (new branches, copy-only for a message)
        -> emit('report.created', ids only) -> worker source (notifications module) -> bell + push to moderation.manage holders
        GET /v1/admin/reports -> listReports (new per-subject projection)
        POST .../resolve -> resolveReport(deps.removeContent = API-tier dispatcher over feed / stories / communities InTx removers)
        Voice copy: GET /v1/media/{id}/original -> chatAssetHidden (invoker) -> content_reports_select RLS lets admin_tenant see the report row
```

### Recommended Project Structure (touch points)

```
supabase/migrations/            two new sets (expand-only): kernel (blocks, reports, follows) + chat (pair columns, definers, triggers, policies)
supabase/tests/                 237-direct-conversations.sql, 238-direct-block-effects.sql, 239-reports-new-subjects.sql, 240-direct-realtime-media.sql  [ASSUMED names]
packages/contracts/src/moderation.ts     REPORT_SUBJECT_TYPES appended; reportItem extended with optional keys; event types
packages/core/db/schema/content-reports.ts   CHECK list + 2 nullable columns (media asset id, voice seconds)
packages/core/server/safety/{reports,blocks,limits}.ts   createReport readability switch, listReports projection, new limiters
packages/modules/chat/{db/schema.ts,contracts,server/{service,routes,notifications,notification-copy,direct}.ts,module.ts}
packages/modules/social/{server/service.ts,contracts,module.ts}          follow refusal, facts, notification source
packages/modules/{stories,communities,feed}/server/service.ts            ...InTx removers (+ blocked filter on story comments)
packages/modules/notifications/{contracts,server/push/payload.ts,module.ts} literal push title; report source
packages/core/server/notifications/source.ts                              NotificationPushHint.title widened
apps/api/src/{modules/registry.ts,routes/admin/reports.ts,routes/safety.ts}  chat.direct composition, dispatcher
apps/api/tests/{isolation-inventory.ts,admin-lane-inventory/*,integration/*}
apps/web/{app/(app)/conversas/**,app/(app)/configuracoes/{denuncias,bloqueados}/**,components/{chat,feed,social,profile,stories}/**,lib/{chat-view,reports-view,notification-renderers}.ts*,messages/pt-BR/*.json}
```

### Pattern 1: A kernel definer that pins tenant and caller to claims, never to parameters
**What:** every write of `content_reports` and `member_blocks` is a definer that reads `app.tenant_id()` and `app.user_id()` and refuses a non-live caller with `42501`.
**Evidence:** `[VERIFIED: supabase/migrations/20261105152916_reports_blocks_functions.sql:6-11]` "every write is one of the functions below, which pin the tenant and the caller to the claims in EVERY statement … `security definer`, `set search_path = ''`, fully qualified names, `revoke all … from public`, `grant execute … to authenticated` only".
**Use for:** `app.direct_conversation_open`, `app.members_blocked_between`, the new `content_report_create` branches.

### Pattern 2: Extract `...InTx` + `afterCommit` so the kernel resolve can call a module's removal in its transaction
**Evidence:** `[VERIFIED: packages/core/server/safety/reports.ts:289-293]` `export type ReportContentRemover = (tx: Tx, ctx: RequestContext, subject: { type: ReportSubjectType; id: string }) => Promise<{ outcome: 'removed' | 'already_gone' | 'not_removable'; afterCommit: () => void }>;` and the feed implementation `removeReportedContentInTx` (`packages/modules/feed/server/service.ts:2487`) that returns `{ outcome: 'not_removable' }` when the shipped removal answers its bare 404.
**Use for:** `deleteStoryInTx` (from `deleteStory`, `packages/modules/stories/server/service.ts:1013`), `deleteStoryCommentInTx` (from `:1601`), `archiveCommunityInTx` (the status write inside `updateCommunity`, `packages/modules/communities/server/service.ts:1113`, archive branch `:1227-1240`, log helper `logModeratorAction` `:1060`).

### Pattern 3: Routes for the member lane live in the module router; the guard chain is the module's
**Evidence:** `[VERIFIED: packages/modules/chat/server/routes.ts:79]` `chat.use('*', requireAuth, requireModule('chat'));` and per-route `middleware: [requirePermission('chat.support.contact')]`. New direct routes add `requireModule('social')` and `requirePermission('chat.direct')`.

### Pattern 4: A permission the module cannot name is composed in the app-tier registry
**Evidence:** `[VERIFIED: apps/api/src/modules/registry.ts:242-249]` `if (effective.has('social') && role === 'member') { permissions.add(FEED_PERMISSIONS.create); ... }` with the comment "The module manifest cannot name these two strings: that would be a module-to-module edge (MOD-02), so the app tier composes them."
**Use for:** `chat.direct` composed when `effective.has('social') && effective.has('chat') && role === 'member'` (proposed string `[ASSUMED]`). The web chooses the bubble destination from `bootstrap.permissions.includes('chat.direct')`, which is data and not a role comparison (UI-D-861).

### Anti-Patterns to Avoid
- **Widening a chat select policy for the worker or for staff.** Staff must never read a direct. Use a definer that returns notice facts only.
- **Putting the guard on every `direct` row.** Fixtures in 152/235/236 insert unpaired directs; guard only rows whose pair columns are set.
- **Using `on conflict` on `chat_messages`.** The seq trigger fires before the arbiter and would burn a seq (`[VERIFIED: supabase/migrations/20260930190229_chat_functions.sql:20-23]`). The conversation insert may use `on conflict do nothing` (conversations take no seq).
- **A refusal code or wording that names the block** (`member_blocked` already exists in `CHAT_ISSUES` for staff replies and must not be reused for direct). `[VERIFIED: packages/modules/chat/contracts/index.ts:115-129]` lists `'member_blocked'`, `'member_removed'`.
- **Returning a "blocked me" flag anywhere.** Facts are `canFollow`, `canMessage`, `blockedByViewer` (true only for the blocker) and the composer enum (UI-D-881).
- **Adding branches to the 1257-line support `ThreadPane`.** Build a `DirectThreadPane` from `MessageList`, `ChatComposer`, `lib/chat-cursor`, `lib/chat-view`, `lib/voice-send` (the support chat must not change for a member who never writes to another member, CONTEXT "Not here").

## 1. Chat schema, policies, realtime, unread and push: what exists and what direct needs

### 1.1 Schema and where `direct` already exists
- `chat_conversations.kind` is a text with `check('chat_conversations_kind_chk', sql`${t.kind} in ('support','direct','group')`)` `[VERIFIED: packages/modules/chat/db/schema.ts:149]`. Participants carry `role in ('member','support','admin')` `[VERIFIED: schema.ts:262]`. Messages carry `author_side in ('member','staff')` `[VERIFIED: schema.ts:329]`, so both sides of a direct are `member` and the reader tells own from other by `authorIsViewer` (`messageRowSchema`, `[VERIFIED: packages/modules/chat/contracts/index.ts:233-247]`), which is exactly UI-D-864's "no sender label".
- The case columns must stay null for `direct`: `chat_conversations_case_shape_chk` `[VERIFIED: schema.ts:184-187]` `${t.kind} = 'support' or (${t.state} is null and ${t.caseNumber} is null and ...)`. Both 12.4 triggers skip non-support rows: `if new.kind = 'support' then` (before) and `if new.kind <> 'support' then` (after) `[VERIFIED: supabase/migrations/20261117082355_chat_cases_functions.sql:34,55]`. The message trigger treats a null state as "counters only" `[VERIFIED: supabase/migrations/20261117084153_chat_cases_transitions.sql:7-17 header table]`. pgTAP 235 already proves directs get no number, no counter row and no event (`235-chat-cases.sql` lines 474-512).
- **No pair identity exists.** The only uniqueness is `chat_conversations_one_active_case_per_member`, scoped `where kind = 'support' and state in ('open','in_progress','resolved')` `[VERIFIED: schema.ts:138-140]`. D-720's "unique constraint over the two participants" needs new columns.

**Recommendation (names `[ASSUMED]`):** two nullable columns `direct_low_user_id`, `direct_high_user_id` on `chat_conversations` (uuid, no FK needed beyond `users` cascade like participants), CHECK "both null or both set and low < high", CHECK "only `kind = 'direct'` may set them", `uniqueIndex('chat_conversations_direct_pair_uq').on(tenantId, low, high).where(low is not null)` (tenant-first, per the 040 convention). **Do not** add a CHECK forcing the pair for every `direct` row: fixtures insert bare directs (`235-chat-cases.sql:235,255,484,511`; `236-chat-voice.sql:322,389`; `152-chat.sql:505,512`).

### 1.2 The member lane today and the insert hole
- `chat_conversations_insert` `withCheck` `[VERIFIED: schema.ts:228]` ends `... and ((kind = 'support' and (priority is null or priority = 'normal') and (state is null or state = 'open')) or (kind <> 'support' and state is null and category is null and priority is null))`. A member lane can therefore create a bare `direct` row it created. `chat_participants_insert` lets a lane enrol only `user_id = app.user_id()` into a conversation it created `[VERIFIED: schema.ts:274-278]`, so the second participant cannot be enrolled from a lane.
- **Plan:** tighten `chat_conversations_insert` to `kind = 'support'` only (pgTAP 152 facts at lines 503-516 expecting `42501` for forged inserts keep passing), and create directs only through `app.direct_conversation_open(p_other_user uuid)` `[ASSUMED name]`: definer, claims-pinned, checks both memberships live and `role = 'member'`, not self, `app.social_enabled()`, `chat` enabled, no block either way (via `app.members_blocked_between`), then `insert ... on conflict (tenant_id, direct_low_user_id, direct_high_user_id) where direct_low_user_id is not null do nothing`, reads the id back, inserts both participant rows `on conflict do nothing`, returns `(conversation_id, created)`. All refusals use ONE custom SQLSTATE (for example `DM001`, five characters, the `sqlstateOf` regex is `/^[0-9A-Z]{5}$/` `[VERIFIED: packages/core/server/safety/sqlstate.ts:4]`) so the API cannot distinguish a block from "target is staff".
- `chat_messages_insert` for a member side requires only a participant row `[VERIFIED: schema.ts:355]`; it checks no block, no liveness and no `social`. Enforce those in the BEFORE INSERT trigger (see 1.6), not in the policy, so one function serves every writer.

### 1.3 Select policies, realtime topic and the media gate already admit direct participants
- `chat_conversations_select`: `... or created_by_user_id = app.user_id() or exists (select 1 from public.chat_participants p where ...)` `[VERIFIED: schema.ts:220]`; `chat_messages_select` follows the conversation `[VERIFIED: schema.ts:350]`. Staff reach only `kind = 'support'`. So a staff member (and the admin reading a report) cannot read a direct message by any policy path. pgTAP must pin this as a negative.
- `app.realtime_topic_allowed` for `conv:` allows a participant row, or staff on a support conversation, while `chat` is enabled `[VERIFIED: supabase/migrations/20260930123213_realtime_authorization.sql:109-133]` (`or (c.kind = 'support' and v_role in ('admin_tenant', 'support_tenant'))`). No change is needed for participants; add a `social` term for paired directs only if the planner wants D-483 at the topic level (signals are ids only; low value, flagged in Open Questions).
- `app.chat_asset_hidden` is `security invoker` and already answers "not hidden" to any user who can read a message that carries the recording, and its header names "the participants of a direct or a group conversation" `[VERIFIED: supabase/migrations/20261117223747_chat_voice_gate.sql:6-10]`. VOICE-06/24 are pinned for unpaired directs by `236-chat-voice.sql:399-401,525-529`. D-734's "only the two participants play it" therefore already holds.

### 1.4 Seq, counters and signals for a direct row
- The seq trigger locks the conversation row `for update` and updates `last_seq`, `last_message_at`, `last_message_side = new.author_side` `[VERIFIED: 20261117084153_chat_cases_transitions.sql:41-72]`. For directs `last_message_side` is always `'member'`; the staff inbox and counters read `kind = 'support'` only `[VERIFIED: service.ts:1243-1245, 1192]`.
- The AFTER trigger publishes `chat.message` on the conversation topic and, only for a staff-authored support message, `chat.unread` on the member's user topic `[VERIFIED: 20260930190229_chat_functions.sql: after-insert body]`. **A direct message publishes nothing to the recipient's user topic today**, and `LiveShell` refetches counters on `chat.unread` over `COUNTER_EVENTS` on the always-subscribed user topic `[VERIFIED: apps/web/components/shell/LiveShell.tsx:145-147, 207-213]`. Add a `chat.unread` signal to the recipient's `tenant:<t>:user:<u>` topic for paired directs in the AFTER trigger (a `create or replace` of `app.chat_messages_after_insert`, keeping the existing body character for character plus the new branch).

### 1.5 Unread model (the one design the support chat cannot lend)
Support unread is `last_staff_seq > p.last_read_seq` (`chatCounters`, `[VERIFIED: service.ts:1248-1262]`). A direct has two members, so unread for participant P is "a message by the other side above P's `last_read_seq`".
- **Recommended:** the BEFORE trigger sets the author's participant `last_read_seq = new.seq` on a paired direct (a writer has seen everything up to its own message). Then unread flag for P is exactly `c.last_seq > p.last_read_seq`, one indexed row read, and the per-row number is `least(100, count(*))` of messages by the other side above `last_read_seq` (the existing `chat_messages_tenant_conversation_seq_idx` serves the range). The `99+` cap needs at most 100 rows.
- `chatCounters` member branch returns `{ unreadConversations: supportDot(0|1) + unreadDirectConversations, conversationsBadge: 'count' }` when the caller holds `chat.direct`, else the current `dot` (`[VERIFIED: service.ts:1263]` returns `conversationsBadge: 'dot'`). `Counters` is `{ unreadNotifications; unreadConversations; conversationsBadge: 'dot' | 'count' }` `[VERIFIED: packages/core/server/modules/counters.ts:13-17]`, so no contract change. The push badge and the app-icon badge reuse these counters (`send-job.ts:152` `badge = counters.unreadNotifications + counters.unreadConversations`), so they follow automatically.
- **Counter correctness trap:** the counter and the list must apply the same visibility predicate (other participant live, or anonymised, D-721), or a hidden conversation lights a badge nobody can open. Put the predicate in one SQL fragment used by both.

### 1.6 Send guard (D-722, D-723, D-721)
BEFORE INSERT on `chat_messages` (replace `app.chat_messages_before_insert` again; the current body is the 12.4 one, copy it verbatim, `[VERIFIED: 20261117084153_chat_cases_transitions.sql:25-85]`). After taking the conversation row lock, when `direct_low_user_id is not null`: require `social` enabled for `new.tenant_id` (read `tenant_modules` with the row's tenant, not the claim, so system writers behave), both participants live (`status = 'active' and blocked_at is null and deleted_at is null`; an anonymised member has `deleted_at` set so the conversation is read-only, matching D-721), and no row in `member_blocks` either way; otherwise `raise exception using errcode = 'DM001'` `[ASSUMED]`. The block definers must take the same row lock first (see 4.2) so a block and a send serialise.

### 1.7 Where the support path assumes support (everything the direct path must NOT reuse)
- `visibleConversation` (staff-or-creator-or-participant, any kind) `[VERIFIED: service.ts:142-163]`, `listMessages`, `getConversation` member branch and `markConversationRead` member branch are kind-agnostic and work for directs, but each needs the D-721 live-other predicate and the `social` gate for paired directs (a conversation hidden by an administrator block must answer the bare 404, UI-D-864).
- `supportSendInTx`, `activeCaseOf`, `sendSupportMessage`, the case triggers, `chatCounters` staff branch, `listInbox`, `lockSupportConversation` are `kind = 'support'` by construction `[VERIFIED: service.ts:295, 665, 889, 965, 1192]`. Reuse only `insertMessage` (kind-agnostic), `bodyCheckViolated`, `assetIndexViolated`, `storedVoiceMessage`, `assertVoiceUsable`, `pageOf`, `messageSource`.
- Staff reply and staff voice reply route through `lockSupportConversation`, which is `c.kind = 'support'`, so a direct id is the bare 404 for staff (`chat-voice-reply.test.ts:201` already pins this).

### 1.8 Notifications of a message (the worker problem)
- `resolveMessageSent` returns `[]` for anything but support: `if (row?.kind !== 'support' || !row.member_user_id) return [];` `[VERIFIED: packages/modules/chat/server/notifications.ts:149]`.
- The worker lane is `role: 'support_tenant'` with the zero user `[VERIFIED: packages/modules/notifications/server/system-context.ts:4-26]`. Under `chat_conversations_select`, a direct is invisible to it, so a new branch in `resolveMessageSent` would read zero rows.
- **Recommended:** a definer `app.direct_message_notice(p_message uuid)` `[ASSUMED name]` pinned to `app.tenant_id()` returning one row: recipient user id, writer user id, writer display name, text body or voice seconds, voice-gone flag, and a boolean "deliverable" computed in SQL (paired direct, `social` on, recipient live, no block either way). The source maps it to a push-only intent `channels: ['push']`, `dedupeKey: 'chat.direct_message:' + messageId`, `tag/topic = conversationTag(conversationId)` (the existing 32-hex helper `[VERIFIED: notifications.ts:62]`), `renotify: true`, `ttlSeconds: CHAT_PUSH_TTL_SECONDS` (259200), `url: '/conversas/' + conversationId`. No bell row (D-228 shape: the shipped chat kinds are push-only `[VERIFIED: notification-copy.ts header]`). Voice preview reuses `voicePreview(seconds)` and a gone recording sends nothing (`[VERIFIED: notifications.ts:156-157]`).
- **Push title:** `NotificationPushHint.title: 'tenant' | 'team'` `[VERIFIED: packages/core/server/notifications/source.ts:32]`, validated by `title: z.enum(['tenant', 'team'])` `[VERIFIED: packages/modules/notifications/contracts/index.ts:361]` and rendered by `const title = hint.title === 'team' ? PUSH_TITLE_COPY.team(tenantName) : tenantName;` `[VERIFIED: packages/modules/notifications/server/push/payload.ts:61]`. Widen all three together, additively (for example an optional literal `titleText`, with `title` staying the closed union so queued jobs keep parsing), and cap the literal at a few dozen graphemes: `buildPushPayload` shortens only the body and throws when the fixed fields alone exceed `PUSH_PAYLOAD_MAX_BYTES = 3072` `[VERIFIED: contracts/index.ts:156; payload.ts doc]`. The SW decides display from the payload only, so no SW change is needed for the title (`isPushPayloadV1` needs `title` to be a non-empty string `[VERIFIED: apps/web/lib/push-sw.ts]`).
- **D-728's "participant looking at the conversation" is the shipped global rule:** "The service worker suppresses the OS banner when an app window is focused and visible … On iOS a notification must be shown for every push" `[VERIFIED: 07-CONTEXT.md D-236]`, implemented by `decidePushDisplay` (`apps/web/lib/push-sw.test.ts:119-150`). There is no per-conversation presence and building one is a new capability; the plan should state that D-728 is met by this rule (Assumption A5).

## 2. What Phase 13 delivered for reports and blocks, and exactly where to append

### 2.1 Tables, enums, routes (all verified)
- Tables `content_reports`, `member_blocks`: `[VERIFIED: supabase/migrations/20261105152832_reports_blocks.sql]`. CHECK to widen: `CONSTRAINT "content_reports_subject_type_chk" CHECK ("content_reports"."subject_type" in ('feed_post','post_comment'))`. One select policy `content_reports_select ... USING (tenant_id = app.tenant_id() and (reporter_user_id = app.user_id() or app.tenant_role() = 'admin_tenant'))`; `member_blocks_select ... blocker_user_id = app.user_id()`. No insert/update/delete policy on either.
- Contract: `export const REPORT_SUBJECT_TYPES = ['feed_post', 'post_comment'] as const;` `[VERIFIED: packages/contracts/src/moderation.ts:91]`, plus `REPORT_REASONS`, `REPORT_STATUSES = ['open', 'dismissed', 'content_removed', 'author_blocked']`, `REPORT_EXCERPT_MAX = 280`, `REPORT_NOTE_MAX = 500`, `REPORT_RESOLVE_ACTIONS = ['dismiss', 'remove_content', 'block_author']`. `MODERATION_SUBJECT_TYPES` already contains `'story_comment'`, `'story'`, `'community'` `[VERIFIED: moderation.ts:68-74]`, and `MODERATION_ACTIONS` already contains `story_removed`, `community_archived`, `community_removed`. **`moderation_log` needs no migration**; `comment_removed` with `subject_type = 'story_comment'` is already the shipped story-comment path `[VERIFIED: packages/modules/stories/server/service.ts:1633]`.
- Routes: `POST /v1/reports`, `GET|POST /v1/blocks`, `DELETE /v1/blocks/{userId}` in `apps/api/src/routes/safety.ts` (member lane, `requireAuth` only, limiters `reportLimiter` 20/h and `blockLimiter` 60/h `[VERIFIED: packages/core/server/safety/limits.ts]`), and `GET /v1/admin/reports`, `POST /v1/admin/reports/{id}/resolve` in `apps/api/src/routes/admin/reports.ts` guarded by `requirePermission(KERNEL_PERMISSIONS.moderationManage)`.

### 2.2 The append checklist (one release, in this order)
1. `REPORT_SUBJECT_TYPES` gains `'story'`, `'story_comment'`, `'community'`, `'direct_message'` **appended** (D-730 lists all four; the contract header names only three, `[VERIFIED: moderation.ts:33-35]`, `story` was added by D-730).
2. `content_reports_subject_type_chk` dropped and re-added wider (generated from the same constant in `packages/core/db/schema/content-reports.ts`, which builds the list with `list(REPORT_SUBJECT_TYPES)`). Expand-only: every existing row satisfies it.
3. Two nullable columns for the voice copy, `[ASSUMED]` names `media_asset_id uuid`, `voice_seconds smallint`, no FK (the report outlives the asset, like `subject_id`), CHECK "both null or both set". `excerpt` already carries the 280-character text copy (`content_reports_excerpt_len_chk`).
4. `app.content_report_create` replaced (it is a switch on `p_subject_type` today: `feed_post` reads `feed_posts`, `post_comment` reads `feed_comments ... c.target_kind = 'post'`, anything else `raise exception ... using errcode = '22023'` `[VERIFIED: 20261105152916_reports_blocks_functions.sql, content_report_create body]`). New branches:
   - `story`: author from `stories.author_user_id`, excerpt `left(caption, 280)`, live predicate `deleted_at is null`.
   - `story_comment`: `feed_comments` where `story_id is not null` (the row's generated `target_kind` is `'story'`, `[VERIFIED: feed schema targetKind generated column, packages/modules/feed/db/schema.ts:559]`), `deleted_at is null`.
   - `community`: author `communities.created_by_user_id` (NOT NULL `[VERIFIED: packages/modules/communities/db/schema.ts:80-82]`, so an organization community's author is its creating admin), excerpt `left(name || E'\n' || description, 280)` or name only (Open Question 6).
   - `direct_message`: the definer must itself check what RLS would: the reporter is a participant of a **paired direct** conversation, the message exists, is not deleted, is authored by the other side (own message is `RP001`), `social` is on, and the other participant is live-or-anonymised; any miss is `RP002`. Store `author_user_id`, `excerpt = left(body, 280)` for text, or `excerpt = ''` plus `media_asset_id` and `voice_seconds` for a recording. **Never store the conversation id.** Never allow `kind = 'support'` (A-UI-21).
5. `createReport` readability precheck (`packages/core/server/safety/reports.ts:78`) is a two-way ternary today (`feed_post` vs everything else as a comment join `feed_posts`). Make it an exhaustive switch over the new subjects, each read through the reporter's own lane so RLS (including `stories_audience_gate`, a RESTRICTIVE policy `[VERIFIED: packages/modules/stories/db/schema.ts:224-241]`, and the community gates) applies; a miss stays the bare `404`. A message precheck reads `chat_messages` through the lane (participant-only by RLS).
6. `listReports` (`reports.ts:187-262`) has `content_available` as `case r.subject_type when 'feed_post' then ... else exists (select 1 from feed_comments ...) end` `[VERIFIED: reports.ts:218-223]`: the `else` silently treats every new type as a post comment. Replace with an exhaustive case, add per-subject projection fields as **optional** keys on `reportItemSchema` (strict, `[VERIFIED: moderation.ts:204-227]`): community `description`, message `voice: { durationSeconds }` and `contentHref`-style facts computed server-side (UI-SPEC "Server view-model"). For a recording, `voiceGone` from `app.voice_asset_retired` or the live asset row.
7. Web exhaustive maps: `apps/web/lib/moderation-view.ts` (already maps story/community subjects for the log), a new `reports-view.ts`, catalogs.

### 2.3 Resolve: what is generic and what is not
- `app.content_report_resolve` already returns `(subject_type, subject_id, author_user_id)` for any type and `block_author` uses the stored `author_user_id` through the Phase 8 `changeAccessInTx`, so **"Bloquear autor" for every new subject needs no new SQL** `[VERIFIED: reports.ts:324-400]`. Refusals `author_not_member` / `author_unavailable` already exist as `409 CONFLICT { report: ... }`.
- `remove_content` goes through the injected `ReportContentRemover`. The only implementation is `removeReportedContentInTx` (feed) wired in `apps/api/src/routes/admin/reports.ts`. Phase 11 replaces the injected function with an **API-tier dispatcher** (the app tier may import every module) keyed on `subject.type`: `feed_post`/`post_comment` → feed (unchanged), `story` → `deleteStoryInTx`, `story_comment` → `deleteStoryCommentInTx`, `community` → `archiveCommunityInTx`, `direct_message` → `{ outcome: 'not_removable' }` (D-732; the UI never renders the row, the API must still refuse it).
- Permission flags for the removers (`canManage`, `canModerate`) are read by the route through `permissionsForRequest(ctx)` **before** the transaction opens (pool is `max: 5`; the shipped comment-removal docblock states the rule, `[VERIFIED: feed/server/service.ts doc of deleteComment]`).
- **Log rows** are written by the module functions through `recordModerationAction(tx, ctx, ...)`: `story_removed` (only `!isAuthor && visibility = 'followers'`), `comment_removed` / `story_comment`, `community_archived` (only for a `kind = 'member'` community whose creator is not the actor, `[VERIFIED: communities/server/service.ts:1060-1082]`). Consequence for D-732's "every action writes its log row": archiving an **organization** community or removing an **organization** story from the queue writes no row today (the admin's own content). Recommend keeping that (Assumption A3); `block_author` always logs `member_blocked`.
- `content_report_resolve` and `content_reports_select` check `admin_tenant` by literal role while the route checks `moderation.manage` `[VERIFIED: 20261105152916...resolve: app.tenant_role() is distinct from 'admin_tenant'`; `apps/api/src/routes/admin/reports.ts` guard]`. Today `moderation.manage` is granted only to `admin_tenant` (`KERNEL_ROLE_PERMISSIONS`, `[VERIFIED: packages/core/server/rbac/require-role.ts:19]`). The report-created audience and the voice read seam must use the same set, derived once (a SQL role literal pinned by a drift test against the TS permission, the pattern 07-08 used for the staff roles).

### 2.4 Admin queue and screens: nothing of the web slice exists
`ls apps/web/app/(app)/configuracoes` shows `formulario-de-perfil marca membros menu midia moderacao pagamentos regras` only. `grep` for `denuncias|bloqueados` in the web finds nothing. Plan 13-20 lists the files (`PostMenu.tsx`, `CommentItem.tsx`, `ReportAndBlock.tsx`, `safety-actions.ts`, `bloqueados/*`, `denuncias/*`, `lib/reports.ts`, `lib/reports-view.ts`, `messages/pt-BR/safety.json`, `e2e/safety.spec.ts`) and has no SUMMARY; plan 13-14's SUMMARY confirms only the server half shipped, with `canReport`/`canBlock` as optional booleans on post and comment answers (`grep` finds them in `packages/modules/feed/contracts/index.ts` and `service.ts`). Phase 11 owns all of 13-20's files, with the five-subject and `social`-aware variants. **Re-point:** 13-20's precondition `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md` must be changed to sketch 025 by the Phase 11 planner (UI-SPEC "Sketch gate"). `canReport`/`canBlock` riders are still missing for stories, story comments, communities and message rows.

## 3. Direct-conversation API surface (proposed, all names `[ASSUMED]`)

| Route | Purpose | Notes |
|-------|---------|-------|
| `GET /v1/chat/direct` | Conversas list: support summary row plus keyset page of directs | `(last_message_at desc, id desc)`, 20 per page, over-fetch by one, cursor decoded with the `decodeInstantCursor` pattern (`[VERIFIED: service.ts:1016-1048]`); one SQL fragment for "visible" shared with the counter |
| `GET /v1/chat/direct/with/{membershipId}` | Existing conversation id or `null`, plus the composer enum | Target resolved by membership id (like follow); every miss (staff, self, other tenant, removed, unknown, social off) is the same bare 404 |
| `GET /v1/chat/direct/{conversationId}` | Header facts (other member, removed flag), composer enum, read position | Hidden by admin block or removal: bare 404 |
| `POST /v1/chat/direct/messages` | `{ toMembershipId, body }` text send; lazy creation | One tx: open (definer) then `insertMessage`; the answer carries `conversationId` and the finished message |
| `POST /v1/chat/direct/voice-messages` | `{ toMembershipId, mediaId }` | Same order as the support voice send: `storedVoiceMessage` idempotent read, `assertVoiceUsable`, insert; `assetIndexViolated` retry in a new tx `[VERIFIED: service.ts:434-450, 505-555]` |
| existing `GET /v1/chat/conversations/{id}/messages` and `POST .../read` | Catch-up and read mark | Already kind-agnostic through RLS; add the live-other and `social` predicates for paired directs |

Guard chain `requireAuth, requireModule('chat'), requireModule('social'), requirePermission('chat.direct')`, so `social` off is `404 MODULE_DISABLED` and the web maps it to the single not-found screen. Body schema reuses `chatBodySchema` (1 to 2000 code points after trim) `[VERIFIED: contracts/index.ts:134-150]`; request schemas `.strict()`; closed refusal vocabulary gains ONE neutral word for the closed composer (for example `direct_closed`, `[ASSUMED]`), never `member_blocked`. Refusal wording on the wire is code only; the sentence is the web catalog's.

**Limits:** the 13-13 attempt limiter and `safetyLimiterKey` are reused `[VERIFIED: limits.ts]`; add `directMessageLimiter` (and a smaller new-conversation limiter) beside `reportLimiter`. Numbers are the planner's; reference points: reports 20/h, blocks 60/h, story publishes 30/h, community creates 10/h. Per-process limiter, so the effective ceiling is the number times the instance count (documented in `limits.ts`). Suggest 30 messages per minute and 20 new conversations per hour per member (`[ASSUMED]`, A6).

**Profile and row facts (UI-D-867, UI-D-868):** extend `memberSocialProfileSchema` and the follow-state items with optional `canFollow`, `canMessage`, `blockedByViewer`; they come from one kernel definer `app.members_blocked_between(p_other uuid)` `[ASSUMED]` (caller is one party, tenant pinned; the blocked side cannot read `member_blocks` rows because `member_blocks_select` is blocker-only). `blockedByViewer` is `app.is_blocked_by_viewer` (invoker, blocker only). `canMessage` also needs `chat.direct`; compose in the web host from `permissions` plus these facts. Release order: the API adds optional keys the strict old web would refuse, so web first (see Deploy order).

## 4. The follow graph (Phase 9) and where a block acts

### 4.1 What exists
- Table `social_follows` with `social_follows_no_self_chk`, unique `(tenant_id, follower_user_id, followee_user_id)`, policies `social_follows_select_own` (either party), `social_follows_insert_member` (follower = caller, role `member`, `app.social_enabled()`, live member followee) and `social_follows_delete_own` (**follower side only**) `[VERIFIED: supabase/migrations/20261019204728_social_follows.sql:31-42]`. `update` and `truncate` are revoked from `authenticated` (`social_functions.sql`).
- `followMember` (`packages/modules/social/server/service.ts:84-106` `[VERIFIED]`) resolves the target in the lane by `membershipId` with the `LIVE_MEMBER` predicate (bare 404 on miss), refuses self (`400 VALIDATION_FAILED { follow: 'self_follow' }`), inserts `on conflict ... do nothing`. Its catch maps `42501` to `ApiError(404, 'MODULE_DISABLED')` (D-483).
- `app.member_block_create` is the only block writer; it validates the target and inserts `on conflict do nothing`, returning whether it created the row `[VERIFIED: 20261105152916_reports_blocks_functions.sql, member_block_create]`. Callers: `blockMember` in `packages/core/server/safety/blocks.ts` (`mapReportError` turns `BL001` into `400 CANNOT_BLOCK`).

### 4.2 What Phase 11 changes
1. **Replace `app.member_block_create`** (`create or replace`, same signature and grants): after the validity checks and before the insert, lock the paired direct row (`select ... from chat_conversations where tenant_id = v_t and direct_low_user_id = least(...) and direct_high_user_id = greatest(...) for update`, so a concurrent send holding the conversation lock finishes first and the next send sees the block); insert the block; **delete the follow rows in both directions** `delete from public.social_follows f where f.tenant_id = v_t and ((f.follower_user_id = v_u and f.followee_user_id = p_blocked) or (f.follower_user_id = p_blocked and f.followee_user_id = v_u))`. A definer is mandatory: `social_follows_delete_own` cannot delete the blocked member's row. Precedent for a kernel definer touching a module table exists (`account_anonymise` deletes `profile_form_answers`, `[VERIFIED: 20261117230638_chat_voice_account_deletion.sql]`). Do not gate on `social` (D-616: the block is not gated; rows survive `social` off per D-483, so delete them whenever they exist). `member_block_delete` is unchanged and restores nothing (D-724).
2. **Refuse a follow across a block**, two layers: (a) in `followMember`'s target lookup add `and not app.members_blocked_between(m.user_id)` so a blocked pair is the identical bare 404 as an unknown target (no new code, no oracle); (b) add the same predicate to `social_follows_insert_member` as a backstop (the policy edit is generated by drizzle from `packages/modules/social/db/schema.ts`). Do **not** rely on (b) alone: its `42501` becomes `404 MODULE_DISABLED` (wrong word, but still a neutral failure the web shows as "Não foi possível seguir agora").
3. **Facts** `canFollow`, `canMessage`, `blockedByViewer` on `getMemberSocial` (`:getMemberSocial`) and `followState` (see 3).
4. **Follow-lists**: the blocked pair's rows are deleted, so `listSide` needs no change.
5. **Account anonymisation** already deletes the member's blocks in both directions; it does not touch follows (the follow rows of an anonymised member disappear from counts through the live-member join). No change unless a new table is added.

### 4.3 The follow notification ("começou a te seguir", D-727)
The social module has no notification sources today (`module.ts` doc: "no notification sources of its own"). Add: event `social.followed` (ids only) emitted after commit from `followMember` **only when the insert created a row** (`returning id`); a `notificationSources` entry in the social manifest (`[VERIFIED: packages/core/server/modules/manifest.ts:137-148]` declares the field and the registry registers it, `apps/api/src/modules/registry.ts:116-126`); intent `kind: 'social.followed'`, `audience: users [followee]`, `channels: ['in_app']`, `push: null`, `dedupeKey: 'social.followed:' + follower + ':' + followee` (natural once-per-pair within the 90-day prune horizon, `notifications_prune`), `actorUserId: follower`, `subject: { type: 'membership', id: followerMembershipId }` or facts `{ membershipId }` for the tap target (UI-D-875). The resolver (worker, zero user) must drop the intent when `social` is off (`app.social_enabled()` reads the tenant claim, which the worker lane sets) or when the pair is blocked either way (use `app.members_blocked_between`-style definer with explicit parties, since `is_blocked_by_viewer` would see only the zero user). A retraction on unfollow is **not** wanted (A-UI-16: never retracted).

## 5. Notices: what D-476/D-477 leave in place
- Feed source: a member post notifies nobody (`packages/modules/feed/server/notifications.ts:148` comment "D-476 (T-09-24, PR-5): a member post notifies NOBODY") and the first-level comment on a member post notifies its author (`:300`, `:391`). D-726 is already the code's behavior; **no code change**, only a note in CONTEXT-to-requirements. Regression guard: keep the existing notification tests green.
- All new kinds are free strings, **no notifications migration** (`[VERIFIED: packages/modules/notifications/db/schema.ts:58]` "a string so a new kind is a row value, never a migration"). The renderer map is web-side (`apps/web/lib/notification-renderers.tsx`, "A kind absent from this map renders the generic row"), so a kind written before the web ships renders generically and breaks nothing. Constants `SOCIAL_NOTIFICATION_KINDS` (social contracts) and a `moderation.*` kind constant (kernel contract) are new `[ASSUMED]`.
- **New report notice (D-729).** `createReport` emits `report.created` (ids: `tenantId`, `reportId`, `reporterUserId`, `authorUserId`) after commit; `content_reports` is unreadable to the worker (`support_tenant` is not `admin_tenant`), so the source must not read it. A source registered in the notifications module's manifest (it already hosts kernel-event subscribers, `membership.blocked`), audience = live memberships whose role holds `moderation.manage` (derive the role list from `KERNEL_ROLE_PERMISSIONS`, never hard-code in the source), `excludeUserIds: [reporter, author]` (D-729: the reported member is never told; AD-1 allows reporting an administrator's content), `channels: ['in_app', 'push']`, `dedupeKey: 'moderation.report_created:' + reportId`, `actorUserId: null`, `facts: {}`, `subject: { type: 'report', id: reportId }`, push hint literal title "Nova denúncia", body "Toque para ver a fila de denúncias.", tag per report, `url: '/configuracoes/denuncias'`. Existing test `reports-blocks.test.ts:623` ("no notification is created" for the author) stays valid because it counts the author's rows; keep that scoping.
- **Push preferences:** V1 has one switch per device and no per-kind toggles (D-235 `[VERIFIED: 07-CONTEXT.md]`), so none of the three rules touches preferences. The push channel pushes `batch.recipients` for in_app+push intents and the explicit user list for push-only intents `[VERIFIED: packages/modules/notifications/server/channels/push.ts:60-75]`; dead subscriptions are swept first. The `chat.support_reply`/`member_message` kinds stay push-only.

## 6. Member stories and communities: removal and the log (item 5)
| Subject | Existing path | Log row | Extraction needed |
|---------|---------------|---------|-------------------|
| story | `deleteStory(ctx, storyId, { canManage, canModerate })` `stories/server/service.ts:1013`: row locked `for update`, author or `canModerate` on `visibility = 'followers'` or `canManage` on `'tenant'`, soft delete, emits `story.deleted` after commit | `story_removed`, `subjectType: 'story'`, excerpt = caption, written only when `!isAuthor && visibility === 'followers'` (`:1059`) | `deleteStoryInTx` + after-commit `emit('story.deleted', ...)` and the log line |
| story comment | `deleteStoryComment(ctx, storyId, commentId, { canModerate })` `:1601`: locks the comment with `story_id` in the predicate, soft delete, emits `story.comment_deleted` | `comment_removed`, `subjectType: 'story_comment'` when `!isAuthor` (`:1633`) | `deleteStoryCommentInTx`; the report stores only `subject_id`, so the dispatcher reads `story_id` from the row |
| community | `updateCommunity` `communities/server/service.ts:1113`; archive transition `:1227` calls `logModeratorAction(... 'community_archived' ...)` `:1232` (writes only when `canManage`, `kind = 'member'`, creator ≠ actor); emits `community.archived` | `community_archived`, subject `community` | `archiveCommunityInTx` (status write + log + the 10-05 allowance rule untouched) |
The kernel-side `recordModerationAction(tx, ctx, entry)` is already transactional (`[VERIFIED: packages/modules/stories/server/service.ts:1059]` passes the caller's `tx`). A moderator's archive keeps working with `social` off (`[VERIFIED: communities service doc]` "The guard is the manage permission and never a member permission").

**The `is_blocked_by_viewer` gap (finding 6):** stories' authors strip, author list and detail use it (`stories/server/service.ts:594, 660, 714`) but `listStoryComments` (`:1418`) does not, and the replies/comments of posts do (`NOT_BLOCKED_COMMENT_AUTHOR`, feed `:1882`). Add `and not app.is_blocked_by_viewer(c.author_user_id)` to the story-comment list so UI-D-869's "Bloquear {nome}" on a story comment has the effect NATIVE-33 promises (D-725 states the blocker "keeps not seeing B's posts and comments"). Small, in scope for the safety of the new menu entry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-conversation seq and ordering | A new counter | The existing BEFORE INSERT trigger | Gapless, commit order = seq order (`chat_functions.sql` header) |
| Unread per participant | A new unread table | `chat_participants.last_read_seq` plus the author-advances rule | One indexed row read |
| Voice recording, player, recorder | Anything | `ChatComposer` voice props, `VoicePlayer`, `useVoiceRecorder`, `voice-send.ts`, `/v1/media/uploads` | D-734 says do not rebuild |
| Who may play a recording | A new permission check | `app.chat_asset_hidden` (invoker) extended with the report clause | One definition of "can read" |
| Report removal for stories/communities | A second resolve flow | `resolveReport` + injected dispatcher + `...InTx` functions | Phase 13 pattern, log row in the same tx |
| "Block author" | A new block | `changeAccessInTx` through the shipped `block_author` resolution | Phase 8 admin block, `member_blocked` log row |
| Push banner, tag/topic, TTL | New send path | `pushHint(...)`, `conversationTag`, the push channel and job | Existing collapse and urgency rules |
| Rate limiting | A new limiter | `createAttemptLimiter` (13-13) | Existing, per process |
| Cursor/keyset | New encoding | `encodeCursor`/`decodeCursor` and the instant-cursor guard | Tamper-safe |
| ICU/plural strings | Hand-built plurals | next-intl catalogs | UI-D-880 |

**Key insight:** every hard part (seq, signals, voice gate, report snapshot, block, removal with log row) already exists as a seam written for a later phase. The risk is not missing capability but breaking the 100+ assertions that pin those seams, so every change is a `create or replace` that copies the current body verbatim and adds a branch.

## Common Pitfalls

### Pitfall 1: Replacing a function with an older body
**What goes wrong:** `app.account_anonymise`, `app.chat_messages_before_insert`, `app.content_report_create`, `app.member_block_create` were each replaced by later migrations; copying an earlier file silently drops a later phase's statements (the voice-asset retirement, the 12.4 case transitions).
**Prevention:** for each function, start from the newest migration that defines it (`account_anonymise` → `20261117230638_chat_voice_account_deletion.sql`; message before-insert → `20261117084153_chat_cases_transitions.sql`; the three report/block definers → `20261105152916_reports_blocks_functions.sql`), diff the new body against it, and add a pgTAP assertion per preserved behavior.
**Warning signs:** pgTAP 235/236 failures after the migration.

### Pitfall 2: A guard that breaks the unpaired directs in 152, 235, 236
Apply the Phase 11 guard, the select-policy `social` term and the topic `social` term only when `direct_low_user_id is not null`. Otherwise `236-chat-voice.sql:399-401` ("a participant sends a recording into a direct conversation") and `:525-529` fail because the fixture tenant has no `social` module.

### Pitfall 3: The worker sees no direct
See 1.8: use a definer. A source that "works in dev" because the seed admin lane can read directs will return nothing in the worker.

### Pitfall 4: `42501` means three different things
`followMember` turns it into `404 MODULE_DISABLED`; `mapReportError` into `403 FORBIDDEN`. A block-induced RLS refusal must not surface as either. Check the pair in the lookup (bare 404) and use one custom SQLSTATE for the chat refusals.

### Pitfall 5: Strict web parsers refuse unknown keys
The web parses every API answer with strict schemas (`docs/DEPLOY.md:1227-1233`). Every new response key must be `.optional()` and the new web must tolerate the old API; every new request key lives on a new schema. Release order for this phase: migrations (expand-only), then web, then API and worker (the Phase 8 rule). The CHECK widening must be live before the API can write a new subject type.

### Pitfall 6: Hidden conversations lighting badges
List, counter and the `GET messages`/read routes must share the same "other participant visible" predicate (live, or anonymised). Test: admin-block B, assert A's `unreadConversations` drops.

### Pitfall 7: Lock order deadlock between block and send
Always lock the conversation row first, then read `member_blocks`; `member_block_create` must take the same lock (4.2) before its own writes. A test with two connections (block while a send holds the lock) pins it.

### Pitfall 8: The fan-out reads `notifications` module state, not chat state
Fan-out sources run only while `notifications` is enabled `[VERIFIED: fanout-job.ts doc]`; the chat counters and the realtime signals do not depend on it. Tests that assert pushes must enable `notifications` for the tenant (rede-lab has it off by seed design).

### Pitfall 9: Seed shape
`rede-lab` has `social` on and `chat`/`notifications` off; `rede-demo` has `chat` on and `social` off `[VERIFIED: scripts/seed.ts:194-206]`. The helper `withModuleEnabled(host, key)` and `withSocialEnabled` exist `[VERIFIED: apps/api/tests/integration/setup.ts:655]`. Direct tests: enable `social` on demo; cross-tenant negatives: enable `chat` and `social` on lab for the duration.

### Pitfall 10: Integration run quirks (project memory)
`pnpm test:integration -- x` does not filter (use `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`); run pgTAP before the integration suite or reset in between (`154-moderation-log.sql` trips on integration residue); `db:reset` needs `pnpm db:seed` after; manual UAT rows break seed-pinned tests; use `bash scripts/supabase.sh`, not bare `supabase`; turbo gates with `--concurrency=4` and `TURBO_CACHE=local:r`; check `df -h /System/Volumes/Data` (16 GiB free now, 92% used). `[CITED: user memory integration-tests-filter-and-drift, turbo-cache-fills-disk]`

### Pitfall 11: Release notes the planner must not forget
The workers' push title widening changes a pg-boss job schema; ship the schema widening (accepts old and new) before any code enqueues the new shape. Both the API and the worker import the registry, so deploy both.

## Code Examples

All names below are **proposals** (`[ASSUMED]`), shaped after verified patterns.

### Definer skeleton (kernel, claims-pinned)
```sql
-- Pattern: 20261105152916_reports_blocks_functions.sql (header lines 6-11) [VERIFIED]
create or replace function app.members_blocked_between(p_other uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_blocks b
     where b.tenant_id = app.tenant_id()
       and ((b.blocker_user_id = app.user_id() and b.blocked_user_id = p_other)
         or (b.blocker_user_id = p_other and b.blocked_user_id = app.user_id()))
  )
$$;
revoke all on function app.members_blocked_between(uuid) from public;
grant execute on function app.members_blocked_between(uuid) to authenticated;
```

### Source skeleton (worker lane, definer read)
```ts
// Pattern: packages/modules/chat/server/notifications.ts resolveMessageSent [VERIFIED]
// kind === 'direct' is read through app.direct_message_notice(...), NOT through chat_messages
const rows = await tx.execute<NoticeRow>(sql`
  select * from app.direct_message_notice(${payload.messageId}::uuid)`);
const n = rows[0];
if (!n?.deliverable) return [];
return [{
  kind: CHAT_NOTIFICATION_KINDS.directMessage,           // new constant, push-only
  audience: { type: 'users', userIds: [n.recipient_user_id] },
  excludeUserIds: [n.writer_user_id],
  dedupeKey: `chat.direct_message:${payload.messageId}`,
  subject: { type: 'conversation', id: payload.conversationId },
  object: null, actorUserId: n.writer_user_id, facts: {},
  channels: ['push'],
  push: { ...pushHint(payload.conversationId, 'tenant', previewText, `/conversas/${payload.conversationId}`),
          titleText: n.writer_name },                    // new additive field, capped
}];
```

### Resolve dispatcher (API tier)
```ts
// Pattern: apps/api/src/routes/admin/reports.ts passes { removeContent: removeReportedContentInTx } [VERIFIED]
const removeContent: ReportContentRemover = (tx, ctx, subject) => {
  switch (subject.type) {
    case 'feed_post': case 'post_comment': return removeReportedContentInTx(tx, ctx, subject);
    case 'story':         return removeReportedStoryInTx(tx, ctx, subject.id, flags);
    case 'story_comment': return removeReportedStoryCommentInTx(tx, ctx, subject.id);
    case 'community':     return archiveReportedCommunityInTx(tx, ctx, subject.id, flags);
    case 'direct_message': return Promise.resolve({ outcome: 'not_removable', afterCommit: () => undefined });
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Support-only chat (`kind = 'support'`) | Generic `kind` with `direct`/`group` anticipated; voice, media gate and counters already documented for directs | Phases 7, 12.4, 12.5 | Phase 11 adds the lane, not the model |
| Reports of posts/comments only | Subject list appended, per-subject projection | Phase 13 → 11 | CHECK is one-way: append only |
| Kernel resolve with one remover | Dispatcher injected by the API tier | 13-14 → 11 | Kernel stays module-free |
| Titles `tenant`/`team` for push | Literal title | Phase 11 | Additive widening in three files |

**Deprecated/outdated:** CONTEXT's note "plan 13-20's guard still points at sketch 017" (re-point to 025). The Phase 13 comment "Phase 11 appends `story_comment`, `community` and `direct_message`" omits `story`, which D-730 adds.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pair columns `direct_low_user_id`/`direct_high_user_id` with a partial unique index are acceptable (vs a table) | §1.1 | Low: planner may pick another shape; unique-per-pair requirement is locked |
| A2 | `chat.direct` is the composed permission string and the web picks the bubble destination from it | §Pattern 4 | Low: any permission name works if composed in the registry |
| A3 | Archiving an organization community or removing an organization story from the queue writes no `moderation_log` row (the shipped helpers write only for member content) | §2.3, §6 | Medium: if Igor wants a row for every queue action, `recordModerationAction` needs a new subject binding or the CHECK allows an extra row; confirm |
| A4 | A custom SQLSTATE `DM001` for the single neutral chat refusal and `direct_closed` as the API word | §1.2, §3 | Low |
| A5 | D-728's "participant looking at the conversation" is satisfied by the service worker's global foreground rule | §1.8 | Medium: a per-conversation rule would be new work; confirm with Igor at the UI review |
| A6 | Limits: 30 messages/min and 20 new conversations/h per member | §3 | Low (planner's numbers) |
| A7 | The report-created audience is "every live membership whose role holds `moderation.manage`", which is `admin_tenant` today | §5 | Low |
| A8 | Hiding a conversation when the other member is administratively blocked/removed is done in the list/read predicates, not in RLS | §1.5, §3 | Low |
| A9 | `supabase test db <path>` accepts a single file (CLI help shows `[<path...>]`, verified) so the quick pgTAP command is per-file | Validation | None (verified) |
| A10 | Anonymised members keep `deleted_at` set, so "deleted for good" (D-721 read-only) is `anonymised_at is not null` while "removed" is `deleted_at is not null and anonymised_at is null` | §1.5 | Medium: verify against `account_request`/`cancel` definers during planning; the two states must be distinguishable by one column test |

## Open Questions

1. **`moderation.manage` vs `admin_tenant` in SQL.** What we know: SQL and policy hard-code `admin_tenant`; the route and CONTEXT say `moderation.manage`; only `admin_tenant` holds it. Unclear: whether a custom tenant role could ever hold it. Recommendation: keep one role list in SQL (drift-tested against `KERNEL_ROLE_PERMISSIONS`) and reuse it for the audience and the voice seam.
2. **Organization story/community in the queue.** Staff content can be reported (AD-1). "Remover conteúdo" on an organization item: allow with no log row (A3), or hide the removal row and offer only "Ignorar" and "Bloquear autor"? Recommendation: allow, no row, state it in the plan.
3. **"Once per pair" storage for the follow notice.** The `dedupe_key` survives only until `notifications_prune` (90 days). Recommendation: accept the horizon and write it in the plan; add a one-row table only if Igor wants it strict.
4. **Social term at the realtime topic and the asset gate for paired directs.** With `social` off the API refuses everything; the topic and `/original` would still serve participants who already know an id. Recommendation: add a paired-only `social` term to `chat_conversations_select` (covers messages and the asset gate by inheritance); skip the topic function.
5. **Community report snapshot.** `excerpt` is 280 code points; UI-D-873 shows name (bold) plus description. Recommendation: `excerpt = left(name || E'\n' || description, 280)` and the web splits at the first line break; or store the name only and read the description live.
6. **Story comment author block filter** (finding 6) is outside CONTEXT's named files. Recommendation: include it as one task in the stories plan.
7. **Sketch 025** does not exist (MANIFEST ends at 024). All web plans carry `grep -q '^approved: true' .planning/sketches/025-phase-11-designed-screens/README.md` and stop when absent; the approval line is Igor's own edit (D-417). The planner re-points 13-20's guard from 017.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | yes | v24.14.0 | — |
| pnpm | monorepo | yes | 12.4.1 | — |
| Docker | local Supabase stack | yes | 29.3.1; containers `supabase_db_rede-social`, `supabase_pooler_rede-social`, `supabase_storage_rede-social` running | — |
| Supabase CLI (pinned) | pgTAP, migrations | yes | `node_modules/.bin/supabase`, `bash scripts/supabase.sh test db [<path...>]` verified | — |
| Disk | builds and e2e | tight | 16 GiB free of 228 GiB (92%) | builds and e2e need 5-10 GiB; clear `.turbo/cache`, `apps/web/.next/dev` when idle |
| ffmpeg | voice fixtures in integration | not probed | the 12.5 suites already require it (`chat-voice-fixtures.ts` drives the real derive job) | skip voice integration cases locally and prove in pgTAP |

**Missing dependencies with no fallback:** none found. **Real-device proofs** (two phones, push on each, VoiceOver/TalkBack phrases, the queue's voice row) are Igor's and cannot be made locally (UI-SPEC "Proofs that are Igor's"); the plan must list them as manual ledger rows, and phones cannot reach `*.localhost` `[CITED: user memory real-device-uat-blocked-locally]`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit, module, web), API integration (Vitest against the live local stack), pgTAP via `supabase test db`, Playwright 1.63.0 |
| Config files | per-package `vitest.config.ts` (`apps/api`, `apps/web`, `packages/modules/*`, `packages/core`), `apps/web/playwright.config.ts` |
| Quick run (module/contracts) | `pnpm --filter @rede-social/module-chat test`, `pnpm --filter @rede-social/module-social test`, `pnpm --filter @rede-social/contracts test` |
| Quick run (web view functions) | `pnpm --filter @rede-social/web exec vitest run lib/chat-view.test.ts lib/reports-view.test.ts` |
| Quick run (one pgTAP file) | `bash scripts/supabase.sh test db supabase/tests/237-direct-conversations.sql` |
| Quick run (one integration file) | `pnpm --filter @rede-social/api exec vitest run tests/integration/direct-chat.test.ts` |
| Full suite | `pnpm lint && pnpm turbo typecheck build test --concurrency=4` then `pnpm boundaries && pnpm check:static-routes`, then `bash scripts/supabase.sh test db` (BEFORE) `pnpm test:integration`, then `pnpm e2e` |

### Phase Requirements → Test Map
| Req / Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------------|----------|-----------|-------------------|--------------|
| CHAT-06, D-720 | one conversation per pair, concurrent first sends create one, never two; lane cannot create a direct directly | pgTAP | `bash scripts/supabase.sh test db supabase/tests/237-direct-conversations.sql` | ❌ Wave 0 |
| CHAT-06, D-720 | lazy creation, redirect to existing, staff/self/other tenant/removed/unknown = same bare 404 | integration | `... vitest run tests/integration/direct-chat.test.ts` | ❌ Wave 0 |
| CHAT-06 | other tenant unreachable, same two user ids in tenant B, topic denied (`app.realtime_topic_allowed`) | pgTAP + isolation sweep | `237-...sql`, `isolation.test.ts` case `phase 11 sweep` | ❌ Wave 0 / extend |
| D-719 | `/conversas` list, support row pinned, counters add direct unread, `social` off unchanged | integration + web unit | `direct-chat.test.ts`, `chat-view.test.ts` | ❌ Wave 0 |
| D-721 | admin block / removal hides list, read 404, send refused, returns on unblock; anonymised stays read-only | pgTAP + integration | `238-direct-block-effects.sql`, `direct-chat-block.test.ts` | ❌ Wave 0 |
| CHAT-07, D-722/D-723 | neutral refusal, no "bloqueado" in code or body, B reads history, A sees blocker state, unblock restores | integration + unit | `direct-chat-block.test.ts` (asserts the refusal body and the closed `CHAT_ISSUES` list) | ❌ Wave 0 |
| CHAT-07, D-724 | block deletes follows both ways in one tx, follow across a block = bare 404 identical to unknown, unblock restores nothing | pgTAP + integration | `238-...sql`, `social-block.test.ts` | ❌ Wave 0 |
| D-725 | nothing else changes (feed, Explorar, directory) | integration (regression) | existing `reports-blocks.test.ts`, `feed-social.test.ts` stay green | ✅ |
| D-726 | member post notifies nobody; D-477 intact | integration | existing feed notification tests | ✅ |
| D-727 | follow bell row once per pair, none for blocked pair or `social` off, no push | integration (worker lane) | `direct-notifications.test.ts` | ❌ Wave 0 |
| D-728 | message push: one per conversation (tag), title writer name, voice `Mensagem de voz · 0:42`, none to blocked pair / `social` off, no bell row, badge counts | integration + module unit | `direct-notifications.test.ts`, `packages/modules/chat/tests/direct-notification-copy.test.ts` | ❌ Wave 0 |
| D-729 | report created → bell + push to `moderation.manage` holders only, never author/reporter, never names subject | integration | `reports-notice.test.ts` | ❌ Wave 0 |
| MODER-05, D-730 | CHECK + contract append order; five reasons/note/duplicate/own content unchanged; staff content reportable | pgTAP + contracts | `239-reports-new-subjects.sql`, `packages/contracts` moderation test | ❌ Wave 0 / extend |
| MODER-05, D-731 | message report stores only the message; admin cannot read any chat row; voice copy playable by admin only via the report, not by a third member | pgTAP + integration | `239-...sql`, `240-direct-realtime-media.sql`, `reports-new-subjects.test.ts` | ❌ Wave 0 |
| MODER-04, D-732 | story → `story_removed`, story comment → `comment_removed`, community → `community_archived`, message → only dismiss/block, each log row in the same tx; two admins race → one winner | integration | `reports-new-subjects.test.ts` | ❌ Wave 0 |
| D-733 | `canReport`/`canBlock` riders; staff never `canBlock`; entries work with `social` off | integration + web unit | `reports-new-subjects.test.ts`, `reports-view.test.ts`, component tests | ❌ Wave 0 |
| D-734 | voice send in a direct (idempotent per take, only two participants play, third member 404) | integration | `direct-chat-voice.test.ts` (reuses `chat-voice-fixtures.ts`) | ❌ Wave 0 |
| UI contract | menus, strips, profile zone, row control, queue rows, bell rows; 320/390 backstops | web component + Playwright | `pnpm --filter @rede-social/web exec vitest run <files>`, `e2e/direct-chat.spec.ts`, `e2e/safety.spec.ts` | ❌ Wave 0 (web plans, gated) |

### Sampling Rate
- **Per task commit:** the one quick command of the touched layer (module test, one pgTAP file, one integration file, one web test file).
- **Per wave merge:** `pnpm turbo typecheck test --concurrency=4` with `TURBO_CACHE=local:r`, plus `bash scripts/supabase.sh test db` once the wave touched SQL.
- **Phase gate:** full suite green in this order: lint, typecheck/build/test, boundaries, static routes, pgTAP, then integration (reset and seed in between if pgTAP follows), then e2e. Existing suites that pin touched seams must be updated deliberately: `registry.test.ts` (member permission sets), `isolation-inventory.test.ts` (new routes), `module-readmes.test.ts` (chat, social, notifications READMEs), `mounts.test.ts`, `admin-lane-inventory` (no new admin-lane site expected; the resolve already has one), web `notification-renderers` and `moderation-view` tests.

### Wave 0 Gaps
- [ ] `supabase/tests/237-direct-conversations.sql` — pair uniqueness, lane insert refused, definer eligibility, cross-tenant, case columns null, triggers leave directs alone, unread flag
- [ ] `supabase/tests/238-direct-block-effects.sql` — block deletes follows both ways, follow-policy refusal, send guard (block either way, `social` off, removed/blocked other), lock-order race, unpaired fixtures untouched
- [ ] `supabase/tests/239-reports-new-subjects.sql` — CHECK append, per-subject snapshot, own content, cross-tenant, message copy-only, no chat row readable by admin
- [ ] `supabase/tests/240-direct-realtime-media.sql` — topic for paired direct, `chat_asset_hidden` with the report clause (admin, reporter, third member, other tenant)
- [ ] `apps/api/tests/integration/{direct-chat,direct-chat-block,direct-chat-voice,direct-notifications,reports-new-subjects,reports-notice}.test.ts` and a `phase 11 sweep` block in `isolation.test.ts` plus entries in `apps/api/tests/isolation-inventory.ts` for every new route
- [ ] `packages/modules/chat/tests/direct-*.test.ts`, `packages/modules/social/tests/*` additions, `apps/web/lib/{chat-view,reports-view}.test.ts` additions
- [ ] Fixture helper: both `chat` and `social` (and `notifications` for push cases) enabled on demo and lab for the test span (`withModuleEnabled`), two more seeded members with a profile each
- [ ] No framework install needed.

## Security Domain

`security_enforcement` is enabled (`.planning/config.json`: `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high`).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | Supabase Auth + JWKS (unchanged) |
| V3 Session Management | no change | HttpOnly BFF cookies (unchanged); the block cut of Phase 8 untouched |
| V4 Access Control | **yes, primary** | Definers pinned to claims, RLS per command, `requirePermission` + `requireModule('social')`, one pgTAP cross-tenant negative per path, isolation inventory entry per route |
| V5 Input Validation | yes | Zod `.strict()` bodies (`chatBodySchema`, report body), `::uuid` casts after Zod, React text only for every member string |
| V7 Error Handling and Logging | yes | Logs carry ids and shapes only (the shipped rule): never a body, a name, a note or a reason; no "bloqueado" in codes |
| V8 Data Protection | yes | Report copy limited to 280 characters or one recording; conversation id never stored in a report; signed media access only via the gate |
| V13 API | yes | Strict answers, additive optional keys, `Cache-Control: no-store` on safety answers (existing) |
| V6 Cryptography | no | none introduced |

### Known Threat Patterns for this stack (inputs for the threat model)
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant reach of a direct (a user with memberships in two tenants; `users.id` is shared) | Information disclosure | Every statement pins `tenant_id = app.tenant_id()`; unique pair includes the tenant; topic embeds the tenant; negative: same two user ids in tenant B reach nothing (`pgTAP 223` already models this for blocks) |
| Staff or admin reading a direct through a policy or the report | Information disclosure | No staff path in `chat_conversations_select`; the worker uses a definer; negative tests for `admin_tenant` and `support_tenant` on `chat_messages` |
| Blocked member learns they are blocked (error code, wording, timing, absent buttons, `canMessage` flag, profile) | Information disclosure | One neutral code for the closed composer, bare 404 for a refused follow, no "blocked me" field; **accepted by decision D-722/UI-D-867:** the absent buttons are themselves a signal and are locked |
| Report of a message exposes the other side or the surrounding conversation | Information disclosure | Definer snapshots only the message; no conversation id stored; queue row has no link and no counterpart; voice link only via `chat_asset_hidden` + report row |
| Admin plays a recording that is not reported | Information disclosure | The report clause matches `media_asset_id` of an existing report row of the tenant only |
| Report spam / harassment by report | Denial of service | `reportLimiter` 20/h, one report per reporter and item, notice is one bell row per report (a flood of reports floods the admin bell: consider coalescing or a per-reporter ceiling, Open Question) |
| Send races a block (TOCTOU) | Tampering | Conversation row lock taken by both the block definer and the BEFORE INSERT trigger; recheck in the worker before pushing |
| Push to a pair that became blocked after enqueue | Information disclosure | The definer `deliverable` is recomputed at fan-out time |
| Push content on a lock screen | Information disclosure | Title is the writer's name and the body the first 100 characters: accepted by D-728 (as the support reply today) |
| Enumeration of member ids via `/conversas/com/{id}` | Information disclosure | One bare 404 for every miss, self redirects; membership ids are already public in the directory |
| Voice URL reuse | Information disclosure | `/v1/media/{id}/original` signs per request through the gate (unchanged) |
| Notification of a report to the reported administrator | Information disclosure | `excludeUserIds` contains the author; D-616 holds |
| Message flood | Denial of service | `directMessageLimiter` per member, 2000-character cap (`chat_messages_body_chk` as database backstop) |

## Sources

### Primary (HIGH confidence — read from source this session)
- `packages/modules/chat/db/schema.ts`, `server/{service,routes,notifications,notification-copy,voice-sql}.ts`, `contracts/index.ts`, `module.ts`
- `supabase/migrations/{20260930123213_realtime_authorization,20260930190229_chat_functions,20261001004638_chat_rls_grants,20261117082355_chat_cases_functions,20261117084153_chat_cases_transitions,20261117223744_chat_asset_gate_seam,20261117223747_chat_voice_gate,20261117230638_chat_voice_account_deletion,20261105152832_reports_blocks,20261105152916_reports_blocks_functions,20261019204728_social_follows,20261019204737_social_functions,20261111151218_moderation_member_content}.sql`
- `packages/core/server/safety/{reports,blocks,limits,sqlstate}.ts`, `packages/core/db/schema/content-reports.ts`, `packages/core/server/notifications/source.ts`, `packages/core/server/modules/counters.ts`, `packages/core/server/media/service.ts` (gate call), `packages/core/db/chat-gate.ts`
- `packages/contracts/src/moderation.ts`, `packages/modules/{social,stories,communities,feed,notifications}` services, schemas and manifests
- `apps/api/src/{modules/registry.ts,routes/safety.ts,routes/admin/reports.ts}`, `apps/api/tests/{isolation-inventory.ts,admin-lane-inventory/safety.ts,integration/reports-blocks.test.ts,integration/social-module.test.ts}`
- `apps/web/{app/sw.ts,lib/push-sw.ts,components/shell/LiveShell.tsx,app/(app)/layout.tsx,app/(app)/suporte/ThreadPane.tsx}` (structure), `packages/core/ui/nav.ts`
- `supabase/tests/{152-chat,223-reports-blocks,235-chat-cases,236-chat-voice}.sql`, `scripts/seed.ts`, `docs/DEPLOY.md:1224-1236`
- `.planning/phases/11-*/{11-CONTEXT,11-UI-SPEC,11-DISCUSSION-LOG}.md`, `.planning/ROADMAP.md` (Phase 11), `.planning/REQUIREMENTS.md`, `13-14-SUMMARY.md`, `13-20-PLAN.md`, `07-CONTEXT.md` (D-228, D-235..D-240)
- Environment probes: `node --version`, `pnpm --version`, `docker`, `bash scripts/supabase.sh test db --help`, `df -h`

### Secondary (MEDIUM)
- User memory notes on test quirks and the Phase 11 UI-gate state (cited inline)

### Tertiary (LOW)
- none (no web search was used: this is a brownfield, code-grounded phase; no external library is introduced)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every library is already in the repo
- Architecture: HIGH — each recommendation extends a verified seam; the two places that depart from a seam (literal push title, paired-only guards) are called out
- Pitfalls: HIGH — each is a file and line in the repo or a recorded project quirk
- Names, limits, SQLSTATEs: MEDIUM — proposals tagged `[ASSUMED]`

**Research date:** 2026-11-19
**Valid until:** 2026-12-19 (the code under it moves with every Phase 12.x/13 plan; re-grep `chat_messages_before_insert`, `content_report_create` and `member_block_create` for newer migrations before planning each SQL plan)

*Deploy order (for the plan's release task, `docs/DEPLOY.md:1227-1236`): expand-only migrations first (columns, CHECK widening, policy edits, function replacements), then the web (it tolerates both APIs), then the API and the worker together. Nothing in this phase is contract (no column dropped, no CHECK narrowed).*
