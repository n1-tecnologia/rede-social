/**
 * The device clock of the countdown stack, read in ONE place (Phase 10.2, OPEN-21, D-788).
 *
 * The device clock is untrusted: it can be a day off, or in another year. The server sends its own
 * instant as a seed (`serverNow` of the read models, plan 07), and this module turns it into ONE offset
 * against the device clock, taken when the clock is built (in the effect, after hydration). `now()` is
 * the device time plus that offset, the estimate of the server time. By construction the estimate equals
 * the seed at the instant the effect runs, whatever the AGE of the seed, so it lags the true server time
 * by the age of the payload at that instant. For a payload rendered moments before hydration that is the
 * render-to-hydration latency; for a payload older than hydration (a client router cache served on a back
 * or forward navigation, or a service worker response) it can be minutes. Either way the lag is in the
 * safe direction: the count shows too much time and reaches zero late, never early (EP-25), and it never
 * reveals a link, which only the server sends. A re-seed (a `pageshow` with `persisted`, a tab hidden over
 * a minute) fixes it; an in-app navigation that reuses a stale payload is not covered by either (ledger
 * row P18 of `10.2-MANUAL-PROOFS.md`).
 *
 * This is the only file of the stack (`useCountdownClock`, `useBoundaryRefresh`) that reads the device
 * clock; the others call `serverClock()` and a grep checks that. With no seed the offset is zero and
 * `seeded` is false: only the unseeded boundary refresh of Phase 10.1 uses that device time, as it
 * always did, and the countdown hook never counts from it.
 */

export interface ServerClock {
  /** True when the seed parsed; false means the offset is zero and `now()` is the bare device time. */
  seeded: boolean;
  /** The seed minus the device time at creation; zero when not seeded. */
  offsetMs: number;
  /** The estimate of the server time: the device time plus the offset. */
  now(): number;
  /** The bare device time, for spans measured on one clock (how long a tab stayed hidden). */
  deviceNow(): number;
}

/** Builds the clock from a server seed (an ISO instant) read against the device clock right now. */
export function serverClock(seedIso?: string | null): ServerClock {
  const deviceAtCreation = Date.now();
  const seedMs = seedIso ? Date.parse(seedIso) : Number.NaN;
  const seeded = Number.isFinite(seedMs);
  const offsetMs = seeded ? seedMs - deviceAtCreation : 0;
  return {
    seeded,
    offsetMs,
    now: () => Date.now() + offsetMs,
    deviceNow: () => Date.now(),
  };
}
