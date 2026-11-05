import { createHash } from 'node:crypto';
import {
  answerEtag,
  answerTokens,
  type DismissNoticeResult,
  isQuestionVisible,
  type MemberForm,
  type MemberQuestion,
  missingIssue,
  PROFILE_FORM_LIMITS,
  type ProfileFormBootstrap,
  type ProfileFormCondition,
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
 * that she has not answered AND can see (D-586, 12.1): a question with a condition is new for her only while
 * her answer to its opener overlaps the condition, the same rule the gate and the purge use, so a conditional
 * question her answers keep hidden is not "new". Counts only: no title or value is selected.
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
       and (q.condition_question_id is null
            or exists (
                 select 1
                   from public.profile_form_answers o
                   join public.memberships m on m.id = o.membership_id
                  where o.tenant_id = q.tenant_id
                    and o.question_id = q.condition_question_id
                    and m.tenant_id = ${ctx.tenantId}::uuid
                    and m.user_id = ${ctx.userId}::uuid
                    and m.deleted_at is null
                    and q.condition_values && app.profile_form_answer_tokens(o.value)))
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
  /** 12.1 (D-627): the step the question sits in; every question has exactly one. */
  step_id: string;
  /** 12.1 (D-621): the opener and the tokens that show the question; both null or both set. */
  condition_question_id: string | null;
  condition_values: string[] | null;
};

/** A step of the tenant as the etag needs it: its revision moves with every rename. */
type StepRow = { id: string; title: string; revision: number };

/** The condition of a row in the contracts' shape, or null for an always-shown question. */
const conditionOf = (row: QuestionRow): ProfileFormCondition | null =>
  row.condition_question_id === null || row.condition_values === null
    ? null
    : { questionId: row.condition_question_id, values: row.condition_values };

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
           q.allow_other, q.options, q.limits, q.position, q.revision,
           q.step_id::text as step_id, q.condition_question_id::text as condition_question_id,
           q.condition_values
      from public.profile_form_questions q
     where q.tenant_id = ${ctx.tenantId}::uuid
       and q.archived_at is null
     order by q.position, q.created_at, q.id`);
  return [...rows];
}

/**
 * The same rows, locked `FOR SHARE` in the same canonical order (PFORM-24 member half, T-12-16). A member
 * cannot lock them herself: `FOR SHARE` applies the UPDATE policy, which only an admin passes, so from her
 * session it would lock and return nothing. `app.profile_form_lock_active_v2()` is a definer function that
 * takes the tenant from the session claims and locks regardless of the caller's role; the `_v2` adds the step
 * and the condition columns (the old function stays one release for the API revision still serving).
 */
async function lockActiveQuestions(tx: Tx): Promise<QuestionRow[]> {
  const rows = await tx.execute<QuestionRow>(sql`
    select id::text as id, type, title, help_text, required, show_on_profile,
           allow_other, options, limits, "position" as position, revision,
           step_id::text as step_id, condition_question_id::text as condition_question_id,
           condition_values
      from app.profile_form_lock_active_v2()`);
  return [...rows];
}

/**
 * The steps a member is shown (D-628): the tenant's steps in `position, created_at, id` order that hold at
 * least one of the given ACTIVE questions. An empty step, and a step that only holds archived questions, is
 * never shown. Members read the steps through their own SELECT policy; the explicit tenant predicate is layer 2.
 */
async function readFormSteps(
  tx: Tx,
  ctx: Ctx,
  rows: readonly Pick<QuestionRow, 'step_id'>[],
): Promise<StepRow[]> {
  const held = new Set(rows.map((row) => row.step_id));
  const all = await tx.execute<{ id: string; title: string; revision: number | string }>(sql`
    select s.id::text as id, s.title, s.revision
      from public.profile_form_steps s
     where s.tenant_id = ${ctx.tenantId}::uuid
     order by s."position", s.created_at, s.id`);
  return all
    .filter((step) => held.has(step.id))
    .map((step) => ({ id: step.id, title: step.title, revision: Number(step.revision) }));
}

/**
 * The identity of the form: a short hash of each question's `id:revision:step_id` in list order plus the shown
 * steps' `id:revision` (D-629). A question moved between steps that keeps the global order, a step rename and
 * any condition edit (it bumps the question's revision) each change it.
 */
export function formEtagOf(
  questions: readonly { id: string; revision: number; step_id: string }[],
  steps: readonly { id: string; revision: number }[],
): string {
  const text = answerEtag(
    questions.map((question) => ({
      id: question.id,
      revision: question.revision,
      stepId: question.step_id,
    })),
    steps,
  );
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
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
  formEtag: formEtagOf([], []),
  steps: [],
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
  const steps = await readFormSteps(tx, ctx, rows);
  const questions: MemberQuestion[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    helpText: row.help_text,
    required: row.required,
    showOnProfile: row.show_on_profile,
    allowOther: row.allow_other,
    limits: row.limits,
    stepId: row.step_id,
    condition: conditionOf(row),
    options: row.options,
    answer: answers.get(row.id) ?? null,
  }));
  // The mode is decided from the data, never from the URL (D-582).
  let mode: ProfileFormMode;
  if (rows.length === 0) mode = 'none';
  else if (missingRequired === 0) mode = 'edit';
  else if (questions.every((question) => question.answer === null)) mode = 'first';
  else mode = 'returning';
  return {
    mode,
    missingRequired,
    formEtag: formEtagOf(rows, steps),
    steps: steps.map((step) => ({ id: step.id, title: step.title })),
    questions,
  };
}

/**
 * `GET /v1/me/profile-form` (D-582, D-628, D-630): every ACTIVE question in the admin's order, hidden ones
 * included (the client reveals live), each with its `stepId` and `condition`, pre-filled with the member's own
 * stored answers, plus the shown `steps`. Staff and a module that is off get `mode: 'none'` and no questions.
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

/** A JSON value as a string with the object keys sorted, so two equal stored values compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The refusal of a race: the form changed under this save, so the client gets the fresh one (D-629). */
async function formChanged(tx: Tx, ctx: Ctx, membershipId: string): Promise<ApiError> {
  const fresh = await readActiveQuestions(tx, ctx);
  return new ApiError(409, 'CONFLICT', {
    profileForm: 'form_changed',
    form: await formFromRows(tx, ctx, fresh, membershipId),
  });
}

/**
 * What the member still owes after a save (D-629, D-631): the ids of the VISIBLE required questions with no
 * answer, over the whole form, in the form's order, and `missingRequired` from the SAME SQL function the gate
 * runs. The two are computed apart (TypeScript with `isQuestionVisible`, SQL with the token helper) and must
 * agree; when they do not a required question appeared after the lock was taken, and the save is a
 * `form_changed` (FA-32). Never refuses for what is owed elsewhere: only the SQL gate holds a member in.
 */
async function reportMissing(
  tx: Tx,
  ctx: Ctx,
  rows: readonly QuestionRow[],
  membershipId: string,
): Promise<SaveAnswersResult> {
  const answers = await readOwnAnswers(tx, ctx, membershipId);
  const tokensOf = (id: string) => answerTokens(answers.get(id));
  const missingQuestionIds = rows
    .filter(
      (row) =>
        row.required &&
        !answers.has(row.id) &&
        isQuestionVisible({ condition: conditionOf(row) }, tokensOf),
    )
    .map((row) => row.id);
  const missingRequired = await missingSelf(tx);
  if (missingRequired !== missingQuestionIds.length) throw await formChanged(tx, ctx, membershipId);
  return { missingRequired, missingQuestionIds };
}

/**
 * `PUT /v1/me/profile-form/answers` (D-585, D-624, D-629, D-631, D-636; PFORM-07, PFORM-24, PFORM-30,
 * PFORM-33): one step, or the whole screen, in ONE transaction.
 *
 *   1. staff are refused (403); a module that is off is a 200 no-op;
 *   2. the active questions are locked `FOR SHARE` in the canonical order BEFORE anything is validated, so an
 *      admin's type, option, condition or step edit and this save never interleave; then a per-member advisory
 *      lock serialises two saves of one member, so the stored answers they read are never half-written;
 *   3. a stale `formEtag` (it hashes ids, revisions, steps and the shown steps' revisions) is a 409
 *      `form_changed` carrying the fresh form, and nothing is written;
 *   4. the scope is the questions of `stepId`, or every active question without one. An unknown, empty or
 *      foreign step is 400 `unknown_step`; a key outside the scope is `unknown_question`;
 *   5. visibility is computed HERE, from the effective answers (stored, overlaid with the submitted values), with
 *      the contracts' `isQuestionVisible`: the client's copy is only a convenience (T-12.1-16). A value for a
 *      question that is not visible is ignored, with no error and no write (T-12.1-02). A visible question goes
 *      through `parseAnswer` built from the STORED question; a visible required one left without an answer is
 *      `required` / `not_ticked`, but only inside the scope: what is owed in another step is reported, never
 *      refused (D-629);
 *   6. rows are written in the canonical question order (unchanged values are not rewritten), then
 *      `app.profile_form_purge_closed()` deletes, in the same transaction, the answers to every question that
 *      stopped applying, ACTIVE or ARCHIVED (D-624, D-636);
 *   7. the report: `{ missingRequired, missingQuestionIds }`, the SQL count cross-checked with the list.
 *
 * `answers: {}` writes nothing and answers the current report. No completeness is ever stored.
 */
export async function saveAnswers(ctx: Ctx, body: SaveAnswersBody): Promise<SaveAnswersResult> {
  if (ctx.role !== 'member') throw new ApiError(403, 'FORBIDDEN');
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return { missingRequired: 0, missingQuestionIds: [] };
    const membershipId = await ownMembershipId(tx, ctx);
    const rows = await lockActiveQuestions(tx);
    const steps = await readFormSteps(tx, ctx, rows);

    if (body.formEtag !== formEtagOf(rows, steps)) {
      throw new ApiError(409, 'CONFLICT', {
        profileForm: 'form_changed',
        form: await formFromRows(tx, ctx, rows, membershipId),
      });
    }

    // Scope (D-629). `steps` holds only steps with an active question, so an empty step is unknown too.
    let scope: readonly QuestionRow[] = rows;
    if (body.stepId !== undefined) {
      const stepId = body.stepId.toLowerCase();
      if (!steps.some((step) => step.id === stepId)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'unknown_step' });
      }
      scope = rows.filter((row) => row.step_id === stepId);
    }

    // Two saves of one member run one after the other: the answers read below are never a half-written view.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${MODULE_KEY}:member:${membershipId}`}, 0))`,
    );

    const submitted = Object.keys(body.answers);
    if (submitted.length === 0) return reportMissing(tx, ctx, rows, membershipId);

    const order = scope.map((row) => row.id);
    const inScope = new Set(order);
    const errors = new Map<string, ProfileFormIssue>();
    for (const id of submitted) if (!inScope.has(id)) errors.set(id, 'unknown_question');

    // The parsed value of every submitted, in-scope key (null: the member cleared it).
    const parsedOf = new Map<string, ReturnType<typeof parseAnswer>>();
    for (const row of scope) {
      if (Object.hasOwn(body.answers, row.id)) {
        parsedOf.set(row.id, parseAnswer(toDef(row), body.answers[row.id]));
      }
    }

    // The effective answers: stored, overlaid with what was submitted. An opener carries no condition (D-622),
    // so the openers' answers are settled first and two passes suffice.
    const stored = await readOwnAnswers(tx, ctx, membershipId);
    const effective = new Map<string, unknown>(stored);
    for (const row of rows) {
      if (row.condition_question_id !== null) continue;
      const parsed = parsedOf.get(row.id);
      if (!parsed?.ok) continue;
      if (parsed.value === null) effective.delete(row.id);
      else effective.set(row.id, parsed.value);
    }
    const tokensOf = (id: string) => answerTokens(effective.get(id));

    const writes: { id: string; value: unknown | null }[] = [];
    for (const row of scope) {
      const def = toDef(row);
      // T-12.1-02: a question that is not visible takes no value, valid or not, and raises no error.
      if (!isQuestionVisible({ condition: conditionOf(row) }, tokensOf)) continue;
      const parsed = parsedOf.get(row.id);
      if (parsed === undefined) {
        if (row.required && !effective.has(row.id)) errors.set(row.id, missingIssue(def));
      } else if (!parsed.ok) {
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
      const current = stored.get(write.id);
      if (write.value === null) {
        if (current === undefined) continue;
        await tx.execute(sql`
          delete from public.profile_form_answers
           where tenant_id = ${ctx.tenantId}::uuid
             and membership_id = ${membershipId}::uuid
             and question_id = ${write.id}::uuid`);
      } else {
        // PFORM-33 idempotency: an unchanged value is not rewritten, so `updated_at` stays.
        if (current !== undefined && canonical(current) === canonical(write.value)) continue;
        await tx.execute(sql`
          insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
          values (${ctx.tenantId}::uuid, ${write.id}::uuid, ${membershipId}::uuid, ${ctx.userId}::uuid,
                  ${JSON.stringify(write.value)}::jsonb)
          on conflict (tenant_id, membership_id, question_id)
          do update set value = excluded.value, updated_at = now()`);
      }
    }

    // D-624, D-636: what stopped applying is deleted by the save that closed it, in this transaction. It covers
    // archived questions too (a member cannot see them through RLS, hence the definer function).
    await tx.execute(sql`select question_id from app.profile_form_purge_closed()`);

    return reportMissing(tx, ctx, rows, membershipId);
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
