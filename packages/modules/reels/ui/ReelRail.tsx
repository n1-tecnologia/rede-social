'use client';

import type { ReactNode } from 'react';

/**
 * RED STUB (05.3-06 Task 2). Deliberately inert: it renders nothing so the failing cases in
 * `tests/reel-rail.test.tsx` fail on their assertions, not on a missing module. The GREEN commit
 * replaces this file in full with the UI-D-87 rail.
 */
export type ReelRailProps = {
  author: { href: string; avatarUrl: string | null; name: string; label: string };
  like: ReactNode;
  likeCount: string | null;
  commentLabel: string;
  commentCount: string | null;
  onComment(): void;
  shareLabel: string;
  onShare?: () => void;
};

export function ReelRail(_props: ReelRailProps) {
  return null;
}
