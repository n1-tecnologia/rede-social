# Phase 11: Rede Social - Direct Messages, Member Blocking and Reports - Pattern Map

**Mapped:** 2026-11-19
**Files analyzed:** 38 (new or modified)
**Analogs found:** 36 / 38 (all analog paths are git-tracked source)

Line numbers below are from this session's reads; where a range was not re-read here the RESEARCH.md cite is carried (marked "per RESEARCH"). Replacing a SQL function: copy the NEWEST body (RESEARCH Pitfall 1).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/<ts>_direct_pairs.sql` (pair columns, unique index, tightened insert policy; generated half) | migration | CRUD | `supabase/migrations/20261117084153_chat_cases_transitions.sql` (12.4 expand-only nullable columns) | role-match |
| `supabase/migrations/<ts>_direct_functions.sql` (`direct_conversation_open`, `direct_message_notice`, replaced `chat_messages_before_insert` / `_after_insert`) | migration (definer) | request-response | `20261105152916_reports_blocks_functions.sql` (claims-pinned definers) + `20261117084153_chat_cases_transitions.sql` (trigger body) | exact |
| `supabase/migrations/<ts>_blocks_follows_reports.sql` (replace `member_block_create`, `content_report_create`, widen CHECK, 2 columns, `members_blocked_between`, follow insert policy term) | migration | CRUD | `20261105152916_reports_blocks_functions.sql`, `20261105152832_reports_blocks.sql` | exact |
| `supabase/migrations/<ts>_chat_asset_hidden_report.sql` (extend `app.chat_asset_hidden` with the report clause) | migration | request-response | `20261117223747_chat_voice_gate.sql` | exact |
| `supabase/tests/237..240-*.sql` (direct conversations, block effects, reports new subjects, realtime/media) | test (pgTAP) | request-response | `supabase/tests/236-chat-voice.sql`, `235-chat-cases.sql` | exact |
| `packages/core/db/schema/content-reports.ts` | model | CRUD | itself (CHECK built with `list(REPORT_SUBJECT_TYPES)`) | exact |
| `packages/contracts/src/moderation.ts` | contract | transform | itself (append-only constants, strict schemas) | exact |
| `packages/modules/chat/db/schema.ts` | model | CRUD | itself (`chat_conversations_*` policies, case-shape CHECK) | exact |
| `packages/modules/chat/contracts/index.ts` | contract | request-response | itself (`chatBodySchema`, `CHAT_ISSUES`, `messageRowSchema`) | exact |
| `packages/modules/chat/server/direct.ts` (new) | service | request-response | `packages/modules/chat/server/service.ts` (`insertMessage`, `sendSupportMessage`, `pageOf`, `decodeInstantCursor`) | role-match |
| `packages/modules/chat/server/routes.ts` | route | request-response | itself (`chat.use('*', requireAuth, requireModule('chat'))`, per-route `requirePermission`) | exact |
| `packages/modules/chat/server/notifications.ts` + `notification-copy.ts` | notification source | event-driven | itself, `resolveMessageSent` (lines ~130-185) | exact |
| `packages/core/server/notifications/source.ts` (+ `notifications/contracts` hint schema, `push/payload.ts`) | kernel type / util | transform | itself (`title: 'tenant' \| 'team'`, `payload.ts:61`) | exact |
| `packages/core/server/safety/{reports,blocks,limits}.ts` | service | CRUD | itself | exact |
| `packages/modules/social/server/service.ts` (`followMember`, facts) | service | CRUD | itself, `followMember` (lines 84-106) | exact |
| `packages/modules/social/db/schema.ts` (follow insert policy term) | model | CRUD | itself | exact |
| `packages/modules/social/module.ts` + new social notification source | notification source | event-driven | `packages/modules/feed/server/notifications.ts` (sources) + `registry.ts:116-126` | role-match |
| `packages/modules/notifications/module.ts` (report-created source) | notification source | event-driven | `membership.blocked` subscriber in the same manifest | role-match |
| `packages/modules/{stories,communities,feed}/server/service.ts` (`...InTx` removers, story-comment blocked filter) | service | CRUD | `removeReportedContentInTx` (`feed/server/service.ts:2487`) | exact |
| `apps/api/src/routes/admin/reports.ts` (dispatcher) | route | request-response | itself (line 89 `removeContent: removeReportedContentInTx`) | exact |
| `apps/api/src/modules/registry.ts` (`chat.direct` composition) | config | transform | itself (`registry.ts:242-249`) | exact |
| `apps/api/tests/integration/direct-*.test.ts`, `reports-new-subjects.test.ts` | test | request-response | `chat-voice.test.ts`, `chat-voice-fixtures.ts`, `reports-blocks.test.ts` | exact |
| `apps/api/tests/isolation-inventory.ts` (+ admin-lane inventory) | test | batch | itself | exact |
| `apps/web/app/(app)/conversas/**` (list, thread, `/com/{membershipId}`) | component/page | request-response | `apps/web/app/(app)/suporte/ThreadPane.tsx` (do NOT extend it) | role-match |
| `apps/web/components/chat/DirectThreadPane.tsx` | component | streaming (realtime signals) | `suporte/ThreadPane.tsx` + `packages/modules/chat/ui/{ChatComposer,MessageList}.tsx` | role-match |
| `apps/web/components/shell/LiveShell.tsx` (bubble destination, counters) | component | event-driven | itself (lines 145-147, 207-213 per RESEARCH) | exact |
| `apps/web/app/(app)/configuracoes/{denuncias,bloqueados}/**` | page | request-response | `apps/web/app/(app)/configuracoes/moderacao/**` | role-match |
| `apps/web/lib/{reports-view,chat-view}.ts`, `moderation-view.ts` | utility | transform | `apps/web/lib/moderation-view.ts` | exact |
| `apps/web/lib/notification-renderers.tsx` | utility | transform | itself | exact |
| `apps/web/messages/pt-BR/{chat,social,notifications,moderation,safety}.json` | config | n/a | existing catalogs in same dir | exact |
| `PostMenu`/`ReportAndBlock`/`CommentItem` report entries | component | request-response | 13-20 file list (no shipped analog; see below) | none |

## Pattern Assignments

### Definers: `direct_conversation_open`, `members_blocked_between`, `direct_message_notice`

**Analog:** `supabase/migrations/20261105152916_reports_blocks_functions.sql`

Header convention (lines 6-11): every write is a definer, pins tenant and caller to claims in EVERY statement, `security definer`, `set search_path = ''`, fully qualified names, `revoke all ... from public`, `grant execute ... to authenticated` only.

Caller-live guard (copy, lines 52-73):
```sql
create or replace function app.member_block_create(p_blocked uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_n int;
begin
  if v_t is null or v_u is null then
    raise exception 'member_block_create: refused' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.tenant_id = v_t and m.user_id = v_u
       and m.status = 'active' and m.blocked_at is null and m.deleted_at is null
  ) then
    raise exception 'member_block_create: refused' using errcode = '42501';
  end if;
```
Target validity (lines 78-89): `role = 'member'`, `status = 'active'`, `blocked_at is null`, `deleted_at is null`, same `tenant_id`; refusal `BL001` (single code, no oracle). `direct_conversation_open` uses the same shape with ONE custom SQLSTATE (`DM001`, 5 chars `[0-9A-Z]`, regex in `packages/core/server/safety/sqlstate.ts:4`).

Grant tail (lines 98-100): `revoke all on function ... from public;--> statement-breakpoint` then `grant execute ... to authenticated;--> statement-breakpoint`. The `--> statement-breakpoint` marker is required between statements.

Invoker predicate pattern (lines 36-45, `app.is_blocked_by_viewer`): `security invoker`, explicit tenant scope, blocker-only. `members_blocked_between` is a definer variant (see RESEARCH Code Examples) because the blocked side cannot read `member_blocks`.

**`member_block_create` replacement:** copy the body above (newest definition is this file, no later replacement per RESEARCH), add before the insert: lock the paired direct row `for update`, and after the insert delete `social_follows` in both directions in the same tx.

### `chat_messages_before_insert` / `_after_insert` replacement

**Analog:** `supabase/migrations/20261117084153_chat_cases_transitions.sql` (lines 25-85 BEFORE body, newest; the 12.4 header table at lines 7-17). The AFTER body is `20260930190229_chat_functions.sql` unless a later file replaced it: run `grep -ln "chat_messages_after_insert" supabase/migrations/*` and take the newest. Copy character for character, add only: paired-direct guard (`direct_low_user_id is not null`), author `last_read_seq = new.seq`, recipient `chat.unread` signal. Do not use `on conflict` on `chat_messages` (seq trigger fires first).

### Tightened `chat_conversations_insert` and pair columns

**Analog:** `packages/modules/chat/db/schema.ts` lines ~137-140 (partial unique `chat_conversations_one_active_case_per_member` `where kind = 'support' ...`), 149 (kind CHECK), 184-187 (case-shape CHECK), 220-228 (select/insert policy), 274-278 (participants insert, self-only). Mirror the partial unique index with `.where(sql\`direct_low_user_id is not null\`)`, tenant-first (040 convention). No CHECK forcing the pair on every `direct` row (fixtures 152/235/236 insert bare directs).

### `content_report_create` (new branches), CHECK widening, report columns

**Analogs:** `20261105152916_reports_blocks_functions.sql` (switch on `p_subject_type`; unknown type raises `22023`; refusal codes `RP001` own content, `RP002` missing, `RP004` already resolved), `20261105152832_reports_blocks.sql` (CHECK `content_reports_subject_type_chk`, one select policy, no write policy), `packages/core/db/schema/content-reports.ts` (list built from `REPORT_SUBJECT_TYPES`). Direct-message branch must itself check participation (the definer bypasses RLS) and never store the conversation id.

### `app.chat_asset_hidden` report clause

**Analog:** `supabase/migrations/20261117223747_chat_voice_gate.sql` (header lines 6-10; security INVOKER, "not hidden" if the caller can read a message carrying the recording). Add the clause "caller can read a `content_reports` row whose `media_asset_id` is this asset" so the invoker RLS (`content_reports_select`) is the single answer.

### `packages/contracts/src/moderation.ts`

**Analog:** itself. `REPORT_SUBJECT_TYPES` at line 91 (append `story`, `story_comment`, `community`, `direct_message`, never insert); `reportItemSchema` strict at lines 204-227: every new key `.optional()` (strict web parsers, Pitfall 5); `MODERATION_SUBJECT_TYPES`/`MODERATION_ACTIONS` already contain the story/community values (lines 68-74), no log migration.

### `packages/core/server/safety/reports.ts`

**Analog:** itself. Replace the two-way ternary precheck (line ~78) with an exhaustive switch read through the reporter's lane; replace the `else` in `content_available` (lines 218-223) with an exhaustive `case`. `ReportContentRemover` type at lines 289-293 stays; the kernel never imports a module (MOD-02).

### `...InTx` removers (stories, communities)

**Analog:** `packages/modules/feed/server/service.ts:2487` `removeReportedContentInTx`:
```ts
const NOTHING_AFTER_COMMIT = () => undefined;
export async function removeReportedContentInTx(
  tx: Tx,
  ctx: RequestContext,
  subject: { type: ReportSubjectType; id: string },
): Promise<ReportedRemoval> {
  const live = ... select 1 as one from feed_posts where id = ${subject.id}::uuid and deleted_at is null ...
  if (live.length === 0) return { outcome: 'already_gone', afterCommit: NOTHING_AFTER_COMMIT };
```
Sources to extract from: `deleteStory` (`stories/server/service.ts:1013`, log at `:1059` through `recordModerationAction(tx, ...)`), `deleteStoryComment` (`:1601`, log at `:1633`), `updateCommunity` archive branch (`communities/server/service.ts:1227-1240`, `logModeratorAction` at `:1060`). Read permission flags (`canManage`, `canModerate`) via `permissionsForRequest(ctx)` BEFORE the tx opens (pool max 5). Story-comment list: add `and not app.is_blocked_by_viewer(c.author_user_id)` at `listStoryComments` (`:1418`), the same way stories use it at `:594, 660, 714`.

### `apps/api/src/routes/admin/reports.ts` dispatcher

**Analog:** itself. Imports line 13 `removeReportedContentInTx` from `@rede-social/module-feed/server`; line 89 passes `removeContent: removeReportedContentInTx`. Replace with an API-tier switch (RESEARCH "Resolve dispatcher"). Guard stays `requirePermission(KERNEL_PERMISSIONS.moderationManage)` (line 29); `reports.use('*', requireAuth)`. API tier may import every module.

### `packages/modules/chat/server/notifications.ts` (direct notice)

**Analog:** itself, `resolveMessageSent`. Existing early exit `if (row?.kind !== 'support' || !row.member_user_id) return [];` (line ~149). Shape to copy for the push-only intent:
```ts
return [{
  ...common,
  kind: CHAT_NOTIFICATION_KINDS.supportReply,
  audience: { type: 'users', userIds: [row.member_user_id] },
  excludeUserIds: [row.author_user_id],
  dedupeKey: `${CHAT_NOTIFICATION_KINDS.supportReply}:${payload.messageId}`,
  channels: ['push'],
  push: pushHint(payload.conversationId, 'team', supportReplyPushCopy(text), '/suporte'),
}];
```
Voice preview: `isVoice = row.voice_seconds != null`; gone recording returns `[]`; `voicePreview(seconds)`. For directs read through the new definer, not `chat_messages` (the worker lane is `support_tenant` zero user, `notifications/server/system-context.ts:4-26`). Add `CHAT_NOTIFICATION_KINDS.directMessage`, push-only, no bell row.

### Push title widening (three files together)

**Analog:** `packages/modules/notifications/server/push/payload.ts:61`:
```ts
const title = hint.title === 'team' ? PUSH_TITLE_COPY.team(tenantName) : tenantName;
```
plus `packages/core/server/notifications/source.ts:32` (`title: 'tenant' | 'team'`) and `notifications/contracts/index.ts:361` (`z.enum(['tenant','team'])`). Add an optional `titleText` literal (capped) beside `title`; ship the schema widening before any code enqueues the new shape (Pitfall 11). Keep `PUSH_PAYLOAD_MAX_BYTES = 3072`.

### `packages/modules/social/server/service.ts` `followMember`

**Analog:** itself lines 84-106. Target lookup:
```ts
const target = await tx.execute<{ user_id: string }>(sql`
  select m.user_id from memberships m
   where m.id = ${membershipId}::uuid and ${LIVE_MEMBER}
   limit 1`);
const row = target[0];
if (!row) throw new ApiError(404, 'NOT_FOUND');
if (row.user_id === ctx.userId) throw new ApiError(400, 'VALIDATION_FAILED', { follow: 'self_follow' });
```
Add `and not app.members_blocked_between(m.user_id)` to the lookup so a blocked pair is the same bare 404 (the catch maps `42501` to `404 MODULE_DISABLED`, wrong word). Insert uses `on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`; add `returning id` and emit `social.followed` after commit only when created.

### Registry permission composition

**Analog:** `apps/api/src/modules/registry.ts:242-249` (`if (effective.has('social') && role === 'member') { permissions.add(FEED_PERMISSIONS.create); ... }`). Add `chat.direct` when `effective.has('social') && effective.has('chat') && role === 'member'`. Notification sources registered at `registry.ts:116-126`; manifest field declared at `packages/core/server/modules/manifest.ts:137-148`.

### Chat routes

**Analog:** `packages/modules/chat/server/routes.ts:79` `chat.use('*', requireAuth, requireModule('chat'));` with per-route `middleware: [requirePermission('chat.support.contact')]`. New direct routes add `requireModule('social')` and `requirePermission('chat.direct')`; request schemas `.strict()`; reuse `chatBodySchema`; new refusal word `direct_closed` (never `member_blocked`, which exists in `CHAT_ISSUES` lines 115-129).

### Web: DirectThreadPane and Conversas

**Analog:** `apps/web/app/(app)/suporte/ThreadPane.tsx` (1257 lines; copy structure, do not add branches), `packages/modules/chat/ui/ChatComposer.tsx`, `MessageList.tsx`, `apps/web/lib/chat-cursor`, `chat-view`, `voice-send`. Bubble and counters: `apps/web/components/shell/LiveShell.tsx` (refetch counters on `chat.unread` over `COUNTER_EVENTS` on the user topic). Gate every web plan with `grep -q '^approved: true' .planning/sketches/025-phase-11-designed-screens/README.md`.

### pgTAP and integration tests

**Analog:** `supabase/tests/236-chat-voice.sql` (begin; numbered header sections, appended continuously), `235-chat-cases.sql`. Every policy needs a cross-tenant negative plus a positive control. Integration: `apps/api/tests/integration/chat-voice-fixtures.ts` (helpers), `reports-blocks.test.ts` (notice count scoping at line ~623), `setup.ts:613` `withModuleEnabled(host, key)`; direct tests need `chat` and `social` both on in the tenant (seed splits them: rede-lab social only, rede-demo chat only).

## Shared Patterns

### Claims-pinned definers
**Source:** `20261105152916_reports_blocks_functions.sql` header + `member_block_create`. **Apply to:** every new SQL function (open, notice, blocked_between, report branches, member_block_create).

### Expand-only, copy-newest-body replacement
**Source:** `20261117084153_chat_cases_transitions.sql`, `20261117230638_chat_voice_account_deletion.sql` (`account_anonymise` newest). **Apply to:** every `create or replace`. Add a pgTAP assertion per preserved behavior.

### Guard only paired directs
**Apply to:** the send guard, any `social` term in select policies: condition `direct_low_user_id is not null`, or fixtures in 152/235/236 break.

### Neutral refusal
One SQLSTATE (`DM001`), one API word (`direct_closed`), bare 404 on every target miss; never "bloqueado", never `member_blocked`.

### Strict-parser additive contracts
**Source:** `moderation.ts:204-227`. New response keys `.optional()`; release order: migrations, web, then API and worker.

### Module boundaries
Kernel never imports a module (`reports.ts:289-293`); cross-module wiring only in `apps/api/src/{modules/registry.ts,routes/*}`.

### No Claude co-author trailer in commits
Repo rule from project memory; applies if anything is committed.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `PostMenu` / `ReportAndBlock` / `CommentItem` report entries, `safety-actions.ts`, `configuracoes/bloqueados`, `configuracoes/denuncias` | component/page | request-response | Phase 13 plan 13-20 never executed; nothing shipped. Use the 13-20 file list plus sketch 025 and the `configuracoes/moderacao` page as the structural analog |
| Per-participant unread (two-sided) | service | CRUD | Support unread is staff-vs-member (`chatCounters`, `service.ts:1248-1262`); direct uses the author-advances `last_read_seq` rule in RESEARCH 1.5 |

## Metadata

**Analog search scope:** `supabase/migrations`, `supabase/tests`, `packages/{core,contracts,modules/chat,modules/social,modules/notifications,modules/feed}`, `apps/api/{src,tests}`, `apps/web/{app,components,lib}`
**Files scanned:** ~25 read or grepped; remaining excerpts carried from RESEARCH.md verified cites
**Pattern extraction date:** 2026-11-19
