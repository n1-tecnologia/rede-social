// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-12 — the presentational parts of the new `/perfil`: `ProgressRing`, `ProfileSection`
 * (with its rail, skeleton and empty card) and `ProfileCompletenessCard`.
 *
 * Claims:
 *  1. the ring clamps its percent, offsets a 100-long arc by `100 - percent`, animates in CSS only
 *     with the reduced-motion opt-out, and draws no arc at 0;
 *  4. a section is named by its title and carries the "Ver todos" link only when given, its
 *     accessible name containing the visible text;
 *  5. the empty card's action is the tenant button (`filled`) or the outline retry;
 *  6. the completeness card shows its CTA only when given, and turns compact at 100.
 *
 * `next/link` is stubbed as a plain anchor. Sentinel copy only: the components ship no words. The
 * web workspace has no jest-dom: plain DOM assertions only.
 */

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});

const { clampPercent, ProgressRing } = await import('./ProgressRing');
const { ProfileEmptyCard, ProfileRail, ProfileRailItem, ProfileRailSkeleton, ProfileSection } =
  await import('./ProfileSection');
const { ProfileCompletenessCard } = await import('./ProfileCompletenessCard');

afterEach(cleanup);

const classesOf = (element: Element | null | undefined) =>
  (element?.getAttribute('class') ?? '').split(/\s+/);

describe('ProgressRing', () => {
  it('1a. clamps the percent and offsets the arc by 100 - percent', () => {
    expect(clampPercent(33)).toBe(33);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(-20)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);

    const { container, rerender } = render(<ProgressRing percent={33} label="33-label" />);
    const arc = () => container.querySelector('[data-ring-arc]');
    expect(arc()?.getAttribute('pathLength')).toBe('100');
    expect(arc()?.getAttribute('stroke-dasharray')).toBe('100');
    expect(arc()?.getAttribute('stroke-linecap')).toBe('round');
    expect(renderToStaticMarkup(<ProgressRing percent={33} label="33-label" />)).toContain(
      '--ring-offset:67',
    );

    rerender(<ProgressRing percent={150} label="150-label" />);
    expect(container.querySelector('[data-progress-ring]')?.getAttribute('data-percent')).toBe(
      '100',
    );
    expect(renderToStaticMarkup(<ProgressRing percent={150} label="x" />)).toContain(
      '--ring-offset:0',
    );
  });

  it('1b. animates in CSS only, with the reduced-motion opt-out, and draws no arc at 0', () => {
    const { container, rerender } = render(<ProgressRing percent={50} label="50-label" />);
    const arc = container.querySelector('[data-ring-arc]');
    for (const token of [
      'stroke-brand',
      '[stroke-dashoffset:var(--ring-offset)]',
      'starting:[stroke-dashoffset:100]',
      'transition-[stroke-dashoffset]',
      'motion-reduce:transition-none',
    ]) {
      expect(classesOf(arc)).toContain(token);
    }
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 64 64');
    expect(classesOf(svg)).toContain('-rotate-90');
    // The track is always there; the label is the readable value, centred.
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(classesOf(container.querySelector('circle'))).toContain('stroke-brand-soft');
    const label = screen.getByText('50-label');
    expect(classesOf(label)).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'grid', 'place-items-center']),
    );

    for (const percent of [0, -5, Number.NaN]) {
      rerender(<ProgressRing percent={percent} label="0-label" />);
      expect(container.querySelector('[data-ring-arc]')).toBeNull();
      expect(container.querySelectorAll('circle')).toHaveLength(1);
    }
  });

  it('1c. the box takes the size, and the stroke is max(3, round(size / 11)) viewBox units', () => {
    const { container, rerender } = render(<ProgressRing percent={40} label="x" />);
    const ring = () => container.querySelector<HTMLElement>('[data-progress-ring]');
    expect(ring()?.style.width).toBe('64px');
    expect(ring()?.style.height).toBe('64px');
    expect(container.querySelector('[data-ring-arc]')?.getAttribute('stroke-width')).toBe('6');

    rerender(<ProgressRing percent={40} size={20} label="x" />);
    expect(ring()?.style.width).toBe('20px');
    expect(container.querySelector('[data-ring-arc]')?.getAttribute('stroke-width')).toBe('3');
  });
});

describe('ProfileSection, ProfileRail, ProfileEmptyCard', () => {
  it('4. the section is named by its title and carries the see-all link only when given', () => {
    const { rerender } = render(
      <ProfileSection
        id="events"
        title="title-sentinel"
        seeAll={{ href: '/eventos/meus', label: 'see-all', ariaLabel: 'see-all events' }}
      >
        <p>body-sentinel</p>
      </ProfileSection>,
    );
    const section = screen.getByRole('region', { name: 'title-sentinel' });
    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('data-profile-section')).toBe('events');
    expect(section.getAttribute('aria-labelledby')).toBe('profile-events-title');
    const title = screen.getByRole('heading', { level: 2, name: 'title-sentinel' });
    expect(title.id).toBe('profile-events-title');
    expect(title.hasAttribute('data-brand-title')).toBe(true);

    const link = within(section).getByRole('link', { name: 'see-all events' });
    expect(link.getAttribute('href')).toBe('/eventos/meus');
    expect(link.textContent).toBe('see-all');
    // Label in name: the accessible name contains the visible text.
    expect(link.getAttribute('aria-label')).toContain(link.textContent ?? '');
    expect(classesOf(link)).toContain('min-h-11');
    expect(within(section).getByText('body-sentinel')).toBeTruthy();

    rerender(
      <ProfileSection id="events" title="title-sentinel">
        <p>body-sentinel</p>
      </ProfileSection>,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('4b. the rail is a sideways list of 256px items; its skeleton keeps the items geometry', () => {
    const { container } = render(
      <ProfileRail>
        <ProfileRailItem>a</ProfileRailItem>
        <ProfileRailItem>b</ProfileRailItem>
      </ProfileRail>,
    );
    const list = container.querySelector('ul');
    expect(classesOf(list)).toEqual(
      expect.arrayContaining(['flex', 'overflow-x-auto', 'scrollbar-none', 'md:scrollbar-thin']),
    );
    const items = Array.from(list?.children ?? []);
    expect(items.map((item) => item.tagName)).toEqual(['LI', 'LI']);
    for (const item of items) expect(classesOf(item)).toEqual(['w-64', 'shrink-0']);
    cleanup();

    render(<ProfileRailSkeleton kind="poster" />);
    const posters = screen.getByTestId('profile-rail-skeleton');
    expect(posters.getAttribute('aria-busy')).toBe('true');
    expect(posters.children).toHaveLength(3);
    for (const poster of Array.from(posters.children)) {
      expect(classesOf(poster)).toEqual(expect.arrayContaining(['aspect-[4/5]', 'h-auto', 'w-64']));
    }
    cleanup();

    render(<ProfileRailSkeleton kind="tile" />);
    const tiles = screen.getByTestId('profile-rail-skeleton');
    expect(tiles.getAttribute('data-kind')).toBe('tile');
    expect(tiles.querySelectorAll('.aspect-\\[16\\/9\\]')).toHaveLength(3);
  });

  it('5. the empty card: the brand disc, two lines, and a filled or outline action', () => {
    const { container, rerender } = render(
      <ProfileEmptyCard
        icon={CalendarDays}
        title="empty-title"
        body="empty-body"
        action={{ href: '/eventos', label: 'explore', variant: 'filled' }}
      />,
    );
    const card = container.querySelector('[data-profile-empty]');
    expect(Array.from(card?.querySelectorAll('p') ?? []).map((p) => p.textContent)).toEqual([
      'empty-title',
      'empty-body',
    ]);
    const disc = card?.querySelector('[aria-hidden]');
    expect(classesOf(disc)).toEqual(expect.arrayContaining(['h-12', 'w-12', 'text-brand']));

    const filled = screen.getByRole('link', { name: 'explore' });
    expect(filled.getAttribute('href')).toBe('/eventos');
    expect(filled.getAttribute('data-variant')).toBe('filled');
    expect(classesOf(filled)).toEqual(
      expect.arrayContaining(['bg-button', 'bg-(image:--button-image)', 'text-on-button']),
    );

    rerender(
      <ProfileEmptyCard
        icon={CalendarDays}
        title="empty-title"
        body="empty-body"
        action={{ href: '/perfil', label: 'retry', variant: 'outline' }}
      />,
    );
    const outline = screen.getByRole('link', { name: 'retry' });
    expect(classesOf(outline)).toEqual(
      expect.arrayContaining(['border', 'border-border-secondary']),
    );
    expect(classesOf(outline)).not.toContain('bg-button');

    rerender(<ProfileEmptyCard icon={CalendarDays} title="empty-title" body="empty-body" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('ProfileCompletenessCard', () => {
  const ITEMS = [
    { key: 'photo', label: 'photo-label', done: true, stateLabel: 'done-state' },
    { key: 'bio', label: 'bio-label', done: false, stateLabel: 'pending-state' },
    { key: 'instagram', label: 'instagram-label', done: false, stateLabel: 'pending-state' },
  ];
  const CTA = { href: '/perfil/editar', label: 'complete-cta' };

  it('6a. the ring, the title, the progress line, the checklist and the CTA when given', () => {
    const { container, rerender } = render(
      <ProfileCompletenessCard
        percent={33}
        percentLabel="33-label"
        title="title-sentinel"
        progress="progress-sentinel"
        items={ITEMS}
        cta={CTA}
      />,
    );
    const card = container.querySelector('[data-profile-completeness]');
    expect(card?.hasAttribute('data-complete')).toBe(false);
    expect(card?.querySelector('[data-progress-ring]')?.getAttribute('data-percent')).toBe('33');
    expect(screen.getByText('33-label')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'title-sentinel' })).toBeTruthy();
    expect(screen.getByText('progress-sentinel').tagName).toBe('P');

    const items = Array.from(card?.querySelectorAll('li') ?? []);
    expect(items).toHaveLength(3);
    const [done, pending] = items;
    expect(done?.hasAttribute('data-done')).toBe(true);
    expect(classesOf(done?.querySelector('svg'))).toContain('text-success');
    expect(done?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(done?.querySelector('.sr-only')?.textContent).toBe('done-state');
    expect(pending?.hasAttribute('data-done')).toBe(false);
    expect(classesOf(pending?.querySelector('svg'))).toContain('text-text-tertiary');
    expect(pending?.querySelector('.sr-only')?.textContent).toBe('pending-state');

    const cta = screen.getByRole('link', { name: 'complete-cta' });
    expect(cta.getAttribute('href')).toBe('/perfil/editar');
    expect(classesOf(cta)).toEqual(
      expect.arrayContaining(['bg-button', 'bg-(image:--button-image)', 'text-on-button', 'h-9']),
    );

    rerender(
      <ProfileCompletenessCard
        percent={33}
        percentLabel="33-label"
        title="title-sentinel"
        progress="progress-sentinel"
        items={ITEMS}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('6b. at 100 it turns compact: no checklist and no CTA, even if one is passed', () => {
    const { container } = render(
      <ProfileCompletenessCard
        percent={100}
        percentLabel="100-label"
        title="complete-title"
        progress="3-of-3"
        items={ITEMS.map((item) => ({ ...item, done: true }))}
        cta={CTA}
      />,
    );
    const card = container.querySelector('[data-profile-completeness]');
    expect(card?.getAttribute('data-complete')).toBe('true');
    expect(card?.querySelector('ul')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 3, name: 'complete-title' })).toBeTruthy();
    expect(screen.getByText('3-of-3')).toBeTruthy();
    expect(screen.getByText('100-label')).toBeTruthy();
  });
});
