import type { ReactElement, ReactNode } from 'react';

/** RED stub (09-10 Task 2): replaced by the GREEN commit. */
export interface FollowListRowProps {
  href: string;
  avatar: ReactNode;
  name: string;
  snippet?: string | null;
  action: ReactNode;
}

export function FollowListRow(_props: FollowListRowProps): ReactElement | null {
  return null;
}
