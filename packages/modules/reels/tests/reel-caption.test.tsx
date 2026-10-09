// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReelCaption, type ReelCaptionProps } from '../ui/ReelCaption';

/**
 * The caption block (REELS-07, UI-D-88, D-129, D-131): the author, the community chip and the
 * caption clamped to two RENDERED lines, expanding over a darker veil without pausing anything.
 *
 * happy-dom does no layout, so the paragraph's `scrollHeight`/`clientHeight` are stubbed on the
 * prototype for the element the component marks `data-reel-caption-text`. Strings are sentinel
 * ASCII; the linkified body arrives as children, exactly as the host passes it (D-54's one sink).
 */

const layout = { scrollHeight: 0, clientHeight: 0 };
const saved = {
  scroll: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
  client: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
};

function isCaptionText(el: HTMLElement): boolean {
  return el.hasAttribute('data-reel-caption-text');
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isCaptionText(this) ? layout.scrollHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isCaptionText(this) ? layout.clientHeight : 0;
    },
  });
});

afterAll(() => {
  if (saved.scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', saved.scroll);
  if (saved.client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', saved.client);
});

beforeEach(() => {
  layout.scrollHeight = 40;
  layout.clientHeight = 40;
});

afterEach(() => {
  cleanup();
});

const COMMUNITY = {
  name: 'community-name',
  href: '/comunidades/c-1',
  ariaLabel: 'community-aria-label',
};

function props(overrides: Partial<ReelCaptionProps> = {}): ReelCaptionProps {
  return {
    author: { name: 'author-name', href: '/membros/m-1' },
    community: null,
    children: 'caption body',
    moreLabel: 'more-label',
    lessLabel: 'less-label',
    expanded: false,
    onExpandedChange: vi.fn(),
    ...overrides,
  };
}

const text = (container: HTMLElement) => container.querySelector('[data-reel-caption-text]');
const veil = (container: HTMLElement) => container.querySelector('[data-reel-caption-veil]');

describe('ReelCaption — author and community chip (UI-D-88, D-129)', () => {
  it('the author name is a plain link to the profile, one truncating line', () => {
    render(<ReelCaption {...props()} />);
    const author = screen.getByRole('link', { name: 'author-name' });
    expect(author).toHaveAttribute('href', '/membros/m-1');
    for (const cls of ['truncate', 'text-base', 'font-bold', 'text-white']) {
      expect(author.className).toContain(cls);
    }
  });

  it('with community null there is no chip link', () => {
    render(<ReelCaption {...props({ community: null })} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'community-aria-label' })).toBeNull();
  });

  it('with a community the chip link carries its href and accessible name around a 28 px pill', () => {
    render(<ReelCaption {...props({ community: COMMUNITY })} />);
    const chip = screen.getByRole('link', { name: 'community-aria-label' });
    expect(chip).toHaveAttribute('href', '/comunidades/c-1');
    expect(chip.className).toContain('min-h-11');
    const pill = chip.firstElementChild as HTMLElement;
    expect(pill).toHaveTextContent('community-name');
    for (const cls of ['h-7', 'rounded-full', 'bg-white/20', 'truncate', 'max-w-full']) {
      expect(pill.className).toContain(cls);
    }
  });

  it('with no children there is no paragraph and no toggle', () => {
    layout.scrollHeight = 41;
    const { container } = render(<ReelCaption {...props({ children: undefined })} />);
    expect(text(container)).toBeNull();
    expect(container.querySelector('p')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'author-name' })).toBeInTheDocument();
  });

  it('an empty-string caption is the same as none', () => {
    const { container } = render(<ReelCaption {...props({ children: '' })} />);
    expect(text(container)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ReelCaption — the author’s Instagram line (2026-10-09)', () => {
  const HANDLE = {
    label: 'handle-label',
    href: 'https://instagram.example/handle',
    ariaLabel: 'handle-aria-label',
  };

  it('renders the handle under the author as its own link, opening a new tab', () => {
    render(
      <ReelCaption
        {...props({
          author: { name: 'author-name', href: '/membros/m-1', handle: HANDLE },
          community: COMMUNITY,
        })}
      />,
    );
    const handle = screen.getByRole('link', { name: 'handle-aria-label' });
    expect(handle).toHaveAttribute('href', 'https://instagram.example/handle');
    expect(handle).toHaveAttribute('target', '_blank');
    expect(handle).toHaveAttribute('rel', 'noopener noreferrer');
    expect(handle).toHaveAttribute('data-reel-handle');
    expect(handle).toHaveTextContent('handle-label');
    for (const cls of ['truncate', 'text-white/80', 'focus-visible:ring-white']) {
      expect(handle.className).toContain(cls);
    }
    // Under the name, above the community chip.
    const author = screen.getByRole('link', { name: 'author-name' });
    const chip = screen.getByRole('link', { name: 'community-aria-label' });
    expect(author.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a pointer on the handle never reaches the pager tap surface', () => {
    const outer = vi.fn();
    render(
      <div onPointerDown={outer} onPointerUp={outer}>
        <ReelCaption
          {...props({ author: { name: 'author-name', href: '/membros/m-1', handle: HANDLE } })}
        />
      </div>,
    );
    const handle = screen.getByRole('link', { name: 'handle-aria-label' });
    fireEvent.pointerDown(handle);
    fireEvent.pointerUp(handle);
    expect(outer).not.toHaveBeenCalled();
  });

  it('absent or null renders no line', () => {
    const { rerender } = render(<ReelCaption {...props()} />);
    expect(document.querySelector('[data-reel-handle]')).toBeNull();
    rerender(
      <ReelCaption
        {...props({ author: { name: 'author-name', href: '/membros/m-1', handle: null } })}
      />,
    );
    expect(document.querySelector('[data-reel-handle]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('ReelCaption — the measured two-line clamp (REELS-07 boundary, UI-D-88, D-131)', () => {
  it('collapsed is line-clamp-2 with the caption style', () => {
    const { container } = render(<ReelCaption {...props()} />);
    const p = text(container) as HTMLElement;
    for (const cls of [
      'line-clamp-2',
      'whitespace-pre-wrap',
      'break-words',
      'text-sm',
      'text-white',
    ]) {
      expect(p.className).toContain(cls);
    }
    expect(p.className).not.toContain('max-h-[40vh]');
  });

  it('a caption that exactly fills two lines (40 = 40) shows no "… mais"', () => {
    render(<ReelCaption {...props()} />);
    expect(screen.queryByRole('button', { name: 'more-label' })).toBeNull();
  });

  it('one pixel of overflow (41 > 40) shows "… mais" with aria-expanded false', () => {
    layout.scrollHeight = 41;
    render(<ReelCaption {...props()} />);
    const more = screen.getByRole('button', { name: 'more-label' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    for (const cls of ['absolute', 'right-0', 'bottom-0', 'pl-6', 'text-white/70', 'font-bold']) {
      expect(more.className).toContain(cls);
    }
  });

  it('"… mais" and "menos" reach a 44 px hit area without moving their label (UI-REVIEW fix 1)', () => {
    layout.scrollHeight = 41;
    const { rerender } = render(<ReelCaption {...props()} />);
    const more = screen.getByRole('button', { name: 'more-label' });
    for (const cls of [
      'after:absolute',
      'after:inset-x-0',
      'after:-inset-y-3',
      'absolute',
      'right-0',
      'bottom-0',
      'pl-6',
    ]) {
      expect(more.className).toContain(cls);
    }
    expect(more.className).not.toContain('min-h-11');

    rerender(<ReelCaption {...props({ expanded: true })} />);
    const less = screen.getByRole('button', { name: 'less-label' });
    expect(less.className).toContain('pt-6');
    expect(less.className).toContain('-mt-6');
  });

  it('clicking "… mais" calls onExpandedChange(true) once', () => {
    layout.scrollHeight = 41;
    const onExpandedChange = vi.fn();
    render(<ReelCaption {...props({ onExpandedChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'more-label' }));
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('a tap on the overflowing caption text expands it', () => {
    layout.scrollHeight = 41;
    const onExpandedChange = vi.fn();
    const { container } = render(<ReelCaption {...props({ onExpandedChange })} />);
    fireEvent.click(text(container) as HTMLElement);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('re-measures when the box resizes', () => {
    const observers: { cb: ResizeObserverCallback }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push({ cb });
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      render(<ReelCaption {...props()} />);
      expect(screen.queryByRole('button', { name: 'more-label' })).toBeNull();
      expect(observers.length).toBeGreaterThan(0);
      layout.scrollHeight = 60;
      act(() => {
        for (const o of observers) o.cb([], {} as ResizeObserver);
      });
      expect(screen.getByRole('button', { name: 'more-label' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ReelCaption — expanded (UI-D-88, D-131)', () => {
  it('shows "menos" with aria-expanded true, drops the clamp and scrolls inside 40vh', () => {
    layout.scrollHeight = 41;
    const { container } = render(<ReelCaption {...props({ expanded: true })} />);
    const less = screen.getByRole('button', { name: 'less-label' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'more-label' })).toBeNull();
    const p = text(container) as HTMLElement;
    expect(p.className).not.toContain('line-clamp-2');
    for (const cls of ['max-h-[40vh]', 'overflow-y-auto', 'overscroll-contain']) {
      expect(p.className).toContain(cls);
    }
    expect(p.style.touchAction).toBe('pan-y');
  });

  it('renders the veil only when expanded, before the caption block and under the overlays', () => {
    const { container, rerender } = render(<ReelCaption {...props()} />);
    expect(veil(container)).toBeNull();
    rerender(<ReelCaption {...props({ expanded: true })} />);
    const v = veil(container) as HTMLElement;
    expect(v).not.toBeNull();
    for (const cls of ['absolute', 'inset-0', 'z-[2]', 'bg-black/50', 'duration-200']) {
      expect(v.className).toContain(cls);
    }
    const block = text(container)?.closest('[data-reel-caption]') as HTMLElement;
    expect(v.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.className).toContain('z-[3]');
  });

  it('clicking the veil calls onExpandedChange(false)', () => {
    const onExpandedChange = vi.fn();
    const { container } = render(<ReelCaption {...props({ expanded: true, onExpandedChange })} />);
    fireEvent.click(veil(container) as HTMLElement);
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('clicking "menos" calls onExpandedChange(false) exactly once', () => {
    const onExpandedChange = vi.fn();
    render(<ReelCaption {...props({ expanded: true, onExpandedChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'less-label' }));
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('a tap on the expanded caption text collapses it', () => {
    const onExpandedChange = vi.fn();
    const { container } = render(<ReelCaption {...props({ expanded: true, onExpandedChange })} />);
    fireEvent.click(text(container) as HTMLElement);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('clicking a link inside the children toggles nothing, collapsed or expanded', () => {
    layout.scrollHeight = 41;
    const onExpandedChange = vi.fn();
    const body = (
      <>
        see{' '}
        <a href="https://example.com" rel="noopener noreferrer nofollow">
          link-text
        </a>
      </>
    );
    const { rerender } = render(<ReelCaption {...props({ onExpandedChange, children: body })} />);
    fireEvent.click(screen.getByRole('link', { name: 'link-text' }));
    rerender(<ReelCaption {...props({ onExpandedChange, children: body, expanded: true })} />);
    fireEvent.click(screen.getByRole('link', { name: 'link-text' }));
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('links in the caption are re-coloured white, bold and underlined over media', () => {
    const { container } = render(<ReelCaption {...props()} />);
    const p = text(container) as HTMLElement;
    for (const cls of ['[&_a]:text-white', '[&_a]:font-bold', '[&_a]:underline']) {
      expect(p.className).toContain(cls);
    }
  });

  it('a pointer on the caption block or the veil never reaches the pager tap surface', () => {
    const outer = vi.fn();
    const { container } = render(
      <div onPointerDown={outer} onPointerUp={outer}>
        <ReelCaption {...props({ expanded: true })} />
      </div>,
    );
    for (const el of [text(container) as HTMLElement, veil(container) as HTMLElement]) {
      fireEvent.pointerDown(el);
      fireEvent.pointerUp(el);
    }
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('ReelCaption — encoding (REELS-07 encoding edge)', () => {
  it('renders the full text of a caption with emoji, a ZWJ family, a flag and a combining mark', () => {
    const caption = 'Oi 👩‍👩‍👧‍👦 cafe\u0301 🇧🇷 ✨'.repeat(20);
    layout.scrollHeight = 200;
    const { container } = render(<ReelCaption {...props({ children: caption })} />);
    expect(text(container)?.textContent?.startsWith(caption)).toBe(true);
    // Collapsed: the "… mais" button is a sibling of the paragraph, never inside it, so the text is
    // exactly the input with nothing cut.
    expect(text(container)?.textContent).toBe(caption);
  });
});
