// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaImage } from '../ui';

/**
 * `MediaImage`'s REPORTING contract (R-05, 05-VERIFICATION.md gap 2 / CR-03).
 *
 * The component has exactly two outward reports — `onReady` and `onFailed` — and the caller is
 * WAITING on one of them: the story viewer's clock is gated on `ready` and its error copy on
 * `error`. Every case below therefore asserts a call COUNT, never call presence. "Called at least
 * once" is the assertion shape that let both of this file's defects ship:
 *
 *  - a decoded image reported on EVERY pass, because the mount effect took the caller's callback
 *    identities as dependencies while the caller rebuilt them each render — a loop a verifier probe
 *    drove to `FATAL ERROR: JavaScript heap out of memory`;
 *  - an EMPTY variant ladder reported NOTHING, because the `src === null` branch returned the
 *    fallback without either report, leaving the viewer in `loading` with no progress, no
 *    auto-advance, no error copy and no retry.
 *
 * Case 1 is the verifier's own probe made permanent. Its ceiling throw is load-bearing: without it
 * a regression would exhaust the heap here exactly as the probe did, and an OOM-killed run has no
 * test counts and proves nothing.
 */

/** Two orders of magnitude above the settled count. Crossing it IS the loop, reported not suffered. */
const RENDER_CEILING = 400;
const CEILING_MESSAGE = `MediaImage render count exceeded ${RENDER_CEILING}`;

const WIDTHS = [320, 640, 1080] as const;

let renderCount = 0;
/** Spies rather than counters, so every assertion below reads as an explicit CALL COUNT. */
const onReadyReport = vi.fn();
const onFailedReport = vi.fn();

function bumpRender() {
  renderCount += 1;
  if (renderCount > RENDER_CEILING) throw new Error(CEILING_MESSAGE);
}

/**
 * The story viewer's shape, reduced to its essentials: a parent that writes a FRESH object into
 * state on the report and therefore rebuilds both report props on every render.
 */
function ReportingParent({
  assetId,
  widths,
  baseWidth,
}: {
  assetId: string;
  widths: readonly number[];
  baseWidth?: number;
}) {
  const [, setState] = useState<Record<string, string>>({});
  bumpRender();
  return (
    <MediaImage
      assetId={assetId}
      widths={widths}
      alt=""
      sizes="100vw"
      baseWidth={baseWidth}
      ratio=""
      fit="contain"
      onReady={() => {
        onReadyReport();
        setState((state) => ({ ...state, [assetId]: 'ready' }));
      }}
      onFailed={() => {
        onFailedReport();
        setState((state) => ({ ...state, [assetId]: 'error' }));
      }}
      fallback={<span data-testid="media-fallback" />}
    />
  );
}

/**
 * The image element's decoded state, forced on the prototype — the branch a SERVER-RENDERED image
 * takes, where neither `load` nor `error` is ever delivered to a React handler. Descriptors are
 * saved and restored rather than deleted, so happy-dom's own accessors survive the suite.
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
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[key];
  }
  savedDescriptors.clear();
}

beforeEach(() => {
  renderCount = 0;
  onReadyReport.mockClear();
  onFailedReport.mockClear();
});

afterEach(() => {
  cleanup();
  restoreImageState();
  vi.unstubAllGlobals();
});

describe('MediaImage — the reporting contract (R-05, CR-03)', () => {
  it('1. a decoded image under a caller that rebuilds both reports every render SETTLES', () => {
    forceImageState(true, 800);

    render(<ReportingParent assetId="asset-loop" widths={WIDTHS} baseWidth={1080} />);

    // The verifier's probe, made permanent. Before the fix this line is never reached.
    expect(renderCount).toBeLessThan(10);
    expect(onReadyReport).toHaveBeenCalledTimes(1);
    expect(onFailedReport).toHaveBeenCalledTimes(0);
  });

  it('2. an EMPTY variant ladder reports FAILURE exactly once and renders the fallback (CR-03)', () => {
    forceImageState(true, 800);

    // The admin history (`listOwnStories`) omits the `status = 'ready'` filter, so a
    // still-transcoding asset reaches the viewer with no variants published yet.
    render(<ReportingParent assetId="asset-empty" widths={[]} />);

    expect(onFailedReport).toHaveBeenCalledTimes(1);
    expect(onReadyReport).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('media-fallback')).toBeInTheDocument();
    // There is nothing to render, so there must be no `<img>` at all — not a broken-image glyph.
    expect(document.querySelector('img')).toBeNull();
  });

  it('3. an image that decoded to ZERO natural width reports FAILURE exactly once', () => {
    // A fetch that ended without an image: expired, deleted, or another tenant's asset.
    forceImageState(true, 0);

    render(<ReportingParent assetId="asset-broken" widths={WIDTHS} baseWidth={1080} />);

    expect(onFailedReport).toHaveBeenCalledTimes(1);
    expect(onReadyReport).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('media-fallback')).toBeInTheDocument();
  });

  it('4. the happy path reports READY exactly once, and a parent re-render fires neither again', () => {
    forceImageState(true, 800);

    const { rerender } = render(
      <ReportingParent assetId="asset-ok" widths={WIDTHS} baseWidth={1080} />,
    );

    expect(onReadyReport).toHaveBeenCalledTimes(1);
    expect(onFailedReport).toHaveBeenCalledTimes(0);

    act(() => {
      rerender(<ReportingParent assetId="asset-ok" widths={WIDTHS} baseWidth={1080} />);
    });

    expect(onReadyReport).toHaveBeenCalledTimes(1);
    expect(onFailedReport).toHaveBeenCalledTimes(0);
  });
});
