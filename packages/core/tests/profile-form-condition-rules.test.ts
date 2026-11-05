import { describe, expect, it } from 'vitest';
import {
  checkCondition,
  checkConditionLock,
  checkOpenerChange,
  checkReactivation,
  dependentsOf,
  type RuleQuestion,
} from '../server/profile-form/condition-rules';
import type { Layout } from '../server/profile-form/layout';

/**
 * 12.1-04 (D-620..D-623, D-625, D-632; PFORM-29): the pure condition rules, no database and no mocks.
 * One row per accept or refuse, the boundary of each beside it.
 */

const OPT_A = 'a0000000-0000-4000-8000-000000000001';
const OPT_B = 'b0000000-0000-4000-8000-000000000002';
const OPT_C = 'c0000000-0000-4000-8000-000000000003';

const q = (id: string, over: Partial<RuleQuestion> = {}): RuleQuestion => ({
  id,
  type: 'short_text',
  title: `Titulo ${id}`,
  archived: false,
  options: [],
  conditionQuestionId: null,
  conditionValues: null,
  ...over,
});

const yesNo = (id: string, over: Partial<RuleQuestion> = {}) => q(id, { type: 'yes_no', ...over });
const choice = (id: string, over: Partial<RuleQuestion> = {}) =>
  q(id, { type: 'single_choice', options: [{ id: OPT_A }, { id: OPT_B }], ...over });

const oneStep = (...ids: string[]): Layout => [{ stepId: 's1', questionIds: ids }];

const check = (
  questions: RuleQuestion[],
  layout: Layout,
  condition: { questionId: string; values: string[] } | null,
  subjectId = 'sub',
) => checkCondition({ questions, layout, subjectId, condition });

const refusal = (result: ReturnType<typeof checkCondition>) => (result.ok ? null : result.issue);

describe('12.1-04 checkCondition, behavior 1: yes/no tokens (D-621)', () => {
  const questions = [yesNo('op'), q('sub')];
  const layout = oneStep('op', 'sub');

  it.each([['true'], ['false'], ['true', 'false']])('accepts %j', (...values) => {
    expect(check(questions, layout, { questionId: 'op', values }).ok).toBe(true);
  });

  it.each([[['yes']], [[]], [['true', 'true']], [['TRUE']]])(
    'refuses %j as condition_invalid',
    (values) => {
      expect(refusal(check(questions, layout, { questionId: 'op', values }))).toBe(
        'condition_invalid',
      );
    },
  );
});

describe('12.1-04 checkCondition, behavior 2: choice tokens are option ids (D-621)', () => {
  const layout = oneStep('op', 'sub');

  it.each(['dropdown', 'multiple_choice', 'single_choice'])(
    '%s accepts one or two option ids',
    (type) => {
      const questions = [choice('op', { type }), q('sub')];
      expect(check(questions, layout, { questionId: 'op', values: [OPT_A] }).ok).toBe(true);
      expect(check(questions, layout, { questionId: 'op', values: [OPT_B, OPT_A] }).ok).toBe(true);
    },
  );

  it('refuses an id that is not one of the options and the "Outro" token', () => {
    const questions = [choice('op', { options: [{ id: OPT_A }] }), q('sub')];
    expect(refusal(check(questions, layout, { questionId: 'op', values: [OPT_B] }))).toBe(
      'condition_invalid',
    );
    expect(refusal(check(questions, layout, { questionId: 'op', values: ['other'] }))).toBe(
      'condition_invalid',
    );
    expect(refusal(check(questions, layout, { questionId: 'op', values: [OPT_A, OPT_C] }))).toBe(
      'condition_invalid',
    );
  });

  it('refuses a duplicate id', () => {
    const questions = [choice('op'), q('sub')];
    expect(refusal(check(questions, layout, { questionId: 'op', values: [OPT_A, OPT_A] }))).toBe(
      'condition_invalid',
    );
  });

  it('a yes/no token is not valid for a choice opener', () => {
    const questions = [choice('op'), q('sub')];
    expect(refusal(check(questions, layout, { questionId: 'op', values: ['true'] }))).toBe(
      'condition_invalid',
    );
  });
});

describe('12.1-04 checkCondition, behavior 3: who may open (D-620, D-622)', () => {
  const layout = oneStep('op', 'sub');

  it.each([
    'short_text',
    'long_text',
    'number',
    'date',
    'phone',
    'email',
    'link',
    'acceptance',
    'rating',
  ])('an opener of type %s is refused', (type) => {
    const questions = [q('op', { type, options: [{ id: OPT_A }] }), q('sub')];
    expect(refusal(check(questions, layout, { questionId: 'op', values: [OPT_A] }))).toBe(
      'condition_invalid',
    );
  });

  it('an archived opener is refused', () => {
    const questions = [yesNo('op', { archived: true }), q('sub')];
    expect(refusal(check(questions, layout, { questionId: 'op', values: ['true'] }))).toBe(
      'condition_invalid',
    );
  });

  it('a question naming itself as opener is refused', () => {
    const questions = [yesNo('sub'), yesNo('op')];
    expect(
      refusal(check(questions, oneStep('op', 'sub'), { questionId: 'sub', values: ['true'] })),
    ).toBe('condition_invalid');
  });

  it('an opener absent from the list is refused (foreign or unknown id)', () => {
    const questions = [q('sub')];
    expect(
      refusal(check(questions, oneStep('sub'), { questionId: 'ghost', values: ['true'] })),
    ).toBe('condition_invalid');
  });

  it('an opener that is in the list but not in the layout is refused', () => {
    const questions = [yesNo('op'), q('sub')];
    expect(refusal(check(questions, oneStep('sub'), { questionId: 'op', values: ['true'] }))).toBe(
      'condition_invalid',
    );
  });

  it('PFORM-29 prohibition: a chain never passes, whatever the order', () => {
    // op2 opens sub, but op2 itself carries a condition on op1.
    const chained = [
      yesNo('op1'),
      yesNo('op2', { conditionQuestionId: 'op1', conditionValues: ['true'] }),
      q('sub'),
    ];
    for (const order of [
      ['op1', 'op2', 'sub'],
      ['op2', 'op1', 'sub'],
      ['sub', 'op1', 'op2'],
    ]) {
      expect(
        refusal(check(chained, oneStep(...order), { questionId: 'op2', values: ['true'] })),
      ).toBe('condition_invalid');
    }
  });
});

describe('12.1-04 checkCondition, behavior 4: an opener cannot gain a condition (D-622)', () => {
  it('a question that is an active opener of another is refused', () => {
    const questions = [
      yesNo('first'),
      yesNo('sub'),
      q('dep', { conditionQuestionId: 'sub', conditionValues: ['true'] }),
    ];
    expect(
      refusal(
        check(questions, oneStep('first', 'sub', 'dep'), { questionId: 'first', values: ['true'] }),
      ),
    ).toBe('condition_invalid');
  });

  it('an ARCHIVED dependent does not make the question an opener', () => {
    const questions = [
      yesNo('first'),
      yesNo('sub'),
      q('dep', { conditionQuestionId: 'sub', conditionValues: ['true'], archived: true }),
    ];
    expect(
      check(questions, oneStep('first', 'sub', 'dep'), { questionId: 'first', values: ['true'] })
        .ok,
    ).toBe(true);
  });
});

describe('12.1-04 checkCondition, behavior 5: opener before the shown question (D-623)', () => {
  it('an opener after the question is condition_order naming the pair', () => {
    const questions = [q('sub'), yesNo('op')];
    const result = check(questions, oneStep('sub', 'op'), { questionId: 'op', values: ['true'] });
    expect(result).toEqual({
      ok: false,
      issue: 'condition_order',
      questionId: 'sub',
      openerId: 'op',
    });
  });

  it('the same opener in an earlier step is accepted', () => {
    const questions = [q('sub'), yesNo('op')];
    const layout: Layout = [
      { stepId: 's1', questionIds: ['op'] },
      { stepId: 's2', questionIds: ['sub'] },
    ];
    expect(check(questions, layout, { questionId: 'op', values: ['true'] }).ok).toBe(true);
  });

  it('the opener in a LATER step is refused even when the steps hold one question each', () => {
    const questions = [q('sub'), yesNo('op')];
    const layout: Layout = [
      { stepId: 's1', questionIds: ['sub'] },
      { stepId: 's2', questionIds: ['op'] },
    ];
    expect(refusal(check(questions, layout, { questionId: 'op', values: ['true'] }))).toBe(
      'condition_order',
    );
  });

  it('PFORM-29 ordering: one place AFTER is refused, one place BEFORE is accepted, never a tie', () => {
    const questions = [yesNo('op'), q('sub'), q('x')];
    const condition = { questionId: 'op', values: ['true'] };
    expect(refusal(check(questions, oneStep('sub', 'op', 'x'), condition))).toBe('condition_order');
    expect(check(questions, oneStep('op', 'sub', 'x'), condition).ok).toBe(true);
    expect(check(questions, oneStep('x', 'op', 'sub'), condition).ok).toBe(true);
  });

  it('a subject that is not yet in the layout counts as sitting after everything', () => {
    const questions = [yesNo('op')];
    expect(check(questions, oneStep('op'), { questionId: 'op', values: ['true'] }).ok).toBe(true);
  });
});

describe('12.1-04 checkCondition, PFORM-29 edges', () => {
  it('PFORM-29 adjacency: opener immediately before the dependent is accepted', () => {
    const questions = [yesNo('op'), q('sub')];
    expect(check(questions, oneStep('op', 'sub'), { questionId: 'op', values: ['true'] }).ok).toBe(
      true,
    );
  });

  it('PFORM-29 adjacency: last slot of one step and first slot of the next is accepted', () => {
    const questions = [q('a'), yesNo('op'), q('sub'), q('b')];
    const layout: Layout = [
      { stepId: 's1', questionIds: ['a', 'op'] },
      { stepId: 's2', questionIds: ['sub', 'b'] },
    ];
    expect(check(questions, layout, { questionId: 'op', values: ['true'] }).ok).toBe(true);
  });

  it('PFORM-29 adjacency: a question naming itself is refused condition_invalid', () => {
    const questions = [yesNo('sub')];
    expect(refusal(check(questions, oneStep('sub'), { questionId: 'sub', values: ['true'] }))).toBe(
      'condition_invalid',
    );
  });

  it('PFORM-29 adjacency: an empty step between opener and dependent changes nothing', () => {
    const questions = [yesNo('op'), q('sub')];
    const layout: Layout = [
      { stepId: 's1', questionIds: ['op'] },
      { stepId: 'empty', questionIds: [] },
      { stepId: 's3', questionIds: ['sub'] },
    ];
    expect(check(questions, layout, { questionId: 'op', values: ['true'] }).ok).toBe(true);
  });

  it('PFORM-29 empty: a condition with no values is refused', () => {
    const questions = [yesNo('op'), q('sub')];
    expect(refusal(check(questions, oneStep('op', 'sub'), { questionId: 'op', values: [] }))).toBe(
      'condition_invalid',
    );
  });

  it('PFORM-29 empty: a null condition is not checked at all (removal is always allowed)', () => {
    // Even a layout and a list that are otherwise broken: removal needs no facts.
    expect(check([], [], null).ok).toBe(true);
    expect(check([q('sub')], oneStep('sub'), null).ok).toBe(true);
  });

  it('PFORM-29 empty: an opener absent from an empty list is refused', () => {
    expect(refusal(check([], [], { questionId: 'op', values: ['true'] }))).toBe(
      'condition_invalid',
    );
  });
});

describe('12.1-04 checkConditionLock, behavior 6 (D-625)', () => {
  const one = { questionId: 'op', values: [OPT_A, OPT_B] };

  it('with answers, a gained condition is refused', () => {
    expect(checkConditionLock({ answerCount: 3, current: null, next: one })).toBe(
      'condition_locked',
    );
  });

  it('with answers, a changed value set or a changed opener is refused', () => {
    expect(
      checkConditionLock({
        answerCount: 3,
        current: one,
        next: { questionId: 'op', values: [OPT_A] },
      }),
    ).toBe('condition_locked');
    expect(
      checkConditionLock({
        answerCount: 3,
        current: one,
        next: { questionId: 'other', values: [OPT_A, OPT_B] },
      }),
    ).toBe('condition_locked');
  });

  it('with answers, the same set in another order is unchanged and passes', () => {
    expect(
      checkConditionLock({
        answerCount: 3,
        current: one,
        next: { questionId: 'op', values: [OPT_B, OPT_A] },
      }),
    ).toBeNull();
  });

  it('with answers, removal passes and so does an unchanged condition', () => {
    expect(checkConditionLock({ answerCount: 3, current: one, next: null })).toBeNull();
    expect(checkConditionLock({ answerCount: 3, current: null, next: null })).toBeNull();
    expect(checkConditionLock({ answerCount: 3, current: one, next: { ...one } })).toBeNull();
  });

  it('with no answers everything passes', () => {
    expect(checkConditionLock({ answerCount: 0, current: null, next: one })).toBeNull();
    expect(
      checkConditionLock({
        answerCount: 0,
        current: one,
        next: { questionId: 'z', values: ['x'] },
      }),
    ).toBeNull();
  });
});

describe('12.1-04 dependents, opener changes and reactivation, behavior 7 (D-632)', () => {
  const dep = (id: string, values: string[], over: Partial<RuleQuestion> = {}) =>
    q(id, { conditionQuestionId: 'op', conditionValues: values, ...over });

  const questions = [
    choice('op', { options: [{ id: OPT_A }, { id: OPT_B }, { id: OPT_C }] }),
    dep('d1', [OPT_A]),
    dep('d2', [OPT_B], { archived: true }),
    dep('d3', [OPT_A, OPT_B]),
    q('free'),
  ];

  it('dependentsOf lists only ACTIVE dependents, in list order', () => {
    expect(dependentsOf(questions, 'op')).toEqual([
      { id: 'd1', title: 'Titulo d1' },
      { id: 'd3', title: 'Titulo d3' },
    ]);
    expect(dependentsOf(questions, 'free')).toEqual([]);
  });

  it('archiving an opener with active dependents is has_dependents with the list', () => {
    expect(checkOpenerChange({ questions, openerId: 'op', archive: true })).toEqual({
      issue: 'has_dependents',
      dependents: [
        { id: 'd1', title: 'Titulo d1' },
        { id: 'd3', title: 'Titulo d3' },
      ],
    });
  });

  it('a type change is has_dependents', () => {
    expect(checkOpenerChange({ questions, openerId: 'op', nextType: 'yes_no' })?.issue).toBe(
      'has_dependents',
    );
  });

  it('keeping the same type is not a change', () => {
    expect(checkOpenerChange({ questions, openerId: 'op', nextType: 'single_choice' })).toBeNull();
  });

  it('removing a referenced option lists only the dependents that reference it', () => {
    expect(checkOpenerChange({ questions, openerId: 'op', removedOptionIds: [OPT_B] })).toEqual({
      issue: 'has_dependents',
      dependents: [{ id: 'd3', title: 'Titulo d3' }],
    });
  });

  it('removing an unreferenced option is allowed (an archived dependent does not count)', () => {
    expect(checkOpenerChange({ questions, openerId: 'op', removedOptionIds: [OPT_C] })).toBeNull();
  });

  it('with no active dependent nothing is refused', () => {
    expect(checkOpenerChange({ questions, openerId: 'free', archive: true })).toBeNull();
    expect(
      checkOpenerChange({
        questions: [choice('op'), dep('only', [OPT_A], { archived: true })],
        openerId: 'op',
        archive: true,
      }),
    ).toBeNull();
  });

  it('checkReactivation refuses a conditional question whose opener is archived', () => {
    const list = [
      yesNo('op', { archived: true }),
      q('sub', {
        archived: true,
        conditionQuestionId: 'op',
        conditionValues: ['true'],
      }),
    ];
    expect(
      refusal(
        checkReactivation({ questions: list, layout: oneStep('op', 'sub'), questionId: 'sub' }),
      ),
    ).toBe('condition_invalid');
  });

  it('checkReactivation refuses an opener that gained a condition, lost the option or moved after', () => {
    const base = (opener: RuleQuestion, values = [OPT_A]) => [
      opener,
      q('sub', { archived: true, conditionQuestionId: 'op', conditionValues: values }),
    ];
    const asked = (list: RuleQuestion[], layout = oneStep('op', 'sub')) =>
      refusal(checkReactivation({ questions: list, layout, questionId: 'sub' }));

    expect(asked(base(choice('op', { conditionQuestionId: 'x', conditionValues: ['true'] })))).toBe(
      'condition_invalid',
    );
    expect(asked(base(choice('op', { options: [{ id: OPT_B }] })))).toBe('condition_invalid');
    expect(asked(base(choice('op')), oneStep('sub', 'op'))).toBe('condition_order');
  });

  it('checkReactivation accepts a still-valid condition and a question with no condition', () => {
    const list = [
      choice('op'),
      q('sub', { archived: true, conditionQuestionId: 'op', conditionValues: [OPT_A] }),
      q('plain', { archived: true }),
    ];
    const layout = oneStep('op', 'sub', 'plain');
    expect(checkReactivation({ questions: list, layout, questionId: 'sub' }).ok).toBe(true);
    expect(checkReactivation({ questions: list, layout, questionId: 'plain' }).ok).toBe(true);
  });

  it('checkReactivation of an unknown question is unknown_question', () => {
    expect(refusal(checkReactivation({ questions: [], layout: [], questionId: 'ghost' }))).toBe(
      'unknown_question',
    );
  });
});
