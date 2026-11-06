import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';
import { ApiError } from '../http/api-error';
import { type BranchRuleBranch, type BranchRuleQuestion, branchFactsOf } from './branch-rules';
import type { RuleQuestion } from './condition-rules';
import { checkLayoutOrder, flatten, type Layout, type LayoutResult, renumber } from './layout';

/**
 * The store half of the layout writes (Phase 12.1 plan 09, D-623, D-627; PFORM-27, PFORM-28, PFORM-29): the
 * LOCKED read of the tenant's steps and active questions as one `Layout`, and the ONE-STATEMENT renumber that
 * writes a `Layout` back. The pure operations (`layout.ts`) sit between the two:
 *
 *   readLayout -> one pure operation -> checkLayoutOrder (D-623) -> writeLayout
 *
 * The caller holds `adminLock` (T-12.1-13) and has checked the live module row. Nothing here deletes a question
 * or an answer: a write only changes `position`, `step_id` and `revision`.
 */

/** A pair the order rule is about: the question is shown by the opener and must come after it (D-623). */
export type OrderFact = { questionId: string; openerId: string };

export type LayoutRead = {
  layout: Layout;
  /** The ACTIVE questions, for the condition rules. */
  questions: RuleQuestion[];
  /** `(questionId, openerId)` of every ACTIVE conditional question. */
  facts: OrderFact[];
};

/**
 * 12.2 (D-640, D-652): the tenant's form as the branch rules and the tree normaliser read it. Added beside the
 * 12.1 `LayoutRead`, which stays until the callers have moved over (it is renamed in the last task of plan 09).
 */
export type TreeRead = {
  layout: Layout;
  /** EVERY question of the tenant: the ACTIVE ones in `position, created_at, id` order, then the archived ones. */
  questions: BranchRuleQuestion[];
  /** EVERY branch of the tenant, `created_at, id`. */
  branches: BranchRuleBranch[];
  /** `(questionId, openerId)` of every ACTIVE question that sits in an ACTIVE branch (`branchFactsOf`). */
  facts: OrderFact[];
};

type StoredStep = { id: string };
type StoredLayoutQuestion = {
  id: string;
  step_id: string;
  type: string;
  title: string;
  options: { id: string }[];
  condition_question_id: string | null;
  condition_values: string[] | null;
};

/**
 * The tenant's layout. The steps are read `order by position, created_at, id for update` (a member's save
 * never touches a step). The ACTIVE questions are read in the same total order, and `lockRows` decides whether
 * they are also locked `for update`:
 *
 *   - `lockRows: true` (a reorder, a move): the write can change ANY question's place, so every active row is
 *     taken now, in the canonical order the member's lock function takes them in, and no pair of transactions
 *     can deadlock;
 *   - `lockRows: false` (the default): the caller holds `adminLock`, which already serialises the admins, and
 *     `writeLayout` takes only the rows whose place actually changes, in the same canonical order. So a create
 *     at the end of the last step, or a reactivation, never waits for a member's save (the Phase 12 adjacency
 *     rule), while a write that shifts other rows waits for them.
 *
 * A tenant that never built a form has an empty layout.
 */
export async function readLayout(tx: Tx, tenantId: string, lockRows = false): Promise<LayoutRead> {
  const steps = await tx.execute<StoredStep>(sql`
    select s.id::text as id
      from public.profile_form_steps s
     where s.tenant_id = ${tenantId}::uuid
     order by s."position", s.created_at, s.id
       for update`);
  const rows = await tx.execute<StoredLayoutQuestion>(
    lockRows
      ? sql`
        select q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.options,
               q.condition_question_id::text as condition_question_id, q.condition_values
          from public.profile_form_questions q
         where q.tenant_id = ${tenantId}::uuid and q.archived_at is null
         order by q."position", q.created_at, q.id
           for update`
      : sql`
        select q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.options,
               q.condition_question_id::text as condition_question_id, q.condition_values
          from public.profile_form_questions q
         where q.tenant_id = ${tenantId}::uuid and q.archived_at is null
         order by q."position", q.created_at, q.id`,
  );

  const layout: Layout = steps.map((step) => ({
    stepId: step.id,
    questionIds: rows.filter((row) => row.step_id === step.id).map((row) => row.id),
  }));
  const questions: RuleQuestion[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    archived: false,
    options: row.options.map((option) => ({ id: option.id })),
    conditionQuestionId: row.condition_question_id,
    conditionValues: row.condition_values,
  }));
  const facts: OrderFact[] = rows.flatMap((row) =>
    row.condition_question_id === null
      ? []
      : [{ questionId: row.id, openerId: row.condition_question_id }],
  );
  return { layout, questions, facts };
}

type TreeQuestionRow = {
  id: string;
  type: string;
  title: string;
  show_on_profile: boolean;
  options: { id: string }[];
  branch_id: string | null;
};

type TreeBranchRow = {
  id: string;
  opener_question_id: string;
  open_values: string[];
  name: string | null;
  archived: boolean;
};

/**
 * 12.2 (D-652): the tree the writes judge over, in the CANONICAL LOCK ORDER of the phase: the steps `for update`,
 * the ACTIVE questions in `position, created_at, id` order (`for update` when `lockRows`), the archived
 * questions (read, never locked: an archived question is read-only to members) and last the branches
 * `created_at, id` (`for update` when `lockRows`). `lockRows` has the meaning it has in `readLayout`: a write
 * that can change ANY question's place takes every row and branch now, so it can never deadlock with a member's
 * save (which takes the questions `for share` in the same order and the branches after them). The caller holds
 * `adminLock` and has checked the live module row.
 */
export async function readTree(tx: Tx, tenantId: string, lockRows = false): Promise<TreeRead> {
  const steps = await tx.execute<StoredStep>(sql`
    select s.id::text as id
      from public.profile_form_steps s
     where s.tenant_id = ${tenantId}::uuid
     order by s."position", s.created_at, s.id
       for update`);
  const active = await tx.execute<TreeQuestionRow & { step_id: string }>(
    lockRows
      ? sql`
        select q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.show_on_profile, q.options,
               q.branch_id::text as branch_id
          from public.profile_form_questions q
         where q.tenant_id = ${tenantId}::uuid and q.archived_at is null
         order by q."position", q.created_at, q.id
           for update`
      : sql`
        select q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.show_on_profile, q.options,
               q.branch_id::text as branch_id
          from public.profile_form_questions q
         where q.tenant_id = ${tenantId}::uuid and q.archived_at is null
         order by q."position", q.created_at, q.id`,
  );
  const archived = await tx.execute<TreeQuestionRow>(sql`
    select q.id::text as id, q.type, q.title, q.show_on_profile, q.options, q.branch_id::text as branch_id
      from public.profile_form_questions q
     where q.tenant_id = ${tenantId}::uuid and q.archived_at is not null
     order by q."position", q.created_at, q.id`);
  const branchRows = await tx.execute<TreeBranchRow>(
    lockRows
      ? sql`
        select b.id::text as id, b.opener_question_id::text as opener_question_id, b.open_values, b.name,
               b.archived_at is not null as archived
          from public.profile_form_branches b
         where b.tenant_id = ${tenantId}::uuid
         order by b.created_at, b.id
           for update`
      : sql`
        select b.id::text as id, b.opener_question_id::text as opener_question_id, b.open_values, b.name,
               b.archived_at is not null as archived
          from public.profile_form_branches b
         where b.tenant_id = ${tenantId}::uuid
         order by b.created_at, b.id`,
  );

  const layout: Layout = steps.map((step) => ({
    stepId: step.id,
    questionIds: active.filter((row) => row.step_id === step.id).map((row) => row.id),
  }));
  const toRule = (row: TreeQuestionRow, isArchived: boolean): BranchRuleQuestion => ({
    id: row.id,
    type: row.type,
    title: row.title,
    archived: isArchived,
    showOnProfile: row.show_on_profile,
    options: row.options.map((option) => ({ id: option.id })),
    branchId: row.branch_id,
  });
  const questions = [
    ...active.map((row) => toRule(row, false)),
    ...archived.map((row) => toRule(row, true)),
  ];
  const branches: BranchRuleBranch[] = branchRows.map((row) => ({
    id: row.id,
    openerQuestionId: row.opener_question_id,
    values: [...row.open_values],
    archived: row.archived,
    name: row.name,
  }));
  return { layout, questions, branches, facts: branchFactsOf(questions, branches) };
}

/**
 * Writes the layout in TWO set-based statements, so the readers' `order by position, created_at, id` is
 * unchanged and positions are contiguous `1..n` over the active questions:
 *
 *   1. every question whose `position` or `step_id` changes gets both, together; a question that CHANGED STEP
 *      also gets its `revision` bumped (a pure reorder inside a step keeps revisions, as in Phase 12);
 *   2. every step whose `position` changes gets it, with its `revision` bumped.
 *
 * The statement shape is `rows from (jsonb_to_recordset(...)) with ordinality`: Postgres REJECTS the shorter
 * `jsonb_to_recordset(...) with ordinality as o(id uuid, ...)` (SQLSTATE 42601, proved in
 * `supabase/tests/225-profile-form-steps-conditions.sql`). Both statements filter by `tenant_id` and by the
 * ids of the locked layout only (T-12.1-01).
 */
export async function writeLayout(tx: Tx, tenantId: string, layout: Layout): Promise<void> {
  const rows = renumber(layout);
  if (rows.length > 0) {
    await lockChangedRows(tx, tenantId, rows);
    const json = JSON.stringify(rows.map((row) => ({ id: row.id, step_id: row.stepId })));
    await tx.execute(sql`
      update public.profile_form_questions q
         set position = o.ord::int,
             step_id = o.step_id,
             revision = case when q.step_id is distinct from o.step_id then q.revision + 1 else q.revision end,
             updated_at = now()
        from rows from (jsonb_to_recordset(${json}::jsonb) as (id uuid, step_id uuid)) with ordinality
             as o(id, step_id, ord)
       where q.id = o.id and q.tenant_id = ${tenantId}::uuid
         and (q.position is distinct from o.ord::int or q.step_id is distinct from o.step_id)`);
  }
  if (layout.length > 0) {
    const stepsJson = JSON.stringify(layout.map((step) => ({ id: step.stepId })));
    await tx.execute(sql`
      update public.profile_form_steps s
         set "position" = o.ord::int, revision = s.revision + 1, updated_at = now()
        from rows from (jsonb_to_recordset(${stepsJson}::jsonb) as (id uuid)) with ordinality as o(id, ord)
       where s.id = o.id and s.tenant_id = ${tenantId}::uuid
         and s."position" is distinct from o.ord::int`);
  }
}

type StoredPlace = { id: string; position: number | string; step_id: string };

/**
 * Takes `for update`, in the canonical order `position, created_at, id` (the order the member's lock function
 * takes them in), exactly the rows whose `position` or `step_id` the renumber is about to change. A row that
 * keeps its place is not touched, so an append to the end of the form waits for nobody, and the rows that do
 * change are acquired in the same total order as everyone else's (T-12.1-13, no deadlock). Rows already
 * locked by the caller are locked again for free.
 */
async function lockChangedRows(
  tx: Tx,
  tenantId: string,
  rows: readonly { id: string; stepId: string; position: number }[],
): Promise<void> {
  const idsJson = JSON.stringify(rows.map((row) => row.id));
  const stored = await tx.execute<StoredPlace>(sql`
    select q.id::text as id, q."position" as position, q.step_id::text as step_id
      from public.profile_form_questions q
     where q.tenant_id = ${tenantId}::uuid
       and q.id in (select e::uuid from jsonb_array_elements_text(${idsJson}::jsonb) e)`);
  const wanted = new Map(rows.map((row) => [row.id, row] as const));
  const changed = stored.filter((row) => {
    const next = wanted.get(row.id);
    return (
      next !== undefined && (Number(row.position) !== next.position || row.step_id !== next.stepId)
    );
  });
  if (changed.length === 0) return;
  const changedJson = JSON.stringify(changed.map((row) => row.id));
  await tx.execute(sql`
    select q.id
      from public.profile_form_questions q
     where q.tenant_id = ${tenantId}::uuid
       and q.id in (select e::uuid from jsonb_array_elements_text(${changedJson}::jsonb) e)
     order by q."position", q.created_at, q.id
       for update`);
}

/** Whether the question is the LAST one of the flattened layout (an append to the very end of the form). */
export function endsWith(layout: Layout, questionId: string): boolean {
  return flatten(layout).at(-1) === questionId;
}

/** The layout without one question (an archive or a delete); a question that is not in it changes nothing. */
export function dropQuestion(layout: Layout, questionId: string): Layout {
  return layout.map((step) => ({
    stepId: step.stepId,
    questionIds: step.questionIds.filter((id) => id !== questionId),
  }));
}

/** The layout with `oldId` replaced in place by `newId` (a replace keeps step AND position, D-627). */
export function swapQuestion(layout: Layout, oldId: string, newId: string): Layout {
  return layout.map((step) => ({
    stepId: step.stepId,
    questionIds: step.questionIds.map((id) => (id === oldId ? newId : id)),
  }));
}

/**
 * The layout of a pure operation, or the coded refusal: `unknown_step` is the 400 of a step that is not the
 * tenant's (a foreign and a missing id answer the same, T-12.1-10), anything else is a 409 `CONFLICT`
 * carrying only the machine code.
 */
export function layoutOrThrow(result: LayoutResult): Layout {
  if (result.ok) return result.layout;
  if (result.issue === 'unknown_step') {
    throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'unknown_step' });
  }
  throw new ApiError(409, 'CONFLICT', { profileForm: result.issue });
}

/** D-623 over a whole layout: 409 `condition_order` naming the first violated pair, or nothing. */
export function assertLayoutOrder(layout: Layout, facts: readonly OrderFact[]): void {
  const check = checkLayoutOrder(layout, facts);
  if (check.ok) return;
  throw new ApiError(409, 'CONFLICT', {
    profileForm: 'condition_order',
    questionId: check.questionId,
    openerId: check.openerId,
  });
}
