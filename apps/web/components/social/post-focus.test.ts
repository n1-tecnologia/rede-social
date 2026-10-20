import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeFocusAfterFollow, markFocusAfterFollow } from './post-focus';

/**
 * 09-11 (UI-D-499, planning decision 3): the one-shot that carries "focus the post" across the server
 * re-render of the same URL. It is a module variable, not a query parameter, so the shared link stays
 * the shared link. The claims: it answers true exactly once for the post that was marked, never for
 * another post, a later mark replaces an earlier one, and a mark nobody consumed goes stale.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('post-focus', () => {
  it('F1: consume is true once for the marked post, then false', () => {
    markFocusAfterFollow('post-a');
    expect(consumeFocusAfterFollow('post-a')).toBe(true);
    expect(consumeFocusAfterFollow('post-a')).toBe(false);
  });

  it('F2: another post never consumes the mark, and does not clear it', () => {
    markFocusAfterFollow('post-a');
    expect(consumeFocusAfterFollow('post-b')).toBe(false);
    expect(consumeFocusAfterFollow('post-a')).toBe(true);
  });

  it('F3: nothing marked is false', () => {
    expect(consumeFocusAfterFollow('post-a')).toBe(false);
  });

  it('F4: a later mark replaces the earlier one', () => {
    markFocusAfterFollow('post-a');
    markFocusAfterFollow('post-b');
    expect(consumeFocusAfterFollow('post-a')).toBe(false);
    expect(consumeFocusAfterFollow('post-b')).toBe(true);
  });

  it('F5: a mark nobody consumed within ten seconds is stale', () => {
    markFocusAfterFollow('post-a');
    vi.advanceTimersByTime(10_001);
    expect(consumeFocusAfterFollow('post-a')).toBe(false);
  });
});
