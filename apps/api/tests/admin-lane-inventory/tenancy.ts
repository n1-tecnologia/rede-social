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
    ['verifiedTenantIdForHost', 'P', 7, 'host to tenant id, answered by the central mirror'],
    ['hasOpenInviteIn', 'T', 7],
    ['hasOpenInviteAnywhere', 'S', 7, 'asks every project through the central index'],
    [
      'tenantBrandRow',
      'P',
      7,
      'the tenant row and its verified primary host, both mirrored centrally',
    ],
  ]),
  ...group('packages/core/server/tenancy/member-admin.ts', [
    ['changeAccess', 'T', 5, undefined, 'migrated'],
    ['setMembershipRole', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/tenancy/public-tenant.ts', [
    ['getPublicTenant', 'S', 7],
    ['getTenantIdBySlug', 'P', 7, 'slug to tenant id, answered by the central mirror'],
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
