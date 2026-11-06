import {
  answerTokens,
  isQuestionVisible,
  type MemberQuestion,
  type ProfileFormCondition,
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

type FormQuestions = { questions: readonly MemberQuestion[] };

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

/**
 * The questions "Minhas respostas" shows (D-634, UI-D-659): a question with a condition whose opener answer
 * does not match is omitted. Stored equals visible (D-624), so nothing else is filtered.
 */
export function storedVisibleQuestionIds(form: FormQuestions): Set<string> {
  return visibleQuestionIds(form);
}

/**
 * The ACTIVE questions whose stored answer a save of these drafts would delete (D-626, D-624): they have a
 * stored answer in the form read and are hidden under the drafts, in form order. A draft that closes
 * nothing with a stored answer lists nothing. Only an id and a title leave: never an answer (T-12.1-11).
 */
export function answersToErase(
  form: FormQuestions,
  drafts: Answers,
): { id: string; title: string }[] {
  const visible = visibleQuestionIds(form, drafts);
  return form.questions
    .filter((question) => question.answer !== null && !visible.has(question.id))
    .map((question) => ({ id: question.id, title: question.title }));
}

/**
 * True when a staff row's condition is not met by the opener's own staff row (UI-D-659): the staff view reads
 * "Não se aplica" for such a row instead of "Sem resposta". An opener row that is absent or holds no value
 * does not meet the condition. The caller applies it to unanswered rows only.
 */
export function isNotApplicable(
  row: { questionId: string; condition: ProfileFormCondition | null; value: unknown },
  rowsById: ReadonlyMap<string, { value: unknown }>,
): boolean {
  return !isQuestionVisible(row, (questionId) => {
    const opener = rowsById.get(questionId);
    return opener === undefined ? undefined : answerTokens(opener.value);
  });
}

/**
 * RED stub (12.2-13 task 1): deliberately inert, replaced in full by the GREEN commit of the same task.
 */
export function isNotApplicableInTree(
  _row: { questionId: string; branchId?: string | null; value: unknown },
  _rowsById: ReadonlyMap<string, { value: unknown; branchId?: string | null }>,
  _branches: readonly { id: string; openerQuestionId: string; values: readonly string[] }[],
): boolean {
  return false;
}
