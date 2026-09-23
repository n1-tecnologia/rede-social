'use client';

/**
 * RED skeleton (05-06 Task 1) — signature only. The behaviour lands in the GREEN commit.
 */

export interface StoryProgressBarsProps {
  items: readonly { id: string }[];
  index: number;
  progress: number;
}

export function StoryProgressBars(_props: StoryProgressBarsProps) {
  return <div data-testid="story-progress-bars" />;
}
