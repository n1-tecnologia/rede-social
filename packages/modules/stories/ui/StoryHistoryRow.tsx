'use client';

import type { ReactNode } from 'react';

/**
 * RED SKELETON (05-08 Task 3) — signature-only and deliberately wrong. The symbols must EXIST so
 * the loader resolves (an absent export crashes it, which is `INVALID_RED`) while none of the
 * behaviour does.
 */

export interface StoryHistoryRowProps {
  thumbnailAssetId: string | null;
  thumbnailVariantWidths: readonly number[];
  thumbnailAlt: string;
  caption: string;
  captionMuted?: boolean;
  meta: string;
  note?: string;
  status?: { tone: 'warning' | 'danger'; label: string };
  pinned?: { count: number; label: string };
  actionLabel: string;
  onOpen: () => void;
}

export function StoryHistoryRow(_props: StoryHistoryRowProps): ReactNode {
  return <div data-testid="story-history-row" />;
}
