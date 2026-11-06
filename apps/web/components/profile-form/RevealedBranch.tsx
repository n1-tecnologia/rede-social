'use client';

import type { ReactNode } from 'react';

/**
 * The motion wrapper of a block of questions with the shared rail (12.2-14, D-641; UI-D-679).
 *
 * INERT STUB of the RED commit: it draws its children as they are, with no rail and no motion. The GREEN
 * commit replaces it.
 */
export interface RevealedBranchProps {
  show: boolean;
  children: ReactNode;
}

export function RevealedBranch({ show, children }: RevealedBranchProps) {
  return show ? <>{children}</> : null;
}
