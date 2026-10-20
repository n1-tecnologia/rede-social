// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FollowCounts } from '../ui/FollowCounts';

/**
 * 09-10 (UI-D-501, D-468): the counts row. Counts are public and lists are private, so on another
 * member's profile the cells are plain `div`s (no link, no cursor) and on the member's own profile
 * the same two cells are links. The number comes before the label in the DOM (a screen reader reads
 * "12 seguidores"), and the numeral is `tabular-nums`.
 */

afterEach(cleanup);

const FOLLOWERS = { value: '1.234', label: 'followers-label' };
const FOLLOWING = { value: '7', label: 'following-label' };

describe('FollowCounts', () => {
  it('C1: plain cells hold no link and no interactive element', () => {
    render(<FollowCounts followers={FOLLOWERS} following={FOLLOWING} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getByText('following-label')).toBeInTheDocument();
  });

  it('C2: the block is the two-column hairline grid of UI-D-501', () => {
    const { container } = render(<FollowCounts followers={FOLLOWERS} following={FOLLOWING} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('grid-cols-2');
    expect(root.className).toContain('border-y');
    expect(root.className).toContain('py-4');
    expect(root.children).toHaveLength(2);
    for (const cell of Array.from(root.children)) {
      expect(cell.className).toContain('flex-col');
      expect(cell.className).toContain('items-center');
      expect(cell.className).toContain('gap-1');
    }
  });

  it('C3: the number comes before the label and carries tabular-nums', () => {
    const { container } = render(<FollowCounts followers={FOLLOWERS} following={FOLLOWING} />);
    const cell = (container.firstElementChild as HTMLElement).children[0] as HTMLElement;
    const [number, label] = Array.from(cell.children) as HTMLElement[];
    expect(number?.textContent).toBe('1.234');
    expect(number?.className).toContain('tabular-nums');
    expect(number?.className).toContain('font-bold');
    expect(label?.textContent).toBe('followers-label');
    expect(label?.className).toContain('text-text-tertiary');
  });

  it('C4: with hrefs the cells are links named by the host aria strings, 44px tall', () => {
    render(
      <FollowCounts
        followers={{
          ...FOLLOWERS,
          href: '/perfil/seguidores',
          ariaLabel: '1.234 followers, see list',
        }}
        following={{ ...FOLLOWING, href: '/perfil/seguindo', ariaLabel: '7 following, see list' }}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/perfil/seguidores');
    expect(links[0]?.getAttribute('aria-label')).toBe('1.234 followers, see list');
    expect(links[1]?.getAttribute('href')).toBe('/perfil/seguindo');
    for (const link of links) {
      expect(link.className).toContain('min-h-11');
      expect(link.className).toContain('active:opacity-70');
    }
  });

  it('C5: a plain cell never carries the link affordances', () => {
    const { container } = render(<FollowCounts followers={FOLLOWERS} following={FOLLOWING} />);
    const html = container.innerHTML;
    expect(html).not.toContain('active:opacity-70');
    expect(html).not.toContain('cursor-pointer');
  });
});
