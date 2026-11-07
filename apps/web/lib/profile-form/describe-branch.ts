import type { ProfileFormType } from '@rede-social/contracts/profile-form';

/**
 * The label of a branch as structured values (12.2-13, D-642, UI-D-666, UI-D-676). The sentence itself is
 * built by the component from the catalog text plus these values ("Se “{opener}” for {options}"), so no
 * component types a label and no catalog is read here. Pure; the labels are the admin's own option labels,
 * never a member's answer (T-12.2-14).
 *
 * The branch NAME is an admin label: only the builder's helpers pass a branch that carries one, and a name
 * is returned beside the opening-answer parts so the answers that open the branch are never hidden by it.
 */

/** A choice opener lists its option labels; a yes/no opener lists the answers (the words are the catalog's). */
export type ConditionDescription =
  | { yesNo: false; openerTitle: string; labels: string[] }
  | { yesNo: true; openerTitle: string; values: ('true' | 'false')[] };

/** A branch's opening-answer parts, plus the admin's name when it has one. */
export type BranchDescription = ConditionDescription & { name?: string };

type Opener = {
  title: string;
  type: ProfileFormType;
  options: readonly { id: string; label: string }[];
};

/**
 * Describes `branch` against the questions it can name, or `null` when the opener is not among them. The
 * labels come in the OPENER's option order (not the order the branch stored them in); a yes/no opener's
 * values come as true then false. A blank or `null` name means no name.
 */
export function describeBranch(
  branch: { openerQuestionId: string; values: readonly string[]; name?: string | null },
  questionsById: ReadonlyMap<string, Opener>,
): BranchDescription | null {
  const opener = questionsById.get(branch.openerQuestionId);
  if (opener === undefined) return null;
  const parts: ConditionDescription =
    opener.type === 'yes_no'
      ? {
          yesNo: true,
          openerTitle: opener.title,
          values: (['true', 'false'] as const).filter((value) => branch.values.includes(value)),
        }
      : {
          yesNo: false,
          openerTitle: opener.title,
          labels: opener.options
            .filter((option) => branch.values.includes(option.id))
            .map((option) => option.label),
        };
  const name = branch.name?.trim() ?? '';
  return name === '' ? parts : { name, ...parts };
}

/** “A”, “B” ou “C”: the labels quoted and joined with the pt-BR disjunction. */
export function formatDisjunction(labels: readonly string[]): string {
  const list = new Intl.ListFormat('pt-BR', { type: 'disjunction' });
  return list.format(labels.map((label) => `“${label}”`));
}

/**
 * The answers a Fluxo edge shows (UI-D-676): at most `cap` of them, then "e mais {more}". The full set is
 * in the branch sheet.
 */
export function capAnswers(labels: readonly string[], cap = 4): { shown: string[]; more: number } {
  const shown = labels.slice(0, Math.max(0, cap));
  return { shown, more: labels.length - shown.length };
}
