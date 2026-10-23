import type { AdminLaneEntry, SiteClass, SiteStatus } from './index';

/** The tenancy area (`packages/core/server/tenancy/*`): sign-up, rules, member admin, the public lookups, the daily dispatcher. One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [
    fn: string,
    cls: SiteClass,
    plan: number,
    note?: string,
    status?: SiteStatus,
  ])[],
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note, status]) => ({
    file,
    fn,
    class: cls,
    status: status ?? 'pending',
    plan,
    ...(note ? { note } : {}),
  }));

export const tenancy: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/tenancy/accept-invite.ts', [
    ['acceptInvite', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/admin-members.ts', [
    ['getMemberForAdmin', 'T', 5, undefined, 'migrated'],
    ['listMembersForAdmin', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/daily-dispatch.ts', [
    ['runDailyTenantDispatch', 'L', 9],
    ['runDailyTenantDispatch', 'L', 9],
    ['armDailyTenantDispatch', 'L', 9],
  ]),
  ...group('packages/core/server/tenancy/join.ts', [
    ['joinState', 'T', 5, 'removed by plan 26', 'migrated'],
    ['joinTenant', 'T', 5, 'removed by plan 26', 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/mail-tenant.ts', [
    ['hasOpenInviteIn', 'T', 7, undefined, 'migrated'],
    [
      'hasOpenInviteAnywhere',
      'L',
      7,
      'no tenant in hand: one { projectId } lane per ready project, stopping at the first hit',
      'migrated',
    ],
  ]),
  ...group('packages/core/server/tenancy/member-admin.ts', [
    ['changeAccess', 'T', 5, undefined, 'migrated'],
    ['setMembershipRole', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/mirror.ts', [
    [
      'pushToTenant',
      'T',
      7,
      'the copy of the central-owned columns, written after the central commit',
      'migrated',
    ],
    ['pushToCentral', 'T', 7, 'reads the tenant-owned brand from the tenant project', 'migrated'],
    ['reconcileTenantMirror', 'T', 7, 'reads the tenant project copy', 'migrated'],
    [
      'reconcileTenantMirror',
      'T',
      7,
      'seeds a missing tenant row from the central values',
      'migrated',
    ],
    ['reconcileTenantMirror', 'T', 7, 'writes the central-owned columns that differ', 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/public-tenant.ts', [
    [
      'getPublicTenant',
      'S',
      7,
      'identity from the platform lane first, rules text and checkout link from the tenant project',
      'migrated',
    ],
  ]),
  ...group('packages/core/server/tenancy/rules.ts', [
    ['getTenantRules', 'T', 5, undefined, 'migrated'],
    ['saveTenantRules', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/signup.ts', [
    ['isDuplicateEmail', 'T', 5, undefined, 'migrated'],
    ['existingIdentityForEmail', 'T', 5, undefined, 'migrated'],
    ['signupMember', 'T', 5, undefined, 'migrated'],
  ]),
];
