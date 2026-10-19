import type { OwnerContentReady } from '@rede-social/module-dashboard/contracts';
import type { ReactNode } from 'react';
import type { ContentWho, OwnerContentView } from '@/lib/owner-content-view';

export interface OwnerContentPeopleProps {
  view: OwnerContentView & { postId: string; who: ContentWho };
  answer: OwnerContentReady;
  timeZone: string;
  /** The publication's detail (an id the API does not know falls back to it). */
  fallback: ReactNode;
}

/**
 * INERT STUB (08.7-07 Task 1): who liked and who commented are rewired to
 * `GET …/content/items/{itemId}/people/{who}` in Task 2. Until then the detail above renders.
 */
export async function OwnerContentPeople({
  fallback,
}: OwnerContentPeopleProps): Promise<ReactNode> {
  return fallback;
}

/**
 * INERT STUB (08.7-07 Task 1): the interactions are rewired to `GET …/content/interactions` in
 * Task 2. Until then the list is empty.
 */
export async function ContentInteractions(_props: {
  view: OwnerContentView;
  answer: OwnerContentReady;
  timeZone: string;
}): Promise<ReactNode> {
  return null;
}

/** INERT STUB (08.7-07 Task 2 RED): the people list's view, drawn in Task 2's GREEN. */
export function OwnerContentPeopleView(_props: Record<string, unknown>): ReactNode {
  return null;
}

/** INERT STUB (08.7-07 Task 2 RED): the interactions' view, drawn in Task 2's GREEN. */
export function ContentInteractionsView(_props: Record<string, unknown>): ReactNode {
  return null;
}
