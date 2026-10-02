import { randomUUID } from 'node:crypto';
import type { AdminMember, AdminMemberPage } from '@rede-social/contracts/moderation';
import { sqlClient } from '@rede-social/core/db';
import { setPermissionResolver } from '@rede-social/core/server/rbac/permissions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor } from '../../src/modules/registry';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 08-04 — the Membros screen's API (ADMIN-02, MODER-02, D-330..D-333, D-340) against the live local
 * stack.
 *
 * `block tracer`: the demo admin blocks `member@rede-demo.local` through
 * `POST /v1/admin/members/{id}/block` with a reason; the membership row carries BOTH columns, ONE
 * `member_blocked` log row exists with the reason and both memberships, the member's very next request
 * answers 403 `MEMBERSHIP_BLOCKED`; the unblock reverses it with one `member_unblocked` row. Then the
 * D-332 guards (self, invited, last admin), tenant isolation (a rede-lab id is the bare 404) and the
 * permission gate (support and member get 403).
 *
 * The seeded demo member is the subject because the truths name it; `afterAll` (and every case that
 * blocks it) leaves the membership ACTIVE, and `restoreDemoMember` repairs it even after a failure, so
 * no later suite inherits a blocked seed user. The log is APPEND-ONLY: every count is a delta against
 * a snapshot taken in the same case, and `pnpm db:reset` is the clean slate.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const RUN = randomUUID().slice(0, 8);
const THROWAWAY_PASSWORD = `Membros-${RUN}-senha!`;

const tokens = { admin: '', member: '', support: '', labAdmin: '' };
const ids = { demo: '', lab: '' };
type Person = { user: string; membership: string };
const people: Record<'admin' | 'member' | 'support' | 'labMember', Person> = {
  admin: { user: '', membership: '' },
  member: { user: '', membership: '' },
  support: { user: '', membership: '' },
  labMember: { user: '', membership: '' },
};
const throwawayUsers: string[] = [];

const request = (
  path: string,
  token: string,
  init: { method?: string; body?: unknown; host?: string } = {},
) =>
  api.request(path, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': init.host ?? HOSTS.demo,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

const block = (token: string, membershipId: string, body: unknown = {}, host?: string) =>
  request(`/v1/admin/members/${membershipId}/block`, token, { method: 'POST', body, host });

const unblock = (token: string, membershipId: string, body: unknown = {}, host?: string) =>
  request(`/v1/admin/members/${membershipId}/unblock`, token, { method: 'POST', body, host });

async function envelope(res: Response): Promise<Envelope> {
  return (await res.json()) as Envelope;
}

async function list(token: string, query = '', host?: string): Promise<AdminMemberPage> {
  const res = await request(`/v1/admin/members${query}`, token, { host });
  expect(res.status, `GET /v1/admin/members${query}`).toBe(200);
  return (await res.json()) as AdminMemberPage;
}

async function person(tenantId: string, email: string): Promise<Person> {
  const [row] = await adminSql<{ user_id: string; membership_id: string }[]>`
    select u.id::text as user_id, m.id::text as membership_id
      from public.users u join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid and u.email = ${email}`;
  if (!row) throw new Error(`no membership for ${email}`);
  return { user: row.user_id, membership: row.membership_id };
}

/** A throwaway identity with a membership in `tenantId`, in the given role and status. */
async function throwaway(
  tenantId: string,
  email: string,
  role: 'member' | 'admin_tenant' | 'support_tenant',
  status: 'active' | 'invited' | 'blocked' = 'active',
  name = 'Membros Teste',
): Promise<Person> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: THROWAWAY_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  throwawayUsers.push(data.user.id);
  const [membership] = await adminSql<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status, blocked_at)
    values (${tenantId}::uuid, ${data.user.id}::uuid, ${role}, ${status},
            ${status === 'blocked' ? new Date() : null})
    returning id::text`;
  return { user: data.user.id, membership: membership?.id ?? '' };
}

type MembershipRow = { status: string; blocked_at: Date | null };
async function membershipRow(membershipId: string): Promise<MembershipRow | undefined> {
  const [row] = await adminSql<MembershipRow[]>`
    select status, blocked_at from public.memberships where id = ${membershipId}::uuid`;
  return row;
}

type LogRow = {
  id: string;
  action: string;
  reason: string | null;
  actor_membership_id: string;
  target_membership_id: string;
  target_user_id: string;
};
/** Every log row of `action` aimed at one membership, oldest first. */
async function logRows(membershipId: string, action?: string): Promise<LogRow[]> {
  return adminSql<LogRow[]>`
    select id::text, action, reason, actor_membership_id::text, target_membership_id::text,
           target_user_id::text
      from public.moderation_log
     where target_membership_id = ${membershipId}::uuid
       and (${action ?? null}::text is null or action = ${action ?? null}::text)
     order by created_at, id`;
}

/** Leaves the seeded demo member ACTIVE whatever a case did (the shared seed must never stay blocked). */
async function restoreDemoMember(): Promise<void> {
  if (!people.member.membership) return;
  await adminSql`
    update public.memberships set status = 'active', blocked_at = null
     where id = ${people.member.membership}::uuid`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';

  people.admin = await person(ids.demo, 'admin@rede-demo.local');
  people.member = await person(ids.demo, 'member@rede-demo.local');
  people.support = await person(ids.demo, 'support@rede-demo.local');
  people.labMember = await person(ids.lab, 'member@rede-lab.local');
  await restoreDemoMember();

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
});

afterAll(async () => {
  await restoreDemoMember();
  for (const userId of throwawayUsers) await authAdmin().deleteUser(userId);
  await adminSql.end();
  await sqlClient.end();
});

describe('block tracer', () => {
  it('the admin blocks the member: 200, both columns, one log row with the reason; the next request is refused', async () => {
    const reason = `Mensagens ofensivas ${RUN}`;
    const before = (await logRows(people.member.membership, 'member_blocked')).length;

    const res = await block(tokens.admin, people.member.membership, { reason: `  ${reason}  ` });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AdminMember;
    expect(body).toMatchObject({
      membershipId: people.member.membership,
      email: 'member@rede-demo.local',
      role: 'member',
      status: 'blocked',
      isViewer: false,
    });
    // D-331: the reason is never echoed in a response.
    expect(JSON.stringify(body)).not.toContain(reason);

    const row = await membershipRow(people.member.membership);
    expect(row?.status).toBe('blocked');
    expect(row?.blocked_at).not.toBeNull();

    const rows = await logRows(people.member.membership, 'member_blocked');
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({
      reason,
      actor_membership_id: people.admin.membership,
      target_membership_id: people.member.membership,
      target_user_id: people.member.user,
    });

    // MODER-02 "revoked immediately": the member's very next request.
    const next = await request('/v1/me/bootstrap', tokens.member);
    expect(next.status).toBe(403);
    expect((await envelope(next)).error.code).toBe('MEMBERSHIP_BLOCKED');
  });

  it('blocking again is idempotent: 200 with the current state and no second log row', async () => {
    const before = (await logRows(people.member.membership)).length;
    const res = await block(tokens.admin, people.member.membership, { reason: 'de novo' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminMember).status).toBe('blocked');
    expect(await logRows(people.member.membership)).toHaveLength(before);
  });

  it('the list shows the blocked member to the admin under Todos and Bloqueados', async () => {
    const all = await list(tokens.admin, `?q=${encodeURIComponent('member@rede-demo')}`);
    expect(all.items.find((m) => m.membershipId === people.member.membership)?.status).toBe(
      'blocked',
    );
    const blocked = await list(tokens.admin, '?status=blocked&limit=50');
    expect(blocked.items.map((m) => m.membershipId)).toContain(people.member.membership);
    expect(blocked.items.every((m) => m.status === 'blocked')).toBe(true);
  });

  it('the admin unblocks: 200, both columns cleared, one member_unblocked row, the member is back', async () => {
    const before = (await logRows(people.member.membership, 'member_unblocked')).length;
    const res = await unblock(tokens.admin, people.member.membership, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminMember).status).toBe('active');

    const row = await membershipRow(people.member.membership);
    expect(row?.status).toBe('active');
    expect(row?.blocked_at).toBeNull();
    const rows = await logRows(people.member.membership, 'member_unblocked');
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]?.reason).toBeNull();

    const next = await request('/v1/me/bootstrap', tokens.member);
    expect(next.status).toBe(200);

    // Unblocking an active membership is a no-op: 200, no row.
    const again = await unblock(tokens.admin, people.member.membership);
    expect(again.status).toBe(200);
    expect(await logRows(people.member.membership, 'member_unblocked')).toHaveLength(before + 1);
  });

  it('blocking yourself answers 409 self and writes nothing', async () => {
    const before = (await logRows(people.admin.membership)).length;
    const res = await block(tokens.admin, people.admin.membership);
    expect(res.status).toBe(409);
    expect((await envelope(res)).error.details).toEqual({ member: 'self' });
    expect((await membershipRow(people.admin.membership))?.status).toBe('active');
    expect(await logRows(people.admin.membership)).toHaveLength(before);
  });

  it('blocking or unblocking an invited membership answers 409 not_active', async () => {
    const invited = await throwaway(
      ids.demo,
      `convidado-${RUN}@rede-demo.local`,
      'admin_tenant',
      'invited',
      '',
    );
    for (const call of [block, unblock]) {
      const res = await call(tokens.admin, invited.membership);
      expect(res.status).toBe(409);
      expect((await envelope(res)).error.details).toEqual({ member: 'not_active' });
    }
    expect((await membershipRow(invited.membership))?.status).toBe('invited');
    expect(await logRows(invited.membership)).toHaveLength(0);

    // The list shows it to the admin, with no profile name: the e-mail is the only identifier.
    const page = await list(tokens.admin, '?status=invited&limit=50');
    const row = page.items.find((m) => m.membershipId === invited.membership);
    expect(row).toMatchObject({ status: 'invited', displayName: null, role: 'admin_tenant' });
  });

  it('blocking the only active admin answers 409 last_admin (reachable once a non-admin holds moderation.manage)', async () => {
    // With the actor itself an active admin, the set always holds two admins. D-338's future grant to
    // support is simulated by overriding the resolver (last registration wins; restored in finally).
    setPermissionResolver((role, enabled, settings) => {
      const granted = permissionsFor(role, enabled, settings);
      return role === 'support_tenant' ? [...granted, 'moderation.manage'] : granted;
    });
    try {
      const res = await block(tokens.support, people.admin.membership);
      expect(res.status).toBe(409);
      expect((await envelope(res)).error.details).toEqual({ member: 'last_admin' });
      expect((await membershipRow(people.admin.membership))?.status).toBe('active');
    } finally {
      setPermissionResolver(permissionsFor);
    }
  });

  it('a rede-lab membership id is the bare 404 for a rede-demo admin, on every route', async () => {
    for (const res of [
      await block(tokens.admin, people.labMember.membership),
      await unblock(tokens.admin, people.labMember.membership),
      await request(`/v1/admin/members/${people.labMember.membership}`, tokens.admin),
      await block(tokens.admin, randomUUID()),
    ]) {
      expect(res.status).toBe(404);
      const body = await envelope(res);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
    }
    expect((await membershipRow(people.labMember.membership))?.status).toBe('active');
  });

  it('support and member get 403 on the list, the read and both writes', async () => {
    for (const token of [tokens.support, tokens.member]) {
      for (const res of [
        await request('/v1/admin/members', token),
        await request(`/v1/admin/members/${people.member.membership}`, token),
        await block(token, people.member.membership),
        await unblock(token, people.member.membership),
      ]) {
        expect(res.status).toBe(403);
        expect((await envelope(res)).error.code).toBe('FORBIDDEN');
      }
    }
    expect((await membershipRow(people.member.membership))?.status).toBe('active');
  });

  it('the single read answers the sheet row, isViewer on the own membership', async () => {
    const res = await request(`/v1/admin/members/${people.admin.membership}`, tokens.admin);
    expect(res.status).toBe(200);
    expect((await res.json()) as AdminMember).toMatchObject({
      membershipId: people.admin.membership,
      role: 'admin_tenant',
      status: 'active',
      isViewer: true,
    });
  });

  it('a reason over 500 code units and an unknown body key are 400', async () => {
    const long = await block(tokens.admin, people.member.membership, { reason: 'x'.repeat(501) });
    expect(long.status).toBe(400);
    const extra = await block(tokens.admin, people.member.membership, { tenantId: ids.lab });
    expect(extra.status).toBe(400);
    expect((await membershipRow(people.member.membership))?.status).toBe('active');
  });
});
