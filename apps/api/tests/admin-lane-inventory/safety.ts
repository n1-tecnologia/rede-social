import type { AdminLaneEntry } from './index';

/**
 * The safety area (`packages/core/server/safety/*`, 13-14): the one admin-lane site of the reports resolution. A
 * `block_author` resolution writes `memberships`, which the tenant lane refuses by design, so it opens the admin lane
 * for the tenant of record (class T) and runs the report's SQL definer under the caller's own claims inside it. `plan`
 * is the plan number inside Phase 13 (the column predates it; the 09.2 plans own 1..25).
 */
export const safety: readonly AdminLaneEntry[] = [
  {
    file: 'packages/core/server/safety/reports.ts',
    fn: 'resolveReport',
    class: 'T',
    status: 'migrated',
    plan: 14,
    note: 'block_author (13-14): the resolution and the Phase 8 block in ONE admin-lane transaction; the definer runs under the caller claims (asTenantLane)',
  },
];
