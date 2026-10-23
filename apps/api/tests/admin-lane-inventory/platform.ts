import type { AdminLaneEntry, SiteClass } from './index';

/** The platform area (`packages/core/server/platform/*`): domains, invites, branding, tenants, modules, the allow list. One row per site, in site order.
 *
 * 09.2-06: the P files (`domains.ts`, `platform-admins.ts`, `allow-list-lock.ts`, `reconcile-allow-list.ts`, `recordInviteSendOutcome`) now call `withPlatformTx` and so are no `withAdminTx` site at all: their rows left this list (the guard scans `withAdminTx(` only, and a row for a file with no site is a stale entry), the same way `tenant-host.ts` left it in 09.2-04. The grep in plan 06's acceptance criteria is what keeps them out.
 *
 * 09.2-07: the same for `listPlatformTenants`, `invalidateTenantHosts`, `setTenantStatus`, `setModuleEnabled`, `tenantExists` and `invalidateAllTenantHosts` (central tables, `withPlatformTx`). */
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
  ...group(
    'packages/core/server/platform/tenants.ts',
    [
      ['createTenant', 'S', 7, 'step 2 of the saga (the first-admin invite); step 1 is a platform transaction'],
      ['getTenantDetail', 'S', 7, 'invites and admins from the tenant project, after the central read'],
      ['updateTenant', 'S', 7, 'the brand colors; the display name is a central write'],
    ],
    'migrated',
  ),
];
