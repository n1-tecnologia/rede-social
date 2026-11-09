// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenHeader, ScreenHeaderSkeleton } from './ScreenHeader';

/**
 * The header of the courses area's screens, shared by the member's screens and the admin's lists
 * (2026-10-26, the member skin). It carries the skin's hooks (the header surface, its floating glow,
 * the page title and the lede); they are inert outside `[data-member-skin]`, so the admin lists keep
 * their look. The web workspace has no jest-dom: plain DOM assertions only.
 */
afterEach(cleanup);

describe('ScreenHeader', () => {
  it('draws one h1 with the title and the supporting line, and the skin hooks', () => {
    const { container } = render(
      <ScreenHeader title="title-sentinel" subtitle="subtitle-sentinel" testId="header" />,
    );
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('title-sentinel');
    expect(headings[0]?.className).toContain('ms-title-page');
    expect(headings[0]?.hasAttribute('data-brand-title')).toBe(true);
    expect(screen.getByText('subtitle-sentinel').className).toContain('ms-lede');
    const block = screen.getByTestId('header');
    expect(block.className).toContain('ms-header');
    // The floating glow: hidden by the class, wordless, decorative.
    const ambient = container.querySelector('.ms-ambient');
    expect(ambient?.className).toContain('hidden');
    expect(ambient?.getAttribute('aria-hidden')).toBe('true');
    expect(block.textContent).toBe('title-sentinelsubtitle-sentinel');
  });

  it('keeps the skin hooks on its placeholder, at the same geometry', () => {
    const { container } = render(<ScreenHeaderSkeleton />);
    expect(container.querySelector('.ms-header')).not.toBeNull();
    expect(container.querySelector('.ms-skel-page')).not.toBeNull();
    expect(container.querySelector('.ms-skel-lede')).not.toBeNull();
  });
});
