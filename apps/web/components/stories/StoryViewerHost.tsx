'use client';

import type { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import type {
  StoryViewerAuthorView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';

/**
 * RED skeleton (05-06 Task 3) — signature only. The behaviour lands in the GREEN commit.
 */

export type StoryViewerHostProps = {
  items: readonly StoryViewerItemView[];
  initialIndex?: number;
  author: StoryViewerAuthorView;
  labels: StoryViewerLabelsView;
  onLike: typeof likeStoryAction;
  onUnlike: typeof unlikeStoryAction;
  onClose?: () => void;
  closeHref?: string;
};

export function StoryViewerHost(_props: StoryViewerHostProps) {
  return <div data-testid="story-viewer-host" />;
}
