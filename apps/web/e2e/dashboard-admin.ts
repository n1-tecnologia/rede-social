import postgres from 'postgres';

/**
 * 08.7-01 e2e fixtures for the owner panel's snapshot (D-464): build a seed tenant's snapshot the way
 * the worker does, so a spec reads real numbers without waiting for the hourly dispatcher. Superuser
 * connection for fixtures only (the `admin.ts` posture and URL); application code never does this.
 */

/** The dashboard system lane's zero user: the builder refuses any other `sub` (42501). */
const DASHBOARD_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeDashboardAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/**
 * Deletes `slug`'s snapshot rows, then builds its snapshot of the tenant-local yesterday in ONE
 * transaction under the zero-user claims and `set local role authenticated` — the build job's own
 * lane, through the real `app.dashboard_build_snapshot`.
 */
export async function buildDashboardSnapshot(slug: string): Promise<void> {
  const db = sql();
  await db`
    delete from public.dashboard_snapshots
     where tenant_id = (select id from public.tenants where slug = ${slug})`;
  await db.begin(async (tx) => {
    const [tenant] = await tx<{ id: string; day: string }[]>`
      select id::text as id, ((now() at time zone timezone)::date - 1)::text as day
        from public.tenants where slug = ${slug}`;
    if (!tenant) throw new Error(`tenant ${slug} is not seeded`);
    const claims = JSON.stringify({
      sub: DASHBOARD_SYSTEM_USER_ID,
      role: 'authenticated',
      tenant_id: tenant.id,
      tenant_role: 'support_tenant',
    });
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`set local role authenticated`;
    await tx`select app.dashboard_build_snapshot(${tenant.day}::date)`;
  });
}

/**
 * What the Visão geral members card and freshness line must show for `slug`, computed independently
 * of the snapshot: the active members (role `member`, never blocked or deleted) who joined before the
 * tenant-local midnight of today, and the build's local `HH:mm`.
 */
export async function dashboardSnapshotFacts(
  slug: string,
): Promise<{ count: number; time: string }> {
  const [row] = await sql()<{ count: number; time: string }[]>`
    select (select count(*)::int
              from public.memberships m
             where m.tenant_id = t.id and m.role = 'member' and m.status = 'active'
               and m.blocked_at is null and m.deleted_at is null
               and m.joined_at < ((now() at time zone t.timezone)::date::timestamp
                                  at time zone t.timezone)) as count,
           to_char(s.built_at at time zone t.timezone, 'HH24:MI') as time
      from public.tenants t
      join public.dashboard_snapshots s on s.tenant_id = t.id
     where t.slug = ${slug}
     order by s.snapshot_day desc
     fetch first 1 rows only`;
  if (!row) throw new Error(`no dashboard snapshot for ${slug}: call buildDashboardSnapshot first`);
  return row;
}

/**
 * 08.7-08: the soonest event Eventos must show first for `slug`, computed independently of the
 * snapshot: the active, non-deleted event starting at or after the tenant-local midnight of today
 * (`starts_at, id`), its title and its RSVPs "vou" (`going` + `checked_in`). Null when none.
 */
export async function dashboardSoonestEventFacts(
  slug: string,
): Promise<{ id: string; title: string; confirmed: number } | null> {
  const [row] = await sql()<{ id: string; title: string; confirmed: number }[]>`
    select e.id::text as id, e.title,
           (select count(*)::int from public.event_attendances a
             where a.tenant_id = e.tenant_id and a.event_id = e.id
               and a.status in ('going', 'checked_in')) as confirmed
      from public.events e
      join public.tenants t on t.id = e.tenant_id
     where t.slug = ${slug}
       and e.status = 'active'
       and e.deleted_at is null
       and e.starts_at >= ((now() at time zone t.timezone)::date::timestamp at time zone t.timezone)
     order by e.starts_at, e.id
     fetch first 1 rows only`;
  return row ?? null;
}

/**
 * 08.7-12: whether `slug`'s newest snapshot raises any of the bell's three alerts, read from the
 * stored payload with the rules of the overview answer — the support queue (chat on), a member who
 * entered "em risco" in the last 7 days, the next upcoming live event with at most 10% of its seats
 * left and at least one (events on). The spec asserts the bell is present exactly when this is true.
 */
export async function dashboardAlertFacts(
  slug: string,
): Promise<{ support: number; atRisk: number; eventSoon: number }> {
  const [row] = await sql()<{ support: number; at_risk: number; event_soon: number }[]>`
    with s as (
      select s.tenant_id, s.payload
        from public.dashboard_snapshots s
        join public.tenants t on t.id = s.tenant_id
       where t.slug = ${slug}
       order by s.snapshot_day desc
       fetch first 1 rows only
    ),
    m as (
      select tm.module_key from public.tenant_modules tm, s
       where tm.tenant_id = s.tenant_id and tm.enabled
    )
    select
      case when exists (select 1 from m where module_key = 'chat')
           then coalesce((select (payload -> 'support' -> 'awaiting' ->> 'count')::int from s), 0)
           else 0 end as support,
      coalesce((select (payload -> 'overview' -> 'enteredAtRisk' ->> 'members')::int from s), 0)
        as at_risk,
      case when exists (select 1 from m where module_key = 'events') then (
        select count(*)::int
          from s, jsonb_array_elements(s.payload -> 'events' -> 'upcoming') u
          join public.events e on e.id = (u ->> 'id')::uuid
         where e.tenant_id = s.tenant_id and e.status = 'active' and e.deleted_at is null
           and (u ->> 'startsAt')::timestamptz > now()
           and u ->> 'capacity' is not null
           and (u ->> 'capacity')::int - (u ->> 'confirmed')::int >= 1
           and ((u ->> 'capacity')::int - (u ->> 'confirmed')::int) * 10 <= (u ->> 'capacity')::int)
      else 0 end as event_soon`;
  if (!row) throw new Error(`no dashboard snapshot for ${slug}: call buildDashboardSnapshot first`);
  return { support: row.support, atRisk: row.at_risk, eventSoon: row.event_soon };
}
