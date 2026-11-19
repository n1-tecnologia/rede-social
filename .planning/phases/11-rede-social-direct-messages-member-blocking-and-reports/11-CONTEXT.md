# Phase 11: Rede Social - Direct Messages, Member Blocking and Reports - Context

**Gathered:** 2026-11-19
**Status:** Ready for planning

<domain>
## Phase Boundary

With the `social` module on, members message each other 1:1, the block a member already has (Phase 13) starts to change messaging and following, the member and the tenant are told about the new social events that concern them, and members can report stories, story comments, communities and direct messages, which `admin_tenant` works in the reports queue Phase 13 already ships.

Four things are built here, and nothing else.

1. **Direct conversations** between two members of the same tenant (`chat_conversations.kind = 'direct'`, no migration of the model), started from the member profile and from each `/membros` row, listed together with the support chat behind the same top-bar bubble, with voice messages inherited from Phase 12.5.
2. **The block's effect** on messaging and following. The block table, the block and unblock routes, the "Membros bloqueados" list and the blocker's content filter are NATIVE-33 (Phase 13) and are not planned again.
3. **Two new member notices and one new admin notice**: "nova mensagem" (badge and push), "começou a te seguir" (bell) and "nova denúncia" (bell and push for whoever moderates).
4. **Reports of four more subjects** (`story`, `story_comment`, `community`, `direct_message`) and the screens for reporting and blocking on every subject. The report slice for posts and comments (NATIVE-31, the queue, its three actions) is Phase 13's server and is not planned again. The screens Phase 13 planned in 13-20 (`PostMenu`, `CommentItem`, `/configuracoes/bloqueados`, `/configuracoes/denuncias`) move here, as the roadmap amendment of 2026-11-04 says.

Requirements covered: CHAT-06, CHAT-07 (effects only), MODER-04 ("block author" from a report), MODER-05 (story, story comment, community, direct message), plus the notice rules of the old roadmap criterion 3. New ids are written at planning. Phase 12.5's voice acceptance for direct chats must be listed in this phase's acceptance (12.5-CONTEXT).

Not here: group chats (`kind = 'group'`), message requests, muting or deleting a conversation, per-kind notification switches, read or played receipts, any change to the support chat for a member who never writes to another member.

</domain>

<decisions>
## Implementation Decisions

Decision ids D-719..D-739 are this phase's block (reserved by Phase 10.1 and 10.2). Igor chose every default option offered below in the discussion of 2026-11-19, in plain pt-BR, one question at a time.

### Conversations (where they live and how they start)
- **D-719:** With `social` effective for the tenant, the top-bar chat bubble opens a list "Conversas". The support chat is its first, pinned row (it opens the member's active case exactly as today) and the direct conversations follow, newest activity first. With `social` off the bubble keeps opening the active case directly, so D-220 and D-803 hold unchanged for every tenant without `social`. The bubble's unread number (`bootstrap.counters.unreadConversations`) adds the unread direct conversations. Staff are untouched, they have the inbox and no direct conversations (D-482).
- **D-720:** A direct conversation starts from two places only. The "Enviar mensagem" button on another member's profile and a message control on each `/membros` row, the same places as the Seguir button (D-470). It is created lazily on the first message, the way the support case is. A conversation with no message does not exist and does not show in the list. There is at most one conversation per pair of members, so the button opens the existing one. Following is not required, and a member cannot message staff, themselves, a removed member or a member of another tenant. — **Reversibility:** costly — the one-per-pair rule is a unique constraint over the two participants, and lifting it later means deciding which of several conversations survives.
- **D-721:** When the administrator blocks a member (`memberships.blocked_at`) or the membership is removed, a direct conversation with that member leaves the other participant's list and refuses new messages, nothing is deleted, and it returns whole when the administrator unblocks, the same behavior as posts and the directory (D-484). When the account is deleted for good (Phase 13 anonymisation) the conversation stays for the other participant, read only, with the other side shown as "Membro removido".

### What a member block changes
- **D-722:** A blocked member (B) who writes in a conversation with the member who blocked (A) finds the composer closed with the plain sentence "Esta conversa não aceita novas mensagens." and no reason. B still reads the history. Nothing is sent, nothing is delivered, nobody is told, and the refusal code and wording never say "bloqueado" or name A. The same neutral refusal applies when B tries to start a conversation. A's profile does not offer B the "Enviar mensagem" button or the Seguir button, as the roadmap says.
- **D-723:** On A's side the existing conversation stays in the list and the history stays readable (it is the evidence for a later report). The composer is replaced by "Você bloqueou {nome}" and a "Desbloquear" button, and A cannot send while the block stands. Unblocking restores the composer. Neither side gets a notice.
- **D-724:** Blocking deletes the follow rows between the two members in both directions, in the same transaction as the block. Unblocking does not bring them back, whoever wants to follow again follows again. A new follow between a blocked pair is refused (the roadmap's criterion 2), with a neutral refusal. — **Reversibility:** costly — the follow rows are removed, so a later "restore on unblock" needs a different model that keeps them as soft state.
- **D-725:** Nothing else changes for the blocked member. B keeps seeing A's profile and public posts and may like and comment on them. A keeps not seeing B's posts and comments, through the filter Phase 13 shipped (`app.is_blocked_by_viewer`). The block adds no new feed, Explorar, community, story or directory filter.

### Notices
- **D-726:** A member's post keeps notifying nobody. D-476 is now the decision and not an interim answer, and followers find the post in Explorar. The author is still told of first-level comments on their own post (D-477).
- **D-727:** "Começou a te seguir" is a new in-app kind, a row in the bell and no push, like a like (D-235). It is sent once per pair, so a follow, unfollow and follow again does not notify twice. It exists only with `social` on and never reaches a blocked pair. — **Reversibility:** costly — notification kinds are stored strings and renderers grow around them (D-448).
- **D-728:** "Nova mensagem" lights the unread number on the bubble and the Conversas row, and sends one push per conversation (the push `tag`), with no row in the bell, the same shape as the support reply (D-228). The push title is the name of whoever wrote and the body is the start of the message, about 100 characters, and a voice message reads "Mensagem de voz" with its duration as `m:ss` (D-860). No push goes to a blocked pair, when `social` is off, or to a participant who is looking at the conversation (D-236).
- **D-729:** A new report notifies the people who hold `moderation.manage` with a row in the bell and a push titled "Nova denúncia". It never says what was reported or by whom, there is one per report, and it applies to every subject type including the posts and comments Phase 13 already accepts. The report's author and the reported member are never told (D-616 holds). — **Reversibility:** costly — a new kind that the admin bell renders and the worker fans out.

### Reports of the new subjects
- **D-730:** `REPORT_SUBJECT_TYPES` and the `content_reports_subject_type_chk` CHECK are appended with `story`, `story_comment`, `community` and `direct_message`, never inserted, as the contract header already plans (`packages/contracts/src/moderation.ts`). The five reasons, the 500-character note, one report per reporter and item, no report of one's own content and the exclusion of other tenants' items stay as in Phase 13 (AD-5..AD-7). Staff content can be reported (AD-1). — **Reversibility:** one-way — the CHECK list is fixed with the table and grows only by appending.
- **D-731:** A report of a direct message stores a copy of only the reported message (the 280-character excerpt already in the contract, or the recording for a voice message). The administrator reads that copy and nothing else of the conversation, and the rest stays private. A reported voice message is audible to a holder of `moderation.manage` only through that report (a new read seam beside D-867's `app.chat_asset_hidden`, and nobody outside the conversation and the report can play it). — **Reversibility:** costly — widening the stored context later (the messages around it) changes the report row and every reader of it.
- **D-732:** The administrator's actions depend on the subject. For a message the sheet offers "Ignorar" and "Bloquear autor" only, because the chat is append only (D-859) and a hidden message is not built. "Bloquear autor" is the administrator's tenant-level block of Phase 8, for every subject. For a member community "Remover conteúdo" archives it (the `community_archived` log row of MCOMM-10), reversible, and removing it for good stays outside the queue. For a story it is the existing `story_removed` path (MSTORY-09), and for a story comment the existing `comment_removed` path. Every action that removes or blocks writes its `moderation_log` row in the same transaction, as Phase 13's resolve already does.
- **D-733:** The "Denunciar" entry sits in the context menu of each subject, the story viewer, the community header, the story comment and the message bubble, next to "Bloquear {nome}" where the author is a member, the pattern of UI-D-632..UI-D-638 drawn in sketch 017. The entry follows where the content is shown, so it works with `social` on or off for whatever is still visible (AD-8). Exact placement and copy are the UI phase's call.

### Voice and inherited surfaces
- **D-734:** A direct conversation uses the same composer, message model, bubble and player as the support chat, so voice messages (up to 5 minutes, Phase 12.5) work in it without a new recorder or player. Phase 11's acceptance names "voice in direct chats", including that only the two participants play the recording (D-858, D-867), and the plan must not rebuild any of it.

### Claude's Discretion
- The UI-gate path. The default is one new sketch (next free number after 024) that carries the Phase 13 report and block frames forward (`post-menu-denunciar`, `denunciar-*`, `bloquear-dialogo`, `bloqueados-*`, `denuncias-*`) together with the new surfaces (the Conversas list, the conversation with its closed and blocked composer states, the profile button, the message and story and community report entries, the "Nova denúncia" bell row), approved once by Igor's pasted frontmatter (D-417). Plan 13-20 then shrinks to an in-app check, as the roadmap says. Igor did not decide this in the discussion and confirms or overturns it at the sketch review.
- Abuse limits on direct messages. A text message keeps the support chat's 1 to 2000 characters after trim, and the per-member send rate reuses the attempt limiter Phase 13 added (13-13). The numbers are the planner's.
- The error codes and exact pt-BR wording of the neutral refusals (D-722), the "Membro removido" label, empty states, and how the blocker's profile shows "Desbloquear" in place of the message and Seguir buttons.
- Whether the "começou a te seguir" row is retracted when the follow is undone (the keep-and-mark path of D-448..D-454), and how "once per pair" is stored.
- Which routes and RLS policies carry the member lane of direct messages (the chat triggers and the case transitions of Phase 12.4 must be proved to leave `direct` rows alone, as `supabase/tests/235-chat-cases.sql` already pins for the case columns).
- The reading order and paging of the Conversas list, the unread counting, and the realtime topic per conversation (`tenant:<tenant_id>:conv:<conversation_id>` already exists).

### Carried forward, not discussed again
- **D-482 [informational] (09):** only `member` takes part in the social surfaces, staff have no direct conversation.
- **D-483 [informational] (09):** with `social` off everything social hides and nothing is deleted, so direct conversations and follows return when it is turned back on.
- **D-484 [informational] (09):** a member the administrator blocked disappears until unblocked.
- **D-467 [informational] (09):** the follow graph is member to member only.
- **D-470 [informational] (09):** the Seguir button sits on the profile, the "Siga para ver" screen, each `/membros` row and the two private lists, nowhere else.
- **D-476 [informational] (09):** answered finally by D-726 above.
- **D-616 [informational] (13):** the minimum report and block slice, nobody told, staff cannot be blocked by a member, the block is not gated by `social`.
- **D-220 [informational] (07):** the bubble opens the support thread directly with no help hub, kept for tenants without `social` by D-719.
- **D-228 [informational] (07):** support replies light the chat badge and push without a bell row, the model for D-728.
- **D-235 [informational] (07):** every in-app kind except likes is pushed, the baseline D-727 departs from on purpose.
- **D-800 [informational] (12.4):** `direct` and `group` conversations keep every rule they had, the case columns stay null for them.
- **D-846 [informational] (12.5):** a message is text or one recording, and everyone who may send text may send voice.
- **D-859 [informational] (12.5):** nobody edits or deletes a sent message, text or voice.
- **D-860 [informational] (12.5):** a voice message reads "Mensagem de voz" plus its duration wherever a preview shows.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition
- `.planning/ROADMAP.md` § Phase 11 — goal, five success criteria with the 2026-11-04 amendments, Notes. § Phase 13 criterion 9 and plan 13-20 for what moved here.
- `.planning/REQUIREMENTS.md` — CHAT-06, CHAT-07, MODER-04, MODER-05 (and the splits), NATIVE-31, NATIVE-33, SOCIAL-07, FOLLOW-01..06, MSTORY-09, MCOMM-10, MCOMM-11, VOICE-01..37.

### Report and block slice already built (Phase 13)
- `.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-CONTEXT.md` — D-616.
- `.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-UI-SPEC.md` and `13-UI-SPEC-ADDENDUM.md` — UI-D-632..UI-D-638 and assumptions AD-1..AD-8.
- `.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-20-PLAN.md` — the screens this phase takes over, with the files they touch.
- `.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-08-SUMMARY.md`, `13-14-SUMMARY.md` — the definers, routes and decisions already shipped.
- `.planning/sketches/017-phase-13-designed-screens/README.md` — the report and block frames, not yet approved.
- `packages/contracts/src/moderation.ts` — report vocabularies and the append plan for `story_comment`, `community` and `direct_message`.

### Chat, follow and moderation it builds on
- `.planning/phases/07-notifications-web-push-chat/07-CONTEXT.md` — D-40, D-220..D-236 (bubble, notice kinds, push rules).
- `.planning/phases/12.4-abertura-de-chamado-no-suporte/12.4-CONTEXT.md` — D-800..D-844 (the support case, which leaves `direct` rows alone).
- `.planning/phases/12.5-mensagem-de-voz-no-chat/12.5-CONTEXT.md` — D-846..D-868 (voice in every chat, the read gate for chat audio).
- `.planning/phases/09-rede-social-follow-member-posts-and-explorar/09-CONTEXT.md` — D-467..D-484 (follow graph, `social` on and off, admin block).
- `.planning/phases/10-rede-social-member-stories-and-communities/10-CONTEXT.md` — D-701..D-718 (member stories and communities, moderation rows).
- `.planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/08-CONTEXT.md` — the moderation log, `moderation.manage`, the tenant-level block.

### Design
- `.planning/sketches/MANIFEST.md` and `.planning/sketches/024-phase-12.5-designed-screens/README.md` — the latest sketch and the gate mechanics (D-417, approval pasted by the user).
- `reference/frontend-design/` — the design team's prototype, which has no direct-message, report or block screens, so these are prototype-less screens drawn in a sketch first.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/modules/chat` — the schema already allows `kind in ('support','direct','group')` (`db/schema.ts`), plus `server/service.ts`, `server/routes.ts`, `server/notifications.ts`, `server/notification-copy.ts`, `server/voice-sql.ts` and the shared composer and bubble in `ui/`.
- `apps/web/app/(app)/suporte/` — `ThreadPane`, `SupportSplit`, `SupportInbox`, `chamados/` and the `[conversationId]` route, the thread screen the direct conversation reuses. The chat module's single href is `/suporte`, placed in the top bar (`packages/modules/chat/module.ts`).
- `packages/core/server/safety/{blocks,reports,limits,sqlstate}.ts`, `apps/api/src/routes/safety.ts` and `apps/api/src/routes/admin/reports.ts` — the member block and report services and the admin lane that resolves a report in one transaction with the removal path injected from the API tier.
- `packages/core/db/schema/{member-blocks,content-reports}.ts`, migrations `20261105152832_reports_blocks.sql` and `20261105152916_reports_blocks_functions.sql`, `app.is_blocked_by_viewer`, and pgTAP `supabase/tests/223-reports-blocks.sql`.
- `packages/modules/social` (follows, `social_follows` migration `20261019204728`) and `apps/web/app/(app)/membros/` (`MembersList.tsx`, `[membershipId]/page.tsx`) for the profile and the row where the new buttons sit.
- Removal paths with their log rows: `story_removed` (MSTORY-09), `community_archived` and `community_removed` (MCOMM-10), `comment_removed`, `post_removed` (`packages/modules/feed/server/service.ts` exports the in-transaction forms 13-14 extracted).
- Notifications, the `notificationSources` and `notificationRetractions` seams (`feed.comment_replied` is the closest pattern, D-448..D-454) and `apps/web/lib/notification-renderers.tsx`.

### Established Patterns
- Kernel tables with one select policy and writes only through tenant-pinned definers, a viewer-scoped predicate as a security invoker function, and a pgTAP negative for every cross-tenant path.
- The kernel never imports a module, the API tier injects the module's remover (`ReportContentRemover`).
- Every new route joins the isolation inventory, and an admin-lane transaction is inventoried (`apps/api/tests/admin-lane-inventory`).
- Sketch gate before any prototype-less screen, approval pasted by Igor into the sketch README (D-417), and every UI string in the pt-BR catalogs (`scripts/check-ui-literals.sh`).
- The chat is append only, the message has a gapless per-conversation `seq`, and the realtime topic is private per conversation.

### Integration Points
- The two chat triggers and the case transitions of Phase 12.4 must be shown to leave `direct` rows alone, and the INSERT policy and the voice routes need a member lane for a direct conversation.
- The kernel media read gate for chat audio (`app.chat_asset_hidden`) must cover the two participants of a direct conversation and the administrator through a report.
- `content_reports_subject_type_chk` and `ModerationSubjectType` widen in one release, with the web's exhaustive maps.
- `bootstrap.counters.unreadConversations` and the top-bar badge add direct conversations.
- A block must delete the two follow rows and refuse follow and message in the same definers that Phase 13 shipped.
- The release order of a CHECK widening and of a new notification kind follows the deploy runbook (`docs/DEPLOY.md`).

</code_context>

<specifics>
## Specific Ideas

- Plain, short pt-BR for every sentence the member reads. The blocked member never sees the word "bloqueado" or the blocker's name in a refusal.
- The support row in "Conversas" must feel like the support chat today, the member who never writes to another member should notice nothing new beyond the list.
- A reported message is judged on its own text or recording, with no context from the rest of the conversation.

</specifics>

<deferred>
## Deferred Ideas

- Group chats (`kind = 'group'`), message requests ("Solicitações"), muting, archiving or deleting a conversation, and a setting for who may message me. Not asked, and each is a new capability.
- Context around a reported message (the messages before and after) and an administrator action that hides a message. Considered and not chosen, revisit if a pilot tenant's moderation shows the need.
- A "Nova conversa" button with a member search in the Conversas list.
- A notice to followers when a member posts, and a push for a new follower. Both stay off, and per-kind notification switches are V2-NOTIF-01.
- Read and played receipts (V2-CHAT-02).

</deferred>

---

*Phase: 11-Rede Social - Direct Messages, Member Blocking and Reports*
*Context gathered: 2026-11-19*
