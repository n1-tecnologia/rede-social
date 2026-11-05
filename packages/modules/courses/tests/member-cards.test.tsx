// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CourseCard,
  LiveCard,
  LiveStatusChip,
  MemberLessonThumb,
  ProgressBar,
  ProgressRing,
  StatBlock,
} from '../ui';

/**
 * 08.5-06 — the member cards as an observable contract (UI-D-426, D-421, D-430), redrawn 2026-10-22
 * on the social-igoralves prototype (the poster's frame, the padlock disc, the 3px band, the three
 * live cards, the CSS motion that "reduzir movimento" stops). The cards ship NO words (PWA-03) and
 * resolve no route (MOD-02): every string and the href are props, sentinel ASCII here so a copy
 * change cannot turn this file red.
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

describe('CourseCard (UI-D-426; the academy reference card, 2026-10-26)', () => {
  it('1. is ONE anchor with the host href and the host-composed name', () => {
    render(<CourseCard {...base} coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1');
    expect(link).toHaveAttribute('data-testid', 'course-card');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('course-card-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('course-card-meta')).toHaveTextContent('meta-sentinel');
  });

  it('2. a panel with the 16:9 cover on top, and nothing on the card is grayscale or dimmed', () => {
    const { container } = render(
      <CourseCard
        {...base}
        coverAssetId={COVER}
        tags={<span data-testid="host-tag">tag</span>}
        progress={{ percent: 40, label: 'progress-sentinel' }}
        locked
      />,
    );
    const link = screen.getByRole('link');
    for (const token of ['flex-col', 'rounded-2xl', 'border', 'border-border', 'bg-card']) {
      expect(link.className).toContain(token);
    }
    const poster = screen.getByTestId('course-card-poster');
    for (const token of ['relative', 'aspect-video', 'overflow-hidden']) {
      expect(poster.className).toContain(token);
    }
    // The words sit UNDER the art, in the body, never over it.
    expect(poster).not.toContainElement(screen.getByTestId('course-card-title'));
    expect(screen.getByTestId('course-card-body')).toContainElement(
      screen.getByTestId('course-card-title'),
    );
    expect(container.innerHTML).not.toMatch(/grayscale|opacity-50|bg-black\/50/);
  });

  it('3. no cover → the brand gradient in the same box; the title and the lines in the ink', () => {
    const { container } = render(
      <CourseCard {...base} coverAssetId={null} duration="1 h 43 min" />,
    );
    expect(screen.getByTestId('course-card-poster')).toHaveAttribute('data-branch', 'gradient');
    expect(screen.getByTestId('course-card-fallback').getAttribute('style')).toContain(
      '--brand-gradient',
    );
    expect(container.innerHTML).toContain('rgba(0,0,0,0.38)_0%');
    expect(screen.getByTestId('course-card-title').className).toContain('text-text');
    expect(screen.getByTestId('course-card-title').className).toContain('line-clamp-2');
    expect(screen.getByTestId('course-card-meta')).toHaveTextContent('meta-sentinel');
    expect(screen.getByTestId('course-card-duration')).toHaveTextContent('1 h 43 min');
    cleanup();
    render(<CourseCard {...base} coverAssetId={null} />);
    expect(screen.queryByTestId('course-card-duration')).toBeNull();
  });

  it('4. the tag stack renders only when the host passes tags, and replaces the category chip', () => {
    render(<CourseCard {...base} coverAssetId={null} categoryLine="line-sentinel" />);
    expect(screen.queryByTestId('course-card-tags')).toBeNull();
    expect(screen.getByTestId('course-card-category')).toHaveTextContent('line-sentinel');
    cleanup();
    render(
      <CourseCard
        {...base}
        coverAssetId={null}
        categoryLine="line-sentinel"
        tags={<span data-testid="host-tag">tag</span>}
      />,
    );
    const stack = screen.getByTestId('course-card-tags');
    expect(stack).toContainElement(screen.getByTestId('host-tag'));
    for (const token of ['absolute', 'top-2.5', 'left-2.5', 'right-14', 'flex-col', 'gap-1']) {
      expect(stack.className).toContain(token);
    }
    expect(screen.queryByTestId('course-card-category')).toBeNull();
  });

  it("5. with progress: the band pinned to the cover's foot and the share chip; done → the check instead", () => {
    render(<CourseCard {...base} coverAssetId={null} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByTestId('course-card-percent')).toBeNull();
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
    for (const token of ['h-[3px]', 'bg-white/25', 'absolute', 'inset-x-0', 'bottom-0']) {
      expect(bar.className).toContain(token);
    }
    expect(screen.getByTestId('course-card-poster')).toContainElement(bar);
    expect(screen.getByTestId('course-card-percent')).toHaveTextContent('33%');
    cleanup();
    render(
      <CourseCard
        {...base}
        coverAssetId={null}
        progress={{ percent: 100, label: 'progress-sentinel' }}
        done
      />,
    );
    expect(screen.queryByTestId('course-card-percent')).toBeNull();
    expect(screen.getByTestId('course-card-done')).toBeInTheDocument();
  });

  it('6. the category chip is absent when the host passes none', () => {
    render(<CourseCard {...base} coverAssetId={null} categoryLine={null} />);
    expect(screen.queryByTestId('course-card-category')).toBeNull();
  });

  it('7. locked → the padlock disc in the centre (in colour); done → the success check', () => {
    render(<CourseCard {...base} coverAssetId={COVER} locked done />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('data-locked', 'true');
    const lock = screen.getByTestId('course-card-lock');
    expect(lock).toHaveAttribute('aria-hidden', 'true');
    expect(lock.className).toContain('items-center');
    // A locked course is never also drawn as done.
    expect(screen.queryByTestId('course-card-done')).toBeNull();
    cleanup();
    render(<CourseCard {...base} coverAssetId={COVER} done />);
    expect(screen.getByRole('link')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('course-card-done').className).toContain('bg-success');
    expect(screen.queryByTestId('course-card-lock')).toBeNull();
  });

  it('9. carries the member skin hooks (2026-10-26), inert outside the scope', () => {
    const { container } = render(
      <CourseCard {...base} coverAssetId={null} categoryLine="line-sentinel" locked />,
    );
    const link = screen.getByRole('link');
    for (const hook of ['ms-card', 'ms-panel', 'ms-solid']) expect(link.className).toContain(hook);
    expect(screen.getByTestId('course-card-fallback').className).toContain('ms-zoom');
    expect(screen.getByTestId('course-card-title').className).toContain('ms-title-font');
    expect(screen.getByTestId('course-card-category').className).toContain('ms-chip');
    // The vignette and glows layer: hidden by the CLASS, shown only by the skin; never words.
    const fx = container.querySelector('.ms-tile-fx');
    expect(fx).not.toBeNull();
    expect(fx?.className).toContain('hidden');
    expect(fx).toHaveAttribute('aria-hidden', 'true');
    // The padlock sits in the 44px glass disc.
    expect(screen.getByTestId('course-card-lock').innerHTML).toContain('h-11 w-11');
  });

  it('8. a shelf can rename the hooks and size the poster', () => {
    render(
      <CourseCard
        {...base}
        coverAssetId={null}
        testId="shelf-row"
        metaTestId="shelf-legend"
        kind="em_andamento"
        className="w-[138px]"
      />,
    );
    const link = screen.getByTestId('shelf-row');
    expect(link).toHaveAttribute('data-kind', 'em_andamento');
    expect(link.className).toContain('w-[138px]');
    expect(screen.getByTestId('shelf-legend')).toHaveTextContent('meta-sentinel');
    expect(screen.queryByTestId('course-card')).toBeNull();
  });
});

describe('ProgressBar (UI-D-443; grows in, 2026-10-22)', () => {
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

  it('2. the fill grows in with the CSS motion, which "reduzir movimento" turns off', () => {
    render(<ProgressBar percent={10} label="bar-sentinel" size="sm" />);
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill.className).toContain('animate-progress-fill');
    expect(fill.className).toContain('motion-reduce:animate-none');
    expect(screen.getByRole('progressbar').className).toContain('h-1');
    cleanup();
    render(<ProgressBar percent={10} label="bar-sentinel" size="strip" />);
    expect(screen.getByRole('progressbar').className).toContain('h-[3px]');
  });

  it('3. carries the member skin hooks (2026-10-26): the track with its size and ground, the fill', () => {
    render(<ProgressBar percent={40} label="bar-sentinel" size="sm" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('ms-bar-track');
    expect(bar).toHaveAttribute('data-size', 'sm');
    expect(bar.hasAttribute('data-over-media')).toBe(false);
    // The fill keeps its own colour and motion; the skin's gradient and sheen ride on top.
    const fill = screen.getByTestId('progress-bar-fill');
    for (const token of ['ms-bar', 'bg-brand', 'animate-progress-fill']) {
      expect(fill.className).toContain(token);
    }
    cleanup();
    render(<ProgressBar percent={40} label="bar-sentinel" size="strip" overMedia pinned />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-size', 'strip');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-over-media', '');
  });
});

describe('LiveStatusChip (2026-10-22)', () => {
  it('on air: the red chip with the breathing dot, which "reduzir movimento" stops', () => {
    render(<LiveStatusChip label="live-sentinel" icon="live" />);
    const chip = screen.getByTestId('live-status-chip');
    expect(chip).toHaveTextContent('live-sentinel');
    expect(chip.className).toContain('bg-danger');
    const dot = screen.getByTestId('live-status-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.className).toContain('animate-live-dot');
    expect(dot.className).toContain('motion-reduce:animate-none');
  });

  it('a replay leads with an aria-hidden Play; a plain status is the glass chip alone', () => {
    render(<LiveStatusChip label="replay-sentinel" icon="replay" />);
    expect(screen.getByTestId('live-status-chip').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    cleanup();
    const { container } = render(<LiveStatusChip label="plain-sentinel" />);
    const chip = screen.getByTestId('live-status-chip');
    expect(chip.className).toContain('bg-black/55');
    expect(container.querySelector('svg')).toBeNull();
    expect(chip.textContent).toBe('plain-sentinel');
  });
});

describe('LiveCard (UI-D-434; three variants, 2026-10-22)', () => {
  const live = {
    href: '/cursos/lives/l1',
    ariaLabel: 'live-aria-sentinel',
    title: 'live-title-sentinel',
    meta: 'live-meta-sentinel',
    statusLabel: 'status-sentinel',
    coverWidths: [320, 640] as const,
  };

  it('1. the tile is ONE anchor with the host href and name: the 16:10 cover IS the card', () => {
    render(<LiveCard {...live} coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'live-aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/lives/l1');
    expect(link).toHaveAttribute('data-variant', 'tile');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    for (const token of ['block', 'rounded-xl', 'border', 'overflow-hidden']) {
      expect(link.className).toContain(token);
    }
    const cover = screen.getByTestId('live-card-cover');
    expect(cover.className).toContain('aspect-[16/10]');
    expect(cover).toContainElement(screen.getByTestId('live-card-title'));
    expect(screen.getByTestId('live-card-status')).toHaveTextContent('status-sentinel');
    expect(screen.getByTestId('live-card-meta').className).toContain('tabular-nums');
  });

  it('2. only the on-air status draws the red chip and its dot; a replay leads with Play', () => {
    const { container } = render(<LiveCard {...live} coverAssetId={null} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByTestId('live-status-dot')).toBeNull();
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} statusIcon="live" />);
    expect(screen.getByTestId('live-card-status').className).toContain('bg-danger');
    expect(screen.getByTestId('live-status-dot')).toBeInTheDocument();
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} statusIcon="replay" />);
    const glyph = screen.getByTestId('live-card-status').querySelector('svg');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('3. a cancelled card keeps its colour: data-cancelled, and only the title steps back', () => {
    const { container } = render(<LiveCard {...live} coverAssetId={null} cancelled />);
    expect(screen.getByRole('link')).toHaveAttribute('data-cancelled', 'true');
    expect(screen.getByTestId('live-card-title').className).toContain('text-white/70');
    expect(container.innerHTML).not.toMatch(/grayscale|opacity-50/);
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} variant="agenda" cancelled />);
    expect(screen.getByTestId('live-card-title').className).toContain('text-text-secondary');
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} />);
    expect(screen.getByRole('link')).not.toHaveAttribute('data-cancelled');
    expect(screen.getByTestId('live-card-title').className).toContain('text-white');
  });

  it('4. the host tag slot follows the status; nothing renders without it', () => {
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

  it('6. the spotlight: the large chip, the meta as the overline ABOVE the title, a red hairline on air', () => {
    render(<LiveCard {...live} coverAssetId={COVER} variant="spotlight" statusIcon="live" />);
    const link = screen.getByRole('link', { name: 'live-aria-sentinel' });
    expect(link).toHaveAttribute('data-variant', 'spotlight');
    expect(link.className).toContain('rounded-2xl');
    expect(link.className).toContain('border-danger/40');
    const meta = screen.getByTestId('live-card-meta');
    const title = screen.getByTestId('live-card-title');
    expect(meta.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.className).toContain('text-lg');
    expect(screen.getByTestId('live-card-status').className).toContain('text-[10px]');
  });

  it('7. the agenda row: no cover, the date column, the status in words, the time line', () => {
    render(
      <LiveCard
        {...live}
        coverAssetId={COVER}
        variant="agenda"
        day="24"
        month="out"
        timeLine="time-sentinel"
      />,
    );
    const link = screen.getByRole('link', { name: 'live-aria-sentinel' });
    expect(link).toHaveAttribute('data-variant', 'agenda');
    expect(screen.queryByTestId('live-card-cover')).toBeNull();
    const date = screen.getByTestId('live-card-date');
    expect(date).toHaveAttribute('aria-hidden', 'true');
    expect(date).toHaveTextContent('24out');
    expect(screen.getByTestId('live-card-status')).toHaveTextContent('status-sentinel');
    expect(screen.getByTestId('live-card-status').className).toContain('text-brand');
    expect(screen.getByTestId('live-card-meta')).toHaveTextContent('time-sentinel');
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} variant="agenda" statusIcon="live" />);
    expect(screen.getByTestId('live-card-status').className).toContain('bg-danger');
    expect(screen.getByTestId('live-card-meta')).toHaveTextContent('live-meta-sentinel');
  });
});

describe('MemberLessonThumb (08.6-08; the prototype LessonThumb, 2026-10-22)', () => {
  it('1. without badge / duration renders no pill; 96px, the gradient without a cover', () => {
    render(<MemberLessonThumb state="open" coverAssetId={null} coverWidths={[320]} />);
    expect(screen.queryByTestId('member-lesson-thumb-badge')).toBeNull();
    expect(screen.queryByTestId('member-lesson-thumb-duration')).toBeNull();
    const thumb = screen.getByTestId('member-lesson-thumb');
    expect(thumb).toHaveAttribute('aria-hidden', 'true');
    expect(thumb.className).toContain('w-24');
    expect(screen.getByTestId('member-lesson-thumb-fallback')).toBeInTheDocument();
  });

  it('2. badge is a top-left glass chip and duration a bottom-right tabular chip', () => {
    render(
      <MemberLessonThumb
        state="open"
        coverAssetId={COVER}
        coverWidths={[320, 640]}
        sizes="240px"
        badge="badge-sentinel"
        duration="12:34"
        className="w-full"
      />,
    );
    const badge = screen.getByTestId('member-lesson-thumb-badge');
    expect(badge).toHaveTextContent('badge-sentinel');
    for (const token of ['top-1.5', 'left-1.5', 'bg-black/55', 'text-white', 'uppercase']) {
      expect(badge.className).toContain(token);
    }
    const duration = screen.getByTestId('member-lesson-thumb-duration');
    expect(duration).toHaveTextContent('12:34');
    for (const token of ['bottom-1.5', 'right-1.5', 'tabular-nums', 'font-bold']) {
      expect(duration.className).toContain(token);
    }
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

  it('4. the card variant: the hairline frame, the duration at the top-right and the host words at the foot', () => {
    render(
      <MemberLessonThumb
        variant="card"
        state="open"
        coverAssetId={null}
        coverWidths={[320]}
        duration="8:00"
      >
        <span data-testid="foot">foot-sentinel</span>
      </MemberLessonThumb>,
    );
    const card = screen.getByTestId('member-lesson-thumb');
    expect(card).toHaveAttribute('data-variant', 'card');
    expect(card.className).toContain('w-full');
    expect(card.className).toContain('border');
    expect(screen.getByTestId('member-lesson-thumb-duration').className).toContain('top-2');
    expect(card).toContainElement(screen.getByTestId('foot'));
  });
});

describe('StatBlock (08.6-10, UI-D-458; the prototype scale, 2026-10-22)', () => {
  it('1. a <dt> row (glyph then label) BEFORE the <dd> value, inside a dl the host draws', () => {
    const { container } = render(
      <dl>
        <StatBlock
          icon={Clock}
          value="value-sentinel"
          label="label-sentinel"
          className="border-r"
        />
      </dl>,
    );
    const block = screen.getByTestId('stat-block');
    expect(block.className).toContain('border-r');
    const children = Array.from(block.children).map((child) => child.tagName);
    expect(children).toEqual(['DT', 'DD']);
    const dt = block.querySelector('dt');
    const glyph = dt?.querySelector('svg');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph?.getAttribute('class')).toContain('text-brand');
    expect(dt).toHaveTextContent('label-sentinel');
    expect(screen.getByTestId('stat-block-label').className).toContain('line-clamp-2');
    const dd = block.querySelector('dd');
    expect(dd).toHaveTextContent('value-sentinel');
    for (const token of ['whitespace-nowrap', 'tabular-nums', 'text-2xl', 'font-semibold']) {
      expect(dd?.className).toContain(token);
    }
    // 2026-10-26: the label is a small letterspaced overline, up to two lines in a narrow cell.
    for (const token of ['uppercase', 'text-[10px]', 'line-clamp-2']) {
      expect(screen.getByTestId('stat-block-label').className).toContain(token);
    }
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it('2. ships no words of its own: only the props reach the DOM', () => {
    render(<StatBlock icon={Clock} value="v" label="l" />);
    expect(screen.getByTestId('stat-block').textContent).toBe('lv');
  });
});

describe('ProgressRing (08.5-07; 08.6-10 label and tone; draws in, 2026-10-22)', () => {
  it('1. without a label it is the bare decorative svg with the media track', () => {
    render(<ProgressRing percent={40} />);
    const svg = screen.getByTestId('progress-ring');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('circle')?.getAttribute('class')).toBe('stroke-white/25');
    expect(screen.queryByTestId('progress-ring-label')).toBeNull();
  });

  it('2. a label renders centred over the ring, hidden from assistive tech; the arc draws in', () => {
    render(<ProgressRing percent={35} size={88} label="label-sentinel" tone="page" />);
    const wrap = screen.getByTestId('progress-ring-labelled');
    expect(wrap).toHaveAttribute('aria-hidden', 'true');
    expect(wrap.getAttribute('style')).toContain('width: 88px');
    const label = screen.getByTestId('progress-ring-label');
    expect(label).toHaveTextContent('label-sentinel');
    expect(label.className).toContain('absolute inset-0 flex items-center justify-center');
    expect(label.className).toContain('font-extrabold');
    const svg = screen.getByTestId('progress-ring');
    expect(svg.querySelector('circle')?.getAttribute('class')).toBe('stroke-bg-tertiary');
    expect(svg.querySelectorAll('circle')[0]?.getAttribute('stroke-width')).toBe('8');
    expect(svg).toHaveAttribute('data-percent', '35');
    const arc = screen.getByTestId('progress-ring-arc');
    expect(arc.getAttribute('class')).toContain('animate-ring-draw');
    expect(arc.getAttribute('class')).toContain('motion-reduce:animate-none');
    expect(arc.getAttribute('style')).toContain('--ring-c');
  });
});
