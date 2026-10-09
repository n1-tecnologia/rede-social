import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoubleTapHeart } from '../src/index';

/**
 * The gesture window (300 ms) and the burst life (900 ms) are driven with fake timers — vitest fakes
 * `Date.now()` along with the timer queue, so the tap window is deterministic instead of a real wait.
 * `matchMedia` is stubbed the way the package's other suites stub browser APIs, because happy-dom's
 * implementation always reports `matches: false` and the reduced-motion branch needs both answers.
 */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

/** Two `pointerup`s inside the window, with the gap the caller asks for. */
function tapTwice(target: Element, gapMs: number) {
  fireEvent.pointerUp(target);
  act(() => {
    vi.advanceTimersByTime(gapMs);
  });
  fireEvent.pointerUp(target);
}

const burst = () => document.querySelector('[data-double-tap-burst]');

beforeEach(() => {
  stubReducedMotion(false);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DoubleTapHeart — the gesture window', () => {
  it('fires onDoubleTap exactly once for two taps inside the 300 ms window and renders the burst', () => {
    const onDoubleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 120);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(burst()).not.toBeNull();
  });

  it('does not fire for two taps 400 ms apart', () => {
    const onDoubleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 400);
    expect(onDoubleTap).not.toHaveBeenCalled();
    expect(burst()).toBeNull();
  });

  it('does not fire for a single tap and lets the child keep its own click handler', () => {
    const onDoubleTap = vi.fn();
    const onChildClick = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap}>
        <button type="button" onClick={onChildClick}>
          abrir
        </button>
      </DoubleTapHeart>,
    );
    const child = screen.getByRole('button', { name: 'abrir' });
    fireEvent.pointerUp(child);
    fireEvent.click(child);
    expect(onDoubleTap).not.toHaveBeenCalled();
    expect(onChildClick).toHaveBeenCalledTimes(1);
    expect(burst()).toBeNull();
  });

  it('renders children unchanged and never bursts without an onDoubleTap handler', () => {
    render(
      <DoubleTapHeart>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 100);
    expect(screen.getByTestId('media')).toBeInTheDocument();
    expect(burst()).toBeNull();
  });
});

describe('DoubleTapHeart — the burst overlay', () => {
  it('is decorative and never swallows a tap meant for the child', () => {
    render(
      <DoubleTapHeart onDoubleTap={vi.fn()}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 100);
    const overlay = burst();
    expect(overlay?.className).toContain('pointer-events-none');
    expect(overlay).toHaveAttribute('aria-hidden');
  });

  it('is removed after its 900 ms life', async () => {
    render(
      <DoubleTapHeart onDoubleTap={vi.fn()}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 100);
    expect(burst()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(899);
    });
    expect(burst()).not.toBeNull();

    // AnimatePresence unmounts on a microtask once the (skipped) exit settles
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(burst()).toBeNull();
  });

  it('carries the like token on the glyph, never a hex or a legacy prototype class', () => {
    render(
      <DoubleTapHeart onDoubleTap={vi.fn()}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 100);
    const glyph = burst()?.querySelector('svg');
    expect(glyph?.getAttribute('class')).toContain('text-like');
    expect(glyph?.getAttribute('class')).toContain('fill-like');
    expect(glyph?.getAttribute('class')).not.toContain('text-red-500');
    expect(glyph?.getAttribute('width')).toBe('80');
  });
});

describe('DoubleTapHeart — reduced motion', () => {
  it('still renders the burst but drops the scale keyframes for an opacity-only fade', () => {
    stubReducedMotion(true);
    render(
      <DoubleTapHeart onDoubleTap={vi.fn()}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 100);
    expect(burst()).not.toBeNull();
    expect(burst()).toHaveAttribute('data-double-tap-burst', 'opacity');
  });

  it('uses the spring burst when reduced motion is not requested', () => {
    render(
      <DoubleTapHeart onDoubleTap={vi.fn()}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapTwice(screen.getByTestId('media'), 100);
    expect(burst()).toHaveAttribute('data-double-tap-burst', 'spring');
  });
});

/**
 * UI-D-86 / D-124 — the two OPT-IN props Reels needs. A pager page is a tap surface where a single
 * tap pauses and a double tap likes, and where a swipe must never read as either. The props are
 * opt-in so the feed card (which passes neither) keeps its byte-identical path: the last case pins
 * that a caller without them never even schedules a timer.
 */
describe('DoubleTapHeart — opt-in single tap and tap slop (UI-D-86, D-124)', () => {
  /** One pointerdown + pointerup pair, the pointerup `dx` pixels to the right of the pointerdown. */
  function tapWithTravel(target: Element, dx = 0) {
    fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 100 + dx, clientY: 100, pointerId: 1 });
  }

  it('calls onSingleTap once when the 300 ms window closes with no second tap, and never onDoubleTap', () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap} onSingleTap={onSingleTap}>
        <div data-testid="media">video</div>
      </DoubleTapHeart>,
    );
    tapWithTravel(screen.getByTestId('media'));
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onSingleTap).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSingleTap).toHaveBeenCalledTimes(1);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('two taps inside the window call onDoubleTap once and cancel the pending single tap', () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap} onSingleTap={onSingleTap}>
        <div data-testid="media">video</div>
      </DoubleTapHeart>,
    );
    const media = screen.getByTestId('media');
    tapWithTravel(media);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    tapWithTravel(media);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  it('with tapSlopPx={10}, a pointerup 11 px from its pointerdown is no tap at all', () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap} onSingleTap={onSingleTap} tapSlopPx={10}>
        <div data-testid="media">video</div>
      </DoubleTapHeart>,
    );
    const media = screen.getByTestId('media');
    // two quick swipes: neither is a tap, so they never pair into a like
    tapWithTravel(media, 11);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    tapWithTravel(media, 11);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSingleTap).not.toHaveBeenCalled();
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('with tapSlopPx={10}, a pointerup 9 px from its pointerdown still counts as a tap', () => {
    const onSingleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={vi.fn()} onSingleTap={onSingleTap} tapSlopPx={10}>
        <div data-testid="media">video</div>
      </DoubleTapHeart>,
    );
    tapWithTravel(screen.getByTestId('media'), 9);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onSingleTap).toHaveBeenCalledTimes(1);
  });

  it('D-124: without the new props a single tap schedules no timer (the feed path is unchanged)', () => {
    const onDoubleTap = vi.fn();
    render(
      <DoubleTapHeart onDoubleTap={onDoubleTap}>
        <div data-testid="media">foto</div>
      </DoubleTapHeart>,
    );
    tapWithTravel(screen.getByTestId('media'), 40);
    expect(vi.getTimerCount()).toBe(0);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-09 (item 12) — the OPT-IN hold the video surfaces share with the story viewer: a press
 * held still for 200 ms pauses on that frame, its release resumes, and that release is never a tap.
 */
describe('DoubleTapHeart — opt-in hold (item 12)', () => {
  const at = (x: number, extra: Record<string, unknown> = {}) => ({
    clientX: x,
    clientY: 100,
    pointerId: 1,
    ...extra,
  });

  function surface(props: Partial<Parameters<typeof DoubleTapHeart>[0]> = {}) {
    const handlers = {
      onDoubleTap: vi.fn(),
      onSingleTap: vi.fn(),
      onHoldStart: vi.fn(),
      onHoldEnd: vi.fn(),
    };
    const view = render(
      <DoubleTapHeart {...handlers} tapSlopPx={10} {...props}>
        <div data-testid="media">video</div>
      </DoubleTapHeart>,
    );
    return { ...handlers, ...view, media: screen.getByTestId('media') };
  }

  function wait(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('a press held still for 200 ms holds once; its release ends the hold and is no tap', () => {
    const { media, onHoldStart, onHoldEnd, onSingleTap, onDoubleTap } = surface();
    fireEvent.pointerDown(media, at(100));
    wait(199);
    expect(onHoldStart).not.toHaveBeenCalled();
    wait(1);
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    expect(onHoldEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(media, at(100));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    wait(1000);
    expect(onSingleTap).not.toHaveBeenCalled();
    expect(onDoubleTap).not.toHaveBeenCalled();
    expect(burst()).toBeNull();
    expect(onHoldStart).toHaveBeenCalledTimes(1);
  });

  it('a quick tap is still a single tap, and never a hold', () => {
    const { media, onHoldStart, onHoldEnd, onSingleTap } = surface();
    fireEvent.pointerDown(media, at(100));
    wait(120);
    fireEvent.pointerUp(media, at(100));
    wait(300);
    expect(onSingleTap).toHaveBeenCalledTimes(1);
    expect(onHoldStart).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it('a quick double tap still likes, and never holds', () => {
    const { media, onHoldStart, onDoubleTap, onSingleTap } = surface();
    for (let i = 0; i < 2; i += 1) {
      fireEvent.pointerDown(media, at(100));
      wait(60);
      fireEvent.pointerUp(media, at(100));
      wait(60);
    }
    wait(1000);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onSingleTap).not.toHaveBeenCalled();
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('a press that drifts past the slop before 200 ms is a scroll: no hold, no tap', () => {
    const { media, onHoldStart, onHoldEnd, onSingleTap } = surface();
    fireEvent.pointerDown(media, at(100));
    fireEvent.pointerMove(media, at(111));
    wait(500);
    fireEvent.pointerUp(media, at(111));
    wait(500);
    expect(onHoldStart).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  it('a drift within the slop still holds', () => {
    const { media, onHoldStart } = surface();
    fireEvent.pointerDown(media, at(100));
    fireEvent.pointerMove(media, at(109));
    wait(200);
    expect(onHoldStart).toHaveBeenCalledTimes(1);
  });

  it('pointercancel (a scroll taking over) ends the hold, and drops a pending one', () => {
    const held = surface();
    fireEvent.pointerDown(held.media, at(100));
    wait(200);
    fireEvent.pointerCancel(held.media, at(100));
    expect(held.onHoldEnd).toHaveBeenCalledTimes(1);
    held.unmount();

    const pending = surface();
    fireEvent.pointerDown(pending.media, at(100));
    wait(100);
    fireEvent.pointerCancel(pending.media, at(100));
    wait(500);
    expect(pending.onHoldStart).not.toHaveBeenCalled();
    expect(pending.onHoldEnd).not.toHaveBeenCalled();
  });

  it('a hold forgets the tap before it: the next tap is a single tap, never half of a like', () => {
    const { media, onSingleTap, onDoubleTap, onHoldEnd } = surface();
    fireEvent.pointerDown(media, at(100));
    fireEvent.pointerUp(media, at(100));
    wait(50);
    fireEvent.pointerDown(media, at(100));
    wait(200);
    fireEvent.pointerUp(media, at(100));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    wait(50);
    fireEvent.pointerDown(media, at(100));
    fireEvent.pointerUp(media, at(100));
    wait(1000);
    expect(onDoubleTap).not.toHaveBeenCalled();
    expect(onSingleTap).toHaveBeenCalledTimes(1);
  });

  it('a second finger never ends the hold, and lifting it is no tap', () => {
    const { media, onHoldEnd, onSingleTap } = surface();
    fireEvent.pointerDown(media, at(100));
    wait(200);
    fireEvent.pointerDown(media, at(200, { pointerId: 2 }));
    fireEvent.pointerUp(media, at(200, { pointerId: 2 }));
    wait(500);
    expect(onHoldEnd).not.toHaveBeenCalled();
    expect(onSingleTap).not.toHaveBeenCalled();
    fireEvent.pointerUp(media, at(100));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it('a second finger while the first is still deciding makes no hold', () => {
    const { media, onHoldStart } = surface();
    fireEvent.pointerDown(media, at(100));
    wait(100);
    fireEvent.pointerDown(media, at(200, { pointerId: 2 }));
    wait(500);
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('a mouse that leaves the surface while holding ends the hold', () => {
    const { media, onHoldEnd } = surface();
    fireEvent.pointerDown(media, at(100, { pointerType: 'mouse' }));
    wait(200);
    fireEvent.pointerLeave(media, at(100, { pointerType: 'mouse' }));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it('a surface that unmounts mid-hold still ends it', () => {
    const { media, onHoldEnd, unmount } = surface();
    fireEvent.pointerDown(media, at(100));
    wait(200);
    unmount();
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it('only the main button holds', () => {
    const { media, onHoldStart } = surface();
    fireEvent.pointerDown(media, at(100, { pointerType: 'mouse', button: 2 }));
    wait(500);
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('holdMs moves the threshold', () => {
    const { media, onHoldStart } = surface({ holdMs: 500 });
    fireEvent.pointerDown(media, at(100));
    wait(499);
    expect(onHoldStart).not.toHaveBeenCalled();
    wait(1);
    expect(onHoldStart).toHaveBeenCalledTimes(1);
  });

  it('without the hold callbacks a press times nothing (a Reels neighbour, the feed photos)', () => {
    render(
      <DoubleTapHeart tapSlopPx={10}>
        <div data-testid="media">video</div>
      </DoubleTapHeart>,
    );
    fireEvent.pointerDown(screen.getByTestId('media'), at(100));
    expect(vi.getTimerCount()).toBe(0);
  });
});
