import type { OwnerContentReady } from '@rede-social/module-dashboard/contracts';
import type { ReactNode } from 'react';
import type { OwnerContentView } from '@/lib/owner-content-view';

export interface OwnerContentRepliesProps {
  view: OwnerContentView;
  answer: OwnerContentReady;
  timeZone: string;
}

/**
 * INERT STUB (08.7-07 Task 1): the comments waiting for the team are rewired to
 * `GET …/content/unanswered` in Task 2. Until then the screen is empty.
 */
export async function OwnerContentReplies(_props: OwnerContentRepliesProps): Promise<ReactNode> {
  return null;
}

/** INERT STUB (08.7-07 Task 2 RED): the unanswered comments' view, drawn in Task 2's GREEN. */
export function OwnerContentRepliesView(_props: Record<string, unknown>): ReactNode {
  return null;
}
