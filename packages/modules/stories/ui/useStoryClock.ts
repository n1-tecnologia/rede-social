'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * RED skeleton (05-06 Task 1) — signature only. The behaviour lands in the GREEN commit.
 */

export type StoryClockNow = () => number;
export type StoryClockRequestFrame = (callback: (timestamp: number) => void) => number;
export type StoryClockCancelFrame = (handle: number) => void;

export interface UseStoryClockOptions {
  durationMs: number;
  paused: boolean;
  itemKey: string | number;
  onComplete: () => void;
  now?: StoryClockNow;
  requestFrame?: StoryClockRequestFrame;
  cancelFrame?: StoryClockCancelFrame;
}

export interface StoryClock {
  progress: number;
  elapsedMs: number;
  restart: () => void;
}

export function useStoryClock(options: UseStoryClockOptions): StoryClock {
  const [state] = useState({ progress: 0, elapsedMs: 0 });
  const kept = useRef(options);
  kept.current = options;
  useEffect(() => {
    const handle = requestAnimationFrame(() => {});
    return () => cancelAnimationFrame(handle);
  }, []);
  return { progress: state.progress, elapsedMs: state.elapsedMs, restart: () => {} };
}
