import type { OwnerContentReady } from '@rede-social/module-dashboard/contracts';
import type { ReactNode } from 'react';
import type { OwnerContentView } from '@/lib/owner-content-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';

export interface OwnerContentPostDetailProps {
  view: OwnerContentView & { postId: string };
  answer: OwnerContentReady;
  flags: OwnerPanelFlags;
  timeZone: string;
  /** The list the publication was opened from (an id the API does not know falls back to it). */
  fallback: ReactNode;
}

/**
 * INERT STUB (08.7-07 Task 1): the post detail is rewired to `GET …/content/items/{itemId}` in
 * Task 2. Until then it renders the list it was opened from.
 */
export async function OwnerContentPostDetail({
  fallback,
}: OwnerContentPostDetailProps): Promise<ReactNode> {
  return fallback;
}
