'use client';

import type { StoryCircleVariant } from './StoryCircle';

/**
 * RED SKELETON — signature only (05-05 Task 1). See the note in `StoryCircle.tsx`.
 *
 * It renders an unconditional node on purpose: UI-D-26's whole claim is that a member with no
 * active story gets NO node at all, so the skeleton has to contradict exactly that to make the
 * target assertion fail for the right reason.
 */

export interface StoryCircleItem {
  id: string;
  label: string;
  actionLabel: string;
  assetId: string | null;
  variantWidths: readonly number[];
}

export interface StoryStripOwnCircle {
  href: string;
  label: string;
  actionLabel: string;
  avatarUrl: string | null;
}

export interface StoriesStripProps {
  items: readonly StoryCircleItem[];
  ringVariant: Exclude<StoryCircleVariant, 'own'>;
  regionLabel: string;
  loading?: boolean;
  own?: StoryStripOwnCircle;
  onOpen?: (index: number) => void;
}

export function StoriesStrip(_props: StoriesStripProps) {
  return <div />;
}
