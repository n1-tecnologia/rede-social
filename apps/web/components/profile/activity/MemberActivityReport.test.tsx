// @vitest-environment happy-dom
import { KpiCard as ModuleKpiCard } from '@rede-social/module-dashboard/ui';
import type { MemberActivityReady } from '@rede-social/module-dashboard/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard';
import { type ActivityT, MemberActivityReport } from './MemberActivityReport';
import { barPercent, linearPoints, niceBounds } from './scale';

/**
 * 08.7-03 — the member's "Sua atividade" on the real answer (`GET /v1/dashboard/activity`). Claims:
 *  1. the freshness line is the report body's first child, then the blocks in the prototype order
 *     (D-457, UI-D-468); no freshness line when none is given (the super_admin preview);
 *  2. "Tempo de uso" is ONE full-width "Em breve" tile with the block note, no chart image and no
 *     "Pico de uso" footer (UI-D-467);
 *  3. engagement is likes, comments, saves, shares in that order whatever the values (EP-03): likes
 *     and comments real with their count change, saves and shares "Em breve" tiles with no number,
 *     no chip and no link (EP-11);
 *  4. "O que você viu": stories real, posts, videos and time "Em breve" (D-458);
 *  5. communities: absent without `byCommunity`, the empty line at none, "Início" for the null row,
 *     the bars to scale (UI-D-475, EP-06);
 *  6. presence: the streak tile only from MIN_STREAK_WEEKS; 0 events reads "0" with its note; the
 *     block is absent when both tiles are (UI-D-485);
 *  7. EP-12: the member tile and the module tile say the same "Em breve" and "Medição a caminho".
 *
 * `t` and `tr` are sentinels that echo their key (and values), prefixed by their namespace, so the
 * test reads which catalog each place asks for. Plain DOM assertions (no jest-dom in the web).
 */

const echo =
  (ns: string): ActivityT =>
  (key, values) =>
    values
      ? `${ns}.${key}(${Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : `${ns}.${key}`;
const t = echo('a');
const tr = echo('r');

const COMMUNITY_A = '11111111-1111-4111-8111-111111111111';
const COMMUNITY_B = '22222222-2222-4222-8222-222222222222';

const READY: MemberActivityReady = {
  state: 'ready',
  snapshot: { day: '2026-10-17', builtAt: '2026-10-18T03:30:00Z' },
  likes: { count: 3, previous: 1 },
  comments: { count: 0, previous: 0 },
  saves: { measured: false, reason: 'needs_saves' },
  shares: { measured: false, reason: 'needs_shares' },
  usage: { measured: false, reason: 'needs_usage_sessions' },
  seen: {
    stories: 7,
    posts: { measured: false, reason: 'needs_post_views' },
    videos: { measured: false, reason: 'needs_video_playback' },
  },
  byCommunity: [
    { communityId: COMMUNITY_A, name: 'Geral', interactions: 4 },
    { communityId: null, name: null, interactions: 8 },
    { communityId: COMMUNITY_B, name: 'Avisos', interactions: 2 },
  ],
  attendance: { attended: 2, events: 3 },
  weekStreak: 4,
};

afterEach(cleanup);

const blocksOf = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-activity-block]')].map((el) =>
    el.getAttribute('data-activity-block'),
  );
const block = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-activity-block="${id}"]`) as HTMLElement;
const values = (container: HTMLElement, id: string) =>
  [...block(container, id).querySelectorAll('[data-activity-value]')].map((el) => el.textContent);

function renderReport(answer: MemberActivityReady = READY, freshness: string | null = 'FRESH') {
  return render(<MemberActivityReport t={t} tr={tr} answer={answer} freshness={freshness} />);
}

describe('MemberActivityReport (the real answer)', () => {
  it('1. the freshness line first, then the five blocks in the prototype order', () => {
    const { container, rerender } = renderReport();
    const body = container.querySelector('[data-member-activity]') as HTMLElement;
    expect(body.firstElementChild?.hasAttribute('data-snapshot-freshness')).toBe(true);
    expect(body.firstElementChild?.textContent).toBe('FRESH');
    expect(blocksOf(container)).toEqual(['usage', 'engagement', 'seen', 'communities', 'presence']);
    rerender(<MemberActivityReport t={t} tr={tr} answer={READY} freshness={null} />);
    expect(container.querySelector('[data-snapshot-freshness]')).toBeNull();
  });

  it('2. usage: one full-width Em breve tile with the block note, no chart and no peak footer', () => {
    const { container } = renderReport();
    const usage = block(container, 'usage');
    expect(within(usage).getByRole('heading', { level: 3 }).textContent).toBe('a.usage.title');
    const cards = usage.querySelectorAll('[data-activity-card]');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.hasAttribute('data-activity-missing')).toBe(true);
    expect(usage.querySelector('[data-activity-value]')?.textContent).toBe('r.comingSoon.value');
    expect(usage.textContent).toContain('a.usage.average');
    expect(usage.textContent).toContain('r.comingSoon.block');
    expect(usage.querySelector('[role="img"]')).toBeNull();
    expect(usage.querySelector('svg[role="img"]')).toBeNull();
    expect(usage.textContent).not.toContain('peak');
  });

  it('3. engagement: likes, comments, saves, shares in order; the two missing tiles have no number, chip or link (EP-03, EP-11)', () => {
    const { container, rerender } = renderReport();
    const labels = () =>
      [...block(container, 'engagement').querySelectorAll('[data-activity-card]')].map(
        (card) => card.querySelector('[data-activity-label]')?.textContent,
      );
    expect(labels()).toEqual([
      'a.engagement.likes',
      'a.engagement.comments',
      'a.engagement.saves',
      'a.engagement.shares',
    ]);
    expect(values(container, 'engagement')).toEqual([
      '3',
      '0',
      'r.comingSoon.value',
      'r.comingSoon.value',
    ]);
    const cards = [...block(container, 'engagement').querySelectorAll('[data-activity-card]')];
    // Likes 3 vs 1: the chip says 2 up; comments 0 vs 0: a flat 0 chip (UI-D-481), never Em breve.
    expect(within(cards[0] as HTMLElement).getByText('a.vsLastWeek(amount=2)').className).toContain(
      'sr-only',
    );
    expect(within(cards[1] as HTMLElement).getByText('a.vsLastWeek(amount=0)')).toBeTruthy();
    for (const missing of cards.slice(2)) {
      expect(missing.hasAttribute('data-activity-missing')).toBe(true);
      expect(missing.querySelector('[data-activity-delta]')).toBeNull();
      expect(missing.querySelector('a')).toBeNull();
      expect(missing.textContent).toContain('r.comingSoon.note');
      expect(missing.textContent).not.toMatch(/\d|—|–/);
    }
    // EP-03: the order holds whatever the values.
    rerender(
      <MemberActivityReport
        t={t}
        tr={tr}
        answer={{ ...READY, likes: { count: 0, previous: 9 }, comments: { count: 99, previous: 0 } }}
        freshness={null}
      />,
    );
    expect(labels()).toEqual([
      'a.engagement.likes',
      'a.engagement.comments',
      'a.engagement.saves',
      'a.engagement.shares',
    ]);
  });

  it('4. seen: posts, stories, videos, time; only stories carries a number (D-458)', () => {
    const { container } = renderReport();
    expect(values(container, 'seen')).toEqual([
      'r.comingSoon.value',
      '7',
      'r.comingSoon.value',
      'r.comingSoon.value',
    ]);
    const missing = block(container, 'seen').querySelectorAll('[data-activity-missing]');
    expect(missing).toHaveLength(3);
  });

  it('5. communities: ranked bars, Início for the tenant feed; the empty line at none; absent without byCommunity', () => {
    const { container, rerender } = renderReport();
    const rows = () =>
      [...block(container, 'communities').querySelectorAll('li > span:first-child')].map(
        (el) => el.textContent,
      );
    expect(rows()).toEqual(['r.tenantFeed', 'Geral', 'Avisos']);
    const fills = [
      ...block(container, 'communities').querySelectorAll<HTMLElement>('[data-bar-fill]'),
    ];
    expect(fills.map((fill) => fill.style.width)).toEqual(['100%', '50%', '25%']);

    rerender(
      <MemberActivityReport
        t={t}
        tr={tr}
        answer={{ ...READY, byCommunity: [] }}
        freshness={null}
      />,
    );
    expect(block(container, 'communities').querySelector('[data-activity-bars]')).toBeNull();
    expect(block(container, 'communities').textContent).toContain('a.communities.empty');

    rerender(
      <MemberActivityReport
        t={t}
        tr={tr}
        answer={{ ...READY, byCommunity: [READY.byCommunity?.[0] as never] }}
        freshness={null}
      />,
    );
    expect(rows()).toEqual(['Geral']);

    const { byCommunity: _gone, ...noCommunities } = READY;
    rerender(<MemberActivityReport t={t} tr={tr} answer={noCommunities} freshness={null} />);
    expect(blocksOf(container)).toEqual(['usage', 'engagement', 'seen', 'presence']);
  });

  it('6. presence: streak only from 2 weeks; 0 events is "0" with its note; no block without both tiles', () => {
    const { container, rerender } = renderReport();
    const cards = () => block(container, 'presence').querySelectorAll('[data-activity-card]');
    expect(cards()).toHaveLength(2);
    expect(values(container, 'presence')).toEqual([
      '2a.presence.attendanceOf(total=3)',
      '4a.presence.streakUnit(weeks=4)',
    ]);

    rerender(
      <MemberActivityReport t={t} tr={tr} answer={{ ...READY, weekStreak: 1 }} freshness={null} />,
    );
    expect(cards()).toHaveLength(1);
    rerender(
      <MemberActivityReport t={t} tr={tr} answer={{ ...READY, weekStreak: 2 }} freshness={null} />,
    );
    expect(cards()).toHaveLength(2);

    rerender(
      <MemberActivityReport
        t={t}
        tr={tr}
        answer={{ ...READY, attendance: { attended: 0, events: 0 } }}
        freshness={null}
      />,
    );
    expect(values(container, 'presence')[0]).toBe('0');
    expect(block(container, 'presence').textContent).toContain('a.presence.noEvents');

    const { attendance: _gone, ...noEvents } = READY;
    rerender(
      <MemberActivityReport t={t} tr={tr} answer={{ ...noEvents, weekStreak: 1 }} freshness={null} />,
    );
    expect(blocksOf(container)).toEqual(['usage', 'engagement', 'seen', 'communities']);
  });

  it('PR-3: the report never compares the member with others (no rank, percentile or average)', () => {
    const { container } = renderReport();
    expect(container.textContent).not.toMatch(/rank|percentil|média da comunidade|top \d|%/i);
  });
});

describe('EP-12: one "Em breve" family on both panels (D-456)', () => {
  it('the member tile and the module tile render the identical "Em breve" and "Medição a caminho"', () => {
    const value = tr('comingSoon.value');
    const note = tr('comingSoon.note');
    const member = render(<KpiCard icon={Clock} label="L" value={value} note={note} missing />);
    const memberText = member.container.textContent;
    cleanup();
    const owner = render(
      <ModuleKpiCard icon={Clock} label="L" value={value} note={note} variant="missing" />,
    );
    const ownerText = owner.container.textContent;
    expect(memberText).toBe(`L${value}${note}`);
    expect(ownerText).toBe(`L${value}${note}`);
    expect(screen.getByText(value)).toBeTruthy();
    expect(screen.getByText(note)).toBeTruthy();
  });
});

describe('scale', () => {
  it('bounds floored and ceiled to the step, and no division by zero', () => {
    expect(niceBounds([32, 41, 28, 45, 36, 52, 32], 10)).toEqual({ lo: 20, hi: 60 });
    expect(niceBounds([], 10)).toEqual({ lo: 0, hi: 10 });
    expect(linearPoints([5], 100, 100)).toEqual([{ x: 50, y: 100 }]);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(50, 40)).toBe(100);
  });
});
