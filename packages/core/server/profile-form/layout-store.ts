import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';
import { ApiError } from '../http/api-error';
import type { RuleQuestion } from './condition-rules';
import { checkLayoutOrder, type Layout, type LayoutResult, renumber } from './layout';

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
 * The tenant's layout, read under the canonical locks: the steps `order by position, created_at, id for
 * update`, then the ACTIVE questions in the same total order `for update` (the order the member's lock
 * function takes, so no pair of transactions can deadlock). A tenant that never built a form has an empty
 * layout.
 */
export async function readLayout(tx: Tx, tenantId: string): Promise<LayoutRead> {
  const steps = await tx.execute<StoredStep>(sql`
    select s.id::text as id
      from public.profile_form_steps s
     where s.tenant_id = ${tenantId}::uuid
     order by s."position", s.created_at, s.id
       for update`);
  const rows = await tx.execute<StoredLayoutQuestion>(sql`
    select q.id::text as id, q.step_id::text as step_id, q.type, q.title, q.options,
           q.condition_question_id::text as condition_question_id, q.condition_values
      from public.profile_form_questions q
     where q.tenant_id = ${tenantId}::uuid and q.archived_at is null
     order by q."position", q.created_at, q.id
       for update`);

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
