'use client';

/**
 * RED STUB (05.3-06 Task 1). Deliberately inert: it renders nothing for any input so the failing
 * cases in `tests/reels-lanes.test.tsx` fail on their assertions, not on a missing module. The
 * GREEN commit replaces this file in full with the UI-D-84 tablist.
 */
export type ReelsLane = { key: string; label: string; tabId: string };

export type ReelsLanesProps = {
  lanes: ReelsLane[];
  activeKey: string;
  onSelect(key: string): void;
  label: string;
  panelId: string;
};

export function ReelsLanes(_props: ReelsLanesProps) {
  return null;
}
