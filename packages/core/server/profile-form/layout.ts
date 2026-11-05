import type { ProfileFormIssue } from '@rede-social/contracts/profile-form';

/**
 * The pure layout of the profile form (Phase 12.1, D-623, D-627): ONE sequence of question ids cut into
 * steps. This first cut carries the types and `flatten`; the operations arrive with the layout task.
 */

export type LayoutStep = { stepId: string; questionIds: readonly string[] };
export type Layout = readonly LayoutStep[];
export type LayoutResult = { ok: true; layout: Layout } | { ok: false; issue: ProfileFormIssue };

/** The question ids of every step in order; an empty step contributes nothing. */
export function flatten(layout: Layout): string[] {
  return layout.flatMap((step) => step.questionIds);
}

// ── RED-phase inert stubs (12.1-04 Task 2): replaced in the GREEN commit ─────────────────────────

export function addQuestion(layout: Layout, _stepId: string, _questionId: string): LayoutResult {
  return { ok: true, layout };
}

export function moveQuestion(layout: Layout, _questionId: string, _toStepId: string): LayoutResult {
  return { ok: true, layout };
}

export function reorderWithin(
  layout: Layout,
  _stepId: string,
  _questionIds: readonly string[],
): LayoutResult {
  return { ok: true, layout };
}

export function reorderSteps(layout: Layout, _stepIds: readonly string[]): LayoutResult {
  return { ok: true, layout };
}

export function removeStep(layout: Layout, _stepId: string): LayoutResult {
  return { ok: true, layout };
}

export function applyRequestedLayout(current: Layout, _requested: Layout): LayoutResult {
  return { ok: true, layout: current };
}

export function renumber(_layout: Layout): { id: string; stepId: string; position: number }[] {
  return [];
}

export type LayoutOrderCheck =
  | { ok: true }
  | { ok: false; issue: 'condition_order'; questionId: string; openerId: string };

export function checkLayoutOrder(
  _layout: Layout,
  _facts: readonly { questionId: string; openerId: string }[],
): LayoutOrderCheck {
  return { ok: true };
}
