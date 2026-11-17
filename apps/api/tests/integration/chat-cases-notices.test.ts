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

/** The team kinds of D-809: push only, never a bell row. */
const TEAM_KINDS = [
  'chat.case_new',
  'chat.case_reopened',
  'chat.case_assigned',
  'chat.member_message',
  'chat.support_reply',
] as const;

async function teamBellRows(tenantId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.notifications
     where tenant_id = ${tenantId}::uuid and kind = any(${[...TEAM_KINDS]}::text[])`;
  return row?.n ?? -1;
}

describe('case team notices', () => {
  let staff2: { id: string; token: string };

  beforeAll(async () => {
    const { tokens } = await caseKit();
    staff2 = await throwawayMember('team-second', 'support_tenant');
    await subscribeDevice(staff2.token, newEndpoint('staff2'));
    await subscribeDevice(tokens.demoSupport, newEndpoint('demo-support'));
    await subscribeDevice(tokens.demoAdmin, newEndpoint('demo-admin'));
  });

  /** A member with a device and a fresh case, plus the lab bystander's counters taken before anything happens. */
  async function openMemberCase(label: string) {
    const member = await throwawayMember(label);
    await subscribeDevice(member.token, newEndpoint(label));
    await closeWaitingJobs();
    const lab = labStaff as { id: string };
    const labBefore = (await pushSendJobsOf((await caseKit()).ids.lab)).length;
    const sent = await send(member.token, `Primeira mensagem (${label})`);
    return { member, id: sent.conversationId, messageId: sent.message.id, lab, labBefore };
  }

  async function labSawNothing(labBefore: number) {
    const { ids } = await caseKit();
    const lab = labStaff as { id: string };
    expect(await pushSubscriptionCount(lab.id)).toBe(1);
    expect(await pushJobsFor(ids.lab, lab.id)).toHaveLength(0);
    expect((await pushSendJobsOf(ids.lab)).length).toBe(labBefore);
  }

  it('new: the first message pushes every live staff member of the tenant, never the author and never tenant B (D-809, CASE-20, CASE-23)', async () => {
    const { ids } = await caseKit();
    const { member, id, messageId, labBefore } = await openMemberCase('new');
    const bellBefore = await teamBellRows(ids.demo);
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    const number = await caseNumberOf(id);
    const jobs = (await pushSendJobsOf(ids.demo)).filter(
      (job) => job.data.dedupeKey === `chat.case_new:${messageId}`,
    );
    expect(jobs).toHaveLength(1);
    const userIds = jobs[0]?.data.userIds ?? [];
    expect(userIds).toEqual(expect.arrayContaining([ids.demoSupport, ids.demoAdmin, staff2.id]));
    expect(userIds).not.toContain(member.id);
    expect(jobs[0]?.data.push).toMatchObject({
      title: 'tenant',
      body: `Novo chamado #${number} de Pessoa new: Primeira mensagem (new)`,
      url: `/suporte/${id}`,
      tag: id.replaceAll('-', ''),
      topic: id.replaceAll('-', ''),
      renotify: true,
    });
    // Push only: no bell row for the team (the count of staff bell rows stays where it was).
    expect(await teamBellRows(ids.demo)).toBe(bellBefore);
    // Tenant B's live staff user (with a device) got nothing, beside a non-zero demo staff count.
    expect(userIds.length).toBeGreaterThan(0);
    await labSawNothing(labBefore);
  });

  it('owner only: a member message on a case owned by live staff pushes that owner alone, while the others get none (EP-062, EP-063)', async () => {
    const { tokens, ids } = await caseKit();
    const { member, id } = await openMemberCase('owner');
    expect((await reply(tokens.demoSupport, id)).status).toBe(201);
    await closeWaitingJobs();
    const sent = await send(member.token, 'Ainda preciso de ajuda');
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    const number = await caseNumberOf(id);
    const jobs = (await pushSendJobsOf(ids.demo)).filter(
      (job) => job.data.dedupeKey === `chat.member_message:${sent.message.id}`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.userIds).toEqual([ids.demoSupport]);
    expect(jobs[0]?.data.push).toMatchObject({
      title: 'tenant',
      body: `Nova mensagem de Pessoa owner no chamado #${number}: Ainda preciso de ajuda`,
      url: `/suporte/${id}`,
    });
    // The admin and the second staff member have devices too and are NOT in the audience (the exact list above).
    expect(jobs[0]?.data.userIds).not.toContain(ids.demoAdmin);
    expect(jobs[0]?.data.userIds).not.toContain(staff2.id);
  });

  it('reopened: the member answering a resolved case pushes every live staff member as a reopened case (D-841)', async () => {
    const { tokens, ids } = await caseKit();
    const { member, id, labBefore } = await openMemberCase('reopen');
    expect((await reply(tokens.demoSupport, id)).status).toBe(201);
    expect(
      (await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' })).status,
    ).toBe(200);
    await closeWaitingJobs();
    const sent = await send(member.token, 'Voltou a falhar');
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    const number = await caseNumberOf(id);
    const jobs = (await pushSendJobsOf(ids.demo)).filter(
      (job) => job.data.dedupeKey === `chat.case_reopened:${sent.message.id}`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.userIds).toEqual(
      expect.arrayContaining([ids.demoSupport, ids.demoAdmin, staff2.id]),
    );
    expect(jobs[0]?.data.push).toMatchObject({
      body: `O chamado #${number} de Pessoa reopen foi reaberto: Voltou a falhar`,
      url: `/suporte/${id}`,
    });
    await labSawNothing(labBefore);
  });

  it('assigned: an assignment through the route pushes only the assignee; a self-assignment and the team’s own actions push nobody (D-809, D-841, EP-062)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openMemberCase('assign');
    await closeWaitingJobs();

    // Admin hands the case to the second staff member.
    expect(
      (
        await act(tokens.demoAdmin, id, 'assign', {
          expectedState: 'open',
          assigneeUserId: staff2.id,
        })
      ).status,
    ).toBe(200);
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const number = await caseNumberOf(id);
    const assigned = (await pushSendJobsOf(ids.demo)).filter(
      (job) => job.data.kind === 'chat.case_assigned' && job.data.userIds.includes(staff2.id),
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.data.userIds).toEqual([staff2.id]);
    expect(assigned[0]?.data.push).toMatchObject({
      title: 'tenant',
      body: `O chamado #${number} de Pessoa assign foi atribuído a você.`,
      url: `/suporte/${id}`,
    });

    // The admin takes the case over from the second staff member: a self-assignment notifies nobody.
    await closeWaitingJobs();
    const before = (await pushSendJobsOf(ids.demo)).length;
    expect(
      (
        await act(tokens.demoAdmin, id, 'assign', {
          expectedState: 'in_progress',
          expectedOwnerId: staff2.id,
          assigneeUserId: ids.demoAdmin,
        })
      ).status,
    ).toBe(200);
    await runNotificationJobs(ids.demo);
    expect((await pushSendJobsOf(ids.demo)).length).toBe(before);

    // The team's own Resolver, Fechar and Reabrir send the team no push (only the member's resolved notice exists).
    expect(
      (await act(tokens.demoAdmin, id, 'resolve', { expectedState: 'in_progress' })).status,
    ).toBe(200);
    expect((await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'resolved' })).status).toBe(
      200,
    );
    expect((await act(tokens.demoAdmin, id, 'close', { expectedState: 'open' })).status).toBe(200);
    await runNotificationJobs(ids.demo);
    for (const teammate of [ids.demoSupport, ids.demoAdmin, staff2.id]) {
      const jobs = (await pushSendJobsOf(ids.demo)).filter(
        (job) => job.data.userIds.includes(teammate) && job.data.dedupeKey.includes(id),
      );
      expect(jobs.map((job) => job.data.kind)).not.toContain('chat.case_resolved');
    }
    expect(await teamBellRows(ids.demo)).toBe(0);
  });

  it('answered: a staff reply is still chat.support_reply to the member alone, url /suporte (D-235)', async () => {
    const { tokens, ids } = await caseKit();
    const { member, id } = await openMemberCase('answered');
    await closeWaitingJobs();
    const res = await reply(tokens.demoSupport, id, 'Ja estamos olhando');
    expect(res.status).toBe(201);
    const messageId = ((await res.json()) as SendResult).message.id;
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const jobs = (await pushSendJobsOf(ids.demo)).filter(
      (job) => job.data.dedupeKey === `chat.support_reply:${messageId}`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.userIds).toEqual([member.id]);
    expect(jobs[0]?.data.push).toMatchObject({
      title: 'team',
      body: 'Ja estamos olhando',
      url: '/suporte',
    });
  });
});
