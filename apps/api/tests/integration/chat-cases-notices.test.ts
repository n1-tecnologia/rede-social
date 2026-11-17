import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { SendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  post,
  removeThrowaways,
  request,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import {
  adminSql,
  authAdmin,
  HOSTS,
  pushSendJobsOf,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * The notices of the support case against the live local stack and the real worker lanes (Phase 12.4, plan 09):
 * the member's bell row and push when a case is resolved, the team's pushes for a new, reopened, assigned and
 * answered case, the counters that learn "active means not closed", and the `chat.case` signals end to end
 * (CASE-17, CASE-18, CASE-19, CASE-20, CASE-23; D-808, D-809, D-840, D-841, D-237, D-238).
 *
 * The tenant counter is never touched. Test ORDER is load-bearing (`fileParallelism: false`, declaration
 * order). A fan-out job is played by `runNotificationJobs`, which is the worker's own handler.
 */

const FAKE_PUSH = 'https://push.fake.test';

const deviceKeys = (): { p256dh: string; auth: string } => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
};

/**
 * One push device for the caller, through the real route (the shape of the helper of `moderation-posts.test.ts`,
 * copied on purpose because that one is local to its file). `host` picks the tenant the device belongs to.
 */
async function subscribeDevice(token: string, endpoint: string, host = HOSTS.demo): Promise<void> {
  const res = await request('/v1/notifications/push-subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({ endpoint, keys: deviceKeys(), userAgent: 'vitest' }),
    headers: { 'x-tenant-host': host },
  });
  expect(res.status).toBeLessThan(300);
}

const endpoints: string[] = [];
const newEndpoint = (label: string): string => {
  const endpoint = `${FAKE_PUSH}/sub/notices-${label}-${randomUUID()}`;
  endpoints.push(endpoint);
  return endpoint;
};

async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'`;
}

async function send(token: string, body: string): Promise<SendResult> {
  const res = await post('/v1/chat/support/messages', token, { body });
  expect(res.status).toBe(201);
  return (await res.json()) as SendResult;
}

const reply = (token: string, conversationId: string, body = 'Resposta da equipe') =>
  post(`/v1/chat/conversations/${conversationId}/messages`, token, { body });

const act = (token: string, conversationId: string, action: string, body: unknown) =>
  post(`/v1/chat/conversations/${conversationId}/case/${action}`, token, body);

async function caseNumberOf(conversationId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select case_number::int as n from public.chat_conversations where id = ${conversationId}::uuid`;
  return row?.n ?? -1;
}

type NoticeRow = { user_id: string; kind: string; payload: Record<string, unknown> };

async function noticeRows(tenantId: string, kind: string): Promise<NoticeRow[]> {
  return adminSql<NoticeRow[]>`
    select user_id::text as user_id, kind, payload
      from public.notifications
     where tenant_id = ${tenantId}::uuid and kind = ${kind}
     order by created_at, id`;
}

async function noticeCount(tenantId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.notifications where tenant_id = ${tenantId}::uuid`;
  return row?.n ?? -1;
}

/** The push jobs of `tenantId` that name `userId`, optionally of one kind. */
async function pushJobsFor(tenantId: string, userId: string, kind?: string) {
  return (await pushSendJobsOf(tenantId)).filter(
    (job) => job.data.userIds.includes(userId) && (kind === undefined || job.data.kind === kind),
  );
}

async function pushSubscriptionCount(userId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.push_subscriptions where user_id = ${userId}::uuid`;
  return row?.n ?? -1;
}

/** rede-lab ships with `notifications` (and chat) OFF: turned on for the file and restored afterwards. */
async function setModule(
  tenantId: string,
  moduleKey: string,
  enabled: boolean,
): Promise<() => Promise<void>> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = ${moduleKey}`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, ${moduleKey}, ${enabled})
    on conflict (tenant_id, module_key) do update set enabled = ${enabled}, updated_at = now()`;
  moduleFlags.invalidate(tenantId);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${tenantId}::uuid and module_key = ${moduleKey}`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenantId}::uuid and module_key = ${moduleKey}`;
    }
    moduleFlags.invalidate(tenantId);
  };
}

/** A throwaway LIVE `support_tenant` of rede-lab with a device (the CASE-23 bystander). */
let labStaff: { id: string; token: string; endpoint: string } | null = null;
const restores: Array<() => Promise<void>> = [];

async function createLabStaff(): Promise<{ id: string; token: string; endpoint: string }> {
  const { ids } = await caseKit();
  const email = `notices-lab-staff-${Date.now()}@rede-lab.local`;
  const created = await authAdmin().createUser({
    email,
    password: 'Segredo123',
    email_confirm: true,
    user_metadata: { name: 'Equipe Lab Avisos' },
  });
  const id = created.data.user?.id ?? '';
  if (!id) throw new Error(`could not create ${email}: ${created.error?.message}`);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${ids.lab}::uuid, ${id}::uuid, 'support_tenant', 'active')`;
  const token = await signInAs(email, 'Segredo123');
  const endpoint = newEndpoint('lab-staff');
  await subscribeDevice(token, endpoint, HOSTS.lab);
  return { id, token, endpoint };
}

async function removeLabStaff(): Promise<void> {
  if (!labStaff) return;
  const { id } = labStaff;
  labStaff = null;
  await adminSql`delete from public.push_subscriptions where user_id = ${id}::uuid`;
  await adminSql`delete from public.notifications where user_id = ${id}::uuid`;
  await adminSql`
    delete from public.member_profiles
     where membership_id in (select id from public.memberships where user_id = ${id}::uuid)`;
  await adminSql`delete from public.memberships where user_id = ${id}::uuid`;
  await authAdmin().deleteUser(id);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required');
  const { ids } = await caseKit();
  await sweepCases();
  restores.push(await setModule(ids.lab, 'notifications', true));
  labStaff = await createLabStaff();
});

afterAll(async () => {
  await removeLabStaff();
  for (const restore of restores.splice(0).reverse()) await restore();
  if (endpoints.length > 0) {
    await adminSql`delete from public.push_subscriptions where endpoint = any(${endpoints}::text[])`;
  }
  await closeWaitingJobs();
  await sweepCases();
  await removeThrowaways();
});

describe('case resolved notice', () => {
  it('tracer: staff resolves a case, the member gets ONE bell row (ids only) and ONE push, the team and a bystander get none (D-808, CASE-19, CASE-23)', async () => {
    const { tokens, ids } = await caseKit();
    const member = await throwawayMember('resolved');
    const bystander = await throwawayMember('bystander');
    const memberEndpoint = newEndpoint('member');
    const supportEndpoint = newEndpoint('support');
    await subscribeDevice(member.token, memberEndpoint);
    await subscribeDevice(bystander.token, newEndpoint('bystander'));
    await subscribeDevice(tokens.demoSupport, supportEndpoint);

    const opened = await send(member.token, 'Preciso de ajuda com o pagamento do plano');
    const id = opened.conversationId;
    expect((await reply(tokens.demoSupport, id)).status).toBe(201);
    await closeWaitingJobs();

    // The lab bystander is live, has a device, and the control row proves the subscription exists.
    expect(labStaff).not.toBeNull();
    const lab = labStaff as { id: string; token: string; endpoint: string };
    expect(await pushSubscriptionCount(lab.id)).toBe(1);
    const labRowsBefore = await noticeCount(ids.lab);
    const labJobsBefore = (await pushSendJobsOf(ids.lab)).length;
    const demoRowsBefore = (await noticeRows(ids.demo, 'chat.case_resolved')).length;

    const res = await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' });
    expect(res.status).toBe(200);
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    const number = await caseNumberOf(id);
    expect(number).toBeGreaterThan(0);

    // ONE bell row, for the member only, facts exactly { caseId, number }.
    const rows = (await noticeRows(ids.demo, 'chat.case_resolved')).slice(demoRowsBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(member.id);
    expect(rows[0]?.payload).toEqual({ caseId: id, number });

    // ONE push job, the fixed sentence, a tap into the case, one device tag per case.
    const jobs = await pushJobsFor(ids.demo, member.id, 'chat.case_resolved');
    expect(jobs).toHaveLength(1);
    const tag = id.replaceAll('-', '');
    expect(jobs[0]?.data.userIds).toEqual([member.id]);
    expect(jobs[0]?.data.push).toMatchObject({
      title: 'team',
      body: `Seu chamado #${number} foi resolvido.`,
      url: `/suporte/${id}`,
      tag,
      topic: tag,
    });

    // Nobody else: not the team, not another member of the same tenant.
    for (const other of [ids.demoSupport, ids.demoAdmin, bystander.id]) {
      expect(await pushJobsFor(ids.demo, other, 'chat.case_resolved')).toHaveLength(0);
      const [count] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.notifications
         where user_id = ${other}::uuid and kind = 'chat.case_resolved'`;
      expect(count?.n).toBe(0);
    }

    // CASE-23: the tenant B staff user (live, with a device) got nothing and tenant B's tables did not move.
    expect(await pushSubscriptionCount(lab.id)).toBe(1);
    expect(await pushJobsFor(ids.lab, lab.id)).toHaveLength(0);
    expect(await noticeCount(ids.lab)).toBe(labRowsBefore);
    expect((await pushSendJobsOf(ids.lab)).length).toBe(labJobsBefore);
    const [labBell] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications where user_id = ${lab.id}::uuid`;
    expect(labBell?.n).toBe(0);
  });

  it('EP-060 boundary: a case reopened before the worker ran notifies nobody; resolve, reopen, resolve yields ONE notice for the latest instant (D-808, T-12.4-43)', async () => {
    const { tokens, ids } = await caseKit();
    const member = await throwawayMember('reopened');
    await subscribeDevice(member.token, newEndpoint('reopened'));
    const opened = await send(member.token, 'Meu acesso nao abre');
    const id = opened.conversationId;
    expect((await reply(tokens.demoSupport, id)).status).toBe(201);
    await closeWaitingJobs();
    const before = (await noticeRows(ids.demo, 'chat.case_resolved')).length;

    // First half: resolved, then the member answers before the worker runs.
    expect(
      (await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' })).status,
    ).toBe(200);
    await send(member.token, 'Ainda nao funcionou');
    await runNotificationJobs(ids.demo);
    expect((await noticeRows(ids.demo, 'chat.case_resolved')).length).toBe(before);
    expect(await pushJobsFor(ids.demo, member.id, 'chat.case_resolved')).toHaveLength(0);

    // Second half: the team answers (takes the case again), resolves, the member reopens and the team resolves
    // again before the worker runs: only the latest resolve notifies, once.
    await closeWaitingJobs();
    expect((await reply(tokens.demoSupport, id, 'Vamos olhar de novo')).status).toBe(201);
    expect(
      (await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' })).status,
    ).toBe(200);
    await send(member.token, 'Nao, continua igual');
    expect((await reply(tokens.demoSupport, id, 'Agora sim')).status).toBe(201);
    expect(
      (await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' })).status,
    ).toBe(200);
    await runNotificationJobs(ids.demo);

    const rows = (await noticeRows(ids.demo, 'chat.case_resolved')).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(member.id);
    expect(await pushJobsFor(ids.demo, member.id, 'chat.case_resolved')).toHaveLength(1);
  });
});
