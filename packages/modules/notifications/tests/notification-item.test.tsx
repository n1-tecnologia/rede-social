// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationItem, type NotificationItemProps } from '../ui/NotificationItem';
import { NotificationList } from '../ui/NotificationList';

/**
 * UI-D-251 / UI-D-250 as observable contract, not pixels. The components ship NO words: every string
 * is a prop, sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';

function item(overrides: Partial<NotificationItemProps> = {}) {
  const props: NotificationItemProps = {
    href: '/post/p1',
    unread: true,
    leading: { avatar: { src: null, alt: 'actor-sentinel' } },
    glyph: 'Newspaper',
    sentence: (
      <>
        <span className="font-bold text-text">actor-sentinel</span> sentence-sentinel
      </>
    ),
    time: 'time-sentinel',
    unreadLabel: 'unread-sentinel',
    ...overrides,
  };
  return render(<NotificationItem {...props} />);
}

describe('NotificationItem', () => {
  it('is ONE anchor to the target, tinted and labelled while unread', () => {
    item();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/post/p1');
    expect(link).toHaveClass('bg-brand/10');
    expect(link).toHaveAttribute('data-unread', 'true');
    expect(screen.getByText('unread-sentinel')).toHaveClass('sr-only');
    expect(link).toHaveTextContent('actor-sentinel sentence-sentinel');
    expect(link).toHaveTextContent('time-sentinel');
  });

  it('drops the tint and the unread label once read', () => {
    item({ unread: false });
    const link = screen.getByRole('link');
    expect(link).not.toHaveClass('bg-brand/10');
    expect(screen.queryByText('unread-sentinel')).toBeNull();
  });

  it('renders the preview only when one is given, with no reserved width otherwise', () => {
    const { container, unmount } = item({ preview: { assetId: ASSET, widths: [320] } });
    expect(container.querySelector('.h-11.w-11')).not.toBeNull();
    unmount();
    const again = item({ preview: null });
    expect(again.container.querySelector('.h-11.w-11')).toBeNull();
  });

  it('calls onActivate on a tap', () => {
    const onActivate = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    item({ onActivate });
    fireEvent.click(screen.getByRole('link'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationItem variants (07-04, UI-D-251)', () => {
  it('the removed variant is a BUTTON, never an anchor, with no preview and the tertiary sentence', () => {
    const onActivate = vi.fn();
    const { container } = item({
      removed: true,
      href: null,
      onActivate,
      sentence: 'removed-sentinel',
      preview: { assetId: ASSET, widths: [320] },
    });
    expect(screen.queryByRole('link')).toBeNull();
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-removed', 'true');
    expect(button).toHaveClass('bg-brand/10');
    expect(screen.getByText('unread-sentinel')).toHaveClass('sr-only');
    expect(screen.getByText(/removed-sentinel/)).toHaveClass('text-text-tertiary');
    expect(container.querySelector('.h-11.w-11')).toBeNull();
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('an actor-less row draws the 40px glyph disc instead of an avatar', () => {
    const { container } = item({ leading: { glyph: true }, glyph: 'Bell' });
    const disc = container.querySelector('.h-10.w-10.rounded-full.bg-bg-tertiary');
    expect(disc).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'actor-sentinel' })).toBeNull();
  });

  it('only the like glyph carries the like tone', () => {
    const liked = item({ glyph: 'Heart', glyphTone: 'like' });
    expect(liked.container.querySelector('svg.text-like.fill-like')).not.toBeNull();
    liked.unmount();
    const neutral = item({ glyph: 'MessageCircleReply' });
    expect(neutral.container.querySelector('svg.text-like')).toBeNull();
    expect(neutral.container.querySelector('svg.text-text-secondary')).not.toBeNull();
  });

  it('a read removed row carries no unread label and no tint', () => {
    item({ removed: true, href: null, unread: false, sentence: 'removed-sentinel' });
    expect(screen.getByRole('button')).not.toHaveClass('bg-brand/10');
    expect(screen.queryByText('unread-sentinel')).toBeNull();
  });
});

describe('NotificationList', () => {
  it('renders Novas above Anteriores, and a section with no rows is absent', () => {
    const { rerender } = render(
      <NotificationList
        ariaLabel="region-sentinel"
        unreadTitle="unread-title"
        readTitle="read-title"
        unread={[<p key="a">row-a</p>]}
        read={[<p key="b">row-b</p>]}
        markAll={<button type="button">mark-all</button>}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['unread-title', 'read-title']);
    expect(screen.getByRole('region', { name: 'region-sentinel' })).toBeInTheDocument();

    rerender(
      <NotificationList
        ariaLabel="region-sentinel"
        unreadTitle="unread-title"
        readTitle="read-title"
        unread={[]}
        read={[<p key="b">row-b</p>]}
        markAll={<button type="button">mark-all</button>}
      />,
    );
    expect(screen.queryByText('unread-title')).toBeNull();
    expect(screen.queryByText('mark-all')).toBeNull();
    expect(screen.getByText('read-title')).toBeInTheDocument();
  });
});
