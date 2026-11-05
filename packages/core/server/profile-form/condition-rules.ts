import {
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  type ProfileFormCondition,
  type ProfileFormIssue,
} from '@rede-social/contracts/profile-form';
import { flatten, type Layout } from './layout';

/**
 * The condition rules of the profile form, PURE (Phase 12.1, D-620..D-623, D-625, D-632; PFORM-28, PFORM-29,
 * PFORM-31): what a condition may be, where a conditional question may sit, which edits an opener refuses.
 * No database, no I/O, no clock: the service reads the facts (the tenant's questions, the locked layout, the
 * answer count) and asks these functions, the `lock-rules.ts` mould.
 *
 * The SQL trigger `app.profile_form_question_guard` (PF006: condition_locked, PF007: has_dependents) and the
 * `app.profile_form_*` condition gate are the backstop of the same rules, for a race that gets past the
 * service. The two must stay in step; `guardIssueOf` in `lock-rules.ts` maps the SQLSTATEs back to the codes
 * used here.
 *
 * The model has ONE level (D-622): an opener carries no condition and a conditional question opens nothing,
 * so no rule here recurses and a chain can never pass `checkCondition`, whatever the order.
 */

/** The part of a question the condition rules look at. */
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

type Dependent = { id: string; title: string };

const OK: ConditionCheck = { ok: true };
const invalid: ConditionCheck = { ok: false, issue: 'condition_invalid' };

const isOpenerType = (type: string) =>
  (PROFILE_FORM_CONDITION_OPENER_TYPES as readonly string[]).includes(type);

/**
 * Whether `condition` is acceptable on the question `subjectId`, against the whole list and the layout the
 * question will have (a question not yet in the layout counts as sitting after everything). A null
 * condition is a removal and is never checked. The first refusal wins, in this order: the subject is not its
 * own opener; the opener is in the list, in the layout and active; its type may open (D-620); it carries no
 * condition itself (D-622); the subject is not an active opener (D-622); the opener sits before the subject
 * in the flattened layout (D-623, `condition_order` naming the pair); the values are non-empty, unique and
 * each a token of the opener (D-621).
 */
export function checkCondition(input: {
  questions: readonly RuleQuestion[];
  layout: Layout;
  subjectId: string;
  condition: ProfileFormCondition | null;
}): ConditionCheck {
  const { questions, layout, subjectId, condition } = input;
  if (condition === null) return OK;

  if (condition.questionId === subjectId) return invalid;
  const opener = questions.find((question) => question.id === condition.questionId);
  if (!opener || opener.archived) return invalid;
  const flat = flatten(layout);
  const openerIndex = flat.indexOf(opener.id);
  if (openerIndex === -1) return invalid;
  if (!isOpenerType(opener.type)) return invalid;
  if (opener.conditionQuestionId !== null) return invalid;
  if (
    questions.some(
      (question) =>
        question.id !== subjectId &&
        !question.archived &&
        question.conditionQuestionId === subjectId,
    )
  )
    return invalid;

  const subjectIndex = flat.indexOf(subjectId);
  if (subjectIndex !== -1 && openerIndex >= subjectIndex)
    return { ok: false, issue: 'condition_order', questionId: subjectId, openerId: opener.id };

  const { values } = condition;
  if (values.length === 0 || new Set(values).size !== values.length) return invalid;
  const allowed =
    opener.type === 'yes_no'
      ? new Set(['true', 'false'])
      : new Set(opener.options.map((option) => option.id));
  if (!values.every((token) => allowed.has(token))) return invalid;

  return OK;
}

const sameCondition = (a: ProfileFormCondition, b: ProfileFormCondition) => {
  const left = new Set(a.values);
  const right = new Set(b.values);
  return (
    a.questionId === b.questionId &&
    left.size === right.size &&
    [...left].every((token) => right.has(token))
  );
};

/**
 * D-625: a question that has answers cannot GAIN a condition or CHANGE it (another opener or another value
 * set, compared as sets). Removal and an unchanged condition pass at any answer count.
 */
export function checkConditionLock(input: {
  answerCount: number;
  current: ProfileFormCondition | null;
  next: ProfileFormCondition | null;
}): ProfileFormIssue | null {
  const { answerCount, current, next } = input;
  if (answerCount <= 0 || next === null) return null;
  if (current !== null && sameCondition(current, next)) return null;
  return 'condition_locked';
}

/** The ACTIVE questions whose condition names `openerId`, in list order (D-632). */
export function dependentsOf(questions: readonly RuleQuestion[], openerId: string): Dependent[] {
  return questions
    .filter((question) => !question.archived && question.conditionQuestionId === openerId)
    .map((question) => ({ id: question.id, title: question.title }));
}

/**
 * D-632: the refusals of an opener. Archiving it, changing its type, or removing an option id that some
 * active dependent's values name (even an option with no answer) is `has_dependents` with the list of
 * active dependents the change would orphan; for removed options only the dependents that name a removed id
 * are listed. With no active dependent, or when only unreferenced options go, the answer is null.
 */
export function checkOpenerChange(input: {
  questions: readonly RuleQuestion[];
  openerId: string;
  archive?: boolean;
  nextType?: string;
  removedOptionIds?: readonly string[];
}): { issue: 'has_dependents'; dependents: Dependent[] } | null {
  const { questions, openerId, archive, nextType, removedOptionIds } = input;
  const active = questions.filter(
    (question) => !question.archived && question.conditionQuestionId === openerId,
  );
  if (active.length === 0) return null;

  const opener = questions.find((question) => question.id === openerId);
  const retyped = nextType !== undefined && opener !== undefined && nextType !== opener.type;
  const removed = new Set(removedOptionIds ?? []);
  const affected =
    archive || retyped
      ? active
      : active.filter((question) => (question.conditionValues ?? []).some((v) => removed.has(v)));
  if (affected.length === 0) return null;
  return {
    issue: 'has_dependents',
    dependents: affected.map((question) => ({ id: question.id, title: question.title })),
  };
}

/**
 * A shown question about to become active again must still hold: its opener may be archived, no longer
 * eligible (a condition of its own, another type, a removed option) or now after it. Re-runs the whole
 * condition (`condition_invalid`, or `condition_order` naming the pair). A question with no condition always
 * passes; an unknown question is `unknown_question`.
 */
export function checkReactivation(input: {
  questions: readonly RuleQuestion[];
  layout: Layout;
  questionId: string;
}): ConditionCheck {
  const { questions, layout, questionId } = input;
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) return { ok: false, issue: 'unknown_question' };
  if (question.conditionQuestionId === null) return OK;
  return checkCondition({
    questions,
    layout,
    subjectId: questionId,
    condition: {
      questionId: question.conditionQuestionId,
      values: [...(question.conditionValues ?? [])],
    },
  });
}
