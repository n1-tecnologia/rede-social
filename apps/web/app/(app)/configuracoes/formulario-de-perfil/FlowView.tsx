'use client';

import type { AdminBranch, AdminQuestion, AdminStep } from '@rede-social/contracts/profile-form';
import type { AdminBranchTree } from '@/lib/profile-form/branch-tree';

export interface FlowViewProps {
  /** The one tree the Lista is drawn from (`buildBranchTree`). */
  tree: AdminBranchTree;
  /** The builder's steps: the "Etapa {n}" pill shows from two. */
  steps: readonly AdminStep[];
  /** A question node was tapped: the question and the element that opened it (focus goes back there). */
  onOpenQuestion: (question: AdminQuestion, trigger: HTMLElement) => void;
  /** A branch edge was tapped: the branch and the element that opened it. */
  onOpenBranch: (branch: AdminBranch, trigger: HTMLElement) => void;
}

/**
 * INERT STUB (12.2-19, RED commit only): the real read-only vertical tree replaces this in the GREEN commit.
 * It draws nothing, so every test that expects the drawing fails for the right reason.
 */
export function FlowView(_props: FlowViewProps) {
  return null;
}
