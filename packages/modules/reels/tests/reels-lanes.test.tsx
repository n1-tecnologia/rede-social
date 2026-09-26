// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReelsLane, ReelsLanes, type ReelsLanesProps } from '../ui/ReelsLanes';

/**
 * The lane row (REELS-04, UI-D-84, D-117, D-118, D-120): an ARIA tablist with automatic activation
 * that renders nothing below two lanes. Strings are sentinel ASCII: the module ships no words
 * (PWA-03), so "Todos" and the tablist name arrive from the host's catalog.
 */

const LONG = 'L'.repeat(60);

function lanes(...keys: string[]): ReelsLane[] {
  return keys.map((key) => ({ key, label: `label-${key}`, tabId: `tab-${key}` }));
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

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubMatchMedia(false);
  scrollSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView'];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function props(overrides: Partial<ReelsLanesProps> = {}): ReelsLanesProps {
  return {
    lanes: lanes('all', 'a', 'b'),
    activeKey: 'all',
    onSelect: vi.fn(),
    label: 'lanes-label',
    panelId: 'reels-panel',
    ...overrides,
  };
}

describe('ReelsLanes — the hidden row (D-120)', () => {
  it('renders nothing at all with a single lane', () => {
    const { container } = render(<ReelsLanes {...props({ lanes: lanes('all') })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with no lane', () => {
    const { container } = render(<ReelsLanes {...props({ lanes: [] })} />);
    expect(container.firstChild).toBeNull();
  });

  it('two lanes render a tablist with two tabs', () => {
    render(<ReelsLanes {...props({ lanes: lanes('all', 'a') })} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});

describe('ReelsLanes — the tablist (UI-D-84)', () => {
  it('three lanes: a tablist named by label, the active tab selected with tabIndex 0, the others -1', () => {
    render(<ReelsLanes {...props()} />);
    const list = screen.getByRole('tablist', { name: 'lanes-label' });
    const tabs = screen.getAllByRole('tab');
    expect(list).toBeInTheDocument();
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs.map((t) => t.textContent)).toEqual(['label-all', 'label-a', 'label-b']);
  });

  it('every tab carries its tabId and aria-controls the pager panel', () => {
    render(<ReelsLanes {...props()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.id)).toEqual(['tab-all', 'tab-a', 'tab-b']);
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', 'reels-panel');
  });

  it('the active tab is white 700 underlined; an idle tab is white/70 with a transparent border', () => {
    render(<ReelsLanes {...props()} />);
    const [active, idle] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement];
    for (const cls of ['font-bold', 'text-white', 'border-b-2', 'border-white', 'h-11']) {
      expect(active.className).toContain(cls);
    }
    for (const cls of ['font-normal', 'text-white/70', 'border-b-2', 'border-transparent']) {
      expect(idle.className).toContain(cls);
    }
  });

  it('the row scrolls inside left-16 right-16 around a centred w-max row', () => {
    render(<ReelsLanes {...props()} />);
    const list = screen.getByRole('tablist');
    for (const cls of ['mx-auto', 'flex', 'w-max', 'gap-4']) expect(list.className).toContain(cls);
    const scroller = list.parentElement as HTMLElement;
    for (const cls of ['overflow-x-auto', 'overscroll-x-contain']) {
      expect(scroller.className).toContain(cls);
    }
    const root = scroller.parentElement as HTMLElement;
    for (const cls of ['absolute', 'left-16', 'right-16', 'z-[3]', 'md:top-4']) {
      expect(root.className).toContain(cls);
    }
  });

  it('a 60-character label is the full accessible name and truncates at max-w-40', () => {
    const long: ReelsLane[] = [
      { key: 'all', label: 'label-all', tabId: 'tab-all' },
      { key: 'long', label: LONG, tabId: 'tab-long' },
    ];
    render(<ReelsLanes {...props({ lanes: long })} />);
    const tab = screen.getByRole('tab', { name: LONG });
    expect(tab.className).toContain('truncate');
    expect(tab.className).toContain('max-w-40');
  });
});

describe('ReelsLanes — selection and keyboard (UI-D-84, automatic activation)', () => {
  it('clicking the second tab calls onSelect with its key', () => {
    const onSelect = vi.fn();
    render(<ReelsLanes {...props({ onSelect })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'label-a' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('ArrowRight on the active first tab selects the second and moves focus to it', () => {
    const onSelect = vi.fn();
    render(<ReelsLanes {...props({ onSelect })} />);
    const first = screen.getByRole('tab', { name: 'label-all' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(screen.getByRole('tab', { name: 'label-a' })).toHaveFocus();
  });

  it('End selects the last lane and Home the first', () => {
    const onSelect = vi.fn();
    render(<ReelsLanes {...props({ onSelect, activeKey: 'a' })} />);
    const middle = screen.getByRole('tab', { name: 'label-a' });
    fireEvent.keyDown(middle, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(middle, { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('all');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('ArrowLeft on the first tab does nothing (no wrap)', () => {
    const onSelect = vi.fn();
    render(<ReelsLanes {...props({ onSelect })} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'label-all' }), { key: 'ArrowLeft' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ArrowLeft on the last tab selects the one before it', () => {
    const onSelect = vi.fn();
    render(<ReelsLanes {...props({ onSelect, activeKey: 'b' })} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'label-b' }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('a pointer on a tab never reaches the pager tap surface behind it', () => {
    const outer = vi.fn();
    render(
      <div onPointerDown={outer} onPointerUp={outer}>
        <ReelsLanes {...props()} />
      </div>,
    );
    const tab = screen.getByRole('tab', { name: 'label-a' });
    fireEvent.pointerDown(tab);
    fireEvent.pointerUp(tab);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('ReelsLanes — the active tab is scrolled into view (UI-D-84 overflow)', () => {
  it('centres the active tab smoothly when activeKey changes', () => {
    const { rerender } = render(<ReelsLanes {...props()} />);
    scrollSpy.mockClear();
    rerender(<ReelsLanes {...props({ activeKey: 'b' })} />);
    expect(scrollSpy).toHaveBeenCalled();
    const call = scrollSpy.mock.calls.at(-1)?.[0];
    expect(call).toEqual({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    expect(scrollSpy.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'label-b' }));
  });

  it('jumps instantly under reduced motion', () => {
    stubMatchMedia(true);
    const { rerender } = render(<ReelsLanes {...props()} />);
    rerender(<ReelsLanes {...props({ activeKey: 'a' })} />);
    expect(scrollSpy.mock.calls.at(-1)?.[0]).toEqual({
      inline: 'center',
      block: 'nearest',
      behavior: 'instant',
    });
  });
});
