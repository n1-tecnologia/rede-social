import type { ConditionDescription } from './describe-condition';

/**
 * The label of a branch as structured values (12.2-13, D-642, UI-D-666, UI-D-676). RED stub: deliberately
 * inert, replaced in full by the GREEN commit of the same task.
 */

/** A branch's condition parts, plus the admin's name when it has one (the name is admin-only, T-12.2-03). */
export type BranchDescription = ConditionDescription & { name?: string };

type Opener = {
  title: string;
  type: string;
  options: readonly { id: string; label: string }[];
};

export function describeBranch(
  _branch: { openerQuestionId: string; values: readonly string[]; name?: string | null },
  _questionsById: ReadonlyMap<string, Opener>,
): BranchDescription | null {
  return null;
}

/** The answers a Fluxo edge shows and how many were left out. */
export function capAnswers(labels: readonly string[], _cap = 4): { shown: string[]; more: number } {
  return { shown: [...labels], more: 0 };
}
