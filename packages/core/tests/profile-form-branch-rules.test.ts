import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import {
  type BranchCheck,
  type BranchRuleBranch,
  type BranchRuleQuestion,
  branchFactsOf,
  branchHeight,
  branchLevel,
  checkBranch,
  publicUnderPrivate,
  subtreeOf,
} from '../server/profile-form/branch-rules';
import type { Layout } from '../server/profile-form/layout';

/**
 * 12.2-04 (D-641, D-643, D-644, D-646, D-653; PFORM-44, PFORM-48, PFORM-53): the pure branch rules, no
 * database and no mocks. The clinic tree of the phase: Q1 (single choice) opens B1 holding Q2 and Q3; Q2
 * (yes/no) opens B2 holding Q4 and Q5; Q5 (yes/no) opens B3 holding Q6. Every refusal has its own row, in the
 * documented order, and a malformed stored tree is a refusal that terminates.
 */

const TEM = 'a0000000-0000-4000-8000-000000000001';
const TRABALHA = 'a0000000-0000-4000-8000-000000000002';
const APRENDE = 'a0000000-0000-4000-8000-000000000003';

const q = (id: string, over: Partial<BranchRuleQuestion> = {}): BranchRuleQuestion => ({
  id,
  type: 'short_text',
  title: `Titulo ${id}`,
  archived: false,
  showOnProfile: true,
  options: [],
  branchId: null,
  ...over,
});
const yesNo = (id: string, over: Partial<BranchRuleQuestion> = {}) =>
  q(id, { type: 'yes_no', ...over });
const choice = (id: string, over: Partial<BranchRuleQuestion> = {}) =>
  q(id, {
    type: 'single_choice',
    options: [{ id: TEM }, { id: TRABALHA }, { id: APRENDE }],
    ...over,
  });

const b = (
  id: string,
  openerQuestionId: string,
  values: string[],
  over: Partial<BranchRuleBranch> = {},
): BranchRuleBranch => ({ id, openerQuestionId, values, archived: false, name: null, ...over });

const oneStep = (...ids: string[]): Layout => [{ stepId: 's1', questionIds: ids }];

/** The clinic tree, plus q7 (a free single choice) and q8 (a free yes/no) outside every branch. */
const clinic = () => {
  const questions: BranchRuleQuestion[] = [
    choice('q1'),
    yesNo('q2', { branchId: 'b1' }),
    q('q3', { branchId: 'b1' }),
    q('q4', { type: 'number', branchId: 'b2' }),
    yesNo('q5', { branchId: 'b2' }),
    yesNo('q6', { branchId: 'b3' }),
    choice('q7'),
  ];
  const branches: BranchRuleBranch[] = [
    b('b1', 'q1', [TEM]),
    b('b2', 'q2', ['true']),
    b('b3', 'q5', ['true']),
  ];
  return { questions, branches, layout: oneStep('q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7') };
};

const refusal = (result: BranchCheck) => (result.ok ? null : result.issue);

describe('12.2-04 checkBranch, tracer: the depth-3 clinic tree', () => {
  it('accepts a second branch of Q1 with an overlapping value set', () => {
    const { questions, branches, layout } = clinic();
    const result = checkBranch({
      questions,
      branches,
      layout,
      openerId: 'q1',
      values: [TEM, TRABALHA],
      creating: true,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an empty branch (no question holds it yet)', () => {
    const { questions, branches, layout } = clinic();
    expect(
      checkBranch({
        questions,
        branches,
        layout,
        openerId: 'q1',
        values: [APRENDE],
        creating: true,
      }).ok,
    ).toBe(true);
  });

  it('accepts a second branch on Q5, the third level (levels above 2, own height 1)', () => {
    const { questions, branches, layout } = clinic();
    expect(
      checkBranch({
        questions,
        branches,
        layout,
        openerId: 'q5',
        values: ['false'],
        creating: true,
      }).ok,
    ).toBe(true);
  });

  it('refuses a fourth level as branch_depth (a branch hung on Q6, which sits in B3)', () => {
    const { questions, branches, layout } = clinic();
    expect(
      refusal(
        checkBranch({
          questions,
          branches,
          layout,
          openerId: 'q6',
          values: ['true'],
          creating: true,
        }),
      ),
    ).toBe('branch_depth');
  });

  it('refuses an unknown opener, an archived opener and an opener outside the layout as condition_invalid', () => {
    const { questions, branches, layout } = clinic();
    const base = { branches, creating: true, values: [TEM] };
    expect(refusal(checkBranch({ ...base, questions, layout, openerId: 'ghost' }))).toBe(
      'condition_invalid',
    );
    expect(
      refusal(
        checkBranch({
          ...base,
          questions: questions.map((x) => (x.id === 'q7' ? { ...x, archived: true } : x)),
          layout,
          openerId: 'q7',
        }),
      ),
    ).toBe('condition_invalid');
    expect(
      refusal(checkBranch({ ...base, questions, layout: oneStep('q1', 'q2'), openerId: 'q7' })),
    ).toBe('condition_invalid');
  });

  it.each(['short_text', 'long_text', 'number', 'date'])(
    'refuses a %s opener (the type cannot open)',
    (type) => {
      const { questions, branches, layout } = clinic();
      const typed = questions.map((x) => (x.id === 'q7' ? { ...x, type } : x));
      expect(
        refusal(
          checkBranch({
            questions: typed,
            branches,
            layout,
            openerId: 'q7',
            values: [TEM],
            creating: true,
          }),
        ),
      ).toBe('condition_invalid');
    },
  );

  it.each([
    ['empty set', []],
    ['a duplicate', [TEM, TEM]],
    ['a value that is not an option of the opener', ['a0000000-0000-4000-8000-0000000000ff']],
    ['"Outro" (no option id)', ['outro']],
    ['a yes/no token on a choice', ['true']],
  ])('refuses %s as condition_invalid', (_name, values) => {
    const { questions, branches, layout } = clinic();
    expect(
      refusal(checkBranch({ questions, branches, layout, openerId: 'q1', values, creating: true })),
    ).toBe('condition_invalid');
  });

  it.each([[['yes']], [['TRUE']], [[TEM]]])(
    'refuses %j on a yes/no opener, only true and false are tokens',
    (values) => {
      const { questions, branches, layout } = clinic();
      expect(
        refusal(
          checkBranch({ questions, branches, layout, openerId: 'q5', values, creating: true }),
        ),
      ).toBe('condition_invalid');
    },
  );

  it('accepts both tokens of a yes/no opener', () => {
    const { questions, branches, layout } = clinic();
    expect(
      checkBranch({
        questions,
        branches,
        layout,
        openerId: 'q5',
        values: ['true', 'false'],
        creating: true,
      }).ok,
    ).toBe(true);
  });

  it('refuses an opener that is a member of the branch itself (a question is never its own opener)', () => {
    const { questions, branches, layout } = clinic();
    expect(
      refusal(
        checkBranch({
          questions,
          branches,
          layout,
          openerId: 'q2',
          values: ['true'],
          branchId: 'b1',
        }),
      ),
    ).toBe('condition_invalid');
  });

  it('refuses an opener inside the branch own subtree as condition_invalid (a cycle), before the order rule', () => {
    const { questions, branches, layout } = clinic();
    // Q5 sits in B2, which hangs on Q2 of B1: moving B1 under Q5 would close a loop. Q5 is also after Q2,
    // so the order rule would fail too, and the cycle must win.
    expect(
      refusal(
        checkBranch({
          questions,
          branches,
          layout,
          openerId: 'q5',
          values: ['true'],
          branchId: 'b1',
        }),
      ),
    ).toBe('condition_invalid');
  });

  it('refuses an opener after a question of the branch as condition_order naming the pair', () => {
    const { questions, branches, layout } = clinic();
    const result = checkBranch({
      questions,
      branches,
      layout,
      openerId: 'q7',
      values: [TEM],
      branchId: 'b1',
    });
    expect(result).toEqual({
      ok: false,
      issue: 'condition_order',
      questionId: 'q2',
      openerId: 'q7',
    });
  });

  it('names the FIRST violated pair in the flattened order of the question', () => {
    const { questions, branches } = clinic();
    // q3 and q2 both come before the opener q7 here: the first in the flattened order is q3.
    const layout = oneStep('q1', 'q3', 'q2', 'q7', 'q4', 'q5', 'q6');
    const result = checkBranch({
      questions,
      branches,
      layout,
      openerId: 'q7',
      values: [TEM],
      branchId: 'b1',
    });
    expect(result).toEqual({
      ok: false,
      issue: 'condition_order',
      questionId: 'q3',
      openerId: 'q7',
    });
  });

  it('refuses an opener in the middle of its own members, naming the member that comes before it', () => {
    const { questions, branches } = clinic();
    const layout = oneStep('q1', 'q2', 'q7', 'q3', 'q4', 'q5', 'q6');
    const result = checkBranch({
      questions,
      branches,
      layout,
      openerId: 'q7',
      values: [TEM],
      branchId: 'b1',
    });
    expect(result).toEqual({
      ok: false,
      issue: 'condition_order',
      questionId: 'q2',
      openerId: 'q7',
    });
  });

  it('passes an opener at the end of one step and the first question of the branch at the start of the next', () => {
    const { questions, branches } = clinic();
    const layout: Layout = [
      { stepId: 's1', questionIds: ['q1'] },
      { stepId: 's2', questionIds: ['q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
    ];
    expect(
      checkBranch({ questions, branches, layout, openerId: 'q1', values: [TEM], branchId: 'b1' })
        .ok,
    ).toBe(true);
  });

  it('lets the questions of a branch sit in different steps while the opener stays strictly before all', () => {
    const { questions, branches } = clinic();
    const layout: Layout = [
      { stepId: 's1', questionIds: ['q1', 'q2'] },
      { stepId: 's2', questionIds: ['q3', 'q4', 'q5', 'q6', 'q7'] },
    ];
    expect(
      checkBranch({ questions, branches, layout, openerId: 'q1', values: [TEM], branchId: 'b1' })
        .ok,
    ).toBe(true);
  });

  it('refuses re-hanging a branch whose subtree is too tall: levels above the opener plus the own height', () => {
    const { questions, branches } = clinic();
    // B4 hangs on Q1 (level 1) and holds q8. Hanging B1 (height 3) under q8 would make 1 + 3 = 4 levels.
    const withQ8 = [...questions, yesNo('q8', { branchId: 'b4' })];
    const withB4 = [...branches, b('b4', 'q1', [APRENDE])];
    const layout = oneStep('q1', 'q8', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7');
    expect(
      refusal(
        checkBranch({
          questions: withQ8,
          branches: withB4,
          layout,
          openerId: 'q8',
          values: ['true'],
          branchId: 'b1',
        }),
      ),
    ).toBe('branch_depth');
  });

  it('reports condition_order before branch_depth when both would fail', () => {
    const { questions, branches } = clinic();
    const withQ8 = [...questions, yesNo('q8', { branchId: 'b4' })];
    const withB4 = [...branches, b('b4', 'q1', [APRENDE])];
    const layout = oneStep('q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q8', 'q7');
    expect(
      refusal(
        checkBranch({
          questions: withQ8,
          branches: withB4,
          layout,
          openerId: 'q8',
          values: ['true'],
          branchId: 'b1',
        }),
      ),
    ).toBe('condition_order');
  });

  it('refuses the sixteenth active branch as branch_limit, and ignores archived ones', () => {
    const questions = [choice('q1')];
    const many = (count: number, archived = false) =>
      Array.from({ length: count }, (_, i) => b(`x${i}`, 'q1', [TEM], { archived }));
    const layout = oneStep('q1');
    const input = { questions, layout, openerId: 'q1', values: [TRABALHA], creating: true };
    expect(checkBranch({ ...input, branches: many(PROFILE_FORM_LIMITS.branches - 1) }).ok).toBe(
      true,
    );
    expect(refusal(checkBranch({ ...input, branches: many(PROFILE_FORM_LIMITS.branches) }))).toBe(
      'branch_limit',
    );
    expect(checkBranch({ ...input, branches: many(PROFILE_FORM_LIMITS.branches, true) }).ok).toBe(
      true,
    );
  });

  it('does not count the limit when editing a branch', () => {
    const questions = [choice('q1'), q('q2', { branchId: 'x0' })];
    const branches = Array.from({ length: PROFILE_FORM_LIMITS.branches }, (_, i) =>
      b(`x${i}`, 'q1', [TEM]),
    );
    expect(
      checkBranch({
        questions,
        branches,
        layout: oneStep('q1', 'q2'),
        openerId: 'q1',
        values: [TRABALHA],
        branchId: 'x0',
      }).ok,
    ).toBe(true);
  });

  it('reports branch_depth before branch_limit when both would fail', () => {
    const { questions, branches, layout } = clinic();
    const filler = Array.from({ length: PROFILE_FORM_LIMITS.branches }, (_, i) =>
      b(`x${i}`, 'q1', [APRENDE]),
    );
    expect(
      refusal(
        checkBranch({
          questions,
          branches: [...branches, ...filler],
          layout,
          openerId: 'q6',
          values: ['true'],
          creating: true,
        }),
      ),
    ).toBe('branch_depth');
  });

  it('refuses a private opener that would put a public question under it, naming the titles', () => {
    const { questions, branches } = clinic();
    // q7 is private and now comes before q2; B1 re-hung on q7 puts every public question below under it.
    const typed = questions.map((x) => (x.id === 'q7' ? { ...x, showOnProfile: false } : x));
    const layout = oneStep('q1', 'q7', 'q2', 'q3', 'q4', 'q5', 'q6');
    const result = checkBranch({
      questions: typed,
      branches,
      layout,
      openerId: 'q7',
      values: [TEM],
      branchId: 'b1',
    });
    expect(result).toEqual({
      ok: false,
      issue: 'public_under_private',
      titles: ['Titulo q2', 'Titulo q3', 'Titulo q4', 'Titulo q5', 'Titulo q6'],
    });
  });

  it('does not refuse an unrelated edit because of a violation that was already stored', () => {
    const { questions, branches } = clinic();
    // q1 private with public members under it: stored that way (legacy). A new branch on q7 is unrelated.
    const typed = questions.map((x) => (x.id === 'q1' ? { ...x, showOnProfile: false } : x));
    expect(
      checkBranch({
        questions: typed,
        branches,
        layout: oneStep('q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'),
        openerId: 'q7',
        values: [TEM],
        creating: true,
      }).ok,
    ).toBe(true);
  });

  it('refuses an unknown branch being edited as unknown_branch', () => {
    const { questions, branches, layout } = clinic();
    expect(
      refusal(
        checkBranch({
          questions,
          branches,
          layout,
          openerId: 'q1',
          values: [TEM],
          branchId: 'nope',
        }),
      ),
    ).toBe('unknown_branch');
  });
});

describe('12.2-04 branchLevel, branchHeight, subtreeOf (D-644)', () => {
  const { questions, branches } = clinic();

  it('numbers the levels of the clinic tree', () => {
    expect(branchLevel('b1', questions, branches)).toBe(1);
    expect(branchLevel('b2', questions, branches)).toBe(2);
    expect(branchLevel('b3', questions, branches)).toBe(3);
  });

  it('measures the height of a branch counting itself', () => {
    expect(branchHeight('b1', questions, branches)).toBe(3);
    expect(branchHeight('b2', questions, branches)).toBe(2);
    expect(branchHeight('b3', questions, branches)).toBe(1);
  });

  it('returns null for an unknown branch', () => {
    expect(branchLevel('nope', questions, branches)).toBeNull();
    expect(branchHeight('nope', questions, branches)).toBeNull();
  });

  it('lists the branch, the branches below it and every question of those', () => {
    const subtree = subtreeOf(branches, questions, 'b1');
    expect(subtree.branchIds).toEqual(['b1', 'b2', 'b3']);
    expect(subtree.questionIds).toEqual(['q2', 'q3', 'q4', 'q5', 'q6']);
    expect(subtreeOf(branches, questions, 'b3')).toEqual({
      branchIds: ['b3'],
      questionIds: ['q6'],
    });
    expect(subtreeOf(branches, questions, 'nope')).toEqual({ branchIds: [], questionIds: [] });
  });
});

describe('12.2-04 a stored cycle or depth bomb is a refusal that terminates (D-644, T-12.2-07)', () => {
  // qa sits in bx and is the opener of bx: the shortest possible loop. qb/by is a loop of two.
  const loopQuestions = [
    choice('qa', { branchId: 'bx' }),
    choice('qb', { branchId: 'bz' }),
    choice('qc', { branchId: 'by' }),
  ];
  const loopBranches = [b('bx', 'qa', [TEM]), b('by', 'qb', [TEM]), b('bz', 'qc', [TEM])];
  const layout = oneStep('qa', 'qb', 'qc');

  it('walks never loop: level, height, subtree and privacy all end', () => {
    expect(branchLevel('bx', loopQuestions, loopBranches)).toBeNull();
    expect(branchHeight('bx', loopQuestions, loopBranches)).toBeNull();
    expect(branchLevel('by', loopQuestions, loopBranches)).toBeNull();
    expect(branchHeight('by', loopQuestions, loopBranches)).toBeNull();
    expect(subtreeOf(loopBranches, loopQuestions, 'bx').branchIds).toEqual(['bx']);
    expect(subtreeOf(loopBranches, loopQuestions, 'by').branchIds.sort()).toEqual(['by', 'bz']);
    expect(publicUnderPrivate(loopQuestions, loopBranches)).toEqual([]);
    expect(branchFactsOf(loopQuestions, loopBranches)).toHaveLength(3);
  }, 1000);

  it('checkBranch refuses editing the looped branch and hanging a new one under the loop', () => {
    expect(
      refusal(
        checkBranch({
          questions: loopQuestions,
          branches: loopBranches,
          layout,
          openerId: 'qa',
          values: [TEM],
          branchId: 'bx',
        }),
      ),
    ).toBe('condition_invalid');
    expect(
      refusal(
        checkBranch({
          questions: loopQuestions,
          branches: loopBranches,
          layout,
          openerId: 'qa',
          values: [TRABALHA],
          creating: true,
        }),
      ),
    ).toBe('condition_invalid');
  }, 1000);

  it('a chain longer than the limit reports a level over the limit and ends', () => {
    const depth = PROFILE_FORM_LIMITS.branchDepth + 3;
    const ids = Array.from({ length: depth }, (_, i) => i);
    const qs = ids.map((i) => choice(`d${i}`, { branchId: i === 0 ? null : `bd${i}` }));
    const bs = ids.slice(1).map((i) => b(`bd${i}`, `d${i - 1}`, [TEM]));
    const last = `bd${depth - 1}`;
    expect(branchLevel(last, qs, bs)).toBeGreaterThan(PROFILE_FORM_LIMITS.branchDepth);
    expect(branchHeight('bd1', qs, bs)).toBeGreaterThan(PROFILE_FORM_LIMITS.branchDepth);
  }, 1000);
});

describe('12.2-04 publicUnderPrivate and branchFactsOf, tracer cases (PFORM-53)', () => {
  it('is empty on the clinic tree and lists the public questions under a private opener', () => {
    const { questions, branches } = clinic();
    expect(publicUnderPrivate(questions, branches)).toEqual([]);
    const typed = questions.map((x) => (x.id === 'q1' ? { ...x, showOnProfile: false } : x));
    expect(publicUnderPrivate(typed, branches)).toEqual([
      'Titulo q2',
      'Titulo q3',
      'Titulo q4',
      'Titulo q5',
      'Titulo q6',
    ]);
  });

  it('derives one fact per active question in an active branch', () => {
    const { questions, branches } = clinic();
    expect(branchFactsOf(questions, branches)).toEqual([
      { questionId: 'q2', openerId: 'q1' },
      { questionId: 'q3', openerId: 'q1' },
      { questionId: 'q4', openerId: 'q2' },
      { questionId: 'q5', openerId: 'q2' },
      { questionId: 'q6', openerId: 'q5' },
    ]);
    const archivedBranch = branches.map((x) => (x.id === 'b2' ? { ...x, archived: true } : x));
    expect(branchFactsOf(questions, archivedBranch).map((f) => f.questionId)).toEqual([
      'q2',
      'q3',
      'q6',
    ]);
    const archivedQuestion = questions.map((x) => (x.id === 'q3' ? { ...x, archived: true } : x));
    expect(branchFactsOf(archivedQuestion, branches).map((f) => f.questionId)).not.toContain('q3');
  });
});
