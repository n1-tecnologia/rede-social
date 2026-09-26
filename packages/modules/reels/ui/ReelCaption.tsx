'use client';

import type { ReactNode } from 'react';

/**
 * RED STUB (05.3-06 Task 2). Deliberately inert: it renders nothing so the failing cases in
 * `tests/reel-caption.test.tsx` fail on their assertions, not on a missing module. The GREEN commit
 * replaces this file in full with the UI-D-88 caption block.
 */
export type ReelCaptionProps = {
  author: { name: string; href: string };
  community: { name: string; href: string; ariaLabel: string } | null;
  children?: ReactNode;
  moreLabel: string;
  lessLabel: string;
  expanded: boolean;
  onExpandedChange(next: boolean): void;
};

export function ReelCaption(_props: ReelCaptionProps) {
  return null;
}
