import type { ReactElement } from 'react';

/** RED stub (09-10 Task 1): replaced by the GREEN commit. */
export interface FollowButtonLabels {
  follow: string;
  following: string;
  ariaFollow: string;
  ariaFollowing: string;
}

export interface FollowButtonProps {
  following: boolean;
  pending?: boolean;
  size?: 'md' | 'sm';
  fullWidth?: boolean;
  className?: string;
  labels: FollowButtonLabels;
  onToggle: () => void;
}

export function FollowButton(_props: FollowButtonProps): ReactElement | null {
  return null;
}
