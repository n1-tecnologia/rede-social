import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import {
  type BranchCheck,
  type BranchRuleBranch,
  type BranchRuleQuestion,
  branchFactsOf,
  branchHeight,
  branchLevel,
  checkArchiveBranch,
  checkBranch,
  checkBranchEdit,
  checkMoveIntoBranch,
  checkOpenerChange,
  checkReactivateBranch,
  checkReactivation,
  dependentBranchesOf,
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

describe('12.2-04 checkBranchEdit (D-646): the lock on a branch with answers', () => {
  const branch = b('b1', 'q1', [TEM, TRABALHA]);

  it('refuses a change of opener on a branch with an answered question', () => {
    expect(refusal(checkBranchEdit({ branch, openerId: 'q7', answeredQuestions: 1 }))).toBe(
      'condition_locked',
    );
  });

  it('refuses a change of the opening set, by set and not by order', () => {
    expect(refusal(checkBranchEdit({ branch, values: [TEM], answeredQuestions: 2 }))).toBe(
      'condition_locked',
    );
    expect(
      refusal(checkBranchEdit({ branch, values: [TEM, TRABALHA, APRENDE], answeredQuestions: 1 })),
    ).toBe('condition_locked');
  });

  it('allows a name change and an undo: the same opener, the same set in another order, or nothing', () => {
    expect(checkBranchEdit({ branch, answeredQuestions: 3 }).ok).toBe(true);
    expect(checkBranchEdit({ branch, openerId: 'q1', answeredQuestions: 3 }).ok).toBe(true);
    expect(checkBranchEdit({ branch, values: [TRABALHA, TEM], answeredQuestions: 3 }).ok).toBe(
      true,
    );
  });

  it('allows any change while no question of the branch has an answer', () => {
    expect(
      checkBranchEdit({ branch, openerId: 'q7', values: [APRENDE], answeredQuestions: 0 }).ok,
    ).toBe(true);
  });
});

describe('12.2-04 dependentBranchesOf (D-646): the branches that hang on an opener', () => {
  it('lists the active branches with the titles of their active questions', () => {
    const { questions, branches } = clinic();
    expect(dependentBranchesOf(branches, questions, 'q1')).toEqual([
      {
        id: 'b1',
        name: null,
        openerQuestionId: 'q1',
        values: [TEM],
        questions: [
          { id: 'q2', title: 'Titulo q2' },
          { id: 'q3', title: 'Titulo q3' },
        ],
      },
    ]);
    expect(dependentBranchesOf(branches, questions, 'q2').map((x) => x.id)).toEqual(['b2']);
  });

  it('skips an archived branch and an archived question, and lists an empty branch with no titles', () => {
    const { questions, branches } = clinic();
    const archivedBranch = branches.map((x) => (x.id === 'b1' ? { ...x, archived: true } : x));
    expect(dependentBranchesOf(archivedBranch, questions, 'q1')).toEqual([]);
    const archivedQuestion = questions.map((x) => (x.id === 'q3' ? { ...x, archived: true } : x));
    expect(
      dependentBranchesOf(branches, archivedQuestion, 'q1')[0]?.questions.map((x) => x.id),
    ).toEqual(['q2']);
    const empty = [...branches, b('b9', 'q7', [TEM], { name: 'Vazio' })];
    expect(dependentBranchesOf(empty, questions, 'q7')).toEqual([
      { id: 'b9', name: 'Vazio', openerQuestionId: 'q7', values: [TEM], questions: [] },
    ]);
  });

  it('is empty for a question that opens nothing', () => {
    const { questions, branches } = clinic();
    expect(dependentBranchesOf(branches, questions, 'q3')).toEqual([]);
  });
});

describe('12.2-04 checkOpenerChange (D-646): archive, retype and remove an option', () => {
  const withB4 = () => {
    const { questions, branches } = clinic();
    return {
      questions: [...questions, yesNo('q8', { branchId: 'b4' })],
      branches: [...branches, b('b4', 'q1', [APRENDE])],
    };
  };

  it('answers has_dependents with the active branches and their question titles when the opener is archived', () => {
    const { questions, branches } = withB4();
    const result = checkOpenerChange({ questions, branches, openerId: 'q1', archive: true });
    expect(result?.issue).toBe('has_dependents');
    expect(result?.branches.map((x) => x.id)).toEqual(['b1', 'b4']);
    expect(result?.branches[0]?.questions.map((x) => x.title)).toEqual(['Titulo q2', 'Titulo q3']);
  });

  it('answers has_dependents when the opener is retyped, and passes an unchanged type', () => {
    const { questions, branches } = withB4();
    expect(
      checkOpenerChange({ questions, branches, openerId: 'q1', newType: 'yes_no' })?.branches,
    ).toHaveLength(2);
    expect(
      checkOpenerChange({ questions, branches, openerId: 'q1', newType: 'single_choice' }),
    ).toBeNull();
  });

  it('lists only the branches that name a removed option, and passes an unreferenced one', () => {
    const { questions, branches } = withB4();
    expect(
      checkOpenerChange({
        questions,
        branches,
        openerId: 'q1',
        removedOptionIds: [APRENDE],
      })?.branches.map((x) => x.id),
    ).toEqual(['b4']);
    expect(
      checkOpenerChange({ questions, branches, openerId: 'q1', removedOptionIds: [TRABALHA] }),
    ).toBeNull();
  });

  it('ignores archived branches and openers with none', () => {
    const { questions, branches } = withB4();
    const archived = branches.map((x) =>
      x.id === 'b1' || x.id === 'b4' ? { ...x, archived: true } : x,
    );
    expect(
      checkOpenerChange({ questions, branches: archived, openerId: 'q1', archive: true }),
    ).toBeNull();
    expect(checkOpenerChange({ questions, branches, openerId: 'q3', archive: true })).toBeNull();
  });
});

describe('12.2-04 checkMoveIntoBranch (D-646): a question entering, leaving or changing branch', () => {
  const move = (
    over: Partial<Parameters<typeof checkMoveIntoBranch>[0]> & { questionId: string },
  ) => {
    const { questions, branches, layout } = clinic();
    return checkMoveIntoBranch({
      questions,
      branches,
      layout,
      branchId: 'b1',
      answered: 0,
      ...over,
    });
  };

  it('refuses a question with answers entering, leaving or changing branch as condition_locked', () => {
    expect(refusal(move({ questionId: 'q7', branchId: 'b1', answered: 1 }))).toBe(
      'condition_locked',
    );
    expect(refusal(move({ questionId: 'q2', branchId: null, answered: 1 }))).toBe(
      'condition_locked',
    );
    expect(refusal(move({ questionId: 'q2', branchId: 'b3', answered: 2 }))).toBe(
      'condition_locked',
    );
  });

  it('lets a question with answers stay where it is', () => {
    expect(move({ questionId: 'q2', branchId: 'b1', answered: 5 }).ok).toBe(true);
  });

  it('allows removing the branch from a question without answers', () => {
    expect(move({ questionId: 'q2', branchId: null }).ok).toBe(true);
  });

  it('refuses an unknown question, an unknown branch and an archived branch', () => {
    expect(refusal(move({ questionId: 'ghost' }))).toBe('unknown_question');
    expect(refusal(move({ questionId: 'q7', branchId: 'nope' }))).toBe('unknown_branch');
    const { questions, branches, layout } = clinic();
    const archived = branches.map((x) => (x.id === 'b1' ? { ...x, archived: true } : x));
    expect(
      checkMoveIntoBranch({
        questions,
        branches: archived,
        layout,
        questionId: 'q7',
        branchId: 'b1',
        answered: 0,
      }),
    ).toEqual({ ok: false, issue: 'branch_archived', branchId: 'b1' });
  });

  it('refuses an opener that does not come before the question, naming the pair', () => {
    const { questions, branches } = clinic();
    const layout = oneStep('q7', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6');
    expect(
      checkMoveIntoBranch({
        questions,
        branches,
        layout,
        questionId: 'q7',
        branchId: 'b1',
        answered: 0,
      }),
    ).toEqual({ ok: false, issue: 'condition_order', questionId: 'q7', openerId: 'q1' });
  });

  it('accepts a question that is being created: absent from the layout, it counts as after everything', () => {
    const { questions, branches, layout } = clinic();
    expect(
      checkMoveIntoBranch({
        questions: [...questions, q('new')],
        branches,
        layout,
        questionId: 'new',
        branchId: 'b1',
        answered: 0,
      }).ok,
    ).toBe(true);
  });

  it('refuses a branch that is the question own descendant as condition_invalid, before the order rule', () => {
    // q2 opens b2, and b3 hangs on q5 inside b2: q2 cannot sit in b3 (nor in b2 itself).
    expect(refusal(move({ questionId: 'q2', branchId: 'b3' }))).toBe('condition_invalid');
    expect(refusal(move({ questionId: 'q2', branchId: 'b2' }))).toBe('condition_invalid');
  });

  it('refuses a depth overflow counting the question own sub-branches', () => {
    const { questions, branches } = clinic();
    // b5 hangs on q9 (a member of b1), so it is level 2; q2 opens b2 and b3 below it (height 2): 2 + 2 > 3.
    const q9 = yesNo('q9', { branchId: 'b1' });
    const withB5 = [...questions, q9];
    const bs = [...branches, b('b5', 'q9', ['true'])];
    const layout = oneStep('q1', 'q9', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7');
    const input = { questions: withB5, branches: bs, layout, branchId: 'b5', answered: 0 };
    expect(refusal(checkMoveIntoBranch({ ...input, questionId: 'q2' }))).toBe('branch_depth');
    // q3 opens nothing: 2 + 0 fits.
    expect(checkMoveIntoBranch({ ...input, questionId: 'q3' }).ok).toBe(true);
  });

  it('refuses a public question under a private opener, listing the titles that would become public under it', () => {
    const { questions, branches } = clinic();
    const typed = questions.map((x) => (x.id === 'q1' ? { ...x, showOnProfile: false } : x));
    // The stored violation (q2..q6 under the private q1) is not blamed on q7.
    expect(
      checkMoveIntoBranch({
        questions: typed,
        branches,
        layout: oneStep('q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'),
        questionId: 'q7',
        branchId: 'b1',
        answered: 0,
      }),
    ).toEqual({ ok: false, issue: 'public_under_private', titles: ['Titulo q7'] });
  });

  it('counts the public descendants of a moved opener against the privacy rule', () => {
    const { questions, branches } = clinic();
    // q8 is private and opens the empty b4: moving q2 (which opens b2 and b3) into b4 exposes q2, q4, q5, q6.
    const qs = [...questions, choice('q8', { showOnProfile: false })];
    const bs = [...branches, b('b4', 'q8', [TEM])];
    const layout = oneStep('q1', 'q8', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7');
    expect(
      checkMoveIntoBranch({
        questions: qs,
        branches: bs,
        layout,
        questionId: 'q2',
        branchId: 'b4',
        answered: 0,
      }),
    ).toEqual({
      ok: false,
      issue: 'public_under_private',
      titles: ['Titulo q2', 'Titulo q4', 'Titulo q5', 'Titulo q6'],
    });
    const privateQ2 = qs.map((x) => (x.id === 'q2' ? { ...x, showOnProfile: false } : x));
    expect(
      checkMoveIntoBranch({
        questions: privateQ2,
        branches: bs,
        layout,
        questionId: 'q2',
        branchId: 'b4',
        answered: 0,
      }),
    ).toEqual({
      ok: false,
      issue: 'public_under_private',
      titles: ['Titulo q4', 'Titulo q5', 'Titulo q6'],
    });
  });
});

describe('12.2-04 checkArchiveBranch (D-653): a block goes out together', () => {
  it('passes a leaf branch and a block whose nested branches have no answers', () => {
    const { questions, branches } = clinic();
    expect(
      checkArchiveBranch({ questions, branches, branchId: 'b3', answeredBranchIds: [] }).ok,
    ).toBe(true);
    expect(
      checkArchiveBranch({ questions, branches, branchId: 'b1', answeredBranchIds: [] }).ok,
    ).toBe(true);
  });

  it('keeps the answers of the branch itself: only nested branches with answers refuse', () => {
    const { questions, branches } = clinic();
    expect(
      checkArchiveBranch({ questions, branches, branchId: 'b2', answeredBranchIds: ['b2'] }).ok,
    ).toBe(true);
  });

  it('refuses with has_dependents naming the openers of the nested branches that have answers', () => {
    const { questions, branches } = clinic();
    expect(
      checkArchiveBranch({
        questions,
        branches,
        branchId: 'b1',
        answeredBranchIds: new Set(['b3']),
      }),
    ).toEqual({
      ok: false,
      issue: 'has_dependents',
      dependents: [{ id: 'q5', title: 'Titulo q5' }],
    });
    expect(
      checkArchiveBranch({ questions, branches, branchId: 'b1', answeredBranchIds: ['b3', 'b2'] }),
    ).toEqual({
      ok: false,
      issue: 'has_dependents',
      dependents: [
        { id: 'q2', title: 'Titulo q2' },
        { id: 'q5', title: 'Titulo q5' },
      ],
    });
  });

  it('ignores a nested branch that is already archived, and refuses an unknown or archived target', () => {
    const { questions, branches } = clinic();
    const archivedNested = branches.map((x) => (x.id === 'b3' ? { ...x, archived: true } : x));
    expect(
      checkArchiveBranch({
        questions,
        branches: archivedNested,
        branchId: 'b1',
        answeredBranchIds: ['b3'],
      }).ok,
    ).toBe(true);
    expect(
      refusal(checkArchiveBranch({ questions, branches, branchId: 'nope', answeredBranchIds: [] })),
    ).toBe('unknown_branch');
    expect(
      refusal(
        checkArchiveBranch({
          questions,
          branches: archivedNested,
          branchId: 'b3',
          answeredBranchIds: [],
        }),
      ),
    ).toBe('already_archived');
  });
});

describe('12.2-04 checkReactivateBranch and checkReactivation (D-653): name the one thing to do first', () => {
  const archivedBlock = () => {
    const { questions, branches, layout } = clinic();
    return {
      layout,
      questions: questions.map((x) =>
        x.branchId === 'b2' || x.branchId === 'b3' ? { ...x, archived: true } : x,
      ),
      branches: branches.map((x) =>
        x.id === 'b2' || x.id === 'b3' ? { ...x, archived: true } : x,
      ),
    };
  };

  it('passes a block whose opener is active', () => {
    const { questions, branches } = archivedBlock();
    expect(checkReactivateBranch({ questions, branches, branchId: 'b2' }).ok).toBe(true);
  });

  it('refuses a block whose opener is archived, naming the opener', () => {
    const { questions, branches } = archivedBlock();
    const openerArchived = questions.map((x) => (x.id === 'q2' ? { ...x, archived: true } : x));
    expect(checkReactivateBranch({ questions: openerArchived, branches, branchId: 'b2' })).toEqual({
      ok: false,
      issue: 'condition_invalid',
      openerId: 'q2',
    });
  });

  it('refuses an unknown branch and a branch that is not archived', () => {
    const { questions, branches } = archivedBlock();
    expect(refusal(checkReactivateBranch({ questions, branches, branchId: 'nope' }))).toBe(
      'unknown_branch',
    );
    expect(refusal(checkReactivateBranch({ questions, branches, branchId: 'b1' }))).toBe(
      'not_archived',
    );
  });

  it('refuses a block that would put public questions under a private opener, or only the ones restored', () => {
    const { questions, branches } = archivedBlock();
    const typed = questions.map((x) => (x.id === 'q2' ? { ...x, showOnProfile: false } : x));
    const all = checkReactivateBranch({ questions: typed, branches, branchId: 'b2' });
    expect(all).toEqual({
      ok: false,
      issue: 'public_under_private',
      titles: ['Titulo q4', 'Titulo q5', 'Titulo q6'],
    });
    expect(
      checkReactivateBranch({
        questions: typed,
        branches,
        branchId: 'b2',
        restoredQuestionIds: ['q4'],
      }),
    ).toEqual({ ok: false, issue: 'public_under_private', titles: ['Titulo q4'] });
  });

  it('reactivating a question inside an archived branch names the branch to reactivate first', () => {
    const { questions, branches, layout } = archivedBlock();
    expect(checkReactivation({ questions, branches, layout, questionId: 'q4' })).toEqual({
      ok: false,
      issue: 'branch_archived',
      branchId: 'b2',
    });
  });

  it('reactivating a question whose branch is active but whose opener is archived names the opener', () => {
    const { questions, branches, layout } = clinic();
    const qs = questions.map((x) =>
      x.id === 'q3' || x.id === 'q1' ? { ...x, archived: true } : x,
    );
    expect(checkReactivation({ questions: qs, branches, layout, questionId: 'q3' })).toEqual({
      ok: false,
      issue: 'condition_invalid',
      openerId: 'q1',
    });
  });

  it('passes a question in an active branch with an active opener, and a plain archived question', () => {
    const { questions, branches, layout } = clinic();
    const qs = questions.map((x) =>
      x.id === 'q3' || x.id === 'q7' ? { ...x, archived: true } : x,
    );
    expect(checkReactivation({ questions: qs, branches, layout, questionId: 'q3' }).ok).toBe(true);
    expect(checkReactivation({ questions: qs, branches, layout, questionId: 'q7' }).ok).toBe(true);
  });

  it('refuses an unknown question and a dangling branch', () => {
    const { questions, branches, layout } = clinic();
    expect(refusal(checkReactivation({ questions, branches, layout, questionId: 'ghost' }))).toBe(
      'unknown_question',
    );
    const dangling = questions.map((x) =>
      x.id === 'q7' ? { ...x, archived: true, branchId: 'nope' } : x,
    );
    expect(
      refusal(checkReactivation({ questions: dangling, branches, layout, questionId: 'q7' })),
    ).toBe('unknown_branch');
  });

  it('refuses reactivating a public question into a chain with a private opener', () => {
    const { questions, branches, layout } = clinic();
    const qs = questions.map((x) => {
      if (x.id === 'q3') return { ...x, archived: true };
      if (x.id === 'q1') return { ...x, showOnProfile: false };
      return x;
    });
    expect(checkReactivation({ questions: qs, branches, layout, questionId: 'q3' })).toEqual({
      ok: false,
      issue: 'public_under_private',
      titles: ['Titulo q3'],
    });
  });
});

describe('12.2-04 publicUnderPrivate at depth 1, 2 and 3 (PFORM-53, WR-06)', () => {
  const withPrivate = (id: string) => {
    const { questions, branches } = clinic();
    return publicUnderPrivate(
      questions.map((x) => (x.id === id ? { ...x, showOnProfile: false } : x)),
      branches,
    );
  };

  it('lists the public questions under a private opener, whatever the depth of that opener', () => {
    expect(withPrivate('q1')).toEqual([
      'Titulo q2',
      'Titulo q3',
      'Titulo q4',
      'Titulo q5',
      'Titulo q6',
    ]);
    expect(withPrivate('q2')).toEqual(['Titulo q4', 'Titulo q5', 'Titulo q6']);
    expect(withPrivate('q5')).toEqual(['Titulo q6']);
  });

  it('does not list a private question, an archived one, or a question under public openers', () => {
    const { questions, branches } = clinic();
    expect(publicUnderPrivate(questions, branches)).toEqual([]);
    const typed = questions.map((x) => {
      if (x.id === 'q1') return { ...x, showOnProfile: false };
      if (x.id === 'q3') return { ...x, showOnProfile: false };
      if (x.id === 'q4') return { ...x, archived: true };
      return x;
    });
    expect(publicUnderPrivate(typed, branches)).toEqual(['Titulo q2', 'Titulo q5', 'Titulo q6']);
  });
});
