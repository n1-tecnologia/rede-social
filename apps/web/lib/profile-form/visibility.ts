import {
  answerTokens,
  isQuestionVisible,
  type MemberForm,
  type MemberQuestion,
} from '@rede-social/contracts/profile-form';
import { type Answers, type Draft, toWire } from './form-state';

/**
 * Which questions of the member form the member can see (12.1-13, D-621, D-631, UI-D-662).
 *
 * There is ONE rule and it lives in the contracts (`isQuestionVisible` over `answerTokens`): this file only
 * says where the opener's tokens come from, the member's DRAFTS or the STORED answers of the form read.
 * The server recomputes visibility on every save and the SQL gate is the authority; the browser's copy
 * only shapes the screen (T-12.1-16). No helper here returns, logs or passes on an answer value (T-12.1-11).
 */

type FormQuestions = Pick<MemberForm, 'questions'>;

/** The tokens a draft contributes to a condition: the draft goes to the wire value the save sends first. */
export function tokensOfDraft(
  question: Pick<MemberQuestion, 'type'>,
  draft: Draft | undefined,
): string[] {
  return answerTokens(toWire(question, draft));
}

/**
 * The ids of the visible questions. With `drafts` the openers' tokens come from the drafts (the screen the
 * member is typing on); without them from each opener's stored `answer` (the form as read). An opener the
 * form does not hold hides the question that names it.
 */
export function visibleQuestionIds(form: FormQuestions, drafts?: Answers): Set<string> {
  const byId = new Map(form.questions.map((question) => [question.id, question]));
  const tokensOf = (questionId: string): readonly string[] | undefined => {
    const opener = byId.get(questionId);
    if (opener === undefined) return undefined;
    return drafts === undefined
      ? answerTokens(opener.answer)
      : tokensOfDraft(opener, drafts[questionId]);
  };
  const visible = new Set<string>();
  for (const question of form.questions) {
    if (isQuestionVisible(question, tokensOf)) visible.add(question.id);
  }
  return visible;
}
