// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBarHeightAnchor } from './useBarHeightAnchor';

/**
 * 12.4-12 Task 2 (UI-D-830, sketch 023 review outcome 1): the member's case bar changes height when a
 * live state change makes the "Meus chamados" link wrap, and the thread must not jump. The metrics are
 * stubbed (happy-dom lays nothing out) and the ResizeObserver is driven by hand.
 */

type Entry = { contentRect: { height: number } };
let observed: ((entries: Entry[]) => void) | null = null;
let disconnected = 0;

beforeEach(() => {
  observed = null;
  disconnected = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: Entry[]) => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {
        disconnected += 1;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

function scrollerWith({ scrollHeight, clientHeight, scrollTop }: Record<string, number>) {
  const el = document.createElement('div');
  let top = scrollTop as number;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => (el.dataset.client ? Number(el.dataset.client) : (clientHeight as number)),
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  return el;
}

const mount = (scroller: HTMLElement) => {
  const bar = document.createElement('div');
  return renderHook(() => useBarHeightAnchor({ current: bar }, { current: scroller }));
};

describe('useBarHeightAnchor', () => {
  it('moves scrollTop by the bar growth so the content under the reader does not move', () => {
    const scroller = scrollerWith({ scrollHeight: 2000, clientHeight: 500, scrollTop: 300 });
    mount(scroller);
    observed?.([{ contentRect: { height: 82 } }]); // baseline only
    expect(scroller.scrollTop).toBe(300);

    scroller.dataset.client = '464'; // the scroller shrank by the bar's growth
    observed?.([{ contentRect: { height: 118 } }]); // +36
    expect(scroller.scrollTop).toBe(336);
  });

  it('moves scrollTop back when the bar shrinks', () => {
    const scroller = scrollerWith({ scrollHeight: 2000, clientHeight: 464, scrollTop: 300 });
    mount(scroller);
    observed?.([{ contentRect: { height: 118 } }]);
    scroller.dataset.client = '500';
    observed?.([{ contentRect: { height: 82 } }]);
    expect(scroller.scrollTop).toBe(264);
  });

  it('keeps a reader who is at the bottom at the bottom', () => {
    // scrollHeight 1000, client 500, top 500: distance 0.
    const scroller = scrollerWith({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    mount(scroller);
    observed?.([{ contentRect: { height: 82 } }]);
    scroller.dataset.client = '464';
    observed?.([{ contentRect: { height: 118 } }]);
    expect(scroller.scrollTop).toBe(1000);
  });

  it('does nothing when the height did not change, and ignores the baseline callback', () => {
    const scroller = scrollerWith({ scrollHeight: 2000, clientHeight: 500, scrollTop: 300 });
    mount(scroller);
    observed?.([{ contentRect: { height: 82 } }]);
    observed?.([{ contentRect: { height: 82 } }]);
    expect(scroller.scrollTop).toBe(300);
  });

  it('follows the reader when they scroll away from the bottom before the change', () => {
    const scroller = scrollerWith({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    mount(scroller);
    observed?.([{ contentRect: { height: 82 } }]);
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    scroller.dataset.client = '464';
    observed?.([{ contentRect: { height: 118 } }]);
    expect(scroller.scrollTop).toBe(136);
  });

  it('disconnects the observer on unmount and is a no-op without ResizeObserver', () => {
    const scroller = scrollerWith({ scrollHeight: 2000, clientHeight: 500, scrollTop: 300 });
    const { unmount } = mount(scroller);
    unmount();
    expect(disconnected).toBe(1);

    vi.stubGlobal('ResizeObserver', undefined);
    const again = scrollerWith({ scrollHeight: 2000, clientHeight: 500, scrollTop: 300 });
    expect(() => mount(again).unmount()).not.toThrow();
  });
});
