import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import {
  type AdminBranchTree,
  type BranchRun,
  branchChain,
  branchHeight,
  branchLevel,
  buildBranchTree,
  countsOf,
  eligibleBranchesFor,
  eligibleOpenersFor,
  flowTree,
  opensCountOf,
  publicUnderPrivateTitles,
  referencedOptionCounts,
  type StepNode,
  stepTree,
} from './branch-tree';
import { describeBranch } from './describe-branch';
import {
  ADMIN_STEP_ID,
  adminBranch,
  adminQuestion,
  adminStep,
  CLINIC_OPTION_IDS,
  clinicAdminList,
  clinicId,
  uuid,
} from './test-fixtures';

/**
 * 12.2-13 task 1 (D-641, D-642, D-643, D-644, D-649): the admin read of a form becomes the per-step tree the
 * Lista draws, with the counts, the chain, the level and the height. All of it from the one read.
 */

const clinic = () => {
  const list = clinicAdminList();
  return buildBranchTree({ steps: list.steps, questions: list.questions, branches: list.branches });
};

const ids = (runs: readonly BranchRun[]) => runs.map((run) => run.branch.id);
const need = (node: StepNode | null): StepNode => {
  if (node === null) throw new Error('step not found');
  return node;
};

describe('the clinic form as a tree (D-641, D-644)', () => {
  it('has Q1 as the only root of the step, with B1 and B4 under it', () => {
    const node = need(stepTree(clinic(), ADMIN_STEP_ID));
    expect(node.roots).toHaveLength(1);
    const root = node.roots[0];
    if (root?.kind !== 'question') throw new Error('expected a question root');
    expect(root.node.question.id).toBe(clinicId('Q1'));
    expect(ids(root.node.branches)).toEqual([clinicId('B1'), clinicId('B4')]);
  });

  it('nests B2 under Q2 and B3 under Q5, to three levels', () => {
    const root = need(stepTree(clinic(), ADMIN_STEP_ID)).roots[0];
    if (root?.kind !== 'question') throw new Error('expected a question root');
    const b1 = root.node.branches[0];
    expect(b1?.questions.map((n) => n.question.id)).toEqual([clinicId('Q2'), clinicId('Q3')]);
    const q2 = b1?.questions[0];
    expect(ids(q2?.branches ?? [])).toEqual([clinicId('B2')]);
    const b2 = q2?.branches[0];
    expect(b2?.questions.map((n) => n.question.id)).toEqual([clinicId('Q4'), clinicId('Q5')]);
    const q5 = b2?.questions[1];
    expect(ids(q5?.branches ?? [])).toEqual([clinicId('B3')]);
    expect(q5?.branches[0]?.questions.map((n) => n.question.id)).toEqual([clinicId('Q6')]);
    expect([b1?.depth, b2?.depth, q5?.branches[0]?.depth]).toEqual([1, 2, 3]);
    expect([b1?.level, b2?.level, q5?.branches[0]?.level]).toEqual([1, 2, 3]);
  });

  it('numbers the questions globally in the order members see them', () => {
    const root = need(stepTree(clinic(), ADMIN_STEP_ID)).roots[0];
    if (root?.kind !== 'question') throw new Error('expected a question root');
    expect(root.node.number).toBe(1);
    expect(root.node.branches[1]?.questions[0]?.number).toBe(7);
  });

  it('counts the ACTIVE questions of a branch, direct and in the whole subtree', () => {
    const tree = clinic();
    expect(countsOf(tree, clinicId('B1'))).toEqual({ direct: 2, subtree: 5 });
    expect(countsOf(tree, clinicId('B2'))).toEqual({ direct: 2, subtree: 3 });
    expect(countsOf(tree, clinicId('B3'))).toEqual({ direct: 1, subtree: 1 });
    expect(countsOf(tree, clinicId('B4'))).toEqual({ direct: 1, subtree: 1 });
    expect(countsOf(tree, uuid(1))).toEqual({ direct: 0, subtree: 0 });
  });

  it('gives each opener the number of active questions in the branches hanging directly on it', () => {
    const tree = clinic();
    expect(opensCountOf(tree, clinicId('Q1'))).toBe(3);
    expect(opensCountOf(tree, clinicId('Q2'))).toBe(2);
    expect(opensCountOf(tree, clinicId('Q5'))).toBe(1);
    expect(opensCountOf(tree, clinicId('Q3'))).toBe(0);
  });

  it('gives the level, the chain and the height of a branch', () => {
    const tree = clinic();
    expect(
      [clinicId('B1'), clinicId('B2'), clinicId('B3'), clinicId('B4')].map((id) =>
        branchLevel(tree, id),
      ),
    ).toEqual([1, 2, 3, 1]);
    expect(
      [clinicId('B1'), clinicId('B2'), clinicId('B3'), clinicId('B4')].map((id) =>
        branchHeight(tree, id),
      ),
    ).toEqual([3, 2, 1, 1]);
    expect(branchChain(tree, clinicId('B3'))?.map((b) => b.id)).toEqual([
      clinicId('B3'),
      clinicId('B2'),
      clinicId('B1'),
    ]);
    expect(branchLevel(tree, uuid(1))).toBeNull();
    expect(branchHeight(tree, uuid(1))).toBeNull();
    expect(branchChain(tree, uuid(1))).toBeNull();
  });

  it('counts how many branches name each answer of an opener', () => {
    const tree = clinic();
    const q1 = referencedOptionCounts(tree, clinicId('Q1'));
    expect(q1.get(CLINIC_OPTION_IDS.tem)).toBe(1);
    expect(q1.get(CLINIC_OPTION_IDS.aprende)).toBe(1);
    expect(q1.get(CLINIC_OPTION_IDS.trabalha)).toBeUndefined();
    expect(referencedOptionCounts(tree, clinicId('Q2')).get('true')).toBe(1);
    expect(referencedOptionCounts(tree, clinicId('Q3')).size).toBe(0);
  });
});

describe('runs, order and the empty branch (D-642, D-643)', () => {
  const s1 = adminStep({ id: uuid(901), title: 'Etapa 1', position: 1 });
  const s2 = adminStep({ id: uuid(902), title: 'Etapa 2', position: 2 });
  const q = (id: number, stepId: string, overrides: Partial<AdminQuestion> = {}) =>
    adminQuestion('short_text', { id: uuid(id), stepId, title: `Q${id}`, ...overrides });
  const opener = (id: number, stepId: string, overrides: Partial<AdminQuestion> = {}) =>
    adminQuestion('yes_no', { id: uuid(id), stepId, title: `Q${id}`, ...overrides });

  it('draws a branch whose questions sit in two steps as one run per step (D-643)', () => {
    const b = adminBranch({ id: uuid(950), openerQuestionId: uuid(10), values: ['true'] });
    const tree = buildBranchTree({
      steps: [s1, s2],
      questions: [
        opener(10, s1.id),
        q(11, s1.id, { branchId: b.id }),
        q(12, s2.id, { branchId: b.id }),
      ],
      branches: [b],
    });
    const first = need(stepTree(tree, s1.id)).roots[0];
    if (first?.kind !== 'question') throw new Error('expected a question root');
    const run1 = first.node.branches[0];
    expect(run1?.questions.map((n) => n.question.id)).toEqual([uuid(11)]);
    expect(run1?.openerInOtherStep).toBe(false);

    const second = need(stepTree(tree, s2.id)).roots;
    expect(second).toHaveLength(1);
    const run2 = second[0];
    if (run2?.kind !== 'run') throw new Error('expected a run at the root of step 2');
    expect(run2.run.branch.id).toBe(b.id);
    expect(run2.run.questions.map((n) => n.question.id)).toEqual([uuid(12)]);
    expect(run2.run.openerInOtherStep).toBe(true);
    expect(run2.run.depth).toBe(1);
    expect(run2.run.level).toBe(1);
  });

  it('puts a run whose opener is elsewhere among the root questions by its first question', () => {
    const b = adminBranch({ id: uuid(950), openerQuestionId: uuid(10), values: ['true'] });
    const tree = buildBranchTree({
      steps: [s1, s2],
      questions: [opener(10, s1.id), q(20, s2.id), q(12, s2.id, { branchId: b.id }), q(21, s2.id)],
      branches: [b],
    });
    const roots = need(stepTree(tree, s2.id)).roots;
    expect(
      roots.map((root) => (root.kind === 'question' ? root.node.question.id : root.run.branch.id)),
    ).toEqual([uuid(20), b.id, uuid(21)]);
  });

  it('orders the branches of an opener by their first question in the step, the empty ones last in list order', () => {
    const x = adminBranch({ id: uuid(951), openerQuestionId: uuid(10), values: ['true'] });
    const y = adminBranch({ id: uuid(952), openerQuestionId: uuid(10), values: ['false'] });
    const empty1 = adminBranch({ id: uuid(953), openerQuestionId: uuid(10), values: ['true'] });
    const empty2 = adminBranch({ id: uuid(954), openerQuestionId: uuid(10), values: ['false'] });
    const tree = buildBranchTree({
      steps: [s1],
      questions: [
        opener(10, s1.id),
        q(11, s1.id, { branchId: y.id }),
        q(12, s1.id, { branchId: x.id }),
      ],
      branches: [empty1, x, empty2, y],
    });
    const root = need(stepTree(tree, s1.id)).roots[0];
    if (root?.kind !== 'question') throw new Error('expected a question root');
    expect(ids(root.node.branches)).toEqual([y.id, x.id, empty1.id, empty2.id]);
  });

  it('keeps an empty branch under its opener with zero questions', () => {
    const e = adminBranch({ id: uuid(955), openerQuestionId: uuid(10), values: ['true'] });
    const tree = buildBranchTree({
      steps: [s1, s2],
      questions: [opener(10, s1.id)],
      branches: [e],
    });
    const root = need(stepTree(tree, s1.id)).roots[0];
    if (root?.kind !== 'question') throw new Error('expected a question root');
    const run = root.node.branches[0];
    expect(run?.empty).toBe(true);
    expect(run?.questions).toEqual([]);
    expect(run?.counts).toEqual({ direct: 0, subtree: 0 });
    expect(need(stepTree(tree, s2.id)).roots).toEqual([]);
    expect(opensCountOf(tree, uuid(10))).toBe(0);
  });

  it('ignores an archived branch: its question is a root and it opens nothing', () => {
    const old = adminBranch({
      id: uuid(956),
      openerQuestionId: uuid(10),
      values: ['true'],
      archivedAt: '2026-10-01T00:00:00.000Z',
    });
    const tree = buildBranchTree({
      steps: [s1],
      questions: [opener(10, s1.id), q(11, s1.id, { branchId: old.id })],
      branches: [old],
    });
    const roots = need(stepTree(tree, s1.id)).roots;
    expect(roots.map((r) => (r.kind === 'question' ? r.node.question.id : 'run'))).toEqual([
      uuid(10),
      uuid(11),
    ]);
    expect(opensCountOf(tree, uuid(10))).toBe(0);
  });

  it('places every question exactly once even when the stored tree has a cycle', () => {
    const a = adminBranch({ id: uuid(957), openerQuestionId: uuid(11), values: ['true'] });
    const b = adminBranch({ id: uuid(958), openerQuestionId: uuid(10), values: ['true'] });
    const tree = buildBranchTree({
      steps: [s1],
      questions: [
        opener(10, s1.id, { branchId: a.id }),
        opener(11, s1.id, { branchId: b.id }),
        q(12, s1.id),
      ],
      branches: [a, b],
    });
    const placed: string[] = [];
    const walk = (nodes: readonly { question: AdminQuestion; branches: BranchRun[] }[]) => {
      for (const node of nodes) {
        placed.push(node.question.id);
        for (const run of node.branches) walk(run.questions);
      }
    };
    for (const root of need(stepTree(tree, s1.id)).roots) {
      if (root.kind === 'question') walk([root.node]);
      else walk(root.run.questions);
    }
    expect([...placed].sort()).toEqual([uuid(10), uuid(11), uuid(12)]);
    expect(branchChain(tree, a.id)).toBeNull();
    expect(branchLevel(tree, a.id)).toBeNull();
  });

  it('a form with no branches key is a flat list of roots', () => {
    const tree = buildBranchTree({ steps: [s1], questions: [q(11, s1.id), q(12, s1.id)] });
    const roots = need(stepTree(tree, s1.id)).roots;
    expect(roots.map((r) => (r.kind === 'question' ? r.node.question.id : 'run'))).toEqual([
      uuid(11),
      uuid(12),
    ]);
    expect(stepTree(tree, uuid(999))).toBeNull();
  });

  it('does not change the read it is given', () => {
    const list = clinicAdminList();
    const before = JSON.stringify(list);
    const tree: AdminBranchTree = buildBranchTree({
      steps: list.steps,
      questions: list.questions,
      branches: list.branches,
    });
    stepTree(tree, ADMIN_STEP_ID);
    countsOf(tree, clinicId('B1'));
    expect(JSON.stringify(list)).toBe(before);
  });
});

// ── Task 2: eligibility, privacy pre-checks and the Fluxo (D-644, D-646, D-649) ───────────────────

/** The clinic tree with some questions changed, by key (`Q1`..`Q7`); a branch changed, by key (`B1`..`B4`). */
const clinicWith = (
  questions: Record<string, Partial<AdminQuestion>> = {},
  branches: Record<string, Partial<ReturnType<typeof adminBranch>>> = {},
) => {
  const list = clinicAdminList();
  const keyOfQuestion = (id: string) =>
    ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'].find((k) => clinicId(k) === id);
  const keyOfBranch = (id: string) => ['B1', 'B2', 'B3', 'B4'].find((k) => clinicId(k) === id);
  return buildBranchTree({
    steps: list.steps,
    questions: list.questions.map((q) => ({ ...q, ...questions[keyOfQuestion(q.id) ?? ''] })),
    branches: (list.branches ?? []).map((b) => ({ ...b, ...branches[keyOfBranch(b.id) ?? ''] })),
  });
};
const branchIds = (result: { branches: { id: string }[] }) => result.branches.map((b) => b.id);
const keys = (found: readonly { id: string }[]) =>
  found.map((item) =>
    ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'B1', 'B2', 'B3', 'B4'].find(
      (k) => clinicId(k) === item.id,
    ),
  );
const subject = (key: string, showOnProfile = false) => ({ id: clinicId(key), showOnProfile });

describe('eligibleBranchesFor: the branches a question may enter (D-641, D-644, D-646, UI-D-669)', () => {
  it('lists the branches whose opener comes strictly before a new question, in opener order', () => {
    const result = eligibleBranchesFor({ id: null, showOnProfile: false }, clinicWith());
    expect(keys(result.branches)).toEqual(['B1', 'B4', 'B2', 'B3']);
    expect(result.leftOutForPrivacy).toBe(false);
  });

  it('on a form where only Q1 precedes, a new question may enter B1 and B4 only', () => {
    const s = adminStep({ id: uuid(901), position: 1 });
    const q1 = adminQuestion('single_choice', { id: uuid(10), stepId: s.id });
    const b1 = adminBranch({ id: uuid(950), openerQuestionId: q1.id, values: ['a'] });
    const b4 = adminBranch({ id: uuid(951), openerQuestionId: q1.id, values: ['b'] });
    const q2 = adminQuestion('short_text', { id: uuid(11), stepId: s.id, branchId: b1.id });
    const tree = buildBranchTree({ steps: [s], questions: [q1, q2], branches: [b1, b4] });
    expect(branchIds(eligibleBranchesFor({ id: null, showOnProfile: false }, tree))).toEqual([
      b1.id,
      b4.id,
    ]);
  });

  it('an existing question needs its opener to come before it and not be itself or below itself', () => {
    const tree = clinicWith();
    expect(keys(eligibleBranchesFor(subject('Q1'), tree).branches)).toEqual([]);
    // Q2 opens B2 (height 2): B2 and B3 hang below it, B3 opens after it.
    expect(keys(eligibleBranchesFor(subject('Q2'), tree).branches)).toEqual(['B1', 'B4']);
    // Q5 opens B3: B3 is its own, and B2 (opener Q2, level 2) plus B3 (height 1) still fits.
    expect(keys(eligibleBranchesFor(subject('Q5'), tree).branches)).toEqual(['B1', 'B4', 'B2']);
    // Q4 sits in B2 and opens nothing: B3 opens on Q5, after it.
    expect(keys(eligibleBranchesFor(subject('Q4'), tree).branches)).toEqual(['B1', 'B4', 'B2']);
  });

  it('keeps the level plus the height of the question own sub-branches within three levels', () => {
    const s = adminStep({ id: uuid(901), position: 1 });
    const a = adminQuestion('yes_no', { id: uuid(10), stepId: s.id });
    const ba = adminBranch({ id: uuid(950), openerQuestionId: a.id, values: ['true'] });
    const b = adminQuestion('yes_no', { id: uuid(11), stepId: s.id, branchId: ba.id });
    const bb = adminBranch({ id: uuid(951), openerQuestionId: b.id, values: ['true'] });
    const c = adminQuestion('yes_no', { id: uuid(12), stepId: s.id, branchId: bb.id });
    const bc = adminBranch({ id: uuid(952), openerQuestionId: c.id, values: ['true'] });
    const d = adminQuestion('short_text', { id: uuid(13), stepId: s.id, branchId: bc.id });
    const x = adminQuestion('yes_no', { id: uuid(14), stepId: s.id });
    const bx = adminBranch({ id: uuid(953), openerQuestionId: x.id, values: ['true'] });
    const y = adminQuestion('short_text', { id: uuid(15), stepId: s.id, branchId: bx.id });
    const tree = buildBranchTree({
      steps: [s],
      questions: [a, b, c, d, x, y],
      branches: [ba, bb, bc, bx],
    });
    expect(branchLevel(tree, bc.id)).toBe(3);
    // x opens bx (height 1): it may enter ba (1+1) and bb (2+1), not bc (3+1) and not its own bx.
    expect(branchIds(eligibleBranchesFor({ id: x.id, showOnProfile: false }, tree))).toEqual([
      ba.id,
      bb.id,
    ]);
    // a new question may enter any of the four, level 3 included: it opens nothing.
    expect(branchIds(eligibleBranchesFor({ id: null, showOnProfile: false }, tree))).toEqual([
      ba.id,
      bb.id,
      bc.id,
      bx.id,
    ]);
    // y opens nothing and sits last: all four openers precede it.
    expect(branchIds(eligibleBranchesFor({ id: y.id, showOnProfile: false }, tree))).toEqual([
      ba.id,
      bb.id,
      bc.id,
      bx.id,
    ]);
  });

  it('leaves out an archived branch', () => {
    const tree = clinicWith({}, { B4: { archivedAt: '2026-10-01T00:00:00.000Z' } });
    expect(keys(eligibleBranchesFor({ id: null, showOnProfile: false }, tree).branches)).toEqual([
      'B1',
      'B2',
      'B3',
    ]);
  });

  it('a new question going into a step only sees openers of that step or the ones before it', () => {
    const s1 = adminStep({ id: uuid(901), position: 1 });
    const s2 = adminStep({ id: uuid(902), position: 2 });
    const first = adminQuestion('yes_no', { id: uuid(10), stepId: s1.id });
    const later = adminQuestion('yes_no', { id: uuid(11), stepId: s2.id });
    const bFirst = adminBranch({ id: uuid(950), openerQuestionId: first.id, values: ['true'] });
    const bLater = adminBranch({ id: uuid(951), openerQuestionId: later.id, values: ['true'] });
    const tree = buildBranchTree({
      steps: [s1, s2],
      questions: [first, later],
      branches: [bFirst, bLater],
    });
    expect(
      branchIds(eligibleBranchesFor({ id: null, showOnProfile: false, stepId: s1.id }, tree)),
    ).toEqual([bFirst.id]);
    expect(
      branchIds(eligibleBranchesFor({ id: null, showOnProfile: false, stepId: s2.id }, tree)),
    ).toEqual([bFirst.id, bLater.id]);
    expect(branchIds(eligibleBranchesFor({ id: null, showOnProfile: false }, tree))).toEqual([
      bFirst.id,
      bLater.id,
    ]);
  });

  it('a public question never enters a branch whose chain holds a private opener, and says so (UI-D-675)', () => {
    const allPrivate = clinicWith();
    const none = eligibleBranchesFor({ id: null, showOnProfile: true }, allPrivate);
    expect(none.branches).toEqual([]);
    expect(none.leftOutForPrivacy).toBe(true);

    const q1Public = clinicWith({ Q1: { showOnProfile: true } });
    const some = eligibleBranchesFor({ id: null, showOnProfile: true }, q1Public);
    expect(keys(some.branches)).toEqual(['B1', 'B4']);
    expect(some.leftOutForPrivacy).toBe(true);

    const allPublic = clinicWith({
      Q1: { showOnProfile: true },
      Q2: { showOnProfile: true },
      Q5: { showOnProfile: true },
    });
    const every = eligibleBranchesFor({ id: null, showOnProfile: true }, allPublic);
    expect(keys(every.branches)).toEqual(['B1', 'B4', 'B2', 'B3']);
    expect(every.leftOutForPrivacy).toBe(false);

    const privateSubject = eligibleBranchesFor({ id: null, showOnProfile: false }, allPrivate);
    expect(keys(privateSubject.branches)).toEqual(['B1', 'B4', 'B2', 'B3']);
    expect(privateSubject.leftOutForPrivacy).toBe(false);
  });

  it('does not say a branch was left out for privacy when it was left out for another reason', () => {
    const tree = clinicWith({}, { B4: { archivedAt: '2026-10-01T00:00:00.000Z' } });
    const result = eligibleBranchesFor(subject('Q1', true), tree);
    expect(result.leftOutForPrivacy).toBe(false);
  });

  it('is a pure function of the read: the same input gives the same output and nothing is changed', () => {
    const list = clinicAdminList();
    const before = JSON.stringify(list);
    const tree = buildBranchTree({
      steps: list.steps,
      questions: list.questions,
      branches: list.branches,
    });
    const first = eligibleBranchesFor(subject('Q5'), tree);
    const second = eligibleBranchesFor(subject('Q5'), tree);
    expect(second).toEqual(first);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('eligibleOpenersFor: the questions that may open a branch (D-641, D-644, UI-D-671)', () => {
  it('for a new branch lists the active questions of the four opener types that fit one more level', () => {
    expect(keys(eligibleOpenersFor(null, clinicWith()))).toEqual(['Q1', 'Q2', 'Q5']);
  });

  it('leaves out an opener already at the deepest level', () => {
    const tree = clinicWith({ Q6: { type: 'yes_no' } });
    expect(keys(eligibleOpenersFor(null, tree))).toEqual(['Q1', 'Q2', 'Q5']);
  });

  it('for an existing branch lists only the openers before every question of the branch, fitting its height', () => {
    const tree = clinicWith();
    const branch = (key: string) => {
      const found = tree.branchById.get(clinicId(key));
      if (found === undefined) throw new Error(key);
      return found;
    };
    expect(keys(eligibleOpenersFor(branch('B1'), tree))).toEqual(['Q1']);
    expect(keys(eligibleOpenersFor(branch('B2'), tree))).toEqual(['Q1', 'Q2']);
    expect(keys(eligibleOpenersFor(branch('B3'), tree))).toEqual(['Q1', 'Q2', 'Q5']);
    expect(keys(eligibleOpenersFor(branch('B4'), tree))).toEqual(['Q1', 'Q2', 'Q5']);
  });

  it('an opener that would put a public question of the branch under a private opener is left out', () => {
    const privateTree = clinicWith({ Q4: { showOnProfile: true } });
    const b2 = privateTree.branchById.get(clinicId('B2'));
    if (b2 === undefined) throw new Error('B2');
    expect(keys(eligibleOpenersFor(b2, privateTree))).toEqual([]);

    const publicOpeners = clinicWith({
      Q4: { showOnProfile: true },
      Q1: { showOnProfile: true },
      Q2: { showOnProfile: true },
    });
    const b2Again = publicOpeners.branchById.get(clinicId('B2'));
    if (b2Again === undefined) throw new Error('B2');
    expect(keys(eligibleOpenersFor(b2Again, publicOpeners))).toEqual(['Q1', 'Q2']);
  });

  it('is a pure function of the read', () => {
    const list = clinicAdminList();
    const before = JSON.stringify(list);
    const tree = buildBranchTree({
      steps: list.steps,
      questions: list.questions,
      branches: list.branches,
    });
    const a = eligibleOpenersFor(null, tree);
    const b = eligibleOpenersFor(null, tree);
    expect(b).toEqual(a);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('publicUnderPrivateTitles: the titles WR-06 would refuse (PFORM-53, UI-D-675)', () => {
  it('lists the public questions that have a private opener anywhere on their chain, at depth 1, 2 and 3', () => {
    const tree = clinicWith({
      Q3: { showOnProfile: true },
      Q4: { showOnProfile: true },
      Q6: { showOnProfile: true },
    });
    expect(publicUnderPrivateTitles(tree)).toEqual([
      'Quantos profissionais?',
      'Nome do sócio',
      'Nome da clínica',
    ]);
  });

  it('is empty when every opener on the chain is public, or the question is private', () => {
    expect(publicUnderPrivateTitles(clinicWith())).toEqual([]);
    const allPublic = clinicWith({
      Q1: { showOnProfile: true },
      Q2: { showOnProfile: true },
      Q5: { showOnProfile: true },
      Q3: { showOnProfile: true },
      Q4: { showOnProfile: true },
      Q6: { showOnProfile: true },
      Q7: { showOnProfile: true },
    });
    expect(publicUnderPrivateTitles(allPublic)).toEqual([]);
  });

  it('a private opener in the middle of the chain is enough, even when the ones around it are public', () => {
    const tree = clinicWith({
      Q1: { showOnProfile: true },
      Q5: { showOnProfile: true },
      Q6: { showOnProfile: true },
    });
    expect(publicUnderPrivateTitles(tree)).toEqual(['Tem sócio?', 'Nome do sócio']);
  });
});

describe('flowTree: the data of the Fluxo (D-649, UI-D-676)', () => {
  it('has the unconditional questions at the root and the branches under their openers to three levels', () => {
    const flow = flowTree(clinic());
    expect(flow.roots.map((q) => q.id)).toEqual([clinicId('Q1')]);
    const q1 = flow.roots[0];
    expect(q1?.branches.map((b) => b.id)).toEqual([clinicId('B1'), clinicId('B4')]);
    const b1 = q1?.branches[0];
    expect(b1?.questions.map((q) => q.id)).toEqual([clinicId('Q2'), clinicId('Q3')]);
    const b2 = b1?.questions[0]?.branches[0];
    expect(b2?.id).toBe(clinicId('B2'));
    expect(b2?.questions.map((q) => q.id)).toEqual([clinicId('Q4'), clinicId('Q5')]);
    const b3 = b2?.questions[1]?.branches[0];
    expect(b3?.id).toBe(clinicId('B3'));
    expect(b3?.questions.map((q) => q.id)).toEqual([clinicId('Q6')]);
    expect(b3?.questions[0]?.branches).toEqual([]);
  });

  it('carries on each question its type, required flag, public flag and step ordinal, and nothing more', () => {
    const q1 = flowTree(clinicWith({ Q1: { showOnProfile: true, required: true } })).roots[0];
    expect(q1).toMatchObject({
      title: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
      type: 'single_choice',
      required: true,
      showOnProfile: true,
      stepOrdinal: 1,
    });
    expect(Object.keys(q1 ?? {}).sort()).toEqual([
      'branches',
      'id',
      'required',
      'showOnProfile',
      'stepOrdinal',
      'title',
      'type',
    ]);
  });

  it('gives each branch its label parts and question count', () => {
    const list = clinicAdminList();
    const tree = clinic();
    const edge = flowTree(tree).roots[0]?.branches[0];
    expect(edge?.questionCount).toBe(2);
    expect(Object.keys(edge ?? {}).sort()).toEqual(['id', 'label', 'questionCount', 'questions']);
    const b1 = list.branches?.[0];
    expect(edge?.label).toEqual(b1 ? describeBranch(b1, tree.questionById) : null);
  });

  it('a named branch carries its name and the answers (the admin lane only)', () => {
    const edge = flowTree(clinicWith({}, { B1: { name: 'Donos de clínica' } })).roots[0]
      ?.branches[0];
    expect(edge?.label).toMatchObject({ name: 'Donos de clínica', labels: ['Tenho uma clínica'] });
  });

  it('shows an empty branch with a zero count, and leaves out an archived branch', () => {
    const s = adminStep({ id: uuid(901), position: 1 });
    const opener = adminQuestion('yes_no', { id: uuid(10), stepId: s.id });
    const empty = adminBranch({ id: uuid(950), openerQuestionId: opener.id, values: ['true'] });
    const old = adminBranch({
      id: uuid(951),
      openerQuestionId: opener.id,
      values: ['false'],
      archivedAt: '2026-10-01T00:00:00.000Z',
    });
    const flow = flowTree(
      buildBranchTree({ steps: [s], questions: [opener], branches: [empty, old] }),
    );
    const branches = flow.roots[0]?.branches ?? [];
    expect(branches.map((b) => b.id)).toEqual([empty.id]);
    expect(branches[0]?.questionCount).toBe(0);
    expect(branches[0]?.questions).toEqual([]);
  });

  it('numbers the steps and says how many there are, so the pill shows only with two or more', () => {
    const s1 = adminStep({ id: uuid(901), position: 1 });
    const s2 = adminStep({ id: uuid(902), position: 2 });
    const a = adminQuestion('yes_no', { id: uuid(10), stepId: s1.id });
    const b = adminBranch({ id: uuid(950), openerQuestionId: a.id, values: ['true'] });
    const c = adminQuestion('short_text', { id: uuid(11), stepId: s2.id, branchId: b.id });
    const flow = flowTree(buildBranchTree({ steps: [s1, s2], questions: [a, c], branches: [b] }));
    expect(flow.stepCount).toBe(2);
    expect(flow.roots[0]?.stepOrdinal).toBe(1);
    expect(flow.roots[0]?.branches[0]?.questions[0]?.stepOrdinal).toBe(2);
    expect(flowTree(clinic()).stepCount).toBe(1);
  });

  it('draws every question once even when the stored tree has a cycle', () => {
    const s = adminStep({ id: uuid(901), position: 1 });
    const a = adminBranch({ id: uuid(957), openerQuestionId: uuid(11), values: ['true'] });
    const b = adminBranch({ id: uuid(958), openerQuestionId: uuid(10), values: ['true'] });
    const tree = buildBranchTree({
      steps: [s],
      questions: [
        adminQuestion('yes_no', { id: uuid(10), stepId: s.id, branchId: a.id }),
        adminQuestion('yes_no', { id: uuid(11), stepId: s.id, branchId: b.id }),
        adminQuestion('short_text', { id: uuid(12), stepId: s.id }),
      ],
      branches: [a, b],
    });
    const seen: string[] = [];
    const walk = (nodes: readonly { id: string; branches: { questions: unknown[] }[] }[]) => {
      for (const node of nodes) {
        seen.push(node.id);
        for (const branch of node.branches) walk(branch.questions as never);
      }
    };
    walk(flowTree(tree).roots);
    expect([...seen].sort()).toEqual([uuid(10), uuid(11), uuid(12)]);
  });
});
