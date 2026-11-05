import type { ProfileFormCondition, ProfileFormType } from '@rede-social/contracts/profile-form';

/** RED stub of plan 12.1-13 task 3: deliberately inert, replaced in the GREEN commit. */

export type ConditionDescription =
  | { yesNo: false; openerTitle: string; labels: string[] }
  | { yesNo: true; openerTitle: string; values: ('true' | 'false')[] };

type Opener = {
  title: string;
  type: ProfileFormType;
  options: readonly { id: string; label: string }[];
};

export function describeCondition(
  _condition: ProfileFormCondition,
  _questionsById: ReadonlyMap<string, Opener>,
): ConditionDescription | null {
  return null;
}

export function formatDisjunction(_labels: readonly string[]): string {
  return '';
}
