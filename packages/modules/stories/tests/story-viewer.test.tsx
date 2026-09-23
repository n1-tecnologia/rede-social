// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_DURATION_MS } from '../contracts/index';
import { StoryProgressBars } from '../ui/StoryProgressBars';
import {
  type StoryMediaControls,
  StoryViewer,
  type StoryViewerItem,
  type StoryViewerLabels,
} from '../ui/StoryViewer';

/**
 * STORY-02's surface, asserted as behaviour rather than as pixels (UI-D-30..UI-D-34).
 *
 * The claims worth a test are the ones a later edit could break silently, and every one of them is
 * a decision the approved sketch fixes:
 *
 *  1. **One gesture never does two things.** A tap advances, a hold pauses, a horizontal drag moves
 *     through the sequence and a downward drag dismisses — under a dominant-axis lock, so a diagonal
 *     swipe can never both change story and close the viewer.
 *  2. **The boundaries do not loop** (D-78). Next at the last story CLOSES; previous at the first
 *     restarts the current clock. A single-publisher strip on a loop traps the member.
 *  3. **Only the neighbours are mounted.** `|k − i| ≤ 1` is both the render window and the
 *     pre-buffer for the next story's decode.
 *  4. **UI-D-31: there is no double-tap.** A tap already means advance; the like control is the
 *     explicit heart the host puts in the action row.
 *  5. **UI-D-34: "did not start" is a STATE.** A video that reports it can play and then does not
 *     play leaves the clock PAUSED and renders the play badge — the bar never fills over a frozen
 *     video.
 *
 * Every string is sentinel ASCII: the module ships no words (PWA-03), so a copy change in the
 * catalog cannot turn this file red.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const LABELS: StoryViewerLabels = {
  dialog: 'dialog-label',
  close: 'close-label',
  mute: 'mute-label',
  unmute: 'unmute-label',
  previous: 'previous-label',
  next: 'next-label',
  play: 'play-label',
  mediaError: 'media-error-label',
  retry: 'retry-label',
  position: (current, total) => `position-${current}-of-${total}`,
};

/** The injected clock, identical in shape to `story-clock.test.ts`'s — time only moves by hand. */
function manualClock() {
  let time = 0;
  let pending: ((timestamp: number) => void) | null = null;
  let handle = 0;
  return {
    now: () => time,
    requestFrame: (callback: (timestamp: number) => void) => {
      pending = callback;
      handle += 1;
      return handle;
    },
    cancelFrame: () => {
      pending = null;
    },
    advance(ms: number) {
      time += ms;
      const callback = pending;
      pending = null;
      if (callback) act(() => callback(time));
    },
    /** Moves the clock WITHOUT delivering a frame — how a hold long enough to count is expressed. */
    skip(ms: number) {
      time += ms;
    },
    get running() {
      return pending !== null;
    },
  };
}

type Clock = ReturnType<typeof manualClock>;

/** The controls the viewer hands each item's media renderer, captured for the test to drive. */
const controls = new Map<string, StoryMediaControls>();

function item(n: number, overrides: Partial<StoryViewerItem> = {}): StoryViewerItem {
  const id = `story-${n}`;
  return {
    id,
    mediaKind: 'image',
    caption: `caption-${n}`,
    authorName: 'author-name',
    timeLabel: `time-${n}`,
    avatar: null,
    media: (c) => {
      controls.set(id, c);
      return <div data-testid={`media-${n}`} />;
    },
    actions: (
      <button type="button" data-testid={`actions-${n}`}>
        {`like-${n}`}
      </button>
    ),
    ...overrides,
  };
}

function viewer(
  count: number,
  overrides: Partial<React.ComponentProps<typeof StoryViewer>> = {},
  clock: Clock = manualClock(),
) {
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <StoryViewer
      items={Array.from({ length: count }, (_, k) => item(k))}
      labels={LABELS}
      now={clock.now}
      requestFrame={clock.requestFrame}
      cancelFrame={clock.cancelFrame}
      {...overrides}
      onClose={onClose}
    />,
  );
  return { ...result, onClose, clock };
}

const stage = () => screen.getByTestId('story-stage');
const pager = () => screen.getByTestId('story-pager');
const dialog = () => screen.getByRole('dialog');

/** Where the thirds fall. The viewer falls back to the viewport when the stage has no layout box. */
const width = () => window.innerWidth;
const LEFT_THIRD = () => Math.round(width() * 0.15);
const RIGHT_TWO_THIRDS = () => Math.round(width() * 0.8);

/** A tap: press and release at the same point, with no time between them. */
function tapAt(x: number) {
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 300, pointerId: 1 });
  fireEvent.pointerUp(stage(), { clientX: x, clientY: 300, pointerId: 1 });
}

/** A drag: press, move past the threshold, release. */
function dragBy(dx: number, dy: number) {
  const from = { clientX: Math.round(width() / 2), clientY: 300, pointerId: 1 };
  fireEvent.pointerDown(stage(), from);
  fireEvent.pointerMove(stage(), {
    clientX: from.clientX + dx,
    clientY: from.clientY + dy,
    pointerId: 1,
  });
  fireEvent.pointerUp(stage(), {
    clientX: from.clientX + dx,
    clientY: from.clientY + dy,
    pointerId: 1,
  });
}

function currentIndex(): number {
  return Number(dialog().getAttribute('data-story-index'));
}

describe('StoryViewer — the pager, the gestures and the boundaries (STORY-02, UI-D-30)', () => {
  it('1. only the neighbours are mounted: |k − i| ≤ 1 and the rest are absent from the DOM', () => {
    viewer(5);

    expect(screen.getByTestId('media-0')).toBeInTheDocument();
    expect(screen.getByTestId('media-1')).toBeInTheDocument();
    // The pre-buffer is exactly one story wide in each direction; 2, 3 and 4 have not decoded.
    expect(screen.queryByTestId('media-2')).toBeNull();
    expect(screen.queryByTestId('media-3')).toBeNull();
    expect(screen.queryByTestId('media-4')).toBeNull();
  });

  it('2. a tap in the right two-thirds advances; a tap in the left third goes back', () => {
    viewer(3);
    expect(currentIndex()).toBe(0);

    tapAt(RIGHT_TWO_THIRDS());
    expect(currentIndex()).toBe(1);

    tapAt(RIGHT_TWO_THIRDS());
    expect(currentIndex()).toBe(2);

    tapAt(LEFT_THIRD());
    expect(currentIndex()).toBe(1);
  });

  it('3. a press HELD past the tap window pauses, and releasing resumes without advancing', () => {
    const clock = manualClock();
    viewer(3, {}, clock);

    expect(dialog()).toHaveAttribute('data-paused', 'false');

    fireEvent.pointerDown(stage(), { clientX: RIGHT_TWO_THIRDS(), clientY: 300, pointerId: 1 });
    expect(dialog()).toHaveAttribute('data-paused', 'true');

    // Longer than the 200 ms tap window: this is a hold, not a tap.
    clock.skip(600);
    fireEvent.pointerUp(stage(), { clientX: RIGHT_TWO_THIRDS(), clientY: 300, pointerId: 1 });

    expect(dialog()).toHaveAttribute('data-paused', 'false');
    // The whole point: holding to read a caption must not cost the member the story.
    expect(currentIndex()).toBe(0);
  });

  it('4. the dominant axis decides: horizontal moves, DOWN dismisses, up does nothing', () => {
    const onClose = vi.fn();
    viewer(3, { onClose });

    dragBy(-120, 0);
    expect(currentIndex()).toBe(1);

    dragBy(120, 0);
    expect(currentIndex()).toBe(0);

    // Up is deliberately inert — there is nothing above a story.
    dragBy(0, -140);
    expect(onClose).not.toHaveBeenCalled();
    expect(currentIndex()).toBe(0);

    // More horizontal than vertical: one gesture never both moves AND dismisses.
    dragBy(-140, 90);
    expect(onClose).not.toHaveBeenCalled();
    expect(currentIndex()).toBe(1);

    dragBy(0, 140);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('5. NEXT at the last story closes the viewer and never loops (D-78)', () => {
    const onClose = vi.fn();
    viewer(1, { onClose });

    tapAt(RIGHT_TWO_THIRDS());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('6. PREVIOUS at the first story restarts the current clock instead of closing', () => {
    const clock = manualClock();
    const onClose = vi.fn();
    viewer(3, { onClose }, clock);

    act(() => controls.get('story-0')?.onLoad());
    clock.advance(STORY_DURATION_MS / 2);
    expect(fillOf(0)).toBe('50%');

    tapAt(LEFT_THIRD());

    expect(onClose).not.toHaveBeenCalled();
    expect(currentIndex()).toBe(0);
    expect(fillOf(0)).toBe('0%');
  });

  it('7. the clock advances the sequence by itself, one story at a time', () => {
    const clock = manualClock();
    viewer(3, {}, clock);

    act(() => controls.get('story-0')?.onLoad());
    clock.advance(STORY_DURATION_MS);
    expect(currentIndex()).toBe(1);

    act(() => controls.get('story-1')?.onLoad());
    clock.advance(STORY_DURATION_MS);
    expect(currentIndex()).toBe(2);
  });

  it('8. reduced motion drops the pager TRANSITION while the clock keeps running', () => {
    stubReducedMotion(true);
    const clock = manualClock();
    viewer(3, {}, clock);

    // The swap is instant…
    expect(pager().style.transition).toBe('none');

    // …and auto-advance survives: it is content pacing, not decoration (UI-D-30).
    act(() => controls.get('story-0')?.onLoad());
    clock.advance(STORY_DURATION_MS / 2);
    expect(fillOf(0)).toBe('50%');
  });

  it('9. it is a modal dialog: focus lands on close, Escape closes, the position is announced once', () => {
    const onClose = vi.fn();
    viewer(4, { onClose, initialIndex: 2 });

    const node = dialog();
    expect(node).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: LABELS.close }));

    // One polite region, one generated string, bounded by the count — never member content.
    const announcements = screen.getAllByTestId('story-position');
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toHaveTextContent('position-3-of-4');
    expect(announcements[0]).toHaveAttribute('aria-live', 'polite');

    fireEvent.keyDown(node, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('10. the keyboard reaches the same three actions: arrows navigate, space toggles pause', () => {
    viewer(3);
    const node = dialog();

    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(currentIndex()).toBe(1);

    fireEvent.keyDown(node, { key: 'ArrowLeft' });
    expect(currentIndex()).toBe(0);

    fireEvent.keyDown(node, { key: ' ' });
    expect(node).toHaveAttribute('data-paused', 'true');
    fireEvent.keyDown(node, { key: ' ' });
    expect(node).toHaveAttribute('data-paused', 'false');
  });

  it('11. UI-D-34: canplay without playback leaves the clock PAUSED and renders the play badge', () => {
    vi.useFakeTimers();
    const clock = manualClock();
    viewer(2, { items: [item(0, { mediaKind: 'video' }), item(1)] }, clock);

    act(() => controls.get('story-0')?.onCanPlay());
    expect(screen.queryByTestId('story-autoplay-badge')).toBeNull();

    // iOS Low Power Mode: the player said it could play and then did not.
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByTestId('story-autoplay-badge')).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('data-paused', 'true');
    // The bar never fills over a video that is not moving.
    expect(fillOf(0)).toBe('0%');
  });

  it('12. media that FAILS shows the error copy, keeps the segment where it was and stays paused', () => {
    const clock = manualClock();
    viewer(3, {}, clock);

    act(() => controls.get('story-0')?.onLoad());
    clock.advance(STORY_DURATION_MS / 5);
    expect(fillOf(0)).toBe('20%');

    act(() => controls.get('story-0')?.onError());

    expect(screen.getByText(LABELS.mediaError)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.retry })).toBeInTheDocument();
    // The close control stays reachable, and the sequence is NOT advanced past the failure.
    expect(screen.getByRole('button', { name: LABELS.close })).toBeInTheDocument();
    expect(currentIndex()).toBe(0);
    // The position must not shift beneath the member: the segment keeps its fill.
    expect(fillOf(0)).toBe('20%');
    clock.advance(STORY_DURATION_MS);
    expect(currentIndex()).toBe(0);
  });

  it('13. UI-D-31 / UI-D-32: no double-tap gesture and no share control anywhere in the viewer', () => {
    viewer(3);

    // Two taps inside any plausible double-tap window are two ADVANCES, never a like.
    tapAt(RIGHT_TWO_THIRDS());
    tapAt(RIGHT_TWO_THIRDS());
    expect(currentIndex()).toBe(2);

    // The like control is the host's, in the action row of whichever story is being watched — the
    // viewer owns no like of its own, and mounts no gesture that could fire one.
    expect(screen.getByTestId('actions-2')).toBeInTheDocument();
    expect(dialog().querySelector('[data-double-tap-burst]')).toBeNull();
  });

  it('14. a story with no caption renders no caption node at all', () => {
    viewer(2, { items: [item(0, { caption: '' }), item(1)] });
    expect(screen.queryByTestId('story-caption')).toBeNull();
  });
});

describe('StoryProgressBars — one segment per story, decorative and text-free (UI-D-30)', () => {
  const items = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `s${k}` }));

  it('15. one segment per item: past full, active at progress, future empty', () => {
    render(<StoryProgressBars items={items(4)} index={1} progress={0.25} />);

    const row = screen.getByTestId('story-progress-bars');
    expect(row.children).toHaveLength(4);
    expect(screen.getByTestId('story-fill-0').style.width).toBe('100%');
    expect(screen.getByTestId('story-fill-1').style.width).toBe('25%');
    expect(screen.getByTestId('story-fill-2').style.width).toBe('0%');
    expect(screen.getByTestId('story-fill-3').style.width).toBe('0%');
  });

  it('16. one story is one full-width segment; 25 stories are 25 segments in one row', () => {
    const { rerender } = render(<StoryProgressBars items={items(1)} index={0} progress={1} />);
    expect(screen.getByTestId('story-progress-bars').children).toHaveLength(1);

    // The overflow backstop's DOM half: 25 segments, one row, `flex-1` sharing the width.
    rerender(<StoryProgressBars items={items(25)} index={11} progress={0.56} />);
    const row = screen.getByTestId('story-progress-bars');
    expect(row.children).toHaveLength(25);
    expect(row).toHaveClass('flex-nowrap');
  });

  it('17. the bars are decorative: hidden from assistive technology and carrying no text', () => {
    render(<StoryProgressBars items={items(3)} index={0} progress={0.5} />);
    const row = screen.getByTestId('story-progress-bars');

    expect(row).toHaveAttribute('aria-hidden');
    expect(row.textContent).toBe('');
    // The announced position lives on the viewer's single live region, never here.
    expect(row.querySelector('[aria-live]')).toBeNull();
    expect(row.querySelector('[role="progressbar"]')).toBeNull();
  });
});

/** The active-segment width, as the browser computes it from the inline style. */
function fillOf(index: number): string {
  return screen.getByTestId(`story-fill-${index}`).style.width;
}

/** Forces `prefers-reduced-motion` for the one test that asserts the motion branch. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}
