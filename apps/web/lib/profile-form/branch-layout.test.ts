import { describe, expect, it } from 'vitest';
import {
  type LayoutStep,
  layoutOf,
  type MoveDirection,
  moveBranchRun,
  moveUnit,
  orderViolationOf,
  treeLayoutOf,
} from './branch-layout';
import { type AdminBranchTree, buildBranchTree } from './branch-tree';
import {
  ADMIN_STEP_ID,
  adminBranch,
  adminQuestion,
  adminStep,
  clinicAdminList,
  clinicId,
  uuid,
} from './test-fixtures';

/**
 * 12.2-13 task 2 (D-652, UI-D-668): the block-aware reorder. A question moves ONE place among its siblings and
 * an opener's whole block travels with it; a branch run moves among the runs of its opener; nothing ever
 * changes a question's branch or step, and every result is already in tree order.
 */

const KEYS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'];
const clinicTree = (): AdminBranchTree => {
  const list = clinicAdminList();
  return buildBranchTree({ steps: list.steps, questions: list.questions, branches: list.branches });
};
const keysOf = (layout: readonly LayoutStep[]) =>
  layout.map((step) => step.questionIds.map((id) => KEYS.find((key) => clinicId(key) === id)));
const DIRECTIONS: MoveDirection[] = ['up', 'down'];

describe('layoutOf and treeLayoutOf: the current layout, in tree order (D-652)', () => {
  it('lists the steps in order with the question ids in stored order', () => {
    expect(keysOf(layoutOf(clinicTree()))).toEqual([['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3', 'Q7']]);
    expect(layoutOf(clinicTree())[0]?.stepId).toBe(ADMIN_STEP_ID);
  });

  it('puts a flat layout in tree order and leaves a tree-ordered one alone', () => {
    const tree = clinicTree();
    const flat: LayoutStep[] = [
      { stepId: ADMIN_STEP_ID, questionIds: KEYS.map((key) => clinicId(key)) },
    ];
    expect(keysOf(treeLayoutOf(flat, tree))).toEqual([['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3', 'Q7']]);
    const ordered = layoutOf(tree);
    expect(treeLayoutOf(ordered, tree)).toEqual(ordered);
  });
});

describe('moveUnit: one place among the siblings, a block as one place (D-652, UI-D-668)', () => {
  it('moves a question one place among the questions of its branch run', () => {
    const tree = clinicTree();
    const moved = moveUnit(layoutOf(tree), tree, clinicId('Q3'), 'up');
    expect(keysOf(moved)).toEqual([['Q1', 'Q3', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7']]);
  });

  it('an opener travels with its whole block', () => {
    const tree = clinicTree();
    const moved = moveUnit(layoutOf(tree), tree, clinicId('Q2'), 'down');
    expect(keysOf(moved)).toEqual([['Q1', 'Q3', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7']]);
  });

  it('a sibling that opens a block counts as one place when something moves past it', () => {
    const tree = clinicTree();
    const down = moveUnit(layoutOf(tree), tree, clinicId('Q4'), 'down');
    expect(keysOf(down)).toEqual([['Q1', 'Q2', 'Q5', 'Q6', 'Q4', 'Q3', 'Q7']]);
    const up = moveUnit(layoutOf(tree), tree, clinicId('Q5'), 'up');
    expect(keysOf(up)).toEqual([['Q1', 'Q2', 'Q5', 'Q6', 'Q4', 'Q3', 'Q7']]);
  });

  it('a move past the first or last sibling returns the layout unchanged', () => {
    const tree = clinicTree();
    const layout = layoutOf(tree);
    const first = moveUnit(layout, tree, clinicId('Q2'), 'up');
    expect(first).toEqual(layout);
    expect(first).toBe(layout);
    expect(moveUnit(layout, tree, clinicId('Q3'), 'down')).toEqual(layout);
    // The only question of its branch, and the only unconditional question of the step.
    expect(moveUnit(layout, tree, clinicId('Q6'), 'up')).toEqual(layout);
    expect(moveUnit(layout, tree, clinicId('Q6'), 'down')).toEqual(layout);
    expect(moveUnit(layout, tree, clinicId('Q1'), 'down')).toEqual(layout);
    expect(moveUnit(layout, tree, uuid(1), 'up')).toEqual(layout);
  });

  it('never leaves a branch: the order of the unconditional questions is its own list', () => {
    const s = adminStep({ id: uuid(901), position: 1 });
    const a = adminQuestion('yes_no', { id: uuid(10), stepId: s.id });
    const b = adminBranch({ id: uuid(950), openerQuestionId: a.id, values: ['true'] });
    const inside = adminQuestion('short_text', { id: uuid(11), stepId: s.id, branchId: b.id });
    const c = adminQuestion('short_text', { id: uuid(12), stepId: s.id });
    const tree = buildBranchTree({ steps: [s], questions: [a, inside, c], branches: [b] });
    // c is the next unconditional place after a's block.
    const up = moveUnit(layoutOf(tree), tree, c.id, 'up');
    expect(up[0]?.questionIds).toEqual([c.id, a.id, inside.id]);
    const down = moveUnit(layoutOf(tree), tree, a.id, 'down');
    expect(down[0]?.questionIds).toEqual([c.id, a.id, inside.id]);
  });
});

describe('moveBranchRun: a run among the runs of its opener (D-652, UI-D-668)', () => {
  it('moves B4 above B1 and B1 below B4 as the same block move', () => {
    const tree = clinicTree();
    const up = moveBranchRun(layoutOf(tree), tree, clinicId('B4'), 'up');
    expect(keysOf(up)).toEqual([['Q1', 'Q7', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3']]);
    const down = moveBranchRun(layoutOf(tree), tree, clinicId('B1'), 'down');
    expect(keysOf(down)).toEqual([['Q1', 'Q7', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3']]);
  });

  it('moving the first run up, the last run down, or the only run either way changes nothing', () => {
    const tree = clinicTree();
    const layout = layoutOf(tree);
    expect(moveBranchRun(layout, tree, clinicId('B1'), 'up')).toBe(layout);
    expect(moveBranchRun(layout, tree, clinicId('B4'), 'down')).toBe(layout);
    for (const direction of DIRECTIONS) {
      expect(moveBranchRun(layout, tree, clinicId('B2'), direction)).toEqual(layout);
      expect(moveBranchRun(layout, tree, clinicId('B3'), direction)).toEqual(layout);
    }
    expect(moveBranchRun(layout, tree, uuid(1), 'up')).toEqual(layout);
  });
});

describe('several steps: a run whose opener is in another step is placed like an unconditional unit (D-643)', () => {
  const s1 = adminStep({ id: uuid(901), position: 1 });
  const s2 = adminStep({ id: uuid(902), position: 2 });
  const opener = adminQuestion('yes_no', { id: uuid(10), stepId: s1.id });
  const x = adminBranch({ id: uuid(950), openerQuestionId: opener.id, values: ['true'] });
  const y = adminBranch({ id: uuid(951), openerQuestionId: opener.id, values: ['false'] });
  const inX = adminQuestion('short_text', { id: uuid(11), stepId: s2.id, branchId: x.id });
  const inY = adminQuestion('short_text', { id: uuid(12), stepId: s2.id, branchId: y.id });
  const a = adminQuestion('short_text', { id: uuid(20), stepId: s2.id });
  const b = adminQuestion('short_text', { id: uuid(21), stepId: s2.id });
  const tree = buildBranchTree({
    steps: [s1, s2],
    questions: [opener, inX, a, inY, b],
    branches: [x, y],
  });

  it('starts as the stored layout', () => {
    expect(layoutOf(tree)).toEqual([
      { stepId: s1.id, questionIds: [opener.id] },
      { stepId: s2.id, questionIds: [inX.id, a.id, inY.id, b.id] },
    ]);
  });

  it('an unconditional question moves among the unconditional questions, past a foreign run', () => {
    const up = moveUnit(layoutOf(tree), tree, b.id, 'up');
    expect(up[1]?.questionIds).toEqual([inX.id, b.id, a.id, inY.id]);
    const down = moveUnit(layoutOf(tree), tree, a.id, 'down');
    expect(down[1]?.questionIds).toEqual([inX.id, inY.id, b.id, a.id]);
  });

  it('a question of a foreign run has the other questions of that run as siblings only', () => {
    const layout = layoutOf(tree);
    expect(moveUnit(layout, tree, inX.id, 'down')).toEqual(layout);
    expect(moveUnit(layout, tree, inY.id, 'up')).toEqual(layout);
  });

  it('two runs of one opener swap, wherever the unconditional questions sit between them', () => {
    const moved = moveBranchRun(layoutOf(tree), tree, y.id, 'up', s2.id);
    expect(moved[1]?.questionIds).toEqual([inY.id, inX.id, a.id, b.id]);
    expect(moved[0]).toEqual({ stepId: s1.id, questionIds: [opener.id] });
    const back = moveBranchRun(moved, tree, y.id, 'down', s2.id);
    expect(back[1]?.questionIds).toEqual([inX.id, inY.id, a.id, b.id]);
  });

  it('a run of a branch in two steps moves in the step named, and the first run by default', () => {
    const p = adminStep({ id: uuid(911), position: 1 });
    const q = adminStep({ id: uuid(912), position: 2 });
    const o = adminQuestion('yes_no', { id: uuid(30), stepId: p.id });
    const m = adminBranch({ id: uuid(960), openerQuestionId: o.id, values: ['true'] });
    const n = adminBranch({ id: uuid(961), openerQuestionId: o.id, values: ['false'] });
    const inM1 = adminQuestion('short_text', { id: uuid(31), stepId: p.id, branchId: m.id });
    const inN1 = adminQuestion('short_text', { id: uuid(32), stepId: p.id, branchId: n.id });
    const inM2 = adminQuestion('short_text', { id: uuid(33), stepId: q.id, branchId: m.id });
    const inN2 = adminQuestion('short_text', { id: uuid(34), stepId: q.id, branchId: n.id });
    const two = buildBranchTree({
      steps: [p, q],
      questions: [o, inM1, inN1, inM2, inN2],
      branches: [m, n],
    });
    const second = moveBranchRun(layoutOf(two), two, n.id, 'up', q.id);
    expect(second[0]?.questionIds).toEqual([o.id, inM1.id, inN1.id]);
    expect(second[1]?.questionIds).toEqual([inN2.id, inM2.id]);
    const byDefault = moveBranchRun(layoutOf(two), two, n.id, 'up');
    expect(byDefault[0]?.questionIds).toEqual([o.id, inN1.id, inM1.id]);
    expect(byDefault[1]?.questionIds).toEqual([inM2.id, inN2.id]);
  });
});

describe('every move keeps the form whole and in tree order (D-652, T-12.2-05)', () => {
  const tree = clinicTree();
  const layout = layoutOf(tree);
  const results: { name: string; result: LayoutStep[] }[] = [];
  for (const key of KEYS) {
    for (const direction of DIRECTIONS) {
      results.push({
        name: `moveUnit ${key} ${direction}`,
        result: moveUnit(layout, tree, clinicId(key), direction),
      });
    }
  }
  for (const key of ['B1', 'B2', 'B3', 'B4']) {
    for (const direction of DIRECTIONS) {
      results.push({
        name: `moveBranchRun ${key} ${direction}`,
        result: moveBranchRun(layout, tree, clinicId(key), direction),
      });
    }
  }

  for (const { name, result } of results) {
    it(`${name}: same ids, same steps, already in tree order, openers before their questions`, () => {
      expect(result.map((step) => step.stepId)).toEqual(layout.map((step) => step.stepId));
      for (const [index, step] of result.entries()) {
        expect([...step.questionIds].sort()).toEqual(
          [...(layout[index]?.questionIds ?? [])].sort(),
        );
      }
      expect(treeLayoutOf(result, tree)).toEqual(result);
      const flat = result.flatMap((step) => step.questionIds);
      for (const question of tree.questions) {
        const branch = tree.branchById.get(question.branchId ?? '');
        if (branch === undefined) continue;
        expect(flat.indexOf(branch.openerQuestionId)).toBeLessThan(flat.indexOf(question.id));
      }
    });
  }

  it('does not change the layout or the tree it is given', () => {
    const before = JSON.stringify(layout);
    const treeBefore = JSON.stringify(tree.questions);
    moveUnit(layout, tree, clinicId('Q3'), 'up');
    moveBranchRun(layout, tree, clinicId('B4'), 'up');
    expect(JSON.stringify(layout)).toBe(before);
    expect(JSON.stringify(tree.questions)).toBe(treeBefore);
  });
});

/**
 * 12.2-15 task 3 (D-652, UI-D-668): the pre-check of a candidate layout. The first question that would sit at
 * or before the opener of its branch is named together with that opener, so the press can say which two
 * QUESTIONS conflict before anything moves. The server revalidates; this check only decides what to say.
 */
describe('orderViolationOf: a candidate layout that puts a question at or before its opener (D-652)', () => {
  const X1 = adminStep({ title: 'Primeira' });
  const X2 = adminStep({ title: 'Segunda' });
  const opener = adminQuestion('yes_no', { title: 'Tem clínica?', stepId: X1.id });
  const gate = adminBranch({ openerQuestionId: opener.id, values: ['true'], questionCount: 1 });
  const inside = adminQuestion('short_text', {
    title: 'Nome da clínica',
    stepId: X2.id,
    branchId: gate.id,
  });
  const free = adminQuestion('short_text', { title: 'Cargo', stepId: X2.id });
  const tree = buildBranchTree({
    steps: [X1, X2],
    questions: [opener, inside, free],
    branches: [gate],
  });

  it('is null for the layout the form holds', () => {
    expect(orderViolationOf(layoutOf(tree), tree)).toBeNull();
  });

  it('names the question and its opener when a step moves above the step of the opener', () => {
    const swapped: LayoutStep[] = [
      { stepId: X2.id, questionIds: [inside.id, free.id] },
      { stepId: X1.id, questionIds: [opener.id] },
    ];
    const found = orderViolationOf(swapped, tree);
    expect(found?.dependent.id).toBe(inside.id);
    expect(found?.dependent.title).toBe('Nome da clínica');
    expect(found?.opener.id).toBe(opener.id);
    expect(found?.opener.title).toBe('Tem clínica?');
  });

  it('passes the same steps when the opener stays earlier', () => {
    const kept: LayoutStep[] = [
      { stepId: X1.id, questionIds: [opener.id] },
      { stepId: X2.id, questionIds: [free.id, inside.id] },
    ];
    expect(orderViolationOf(kept, tree)).toBeNull();
  });

  it('refuses a question placed right before its opener in the same step', () => {
    const sameStep = buildBranchTree({
      steps: [X1],
      questions: [
        { ...opener, stepId: X1.id },
        { ...inside, stepId: X1.id },
      ],
      branches: [gate],
    });
    const before: LayoutStep[] = [{ stepId: X1.id, questionIds: [inside.id, opener.id] }];
    expect(orderViolationOf(before, sameStep)?.dependent.id).toBe(inside.id);
    const after: LayoutStep[] = [{ stepId: X1.id, questionIds: [opener.id, inside.id] }];
    expect(orderViolationOf(after, sameStep)).toBeNull();
  });

  it('reports the FIRST violation in the order of the candidate layout', () => {
    const second = adminQuestion('short_text', {
      title: 'Segunda dependente',
      stepId: X2.id,
      branchId: gate.id,
    });
    const both = buildBranchTree({
      steps: [X1, X2],
      questions: [opener, inside, second, free],
      branches: [gate],
    });
    const swapped: LayoutStep[] = [
      { stepId: X2.id, questionIds: [second.id, inside.id, free.id] },
      { stepId: X1.id, questionIds: [opener.id] },
    ];
    expect(orderViolationOf(swapped, both)?.dependent.id).toBe(second.id);
  });

  it('ignores an archived branch (its questions are unconditional, like in the Lista) and an unknown opener', () => {
    const archived = { ...gate, archivedAt: '2026-10-20T15:30:00.000Z' };
    const quiet = buildBranchTree({
      steps: [X1, X2],
      questions: [opener, inside, free],
      branches: [archived],
    });
    const swapped: LayoutStep[] = [
      { stepId: X2.id, questionIds: [inside.id, free.id] },
      { stepId: X1.id, questionIds: [opener.id] },
    ];
    expect(orderViolationOf(swapped, quiet)).toBeNull();
    const lost = [{ stepId: X2.id, questionIds: [inside.id, free.id] }];
    expect(orderViolationOf(lost, tree)).toBeNull();
  });

  it('does not change the layout it is given', () => {
    const swapped: LayoutStep[] = [
      { stepId: X2.id, questionIds: [inside.id, free.id] },
      { stepId: X1.id, questionIds: [opener.id] },
    ];
    const before = JSON.stringify(swapped);
    orderViolationOf(swapped, tree);
    expect(JSON.stringify(swapped)).toBe(before);
  });
});
