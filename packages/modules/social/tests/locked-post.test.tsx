// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LockedPost } from '../ui/LockedPost';

/**
 * 09-11 (UI-D-499, D-469, MOD-02): the props-only "Siga para ver" card. The module ships no language
 * and knows no route, so every string below is a sentinel the host would pass. The claims: the card
 * renders the avatar node first, the heading (clamped to two lines, breakable), the body (capped at
 * 260px) and the action node last, and NOTHING else - no caption, media, count or placeholder.
 */

afterEach(cleanup);

function renderCard(heading = 'heading-text') {
  return render(
    <LockedPost
      heading={heading}
      body="body-text"
      avatar={<span data-testid="avatar-node">avatar</span>}
      action={<button type="button">action-node</button>}
    />,
  );
}

describe('LockedPost', () => {
  it('L1: renders the avatar, the heading, the body and the action, in that order', () => {
    const { container } = renderCard();
    const card = container.firstElementChild as HTMLElement;
    expect(card.children).toHaveLength(4);
    expect(card.children[0]).toContainElement(screen.getByTestId('avatar-node'));
    expect(card.children[1]).toHaveTextContent('heading-text');
    expect(card.children[2]).toHaveTextContent('body-text');
    expect(card.children[3]).toContainElement(screen.getByRole('button', { name: 'action-node' }));
  });

  it('L2: the card is a centred column with the UI-D-499 gap and padding', () => {
    const { container } = renderCard();
    const card = container.firstElementChild as HTMLElement;
    for (const token of ['flex', 'flex-col', 'items-center', 'gap-4', 'p-6', 'text-center']) {
      expect(card.className).toContain(token);
    }
  });

  it('L3: the heading clamps to two lines and breaks long words', () => {
    renderCard('A'.repeat(120));
    const heading = screen.getByText('A'.repeat(120));
    expect(heading.className).toContain('line-clamp-2');
    expect(heading.className).toContain('break-words');
    expect(heading.className).toContain('font-bold');
    expect(heading.className).toContain('text-text');
  });

  it('L4: the body is the secondary 14px text capped at 260px', () => {
    renderCard();
    const body = screen.getByText('body-text');
    expect(body.className).toContain('max-w-[260px]');
    expect(body.className).toContain('text-text-secondary');
    expect(body.className).toContain('text-sm');
  });

  it('L5: it renders no image, no link and no word of its own', () => {
    const { container } = renderCard();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toBe('avatarheading-textbody-textaction-node');
  });
});
