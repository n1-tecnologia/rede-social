import {
  type AdminQuestion,
  type AdminQuestionList,
  type ArchivedQuestion,
  type ArchivedQuestionList,
  type CreateQuestionBody,
  createQuestionBodySchema,
  type ImpactQuery,
  type ImpactResult,
  PROFILE_FORM_CHOICE_TYPES,
  PROFILE_FORM_ISSUE_SET,
  PROFILE_FORM_LIMITS,
  type ProfileFormSummary,
  type ProfileFormType,
  type ReorderBody,
  type ReplaceQuestionBody,
  type UpdateQuestionBody,
} from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { addQuestion, applyRequestedLayout, flatten, type Layout, moveQuestion } from './layout';
import {
  assertLayoutOrder,
  dropQuestion,
  type LayoutRead,
  layoutOrThrow,
  readLayout,
  swapQuestion,
  writeLayout,
} from './layout-store';
import { checkLocks, guardIssueOf, type LockDefinition } from './lock-rules';
import { liveModuleOn } from './member';
// A call-time-only cycle with ./steps (which takes `adminLock` and `requireModuleOn` from this file): neither
// module touches the other at load, only inside a function.
import { ensureDefaultStep, readSteps } from './steps';

/**
 * The builder's write side (Phase 12-08, D-582, D-587, D-596; PFORM-01, PFORM-02, PFORM-17, PFORM-24). Pure
 * tenant lane: every statement runs in the caller's own transaction under RLS (the `admin_tenant` policies of
 * `profile_form_questions`), with an explicit `tenant_id` predicate beside it (layer 2). The routes pass only
 * `ctx` and the validated body; the tenant comes from `ctx.tenantId`, never from the body or a path.
 *
 * EVERY WRITE of a tenant starts the same way: `adminLock` (a per-tenant advisory lock, so two admins' writes
 * and the 30-question count never interleave), then a LIVE re-check of the module row (the 30-second flags
 * cache is never the authority of a write), then the row locks `FOR UPDATE` in the canonical order
 * `position, created_at, id` (the order the member's save locks in, so no pair of transactions can deadlock).
 *
 * AGGREGATES ONLY (D-593, PFORM-23): the answers table is read here for `count(*)` and for the option ids an
 * answer references. A member's answer `value` is never selected into a result.
 *
 * NOTHING HERE LOGS a title, an option label or a value.
 */

const MODULE_KEY = 'profile_form';

export type AdminCtx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

const CHOICE: ReadonlySet<string> = new Set(PROFILE_FORM_CHOICE_TYPES);
export const isChoiceType = (type: string): boolean => CHOICE.has(type);

/** The per-tenant advisory lock of every admin write (the `setupLock` shape of the payments gate). */
export const adminLock = (tx: Tx, tenantId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${MODULE_KEY}:${tenantId}`}, 0))`,
  );

/**
 * The live module check of a write. A plain read of the row in this transaction: a `FOR SHARE` lock would
 * return nothing here, because `tenant_modules` has no tenant-lane update policy. A missing row is off.
 */
export async function requireModuleOn(tx: Tx, ctx: Pick<AdminCtx, 'tenantId'>): Promise<void> {
  if (!(await liveModuleOn(tx, ctx))) throw new ApiError(404, 'MODULE_DISABLED');
}

/** A question as the database stores it. */
export type StoredQuestion = {
  id: string;
  step_id: string;
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
  archived_at: string | Date | null;
  created_at: string | Date;
  listed_at: string | Date;
};

const iso = (value: string | Date): string => new Date(value).toISOString();

type CountRow = { question_id: string; n: number | string };
type OptionCountRow = { question_id: string; option_id: string; n: number | string };

/**
 * The aggregate counts of the given questions: answers per question, and answers per option for the choice
 * types (`optionId` of a single-valued answer, every element of `optionIds` of a multiple-choice one).
 */
async function countsFor(
  tx: Tx,
  tenantId: string,
  questionIds: readonly string[],
): Promise<{ perQuestion: Map<string, number>; perOption: Map<string, Map<string, number>> }> {
  const perQuestion = new Map<string, number>();
  const perOption = new Map<string, Map<string, number>>();
  if (questionIds.length === 0) return { perQuestion, perOption };
  const idsJson = JSON.stringify(questionIds);
  const questionRows = await tx.execute<CountRow>(sql`
    select a.question_id::text as question_id, count(*)::int as n
      from public.profile_form_answers a
     where a.tenant_id = ${tenantId}::uuid
       and a.question_id in (select e::uuid from jsonb_array_elements_text(${idsJson}::jsonb) e)
     group by a.question_id`);
  for (const row of questionRows) perQuestion.set(row.question_id, Number(row.n));
  const optionRows = await tx.execute<OptionCountRow>(sql`
    select picked.question_id::text as question_id, picked.option_id, count(*)::int as n
      from (
        select a.question_id, a.value ->> 'optionId' as option_id
          from public.profile_form_answers a
         where a.tenant_id = ${tenantId}::uuid
           and a.question_id in (select e::uuid from jsonb_array_elements_text(${idsJson}::jsonb) e)
           and jsonb_typeof(a.value) = 'object'
        union all
        select a.question_id, o.option_id
          from public.profile_form_answers a
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(a.value) = 'object' and jsonb_typeof(a.value -> 'optionIds') = 'array'
                 then a.value -> 'optionIds' else '[]'::jsonb end) as o(option_id)
         where a.tenant_id = ${tenantId}::uuid
           and a.question_id in (select e::uuid from jsonb_array_elements_text(${idsJson}::jsonb) e)
      ) picked
     where picked.option_id is not null
     group by picked.question_id, picked.option_id`);
  for (const row of optionRows) {
    const inner = perOption.get(row.question_id) ?? new Map<string, number>();
    inner.set(row.option_id, Number(row.n));
    perOption.set(row.question_id, inner);
  }
  return { perQuestion, perOption };
}

/** One stored question as the builder shows it: the member fields without `answer`, plus the counts. */
export function toAdminQuestion(
  row: StoredQuestion,
  counts: { perQuestion: Map<string, number>; perOption: Map<string, Map<string, number>> },
): AdminQuestion {
  const optionCounts = counts.perOption.get(row.id);
  return {
    id: row.id,
    stepId: row.step_id,
    type: row.type,
    title: row.title,
    helpText: row.help_text,
    required: row.required,
    showOnProfile: row.show_on_profile,
    allowOther: row.allow_other,
    limits: row.limits,
    options: row.options.map((option) => ({
      id: option.id,
      label: option.label,
      answerCount: optionCounts?.get(option.id) ?? 0,
    })),
    position: row.position,
    revision: row.revision,
    answerCount: counts.perQuestion.get(row.id) ?? 0,
    createdAt: iso(row.created_at),
    listedAt: iso(row.listed_at),
  };
}

const COLUMNS = sql.raw(`
  q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.help_text, q.required, q.show_on_profile, q.allow_other,
  q.options, q.limits, q."position" as position, q.revision, q.archived_at, q.created_at, q.listed_at`);

/** The tenant's ACTIVE questions in the admin's order, `position, created_at, id` (the lock order too). */
export async function readActive(tx: Tx, tenantId: string): Promise<StoredQuestion[]> {
  const rows = await tx.execute<StoredQuestion>(sql`
    select ${COLUMNS}
      from public.profile_form_questions q
     where q.tenant_id = ${tenantId}::uuid
       and q.archived_at is null
     order by q.position, q.created_at, q.id`);
  return [...rows];
}

/** One question of the tenant by id (archived or not), or null: another tenant's id is the same null. */
export async function readOne(
  tx: Tx,
  tenantId: string,
  id: string,
  lock = false,
): Promise<StoredQuestion | null> {
  const rows = await tx.execute<StoredQuestion>(
    lock
      ? sql`
        select ${COLUMNS}
          from public.profile_form_questions q
         where q.id = ${id}::uuid and q.tenant_id = ${tenantId}::uuid
           for update`
      : sql`
        select ${COLUMNS}
          from public.profile_form_questions q
         where q.id = ${id}::uuid and q.tenant_id = ${tenantId}::uuid`,
  );
  return rows[0] ?? null;
}

/** The builder's active list with its counts, inside an open transaction. */
export async function listInTx(tx: Tx, tenantId: string): Promise<AdminQuestionList> {
  const rows = await readActive(tx, tenantId);
  const counts = await countsFor(
    tx,
    tenantId,
    rows.map((row) => row.id),
  );
  return {
    questions: rows.map((row) => toAdminQuestion(row, counts)),
    activeCount: rows.length,
    limit: PROFILE_FORM_LIMITS.activeQuestions,
    // D-627: the steps the tenant has, none for a form never built (a read never creates the default step).
    steps: await readSteps(tx, tenantId),
    stepLimit: PROFILE_FORM_LIMITS.steps,
  };
}

/** One question with its counts, inside an open transaction. */
export async function adminQuestionOf(
  tx: Tx,
  tenantId: string,
  row: StoredQuestion,
): Promise<AdminQuestion> {
  return toAdminQuestion(row, await countsFor(tx, tenantId, [row.id]));
}

/**
 * `GET /v1/profile_form/questions`: the active questions in the admin's order with `answerCount` per question
 * and per option, `activeCount` and `limit`, and (12.1) the tenant's `steps` with `stepLimit`. A tenant with no
 * question and no step is `{ questions: [], activeCount: 0, limit: 30, steps: [], stepLimit: 10 }`.
 */
export async function listQuestions(ctx: AdminCtx): Promise<AdminQuestionList> {
  return withTenantTx(ctx, async (tx) => {
    await requireModuleOn(tx, ctx);
    return listInTx(tx, ctx.tenantId);
  });
}

/**
 * The step a new question lands in (D-627, D-629): the named one, which must be a step of THIS tenant (a foreign
 * and a missing id answer the same 400 `unknown_step`, T-12.1-10), otherwise the tenant's LAST step, otherwise
 * the default step, created now. Answers the step id and the layout the question will be added to.
 */
async function targetStep(
  tx: Tx,
  tenantId: string,
  read: LayoutRead,
  stepId: string | undefined,
): Promise<{ stepId: string; layout: Layout }> {
  if (stepId !== undefined) {
    const wanted = stepId.toLowerCase();
    if (!read.layout.some((step) => step.stepId === wanted)) throw unknownStep();
    return { stepId: wanted, layout: read.layout };
  }
  const last = read.layout.at(-1);
  if (last) return { stepId: last.stepId, layout: read.layout };
  const created = await ensureDefaultStep(tx, tenantId);
  return { stepId: created, layout: [{ stepId: created, questionIds: [] }] };
}

const unknownStep = () => new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'unknown_step' });

/**
 * `POST /v1/profile_form/questions` (PFORM-02, D-627): a new question at the END of the named step (default:
 * the last step; the default step is created when the form has none). The body is already validated by the
 * contract (title and help text trimmed, 2 to 20 distinct options for a choice type, limits of the right
 * kind). The server decides the rest: a UUID for every option, the position (the layout is renumbered in one
 * statement, so every later step shifts by one), revision 1, `listed_at` now and the caller as the author.
 *
 *   - 404 `MODULE_DISABLED` when the module is off (live read);
 *   - 409 `limit_reached` at 30 ACTIVE questions (counted under the advisory lock, so two simultaneous
 *     creates at 29 end with exactly 30);
 *   - 400 `unknown_step` for a `stepId` that is not a step of this tenant.
 */
export async function createQuestion(
  ctx: AdminCtx,
  body: CreateQuestionBody,
): Promise<AdminQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    if ((await activeCountOf(tx, ctx.tenantId)) >= PROFILE_FORM_LIMITS.activeQuestions) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'limit_reached' });
    }

    const read = await readLayout(tx, ctx.tenantId);
    const target = await targetStep(tx, ctx.tenantId, read, body.stepId);
    const id = await insertQuestion(tx, ctx, body, target.stepId, null);
    const next = layoutOrThrow(addQuestion(target.layout, target.stepId, id));
    await writeLayout(tx, ctx.tenantId, next);
    return questionAfterWrite(tx, ctx, id);
  });
}

/**
 * The insert a create and a replace share: server-made option ids, `revision` 1, `listed_at` now, the step and
 * the caller as the author. `position` is the given one, or (null) the last active position plus one; the
 * layout write that follows sets the final one. Answers the new id.
 */
async function insertQuestion(
  tx: Tx,
  ctx: AdminCtx,
  body: CreateQuestionBody,
  stepId: string,
  position: number | null,
): Promise<string> {
  const options = isChoiceType(body.type)
    ? body.options.map((option) => ({ id: crypto.randomUUID(), label: option.label.trim() }))
    : [];
  const [created] = await tx.execute<{ id: string }>(sql`
    insert into public.profile_form_questions
      (tenant_id, step_id, type, title, help_text, required, show_on_profile, allow_other, options, limits,
       position, revision, listed_at, created_by_user_id)
    values (${ctx.tenantId}::uuid, ${stepId}::uuid, ${body.type}, ${body.title}, ${body.helpText},
            ${body.required}, ${body.showOnProfile}, ${body.allowOther}, ${JSON.stringify(options)}::jsonb,
            ${JSON.stringify(body.limits)}::jsonb,
            coalesce(${position}::int,
              (select coalesce(max(position), 0) + 1
                 from public.profile_form_questions
                where tenant_id = ${ctx.tenantId}::uuid and archived_at is null)),
            1, now(), ${ctx.userId}::uuid)
    returning id::text as id`);
  if (!created) throw new Error('insertQuestion: the insert returned no row');
  return created.id;
}

/** The question as stored AFTER the layout write (its final step, position and revision), with its counts. */
async function questionAfterWrite(tx: Tx, ctx: AdminCtx, id: string): Promise<AdminQuestion> {
  const row = await readOne(tx, ctx.tenantId, id);
  if (!row) throw new Error('questionAfterWrite: the question is not readable');
  return adminQuestionOf(tx, ctx.tenantId, row);
}

/** The part of a question an edit can change, in the shape the lock rules and the update statement share. */
type Definition = LockDefinition & {
  type: ProfileFormType;
  title: string;
  helpText: string | null;
  required: boolean;
};

const definitionOf = (row: StoredQuestion): Definition => ({
  type: row.type,
  title: row.title,
  helpText: row.help_text,
  required: row.required,
  showOnProfile: row.show_on_profile,
  allowOther: row.allow_other,
  options: row.options,
  limits: row.limits,
});

/**
 * The definition the edit asks for. A body option with an `id` keeps that stored option (its label may change,
 * the lock rules decide whether that is allowed); one without gets a fresh server-made id. An id the question
 * does not hold, or one named twice, is a `VALIDATION_FAILED` (it would otherwise be a new option wearing a
 * client-chosen id). A type change on a never-answered question drops what the new type cannot carry: the
 * options of a non-choice type, "Outro" and the limits (unless the body sends them).
 */
function nextDefinition(current: StoredQuestion, body: UpdateQuestionBody): Definition {
  const type = body.type ?? current.type;
  const typeChanged = type !== current.type;

  let options: { id: string; label: string }[];
  if (body.options !== undefined) {
    const stored = new Set(current.options.map((option) => option.id));
    const seen = new Set<string>();
    options = body.options.map((option) => {
      const label = option.label.trim();
      if (option.id === undefined) return { id: crypto.randomUUID(), label };
      if (!stored.has(option.id) || seen.has(option.id)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'unknown_option' });
      }
      seen.add(option.id);
      return { id: option.id, label };
    });
  } else if (typeChanged && !isChoiceType(type)) {
    options = [];
  } else {
    options = current.options;
  }

  const limits: LockDefinition['limits'] =
    body.limits !== undefined
      ? {
          ...(body.limits.min !== undefined ? { min: body.limits.min } : {}),
          ...(body.limits.max !== undefined ? { max: body.limits.max } : {}),
        }
      : typeChanged
        ? {}
        : current.limits;

  return {
    type,
    title: body.title ?? current.title,
    helpText: body.helpText !== undefined ? body.helpText : current.help_text,
    required: body.required ?? current.required,
    showOnProfile: body.showOnProfile ?? current.show_on_profile,
    allowOther:
      body.allowOther ?? (typeChanged && !isChoiceType(type) ? false : current.allow_other),
    options,
    limits,
  };
}

/**
 * The cross-field rules of a whole definition, by the SAME schema a create runs (2 to 20 distinct options for
 * a choice type and none for another, "Outro" only on a choice type, limits of the right kind and
 * `min <= max`). An edit that merges into something a create would refuse is a 400 here, never a database
 * CHECK failing as a 500.
 */
function assertValidDefinition(next: Definition): void {
  const parsed = createQuestionBodySchema.safeParse({
    type: next.type,
    title: next.title,
    helpText: next.helpText,
    required: next.required,
    showOnProfile: next.showOnProfile,
    allowOther: next.allowOther,
    options: next.options.map((option) => ({ label: option.label })),
    limits: next.limits,
  });
  if (parsed.success) return;
  const issue = parsed.error.issues
    .map((candidate) => candidate.message)
    .find((message) => PROFILE_FORM_ISSUE_SET.has(message));
  throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: issue ?? 'invalid' });
}

const sameOptions = (
  a: readonly { id: string; label: string }[],
  b: readonly { id: string; label: string }[],
) =>
  a.length === b.length &&
  a.every((option, i) => option.id === b[i]?.id && option.label === b[i]?.label);

const sameLimits = (a: LockDefinition['limits'], b: LockDefinition['limits']) =>
  a.min === b.min && a.max === b.max;

const unchanged = (a: Definition, b: Definition) =>
  a.type === b.type &&
  a.title === b.title &&
  a.helpText === b.helpText &&
  a.required === b.required &&
  a.showOnProfile === b.showOnProfile &&
  a.allowOther === b.allowOther &&
  sameOptions(a.options, b.options) &&
  sameLimits(a.limits, b.limits);

/**
 * `PATCH /v1/profile_form/questions/{id}` (PFORM-17, PFORM-24; D-587, D-582): edits one question under the
 * lock rules and an optimistic `revision`.
 *
 *   1. `adminLock`, the live module check, then the row `FOR UPDATE`: no row (unknown, another tenant's) is
 *      the bare 404; an archived question is 409 `already_archived` (read-only until reactivated); a
 *      `revision` that is not the stored one is 409 `stale_revision` and nothing changes;
 *   2. AFTER the row lock, in a separate statement, the answer facts are read, so an answer that committed
 *      while this edit waited for the lock is seen; a member's save locks the questions `FOR SHARE` first, so
 *      it cannot slip an answer in between the facts and the update;
 *   3. the pure `checkLocks` decides FIRST (409 `CONFLICT` with `details.profileForm` in `type_locked`,
 *      `option_locked`, `other_locked`, `visibility_locked`, `limits_locked`); the plan-04 trigger is the
 *      backstop and its PF001..PF005 map to the same codes;
 *   4. the merged definition must be one a create would accept (400 otherwise);
 *   5. a change that alters nothing answers 200 and does NOT bump the revision; otherwise the revision is
 *      bumped by one in the same statement;
 *   6. (12.1, D-627) `stepId` moves the question to the END of the target step through the layout store and
 *      bumps its revision once, with or without other edits; an id that is not a step of this tenant is 400
 *      `unknown_step`, and a move that would put an opener at or after its dependent is 409 `condition_order`.
 */
export async function updateQuestion(
  ctx: AdminCtx,
  id: string,
  body: UpdateQuestionBody,
): Promise<AdminQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    // A move needs the whole layout: read (and lock) it BEFORE the question row, in the canonical order, so
    // this transaction never waits for a row a member's save already holds while that save waits for ours.
    const read = body.stepId !== undefined ? await readLayout(tx, ctx.tenantId) : null;

    const row = await readOne(tx, ctx.tenantId, id, true);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (row.archived_at !== null) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'already_archived' });
    }
    if (body.revision !== row.revision) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'stale_revision' });
    }

    // D-627: `stepId` moves the question to the END of the target step; the same step is a no-op. A step that
    // is not the tenant's is the 400 `unknown_step` (T-12.1-10); the order rule (D-623) is checked over the
    // layout the move would produce, before anything is written.
    let moved: Layout | null = null;
    if (read !== null && body.stepId !== undefined) {
      const to = body.stepId.toLowerCase();
      if (!read.layout.some((step) => step.stepId === to)) throw unknownStep();
      if (to !== row.step_id) {
        moved = layoutOrThrow(moveQuestion(read.layout, row.id, to));
        assertLayoutOrder(moved, read.facts);
      }
    }

    const counts = await countsFor(tx, ctx.tenantId, [row.id]);
    const current = definitionOf(row);
    const next = nextDefinition(row, body);

    const locked = checkLocks({
      current,
      next,
      answerCount: counts.perQuestion.get(row.id) ?? 0,
      answeredOptionIds: new Set(counts.perOption.get(row.id)?.keys() ?? []),
      otherAnswered: await otherAnswered(tx, ctx.tenantId, row.id),
    });
    if (locked) throw new ApiError(409, 'CONFLICT', { profileForm: locked });

    assertValidDefinition(next);
    const edited = !unchanged(current, next);
    if (!edited && moved === null) return toAdminQuestion(row, counts);

    // The layout write bumps the revision of a question that changed step, so a move plus an edit is ONE bump.
    if (moved !== null) await writeLayout(tx, ctx.tenantId, moved);
    if (edited) {
      try {
        await tx.execute(sql`
          update public.profile_form_questions
             set type = ${next.type}, title = ${next.title}, help_text = ${next.helpText},
                 required = ${next.required}, show_on_profile = ${next.showOnProfile},
                 allow_other = ${next.allowOther}, options = ${JSON.stringify(next.options)}::jsonb,
                 limits = ${JSON.stringify(next.limits)}::jsonb,
                 revision = revision + ${moved === null ? 1 : 0}::int, updated_at = now()
           where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
      } catch (error) {
        // The trigger is the backstop of a race that got past `checkLocks`: the same coded 409, never a 500.
        const issue = guardIssueOf(error);
        if (issue) throw new ApiError(409, 'CONFLICT', { profileForm: issue });
        throw error;
      }
    }
    return questionAfterWrite(tx, ctx, row.id);
  });
}

/** Whether at least one answer of the question carries an "Outro" text (a boolean, never the text). */
async function otherAnswered(tx: Tx, tenantId: string, questionId: string): Promise<boolean> {
  const [row] = await tx.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from public.profile_form_answers a
       where a.tenant_id = ${tenantId}::uuid
         and a.question_id = ${questionId}::uuid
         and a.value ->> 'otherText' is not null) as found`);
  return row?.found === true;
}

/**
 * `PUT /v1/profile_form/order` (PFORM-02, PFORM-24, PFORM-27; D-582, D-623, D-627): the whole form in its new
 * order, in ONE set-based renumber (`writeLayout`) so positions stay `1..n` and the readers' order is unchanged.
 *
 *   1. `adminLock`, the live module check, then `readLayout` (steps, then every ACTIVE question, `FOR UPDATE` in
 *      the canonical order the member's save locks in, so the two can never deadlock);
 *   2. two bodies for one release: the legacy `{ ids }` is accepted only while the tenant has exactly ONE step
 *      (a flat list cannot say which step each question belongs to, so a form with several steps answers
 *      `order_mismatch`); the layout `{ steps: [{ id, questionIds }] }` must name every step and every active
 *      question exactly once. A missing, repeated, archived or foreign id is 409 `order_mismatch`, an id of
 *      another tenant being just an id that is not in the set, so it leaks nothing;
 *   3. D-623: a layout that puts an opener at or after a question it opens is 409 `condition_order` naming the
 *      pair, and nothing changes;
 *   4. only `position`, `step_id` and (for a question that changed step) `revision` are written. A question is
 *      never dropped: a layout that omits one is a mismatch.
 *
 * Answers the refreshed list.
 */
export async function reorderQuestions(
  ctx: AdminCtx,
  body: ReorderBody,
): Promise<AdminQuestionList> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const read = await readLayout(tx, ctx.tenantId);
    const requested: Layout = (() => {
      if ('ids' in body) {
        const only = read.layout.length === 1 ? read.layout[0] : undefined;
        if (!only) throw new ApiError(409, 'CONFLICT', { profileForm: 'order_mismatch' });
        return [{ stepId: only.stepId, questionIds: body.ids.map((id) => id.toLowerCase()) }];
      }
      return body.steps.map((step) => ({
        stepId: step.id.toLowerCase(),
        questionIds: step.questionIds.map((id) => id.toLowerCase()),
      }));
    })();

    const next = layoutOrThrow(applyRequestedLayout(read.layout, requested));
    assertLayoutOrder(next, read.facts);
    await writeLayout(tx, ctx.tenantId, next);
    return listInTx(tx, ctx.tenantId);
  });
}

// ── The lifecycle of a question (Phase 12-09, D-585, D-588, D-589; PFORM-03, PFORM-17, PFORM-23) ──────────────
//
// NOTHING BELOW EVER WRITES AN ANSWER ROW. Archiving keeps every answer (D-588: "kept" is a promise to members
// and to the export); a question that has answers is never deleted (`has_answers`, with the RESTRICT foreign
// key of plan 04 as the floor). Whether a member is held is NOT stored: the gate reads the SQL rule
// (`app.profile_form_missing`), so reactivating or creating a required question reopens the form for whoever
// lacks the answer, and archiving one frees them, with nothing to recompute (D-585).

const archivedAtOf = (row: StoredQuestion): string => iso(row.archived_at ?? row.created_at);

/** Whether the error, or anything in its cause chain, carries the given SQLSTATE. */
function hasSqlState(error: unknown, state: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === state) return true;
    current = cause;
  }
  return false;
}

/** How many ACTIVE questions the tenant has (counted under the advisory lock, so a create cannot slip in). */
async function activeCountOf(tx: Tx, tenantId: string): Promise<number> {
  const [counted] = await tx.execute<{ n: number | string }>(sql`
    select count(*)::int as n
      from public.profile_form_questions
     where tenant_id = ${tenantId}::uuid and archived_at is null`);
  return Number(counted?.n ?? 0);
}

/** One question archived, with its counts, as the archived list shows it. */
async function archivedQuestionOf(
  tx: Tx,
  tenantId: string,
  row: StoredQuestion,
): Promise<ArchivedQuestion> {
  return { ...(await adminQuestionOf(tx, tenantId, row)), archivedAt: archivedAtOf(row) };
}

/**
 * `POST /v1/profile_form/questions/{id}/archive` (D-588, D-589): the question leaves the form and stops being
 * asked; every answer stays. Idempotent: an already archived question is answered unchanged (`archived_at` is
 * not touched). Unknown or another tenant's id: the bare 404. The row lock waits for a member's save that
 * holds the question `FOR SHARE`, so after both commit no answer can name a question archived before the save's
 * lock (the save then answers `unknown_question`).
 */
export async function archiveQuestion(ctx: AdminCtx, id: string): Promise<ArchivedQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    // The layout first (canonical lock order), the row after; the remaining active questions renumber below.
    const read = await readLayout(tx, ctx.tenantId);
    const row = await readOne(tx, ctx.tenantId, id, true);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (row.archived_at !== null) return archivedQuestionOf(tx, ctx.tenantId, row);

    await tx.execute(sql`
      update public.profile_form_questions
         set archived_at = now(), revision = revision + 1, updated_at = now()
       where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    await writeLayout(tx, ctx.tenantId, dropQuestion(read.layout, row.id));
    const archived = await readOne(tx, ctx.tenantId, row.id);
    if (!archived) throw new Error('archiveQuestion: the archived question is not readable');
    return archivedQuestionOf(tx, ctx.tenantId, archived);
  });
}

/**
 * `POST /v1/profile_form/questions/{id}/reactivate` (D-585, D-588, D-627): an archived question goes back to
 * the END of ITS OWN step (`listed_at` now, so members see it as new). Its stored `step_id` always names an
 * existing step, because deleting a step re-points the archived questions inside it. Idempotent: an active
 * question is answered unchanged. At 30 active questions it is 409 `limit_reached`. Its old answers are still
 * there, so a member who had answered it is not held again. A reactivated conditional question whose opener is
 * active but sits after it would break D-623 and is 409 `condition_order`.
 */
export async function reactivateQuestion(ctx: AdminCtx, id: string): Promise<AdminQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const read = await readLayout(tx, ctx.tenantId);
    const row = await readOne(tx, ctx.tenantId, id, true);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (row.archived_at === null) return adminQuestionOf(tx, ctx.tenantId, row);
    if ((await activeCountOf(tx, ctx.tenantId)) >= PROFILE_FORM_LIMITS.activeQuestions) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'limit_reached' });
    }

    const next = layoutOrThrow(addQuestion(read.layout, row.step_id, row.id));
    const [conditional] = await tx.execute<{ opener_id: string | null }>(sql`
      select q.condition_question_id::text as opener_id
        from public.profile_form_questions q
       where q.id = ${row.id}::uuid and q.tenant_id = ${ctx.tenantId}::uuid`);
    const openerId = conditional?.opener_id ?? null;
    // An opener that is archived or ineligible is the reactivation rule of the conditions (plan 10); here only
    // the ORDER over what is active is enforced.
    const facts =
      openerId !== null && flatten(next).includes(openerId)
        ? [...read.facts, { questionId: row.id, openerId }]
        : read.facts;
    assertLayoutOrder(next, facts);

    await tx.execute(sql`
      update public.profile_form_questions
         set archived_at = null, listed_at = now(), revision = revision + 1, updated_at = now()
       where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    await writeLayout(tx, ctx.tenantId, next);
    return questionAfterWrite(tx, ctx, row.id);
  });
}

/**
 * `GET /v1/profile_form/archived`: the archived questions with `archivedAt`, `required`, `answerCount`, newest
 * archive first then id. A tenant with none is `{ questions: [] }`. Counts are exact `count(*)` at read time.
 */
export async function listArchived(ctx: AdminCtx): Promise<ArchivedQuestionList> {
  return withTenantTx(ctx, async (tx) => {
    await requireModuleOn(tx, ctx);
    const rows = await tx.execute<StoredQuestion>(sql`
      select ${COLUMNS}
        from public.profile_form_questions q
       where q.tenant_id = ${ctx.tenantId}::uuid and q.archived_at is not null
       order by q.archived_at desc, q.id`);
    const counts = await countsFor(
      tx,
      ctx.tenantId,
      rows.map((row) => row.id),
    );
    return {
      questions: rows.map((row) => ({
        ...toAdminQuestion(row, counts),
        archivedAt: archivedAtOf(row),
      })),
    };
  });
}

/**
 * `DELETE /v1/profile_form/questions/{id}` (D-588): only a question nobody ever answered. One answer makes it
 * 409 `has_answers`, whatever its state; the RESTRICT foreign key of plan 04 refuses the same delete in SQL and
 * its SQLSTATE 23503 maps to the same code. A second delete is the bare 404.
 */
export async function deleteQuestion(ctx: AdminCtx, id: string): Promise<{ deleted: true }> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const read = await readLayout(tx, ctx.tenantId);
    const row = await readOne(tx, ctx.tenantId, id, true);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const [answered] = await tx.execute<{ found: boolean }>(sql`
      select exists (
        select 1 from public.profile_form_answers a
         where a.tenant_id = ${ctx.tenantId}::uuid and a.question_id = ${row.id}::uuid) as found`);
    if (answered?.found === true)
      throw new ApiError(409, 'CONFLICT', { profileForm: 'has_answers' });

    try {
      await tx.execute(sql`
        delete from public.profile_form_questions
         where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    } catch (error) {
      if (hasSqlState(error, '23503')) {
        throw new ApiError(409, 'CONFLICT', { profileForm: 'has_answers' });
      }
      throw error;
    }
    await writeLayout(tx, ctx.tenantId, dropQuestion(read.layout, row.id));
    return { deleted: true };
  });
}

/**
 * `POST /v1/profile_form/questions/replace` (PFORM-17, D-627): the new question and the archive of the old one in
 * ONE transaction. The new question takes the old one's STEP and POSITION (its id replaces the old id in the
 * layout, in place); the old one keeps its answers, archived. The active count does not grow, so the
 * 30-question limit is not re-checked. A `stepId` in the body must still be a step of this tenant (400
 * `unknown_step`) but does not move the replacement. An old question that is not active is 409
 * `already_archived`; unknown or another tenant's id is the bare 404. Any failure of either half rolls both
 * back: the old question stays active and nothing is created.
 */
export async function replaceQuestion(
  ctx: AdminCtx,
  body: ReplaceQuestionBody,
): Promise<AdminQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const read = await readLayout(tx, ctx.tenantId);
    const old = await readOne(tx, ctx.tenantId, body.replaces, true);
    if (!old) throw new ApiError(404, 'NOT_FOUND');
    if (old.archived_at !== null) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'already_archived' });
    }
    if (
      body.stepId !== undefined &&
      !read.layout.some((step) => step.stepId === body.stepId?.toLowerCase())
    ) {
      throw unknownStep();
    }

    const createdId = await insertQuestion(tx, ctx, body, old.step_id, old.position);
    const next = swapQuestion(read.layout, old.id, createdId);
    assertLayoutOrder(next, read.facts);
    await tx.execute(sql`
      update public.profile_form_questions
         set archived_at = now(), revision = revision + 1, updated_at = now()
       where id = ${old.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    await writeLayout(tx, ctx.tenantId, next);
    return questionAfterWrite(tx, ctx, createdId);
  });
}

/**
 * The members the builder's numbers are about: live `member`-role memberships of the tenant whose status is
 * `active` and not blocked (D-584: staff are in no number; a blocked or invited member is not asked yet). The
 * fold of `status`/`blocked_at` is the one the members list uses.
 */
const ACTIVE_MEMBERS = (tenantId: string) => sql`
  select m.id
    from public.memberships m
   where m.tenant_id = ${tenantId}::uuid
     and m.role = 'member'
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null`;

/**
 * `GET /v1/profile_form/summary` (PFORM-23): `{ total, complete, hasRequired }` in ONE set-based statement.
 * `complete` is the members with an answer to EVERY active required question (all of them when there is no
 * required question). Counts only: no answer is selected.
 */
export async function getSummary(ctx: AdminCtx): Promise<ProfileFormSummary> {
  return withTenantTx(ctx, async (tx) => {
    await requireModuleOn(tx, ctx);
    const [row] = await tx.execute<{
      total: number | string;
      complete: number | string;
      has_required: boolean;
    }>(
      sql`
      with members as (${ACTIVE_MEMBERS(ctx.tenantId)}),
      req as (
        select q.id
          from public.profile_form_questions q
         where q.tenant_id = ${ctx.tenantId}::uuid and q.required and q.archived_at is null),
      answered as (
        select a.membership_id, count(*) as n
          from public.profile_form_answers a
          join req r on r.id = a.question_id
         where a.tenant_id = ${ctx.tenantId}::uuid
         group by a.membership_id)
      select (select count(*) from members)::int as total,
             (select count(*)
                from members m
                left join answered x on x.membership_id = m.id
               where coalesce(x.n, 0) = (select count(*) from req))::int as complete,
             exists (select 1 from req) as has_required`,
    );
    return {
      total: Number(row?.total ?? 0),
      complete: Number(row?.complete ?? 0),
      hasRequired: row?.has_required === true,
    };
  });
}

/**
 * `GET /v1/profile_form/impact` (D-585, PFORM-23): how many members a change would ask to answer, were it
 * applied now. `create_required` and `replace` count every member; `make_required` and `reactivate` count the
 * members with no answer to `questionId`. A change that asks nobody is 0: a `reactivate` of an optional or an
 * active question, a `make_required` of a question that is already required or archived. `questionId` is
 * needed by those two (400 `invalid` without it) and an unknown or foreign one is the bare 404. A count only.
 */
export async function getImpact(ctx: AdminCtx, query: ImpactQuery): Promise<ImpactResult> {
  return withTenantTx(ctx, async (tx) => {
    await requireModuleOn(tx, ctx);

    if (query.change === 'create_required' || query.change === 'replace') {
      const [row] = await tx.execute<{ n: number | string }>(
        sql`select count(*)::int as n from (${ACTIVE_MEMBERS(ctx.tenantId)}) members`,
      );
      return { members: Number(row?.n ?? 0) };
    }

    if (query.questionId === undefined) {
      throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'invalid' });
    }
    const row = await readOne(tx, ctx.tenantId, query.questionId);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const asksNobody =
      query.change === 'reactivate'
        ? row.archived_at === null || !row.required
        : row.archived_at !== null || row.required;
    if (asksNobody) return { members: 0 };

    const [counted] = await tx.execute<{ n: number | string }>(sql`
      select count(*)::int as n
        from (${ACTIVE_MEMBERS(ctx.tenantId)}) members
       where not exists (
         select 1 from public.profile_form_answers a
          where a.tenant_id = ${ctx.tenantId}::uuid
            and a.membership_id = members.id
            and a.question_id = ${row.id}::uuid)`);
    return { members: Number(counted?.n ?? 0) };
  });
}
