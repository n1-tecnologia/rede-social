import type { MemberActivityCommunity } from '@rede-social/module-dashboard/contracts';

/**
 * 08.7-03 — the pure helpers of the member's "Sua atividade" (`MemberActivityReport`): the API sends
 * raw integers (`{ count, previous }`), this file turns them into what the report draws. No React and
 * no catalog: the report words everything. The helpers the retired sample file held
 * (`MIN_STREAK_WEEKS`, `formatCount`, `formatWeekdayShort`) live here now.
 */

/** A change against the 7 days before (the report describes, it never grades: no good or bad). */
export type ActivityDelta = { amount: number; direction: 'up' | 'down' | 'flat' };

/** Below this many weeks the streak tile is not shown (a one-week "streak" says nothing, UI-D-483). */
export const MIN_STREAK_WEEKS = 2;

/**
 * The count difference of the last 7 days against the 7 before (planning decision 3): the amount is
 * `|count - previous|`, the direction what the number did. A real 0 against 0 is a flat 0 chip
 * (UI-D-481), never "Em breve".
 */
export function activityDelta(count: number, previous: number): ActivityDelta {
  const diff = count - previous;
  return {
    amount: Math.abs(diff),
    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
  };
}

/** One "Onde você mais participa" bar, ready for `BarList`. */
export type CommunityRow = { id: string; label: string; interactions: number };

/** The bar id of the tenant-wide feed (the `communityId: null` row). */
export const TENANT_FEED_ROW_ID = 'tenant-feed';

/**
 * The answer's per-community rows ranked for the bars (EP-05, EP-08, UI-D-475): rows at 0 dropped,
 * the tenant-wide feed labelled `tenantFeedLabel` ("Início") and ranked by its value like any
 * community (never pinned), most interactions first, then the label in pt-BR, then the id, so two
 * renders of the same snapshot agree whatever the input order. A community's name is kept exactly
 * as stored (EP-07); the bar renders it as text.
 */
export function rankCommunityRows(
  rows: readonly MemberActivityCommunity[],
  tenantFeedLabel: string,
): CommunityRow[] {
  return rows
    .filter((row) => row.interactions > 0)
    .map((row) => ({
      id: row.communityId ?? TENANT_FEED_ROW_ID,
      label: row.communityId === null ? tenantFeedLabel : (row.name ?? ''),
      interactions: row.interactions,
    }))
    .sort(
      (a, b) =>
        b.interactions - a.interactions ||
        a.label.localeCompare(b.label, 'pt-BR') ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

const INTEGER = new Intl.NumberFormat('pt-BR');
const WEEKDAY_SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });

/** A count in pt-BR (`1.234`). */
export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** `2026-10-05` -> `seg` (a chart's x labels: no trailing dot). */
export function formatWeekdayShort(isoDate: string): string {
  return WEEKDAY_SHORT.format(new Date(`${isoDate}T00:00:00Z`)).replace('.', '');
}
