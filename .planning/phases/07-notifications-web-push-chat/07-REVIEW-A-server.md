---
phase: 07-notifications-web-push-chat
area: A (server / kernel / db)
reviewed: 2026-10-01T00:31:30Z
depth: standard
diff_base: 80ef5b8
files_reviewed: 91
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - .github/workflows/deploy-api.yml
  - apps/api/.env.example
  - apps/api/package.json
  - apps/api/src/app.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/me.ts
  - apps/api/tests/integration/bootstrap.test.ts
  - apps/api/tests/integration/chat.test.ts
  - apps/api/tests/integration/events-reminders.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - apps/api/tests/integration/modules.test.ts
  - apps/api/tests/integration/notifications-prune.test.ts
  - apps/api/tests/integration/notifications.test.ts
  - apps/api/tests/integration/push.test.ts
  - apps/api/tests/integration/realtime-helpers.ts
  - apps/api/tests/integration/realtime.test.ts
  - apps/api/tests/integration/setup.ts
  - apps/api/tests/unit/env.test.ts
  - apps/api/tests/unit/registry.test.ts
  - apps/api/vitest.config.ts
  - docs/DEPLOY.md
  - docs/phase-07-device-test-plan.md
  - packages/contracts/package.json
  - packages/contracts/src/bootstrap.ts
  - packages/contracts/src/realtime.ts
  - packages/contracts/src/text.ts
  - packages/contracts/tests/text.test.ts
  - packages/core/db/schema/index.ts
  - packages/core/package.json
  - packages/core/server/env.ts
  - packages/core/server/jobs/sweep-functions.ts
  - packages/core/server/media/sweep-job.ts
  - packages/core/server/modules/counters.ts
  - packages/core/server/modules/manifest.ts
  - packages/core/server/notifications/sink.ts
  - packages/core/server/notifications/source.ts
  - packages/core/server/rbac/require-role.ts
  - packages/core/tests/before-logout.test.tsx
  - packages/core/tests/live-counters.test.tsx
  - packages/core/tests/realtime-app-badge.test.ts
  - packages/core/tests/realtime-token-source.test.ts
  - packages/core/tests/require-role.test.ts
  - packages/core/tests/tenant-logo.test.tsx
  - packages/core/ui/AppShell.tsx
  - packages/core/ui/BeforeLogout.tsx
  - packages/core/ui/DesktopRail.tsx
  - packages/core/ui/HidingLogoImage.tsx
  - packages/core/ui/TenantLogo.tsx
  - packages/core/ui/TopBar.tsx
  - packages/core/ui/index.ts
  - packages/core/ui/realtime/LiveCountersProvider.tsx
  - packages/core/ui/realtime/RealtimeProvider.tsx
  - packages/core/ui/realtime/SlotBadgeLabels.tsx
  - packages/core/ui/realtime/app-badge.ts
  - packages/core/ui/realtime/token-source.ts
  - packages/core/ui/realtime/useRealtimeTopic.ts
  - scripts/arm-event-reminders.ts
  - scripts/check-static-routes.sh
  - scripts/local-env.sh
  - scripts/seed.ts
  - supabase/migrations/20260930123126_notifications.sql
  - supabase/migrations/20260930123133_notifications_drop_event_id.sql
  - supabase/migrations/20260930123213_realtime_authorization.sql
  - supabase/migrations/20260930123214_notifications_functions.sql
  - supabase/migrations/20260930141455_notifications_retract_prune.sql
  - supabase/migrations/20260930142350_notifications_prune_index.sql
  - supabase/migrations/20260930142352_notifications_prune.sql
  - supabase/migrations/20260930180214_push_subscriptions.sql
  - supabase/migrations/20260930180227_push_subscriptions_functions.sql
  - supabase/migrations/20260930190151_chat.sql
  - supabase/migrations/20260930190229_chat_functions.sql
  - supabase/migrations/meta/20260930123126_snapshot.json
  - supabase/migrations/meta/20260930123133_snapshot.json
  - supabase/migrations/meta/20260930123213_snapshot.json
  - supabase/migrations/meta/20260930123214_snapshot.json
  - supabase/migrations/meta/20260930141455_snapshot.json
  - supabase/migrations/meta/20260930142350_snapshot.json
  - supabase/migrations/meta/20260930142352_snapshot.json
  - supabase/migrations/meta/20260930180214_snapshot.json
  - supabase/migrations/meta/20260930180227_snapshot.json
  - supabase/migrations/meta/20260930190151_snapshot.json
  - supabase/migrations/meta/20260930190229_snapshot.json
  - supabase/migrations/meta/_journal.json
  - supabase/tests/010-rls-coverage.sql
  - supabase/tests/020-tenant-isolation.sql
  - supabase/tests/150-realtime-authorization.sql
  - supabase/tests/151-notifications.sql
  - supabase/tests/152-chat.sql
  - supabase/tests/153-push-subscriptions.sql
findings:
  critical: 1
  warning: 7
  info: 6
  total: 14
status: issues_found
---

# Phase 7: Code Review Report, Area A (server / kernel / db)

**Reviewed:** 2026-10-01T00:31:30Z
**Depth:** standard (Phase 7 diff `80ef5b8..HEAD`, with call chains followed into `packages/modules/{notifications,chat}` where a kernel or db file depends on them)
**Files Reviewed:** 91
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The security-definer functions are mostly sound. Every definer pins `search_path = ''`, uses fully
qualified names, revokes from PUBLIC and takes its tenant from `app.tenant_id()` rather than from a
parameter. `app.realtime_topic_allowed` validates the regex and the canonical UUID shape before any
cast and requires a live membership in the topic's tenant. `realtime.messages` has no INSERT
policy. `notifications_prune` is limited to `service_role`. I found no cross-tenant leak in the
definers, and the pgTAP adjacency fixtures cover them.

The weak layer is the **chat RLS policies** in `20260930190151_chat.sql`. All three are `FOR ALL`,
and their `WITH CHECK` clauses do not express what the T-07-50/51/54 mitigations promise. In
particular, `chat_participants_access` lets any member enroll themselves in any conversation of
their tenant. The API does not do this today, but RLS is the layer that is supposed to hold when
the API slips. `app.realtime_topic_allowed` trusts the same participant table, so the gap also
covers the Realtime `conv:` topic.

The other findings are robustness issues:
- one module's counter query can take down the whole bootstrap;
- the counters resolver opens a nested connection inside an open transaction (pool of 5);
- retractions are dropped while the `notifications` module is disabled;
- a same-topic leave/re-join race in `RealtimeProvider`;
- the pgTAP Realtime authorization suite turns into `skip()` when no partition exists;
- a bootstrap contract that needs a manual Vercel promotion to deploy safely.

## Critical Issues

### A-CR-01: `chat_participants_access` lets a member enroll in any conversation of their tenant (RLS, intra-tenant privacy)

**File:** `supabase/migrations/20260930190151_chat.sql:16` (also relied on by `supabase/migrations/20260930123213_realtime_authorization.sql:118-133` and `chat_conversations_access` at line 14)

**Issue:** The policy is `FOR ALL TO authenticated USING / WITH CHECK (tenant_id = app.tenant_id() and (user_id = app.user_id() or app.tenant_role() in ('admin_tenant','support_tenant')))`. Nothing ties the inserted row's `conversation_id` to a conversation the caller may already see. A tenant-lane session opened as member M2 can therefore run:

```sql
insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
values ('<M1''s support conversation>', '<tenant>', '<M2>', 'member');
```

That passes `WITH CHECK`. From then on:
- `chat_conversations_access` admits M2 through its `exists (… chat_participants p … p.user_id = app.user_id())` branch.
- `chat_messages_access` admits M2 to every message of M1's thread, because its `USING` only asks whether the conversation is visible.
- M2 can post into M1's thread, because `WITH CHECK` only requires `author_user_id = app.user_id()` and a visible conversation.
- `app.realtime_topic_allowed` authorizes M2 on `tenant:<t>:conv:<M1's conversation>`.

pgTAP 152 fact 5 asserts that "M2 cannot insert into M1's conversation (42501)". That holds only while M2 has not inserted the participant row first; nothing tests the participant insert. The project's three-layer isolation rule exists for the case where the API is bypassed or has a bug. Today `sendSupportMessage` (`packages/modules/chat/server/service.ts:248`) only ever enrolls `ctx.userId` into the conversation it just created, so this is not reachable through a current route. It is still a hole in the layer that T-07-50/51 cite as their mitigation.

**Fix:** Split the policy per command. Only allow a member to insert a participant row into a support conversation they created; staff keep the role branch. For example:

```sql
drop policy chat_participants_access on public.chat_participants;
create policy chat_participants_select on public.chat_participants for select to authenticated
  using (tenant_id = app.tenant_id()
         and (user_id = app.user_id() or app.tenant_role() in ('admin_tenant','support_tenant')));
create policy chat_participants_insert on public.chat_participants for insert to authenticated
  with check (
    tenant_id = app.tenant_id()
    and (
      app.tenant_role() in ('admin_tenant','support_tenant')
      or (user_id = app.user_id()
          and exists (select 1 from public.chat_conversations c
                       where c.id = conversation_id and c.tenant_id = app.tenant_id()
                         and c.created_by_user_id = app.user_id()))
    ));
create policy chat_participants_update_own on public.chat_participants for update to authenticated
  using (tenant_id = app.tenant_id() and user_id = app.user_id())
  with check (tenant_id = app.tenant_id() and user_id = app.user_id());
-- no member DELETE policy
```

Add a pgTAP 152 negative: M2's lane inserting a participant row into M1's conversation must throw 42501, with M1 enrolling into its own conversation as the positive control. Also consider adding a composite FK `(conversation_id, tenant_id) → chat_conversations(id, tenant_id)` so a participant row can never name another tenant's conversation.

## Warnings

### A-WR-01: `chat_messages_access` / `chat_conversations_access` are `FOR ALL`: members can delete or re-author staff messages and rewind the seq counter

**File:** `supabase/migrations/20260930190151_chat.sql:14-15`

**Issue:** At the RLS layer:
- **Messages:** `chat_messages_access` `USING` only checks tenant and conversation visibility. A member can `DELETE` any message in their thread, including the team's replies. They can also `UPDATE` a staff message's `body` as long as they set `author_user_id` to themselves (`WITH CHECK` is satisfied).
- **Author side:** Nothing ties `author_side` to the caller's role, so a member lane can insert `author_side = 'staff'`. The BEFORE trigger then advances `last_staff_seq` / `staff_last_read_seq` and publishes `chat.unread`.
- **Conversation counters:** `chat_conversations_access` lets the creator `UPDATE` their conversation's `last_seq`, `staff_last_read_seq`, `kind`, and so on. Rewinding `last_seq` makes every later insert collide with `chat_messages_conversation_seq_uq`, which permanently breaks that thread.

None of these is reachable through today's routes. Chat is designed as append-only, and the policies should say so.

**Fix:** Replace the `FOR ALL` policies with per-command ones:
- `chat_messages`: SELECT, plus INSERT with `WITH CHECK (… and author_user_id = app.user_id() and (author_side = 'member' or app.tenant_role() in ('admin_tenant','support_tenant')))`. No UPDATE or DELETE policy for `authenticated`.
- `chat_conversations`: SELECT and INSERT. Counter updates already go through the definer trigger, and the staff read position can move to a narrow definer, so no tenant-lane UPDATE or DELETE policy is needed.

Add pgTAP negatives for each.

### A-WR-02: One module's counter failure aborts the whole bootstrap (every signed-in page)

**File:** `apps/api/src/modules/registry.ts:213-225`; `apps/api/src/routes/me.ts:163-166`

**Issue:** `countersFor` awaits each module's `counters` inside the bootstrap's tenant-lane transaction and does not catch errors. If one contributor throws (a chat query regression, a missing index, a statement timeout), the transaction aborts. `GET /v1/me/bootstrap` then returns 500, and every authenticated page of that tenant fails to render. `packages/core/server/modules/counters.ts:36-37` says "a counter is a hint, never an authority: failing closed to zero is the safe default", but that rule is only applied when no resolver is registered.

**Fix:** Isolate each contributor in a savepoint and fall back to its zeros:

```ts
for (const key of effectiveKeys(flags.keys)) {
  const contribute = MODULE_REGISTRY[key]?.counters;
  if (!contribute) continue;
  try {
    Object.assign(counters, await tx.transaction((sp) => contribute(sp, ctx, permissions)));
  } catch (error) {
    log.warn({ event: 'counters.contributor_failed', key, err: String(error) }, 'counter skipped');
  }
}
```

### A-WR-03: The counters resolver opens a second pooled connection while holding one (pool `max: 5`)

**File:** `apps/api/src/modules/registry.ts:228` (consumed by `packages/modules/notifications/server/push/send-job.ts:124`)

**Issue:** `setCountersResolver(async (tx, ctx) => countersFor(tx, ctx, await moduleFlags.flags(ctx)))` runs inside `withTenantTx(ctx, (tx) => resolveCounters(tx, ctx))`. On a flags-cache miss (30 s TTL, per tenant), `moduleFlags.flags` itself calls `withTenantTx`, so it needs a second connection from `sqlClient` (`max: 5`, `packages/core/db/client.ts:11`) while the outer transaction still holds one. If five worker jobs do this at the same time (push-send badges across tenants, plus fan-outs), every connection is held by an outer transaction waiting for an inner one, and the worker deadlocks until the statement or idle timeouts fire. `me.ts` avoids this by resolving flags before opening its transaction; the resolver seam does not.

**Fix:** Resolve flags before the transaction. For example, change the seam to `resolveCounters(ctx)`, which reads `moduleFlags.flags(ctx)` first and then opens `withTenantTx`. Alternatively, have the push job pass in the flags it already has.

### A-WR-04: Retractions are dropped while `notifications` is disabled, so deleted content's excerpts reappear when it is turned back on

**File:** `apps/api/src/modules/registry.ts:82-91` (composition) with `packages/modules/notifications/server/sink.ts:46`

**Issue:** Retractions (`notificationRetractions`) are routed through the same sink subscription as sources. The sink returns early when `moduleFlags.isEnabled(ctx, 'notifications')` is false. If a tenant turns notifications off, an author or moderator deletes a post, comment or story, and the tenant later turns notifications back on, the old rows still carry the excerpt in `payload`. They show in `/notificacoes`, which violates "A notification must never keep showing, storing or pushing the text of content its author or a moderator took down" (`20260930141455_notifications_retract_prune.sql:7-8`). The 90-day prune is the only thing that eventually removes them.

**Fix:** Do not gate retractions on the module flag. Enqueue the fan-out job for retraction events whatever the flag says (sources stay gated). Alternatively, run `app.notifications_retract` synchronously in a system lane from the bus subscriber when the module is off.

### A-WR-05: `RealtimeProvider` can re-attach a listener to a channel that is still leaving, which silently kills the topic

**File:** `packages/core/ui/realtime/RealtimeProvider.tsx:120-138, 210-247`

**Issue:** When a topic's last listener leaves, `close()` calls `removeChannel(channel)` without awaiting it. That call sends `phx_leave` and only drops the channel from `client.channels` in the leave's `onClose`. If a listener for the same topic joins before the leave completes, `open()` runs `attach()` on the next microtask. `client.channel(topic)` in realtime-js 2.116.0 (`RealtimeClient.js:338-349`) returns the existing leaving channel instead of a new one. `.subscribe()` on a channel that is not closed returns without calling the callback (`RealtimeChannel.js:135-183`). When the leave completes, the channel is torn down, `entry.channel` points at a dead object, and `join()` never reopens it because `entry.channel` is non-null. The member stops receiving signals for that topic until a 60 s hidden-tab cycle.

This is triggered by any same-topic leave followed by a re-join, for example:
- `LiveCountersProvider` re-running its effect because `topics` or `events` changed (all old topics are left, then all new ones, including the shared `all` and `user` topics, are joined);
- `useRealtimeTopic` with a changed `events` list.

**Fix:** Keep the removal promise on a per-topic map and chain any new open after it. Alternatively, defer `close()` by a tick and cancel it if a listener re-joins the same topic before then:

```ts
const removing = new Map<string, Promise<unknown>>();
// close(): removing.set(topic, client.removeChannel(channel).catch(() => {}).finally(() => removing.delete(topic)));
// open():  void Promise.all([authReady.current, removing.get(topic)]).then(() => { … attach … });
```

### A-WR-06: pgTAP Realtime authorization and signal assertions become `skip()` when no partition exists

**File:** `supabase/tests/150-realtime-authorization.sql:185-274`; `supabase/tests/152-chat.sql:390-431` (and the same pattern in 151)

**Issue:** The SELECT-policy facts for `realtime.messages`, the core tenant-isolation proof for Realtime, and the ids-only payload facts run only when `tests.now_partition` is non-empty; otherwise each one is `skip(...)`. A CI stack whose Realtime container has not created partitions yet (a cold start, or the window just after 00:00 UTC before the next daily partition exists) reports green with no Realtime authorization tested. Isolation evidence must not pass vacuously.

**Fix:** Inside the rolled-back test transaction, create the partition the fixture needs as the migration role, for example `create table if not exists realtime.messages_pgtap partition of realtime.messages for values from (now() - interval '1 hour') to (now() + interval '1 hour');`, or attach one covering `now()`. Then drop the `skip()` branches. At minimum, fail instead of skipping when `CI` is set.

### A-WR-07: The bootstrap contract makes `conversationsBadge` required, which turns every deploy order into a manual promotion

**File:** `packages/contracts/src/bootstrap.ts:61-64` (DEPLOY.md "Phase 7 release" step 7)

**Issue:** The web parses the API's bootstrap with `bootstrapSchema`. Adding a required `conversationsBadge` means any web build that goes live before the API revision breaks every signed-in page. Both pipelines start on the same push, and Vercel normally wins. DEPLOY.md works around this with a manual "turn off automatic domain assignment, then promote by hand" procedure. That is fragile: it already happened once (06-01, `deferred-items.md`), and one forgotten step means a full outage. The same applies to any rollback of the API.

**Fix:** Make the new field tolerant on the reader side: `conversationsBadge: z.enum(['dot','count']).catch('count')`, or `.default('count')`. The schema stays the single source, the API still always sends it, and the deploy order stops mattering. Apply the same rule to future additive bootstrap fields.

## Info

### A-IN-01: `notifications_fanout` exclusion is NULL-unsafe

**File:** `supabase/migrations/20260930123214_notifications_functions.sql:71`
**Issue:** `m.user_id <> all(coalesce(p_exclude, '{}'))` evaluates to NULL for every row if `p_exclude` contains a NULL element, so the fan-out silently notifies nobody. `in-app.ts`'s `pgUuidArray` drops non-uuids today, but `push/send-job.ts:34` has an unfiltered twin, and the definer should not rely on its caller for this.
**Fix:** `and not (m.user_id = any(array_remove(coalesce(p_exclude, '{}'::uuid[]), null)))`.

### A-IN-02: `notifications_owner_update` lets the owner rewrite any column

**File:** `supabase/migrations/20260930123126_notifications.sql:16`
**Issue:** At the RLS layer a member may `UPDATE` `payload`, `kind`, `dedupe_key` or `subject_*` on their own rows. For example, they could reverse a retraction by restoring an excerpt, or change a dedupe key so a re-fan-out duplicates. Only `seen_at` and `read_at` are meant to be member-writable.
**Fix:** `revoke update on public.notifications from authenticated; grant update (seen_at, read_at) on public.notifications to authenticated;`

### A-IN-03: `HidingLogoImage` misses an `error` that fires before hydration and never resets on a new `src`

**File:** `packages/core/ui/HidingLogoImage.tsx:19-31`
**Issue:** The component is server-rendered. If the logo fails before React attaches `onError`, the broken-image glyph stays, which is what UI-D-258 forbids. `failed` also survives a `src` change.
**Fix:** In a `useEffect`/ref callback, check `img.complete && img.naturalWidth === 0` on mount (SVGs without intrinsic size report `naturalWidth` > 0 once decoded in modern engines; otherwise, guard on `complete` plus a `decode()` rejection). Key the state on `src`.

### A-IN-04: The chat BEFORE trigger's 23503 reveals whether a conversation exists in the caller's tenant

**File:** `supabase/migrations/20260930190229_chat_functions.sql:68-71`
**Issue:** An insert naming a same-tenant conversation the lane cannot see fails later with 42501 (`WITH CHECK`). An unknown id, or one from another tenant, fails with 23503 from the definer. The two codes distinguish the cases. The ids are random UUIDs and the API masks both, so the impact is negligible.
**Fix:** Raise the same SQLSTATE in both cases, or have the API map both to 404.

### A-IN-05: `chat.test.ts` `sweep()` deletes every chat conversation of both seed tenants

**File:** `apps/api/tests/integration/chat.test.ts:171-175, 659`
**Issue:** Running the suite on a developer's stack destroys any manual UAT conversations in rede-demo and rede-lab, not only the fixtures. The memory notes already record manual UAT rows clashing with suite counts.
**Fix:** Scope the sweep to the seeded conversation id and to conversations created by the throwaway users.

### A-IN-06: `assertProductionEnv` does not check the VAPID pair

**File:** `packages/core/server/env.ts:173-183`
**Issue:** Swapped or mismatched public and private keys boot cleanly, and then every send fails with 401/403 and is counted as `failed`, never `gone`, so subscriptions are never cleaned up. Nothing checks that Vercel's `NEXT_PUBLIC_VAPID_PUBLIC_KEY` equals the API's `VAPID_PUBLIC_KEY`.
**Fix:** At boot, check that both keys decode as base64url to 65 and 32 bytes, and that the public key derives from the private one (`crypto.createECDH('prime256v1').setPrivateKey(...).getPublicKey()`). Also expose the public key on `/health/deep`, so the release checklist can compare it with Vercel's value.

---

_Reviewed: 2026-10-01T00:31:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
