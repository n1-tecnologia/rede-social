// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MediaImage } from '@tria/core/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_DURATION_MS } from '../contracts/index';
import { StoryViewer, type StoryViewerItem, type StoryViewerLabels } from '../ui/StoryViewer';

/**
 * The REAL `MediaImage` under the REAL `StoryViewer` (STORY-02, GAP 2 of 05-VERIFICATION.md).
 *
 * `story-viewer.test.tsx` stubs the `media` prop with a plain `<div/>` — deliberately, because that
 * file is about the pointer pipeline. The cost of that stub was that the phase shipped green over a
 * viewer whose image path spun without bound: `MediaImage`'s mount effect took the caller's
 * `onReady`/`onFailed` as dependencies while `StoryViewer` rebuilt them on every render, so a decoded
 * image re-armed the effect on every pass. A verifier probe reproducing exactly that composition ran
 * to `FATAL ERROR: JavaScript heap out of memory` after ~168 seconds.
 *
 * **The defect this file exists for is a RENDER-RATE property, not a value property.** A viewer that
 * produces the correct DOM while re-rendering without bound is indistinguishable from a correct one
 * under any assertion that only reads the DOM. So the render COUNT is a first-class assertion here.
 *
 * **The ceiling throw in `CountedMediaImage` is load-bearing.** Without it this test would reproduce
 * the loop rather than report it — it would exhaust the heap exactly as the verifier's probe did, and
 * an OOM-killed run has no test counts and proves nothing. With it, a regression fails in
 * milliseconds with a sentence naming the loop.
 *
 * Every string is sentinel ASCII: the module ships no words (PWA-03).
 */

/** Two orders of magnitude above the settled count. Crossing it IS the loop, reported not suffered. */
const RENDER_CEILING = 400;
/** What a settled mount really costs: two mounted neighbours across the load-report cascade. */
const SETTLED_RENDER_BOUND = 40;
const CEILING_MESSAGE = `media render count exceeded ${RENDER_CEILING}`;

/** The variant ladder a story asset publishes; the viewer is full-bleed so the widest is the base. */
const WIDTHS = [320, 640, 1080] as const;

let renderCount = 0;
const reports = { ready: 0, failed: 0 };
/** Per-asset report counts, so "the new story reported" and "the old one did not" are separable. */
const readyByAsset = new Map<string, number>();

function bumpRender() {
  renderCount += 1;
  if (renderCount > RENDER_CEILING) throw new Error(CEILING_MESSAGE);
}

/**
 * The real component, wrapped in a render counter. The wrapper is the ONLY instrument: the props
 * below are `StoryViewerHost`'s wiring verbatim except that the two report props are fresh arrows
 * rather than `controls.onLoad` / `controls.onError` directly. A fresh arrow per render is strictly
 * MORE unstable than the host's object property, so the composition under test is the harder one.
 */
function CountedMediaImage({
  assetId,
  widths,
  active,
  onLoad,
  onError,
}: {
  assetId: string;
  widths: readonly number[];
  active: boolean;
  onLoad: () => void;
  onError: () => void;
}) {
  bumpRender();
  return (
    <MediaImage
      assetId={assetId}
      widths={widths}
      alt=""
      sizes="100vw"
      baseWidth={widths[widths.length - 1]}
      eager={active}
      ratio=""
      fit="contain"
      className="h-full w-full bg-transparent"
      onReady={() => {
        reports.ready += 1;
        readyByAsset.set(assetId, (readyByAsset.get(assetId) ?? 0) + 1);
        onLoad();
      }}
      onFailed={() => {
        reports.failed += 1;
        onError();
      }}
      fallback={<span data-testid={`media-fallback-${assetId}`} />}
    />
  );
}

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

function mediaItem(n: number, widths: readonly number[] = WIDTHS): StoryViewerItem {
  const assetId = `asset-${n}`;
  return {
    id: `story-${n}`,
    mediaKind: 'image',
    caption: '',
    authorName: 'author-name',
    timeLabel: `time-${n}`,
    avatar: null,
    media: (controls) => (
      <CountedMediaImage
        assetId={assetId}
        widths={widths}
        active={controls.active}
        onLoad={controls.onLoad}
        onError={controls.onError}
      />
    ),
    actions: null,
  };
}

/** The injected clock, identical in shape to `story-viewer.test.tsx`'s — time only moves by hand. */
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
  };
}

type Clock = ReturnType<typeof manualClock>;

function viewer(
  items: readonly StoryViewerItem[],
  overrides: Partial<React.ComponentProps<typeof StoryViewer>> = {},
  clock: Clock = manualClock(),
) {
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <StoryViewer
      // A single sequence — ONE group, the shape every pre-05.2 caller passes.
      groups={[{ key: 'A', items, header: { name: 'group-A', avatar: null } }]}
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

/**
 * The decoded state, forced on the prototype. A server-rendered image that is ALREADY decoded never
 * fires `load`, which is why `MediaImage` reports from its mount effect — and it is the exact branch
 * the verifier's probe drove to an OOM. The descriptors are saved and restored rather than deleted,
 * so happy-dom's own accessors survive the suite.
 */
const savedDescriptors = new Map<string, PropertyDescriptor | undefined>();

function forceImageState(complete: boolean, naturalWidth: number) {
  for (const [key, value] of [
    ['complete', complete],
    ['naturalWidth', naturalWidth],
  ] as const) {
    if (!savedDescriptors.has(key))
      savedDescriptors.set(key, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key));
    Object.defineProperty(HTMLImageElement.prototype, key, {
      configurable: true,
      get: () => value,
    });
  }
}

function restoreImageState() {
  for (const [key, descriptor] of savedDescriptors) {
    if (descriptor) Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
    else
      delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[
        key as keyof HTMLImageElement & string
      ];
  }
  savedDescriptors.clear();
}

const dialog = () => screen.getByRole('dialog');
const currentIndex = () => Number(dialog().getAttribute('data-story-index'));
const fillOf = (index: number) => screen.getByTestId(`story-fill-${index}`).style.width;

beforeEach(() => {
  renderCount = 0;
  reports.ready = 0;
  reports.failed = 0;
  readyByAsset.clear();
  forceImageState(true, 800);
});

afterEach(() => {
  cleanup();
  restoreImageState();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('StoryViewer over the REAL MediaImage — the image path settles (STORY-02, GAP 2)', () => {
  it('1. a decoded story image renders the real component, reports once, and lets the clock start', () => {
    const clock = manualClock();
    viewer([mediaItem(0), mediaItem(1)], {}, clock);

    // The render-rate assertion. Before the fix this line is never reached: the ceiling throws first.
    expect(renderCount).toBeLessThan(SETTLED_RENDER_BOUND);
    expect(reports.ready).toBe(1 + 1); // the active story and its one mounted neighbour
    expect(readyByAsset.get('asset-0')).toBe(1);
    expect(reports.failed).toBe(0);

    // THE STUB-PROOF ASSERTION: a plain `<div/>` produces no `<img>` and no variant ladder. Only the
    // real `MediaImage` emits `/v1/media/{assetId}/w320 320w`.
    const img = dialog().querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('srcSet')).toContain('/v1/media/asset-0/w320 320w');
    expect(img?.getAttribute('src')).toBe('/v1/media/asset-0/w1080');

    // UI loading/E04: before the clock starts the active segment sits at 0%, never a shimmer.
    expect(fillOf(0)).toBe('0%');
    // …and it only fills because the media reached `ready` — the clock is gated on exactly that.
    clock.advance(STORY_DURATION_MS / 5);
    expect(fillOf(0)).toBe('20%');
  });

  it('2. an unrelated re-render (a mute toggle) does not re-report and does not cascade', () => {
    viewer([mediaItem(0), mediaItem(1)]);

    const settled = renderCount;
    const readyBefore = reports.ready;

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: LABELS.unmute }));
    });

    expect(reports.ready).toBe(readyBefore);
    expect(renderCount - settled).toBeLessThan(SETTLED_RENDER_BOUND);
  });

  it('3. moving to the next story reports for the NEW asset and leaves the previous one alone', () => {
    viewer([mediaItem(0), mediaItem(1), mediaItem(2)]);

    expect(readyByAsset.get('asset-0')).toBe(1);
    expect(readyByAsset.get('asset-1')).toBe(1);
    expect(readyByAsset.get('asset-2')).toBeUndefined();

    act(() => {
      fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    });

    expect(currentIndex()).toBe(1);
    // The third story enters the neighbour window and reports on its own…
    expect(readyByAsset.get('asset-2')).toBe(1);
    // …and neither of the already-mounted ones reports a second time.
    expect(readyByAsset.get('asset-0')).toBe(1);
    expect(readyByAsset.get('asset-1')).toBe(1);
    expect(renderCount).toBeLessThan(SETTLED_RENDER_BOUND * 2);
  });

  it('4. CR-03: a story with an EMPTY variant ladder reaches the error state and is not consumed', () => {
    const clock = manualClock();
    // The admin history (`listOwnStories`) omits the `status = 'ready'` filter on purpose, so a
    // still-transcoding asset reaches the viewer with no variants published yet.
    viewer([mediaItem(0, []), mediaItem(1)], {}, clock);

    // The failure is REPORTED rather than swallowed, so the viewer can say something.
    expect(reports.failed).toBe(1);
    expect(reports.ready).toBe(1); // the healthy neighbour, not this story
    expect(screen.getByTestId('media-fallback-asset-0')).toBeInTheDocument();

    // The error copy and its retry, not a permanent `loading` state.
    expect(screen.getByTestId('story-media-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.retry })).toBeInTheDocument();

    // A full-screen surface with no way out is a trap, not an error state.
    const close = screen.getByRole('button', { name: LABELS.close });
    act(() => close.focus());
    expect(document.activeElement).toBe(close);

    // The prohibition, made executable: a story the member could NOT see must not be consumed on
    // their behalf. The clock stays where it stopped and the sequence does not advance.
    clock.advance(STORY_DURATION_MS * 2);
    expect(fillOf(0)).toBe('0%');
    expect(currentIndex()).toBe(0);
  });
});
