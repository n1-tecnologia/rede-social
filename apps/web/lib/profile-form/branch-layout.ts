import { treeOrder } from '@rede-social/contracts/profile-form-branches';
import { type AdminBranchTree, usableBranch, usableBranchesOf } from './branch-tree';

/**
 * The block-aware reorder of the builder (12.2-13, D-652, UI-D-668): the layout the builder PUTs, computed
 * on the client. The order of a form IS its tree: a branch's questions are consecutive and right after their
 * opener, a nested branch sits inside its parent's block. A question moves ONE place among its siblings (the
 * questions of the same branch run, or the unconditional questions of the step) and an opener's whole block
 * counts as one place and travels with it; a branch run moves among the runs of its opener in the step.
 * Neither ever changes a question's branch or step, and every result goes through the contracts' `treeOrder`,
 * so the server's normaliser is a no-op for it. The server stays the authority and revalidates every write.
 */

export type LayoutStep = { stepId: string; questionIds: string[] };
export type MoveDirection = 'up' | 'down';

/** The layout as the admin read stores it: the steps in order, each with its question ids in stored order. */
export function layoutOf(tree: AdminBranchTree): LayoutStep[] {
  return tree.steps.map((step) => ({
    stepId: step.id,
    questionIds: tree.questions.filter((q) => q.stepId === step.id).map((q) => q.id),
  }));
}

/**
 * A layout in tree order: the contracts' `treeOrder` over the question-to-branch map of the read. A question
 * of an archived or unknown branch is unconditional, like in the Lista. Idempotent.
 */
export function treeLayoutOf(
  layout: readonly { stepId: string; questionIds: readonly string[] }[],
  tree: AdminBranchTree,
): LayoutStep[] {
  const branchIdOf = new Map(
    tree.questions.map((question) => [
      question.id,
      usableBranch(tree, question.branchId)?.id ?? null,
    ]),
  );
  const branches = tree.branches
    .filter((branch) => branch.archivedAt === null)
    .map((branch) => ({ id: branch.id, openerQuestionId: branch.openerQuestionId }));
  return treeOrder({ layout, branchIdOf, branches }).map((step) => ({
    stepId: step.stepId,
    questionIds: [...step.questionIds],
  }));
}

/** The shape of one tree-ordered step: each position's branch and where its block ends. */
type Forest = { branchAt: (string | null)[]; blockEnd: number[] };

function forestOf(ids: readonly string[], tree: AdminBranchTree): Forest {
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const branchAt = ids.map(
    (id) => usableBranch(tree, tree.questionById.get(id)?.branchId)?.id ?? null,
  );
  const children: number[][] = ids.map(() => []);
  branchAt.forEach((branchId, index) => {
    if (branchId === null) return;
    const opener = tree.branchById.get(branchId)?.openerQuestionId;
    const parent = opener === undefined ? undefined : indexOf.get(opener);
    if (parent !== undefined && parent !== index) children[parent]?.push(index);
  });
  // The block of a position: itself and every position below it in this step (an explicit stack, a visited set).
  const blockEnd = ids.map((_, start) => {
    const seen = new Set<number>([start]);
    const stack = [start];
    let end = start;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      for (const child of children[at] ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        end = Math.max(end, child);
        stack.push(child);
      }
    }
    return end;
  });
  return { branchAt, blockEnd };
}

/** Moves the span `[from, to]` to just before `before`, or (when `after` is given) to just after `after`. */
function relocate(
  ids: readonly string[],
  span: readonly [number, number],
  target: { before: number } | { after: number },
): string[] {
  const [from, to] = span;
  if ('before' in target) {
    return [
      ...ids.slice(0, target.before),
      ...ids.slice(from, to + 1),
      ...ids.slice(target.before, from),
      ...ids.slice(to + 1),
    ];
  }
  return [
    ...ids.slice(0, from),
    ...ids.slice(to + 1, target.after + 1),
    ...ids.slice(from, to + 1),
    ...ids.slice(target.after + 1),
  ];
}

function withStep(
  layout: readonly LayoutStep[],
  at: number,
  questionIds: string[],
  tree: AdminBranchTree,
) {
  return treeLayoutOf(
    layout.map((step, index) => (index === at ? { stepId: step.stepId, questionIds } : step)),
    tree,
  );
}

/**
 * Moves a question ONE place up or down among its siblings in the same branch run (or among the
 * unconditional questions of its step); an opener's block (its branches in the same step) is one place and
 * travels with it. Never changes the question's branch or step. A move past the first or last sibling, or of
 * a question the layout does not hold, returns the layout unchanged (the same value).
 */
export function moveUnit(
  layout: readonly LayoutStep[],
  tree: AdminBranchTree,
  questionId: string,
  direction: MoveDirection,
): LayoutStep[] {
  const unchanged = layout as LayoutStep[];
  const canonical = treeLayoutOf(layout, tree);
  const at = canonical.findIndex((step) => step.questionIds.includes(questionId));
  if (at === -1) return unchanged;
  const ids = canonical[at]?.questionIds ?? [];
  const forest = forestOf(ids, tree);
  const me = ids.indexOf(questionId);
  const group = forest.branchAt[me] ?? null;
  const siblings = ids
    .map((_, index) => index)
    .filter((index) => (forest.branchAt[index] ?? null) === group);
  const place = siblings.indexOf(me);
  const other = siblings[direction === 'up' ? place - 1 : place + 1];
  if (other === undefined) return unchanged;
  const span = [me, forest.blockEnd[me] ?? me] as const;
  const next =
    direction === 'up'
      ? relocate(ids, span, { before: other })
      : relocate(ids, span, { after: forest.blockEnd[other] ?? other });
  return withStep(canonical, at, next, tree);
}

/**
 * Moves the run of a branch in ONE step up or down among the runs of the same opener in that step. `stepId`
 * names the run of a branch whose questions sit in several steps (D-643); absent, the first step that holds
 * one. A move past the first or last run, or of a branch with no run in the step, returns the layout
 * unchanged (the same value).
 */
export function moveBranchRun(
  layout: readonly LayoutStep[],
  tree: AdminBranchTree,
  branchId: string,
  direction: MoveDirection,
  stepId?: string,
): LayoutStep[] {
  const unchanged = layout as LayoutStep[];
  const branch = usableBranch(tree, branchId);
  if (branch === undefined) return unchanged;
  const canonical = treeLayoutOf(layout, tree);
  const at =
    stepId === undefined
      ? canonical.findIndex((step) =>
          step.questionIds.some((id) => tree.questionById.get(id)?.branchId === branchId),
        )
      : canonical.findIndex((step) => step.stepId === stepId);
  if (at === -1) return unchanged;
  const ids = canonical[at]?.questionIds ?? [];
  const forest = forestOf(ids, tree);
  const extentOf = (id: string): [number, number] | null => {
    const members = ids.map((_, index) => index).filter((index) => forest.branchAt[index] === id);
    if (members.length === 0) return null;
    return [
      Math.min(...members),
      Math.max(...members.map((index) => forest.blockEnd[index] ?? index)),
    ];
  };
  const runs = usableBranchesOf(tree, branch.openerQuestionId)
    .map((sibling) => ({ id: sibling.id, extent: extentOf(sibling.id) }))
    .filter((run): run is { id: string; extent: [number, number] } => run.extent !== null)
    .sort((a, b) => a.extent[0] - b.extent[0]);
  const place = runs.findIndex((run) => run.id === branchId);
  const mine = runs[place];
  const other = runs[direction === 'up' ? place - 1 : place + 1];
  if (mine === undefined || other === undefined) return unchanged;
  const next =
    direction === 'up'
      ? relocate(ids, mine.extent, { before: other.extent[0] })
      : relocate(ids, mine.extent, { after: other.extent[1] });
  return withStep(canonical, at, next, tree);
}
