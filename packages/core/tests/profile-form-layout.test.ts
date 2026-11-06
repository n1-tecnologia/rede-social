import { describe, expect, it } from 'vitest';
import {
  addQuestion,
  addQuestionAfterOpener,
  applyRequestedLayout,
  checkLayoutOrder,
  flatten,
  type Layout,
  moveQuestion,
  removeStep,
  renumber,
  reorderSteps,
  reorderWithin,
} from '../server/profile-form/layout';

/**
 * 12.1-04 (D-623, D-627; PFORM-28, PFORM-29): the pure one-sequence layout, no database and no mocks. The
 * input of every operation is deep-frozen so a mutation throws.
 */

const freeze = (layout: Layout): Layout => {
  for (const step of layout) {
    Object.freeze(step.questionIds);
    Object.freeze(step);
  }
  return Object.freeze(layout) as Layout;
};

const base = (): Layout =>
  freeze([
    { stepId: 's1', questionIds: ['a', 'b'] },
    { stepId: 's2', questionIds: ['c'] },
    { stepId: 's3', questionIds: [] },
  ]);

const layoutOf = (result: ReturnType<typeof addQuestion>) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.issue}`);
  return result.layout;
};

const issueOf = (result: ReturnType<typeof addQuestion>) => (result.ok ? null : result.issue);

describe('12.1-04 layout, behavior 1: flatten', () => {
  it('lists the question ids of all steps in order; an empty step contributes nothing', () => {
    expect(flatten(base())).toEqual(['a', 'b', 'c']);
    expect(flatten([])).toEqual([]);
    expect(flatten([{ stepId: 'x', questionIds: [] }])).toEqual([]);
  });
});

describe('12.1-04 layout, behavior 2: addQuestion', () => {
  it('appends to the END of the named step', () => {
    const next = layoutOf(addQuestion(base(), 's1', 'z'));
    expect(next.map((step) => step.questionIds)).toEqual([['a', 'b', 'z'], ['c'], []]);
    expect(flatten(layoutOf(addQuestion(base(), 's3', 'z')))).toEqual(['a', 'b', 'c', 'z']);
  });

  it('an unknown step is unknown_step', () => {
    expect(issueOf(addQuestion(base(), 'nope', 'z'))).toBe('unknown_step');
  });

  it('a question already in the layout is order_mismatch (it would appear twice)', () => {
    expect(issueOf(addQuestion(base(), 's2', 'a'))).toBe('order_mismatch');
  });
});

describe('12.1-04 layout, behavior 3: moveQuestion', () => {
  it('removes the question from its step and appends it to the end of the target step', () => {
    const next = layoutOf(moveQuestion(base(), 'a', 's2'));
    expect(next.map((step) => step.questionIds)).toEqual([['b'], ['c', 'a'], []]);
  });

  it('moving to the same step is a no-op returning an equal layout', () => {
    const before = base();
    const next = layoutOf(moveQuestion(before, 'a', 's1'));
    expect(next).toEqual(before);
  });

  it('an unknown target step is unknown_step and an unknown question is order_mismatch', () => {
    expect(issueOf(moveQuestion(base(), 'a', 'nope'))).toBe('unknown_step');
    expect(issueOf(moveQuestion(base(), 'ghost', 's1'))).toBe('order_mismatch');
  });
});

describe('12.1-04 layout, behavior 4: reorderWithin and reorderSteps', () => {
  it('reorderWithin accepts exactly the step’s current ids in a new order', () => {
    const next = layoutOf(reorderWithin(base(), 's1', ['b', 'a']));
    expect(next.map((step) => step.questionIds)).toEqual([['b', 'a'], ['c'], []]);
  });

  it.each([
    ['a missing id', ['a']],
    ['an extra id', ['a', 'b', 'z']],
    ['a foreign id (from another step)', ['a', 'c']],
    ['a repeated id', ['a', 'a']],
    ['no ids', []],
  ])('reorderWithin refuses %s as order_mismatch', (_name, ids) => {
    expect(issueOf(reorderWithin(base(), 's1', ids))).toBe('order_mismatch');
  });

  it('reorderWithin of an unknown step is unknown_step', () => {
    expect(issueOf(reorderWithin(base(), 'nope', ['a']))).toBe('unknown_step');
  });

  it('reorderSteps accepts exactly the current step ids in a new order', () => {
    const next = layoutOf(reorderSteps(base(), ['s3', 's1', 's2']));
    expect(next.map((step) => step.stepId)).toEqual(['s3', 's1', 's2']);
    expect(flatten(next)).toEqual(['a', 'b', 'c']);
  });

  it.each([
    ['a missing step', ['s1', 's2']],
    ['an extra step', ['s1', 's2', 's3', 's4']],
    ['a repeated step', ['s1', 's1', 's2']],
  ])('reorderSteps refuses %s as order_mismatch', (_name, ids) => {
    expect(issueOf(reorderSteps(base(), ids))).toBe('order_mismatch');
  });
});

describe('12.1-04 layout, behavior 5: removeStep', () => {
  it('refuses a step that holds a question with step_not_empty', () => {
    expect(issueOf(removeStep(base(), 's1'))).toBe('step_not_empty');
  });

  it('refuses the only step with last_step, even when it is empty', () => {
    expect(issueOf(removeStep([{ stepId: 'only', questionIds: [] }], 'only'))).toBe('last_step');
  });

  it('drops an empty step when another one remains', () => {
    const next = layoutOf(removeStep(base(), 's3'));
    expect(next.map((step) => step.stepId)).toEqual(['s1', 's2']);
  });

  it('an unknown step is unknown_step', () => {
    expect(issueOf(removeStep(base(), 'nope'))).toBe('unknown_step');
  });
});

describe('12.1-04 layout, behavior 6: applyRequestedLayout', () => {
  it('accepts the same question and step ids; the requested grouping and order win', () => {
    const requested: Layout = [
      { stepId: 's3', questionIds: ['c', 'a'] },
      { stepId: 's1', questionIds: ['b'] },
      { stepId: 's2', questionIds: [] },
    ];
    const next = layoutOf(applyRequestedLayout(base(), requested));
    expect(next).toEqual(requested);
  });

  it.each([
    [
      'a missing question',
      [
        { stepId: 's1', questionIds: ['a'] },
        { stepId: 's2', questionIds: ['c'] },
        { stepId: 's3', questionIds: [] },
      ],
    ],
    [
      'an extra question',
      [
        { stepId: 's1', questionIds: ['a', 'b', 'x'] },
        { stepId: 's2', questionIds: ['c'] },
        { stepId: 's3', questionIds: [] },
      ],
    ],
    [
      'a question listed twice',
      [
        { stepId: 's1', questionIds: ['a', 'b'] },
        { stepId: 's2', questionIds: ['c', 'a'] },
        { stepId: 's3', questionIds: [] },
      ],
    ],
    [
      'a missing step',
      [
        { stepId: 's1', questionIds: ['a', 'b'] },
        { stepId: 's2', questionIds: ['c'] },
      ],
    ],
    [
      'a foreign step',
      [
        { stepId: 's1', questionIds: ['a', 'b'] },
        { stepId: 's2', questionIds: ['c'] },
        { stepId: 'ghost', questionIds: [] },
      ],
    ],
    [
      'a repeated step',
      [
        { stepId: 's1', questionIds: ['a', 'b'] },
        { stepId: 's1', questionIds: ['c'] },
        { stepId: 's3', questionIds: [] },
      ],
    ],
    ['no steps at all', []],
  ] as [string, Layout][])('refuses %s as order_mismatch', (_name, requested) => {
    expect(issueOf(applyRequestedLayout(base(), requested))).toBe('order_mismatch');
  });
});

describe('12.1-04 layout, behavior 7: renumber', () => {
  it('PFORM-28 precision: positions are the integers 1..n over the flattened order, no gap, no repeat', () => {
    const layouts: Layout[] = [
      base(),
      [
        { stepId: 'x', questionIds: ['q1', 'q2'] },
        { stepId: 'empty1', questionIds: [] },
        { stepId: 'empty2', questionIds: [] },
        { stepId: 'y', questionIds: ['q3'] },
        { stepId: 'empty3', questionIds: [] },
        { stepId: 'z', questionIds: ['q4', 'q5', 'q6'] },
      ],
      [{ stepId: 'only', questionIds: [] }],
      [],
    ];
    for (const layout of layouts) {
      const rows = renumber(layout);
      const n = flatten(layout).length;
      expect(rows.map((row) => row.position)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(rows.map((row) => row.id)).toEqual(flatten(layout));
      expect(rows.every((row) => Number.isInteger(row.position))).toBe(true);
    }
  });

  it('carries the step of each question', () => {
    expect(renumber(base())).toEqual([
      { id: 'a', stepId: 's1', position: 1 },
      { id: 'b', stepId: 's1', position: 2 },
      { id: 'c', stepId: 's2', position: 3 },
    ]);
  });

  it('PFORM-28 precision: the result is identical when computed twice (deterministic)', () => {
    expect(renumber(base())).toEqual(renumber(base()));
  });
});

describe('12.1-04 layout, behavior 8: checkLayoutOrder (D-623)', () => {
  it('accepts when every opener index is below its question’s index', () => {
    expect(
      checkLayoutOrder(base(), [
        { questionId: 'b', openerId: 'a' },
        { questionId: 'c', openerId: 'a' },
      ]),
    ).toEqual({ ok: true });
  });

  it('refuses the first violation in flattened order, naming the pair', () => {
    expect(
      checkLayoutOrder(base(), [
        { questionId: 'c', openerId: 'b' },
        { questionId: 'a', openerId: 'b' },
        { questionId: 'b', openerId: 'c' },
      ]),
    ).toEqual({ ok: false, issue: 'condition_order', questionId: 'a', openerId: 'b' });
  });

  it('PFORM-29 ordering: moving a step above the step holding an opener is refused with the pair', () => {
    const moved = layoutOf(reorderSteps(base(), ['s2', 's1', 's3']));
    expect(checkLayoutOrder(moved, [{ questionId: 'c', openerId: 'a' }])).toEqual({
      ok: false,
      issue: 'condition_order',
      questionId: 'c',
      openerId: 'a',
    });
  });

  it('a question that is its own opener is a violation (no tie is ever fine)', () => {
    expect(checkLayoutOrder(base(), [{ questionId: 'a', openerId: 'a' }]).ok).toBe(false);
  });

  it('an opener absent from the layout is a violation', () => {
    expect(checkLayoutOrder(base(), [{ questionId: 'b', openerId: 'ghost' }]).ok).toBe(false);
  });

  it('a fact about a question that is not in the layout is ignored', () => {
    expect(checkLayoutOrder(base(), [{ questionId: 'archived', openerId: 'a' }])).toEqual({
      ok: true,
    });
  });

  it('with no facts it accepts, whatever the layout', () => {
    expect(checkLayoutOrder(base(), [])).toEqual({ ok: true });
    expect(checkLayoutOrder([], [])).toEqual({ ok: true });
  });
});

describe('12.1-04 layout, behavior 9: no operation mutates its input', () => {
  it('runs every operation on a deep-frozen layout without throwing', () => {
    const layout = base();
    const snapshot = JSON.stringify(layout);
    addQuestion(layout, 's1', 'z');
    moveQuestion(layout, 'a', 's2');
    reorderWithin(layout, 's1', ['b', 'a']);
    reorderSteps(layout, ['s3', 's2', 's1']);
    removeStep(layout, 's3');
    applyRequestedLayout(layout, [
      { stepId: 's2', questionIds: ['a'] },
      { stepId: 's1', questionIds: ['b', 'c'] },
      { stepId: 's3', questionIds: [] },
    ]);
    renumber(layout);
    checkLayoutOrder(layout, [{ questionId: 'b', openerId: 'a' }]);
    flatten(layout);
    expect(JSON.stringify(layout)).toBe(snapshot);
  });

  it('returns a fresh layout, not the same array', () => {
    const layout = base();
    expect(layoutOf(moveQuestion(layout, 'a', 's1'))).not.toBe(layout);
  });
});

describe('quick 261106-ei5 layout: addQuestionAfterOpener', () => {
  const wide = (): Layout =>
    freeze([
      { stepId: 's1', questionIds: ['o', 'x', 'd1', 'y'] },
      { stepId: 's2', questionIds: ['p', 'q'] },
      { stepId: 's3', questionIds: [] },
    ]);
  const idsOf = (layout: Layout) => layout.map((step) => step.questionIds);

  it('puts the new id right after the opener when the opener has no dependent in the step', () => {
    const next = layoutOf(addQuestionAfterOpener(wide(), 's1', 'n', 'o', []));
    expect(idsOf(next)).toEqual([['o', 'n', 'x', 'd1', 'y'], ['p', 'q'], []]);
  });

  it('puts the new id after the LAST dependent of the opener, skipping a non-dependent in between and a dependent of another opener', () => {
    const layout = freeze([
      { stepId: 's1', questionIds: ['o', 'd1', 'x', 'd2', 'e', 'y'] },
      { stepId: 's2', questionIds: [] },
    ]);
    const facts = [
      { questionId: 'd1', openerId: 'o' },
      { questionId: 'd2', openerId: 'o' },
      { questionId: 'e', openerId: 'x' },
    ];
    const next = layoutOf(addQuestionAfterOpener(layout, 's1', 'n', 'o', facts));
    expect(idsOf(next)).toEqual([['o', 'd1', 'x', 'd2', 'n', 'e', 'y'], []]);
  });

  it('ignores a dependent of the opener in another step and one sitting before the opener', () => {
    const layout = freeze([
      { stepId: 's1', questionIds: ['d0', 'o', 'x'] },
      { stepId: 's2', questionIds: ['d9', 'z'] },
    ]);
    const facts = [
      { questionId: 'd0', openerId: 'o' },
      { questionId: 'd9', openerId: 'o' },
    ];
    const next = layoutOf(addQuestionAfterOpener(layout, 's1', 'n', 'o', facts));
    expect(idsOf(next)).toEqual([
      ['d0', 'o', 'n', 'x'],
      ['d9', 'z'],
    ]);
  });

  it('goes to the end of the named step when the opener sits in another step', () => {
    const next = layoutOf(addQuestionAfterOpener(wide(), 's2', 'n', 'o', []));
    expect(idsOf(next)).toEqual([['o', 'x', 'd1', 'y'], ['p', 'q', 'n'], []]);
  });

  it('goes to the end of the named step when the opener is not in the layout', () => {
    const next = layoutOf(addQuestionAfterOpener(wide(), 's1', 'n', 'ghost', []));
    expect(idsOf(next)).toEqual([['o', 'x', 'd1', 'y', 'n'], ['p', 'q'], []]);
  });

  it('equals addQuestion when there is no opener', () => {
    expect(addQuestionAfterOpener(wide(), 's2', 'n', null, [])).toEqual(
      addQuestion(wide(), 's2', 'n'),
    );
  });

  it('an unknown step is unknown_step and an id already in the layout is order_mismatch', () => {
    expect(issueOf(addQuestionAfterOpener(wide(), 'nope', 'n', 'o', []))).toBe('unknown_step');
    expect(issueOf(addQuestionAfterOpener(wide(), 's1', 'x', 'o', []))).toBe('order_mismatch');
  });

  it('does not mutate frozen inputs and returns a fresh layout', () => {
    const layout = wide();
    const facts = Object.freeze([Object.freeze({ questionId: 'd1', openerId: 'o' })]);
    const snapshot = JSON.stringify(layout);
    const next = layoutOf(addQuestionAfterOpener(layout, 's1', 'n', 'o', facts));
    expect(JSON.stringify(layout)).toBe(snapshot);
    expect(next).not.toBe(layout);
    expect(idsOf(next)[0]).toEqual(['o', 'x', 'd1', 'n', 'y']);
  });
});
