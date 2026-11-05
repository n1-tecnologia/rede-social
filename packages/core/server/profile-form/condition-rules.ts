import type { ProfileFormCondition, ProfileFormIssue } from '@rede-social/contracts/profile-form';
import type { Layout } from './layout';

/**
 * RED-phase inert stub (12.1-04 Task 1): the types are final, every function accepts everything. Fully
 * replaced in the GREEN commit.
 */

export type RuleQuestion = {
  id: string;
  type: string;
  title: string;
  archived: boolean;
  options: readonly { id: string }[];
  conditionQuestionId: string | null;
  conditionValues: readonly string[] | null;
};

export type ConditionCheck =
  | { ok: true }
  | { ok: false; issue: ProfileFormIssue; questionId?: string; openerId?: string };

export function checkCondition(_input: {
  questions: readonly RuleQuestion[];
  layout: Layout;
  subjectId: string;
  condition: ProfileFormCondition | null;
}): ConditionCheck {
  return { ok: true };
}

export function checkConditionLock(_input: {
  answerCount: number;
  current: ProfileFormCondition | null;
  next: ProfileFormCondition | null;
}): ProfileFormIssue | null {
  return null;
}

export function dependentsOf(
  _questions: readonly RuleQuestion[],
  _openerId: string,
): { id: string; title: string }[] {
  return [];
}

export function checkOpenerChange(_input: {
  questions: readonly RuleQuestion[];
  openerId: string;
  archive?: boolean;
  nextType?: string;
  removedOptionIds?: readonly string[];
}): { issue: 'has_dependents'; dependents: { id: string; title: string }[] } | null {
  return null;
}

export function checkReactivation(_input: {
  questions: readonly RuleQuestion[];
  layout: Layout;
  questionId: string;
}): ConditionCheck {
  return { ok: true };
}
