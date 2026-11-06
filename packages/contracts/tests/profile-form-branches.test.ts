import { describe, expect, it } from 'vitest';
import { answerTokens, PROFILE_FORM_LIMITS } from '../src/profile-form';
import {
  type BranchTree,
  branchChainOf,
  branchTreeOf,
  type ChainFixture,
  isQuestionVisibleInTree,
  PROFILE_FORM_CHAIN_CASES,
  PROFILE_FORM_CHAIN_FIXTURE,
  PROFILE_FORM_CHAIN_FIXTURE_ANY_OF,
  type TreeOrderInput,
  treeOrder,
  visibleStepsInTree,
} from '../src/profile-form-branches';

/**
 * 12.2-01 (D-641, D-644, D-645, PFORM-44, PFORM-54): the chain visibility rule. A question in a branch is
 * visible only when EVERY branch on its chain is open; the chain is at most `branchDepth` long and the
 * rule fails closed on a malformed tree. `PROFILE_FORM_CHAIN_CASES` is the table the SQL gate and the purge
 * replay in plan 07.
 */

const PREFIX = '24000000-0000-4000-8000-';
const id = (suffix: string) => `${PREFIX}${suffix.padStart(12, '0')}`;

const tokensFor = (fixture: ChainFixture, stored: Record<string, unknown>) => {
  const keyById = new Map(fixture.questions.map((question) => [question.id, question.key]));
  return (questionId: string): readonly string[] | undefined => {
    const key = keyById.get(questionId);
    return key === undefined ? undefined : answerTokens(stored[key]);
  };
};

const evaluate = (fixture: ChainFixture, stored: Record<string, unknown>) => {
  const tree = branchTreeOf(
    fixture.questions,
    fixture.branches.map((branch) => ({
      id: branch.id,
      openerQuestionId: fixture.questions.find((question) => question.key === branch.openerKey)
        ?.id as string,
      values: branch.values,
    })),
  );
  const tokensOf = tokensFor(fixture, stored);
  const visible = fixture.questions.filter((question) =>
    isQuestionVisibleInTree(question, tree, tokensOf),
  );
  const visibleKeys = visible.map((question) => question.key);
  const owed = visible
    .filter((question) => question.required && !(question.key in stored))
    .map((question) => question.key);
  const purged = fixture.questions
    .filter((question) => question.key in stored && !visibleKeys.includes(question.key))
    .map((question) => question.key);
  return { visibleKeys, owed, purged };
};

describe('12.2-01 - the chain parity table (D-645, PFORM-54)', () => {
  it('has exactly eleven rows with unique names, and the first nine run on the clinic fixture', () => {
    expect(PROFILE_FORM_CHAIN_CASES).toHaveLength(11);
    expect(new Set(PROFILE_FORM_CHAIN_CASES.map((row) => row.name)).size).toBe(11);
    expect(PROFILE_FORM_CHAIN_CASES.slice(0, 9).every((row) => row.fixture === undefined)).toBe(
      true,
    );
    expect(PROFILE_FORM_CHAIN_CASES.slice(0, 9).every((row) => row.tsOnly !== true)).toBe(true);
    // rows 10 and 11 need a tree the clinic fixture cannot hold: they are TypeScript only
    expect(PROFILE_FORM_CHAIN_CASES.slice(9).every((row) => row.tsOnly === true)).toBe(true);
  });

  it('the clinic fixture is Q1..Q7 and B1..B4 under the reserved id prefix', () => {
    expect(PROFILE_FORM_CHAIN_FIXTURE.questions.map((question) => question.key)).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Q7',
    ]);
    expect(PROFILE_FORM_CHAIN_FIXTURE.branches.map((branch) => branch.key)).toEqual([
      'B1',
      'B2',
      'B3',
      'B4',
    ]);
    for (const question of PROFILE_FORM_CHAIN_FIXTURE.questions) {
      expect(question.id.startsWith(PREFIX)).toBe(true);
    }
    for (const branch of PROFILE_FORM_CHAIN_FIXTURE.branches) {
      expect(branch.id.startsWith(PREFIX)).toBe(true);
      expect(branch.values.length).toBeGreaterThan(0);
    }
  });

  for (const row of PROFILE_FORM_CHAIN_CASES) {
    it(`chain row: ${row.name}`, () => {
      const fixture = row.fixture ?? PROFILE_FORM_CHAIN_FIXTURE;
      const result = evaluate(fixture, row.stored);
      expect(result.visibleKeys).toEqual(row.visible);
      expect(result.owed).toEqual(row.owed);
      expect(result.purged).toEqual(row.purged);
    });
  }
});

describe('12.2-01 - any-of at depth 2 (D-641, PFORM-44)', () => {
  const tem = { optionId: '24000000-0000-4000-8000-0000000000e1', otherText: null };
  const ticked = (...suffixes: string[]) => ({
    optionIds: suffixes.map((suffix) => `${PREFIX}${suffix.padStart(12, '0')}`),
    otherText: null,
  });

  it('opens when ONE ticked option overlaps the branch values, stays closed when none does', () => {
    const fixture = PROFILE_FORM_CHAIN_FIXTURE_ANY_OF;
    expect(evaluate(fixture, { Q1: tem, Q2: ticked('f1', 'f2') }).visibleKeys).toEqual([
      'Q1',
      'Q2',
      'Q3',
    ]);
    expect(evaluate(fixture, { Q1: tem, Q2: ticked('f1') }).visibleKeys).toEqual(['Q1', 'Q2']);
    expect(evaluate(fixture, { Q1: tem, Q2: ticked('f1') }).owed).toEqual([]);
    expect(evaluate(fixture, { Q1: tem, Q2: ticked() }).visibleKeys).toEqual(['Q1', 'Q2']);
  });
});

describe('12.2-01 - the rule on hand-built trees (D-641, D-644)', () => {
  const opener = id('a1');
  const second = id('a2');
  const treeOf = (
    questions: { id: string; branchId: string | null }[],
    branches: { id: string; openerQuestionId: string; values: string[] }[],
  ): BranchTree => branchTreeOf(questions, branches);

  it('a question with no branch is visible whatever the answers', () => {
    const tree = treeOf([{ id: opener, branchId: null }], []);
    expect(isQuestionVisibleInTree({ branchId: null }, tree, () => undefined)).toBe(true);
    expect(isQuestionVisibleInTree({}, tree, () => [])).toBe(true);
    expect(isQuestionVisibleInTree({ branchId: undefined }, tree, () => undefined)).toBe(true);
  });

  it('an unknown branch hides the question', () => {
    const tree = treeOf([{ id: opener, branchId: null }], []);
    expect(isQuestionVisibleInTree({ branchId: id('ff') }, tree, () => ['x'])).toBe(false);
  });

  it('an unknown opener or a missing token set hides the question', () => {
    const branch = { id: id('b1'), openerQuestionId: id('c0'), values: ['x'] };
    const tree = treeOf([{ id: opener, branchId: null }], [branch]);
    expect(isQuestionVisibleInTree({ branchId: branch.id }, tree, () => ['x'])).toBe(false);
    const known = { id: id('b2'), openerQuestionId: opener, values: ['x'] };
    const treeKnown = treeOf([{ id: opener, branchId: null }], [known]);
    expect(isQuestionVisibleInTree({ branchId: known.id }, treeKnown, () => undefined)).toBe(false);
    expect(isQuestionVisibleInTree({ branchId: known.id }, treeKnown, () => [])).toBe(false);
    expect(isQuestionVisibleInTree({ branchId: known.id }, treeKnown, () => ['x'])).toBe(true);
  });

  it('tokens compare as exact case-sensitive strings, never trimmed or lowercased (PFORM-44)', () => {
    const branch = { id: id('b1'), openerQuestionId: opener, values: ['true'] };
    const tree = treeOf([{ id: opener, branchId: null }], [branch]);
    for (const token of ['True', 'TRUE', ' true', 'true ']) {
      expect(isQuestionVisibleInTree({ branchId: branch.id }, tree, () => [token])).toBe(false);
    }
    expect(isQuestionVisibleInTree({ branchId: branch.id }, tree, () => ['true'])).toBe(true);
  });

  it('a cycle (a branch whose opener sits inside its own branch) hides the question', () => {
    const branch = { id: id('b1'), openerQuestionId: opener, values: ['x'] };
    const tree = treeOf(
      [
        { id: opener, branchId: branch.id },
        { id: second, branchId: branch.id },
      ],
      [branch],
    );
    expect(isQuestionVisibleInTree({ branchId: branch.id }, tree, () => ['x'])).toBe(false);
    expect(branchChainOf(branch.id, tree)).toBeNull();
    // two branches that open each other
    const b1 = { id: id('b1'), openerQuestionId: opener, values: ['x'] };
    const b2 = { id: id('b2'), openerQuestionId: second, values: ['x'] };
    const loop = treeOf(
      [
        { id: opener, branchId: b2.id },
        { id: second, branchId: b1.id },
      ],
      [b1, b2],
    );
    expect(isQuestionVisibleInTree({ branchId: b1.id }, loop, () => ['x'])).toBe(false);
    expect(branchChainOf(b1.id, loop)).toBeNull();
  });

  it('a chain of exactly branchDepth branches is allowed, one more is hidden', () => {
    expect(PROFILE_FORM_LIMITS.branchDepth).toBe(3);
    const chain = (length: number) => {
      const questions: { id: string; branchId: string | null }[] = [
        { id: id('d0'), branchId: null },
      ];
      const branches: { id: string; openerQuestionId: string; values: string[] }[] = [];
      for (let level = 1; level <= length; level += 1) {
        const branchId = id(`b${level}`);
        branches.push({ id: branchId, openerQuestionId: id(`d${level - 1}`), values: ['x'] });
        questions.push({ id: id(`d${level}`), branchId });
      }
      return { tree: treeOf(questions, branches), leaf: id(`b${length}`) };
    };
    for (const length of [1, 2, 3]) {
      const { tree, leaf } = chain(length);
      expect(isQuestionVisibleInTree({ branchId: leaf }, tree, () => ['x'])).toBe(true);
      expect(branchChainOf(leaf, tree)).toHaveLength(length);
    }
    const four = chain(4);
    expect(isQuestionVisibleInTree({ branchId: four.leaf }, four.tree, () => ['x'])).toBe(false);
    expect(branchChainOf(four.leaf, four.tree)).toBeNull();
  });

  it('branchChainOf lists the branches nearest first and answers null for an unknown branch', () => {
    const b1 = { id: id('b1'), openerQuestionId: id('d0'), values: ['x'] };
    const b2 = { id: id('b2'), openerQuestionId: id('d1'), values: ['x'] };
    const tree = treeOf(
      [
        { id: id('d0'), branchId: null },
        { id: id('d1'), branchId: b1.id },
        { id: id('d2'), branchId: b2.id },
      ],
      [b1, b2],
    );
    expect(branchChainOf(b2.id, tree)?.map((branch) => branch.id)).toEqual([b2.id, b1.id]);
    expect(branchChainOf(b1.id, tree)?.map((branch) => branch.id)).toEqual([b1.id]);
    expect(branchChainOf(id('ee'), tree)).toBeNull();
  });

  it('branchTreeOf answers undefined for an unknown question and null for an unbranched one', () => {
    const tree = treeOf([{ id: opener, branchId: null }], []);
    expect(tree.branchIdOf(opener)).toBeNull();
    expect(tree.branchIdOf(id('ee'))).toBeUndefined();
    expect(tree.branch(id('ee'))).toBeUndefined();
  });

  it('visibleStepsInTree keeps the step order and drops a step with no visible question', () => {
    const [s1, s2, s3] = [id('51'), id('52'), id('53')];
    const branch = { id: id('b1'), openerQuestionId: opener, values: ['true'] };
    const questions = [
      { id: opener, stepId: s1, branchId: null },
      { id: second, stepId: s2, branchId: branch.id },
    ];
    const tree = branchTreeOf(questions, [branch]);
    const steps = [{ id: s1 }, { id: s2 }, { id: s3 }];
    expect(visibleStepsInTree(steps, questions, tree, () => ['false'])).toEqual([s1]);
    expect(visibleStepsInTree(steps, questions, tree, () => ['true'])).toEqual([s1, s2]);
    expect(visibleStepsInTree([...steps].reverse(), questions, tree, () => ['true'])).toEqual([
      s2,
      s1,
    ]);
    expect(visibleStepsInTree(steps, [], tree, () => ['true'])).toEqual([]);
  });
});

describe('12.2-01 - the tree order (D-652)', () => {
  /** A request: step id -> its question ids; `of` maps a question to its branch; `branches` lists them in caller order. */
  const run = (
    steps: Record<string, string[]>,
    of: Record<string, string | null>,
    branches: { id: string; openerQuestionId: string }[],
  ): TreeOrderInput => ({
    layout: Object.entries(steps).map(([stepId, questionIds]) => ({ stepId, questionIds })),
    branchIdOf: new Map(Object.entries(of)),
    branches,
  });
  const idsOf = (input: TreeOrderInput) =>
    Object.fromEntries(treeOrder(input).map((step) => [step.stepId, [...step.questionIds]]));

  it('puts a branch right after its opener and keeps the run whole', () => {
    const input = run({ s1: ['A', 'Q2', 'C', 'Q3'] }, { A: null, Q2: 'B1', C: null, Q3: 'B1' }, [
      { id: 'B1', openerQuestionId: 'A' },
    ]);
    expect(idsOf(input)).toEqual({ s1: ['A', 'Q2', 'Q3', 'C'] });
  });

  it('orders the branches of one opener by the smallest requested index of their members', () => {
    const branches = [
      { id: 'B1', openerQuestionId: 'A' },
      { id: 'B2', openerQuestionId: 'A' },
    ];
    const of = { A: null, x: 'B2', y: 'B1', z: 'B1', x2: 'B2' };
    expect(idsOf(run({ s1: ['A', 'x', 'y', 'z', 'x2'] }, of, branches))).toEqual({
      s1: ['A', 'x', 'x2', 'y', 'z'],
    });
    expect(idsOf(run({ s1: ['A', 'y', 'x', 'z', 'x2'] }, of, branches))).toEqual({
      s1: ['A', 'y', 'z', 'x', 'x2'],
    });
  });

  it('sits a nested branch inside its parent block, right after its own opener', () => {
    const input = run({ s1: ['A', 'a1', 'a2', 'b1'] }, { A: null, a1: 'B1', a2: 'B1', b1: 'B2' }, [
      { id: 'B1', openerQuestionId: 'A' },
      { id: 'B2', openerQuestionId: 'a1' },
    ]);
    expect(idsOf(input)).toEqual({ s1: ['A', 'a1', 'b1', 'a2'] });
  });

  it('places a run whose opener is in another step like an unconditional unit, in its own step', () => {
    const input = run(
      { s1: ['A', 'p'], s2: ['u', 'f1', 'v', 'f2'] },
      { A: null, p: null, u: null, f1: 'B1', v: null, f2: 'B1' },
      [{ id: 'B1', openerQuestionId: 'A' }],
    );
    expect(idsOf(input)).toEqual({ s1: ['A', 'p'], s2: ['u', 'f1', 'f2', 'v'] });
  });

  it('keeps a plain unconditional question where it was asked and treats unknown branches as roots', () => {
    const input = run({ s1: ['p', 'q', 'r'] }, { p: null, q: 'GHOST', r: null }, [
      { id: 'B1', openerQuestionId: 'p' },
    ]);
    expect(idsOf(input)).toEqual({ s1: ['p', 'q', 'r'] });
  });

  it('is idempotent and preserves the id multiset of every case', () => {
    const cases = [
      run({ s1: ['A', 'Q2', 'C', 'Q3'] }, { A: null, Q2: 'B1', C: null, Q3: 'B1' }, [
        { id: 'B1', openerQuestionId: 'A' },
      ]),
      run({ s1: ['A', 'x', 'y', 'z', 'x2'] }, { A: null, x: 'B2', y: 'B1', z: 'B1', x2: 'B2' }, [
        { id: 'B1', openerQuestionId: 'A' },
        { id: 'B2', openerQuestionId: 'A' },
      ]),
      run({ s1: ['A', 'a1', 'a2', 'b1'] }, { A: null, a1: 'B1', a2: 'B1', b1: 'B2' }, [
        { id: 'B1', openerQuestionId: 'A' },
        { id: 'B2', openerQuestionId: 'a1' },
      ]),
      run(
        { s1: ['A', 'p'], s2: ['u', 'f1', 'v', 'f2'] },
        { A: null, p: null, u: null, f1: 'B1', v: null, f2: 'B1' },
        [{ id: 'B1', openerQuestionId: 'A' }],
      ),
    ];
    for (const input of cases) {
      const once = treeOrder(input);
      const twice = treeOrder({ ...input, layout: once });
      expect(twice).toEqual(once);
      expect(once.flatMap((step) => [...step.questionIds]).sort()).toEqual(
        input.layout.flatMap((step) => [...step.questionIds]).sort(),
      );
      expect(once.map((step) => step.stepId)).toEqual(input.layout.map((step) => step.stepId));
    }
  });

  it('treats a cycle as roots: it does not loop and returns every id exactly once', () => {
    const input = run({ s1: ['A', 'B', 'C', 'D'] }, { A: 'X', B: 'Y', C: null, D: 'X' }, [
      { id: 'X', openerQuestionId: 'B' },
      { id: 'Y', openerQuestionId: 'A' },
    ]);
    const out = treeOrder(input);
    expect([...(out[0]?.questionIds ?? [])].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(treeOrder({ ...input, layout: out })).toEqual(out);
    const selfOpened = run({ s1: ['A', 'B'] }, { A: 'X', B: null }, [
      { id: 'X', openerQuestionId: 'A' },
    ]);
    expect(idsOf(selfOpened)).toEqual({ s1: ['A', 'B'] });
  });

  it('never moves a question to another step and keeps empty steps', () => {
    const input = run({ s1: ['A'], s2: [], s3: ['f1', 'x'] }, { A: null, f1: 'B1', x: null }, [
      { id: 'B1', openerQuestionId: 'A' },
    ]);
    expect(idsOf(input)).toEqual({ s1: ['A'], s2: [], s3: ['f1', 'x'] });
  });

  it('property: any random forest keeps its multiset, stays in its step and is a fixpoint', () => {
    let seed = 12345;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let round = 0; round < 200; round += 1) {
      const count = 1 + next(12);
      const questions = Array.from({ length: count }, (_, index) => `q${index}`);
      const branchCount = next(5);
      const branches = Array.from({ length: branchCount }, (_, index) => ({
        id: `b${index}`,
        openerQuestionId: questions[next(count)] as string,
      }));
      const of: Record<string, string | null> = {};
      for (const question of questions) {
        of[question] = next(3) === 0 || branchCount === 0 ? null : `b${next(branchCount)}`;
      }
      const shuffled = [...questions].sort(() => next(3) - 1);
      const cut = next(count + 1);
      const input = run({ s1: shuffled.slice(0, cut), s2: shuffled.slice(cut) }, of, branches);
      const once = treeOrder(input);
      expect(treeOrder({ ...input, layout: once })).toEqual(once);
      expect(once.map((step) => [...step.questionIds].sort())).toEqual(
        input.layout.map((step) => [...step.questionIds].sort()),
      );
    }
  });
});
