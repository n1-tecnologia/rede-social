// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CourseHero } from './CourseHero';

/**
 * The course hero shared by the admin's course page and the member's (2026-10-26, the member skin).
 * The member page passes a row of chips (the academy reference's hero); the admin page passes none
 * and must draw exactly what it did. The skin's hooks ride on both and only the member page's
 * `MemberSkin` turns them on. The web workspace has no jest-dom: plain DOM assertions only.
 */
afterEach(cleanup);

const base = {
  coverAssetId: null,
  coverAlt: 'cover-alt-sentinel',
  category: 'category-sentinel',
  overline: 'overline-sentinel',
  title: 'title-sentinel',
  instructorLine: 'instructor-sentinel',
  instructorPhotoAssetId: null,
  testIds: {
    root: 'hero',
    fallback: 'hero-fallback',
    tags: 'hero-tags',
    overline: 'hero-overline',
    title: 'hero-title',
    instructor: 'hero-instructor',
  },
};

describe('CourseHero', () => {
  it('without chips (the admin page) draws no chip row and no new words', () => {
    render(<CourseHero {...base} />);
    const root = screen.getByTestId('hero');
    expect(root.textContent).toBe(
      'category-sentineloverline-sentineltitle-sentinelinstructor-sentinel',
    );
    expect(root.querySelector('[data-testid="chip-sentinel"]')).toBeNull();
  });

  it('with chips (the member page) draws them after the instructor line', () => {
    render(<CourseHero {...base} chips={<span data-testid="chip-sentinel">chip</span>} />);
    const chip = screen.getByTestId('chip-sentinel');
    const instructor = screen.getByTestId('hero-instructor');
    expect(
      instructor.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('carries the skin hooks, inert outside the member skin', () => {
    const { container } = render(<CourseHero {...base} />);
    const root = screen.getByTestId('hero');
    expect(root.className).toContain('ms-hero');
    expect(screen.getByTestId('hero-title').className).toContain('ms-title-page');
    expect(container.querySelector('.ms-hero-veil')).not.toBeNull();
    const fx = container.querySelector('.ms-tile-fx');
    expect(fx?.getAttribute('aria-hidden')).toBe('true');
    expect(fx?.className).toContain('hidden');
  });
});
