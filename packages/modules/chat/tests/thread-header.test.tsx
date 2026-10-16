// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { recordAppPath, resetBackStack, startBackStack } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadHeader, type ThreadHeaderStaffProps } from '../ui/index';

/**
 * UI-D-258 / UI-D-263 as observable contract: the member variant (07-09) and the staff variant
 * (07-10) of the ONE thread bar. Every string is a sentinel handed in as a prop; the header ships no
 * words.
 */

afterEach(cleanup);

const staff: ThreadHeaderStaffProps = {
  backHref: '/suporte',
  backLabel: 'back-sentinel',
  avatar: 'https://cdn.exemplo/avatar.webp',
  name: 'name-sentinel',
  profileHref: '/membros/m1',
  profileLabel: 'profile-sentinel',
};

describe('ThreadHeader (UI-D-258, UI-D-263)', () => {
  it('member variant: back, the logo slot and the title h1', () => {
    render(
      <ThreadHeader
        backHref="/inicio"
        backLabel="back-sentinel"
        logo={<span data-testid="logo" />}
        title="title-sentinel"
      />,
    );
    expect(screen.getByRole('link', { name: 'back-sentinel' })).toHaveAttribute('href', '/inicio');
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('title-sentinel');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('staff variant: back to the inbox, then ONE link to the profile holding the avatar and the h1', () => {
    render(<ThreadHeader {...staff} />);
    expect(screen.getByRole('link', { name: 'back-sentinel' })).toHaveAttribute('href', '/suporte');
    const profile = screen.getByRole('link', { name: 'profile-sentinel' });
    expect(profile).toHaveAttribute('href', '/membros/m1');
    expect(profile).toHaveClass('flex', 'min-w-0', 'items-center', 'gap-2', 'rounded-xl');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(profile).toContainElement(heading);
    expect(heading).toHaveTextContent('name-sentinel');
    expect(heading).toHaveClass('truncate', 'min-w-0', 'text-base', 'font-bold', 'text-text');
    expect(profile.querySelector('.h-8.w-8')).not.toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(renderToStaticMarkup(<ThreadHeader {...staff} />)).toContain(`src="${staff.avatar}"`);
  });

  it('staff variant with profileHref null (departed): no link, the neutral avatar, the name in tertiary', () => {
    render(<ThreadHeader {...staff} name="removed-sentinel" profileHref={null} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'profile-sentinel' })).toBeNull();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('removed-sentinel');
    expect(heading).toHaveClass('text-text-tertiary', 'truncate');
    expect(renderToStaticMarkup(<ThreadHeader {...staff} profileHref={null} />)).not.toContain(
      '<img',
    );
  });

  it('ships no words: every text node comes from a prop', () => {
    const { container } = render(<ThreadHeader {...staff} />);
    expect(container.textContent).toBe('name-sentinel');
  });

  /**
   * 2026-10-09: the back control is the shared `BackLink`. With the inbox recorded behind the
   * thread, a tap steps back through history instead of following `backHref` (the fallback).
   */
  describe('the back control', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      resetBackStack();
    });

    it('returns to the screen the member came from', () => {
      resetBackStack();
      window.history.replaceState(null, '', '/suporte');
      startBackStack();
      window.history.pushState(null, '', '/suporte/c1');
      recordAppPath('/suporte/c1');
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

      render(<ThreadHeader {...staff} />);
      const link = screen.getByRole('link', { name: 'back-sentinel' });
      expect(link).toHaveAttribute('href', '/suporte');
      // `fireEvent` answers false when a handler prevented the link's own navigation.
      expect(fireEvent.click(link)).toBe(false);
      expect(back).toHaveBeenCalledTimes(1);
    });
  });
});
