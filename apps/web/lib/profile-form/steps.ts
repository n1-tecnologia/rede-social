import type { MemberForm } from '@rede-social/contracts/profile-form';
import { type Answers, isEmptyDraft } from './form-state';
import { visibleQuestionIds } from './visibility';

/**
 * The member's path through the steps of the profile form (12.1-13, D-628, D-629, D-630; UI-D-653,
 * UI-D-654, UI-D-657). Pure functions of their arguments: they decide which steps are walked and in what
 * order, never what a member answered, and no answer value is in any output (T-12.1-11).
 */

type StepForm = Pick<MemberForm, 'steps' | 'questions'>;

/** The step chrome (title, buttons) shows only when the form has two or more configured steps. */
export function showSteps(form: Pick<MemberForm, 'steps'>): boolean {
  return form.steps.length >= 2;
}

/** Progress shows only when the member's path has two or more steps. */
export function showProgress(path: readonly string[]): boolean {
  return path.length >= 2;
}

/**
 * The ordered step ids the member walks. `first` and `edit`: the steps that hold at least one visible
 * question (a step whose questions are all hidden, and an empty one, are skipped). `returning`: only the
 * steps that hold a visible, required question still unanswered under the drafts. `none`: no path.
 */
export function stepPath(form: StepForm, drafts: Answers, mode: MemberForm['mode']): string[] {
  if (mode === 'none') return [];
  const visible = visibleQuestionIds(form, drafts);
  const wanted = new Set<string>();
  for (const question of form.questions) {
    if (!visible.has(question.id)) continue;
    if (
      mode === 'returning' &&
      !(question.required && isEmptyDraft(question.type, drafts[question.id]))
    ) {
      continue;
    }
    wanted.add(question.stepId);
  }
  return form.steps.filter((step) => wanted.has(step.id)).map((step) => step.id);
}

/** The first step, in step order, that holds one of the question ids the server reported as missing. */
export function firstStepWithMissing(
  form: StepForm,
  missingQuestionIds: readonly string[],
): string | null {
  const missing = new Set(missingQuestionIds);
  const withMissing = new Set(
    form.questions.filter((question) => missing.has(question.id)).map((q) => q.stepId),
  );
  return form.steps.find((step) => withMissing.has(step.id))?.id ?? null;
}

/** The step after `currentStepId` on the path; `null` at the end or when the step is not on the path. */
export function nextStep(path: readonly string[], currentStepId: string): string | null {
  const index = path.indexOf(currentStepId);
  return index === -1 ? null : (path[index + 1] ?? null);
}

/** The step before `currentStepId` on the path; `null` at the start or when the step is not on the path. */
export function previousStep(path: readonly string[], currentStepId: string): string | null {
  const index = path.indexOf(currentStepId);
  return index <= 0 ? null : (path[index - 1] ?? null);
}

/** True when `currentStepId` is the last step of the path (the button reads "Concluir"). */
export function isLastStep(path: readonly string[], currentStepId: string): boolean {
  return path.length > 0 && path[path.length - 1] === currentStepId;
}
