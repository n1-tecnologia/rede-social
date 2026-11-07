'use client';

import type { AdminBranch, AdminQuestion, AdminStep } from '@rede-social/contracts/profile-form';

export interface BranchSheetProps {
  open: boolean;
  /** The question that decides; read-only in create mode. */
  opener: AdminQuestion;
  steps: AdminStep[];
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** The branch was created: the host refreshes the page and closes the sheet. */
  onSaved: (branch: AdminBranch) => void;
}

/**
 * The branch sheet, create mode (12.2-16, D-640, D-642, UI-D-671). RED-stage stub: inert, replaced in the GREEN
 * commit.
 */
export function BranchSheet(_props: BranchSheetProps) {
  return null;
}
