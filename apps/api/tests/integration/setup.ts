import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

export { app as api } from '../../src/app';

/** Seed tenants' hosts (D-24), same defaults as scripts/seed.ts. */
export const HOSTS = {
  demo: process.env.TENANT_DEMO_HOST ?? 'rede-demo.localhost',
  lab: process.env.TENANT_LAB_HOST ?? 'rede-lab.localhost',
};

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? '';

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for integration tests (see scripts/local-env.sh)`);
  return value;
}

/** Real GoTrue session for a seeded user: the token the API verifies against the local JWKS. */
export async function signInAs(email: string, password: string): Promise<string> {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session)
    throw new Error(`signInWithPassword failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

/**
 * GoTrue admin API for throwaway fixtures (service key). Built here on purpose instead of importing
 * `@rede-social/core/server/supabase-admin`, which Biome restricts to the kernel's admin lane.
 */
export function authAdmin() {
  const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
  // Quick 261018-owq: the `custom_access_token` hook refuses a token for an e-mail that is not
  // `liberado` in public.email_allowlist. Every harness identity is meant to sign in, so creating one
  // lists its e-mail first (one choke point instead of an edit at each of the ~20 call sites). The
  // allowlist suite un-lists explicitly with `disallowEmail` after the fixture exists.
  const createUser = admin.createUser.bind(admin);
  admin.createUser = async (attributes) => {
    if (attributes.email) await allowEmail(attributes.email);
    return createUser(attributes);
  };
  return admin;
}

/** Superuser-ish connection for fixtures only (never used by application code). */
export const adminSql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 1,
});

/**
 * Quick 261018-owq: lists `email` on the global allowlist (status `liberado` by default; pass
 * `bloqueado` for the blocked case). Normalises with the same SQL `lower(btrim())` the hooks and the
 * table CHECK use, so a padded or mixed-case argument matches the way the real list does.
 */
export async function allowEmail(
  email: string,
  status: 'liberado' | 'bloqueado' = 'liberado',
): Promise<void> {
  await adminSql`
    insert into public.email_allowlist (email, status)
    values (lower(btrim(${email})), ${status})
    on conflict (email) do update set status = excluded.status, updated_at = now()`;
}

/** Quick 261018-owq: removes `email` from the allowlist (an absent row means blocked). */
export async function disallowEmail(email: string): Promise<void> {
  await adminSql`delete from public.email_allowlist where email = lower(btrim(${email}))`;
}

/**
 * One membership of a shared identity (08.1): the seeded tenant behind `HOSTS[host]`, or (08.1-07) a
 * throwaway tenant named by its `tenantSlug` (the suites' own third tenant, with or without a host).
 */
export type SharedMembership = (
  | { host: keyof typeof HOSTS; tenantSlug?: never }
  | { tenantSlug: string; host?: never }
) & {
  role?: 'member' | 'admin_tenant' | 'support_tenant';
  status?: 'active' | 'blocked' | 'invited';
  displayName?: string;
};

/**
 * 08.1 (V2-PLAT-07): a THROWAWAY identity holding one membership in each listed seed tenant — the
 * shared-identity fixture. Seed users are never joined to a second tenant (count-based suites would
 * drift), so every multi-membership case builds its own: e-mail `<prefix>-<random>@rede-demo.local`,
 * the seed password, a confirmed GoTrue identity, then one `memberships` row per host's VERIFIED seed
 * tenant (`blocked` also stamps `blocked_at`). The membership trigger creates each profile row;
 * `displayName` overwrites that row's name for this membership only. Tear down with
 * `removeIdentitiesByPrefix(prefix)`.
 */
export async function createSharedIdentity(input: {
  prefix: string;
  memberships: SharedMembership[];
}): Promise<{ userId: string; email: string; password: string }> {
  const email = `${input.prefix}-${crypto.randomUUID().slice(0, 12)}@rede-demo.local`;
  const password = SEED_PASSWORD;
  const { data, error } = await authAdmin().createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  const userId = data.user.id;

  for (const m of input.memberships) {
    const status = m.status ?? 'active';
    const [row] =
      m.tenantSlug !== undefined
        ? await adminSql<{ id: string }[]>`
            insert into public.memberships (tenant_id, user_id, role, status, blocked_at)
            select t.id, ${userId}::uuid, ${m.role ?? 'member'}, ${status},
                   case when ${status} = 'blocked' then now() end
              from public.tenants t
             where t.slug = ${m.tenantSlug}
            returning id`
        : await adminSql<{ id: string }[]>`
            insert into public.memberships (tenant_id, user_id, role, status, blocked_at)
            select d.tenant_id, ${userId}::uuid, ${m.role ?? 'member'}, ${status},
                   case when ${status} = 'blocked' then now() end
              from public.tenant_domains d
             where d.host = ${HOSTS[m.host]} and d.verified_at is not null
             limit 1
            returning id`;
    if (!row) {
      throw new Error(
        m.tenantSlug !== undefined
          ? `no tenant with slug ${m.tenantSlug}`
          : `no verified seed tenant behind ${HOSTS[m.host]}`,
      );
    }
    if (m.displayName !== undefined) {
      await adminSql`
        update public.member_profiles set display_name = ${m.displayName}
         where membership_id = ${row.id}::uuid`;
    }
  }
  return { userId, email, password };
}

/**
 * Deletes every GoTrue identity whose e-mail starts with `<prefix>-` (the `createSharedIdentity`
 * shape); `public.users`, memberships, profiles and consents cascade. Idempotent: run it in
 * `beforeAll` (leftovers of a crashed run) and `afterAll`.
 *
 * 08.1-07 (SC5 concurrency): the shared-identity suites make these identities WRITE (posts, comments,
 * support threads, events, attendances, media), and those author columns are `on delete no action`.
 * A run interrupted before its own cleanup would otherwise leave an identity no later sweep can
 * delete, so the rows they authored are removed first, children before parents.
 */
export async function removeIdentitiesByPrefix(prefix: string): Promise<void> {
  const rows = await adminSql<{ id: string }[]>`
    select id from auth.users where email like ${`${prefix}-%`}`;
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await adminSql`delete from public.event_checkin_attempts where user_id = any(${ids}::uuid[])`;
    await adminSql`delete from public.event_attendances where user_id = any(${ids}::uuid[])`;
    await adminSql`delete from public.story_views where user_id = any(${ids}::uuid[])`;
    await adminSql`delete from public.feed_comments where author_user_id = any(${ids}::uuid[])`;
    await adminSql`delete from public.feed_posts where author_user_id = any(${ids}::uuid[])`;
    await adminSql`
      delete from public.chat_conversations
       where created_by_user_id = any(${ids}::uuid[])
          or id in (select conversation_id from public.chat_messages
                     where author_user_id = any(${ids}::uuid[]))`;
    await adminSql`delete from public.events where created_by_user_id = any(${ids}::uuid[])`;
    await adminSql`
      update public.member_profiles set avatar_asset_id = null
       where avatar_asset_id in (select id from public.media_assets
                                  where owner_user_id = any(${ids}::uuid[]))`;
    await adminSql`delete from public.media_assets where owner_user_id = any(${ids}::uuid[])`;
    // 08.2-06: the store ledgers reference `users` with no cascade (an order is history). A throwaway
    // identity that bought, was granted, or granted/revoked as an admin leaves rows that would block
    // its deletion; entitlements go first (they reference their order).
    await adminSql`
      delete from public.store_entitlements
       where user_id = any(${ids}::uuid[])
          or granted_by_user_id = any(${ids}::uuid[])
          or revoked_by_user_id = any(${ids}::uuid[])
          or order_id in (select id from public.store_orders
                           where user_id = any(${ids}::uuid[])
                              or revoked_by_user_id = any(${ids}::uuid[]))`;
    await adminSql`
      delete from public.store_orders
       where user_id = any(${ids}::uuid[]) or revoked_by_user_id = any(${ids}::uuid[])`;
  }
  for (const { id } of rows) {
    const { error } = await authAdmin().deleteUser(id);
    if (error) throw new Error(`deleteUser failed for ${id}: ${error.message}`);
  }
  // Quick 261018-owq: the identities' allowlist rows go too (also the rows of identities that never
  // reached GoTrue, e.g. a refused sign-up).
  await adminSql`delete from public.email_allowlist where email like ${`${prefix}-%`}`;
}

/**
 * A REAL image asset for the given session, through the 03-01 broker end to end: `start` mints the
 * signed target, the bytes go STRAIGHT to Storage (never through the API), `complete` decodes the
 * header, and the worker handler derives the WebP ladder so the row reaches `ready`. Returns the
 * `media_assets` id, which is what `PATCH /v1/me/profile { avatarAssetId }` takes (03-02).
 *
 * `purpose` is a parameter so a test can build the NEGATIVE fixture the avatar gate exists for — an
 * otherwise perfectly valid `post` image, which the profile must still refuse.
 *
 * The heavy kernel imports (`sharp` through `variants`, pg-boss through `derive-job`) are loaded
 * INSIDE the function on purpose: `setup.ts` is imported by every integration file, including
 * `health-no-db.ts`, and none of them should pay for the media stack just to reach `api`/`adminSql`.
 */
export async function uploadAvatar(
  token: string,
  opts: { purpose?: 'avatar' | 'post'; bytes?: Buffer; host?: string } = {},
): Promise<string> {
  const { app } = await import('../../src/app');
  const { encodeJpeg } = await import('@rede-social/core/server/media/variants');
  const { deriveVariantsJob } = await import('@rede-social/core/server/media/derive-job');

  const body =
    opts.bytes ??
    (await encodeJpeg(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#7c3aed"/><circle cx="320" cy="320" r="200" fill="#fde68a"/></svg>`,
      ),
    ));

  // 08.1-07: an identity with two memberships must name the host it uploads on (a generic host
  // would ask it to choose a community); a single-membership session keeps working without one.
  const hostHeader: Record<string, string> = opts.host ? { 'x-tenant-host': opts.host } : {};
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...hostHeader,
  };
  const started = await app.request('/v1/media/uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: 'image',
      purpose: opts.purpose ?? 'avatar',
      mime: 'image/jpeg',
      size: body.length,
      filename: 'foto.jpg',
    }),
  });
  if (started.status !== 201) throw new Error(`start failed: ${started.status}`);
  const target = (await started.json()) as { assetId: string; signedUrl: string };

  const put = await fetch(target.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
  });
  if (!put.ok) throw new Error(`PUT to Storage failed: ${put.status}`);

  const completed = await app.request(`/v1/media/uploads/${target.assetId}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, ...hostHeader },
  });
  if (completed.status !== 200) throw new Error(`complete failed: ${completed.status}`);

  const [row] = await adminSql<
    { tenant_id: string }[]
  >`select tenant_id from public.media_assets where id = ${target.assetId}::uuid`;
  if (!row) throw new Error('the asset row disappeared after complete');
  await deriveVariantsJob.handler({ tenantId: row.tenant_id, assetId: target.assetId, attempt: 0 });

  return target.assetId;
}

/** One `kernel.invite-send` row as the integration suites assert it (quick 260929-g0s). */
export type InviteSendJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  retry_limit: number;
  retry_backoff: boolean;
  data: Record<string, unknown>;
};

/** Every `kernel.invite-send` job scheduled for `tenantId`, oldest first (any state). */
export async function inviteSendJobsOf(tenantId: string): Promise<InviteSendJobRow[]> {
  return adminSql<InviteSendJobRow[]>`
    select id, state::text as state, singleton_key, start_after, retry_limit, retry_backoff, data
      from pgboss.job_common
     where name = 'kernel.invite-send' and data->>'tenantId' = ${tenantId}
     order by created_on`;
}

/**
 * Plays the worker for `tenantId`'s waiting `kernel.invite-send` jobs, ignoring `start_after`: each
 * `created` row's payload goes through the real `inviteSendJob.handler` (errors propagate, the row
 * stays `created`), and a row whose handler resolved is marked `completed` like `boss.work` would —
 * so a later verify can schedule the same invite again. The kernel job is imported INSIDE the
 * function (this file's "heavy kernel imports" rule). Returns how many handlers ran.
 */
export async function runInviteSendJobs(tenantId: string): Promise<number> {
  const { inviteSendJob } = await import('@rede-social/core/server/platform/invite-send-job');
  const rows = (await inviteSendJobsOf(tenantId)).filter((row) => row.state === 'created');
  for (const row of rows) {
    await inviteSendJob.handler(row.data as { tenantId: string; inviteId: string });
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'kernel.invite-send' and id = ${row.id}::uuid`;
  }
  return rows.length;
}

/** One `notifications.fanout` row as the integration suites assert it (07-01). */
export type NotificationJobRow = {
  id: string;
  state: string;
  data: Record<string, unknown>;
};

/** Every `notifications.fanout` job enqueued for `tenantId`, oldest first (any state). */
export async function notificationJobsOf(tenantId: string): Promise<NotificationJobRow[]> {
  return adminSql<NotificationJobRow[]>`
    select id, state::text as state, data
      from pgboss.job_common
     where name = 'notifications.fanout' and data->>'tenantId' = ${tenantId}
     order by created_on`;
}

/**
 * Plays the worker for `tenantId`'s waiting `notifications.fanout` jobs (the `runInviteSendJobs`
 * clone): each `created` row's payload goes through the real `notificationsFanoutJob.handler`
 * (errors propagate, the row stays `created`), and a row whose handler resolved is marked
 * `completed` like `boss.work` would. The module job is imported INSIDE the function (this file's
 * "heavy imports" rule). Returns how many handlers ran.
 */
export async function runNotificationJobs(tenantId: string): Promise<number> {
  const { notificationsFanoutJob } = await import('@rede-social/module-notifications/server');
  const rows = (await notificationJobsOf(tenantId)).filter((row) => row.state === 'created');
  for (const row of rows) {
    await notificationsFanoutJob.handler(
      row.data as Parameters<typeof notificationsFanoutJob.handler>[0],
    );
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'notifications.fanout' and id = ${row.id}::uuid`;
  }
  return rows.length;
}

/** One `events.reminder` row as the integration suites assert it (07-05). */
export type EventReminderJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  data: { tenantId: string; eventId: string; window: '24h' | '1h'; startsAt: string };
};

/** Every `events.reminder` job armed for `tenantId`, oldest first (any state). */
export async function eventReminderJobsOf(tenantId: string): Promise<EventReminderJobRow[]> {
  return adminSql<EventReminderJobRow[]>`
    select id, state::text as state, singleton_key, start_after, data
      from pgboss.job_common
     where name = 'events.reminder' and data->>'tenantId' = ${tenantId}
     order by created_on, singleton_key`;
}

/**
 * Plays the worker for `tenantId`'s waiting `events.reminder` jobs (the `runInviteSendJobs` clone),
 * IGNORING `start_after` and passing `nowMs` as the fire-time clock (07-05 planning decision 3), so a
 * test drives moved, late and cancelled cases without waiting. `only` narrows the rows (one window,
 * one event, one start). Each row's payload goes through the real `runEventReminder` (errors
 * propagate, the row stays `created`); a row whose handler resolved is marked `completed` like
 * `boss.work` would. Returns each run row's outcome, in order.
 */
export async function runEventReminderJobs(
  tenantId: string,
  nowMs: number,
  only: (row: EventReminderJobRow) => boolean = () => true,
): Promise<('emitted' | 'skipped' | 'dropped')[]> {
  const { runEventReminder } = await import('@rede-social/module-events/server');
  const rows = (await eventReminderJobsOf(tenantId)).filter(
    (row) => row.state === 'created' && only(row),
  );
  const outcomes: ('emitted' | 'skipped' | 'dropped')[] = [];
  for (const row of rows) {
    outcomes.push(await runEventReminder(row.data, nowMs));
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'events.reminder' and id = ${row.id}::uuid`;
  }
  return outcomes;
}

/** One `courses.live_reminder` row as the integration suites assert it (08.6-05). */
export type LiveReminderJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  data: { tenantId: string; liveId: string; startsAt: string };
};

/** Every `courses.live_reminder` job armed for `tenantId`, oldest first (any state). */
export async function liveReminderJobsOf(tenantId: string): Promise<LiveReminderJobRow[]> {
  return adminSql<LiveReminderJobRow[]>`
    select id, state::text as state, singleton_key, start_after, data
      from pgboss.job_common
     where name = 'courses.live_reminder' and data->>'tenantId' = ${tenantId}
     order by created_on, singleton_key`;
}

/**
 * Plays the worker for `tenantId`'s waiting `courses.live_reminder` jobs (the `runEventReminderJobs`
 * clone), IGNORING `start_after` and passing `nowMs` as the fire-time clock, so a test drives the
 * moved, late, started and cancelled cases without waiting. `only` narrows the rows (one live, one
 * start). Each row's payload goes through the real `runLiveReminder` (errors propagate, the row
 * stays `created`); a row whose handler resolved is marked `completed` like `boss.work` would. The
 * module is imported INSIDE the function (this file's "heavy imports" rule). Returns each run row's
 * outcome, in order.
 */
export async function runLiveReminderJobs(
  tenantId: string,
  nowMs: number,
  only: (row: LiveReminderJobRow) => boolean = () => true,
): Promise<('emitted' | 'skipped' | 'dropped')[]> {
  const { runLiveReminder } = await import('@rede-social/module-courses/server');
  const rows = (await liveReminderJobsOf(tenantId)).filter(
    (row) => row.state === 'created' && only(row),
  );
  const outcomes: ('emitted' | 'skipped' | 'dropped')[] = [];
  for (const row of rows) {
    outcomes.push(await runLiveReminder(row.data, nowMs));
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'courses.live_reminder' and id = ${row.id}::uuid`;
  }
  return outcomes;
}

/** One `courses.lessons_batch` row as the integration suites assert it (08.6-07). */
export type LessonsBatchJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  data: { tenantId: string; courseId: string };
};

/** Every `courses.lessons_batch` job armed for `tenantId`, oldest first (any state). */
export async function lessonsBatchJobsOf(tenantId: string): Promise<LessonsBatchJobRow[]> {
  return adminSql<LessonsBatchJobRow[]>`
    select id, state::text as state, singleton_key, start_after, data
      from pgboss.job_common
     where name = 'courses.lessons_batch' and data->>'tenantId' = ${tenantId}
     order by created_on, id`;
}

/**
 * Plays the worker for `tenantId`'s waiting `courses.lessons_batch` jobs (the `runLiveReminderJobs`
 * clone), IGNORING `start_after` and passing `nowMs` as the run clock. Each row is first marked
 * `active` like `boss.work`'s fetch does, so a batch that re-arms itself (same singleton key) inserts
 * a NEW waiting job exactly as in the worker; then its payload goes through the real
 * `runLessonsBatch` (errors propagate) and the row is marked `completed`. `only` narrows the rows
 * (one course). Returns each run row's outcome, in order.
 */
export async function runLessonsBatchJobs(
  tenantId: string,
  nowMs: number,
  only: (row: LessonsBatchJobRow) => boolean = () => true,
): Promise<('emitted' | 'skipped' | 'dropped')[]> {
  const { runLessonsBatch } = await import('@rede-social/module-courses/server');
  const rows = (await lessonsBatchJobsOf(tenantId)).filter(
    (row) => row.state === 'created' && only(row),
  );
  const outcomes: ('emitted' | 'skipped' | 'dropped')[] = [];
  for (const row of rows) {
    await adminSql`
      update pgboss.job_common set state = 'active', started_on = now()
       where name = 'courses.lessons_batch' and id = ${row.id}::uuid`;
    outcomes.push(await runLessonsBatch(row.data, nowMs));
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'courses.lessons_batch' and id = ${row.id}::uuid`;
  }
  return outcomes;
}

/** One `notifications.push-send` row as the integration suites assert it (07-06). */
export type PushSendJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  data: {
    tenantId: string;
    kind: string;
    dedupeKey: string;
    userIds: string[];
    push: Record<string, unknown>;
    attempt: number;
    subscriptionIds?: string[];
  };
};

/** Every `notifications.push-send` job enqueued for `tenantId`, oldest first (any state). */
export async function pushSendJobsOf(tenantId: string): Promise<PushSendJobRow[]> {
  return adminSql<PushSendJobRow[]>`
    select id, state::text as state, singleton_key, start_after, data
      from pgboss.job_common
     where name = 'notifications.push-send' and data->>'tenantId' = ${tenantId}
     order by created_on, singleton_key`;
}

/**
 * Plays the worker for `tenantId`'s waiting `notifications.push-send` jobs (the `runInviteSendJobs`
 * clone), IGNORING `start_after` so a re-try runs at once: each `created` row's payload goes through
 * the real `pushSendJob.handler` on the transport the env selects (`PUSH_TRANSPORT=fake`, pinned by
 * `vitest.config.ts`), errors propagate and the row stays `created`; a row whose handler resolved is
 * marked `completed` like `boss.work` would. Only the rows waiting when it starts run, so a re-try the
 * run enqueues waits for the NEXT call. Returns how many handlers ran.
 */
export async function runPushSendJobs(tenantId: string): Promise<number> {
  const { pushSendJob } = await import('@rede-social/module-notifications/server');
  const rows = (await pushSendJobsOf(tenantId)).filter((row) => row.state === 'created');
  for (const row of rows) {
    await pushSendJob.handler(row.data as Parameters<typeof pushSendJob.handler>[0]);
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'notifications.push-send' and id = ${row.id}::uuid`;
  }
  return rows.length;
}

/** One `dashboard.snapshot-build` row as the integration suites assert it (08.7-01). */
export type DashboardJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  data: { tenantId: string; day: string };
};

/** Every `dashboard.snapshot-build` job enqueued for `tenantId`, oldest first (any state). */
export async function dashboardJobsOf(tenantId: string): Promise<DashboardJobRow[]> {
  return adminSql<DashboardJobRow[]>`
    select id, state::text as state, singleton_key, start_after, data
      from pgboss.job_common
     where name = 'dashboard.snapshot-build' and data->>'tenantId' = ${tenantId}
     order by created_on, singleton_key`;
}

/**
 * Plays the worker for `tenantId`'s waiting `dashboard.snapshot-build` jobs (the `runLiveReminderJobs`
 * clone), IGNORING `start_after`: each `created` row's payload goes through the real
 * `runSnapshotBuild` (errors propagate, the row stays `created`); a row whose handler resolved is
 * marked `completed` like `boss.work` would. The module is imported INSIDE the function (this file's
 * "heavy imports" rule). Returns each run row's outcome, in order.
 */
export async function runDashboardJobs(
  tenantId: string,
): Promise<('built' | 'skipped' | 'dropped')[]> {
  const { runSnapshotBuild } = await import('@rede-social/module-dashboard/server');
  const rows = (await dashboardJobsOf(tenantId)).filter((row) => row.state === 'created');
  const outcomes: ('built' | 'skipped' | 'dropped')[] = [];
  for (const row of rows) {
    outcomes.push(await runSnapshotBuild(row.data));
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'dashboard.snapshot-build' and id = ${row.id}::uuid`;
  }
  return outcomes;
}

/** The seed slug behind each of `HOSTS` (scripts/seed.ts). */
const SEED_SLUGS: Record<keyof typeof HOSTS, string> = { demo: 'rede-demo', lab: 'rede-lab' };

/** The modules a suite may toggle on a seed tenant: the two that are OFF by default. */
export type ToggleableInTests = 'store' | 'courses';

/**
 * 08.2 / 08.3: turns a module that is OFF by default (`store`, STORE-01; `courses`, COURSE-01) ON
 * for a seed tenant and returns the function that puts it back. Every suite of that module calls
 * this in `beforeAll` and the returned restore in `afterAll`: it writes back the previous row value
 * (or deletes the row when there was none) and invalidates the per-instance flags cache, the
 * communities.test.ts precedent (RESEARCH Pitfall 8). The integration config runs files one at a
 * time, so a toggle never leaks into another file (P52, P53).
 */
export async function withModuleEnabled(
  host: keyof typeof HOSTS,
  key: ToggleableInTests,
): Promise<() => Promise<void>> {
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = ${SEED_SLUGS[host]}`;
  if (!tenant) throw new Error(`tenant ${SEED_SLUGS[host]} is not seeded — run pnpm db:seed first`);
  const tenantId = tenant.id;
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, ${key}, true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(tenantId);
  return async () => {
    if (previous) {
      // An upsert, not an update: a suite may have DELETED the row to prove "no row = off" (P02).
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantId}::uuid, ${key}, ${previous.enabled})
        on conflict (tenant_id, module_key)
        do update set enabled = ${previous.enabled}, updated_at = now()`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
    }
    moduleFlags.invalidate(tenantId);
  };
}

/** 08.2's name for the store toggle, kept for every store suite. */
export const withStoreEnabled = (host: keyof typeof HOSTS) => withModuleEnabled(host, 'store');
