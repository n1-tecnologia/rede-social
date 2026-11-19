import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { reportLimiter } from '@rede-social/core/server/safety/limits';
import {
  fakePushOutbox,
  notificationsFanoutJob,
  resetFakePushOutbox,
} from '@rede-social/module-notifications/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, request } from './chat-case-fixtures';
import {
  directMember,
  removeDirectRows,
  resetDirectLimiters,
  withDirectModules,
} from './direct-fixtures';
import {
  adminSql,
  HOSTS,
  notificationJobsOf,
  pushSendJobsOf,
  runNotificationJobs,
  runPushSendJobs,
  withModuleEnabled,
} from './setup';

/**
 * Phase 11 plan 17 (MODER-05; D-229, D-235, D-616, D-729, UI-D-876; T-11-01, T-11-12, T-11-13, T-11-31, T-11-32):
 * the notice a new report raises for the moderators, against the live local stack and the worker's real lanes.
 *
 * `report notice tracer`: a member reports another member's post; the administrator gets ONE unread
 * `moderation.report_created` row (empty facts, subject `report`, no actor) and ONE push titled `Nova denúncia`,
 * and the reporter and the reported author get nothing. The fan-out is played by `runNotificationJobs`, which is the
 * worker's own handler, and the push by `runPushSendJobs` on the fake transport.
 *
 * Every row is scoped by the ids it created; the throwaway members, posts, reports, devices and rows are removed in
 * `afterAll` and the `notifications` flag of rede-demo goes back to what it was. Test ORDER is load-bearing
 * (`fileParallelism: false`, declaration order).
 */

const FAKE_PUSH = 'https://push.fake.test';
const KIND = 'moderation.report_created';
const PREFIX = 'Aviso de denuncia ';

const deviceKeys = (): { p256dh: string; auth: string } => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
};

const endpoints: string[] = [];

/** One push device for the caller, through the real route; the endpoint is remembered for the sweep. */
async function subscribeDevice(token: string, label: string): Promise<string> {
  const endpoint = `${FAKE_PUSH}/sub/report-notice-${label}-${randomUUID()}`;
  endpoints.push(endpoint);
  const res = await request('/v1/notifications/push-subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({ endpoint, keys: deviceKeys(), userAgent: 'vitest' }),
  });
  expect(res.status).toBeLessThan(300);
  return endpoint;
}

const ids = { demo: '', lab: '', admin: '' };
const tokens = { admin: '' };
const restores: Array<() => Promise<void>> = [];
const createdPosts: string[] = [];
const createdReports: string[] = [];

/** A post of the demo tenant written by hand, authored by `authorId`. */
async function seedPost(authorId: string, label: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, caption, author_user_id)
    values (${ids.demo}::uuid, ${`${PREFIX}${label}`}, ${authorId}::uuid)
    returning id::text as id`;
  const id = row?.id ?? '';
  createdPosts.push(id);
  return id;
}

/** The reporter files a report of a post; the id of the new report. */
async function fileReport(
  token: string,
  subjectType: string,
  subjectId: string,
  host: string = HOSTS.demo,
): Promise<string> {
  reportLimiter.reset();
  const res = await request('/v1/reports', token, {
    method: 'POST',
    body: JSON.stringify({ subjectType, subjectId, reason: 'spam' }),
    headers: { 'x-tenant-host': host },
  });
  expect(res.status, `POST /v1/reports ${subjectType}`).toBe(201);
  const { id } = (await res.clone().json()) as { id: string };
  createdReports.push(id);
  return id;
}

/** Waits (at most 3 s) until the bus flush enqueued the fan-out job that carries `reportId`. */
async function awaitFanoutJob(tenantId: string, reportId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const jobs = await notificationJobsOf(tenantId);
    if (jobs.some((job) => JSON.stringify(job.data).includes(reportId))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no fan-out job for report ${reportId}`);
}

/** Plays the worker for one filed report: the fan-out, then the push sends it enqueued. */
async function play(reportId: string, tenantId: string = ids.demo): Promise<void> {
  await awaitFanoutJob(tenantId, reportId);
  await runNotificationJobs(tenantId);
  await runPushSendJobs(tenantId);
}

type NoticeRow = {
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
  subject_type: string;
  subject_id: string;
  actor_user_id: string | null;
  seen_at: string | null;
};

/** Every report notice row written for `reportId`, whoever got it. */
async function noticesOf(reportId: string): Promise<NoticeRow[]> {
  return adminSql<NoticeRow[]>`
    select user_id::text as user_id, kind, payload, subject_type, subject_id::text as subject_id,
           actor_user_id::text as actor_user_id, seen_at::text as seen_at
      from public.notifications
     where kind = ${KIND} and subject_id = ${reportId}::uuid
     order by created_at, id`;
}

/** The push jobs (any state) the report's fan-out enqueued. */
async function pushJobsOf(reportId: string, tenantId: string = ids.demo) {
  return (await pushSendJobsOf(tenantId)).filter(
    (job) => job.data.dedupeKey === `${KIND}:${reportId}`,
  );
}

/** The tenant's live administrators: who the notice is for, before the exclusions. */
async function liveAdministrators(tenantId: string): Promise<string[]> {
  const rows = await adminSql<{ id: string }[]>`
    select user_id::text as id from public.memberships
     where tenant_id = ${tenantId}::uuid and role = 'admin_tenant' and status = 'active'
       and blocked_at is null and deleted_at is null`;
  return rows.map((row) => row.id);
}

async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'`;
}

beforeAll(async () => {
  const kit = await caseKit();
  ids.demo = kit.ids.demo;
  ids.lab = kit.ids.lab;
  ids.admin = kit.ids.demoAdmin;
  tokens.admin = kit.tokens.demoAdmin;
  // `social` and `chat` for the direct-message subject, `notifications` for the span of the file (rede-lab ships
  // with it off and the demo may too): every flag goes back in `afterAll`.
  restores.push(await withDirectModules('demo'));
  restores.push(await withModuleEnabled('demo', 'notifications'));
  await closeWaitingJobs();
  resetFakePushOutbox();
});

beforeEach(() => {
  reportLimiter.reset();
  resetDirectLimiters();
});

afterAll(async () => {
  await closeWaitingJobs();
  if (createdReports.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${createdReports}::uuid[])`;
    await adminSql`delete from public.content_reports where id = any(${createdReports}::uuid[])`;
  }
  if (createdPosts.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPosts}::uuid[])`;
  }
  if (endpoints.length > 0) {
    await adminSql`delete from public.push_subscriptions where endpoint = any(${endpoints}::text[])`;
  }
  await removeDirectRows();
  await removeThrowaways();
  for (const restore of restores.splice(0).reverse()) await restore();
  await adminSql.end();
  await sqlClient.end();
});

describe('report notice tracer', () => {
  it('a member reports a post: the administrator gets ONE bell row and ONE push titled Nova denúncia, naming nothing; the reporter and the author get none (D-729, UI-D-876)', async () => {
    const reporter = await directMember('rn-rep');
    const author = await directMember('rn-aut');
    const adminEndpoint = await subscribeDevice(tokens.admin, 'admin');
    await subscribeDevice(reporter.token, 'reporter');
    await subscribeDevice(author.token, 'author');
    const postId = await seedPost(author.userId, 'tracer');

    const reportId = await fileReport(reporter.token, 'feed_post', postId);
    await play(reportId);

    // The bell: exactly the live administrators, one row each, with nothing in it.
    const rows = await noticesOf(reportId);
    const administrators = await liveAdministrators(ids.demo);
    expect(administrators).toContain(ids.admin);
    expect(rows.map((row) => row.user_id).sort()).toEqual([...administrators].sort());
    const mine = rows.find((row) => row.user_id === ids.admin);
    expect(mine).toMatchObject({
      kind: KIND,
      payload: {},
      subject_type: 'report',
      subject_id: reportId,
      actor_user_id: null,
      seen_at: null,
    });
    expect(rows.map((row) => row.user_id)).not.toContain(reporter.userId);
    expect(rows.map((row) => row.user_id)).not.toContain(author.userId);

    // The push: ONE job for this report, titled by `titleText`, the fixed body, the queue's path and the report's tag.
    const jobs = await pushJobsOf(reportId);
    expect(jobs).toHaveLength(1);
    const tag = reportId.replaceAll('-', '');
    expect(jobs[0]?.data.push).toMatchObject({
      title: 'tenant',
      titleText: 'Nova denúncia',
      body: 'Toque para ver a fila de denúncias.',
      url: '/configuracoes/denuncias',
      tag,
      topic: tag,
      ttlSeconds: 259_200,
      urgency: 'normal',
    });
    expect(jobs[0]?.data.userIds).toContain(ids.admin);
    expect(jobs[0]?.data.userIds).not.toContain(reporter.userId);
    expect(jobs[0]?.data.userIds).not.toContain(author.userId);

    // On the wire: one banner for the administrator's device, and the reporter's and author's devices got none.
    const sent = fakePushOutbox().filter((send) => send.payload.includes(tag));
    expect(sent.map((send) => send.endpoint)).toContain(adminEndpoint);
    const banner = JSON.parse(
      sent.find((send) => send.endpoint === adminEndpoint)?.payload ?? '{}',
    );
    expect(banner).toMatchObject({
      title: 'Nova denúncia',
      body: 'Toque para ver a fila de denúncias.',
      url: '/configuracoes/denuncias',
      tag,
    });
    expect(JSON.stringify(banner)).not.toContain(PREFIX);
    expect(JSON.stringify(banner)).not.toContain(reporter.userId);
    expect(JSON.stringify(banner)).not.toContain(author.userId);
    for (const send of sent) {
      expect(send.endpoint).not.toMatch(/report-notice-(reporter|author)-/);
    }
  });

  it('two reports are two rows, two banners and two tags; a redelivered event is the same key and adds nothing (MODER-05 idempotency)', async () => {
    const reporter = await directMember('rn-rep2');
    const author = await directMember('rn-aut2');
    await subscribeDevice(tokens.admin, 'admin-per-report');
    const first = await fileReport(
      reporter.token,
      'feed_post',
      await seedPost(author.userId, 'um'),
    );
    const second = await fileReport(
      reporter.token,
      'feed_post',
      await seedPost(author.userId, 'dois'),
    );
    await awaitFanoutJob(ids.demo, second);
    await runNotificationJobs(ids.demo);
    await runPushSendJobs(ids.demo);

    const firstJobs = await pushJobsOf(first);
    const secondJobs = await pushJobsOf(second);
    expect(firstJobs).toHaveLength(1);
    expect(secondJobs).toHaveLength(1);
    expect(firstJobs[0]?.data.push.tag).toBe(first.replaceAll('-', ''));
    expect(secondJobs[0]?.data.push.tag).toBe(second.replaceAll('-', ''));
    expect(firstJobs[0]?.data.push.tag).not.toBe(secondJobs[0]?.data.push.tag);
    expect(firstJobs[0]?.data.dedupeKey).not.toBe(secondJobs[0]?.data.dedupeKey);
    expect(await noticesOf(first)).toHaveLength((await liveAdministrators(ids.demo)).length);
    expect(await noticesOf(second)).toHaveLength((await liveAdministrators(ids.demo)).length);

    // A redelivery of the first report's event: the very same job payload runs again.
    const original = (await notificationJobsOf(ids.demo)).find((job) =>
      JSON.stringify(job.data).includes(first),
    );
    expect(original).toBeDefined();
    const rowsBefore = (await noticesOf(first)).length;
    const jobsBefore = (await pushSendJobsOf(ids.demo)).length;
    await notificationsFanoutJob.handler(
      original?.data as Parameters<typeof notificationsFanoutJob.handler>[0],
    );
    expect(await noticesOf(first)).toHaveLength(rowsBefore);
    expect((await pushSendJobsOf(ids.demo)).length).toBe(jobsBefore);
  });
});
