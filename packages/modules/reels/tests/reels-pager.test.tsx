// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REELS_SWIPE_THRESHOLD_PX,
  REELS_WHEEL_LOCK_MS,
  REELS_WHEEL_THRESHOLD_PX,
} from '../contracts/index';
import {
  ReelsPager,
  type ReelsPagerItem,
  type ReelsPagerLabels,
  type ReelsPagerProps,
} from '../ui/ReelsPager';

/**
 * REELS-05 / D-117 / D-125 / D-127 / D-128 / D-132 — the Reels pager, asserted as behaviour.
 *
 * The claims worth a test are the ones a later edit could break silently:
 *
 *  1. **An INDEX pager with one gesture grammar.** The dominant axis decides at 60 px: vertical
 *     pages, horizontal steps the lane, and one gesture never does both. `pointercancel` resets
 *     without navigating (the prototype mapped it to `up`).
 *  2. **The WebKit rule.** Every index change calls `onActivate(next)` BEFORE `onIndexChange(next)`,
 *     synchronously inside the event, so the host can start the next video inside the gesture.
 *  3. **Single tap, double tap and swipe are three different things** (UI-D-86): a single tap pauses
 *     once the 300 ms window closes, a double tap likes and never pauses, a swipe is neither, and a
 *     tap on the rail, caption or lane row reaches neither.
 *  4. **Only ±1 is mounted; neighbours are inert** (UI-D-97).
 *  5. **Keys, wheel and the desktop buttons go through the same navigation as swipes** (UI-D-95), the
 *     wheel moves exactly one video per 600 ms lock, and nothing ever advances on its own (D-125).
 *
 * Every string is sentinel ASCII: the module ships no words (PWA-03).
 */

const LABELS: ReelsPagerLabels = {
  play: 'play-label',
  pause: 'pause-label',
  previous: 'previous-label',
  next: 'next-label',
  position: 'position {current} of {author}',
};

function makeItems(count: number): ReelsPagerItem[] {
  return Array.from({ length: count }, (_, k) => ({ id: `p${k}`, authorName: `author-${k}` }));
}

/** matchMedia stub: happy-dom always answers `false`, and the reduced-motion branch needs both. */
function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
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

/** The call log shared by every callback, so ORDER across callbacks can be asserted. */
let events: [string, ...unknown[]][] = [];

function baseProps(overrides: Partial<ReelsPagerProps> = {}): ReelsPagerProps {
  return {
    items: makeItems(5),
    index: 0,
    hasMore: false,
    onActivate: vi.fn((next: number) => events.push(['activate', next])),
    onIndexChange: vi.fn((next: number) => events.push(['index', next])),
    onEndReached: vi.fn(() => events.push(['end'])),
    onLaneStep: vi.fn((delta: 1 | -1) => events.push(['lane', delta])),
    renderMedia: vi.fn((item: ReelsPagerItem) => <div data-testid={`media-${item.id}`}>media</div>),
    renderOverlay: vi.fn((item: ReelsPagerItem) => (
      <button type="button" data-testid={`overlay-${item.id}`}>
        overlay
      </button>
    )),
    top: (
      <button type="button" data-testid="top-node">
        top
      </button>
    ),
    paused: false,
    showPlayBadge: false,
    showSpinner: false,
    onTogglePause: vi.fn(() => events.push(['togglePause'])),
    onDoubleTap: vi.fn(() => events.push(['doubleTap'])),
    onToggleSound: vi.fn(() => events.push(['toggleSound'])),
    gesturesDisabled: false,
    instantKey: 'lane-all',
    labels: LABELS,
    ...overrides,
  };
}

/** A host that owns `index` the way ReelsHost will: the pager reports, the host moves. */
function Harness(props: Partial<ReelsPagerProps> & { start?: number }) {
  const { start = 0, ...rest } = props;
  const [index, setIndex] = useState(start);
  const merged = baseProps(rest);
  return (
    <ReelsPager
      {...merged}
      index={index}
      onIndexChange={(next) => {
        merged.onIndexChange(next);
        setIndex(next);
      }}
    />
  );
}

const stack = () => screen.getByTestId('reels-stack');
const pagerRoot = () => screen.getByTestId('reels-pager');
const track = () => screen.getByTestId('reels-track');

/** A drag on `target` from (200, 400) by (dx, dy), released where it ended. */
function drag(target: Element, dx: number, dy: number) {
  const from = { clientX: 200, clientY: 400, pointerId: 1, pointerType: 'touch' };
  fireEvent.pointerDown(target, from);
  fireEvent.pointerMove(target, { ...from, clientX: 200 + dx, clientY: 400 + dy });
  fireEvent.pointerUp(target, { ...from, clientX: 200 + dx, clientY: 400 + dy });
}

/** A still tap on `target`. */
function tap(target: Element) {
  const at = { clientX: 150, clientY: 300, pointerId: 1, pointerType: 'touch' };
  fireEvent.pointerDown(target, at);
  fireEvent.pointerUp(target, at);
}

function flushTimers(ms = 1000) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  events = [];
  stubMatchMedia(false);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReelsPager — vertical paging and the WebKit order (REELS-05, UI-D-82, Pitfall 1)', () => {
  it('a 70 px upward swipe calls onActivate(1) then onIndexChange(1), in that order', () => {
    render(<ReelsPager {...baseProps()} />);
    drag(stack(), 5, -70);
    expect(events).toEqual([
      ['activate', 1],
      ['index', 1],
    ]);
  });

  it('a 50 px upward swipe is under the 60 px threshold and calls nothing', () => {
    expect(REELS_SWIPE_THRESHOLD_PX).toBe(60);
    render(<ReelsPager {...baseProps()} />);
    drag(stack(), 0, -50);
    expect(events).toEqual([]);
  });

  it('a downward swipe from index 2 goes to index 1', () => {
    render(<ReelsPager {...baseProps({ index: 2 })} />);
    drag(stack(), 0, 90);
    expect(events).toEqual([
      ['activate', 1],
      ['index', 1],
    ]);
  });

  it('a swipe started on the media pages and never counts as a tap (T-05.3-12)', () => {
    render(<ReelsPager {...baseProps()} />);
    drag(screen.getByTestId('media-p0'), 0, -80);
    flushTimers();
    expect(events).toEqual([
      ['activate', 1],
      ['index', 1],
    ]);
  });
});

describe('ReelsPager — the horizontal lane step (D-117)', () => {
  it('80 px left with 10 px vertical calls onLaneStep(1) and never onIndexChange', () => {
    render(<ReelsPager {...baseProps()} />);
    drag(stack(), -80, 10);
    expect(events).toEqual([['lane', 1]]);
  });

  it('80 px right calls onLaneStep(-1)', () => {
    render(<ReelsPager {...baseProps({ index: 1 })} />);
    drag(stack(), 80, -10);
    expect(events).toEqual([['lane', -1]]);
  });

  it('without onLaneStep (one lane, D-120) the same gesture calls nothing', () => {
    render(<ReelsPager {...baseProps({ onLaneStep: undefined })} />);
    drag(stack(), -80, 10);
    expect(events).toEqual([]);
  });
});

describe('ReelsPager — the ends and the cancel', () => {
  it('at index 0 a downward swipe calls neither callback (rubber band, no pull-to-refresh)', () => {
    render(<ReelsPager {...baseProps({ index: 0 })} />);
    drag(stack(), 0, 120);
    expect(events).toEqual([]);
  });

  it('at the last loaded page with hasMore an upward swipe calls onEndReached, not onIndexChange', () => {
    render(<ReelsPager {...baseProps({ index: 4, hasMore: true })} />);
    drag(stack(), 0, -120);
    expect(events).toEqual([['end']]);
  });

  it('at the true end (hasMore false) an upward swipe calls nothing', () => {
    render(<ReelsPager {...baseProps({ index: 4, hasMore: false })} />);
    drag(stack(), 0, -120);
    expect(events).toEqual([]);
  });

  it('pointerdown, a 100 px move up, then pointercancel calls nothing and resets the drag', () => {
    render(<ReelsPager {...baseProps({ index: 1 })} />);
    const at = { clientX: 200, clientY: 400, pointerId: 1, pointerType: 'touch' };
    fireEvent.pointerDown(stack(), at);
    fireEvent.pointerMove(stack(), { ...at, clientY: 300 });
    expect(track().style.transform).toContain('-35px');
    fireEvent.pointerCancel(stack(), { ...at, clientY: 300 });
    // a stray pointerup after the cancel has no origin and decides nothing
    fireEvent.pointerUp(stack(), { ...at, clientY: 300 });
    expect(events).toEqual([]);
    expect(track().style.transform).not.toContain('-35px');
  });

  it('one item: a single page, no ticks, both swipes rubber-band and both desktop buttons disabled', () => {
    render(<ReelsPager {...baseProps({ items: makeItems(1), index: 0 })} />);
    drag(stack(), 0, -120);
    drag(stack(), 0, 120);
    expect(events).toEqual([]);
    expect(screen.queryByTestId('reels-ticks')).toBeNull();
    expect(screen.getByRole('button', { name: 'previous-label' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'next-label' })).toBeDisabled();
  });
});

describe('ReelsPager — taps on the page (UI-D-86, D-127, D-128)', () => {
  it('a single tap on the media calls onTogglePause once the 300 ms window closes', () => {
    render(<ReelsPager {...baseProps()} />);
    tap(screen.getByTestId('media-p0'));
    flushTimers(299);
    expect(events).toEqual([]);
    flushTimers(1);
    expect(events).toEqual([['togglePause']]);
  });

  it('two quick taps call onDoubleTap once and onTogglePause never', () => {
    render(<ReelsPager {...baseProps()} />);
    const media = screen.getByTestId('media-p0');
    tap(media);
    flushTimers(120);
    tap(media);
    flushTimers();
    expect(events).toEqual([['doubleTap']]);
  });

  it('a tap on a renderOverlay node calls neither, even twice', () => {
    render(<ReelsPager {...baseProps()} />);
    const overlay = screen.getByTestId('overlay-p0');
    tap(overlay);
    flushTimers(100);
    tap(overlay);
    flushTimers();
    expect(events).toEqual([]);
  });

  it('a tap on the top node calls neither', () => {
    render(<ReelsPager {...baseProps()} />);
    tap(screen.getByTestId('top-node'));
    flushTimers();
    expect(events).toEqual([]);
  });
});

describe('ReelsPager — mounting and the inert neighbours (UI-D-82, UI-D-97)', () => {
  it('with 5 items at index 2, renderMedia runs for items 1, 2 and 3 only', () => {
    const props = baseProps({ index: 2 });
    render(<ReelsPager {...props} />);
    const rendered = new Set(
      vi.mocked(props.renderMedia).mock.calls.map(([item]) => (item as ReelsPagerItem).id),
    );
    expect([...rendered].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(screen.queryByTestId('media-p0')).toBeNull();
    expect(screen.queryByTestId('media-p4')).toBeNull();
  });

  it('pages 0, 1, 3 and 4 are inert and aria-hidden; the current page is neither', () => {
    const { container } = render(<ReelsPager {...baseProps({ index: 2 })} />);
    const pages = [...container.querySelectorAll<HTMLElement>('[data-reel-page]')];
    expect(pages).toHaveLength(5);
    for (const page of pages) {
      const k = Number(page.dataset.reelPage);
      if (k === 2) {
        expect(page).not.toHaveAttribute('inert');
        expect(page).not.toHaveAttribute('aria-hidden');
      } else {
        expect(page).toHaveAttribute('inert');
        expect(page).toHaveAttribute('aria-hidden', 'true');
      }
    }
  });

  it('renderMedia receives current: true for the current page only', () => {
    const props = baseProps({ index: 2 });
    render(<ReelsPager {...props} />);
    const currentFlags = vi
      .mocked(props.renderMedia)
      .mock.calls.map(([item, state]) => [(item as ReelsPagerItem).id, state.current]);
    expect(currentFlags).toContainEqual(['p2', true]);
    expect(currentFlags).toContainEqual(['p1', false]);
    expect(currentFlags).toContainEqual(['p3', false]);
  });

  it('the stack sits at translateY(-index * 100%) with the prototype settle transition', () => {
    render(<ReelsPager {...baseProps({ index: 2 })} />);
    expect(track().style.transform).toContain('-200%');
    expect(track().style.transition).toContain('0.42s');
    expect(track().style.transition).toContain('cubic-bezier(0.2, 0.715, 0.205, 0.99)');
  });

  it('under prefers-reduced-motion the slide is instant', () => {
    stubMatchMedia(true);
    render(<ReelsPager {...baseProps({ index: 2 })} />);
    expect(track().style.transition).toBe('none');
  });

  it('a new instantKey (lane change) drops the transition for that frame', () => {
    const { rerender } = render(<ReelsPager {...baseProps({ index: 3 })} />);
    rerender(<ReelsPager {...baseProps({ index: 0, instantKey: 'lane-other' })} />);
    expect(track().style.transition).toBe('none');
  });
});

describe('ReelsPager — keyboard (D-132, UI-D-95)', () => {
  it('ArrowDown calls onActivate(i + 1) then onIndexChange(i + 1)', () => {
    render(<ReelsPager {...baseProps({ index: 1 })} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(events).toEqual([
      ['activate', 2],
      ['index', 2],
    ]);
  });

  it('ArrowUp at index 0 does nothing', () => {
    render(<ReelsPager {...baseProps({ index: 0 })} />);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(events).toEqual([]);
  });

  it('Space toggles pause and M toggles the sound', () => {
    render(<ReelsPager {...baseProps()} />);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'm' });
    fireEvent.keyDown(window, { key: 'M' });
    expect(events).toEqual([['togglePause'], ['toggleSound'], ['toggleSound']]);
  });

  it('with gesturesDisabled (a sheet is open) every key does nothing', () => {
    render(<ReelsPager {...baseProps({ index: 1, gesturesDisabled: true })} />);
    for (const key of ['ArrowDown', 'ArrowUp', ' ', 'm']) fireEvent.keyDown(window, { key });
    expect(events).toEqual([]);
  });

  it('Space with focus on a button does not toggle pause (native activation wins)', () => {
    render(<ReelsPager {...baseProps()} />);
    const button = screen.getByTestId('top-node');
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(events).toEqual([]);
  });

  it('keys typed into an input are ignored', () => {
    render(<ReelsPager {...baseProps({ index: 1, top: <input data-testid="field" /> })} />);
    const field = screen.getByTestId('field');
    field.focus();
    for (const key of ['ArrowDown', ' ', 'm']) fireEvent.keyDown(field, { key });
    expect(events).toEqual([]);
  });
});

describe('ReelsPager — the locked wheel (D-132, UI-D-95)', () => {
  it('accumulates to 50 px, moves exactly one video, and locks for 600 ms', () => {
    expect(REELS_WHEEL_THRESHOLD_PX).toBe(50);
    expect(REELS_WHEEL_LOCK_MS).toBe(600);
    render(<Harness />);
    fireEvent.wheel(pagerRoot(), { deltaY: 20 });
    fireEvent.wheel(pagerRoot(), { deltaY: 20 });
    fireEvent.wheel(pagerRoot(), { deltaY: 20 });
    expect(events).toEqual([
      ['activate', 1],
      ['index', 1],
    ]);

    // the trackpad's inertia inside the lock moves nothing
    flushTimers(100);
    fireEvent.wheel(pagerRoot(), { deltaY: 60 });
    fireEvent.wheel(pagerRoot(), { deltaY: 60 });
    expect(events).toHaveLength(2);

    // after the lock, one more flick is one more video
    flushTimers(REELS_WHEEL_LOCK_MS);
    fireEvent.wheel(pagerRoot(), { deltaY: 60 });
    expect(events).toEqual([
      ['activate', 1],
      ['index', 1],
      ['activate', 2],
      ['index', 2],
    ]);
  });

  it('the wheel is ignored while gestures are disabled', () => {
    render(<Harness gesturesDisabled />);
    fireEvent.wheel(pagerRoot(), { deltaY: 120 });
    expect(events).toEqual([]);
  });
});

describe('ReelsPager — the desktop buttons (D-132, UI-D-95)', () => {
  it('"previous" is disabled at index 0 and "next" is enabled', () => {
    render(<ReelsPager {...baseProps({ index: 0 })} />);
    expect(screen.getByRole('button', { name: 'previous-label' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'next-label' })).toBeEnabled();
  });

  it('"next" is disabled at the last page when hasMore is false and enabled when it is true', () => {
    const { rerender } = render(<ReelsPager {...baseProps({ index: 4, hasMore: false })} />);
    expect(screen.getByRole('button', { name: 'next-label' })).toBeDisabled();
    rerender(<ReelsPager {...baseProps({ index: 4, hasMore: true })} />);
    expect(screen.getByRole('button', { name: 'next-label' })).toBeEnabled();
  });

  it('"next" goes through the same navigation: onActivate then onIndexChange', () => {
    render(<ReelsPager {...baseProps({ index: 0 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'next-label' }));
    expect(events).toEqual([
      ['activate', 1],
      ['index', 1],
    ]);
  });

  it('"next" at the last loaded page while more is in flight asks for the end, like a swipe', () => {
    render(<ReelsPager {...baseProps({ index: 4, hasMore: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'next-label' }));
    expect(events).toEqual([['end']]);
  });
});

describe('ReelsPager — accessibility (UI-D-97)', () => {
  it('the live region reads the filled position template after an index change', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    const region = screen.getByTestId('reels-position');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.className).toContain('sr-only');
    expect(region).toHaveTextContent('position 2 of author-1');
  });

  it('the first focusable in the current page is the sr-only pause control, named by the state', () => {
    const { container, rerender } = render(<ReelsPager {...baseProps({ index: 0 })} />);
    const current = container.querySelector<HTMLElement>('[data-reel-page="0"]');
    expect(current).not.toBeNull();
    const first = within(current as HTMLElement).getAllByRole('button')[0];
    expect(first).toHaveAccessibleName('pause-label');
    expect(first.className).toContain('sr-only');
    expect(first.className).toContain('focus:not-sr-only');
    fireEvent.click(first);
    expect(events).toEqual([['togglePause']]);

    rerender(<ReelsPager {...baseProps({ index: 0, paused: true })} />);
    const again = container.querySelector<HTMLElement>('[data-reel-page="0"]');
    expect(within(again as HTMLElement).getAllByRole('button')[0]).toHaveAccessibleName(
      'play-label',
    );
  });

  it('the stack is the lane tab panel when the host gives panelId and labelledBy', () => {
    render(<ReelsPager {...baseProps({ panelId: 'panel-x', labelledBy: 'tab-x' })} />);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'panel-x');
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-x');
  });

  it('without a lane row there is no tab panel role', () => {
    render(<ReelsPager {...baseProps()} />);
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });
});

describe('ReelsPager — badge, spinner and ticks (UI-D-86, UI-D-89, UI-D-92)', () => {
  it('showPlayBadge renders a button named labels.play; one click calls onTogglePause once', () => {
    render(<ReelsPager {...baseProps({ showPlayBadge: true })} />);
    const badge = screen.getByTestId('reels-play-badge');
    expect(badge).toHaveAccessibleName('play-label');
    fireEvent.click(badge);
    flushTimers();
    expect(events).toEqual([['togglePause']]);
  });

  it('no badge and no spinner unless asked', () => {
    render(<ReelsPager {...baseProps()} />);
    expect(screen.queryByTestId('reels-play-badge')).toBeNull();
    expect(screen.queryByTestId('reels-spinner')).toBeNull();
  });

  it('showSpinner renders the decorative spinner', () => {
    render(<ReelsPager {...baseProps({ showSpinner: true })} />);
    const spinner = screen.getByTestId('reels-spinner');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws the windowed aria-hidden ticks, the current one active', () => {
    render(<ReelsPager {...baseProps({ items: makeItems(30), index: 10 })} />);
    const ticks = screen.getByTestId('reels-ticks');
    expect(ticks).toHaveAttribute('aria-hidden', 'true');
    const marks = [...ticks.querySelectorAll<HTMLElement>('[data-tick]')];
    expect(marks).toHaveLength(7);
    expect(marks.filter((mark) => mark.dataset.active === 'true')).toHaveLength(1);
  });
});

describe('ReelsPager — never advances on its own (D-125)', () => {
  it('a long idle with the media mounted changes nothing', () => {
    render(<ReelsPager {...baseProps({ index: 1 })} />);
    flushTimers(10 * 60 * 1000);
    expect(events).toEqual([]);
  });
});
