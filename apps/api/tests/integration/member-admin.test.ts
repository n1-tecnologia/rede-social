import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { PLATFORM_TERMS_VERSION } from '@rede-social/contracts';
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

/** Leaves the seeded demo admin ACTIVE whatever a concurrency case did. */
async function restoreDemoAdmin(): Promise<void> {
  if (!people.admin.membership) return;
  await adminSql`
    update public.memberships set status = 'active', blocked_at = null
     where id = ${people.admin.membership}::uuid`;
}

/** Rows a throwaway left behind that would keep `deleteUser` from cascading cleanly. */
async function removeThrowawayRows(userId: string): Promise<void> {
  await adminSql`delete from public.chat_messages where author_user_id = ${userId}::uuid`;
  await adminSql`delete from public.chat_conversations where created_by_user_id = ${userId}::uuid`;
  await adminSql`delete from public.push_subscriptions where user_id = ${userId}::uuid`;
  await adminSql`delete from public.notifications where user_id = ${userId}::uuid`;
}

afterAll(async () => {
  await restoreDemoMember();
  await restoreDemoAdmin();
  await adminSql`delete from public.feed_posts where caption like ${`Membros 08-04 ${RUN}%`}`;
  // Fan-out jobs the comment and the support message queued are closed, not run (the chat precedent).
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'`;
  for (const userId of throwawayUsers) {
    await removeThrowawayRows(userId);
    await authAdmin().deleteUser(userId);
  }
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

/** Walks every page of the list at `limit`, guarding against a runaway loop. */
async function walk(
  token: string,
  limit: number,
  query: Record<string, string> = {},
  host?: string,
): Promise<AdminMember[]> {
  const seen: AdminMember[] = [];
  let cursor: string | null = null;
  for (let hops = 0; hops < 500; hops += 1) {
    const search = new URLSearchParams({ ...query, limit: String(limit) });
    if (cursor) search.set('cursor', cursor);
    const next = await list(token, `?${search.toString()}`, host);
    expect(next.items.length).toBeLessThanOrEqual(limit);
    seen.push(...next.items);
    cursor = next.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error('the walk did not terminate');
}

/** The table's own order for one tenant: the ground truth a walk must reproduce (ADMIN-02 ordering). */
async function listSnapshot(tenantId: string): Promise<string[]> {
  const rows = await adminSql<{ id: string }[]>`
    select m.id::text
      from public.memberships m
      join public.users u on u.id = m.user_id
      left join public.member_profiles mp on mp.membership_id = m.id
     where m.tenant_id = ${tenantId}::uuid and m.deleted_at is null
     order by app.imm_unaccent(lower(coalesce(nullif(mp.display_name, ''), u.email))),
              lower(u.email), m.id`;
  return rows.map((row) => row.id);
}

describe('admin list', () => {
  const fixtures = {
    twinA: { user: '', membership: '' },
    twinB: { user: '', membership: '' },
    accented: { user: '', membership: '' },
    percent: { user: '', membership: '' },
    nameless: { user: '', membership: '' },
    blocked: { user: '', membership: '' },
    legacy: { user: '', membership: '' },
    invited: { user: '', membership: '' },
  };

  beforeAll(async () => {
    const twin = `Ana Souza ${RUN}`;
    fixtures.twinA = await throwaway(
      ids.demo,
      `twin-a-${RUN}@rede-demo.local`,
      'member',
      'active',
      twin,
    );
    fixtures.twinB = await throwaway(
      ids.demo,
      `twin-b-${RUN}@rede-demo.local`,
      'member',
      'active',
      twin,
    );
    fixtures.accented = await throwaway(
      ids.demo,
      `acento-${RUN}@rede-demo.local`,
      'member',
      'active',
      `Árvore Conceição ${RUN}`,
    );
    fixtures.percent = await throwaway(
      ids.demo,
      `percent-${RUN}@rede-demo.local`,
      'member',
      'active',
      `Cem 100% Real ${RUN}`,
    );
    fixtures.nameless = await throwaway(
      ids.demo,
      `mmm-${RUN}@rede-demo.local`,
      'member',
      'active',
      '',
    );
    fixtures.blocked = await throwaway(
      ids.demo,
      `bloqueado-${RUN}@rede-demo.local`,
      'member',
      'blocked',
      `Bloqueado ${RUN}`,
    );
    fixtures.legacy = await throwaway(
      ids.demo,
      `legado-${RUN}@rede-demo.local`,
      'member',
      'active',
      `Legado ${RUN}`,
    );
    // A legacy row: `status` still active, only `blocked_at` set. Every reader must call it blocked.
    await adminSql`
      update public.memberships set blocked_at = now() where id = ${fixtures.legacy.membership}::uuid`;
    fixtures.invited = await throwaway(
      ids.demo,
      `convite-${RUN}@rede-demo.local`,
      'admin_tenant',
      'invited',
      '',
    );
  });

  it('lists every membership — active, staff, blocked (incl. blocked_at-only) and invited — with its folded status', async () => {
    const all = await walk(tokens.admin, 50);
    const byId = new Map(all.map((member) => [member.membershipId, member]));
    expect(byId.get(people.admin.membership)).toMatchObject({
      role: 'admin_tenant',
      isViewer: true,
    });
    expect(byId.get(people.support.membership)?.role).toBe('support_tenant');
    expect(byId.get(fixtures.blocked.membership)?.status).toBe('blocked');
    expect(byId.get(fixtures.legacy.membership)?.status).toBe('blocked');
    expect(byId.get(fixtures.invited.membership)).toMatchObject({
      status: 'invited',
      displayName: null,
    });
    expect(byId.get(fixtures.nameless.membership)?.displayName).toBeNull();
    expect(all.filter((member) => member.isViewer)).toHaveLength(1);
    expect(all.map((member) => member.membershipId)).toEqual(await listSnapshot(ids.demo));
  });

  it('status filters are disjoint and the legacy blocked_at row is blocked, never active', async () => {
    const active = (await walk(tokens.admin, 50, { status: 'active' })).map((m) => m.membershipId);
    const blocked = (await walk(tokens.admin, 50, { status: 'blocked' })).map(
      (m) => m.membershipId,
    );
    const invited = (await walk(tokens.admin, 50, { status: 'invited' })).map(
      (m) => m.membershipId,
    );
    expect(blocked).toEqual(
      expect.arrayContaining([fixtures.blocked.membership, fixtures.legacy.membership]),
    );
    expect(active).not.toContain(fixtures.legacy.membership);
    expect(active).toContain(people.admin.membership);
    expect(invited).toEqual(expect.arrayContaining([fixtures.invited.membership]));
    const all = await walk(tokens.admin, 50);
    expect(active.length + blocked.length + invited.length).toBe(all.length);
    expect(new Set([...active, ...blocked, ...invited]).size).toBe(all.length);
  });

  it('q matches the name accent- and case-insensitively, or the e-mail', async () => {
    const byName = await list(tokens.admin, `?q=${encodeURIComponent(`arvore CONCEICAO ${RUN}`)}`);
    expect(byName.items.map((m) => m.membershipId)).toEqual([fixtures.accented.membership]);
    const byEmail = await list(tokens.admin, `?q=${encodeURIComponent(`ACENTO-${RUN}@`)}`);
    expect(byEmail.items.map((m) => m.membershipId)).toEqual([fixtures.accented.membership]);
    // The nameless membership is found by its e-mail (an invited admin's only identifier).
    const nameless = await list(tokens.admin, `?q=${encodeURIComponent(`convite-${RUN}`)}`);
    expect(nameless.items.map((m) => m.membershipId)).toEqual([fixtures.invited.membership]);
  });

  it('a % in q is a literal percent sign, not a wildcard', async () => {
    const page = await list(tokens.admin, `?q=${encodeURIComponent('%')}&limit=50`);
    expect(page.items.map((m) => m.membershipId)).toContain(fixtures.percent.membership);
    for (const member of page.items) {
      expect(`${member.displayName ?? ''} ${member.email}`).toContain('%');
    }
    const underscore = await list(tokens.admin, `?q=${encodeURIComponent(`_${RUN}`)}&limit=50`);
    for (const member of underscore.items) {
      expect(`${member.displayName ?? ''} ${member.email}`).toContain(`_${RUN}`);
    }
  });

  it('an empty or spaces-only q is no filter', async () => {
    const plain = await list(tokens.admin, '?limit=50');
    const spaces = await list(tokens.admin, `?q=${encodeURIComponent('    ')}&limit=50`);
    const empty = await list(tokens.admin, '?q=&limit=50');
    expect(spaces.items.map((m) => m.membershipId)).toEqual(plain.items.map((m) => m.membershipId));
    expect(empty.items.map((m) => m.membershipId)).toEqual(plain.items.map((m) => m.membershipId));
  });

  it('a q with no match is { items: [], nextCursor: null }', async () => {
    expect(await list(tokens.admin, `?q=${encodeURIComponent(`ninguem-${RUN}-zzz`)}`)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('ordering: two identical names in a stable order; a limit=1 walk visits each membership exactly once', async () => {
    const walked = (await walk(tokens.admin, 1)).map((member) => member.membershipId);
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toEqual(await listSnapshot(ids.demo));

    const twins = [fixtures.twinA.membership, fixtures.twinB.membership];
    const positions = twins.map((id) => walked.indexOf(id));
    // Adjacent, and ordered by the e-mail tiebreaker (twin-a before twin-b).
    expect(positions[1]).toBe((positions[0] ?? -2) + 1);
    // A second walk at a different page size gives the very same order.
    expect((await walk(tokens.admin, 3)).map((m) => m.membershipId)).toEqual(walked);
  });

  it('a membership without a profile name sorts by its e-mail', async () => {
    const walked = (await walk(tokens.admin, 50)).map((member) => member.membershipId);
    // "mmm-<run>@…" sorts after the seeded "Membro Rede Demo" ("membro …" < "mmm-…").
    expect(walked.indexOf(fixtures.nameless.membership)).toBeGreaterThan(
      walked.indexOf(people.member.membership),
    );
  });

  it('a tampered cursor answers page 1', async () => {
    const first = await list(tokens.admin, '?limit=2');
    const tampered = await list(tokens.admin, '?limit=2&cursor=bm90LWEtY3Vyc29y');
    expect(tampered.items.map((m) => m.membershipId)).toEqual(
      first.items.map((m) => m.membershipId),
    );
  });

  it('support and member get 403 on the list with any query', async () => {
    for (const token of [tokens.support, tokens.member]) {
      const res = await request('/v1/admin/members?status=blocked&q=a', token);
      expect(res.status).toBe(403);
      expect((await envelope(res)).error.code).toBe('FORBIDDEN');
    }
  });

  it('a rede-lab admin never sees a rede-demo row; a rede-demo session on the lab host is 403 TENANT_HOST_MISMATCH', async () => {
    const lab = await walk(tokens.labAdmin, 50, {}, HOSTS.lab);
    const demoIds = new Set(await listSnapshot(ids.demo));
    expect(lab.length).toBeGreaterThan(0);
    expect(lab.some((member) => demoIds.has(member.membershipId))).toBe(false);
    expect(lab.map((member) => member.membershipId)).toEqual(await listSnapshot(ids.lab));

    const res = await request('/v1/admin/members', tokens.admin, { host: HOSTS.lab });
    expect(res.status).toBe(403);
    expect((await envelope(res)).error.code).toBe('TENANT_HOST_MISMATCH');
  });
});

/* ── Task 3: what a block DOES (and does not do), and what concurrent admins get ───────────────── */

/** A throwaway identity with a session (its own token) — `throwaway` plus a GoTrue sign-in. */
async function throwawaySession(
  label: string,
  role: 'member' | 'admin_tenant' = 'member',
  name = `Pessoa ${label} ${RUN}`,
): Promise<Person & { email: string; token: string }> {
  const email = `${label}-${RUN}@rede-demo.local`;
  const created = await throwaway(ids.demo, email, role, 'active', name);
  return { ...created, email, token: await signInAs(email, THROWAWAY_PASSWORD) };
}

function deviceKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

async function pushDevicesOf(userId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.push_subscriptions
     where tenant_id = ${ids.demo}::uuid and user_id = ${userId}::uuid`;
  return row?.n ?? 0;
}

async function dbNow(): Promise<string> {
  const [row] = await adminSql<{ now: string }[]>`select now()::text as now`;
  return row?.now ?? '';
}

describe('block effects', () => {
  const REASON = `Motivo-unico-${RUN}-nunca-visivel`;
  let subject: Person & { email: string; token: string };
  let postId = '';
  let commentId = '';
  let conversationId = '';

  beforeAll(async () => {
    subject = await throwawaySession('efeitos');

    // Two push devices (the 07-06 registration route, as the browser would).
    for (const n of [1, 2]) {
      const res = await request('/v1/notifications/push-subscriptions', subject.token, {
        method: 'POST',
        body: {
          endpoint: `https://push.fake.test/08-04/${RUN}/${n}`,
          keys: deviceKeys(),
          userAgent: 'vitest',
        },
      });
      expect(res.status, 'push device registered').toBeLessThan(300);
    }
    expect(await pushDevicesOf(subject.user)).toBe(2);

    // A post by the admin, a comment by the subject (D-330 evidence).
    const post = await request('/v1/feed/posts', tokens.admin, {
      method: 'POST',
      body: { caption: `Membros 08-04 ${RUN} post` },
    });
    expect(post.status).toBe(201);
    postId = ((await post.json()) as { id: string }).id;
    const comment = await request(`/v1/feed/posts/${postId}/comments`, subject.token, {
      method: 'POST',
      body: { body: `Comentario do bloqueado ${RUN}` },
    });
    expect(comment.status).toBe(201);
    commentId = ((await comment.json()) as { id: string }).id;

    // The subject's support thread (D-333 evidence).
    const support = await request('/v1/chat/support/messages', subject.token, {
      method: 'POST',
      body: { body: `Oi, sou o bloqueado ${RUN}.` },
    });
    expect(support.status).toBe(201);
    conversationId = ((await support.json()) as { conversationId: string }).conversationId;
  });

  it('a block deletes the member’s push devices and nudges their user topic, ids only', async () => {
    const since = await dbNow();
    const res = await block(tokens.admin, subject.membership, { reason: REASON });
    expect(res.status).toBe(200);

    expect(await pushDevicesOf(subject.user)).toBe(0);
    const signals = await adminSql<{ event: string; payload: Record<string, unknown> }[]>`
      select event, payload from realtime.messages
       where topic = ${`tenant:${ids.demo}:user:${subject.user}`}
         and inserted_at >= ${since}::timestamptz`;
    expect(signals.map((signal) => signal.event)).toContain('notifications.changed');
    for (const signal of signals) expect(JSON.stringify(signal.payload)).not.toContain(REASON);
  });

  it('D-330: the blocked member’s comment is still listed on its post, for everyone', async () => {
    for (const token of [tokens.admin, tokens.member]) {
      const res = await request(`/v1/feed/posts/${postId}/comments`, token);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(commentId);
      expect(text).toContain(`Comentario do bloqueado ${RUN}`);
    }
    const [row] = await adminSql<{ deleted_at: Date | null }[]>`
      select deleted_at from public.feed_comments where id = ${commentId}::uuid`;
    expect(row?.deleted_at).toBeNull();
  });

  it('D-331: no member-facing response carries the reason', async () => {
    const bodies: string[] = [];
    // The blocked member's own refusal.
    const bootstrap = await request('/v1/me/bootstrap', subject.token);
    expect(bootstrap.status).toBe(403);
    bodies.push(await bootstrap.text());
    // Another member's reads: the post's comments, the directory, the profile route.
    for (const path of [
      `/v1/feed/posts/${postId}/comments`,
      '/v1/members?limit=50',
      `/v1/members/${subject.membership}`,
      '/v1/me/bootstrap',
    ]) {
      bodies.push(await (await request(path, tokens.member)).text());
    }
    // The admin's own member read (sheet) does not carry it either: it lives only in the log.
    bodies.push(
      await (await request(`/v1/admin/members/${subject.membership}`, tokens.admin)).text(),
    );
    for (const body of bodies) expect(body).not.toContain(REASON);

    const [logged] = await adminSql<{ reason: string | null }[]>`
      select reason from public.moderation_log
       where target_membership_id = ${subject.membership}::uuid and action = 'member_blocked'`;
    expect(logged?.reason).toBe(REASON);
  });

  it('MODER-02: the blocked member cannot re-register with the same e-mail', async () => {
    const [tenant] = await adminSql<{ rules_version: number }[]>`
      select rules_version from public.tenants where id = ${ids.demo}::uuid`;
    const res = await api.request('/v1/public/signup/rede-demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
      body: JSON.stringify({
        name: 'Outra Conta',
        email: subject.email,
        password: 'Segredo123',
        consents: {
          tenantRulesVersion: tenant?.rules_version ?? 1,
          platformTermsVersion: PLATFORM_TERMS_VERSION,
        },
      }),
    });
    expect(res.status).toBe(409);
    expect((await envelope(res)).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('D-333: staff still read the thread; a reply is 409 member_blocked while blocked, 201 after unblock', async () => {
    const read = await request(`/v1/chat/conversations/${conversationId}/messages`, tokens.support);
    expect(read.status).toBe(200);
    const blocked = await request(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.support,
      {
        method: 'POST',
        body: { body: 'Oi?' },
      },
    );
    expect(blocked.status).toBe(409);
    expect((await envelope(blocked)).error.details).toEqual({ chat: 'member_blocked' });

    expect((await unblock(tokens.admin, subject.membership)).status).toBe(200);
    const reply = await request(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.support,
      {
        method: 'POST',
        body: { body: 'Estamos de volta.' },
      },
    );
    expect(reply.status).toBe(201);
    // Unblocking restores access exactly as it was (and adds no devices back).
    expect((await request('/v1/me/bootstrap', subject.token)).status).toBe(200);
  });
});

describe('block concurrency', () => {
  let secondAdmin: Person & { email: string; token: string };

  beforeAll(async () => {
    // A second ACTIVE admin, promoted through the admin SQL lane: the demo tenant now has exactly two.
    secondAdmin = await throwawaySession('admin2', 'admin_tenant');
  });

  it('two concurrent blocks of one member: both 200, exactly one member_blocked row', async () => {
    const target = await throwawaySession('alvo-duplo');
    const [a, b] = await Promise.all([
      block(tokens.admin, target.membership),
      block(secondAdmin.token, target.membership),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(((await a.json()) as AdminMember).status).toBe('blocked');
    expect(((await b.json()) as AdminMember).status).toBe('blocked');
    expect(await logRows(target.membership, 'member_blocked')).toHaveLength(1);
  });

  it('a concurrent block and unblock end consistent, with one row per real transition', async () => {
    const target = await throwawaySession('alvo-misto');
    const [a, b] = await Promise.all([
      block(tokens.admin, target.membership),
      unblock(secondAdmin.token, target.membership),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const final = await membershipRow(target.membership);
    const blockedRows = await logRows(target.membership, 'member_blocked');
    const unblockedRows = await logRows(target.membership, 'member_unblocked');
    // The block is always a real transition (the target starts active); the unblock is one only
    // when it ran AFTER the block.
    expect(blockedRows).toHaveLength(1);
    if (final?.status === 'blocked') {
      expect(final.blocked_at).not.toBeNull();
      expect(unblockedRows).toHaveLength(0);
    } else {
      expect(final).toMatchObject({ status: 'active', blocked_at: null });
      expect(unblockedRows).toHaveLength(1);
    }
  });

  it('mutual blocks of the only two admins: one 200, one 409 last_admin, one active admin remains', async () => {
    const before =
      (await logRows(secondAdmin.membership, 'member_blocked')).length +
      (await logRows(people.admin.membership, 'member_blocked')).length;
    try {
      const [a, b] = await Promise.all([
        block(tokens.admin, secondAdmin.membership),
        block(secondAdmin.token, people.admin.membership),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const refused = a.status === 409 ? a : b;
      expect((await envelope(refused)).error.details).toEqual({ member: 'last_admin' });

      const [active] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.memberships
         where tenant_id = ${ids.demo}::uuid and role = 'admin_tenant' and status = 'active'
           and blocked_at is null and deleted_at is null`;
      expect(active?.n).toBe(1);
      const written = [
        ...(await logRows(secondAdmin.membership, 'member_blocked')),
        ...(await logRows(people.admin.membership, 'member_blocked')),
      ];
      expect(written).toHaveLength(before + 1);
    } finally {
      await restoreDemoAdmin();
      await adminSql`
        update public.memberships set status = 'active', blocked_at = null
         where id = ${secondAdmin.membership}::uuid`;
    }
  });
});

/* ── 08-05: the role change ──────────────────────────────────────────────────────────────────── */

const setRole = (token: string, membershipId: string, body: unknown, host?: string) =>
  request(`/v1/admin/members/${membershipId}/role`, token, { method: 'PUT', body, host });

type RoleLogRow = { details: { from: string; to: string } | null; actor_membership_id: string };
/** Every `role_changed` row aimed at one membership, oldest first, with its details. */
async function roleRows(membershipId: string): Promise<RoleLogRow[]> {
  return adminSql<RoleLogRow[]>`
    select details, actor_membership_id::text
      from public.moderation_log
     where target_membership_id = ${membershipId}::uuid and action = 'role_changed'
     order by created_at, id`;
}

async function roleOf(membershipId: string): Promise<string | undefined> {
  const [row] = await adminSql<{ role: string }[]>`
    select role from public.memberships where id = ${membershipId}::uuid`;
  return row?.role;
}

/** Leaves the seeded demo member a plain `member` whatever a role case did. */
async function restoreDemoMemberRole(): Promise<void> {
  if (!people.member.membership) return;
  await adminSql`
    update public.memberships set "role" = 'member' where id = ${people.member.membership}::uuid`;
}

/**
 * ADMIN-02 tracer (D-332): the demo admin promotes `member@rede-demo.local` to admin through
 * `PUT /v1/admin/members/{id}/role`; ONE `role_changed` row with `{ from, to }` exists, and the
 * member's very next bootstrap — the SAME token, no refresh — carries `moderation.manage` (membership
 * is resolved per request). Then the admin demotes them back, which is a second row and takes the
 * permission away on the next request too.
 */
describe('role tracer', () => {
  afterAll(restoreDemoMemberRole);

  it('the admin promotes the member: 200, one role_changed row, the next bootstrap carries the admin permissions', async () => {
    const before = (await roleRows(people.member.membership)).length;
    const pre = await request('/v1/me/bootstrap', tokens.member);
    expect(pre.status).toBe(200);
    expect(((await pre.json()) as { permissions: string[] }).permissions).not.toContain(
      'moderation.manage',
    );

    const res = await setRole(tokens.admin, people.member.membership, { role: 'admin_tenant' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()) as AdminMember).toMatchObject({
      membershipId: people.member.membership,
      role: 'admin_tenant',
      status: 'active',
      isViewer: false,
    });
    expect(await roleOf(people.member.membership)).toBe('admin_tenant');

    const rows = await roleRows(people.member.membership);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toEqual({
      details: { from: 'member', to: 'admin_tenant' },
      actor_membership_id: people.admin.membership,
    });

    // D-332: the member's very next request, on the token minted BEFORE the change.
    const next = await request('/v1/me/bootstrap', tokens.member);
    expect(next.status).toBe(200);
    const permissions = ((await next.json()) as { permissions: string[] }).permissions;
    expect(permissions).toEqual(expect.arrayContaining(['moderation.manage', 'members.manage']));
    expect(permissions).toEqual(expect.arrayContaining(['tenant.manage']));
    // …and the admin list now answers them.
    expect((await request('/v1/admin/members', tokens.member)).status).toBe(200);
  });

  it('the admin demotes them back: a second row, and the next request has lost the permissions', async () => {
    const before = (await roleRows(people.member.membership)).length;
    const res = await setRole(tokens.admin, people.member.membership, { role: 'member' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminMember).role).toBe('member');

    const rows = await roleRows(people.member.membership);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]?.details).toEqual({ from: 'admin_tenant', to: 'member' });

    const next = await request('/v1/me/bootstrap', tokens.member);
    expect(next.status).toBe(200);
    const permissions = ((await next.json()) as { permissions: string[] }).permissions;
    expect(permissions).not.toContain('moderation.manage');
    expect(permissions).not.toContain('members.manage');
    // T-08-29: a demoted admin's next admin call is refused.
    const list = await request('/v1/admin/members', tokens.member);
    expect(list.status).toBe(403);
    expect((await envelope(list)).error.code).toBe('FORBIDDEN');
  });
});

/**
 * 08-05 D-332 guards on a role change (T-08-26, T-08-27, T-08-28), under the 08-04 row locks. The
 * seeded member is promoted to admin through the admin SQL lane, so the demo tenant has exactly TWO
 * active admins; every case leaves it that way, and `afterAll` restores the seed (admin stays
 * `admin_tenant`, member back to `member`).
 */
describe('role guards', () => {
  const activeAdmins = async (): Promise<number> => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships
       where tenant_id = ${ids.demo}::uuid and role = 'admin_tenant' and status = 'active'
         and blocked_at is null and deleted_at is null`;
    return row?.n ?? 0;
  };
  const restoreTwoAdmins = async () => {
    await adminSql`
      update public.memberships set "role" = 'admin_tenant', status = 'active', blocked_at = null
       where id in (${people.admin.membership}::uuid, ${people.member.membership}::uuid)`;
  };

  beforeAll(async () => {
    // Earlier describes leave THROWAWAY admins of this run active (`block concurrency`'s second
    // admin): demote them, so the seeded admin and the promoted member are the only two.
    if (throwawayUsers.length > 0) {
      await adminSql`
        update public.memberships set "role" = 'member'
         where tenant_id = ${ids.demo}::uuid and role = 'admin_tenant'
           and user_id = any(${throwawayUsers}::uuid[])`;
    }
    await restoreTwoAdmins();
    expect(await activeAdmins()).toBe(2);
  });

  afterAll(async () => {
    await restoreDemoAdmin();
    await adminSql`
      update public.memberships set "role" = 'admin_tenant' where id = ${people.admin.membership}::uuid`;
    await restoreDemoMember();
    await restoreDemoMemberRole();
  });

  it('each admin changing their own role answers 409 self and writes nothing', async () => {
    for (const [token, membership] of [
      [tokens.admin, people.admin.membership],
      [tokens.member, people.member.membership],
    ] as const) {
      const before = (await roleRows(membership)).length;
      for (const role of ['member', 'support_tenant', 'admin_tenant']) {
        const res = await setRole(token, membership, { role });
        expect(res.status).toBe(409);
        expect((await envelope(res)).error.details).toEqual({ member: 'self' });
      }
      expect(await roleOf(membership)).toBe('admin_tenant');
      expect(await roleRows(membership)).toHaveLength(before);
    }
  });

  it('two admins demoting each other at once: one 200, one 409 last_admin, one active admin remains', async () => {
    expect(await activeAdmins()).toBe(2);
    const before =
      (await roleRows(people.admin.membership)).length +
      (await roleRows(people.member.membership)).length;
    try {
      const [a, b] = await Promise.all([
        setRole(tokens.admin, people.member.membership, { role: 'member' }),
        setRole(tokens.member, people.admin.membership, { role: 'member' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const refused = a.status === 409 ? a : b;
      expect((await envelope(refused)).error.details).toEqual({ member: 'last_admin' });
      expect(await activeAdmins()).toBe(1);
      const written =
        (await roleRows(people.admin.membership)).length +
        (await roleRows(people.member.membership)).length;
      expect(written).toBe(before + 1);
    } finally {
      await restoreTwoAdmins();
    }
  });

  it('demoting the only active admin is refused even to support (sequential last_admin)', async () => {
    // A promoted-then-demoted second admin leaves one: the remaining admin cannot be demoted by a
    // members.manage holder who is not an admin (D-338's future grant, simulated as in 08-04).
    await adminSql`
      update public.memberships set "role" = 'support_tenant' where id = ${people.member.membership}::uuid`;
    setPermissionResolver((role, enabled, settings) => {
      const granted = permissionsFor(role, enabled, settings);
      return role === 'support_tenant' ? [...granted, 'members.manage'] : granted;
    });
    try {
      for (const role of ['member', 'support_tenant']) {
        const res = await setRole(tokens.member, people.admin.membership, { role });
        expect(res.status).toBe(409);
        expect((await envelope(res)).error.details).toEqual({ member: 'last_admin' });
      }
      expect(await activeAdmins()).toBe(1);
      // Promoting someone is always allowed, and promoting back restores two admins.
      const promote = await setRole(tokens.admin, people.member.membership, {
        role: 'admin_tenant',
      });
      expect(promote.status).toBe(200);
      expect(await activeAdmins()).toBe(2);
    } finally {
      setPermissionResolver(permissionsFor);
      await restoreTwoAdmins();
    }
  });

  it('promoting or demoting ANOTHER admin is allowed while two remain', async () => {
    const demote = await setRole(tokens.admin, people.member.membership, {
      role: 'support_tenant',
    });
    expect(demote.status).toBe(200);
    expect(((await demote.json()) as AdminMember).role).toBe('support_tenant');
    const rows = await roleRows(people.member.membership);
    expect(rows[rows.length - 1]?.details).toEqual({ from: 'admin_tenant', to: 'support_tenant' });
    const promote = await setRole(tokens.admin, people.member.membership, {
      role: 'admin_tenant',
    });
    expect(promote.status).toBe(200);
    expect(await activeAdmins()).toBe(2);
  });

  it('an invited membership answers 409 not_active', async () => {
    const invited = await throwaway(
      ids.demo,
      `convite-papel-${RUN}@rede-demo.local`,
      'member',
      'invited',
      '',
    );
    const res = await setRole(tokens.admin, invited.membership, { role: 'support_tenant' });
    expect(res.status).toBe(409);
    expect((await envelope(res)).error.details).toEqual({ member: 'not_active' });
    expect(await roleOf(invited.membership)).toBe('member');
    expect(await roleRows(invited.membership)).toHaveLength(0);
  });

  it('a blocked membership answers 409 blocked (unblock first), for any role', async () => {
    const blocked = await throwaway(
      ids.demo,
      `bloqueado-papel-${RUN}@rede-demo.local`,
      'support_tenant',
      'blocked',
    );
    for (const role of ['admin_tenant', 'member', 'support_tenant']) {
      const res = await setRole(tokens.admin, blocked.membership, { role });
      expect(res.status).toBe(409);
      expect((await envelope(res)).error.details).toEqual({ member: 'blocked' });
    }
    // The legacy blocked_at-only row is blocked too (the app.membership_for_user folding).
    await adminSql`
      update public.memberships set status = 'active' where id = ${blocked.membership}::uuid`;
    const legacy = await setRole(tokens.admin, blocked.membership, { role: 'member' });
    expect(legacy.status).toBe(409);
    expect((await envelope(legacy)).error.details).toEqual({ member: 'blocked' });
    expect(await roleOf(blocked.membership)).toBe('support_tenant');
    expect(await roleRows(blocked.membership)).toHaveLength(0);
  });

  it('the same role is 200 with the current state and no new log row', async () => {
    const before = (await roleRows(people.member.membership)).length;
    const res = await setRole(tokens.admin, people.member.membership, { role: 'admin_tenant' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminMember).role).toBe('admin_tenant');
    expect(await roleRows(people.member.membership)).toHaveLength(before);
  });

  it('a role outside TENANT_ROLES, a missing role or an unknown key is 400', async () => {
    for (const body of [
      { role: 'super_admin' },
      { role: 'admin' },
      {},
      { role: 'member', tenantId: ids.lab },
    ]) {
      const res = await setRole(tokens.admin, people.support.membership, body);
      expect(res.status).toBe(400);
    }
    expect(await roleOf(people.support.membership)).toBe('support_tenant');
  });

  it('a rede-lab membership id (or an unknown one) is the bare 404', async () => {
    for (const id of [people.labMember.membership, randomUUID()]) {
      const res = await setRole(tokens.admin, id, { role: 'admin_tenant' });
      expect(res.status).toBe(404);
      const body = await envelope(res);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
    }
    expect(await roleOf(people.labMember.membership)).toBe('member');
  });

  it('support and a plain member get 403 FORBIDDEN', async () => {
    const plain = await throwawaySession('papel-membro');
    for (const token of [tokens.support, plain.token]) {
      const res = await setRole(token, people.support.membership, { role: 'admin_tenant' });
      expect(res.status).toBe(403);
      expect((await envelope(res)).error.code).toBe('FORBIDDEN');
    }
    expect(await roleOf(people.support.membership)).toBe('support_tenant');
  });

  it('a rede-demo session on the lab host is 403 TENANT_HOST_MISMATCH', async () => {
    const res = await setRole(
      tokens.admin,
      people.labMember.membership,
      { role: 'admin_tenant' },
      HOSTS.lab,
    );
    expect(res.status).toBe(403);
    expect((await envelope(res)).error.code).toBe('TENANT_HOST_MISMATCH');
    expect(await roleOf(people.labMember.membership)).toBe('member');
  });

  it('ADMIN-02 adjacency: a same-named other member is acted on; the actor’s own membership is always self', async () => {
    const [own] = await adminSql<{ name: string | null }[]>`
      select display_name as name from public.member_profiles
       where membership_id = ${people.admin.membership}::uuid`;
    const adminName = own?.name ?? '';
    expect(adminName).not.toBe('');
    const twin = await throwaway(
      ids.demo,
      `gemeo-${RUN}@rede-demo.local`,
      'member',
      'active',
      adminName,
    );
    const page = await list(tokens.admin, `?q=${encodeURIComponent(adminName)}&limit=50`);
    const named = page.items.filter((m) => m.displayName === adminName);
    expect(named.map((m) => m.membershipId).sort()).toEqual(
      [people.admin.membership, twin.membership].sort(),
    );

    const self = await setRole(tokens.admin, people.admin.membership, { role: 'support_tenant' });
    expect(self.status).toBe(409);
    expect((await envelope(self)).error.details).toEqual({ member: 'self' });

    const other = await setRole(tokens.admin, twin.membership, { role: 'support_tenant' });
    expect(other.status).toBe(200);
    expect(await roleOf(twin.membership)).toBe('support_tenant');
    expect(await roleOf(people.admin.membership)).toBe('admin_tenant');
  });
});

/* ── quick 261007-gzu: the "E-mail não confirmado" fact on the admin rows ──────────────────────── */

/** Marks an identity's e-mail unconfirmed, the state a sign-up is in until the mail is followed. */
async function makeUnconfirmed(userId: string): Promise<void> {
  await adminSql`update auth.users set email_confirmed_at = null where id = ${userId}::uuid`;
}

describe('email unconfirmed', () => {
  const fx = {
    unconfirmed: { user: '', membership: '' },
    confirmed: { user: '', membership: '' },
    invited: { user: '', membership: '' },
    lab: { user: '', membership: '' },
  };

  beforeAll(async () => {
    fx.unconfirmed = await throwaway(
      ids.demo,
      `ue-pendente-${RUN}@rede-demo.local`,
      'member',
      'active',
      `Pendente ${RUN}`,
    );
    fx.confirmed = await throwaway(
      ids.demo,
      `ue-confirmado-${RUN}@rede-demo.local`,
      'member',
      'active',
      `Confirmado ${RUN}`,
    );
    fx.invited = await throwaway(
      ids.demo,
      `ue-convidado-${RUN}@rede-demo.local`,
      'admin_tenant',
      'invited',
      '',
    );
    fx.lab = await throwaway(
      ids.lab,
      `ue-pendente-lab-${RUN}@rede-lab.local`,
      'member',
      'active',
      `Pendente Lab ${RUN}`,
    );
    await makeUnconfirmed(fx.unconfirmed.user);
    await makeUnconfirmed(fx.invited.user);
    await makeUnconfirmed(fx.lab.user);
  });

  const flagOf = (items: AdminMember[], membershipId: string) =>
    items.find((m) => m.membershipId === membershipId)?.emailUnconfirmed;

  it('the list reports the raw fact: true for the unconfirmed active and invited rows, false for the rest', async () => {
    const all = await walk(tokens.admin, 50);
    expect(flagOf(all, fx.unconfirmed.membership)).toBe(true);
    expect(flagOf(all, fx.invited.membership)).toBe(true);
    expect(flagOf(all, fx.confirmed.membership)).toBe(false);
    expect(flagOf(all, people.admin.membership)).toBe(false);
    expect(flagOf(all, people.member.membership)).toBe(false);
    const invitedRow = all.find((m) => m.membershipId === fx.invited.membership);
    expect(invitedRow?.status).toBe('invited');
    // Every row carries a real boolean: the API always emits the field.
    for (const row of all) expect(typeof row.emailUnconfirmed).toBe('boolean');
  });

  it('nobody is hidden: the unconfirmed member stays under Todos and Ativos and the order equals the table', async () => {
    const all = await walk(tokens.admin, 50);
    expect(all.map((m) => m.membershipId)).toEqual(await listSnapshot(ids.demo));
    expect(all.some((m) => m.membershipId === fx.unconfirmed.membership)).toBe(true);
    const active = await walk(tokens.admin, 50, { status: 'active' });
    expect(active.some((m) => m.membershipId === fx.unconfirmed.membership)).toBe(true);
    expect(active.some((m) => m.membershipId === fx.invited.membership)).toBe(false);
  });

  it('the single read answers the flag, and both reads flip once the address is confirmed', async () => {
    const single = await request(`/v1/admin/members/${fx.unconfirmed.membership}`, tokens.admin);
    expect(single.status).toBe(200);
    expect(((await single.json()) as AdminMember).emailUnconfirmed).toBe(true);

    await adminSql`update auth.users set email_confirmed_at = now() where id = ${fx.unconfirmed.user}::uuid`;

    const after = await request(`/v1/admin/members/${fx.unconfirmed.membership}`, tokens.admin);
    expect(((await after.json()) as AdminMember).emailUnconfirmed).toBe(false);
    expect(flagOf(await walk(tokens.admin, 50), fx.unconfirmed.membership)).toBe(false);
    await makeUnconfirmed(fx.unconfirmed.user);
  });

  it('tenant isolation: a rede-lab admin sees its own unconfirmed row and none of rede-demo, and vice versa', async () => {
    const lab = await walk(tokens.labAdmin, 50, {}, HOSTS.lab);
    expect(flagOf(lab, fx.lab.membership)).toBe(true);
    const demoIds = [fx.unconfirmed, fx.confirmed, fx.invited].map((f) => f.membership);
    expect(lab.some((m) => demoIds.includes(m.membershipId))).toBe(false);
    const demo = await walk(tokens.admin, 50);
    expect(demo.some((m) => m.membershipId === fx.lab.membership)).toBe(false);

    const [wrong] = await adminSql<{ v: boolean }[]>`
      select app.membership_email_unconfirmed(${ids.lab}::uuid, ${fx.unconfirmed.membership}::uuid) as v`;
    const [right] = await adminSql<{ v: boolean }[]>`
      select app.membership_email_unconfirmed(${ids.demo}::uuid, ${fx.unconfirmed.membership}::uuid) as v`;
    expect(wrong?.v).toBe(false);
    expect(right?.v).toBe(true);
  });

  it('privacy: the member-facing directory carries no trace of the field', async () => {
    const res = await request('/v1/members?limit=50', tokens.member);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('nconfirmed');
  });
});
