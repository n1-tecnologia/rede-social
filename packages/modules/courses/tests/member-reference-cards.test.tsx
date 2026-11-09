// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LiveCard,
  MemberLessonCard,
  MemberModuleCard,
  MemberQuickCard,
  MemberTrackCard,
} from '../ui';

/**
 * 2026-10-26 — the academy reference's cards (the user's "swap completo"): the track's cover card,
 * the module and lesson cards of the course and module pages, and the live card in the catalogue's
 * language. Like every member card they ship NO words (PWA-03) and resolve no route (MOD-02): every
 * string and the href are props, sentinel ASCII here.
 */

afterEach(cleanup);

const COVER = '11111111-1111-4111-8111-111111111111';
const widths = [320, 640] as const;

describe('MemberTrackCard (the reference track card)', () => {
  const track = {
    id: 't1',
    href: '/area-membros/trilhas?trilha=t1',
    ariaLabel: 'track-aria-sentinel',
    title: 'track-title-sentinel',
    eyebrow: 'eyebrow-sentinel',
    cta: 'cta-sentinel',
    coverWidths: widths,
  };

  it('is ONE anchor with the host href and name; the cover IS the card, on a black ground', () => {
    render(<MemberTrackCard {...track} percent={null} coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'track-aria-sentinel' });
    expect(link).toHaveAttribute('href', '/area-membros/trilhas?trilha=t1');
    expect(link).toHaveAttribute('data-track-id', 't1');
    expect(link).toHaveAttribute('data-size', 'lg');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('member-track-card-title')).toHaveTextContent('track-title-sentinel');
    for (const token of ['ms-card', 'bg-black', 'aspect-[3/4]', 'sm:h-[300px]']) {
      expect(link.className).toContain(token);
    }
  });

  it('the breathing glows and the dots are decorative layers the skin shows; the band is always drawn', () => {
    const { container } = render(
      <MemberTrackCard {...track} percent={null} coverAssetId={null} index={1} />,
    );
    for (const layer of ['.ms-track-glow', '.ms-track-glow-alt', '.ms-dots']) {
      const node = container.querySelector(layer);
      expect(node, layer).not.toBeNull();
      expect(node?.className).toContain('hidden');
    }
    // The second card's glows start in the other corner, 2.6s later.
    const style = screen.getByRole('link').getAttribute('style') ?? '';
    expect(style).toContain('--ms-glow-x: 85%');
    expect(style).toContain('--ms-glow-delay: -2.6s');
    expect(screen.queryByTestId('member-track-card-percent')).toBeNull();
    expect(screen.queryByTestId('member-track-card-line')).toBeNull();
    expect(screen.getByTestId('member-track-card-fallback').getAttribute('style')).toContain(
      '--brand-gradient',
    );
  });

  it('the share and the hover line once the host passes them', () => {
    render(<MemberTrackCard {...track} coverAssetId={null} line="line-sentinel" percent={40} />);
    expect(screen.getByTestId('member-track-card-line')).toHaveTextContent('line-sentinel');
    expect(screen.getByTestId('member-track-card-line').className).toContain(
      'group-hover:opacity-100',
    );
    expect(screen.getByTestId('member-track-card-percent')).toHaveTextContent('40%');
  });

  // 2026-10-27: the manager's subtitle under the title, the audience as a tag beside the chip.
  it('the subtitle under the title and the audience tag beside the chip, only when passed', () => {
    const { unmount } = render(
      <MemberTrackCard
        {...track}
        coverAssetId={null}
        percent={null}
        subtitle="subtitle-sentinel"
        tag="audience-sentinel"
      />,
    );
    expect(screen.getByTestId('member-track-card-subtitle')).toHaveTextContent('subtitle-sentinel');
    const tag = screen.getByTestId('member-track-card-tag');
    expect(tag).toHaveTextContent('audience-sentinel');
    // The chip's glass, without the arrow.
    expect(tag.className).toContain('rounded-full');
    expect(tag.querySelector('svg')).toBeNull();
    unmount();

    render(<MemberTrackCard {...track} coverAssetId={null} percent={null} />);
    expect(screen.queryByTestId('member-track-card-subtitle')).toBeNull();
    expect(screen.queryByTestId('member-track-card-tag')).toBeNull();
  });

  it('`sm` is the stacked tile: the title and the eyebrow at the foot, no chip, no share', () => {
    render(<MemberTrackCard {...track} size="sm" percent={40} coverAssetId={null} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('data-size', 'sm');
    expect(link).toHaveTextContent('eyebrow-sentinel');
    expect(link).not.toHaveTextContent('cta-sentinel');
    expect(screen.queryByTestId('member-track-card-percent')).toBeNull();
  });
});

describe('MemberQuickCard (the reference quick-access card)', () => {
  const card = {
    href: '/cursos/c1',
    ariaLabel: 'quick-aria-sentinel',
    title: 'quick-title-sentinel',
    coverWidths: widths,
    percentLabel: 'share-sentinel',
  };

  it('one link; the inset cover, the title and the 2px line, always drawn', () => {
    render(<MemberQuickCard {...card} coverAssetId={COVER} percent={0} />);
    const link = screen.getByRole('link', { name: 'quick-aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1');
    for (const token of ['ms-card', 'ms-panel', 'p-1', 'pb-2.5', 'rounded-2xl']) {
      expect(link.className).toContain(token);
    }
    expect(screen.getByTestId('member-quick-card-cover').className).toContain('rounded-xl');
    expect(screen.getByTestId('member-quick-card-title')).toHaveTextContent('quick-title-sentinel');
    const bar = screen.getByRole('progressbar', { name: 'share-sentinel' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('the share fills the line (clamped); the lessons line is for a screen reader only', () => {
    render(
      <MemberQuickCard
        {...card}
        coverAssetId={null}
        percent={140}
        srLine="lessons-sentinel"
        srLineTestId="sr-line"
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('sr-line')).toHaveTextContent('lessons-sentinel');
    expect(screen.getByTestId('sr-line').className).toContain('sr-only');
  });
});

describe('MemberModuleCard (the reference module card)', () => {
  const card = {
    id: 'm1',
    href: '/cursos/c1/modulos/m1',
    ariaLabel: 'module-aria-sentinel',
    title: 'module-title-sentinel',
    pill: 'pill-sentinel',
    meta: 'meta-sentinel',
    coverWidths: widths,
  };

  it('one link; the title, the pill and the lessons line are the host words', () => {
    render(<MemberModuleCard {...card} state={{ kind: 'idle' }} coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'module-aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1/modulos/m1');
    expect(screen.getByTestId('member-module-card-title')).toHaveTextContent(
      'module-title-sentinel',
    );
    expect(screen.getByTestId('member-module-card-pill')).toHaveTextContent('pill-sentinel');
    expect(screen.getByTestId('member-module-card-meta')).toHaveTextContent('meta-sentinel');
  });

  it('the state draws one corner: the share, the done chip or the padlock', () => {
    render(
      <MemberModuleCard
        {...card}
        coverAssetId={null}
        state={{ kind: 'progress', percent: 25, label: 'share-sentinel' }}
      />,
    );
    expect(screen.getByTestId('member-module-card-percent')).toHaveTextContent('25%');
    expect(screen.queryByTestId('member-module-card-done')).toBeNull();
    expect(screen.queryByTestId('member-module-card-lock')).toBeNull();
    cleanup();
    render(
      <MemberModuleCard
        {...card}
        coverAssetId={null}
        state={{ kind: 'done', label: 'done-sentinel' }}
      />,
    );
    expect(screen.getByTestId('member-module-card-done')).toHaveTextContent('done-sentinel');
    cleanup();
    render(<MemberModuleCard {...card} coverAssetId={null} state={{ kind: 'locked' }} />);
    expect(screen.getByTestId('member-module-card-lock')).toBeInTheDocument();
    expect(screen.queryByTestId('member-module-card-percent')).toBeNull();
  });
});

describe('MemberLessonCard (the reference lesson card)', () => {
  const card = {
    id: 'l1',
    href: '/cursos/c1/aulas/l1',
    ariaLabel: 'lesson-aria-sentinel',
    title: 'lesson-title-sentinel',
    pill: 'pill-sentinel',
    doneLabel: 'done-sentinel',
    meta: 'meta-sentinel',
    coverWidths: widths,
  };

  it('one link with the host name; the duration only when the host passes one', () => {
    render(<MemberLessonCard {...card} state="open" coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'lesson-aria-sentinel' });
    expect(link).toHaveAttribute('href', '/cursos/c1/aulas/l1');
    expect(screen.getByTestId('member-lesson-card-title')).toHaveTextContent(
      'lesson-title-sentinel',
    );
    expect(screen.queryByTestId('member-lesson-card-duration')).toBeNull();
    cleanup();
    render(<MemberLessonCard {...card} state="open" coverAssetId={null} duration="9:12" />);
    expect(screen.getByTestId('member-lesson-card-duration')).toHaveTextContent('9:12');
  });

  it('progress → the share; done → the done chip; locked → the padlock', () => {
    render(
      <MemberLessonCard
        {...card}
        state="progress"
        percent={60}
        percentLabel="share-sentinel"
        coverAssetId={null}
      />,
    );
    expect(screen.getByTestId('member-lesson-card-percent')).toHaveTextContent('60%');
    cleanup();
    render(<MemberLessonCard {...card} state="done" coverAssetId={null} />);
    expect(screen.getByTestId('member-lesson-card-done')).toHaveTextContent('done-sentinel');
    cleanup();
    render(<MemberLessonCard {...card} state="locked" coverAssetId={null} />);
    expect(screen.getByTestId('member-lesson-card-lock')).toBeInTheDocument();
  });
});

describe('LiveCard `card` (the reference card language, the member Lives)', () => {
  const live = {
    href: '/cursos/lives/l1',
    ariaLabel: 'live-aria-sentinel',
    title: 'live-title-sentinel',
    meta: 'live-meta-sentinel',
    statusLabel: 'status-sentinel',
    coverWidths: widths,
  };

  it('a panel with the 16:9 cover on top and the words UNDER it, one link', () => {
    render(<LiveCard {...live} variant="card" coverAssetId={COVER} />);
    const link = screen.getByRole('link', { name: 'live-aria-sentinel' });
    expect(link).toHaveAttribute('data-variant', 'card');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    for (const token of ['ms-card', 'ms-panel', 'rounded-2xl', 'flex-col']) {
      expect(link.className).toContain(token);
    }
    const cover = screen.getByTestId('live-card-cover');
    expect(cover.className).toContain('aspect-video');
    expect(cover).not.toContainElement(screen.getByTestId('live-card-title'));
    expect(cover).toContainElement(screen.getByTestId('live-card-status'));
    expect(screen.getByTestId('live-card-meta')).toHaveTextContent('live-meta-sentinel');
  });

  it("a cancelled live steps its title back; the tile stays the admin's variant", () => {
    render(<LiveCard {...live} variant="card" coverAssetId={null} cancelled />);
    expect(screen.getByRole('link')).toHaveAttribute('data-cancelled', 'true');
    expect(screen.getByTestId('live-card-title').className).toContain('text-text-secondary');
    cleanup();
    render(<LiveCard {...live} coverAssetId={null} />);
    expect(screen.getByRole('link')).toHaveAttribute('data-variant', 'tile');
  });

  it('`wide` flattens a spotlight to 3:1 from lg; without it the spotlight is 2:1', () => {
    render(<LiveCard {...live} variant="spotlight" wide coverAssetId={null} />);
    expect(screen.getByTestId('live-card-cover').className).toContain('lg:aspect-[3/1]');
    cleanup();
    render(<LiveCard {...live} variant="spotlight" coverAssetId={null} />);
    expect(screen.getByTestId('live-card-cover').className).not.toContain('lg:aspect-[3/1]');
  });
});
