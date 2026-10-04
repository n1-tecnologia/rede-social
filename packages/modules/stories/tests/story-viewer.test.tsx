// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_DURATION_MS } from '../contracts/index';
import { StoryProgressBars } from '../ui/StoryProgressBars';
import {
  type StoryMediaControls,
  StoryViewer,
  type StoryViewerGroup,
  type StoryViewerItem,
  type StoryViewerLabels,
} from '../ui/StoryViewer';

/**
 * STORY-02's surface, asserted as behaviour rather than as pixels (UI-D-30..UI-D-34), and since
 * 05.2-05 the GROUPED viewer that plays a row of circles (D-107, UI-D-65, R-D-M).
 *
 * The claims worth a test are the ones a later edit could break silently, and every one of them is
 * a decision the approved sketches fix:
 *
 *  1. **One gesture never does two things.** A tap moves one story, a hold pauses, a horizontal drag
 *     skips a whole GROUP and a downward drag dismisses — under a dominant-axis lock, so a diagonal
 *     swipe can never both move and close the viewer.
 *  2. **The row's boundaries (UI-D-65).** Next at a group's last story enters the next group's
 *     first; previous at a group's first story enters the previous group's LAST (the exact mirror);
 *     previous on the row's very first story restarts its clock; next after the row's last story
 *     closes. An empty group is skipped both ways; a not-yet-loaded group shows a loading frame.
 *  3. **Only the neighbours are mounted.** `|k − i| ≤ 1` inside the group, plus the next group's first
 *     story at a group's last index, is both the render window and the pre-buffer.
 *  4. **Pitfall 4: every per-segment key is `${group.key}:${item.id}`.** The same story in two groups
 *     never shares media, blocked or progress state and never collides as a React key.
 *  5. **UI-D-31: there is no double-tap.** A tap already means advance.
 *  6. **UI-D-34: "did not start" is a STATE.** The bar never fills over a frozen video.
 *
 * Every string is sentinel ASCII: the module ships no words (PWA-03), so a copy change in the
 * catalog cannot turn this file red.
 */

afterEach(() => {
  cleanup();
  controls.clear();
  vi.restoreAllMocks();
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
  loadingGroup: 'loading-group-label',
  groupError: 'group-error-label',
  position: (group, current, total) => `position-${group}-${current}-of-${total}`,
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

/**
 * The `media` renderer below is a LIGHT STAND-IN on purpose, not an oversight. Every case in this
 * file is about the POINTER PIPELINE and the row's STATE MACHINE — which tap advances, which group
 * a boundary enters, which control is isolated from the stage — and a real decoder in the tree
 * would add nothing to any of them.
 *
 * The REAL media integration (the real `MediaImage` under the real `StoryViewer`, with a bounded
 * render count and the empty-ladder error path) is asserted in **`story-viewer-media.test.tsx`**,
 * beside this file. That file exists because the stand-in alone once let a viewer whose image path
 * looped without bound ship green; the two files together are the contract.
 */
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

/** One circle of the row. `items: null` is "not loaded yet"; `[]` is "loaded and empty". */
function group(
  key: string,
  items: readonly StoryViewerItem[] | null,
  extra: Partial<StoryViewerGroup> = {},
): StoryViewerGroup {
  return { key, items, header: { name: `group-${key}`, avatar: null }, ...extra };
}

type ViewerProps = React.ComponentProps<typeof StoryViewer>;

/** A ROW of groups, with the injected clock. `rerenderGroups` swaps the row in place. */
function row(
  groups: readonly StoryViewerGroup[],
  overrides: Partial<ViewerProps> = {},
  clock: Clock = manualClock(),
) {
  const onClose = overrides.onClose ?? vi.fn();
  const props = (next: readonly StoryViewerGroup[]): ViewerProps => ({
    labels: LABELS,
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    ...overrides,
    groups: next,
    onClose,
  });
  const result = render(<StoryViewer {...props(groups)} />);
  const rerenderGroups = (next: readonly StoryViewerGroup[]) =>
    result.rerender(<StoryViewer {...props(next)} />);
  return { ...result, onClose, clock, rerenderGroups };
}

/** A SINGLE sequence — how every pre-05.2 caller (deep link, community row) uses the viewer. */
function viewer(count: number, overrides: Partial<ViewerProps> = {}, clock: Clock = manualClock()) {
  return row(
    [
      group(
        'A',
        Array.from({ length: count }, (_, k) => item(k)),
      ),
    ],
    overrides,
    clock,
  );
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

/**
 * A tap ON A CONTROL — the full browser sequence (pointerdown, pointerup, then click), not a
 * synthetic `click`. A bare `click` skips the pointer pipeline entirely, which is precisely the
 * pipeline the CR-04 cases below are about: whether the press/release pair also reaches the stage.
 */
function tapOn(node: HTMLElement) {
  const x = Math.round(width() / 2);
  fireEvent.pointerDown(node, { clientX: x, clientY: 300, pointerId: 1 });
  fireEvent.pointerUp(node, { clientX: x, clientY: 300, pointerId: 1 });
  fireEvent.click(node, { clientX: x, clientY: 300 });
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

/** `[group, index]` — the viewer's whole position, as it publishes it on the dialog. */
function position(): [number, number] {
  return [Number(dialog().getAttribute('data-story-group')), currentIndex()];
}

/** React's duplicate-key warning, read from the console spy a case installs. */
function keyWarnings(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((call) => call.some((part) => String(part).includes('same key')))
    .length;
}

/**
 * A stand-in that counts its MOUNTS, so "the retry re-mounted the media" is observable: the viewer
 * remounts the node under a fresh `attempt` key, and a `[]`-dependency effect fires once per mount.
 */
function countingMedia(n: number, mounted: { count: number }) {
  function MountCounter() {
    useEffect(() => {
      mounted.count += 1;
    }, []);
    return <div data-testid={`media-${n}`} />;
  }
  return (c: StoryMediaControls) => {
    controls.set(`story-${n}`, c);
    return <MountCounter />;
  };
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

  it('4. the dominant axis decides: horizontal skips a group, DOWN dismisses, up does nothing', () => {
    const onClose = vi.fn();
    row([group('A', [item(0), item(1)]), group('B', [item(10), item(11)])], { onClose });

    dragBy(-120, 0);
    expect(position()).toEqual([1, 0]);

    dragBy(120, 0);
    expect(position()).toEqual([0, 0]);

    // Up is deliberately inert — there is nothing above a story.
    dragBy(0, -140);
    expect(onClose).not.toHaveBeenCalled();
    expect(position()).toEqual([0, 0]);

    // More horizontal than vertical: one gesture never both moves AND dismisses.
    dragBy(-140, 90);
    expect(onClose).not.toHaveBeenCalled();
    expect(position()).toEqual([1, 0]);

    dragBy(0, 140);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('5. NEXT at the row’s last story closes the viewer and never loops (D-107)', () => {
    const onClose = vi.fn();
    viewer(1, { onClose });

    tapAt(RIGHT_TWO_THIRDS());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('6. PREVIOUS at the row’s first story restarts the current clock instead of closing', () => {
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
    expect(announcements[0]).toHaveTextContent('position-group-A-3-of-4');
    expect(announcements[0]).toHaveAttribute('aria-live', 'polite');

    fireEvent.keyDown(node, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('9a. while it is open the dialog declares the shell chrome hidden, and the declaration leaves with it', () => {
    const { unmount } = viewer(2);
    // 2026-10-02: the shell's own stylesheet hides its TopBar and floating BottomNav while a node
    // carrying this declaration is mounted, so neither sits over the header or the action row. The
    // attribute is the whole contract between the module and the shell (MOD-02), so it is pinned.
    expect(dialog()).toHaveAttribute('data-shell-hide', 'chrome');

    unmount();
    expect(document.querySelector('[data-shell-hide]')).toBeNull();
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

  it('10a. a key that starts INSIDE a dialog the viewer hosts (the comment sheet) is that dialog’s', () => {
    // The comment sheet renders inside this dialog (`overlay`) and opens with the focus on its
    // title. A Space there toggled the keyboard pause, so the story stayed paused after the sheet
    // closed; an arrow in its field moved the story underneath it.
    viewer(3, {
      overlay: (
        <div role="dialog" aria-modal="true" aria-label="sheet-label" tabIndex={-1}>
          <h2 tabIndex={-1}>sheet-title</h2>
          <input aria-label="sheet-field" />
        </div>
      ),
    });
    const node = screen.getByRole('dialog', { name: LABELS.dialog });
    const heading = screen.getByRole('heading', { name: 'sheet-title' });
    const field = screen.getByRole('textbox', { name: 'sheet-field' });

    fireEvent.keyDown(heading, { key: ' ' });
    expect(node).toHaveAttribute('data-paused', 'false');
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    fireEvent.keyDown(heading, { key: 'ArrowRight' });
    expect(node).toHaveAttribute('data-story-index', '0');

    // The viewer's own keys are untouched: from the dialog root they still move and pause.
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(node).toHaveAttribute('data-story-index', '1');
    fireEvent.keyDown(node, { key: ' ' });
    expect(node).toHaveAttribute('data-paused', 'true');
  });

  it('11. UI-D-34: canplay without playback leaves the clock PAUSED and renders the play badge', () => {
    vi.useFakeTimers();
    const clock = manualClock();
    row([group('A', [item(0, { mediaKind: 'video' }), item(1)])], {}, clock);

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

  /* ── CR-04: one tap, one meaning ──────────────────────────────────────────────────────────────
   *
   * The play badge and the media-error retry used to live INSIDE the div that owns
   * `onPointerDown`/`onPointerMove`/`onPointerUp`, so a tap on either also ran the stage's tap-zone
   * maths and advanced the story. The member pressed "play" and lost the story instead.
   *
   * The fix is STRUCTURAL rather than propagational: the two controls are siblings of the stage, so
   * their press/release pair cannot bubble into its handlers — there is no `stopPropagation` call
   * for a later edit to delete by accident.
   *
   * What these three cases can and cannot see: happy-dom does not hit-test, so the other half of
   * the fix — the error container being `pointer-events-none` so a tap on the COPY still falls
   * through to the stage — is NOT observable here and is asserted by NO automated test in this
   * repo. It is a real-browser property and it is carried as an open HUMAN check in the phase's
   * verification pack (WR-09). Case 12c is the unit-level guard that matters most here: without
   * it, 12a and 12b would also pass over a viewer whose gesture pipeline had been broken entirely
   * rather than isolated.
   */

  it('12a. CR-04: tapping the play badge starts playback and does NOT advance the story', () => {
    vi.useFakeTimers();
    const clock = manualClock();
    const onRequestPlay = vi.fn();
    row([group('A', [item(0, { mediaKind: 'video', onRequestPlay }), item(1)])], {}, clock);

    act(() => controls.get('story-0')?.onCanPlay());
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const badge = screen.getByTestId('story-autoplay-badge');
    expect(badge).toHaveAttribute('data-play-attempt', '0');

    tapOn(badge);

    // The badge acted: the host's `play()` ran synchronously inside the gesture, and the blocked
    // state cleared, which is why the badge itself is gone. (`data-play-attempt` lives ON the badge,
    // so it unmounts with it — `onRequestPlay` is the same event observed from the other side.)
    expect(onRequestPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('story-autoplay-badge')).toBeNull();
    // …and it did ONLY that.
    expect(currentIndex()).toBe(0);
  });

  it('12b. CR-04: tapping the media-error retry re-mounts the media and does NOT advance', () => {
    const clock = manualClock();
    const mounted = { count: 0 };
    row([group('A', [item(0, { media: countingMedia(0, mounted) }), item(1), item(2)])], {}, clock);

    expect(mounted.count).toBe(1);
    act(() => controls.get('story-0')?.onError());
    expect(screen.getByTestId('story-media-error')).toBeInTheDocument();

    tapOn(screen.getByRole('button', { name: LABELS.retry }));

    // The retry acted: the media state went back to `loading` and the node was re-mounted under a
    // fresh `attempt` key.
    expect(screen.queryByTestId('story-media-error')).toBeNull();
    expect(mounted.count).toBe(2);
    // …and it did ONLY that.
    expect(currentIndex()).toBe(0);
  });

  it('12c. CR-04: the stage is still LIVE — a tap on the media area advances as before', () => {
    viewer(3);

    tapAt(RIGHT_TWO_THIRDS());
    expect(currentIndex()).toBe(1);

    tapAt(LEFT_THIRD());
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
    row([group('A', [item(0, { caption: '' }), item(1)])]);
    expect(screen.queryByTestId('story-caption')).toBeNull();
  });
});

/* ── The grouped viewer (05.2-05: D-107, UI-D-65, R-D-M, Pitfall 4) ─────────────────────────────
 *
 * The position is the PAIR `(group, index)`, published on the dialog as `data-story-group` and
 * `data-story-index`. Group keys are sentinel ASCII and the header name is `group-{key}`.
 */
describe('StoryViewer — a row of groups (D-107, UI-D-65, R-D-M)', () => {
  it('G1. next at a group’s last story enters the next group’s FIRST; next after the row’s last closes', () => {
    const onClose = vi.fn();
    row([group('A', [item(0), item(1)]), group('B', [item(10)])], { onClose, initialIndex: 1 });
    expect(position()).toEqual([0, 1]);

    tapAt(RIGHT_TWO_THIRDS());
    expect(position()).toEqual([1, 0]);
    expect(screen.getByTestId('media-10')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // B's only story is the row's last: the viewer closes rather than looping (D-107).
    tapAt(RIGHT_TWO_THIRDS());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('G2. previous at a group’s first story enters the previous group’s LAST; at the row’s very first it restarts', () => {
    const clock = manualClock();
    const onClose = vi.fn();
    row(
      [group('A', [item(0), item(1)]), group('B', [item(10)])],
      { onClose, initialGroup: 1 },
      clock,
    );
    expect(position()).toEqual([1, 0]);

    // The exact mirror of next (R A2): A's LAST story, not its first.
    tapAt(LEFT_THIRD());
    expect(position()).toEqual([0, 1]);

    tapAt(LEFT_THIRD());
    expect(position()).toEqual([0, 0]);

    act(() => controls.get('story-0')?.onLoad());
    clock.advance(STORY_DURATION_MS / 2);
    expect(fillOf(0)).toBe('50%');

    // Nothing precedes the row's first story: its clock restarts and nothing closes.
    tapAt(LEFT_THIRD());
    expect(position()).toEqual([0, 0]);
    expect(fillOf(0)).toBe('0%');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('G3. a horizontal swipe skips a WHOLE group: left to the next group’s first, right to the previous group’s first', () => {
    row([group('A', [item(0), item(1)]), group('B', [item(10), item(11)])]);

    dragBy(-120, 0);
    expect(position()).toEqual([1, 0]);

    tapAt(RIGHT_TWO_THIRDS());
    expect(position()).toEqual([1, 1]);

    // Right lands on the previous group's FIRST story — a swipe is a group skip, not a tap.
    dragBy(120, 0);
    expect(position()).toEqual([0, 0]);

    // ArrowRight keeps TAP semantics: one story, not one group.
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(position()).toEqual([0, 1]);
  });

  it('G4. an EMPTY group is skipped in both directions', () => {
    row([group('A', [item(0), item(1)]), group('E', []), group('B', [item(10)])], {
      initialIndex: 1,
    });

    tapAt(RIGHT_TWO_THIRDS());
    expect(position()).toEqual([2, 0]);

    tapAt(LEFT_THIRD());
    expect(position()).toEqual([0, 1]);
  });

  it('G5. a group not loaded yet shows the loading frame with the clock paused, then plays when its items arrive', () => {
    const clock = manualClock();
    const onNeedGroup = vi.fn();
    const { rerenderGroups } = row(
      [group('A', [item(0)]), group('B', null)],
      { onNeedGroup },
      clock,
    );

    act(() => controls.get('story-0')?.onLoad());
    clock.advance(STORY_DURATION_MS / 5);
    expect(clock.running).toBe(true);

    tapAt(RIGHT_TWO_THIRDS());
    expect(position()).toEqual([1, 0]);

    // The loading frame: the spinner, the group's own header, ONE empty segment.
    expect(screen.getByTestId('story-group-loading')).toBeInTheDocument();
    expect(screen.getByText('group-B')).toBeInTheDocument();
    expect(screen.getByTestId('story-progress-bars')).toHaveAttribute('data-story-count', '1');
    expect(fillOf(0)).toBe('0%');
    expect(onNeedGroup).toHaveBeenCalledWith(1);

    // The clock is paused: time passing moves nothing and closes nothing.
    expect(clock.running).toBe(false);
    clock.advance(STORY_DURATION_MS * 2);
    expect(position()).toEqual([1, 0]);

    rerenderGroups([group('A', [item(0)]), group('B', [item(10), item(11)])]);

    expect(screen.queryByTestId('story-group-loading')).toBeNull();
    expect(screen.getByTestId('media-10')).toBeInTheDocument();
    expect(position()).toEqual([1, 0]);
    expect(screen.getByTestId('story-progress-bars')).toHaveAttribute('data-story-count', '2');

    act(() => controls.get('story-10')?.onLoad());
    clock.advance(STORY_DURATION_MS / 2);
    expect(fillOf(0)).toBe('50%');
  });

  it('G6. a group whose load FAILED shows the group error with a retry, and close and swipe stay live', () => {
    const onRetryGroup = vi.fn();
    const onNeedGroup = vi.fn();
    const onClose = vi.fn();
    row([group('A', [item(0)]), group('B', null, { failed: true })], {
      initialGroup: 1,
      onRetryGroup,
      onNeedGroup,
      onClose,
    });

    const error = screen.getByTestId('story-group-error');
    expect(within(error).getByText(LABELS.groupError)).toBeInTheDocument();
    // The one polite region announces the failure too, in place of the position.
    expect(screen.getByTestId('story-position')).toHaveTextContent(LABELS.groupError);
    expect(screen.queryByTestId('story-group-loading')).toBeNull();
    // A failed group is not re-requested behind the member's back; only the retry asks again.
    expect(onNeedGroup).not.toHaveBeenCalled();

    tapOn(screen.getByRole('button', { name: LABELS.retry }));
    expect(onRetryGroup).toHaveBeenCalledWith(1);
    expect(position()).toEqual([1, 0]);

    // The swipe is live over the error frame…
    dragBy(120, 0);
    expect(position()).toEqual([0, 0]);
    dragBy(-120, 0);
    expect(position()).toEqual([1, 0]);

    // …and so is the close control: the viewer never traps a member.
    fireEvent.click(screen.getByRole('button', { name: LABELS.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('G7. at a group’s last story the next group’s items are PREFETCHED before any tap', () => {
    const onNeedGroup = vi.fn();
    row([group('A', [item(0), item(1)]), group('B', null)], { onNeedGroup });

    // Not at the last index yet: nothing is fetched early.
    expect(onNeedGroup).not.toHaveBeenCalled();

    tapAt(RIGHT_TWO_THIRDS());
    // Still inside A — the request goes out while the member watches A's last story.
    expect(position()).toEqual([0, 1]);
    expect(onNeedGroup).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('story-group-loading')).toBeNull();
  });

  it('G8. Pitfall 4: the SAME story in two groups shares no state and no React key', () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dup = (groupKey: string) =>
      item(0, {
        id: 'dup',
        mediaKind: 'video',
        media: (c) => {
          controls.set(`${groupKey}:dup`, c);
          return <div data-testid={`media-${groupKey}-dup`} />;
        },
      });
    row([group('A', [dup('A')]), group('B', [dup('B')])]);

    // A's only story is its last, so B's first is pre-mounted beside it — two copies, two keys.
    const keys = [...dialog().querySelectorAll('[data-segment-key]')].map((node) =>
      node.getAttribute('data-segment-key'),
    );
    expect(keys).toEqual(['A:dup', 'B:dup']);

    // A's copy is autoplay-blocked…
    act(() => controls.get('A:dup')?.onCanPlay());
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('story-autoplay-badge')).toBeInTheDocument();

    // …and B's copy, a different segment of the same story, is not.
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(position()).toEqual([1, 0]);
    expect(screen.queryByTestId('story-autoplay-badge')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('story-autoplay-badge')).toBeNull();

    expect(keyWarnings(errors)).toBe(0);
  });

  it('G9. onSegmentShown fires once per time a segment is CURRENT and ready — never on mount, never for a neighbour', () => {
    const onSegmentShown = vi.fn();
    row([group('A', [item(0), item(1)]), group('B', [item(10)])], { onSegmentShown });

    expect(onSegmentShown).not.toHaveBeenCalled();

    // The pre-mounted neighbour decodes first: it is not being shown, so it is not reported.
    act(() => controls.get('story-1')?.onLoad());
    expect(onSegmentShown).not.toHaveBeenCalled();

    act(() => controls.get('story-0')?.onLoad());
    expect(onSegmentShown).toHaveBeenCalledTimes(1);
    expect(onSegmentShown).toHaveBeenLastCalledWith('story-0', 'A');

    // An unrelated re-render (a mute toggle) reports nothing new.
    fireEvent.click(screen.getByRole('button', { name: LABELS.unmute }));
    expect(onSegmentShown).toHaveBeenCalledTimes(1);

    // Story 1 is already decoded: it is reported the moment it BECOMES current.
    tapAt(RIGHT_TWO_THIRDS());
    expect(onSegmentShown).toHaveBeenCalledTimes(2);
    expect(onSegmentShown).toHaveBeenLastCalledWith('story-1', 'A');

    // Revisiting story 0 is a new showing, and it is reported again.
    tapAt(LEFT_THIRD());
    expect(onSegmentShown).toHaveBeenCalledTimes(3);
    expect(onSegmentShown).toHaveBeenLastCalledWith('story-0', 'A');
  });

  it('G10. the bars show the CURRENT group only and reset on a group change; the live region names the group', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // `story-1` is in BOTH groups (D-111): the tenant group and a highlight.
    row([group('A', [item(0), item(1)]), group('B', [item(1), item(10), item(11)])], {
      initialIndex: 1,
    });

    const bars = () => screen.getByTestId('story-progress-bars');
    expect(bars()).toHaveAttribute('data-story-count', '2');
    expect(fillOf(0)).toBe('100%');
    expect(screen.getByTestId('story-position')).toHaveTextContent('position-group-A-2-of-2');

    tapAt(RIGHT_TWO_THIRDS());

    expect(position()).toEqual([1, 0]);
    expect(bars()).toHaveAttribute('data-story-count', '3');
    expect(bars().children).toHaveLength(3);
    // The row RESET: the first segment of the new group is empty, not A's full one.
    expect(fillOf(0)).toBe('0%');
    expect(fillOf(1)).toBe('0%');
    expect(screen.getByTestId('story-position')).toHaveTextContent('position-group-B-1-of-3');
    expect(screen.getAllByTestId('story-position')).toHaveLength(1);

    expect(keyWarnings(errors)).toBe(0);
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
