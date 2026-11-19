import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { sourcesFor } from '@rede-social/core/server/notifications/source';
import { reportLimiter } from '@rede-social/core/server/safety/limits';
import type { NotificationPage } from '@rede-social/module-notifications/contracts';
import {
  fakePushOutbox,
  notificationsFanoutJob,
  resetFakePushOutbox,
} from '@rede-social/module-notifications/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODULE_REGISTRY } from '../../src/modules/registry';
import { caseKit, removeThrowaways, request, throwawayMember } from './chat-case-fixtures';
import {
  directMember,
  removeDirectRows,
  resetDirectLimiters,
  sendDirect,
  setModule,
  withDirectModules,
} from './direct-fixtures';
import {
  adminSql,
  api,
  HOSTS,
  notificationJobsOf,
  pushSendJobsOf,
  runNotificationJobs,
  runPushSendJobs,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withModuleEnabled,
  withStoriesEnabled,
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

const ids = { demo: '', lab: '', admin: '', demoSupport: '' };
const tokens = { admin: '' };
const restores: Array<() => Promise<void>> = [];
const createdPosts: string[] = [];
const createdReports: string[] = [];
const createdStories: string[] = [];
const createdAssets: string[] = [];
const createdComments: string[] = [];
const createdCommunities: string[] = [];

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
  ids.demoSupport = kit.ids.demoSupport;
  tokens.admin = kit.tokens.demoAdmin;
  // `social` and `chat` for the direct-message subject, `notifications` for the span of the file (rede-lab ships
  // with it off and the demo may too): every flag goes back in `afterAll`.
  restores.push(await withDirectModules('demo'));
  restores.push(await withModuleEnabled('demo', 'notifications'));
  restores.push(await withStoriesEnabled('demo'));
  restores.push(await withCommunitiesEnabled('demo'));
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
  if (createdComments.length > 0) {
    await adminSql`delete from public.feed_comments where id = any(${createdComments}::uuid[])`;
  }
  if (createdStories.length > 0) {
    await adminSql`delete from public.feed_comments where story_id = any(${createdStories}::uuid[])`;
    await adminSql`delete from public.stories where id = any(${createdStories}::uuid[])`;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
  }
  if (createdCommunities.length > 0) {
    await adminSql`delete from public.communities where id = any(${createdCommunities}::uuid[])`;
  }
  if (createdPosts.length > 0) {
    await adminSql`delete from public.feed_comments where post_id = any(${createdPosts}::uuid[])`;
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

/* ── fixtures of the other subjects (the six-subject comparison) ─────────────────────────────────── */

async function insertStory(authorId: string, caption: string): Promise<string> {
  const assetId = randomUUID();
  createdAssets.push(assetId);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${assetId}::uuid, ${ids.demo}::uuid, ${authorId}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])`;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
    values (${ids.demo}::uuid, ${authorId}::uuid, ${assetId}::uuid, 'image', ${caption}, 'tenant')
    returning id::text as id`;
  const id = row?.id ?? '';
  createdStories.push(id);
  return id;
}

async function insertPostComment(postId: string, authorId: string, body: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
    values (${ids.demo}::uuid, ${postId}::uuid, ${authorId}::uuid, ${body})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdComments.push(id);
  return id;
}

async function insertStoryComment(
  storyId: string,
  authorId: string,
  body: string,
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
    values (${ids.demo}::uuid, ${storyId}::uuid, ${authorId}::uuid, ${body})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdComments.push(id);
  return id;
}

async function insertCommunity(creatorId: string, name: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug, description, kind, position)
    values (${ids.demo}::uuid, ${creatorId}::uuid, ${name}, ${`rn-${randomUUID().slice(0, 8)}`}, '',
            'member', 1000000)
    returning id::text as id`;
  const id = row?.id ?? '';
  createdCommunities.push(id);
  return id;
}

/** The recipients' ids of a report's notice rows, sorted. */
const recipientsOf = async (reportId: string): Promise<string[]> =>
  (await noticesOf(reportId)).map((row) => row.user_id).sort();

describe('every subject', () => {
  it('a report of a post, a post comment, a story, a story comment, a community and a message gives the moderators the SAME row and push, byte-identical apart from the report id and tag', async () => {
    const reporter = await directMember('rn-sub-rep');
    const author = await directMember('rn-sub-aut');
    await subscribeDevice(tokens.admin, 'admin-subjects');

    const postId = await seedPost(author.userId, 'sujeitos');
    const storyId = await insertStory(author.userId, `${PREFIX}historia`);
    const sent = await sendDirect(author, reporter.membershipId, 'mensagem que sera denunciada');
    expect(sent.status).toBe(201);
    const messageId = ((await sent.json()) as { message: { id: string } }).message.id;
    const subjects: Array<[string, string]> = [
      ['feed_post', postId],
      ['post_comment', await insertPostComment(postId, author.userId, `${PREFIX}comentario`)],
      ['story', storyId],
      ['story_comment', await insertStoryComment(storyId, author.userId, `${PREFIX}resposta`)],
      ['community', await insertCommunity(author.userId, `${PREFIX}Clube`)],
      ['direct_message', messageId],
    ];

    const shapes: string[] = [];
    for (const [subjectType, subjectId] of subjects) {
      const reportId = await fileReport(reporter.token, subjectType, subjectId);
      await play(reportId);
      const rows = await noticesOf(reportId);
      const jobs = await pushJobsOf(reportId);
      expect(rows.length, `${subjectType}: one row per administrator`).toBe(
        (await liveAdministrators(ids.demo)).length,
      );
      expect(jobs, `${subjectType}: one push job`).toHaveLength(1);
      const tag = reportId.replaceAll('-', '');
      shapes.push(
        JSON.stringify({
          rows: rows.map((row) => ({ ...row, subject_id: '<report>', seen_at: null })),
          push: { ...jobs[0]?.data.push, tag: '<tag>', topic: '<tag>' },
          dedupe: (jobs[0]?.data.dedupeKey ?? '').replace(reportId, '<report>'),
          userIds: [...(jobs[0]?.data.userIds ?? [])].sort(),
          tagIsReport: jobs[0]?.data.push.tag === tag,
        }),
      );
      // Nothing of the subject, the reporter or the reported member rides any part of it.
      const everything = JSON.stringify({ rows, jobs: jobs.map((job) => job.data) });
      for (const secret of [subjectId, subjectType, author.userId, reporter.userId, PREFIX]) {
        expect(everything, `${subjectType}: ${secret}`).not.toContain(secret);
      }
    }
    expect(shapes).toHaveLength(6);
    expect(new Set(shapes).size).toBe(1);
  });
});

describe('exclusions', () => {
  it('when the only administrator is the reported author nobody is told: no row, no push job (MODER-05 empty)', async () => {
    expect(await liveAdministrators(ids.demo)).toEqual([ids.admin]);
    const reporter = await directMember('rn-emp-rep');
    const reportId = await fileReport(
      reporter.token,
      'feed_post',
      await seedPost(ids.admin, 'unico administrador'),
    );
    await awaitFanoutJob(ids.demo, reportId);
    await runNotificationJobs(ids.demo);
    await runPushSendJobs(ids.demo);
    expect(await noticesOf(reportId)).toEqual([]);
    expect(await pushJobsOf(reportId)).toEqual([]);
  });

  it('an administrator whose own content is reported is not told, a second administrator is; a support member, a blocked and a removed administrator are not (D-729, T-11-31)', async () => {
    const reporter = await directMember('rn-exc-rep');
    const second = await throwawayMember('rn-adm2', 'admin_tenant');
    const support = await throwawayMember('rn-sup', 'support_tenant');
    const blocked = await throwawayMember('rn-adm-blocked', 'admin_tenant');
    const removed = await throwawayMember('rn-adm-removed', 'admin_tenant');
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where tenant_id = ${ids.demo}::uuid and user_id = ${blocked.id}::uuid`;
    await adminSql`
      update public.memberships set deleted_at = now()
       where tenant_id = ${ids.demo}::uuid and user_id = ${removed.id}::uuid`;
    await subscribeDevice(second.token, 'second-admin');
    await subscribeDevice(support.token, 'support');

    const reportId = await fileReport(
      reporter.token,
      'feed_post',
      await seedPost(ids.admin, 'conteudo do administrador'),
    );
    await play(reportId);

    const told = await recipientsOf(reportId);
    expect(told).toContain(second.id);
    expect(told).not.toContain(ids.admin);
    expect(told).not.toContain(reporter.userId);
    for (const out of [support.id, blocked.id, removed.id, ids.demoSupport]) {
      expect(told).not.toContain(out);
    }
    expect(told.sort()).toEqual(
      (await liveAdministrators(ids.demo)).filter((id) => id !== ids.admin).sort(),
    );
    const pushed = (await pushJobsOf(reportId)).flatMap((job) => job.data.userIds);
    expect(pushed).toContain(second.id);
    expect(pushed).not.toContain(ids.admin);
    expect(pushed).not.toContain(support.id);
  });

  it('a reporter who is staff is not told of their own report, the other administrator is', async () => {
    const author = await directMember('rn-stf-aut');
    const second = await throwawayMember('rn-adm3', 'admin_tenant');
    await subscribeDevice(second.token, 'second-reporter-admin');
    const reportId = await fileReport(
      second.token,
      'feed_post',
      await seedPost(author.userId, 'staff'),
    );
    await play(reportId);
    const told = await recipientsOf(reportId);
    expect(told).toContain(ids.admin);
    expect(told).not.toContain(second.id);
    expect(told).not.toContain(author.userId);
  });
});

describe('notifications off', () => {
  it('a tenant with notifications off gets no row and no job, and the report still files and lists (D-229)', async () => {
    const restore = await setModule('demo', 'notifications', false);
    try {
      const reporter = await directMember('rn-off-rep');
      const author = await directMember('rn-off-aut');
      const jobsBefore = (await notificationJobsOf(ids.demo)).length;
      const reportId = await fileReport(
        reporter.token,
        'feed_post',
        await seedPost(author.userId, 'sem notificacoes'),
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect((await notificationJobsOf(ids.demo)).length).toBe(jobsBefore);
      await runNotificationJobs(ids.demo);
      await runPushSendJobs(ids.demo);
      expect(await noticesOf(reportId)).toEqual([]);
      expect(await pushJobsOf(reportId)).toEqual([]);

      const queue = await request('/v1/admin/reports?estado=todas&limit=50', tokens.admin);
      expect(queue.status).toBe(200);
      const page = (await queue.json()) as { items: Array<{ id: string }> };
      expect(page.items.map((item) => item.id)).toContain(reportId);
    } finally {
      await restore();
    }
  });
});

describe('tenant isolation', () => {
  it("tenant A's report never notifies tenant B's administrator, and tenant B's administrator is told of their own report (T-11-01)", async () => {
    const restoreLab = await withModuleEnabled('lab', 'notifications');
    restores.push(restoreLab);
    const labAdmin = await adminSql<{ id: string }[]>`
      select u.id::text as id from public.users u join public.memberships m on m.user_id = u.id
       where m.tenant_id = ${ids.lab}::uuid and m.role = 'admin_tenant' and u.email = 'admin@rede-lab.local'`;
    const labAdminId = labAdmin[0]?.id ?? '';
    expect(labAdminId).not.toBe('');

    // Tenant A's report: the lab administrator gets nothing.
    const reporter = await directMember('rn-iso-rep');
    const author = await directMember('rn-iso-aut');
    const demoReport = await fileReport(
      reporter.token,
      'feed_post',
      await seedPost(author.userId, 'isolamento'),
    );
    await play(demoReport);
    expect(await recipientsOf(demoReport)).toContain(ids.admin);
    expect(await recipientsOf(demoReport)).not.toContain(labAdminId);
    expect(
      await adminSql`
      select 1 from public.notifications where user_id = ${labAdminId}::uuid and subject_id = ${demoReport}::uuid`,
    ).toHaveLength(0);

    // The positive control: a report filed in tenant B notifies tenant B's administrator and not tenant A's.
    const labReporter = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
    const [labAuthor] = await adminSql<{ id: string }[]>`
      select u.id::text as id from public.users u where u.email = 'marcos.vinicius@rede-lab.local'`;
    const [labPost] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, caption, author_user_id)
      values (${ids.lab}::uuid, ${`${PREFIX}lab`}, ${labAuthor?.id ?? ''}::uuid)
      returning id::text as id`;
    createdPosts.push(labPost?.id ?? '');
    const labReport = await fileReport(labReporter, 'feed_post', labPost?.id ?? '', HOSTS.lab);
    await play(labReport, ids.lab);
    const labTold = await recipientsOf(labReport);
    expect(labTold).toContain(labAdminId);
    expect(labTold).not.toContain(ids.admin);
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'`;
  });
});

describe('bell counters and list', () => {
  it("the administrator's counter counts the new row, the list returns it with empty facts, marking it seen clears the bell, and the 90-day prune treats it like any row (D-231)", async () => {
    const reporter = await directMember('rn-bell-rep');
    const author = await directMember('rn-bell-aut');
    const unseenBefore = await adminSql<{ id: string }[]>`
      select id::text as id from public.notifications
       where user_id = ${ids.admin}::uuid and tenant_id = ${ids.demo}::uuid and seen_at is null`;
    const counterBefore = await unreadCounter();

    const reportId = await fileReport(
      reporter.token,
      'feed_post',
      await seedPost(author.userId, 'sino'),
    );
    await play(reportId);

    expect(await unreadCounter()).toBe(counterBefore + 1);
    const unread = await listFor('unread');
    const row = unread.items.find((item) => item.subject.id === reportId);
    expect(row).toMatchObject({
      kind: KIND,
      subject: { type: 'report', id: reportId },
      object: null,
      actor: null,
      facts: {},
      preview: null,
      removed: false,
      seenAt: null,
      readAt: null,
    });

    // Seen clears the bell and leaves the row unread (D-230); read moves it to the read section.
    const seen = await request('/v1/notifications/seen', tokens.admin, { method: 'POST' });
    expect(seen.status).toBe(204);
    expect(await unreadCounter()).toBe(0);
    expect((await listFor('unread')).items.some((item) => item.id === row?.id)).toBe(true);
    const read = await request(`/v1/notifications/${row?.id}/read`, tokens.admin, {
      method: 'POST',
    });
    expect(read.status).toBe(204);
    expect((await listFor('read')).items.some((item) => item.id === row?.id)).toBe(true);
    // The rows other files left unseen before this case are put back as they were.
    if (unseenBefore.length > 0) {
      await adminSql`
        update public.notifications set seen_at = null
         where id = any(${unseenBefore.map((r) => r.id)}::uuid[])`;
    }

    // The prune: an old row of the kind goes, the fresh one stays.
    const oldReport = randomUUID();
    await adminSql`
      insert into public.notifications
        (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, created_at)
      values (${ids.demo}::uuid, ${ids.admin}::uuid, ${KIND}, ${`${KIND}:${oldReport}`}, 'report',
              ${oldReport}::uuid, now() - interval '90 days 1 minute')`;
    await adminSql`select app.notifications_prune(100000)`;
    expect(await noticesOf(oldReport)).toEqual([]);
    expect((await noticesOf(reportId)).length).toBeGreaterThan(0);
  });
});

describe('unchanged', () => {
  it('every source the manifests declare is still registered once, and report.created has exactly the notice of this module', () => {
    expect(api).toBeDefined();
    let declared = 0;
    for (const manifest of Object.values(MODULE_REGISTRY)) {
      for (const source of manifest?.notificationSources ?? []) {
        declared += 1;
        expect(sourcesFor(source.event), source.event).toContain(source);
      }
    }
    expect(declared).toBeGreaterThan(1);
    const forReport = sourcesFor('report.created');
    expect(forReport).toHaveLength(1);
    expect(forReport[0]).toBe(MODULE_REGISTRY.notifications?.notificationSources?.[0]);
    // The shipped kinds keep their producers: a feed post, a story, a follow and a chat message.
    for (const event of ['post.published', 'social.followed', 'chat.message_sent'] as const) {
      expect(sourcesFor(event).length, event).toBeGreaterThan(0);
    }
  });
});

async function unreadCounter(): Promise<number> {
  const res = await request('/v1/me/bootstrap', tokens.admin);
  expect(res.status).toBe(200);
  return ((await res.json()) as { counters: { unreadNotifications: number } }).counters
    .unreadNotifications;
}

async function listFor(section: 'unread' | 'read'): Promise<NotificationPage> {
  const res = await request(`/v1/notifications?section=${section}&limit=50`, tokens.admin);
  expect(res.status).toBe(200);
  return (await res.json()) as NotificationPage;
}
