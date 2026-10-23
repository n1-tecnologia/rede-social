import type { AdminLaneEntry, SiteClass } from './index';

/** The operator scripts (`scripts/*`). One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [fn: string, cls: SiteClass, plan: number, note?: string])[],
  status: AdminLaneEntry['status'] = 'pending',
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note]) => ({
    file,
    fn,
    class: cls,
    status,
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
  // 09.2-06: the seed's control-plane writes (the tenant row and its icon patch, the enabled modules, the
  // domains, the platform admin) call `withPlatformTx`, so they are no `withAdminTx` site and have no row
  // here (the same way the P rows left `platform.ts`). What is left is tenant data, all `{ tenantId }`.
  ...group(
    'scripts/seed.ts',
    [
      ['seedEventAttendances', 'T', 6],
      ['seedPostImageAsset', 'T', 6],
      ['seedStoryImageAsset', 'T', 6],
      ['seedStoryVideoAsset', 'T', 6],
      ['seedAttachmentAsset', 'T', 6],
      ['seedVideoAsset', 'T', 6],
      ...Array.from({ length: 23 }, () => ['seedMemberProfile', 'T', 6] as const),
      [
        'grantSeedAccess',
        'T',
        6,
        'the tenant row is looked up through the platform lane first, then the access rows go through its own lane',
      ],
      [
        'grantSeedAccess',
        'T',
        6,
        "analyze is database-wide: it runs once per seeded tenant, through that tenant's lane",
      ],
    ],
    'migrated',
  ),
];
