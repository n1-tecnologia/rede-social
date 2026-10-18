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
}): Promise<{ membershipId: string; userId: string; email: string; joinedAtUtc: string }> {
  const { userId, email } = await createSharedIdentity({
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
  return { membershipId: row.id, userId, email, joinedAtUtc: row.joined_at_utc };
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

/**
 * The SQL of a tenant-local instant: `localTime` of D-`k` in `tenantId`'s zone, D being the
 * tenant-local yesterday (the day a build at this instant covers). Every 08.7-02 action helper dates
 * its row with it, so the window edges are the builder's own (R-Pitfall 13).
 */
async function instantOf(tenantId: string, k: number, localTime: string): Promise<string> {
  const [row] = await adminSql<{ at: string }[]>`
    select to_char(
             ((((now() at time zone t.timezone)::date - 1 - ${k}::int)::timestamp + ${localTime}::time)
               at time zone t.timezone) at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from public.tenants t where t.id = ${tenantId}::uuid`;
  if (!row) throw new Error(`no tenant ${tenantId}`);
  return row.at;
}

/**
 * A tenant-wide (or community) post by `authorUserId`, published long before every window (D-150),
 * for the members' likes and comments to land on. Author it with a fixture identity so
 * `removeIdentitiesByPrefix` takes it (and every like on it) away.
 */
export async function insertFixturePost(input: {
  tenantId: string;
  authorUserId: string;
  communityId?: string;
  k?: number;
}): Promise<string> {
  const at = await instantOf(input.tenantId, input.k ?? 150, '09:00');
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, community_id, caption, author_user_id, created_at)
    values (${input.tenantId}::uuid, ${input.communityId ?? null}::uuid, 'Aviso.',
            ${input.authorUserId}::uuid, ${at}::timestamptz)
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture post');
  return row.id;
}

/** One like of `userId` on `postId`, at the tenant-local `localTime` (noon by default) of D-`k`. */
export async function insertLikeAt(input: {
  tenantId: string;
  userId: string;
  postId: string;
  k: number;
  localTime?: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, input.localTime ?? '12:00');
  await adminSql`
    insert into public.feed_likes (tenant_id, user_id, post_id, created_at)
    values (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.postId}::uuid, ${at}::timestamptz)`;
}

/**
 * One comment of `userId` on `postId` at noon of D-`k`; `deletedBy` soft-deletes it an hour later
 * (the author: self-deleted; a moderator: removed). Neither kind ever counts (UI-D-484).
 */
export async function insertCommentAt(input: {
  tenantId: string;
  userId: string;
  postId: string;
  k: number;
  deletedBy?: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, '12:00');
  const deleted = input.deletedBy !== undefined;
  await adminSql`
    insert into public.feed_comments
      (tenant_id, post_id, author_user_id, body, created_at, deleted_at, deleted_by_user_id)
    values (${input.tenantId}::uuid, ${input.postId}::uuid, ${input.userId}::uuid, 'Comentário.',
            ${at}::timestamptz,
            case when ${deleted}::boolean then ${at}::timestamptz + interval '1 hour' end,
            ${input.deletedBy ?? null}::uuid)`;
}

/**
 * A fixture event of `authorUserId` (write it with a fixture identity). `open: false` starts it in
 * 15 minutes, so an RSVP may still be written and it is the soonest of the panel's upcoming events;
 * `open: true` puts now inside its check-in window. The attendance guard judges `now()`, never the
 * stored instants, which is what lets `insertAttendanceAt` date them in the past.
 */
export async function insertFixtureEvent(input: {
  tenantId: string;
  authorUserId: string;
  open: boolean;
  code: string;
}): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    with e as (
      insert into public.events (tenant_id, created_by_user_id, title, format, venue_name, address,
                                 starts_at, ends_at, category, capacity)
      values (${input.tenantId}::uuid, ${input.authorUserId}::uuid, 'Encontro', 'in_person', 'Sede',
              'Rua A, 1',
              case when ${input.open}::boolean then now() - interval '30 minutes' else now() + interval '15 minutes' end,
              case when ${input.open}::boolean then now() + interval '1 hour' else now() + interval '2 hours' end,
              null, 50)
      returning id, tenant_id, format
    ), s as (
      insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
      select id, tenant_id, format, ${input.code} from e
    )
    select id::text as id from e`;
  if (!row) throw new Error('could not insert the fixture event');
  return row.id;
}

/**
 * One attendance row of `userId` dated at noon of D-`k`: `going` / `not_going` by `responded_at`
 * (the event must start in the future), `walk_in` / `checked_in` by `checked_in_at` (the event must
 * be open now; a `checked_in` row also answered "vou" a day earlier).
 */
export async function insertAttendanceAt(input: {
  tenantId: string;
  userId: string;
  eventId: string;
  status: 'going' | 'not_going' | 'checked_in' | 'walk_in';
  k: number;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, '12:00');
  const checkedIn = input.status === 'checked_in' || input.status === 'walk_in';
  const responded =
    input.status === 'walk_in'
      ? null
      : input.status === 'checked_in'
        ? await instantOf(input.tenantId, input.k + 1, '12:00')
        : at;
  await adminSql`
    insert into public.event_attendances
      (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via)
    values (${input.tenantId}::uuid, ${input.eventId}::uuid, ${input.userId}::uuid, ${input.status},
            ${responded}::timestamptz,
            case when ${checkedIn}::boolean then ${at}::timestamptz end,
            case when ${checkedIn}::boolean then 'code' end)`;
}

/**
 * 08.7-03: moves a fixture event (written open or in the future, so its attendances could be
 * inserted past the guard) to start at the tenant-local `localTime` of D-`k`, two hours long. No
 * trigger guards an event's schedule, so the attendances written before keep their instants.
 */
export async function moveFixtureEvent(input: {
  tenantId: string;
  eventId: string;
  k: number;
  localTime?: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, input.localTime ?? '12:00');
  await adminSql`
    update public.events
       set starts_at = ${at}::timestamptz, ends_at = ${at}::timestamptz + interval '2 hours'
     where id = ${input.eventId}::uuid and tenant_id = ${input.tenantId}::uuid`;
}

/**
 * 08.7-03: one story view of `userId` at the tenant-local `localTime` (noon by default) of D-`k`, on
 * a live story of the tenant this user has not viewed yet (a view is unique per member and story,
 * `story_views_uq`). The seed's stories are enough; `removeIdentitiesByPrefix` takes the views away.
 */
export async function insertStoryViewAt(input: {
  tenantId: string;
  userId: string;
  k: number;
  localTime?: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, input.localTime ?? '12:00');
  const rows = await adminSql<{ id: string }[]>`
    insert into public.story_views (tenant_id, user_id, story_id, viewed_at)
    select ${input.tenantId}::uuid, ${input.userId}::uuid, s.id, ${at}::timestamptz
      from public.stories s
     where s.tenant_id = ${input.tenantId}::uuid
       and s.deleted_at is null
       and not exists (select 1 from public.story_views v
                        where v.tenant_id = s.tenant_id and v.user_id = ${input.userId}::uuid
                          and v.story_id = s.id)
     order by s.id
     limit 1
    returning id::text as id`;
  if (rows.length === 0) throw new Error('no story left to view — the seed needs more stories');
}

/**
 * A store product for the paid-order fixtures, created by the seed admin (a product outlives its
 * orders); `removeFixtureProduct` deletes it after `removeDashboardFixtures` took the orders.
 */
export async function insertFixtureProduct(tenantId: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
    select ${tenantId}::uuid, m.user_id, 'Produto do painel', 1990
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     order by m.joined_at, m.id
     limit 1
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture product');
  return row.id;
}

export async function removeFixtureProduct(productId: string): Promise<void> {
  await adminSql`delete from public.store_orders where product_id = ${productId}::uuid`;
  await adminSql`delete from public.store_products where id = ${productId}::uuid`;
}

/** One paid order of `userId` for `productId`, `paid_at` at noon of D-`k`. */
export async function insertPaidOrderAt(input: {
  tenantId: string;
  userId: string;
  productId: string;
  k: number;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, '12:00');
  await adminSql`
    insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency,
                                     created_at, paid_at)
    values (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.productId}::uuid, 'paid', 1990,
            'BRL', ${at}::timestamptz, ${at}::timestamptz)`;
}

/** Removes every identity named `<prefix>-…` (memberships cascade) and every seed tenant's snapshots and member rows. */
export async function removeDashboardFixtures(prefix: string): Promise<void> {
  await removeIdentitiesByPrefix(prefix);
  await adminSql`
    delete from public.dashboard_snapshots
     where tenant_id in (select id from public.tenants where slug in ('rede-demo', 'rede-lab'))`;
  // 08.7-02: the builds wrote member rows for the seed members too (latest only); none outlive a suite.
  await adminSql`
    delete from public.dashboard_member_snapshots
     where tenant_id in (select id from public.tenants where slug in ('rede-demo', 'rede-lab'))`;
}
