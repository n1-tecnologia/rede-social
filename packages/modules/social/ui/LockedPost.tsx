import type { ReactNode } from 'react';

/**
 * RED stub (09-11 Task 1): inert until the GREEN commit. It renders an empty box so the tests fail on
 * assertions about the card, not on a missing import.
 */
export interface LockedPostProps {
  heading: string;
  body: string;
  avatar: ReactNode;
  action: ReactNode;
}

export function LockedPost(_props: LockedPostProps) {
  return <div />;
}
