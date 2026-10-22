import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  // Quick 261018-owq, retargeted by 09.1-03: the `custom_access_token` hook refuses a token for an
  // e-mail with no usable access. Every harness identity is meant to sign in, so creating one grants its
  // e-mail a manual access first (one choke point instead of an edit at each of the ~20 call sites). The
  // hook suites un-grant explicitly with `disallowEmail` after the fixture exists.
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
 * Quick 261018-owq, retargeted by 09.1-03 (D-487): grants `email` a MANUAL access in the seed tenant
 * `rede-demo` (`liberado`, the default) or a manual BLOCK there (`bloqueado`), over `public.access_grants`
 * instead of the retired global list. Names and signatures are unchanged on purpose, so the ~20 call
 * sites do not move. A release removes the manual block for that tenant and e-mail, and a block removes
 * the manual release, so the call leaves exactly the verdict that was asked for. Normalises with the same
 * SQL `lower(btrim())` the hooks and the table CHECK use, so a padded or mixed-case argument matches.
 */
export async function allowEmail(
  email: string,
  status: 'liberado' | 'bloqueado' = 'liberado',
): Promise<void> {
  const keep = status === 'liberado' ? 'active' : 'blocked';
  const drop = status === 'liberado' ? 'blocked' : 'active';
  await adminSql`
    insert into public.access_grants (tenant_id, email, source, status)
    select t.id, lower(btrim(${email})), 'manual', ${keep}
      from public.tenants t
     where t.slug = 'rede-demo'
    on conflict (tenant_id, email, status) where source = 'manual'
    do update set updated_at = now()`;
  await adminSql`
    delete from public.access_grants ag
     using public.tenants t
     where t.slug = 'rede-demo'
       and ag.tenant_id = t.id
       and ag.source = 'manual'
       and ag.status = ${drop}
       and ag.email = lower(btrim(${email}))`;
}

/** Removes EVERY manual access row of `email`, in every tenant (gateway rows are left alone). */
export async function disallowEmail(email: string): Promise<void> {
  await adminSql`
    delete from public.access_grants
     where source = 'manual' and email = lower(btrim(${email}))`;
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
  // Quick 261018-owq, retargeted by 09.1-03: the identities' access rows go too (also the rows of
  // identities that never reached GoTrue, e.g. a refused sign-up).
  await adminSql`delete from public.access_grants where email like ${`${prefix}-%`}`;
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

/** The modules a suite may toggle on a seed tenant: the ones that are OFF by default. */
export type ToggleableInTests = 'store' | 'courses' | 'social';

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

/** 09-01's name for the `social` toggle (SOCIAL-01): its members become authors while it is on. */
export const withSocialEnabled = (host: keyof typeof HOSTS) => withModuleEnabled(host, 'social');

/**
 * 09.1-02 (D-491): runs `fn` with the tenant's `payments` module row written the way a case needs it,
 * then puts the previous row back (or deletes the one it created) in a `finally`. The default is the
 * gated state: `enabled` true and `settings {"gate": true}`. `gate` is `unknown` on purpose: the P14
 * cases write lookalike values (the string "true", the number 1, null) that must read as OFF. Pass
 * `settings` to write the jsonb verbatim (an empty object, a missing key) and `enabled: false` for a
 * disabled module that still carries `gate: true`.
 *
 * Nothing is invalidated: `app.access_state` reads `tenant_modules` live on every request, which is
 * exactly the property (P17) the cases prove. `requireModule('payments')` is not on this path.
 */
export type PaymentsGateOptions = {
  gate?: unknown;
  enabled?: boolean;
  settings?: Record<string, unknown>;
};

export async function setPaymentsRow(
  tenantId: string,
  options: PaymentsGateOptions = {},
): Promise<void> {
  const settings = options.settings ?? { gate: options.gate === undefined ? true : options.gate };
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled, settings)
    values (${tenantId}::uuid, 'payments', ${options.enabled ?? true},
            ${adminSql.json(settings as never)})
    on conflict (tenant_id, module_key)
    do update set enabled = excluded.enabled, settings = excluded.settings, updated_at = now()`;
}

export async function withPaymentsGate<T>(
  tenantId: string,
  fn: () => Promise<T>,
  options: PaymentsGateOptions = {},
): Promise<T> {
  const [previous] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
    select enabled, settings from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = 'payments'`;
  await setPaymentsRow(tenantId, options);
  try {
    return await fn();
  } finally {
    if (previous) {
      await setPaymentsRow(tenantId, { enabled: previous.enabled, settings: previous.settings });
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenantId}::uuid and module_key = 'payments'`;
    }
  }
}

/**
 * 09.1-05 (D-486): a tenant's payment integration, seeded the way the Pagamentos screen will create it:
 * a uuid the application chooses BEFORE the insert (the sealed token is bound to it), the token sealed
 * with the same `sealSecret` the route opens it with, written through the migration role. Returns the
 * plaintext token so a case can sign deliveries with it. `provider` defaults to the only registered
 * adapter, `fake`; a second integration of one provider in one tenant violates `(tenant_id, provider)`.
 *
 * The kernel module is loaded INSIDE the function, like `uploadAvatar` does, so the many suites that
 * import this file but never touch payments do not pay for it. Tear down with `removePaymentIntegrations`.
 */
export type SeededPaymentIntegration = {
  id: string;
  tenantId: string;
  provider: string;
  token: string;
};

export async function seedPaymentIntegration(
  tenantId: string,
  options: { provider?: string; token?: string } = {},
): Promise<SeededPaymentIntegration> {
  const { sealSecret } = await import('@rede-social/core/server/payments/secret');
  const id = crypto.randomUUID();
  const provider = options.provider ?? 'fake';
  const token = options.token ?? `tok-${crypto.randomUUID()}`;
  await adminSql`
    insert into public.payment_integrations (id, tenant_id, provider, secret_sealed)
    values (${id}::uuid, ${tenantId}::uuid, ${provider}, ${sealSecret(token, id)})`;
  return { id, tenantId, provider, token };
}

/**
 * 09.1-06 (D-506): a payment mapping of `tenantId`, written through the migration role the way the
 * product form will save it. `kind` defaults to `store_product` (target = a store product, no name);
 * an `access` mapping takes a `name` and no target. `externalProductId` defaults to a fresh uuid
 * (the `(provider, external_product_id)` pair is unique across tenants). Tear down with
 * `removePaymentMappings`.
 */
export type SeededPaymentMapping = { id: string; checkoutUrl: string | null };

export async function seedPaymentMapping(
  tenantId: string,
  options: {
    kind?: 'access' | 'store_product';
    provider?: string;
    externalProductId?: string;
    targetId?: string | null;
    checkoutUrl?: string | null;
    name?: string | null;
  } = {},
): Promise<SeededPaymentMapping> {
  const kind = options.kind ?? 'store_product';
  const checkoutUrl = options.checkoutUrl === undefined ? null : options.checkoutUrl;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.payment_products
           (tenant_id, provider, kind, name, external_product_id, checkout_url, target_id)
    values (${tenantId}::uuid, ${options.provider ?? 'fake'}, ${kind},
            ${kind === 'access' ? (options.name ?? 'Acesso') : null},
            ${options.externalProductId ?? crypto.randomUUID()}, ${checkoutUrl},
            ${kind === 'store_product' ? (options.targetId ?? null) : null}::uuid)
    returning id::text as id`;
  if (!row) throw new Error('could not seed the payment mapping');
  return { id: row.id, checkoutUrl };
}

/** Removes every mapping of `tenantId` (events and grants that pointed at one forget it). */
export async function removePaymentMappings(tenantId: string): Promise<void> {
  await adminSql`delete from public.payment_products where tenant_id = ${tenantId}::uuid`;
}

/**
 * Removes every integration of `tenantId` with its events (cascade) and the queued jobs those events
 * produced. Jobs are keyed by the event id, so they are collected before the events go.
 */
export async function removePaymentIntegrations(tenantId: string): Promise<void> {
  await adminSql`
    delete from pgboss.job_common
     where name = 'kernel.payment-event'
       and singleton_key in (select id::text from public.payment_events
                              where tenant_id = ${tenantId}::uuid)`;
  await adminSql`delete from public.payment_events where tenant_id = ${tenantId}::uuid`;
  await adminSql`delete from public.payment_integrations where tenant_id = ${tenantId}::uuid`;
}

/**
 * 09.1-05: posts `body` to the REAL webhook route of `integration`, signed the way the `fake` adapter
 * verifies: HMAC-SHA256 hex over the EXACT bytes, in `?signature=`. `signature` overrides the computed
 * one (a forged or stale value), `omitSignature` sends none, `provider` and `id` override the path
 * segments, `token` signs with another token.
 */
export async function signedWebhook(
  integration: SeededPaymentIntegration,
  body: string | Buffer | Record<string, unknown>,
  options: {
    signature?: string;
    omitSignature?: boolean;
    provider?: string;
    id?: string;
    token?: string;
  } = {},
): Promise<Response> {
  const { createHmac } = await import('node:crypto');
  const bytes =
    typeof body === 'string'
      ? Buffer.from(body, 'utf8')
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(JSON.stringify(body), 'utf8');
  const signature =
    options.signature ??
    createHmac('sha256', options.token ?? integration.token)
      .update(bytes)
      .digest('hex');
  const query = options.omitSignature ? '' : `?signature=${encodeURIComponent(signature)}`;
  const { app } = await import('../../src/app');
  return app.request(
    `/v1/webhooks/${options.provider ?? integration.provider}/${options.id ?? integration.id}${query}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array(bytes),
    },
  );
}

/**
 * 09.2-03 (DBT-38): the second local database, `rede_tenant_b`, inside the local stack's Postgres. Built
 * by `scripts/db-two-databases.sh` (the real runner applies the 146-file tenant set); the script is
 * idempotent, so it runs once per process and a database that already exists is only checked.
 */
let secondDatabase: Promise<void> | undefined;

export function ensureSecondDatabase(): Promise<void> {
  secondDatabase ??= Promise.resolve().then(() => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    execFileSync('bash', ['scripts/db-two-databases.sh'], {
      cwd: root,
      timeout: 120_000,
      stdio: 'pipe',
    });
  });
  return secondDatabase;
}

/** Superuser-ish connection to `rede_tenant_b` for fixtures only (the `adminSql` of the second database). */
export const adminSqlB = postgres('postgres://postgres:postgres@127.0.0.1:54322/rede_tenant_b', {
  prepare: false,
  max: 1,
});

/** The connection string the registry holds, SEALED, for `rede_tenant_b` (the API's own `api_user`). */
export const TENANT_B_URL = 'postgres://api_user:postgres@127.0.0.1:54322/rede_tenant_b';

export type TenantOnB = {
  tenantId: string;
  projectId: string;
  host: string;
  userId: string;
  email: string;
  token: string;
  /** Removes everything this fixture created, in both databases and in GoTrue. Idempotent. */
  cleanup: () => Promise<void>;
};

/**
 * 09.2-03: a throwaway tenant that lives ONLY in `rede_tenant_b`. The central project holds the tenant row
 * (a mirror with a DIFFERENT display name, so a read that wrongly lands centrally is visible), its verified
 * primary host, a `platform.projects` row whose `database_url_tx` is sealed with the real keyring, and the
 * explicit `platform.tenant_projects` binding. Database B holds the tenant's real row, its modules, the
 * user and the user's membership; the membership exists in NO central table. The user is a real GoTrue
 * identity, signed in, so the token is the one the API verifies.
 */
export async function provisionTenantOnB(opts: {
  slug: string;
  role?: 'member' | 'admin_tenant' | 'support_tenant';
  /** The URL the registry seals for this project. Default: the real `rede_tenant_b` (see `TENANT_B_URL`). */
  databaseUrl?: string;
}): Promise<TenantOnB> {
  await ensureSecondDatabase();
  const { seal } = await import('@rede-social/core/server/secrets/sealed');
  const { invalidateProject } = await import('@rede-social/core/server/tenancy/project-registry');
  const { invalidateTenantHost } = await import('@rede-social/core/server/tenancy/tenant-host');

  const tenantId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const host = `${opts.slug}.localhost`;
  const ref = `fk-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const email = `${opts.slug}-${crypto.randomUUID().slice(0, 8)}@rede-demo.local`;

  await adminSql.begin(async (tx) => {
    await tx`
      insert into platform.projects
             (id, ref, provider, credential_source, state, api_url, secret_key_id,
              database_url_tx_sealed)
      values (${projectId}::uuid, ${ref}, 'fake', 'sealed', 'ready', ${required('SUPABASE_URL')}, 1,
              ${seal(opts.databaseUrl ?? TENANT_B_URL, `${projectId}:database_url_tx`)})`;
    await tx`
      insert into public.tenants (id, slug, display_name, rules_text, rules_version)
      values (${tenantId}::uuid, ${opts.slug}, 'Tenant B (central mirror)', 'Regras.', 1)`;
    await tx`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${host}, true, now())`;
    await tx`
      insert into platform.tenant_projects (tenant_id, project_id)
      values (${tenantId}::uuid, ${projectId}::uuid)`;
  });

  await adminSqlB`
    insert into public.tenants (id, slug, display_name, rules_text, rules_version)
    values (${tenantId}::uuid, ${opts.slug}, 'Tenant B (database B)', 'Regras.', 1)`;
  await adminSqlB`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, 'feed', true)`;

  const created = await authAdmin().createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed for ${email}: ${created.error?.message}`);
  }
  const userId = created.data.user.id;
  // The same identity id in B's own auth schema (the second project's GoTrue is plan 04+'s concern);
  // `on_auth_user_created` mirrors it into B's `public.users`.
  await adminSqlB`
    insert into auth.users (id, email, aud, role, email_confirmed_at)
    values (${userId}::uuid, ${email}, 'authenticated', 'authenticated', now())`;
  await adminSqlB`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${userId}::uuid, ${opts.role ?? 'member'}, 'active')`;

  const token = await signInAs(email, SEED_PASSWORD);
  invalidateProject(tenantId);
  invalidateTenantHost(host);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    invalidateProject(tenantId);
    invalidateTenantHost(host);
    await adminSqlB`delete from public.memberships where tenant_id = ${tenantId}::uuid`;
    await adminSqlB`delete from public.tenants where id = ${tenantId}::uuid`;
    await adminSqlB`delete from auth.users where id = ${userId}::uuid`;
    await authAdmin().deleteUser(userId);
    await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
    await adminSql`delete from platform.projects where id = ${projectId}::uuid`;
    await adminSql`delete from public.access_grants where email = ${email}`;
  };
  return { tenantId, projectId, host, userId, email, token, cleanup };
}
