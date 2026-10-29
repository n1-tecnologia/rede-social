import { createHash } from 'node:crypto';
import {
  answerEtag,
  type DismissNoticeResult,
  type MemberForm,
  type MemberQuestion,
  missingIssue,
  PROFILE_FORM_LIMITS,
  type ProfileFormBootstrap,
  type ProfileFormIssue,
  type ProfileFormMode,
  type ProfileFormQuestionDef,
  type ProfileFormType,
  parseAnswer,
  type SaveAnswersBody,
  type SaveAnswersResult,
} from '@rede-social/contracts/profile-form';
import { and, eq, sql } from 'drizzle-orm';
import { memberships, tenantModules } from '../../db/schema';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { membershipOfRecord } from '../tenancy/membership-scope';

/**
 * The member side of the profile form that the kernel owns (Phase 12-05 and 12-06). Pure tenant lane: every
 * statement runs in the caller's own transaction under RLS, with an explicit `tenant_id` / `membership_id`
 * predicate beside it (layer 2 of the three-layer scoping).
 *
 * The module key is a literal on purpose: the kernel never imports a module package. These are KERNEL routes
 * with no `requireModule` (UI-SPEC "Nothing to answer"): a module switched off meanwhile makes the read
 * `mode: 'none'` and the save a 200 no-op, never a 404.
 *
 * NOTHING HERE LOGS, and no thrown message carries a value: an answer is member content (T-12-15). Errors carry
 * closed issue codes keyed by question id and nothing else.
 */
const MODULE_KEY = 'profile_form';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/**
 * Whether the tenant's `profile_form` module is on RIGHT NOW: a live read of the `tenant_modules` row in
 * the given transaction, never the 30-second flags cache. The gate (`app.profile_form_missing`) reads the
 * same row live, so a bootstrap built from this answer and a gate that refuses cannot disagree (RESEARCH
 * Pitfall 1: a member would otherwise ping-pong between a refusal and an empty form). A missing row reads
 * as off.
 */
export async function liveModuleOn(tx: Tx, ctx: Pick<Ctx, 'tenantId'>): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: tenantModules.enabled })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, ctx.tenantId), eq(tenantModules.moduleKey, MODULE_KEY)))
    .limit(1);
  return row?.enabled === true;
}

/** A non-negative integer count from a SQL result; anything else is a broken invariant, not "zero". */
function count(value: unknown, what: string): number {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} returned an unexpected count`);
  return n;
}

/** `app.profile_form_missing_self()`: the SAME SQL rule the gate runs, derived from the session claims. */
async function missingSelf(tx: Tx): Promise<number> {
  const rows = await tx.execute<{ missing: number | string }>(
    sql`select app.profile_form_missing_self() as missing`,
  );
  return count(rows[0]?.missing ?? 0, 'profile_form_missing_self');
}

/**
 * The ACTIVE OPTIONAL questions listed after the member's "Agora não" instant (all of them while it is null)
 * that she has not answered. Counts only: no title or value is read.
 */
async function newOptionalCount(tx: Tx, ctx: Ctx): Promise<number> {
  const fresh = await tx.execute<{ fresh: number | string }>(sql`
    select count(*)::int as fresh
      from public.profile_form_questions q
     where q.tenant_id = ${ctx.tenantId}::uuid
       and q.archived_at is null
       and q.required = false
       and q.listed_at > coalesce(
             (select p.profile_form_notice_dismissed_at
                from public.member_profiles p
                join public.memberships m on m.id = p.membership_id
               where m.tenant_id = ${ctx.tenantId}::uuid
                 and m.user_id = ${ctx.userId}::uuid
                 and m.deleted_at is null
               limit 1),
             '-infinity'::timestamptz)
       and not exists (
             select 1
               from public.profile_form_answers a
               join public.memberships m on m.id = a.membership_id
              where a.tenant_id = q.tenant_id
                and a.question_id = q.id
                and m.tenant_id = ${ctx.tenantId}::uuid
                and m.user_id = ${ctx.userId}::uuid
                and m.deleted_at is null)`);
  return count(fresh[0]?.fresh ?? 0, 'profile form optional count');
}

/**
 * `GET /v1/me/bootstrap`'s `profileForm` block (PFORM-12, D-584, D-585, D-586): `undefined` when the role is
 * not `member` or the module is off; otherwise
 *   - `pendingRequired`: `app.profile_form_missing_self()`, the SAME SQL rule the gate runs;
 *   - `newOptional`: see `newOptionalCount`.
 */
export async function bootstrapBlock(tx: Tx, ctx: Ctx): Promise<ProfileFormBootstrap | undefined> {
  if (ctx.role !== 'member') return undefined;
  if (!(await liveModuleOn(tx, ctx))) return undefined;
  const pendingRequired = await missingSelf(tx);
  const newOptional = await newOptionalCount(tx, ctx);
  return { pendingRequired, newOptional };
}

// ── The member's read and save (12-06) ──────────────────────────────────────────────────────────────

/** One active question as the database stores it, in the admin's order. */
type QuestionRow = {
  id: string;
  type: ProfileFormType;
  title: string;
  help_text: string | null;
  required: boolean;
  show_on_profile: boolean;
  allow_other: boolean;
  options: { id: string; label: string }[];
  limits: { min?: number | string; max?: number | string };
  position: number;
  revision: number;
};

const toDef = (row: QuestionRow): ProfileFormQuestionDef => ({
  id: row.id,
  type: row.type,
  required: row.required,
  allowOther: row.allow_other,
  options: row.options,
  limits: row.limits,
});

/**
 * The plain read of the active questions: the member form, in the order `position, created_at, id` (the same
 * canonical order the lock below uses). RLS limits the rows to the caller's tenant; the explicit predicate is
 * layer 2.
 */
async function readActiveQuestions(tx: Tx, ctx: Ctx): Promise<QuestionRow[]> {
  const rows = await tx.execute<QuestionRow>(sql`
    select q.id::text as id, q.type, q.title, q.help_text, q.required, q.show_on_profile,
           q.allow_other, q.options, q.limits, q.position, q.revision
      from public.profile_form_questions q
     where q.tenant_id = ${ctx.tenantId}::uuid
       and q.archived_at is null
     order by q.position, q.created_at, q.id`);
  return [...rows];
}

/**
 * The same rows, locked `FOR SHARE` in the same canonical order (PFORM-24 member half, T-12-16). A member
 * cannot lock them herself: `FOR SHARE` applies the UPDATE policy, which only an admin passes, so from her
 * session it would lock and return nothing. `app.profile_form_lock_active()` is a definer function that takes
 * the tenant from the session claims and locks regardless of the caller's role.
 */
async function lockActiveQuestions(tx: Tx): Promise<QuestionRow[]> {
  const rows = await tx.execute<QuestionRow>(sql`
    select id::text as id, type, title, help_text, required, show_on_profile,
           allow_other, options, limits, "position" as position, revision
      from app.profile_form_lock_active()`);
  return [...rows];
}

/** The identity of the form: a short hash of `id:revision` pairs in list order. */
export function formEtagOf(questions: readonly { id: string; revision: number }[]): string {
  return createHash('sha256').update(answerEtag(questions)).digest('hex').slice(0, 16);
}

async function ownMembershipId(tx: Tx, ctx: Ctx): Promise<string> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(membershipOfRecord(ctx))
    .limit(1);
  if (!row) throw new ApiError(403, 'FORBIDDEN');
  return row.id;
}

type StoredAnswer = MemberQuestion['answer'];

/** The member's own stored answers by question id (self policy plus the explicit predicate). */
async function readOwnAnswers(
  tx: Tx,
  ctx: Ctx,
  membershipId: string,
): Promise<Map<string, NonNullable<StoredAnswer>>> {
  const rows = await tx.execute<{ question_id: string; value: NonNullable<StoredAnswer> }>(sql`
    select a.question_id::text as question_id, a.value
      from public.profile_form_answers a
     where a.tenant_id = ${ctx.tenantId}::uuid
       and a.membership_id = ${membershipId}::uuid`);
  return new Map(rows.map((row) => [row.question_id, row.value]));
}

const EMPTY_FORM: MemberForm = {
  mode: 'none',
  missingRequired: 0,
  formEtag: formEtagOf([]),
  questions: [],
};

/** The member form payload from already-read rows: pre-filled answers, `mode`, `missingRequired`, `formEtag`. */
async function formFromRows(
  tx: Tx,
  ctx: Ctx,
  rows: readonly QuestionRow[],
  membershipId: string,
): Promise<MemberForm> {
  const answers = await readOwnAnswers(tx, ctx, membershipId);
  const missingRequired = await missingSelf(tx);
  const questions: MemberQuestion[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    helpText: row.help_text,
    required: row.required,
    showOnProfile: row.show_on_profile,
    allowOther: row.allow_other,
    limits: row.limits,
    options: row.options,
    answer: answers.get(row.id) ?? null,
  }));
  // The mode is decided from the data, never from the URL (D-582).
  let mode: ProfileFormMode;
  if (rows.length === 0) mode = 'none';
  else if (missingRequired === 0) mode = 'edit';
  else if (questions.every((question) => question.answer === null)) mode = 'first';
  else mode = 'returning';
  return { mode, missingRequired, formEtag: formEtagOf(rows), questions };
}

/**
 * `GET /v1/me/profile-form` (D-582): every ACTIVE question in the admin's order, pre-filled with the member's
 * own stored answers. Staff and a module that is off get `mode: 'none'` and no questions.
 */
export async function getMemberForm(ctx: Ctx): Promise<MemberForm> {
  return withTenantTx(ctx, async (tx) => {
    if (ctx.role !== 'member' || !(await liveModuleOn(tx, ctx))) return EMPTY_FORM;
    const membershipId = await ownMembershipId(tx, ctx);
    const rows = await readActiveQuestions(tx, ctx);
    return formFromRows(tx, ctx, rows, membershipId);
  });
}

/** The keyed refusal: the errors object lists the questions in the admin's order, unknown ids last. */
function refuse(order: readonly string[], errors: ReadonlyMap<string, ProfileFormIssue>): ApiError {
  const ordered: Record<string, ProfileFormIssue> = {};
  for (const id of order) {
    const issue = errors.get(id);
    if (issue) ordered[id] = issue;
  }
  const known = new Set(order);
  for (const id of [...errors.keys()].filter((key) => !known.has(key)).sort()) {
    const issue = errors.get(id);
    if (issue) ordered[id] = issue;
  }
  return new ApiError(400, 'VALIDATION_FAILED', {
    profileForm: 'answers_invalid',
    errors: ordered,
  });
}

/**
 * `PUT /v1/me/profile-form/answers` (D-585, PFORM-07, PFORM-24): the whole screen at once, in ONE transaction.
 *
 *   1. staff are refused (403); a module that is off is a 200 no-op;
 *   2. the active questions are locked `FOR SHARE` in the canonical order BEFORE anything is validated, so an
 *      admin's type, option or visibility edit and this save never interleave;
 *   3. a stale `formEtag` is a 409 `form_changed` carrying the fresh form, and nothing is written;
 *   4. every submitted value goes through `parseAnswer` built from the STORED question; an unknown, archived or
 *      foreign id is `unknown_question`; a null on an optional question deletes its row, on a required one it is
 *      `required` / `not_ticked`;
 *   5. rows are written in the canonical question order (two saves of one member cannot deadlock), then the rule
 *      `app.profile_form_missing_self()` recounts: a required question still unanswered refuses the whole save.
 *
 * `answers: {}` writes nothing and answers the current `missingRequired` (it submits nothing, so it cannot leave
 * anything unanswered). No completeness is ever stored.
 */
export async function saveAnswers(ctx: Ctx, body: SaveAnswersBody): Promise<SaveAnswersResult> {
  if (ctx.role !== 'member') throw new ApiError(403, 'FORBIDDEN');
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return { missingRequired: 0 };
    const membershipId = await ownMembershipId(tx, ctx);
    const rows = await lockActiveQuestions(tx);

    if (body.formEtag !== formEtagOf(rows)) {
      throw new ApiError(409, 'CONFLICT', {
        profileForm: 'form_changed',
        form: await formFromRows(tx, ctx, rows, membershipId),
      });
    }

    const submitted = Object.keys(body.answers);
    if (submitted.length === 0) return { missingRequired: await missingSelf(tx) };

    const order = rows.map((row) => row.id);
    const known = new Set(order);
    const errors = new Map<string, ProfileFormIssue>();
    for (const id of submitted) if (!known.has(id)) errors.set(id, 'unknown_question');

    const writes: { id: string; value: unknown | null }[] = [];
    for (const row of rows) {
      if (!Object.hasOwn(body.answers, row.id)) continue;
      const def = toDef(row);
      const parsed = parseAnswer(def, body.answers[row.id]);
      if (!parsed.ok) {
        errors.set(row.id, parsed.issue);
      } else if (parsed.value === null) {
        if (row.required) errors.set(row.id, missingIssue(def));
        else writes.push({ id: row.id, value: null });
      } else if (
        Buffer.byteLength(JSON.stringify(parsed.value), 'utf8') > PROFILE_FORM_LIMITS.valueBytes
      ) {
        // The table CHECK would raise a 500; a value that big is a text too long in bytes.
        errors.set(row.id, 'too_long');
      } else {
        writes.push({ id: row.id, value: parsed.value });
      }
    }
    if (errors.size > 0) throw refuse(order, errors);

    for (const write of writes) {
      if (write.value === null) {
        await tx.execute(sql`
          delete from public.profile_form_answers
           where tenant_id = ${ctx.tenantId}::uuid
             and membership_id = ${membershipId}::uuid
             and question_id = ${write.id}::uuid`);
      } else {
        await tx.execute(sql`
          insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
          values (${ctx.tenantId}::uuid, ${write.id}::uuid, ${membershipId}::uuid, ${ctx.userId}::uuid,
                  ${JSON.stringify(write.value)}::jsonb)
          on conflict (tenant_id, membership_id, question_id)
          do update set value = excluded.value, updated_at = now()`);
      }
    }

    // D-585: recount with the SAME rule the gate runs, in the same transaction.
    const stillMissing = await missingSelf(tx);
    if (stillMissing > 0) {
      const answered = await readOwnAnswers(tx, ctx, membershipId);
      for (const row of rows) {
        if (row.required && !answered.has(row.id)) errors.set(row.id, missingIssue(toDef(row)));
      }
      if (errors.size < stillMissing) {
        // A required question appeared after the lock was taken: the form changed under this save.
        const fresh = await readActiveQuestions(tx, ctx);
        throw new ApiError(409, 'CONFLICT', {
          profileForm: 'form_changed',
          form: await formFromRows(tx, ctx, fresh, membershipId),
        });
      }
      throw refuse(order, errors);
    }
    return { missingRequired: 0 };
  });
}

/**
 * `POST /v1/me/profile-form/dismiss-notice` (D-586): "Agora não" on the "Há perguntas novas" notice, stored on
 * the server so it survives a reinstall and another device. Batch granularity: one instant, and a question
 * listed after it brings the notice back. Deliberately NOT a `coalesce` (unlike the first-access nudge): a later
 * dismissal after a later batch must move the timestamp forward. Staff are refused; a module that is off is a
 * no-op.
 */
export async function dismissNotice(ctx: Ctx): Promise<DismissNoticeResult> {
  if (ctx.role !== 'member') throw new ApiError(403, 'FORBIDDEN');
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return { newOptional: 0 };
    const membershipId = await ownMembershipId(tx, ctx);
    await tx.execute(sql`
      update public.member_profiles
         set profile_form_notice_dismissed_at = now(), updated_at = now()
       where tenant_id = ${ctx.tenantId}::uuid
         and membership_id = ${membershipId}::uuid`);
    return { newOptional: await newOptionalCount(tx, ctx) };
  });
}
