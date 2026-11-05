import { describe, expect, it } from 'vitest';
import type { Answers } from './form-state';
import {
  firstStepWithMissing,
  isLastStep,
  nextStep,
  previousStep,
  showProgress,
  showSteps,
  stepPath,
} from './steps';
import { form, options, question, uuid } from './test-fixtures';

/**
 * 12.1-13 task 2 (D-628, D-629, D-630, UI-D-653, UI-D-654, UI-D-657): the steps the member walks, whether
 * the step chrome and the progress show, and where she is sent after the last save.
 */

const S1 = uuid(701);
const S2 = uuid(702);
const S3 = uuid(703);
const opts = options('A', 'B');
const [optA, optB] = [opts[0]?.id ?? '', opts[1]?.id ?? ''];
const picked = (id: string) => ({ optionIds: [id], other: false, otherText: '' });
const steps = (...ids: string[]) => ids.map((id, i) => ({ id, title: `Etapa ${i + 1}` }));

/** Step 1 holds the opener, step 2 only a question that appears for option A, step 3 a plain one. */
function threeSteps() {
  const opener = question('single_choice', { options: opts, stepId: S1 });
  const onlyWhenA = question('short_text', {
    required: true,
    stepId: S2,
    condition: { questionId: opener.id, values: [optA] },
  });
  const plain = question('short_text', { required: true, stepId: S3 });
  return {
    opener,
    onlyWhenA,
    plain,
    f: form([opener, onlyWhenA, plain], { steps: steps(S1, S2, S3) }),
  };
}

describe('stepPath: a step whose questions are all hidden is skipped (D-628)', () => {
  it('skips the step whose only question is hidden, and adds it back when the opener reveals it', () => {
    const { opener, f } = threeSteps();
    const closed: Answers = { [opener.id]: picked(optB) };
    expect(stepPath(f, closed, 'first')).toEqual([S1, S3]);
    const open: Answers = { [opener.id]: picked(optA) };
    expect(stepPath(f, open, 'first')).toEqual([S1, S2, S3]);
  });

  it('never lists an empty configured step', () => {
    const only = question('short_text', { stepId: S1 });
    const f = form([only], { steps: steps(S1, S2) });
    expect(stepPath(f, {}, 'first')).toEqual([S1]);
  });

  it('edit mode lists every step that has a visible question, in step order', () => {
    const { opener, f } = threeSteps();
    expect(stepPath(f, { [opener.id]: picked(optB) }, 'edit')).toEqual([S1, S3]);
    expect(stepPath(f, { [opener.id]: picked(optA) }, 'edit')).toEqual([S1, S2, S3]);
  });

  it('mode none has no path', () => {
    const { f } = threeSteps();
    expect(stepPath(f, {}, 'none')).toEqual([]);
  });
});

describe('showSteps and showProgress (UI-D-653: a form that needs no steps renders as Phase 12)', () => {
  it('showSteps is true only for two or more configured steps', () => {
    expect(showSteps({ steps: steps(S1) })).toBe(false);
    expect(showSteps({ steps: steps(S1, S2) })).toBe(true);
  });

  it('showProgress is true only for a path of two or more, so skipped steps leave the title without progress', () => {
    const { opener, f } = threeSteps();
    expect(showSteps(f)).toBe(true);
    expect(showProgress([S1])).toBe(false);
    expect(showProgress([S1, S3])).toBe(true);
    const lonely = form([question('short_text', { stepId: S1 })], { steps: steps(S1, S2, S3) });
    expect(showSteps(lonely)).toBe(true);
    expect(showProgress(stepPath(lonely, {}, 'first'))).toBe(false);
    expect(showProgress(stepPath(f, { [opener.id]: picked(optB) }, 'first'))).toBe(true);
  });
});

describe('the returning path holds only the steps with something missing (D-630, UI-D-657)', () => {
  it('lists the steps that have a visible required question still unanswered under the drafts', () => {
    const { opener, onlyWhenA, plain } = threeSteps();
    const answeredOpener = { ...opener, answer: { optionId: optB, otherText: null } };
    const f = form([answeredOpener, onlyWhenA, plain], {
      mode: 'returning',
      steps: steps(S1, S2, S3),
    });
    const drafts: Answers = { [opener.id]: picked(optB), [onlyWhenA.id]: '', [plain.id]: '' };
    expect(stepPath(f, drafts, 'returning')).toEqual([S3]);
  });

  it('answering the last missing question of a step removes it from the path', () => {
    const { opener, plain, f } = threeSteps();
    const base: Answers = { [opener.id]: picked(optB), [plain.id]: '' };
    expect(stepPath(f, base, 'returning')).toEqual([S3]);
    expect(stepPath(f, { ...base, [plain.id]: 'ok' }, 'returning')).toEqual([]);
  });

  it('answering an opener that reveals a required question adds the step of that question', () => {
    const { opener, onlyWhenA, plain, f } = threeSteps();
    const drafts: Answers = { [opener.id]: picked(optB), [onlyWhenA.id]: '', [plain.id]: 'ok' };
    expect(stepPath(f, drafts, 'returning')).toEqual([]);
    expect(stepPath(f, { ...drafts, [opener.id]: picked(optA) }, 'returning')).toEqual([S2]);
  });
});

describe('the jump after Concluir goes to the first step with something missing (D-629, UI-D-654)', () => {
  it('returns the first step, in step order, that holds a reported id, and null for none', () => {
    const { onlyWhenA, plain, f } = threeSteps();
    expect(firstStepWithMissing(f, [plain.id, onlyWhenA.id])).toBe(S2);
    expect(firstStepWithMissing(f, [plain.id])).toBe(S3);
    expect(firstStepWithMissing(f, [])).toBeNull();
    expect(firstStepWithMissing(f, ['00000000-0000-4000-8000-00000000dead'])).toBeNull();
  });

  it('nextStep, previousStep and isLastStep follow the path and are null at its ends', () => {
    const path = [S1, S3];
    expect(nextStep(path, S1)).toBe(S3);
    expect(nextStep(path, S3)).toBeNull();
    expect(previousStep(path, S3)).toBe(S1);
    expect(previousStep(path, S1)).toBeNull();
    expect(isLastStep(path, S3)).toBe(true);
    expect(isLastStep(path, S1)).toBe(false);
    expect(nextStep(path, S2)).toBeNull();
    expect(isLastStep(path, S2)).toBe(false);
  });
});
