import type { ProfileFormType } from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { recordModerationAction } from '../moderation/log';
import { answerText, CSV_BOM, csvCell, csvRow, type ExportQuestion } from './csv';
import { liveModuleOn } from './member';
import { questionVisibleSql } from './visibility-sql';

const log = moduleLogger('profile-form-export');

/**
 * The export of the members' answers (Phase 12, D-595; PFORM-08 route half, PFORM-21). The ONE door through
 * which a member's answer leaves the app, so it is logged, never cached and admin-only (the route guard).
 *
 * ORDER OF WORK (T-12-26, repudiation). (1) In ONE tenant transaction: the live module re-check, the
 * `profile_form_exported` row of the moderation log (the exporting admin is actor AND target, no subject, no
 * details) and the header's questions. The transaction ENDS here, so the audit row is COMMITTED before the
 * first byte of the file exists: a mid-stream failure cannot roll it back, and the dialog's "fica registrado"
 * stays true. (2) Only then is the stream built; nothing in the stream touches the log again.
 *
 * WHY THE ADMIN LANE (and only for the page reads). The e-mail lives in `users`, which is self-select only in
 * the tenant lane, exactly the reason `listMembersForAdmin` reads there. RLS is therefore OFF for the page
 * statements: **the `m.tenant_id = ${ctx.tenantId}` and `a.tenant_id = ${ctx.tenantId}` predicates on every
 * statement are the only isolation** (T-12-25). `ctx.tenantId` is the membership of record from
 * `requireAuth`, never input; WHO may call is the route's `requirePermission('profile_form.manage')`.
 *
 * CLOSED BRANCHES (review WR-03). A cell is written only for a question the member SEES: one whose branch chain
 * is closed for her carries no cell, whatever an old row still holds (the shared `questionVisibleSql` fragment,
 * a second layer beside the purge that runs when she saves). Archived questions keep their cells.
 *
 * ROW SET (assumption A-12-02, planner decision (b), Igor to confirm at UAT): every live `member`-role
 * membership of the tenant, `active` AND `blocked`; invited memberships, staff and soft-deleted memberships
 * are left out. Rows are keyset-paged by membership id, so the order is total and two exports of unchanged
 * data are byte-identical (except the file date).
 *
 * MEMORY. The file is a pull-based `ReadableStream`: one page of `pageSize` memberships (default 500) is read
 * and encoded per pull, so memory is bounded by a page and a slow client applies backpressure.
 *
 * NOTHING HERE LOGS a name, an e-mail, a title or an answer: ids and counts only.
 */

export const EXPORT_PAGE_SIZE = 500;
const FALLBACK_TIME_ZONE = 'America/Sao_Paulo';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role' | 'requestId'>;

type QuestionRow = {
  id: string;
  type: ProfileFormType;
  title: string;
  options: { id: string; label: string }[];
};

/** Drizzle's postgres-js client may hand a jsonb column back as text; normalise either form. */
function asJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

type PageRow = {
  membership_id: string;
  display_name: string | null;
  email: string;
  answers: Record<string, unknown>;
};

export type ExportedFile = {
  /** `respostas-perfil-AAAA-MM-DD.csv`, the date in the tenant's time zone. */
  fileName: string;
  /** The CSV bytes: the BOM, the header and one record per member, streamed page by page. */
  body: ReadableStream<Uint8Array>;
};

/** Step 1: audit row, file date and header questions, in one tenant transaction that commits on return. */
async function recordAndReadHeader(ctx: Ctx): Promise<{ day: string; questions: QuestionRow[] }> {
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) throw new ApiError(404, 'MODULE_DISABLED');

    const own = await tx.execute<{ id: string }>(sql`
      select id::text as id from memberships
       where tenant_id = ${ctx.tenantId}::uuid and user_id = ${ctx.userId}::uuid
         and deleted_at is null
       limit 1`);
    const actorMembershipId = own[0]?.id;
    if (!actorMembershipId) throw new ApiError(403, 'FORBIDDEN');

    // The audit row FIRST: if it cannot be written, no question is read and no file exists.
    await recordModerationAction(tx, ctx, { action: 'profile_form_exported', actorMembershipId });

    const dayRows = await tx.execute<{ day: string }>(sql`
      select to_char(
               now() at time zone coalesce(
                 (select z.name from pg_catalog.pg_timezone_names z where z.name = t.timezone),
                 ${FALLBACK_TIME_ZONE}),
               'YYYY-MM-DD') as day
        from tenants t
       where t.id = ${ctx.tenantId}::uuid`);

    // Active questions in the admin's order, then the archived ones by `archived_at` (their answers stay).
    const questions = await tx.execute<QuestionRow>(sql`
      select q.id::text as id, q.type, q.title, q.options
        from profile_form_questions q
       where q.tenant_id = ${ctx.tenantId}::uuid
       order by (q.archived_at is not null),
                case when q.archived_at is null then q.position end,
                case when q.archived_at is null then q.created_at end,
                q.archived_at,
                q.id`);

    return {
      day: dayRows[0]?.day ?? new Date().toISOString().slice(0, 10),
      questions: [...questions],
    };
  });
}

const answers = (row: PageRow): Record<string, unknown> =>
  asJson<Record<string, unknown>>(row.answers, {});

/** One page of members after `after`, in membership-id order, with every answer of each member. */
async function readPage(
  ctx: Pick<Ctx, 'tenantId'>,
  after: string | null,
  pageSize: number,
): Promise<PageRow[]> {
  const rows = await withAdminTx({ tenantId: ctx.tenantId }, (tx) =>
    tx.execute<PageRow>(sql`
      select m.id::text as membership_id,
             nullif(mp.display_name, '') as display_name,
             u.email,
             coalesce(
               (select jsonb_object_agg(a.question_id::text, a.value)
                  from profile_form_answers a
                  join profile_form_questions q
                    on q.tenant_id = a.tenant_id and q.id = a.question_id
                 where a.tenant_id = ${ctx.tenantId}::uuid and a.membership_id = m.id
                   and ${sql.raw(
                     questionVisibleSql({ question: 'q', tenant: 'a.tenant_id', member: 'm.id' }),
                   )}),
               '{}'::jsonb) as answers
        from memberships m
        join users u on u.id = m.user_id
        left join member_profiles mp
               on mp.membership_id = m.id and mp.tenant_id = ${ctx.tenantId}::uuid
       where m.tenant_id = ${ctx.tenantId}::uuid
         and m.role = 'member'
         and m.deleted_at is null
         and m.status in ('active', 'blocked')
         and (${after}::uuid is null or m.id > ${after}::uuid)
       order by m.id
       limit ${pageSize}`),
  );
  return [...rows];
}

/**
 * The profile-form answers of the caller's tenant as a CSV stream. Throws before any byte exists when the
 * caller is not `admin_tenant` (403), the module is off (404) or the audit row cannot be written; the returned stream is the file.
 */
export async function exportAnswers(
  ctx: Ctx,
  opts: { pageSize?: number } = {},
): Promise<ExportedFile> {
  // Defense in depth (WR-01): the page reads run with RLS off and the audit insert accepts any role, so the
  // route guard is not the only door. Refuse before the first read or log row, as `saveAnswers` does for staff.
  if (ctx.role !== 'admin_tenant') throw new ApiError(403, 'FORBIDDEN');
  const pageSize = Math.max(1, Math.floor(opts.pageSize ?? EXPORT_PAGE_SIZE));
  const { day, questions } = await recordAndReadHeader(ctx);

  const shapes: ExportQuestion[] = questions.map((question) => ({
    type: question.type,
    options: asJson<ExportQuestion['options']>(question.options, []),
  }));
  const encoder = new TextEncoder();
  let started = false;
  let after: string | null = null;
  let members = 0;
  let pages = 0;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          const header = csvRow([
            csvCell('Nome'),
            csvCell('E-mail'),
            ...questions.map((question) => csvCell(question.title)),
          ]);
          controller.enqueue(encoder.encode(CSV_BOM + header));
          return;
        }
        const page = await readPage(ctx, after, pageSize);
        pages += 1;
        members += page.length;
        let chunk = '';
        for (const row of page) {
          chunk += csvRow([
            csvCell(row.display_name ?? ''),
            csvCell(row.email),
            ...questions.map((question, index) => {
              const cell = answerText(
                shapes[index] as ExportQuestion,
                answers(row)[question.id] ?? null,
              );
              return csvCell(cell.text, { numeric: cell.numeric });
            }),
          ]);
        }
        if (chunk !== '') controller.enqueue(encoder.encode(chunk));
        const last = page[page.length - 1];
        after = last ? last.membership_id : after;
        if (page.length < pageSize) {
          // Ids and counts only: never a cell.
          log.info(
            {
              event: 'profile_form.exported',
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              requestId: ctx.requestId,
              members,
              pages,
              questions: questions.length,
            },
            'profile form answers exported',
          );
          controller.close();
        }
      } catch (error) {
        log.error(
          {
            event: 'profile_form.export_failed',
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            requestId: ctx.requestId,
            members,
            pages,
          },
          'profile form export failed after the audit row was committed',
        );
        controller.error(error);
      }
    },
  });

  return { fileName: `respostas-perfil-${day}.csv`, body };
}
