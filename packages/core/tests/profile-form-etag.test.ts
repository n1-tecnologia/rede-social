import { describe, expect, it } from 'vitest';
import { formEtagOf } from '../server/profile-form/member';

/**
 * Review WR-02: the member `formEtag` covers what a member renders from a branch (its opener, its opening
 * values, the questions that sit in it), never the admin-only name nor the admin's edit counter, and never a
 * branch that holds no active question.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STEP = uuid(1);
const OPENER = uuid(10);
const DEPENDENT = uuid(11);
const BRANCH = uuid(20);
const EMPTY = uuid(21);

const question = (id: string, branch: string | null = null, revision = 1) => ({
  id,
  revision,
  step_id: STEP,
  branch_id: branch,
});
const steps = [{ id: STEP, revision: 1 }];
const branch = (id: string, values: string[], opener = OPENER) => ({
  id,
  opener_question_id: opener,
  open_values: values,
});
const base = [question(OPENER), question(DEPENDENT, BRANCH)];

describe('WR-02: formEtagOf and the admin-only parts of a branch', () => {
  it('ignores a rename and the revision counter of a branch (neither is an input)', () => {
    const before = formEtagOf(base, steps, [branch(BRANCH, ['a'])]);
    const renamed = {
      ...branch(BRANCH, ['a']),
      name: 'outro nome',
      revision: 9,
    };
    expect(formEtagOf(base, steps, [renamed])).toBe(before);
  });

  it('ignores the creation of an empty branch, and the order of the opening values', () => {
    const before = formEtagOf(base, steps, [branch(BRANCH, ['a', 'b'])]);
    expect(formEtagOf(base, steps, [branch(BRANCH, ['a', 'b']), branch(EMPTY, ['x'])])).toBe(
      before,
    );
    expect(formEtagOf(base, steps, [branch(BRANCH, ['b', 'a'])])).toBe(before);
  });

  it('a form whose branches are all empty hashes exactly like a form without branches', () => {
    const plain = [question(OPENER), question(DEPENDENT)];
    expect(formEtagOf(plain, steps, [branch(EMPTY, ['x'])])).toBe(formEtagOf(plain, steps));
  });

  it('still changes with the opener, the opening values and the active-question set', () => {
    const before = formEtagOf(base, steps, [branch(BRANCH, ['a'])]);
    expect(formEtagOf(base, steps, [branch(BRANCH, ['a', 'b'])])).not.toBe(before);
    expect(formEtagOf(base, steps, [branch(BRANCH, ['b'])])).not.toBe(before);
    expect(formEtagOf(base, steps, [branch(BRANCH, ['a'], uuid(12))])).not.toBe(before);
    // A question joining the branch is a change of the active set (and of that question's own segment).
    const joined = [...base, question(uuid(13), BRANCH)];
    expect(formEtagOf(joined, steps, [branch(BRANCH, ['a'])])).not.toBe(before);
    // The dependent leaving the branch leaves it empty: the form identity moves with the question.
    const left = [question(OPENER), question(DEPENDENT, null)];
    expect(formEtagOf(left, steps, [branch(BRANCH, ['a'])])).not.toBe(before);
    // A question revision still moves it.
    expect(
      formEtagOf([question(OPENER), question(DEPENDENT, BRANCH, 2)], steps, [
        branch(BRANCH, ['a']),
      ]),
    ).not.toBe(before);
  });
});
