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
