import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet, useKeyboardInset } from '../src/index';

/**
 * 04-UI-SPEC E12: "with the mobile keyboard open the sheet's input stays pinned above it" (#4).
 *
 * iOS Safari and Android Chrome shrink only `window.visualViewport` when the keyboard opens; the
 * layout viewport the sheet is anchored to keeps its height, so the whole sheet sat behind the
 * keyboard. happy-dom has no `visualViewport` and Playwright's Chromium has no software keyboard,
 * so this file stubs the one the phone would report: an iPhone 14 layout viewport (844px) and a
 * visual viewport the keyboard shrinks to 500px.
 */

/** The three numbers the hook reads, on an `EventTarget` so `resize`/`scroll` can be dispatched. */
class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

const LAYOUT_HEIGHT = 844;
let frames: FrameRequestCallback[] = [];
const saved: Record<'innerHeight' | 'visualViewport', PropertyDescriptor | undefined> = {
  innerHeight: undefined,
  visualViewport: undefined,
};

function restore(key: keyof typeof saved) {
  const descriptor = saved[key];
  if (descriptor) Object.defineProperty(window, key, descriptor);
  else Reflect.deleteProperty(window, key);
}

function installViewport(): FakeVisualViewport {
  const viewport = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  return viewport;
}

/** Runs the frames the hook asked for, the way the browser would on its next paint. */
function flushFrames() {
  act(() => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  });
}

function dispatch(viewport: FakeVisualViewport, ...types: string[]) {
  act(() => {
    for (const type of types) viewport.dispatchEvent(new Event(type));
  });
}

function renderSheet(open = true) {
  const view = render(
    <BottomSheet open={open} title="Comentários" onClose={() => {}}>
      <input aria-label="Comentário" />
    </BottomSheet>,
  );
  const parts = () => {
    const panel = screen.getByRole('dialog', { name: 'Comentários' });
    return { panel, root: panel.parentElement as HTMLElement };
  };
  return { ...view, parts };
}

beforeEach(() => {
  frames = [];
  saved.innerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  saved.visualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: LAYOUT_HEIGHT });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  restore('innerHeight');
  restore('visualViewport');
});

describe('BottomSheet above the phone keyboard (useKeyboardInset)', () => {
  it('pads the root by the covered strip, caps the panel at the visible height and drops pb-safe', () => {
    const viewport = installViewport();
    const { parts } = renderSheet();
    expect(parts().root.style.paddingBottom).toBe('');
    expect(parts().panel.classList.contains('pb-safe')).toBe(true);

    // The keyboard's own animation fires a burst of events: ONE frame reads them all.
    viewport.height = 500;
    dispatch(viewport, 'resize', 'scroll', 'resize');
    expect(frames).toHaveLength(1);
    flushFrames();

    const { root, panel } = parts();
    expect(root.style.paddingBottom).toBe('344px');
    expect(panel.style.maxHeight).toBe('calc(500px - var(--safe-top))');
    // The home indicator is under the keyboard: no second floor under the panel.
    expect(panel.classList.contains('pb-safe')).toBe(false);

    // The keyboard goes down: everything returns to the resting geometry.
    viewport.height = LAYOUT_HEIGHT;
    dispatch(viewport, 'resize');
    flushFrames();
    expect(parts().root.style.paddingBottom).toBe('');
    expect(parts().panel.style.maxHeight).toBe('');
    expect(parts().panel.classList.contains('pb-safe')).toBe(true);
  });

  it('counts what iOS panned away: offsetTop comes off the covered strip', () => {
    const viewport = installViewport();
    const { parts } = renderSheet();
    viewport.height = 500;
    viewport.offsetTop = 300;
    dispatch(viewport, 'scroll');
    flushFrames();
    expect(parts().root.style.paddingBottom).toBe('44px');
    expect(parts().panel.style.maxHeight).toBe('calc(500px - var(--safe-top))');
  });

  it('a FULL pan leaves nothing to lift, yet only 500px are on screen: still capped, no pb-safe', () => {
    // What iOS does when the member taps the field: it pans the page until the field shows. The
    // panel's floor is already the keyboard's top edge, but its title would sit above the screen.
    const viewport = installViewport();
    const { parts } = renderSheet();
    viewport.height = 500;
    viewport.offsetTop = LAYOUT_HEIGHT - 500;
    dispatch(viewport, 'resize', 'scroll');
    flushFrames();
    expect(parts().root.style.paddingBottom).toBe('');
    expect(parts().panel.style.maxHeight).toBe('calc(500px - var(--safe-top))');
    expect(parts().panel.classList.contains('pb-safe')).toBe(false);
  });

  it('sub-pixel rounding between the two viewports is not a keyboard', () => {
    const viewport = installViewport();
    viewport.height = LAYOUT_HEIGHT - 0.6;
    const { parts } = renderSheet();
    expect(parts().root.style.paddingBottom).toBe('');
    expect(parts().panel.style.maxHeight).toBe('');
    expect(parts().panel.classList.contains('pb-safe')).toBe(true);
  });

  it('a sheet that opens with the keyboard ALREADY up is lifted at once', () => {
    const viewport = installViewport();
    viewport.height = 500;
    const { parts } = renderSheet();
    expect(parts().root.style.paddingBottom).toBe('344px');
  });

  it('a pinch-zoom is not a keyboard: a scale of 2 moves nothing', () => {
    const viewport = installViewport();
    const { parts } = renderSheet();
    viewport.scale = 2;
    viewport.height = 422;
    dispatch(viewport, 'resize');
    flushFrames();
    expect(parts().root.style.paddingBottom).toBe('');
    expect(parts().panel.style.maxHeight).toBe('');
    expect(parts().panel.classList.contains('pb-safe')).toBe(true);
  });

  it('without a visualViewport (happy-dom, older engines) nothing is measured or moved', () => {
    expect(window.visualViewport ?? null).toBeNull();
    const { parts } = renderSheet();
    expect(frames).toHaveLength(0);
    expect(parts().root.style.paddingBottom).toBe('');
    expect(parts().panel.style.maxHeight).toBe('');
    expect(parts().panel.classList.contains('pb-safe')).toBe(true);
  });

  it('closing the sheet removes both listeners, and a later resize schedules nothing', () => {
    const viewport = installViewport();
    const added = vi.spyOn(viewport, 'addEventListener');
    const removed = vi.spyOn(viewport, 'removeEventListener');
    const { rerender } = renderSheet();
    expect(added.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);

    rerender(
      <BottomSheet open={false} title="Comentários" onClose={() => {}}>
        <input aria-label="Comentário" />
      </BottomSheet>,
    );
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);
    for (const [type, listener] of added.mock.calls) {
      expect(removed).toHaveBeenCalledWith(type, listener);
    }

    viewport.height = 500;
    dispatch(viewport, 'resize');
    expect(frames).toHaveLength(0);
  });

  it('a closed sheet never listens', () => {
    const viewport = installViewport();
    const added = vi.spyOn(viewport, 'addEventListener');
    renderSheet(false);
    expect(added).not.toHaveBeenCalled();
  });
});

/**
 * `keyboardHeight` (2026-10-02): the reading the kernel BottomNav steps aside on. It is what the
 * visual viewport LOST, so unlike `inset` it survives the pan iOS and Android make to reveal a
 * field near the bottom, which is exactly when the nav, bound to the layout viewport, lands on the
 * keyboard's top edge.
 */
describe('useKeyboardInset: keyboardHeight answers "is a keyboard up?" whatever the pan', () => {
  it('reports the height the keyboard took, and 0 again once it goes down', () => {
    const viewport = installViewport();
    const { result } = renderHook(() => useKeyboardInset(true));
    expect(result.current).toEqual({ inset: 0, viewportHeight: null, keyboardHeight: 0 });

    viewport.height = 500;
    dispatch(viewport, 'resize');
    flushFrames();
    expect(result.current).toEqual({ inset: 344, viewportHeight: 500, keyboardHeight: 344 });

    viewport.height = LAYOUT_HEIGHT;
    dispatch(viewport, 'resize');
    flushFrames();
    expect(result.current).toEqual({ inset: 0, viewportHeight: null, keyboardHeight: 0 });
  });

  it('a FULL pan takes inset to 0 and leaves keyboardHeight: the keyboard is still up', () => {
    const viewport = installViewport();
    viewport.height = 500;
    viewport.offsetTop = LAYOUT_HEIGHT - 500;
    const { result } = renderHook(() => useKeyboardInset(true));
    expect(result.current).toEqual({ inset: 0, viewportHeight: 500, keyboardHeight: 344 });
  });

  it('a reading where only keyboardHeight moves is still a new reading', () => {
    const viewport = installViewport();
    viewport.height = 500;
    viewport.offsetTop = LAYOUT_HEIGHT - 500;
    const { result } = renderHook(() => useKeyboardInset(true));
    // The layout viewport grows (the toolbars went away) and the pan follows it: inset stays 0 and
    // the visible height stays 500, only what the keyboard took changes.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    viewport.offsetTop = 400;
    dispatch(viewport, 'resize', 'scroll');
    flushFrames();
    expect(result.current).toEqual({ inset: 0, viewportHeight: 500, keyboardHeight: 400 });
  });

  it('a pinch-zoom, a missing visualViewport and an inactive hook all read 0', () => {
    expect(renderHook(() => useKeyboardInset(true)).result.current.keyboardHeight).toBe(0);

    const viewport = installViewport();
    viewport.height = 500;
    expect(renderHook(() => useKeyboardInset(false)).result.current.keyboardHeight).toBe(0);

    viewport.scale = 2;
    viewport.height = 422;
    expect(renderHook(() => useKeyboardInset(true)).result.current.keyboardHeight).toBe(0);
  });
});
