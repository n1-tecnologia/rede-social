import { cutOnWord } from '@rede-social/contracts/text';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import {
  CASE_ACTIVE_STATES,
  type CaseCard,
  CHAT_PREVIEW_GRAPHEMES,
  CHAT_SUBJECT_MAX,
  type ChatCaseCategory,
  type ChatCasePriority,
  type ChatCaseState,
  type ChatSide,
  type InboxRow,
  type MemberCase,
  type MyCasesPage,
  type MyCasesQuery,
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
