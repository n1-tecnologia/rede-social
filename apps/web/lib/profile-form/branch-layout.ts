import type { AdminBranchTree } from './branch-tree';

/**
 * The block-aware reorder of the builder (12.2-13, D-652). RED stub: the types are final, every function is
 * deliberately inert and is replaced in full by the GREEN commit of the same task.
 */

export type LayoutStep = { stepId: string; questionIds: string[] };
export type MoveDirection = 'up' | 'down';

/** The layout as the admin read stores it: the steps in order, each with its question ids in stored order. */
export function layoutOf(_tree: AdminBranchTree): LayoutStep[] {
  return [];
}

/** A layout in tree order (the contracts' `treeOrder`), the form the server stores. */
export function treeLayoutOf(
  layout: readonly { stepId: string; questionIds: readonly string[] }[],
  _tree: AdminBranchTree,
): LayoutStep[] {
  return layout.map((step) => ({ stepId: step.stepId, questionIds: [...step.questionIds] }));
}

export function moveUnit(
  layout: readonly LayoutStep[],
  _tree: AdminBranchTree,
  _questionId: string,
  _direction: MoveDirection,
): LayoutStep[] {
  return layout as LayoutStep[];
}

export function moveBranchRun(
  layout: readonly LayoutStep[],
  _tree: AdminBranchTree,
  _branchId: string,
  _direction: MoveDirection,
  _stepId?: string,
): LayoutStep[] {
  return layout as LayoutStep[];
}
