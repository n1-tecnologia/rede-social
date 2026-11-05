import type { ProfileFormCondition, ProfileFormType } from '@rede-social/contracts/profile-form';

/**
 * The values of a condition sentence (12.1-13, D-621, UI-D-650). The sentence itself is built by the
 * component from the catalog text plus these values ("Só aparece se “{opener}” for {options}."), so no
 * component types a condition sentence and no catalog is read here. Pure; the labels are the admin's own
 * option labels, never a member's answer (T-12.1-11).
 */

/** A choice opener lists its option labels; a yes/no opener lists the answers (the words are the catalog's). */
export type ConditionDescription =
  | { yesNo: false; openerTitle: string; labels: string[] }
  | { yesNo: true; openerTitle: string; values: ('true' | 'false')[] };

type Opener = {
  title: string;
  type: ProfileFormType;
  options: readonly { id: string; label: string }[];
};

/**
 * Describes `condition` against the questions it can name, or `null` when the opener is not among them.
 * Labels come in the OPENER's option order (not the order the condition stored them in); a yes/no opener's
 * values come as true then false.
 */
export function describeCondition(
  condition: ProfileFormCondition,
  questionsById: ReadonlyMap<string, Opener>,
): ConditionDescription | null {
  const opener = questionsById.get(condition.questionId);
  if (opener === undefined) return null;
  if (opener.type === 'yes_no') {
    const values = (['true', 'false'] as const).filter((value) => condition.values.includes(value));
    return { yesNo: true, openerTitle: opener.title, values };
  }
  const wanted = new Set(condition.values);
  const labels = opener.options.filter((option) => wanted.has(option.id)).map((o) => o.label);
  return { yesNo: false, openerTitle: opener.title, labels };
}

/** “A”, “B” ou “C”: the labels quoted and joined with the pt-BR disjunction. */
export function formatDisjunction(labels: readonly string[]): string {
  const list = new Intl.ListFormat('pt-BR', { type: 'disjunction' });
  return list.format(labels.map((label) => `“${label}”`));
}
