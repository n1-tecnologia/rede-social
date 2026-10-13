import { describe, expect, it } from 'vitest';
import {
  dailyAverageMinutes,
  formatCount,
  formatWeekdayShort,
  MEMBER_ACTIVITY_SAMPLE,
  MIN_STREAK_WEEKS,
} from './member-activity-sample';

/**
 * 2026-10-13 — the member's "Sua atividade" numbers. The claims: the sample is the
 * rede-social-dashboard preview's member report, value for value; the daily average rounds the
 * week; and the chart's labels are pt-BR weekdays without the dot.
 */

describe('MEMBER_ACTIVITY_SAMPLE — the dashboard preview’s member report', () => {
  it('keeps the preview’s values', () => {
    const { usage, peakHours, engagement, seen, attendance, weeklyStreak } = MEMBER_ACTIVITY_SAMPLE;
    expect(usage.days.map((day) => day.minutes)).toEqual([32, 41, 28, 45, 36, 52, 32]);
    expect(usage.delta).toEqual({ amount: 6, kind: 'minutes', direction: 'down' });
    expect(peakHours).toEqual({ fromHour: 20, toHour: 22 });
    expect(
      Object.fromEntries(Object.entries(engagement).map(([key, value]) => [key, value.count])),
    ).toEqual({ likes: 46, comments: 12, saves: 9, shares: 3 });
    expect(seen).toEqual({
      posts: { posts: 60, views: 128 },
      videos: { count: 41, minutes: 72 },
      stories: 23,
    });
    expect(MEMBER_ACTIVITY_SAMPLE.byCommunity.map((row) => [row.name, row.interactions])).toEqual([
      ['Comunidade VIP', 31],
      ['Geral', 19],
      ['Eventos', 8],
    ]);
    expect(attendance).toEqual({ attended: 3, events: 4 });
    expect(weeklyStreak).toBeGreaterThanOrEqual(MIN_STREAK_WEEKS);
  });

  it('the daily average rounds the week; no day is 0', () => {
    expect(dailyAverageMinutes(MEMBER_ACTIVITY_SAMPLE.usage.days)).toBe(38);
    expect(dailyAverageMinutes([{ minutes: 10 }, { minutes: 11 }])).toBe(11);
    expect(dailyAverageMinutes([])).toBe(0);
  });
});

describe('formatting', () => {
  it('pt-BR counts and weekdays without the dot', () => {
    expect(formatCount(1234)).toBe('1.234');
    expect(MEMBER_ACTIVITY_SAMPLE.usage.days.map((day) => formatWeekdayShort(day.date))).toEqual([
      'seg',
      'ter',
      'qua',
      'qui',
      'sex',
      'sáb',
      'dom',
    ]);
  });
});
