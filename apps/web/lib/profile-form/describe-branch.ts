import type { ProfileFormType } from '@rede-social/contracts/profile-form';
import { type ConditionDescription, describeCondition } from './describe-condition';

/**
 * The label of a branch as structured values (12.2-13, D-642, UI-D-666, UI-D-676). The sentence itself is
 * built by the component from the catalog text plus these values ("Se “{opener}” for {options}"), so no
 * component types a label and no catalog is read here. Pure; the labels are the admin's own option labels,
 * never a member's answer (T-12.2-14).
 *
 * The branch NAME is an admin label: only the builder's helpers pass a branch that carries one, and a name
 * is returned beside the condition parts so the answers that open the branch are never hidden by it.
 */

/** A branch's condition parts, plus the admin's name when it has one. */
export type BranchDescription = ConditionDescription & { name?: string };

type Opener = {
  title: string;
  type: ProfileFormType;
  options: readonly { id: string; label: string }[];
};

/**
 * Describes `branch` against the questions it can name, or `null` when the opener is not among them. The
 * condition parts are the 12.1 ones (`describeCondition`): labels in the OPENER's option order, a yes/no
 * opener's values as true then false. A blank or `null` name means no name.
 */
export function describeBranch(
  branch: { openerQuestionId: string; values: readonly string[]; name?: string | null },
  questionsById: ReadonlyMap<string, Opener>,
): BranchDescription | null {
  const parts = describeCondition(
    { questionId: branch.openerQuestionId, values: [...branch.values] },
    questionsById,
  );
  if (parts === null) return null;
  const name = branch.name?.trim() ?? '';
  return name === '' ? parts : { name, ...parts };
}

/**
 * The answers a Fluxo edge shows (UI-D-676): at most `cap` of them, then "e mais {more}". The full set is
 * in the branch sheet.
 */
export function capAnswers(labels: readonly string[], cap = 4): { shown: string[]; more: number } {
  const shown = labels.slice(0, Math.max(0, cap));
  return { shown, more: labels.length - shown.length };
}
