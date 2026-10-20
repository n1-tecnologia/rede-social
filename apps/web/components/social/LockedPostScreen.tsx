'use client';

import type { PostLockedAuthor } from '@rede-social/module-feed/contracts';

/** RED stub (09-11 Task 1): inert until the GREEN commit. */
export interface LockedPostScreenProps {
  author: PostLockedAuthor;
  postId: string;
  title: string;
  backHref: string;
  backLabel: string;
  heading: string;
  body: string;
  profileLabel: string;
}

export function LockedPostScreen(_props: LockedPostScreenProps) {
  return null;
}
