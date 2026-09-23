'use client';

import type { ReactNode } from 'react';

/**
 * RED skeleton (05-06 Task 1) — signature only. The behaviour lands in the GREEN commit.
 */

export interface StoryMediaControls {
  active: boolean;
  paused: boolean;
  muted: boolean;
  onLoad: () => void;
  onError: () => void;
  onCanPlay: () => void;
  onPlaying: () => void;
  onTimeUpdate: (currentSeconds: number, durationSeconds: number) => void;
}

export interface StoryViewerItem {
  id: string;
  mediaKind: 'image' | 'video';
  caption: string;
  authorName: string;
  timeLabel: string;
  avatar: ReactNode;
  media: (controls: StoryMediaControls) => ReactNode;
  actions: ReactNode;
}

export interface StoryViewerLabels {
  dialog: string;
  close: string;
  mute: string;
  unmute: string;
  previous: string;
  next: string;
  play: string;
  mediaError: string;
  retry: string;
  position: (current: number, total: number) => string;
}

export interface StoryViewerProps {
  items: readonly StoryViewerItem[];
  initialIndex?: number;
  labels: StoryViewerLabels;
  onClose: () => void;
  externallyPaused?: boolean;
  now?: () => number;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  autoplayCheckMs?: number;
}

export function StoryViewer(_props: StoryViewerProps) {
  return <div data-testid="story-viewer" />;
}
