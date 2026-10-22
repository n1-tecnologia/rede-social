/**
 * Client-side request limiter for the Management API (09.2-12, DBT-20, Pitfall 14). The platform limit is
 * 120 requests per minute per user per endpoint; the process stays at `perMinute` (100) in a ROLLING window
 * across every caller, and a 429 observed by one call pauses all the others for the same reset window.
 *
 * Admission is FIFO and serialised: a waiter is admitted only after the one before it, so a burst cannot
 * overtake and the check-and-record of a slot is never interleaved. The clock and the sleep are injected;
 * the default clock is monotonic (`performance.now`), so a wall-clock adjustment can never open a window.
 */

export type Limiter = {
  /** Waits for a slot (and for any shared pause), then runs `fn`. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Holds EVERY waiter until the clock reaches `untilMs` (the shared 429 window). Only ever extends. */
  pause(untilMs: number): void;
  /** The limiter's own clock, so a caller computes `untilMs` on the same scale. */
  now(): number;
  /** The injected sleep, so a caller waits on the same scale. */
  sleep(ms: number): Promise<void>;
};

export type LimiterOptions = {
  perMinute?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const monotonicNow = (): number => performance.now();

export function createLimiter(options: LimiterOptions = {}): Limiter {
  const perMinute = options.perMinute ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? monotonicNow;
  const sleep = options.sleep ?? realSleep;
  if (!Number.isInteger(perMinute) || perMinute < 1) {
    throw new TypeError('limiter: perMinute must be a positive integer');
  }

  /** Admission times of the calls inside the rolling window, ascending. */
  const stamps: number[] = [];
  let pausedUntil = 0;
  let tail: Promise<void> = Promise.resolve();

  async function admit(): Promise<void> {
    for (;;) {
      const t = now();
      if (t < pausedUntil) {
        await sleep(pausedUntil - t);
        continue;
      }
      // A stamp leaves the window when `windowMs` have fully elapsed since it was taken.
      while (stamps.length > 0 && (stamps[0] as number) + windowMs <= t) stamps.shift();
      if (stamps.length < perMinute) {
        stamps.push(t);
        return;
      }
      await sleep((stamps[0] as number) + windowMs - t);
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const mine = tail.then(admit);
      // The chain must survive a failed admission (it cannot fail today, but a throwing injected sleep
      // must not wedge every later caller).
      tail = mine.catch(() => undefined);
      await mine;
      return fn();
    },
    pause(untilMs: number): void {
      if (untilMs > pausedUntil) pausedUntil = untilMs;
    },
    now,
    sleep,
  };
}

let processLimiter: Limiter | undefined;

/** The one limiter every default-configured provider in this process shares (DBT-20, P43). */
export function defaultProcessLimiter(): Limiter {
  processLimiter ??= createLimiter();
  return processLimiter;
}
