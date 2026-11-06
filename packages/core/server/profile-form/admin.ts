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
  type ProfileFormCondition,
  type ProfileFormSummary,
  type ProfileFormType,
  parseConditionValues,
  type ReorderBody,
  type ReplaceQuestionBody,
  type UpdateQuestionBody,
} from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import {
  type ConditionCheck,
  checkCondition,
  checkConditionLock,
  checkOpenerChange,
  checkReactivation,
  dependentsOf,
  type RuleQuestion,
} from './condition-rules';
import {
  addQuestion,
  addQuestionAfterOpener,
  applyRequestedLayout,
  type Layout,
  moveQuestion,
} from './layout';
import {
  assertLayoutOrder,
  dropQuestion,
  endsWith,
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
  condition_question_id: string | null;
  condition_values: string[] | null;
  archived_at: string | Date | null;
  created_at: string | Date;
  listed_at: string | Date;
};

const iso = (value: string | Date): string => new Date(value).toISOString();

type CountRow = { question_id: string; n: number | string };
type OptionCountRow = { question_id: string; option_id: string; n: number | string };
type OpenerCountRow = { opener_id: string; n: number | string };

type Counts = {
  perQuestion: Map<string, number>;
  perOption: Map<string, Map<string, number>>;
  /** ACTIVE dependents per opener (D-632): how many active questions name the key as their opener. */
  opens: Map<string, number>;
};

/**
 * The aggregate counts of the given questions: answers per question, and answers per option for the choice
 * types (`optionId` of a single-valued answer, every element of `optionIds` of a multiple-choice one).
 */
async function countsFor(
  tx: Tx,
  tenantId: string,
  questionIds: readonly string[],
): Promise<Counts> {
  const perQuestion = new Map<string, number>();
  const perOption = new Map<string, Map<string, number>>();
  const opens = new Map<string, number>();
  if (questionIds.length === 0) return { perQuestion, perOption, opens };
  const idsJson = JSON.stringify(questionIds);
  const openerRows = await tx.execute<OpenerCountRow>(sql`
    select d.condition_question_id::text as opener_id, count(*)::int as n
      from public.profile_form_questions d
     where d.tenant_id = ${tenantId}::uuid
       and d.archived_at is null
       and d.condition_question_id in (select e::uuid from jsonb_array_elements_text(${idsJson}::jsonb) e)
     group by d.condition_question_id`);
  for (const row of openerRows) opens.set(row.opener_id, Number(row.n));
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
  return { perQuestion, perOption, opens };
}

/** One stored question as the builder shows it: the member fields without `answer`, plus the counts. */
export function toAdminQuestion(row: StoredQuestion, counts: Counts): AdminQuestion {
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
    condition:
      row.condition_question_id === null
        ? null
        : { questionId: row.condition_question_id, values: row.condition_values ?? [] },
    opensCount: counts.opens.get(row.id) ?? 0,
    createdAt: iso(row.created_at),
    listedAt: iso(row.listed_at),
  };
}

const COLUMNS = sql.raw(`
  q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.help_text, q.required, q.show_on_profile, q.allow_other,
  q.options, q.limits, q."position" as position, q.revision,
  q.condition_question_id::text as condition_question_id, q.condition_values,
  q.archived_at, q.created_at, q.listed_at`);

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

// ── Conditions (Phase 12.1 plan 10: D-620..D-623, D-625, D-632; PFORM-29, PFORM-31) ──────────────────────────

/** The part of a stored question the condition rules look at. */
const ruleQuestionOf = (row: StoredQuestion): RuleQuestion => ({
  id: row.id,
  type: row.type,
  title: row.title,
  archived: row.archived_at !== null,
  options: row.options.map((option) => ({ id: option.id })),
  conditionQuestionId: row.condition_question_id,
  conditionValues: row.condition_values,
});

const conditionOf = (row: StoredQuestion): ProfileFormCondition | null =>
  row.condition_question_id === null
    ? null
    : { questionId: row.condition_question_id, values: row.condition_values ?? [] };

/** The same opener and the same set of tokens (an order of the tokens is not a change). */
const sameCondition = (a: ProfileFormCondition | null, b: ProfileFormCondition | null): boolean => {
  if (a === null || b === null) return a === b;
  const left = new Set(a.values);
  const right = new Set(b.values);
  return (
    a.questionId === b.questionId &&
    left.size === right.size &&
    [...left].every((token) => right.has(token))
  );
};

/**
 * The pure rule's refusal as the coded 409: `condition_invalid` or `condition_order` in `details.profileForm`,
 * with `openerId` for the order (and `questionId` when the subject exists already; a question being created has
 * none yet). Nothing is written, the caller's transaction rolls back.
 */
function refuseCondition(check: ConditionCheck, subjectId?: string): void {
  if (check.ok) return;
  throw new ApiError(409, 'CONFLICT', {
    profileForm: check.issue,
    ...(subjectId !== undefined ? { questionId: subjectId } : {}),
    ...(check.openerId !== undefined ? { openerId: check.openerId } : {}),
  });
}

/** D-632: the opener's refusal as the coded 409 `has_dependents` with the ACTIVE dependents it lists. */
function refuseDependents(refusal: ReturnType<typeof checkOpenerChange>): void {
  if (refusal === null) return;
  throw hasDependents(refusal.dependents);
}

const hasDependents = (dependents: { id: string; title: string }[]) =>
  new ApiError(409, 'CONFLICT', { profileForm: 'has_dependents', dependents });

/** `text[]` of the tokens, in order, from a JSON array (a JS array would expand into a record). */
const textArray = (values: readonly string[]) =>
  sql`array(select t.e from jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)
            with ordinality as t(e, n) order by t.n)`;

/**
 * Runs one write inside a SAVEPOINT, so a database error leaves the transaction usable: the caller can read the
 * current dependents of an opener before it refuses. Answers the value or the error; it never throws a
 * database error itself.
 */
async function attempt<T>(
  tx: Tx,
  run: () => Promise<T>,
): Promise<{ value: T } | { error: unknown }> {
  await tx.execute(sql`savepoint pf_attempt`);
  try {
    const value = await run();
    await tx.execute(sql`release savepoint pf_attempt`);
    return { value };
  } catch (error) {
    await tx.execute(sql`rollback to savepoint pf_attempt`);
    return { error };
  }
}

/**
 * A write the guard trigger can still refuse in a race that got past the service (PF001..PF007): the same coded
 * 409 as the pure rules, never a 500. PF007 (`has_dependents`) re-reads the opener's dependents NOW (the savepoint
 * keeps the transaction alive for it), so the list is what a second writer just committed.
 */
async function guardedWrite<T>(
  tx: Tx,
  tenantId: string,
  openerId: string,
  run: () => Promise<T>,
): Promise<T> {
  const out = await attempt(tx, run);
  if ('value' in out) return out.value;
  const issue = guardIssueOf(out.error);
  if (!issue) throw out.error;
  if (issue === 'has_dependents') {
    const fresh = await readLayout(tx, tenantId);
    throw hasDependents(dependentsOf(fresh.questions, openerId));
  }
  throw new ApiError(409, 'CONFLICT', { profileForm: issue });
}

/**
 * `POST /v1/profile_form/questions` (PFORM-02, D-627): a new question at the END of the named step (default:
 * the last step; the default step is created when the form has none). A question created WITH a condition whose
 * opener is in that same step is placed right after the opener, or after its last active dependent, instead
 * (quick 261106-ei5); with the opener in another step it keeps the end of the step. The body is already validated by the
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
    // A question with a condition whose opener is in the SAME step goes right after the opener (or after its last
    // active dependent); any other question goes to the end of its step. ONE function builds the layout for the
    // order check and for the write, so the layout that is checked is the layout that is stored.
    const openerId = body.condition ? body.condition.questionId.toLowerCase() : null;
    const layoutWith = (questionId: string) =>
      layoutOrThrow(
        addQuestionAfterOpener(target.layout, target.stepId, questionId, openerId, read.facts),
      );
    // D-620..D-623: a condition is accepted only through the pure rule, over the layout the question will have.
    // The opener must be an ACTIVE question of THIS tenant: a foreign and a missing id are the same refusal
    // (T-12.1-01), and the composite foreign key is the backstop.
    if (body.condition) {
      const probe = crypto.randomUUID();
      refuseCondition(
        checkCondition({
          questions: read.questions,
          layout: layoutWith(probe),
          subjectId: probe,
          condition: { ...body.condition, questionId: body.condition.questionId.toLowerCase() },
        }),
      );
    }
    const id = await insertQuestion(tx, ctx, body, target.stepId, null);
    const next = layoutWith(id);
    // An append to the very end of the form moves nobody: the insert already gave it max(position) + 1, so no
    // other row is touched and a member's save in flight is never waited for (the Phase 12 adjacency rule).
    // Anywhere else the later questions shift, and the whole layout is renumbered in one statement.
    if (!endsWith(next, id)) await writeLayout(tx, ctx.tenantId, next);
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
  const condition = body.condition ?? null;
  const [created] = await tx.execute<{ id: string }>(sql`
    insert into public.profile_form_questions
      (tenant_id, step_id, type, title, help_text, required, show_on_profile, allow_other, options, limits,
       position, revision, listed_at, created_by_user_id, condition_question_id, condition_values)
    values (${ctx.tenantId}::uuid, ${stepId}::uuid, ${body.type}, ${body.title}, ${body.helpText},
            ${body.required}, ${body.showOnProfile}, ${body.allowOther}, ${JSON.stringify(options)}::jsonb,
            ${JSON.stringify(body.limits)}::jsonb,
            coalesce(${position}::int,
              (select coalesce(max(position), 0) + 1
                 from public.profile_form_questions
                where tenant_id = ${ctx.tenantId}::uuid and archived_at is null)),
            1, now(), ${ctx.userId}::uuid,
            ${condition === null ? null : condition.questionId.toLowerCase()}::uuid,
            ${condition === null ? sql`null::text[]` : textArray(condition.values)})
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
    // this transaction never waits for a row a member's save already holds while that save waits for ours. Any
    // other edit reads it unlocked: the condition rules (12.1) look at the tenant's active questions.
    const read = await readLayout(tx, ctx.tenantId, body.stepId !== undefined);

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
    if (body.stepId !== undefined) {
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

    // D-625, D-620..D-623: `condition` undefined leaves the stored one, `null` removes it (allowed at any answer
    // count, nothing is discarded), an object gains or changes it: the lock first (a question with answers
    // cannot), then the pure rule over the layout the question will have. An unchanged condition is not
    // re-checked, so a rename passes at any answer count.
    const storedCondition = conditionOf(row);
    let conditionWrite: { to: ProfileFormCondition | null } | null = null;
    if (body.condition !== undefined) {
      const wanted: ProfileFormCondition | null =
        body.condition === null
          ? null
          : { ...body.condition, questionId: body.condition.questionId.toLowerCase() };
      const lock = checkConditionLock({
        answerCount: counts.perQuestion.get(row.id) ?? 0,
        current: storedCondition,
        next: wanted,
      });
      if (lock) throw new ApiError(409, 'CONFLICT', { profileForm: lock });
      if (!sameCondition(storedCondition, wanted)) {
        refuseCondition(
          checkCondition({
            questions: read.questions,
            layout: moved ?? read.layout,
            subjectId: row.id,
            condition: wanted,
          }),
          row.id,
        );
        conditionWrite = { to: wanted };
      }
    }

    // D-632: an opener that still opens others cannot change type or lose an option an ACTIVE dependent's
    // condition names. Checked before the answer locks, as the trigger does (PF007 before PF001).
    const nextOptionIds = new Set(next.options.map((option) => option.id));
    refuseDependents(
      checkOpenerChange({
        questions: read.questions,
        openerId: row.id,
        nextType: next.type,
        removedOptionIds: current.options
          .map((option) => option.id)
          .filter((optionId) => !nextOptionIds.has(optionId)),
      }),
    );

    const locked = checkLocks({
      current,
      next,
      answerCount: counts.perQuestion.get(row.id) ?? 0,
      answeredOptionIds: new Set(counts.perOption.get(row.id)?.keys() ?? []),
      otherAnswered: await otherAnswered(tx, ctx.tenantId, row.id),
    });
    if (locked) throw new ApiError(409, 'CONFLICT', { profileForm: locked });

    assertValidDefinition(next);
    const edited = !unchanged(current, next) || conditionWrite !== null;
    if (!edited && moved === null) return toAdminQuestion(row, counts);

    // The layout write bumps the revision of a question that changed step, so a move plus an edit is ONE bump.
    if (moved !== null) await writeLayout(tx, ctx.tenantId, moved);
    if (edited) {
      const conditionSet =
        conditionWrite === null
          ? sql``
          : conditionWrite.to === null
            ? sql`, condition_question_id = null, condition_values = null`
            : sql`, condition_question_id = ${conditionWrite.to.questionId}::uuid,
                   condition_values = ${textArray(conditionWrite.to.values)}`;
      // The trigger is the backstop of a race that got past the pure rules: the same coded 409, never a 500
      // (PF007 also lists the dependents a second writer just committed).
      await guardedWrite(tx, ctx.tenantId, row.id, () =>
        tx.execute(sql`
          update public.profile_form_questions
             set type = ${next.type}, title = ${next.title}, help_text = ${next.helpText},
                 required = ${next.required}, show_on_profile = ${next.showOnProfile},
                 allow_other = ${next.allowOther}, options = ${JSON.stringify(next.options)}::jsonb,
                 limits = ${JSON.stringify(next.limits)}::jsonb${conditionSet},
                 revision = revision + ${moved === null ? 1 : 0}::int, updated_at = now()
           where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`),
      );
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

    const read = await readLayout(tx, ctx.tenantId, true);
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

    // The layout first, the row after. Only the questions AFTER this one change place, so `writeLayout` takes
    // them in the canonical order, behind the row lock below (no cycle with a member's ordered share locks).
    const read = await readLayout(tx, ctx.tenantId);
    const row = await readOne(tx, ctx.tenantId, id, true);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (row.archived_at !== null) return archivedQuestionOf(tx, ctx.tenantId, row);

    // D-632: an opener with active dependents is not archived (the list names them); the trigger's PF007 is
    // the backstop of a race.
    refuseDependents(
      checkOpenerChange({ questions: read.questions, openerId: row.id, archive: true }),
    );
    await guardedWrite(tx, ctx.tenantId, row.id, () =>
      tx.execute(sql`
        update public.profile_form_questions
           set archived_at = now(), revision = revision + 1, updated_at = now()
         where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`),
    );
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
    // D-632: a shown question comes back only while its opener still holds: active, still eligible, no condition
    // of its own, and before it. A refusal names the opener (`openerId`); pure, no extra lock on the hot path.
    const openerId = row.condition_question_id;
    if (openerId !== null) {
      const check = checkReactivation({
        questions: [...read.questions, ruleQuestionOf({ ...row, archived_at: null })],
        layout: next,
        questionId: row.id,
      });
      if (!check.ok) {
        throw new ApiError(409, 'CONFLICT', {
          profileForm: check.issue,
          openerId: check.openerId ?? openerId,
        });
      }
    }
    assertLayoutOrder(
      next,
      openerId !== null ? [...read.facts, { questionId: row.id, openerId }] : read.facts,
    );

    // The end of ITS step is the end of the form only for the last step; there it takes max(position) + 1 of the
    // other active questions and nobody else is touched (a save in flight is never waited for). Anywhere else
    // the later questions shift and the whole layout is renumbered below.
    await tx.execute(sql`
      update public.profile_form_questions
         set archived_at = null, listed_at = now(), revision = revision + 1, updated_at = now(),
             position = (select coalesce(max(position), 0) + 1
                           from public.profile_form_questions
                          where tenant_id = ${ctx.tenantId}::uuid and archived_at is null)
       where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    if (!endsWith(next, row.id)) await writeLayout(tx, ctx.tenantId, next);
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

    // D-632: an opener with active dependents is not deleted. Its ARCHIVED dependents do not block, but the
    // composite foreign key still points at it, so their condition is cleared in this transaction (an archived
    // question is read-only to members; removing a condition is allowed at any answer count and discards no
    // answer). Without it the delete would end in the foreign key.
    refuseDependents(
      checkOpenerChange({ questions: read.questions, openerId: row.id, archive: true }),
    );
    await tx.execute(sql`
      update public.profile_form_questions
         set condition_question_id = null, condition_values = null, updated_at = now()
       where tenant_id = ${ctx.tenantId}::uuid and condition_question_id = ${row.id}::uuid
         and archived_at is not null`);

    const out = await attempt(tx, () =>
      tx.execute(sql`
        delete from public.profile_form_questions
         where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`),
    );
    if ('error' in out) {
      if (!hasSqlState(out.error, '23503')) throw out.error;
      // A foreign key in a race: a second writer gave the question a dependent, or an answer, after the checks.
      const dependents = dependentsOf((await readLayout(tx, ctx.tenantId)).questions, row.id);
      if (dependents.length > 0) throw hasDependents(dependents);
      throw new ApiError(409, 'CONFLICT', { profileForm: 'has_answers' });
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

    // D-632: replacing archives the old question, so an opener with active dependents is refused (and listed).
    refuseDependents(
      checkOpenerChange({ questions: read.questions, openerId: old.id, archive: true }),
    );
    // The replacement's own condition (D-620..D-623) is checked over the layout it will have: it takes the old
    // question's place, so an opener that IS the old question is no longer in the layout (condition_invalid).
    if (body.condition) {
      const probe = crypto.randomUUID();
      refuseCondition(
        checkCondition({
          questions: read.questions,
          layout: swapQuestion(read.layout, old.id, probe),
          subjectId: probe,
          condition: { ...body.condition, questionId: body.condition.questionId.toLowerCase() },
        }),
      );
    }

    const createdId = await insertQuestion(tx, ctx, body, old.step_id, old.position);
    const next = swapQuestion(read.layout, old.id, createdId);
    assertLayoutOrder(next, read.facts);
    await guardedWrite(tx, ctx.tenantId, old.id, () =>
      tx.execute(sql`
        update public.profile_form_questions
           set archived_at = now(), revision = revision + 1, updated_at = now()
         where id = ${old.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`),
    );
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
 * `GET /v1/profile_form/summary` (PFORM-23, PFORM-38, D-634): `{ total, complete, hasRequired }` in ONE set-based
 * statement. `complete` is the members who owe NO VISIBLE required question: a required, active question with no
 * answer row of that member, and either no condition or an answer of that member to the opener whose tokens
 * overlap the condition values. This repeats the predicate of the gate function `app.profile_form_missing`
 * (which the tenant lane cannot call: it takes an arbitrary membership id and is granted to the API and service
 * roles only); the integration test asserts the two never drift. A member who does not see a conditional
 * required question is complete without it. Counts only: no answer is selected.
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
        select q.id, q.condition_question_id, q.condition_values
          from public.profile_form_questions q
         where q.tenant_id = ${ctx.tenantId}::uuid and q.required and q.archived_at is null)
      select (select count(*) from members)::int as total,
             (select count(*)
                from members m
               where not exists (
                 select 1
                   from req r
                  where not exists (
                          select 1 from public.profile_form_answers a
                           where a.tenant_id = ${ctx.tenantId}::uuid
                             and a.membership_id = m.id
                             and a.question_id = r.id)
                    and (r.condition_question_id is null
                         or exists (
                           select 1 from public.profile_form_answers o
                            where o.tenant_id = ${ctx.tenantId}::uuid
                              and o.membership_id = m.id
                              and o.question_id = r.condition_question_id
                              and r.condition_values && app.profile_form_answer_tokens(o.value)))
               ))::int as complete,
             exists (select 1 from req) as has_required`,
    );
    return {
      total: Number(row?.total ?? 0),
      complete: Number(row?.complete ?? 0),
      hasRequired: row?.has_required === true,
    };
  });
}

/** Members who have an answer to `openerId` whose tokens overlap `values` (they SEE a question it opens). */
const SEES_THROUGH = (tenantId: string, openerId: string, values: readonly string[]) => sql`
  exists (
    select 1 from public.profile_form_answers o
     where o.tenant_id = ${tenantId}::uuid
       and o.membership_id = members.id
       and o.question_id = ${openerId}::uuid
       and ${textArray(values)} && app.profile_form_answer_tokens(o.value))`;

/** Members with no answer row for the question. */
const LACKS_ANSWER = (tenantId: string, questionId: string) => sql`
  not exists (
    select 1 from public.profile_form_answers a
     where a.tenant_id = ${tenantId}::uuid
       and a.membership_id = members.id
       and a.question_id = ${questionId}::uuid)`;

/**
 * `GET /v1/profile_form/impact` (D-585, D-634, PFORM-23, PFORM-38): how many members a change would ask to answer,
 * were it applied now, counting only the members who would SEE the question.
 *
 *   - `create_required` and `replace` count every member, or, with `conditionQuestionId` and `conditionValues`,
 *     the members whose answer to that opener overlaps the values (the opener must be an ACTIVE question of this
 *     tenant: a foreign or missing id is the bare 404, which reveals nothing; one of the two parameters alone
 *     is 400 `invalid`);
 *   - `make_required` and `reactivate` count the members with no answer to `questionId`, and, for a conditional
 *     question, only those who see it;
 *   - `remove_condition` (needs `questionId`) counts the members who do NOT see the question today and lack an
 *     answer to it: they are the ones who newly owe it. It is 0 for an unconditional, an optional or an archived
 *     question.
 *
 * A change that asks nobody is 0. `questionId` is needed by the last three kinds (400 `invalid` without it) and
 * an unknown or foreign one is the bare 404. A count only: no member and no answer is ever selected.
 */
export async function getImpact(ctx: AdminCtx, query: ImpactQuery): Promise<ImpactResult> {
  return withTenantTx(ctx, async (tx) => {
    await requireModuleOn(tx, ctx);

    const count = async (where: ReturnType<typeof sql>): Promise<ImpactResult> => {
      const [counted] = await tx.execute<{ n: number | string }>(sql`
        select count(*)::int as n from (${ACTIVE_MEMBERS(ctx.tenantId)}) members where ${where}`);
      return { members: Number(counted?.n ?? 0) };
    };

    if (query.change === 'create_required' || query.change === 'replace') {
      const values =
        query.conditionValues === undefined ? [] : parseConditionValues(query.conditionValues);
      if ((query.conditionQuestionId === undefined) !== (values.length === 0)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'invalid' });
      }
      if (query.conditionQuestionId === undefined) return count(sql`true`);
      const opener = await readOne(tx, ctx.tenantId, query.conditionQuestionId);
      if (!opener || opener.archived_at !== null) throw new ApiError(404, 'NOT_FOUND');
      return count(SEES_THROUGH(ctx.tenantId, opener.id, values));
    }

    if (query.questionId === undefined) {
      throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'invalid' });
    }
    const row = await readOne(tx, ctx.tenantId, query.questionId);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const condition = conditionOf(row);

    if (query.change === 'remove_condition') {
      if (condition === null || !row.required || row.archived_at !== null) return { members: 0 };
      return count(
        sql`not ${SEES_THROUGH(ctx.tenantId, condition.questionId, condition.values)}
            and ${LACKS_ANSWER(ctx.tenantId, row.id)}`,
      );
    }

    const asksNobody =
      query.change === 'reactivate'
        ? row.archived_at === null || !row.required
        : row.archived_at !== null || row.required;
    if (asksNobody) return { members: 0 };

    return count(
      condition === null
        ? LACKS_ANSWER(ctx.tenantId, row.id)
        : sql`${LACKS_ANSWER(ctx.tenantId, row.id)}
              and ${SEES_THROUGH(ctx.tenantId, condition.questionId, condition.values)}`,
    );
  });
}
