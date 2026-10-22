import type { AdminLaneEntry, SiteClass } from './index';

/** The operator scripts (`scripts/*`). One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [fn: string, cls: SiteClass, plan: number, note?: string])[],
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note]) => ({
    file,
    fn,
    class: cls,
    status: 'pending',
    plan,
    ...(note ? { note } : {}),
  }));

export const scripts: readonly AdminLaneEntry[] = [
  ...group('scripts/arm-event-reminders.ts', [
    [
      '(module)',
      'L',
      9,
      'reads the events of every tenant: a per-project loop (the plan list said 06)',
    ],
  ]),
  ...group('scripts/seed.ts', [
    ['seedEventAttendances', 'T', 6],
    ['seedPostImageAsset', 'T', 6],
    ['seedStoryImageAsset', 'T', 6],
    ['seedStoryVideoAsset', 'T', 6],
    ['seedAttachmentAsset', 'T', 6],
    ['seedVideoAsset', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'P', 6, 'the tenant row, central'],
    ['seedMemberProfile', 'P', 6, 'the tenant row, central'],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'P', 6, 'tenant_domains, central'],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['seedMemberProfile', 'T', 6],
    ['grantSeedAccess', 'T', 6],
    ['grantSeedAccess', 'T', 6],
  ]),
];
