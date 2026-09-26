// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactCount } from '../ui/format';
import { ReelRail, type ReelRailProps } from '../ui/ReelRail';

/**
 * The right rail (REELS-07, UI-D-87, D-129, D-130) and the compact count it draws.
 *
 * Strings are sentinel ASCII: the module ships no words (PWA-03). The like node is a stand-in the
 * test builds, exactly as the host (plan 08) builds the feed's `LikeButton` and passes it in — the
 * reels module never imports the feed (MOD-02).
 */

afterEach(() => {
  cleanup();
});

describe('compactCount (REELS-07 precision edge, UI-D-87)', () => {
  // U+00A0 is Intl's own separator before "mil"/"mi"; spelled as an escape so no editor or
  // formatter can silently turn it into a plain space.
  const NBSP = ' ';
  const cases: [number, string | null][] = [
    [0, null],
    [1, '1'],
    [999, '999'],
    [1000, `1${NBSP}mil`],
    [1234, `1,2${NBSP}mil`],
    [1250, `1,3${NBSP}mil`],
    [1950, `2${NBSP}mil`],
    [8000, `8${NBSP}mil`],
    [123400, `123,4${NBSP}mil`],
    [999999, `1${NBSP}mi`],
    [-5, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
  ];

  it.each(cases)('compactCount(%s, pt-BR) is %j', (n, expected) => {
    expect(compactCount(n, 'pt-BR')).toBe(expected);
  });

  it('the separator before "mil" is U+00A0, never a plain space', () => {
    const drawn = compactCount(8000, 'pt-BR');
    expect(drawn).toContain(' ');
    expect(drawn).not.toContain(' ');
  });
});

function props(overrides: Partial<ReelRailProps> = {}): ReelRailProps {
  return {
    author: {
      href: '/membros/m-1',
      avatarUrl: null,
      name: 'author-name',
      label: 'author-profile-label',
    },
    like: (
      <button type="button" data-testid="like-node">
        like-node
      </button>
    ),
    likeCount: null,
    commentLabel: 'comment-label',
    commentCount: null,
    onComment: vi.fn(),
    shareLabel: 'share-label',
    onShare: vi.fn(),
    ...overrides,
  };
}

function slot(container: HTMLElement, which: 'like' | 'comment'): HTMLElement {
  const el = container.querySelector(`[data-reel-count="${which}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no ${which} count slot`);
  return el;
}

describe('ReelRail — order and names (UI-D-87, D-129, D-130)', () => {
  it('renders the author link, the like node, comment, then share, in that DOM order', () => {
    render(<ReelRail {...props()} />);
    const author = screen.getByRole('link', { name: 'author-profile-label' });
    const like = screen.getByTestId('like-node');
    const comment = screen.getByRole('button', { name: 'comment-label' });
    const share = screen.getByRole('button', { name: 'share-label' });
    expect(author).toHaveAttribute('href', '/membros/m-1');
    const order = [author, like, comment, share];
    for (let k = 1; k < order.length; k += 1) {
      const before = order[k - 1] as HTMLElement;
      const after = order[k] as HTMLElement;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('the rail is the fixed 48 px column at the right edge above the nav', () => {
    const { container } = render(<ReelRail {...props()} />);
    const rail = container.firstElementChild as HTMLElement;
    for (const cls of ['absolute', 'right-2', 'z-[3]', 'flex', 'w-12', 'flex-col', 'gap-4']) {
      expect(rail.className).toContain(cls);
    }
    expect(rail.className).toContain('md:bottom-6');
  });

  it('the author link is 44 px and holds the avatar with a white ring', () => {
    render(<ReelRail {...props()} />);
    const author = screen.getByRole('link', { name: 'author-profile-label' });
    expect(author.className).toContain('size-11');
    const avatar = author.querySelector('.ring-white');
    expect(avatar).not.toBeNull();
    expect(avatar?.className).toContain('ring-2');
  });

  it('without onShare there is no share button (no verified primary host, T-04-51)', () => {
    render(<ReelRail {...props({ onShare: undefined })} />);
    expect(screen.queryByRole('button', { name: 'share-label' })).toBeNull();
    expect(screen.getByRole('button', { name: 'comment-label' })).toBeInTheDocument();
  });

  it('clicking comment calls onComment once, and share calls onShare once', () => {
    const onComment = vi.fn();
    const onShare = vi.fn();
    render(<ReelRail {...props({ onComment, onShare })} />);
    fireEvent.click(screen.getByRole('button', { name: 'comment-label' }));
    fireEvent.click(screen.getByRole('button', { name: 'share-label' }));
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('comment and share glyphs are 28 px and white', () => {
    render(<ReelRail {...props()} />);
    for (const name of ['comment-label', 'share-label']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('text-white');
      expect(button.querySelector('svg')?.getAttribute('width')).toBe('28');
    }
  });

  it('a pointer on any rail control never reaches the pager tap surface behind it', () => {
    const outer = vi.fn();
    render(
      <div onPointerDown={outer} onPointerUp={outer}>
        <ReelRail {...props()} />
      </div>,
    );
    for (const el of [
      screen.getByRole('link', { name: 'author-profile-label' }),
      screen.getByTestId('like-node'),
      screen.getByRole('button', { name: 'comment-label' }),
    ]) {
      fireEvent.pointerDown(el);
      fireEvent.pointerUp(el);
    }
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('ReelRail — the reserved count slots (UI-D-87)', () => {
  it('a null like count keeps an empty h-5 slot', () => {
    const { container } = render(<ReelRail {...props({ likeCount: null })} />);
    const like = slot(container, 'like');
    expect(like.className).toContain('h-5');
    expect(like).toBeEmptyDOMElement();
    expect(like).toHaveAttribute('aria-hidden', 'true');
  });

  it("likeCount '8 mil' is drawn, aria-hidden, in the rail's number style", () => {
    const { container } = render(<ReelRail {...props({ likeCount: '8 mil' })} />);
    const like = slot(container, 'like');
    expect(like).toHaveTextContent('8 mil');
    expect(like).toHaveAttribute('aria-hidden', 'true');
    for (const cls of ['h-5', 'text-xs', 'font-bold', 'text-white', 'tabular-nums']) {
      expect(like.className).toContain(cls);
    }
  });

  it('the comment slot is reserved at zero and drawn when present', () => {
    const { container, rerender } = render(<ReelRail {...props({ commentCount: null })} />);
    expect(slot(container, 'comment')).toBeEmptyDOMElement();
    expect(slot(container, 'comment').className).toContain('h-5');
    rerender(<ReelRail {...props({ commentCount: '1' })} />);
    expect(slot(container, 'comment')).toHaveTextContent('1');
  });

  it("share has no count slot and is always the rail's last item", () => {
    const { container } = render(<ReelRail {...props()} />);
    expect(container.querySelectorAll('[data-reel-count]')).toHaveLength(2);
    const rail = container.firstElementChild as HTMLElement;
    const share = screen.getByRole('button', { name: 'share-label' });
    expect(rail.lastElementChild).toBe(share);
  });
});
