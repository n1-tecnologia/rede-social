import {
  type AdminQuestion,
  type AdminQuestionList,
  type CreateQuestionBody,
  createQuestionBodySchema,
  PROFILE_FORM_CHOICE_TYPES,
  PROFILE_FORM_ISSUE_SET,
  PROFILE_FORM_LIMITS,
  type ProfileFormType,
  type UpdateQuestionBody,
} from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { checkLocks, guardIssueOf, type LockDefinition } from './lock-rules';
import { liveModuleOn } from './member';

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
  q.id::text as id, q.type, q.title, q.help_text, q.required, q.show_on_profile, q.allow_other,
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
 * and per option, `activeCount` and `limit`. A tenant with no question is `{ questions: [], activeCount: 0,
 * limit: 30 }`.
 */
export async function listQuestions(ctx: AdminCtx): Promise<AdminQuestionList> {
  return withTenantTx(ctx, async (tx) => {
    await requireModuleOn(tx, ctx);
    return listInTx(tx, ctx.tenantId);
  });
}

/**
 * `POST /v1/profile_form/questions` (PFORM-02): a new question at the end of the list. The body is already
 * validated by the contract (title and help text trimmed, 2 to 20 distinct options for a choice type, limits
 * of the right kind). The server decides the rest: a UUID for every option, `position` = last + 1, revision 1,
 * `listed_at` now and the caller as the author.
 *
 *   - 404 `MODULE_DISABLED` when the module is off (live read);
 *   - 409 `limit_reached` at 30 ACTIVE questions (counted under the advisory lock, so two simultaneous
 *     creates at 29 end with exactly 30).
 */
export async function createQuestion(
  ctx: AdminCtx,
  body: CreateQuestionBody,
): Promise<AdminQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const [counted] = await tx.execute<{ n: number | string }>(sql`
      select count(*)::int as n
        from public.profile_form_questions
       where tenant_id = ${ctx.tenantId}::uuid and archived_at is null`);
    if (Number(counted?.n ?? 0) >= PROFILE_FORM_LIMITS.activeQuestions) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'limit_reached' });
    }

    const options = isChoiceType(body.type)
      ? body.options.map((option) => ({ id: crypto.randomUUID(), label: option.label.trim() }))
      : [];
    const [created] = await tx.execute<{ id: string }>(sql`
      insert into public.profile_form_questions
        (tenant_id, type, title, help_text, required, show_on_profile, allow_other, options, limits,
         position, revision, listed_at, created_by_user_id)
      values (${ctx.tenantId}::uuid, ${body.type}, ${body.title}, ${body.helpText}, ${body.required},
              ${body.showOnProfile}, ${body.allowOther}, ${JSON.stringify(options)}::jsonb,
              ${JSON.stringify(body.limits)}::jsonb,
              (select coalesce(max(position), 0) + 1
                 from public.profile_form_questions
                where tenant_id = ${ctx.tenantId}::uuid and archived_at is null),
              1, now(), ${ctx.userId}::uuid)
      returning id::text as id`);
    if (!created) throw new Error('createQuestion: the insert returned no row');
    const row = await readOne(tx, ctx.tenantId, created.id);
    if (!row) throw new Error('createQuestion: the new question is not readable');
    return adminQuestionOf(tx, ctx.tenantId, row);
  });
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
 *      bumped by one in the same statement.
 */
export async function updateQuestion(
  ctx: AdminCtx,
  id: string,
  body: UpdateQuestionBody,
): Promise<AdminQuestion> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const row = await readOne(tx, ctx.tenantId, id, true);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (row.archived_at !== null) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'already_archived' });
    }
    if (body.revision !== row.revision) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'stale_revision' });
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
    if (unchanged(current, next)) return toAdminQuestion(row, counts);

    try {
      await tx.execute(sql`
        update public.profile_form_questions
           set type = ${next.type}, title = ${next.title}, help_text = ${next.helpText},
               required = ${next.required}, show_on_profile = ${next.showOnProfile},
               allow_other = ${next.allowOther}, options = ${JSON.stringify(next.options)}::jsonb,
               limits = ${JSON.stringify(next.limits)}::jsonb,
               revision = revision + 1, updated_at = now()
         where id = ${row.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    } catch (error) {
      // The trigger is the backstop of a race that got past `checkLocks`: the same coded 409, never a 500.
      const issue = guardIssueOf(error);
      if (issue) throw new ApiError(409, 'CONFLICT', { profileForm: issue });
      throw error;
    }
    const updated = await readOne(tx, ctx.tenantId, row.id);
    if (!updated) throw new Error('updateQuestion: the edited question is not readable');
    return adminQuestionOf(tx, ctx.tenantId, updated);
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
 * `PUT /v1/profile_form/order` (PFORM-02, PFORM-24; D-582): the whole active list in its new order. The stored
 * `position` IS the order members see, so the rewrite renumbers `1..n` in ONE set-based statement.
 *
 *   1. `adminLock`, the live module check, then EVERY active row `FOR UPDATE` in the canonical order
 *      `position, created_at, id` (the order the member's save locks in, so the two can never deadlock);
 *   2. the submitted ids must be EXACTLY the set of active ids (no missing one, no extra, no repeat, no
 *      archived one, none of another tenant): anything else is 409 `order_mismatch` and nothing changes. An id
 *      of another tenant is just an id that is not in the set, so it leaks nothing;
 *   3. the `revision` is NOT bumped: the member's `formEtag` already depends on the id sequence.
 *
 * Answers the refreshed list.
 */
export async function reorderQuestions(
  ctx: AdminCtx,
  ids: readonly string[],
): Promise<AdminQuestionList> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const locked = await tx.execute<{ id: string }>(sql`
      select q.id::text as id
        from public.profile_form_questions q
       where q.tenant_id = ${ctx.tenantId}::uuid and q.archived_at is null
       order by q.position, q.created_at, q.id
         for update`);
    const active = new Set(locked.map((row) => row.id));
    const wanted = ids.map((id) => id.toLowerCase());
    if (
      wanted.length !== active.size ||
      new Set(wanted).size !== wanted.length ||
      wanted.some((id) => !active.has(id))
    ) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'order_mismatch' });
    }

    await tx.execute(sql`
      update public.profile_form_questions q
         set position = o.ord::int, updated_at = now()
        from jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb) with ordinality as o(id, ord)
       where q.id = o.id::uuid and q.tenant_id = ${ctx.tenantId}::uuid`);
    return listInTx(tx, ctx.tenantId);
  });
}
