import { cutOnWord } from '@rede-social/contracts/text';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import {
  CASE_ACTIVE_STATES,
  type CaseCard,
  type CaseEvent,
  type CaseHistory,
  CHAT_CASE_ACTIONS,
  CHAT_EARLIER_CASES_MAX,
  CHAT_PERMISSIONS,
  CHAT_PREVIEW_GRAPHEMES,
  CHAT_SUBJECT_MAX,
  type ChatCaseAction,
  type ChatCaseCategory,
  type ChatCasePriority,
  type ChatCaseState,
  type ChatSide,
  type InboxRow,
  type MemberCase,
  type MyCasesPage,
  type MyCasesQuery,
  type StaffCase,
  type StaffRoster,
} from '../contracts/index';

/**
 * The member's side of a support case (Phase 12.4, plan 06): the subject label rule, the member-shaped case read
 * and the "Meus chamados" page. A PURE TENANT-LANE area like `service.ts`: every statement pins the tenant and the
 * caller, and a case is looked up by its conversation id, NEVER by its number (D-804). No statement here selects the
 * priority, the owner, an event or any staff id: what a member reads is exactly `memberCaseSchema` (UI-D-835,
 * T-12.4-27).
 */

/** The `listNotifications` rule: microsecond ISO instants produced by Postgres, never a JS `Date` round trip. */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * The active-state list spelled from the SAME contract constant `service.ts` builds its `on conflict` arbiter from.
 * `service.ts` keeps its own copy because a test reads that file's text (EP-013); both derive from one tuple.
 */
const ACTIVE_STATES = sql.raw(CASE_ACTIVE_STATES.map((state) => `'${state}'`).join(','));

/**
 * The text a case is SHOWN by (D-839, EP-032, EP-033): the typed subject when the member typed one, else the first
 * message of the case, one line (every whitespace run collapsed) and cut on a word at `CHAT_SUBJECT_MAX` graphemes with
 * the ellipsis only when it cut. A case with neither is the empty string: the web owns the placeholder copy. The
 * typed subject is already at most `CHAT_SUBJECT_MAX` code points, so it is never cut, only put on one line.
 */
export function subjectLabelOf(subject: string | null, firstBody: string | null): string {
  const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
  const typed = subject === null ? '' : oneLine(subject);
  if (typed !== '') return typed;
  return cutOnWord(oneLine(firstBody ?? ''), CHAT_SUBJECT_MAX);
}

type MemberCaseDbRow = {
  id: string;
  case_number: number;
  state: ChatCaseState;
  subject: string | null;
  category: ChatCaseCategory;
  opened_at: string;
  first_body: string | null;
};

const toMemberCase = (row: MemberCaseDbRow): MemberCase => ({
  id: row.id,
  number: Number(row.case_number),
  state: row.state,
  subject: row.subject,
  subjectLabel: subjectLabelOf(row.subject, row.first_body),
  category: row.category,
  openedAt: row.opened_at,
});

/** The first (lowest `seq`) message of a case that is still visible: the fallback of the subject label. */
export const firstMessageJoin = sql`
        left join lateral (
          select m.body
            from chat_messages m
           where m.tenant_id = c.tenant_id
             and m.conversation_id = c.id
             and m.deleted_at is null
           order by m.seq asc
           limit 1
        ) fm on true`;

/**
 * The member-shaped case of ONE conversation, or null when it is not a support case of this caller (another member's,
 * another tenant's, a non-support conversation, an unknown id). One tenant-pinned select: id, number, state, subject,
 * category, the creation instant and the first message for the label. No priority, owner or event is selected.
 */
export async function memberCaseOf(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
): Promise<MemberCase | null> {
  const rows = await tx.execute<MemberCaseDbRow>(sql`
    select c.id,
           c.case_number::int as case_number,
           c.state,
           c.subject,
           c.category,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as opened_at,
           fm.body as first_body
      from chat_conversations c
      ${firstMessageJoin}
     where c.id = ${conversationId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.kind = 'support'
       and c.created_by_user_id = ${ctx.userId}::uuid
       and c.state is not null
       and c.case_number is not null`);
  const row = rows[0];
  return row ? toMemberCase(row) : null;
}

/** The member's ACTIVE case as a member-shaped case, or null: what `GET /support` answers in `case`. */
export async function activeMemberCase(tx: Tx, ctx: RequestContext): Promise<MemberCase | null> {
  const rows = await tx.execute<MemberCaseDbRow>(sql`
    select c.id,
           c.case_number::int as case_number,
           c.state,
           c.subject,
           c.category,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as opened_at,
           fm.body as first_body
      from chat_conversations c
      ${firstMessageJoin}
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.kind = 'support'
       and c.created_by_user_id = ${ctx.userId}::uuid
       and c.state in (${ACTIVE_STATES})
     order by c.case_number desc nulls last
     limit 1`);
  const row = rows[0];
  return row ? toMemberCase(row) : null;
}

/** Whether the member ever opened a case, in any state (`hasAnyCase`). */
export async function hasAnyCaseOf(tx: Tx, ctx: RequestContext): Promise<boolean> {
  const rows = await tx.execute<{ any_case: boolean }>(sql`
    select exists (
             select 1
               from chat_conversations c
              where c.tenant_id = ${ctx.tenantId}::uuid
                and c.kind = 'support'
                and c.created_by_user_id = ${ctx.userId}::uuid
           ) as any_case`);
  return rows[0]?.any_case === true;
}

/**
 * A "Meus chamados" cursor's `n` is the case NUMBER as a string of digits (EP-049). It is re-checked here, before any
 * cast, so a tampered cursor degrades to page 1 and never reaches SQL as anything but a bounded integer (T-12.4-29).
 * Nine digits at most: the number is an `integer` column and the cursor only ever carries a number this service issued.
 */
const CURSOR_NUMBER = /^[1-9]\d{0,8}$/;

function decodeNumberCursor(raw: string | undefined): { n: number; id: string } | null {
  const decoded = decodeCursor(raw);
  if (!decoded || !CURSOR_NUMBER.test(decoded.n)) return null;
  return { n: Number(decoded.n), id: decoded.id };
}

type CardDbRow = MemberCaseDbRow & {
  lm_body: string | null;
  lm_side: ChatSide | null;
  last_message_at: string | null;
};

const toCard = (row: CardDbRow): CaseCard => ({
  ...toMemberCase(row),
  lastMessage:
    row.lm_side === null
      ? null
      : { preview: cutOnWord(row.lm_body ?? '', CHAT_PREVIEW_GRAPHEMES), side: row.lm_side },
  lastMessageAt: row.last_message_at,
});

/** The card columns shared by the active and the closed statements (the latest message like `listInbox`'s). */
const cardColumns = sql`
           c.id,
           c.case_number::int as case_number,
           c.state,
           c.subject,
           c.category,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as opened_at,
           fm.body as first_body,
           lm.body as lm_body,
           lm.author_side as lm_side,
           to_char(c.last_message_at at time zone 'utc', ${ISO_MICROSECONDS}) as last_message_at`;

const lastMessageJoin = sql`
        left join lateral (
          select m.body, m.author_side
            from chat_messages m
           where m.tenant_id = c.tenant_id
             and m.conversation_id = c.id
             and m.deleted_at is null
           order by m.seq desc
           limit 1
        ) lm on true`;

/**
 * `GET /v1/chat/support/cases?cursor=&limit=` (D-803, CASE-14): the member's own cases and nobody else's.
 * `current` is the ACTIVE case (null when none), `items` the CLOSED cases newest first (`case_number desc, id desc`,
 * keyset over the pair so a `limit=1` walk visits each once), `total` the count of closed cases. Three tenant-pinned
 * statements in one transaction; over-fetch by one decides `nextCursor`. A GET: nothing is created or touched.
 */
export async function getMyCases(ctx: RequestContext, query: MyCasesQuery): Promise<MyCasesPage> {
  const limit = query.limit;
  const after = decodeNumberCursor(query.cursor);
  const afterNumber = after?.n ?? null;
  const afterId = after?.id ?? null;
  return withTenantTx(ctx, async (tx) => {
    const active = await tx.execute<CardDbRow>(sql`
      select ${cardColumns}
        from chat_conversations c
        ${firstMessageJoin}
        ${lastMessageJoin}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.created_by_user_id = ${ctx.userId}::uuid
         and c.state in (${ACTIVE_STATES})
       order by c.case_number desc nulls last
       limit 1`);
    const closed = await tx.execute<CardDbRow>(sql`
      select ${cardColumns}
        from chat_conversations c
        ${firstMessageJoin}
        ${lastMessageJoin}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.created_by_user_id = ${ctx.userId}::uuid
         and c.state = 'closed'
         and (
           ${afterNumber}::int is null
           or (c.case_number, c.id) < (${afterNumber}::int, ${afterId}::uuid)
         )
       order by c.case_number desc, c.id desc
       limit ${limit + 1}`);
    const counted = await tx.execute<{ total: number }>(sql`
      select count(*)::int as total
        from chat_conversations c
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.created_by_user_id = ${ctx.userId}::uuid
         and c.state = 'closed'`);
    const page = closed.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      closed.length > limit && last
        ? encodeCursor({ n: String(last.case_number), id: last.id })
        : null;
    const current = active[0];
    return {
      current: current ? toCard(current) : null,
      items: page.map(toCard),
      total: Number(counted[0]?.total ?? 0),
      nextCursor,
    };
  });
}

/* ── Phase 12.4, plan 07: the team's side of the case read API ───────────────────────────────────── */

/**
 * The staff roles of the tenant, spelled as the SQL literal the definers and the policies spell (RESEARCH Pitfall 4;
 * `chat.test.ts` compares the lists). Only an owner, an assignee or a roster entry is judged by it, and always inside
 * the same statement that pins the tenant.
 */
const STAFF_ROLES = sql.raw(`'admin_tenant', 'support_tenant'`);

/**
 * The owner of a case as a LIVE staff member (D-843): an active, unblocked, undeleted membership of this tenant with a
 * staff role. An owner who left the staff matches no row, so `owner_name` is null (the screens say "Sem responsavel")
 * while `owner_user_id` still carries the stored id. Alias `c` is the conversation.
 */
export const ownerJoins = sql`
        left join memberships oms
               on oms.tenant_id = c.tenant_id
              and oms.user_id = c.owner_user_id
              and oms.deleted_at is null
              and oms.blocked_at is null
              and oms.status = 'active'
              and oms.role in (${STAFF_ROLES})
        left join member_profiles omp on omp.membership_id = oms.id`;

/**
 * The list of legal actions of a case for ONE viewer, decided here and drawn as-is by the screens (D-842, D-806, UI-D-826).
 * It reads the viewer's composed PERMISSIONS, never a role literal, and a closed case lists none of the mutating actions.
 * The answer keeps the order of `CHAT_CASE_ACTIONS`. The definers re-enforce every pair (plan 03), so this list is a
 * convenience for the UI and never the only guard.
 */
export function actionsFor(
  row: { state: ChatCaseState; ownerUserId: string | null },
  viewer: { userId: string; permissions: readonly string[] },
): ChatCaseAction[] {
  const active = row.state === 'open' || row.state === 'in_progress';
  const allowed: Record<ChatCaseAction, boolean> = {
    take:
      row.state === 'open' || (row.state === 'in_progress' && row.ownerUserId !== viewer.userId),
    assign: active && viewer.permissions.includes(CHAT_PERMISSIONS.assign),
    resolve: active,
    close: row.state !== 'closed',
    reopen: row.state === 'resolved',
    edit: row.state !== 'closed',
  };
  return CHAT_CASE_ACTIONS.filter((action) => allowed[action]);
}

type StaffCaseDbRow = MemberCaseDbRow & {
  priority: ChatCasePriority | null;
  owner_user_id: string | null;
  owner_name: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

/** The inbox row's case facts (the owner is a name, never an id), from the columns both statements select. */
export function toInboxCase(row: {
  case_number: number | null;
  state: ChatCaseState | null;
  subject: string | null;
  first_body: string | null;
  category: ChatCaseCategory | null;
  priority: ChatCasePriority | null;
  owner_name: string | null;
  owner_is_viewer: boolean;
}): NonNullable<InboxRow['case']> | null {
  if (row.case_number === null || row.state === null || row.category === null) return null;
  return {
    number: Number(row.case_number),
    state: row.state,
    subjectLabel: subjectLabelOf(row.subject, row.first_body),
    category: row.category,
    priority: row.priority ?? 'normal',
    ownerName: row.owner_name,
    ownerIsViewer: row.owner_is_viewer,
  };
}

/**
 * The case of ONE support conversation as the TEAM reads it, with the list of legal actions for this viewer, or null
 * when it is not a numbered support case of this tenant. One tenant-pinned select (D-842).
 */
export async function staffCaseOf(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  permissions: readonly string[],
): Promise<StaffCase | null> {
  const rows = await tx.execute<StaffCaseDbRow>(sql`
    select c.id,
           c.case_number::int as case_number,
           c.state,
           c.subject,
           c.category,
           c.priority,
           c.owner_user_id::text as owner_user_id,
           omp.display_name as owner_name,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as opened_at,
           to_char(c.resolved_at at time zone 'utc', ${ISO_MICROSECONDS}) as resolved_at,
           to_char(c.closed_at at time zone 'utc', ${ISO_MICROSECONDS}) as closed_at,
           fm.body as first_body
      from chat_conversations c
      ${firstMessageJoin}
      ${ownerJoins}
     where c.id = ${conversationId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.kind = 'support'
       and c.state is not null
       and c.case_number is not null`);
  const row = rows[0];
  if (!row) return null;
  const member = toMemberCase(row);
  return {
    ...member,
    priority: row.priority ?? 'normal',
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerIsViewer: row.owner_user_id !== null && row.owner_user_id === ctx.userId,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    actions: actionsFor(
      { state: member.state, ownerUserId: row.owner_user_id },
      { userId: ctx.userId, permissions },
    ),
  };
}

type EventDbRow = {
  kind: CaseEvent['kind'];
  at: string;
  actor_name: string | null;
  target_name: string | null;
  from_state: ChatCaseState | null;
  to_state: ChatCaseState | null;
  field: NonNullable<CaseEvent['field']> | null;
  from_value: string | null;
  to_value: string | null;
};

/** A history row as the schema states it: an absent value is an ABSENT key, and `from`/`to` exist for an edit only. */
const toCaseEvent = (row: EventDbRow): CaseEvent => ({
  kind: row.kind,
  at: row.at,
  ...(row.actor_name !== null ? { actorName: row.actor_name } : {}),
  ...(row.target_name !== null ? { targetName: row.target_name } : {}),
  ...(row.from_state !== null ? { fromState: row.from_state } : {}),
  ...(row.to_state !== null ? { toState: row.to_state } : {}),
  ...(row.field !== null ? { field: row.field } : {}),
  ...(row.kind === 'edited' ? { from: row.from_value, to: row.to_value } : {}),
});

type EarlierDbRow = {
  id: string;
  case_number: number;
  state: ChatCaseState;
  subject: string | null;
  opened_at: string;
  first_body: string | null;
};

/**
 * `GET /v1/chat/conversations/{id}/case/history` (D-810, CASE-12): the events of one case oldest first by
 * `(created_at, id)` with the actor's and the target's display name, then at most `CHAT_EARLIER_CASES_MAX` earlier cases
 * of the SAME member (a case number below the current one, newest first) and `hasMoreEarlier` from a sixth-row probe.
 * An actor or target who left the tenant has no name (the key is absent, never an id). An id that is not a numbered
 * support case of the caller's tenant is one bare 404. A GET: nothing is written or marked read.
 */
export async function getCaseHistory(
  ctx: RequestContext,
  conversationId: string,
): Promise<CaseHistory> {
  return withTenantTx(ctx, async (tx) => {
    const current = await tx.execute<{ created_by_user_id: string; case_number: number }>(sql`
      select c.created_by_user_id::text as created_by_user_id, c.case_number::int as case_number
        from chat_conversations c
       where c.id = ${conversationId}::uuid
         and c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.case_number is not null`);
    const head = current[0];
    if (!head) throw new ApiError(404, 'NOT_FOUND');

    const events = await tx.execute<EventDbRow>(sql`
      select e.kind,
             to_char(e.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as at,
             amp.display_name as actor_name,
             tmp.display_name as target_name,
             e.from_state,
             e.to_state,
             e.field,
             e.from_value,
             e.to_value
        from chat_case_events e
        left join memberships ams
               on ams.tenant_id = e.tenant_id
              and ams.user_id = e.actor_user_id
              and ams.deleted_at is null
        left join member_profiles amp on amp.membership_id = ams.id
        left join memberships tms
               on tms.tenant_id = e.tenant_id
              and tms.user_id = e.target_user_id
              and tms.deleted_at is null
        left join member_profiles tmp on tmp.membership_id = tms.id
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.conversation_id = ${conversationId}::uuid
       order by e.created_at asc, e.id asc`);

    const earlier = await tx.execute<EarlierDbRow>(sql`
      select c.id,
             c.case_number::int as case_number,
             c.state,
             c.subject,
             to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as opened_at,
             fm.body as first_body
        from chat_conversations c
        ${firstMessageJoin}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.created_by_user_id = ${head.created_by_user_id}::uuid
         and c.case_number < ${head.case_number}::int
         and c.state is not null
       order by c.case_number desc, c.id desc
       limit ${CHAT_EARLIER_CASES_MAX + 1}`);

    return {
      events: events.map(toCaseEvent),
      earlierCases: earlier.slice(0, CHAT_EARLIER_CASES_MAX).map((row) => ({
        id: row.id,
        number: Number(row.case_number),
        state: row.state,
        subjectLabel: subjectLabelOf(row.subject, row.first_body),
        openedAt: row.opened_at,
      })),
      hasMoreEarlier: earlier.length > CHAT_EARLIER_CASES_MAX,
    };
  });
}

/**
 * `GET /v1/chat/staff` (D-806): the live team of this tenant, names only: active, unblocked, undeleted members with a
 * staff role, sorted by name then id. It is the one list behind the owner filter and the assign sheet; no email, role or
 * any other field leaves here.
 */
export async function getStaffRoster(ctx: RequestContext): Promise<StaffRoster> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<{ user_id: string; name: string }>(sql`
      select ms.user_id::text as user_id,
             coalesce(mp.display_name, '') as name
        from memberships ms
        left join member_profiles mp on mp.membership_id = ms.id
       where ms.tenant_id = ${ctx.tenantId}::uuid
         and ms.role in (${STAFF_ROLES})
         and ms.status = 'active'
         and ms.blocked_at is null
         and ms.deleted_at is null
       order by name asc, ms.user_id asc`),
  );
  return { items: rows.map((row) => ({ userId: row.user_id, name: row.name })) };
}
