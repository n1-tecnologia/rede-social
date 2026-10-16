// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMBER_ACTIVITY_SAMPLE } from '@/lib/member-activity-sample';
import { type ActivityT, MemberActivityReport } from './MemberActivityReport';
import { barPercent, linearPoints, niceBounds } from './scale';

/**
 * 2026-10-13 — the member's "Sua atividade" report (`MemberActivityReport`), from the
 * rede-social-dashboard preview. Claims:
 *  1. the blocks come in the preview's order, "Onde você mais participa" between "O que você viu"
 *     and "Presença e constância", left out for a tenant without the communities module;
 *  2. "Tempo de uso" is the rounded daily average with its unit, a neutral change chip (the whole
 *     comparison for screen readers) and ONE chart image with a label per day;
 *  3. "Seu engajamento" and "O que você viu" are four cards each, with their units;
 *  4. the streak card needs `MIN_STREAK_WEEKS`;
 *  5. the bars are the preview's comunidades, drawn to scale against the largest count;
 *  6. the scale never divides by zero.
 *
 * `t` is a sentinel that echoes its key and values, so the test reads which copy each place asks
 * for. The web workspace has no jest-dom: plain DOM assertions only.
 */

const t: ActivityT = (key, values) =>
  values
    ? `${key}(${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;

afterEach(cleanup);

const blocksOf = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-activity-block]')].map((el) =>
    el.getAttribute('data-activity-block'),
  );

describe('MemberActivityReport', () => {
  it('1. the blocks in order, the comunidades between seen and presence, absent without the module', () => {
    const { container, rerender } = render(
      <MemberActivityReport t={t} sample={MEMBER_ACTIVITY_SAMPLE} />,
    );
    expect(blocksOf(container)).toEqual(['usage', 'engagement', 'seen', 'communities', 'presence']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'usage.title',
      'engagement.title',
      'seen.title',
      'communities.title',
      'presence.title',
    ]);
    expect(container.querySelector('[data-activity-block="presence"]')?.textContent).toContain(
      'presencePeriod',
    );

    rerender(
      <MemberActivityReport t={t} sample={MEMBER_ACTIVITY_SAMPLE} showCommunities={false} />,
    );
    expect(blocksOf(container)).toEqual(['usage', 'engagement', 'seen', 'presence']);
  });

  it('2. usage: the rounded average, a neutral chip and one chart with a label per day', () => {
    const { container } = render(<MemberActivityReport t={t} sample={MEMBER_ACTIVITY_SAMPLE} />);
    const usage = container.querySelector('[data-activity-block="usage"]') as HTMLElement;
    expect(usage.querySelector('[data-activity-value]')?.textContent).toBe('38usage.unit');
    // The chip: the bare amount drawn, the whole comparison for screen readers.
    expect(within(usage).getByText('minutesAmount(value=6)').getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(
      within(usage).getByText('vsLastWeek(amount=minutesAmount(value=6))').className,
    ).toContain('sr-only');
    const chart = within(usage).getByRole('img', { name: 'usage.chartLabel' });
    expect(chart.querySelectorAll('[data-x-label]')).toHaveLength(7);
    expect(chart.querySelector('[data-x-label]')?.textContent).toBe('seg');
    expect(usage.textContent).toContain('usage.peak(from=20,to=22)');
  });

  it('3. engagement and seen: four cards each, with their values and units', () => {
    const { container } = render(<MemberActivityReport t={t} sample={MEMBER_ACTIVITY_SAMPLE} />);
    const values = (id: string) =>
      [...container.querySelectorAll(`[data-activity-block="${id}"] [data-activity-value]`)].map(
        (el) => el.textContent,
      );
    expect(values('engagement')).toEqual(['46', '12', '9', '3']);
    expect(values('seen')).toEqual([
      '60seen.postsUnit(count=60)',
      '23',
      '41seen.videosUnit(count=41)',
      'durationLong(hours=1,minutes=12)',
    ]);
  });

  it('4. the streak card only from MIN_STREAK_WEEKS', () => {
    const { container, rerender } = render(
      <MemberActivityReport t={t} sample={MEMBER_ACTIVITY_SAMPLE} />,
    );
    const presence = () =>
      container.querySelectorAll('[data-activity-block="presence"] [data-activity-card]');
    expect(presence()).toHaveLength(2);
    rerender(
      <MemberActivityReport t={t} sample={{ ...MEMBER_ACTIVITY_SAMPLE, weeklyStreak: 1 }} />,
    );
    expect(presence()).toHaveLength(1);
  });

  it('5. the preview’s comunidades, the bars to scale, the first in brand', () => {
    const { container } = render(<MemberActivityReport t={t} sample={MEMBER_ACTIVITY_SAMPLE} />);
    const block = container.querySelector('[data-activity-block="communities"]') as HTMLElement;
    expect(
      [...block.querySelectorAll('li > span:first-child')].map((el) => el.textContent),
    ).toEqual(['Comunidade VIP', 'Geral', 'Eventos']);
    const fills = [...block.querySelectorAll<HTMLElement>('[data-bar-fill]')];
    expect(fills.map((fill) => fill.style.width)).toEqual([
      '100%',
      `${(19 / 31) * 100}%`,
      `${(8 / 31) * 100}%`,
    ]);
    expect(fills[0]?.className).toContain('bg-brand');
    expect(fills[1]?.className).toContain('bg-brand/45');
  });
});

describe('scale', () => {
  it('6. bounds floored and ceiled to the step, and no division by zero', () => {
    expect(niceBounds([32, 41, 28, 45, 36, 52, 32], 10)).toEqual({ lo: 20, hi: 60 });
    expect(niceBounds([], 10)).toEqual({ lo: 0, hi: 10 });
    expect(linearPoints([5], 100, 100)).toEqual([{ x: 50, y: 100 }]);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(50, 40)).toBe(100);
  });
});
