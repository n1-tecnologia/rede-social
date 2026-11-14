// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.2-14 (D-788, OPEN-10, T-10.2-06) - the gallery's ONE shared refresh of its `Em breve` openings.
 * Real: the island and `useBoundaryRefresh` over the seeded clock. Stubbed: the router. Fake timers.
 *
 * Claims:
 *  1. however many openings the gallery holds there is ONE scheduled refresh, for the soonest, just after it,
 *     then the bounded retry chain while the key is unchanged (never one chain per card);
 *  2. a new `tags` key (a card turned `Pago`) clears the chain and re-arms for the next opening;
 *  3. no opening mounts no timer, and an opening more than 24 hours away is still scheduled (WR-02);
 *  4. the seed makes a wrong device clock schedule correctly.
 */

const refresh = vi.fn();
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { GalleryBoundaryRefresh } = await import('./GalleryBoundaryRefresh');

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(SEED_MS + ms).toISOString();

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(SEED_MS);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GalleryBoundaryRefresh (10.2-14)', () => {
  it('1. several openings, one of them beyond 24 h: ONE refresh for the soonest, then the bounded chain', () => {
    render(
      <GalleryBoundaryRefresh
        openings={[at(5 * HOUR), at(2 * HOUR), at(10 * HOUR), at(30 * HOUR)]}
        serverNow={SEED}
        tags="a:Em breve|b:Em breve|c:Em breve|d:Em breve"
      />,
    );
    // Only the soonest is scheduled: nothing before it, one refresh just after it.
    vi.advanceTimersByTime(2 * HOUR);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The same answer comes back (same key): the chain retries at 2, 5, 15 and 30 s, five refreshes in all.
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(HOUR);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it('2. a card turned Pago (a new tags key) clears the chain and re-arms for the next opening', () => {
    const props = { serverNow: SEED };
    const view = render(
      <GalleryBoundaryRefresh
        {...props}
        openings={[at(HOUR), at(3 * HOUR)]}
        tags="a:Em breve|b:Em breve"
      />,
    );
    vi.advanceTimersByTime(HOUR + 1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The server answered: card a is Pago now, card b is still Em breve (a new seed too).
    const reseeded = at(HOUR + 1_000);
    view.rerender(
      <GalleryBoundaryRefresh
        openings={[at(3 * HOUR)]}
        serverNow={reseeded}
        tags="a:Pago|b:Em breve"
      />,
    );
    // The old chain is gone: its retry would have fired 2 s after the first refresh.
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The next opening refreshes once, just after it.
    vi.advanceTimersByTime(2 * HOUR - 31_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('3. no openings arm no timer', () => {
    render(<GalleryBoundaryRefresh openings={[]} serverNow={SEED} tags="" />);
    expect(vi.getTimerCount()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('3b. an opening 3 days away is still scheduled: the tab left open refreshes once, just after it (WR-02)', () => {
    const DAY = 24 * HOUR;
    render(<GalleryBoundaryRefresh openings={[at(3 * DAY)]} serverNow={SEED} tags="a:Em breve" />);
    // A timer is armed at once (a capped wait that re-evaluates), and nothing refreshes on the way.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3 * DAY);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('4. the seed schedules by the server clock, whatever the device says', () => {
    // The device is a day fast; the server says it is SEED. The opening is one hour after the SEED.
    vi.setSystemTime(SEED_MS + 24 * HOUR);
    render(<GalleryBoundaryRefresh openings={[at(HOUR)]} serverNow={SEED} tags="a:Em breve" />);
    vi.advanceTimersByTime(HOUR);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('5. renders nothing', () => {
    const { container } = render(
      <GalleryBoundaryRefresh openings={[at(HOUR)]} serverNow={SEED} tags="a:Em breve" />,
    );
    expect(container.innerHTML).toBe('');
  });
});
