// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  knownVideoRatio,
  loadPoster,
  MAX_RATIOS,
  probePosterRatio,
  rememberVideoRatio,
  resetVideoRatios,
  subscribeVideoRatios,
  useKnownVideoRatio,
} from './video-ratio';

/**
 * 2026-10-09 — the proportion every video surface learns in the browser (the feed card and the Reel
 * share it): remembered per asset for the tab, read back by a new document, capped, and never broken
 * by a storage that throws. The poster probe runs on an off-DOM image, stubbed here with the three
 * outcomes a real one has (a size, an error, a zero size).
 */

const KEY = 'rede-social:video-ratios';

function stored(): Record<string, number> {
  return JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}') as Record<string, number>;
}

/** An `Image` stand-in that settles on the next microtask the way the case asks. */
function stubImage(outcome: { width: number; height: number } | 'error') {
  const created: { src: string }[] = [];
  class PosterStandIn {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    #src = '';
    constructor() {
      created.push(this);
    }
    get src() {
      return this.#src;
    }
    set src(url: string) {
      this.#src = url;
      queueMicrotask(() => {
        if (outcome === 'error') {
          this.onerror?.();
          return;
        }
        this.naturalWidth = outcome.width;
        this.naturalHeight = outcome.height;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('Image', PosterStandIn);
  return created;
}

beforeEach(() => {
  resetVideoRatios();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetVideoRatios();
});

describe('video-ratio — what a surface learns, the tab remembers', () => {
  it('is unknown until a surface remembers it, then known for that asset only', () => {
    expect(knownVideoRatio('asset-a')).toBeNull();
    rememberVideoRatio('asset-a', 9 / 16);
    expect(knownVideoRatio('asset-a')).toBeCloseTo(9 / 16, 6);
    expect(knownVideoRatio('asset-b')).toBeNull();
  });

  it('keeps the RAW ratio (each surface clamps on its own) in sessionStorage', () => {
    rememberVideoRatio('asset-a', 3 / 1);
    expect(stored()).toEqual({ 'asset-a': 3 });
  });

  it('ignores a value that is no ratio', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      rememberVideoRatio('asset-a', bad);
    }
    expect(knownVideoRatio('asset-a')).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a new document reads what the previous one stored (a reload, a full-page link)', async () => {
    rememberVideoRatio('asset-a', 16 / 9);
    vi.resetModules();
    const fresh = await import('./video-ratio');
    expect(fresh.knownVideoRatio('asset-a')).toBeCloseTo(16 / 9, 6);
  });

  it('drops what it did not write: unparsable storage, or entries that are no ratio', async () => {
    window.sessionStorage.setItem(KEY, '{nope');
    vi.resetModules();
    const broken = await import('./video-ratio');
    expect(broken.knownVideoRatio('asset-a')).toBeNull();

    window.sessionStorage.setItem(KEY, JSON.stringify({ a: 'wide', b: -2, c: 0.8 }));
    vi.resetModules();
    const mixed = await import('./video-ratio');
    expect(mixed.knownVideoRatio('a')).toBeNull();
    expect(mixed.knownVideoRatio('b')).toBeNull();
    expect(mixed.knownVideoRatio('c')).toBe(0.8);
  });

  it(`keeps at most ${MAX_RATIOS} assets, the oldest dropped first`, () => {
    for (let n = 0; n < MAX_RATIOS + 5; n += 1) rememberVideoRatio(`asset-${n}`, 1 + n / 1000);
    expect(Object.keys(stored())).toHaveLength(MAX_RATIOS);
    expect(knownVideoRatio('asset-0')).toBeNull();
    expect(knownVideoRatio('asset-4')).toBeNull();
    expect(knownVideoRatio('asset-5')).not.toBeNull();
    expect(knownVideoRatio(`asset-${MAX_RATIOS + 4}`)).not.toBeNull();
  });

  it('a storage that throws keeps the ratios in memory for the document', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    rememberVideoRatio('asset-a', 1.5);
    expect(knownVideoRatio('asset-a')).toBe(1.5);
  });

  it('tells the subscribers when a ratio changes, and not when the same one comes again', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVideoRatios(listener);
    rememberVideoRatio('asset-a', 0.5625);
    rememberVideoRatio('asset-a', 0.5625);
    expect(listener).toHaveBeenCalledTimes(1);
    rememberVideoRatio('asset-a', 0.8);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    rememberVideoRatio('asset-a', 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('useKnownVideoRatio follows the store live', () => {
    const { result } = renderHook(() => useKnownVideoRatio('asset-a'));
    expect(result.current).toBeNull();
    act(() => {
      rememberVideoRatio('asset-a', 16 / 9);
    });
    expect(result.current).toBeCloseTo(16 / 9, 6);
  });
});

describe('video-ratio — the poster probe', () => {
  it('resolves the poster’s own width / height, on an image that never enters the page', async () => {
    const created = stubImage({ width: 1080, height: 1920 });
    await expect(probePosterRatio('https://image.example/thumbnail.webp?token=t')).resolves.toBe(
      1080 / 1920,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe('https://image.example/thumbnail.webp?token=t');
    expect(document.querySelector('img')).toBeNull();
  });

  it('a poster that fails to load is no ratio', async () => {
    stubImage('error');
    await expect(probePosterRatio('https://image.example/missing.webp')).resolves.toBeNull();
  });

  it('a poster with no size is no ratio and no image', async () => {
    stubImage({ width: 0, height: 0 });
    await expect(probePosterRatio('https://image.example/empty.webp')).resolves.toBeNull();
    await expect(loadPoster('https://image.example/empty.webp')).resolves.toBeNull();
  });

  it('loadPoster hands back the decoded image itself', async () => {
    stubImage({ width: 1920, height: 1080 });
    const image = await loadPoster('https://image.example/wide.webp');
    expect(image?.naturalWidth).toBe(1920);
    expect(image?.naturalHeight).toBe(1080);
  });
});
