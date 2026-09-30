import postgres from 'postgres';
import { envValue } from './admin';
import { hosts, SEED_PASSWORD, users } from './fixtures';

/**
 * Fixtures for the Notificações e2e specs (07-01), the `events-admin.ts` shape: identity through
 * GoTrue, rows through a direct superuser connection.
 *
 * `publishPostAs` publishes through the REAL API (`POST /v1/feed/posts` with the admin's own
 * session), not through a row insert: the tracer must cross the bus, the sink and the fan-out job
 * exactly as a composer publish does. `feed-admin.ts` has no publish helper and the composer flow is
 * `feed-composer.spec.ts`'s own subject, so the API call is the narrowest honest producer.
 */

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeNotificationsAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/** The host the API resolves the demo tenant from (the same one the browser navigates). */
export const demoHost = new URL(hosts.demo).hostname;

async function accessToken(email: string, password: string): Promise<string> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  return ((await session.json()) as { access_token: string }).access_token;
}

/** Publishes a text post as `email` on `host` through the real API; returns the post id. */
export async function publishPostAs(
  email: string,
  caption: string,
  host = demoHost,
  password = SEED_PASSWORD,
): Promise<string> {
  const token = await accessToken(email, password);
  const res = await fetch(`${API_URL}/v1/feed/posts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ caption }),
  });
  if (res.status !== 201) {
    throw new Error(`POST /v1/feed/posts as ${email}: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/** Deletes every notification row of `tenantSlug` (the bell starts from zero). */
export async function clearNotifications(tenantSlug: string): Promise<void> {
  await sql()`
    delete from public.notifications
     where tenant_id in (select id from public.tenants where slug = ${tenantSlug})`;
}

/** Deletes the posts this spec wrote, by caption prefix, and the rows pointing at them. */
export async function deletePostsByCaptionPrefix(prefix: string): Promise<void> {
  await sql()`
    delete from public.notifications
     where subject_type = 'post'
       and subject_id in (select id from public.feed_posts where caption like ${`${prefix}%`})`;
  await sql()`delete from public.feed_posts where caption like ${`${prefix}%`}`;
}

/** A live post of `tenantSlug` the fixture rows point at, so a tapped row lands on a real page. */
async function anyLivePostId(tenantSlug: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    select p.id::text as id from public.feed_posts p
      join public.tenants t on t.id = p.tenant_id
     where t.slug = ${tenantSlug} and p.deleted_at is null and p.community_id is null
     order by p.created_at desc limit 1`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no live post in ${tenantSlug}`);
  return id;
}

/**
 * Writes `unread` unread rows and `read` read rows for `email` in `tenantSlug`, as the migration role,
 * each a `feed.post` whose excerpt is `${label} ${n}` (1-based, newest first: row 1 is the newest).
 * Every row points at one live post. Returns the excerpts in list order (Novas first, then Anteriores).
 */
export async function insertNotificationRows(
  email: string,
  counts: { unread: number; read: number },
  label = 'Linha',
  tenantSlug = 'rede-demo',
): Promise<{ unread: string[]; read: string[]; postId: string }> {
  const postId = await anyLivePostId(tenantSlug);
  const [who] = await sql()<{ tenant_id: string; user_id: string; actor: string }[]>`
    select t.id::text as tenant_id, u.id::text as user_id,
           (select m.user_id::text from public.memberships m
             where m.tenant_id = t.id and m.role = 'admin_tenant' limit 1) as actor
      from public.tenants t, auth.users u
     where t.slug = ${tenantSlug} and u.email = ${email}`;
  if (!who) throw new Error(`no ${email} in ${tenantSlug}`);
  const unread: string[] = [];
  const read: string[] = [];
  const total = counts.unread + counts.read;
  for (let n = 1; n <= total; n++) {
    const isRead = n > counts.unread;
    const excerpt = `${label} ${n}`;
    (isRead ? read : unread).push(excerpt);
    await sql()`
      insert into public.notifications
        (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, actor_user_id, payload,
         created_at, read_at, seen_at)
      values (${who.tenant_id}::uuid, ${who.user_id}::uuid, 'feed.post',
              ${`e2e:${label}:${n}:${Date.now()}`}, 'post', ${postId}::uuid, ${who.actor}::uuid,
              ${sql().json({ postId, excerpt, communityId: null, communityName: null, previewAssetId: null })},
              now() - make_interval(mins => ${n}),
              case when ${isRead}::boolean then now() end,
              case when ${isRead}::boolean then now() end)`;
  }
  return { unread, read, postId };
}

/* ── 07-04: the kinds e2e (`notifications tipos`) ──────────────────────────────────────────────── */

/** One authenticated API call as `email` on the demo host; throws on an unexpected status. */
async function apiAs(
  email: string,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  expected = [200, 201, 204],
): Promise<unknown> {
  const token = await accessToken(email, SEED_PASSWORD);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': demoHost,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!expected.includes(res.status)) {
    throw new Error(`${method} ${path} as ${email}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Writes a comment (or, with `parentId`, a reply) as `email` through the real API; returns its id. */
export async function commentAs(
  email: string,
  postId: string,
  body: string,
  parentId?: string,
): Promise<string> {
  const created = (await apiAs(
    email,
    'POST',
    `/v1/feed/posts/${postId}/comments`,
    parentId ? { body, parentId } : { body },
  )) as { id: string };
  return created.id;
}

/** Likes a comment as `email` through the real API (the `comment.liked` producer). */
export async function likeCommentAs(email: string, commentId: string): Promise<void> {
  await apiAs(email, 'POST', `/v1/feed/comments/${commentId}/like`);
}

/** Soft-deletes a post as `email` through the real API (the `post.deleted` retraction). */
export async function deletePostAs(email: string, postId: string): Promise<void> {
  await apiAs(email, 'DELETE', `/v1/feed/posts/${postId}`);
}

/** The member's notification rows of `kind` (optionally only the removed ones), as the migration role. */
export async function rowsOf(
  email: string,
  kind: string,
  { removed }: { removed?: boolean } = {},
): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from public.notifications n
      join auth.users u on u.id = n.user_id
     where u.email = ${email} and n.kind = ${kind}
       and (${removed ?? null}::boolean is null
            or (coalesce(n.payload->>'removed', 'false') = 'true') = ${removed ?? false}::boolean)`;
  return row?.n ?? 0;
}

/** Soft-deletes one comment as the migration role (the "deleted target" fixture). */
export async function softDeleteComment(commentId: string): Promise<void> {
  await sql()`update public.feed_comments set deleted_at = now() where id = ${commentId}::uuid`;
}

/** A live root comment of the LAB tenant: the foreign-tenant `?comentario=` probe. */
export async function foreignCommentId(): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    select c.id::text as id from public.feed_comments c
      join public.tenants t on t.id = c.tenant_id
     where t.slug = 'rede-lab' and c.post_id is not null and c.deleted_at is null
     limit 1`;
  const id = rows[0]?.id;
  if (!id) throw new Error('no live post comment in rede-lab');
  return id;
}

/**
 * UI E08 long-text backstop: a demo post (published through the API, so it is a real post) with
 * `total` root comments written as the migration role, one second apart, newest first in the list.
 * The comment at list position `targetPosition` (1-based, newest first) is returned as the target —
 * with 20 roots a page, position 150 is on page 8, far beyond what the page first renders.
 */
export async function seedLongThread(
  caption: string,
  total = 200,
  targetPosition = 150,
): Promise<{ postId: string; targetId: string }> {
  const postId = await publishPostAs(users.demoAdmin, caption);
  const [who] = await sql()<{ tenant_id: string; user_id: string }[]>`
    select p.tenant_id::text as tenant_id, p.author_user_id::text as user_id
      from public.feed_posts p where p.id = ${postId}::uuid`;
  if (!who) throw new Error(`post ${postId} not found`);
  let targetId = '';
  for (let n = 1; n <= total; n++) {
    const [row] = await sql()<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body, created_at)
      values (${who.tenant_id}::uuid, ${postId}::uuid, ${who.user_id}::uuid,
              ${`Comentario longo ${n}`}, now() - make_interval(secs => ${n}))
      returning id::text as id`;
    if (n === targetPosition && row) targetId = row.id;
  }
  return { postId, targetId };
}

/** The member's fixture row pointing at a story, with `expiresAt` in the past (UI-D-254). */
export async function insertExpiredStoryRow(email: string): Promise<void> {
  const [who] = await sql()<{ tenant_id: string; user_id: string; actor: string }[]>`
    select t.id::text as tenant_id, u.id::text as user_id,
           (select m.user_id::text from public.memberships m
             where m.tenant_id = t.id and m.role = 'admin_tenant' limit 1) as actor
      from public.tenants t, auth.users u
     where t.slug = 'rede-demo' and u.email = ${email}`;
  if (!who) throw new Error(`no ${email} in rede-demo`);
  const storyId = crypto.randomUUID();
  await sql()`
    insert into public.notifications
      (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, actor_user_id, payload)
    values (${who.tenant_id}::uuid, ${who.user_id}::uuid, 'stories.story',
            ${`e2e:story:${storyId}`}, 'story', ${storyId}::uuid, ${who.actor}::uuid,
            ${sql().json({ storyId, expiresAt: new Date(Date.now() - 3_600_000).toISOString(), previewAssetId: null })})`;
}

/**
 * UI E03 long-text backstop: a community-post row whose actor carries a 60-character display name
 * and whose excerpt is 80 characters, with a real image preview. The actor is the seeded 40-char
 * demo member, renamed for the test; the returned function restores the name (call it in `finally`).
 */
export async function insertLongRow(
  email: string,
  names: { longName: string; displayName60: string; excerpt80: string; community: string },
): Promise<() => Promise<void>> {
  const [who] = await sql()<
    {
      tenant_id: string;
      user_id: string;
      actor: string;
      membership: string;
      asset: string | null;
    }[]
  >`
    select t.id::text as tenant_id, u.id::text as user_id,
           m.user_id::text as actor, m.id::text as membership,
           (select a.id::text from public.media_assets a
             where a.tenant_id = t.id and a.kind = 'image' and a.status = 'ready'
               and cardinality(a.variant_widths) > 0 and a.deleted_at is null
             limit 1) as asset
      from public.tenants t
      join public.memberships m on m.tenant_id = t.id and m.deleted_at is null
      join public.member_profiles mp on mp.membership_id = m.id
      , auth.users u
     where t.slug = 'rede-demo' and u.email = ${email} and mp.display_name = ${names.longName}`;
  if (!who) throw new Error(`no member named ${names.longName} in rede-demo`);
  if (!who.asset) throw new Error('no ready image asset in rede-demo for the preview');
  await sql()`
    update public.member_profiles set display_name = ${names.displayName60}
     where membership_id = ${who.membership}::uuid`;
  const postId = await anyLivePostId('rede-demo');
  await sql()`
    insert into public.notifications
      (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, actor_user_id, payload)
    values (${who.tenant_id}::uuid, ${who.user_id}::uuid, 'feed.community_post',
            ${`e2e:long:${Date.now()}`}, 'post', ${postId}::uuid, ${who.actor}::uuid,
            ${sql().json({
              postId,
              excerpt: names.excerpt80,
              communityId: null,
              communityName: names.community,
              previewAssetId: who.asset,
            })})`;
  return async () => {
    await sql()`
      update public.member_profiles set display_name = ${names.longName}
       where membership_id = ${who.membership}::uuid`;
  };
}

/** Deletes the comments this spec wrote, by body prefix (the rows pointing at them go with clear). */
export async function deleteCommentsByBodyPrefix(prefix: string): Promise<void> {
  await sql()`delete from public.feed_comments where body like ${`${prefix}%`}`;
}

/* ── 07-05: the event kinds e2e (`notifications eventos`) ─────────────────────────────────────── */

/** `YYYY-MM-DD` of the São Paulo calendar day `days` from now (the demo tenant's zone). */
function demoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** An online demo event body `days` from now, 19:00-21:00 in the tenant's wall clock. */
export function demoEventBody(title: string, days = 3) {
  const date = demoDate(days);
  return {
    title,
    description: '',
    format: 'online',
    meetingUrl: 'https://meet.example.test/e2e-notificacoes',
    start: { date, time: '19:00' },
    end: { date, time: '21:00' },
  };
}

/**
 * Creates a demo event as `email` through the REAL API (`POST /v1/events`), so `event.published`
 * crosses the bus, the sink and the worker's fan-out exactly as the admin form does.
 */
export async function createEventAs(
  email: string,
  title: string,
  days = 3,
): Promise<{ id: string; startsAt: string }> {
  return (await apiAs(email, 'POST', '/v1/events', demoEventBody(title, days))) as {
    id: string;
    startsAt: string;
  };
}

/** Replaces a demo event as `email` through the real API (`PUT /v1/events/{id}`, an edit). */
export async function updateEventAs(
  email: string,
  eventId: string,
  body: ReturnType<typeof demoEventBody>,
): Promise<void> {
  await apiAs(email, 'PUT', `/v1/events/${eventId}`, body);
}

/**
 * The member's actor-less reminder row for `eventId` (UI-D-251), written as the migration role: a
 * reminder needs a job to fire an hour before the start, which no test can wait for. The facts are
 * the ones the events source writes (`eventId`, `title`, `startsAt`, `previewAssetId`).
 */
export async function insertReminderRow(
  email: string,
  event: { id: string; title: string; startsAt: string },
  window: '24h' | '1h',
): Promise<void> {
  const [who] = await sql()<{ tenant_id: string; user_id: string }[]>`
    select t.id::text as tenant_id, u.id::text as user_id
      from public.tenants t, auth.users u
     where t.slug = 'rede-demo' and u.email = ${email}`;
  if (!who) throw new Error(`no ${email} in rede-demo`);
  await sql()`
    insert into public.notifications
      (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, actor_user_id, payload)
    values (${who.tenant_id}::uuid, ${who.user_id}::uuid, ${`events.reminder_${window}`},
            ${`events.reminder_${window}:${event.id}`}, 'event', ${event.id}::uuid, null,
            ${sql().json({
              eventId: event.id,
              title: event.title,
              startsAt: event.startsAt,
              previewAssetId: null,
            })})`;
}

/** Deletes the demo events this spec wrote, by title prefix, and the rows pointing at them. */
export async function deleteEventsByTitlePrefix(prefix: string): Promise<void> {
  await sql()`
    delete from public.notifications
     where subject_type = 'event'
       and subject_id in (select id from public.events where title like ${`${prefix}%`})`;
  await sql()`delete from public.events where title like ${`${prefix}%`}`;
}
