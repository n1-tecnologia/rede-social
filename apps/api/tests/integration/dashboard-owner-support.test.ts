import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type OwnerSupportReady,
  ownerSupportAnswerSchema,
  SUPPORT_WEEKS,
} from '@rede-social/module-dashboard/contracts';
import { runSnapshotBuild } from '@rede-social/module-dashboard/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertSupportMessageAt,
  insertSupportThreadAt,
  localInstantOf,
  rebuildDashboard,
  removeDashboardFixtures,
  removeSupportThreads,
  tenantIdOf,
} from './dashboard-fixture';
import { adminSql, api, createSharedIdentity, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 08.7 — the owner's Atendimento on real data (08.7-11, D-455, D-460, D-465, INSIGHT-13,
 * EP-42, EP-43). rede-lab ships with `chat` off, so the suite turns it ON for its own reads and puts
 * the previous value back afterwards. Two crafted support threads of two fixture members:
 *  - A, created at D-2 09:00: the member writes at 10:00 (with a unique body), the fixture staff
 *    member answers at 10:30 — one turn of 30 minutes in the last week;
 *  - B, created 26 hours and 5 minutes before the build: the member's message nobody answered — the
 *    queue at build time, its oldest wait 26 whole hours.
 * The staff member's name is stored with odd spacing and accents, and must travel exactly as stored.
 */

const PREFIX = `dash87s-${Date.now()}`;
const SUPPORT = '/v1/dashboard/owner/support';
const STAFF_NAME = ' Júlia  da Equipe 0811 ';
const UNIQUE_BODY = `Corpo único do atendimento ${PREFIX}`;
const MEMBER_A_NAME = `Membro A ${PREFIX}`;
const MEMBER_B_NAME = `Membro B ${PREFIX}`;

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
const users = { staff: '', a: '', b: '' };
let memberIds: string[] = [];
let restoreLabChat: () => Promise<void> = async () => {};

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

async function supportOf(
  token: string,
  host: string,
): Promise<{ raw: string; body: OwnerSupportReady }> {
  const res = await request(SUPPORT, token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const raw = await res.text();
  const body = ownerSupportAnswerSchema.parse(JSON.parse(raw));
  if (body.state !== 'ready') throw new Error('expected a ready support answer');
  return { raw, body };
}

/** Sets rede-lab's `chat` flag and answers the function that puts the previous row back. */
async function setLabChat(enabled: boolean): Promise<() => Promise<void>> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenants.lab}::uuid and module_key = 'chat'`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenants.lab}::uuid, 'chat', ${enabled})
    on conflict (tenant_id, module_key) do update set enabled = ${enabled}, updated_at = now()`;
  moduleFlags.invalidate(tenants.lab);
  return async () => {
    if (previous) {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenants.lab}::uuid, 'chat', ${previous.enabled})
        on conflict (tenant_id, module_key)
        do update set enabled = ${previous.enabled}, updated_at = now()`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenants.lab}::uuid and module_key = 'chat'`;
    }
    moduleFlags.invalidate(tenants.lab);
  };
}

/** `day` (an ISO date) minus `k` days. */
function dayMinus(day: string, k: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - k);
  return at.toISOString().slice(0, 10);
}

/** The lab's moderation numbers of the build's Window30, as SQL counts them (seed rows included). */
async function labModeration(day: string) {
  const [row] = await adminSql<
    { removed: number; blocks: number; unblocks: number; comments: number }[]
  >`
    with b as (
      select ((${day}::date - 29)::timestamp at time zone t.timezone) as from_at,
             ((${day}::date + 1)::timestamp at time zone t.timezone) as until_at
        from public.tenants t where t.id = ${tenants.lab}::uuid
    )
    select
      (select count(*) from public.moderation_log ml, b where ml.tenant_id = ${tenants.lab}::uuid
          and ml.action = 'comment_removed' and ml.created_at >= b.from_at and ml.created_at < b.until_at)::int as removed,
      (select count(*) from public.moderation_log ml, b where ml.tenant_id = ${tenants.lab}::uuid
          and ml.action = 'member_blocked' and ml.created_at >= b.from_at and ml.created_at < b.until_at)::int as blocks,
      (select count(*) from public.moderation_log ml, b where ml.tenant_id = ${tenants.lab}::uuid
          and ml.action = 'member_unblocked' and ml.created_at >= b.from_at and ml.created_at < b.until_at)::int as unblocks,
      (select count(*) from public.feed_comments fc, b where fc.tenant_id = ${tenants.lab}::uuid
          and fc.deleted_at is null and fc.created_at >= b.from_at and fc.created_at < b.until_at)::int as comments`;
  if (!row) throw new Error('no moderation counts');
  return {
    removedComments: row.removed,
    blocks: row.blocks,
    unblocks: row.unblocks,
    comments30: row.comments,
  };
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  restoreLabChat = await setLabChat(true);

  users.staff = (
    await createSharedIdentity({
      prefix: `${PREFIX}-staff`,
      memberships: [{ host: 'lab', role: 'support_tenant', displayName: STAFF_NAME }],
    })
  ).userId;
  users.a = (
    await createSharedIdentity({
      prefix: `${PREFIX}-a`,
      memberships: [{ host: 'lab', displayName: MEMBER_A_NAME }],
    })
  ).userId;
  users.b = (
    await createSharedIdentity({
      prefix: `${PREFIX}-b`,
      memberships: [{ host: 'lab', displayName: MEMBER_B_NAME }],
    })
  ).userId;
  memberIds = (
    await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where user_id in (${users.a}::uuid, ${users.b}::uuid)`
  ).map((row) => row.id);
});

afterAll(async () => {
  await removeSupportThreads([users.a, users.b].filter(Boolean));
  await removeDashboardFixtures(PREFIX);
  await restoreLabChat();
});

describe('08.7 support', () => {
  it('EP-42: with chat on and no support conversation, the answer is no queue, eight null medians, eight zero weeks, no team and moderation as values', async () => {
    const [threads] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where tenant_id = ${tenants.lab}::uuid and kind = 'support'`;
    expect(threads?.n).toBe(0);
    // An old day keeps the seed's recent comments out of the window: every number is a zero.
    const day = dayMinus(await dashboardDay(tenants.lab), 120);
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
    expect(await runSnapshotBuild({ tenantId: tenants.lab, day })).toBe('built');

    const { body } = await supportOf(tokens.labAdmin, HOSTS.lab);
    expect(body.snapshot.day).toBe(day);
    expect(body.awaiting).toEqual({ count: 0, oldestHours: null });
    expect(body.weeklyMedianMinutes).toEqual(Array(SUPPORT_WEEKS).fill(null));
    expect(body.weeklyConversations).toEqual(Array(SUPPORT_WEEKS).fill(0));
    expect(body.answeredByStaff).toEqual([]);
    expect(body.moderation).toEqual(await labModeration(day));
    expect(body.moderation).toEqual({ removedComments: 0, blocks: 0, unblocks: 0, comments30: 0 });
    expect(body.bySubject).toEqual({ measured: false, reason: 'needs_support_subject' });
  });

  it('INSIGHT-13 / EP-43: one answered thread and one waiting 26 hours give the queue, the last week’s median 30, the team with its live name, and no word of any conversation', async () => {
    const day = await dashboardDay(tenants.lab);
    const threadA = await insertSupportThreadAt({
      tenantId: tenants.lab,
      memberUserId: users.a,
      createdAt: await localInstantOf(tenants.lab, 2, '09:00'),
    });
    await insertSupportMessageAt({
      tenantId: tenants.lab,
      conversationId: threadA,
      authorUserId: users.a,
      side: 'member',
      body: UNIQUE_BODY,
      k: 2,
      localTime: '10:00',
    });
    await insertSupportMessageAt({
      tenantId: tenants.lab,
      conversationId: threadA,
      authorUserId: users.staff,
      side: 'staff',
      body: `Resposta ${UNIQUE_BODY}`,
      k: 2,
      localTime: '10:30',
    });
    const [waitingSince] = await adminSql<{ at: string }[]>`
      select to_char((now() - interval '26 hours 5 minutes') at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`;
    if (!waitingSince) throw new Error('no instant');
    const threadB = await insertSupportThreadAt({
      tenantId: tenants.lab,
      memberUserId: users.b,
      createdAt: waitingSince.at,
    });
    await insertSupportMessageAt({
      tenantId: tenants.lab,
      conversationId: threadB,
      authorUserId: users.b,
      side: 'member',
      body: UNIQUE_BODY,
      at: waitingSince.at,
    });
    expect(await rebuildDashboard(tenants.lab)).toBe('built');

    const { raw, body } = await supportOf(tokens.labAdmin, HOSTS.lab);
    expect(body.snapshot.day).toBe(day);
    expect(body.awaiting).toEqual({ count: 1, oldestHours: 26 });
    expect(body.weeklyMedianMinutes).toEqual([null, null, null, null, null, null, null, 30]);
    expect(body.weeklyConversations).toEqual([0, 0, 0, 0, 0, 0, 0, 2]);
    expect(body.answeredByStaff).toEqual([
      { userId: users.staff, name: STAFF_NAME, conversations: 1 },
    ]);
    expect(body.moderation).toEqual(await labModeration(day));
    expect(body.bySubject).toEqual({ measured: false, reason: 'needs_support_subject' });
    // EP-43: no message text, no member name, no member id — only the staff member's own identity.
    for (const leak of [
      UNIQUE_BODY,
      MEMBER_A_NAME,
      MEMBER_B_NAME,
      users.a,
      users.b,
      threadA,
      threadB,
      ...memberIds,
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it('preparing before the first build of the tenant', async () => {
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
    const res = await request(SUPPORT, tokens.labAdmin, HOSTS.lab);
    expect(res.status).toBe(200);
    expect(ownerSupportAnswerSchema.parse(await res.json())).toEqual({ state: 'preparing' });
  });

  it('D-460: with chat off the area is 404 MODULE_DISABLED for every session, before the role check', async () => {
    const restore = await setLabChat(false);
    try {
      const admin = await request(SUPPORT, tokens.labAdmin, HOSTS.lab);
      expect(admin.status).toBe(404);
      expect(await codeOf(admin)).toBe('MODULE_DISABLED');
    } finally {
      await restore();
    }
  });

  it('T-08.7-02: with chat on, the support team and members get 403 FORBIDDEN, and no session 401', async () => {
    for (const token of [tokens.demoSupport, tokens.demoMember]) {
      const res = await request(SUPPORT, token, HOSTS.demo);
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe('FORBIDDEN');
    }
    const anonymous = await request(SUPPORT, undefined, HOSTS.demo);
    expect(anonymous.status).toBe(401);
  });
});
