/**
 * 2026-10-13 — the numbers of the member's "Sua atividade" on `/perfil`: SAMPLE values, the same the
 * rede-social-dashboard preview shows for its member level (`memberPanel` of `module-dashboard`), in
 * the app untagged by the owner's decision (2026-10-13: "só front, sem etiqueta"). Every member sees
 * these same numbers until the backend measures them (`docs/pendencias-backend.md` item 9: the
 * usage sessions, saves, shares, post views and video playback are not recorded anywhere yet, and
 * the likes, comments, story views, per-community interactions, presence and streak have no route).
 * "Onde você mais participa" included: its comunidades are the preview's, not the tenant's (the owner
 * asked for the report exactly as the preview shows it).
 *
 * Pure, no React and no catalog: the report component formats and words everything.
 */

/** A change against the 7 days before (the report describes, it never grades: no good or bad). */
export type ActivityDelta = {
  amount: number;
  kind: 'count' | 'minutes';
  direction: 'up' | 'down' | 'flat';
};

export type MemberActivitySample = {
  /** Minutes in the app per day, the last 7 complete days, oldest first. */
  usage: { days: { date: string; minutes: number }[]; delta: ActivityDelta };
  /** The two-hour slot of the most use, in the tenant's hours. */
  peakHours: { fromHour: number; toHour: number };
  engagement: Record<
    'likes' | 'comments' | 'saves' | 'shares',
    { count: number; delta: ActivityDelta }
  >;
  seen: {
    /** Distinct posts seen (and the views over them). */
    posts: { posts: number; views: number };
    /** Videos and reels watched, and the minutes spent on them. */
    videos: { count: number; minutes: number };
    stories: number;
  };
  /** Interactions (likes + comments) per comunidade, most first: the bars. */
  byCommunity: readonly { id: string; name: string; interactions: number }[];
  /** Events with a check-in vs the events confirmed, last 30 days. */
  attendance: { attended: number; events: number };
  /** Consecutive weeks with at least one counted action. */
  weeklyStreak: number;
};

export const MEMBER_ACTIVITY_SAMPLE: MemberActivitySample = {
  usage: {
    days: [
      { date: '2026-10-05', minutes: 32 },
      { date: '2026-10-06', minutes: 41 },
      { date: '2026-10-07', minutes: 28 },
      { date: '2026-10-08', minutes: 45 },
      { date: '2026-10-09', minutes: 36 },
      { date: '2026-10-10', minutes: 52 },
      { date: '2026-10-11', minutes: 32 },
    ],
    delta: { amount: 6, kind: 'minutes', direction: 'down' },
  },
  peakHours: { fromHour: 20, toHour: 22 },
  engagement: {
    likes: { count: 46, delta: { amount: 8, kind: 'count', direction: 'up' } },
    comments: { count: 12, delta: { amount: 3, kind: 'count', direction: 'up' } },
    saves: { count: 9, delta: { amount: 2, kind: 'count', direction: 'up' } },
    shares: { count: 3, delta: { amount: 1, kind: 'count', direction: 'down' } },
  },
  seen: {
    posts: { posts: 60, views: 128 },
    videos: { count: 41, minutes: 72 },
    stories: 23,
  },
  byCommunity: [
    { id: 'c-vip', name: 'Comunidade VIP', interactions: 31 },
    { id: 'c-geral', name: 'Geral', interactions: 19 },
    { id: 'c-eventos', name: 'Eventos', interactions: 8 },
  ],
  attendance: { attended: 3, events: 4 },
  weeklyStreak: 6,
};

/** Below this many weeks the streak card is not shown (a one-week "streak" says nothing). */
export const MIN_STREAK_WEEKS = 2;

/** The average minutes per day of a window, rounded to whole minutes (0 for no days). */
export function dailyAverageMinutes(days: readonly { minutes: number }[]): number {
  if (days.length === 0) return 0;
  return Math.round(days.reduce((total, day) => total + day.minutes, 0) / days.length);
}

const INTEGER = new Intl.NumberFormat('pt-BR');
const WEEKDAY_SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });

/** A count in pt-BR (`1.234`). */
export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** `2026-10-05` -> `seg` (the chart's x labels: no trailing dot). */
export function formatWeekdayShort(isoDate: string): string {
  return WEEKDAY_SHORT.format(new Date(`${isoDate}T00:00:00Z`)).replace('.', '');
}
