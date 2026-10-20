'use client';

import type { SocialListItem } from '@rede-social/module-social/contracts';

/** RED stub (09-10 Task 3): replaced by the GREEN commit. */
export interface SocialListProps {
  kind: 'followers' | 'following';
  initialItems: SocialListItem[];
  initialCursor: string | null;
  initialError?: boolean;
}

export function SocialList(_props: SocialListProps) {
  return null;
}
