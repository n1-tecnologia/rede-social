import type { MemberForm } from '@rede-social/contracts/profile-form';
import type { Answers } from './form-state';

/**
 * RED stub of plan 12.1-13 task 2: deliberately inert (every step is on the path, nothing is shown, no
 * step is found). The GREEN commit replaces this file with the real path logic.
 */

type StepForm = Pick<MemberForm, 'steps' | 'questions'>;

export function showSteps(_form: Pick<MemberForm, 'steps'>): boolean {
  return false;
}

export function showProgress(_path: readonly string[]): boolean {
  return false;
}

export function stepPath(_form: StepForm, _drafts: Answers, _mode: MemberForm['mode']): string[] {
  return [];
}

export function firstStepWithMissing(
  _form: StepForm,
  _missingQuestionIds: readonly string[],
): string | null {
  return null;
}

export function nextStep(_path: readonly string[], _currentStepId: string): string | null {
  return null;
}

export function previousStep(_path: readonly string[], _currentStepId: string): string | null {
  return null;
}

export function isLastStep(_path: readonly string[], _currentStepId: string): boolean {
  return false;
}
