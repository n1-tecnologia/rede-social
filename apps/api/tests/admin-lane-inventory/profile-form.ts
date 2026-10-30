import type { AdminLaneEntry, SiteClass, SiteStatus } from './index';

/** The profile-form area (`packages/core/server/profile-form/*`). One row per site, in site order. */
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

export const profileForm: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/profile-form/export.ts', [
    [
      'readPage',
      'T',
      10,
      'Phase 12-10 (D-595): the answers export reads the members page by page; the e-mail lives in `users`, readable only in the admin lane, so every statement carries the explicit `m.tenant_id` and `a.tenant_id` predicate of ctx.tenantId (RLS is off)',
      'migrated',
    ],
  ]),
];
