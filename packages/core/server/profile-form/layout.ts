import type { ProfileFormIssue } from '@rede-social/contracts/profile-form';

/**
 * The pure layout of the profile form (Phase 12.1, D-623, D-627; PFORM-28, PFORM-29): ONE sequence of
 * question ids cut into steps. Position is global (steps are contiguous ranges of it), so the readers'
 * `order by position, created_at, id` is unchanged. No database, no I/O, no clock.
 *
 * This is the pure half of the plan 08 and 09 writes: the service reads the locked layout, calls one
 * operation, validates D-623 over the result with `checkLayoutOrder` and writes `renumber` in one set-based
 * statement (the 12-08 reorder shape extended with `step_id`). Every operation returns a NEW layout or a
 * coded refusal and never mutates its argument. Only `unknown_step`, `order_mismatch`, `step_not_empty`,
 * `last_step` and `condition_order` are produced here.
 */

export type LayoutStep = { stepId: string; questionIds: readonly string[] };
export type Layout = readonly LayoutStep[];
export type LayoutResult = { ok: true; layout: Layout } | { ok: false; issue: ProfileFormIssue };
export type LayoutOrderCheck =
  | { ok: true }
  | { ok: false; issue: 'condition_order'; questionId: string; openerId: string };

const refuse = (issue: ProfileFormIssue): LayoutResult => ({ ok: false, issue });
const accept = (layout: Layout): LayoutResult => ({ ok: true, layout });
const copy = (layout: Layout): LayoutStep[] =>
  layout.map((step) => ({ stepId: step.stepId, questionIds: [...step.questionIds] }));

/** Whether `ids` holds exactly the members of `expected`, each once, in any order. */
function sameSet(ids: readonly string[], expected: readonly string[]): boolean {
  return (
    ids.length === expected.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => expected.includes(id))
  );
}

/** The question ids of every step in order; an empty step contributes nothing. */
export function flatten(layout: Layout): string[] {
  return layout.flatMap((step) => step.questionIds);
}

/** Appends a new question to the END of the named step. */
export function addQuestion(layout: Layout, stepId: string, questionId: string): LayoutResult {
  if (!layout.some((step) => step.stepId === stepId)) return refuse('unknown_step');
  if (flatten(layout).includes(questionId)) return refuse('order_mismatch');
  return accept(
    layout.map((step) =>
      step.stepId === stepId
        ? { stepId: step.stepId, questionIds: [...step.questionIds, questionId] }
        : { stepId: step.stepId, questionIds: [...step.questionIds] },
    ),
  );
}

/**
 * Adds a new question to the named step, next to the question that opens it (quick 261106-ei5). Three outcomes:
 *   - no opener, or the opener is not in the named step (another step, or not in the layout): the END of the
 *     step, exactly like `addQuestion`;
 *   - the opener is in the named step and nothing in that step AFTER it depends on it: right after the opener;
 *   - the opener is in the named step and some questions after it depend on it (`facts`, one
 *     `{ questionId, openerId }` per active conditional question): right after the LAST of them. A question in
 *     between that does not depend on the opener, and a dependent of another opener, never stop the scan.
 * The refusals are `addQuestion`'s own (`unknown_step`, `order_mismatch`) and come first. Nothing is mutated.
 * Ids are compared as given: the caller passes lowercase uuid text.
 */
export function addQuestionAfterOpener(
  layout: Layout,
  stepId: string,
  questionId: string,
  openerId: string | null,
  facts: readonly { questionId: string; openerId: string }[],
): LayoutResult {
  const appended = addQuestion(layout, stepId, questionId);
  if (!appended.ok || openerId === null) return appended;
  const target = layout.find((step) => step.stepId === stepId);
  const openerIndex = target ? target.questionIds.indexOf(openerId) : -1;
  if (!target || openerIndex === -1) return appended;
  const dependents = new Set(
    facts.filter((fact) => fact.openerId === openerId).map((fact) => fact.questionId),
  );
  let after = openerIndex;
  target.questionIds.forEach((id, index) => {
    if (index > openerIndex && dependents.has(id)) after = index;
  });
  return accept(
    layout.map((step) => {
      if (step.stepId !== stepId)
        return { stepId: step.stepId, questionIds: [...step.questionIds] };
      const ids = [...step.questionIds];
      ids.splice(after + 1, 0, questionId);
      return { stepId: step.stepId, questionIds: ids };
    }),
  );
}

/** Takes the question out of its step and appends it to the END of the target step (UI-D-647). */
export function moveQuestion(layout: Layout, questionId: string, toStepId: string): LayoutResult {
  if (!layout.some((step) => step.stepId === toStepId)) return refuse('unknown_step');
  if (!flatten(layout).includes(questionId)) return refuse('order_mismatch');
  const from = layout.find((step) => step.questionIds.includes(questionId));
  if (from?.stepId === toStepId) return accept(copy(layout));
  return accept(
    layout.map((step) => {
      const kept = step.questionIds.filter((id) => id !== questionId);
      return {
        stepId: step.stepId,
        questionIds: step.stepId === toStepId ? [...kept, questionId] : kept,
      };
    }),
  );
}

/** Reorders one step: `questionIds` must be exactly the step's current ids. */
export function reorderWithin(
  layout: Layout,
  stepId: string,
  questionIds: readonly string[],
): LayoutResult {
  const target = layout.find((step) => step.stepId === stepId);
  if (!target) return refuse('unknown_step');
  if (!sameSet(questionIds, target.questionIds)) return refuse('order_mismatch');
  return accept(
    layout.map((step) => ({
      stepId: step.stepId,
      questionIds: step.stepId === stepId ? [...questionIds] : [...step.questionIds],
    })),
  );
}

/** Reorders the steps: `stepIds` must be exactly the current step ids. */
export function reorderSteps(layout: Layout, stepIds: readonly string[]): LayoutResult {
  if (
    !sameSet(
      stepIds,
      layout.map((step) => step.stepId),
    )
  )
    return refuse('order_mismatch');
  const byId = new Map(layout.map((step) => [step.stepId, step] as const));
  return accept(
    stepIds.map((id) => ({
      stepId: id,
      questionIds: [...(byId.get(id)?.questionIds ?? [])],
    })),
  );
}

/** Drops an EMPTY step; the only step is never removed. */
export function removeStep(layout: Layout, stepId: string): LayoutResult {
  const target = layout.find((step) => step.stepId === stepId);
  if (!target) return refuse('unknown_step');
  if (target.questionIds.length > 0) return refuse('step_not_empty');
  if (layout.length === 1) return refuse('last_step');
  return accept(copy(layout.filter((step) => step.stepId !== stepId)));
}

/**
 * Accepts a requested whole layout only when it holds exactly the same question ids and step ids as the
 * current one (nothing added, dropped, duplicated or foreign); the requested grouping and order win.
 */
export function applyRequestedLayout(current: Layout, requested: Layout): LayoutResult {
  const stepsOk = sameSet(
    requested.map((step) => step.stepId),
    current.map((step) => step.stepId),
  );
  const questionsOk = sameSet(flatten(requested), flatten(current));
  if (!stepsOk || !questionsOk) return refuse('order_mismatch');
  return accept(copy(requested));
}

/** The rows a service writes in one statement: positions 1..n over the flattened order, no gap, no repeat. */
export function renumber(layout: Layout): { id: string; stepId: string; position: number }[] {
  let position = 0;
  return layout.flatMap((step) =>
    step.questionIds.map((id) => {
      position += 1;
      return { id, stepId: step.stepId, position };
    }),
  );
}

/**
 * D-623 over a whole layout: every `{ questionId, openerId }` fact needs the opener at a strictly lower
 * flattened index than its question. The first violated pair, in flattened order of the question, is
 * returned so the UI can print the two titles. A fact about a question that is not in the layout is not
 * about this layout and is ignored; an opener that is not in the layout violates the rule. With no facts
 * the layout passes.
 */
export function checkLayoutOrder(
  layout: Layout,
  facts: readonly { questionId: string; openerId: string }[],
): LayoutOrderCheck {
  const flat = flatten(layout);
  const index = new Map(flat.map((id, i) => [id, i] as const));
  const violations = facts
    .map((fact) => ({ fact, at: index.get(fact.questionId) }))
    .filter(
      (entry): entry is { fact: (typeof facts)[number]; at: number } => entry.at !== undefined,
    )
    .sort((a, b) => a.at - b.at);
  for (const { fact, at } of violations) {
    const openerAt = index.get(fact.openerId);
    if (openerAt === undefined || openerAt >= at)
      return {
        ok: false,
        issue: 'condition_order',
        questionId: fact.questionId,
        openerId: fact.openerId,
      };
  }
  return { ok: true };
}
