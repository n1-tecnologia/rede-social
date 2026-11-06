import type { ProfileFormBranchDef } from '@rede-social/contracts/profile-form-branches';

/**
 * The grouping of a screen's questions into nested blocks (12.2-14, D-641, D-644; UI-D-679).
 *
 * INERT STUB of the RED commit: the final types and an empty result, replaced in the GREEN commit.
 */

type BlockQuestion = { id: string; branchId?: string | null };

export type BlockNode<Q extends BlockQuestion = BlockQuestion> =
  | { kind: 'field'; question: Q }
  | { kind: 'block'; branchId: string; children: BlockNode<Q>[]; show: boolean };

export function blocksOf<Q extends BlockQuestion>(
  _questions: readonly Q[],
  _branches: readonly ProfileFormBranchDef[],
  _visible: ReadonlySet<string>,
  _universe: readonly BlockQuestion[] = _questions,
): BlockNode<Q>[] {
  return [];
}
