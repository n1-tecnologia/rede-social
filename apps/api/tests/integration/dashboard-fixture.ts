import { runSnapshotBuild } from '@rede-social/module-dashboard/server';
import { adminSql, createSharedIdentity, type HOSTS, removeIdentitiesByPrefix } from './setup';

/**
 * 08.7 integration fixtures for the dashboard snapshot (D-464, R-Pitfall 13): the seed writes every
 * row "now", so the window edges are tested with memberships whose `joined_at` / `blocked_at` are
 * EXPLICIT tenant-local instants, and the build runs for an explicit day. Every identity is named
 * `<prefix>-…` and removed with `removeDashboardFixtures(prefix)`.
 */

/** The tenant-local yesterday of `tenantId` (D, the day a build at this instant covers), as SQL says. */
export async function dashboardDay(tenantId: string): Promise<string> {
  const [row] = await adminSql<{ day: string }[]>`
    select ((now() at time zone t.timezone)::date - 1)::text as day
      from public.tenants t where t.id = ${tenantId}::uuid`;
  if (!row) throw new Error(`no tenant ${tenantId}`);
  return row.day;
}

/** The tenant id behind a seed slug. */
export async function tenantIdOf(slug: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`tenant ${slug} is not seeded — run pnpm db:seed first`);
  return row.id;
}

/**
 * A throwaway identity with ONE membership in the seed tenant behind `host`, joined at the
 * tenant-local `localTime` of `daysAgo` days before the tenant-local today (0 = today, 1 = D):
 * `((today_local - daysAgo)::timestamp + localTime) at time zone tenants.timezone`. `blockedDaysAgo`
 * / `blockedLocalTime` stamp `blocked_at` (and `status = 'blocked'`) the same way. Answers the
 * membership id and its stored instant as UTC ISO.
 */
export async function insertMembershipAt(input: {
  prefix: string;
  host: keyof typeof HOSTS;
  daysAgo: number;
  localTime: string;
  role?: 'member' | 'admin_tenant' | 'support_tenant';
  blockedDaysAgo?: number;
  blockedLocalTime?: string;
}): Promise<{ membershipId: string; userId: string; joinedAtUtc: string }> {
  const { userId } = await createSharedIdentity({
    prefix: input.prefix,
    memberships: [{ host: input.host, role: input.role ?? 'member' }],
  });
  const blocked = input.blockedDaysAgo !== undefined;
  const [row] = await adminSql<{ id: string; joined_at_utc: string }[]>`
    update public.memberships m
       set joined_at = (((now() at time zone t.timezone)::date - ${input.daysAgo}::int)::timestamp
                        + ${input.localTime}::time) at time zone t.timezone,
           status = case when ${blocked}::boolean then 'blocked' else m.status end,
           blocked_at = case when ${blocked}::boolean
             then (((now() at time zone t.timezone)::date - ${input.blockedDaysAgo ?? 0}::int)::timestamp
                   + ${input.blockedLocalTime ?? '12:00'}::time) at time zone t.timezone
             else m.blocked_at end
      from public.tenants t
     where t.id = m.tenant_id and m.user_id = ${userId}::uuid
    returning m.id::text as id,
              to_char(m.joined_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as joined_at_utc`;
  if (!row) throw new Error(`could not date the membership of ${input.prefix}`);
  return { membershipId: row.id, userId, joinedAtUtc: row.joined_at_utc };
}

/**
 * Deletes `tenantId`'s snapshot of its tenant-local yesterday (as `adminSql`), then builds it again
 * through the real job body `runSnapshotBuild` (the zero-user lane). Answers the job's outcome.
 */
export async function rebuildDashboard(tenantId: string): Promise<'built' | 'skipped' | 'dropped'> {
  const day = await dashboardDay(tenantId);
  await adminSql`
    delete from public.dashboard_snapshots
     where tenant_id = ${tenantId}::uuid and snapshot_day = ${day}::date`;
  return runSnapshotBuild({ tenantId, day });
}

/** Removes every identity named `<prefix>-…` (memberships cascade) and every seed tenant's snapshots. */
export async function removeDashboardFixtures(prefix: string): Promise<void> {
  await removeIdentitiesByPrefix(prefix);
  await adminSql`
    delete from public.dashboard_snapshots
     where tenant_id in (select id from public.tenants where slug in ('rede-demo', 'rede-lab'))`;
}
