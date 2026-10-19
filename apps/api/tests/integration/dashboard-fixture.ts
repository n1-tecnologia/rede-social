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

/**
 * One like of `userId` on `postId` (or, 08.7-06, on `storyId`), at the tenant-local `localTime`
 * (noon by default) of D-`k`.
 */
export async function insertLikeAt(input: {
  tenantId: string;
  userId: string;
  postId?: string;
  storyId?: string;
  k: number;
  localTime?: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, input.localTime ?? '12:00');
  await adminSql`
    insert into public.feed_likes (tenant_id, user_id, post_id, story_id, created_at)
    values (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.postId ?? null}::uuid,
            ${input.storyId ?? null}::uuid, ${at}::timestamptz)`;
}

/**
 * One ROOT comment of `userId` on `postId` (or, 08.7-06, on `storyId`) at the tenant-local
 * `localTime` (noon by default) of D-`k`; `deletedBy` soft-deletes it an hour later (the author:
 * self-deleted; a moderator: removed). Neither kind ever counts (UI-D-484). Answers its id.
 * `at` (08.7-06) dates it at an exact instant instead (the 24-hour cut of the unanswered list).
 */
export async function insertCommentAt(input: {
  tenantId: string;
  userId: string;
  postId?: string;
  storyId?: string;
  k: number;
  localTime?: string;
  at?: string;
  body?: string;
  deletedBy?: string;
}): Promise<string> {
  const at = input.at ?? (await instantOf(input.tenantId, input.k, input.localTime ?? '12:00'));
  const deleted = input.deletedBy !== undefined;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments
      (tenant_id, post_id, story_id, author_user_id, body, created_at, deleted_at, deleted_by_user_id)
    values (${input.tenantId}::uuid, ${input.postId ?? null}::uuid, ${input.storyId ?? null}::uuid,
            ${input.userId}::uuid, ${input.body ?? 'Comentário.'}, ${at}::timestamptz,
            case when ${deleted}::boolean then ${at}::timestamptz + interval '1 hour' end,
            ${input.deletedBy ?? null}::uuid)
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture comment');
  return row.id;
}

/**
 * 08.7-06: a reply of `userId` to the root comment `parentId` of `postId`, at the tenant-local
 * `localTime` of D-`k` (one reply level: a reply always names a post's root). A reply by current
 * staff answers the root (commentMeta, the unanswered list); a member's reply answers nothing.
 */
export async function insertReplyAt(input: {
  tenantId: string;
  userId: string;
  postId: string;
  parentId: string;
  k: number;
  localTime: string;
}): Promise<string> {
  const at = await instantOf(input.tenantId, input.k, input.localTime);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments
      (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind,
       created_at)
    values (${input.tenantId}::uuid, ${input.postId}::uuid, ${input.userId}::uuid, 'Resposta.', 1,
            ${input.parentId}::uuid, 0, 'post', ${at}::timestamptz)
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture reply');
  return row.id;
}

/** The kinds a fixture post can be published as (08.7-06, INSIGHT-10's kind rule). */
export type FixturePostKind = 'text' | 'link' | 'video' | 'photo' | 'carousel';

/** A `ready` media asset of `ownerUserId` for a fixture post or story (08.7-06). */
async function insertFixtureAsset(input: {
  tenantId: string;
  ownerUserId: string;
  kind: 'image' | 'video';
  purpose: 'post' | 'story';
  width: number;
  height: number;
  durationSeconds?: number;
}): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes,
                                     width, height, duration_seconds)
    values (${input.tenantId}::uuid, ${input.ownerUserId}::uuid, ${input.kind}, ${input.purpose},
            'ready', ${input.kind === 'video' ? 'video/mp4' : 'image/jpeg'}, 1024, ${input.width},
            ${input.height}, ${input.durationSeconds ?? null})
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture asset');
  return row.id;
}

/**
 * 08.7-06: a post of `authorUserId` (a fixture identity, so `removeIdentitiesByPrefix` takes it, its
 * media and its likes away) at the tenant-local `localTime` of D-`k`, of one kind: a `video` (one
 * 1080×1920 42-second video row), a `photo` (one 1080×1350 image), a `carousel` (three images), a
 * `link` (a resolved link preview whose url starts with `linkPrefix`, removed by
 * `removeDashboardFixtures`) or `text`. `at` dates it at an exact instant instead.
 */
export async function insertPostAt(input: {
  tenantId: string;
  authorUserId: string;
  k: number;
  localTime?: string;
  at?: string;
  kind?: FixturePostKind;
  communityId?: string;
  caption?: string;
  linkPrefix?: string;
}): Promise<string> {
  const kind = input.kind ?? 'text';
  const at = input.at ?? (await instantOf(input.tenantId, input.k, input.localTime ?? '12:00'));
  let previewId: string | null = null;
  if (kind === 'link') {
    const url = `${input.linkPrefix ?? 'https://painel.example/fixture'}/${Math.random().toString(36).slice(2)}`;
    const [preview] = await adminSql<{ id: string }[]>`
      insert into public.feed_link_previews (tenant_id, url_hash, url, status, title)
      values (${input.tenantId}::uuid, md5(${url}), ${url}, 'resolved', 'Página')
      returning id::text as id`;
    previewId = preview?.id ?? null;
  }
  const mediaKind =
    kind === 'video' ? 'video' : kind === 'photo' || kind === 'carousel' ? 'gallery' : 'none';
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, community_id, caption, media_kind, link_preview_id,
                                   author_user_id, created_at)
    values (${input.tenantId}::uuid, ${input.communityId ?? null}::uuid, ${input.caption ?? 'Aviso.'},
            ${mediaKind}, ${previewId}::uuid, ${input.authorUserId}::uuid, ${at}::timestamptz)
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture post');
  const images = kind === 'photo' ? 1 : kind === 'carousel' ? 3 : 0;
  for (let position = 0; position < images; position += 1) {
    const asset = await insertFixtureAsset({
      tenantId: input.tenantId,
      ownerUserId: input.authorUserId,
      kind: 'image',
      purpose: 'post',
      width: 1080,
      height: 1350,
    });
    await adminSql`
      insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${input.tenantId}::uuid, ${row.id}::uuid, 'gallery', ${asset}::uuid, 'image', ${position})`;
  }
  if (kind === 'video') {
    const asset = await insertFixtureAsset({
      tenantId: input.tenantId,
      ownerUserId: input.authorUserId,
      kind: 'video',
      purpose: 'post',
      width: 1080,
      height: 1920,
      durationSeconds: 42,
    });
    await adminSql`
      insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${input.tenantId}::uuid, ${row.id}::uuid, 'video', ${asset}::uuid, 'video', 0)`;
  }
  return row.id;
}

/**
 * 08.7-06: an image story of `authorUserId` published at the tenant-local `localTime` of D-`k`
 * (expired 24 hours later). `removeDashboardFixtures` deletes the stories of its prefix first (a
 * story holds its media asset and its author).
 */
export async function insertStoryAt(input: {
  tenantId: string;
  authorUserId: string;
  k: number;
  localTime?: string;
}): Promise<string> {
  const at = await instantOf(input.tenantId, input.k, input.localTime ?? '12:00');
  const asset = await insertFixtureAsset({
    tenantId: input.tenantId,
    ownerUserId: input.authorUserId,
    kind: 'image',
    purpose: 'story',
    width: 1080,
    height: 1920,
  });
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption,
                                published_at, expires_at)
    values (${input.tenantId}::uuid, ${input.authorUserId}::uuid, ${asset}::uuid, 'image', 'Bastidores',
            ${at}::timestamptz, ${at}::timestamptz + interval '24 hours')
    returning id::text as id`;
  if (!row) throw new Error('could not insert the fixture story');
  return row.id;
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
  /** 08.7-06: view exactly this story. */
  storyId?: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, input.localTime ?? '12:00');
  const rows = await adminSql<{ id: string }[]>`
    insert into public.story_views (tenant_id, user_id, story_id, viewed_at)
    select ${input.tenantId}::uuid, ${input.userId}::uuid, s.id, ${at}::timestamptz
      from public.stories s
     where s.tenant_id = ${input.tenantId}::uuid
       and s.deleted_at is null
       and (${input.storyId ?? null}::uuid is null or s.id = ${input.storyId ?? null}::uuid)
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

/** One paid order of `userId` for `productId`, `paid_at` at noon of D-`k`, of `cents` (1990 by default). */
export async function insertPaidOrderAt(input: {
  tenantId: string;
  userId: string;
  productId: string;
  k: number;
  cents?: number;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, '12:00');
  await adminSql`
    insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency,
                                     created_at, paid_at)
    values (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.productId}::uuid, 'paid',
            ${input.cents ?? 1990}, 'BRL', ${at}::timestamptz, ${at}::timestamptz)`;
}

/**
 * 08.7-04: the support thread of `memberUserId` in `tenantId` (one per member, D-221), with its
 * participant row. Delete it with `removeSupportThreads` BEFORE `removeDashboardFixtures`: a
 * message's author is a plain `users` reference, so an identity with messages cannot go first.
 */
export async function insertSupportThreadAt(input: {
  tenantId: string;
  memberUserId: string;
}): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
    values (${input.tenantId}::uuid, 'support', ${input.memberUserId}::uuid)
    returning id::text as id`;
  if (!row) throw new Error('could not insert the support thread');
  await adminSql`
    insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
    values (${row.id}::uuid, ${input.tenantId}::uuid, ${input.memberUserId}::uuid, 'member')`;
  return row.id;
}

/** One support message on `conversationId`, `created_at` at the tenant-local `localTime` of D-`k`. */
export async function insertSupportMessageAt(input: {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  side: 'member' | 'staff';
  k: number;
  localTime: string;
}): Promise<void> {
  const at = await instantOf(input.tenantId, input.k, input.localTime);
  await adminSql`
    insert into public.chat_messages
      (tenant_id, conversation_id, author_user_id, author_side, body, created_at)
    values (${input.tenantId}::uuid, ${input.conversationId}::uuid, ${input.authorUserId}::uuid,
            ${input.side}, 'Mensagem do teste.', ${at}::timestamptz)`;
}

/** Deletes the support threads (and, by cascade, their messages) the given members opened. */
export async function removeSupportThreads(memberUserIds: readonly string[]): Promise<void> {
  if (memberUserIds.length === 0) return;
  await adminSql`
    delete from public.chat_conversations
     where kind = 'support' and created_by_user_id = any (${memberUserIds as string[]}::uuid[])`;
}

/**
 * Removes every identity named `<prefix>-…` (memberships cascade) and every seed tenant's snapshots
 * and member rows. 08.7-06: their stories go first (a story holds its media asset and its author,
 * and takes its likes, comments and views with it), and the link previews of `linkPrefix`.
 */
export async function removeDashboardFixtures(prefix: string, linkPrefix?: string): Promise<void> {
  await adminSql`
    delete from public.stories
     where author_user_id in (select id from auth.users where email like ${`${prefix}-%`})`;
  await removeIdentitiesByPrefix(prefix);
  if (linkPrefix) {
    await adminSql`delete from public.feed_link_previews where url like ${`${linkPrefix}%`}`;
  }
  await adminSql`
    delete from public.dashboard_snapshots
     where tenant_id in (select id from public.tenants where slug in ('rede-demo', 'rede-lab'))`;
  // 08.7-02: the builds wrote member rows for the seed members too (latest only); none outlive a suite.
  await adminSql`
    delete from public.dashboard_member_snapshots
     where tenant_id in (select id from public.tenants where slug in ('rede-demo', 'rede-lab'))`;
}
