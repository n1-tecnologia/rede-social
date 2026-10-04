// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomNav, buildNav, type NavLabels } from '../ui';

vi.mock('next/navigation', () => ({ usePathname: () => '/inicio' }));

/**
 * The BottomNav steps aside for the on-screen keyboard (2026-10-02): it marks itself
 * `data-keyboard-open` and tokens.css hides `[data-shell-nav="bottom"][data-keyboard-open]`. The
 * signal is the visual viewport, never `:focus`: Android's back gesture closes the keyboard without
 * blurring the field, so a focus rule kept the bar hidden with no keyboard on screen.
 *
 * happy-dom has no `visualViewport` and Playwright's Chromium has no software keyboard, so this
 * file stubs what the phone would report: an iPhone 14 layout viewport (844px) and a visual
 * viewport the keyboard shrinks to 500px.
 */

/** The three numbers `useKeyboardInset` reads, on an `EventTarget` to fire `resize`/`scroll`. */
class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

const LAYOUT_HEIGHT = 844;
const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };
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

/** Fires the viewport's events, then runs the frame the hook asked for, as the next paint would. */
function settle(viewport: FakeVisualViewport, ...types: string[]) {
  act(() => {
    for (const type of types) viewport.dispatchEvent(new Event(type));
  });
  act(() => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  });
}

function renderNav() {
  render(<BottomNav tabs={buildNav([], labels).tabs} label="Navegação principal" />);
  return screen.getByRole('navigation', { name: 'Navegação principal' });
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
  cleanup();
  vi.restoreAllMocks();
  restore('innerHeight');
  restore('visualViewport');
});

describe('BottomNav and the on-screen keyboard (data-keyboard-open)', () => {
  it('marks itself while the keyboard is up and drops the mark once it goes down', () => {
    const viewport = installViewport();
    const nav = renderNav();
    expect(nav).toHaveAttribute('data-shell-nav', 'bottom');
    expect(nav).not.toHaveAttribute('data-keyboard-open');

    viewport.height = 500;
    settle(viewport, 'resize');
    expect(nav).toHaveAttribute('data-keyboard-open');

    viewport.height = LAYOUT_HEIGHT;
    settle(viewport, 'resize');
    expect(nav).not.toHaveAttribute('data-keyboard-open');
  });

  it('stays marked when the page is panned to the field (the pan lifts the bar over it)', () => {
    const viewport = installViewport();
    const nav = renderNav();
    viewport.height = 500;
    viewport.offsetTop = LAYOUT_HEIGHT - 500;
    settle(viewport, 'resize', 'scroll');
    expect(nav).toHaveAttribute('data-keyboard-open');
  });

  it('a keyboard ALREADY up when the bar mounts is read at once', () => {
    const viewport = installViewport();
    viewport.height = 500;
    expect(renderNav()).toHaveAttribute('data-keyboard-open');
  });

  it('the browser toolbars collapsing (under 100px) are not a keyboard', () => {
    const viewport = installViewport();
    const nav = renderNav();
    viewport.height = LAYOUT_HEIGHT - 80;
    settle(viewport, 'resize');
    expect(nav).not.toHaveAttribute('data-keyboard-open');
  });

  it('a pinch-zoom is never a keyboard: a scale of 2 marks nothing', () => {
    const viewport = installViewport();
    const nav = renderNav();
    viewport.scale = 2;
    viewport.height = 422;
    settle(viewport, 'resize');
    expect(nav).not.toHaveAttribute('data-keyboard-open');
  });

  it('without a visualViewport (happy-dom, older engines) nothing is measured or marked', () => {
    expect(window.visualViewport ?? null).toBeNull();
    const nav = renderNav();
    expect(frames).toHaveLength(0);
    expect(nav).not.toHaveAttribute('data-keyboard-open');
  });
});
