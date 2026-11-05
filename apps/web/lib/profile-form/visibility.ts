import type { MemberForm, MemberQuestion } from '@rede-social/contracts/profile-form';
import type { Answers, Draft } from './form-state';

/**
 * RED stub of plan 12.1-13 task 1: deliberately inert (every question counts as visible, no token is
 * read). The GREEN commit replaces this file with the real delegation to the contracts' rule.
 */

export function tokensOfDraft(
  _question: Pick<MemberQuestion, 'type'>,
  _draft: Draft | undefined,
): string[] {
  return [];
}

export function visibleQuestionIds(
  form: Pick<MemberForm, 'questions'>,
  _drafts?: Answers,
): Set<string> {
  return new Set(form.questions.map((question) => question.id));
}
