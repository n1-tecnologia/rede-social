/**
 * A small in-process attempt limiter for the one route that can end an account (13-13, T-13-29).
 *
 * The repository has no request limiter (the only `limiter.ts` paces OUTBOUND Management API calls), so this
 * is the first: a sliding window of `max` attempts per key, held in memory. It is per process on purpose:
 * Cloud Run runs a few instances, so the effective ceiling is `max` times the instance count, which is still
 * a hard stop on password guessing through this route (the password grant itself is rate limited by Auth too).
 * The clock is injected so a test moves time without sleeping; the default clock is monotonic.
 *
 * `consume(keys)` is all-or-nothing: when ANY key is already at the ceiling nothing is recorded and the call
 * is refused; otherwise one attempt is recorded on EVERY key. The key map is bounded, so a flood of distinct
 * addresses cannot grow it without limit (the oldest key is dropped first).
 */

export type AttemptLimiterOptions = {
  max: number;
  windowMs: number;
  /** Most keys held at once (default 10,000). */
  maxKeys?: number;
  now?: () => number;
};

export type AttemptLimiter = {
  /** Records one attempt on every key and returns true, or records nothing and returns false. */
  consume(keys: readonly string[]): boolean;
  /** Forgets every attempt (tests). */
  reset(): void;
};

export function createAttemptLimiter(options: AttemptLimiterOptions): AttemptLimiter {
  const { max, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const now = options.now ?? (() => performance.now());
  if (!Number.isInteger(max) || max < 1) throw new TypeError('attempt limiter: max must be >= 1');
  const stamps = new Map<string, number[]>();

  function live(key: string, t: number): number[] {
    const list = stamps.get(key);
    if (!list) return [];
    const kept = list.filter((stamp) => stamp + windowMs > t);
    if (kept.length === 0) stamps.delete(key);
    else if (kept.length !== list.length) stamps.set(key, kept);
    return kept;
  }

  return {
    consume(keys) {
      const t = now();
      const unique = [...new Set(keys)];
      for (const key of unique) {
        if (live(key, t).length >= max) return false;
      }
      for (const key of unique) {
        const list = live(key, t);
        list.push(t);
        stamps.delete(key);
        // Re-inserting keeps the Map in least-recently-used order for the bound below.
        stamps.set(key, list);
      }
      while (stamps.size > maxKeys) {
        const oldest = stamps.keys().next();
        if (oldest.done) break;
        stamps.delete(oldest.value);
      }
      return true;
    },
    reset() {
      stamps.clear();
    },
  };
}

/** 5 attempts in 15 minutes, per member and per network address (T-13-29). */
export const DELETION_ATTEMPTS = 5;
export const DELETION_WINDOW_MS = 15 * 60_000;

export const accountDeletionLimiter: AttemptLimiter = createAttemptLimiter({
  max: DELETION_ATTEMPTS,
  windowMs: DELETION_WINDOW_MS,
});

/** The limiter keys of one attempt: always the member, plus the address when the web hop sent one. */
export function deletionLimiterKeys(input: {
  tenantId: string;
  userId: string;
  ip: string | null;
}): string[] {
  const keys = [`user:${input.tenantId}:${input.userId}`];
  const ip = input.ip?.trim();
  if (ip) keys.push(`ip:${ip.slice(0, 64)}`);
  return keys;
}
