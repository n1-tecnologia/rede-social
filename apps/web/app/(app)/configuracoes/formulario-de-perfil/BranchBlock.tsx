'use client';

import type { AdminBranch } from '@rede-social/contracts/profile-form';
import type { ReactNode } from 'react';
import type { AdminBranchTree } from '@/lib/profile-form/branch-tree';

/**
 * INERT STUB (12.2-15 Task 1, RED commit). It carries the final types only, so the failing tests are
 * assertion failures on the planned behaviour and not an import error. The GREEN commit replaces this
 * whole file.
 */

/** The label of a branch as the strip and the row descriptions read it. */
export interface BranchLabelParts {
  /** The name when the branch has one, else the sentence. */
  label: string;
  /** "Se “{opener}” for {options}", no final period. */
  sentence: string;
  /** The admin's name, or `null`. */
  name: string | null;
}

export interface BranchBlockProps {
  branch: AdminBranch;
  parts: BranchLabelParts;
  count: number;
  empty: boolean;
  openerStepTitle: string | null;
  reordering: boolean;
  busy: boolean;
  place: { index: number; size: number } | null;
  addDisabled: boolean;
  focusKey: string;
  register: (key: string, element: HTMLButtonElement | null) => void;
  onMove: (delta: -1 | 1) => void;
  onEdit?: (branch: AdminBranch) => void;
  onAddQuestion?: () => void;
  children?: ReactNode;
}

export function useBranchLabeler(
  _tree: AdminBranchTree,
): (branch: AdminBranch) => BranchLabelParts {
  return () => ({ label: '', sentence: '', name: null });
}

export function BranchBlock(_props: BranchBlockProps): ReactNode {
  return null;
}
