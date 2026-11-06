import {
  branchChainOf,
  branchTreeOf,
  type ProfileFormBranchDef,
} from '@rede-social/contracts/profile-form-branches';

/**
 * The grouping of a screen's questions into nested blocks (12.2-14, D-641, D-644, D-645; UI-D-679).
 *
 * A pure function of the questions on the screen, the form's branches and the set of visible question ids.
 * Consecutive questions of one branch share ONE block, a nested branch is a block INSIDE its parent's, right
 * after the question that opens it, and a question outside every branch closes all the open blocks. The chain
 * of each question is the contracts' `branchChainOf` (nearest first, reversed here to outermost first), so the
 * client never restates the tree rule. A question whose chain is unknown (a branch the form does not list, a
 * cycle) is a plain field: it is never visible, so the screen draws nothing for it.
 *
 * `show` is true while ANY question inside the block (nested blocks included) is visible. A hidden question of
 * a branch stays in the result so the block can animate out. Only ids and flags come out: no branch name, no
 * answer (T-12.2-14).
 */

type BlockQuestion = { id: string; branchId?: string | null };

export type BlockNode<Q extends BlockQuestion = BlockQuestion> =
  | { kind: 'field'; question: Q }
  | { kind: 'block'; branchId: string; children: BlockNode<Q>[]; show: boolean };

type Block<Q extends BlockQuestion> = Extract<BlockNode<Q>, { kind: 'block' }>;

/**
 * @param questions the questions of the screen, in form order (the current step, a step section, or the card)
 * @param branches the form's branches
 * @param visible the ids of the visible questions of the WHOLE form
 * @param universe every question of the form: the chain of a question may pass through an opener that is on
 *   another screen (D-643), and the tree needs it to resolve. Defaults to `questions`.
 */
export function blocksOf<Q extends BlockQuestion>(
  questions: readonly Q[],
  branches: readonly ProfileFormBranchDef[],
  visible: ReadonlySet<string>,
  universe: readonly BlockQuestion[] = questions,
): BlockNode<Q>[] {
  const tree = branchTreeOf(universe, branches);
  const root: BlockNode<Q>[] = [];
  const stack: Block<Q>[] = [];

  const place = (node: BlockNode<Q>) => {
    (stack.at(-1)?.children ?? root).push(node);
  };

  for (const question of questions) {
    const chain =
      question.branchId == null
        ? []
        : (branchChainOf(question.branchId, tree)?.toReversed() ?? null);
    const ids = chain === null ? [] : chain.map((branch) => branch.id);

    // Pop until the open blocks are a prefix of this question's chain.
    let common = 0;
    while (
      common < stack.length &&
      common < ids.length &&
      stack[common]?.branchId === ids[common]
    ) {
      common += 1;
    }
    stack.length = common;

    // Open one block for each branch of the chain that is not open yet.
    for (const branchId of ids.slice(common)) {
      const block: Block<Q> = { kind: 'block', branchId, children: [], show: false };
      place(block);
      stack.push(block);
    }

    if (visible.has(question.id)) for (const block of stack) block.show = true;
    place({ kind: 'field', question });
  }
  return root;
}
