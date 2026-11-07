import {
  answerTokens,
  type MemberBranch,
  type MemberQuestion,
} from '@rede-social/contracts/profile-form';
import {
  type BranchTree,
  branchTreeOf,
  isQuestionVisibleInTree,
} from '@rede-social/contracts/profile-form-branches';
import { type Answers, type Draft, toWire } from './form-state';

/**
 * Which questions of the member form the member can see (12.2-13, D-641, D-644, D-645; 12.1-13 before it).
 *
 * There is ONE rule and it lives in the contracts (`isQuestionVisibleInTree` over `answerTokens`): a question
 * in a branch is visible only when EVERY branch on its chain is open. This file only says where the openers'
 * tokens come from, the member's DRAFTS or the STORED answers of the form read. The server recomputes
 * visibility on every save and the SQL gate is the authority; the browser's copy only shapes the screen
 * (T-12.2-16). A form read without the `branches` key is a form with none. No helper here returns, logs or
 * passes on an answer value (T-12.2-14); the branch NAME never enters this file (the member and staff shapes
 * have none, T-12.2-03).
 */

type FormQuestions = {
  questions: readonly MemberQuestion[];
  /** The member form's branches (no name); absent reads as none. */
  branches?: readonly MemberBranch[] | undefined;
};

/** The tokens a draft contributes to a branch: the draft goes to the wire value the save sends first. */
export function tokensOfDraft(
  question: Pick<MemberQuestion, 'type'>,
  draft: Draft | undefined,
): string[] {
  return answerTokens(toWire(question, draft));
}

/**
 * The ids of the visible questions, in form order. With `drafts` the openers' tokens come from the drafts
 * (the screen the member is typing on); without them from each opener's stored `answer` (the form as read).
 * An opener the form does not hold, or a branch it does not hold, hides the question that names it.
 */
export function visibleQuestionIds(form: FormQuestions, drafts?: Answers): Set<string> {
  const byId = new Map(form.questions.map((question) => [question.id, question]));
  const tree = branchTreeOf(form.questions, form.branches ?? []);
  const tokensOf = (questionId: string): readonly string[] | undefined => {
    const opener = byId.get(questionId);
    if (opener === undefined) return undefined;
    return drafts === undefined
      ? answerTokens(opener.answer)
      : tokensOfDraft(opener, drafts[questionId]);
  };
  const visible = new Set<string>();
  for (const question of form.questions) {
    if (isQuestionVisibleInTree(question, tree, tokensOf)) visible.add(question.id);
  }
  return visible;
}

/**
 * The questions "Minhas respostas" shows (D-634, UI-D-659): a question in a branch that the opener answers
 * close is omitted. Stored equals visible (D-624), so nothing else is filtered.
 */
export function storedVisibleQuestionIds(form: FormQuestions): Set<string> {
  return visibleQuestionIds(form);
}

/**
 * The ACTIVE questions whose stored answer a save of these drafts would delete (D-626, D-624, D-644): they
 * have a stored answer in the form read and are hidden under the drafts, in form order, whichever branch
 * above them closed. A draft that closes nothing with a stored answer lists nothing. Only an id and a title
 * leave: never an answer (T-12.2-14).
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
 * True when a staff row's chain is not entirely open by the opener rows' own values (D-645, UI-D-659): the
 * staff view reads "Não se aplica" for such a row instead of "Sem resposta". An opener row that is absent or
 * holds no value does not open its branch, and a branch the payload does not list closes the row. The caller
 * applies it to unanswered rows only. The rows carry each question's `branchId`, the branches come from the
 * same payload (no name); only a boolean leaves (T-12.2-14).
 */
export function isNotApplicableInTree(
  row: { questionId: string; branchId?: string | null; value: unknown },
  rowsById: ReadonlyMap<string, { value: unknown; branchId?: string | null }>,
  branches: readonly { id: string; openerQuestionId: string; values: readonly string[] }[],
): boolean {
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
  const tree: BranchTree = {
    branch: (branchId) => byBranch.get(branchId),
    branchIdOf: (questionId) => {
      const opener = rowsById.get(questionId);
      return opener === undefined ? undefined : (opener.branchId ?? null);
    },
  };
  return !isQuestionVisibleInTree({ branchId: row.branchId ?? null }, tree, (questionId) => {
    const opener = rowsById.get(questionId);
    return opener === undefined ? undefined : answerTokens(opener.value);
  });
}
