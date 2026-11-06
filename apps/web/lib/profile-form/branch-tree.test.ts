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
  opensCountOf,
  referencedOptionCounts,
  type StepNode,
  stepTree,
} from './branch-tree';
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
