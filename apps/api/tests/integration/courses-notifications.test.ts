import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLearnFixture, learnRequest, removeLearnFixture } from './learn-fixture';
import {
  adminSql,
  createSharedIdentity,
  HOSTS,
  type LiveReminderJobRow,
  liveReminderJobsOf,
  removeIdentitiesByPrefix,
  runLiveReminderJobs,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
  withModuleEnabled,
} from './setup';

/**
 * The 08.6 course notices end to end against the live local stack and the real seed (08.6-05,
 * COURSE-41, COURSE-48; D-445, D-446, D-447, D-451; 08.6-06, COURSE-41..43, COURSE-46..48). 08.6-05
 * ships the live reminder, 08.6-06 the live's lifecycle notices; plan 07 adds its describes here.
 *
 * `describe('08.6 live reminder')`: lives built by the admin API on rede-demo (`store` and `courses`
 * on), opted into through the SHIPPED reminder routes, the `courses.live_reminder` jobs read back
 * from the real pg-boss table and played through the real `runLiveReminder` with an injected
 * fire-time clock (`runLiveReminderJobs`), then through the real notification fan-out
 * (`runNotificationJobs`). What is proved:
 *  - at `fireAt` the job emits and exactly the opted-in M (the seed member) and H (a throwaway
 *    member holding the product of W) each hold ONE `courses.live_reminder` row for V, actor-less,
 *    with exactly the four facts and the start-carrying dedupe key; a re-run inserts nothing;
 *  - D-446: H's product revoked before W's fire → the job still emits, H receives nothing while the
 *    support user (staff, never locked) who also opted in receives its row;
 *  - D-447: a moved start, a cancel, a fire at or after the start, a worker more than 10 minutes late
 *    and the school turned off all skip and write no row;
 *  - EP-46: a live whose only opt-in was turned off still emits at fire time, and no row is written.
 *
 * Every live and product this file writes carries `cnt86-`; both hooks sweep them, their reminder
 * jobs and the notification rows about them, and close any `notifications.fanout` job other files
 * left waiting, so the counts here are exact. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = `cnt86-${Date.now()}`;
const MINUTE = 60_000;
const DEMO_ADMIN = 'admin@rede-demo.local';
const DEMO_MEMBER = 'member@rede-demo.local';
const DEMO_SUPPORT = 'support@rede-demo.local';
const KIND = 'courses.live_reminder';

const tokens = { admin: '', member: '', support: '', h: '' };
const ids = { demo: '', admin: '', member: '', support: '', h: '' };
const restores: Array<() => Promise<void>> = [];
const starts: Record<string, string> = {};

async function created(res: Response, what: string): Promise<string> {
  expect(res.status, `${what} -> ${res.status}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A live built by the admin API on rede-demo, starting `startsInMin` from now. */
async function adminLive(key: string, startsInMin: number): Promise<string> {
  const startsAt = new Date(Date.now() + startsInMin * MINUTE).toISOString();
  const id = await created(
    await learnRequest('POST', '/v1/courses/lives', tokens.admin, HOSTS.demo, {
      title: `${PREFIX} live ${key}`,
      startsAt,
      durationMin: 60,
      externalUrl: `https://meet.example.com/${PREFIX}-${key}`,
    }),
    `live ${key}`,
  );
  // The stored instant, in the service's microsecond shape (what the job payload carries).
  const [row] = await adminSql<{ starts_at: string }[]>`
    select to_char(starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as starts_at
      from public.course_lives where id = ${id}::uuid`;
  starts[id] = row?.starts_at ?? startsAt;
  return id;
}

/** The caller turns the live's reminder on through the shipped route. */
async function optIn(liveId: string, token: string): Promise<void> {
  const res = await learnRequest(
    'PUT',
    `/v1/courses/learn/lives/${liveId}/reminder`,
    token,
    HOSTS.demo,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ on: true });
}

const fireAtOf = (liveId: string) => Date.parse(starts[liveId] ?? '') - 15 * MINUTE;

/** Plays `liveId`'s waiting reminder jobs at `nowMs`. */
const runFor = (liveId: string, nowMs: number) =>
  runLiveReminderJobs(ids.demo, nowMs, (job: LiveReminderJobRow) => job.data.liveId === liveId);

async function reminderRows(liveId: string) {
  return adminSql<
    {
      user_id: string;
      dedupe_key: string;
      actor_user_id: string | null;
      payload: Record<string, unknown>;
    }[]
  >`
    select user_id::text as user_id, dedupe_key, actor_user_id::text as actor_user_id, payload
      from public.notifications
     where tenant_id = ${ids.demo}::uuid and subject_id = ${liveId}::uuid and kind = ${KIND}
     order by user_id`;
}

/** Every `kind` row about `liveId` in rede-demo, one per recipient, ordered by user. */
async function kindRows(liveId: string, kind: string) {
  return adminSql<
    {
      user_id: string;
      dedupe_key: string;
      actor_user_id: string | null;
      payload: Record<string, unknown>;
    }[]
  >`
    select user_id::text as user_id, dedupe_key, actor_user_id::text as actor_user_id, payload
      from public.notifications
     where tenant_id = ${ids.demo}::uuid and subject_id = ${liveId}::uuid and kind = ${kind}
     order by user_id`;
}

/** The `notifications.fanout` jobs the sink enqueued for `event` about `liveId` (any state). */
async function fanoutJobs(event: string, liveId: string) {
  return adminSql<{ id: string; state: string }[]>`
    select id::text as id, state::text as state
      from pgboss.job_common
     where name = 'notifications.fanout'
       and data->>'tenantId' = ${ids.demo}
       and data->>'event' = ${event}
       and data->'payload'->>'liveId' = ${liveId}`;
}

/** Every LIVE `member` / `support_tenant` membership of rede-demo (the notice audience, D-449/D-453). */
async function demoNoticeAudience(): Promise<string[]> {
  const rows = await adminSql<{ user_id: string }[]>`
    select user_id::text as user_id from public.memberships
     where tenant_id = ${ids.demo}::uuid and status = 'active' and blocked_at is null
       and deleted_at is null and role in ('member', 'support_tenant')
     order by user_id`;
  return rows.map((row) => row.user_id);
}

/** The membership id of `userId` in rede-demo (the grant route's key). */
async function demoMembershipOf(userId: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where tenant_id = ${ids.demo}::uuid and user_id = ${userId}::uuid`;
  return row?.id ?? '';
}

/** Every `notifications.fanout` job about `liveId` (any course event, any state), by id. */
async function fanoutJobsAbout(liveId: string): Promise<string[]> {
  const rows = await adminSql<{ id: string }[]>`
    select id::text as id
      from pgboss.job_common
     where name = 'notifications.fanout'
       and data->>'event' like 'course.%'
       and data->'payload'->>'liveId' = ${liveId}
     order by id`;
  return rows.map((row) => row.id);
}

/** The admin's write on a live through the shipped admin routes. */
const adminWrite = (method: string, path: string, body?: unknown) =>
  learnRequest(method, path, tokens.admin, HOSTS.demo, body);

async function closeFanouts(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'`;
}

async function sweep(): Promise<void> {
  const rows = await adminSql<{ id: string }[]>`
    select id::text as id from public.course_lives where title like ${'cnt86-%'}`;
  const liveIds = rows.map((row) => row.id);
  if (liveIds.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${liveIds}::uuid[])`;
    await adminSql`
      delete from pgboss.job
       where (name = 'courses.live_reminder' and data->>'liveId' = any(${liveIds}::text[]))
          or (name = 'notifications.fanout'
              and data->>'event' like 'course.%'
              and data->'payload'->>'liveId' = any(${liveIds}::text[]))`;
  }
  await adminSql`delete from public.course_lives where title like ${'cnt86-%'}`;
  await removeLearnFixture('cnt86-');
  await removeIdentitiesByPrefix('cnt86');
  await adminSql`delete from public.tenants where slug like ${'cnt86-%'}`;
  await closeFanouts();
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  ids.demo = tenant?.id ?? '';
  const users = await adminSql<{ email: string; id: string }[]>`
    select email, id::text as id from public.users
     where email in (${DEMO_ADMIN}, ${DEMO_MEMBER}, ${DEMO_SUPPORT})`;
  ids.admin = users.find((user) => user.email === DEMO_ADMIN)?.id ?? '';
  ids.member = users.find((user) => user.email === DEMO_MEMBER)?.id ?? '';
  ids.support = users.find((user) => user.email === DEMO_SUPPORT)?.id ?? '';
  [tokens.admin, tokens.member, tokens.support] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(DEMO_SUPPORT, SEED_PASSWORD),
  ]);
  await sweep();
  restores.push(await withModuleEnabled('demo', 'store'));
  restores.push(await withModuleEnabled('demo', 'courses'));
  const h = await createSharedIdentity({ prefix: 'cnt86-h', memberships: [{ host: 'demo' }] });
  ids.h = h.userId;
  tokens.h = await signInAs(h.email, h.password);
});

afterAll(async () => {
  await sweep();
  for (const restore of restores.reverse()) await restore();
  await stopBoss();
  await adminSql.end();
});

describe('08.6 live reminder', () => {
  const lives = { V: '', W: '' };
  let productW = '';
  let entitlementH = '';

  beforeAll(async () => {
    lives.V = await adminLive('V', 120);
    lives.W = await adminLive('W', 180);
    productW = await created(
      await learnRequest('POST', '/v1/store/products', tokens.admin, HOSTS.demo, {
        name: `${PREFIX} produto W`,
        priceCents: 990,
        liveIds: [lives.W],
      }),
      'product W',
    );
    const [membership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where tenant_id = ${ids.demo}::uuid and user_id = ${ids.h}::uuid`;
    const grant = await learnRequest(
      'POST',
      `/v1/store/products/${productW}/grants`,
      tokens.admin,
      HOSTS.demo,
      { membershipId: membership?.id },
    );
    expect(grant.status).toBe(200);
    entitlementH = ((await grant.json()) as { entitlementId: string }).entitlementId;
  });

  it('D-445: M and H opt into V through the route; one waiting job is armed for V', async () => {
    await optIn(lives.V, tokens.member);
    await optIn(lives.V, tokens.h);
    const jobs = (await liveReminderJobsOf(ids.demo)).filter((job) => job.data.liveId === lives.V);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({
      tenantId: ids.demo,
      liveId: lives.V,
      startsAt: starts[lives.V],
    });
  });

  it('D-451: at fireAt the job emits and the fan-out gives exactly M and H one actor-less courses.live_reminder row with the four facts', async () => {
    expect(await runFor(lives.V, fireAtOf(lives.V))).toEqual(['emitted']);
    expect(await runNotificationJobs(ids.demo)).toBeGreaterThanOrEqual(1);
    const rows = await reminderRows(lives.V);
    expect(rows.map((row) => row.user_id).sort()).toEqual([ids.member, ids.h].sort());
    const epoch = Math.floor(Date.parse(starts[lives.V] ?? '') / 1000);
    for (const row of rows) {
      expect(row.dedupe_key).toBe(`${KIND}:${lives.V}:${epoch}`);
      expect(row.actor_user_id).toBeNull();
      expect(Object.keys(row.payload).sort()).toEqual([
        'liveId',
        'previewAssetId',
        'startsAt',
        'title',
      ]);
      expect(row.payload).toMatchObject({
        liveId: lives.V,
        title: `${PREFIX} live V`,
        startsAt: starts[lives.V],
        previewAssetId: null,
      });
      expect(JSON.stringify(row.payload)).not.toContain('meet.example.com');
    }
  });

  it('a re-run of the same reminder inserts nothing (the dedupe key)', async () => {
    const { runLiveReminder } = await import('@rede-social/module-courses/server');
    const payload = { tenantId: ids.demo, liveId: lives.V, startsAt: starts[lives.V] };
    expect(await runLiveReminder(payload, fireAtOf(lives.V))).toBe('emitted');
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(lives.V)).toHaveLength(2);
  });

  it('D-446 / T-08.6-04: H’s product revoked before W fires → the job still emits and H receives nothing, beside support’s row', async () => {
    await optIn(lives.W, tokens.h);
    // Positive control: support (staff, never locked) opts into W too and must receive the row.
    await optIn(lives.W, tokens.support);
    const revoked = await learnRequest(
      'DELETE',
      `/v1/store/products/${productW}/entitlements/${entitlementH}`,
      tokens.admin,
      HOSTS.demo,
    );
    expect(revoked.status).toBe(200);
    expect(await runFor(lives.W, fireAtOf(lives.W))).toEqual(['emitted']);
    await runNotificationJobs(ids.demo);
    expect((await reminderRows(lives.W)).map((row) => row.user_id)).toEqual([ids.support]);
  });

  it('D-447: a moved start skips (the old job finds another start) and writes no row', async () => {
    const moved = await adminLive('movida', 120);
    await optIn(moved, tokens.member);
    await adminSql`
      update public.course_lives set starts_at = starts_at + interval '1 hour'
       where id = ${moved}::uuid`;
    expect(await runFor(moved, fireAtOf(moved))).toEqual(['skipped']);
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(moved)).toEqual([]);
  });

  it('D-447: a cancelled live skips and writes no row', async () => {
    const cancelled = await adminLive('cancelada', 120);
    await optIn(cancelled, tokens.member);
    await adminSql`
      update public.course_lives set cancelled_at = now() where id = ${cancelled}::uuid`;
    expect(await runFor(cancelled, fireAtOf(cancelled))).toEqual(['skipped']);
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(cancelled)).toEqual([]);
  });

  it('R-Pitfall 7: a fire at the start skips (started), and so does a worker 10 minutes and 1 ms late', async () => {
    const started = await adminLive('iniciada', 120);
    await optIn(started, tokens.member);
    expect(await runFor(started, Date.parse(starts[started] ?? ''))).toEqual(['skipped']);
    const late = await adminLive('atrasada', 120);
    await optIn(late, tokens.member);
    expect(await runFor(late, fireAtOf(late) + 10 * MINUTE + 1)).toEqual(['skipped']);
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(started)).toEqual([]);
    expect(await reminderRows(late)).toEqual([]);
  });

  it('the school turned off before the fire skips (module_off) and writes no row', async () => {
    const off = await adminLive('desligada', 120);
    await optIn(off, tokens.member);
    await adminSql`
      update public.tenant_modules set enabled = false, updated_at = now()
       where tenant_id = ${ids.demo}::uuid and module_key = 'courses'`;
    moduleFlags.invalidate(ids.demo);
    try {
      expect(await runFor(off, fireAtOf(off))).toEqual(['skipped']);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true, updated_at = now()
         where tenant_id = ${ids.demo}::uuid and module_key = 'courses'`;
      moduleFlags.invalidate(ids.demo);
    }
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(off)).toEqual([]);
  });

  it('EP-46: a live whose only opt-in was turned off still emits at fire time, and no row is written', async () => {
    const empty = await adminLive('vazia', 120);
    await optIn(empty, tokens.member);
    const off = await learnRequest(
      'DELETE',
      `/v1/courses/learn/lives/${empty}/reminder`,
      tokens.member,
      HOSTS.demo,
    );
    expect(off.status).toBe(200);
    expect(await runFor(empty, fireAtOf(empty))).toEqual(['emitted']);
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(empty)).toEqual([]);
  });

  it('EP-46: a live id that no longer exists skips not_found', async () => {
    const gone = await adminLive('apagada', 120);
    await optIn(gone, tokens.member);
    const [job] = (await liveReminderJobsOf(ids.demo)).filter((row) => row.data.liveId === gone);
    await adminSql`delete from public.course_lives where id = ${gone}::uuid`;
    const { runLiveReminder } = await import('@rede-social/module-courses/server');
    expect(await runLiveReminder(job?.data, fireAtOf(gone))).toBe('skipped');
  });
});

describe('08.6 live lifecycle notices', () => {
  const CANCELLED = 'courses.live_cancelled';
  const SCHEDULED = 'courses.live_scheduled';
  const REPLAY = 'courses.replay_available';

  it('D-447 / COURSE-42: a first cancel through the admin route gives exactly the opted-in M one actor-less courses.live_cancelled row, none for the members who did not opt in', async () => {
    const live = await adminLive('cancel', 120);
    await optIn(live, tokens.member);
    const res = await adminWrite('POST', `/v1/courses/lives/${live}/cancel`);
    expect(res.status).toBe(200);
    const { cancelledAt } = (await res.json()) as { cancelledAt: string };
    expect(await fanoutJobs('course.live_cancelled', live)).toHaveLength(1);
    await runNotificationJobs(ids.demo);
    const rows = await kindRows(live, CANCELLED);
    expect(rows.map((row) => row.user_id)).toEqual([ids.member]);
    const [row] = rows;
    expect(row?.actor_user_id).toBeNull();
    expect(row?.dedupe_key).toBe(
      `${CANCELLED}:${live}:${Math.floor(Date.parse(cancelledAt) / 1000)}`,
    );
    expect(Object.keys(row?.payload ?? {}).sort()).toEqual([
      'liveId',
      'previewAssetId',
      'startsAt',
      'title',
    ]);
    expect(row?.payload).toMatchObject({ liveId: live, title: `${PREFIX} live cancel` });
    expect(JSON.stringify(row?.payload)).not.toContain('meet.example.com');

    // EP-49: a repeated cancel is no transition — 200, the same instant, no new fan-out job.
    const again = await adminWrite('POST', `/v1/courses/lives/${live}/cancel`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { cancelledAt: string }).cancelledAt).toBe(cancelledAt);
    expect(await fanoutJobs('course.live_cancelled', live)).toHaveLength(1);

    // EP-51: M's waiting reminder for the cancelled live skips `cancelled` and writes no reminder.
    expect(await runFor(live, fireAtOf(live))).toEqual(['skipped']);
    await runNotificationJobs(ids.demo);
    expect(await kindRows(live, KIND)).toEqual([]);
  });

  it('EP-50: a cancel of a live with no opt-in writes no notification row', async () => {
    const live = await adminLive('cancel-vazia', 120);
    expect((await adminWrite('POST', `/v1/courses/lives/${live}/cancel`)).status).toBe(200);
    expect(await fanoutJobs('course.live_cancelled', live)).toHaveLength(1);
    await runNotificationJobs(ids.demo);
    expect(await kindRows(live, CANCELLED)).toEqual([]);
  });

  it('EP-51: a cancel after the reminder already fired still tells the opted-in member', async () => {
    const live = await adminLive('cancel-depois', 120);
    await optIn(live, tokens.member);
    expect(await runFor(live, fireAtOf(live))).toEqual(['emitted']);
    await runNotificationJobs(ids.demo);
    expect((await kindRows(live, KIND)).map((row) => row.user_id)).toEqual([ids.member]);
    expect((await adminWrite('POST', `/v1/courses/lives/${live}/cancel`)).status).toBe(200);
    await runNotificationJobs(ids.demo);
    expect((await kindRows(live, CANCELLED)).map((row) => row.user_id)).toEqual([ids.member]);
  });

  it('R-A9: a live cancelled after its planned end notifies nobody', async () => {
    const live = await adminLive('cancel-encerrada', 120);
    await optIn(live, tokens.member);
    // The live happened three hours ago (60 minutes long): its planned end is already past.
    await adminSql`
      update public.course_lives set starts_at = now() - interval '3 hours'
       where id = ${live}::uuid`;
    expect((await adminWrite('POST', `/v1/courses/lives/${live}/cancel`)).status).toBe(200);
    expect(await fanoutJobs('course.live_cancelled', live)).toHaveLength(1);
    await runNotificationJobs(ids.demo);
    expect(await kindRows(live, CANCELLED)).toEqual([]);
  });

  it('EP-45 / D-447: a moved start (admin PATCH) arms a job for the new start with no notice; the old job skips moved and the new one fires', async () => {
    const live = await adminLive('remarcada', 120);
    await optIn(live, tokens.member);
    const original = starts[live] ?? '';
    const moved = new Date(Date.parse(original) + 60 * MINUTE).toISOString();
    const fanoutsBefore = await fanoutJobsAbout(live);
    const res = await adminWrite('PATCH', `/v1/courses/lives/${live}`, { startsAt: moved });
    expect(res.status).toBe(200);
    const originalKey = `${live}:${Math.floor(Date.parse(original) / 1000)}`;
    const movedKey = `${live}:${Math.floor(Date.parse(moved) / 1000)}`;
    const jobs = (await liveReminderJobsOf(ids.demo)).filter(
      (job) => job.data.liveId === live && job.state === 'created',
    );
    expect(jobs.map((job) => job.singleton_key).sort()).toEqual([originalKey, movedKey].sort());
    // No "Live remarcada" notice: the move enqueues no fan-out at all.
    expect(await fanoutJobsAbout(live)).toEqual(fanoutsBefore);

    const onlyKey = (key: string) => (job: LiveReminderJobRow) =>
      job.data.liveId === live && job.singleton_key === key;
    expect(await runLiveReminderJobs(ids.demo, fireAtOf(live), onlyKey(originalKey))).toEqual([
      'skipped',
    ]);
    expect(
      await runLiveReminderJobs(ids.demo, Date.parse(moved) - 15 * MINUTE, onlyKey(movedKey)),
    ).toEqual(['emitted']);
    await runNotificationJobs(ids.demo);
    const rows = await kindRows(live, KIND);
    expect(rows.map((row) => row.user_id)).toEqual([ids.member]);
    expect(rows[0]?.dedupe_key).toBe(`${KIND}:${movedKey}`);
  });

  it('EP-45: moving the start back reuses the still-waiting original job (no third job), which then fires', async () => {
    const live = await adminLive('ida-e-volta', 120);
    await optIn(live, tokens.member);
    const original = starts[live] ?? '';
    const originalIso = new Date(Date.parse(original)).toISOString();
    const moved = new Date(Date.parse(original) + 60 * MINUTE).toISOString();
    expect(
      (await adminWrite('PATCH', `/v1/courses/lives/${live}`, { startsAt: moved })).status,
    ).toBe(200);
    expect(
      (await adminWrite('PATCH', `/v1/courses/lives/${live}`, { startsAt: originalIso })).status,
    ).toBe(200);
    const jobs = (await liveReminderJobsOf(ids.demo)).filter((job) => job.data.liveId === live);
    expect(jobs).toHaveLength(2);
    const originalKey = `${live}:${Math.floor(Date.parse(original) / 1000)}`;
    const onlyKey = (key: string) => (job: LiveReminderJobRow) =>
      job.data.liveId === live && job.singleton_key === key;
    // The original job fires: its start matches the stored one again.
    expect(await runLiveReminderJobs(ids.demo, fireAtOf(live), onlyKey(originalKey))).toEqual([
      'emitted',
    ]);
    // The moved start's job finds another start and skips.
    const movedKey = `${live}:${Math.floor(Date.parse(moved) / 1000)}`;
    expect(
      await runLiveReminderJobs(ids.demo, Date.parse(moved) - 15 * MINUTE, onlyKey(movedKey)),
    ).toEqual(['skipped']);
    await runNotificationJobs(ids.demo);
    expect((await kindRows(live, KIND)).map((row) => row.user_id)).toEqual([ids.member]);
  });

  it('D-448 / D-449 / D-453: a future live (product-linked, so non-buyers too) gives every live member and support membership one courses.live_scheduled row with the actor, none for the admin actor', async () => {
    const live = await adminLive('agendada', 240);
    // A product links it before the fan-out runs: the notice is a shop window, non-buyers included.
    await created(
      await adminWrite('POST', '/v1/store/products', {
        name: `${PREFIX} produto agendada`,
        priceCents: 990,
        liveIds: [live],
      }),
      'product agendada',
    );
    expect(await fanoutJobs('course.live_scheduled', live)).toHaveLength(1);
    await runNotificationJobs(ids.demo);
    const rows = await kindRows(live, SCHEDULED);
    const audience = await demoNoticeAudience();
    expect(rows.map((row) => row.user_id)).toEqual(audience);
    expect(audience).toContain(ids.member);
    expect(audience).toContain(ids.support);
    expect(audience).not.toContain(ids.admin);
    for (const row of rows) {
      expect(row.actor_user_id).toBe(ids.admin);
      expect(row.dedupe_key).toBe(`${SCHEDULED}:${live}`);
      expect(Object.keys(row.payload).sort()).toEqual([
        'liveId',
        'previewAssetId',
        'reactivated',
        'startsAt',
        'title',
      ]);
      expect(row.payload).toMatchObject({
        liveId: live,
        title: `${PREFIX} live agendada`,
        startsAt: starts[live],
        reactivated: false,
      });
      expect(JSON.stringify(row.payload)).not.toContain('meet.example.com');
    }
  });

  it('EP-58: a live created with a start before now emits nothing', async () => {
    const res = await adminWrite('POST', '/v1/courses/lives', {
      title: `${PREFIX} live passada`,
      startsAt: new Date(Date.now() - 2 * 60 * MINUTE).toISOString(),
      durationMin: 60,
      externalUrl: `https://meet.example.com/${PREFIX}-passada`,
    });
    const live = await created(res, 'live passada');
    expect(await fanoutJobs('course.live_scheduled', live)).toEqual([]);
  });

  it('EP-60: created then cancelled before the fan-out runs → no courses.live_scheduled row (the source re-reads)', async () => {
    const live = await adminLive('cancelada-antes', 240);
    expect((await adminWrite('POST', `/v1/courses/lives/${live}/cancel`)).status).toBe(200);
    expect(await fanoutJobs('course.live_scheduled', live)).toHaveLength(1);
    await runNotificationJobs(ids.demo);
    expect(await kindRows(live, SCHEDULED)).toEqual([]);
  });

  it('EP-59: a tenant whose only membership is the admin actor → the fan-out writes zero rows', async () => {
    const slug = `${PREFIX}-so-admin`;
    const host = `${slug}.localhost`;
    const [tenant] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Escola Só Admin', 'Regras de teste.', 1)
      returning id::text as id`;
    const tenantId = tenant?.id ?? '';
    // The school and the bell are on, so the event reaches the fan-out and the definer decides.
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'courses', true), (${tenantId}::uuid, 'notifications', true)`;
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${host}, true, now())`;
    moduleFlags.invalidate(tenantId);
    const admin = await createSharedIdentity({
      prefix: 'cnt86-soadmin',
      memberships: [{ tenantSlug: slug, role: 'admin_tenant' }],
    });
    const token = await signInAs(admin.email, admin.password);
    const live = await created(
      await learnRequest('POST', '/v1/courses/lives', token, host, {
        title: `${PREFIX} live só admin`,
        startsAt: new Date(Date.now() + 240 * MINUTE).toISOString(),
        durationMin: 60,
        externalUrl: `https://meet.example.com/${PREFIX}-so-admin`,
      }),
      'live só admin',
    );
    const jobs = await adminSql<{ id: string }[]>`
      select id::text as id from pgboss.job_common
       where name = 'notifications.fanout' and data->>'tenantId' = ${tenantId}
         and data->>'event' = 'course.live_scheduled' and data->'payload'->>'liveId' = ${live}`;
    expect(jobs).toHaveLength(1);
    expect(await runNotificationJobs(tenantId)).toBe(1);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications where tenant_id = ${tenantId}::uuid`;
    expect(count?.n).toBe(0);
  });

  it('D-433 / EP-61 / EP-62: a replay set on a recorded live notifies only the two doors (staff, the live buyer, the course buyer), never a member holding neither; the facts name the live, never the lesson, and an emoji title round-trips', async () => {
    const fixture = await buildLearnFixture({
      prefix: `${PREFIX}-rp`,
      adminToken: tokens.admin,
      host: 'demo',
      materials: false,
    });
    const live = await adminLive('replay "ação" 🎬', 120);
    // The live happened three hours ago (60 minutes long): it is recorded.
    await adminSql`
      update public.course_lives set starts_at = now() - interval '3 hours' where id = ${live}::uuid`;
    const liveProduct = await created(
      await adminWrite('POST', '/v1/store/products', {
        name: `${PREFIX} produto replay`,
        priceCents: 990,
        liveIds: [live],
      }),
      'product replay',
    );
    // LD holds the live's product (the live door), CD the course's product (the course door).
    const ld = await createSharedIdentity({ prefix: 'cnt86-ld', memberships: [{ host: 'demo' }] });
    const cd = await createSharedIdentity({ prefix: 'cnt86-cd', memberships: [{ host: 'demo' }] });
    for (const [product, userId] of [
      [liveProduct, ld.userId],
      [fixture.productId, cd.userId],
    ] as const) {
      const grant = await adminWrite('POST', `/v1/store/products/${product}/grants`, {
        membershipId: await demoMembershipOf(userId),
      });
      expect(grant.status).toBe(200);
    }

    const res = await adminWrite('PATCH', `/v1/courses/lives/${live}`, {
      replayLessonId: fixture.paidLessonId,
    });
    expect(res.status).toBe(200);
    expect(await fanoutJobs('course.replay_available', live)).toHaveLength(1);
    await runNotificationJobs(ids.demo);
    const rows = await kindRows(live, REPLAY);
    expect(rows.map((row) => row.user_id)).toEqual([ids.support, ld.userId, cd.userId].sort());
    expect(rows.map((row) => row.user_id)).not.toContain(ids.member);
    for (const row of rows) {
      expect(row.actor_user_id).toBeNull();
      expect(row.dedupe_key).toBe(`${REPLAY}:${live}:${fixture.paidLessonId}`);
      expect(Object.keys(row.payload).sort()).toEqual(['liveId', 'previewAssetId', 'title']);
      expect(row.payload.title).toBe(`${PREFIX} live replay "ação" 🎬`);
      expect(JSON.stringify(row.payload)).not.toContain(fixture.paidLessonId);
      expect(JSON.stringify(row.payload)).not.toContain('aula paga');
    }

    // The same replay lesson set again is no new replay: no new fan-out.
    const again = await adminWrite('PATCH', `/v1/courses/lives/${live}`, {
      replayLessonId: fixture.paidLessonId,
    });
    expect(again.status).toBe(200);
    expect(await fanoutJobs('course.replay_available', live)).toHaveLength(1);
  });
});
