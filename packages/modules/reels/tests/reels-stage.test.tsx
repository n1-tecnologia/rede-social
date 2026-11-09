// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReelCaption } from '../ui/ReelCaption';
import { ReelPlaybackError } from '../ui/ReelPlaybackError';
import { ReelRail } from '../ui/ReelRail';
import { ReelsFrame, ReelsStage } from '../ui/ReelsStage';

/**
 * The two props-only pieces every Reels state renders with (UI-D-82, UI-D-93b, UI-D-97, UI-D-98).
 * Strings are sentinel ASCII: the module ships no words (PWA-03). Since 2026-10-09 the stage also
 * has an OVERLAY variant (the Reels a single tap on a feed video opens): it covers the desktop rail,
 * and the rail and the caption drawn on it drop to the bottom, with no BottomNav to clear.
 */
afterEach(() => {
  cleanup();
});

describe('ReelsStage (UI-D-82, UI-D-97, UI-D-98)', () => {
  it('is a labelled region landmark, fixed full-screen black under the BottomNav; from md the theme ground (2026-10-23)', () => {
    render(
      <ReelsStage label="stage-label">
        <p>child</p>
      </ReelsStage>,
    );
    const region = screen.getByRole('region', { name: 'stage-label' });
    expect(region.tagName).toBe('SECTION');
    // Right of the rail: its 72px glyphs (2026-10-26, Instagram's collapsed rail).
    for (const cls of [
      'fixed',
      'inset-0',
      'z-40',
      'overflow-hidden',
      'bg-black',
      'md:left-[72px]',
    ]) {
      expect(region.className).toContain(cls);
    }
    // The YouTube Shorts layout: the member's theme around the player on the desktop. The dark
    // scope is the player box now (`ReelsFrame`, the pager's clip), never the whole stage.
    expect(region.className).toContain('md:bg-bg');
    expect(region.className).toContain('md:text-text');
    expect(region).not.toHaveAttribute('data-theme');
    expect(region.style.touchAction).toBe('none');
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('2026-10-23: ReelsFrame is the dark player box: the whole stage on the phone, the rounded 9:16 box from md', () => {
    render(
      <ReelsStage label="stage-label">
        <ReelsFrame>
          <p>state</p>
        </ReelsFrame>
      </ReelsStage>,
    );
    const frame = document.querySelector('[data-reels-frame]') as HTMLElement;
    expect(frame).toHaveAttribute('data-theme', 'dark');
    const classes = frame.className.split(/\s+/);
    for (const cls of ['relative', 'h-full', 'w-full', 'bg-black', 'text-white']) {
      expect(classes).toContain(cls);
    }
    for (const cls of ['md:aspect-[9/16]', 'md:h-auto', 'md:rounded-xl', 'md:overflow-hidden']) {
      expect(classes).toContain(cls);
    }
    expect(frame.parentElement?.className).toContain('md:pt-2');
    expect(frame).toContainElement(screen.getByText('state'));
  });

  it('is the tab variant by default, and says so', () => {
    render(<ReelsStage label="stage-label">child</ReelsStage>);
    expect(screen.getByRole('region', { name: 'stage-label' })).toHaveAttribute(
      'data-reels-stage',
      'tab',
    );
  });

  it("the overlay variant covers the desktop rail too: md:left-0, never the rail's offset", () => {
    render(
      <ReelsStage label="stage-label" variant="overlay">
        child
      </ReelsStage>,
    );
    const region = screen.getByRole('region', { name: 'stage-label' });
    expect(region).toHaveAttribute('data-reels-stage', 'overlay');
    expect(region).not.toHaveAttribute('data-theme');
    for (const cls of ['fixed', 'inset-0', 'z-40', 'overflow-hidden', 'bg-black', 'md:left-0']) {
      expect(region.className).toContain(cls);
    }
    expect(region.className).not.toContain('md:left-[72px]');
    expect(region.style.touchAction).toBe('none');
  });
});

describe('ReelsStage — the pieces drawn on it follow its variant (2026-10-09)', () => {
  const TAB = 'bottom-[calc(var(--safe-bottom)+88px)]';
  const OVERLAY = 'bottom-[calc(var(--safe-bottom)+24px)]';

  function pieces() {
    return (
      <>
        <ReelRail
          author={{
            href: '/membros/m-1',
            avatarUrl: null,
            name: 'author-name',
            label: 'author-label',
          }}
          like={<span>like-node</span>}
          likeCount={null}
          commentLabel="comment-label"
          commentCount={null}
          onComment={vi.fn()}
          shareLabel="share-label"
        />
        <ReelCaption
          author={{ name: 'author-name', href: '/membros/m-1' }}
          community={null}
          moreLabel="more-label"
          lessLabel="less-label"
          expanded={false}
          onExpandedChange={vi.fn()}
        />
      </>
    );
  }

  function rail(container: HTMLElement): HTMLElement {
    const node = container.querySelector('[data-reel-count="like"]')?.parentElement?.parentElement;
    if (!(node instanceof HTMLElement)) throw new Error('no rail');
    return node;
  }

  function caption(container: HTMLElement): HTMLElement {
    const node = container.querySelector('[data-reel-caption]');
    if (!(node instanceof HTMLElement)) throw new Error('no caption');
    return node;
  }

  it('on the tab the rail and the caption clear the floating BottomNav', () => {
    const { container } = render(<ReelsStage label="stage-label">{pieces()}</ReelsStage>);
    for (const node of [rail(container), caption(container)]) {
      expect(node.className).toContain(TAB);
      expect(node.className).not.toContain(OVERLAY);
      expect(node.className).toContain('md:bottom-6');
    }
  });

  it('outside any stage they keep the tab inset', () => {
    const { container } = render(pieces());
    expect(rail(container).className).toContain(TAB);
    expect(caption(container).className).toContain(TAB);
  });

  it('in the overlay there is no BottomNav: both drop to 24 px over the safe area', () => {
    const { container } = render(
      <ReelsStage label="stage-label" variant="overlay">
        {pieces()}
      </ReelsStage>,
    );
    for (const node of [rail(container), caption(container)]) {
      expect(node.className).toContain(OVERLAY);
      expect(node.className).not.toContain(TAB);
      expect(node.className).toContain('md:bottom-6');
    }
  });
});

describe('ReelPlaybackError (UI-D-93b)', () => {
  it('renders the message and a retry pill that calls onRetry once', () => {
    const onRetry = vi.fn();
    render(<ReelPlaybackError message="error-label" retryLabel="retry-label" onRetry={onRetry} />);
    expect(screen.getByText('error-label')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'retry-label' });
    expect(retry.className).toContain('h-11');
    expect(retry.className).toContain('rounded-full');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is a SIZED block, never an absolute inset-0 sibling that would swallow swipes', () => {
    const { container } = render(
      <ReelPlaybackError message="error-label" retryLabel="retry-label" onRetry={vi.fn()} />,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.className).not.toContain('inset-0');
    expect(block.querySelector('svg')).not.toBeNull();
  });
});
