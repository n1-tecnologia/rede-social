import type { SnapshotMeta } from '@rede-social/module-dashboard/contracts';

/** Which freshness line a snapshot reads (UI-D-468), with its interpolations. */
export interface FreshnessText {
  key: 'today' | 'past';
  values: { time: string; day?: string; date?: string };
}

/**
 * RED STUB (08.7-01 TDD): deliberately inert — it always answers the `past` form with an empty
 * time, so `dashboard-view.test.ts` fails on its assertions. The GREEN commit replaces it whole.
 */
export function freshnessText(
  _meta: Pick<SnapshotMeta, 'day' | 'builtAt'>,
  _timeZone: string,
  _nowMs: number,
): FreshnessText {
  return { key: 'past', values: { time: '' } };
}
