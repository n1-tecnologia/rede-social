import type { AdminLaneEntry } from './index';

/**
 * The accounts area (`packages/core/server/accounts/*`, 13-13): the `accounts.anonymise-due` job. Every site is
 * a project-wide lane, `withAdminTx({ projectId })` of the project the worker's queue belongs to (class L, the
 * daily dispatcher's precedent): the due list crosses tenants on purpose, the Auth lookups and the mail are
 * outside any transaction, and the re-arm and the boot arm are the job's own enqueue. One row per site, in
 * site order. `plan` is the plan number inside Phase 13 (the column predates it; the 09.2 plans own 1..25).
 */
const note = 'project-wide job lane (13-13): the due list crosses tenants by design';

export const accounts: readonly AdminLaneEntry[] = [
  ...(
    [
      ['productionDeps', 'listDue'],
      ['productionDeps', 'tenantFacts'],
      ['productionDeps', 'hasOtherMemberships'],
      ['productionDeps', 'anonymise'],
      ['productionDeps', 'scrubMirrors'],
      ['rearmAnonymiseDue', 'the next hourly run under the constant singleton key'],
      ['armAnonymiseDue', 'the boot run under its own singleton key'],
    ] as const
  ).map(
    ([fn, what]): AdminLaneEntry => ({
      file: 'packages/core/server/accounts/anonymise-job.ts',
      fn,
      class: 'L',
      status: 'migrated',
      plan: 13,
      note: `${note}; ${what}`,
    }),
  ),
];
