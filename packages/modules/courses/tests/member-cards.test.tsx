// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CourseCard, LiveCard, MemberLessonThumb, ProgressBar } from '../ui';

/**
 * 08.5-06 — the member cards as an observable contract (UI-D-426, UI-D-443, D-421, D-430). The cards
 * ship NO words (PWA-03) and resolve no route (MOD-02): every string and the href are props, sentinel
 * ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const COVER = '11111111-1111-4111-8111-111111111111';

const base = {
  href: '/cursos/c1',
  ariaLabel: 'aria-sentinel',
  title: 'title-sentinel',
  meta: 'meta-sentinel',
  coverWidths: [320, 640] as const,
};

describe('CourseCard (UI-D-426)', () => {
  it('1. is ONE anchor with the host href and the host-composed name', () => {
    render(<CourseCard {...base} coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('course-card-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('course-card-meta')).toHaveTextContent('meta-sentinel');
  });

  it('2. the poster is 3:4 on bg-bg-tertiary, and nothing on the card is grayscale or dimmed', () => {
    const { container } = render(
      <CourseCard
        {...base}
        coverAssetId={COVER}
        tags={<span data-testid="host-tag">tag</span>}
        progress={{ percent: 40, label: 'progress-sentinel' }}
      />,
    );
    const poster = screen.getByTestId('course-card-poster');
    for (const token of ['relative', 'aspect-[3/4]', 'overflow-hidden', 'rounded-xl']) {
      expect(poster.className).toContain(token);
    }
    expect(container.innerHTML).not.toMatch(/grayscale|opacity-50|bg-black\/50/);
  });

  it('3. no cover → the brand-gradient branch in the --brand-on-primary ink (D-69)', () => {
    render(<CourseCard {...base} coverAssetId={null} />);
    expect(screen.getByTestId('course-card-poster')).toHaveAttribute('data-branch', 'gradient');
    expect(screen.getByTestId('course-card-fallback').getAttribute('style')).toContain(
      '--brand-gradient',
    );
    expect(screen.getByTestId('course-card-body').getAttribute('style')).toContain(
      '--brand-on-primary',
    );
  });

  it('4. the tag stack renders only when the host passes tags', () => {
    render(<CourseCard {...base} coverAssetId={null} />);
    expect(screen.queryByTestId('course-card-tags')).toBeNull();
    cleanup();
    render(
      <CourseCard {...base} coverAssetId={null} tags={<span data-testid="host-tag">tag</span>} />,
    );
    const stack = screen.getByTestId('course-card-tags');
    expect(stack).toContainElement(screen.getByTestId('host-tag'));
    for (const token of ['absolute', 'top-3', 'left-3', 'right-3', 'flex-col', 'gap-1']) {
      expect(stack.className).toContain(token);
    }
  });

  it('5. the h-1 bar renders only with progress, pinned, and lifts the bottom block to bottom-4', () => {
    render(<CourseCard {...base} coverAssetId={null} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('course-card-body').className).toContain('bottom-3');
    cleanup();
    render(
      <CourseCard
        {...base}
        coverAssetId={null}
        progress={{ percent: 33, label: 'progress-sentinel' }}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'progress-sentinel' });
    expect(bar).toHaveAttribute('aria-valuenow', '33');
    for (const token of ['h-1', 'bg-white/25', 'absolute', 'inset-x-0', 'bottom-0']) {
      expect(bar.className).toContain(token);
    }
    expect(screen.getByTestId('course-card-body').className).toContain('bottom-4');
  });

  it('6. the category line is absent when the host passes none', () => {
    render(<CourseCard {...base} coverAssetId={null} categoryLine={null} />);
    expect(screen.queryByTestId('course-card-category')).toBeNull();
    cleanup();
    render(<CourseCard {...base} coverAssetId={null} categoryLine="line-sentinel" />);
    expect(screen.getByTestId('course-card-category')).toHaveTextContent('line-sentinel');
  });
});

describe('ProgressBar (UI-D-443)', () => {
  it('1. is a named progressbar with a bg-brand fill whose width is the clamped percent', () => {
    render(<ProgressBar percent={142} label="bar-sentinel" />);
    const bar = screen.getByRole('progressbar', { name: 'bar-sentinel' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar.className).toContain('h-2');
    expect(bar.className).toContain('bg-bg-tertiary');
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill.className).toContain('bg-brand');
    expect(fill.getAttribute('style')).toContain('width: 100%');
  });

  it('2. never animates: no transition or animate class on the bar or the fill', () => {
    const { container } = render(<ProgressBar percent={10} label="bar-sentinel" size="sm" />);
    expect(container.innerHTML).not.toMatch(/transition|animate-/);
    expect(screen.getByRole('progressbar').className).toContain('h-1');
  });
});

describe('LiveCard (UI-D-434)', () => {
  const live = {
    href: '/cursos/lives/l1',
    ariaLabel: 'live-aria-sentinel',
    title: 'live-title-sentinel',
    meta: 'live-meta-sentinel',
    statusLabel: 'status-sentinel',
    coverWidths: [320, 640] as const,
  };

  it('1. is ONE anchor with the host href and name, a 16:10 cover and the status pill in words', () => {
    render(<LiveCard {...live} coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'live-aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/lives/l1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    for (const token of ['flex-col', 'rounded-xl', 'bg-bg-secondary', 'overflow-hidden']) {
      expect(link.className).toContain(token);
    }
    expect(screen.getByTestId('live-card-cover').className).toContain('aspect-[16/10]');
    expect(screen.getByTestId('live-card-status')).toHaveTextContent('status-sentinel');
    expect(screen.getByTestId('live-card-meta').className).toContain('tabular-nums');
  });

  it('2. the Radio glyph leads the pill only for the on-air status, aria-hidden', () => {
    const { container } = render(<LiveCard {...live} coverAssetId={null} />);
    expect(container.querySelector('svg')).toBeNull();
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} statusIcon="radio" />);
    const glyph = screen.getByTestId('live-card-status').querySelector('svg');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('3. a cancelled card keeps its colour: only the title takes the secondary ink', () => {
    const { container } = render(<LiveCard {...live} coverAssetId={null} cancelled />);
    expect(screen.getByTestId('live-card-title').className).toContain('text-text-secondary');
    expect(container.innerHTML).not.toMatch(/grayscale|opacity-50/);
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} />);
    expect(screen.getByTestId('live-card-title').className).toContain('text-text');
    expect(screen.getByTestId('live-card-title').className).not.toContain('text-text-secondary');
  });

  it('4. the host tag slot follows the status pill; nothing renders without it', () => {
    render(<LiveCard {...live} coverAssetId={null} />);
    expect(screen.getByTestId('live-card-pills').children).toHaveLength(1);
    cleanup();
    render(
      <LiveCard {...live} coverAssetId={null} tags={<span data-testid="host-tag">tag</span>} />,
    );
    const pills = screen.getByTestId('live-card-pills');
    expect(pills.children).toHaveLength(2);
    expect(pills.lastElementChild).toBe(screen.getByTestId('host-tag'));
  });

  it('5. no cover → the brand gradient in the same 16:10 box', () => {
    render(<LiveCard {...live} coverAssetId={null} />);
    expect(screen.getByTestId('live-card-cover')).toHaveAttribute('data-branch', 'gradient');
    expect(screen.getByTestId('live-card-fallback').getAttribute('style')).toContain(
      '--brand-gradient',
    );
  });
});

describe('MemberLessonThumb (08.6-08, UI-D-449, UI-D-458)', () => {
  it('1. without badge / duration renders no pill (the 08.5 rows are unchanged)', () => {
    render(<MemberLessonThumb state="open" coverAssetId={null} coverWidths={[320]} />);
    expect(screen.queryByTestId('member-lesson-thumb-badge')).toBeNull();
    expect(screen.queryByTestId('member-lesson-thumb-duration')).toBeNull();
    const thumb = screen.getByTestId('member-lesson-thumb');
    expect(thumb).toHaveAttribute('aria-hidden', 'true');
    expect(thumb.className).toContain('w-20');
    expect(screen.getByTestId('member-lesson-thumb-fallback')).toBeInTheDocument();
  });

  it('2. badge is a top-left over-media pill and duration a bottom-right tabular chip', () => {
    render(
      <MemberLessonThumb
        state="open"
        coverAssetId={COVER}
        coverWidths={[320, 640]}
        sizes="(min-width: 680px) 648px, 100vw"
        badge="badge-sentinel"
        duration="12:34"
        className="w-full rounded-none"
      />,
    );
    const badge = screen.getByTestId('member-lesson-thumb-badge');
    expect(badge).toHaveTextContent('badge-sentinel');
    expect(badge.className).toContain('top-3');
    expect(badge.className).toContain('left-3');
    expect(badge.className).toContain('bg-black/60');
    expect(badge.className).toContain('text-white');
    const duration = screen.getByTestId('member-lesson-thumb-duration');
    expect(duration).toHaveTextContent('12:34');
    expect(duration.className).toContain('bottom-2');
    expect(duration.className).toContain('right-2');
    expect(duration.className).toContain('tabular-nums');
    expect(duration.className).toContain('text-xs');
    expect(duration.className).toContain('font-bold');
    expect(screen.getByTestId('member-lesson-thumb').className).toContain('w-full');
  });

  it('3. an empty badge or duration string renders nothing', () => {
    render(
      <MemberLessonThumb
        state="open"
        coverAssetId={null}
        coverWidths={[320]}
        badge=""
        duration=""
      />,
    );
    expect(screen.queryByTestId('member-lesson-thumb-badge')).toBeNull();
    expect(screen.queryByTestId('member-lesson-thumb-duration')).toBeNull();
  });
});
