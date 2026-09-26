import type { ReactNode } from 'react';

/**
 * RED STUB (05.3-05 Task 2) — deliberately inert so `reels-pager.test.tsx` fails on its assertions
 * rather than on a missing module: it renders the two test hooks and nothing else, and calls no
 * callback. Replaced in full by the GREEN commit.
 */
export interface ReelsPagerItem {
  id: string;
  authorName: string;
}

export interface ReelsPagerLabels {
  play: string;
  pause: string;
  previous: string;
  next: string;
  position: string;
}

export interface ReelsPagerProps {
  items: readonly ReelsPagerItem[];
  index: number;
  hasMore: boolean;
  onActivate: (next: number) => void;
  onIndexChange: (next: number) => void;
  onEndReached: () => void;
  onLaneStep?: (delta: 1 | -1) => void;
  renderMedia: (item: ReelsPagerItem, state: { current: boolean }) => ReactNode;
  renderOverlay: (item: ReelsPagerItem, state: { current: boolean }) => ReactNode;
  top: ReactNode;
  paused: boolean;
  showPlayBadge: boolean;
  showSpinner: boolean;
  onTogglePause: () => void;
  onDoubleTap: () => void;
  onToggleSound: () => void;
  gesturesDisabled: boolean;
  instantKey: string;
  panelId?: string;
  labelledBy?: string;
  labels: ReelsPagerLabels;
}

export function ReelsPager(_props: ReelsPagerProps) {
  return (
    <div data-testid="reels-pager">
      <div data-testid="reels-stack" />
      <div data-testid="reels-track" />
    </div>
  );
}
