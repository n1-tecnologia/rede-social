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
