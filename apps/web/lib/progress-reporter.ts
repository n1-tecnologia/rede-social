/**
 * The lesson player's progress cadence (08.5-08, D-427, UI-D-433, R-Pattern 6, R-Pitfall 10): a
 * pure throttle between the video element's events and the progress write, so the cadence is
 * unit-tested with fake timers and `VideoPlayer` itself stays cadence-free.
 *
 *  - `tick` (every `timeupdate`, about four a second) sends **at most once per 15-second window**,
 *    measured by the injected clock: the first tick sends, the next one sends only when
 *    `PROGRESS_TICK_MS` have passed since the last send of ANY reason;
 *  - `pause` and `ended` always send at once, and open a new window;
 *  - every position leaves as an integer ≥ 0 (a `NaN`, a negative or a fraction never does).
 *
 * The reporter decides NOTHING about completion: it forwards a position and the SERVER compares it
 * with its own ready duration (`ceil(0.9 × duration)`); the client's clock is never trusted. It also
 * keeps the last position it saw (sent or not), which the `pagehide` beacon reads, so the member's
 * place is kept even when the page dies between two ticks.
 *
 * No timer is ever scheduled: a dropped tick is simply followed by the next one (a failed write is
 * dropped silently, UI-D-433), so nothing leaks when the player unmounts.
 */

/** One progress write every 15 seconds while the video plays (D-427, Claude's Discretion cadence). */
export const PROGRESS_TICK_MS = 15000;

export type ProgressReason = 'tick' | 'pause' | 'ended';

export interface ProgressReporterOptions {
  /** The write itself; the reporter never awaits it and never retries it. */
  send: (positionSeconds: number, reason: ProgressReason) => void;
  /** The clock, in milliseconds (`Date.now` in the player, a fake one in tests). */
  now: () => number;
  /** The window; `PROGRESS_TICK_MS` unless a test says otherwise. */
  intervalMs?: number;
}

export interface ProgressReporter {
  /** Feed one element event: the position in seconds and why it fired. */
  onProgress: (positionSeconds: number, reason: ProgressReason) => void;
  /** The last position seen (sent or not), or null before the first event. */
  lastPosition: () => number | null;
}

/** A position as the API takes it: an integer ≥ 0. */
export function wholePosition(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function createProgressReporter({
  send,
  now,
  intervalMs = PROGRESS_TICK_MS,
}: ProgressReporterOptions): ProgressReporter {
  let lastSentAt: number | null = null;
  let last: number | null = null;

  return {
    onProgress(positionSeconds, reason) {
      const position = wholePosition(positionSeconds);
      last = position;
      const at = now();
      if (reason === 'tick' && lastSentAt !== null && at - lastSentAt < intervalMs) return;
      lastSentAt = at;
      send(position, reason);
    },
    lastPosition: () => last,
  };
}
