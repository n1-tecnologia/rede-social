'use client';

import type { MediaPlayback } from '@tria/contracts/media';

/**
 * INERT RED STUB (05.3-07 Task 1, TDD RED commit). It declares the published contract so the test
 * file compiles, and deliberately renders only the empty frame: no vendor element, no controller, no
 * listeners. The GREEN commit replaces this file entirely.
 */
export interface ReelVideoController {
  start(wantSound: boolean): void;
  pause(): void;
  resume(wantSound: boolean): void;
  setMuted(muted: boolean): void;
}

export interface ReelVideoProps {
  postId: string;
  playback: MediaPlayback | null;
  width: number | null;
  height: number | null;
  current: boolean;
  onController(postId: string, controller: ReelVideoController | null): void;
  onPlaying(postId: string): void;
  onWaiting(postId: string): void;
  onError(postId: string): void;
  onBlocked(postId: string): void;
  onSoundRefused(): void;
}

export function ReelVideo(_props: ReelVideoProps) {
  return <div className="absolute inset-0 bg-black" data-testid="reel-video" />;
}
