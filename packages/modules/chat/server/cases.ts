import { cutOnWord } from '@rede-social/contracts/text';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { sql } from 'drizzle-orm';
import {
  CASE_ACTIVE_STATES,
  CHAT_SUBJECT_MAX,
  type ChatCaseCategory,
  type ChatCaseState,
  type MemberCase,
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
const firstMessageJoin = sql`
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
