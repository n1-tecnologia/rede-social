import type { AdminLaneEntry, SiteClass } from './index';

/** The platform area (`packages/core/server/platform/*`): domains, invites, branding, tenants, modules, the allow list. One row per site, in site order.
 *
 * 09.2-06: the P files (`domains.ts`, `platform-admins.ts`, `allow-list-lock.ts`, `reconcile-allow-list.ts`, `recordInviteSendOutcome`) now call `withPlatformTx` and so are no `withAdminTx` site at all: their rows left this list (the guard scans `withAdminTx(` only, and a row for a file with no site is a stale entry), the same way `tenant-host.ts` left it in 09.2-04. The grep in plan 06's acceptance criteria is what keeps them out. */
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

export const platform: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/platform/branding.ts', [
    ['tenantExists', 'T', 7],
    ['invalidateAllTenantHosts', 'P', 7, 'reads tenant_domains of every tenant, all central'],
    [
      'completeBrandingUpload',
      'T',
      7,
      'writes the tenant row on the tenant project and pushes the central mirror afterwards',
    ],
    ['writeIconsIfCurrent', 'T', 7],
    ['deriveTenantIcons', 'T', 7],
    ['requeueIconDerivation', 'T', 7],
    [
      'setBrandingColors',
      'T',
      7,
      'writes the tenant row on the tenant project and pushes the central mirror afterwards',
    ],
    [
      'setBrandingLook',
      'T',
      7,
      'writes the tenant row on the tenant project and pushes the central mirror afterwards',
    ],
    [
      'removeIconOverride',
      'T',
      7,
      'writes the tenant row on the tenant project and pushes the central mirror afterwards',
    ],
  ]),
  ...group(
    'packages/core/server/platform/invite-send.ts',
    [
      [
        'scheduleInviteSends',
        'T',
        6,
        'the verified primary tenant_domains row is read first through the platform lane, in a transaction of its own (09.2-06)',
      ],
      ['runScheduledInviteSend', 'T', 6],
    ],
    'migrated',
  ),
  ...group(
    'packages/core/server/platform/invites.ts',
    [
      ['deliverExistingIdentityInvite', 'T', 6],
      ['refuseInvite', 'T', 6],
      [
        'sendPendingInvites',
        'T',
        6,
        'the verified primary tenant_domains row is read first through the platform lane, in a transaction of its own (09.2-06)',
      ],
      ['sendPendingInvites', 'T', 6],
      ['sendPendingInvites', 'T', 6],
      ['sendPendingInvites', 'T', 6],
      ['sendPendingInvites', 'T', 6],
      ['listTenantInvites', 'T', 6],
      [
        'resendInvite',
        'T',
        6,
        'the verified primary tenant_domains row is read first through the platform lane, in a transaction of its own (09.2-06)',
      ],
      ['resendInvite', 'T', 6],
      ['resendInvite', 'T', 6],
      ['resendInvite', 'T', 6],
      ['resendInvite', 'T', 6],
      ['resendInvite', 'T', 6],
    ],
    'migrated',
  ),
  ...group('packages/core/server/platform/modules.ts', [
    ['setModuleEnabled', 'S', 7],
    ['readModuleSettings', 'S', 7],
    ['patchModuleSettings', 'S', 7],
  ]),
  ...group('packages/core/server/platform/tenants.ts', [
    [
      'listPlatformTenants',
      'P',
      7,
      'the platform tenant list is read from the central tables (D-537)',
    ],
    ['createTenant', 'S', 7],
    ['getTenantDetail', 'S', 7],
    ['invalidateTenantHosts', 'P', 7, 'reads tenant_domains, central'],
    ['updateTenant', 'S', 7],
    ['setTenantStatus', 'S', 7],
  ]),
];
