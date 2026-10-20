import type { ReactElement } from 'react';

/** RED stub (09-10 Task 1): replaced by the GREEN commit. */
export interface FollowCountCell {
  value: string;
  label: string;
  href?: string;
  ariaLabel?: string;
}

export interface FollowCountsProps {
  followers: FollowCountCell;
  following: FollowCountCell;
}

export function FollowCounts(_props: FollowCountsProps): ReactElement | null {
  return null;
}
