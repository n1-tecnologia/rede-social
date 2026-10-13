// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CourseRow, LiveRow, RowSkeleton, TrackRow } from '../ui';

/**
 * UI-D-392 — the admin list rows as an observable contract, not pixels. The rows ship NO words
 * (PWA-03) and resolve no route (MOD-02): every string and the href are props, sentinel ASCII here so
 * a copy change cannot turn this file red.
 */

afterEach(cleanup);

const THUMB = <img data-testid="host-thumb" alt="thumb-alt-sentinel" src="data:," />;

const base = {
  href: '/cursos/c1',
  ariaLabel: 'aria-sentinel',
  title: 'title-sentinel',
  meta: 'meta-sentinel',
};

describe('CourseRow (UI-D-392)', () => {
  it('1. is ONE anchor with the host href, the host-composed name, the title and the meta', () => {
    render(<CourseRow {...base} thumb={THUMB} />);
    const link = screen.getByRole('link', { name: 'aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('course-row-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('course-row-meta')).toHaveTextContent('meta-sentinel');
    // The row geometry: flex, 56px minimum, the 12/16 paddings.
    for (const token of ['flex', 'items-center', 'gap-3', 'min-h-14', 'px-4', 'py-2']) {
      expect(link.className).toContain(token);
    }
  });

  it('2. the 3:4 poster thumb slot is 40px wide on bg-bg-tertiary; no slot takes the gradient', () => {
    render(<CourseRow {...base} thumb={THUMB} />);
    const thumb = screen.getByTestId('course-row-thumb');
    expect(thumb.className).toContain('w-10');
    expect(thumb.className).toContain('aspect-[3/4]');
    expect(thumb.className).toContain('rounded-lg');
    expect(thumb.className).toContain('bg-bg-tertiary');
    expect(thumb.className).toContain('shrink-0');
    expect(screen.getByTestId('host-thumb')).toBeInTheDocument();
    cleanup();

    render(<CourseRow {...base} />);
    const fallback = screen.getByTestId('course-row-fallback');
    expect(fallback.className).toContain('w-10');
    expect(fallback.className).toContain('aspect-[3/4]');
    expect(fallback.getAttribute('style')).toContain('var(--brand-gradient)');
    expect(screen.queryByTestId('course-row-thumb')).toBeNull();
  });

  it('3. two pills render in the given order, as words with their tones, never shrinking', () => {
    render(
      <CourseRow
        {...base}
        pills={[
          { label: 'status-sentinel', tone: 'neutral' },
          { label: 'processing-sentinel', tone: 'warning' },
        ]}
      />,
    );
    const pills = screen.getAllByTestId('course-row-pill');
    expect(pills.map((pill) => pill.textContent)).toEqual([
      'status-sentinel',
      'processing-sentinel',
    ]);
    expect(pills[0]).toHaveAttribute('data-tone', 'neutral');
    expect(pills[1]).toHaveAttribute('data-tone', 'warning');
    expect(pills[1]?.className).toContain('text-warning');
    for (const pill of pills) expect(pill.className).toContain('shrink-0');
    // The chevron is the only glyph; the pills carry none.
    const { container } = render(<CourseRow {...base} />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('4. no pills renders no pill group; an empty meta renders no meta line', () => {
    render(<CourseRow {...base} meta="" />);
    expect(screen.queryByTestId('course-row-pill')).toBeNull();
    expect(screen.queryByTestId('course-row-meta')).toBeNull();
  });

  it('5. E03 long-text: a 120-character title clamps to two lines (CSS only, never cut)', () => {
    const long = 'x'.repeat(120);
    render(<CourseRow {...base} title={long} />);
    const title = screen.getByTestId('course-row-title');
    expect(title.className).toContain('line-clamp-2');
    expect(title.textContent).toBe(long);
  });

  it('6. renders no text it was not given', () => {
    const { container } = render(
      <CourseRow {...base} pills={[{ label: 'pill-sentinel', tone: 'success' }]} />,
    );
    expect(container.textContent).toBe('title-sentinelmeta-sentinelpill-sentinel');
  });
});

describe('TrackRow and LiveRow (UI-D-392, plans 10 and 11)', () => {
  it('use the 16:10 thumb at 64px and their own test ids', () => {
    render(<TrackRow {...base} href="/cursos/trilhas/t1" thumb={THUMB} />);
    expect(screen.getByRole('link', { name: 'aria-sentinel' })).toHaveAttribute(
      'href',
      '/cursos/trilhas/t1',
    );
    const thumb = screen.getByTestId('track-row-thumb');
    expect(thumb.className).toContain('w-16');
    expect(thumb.className).toContain('aspect-[16/10]');
    cleanup();

    render(
      <LiveRow
        {...base}
        href="/cursos/lives/l1"
        pills={[{ label: 'live-pill-sentinel', tone: 'success' }]}
      />,
    );
    expect(screen.getByTestId('live-row-fallback').className).toContain('aspect-[16/10]');
    expect(screen.getByTestId('live-row-pill')).toHaveTextContent('live-pill-sentinel');
  });
});

describe('RowSkeleton (UI-D-401)', () => {
  it('is a hidden min-h-14 row with the thumb rect of its variant and no words', () => {
    const { container } = render(<RowSkeleton />);
    const row = screen.getByTestId('row-skeleton');
    expect(row).toHaveAttribute('aria-hidden');
    expect(row.className).toContain('min-h-14');
    expect(container.innerHTML).toContain('aspect-[3/4]');
    expect(container.textContent).toBe('');
    cleanup();

    const wide = render(<RowSkeleton variant="wide" />);
    expect(wide.container.innerHTML).toContain('aspect-[16/10]');
  });
});
