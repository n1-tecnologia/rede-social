import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../server/http/api-error';
import { ProjectUnboundError } from '../server/tenancy/project-errors';

/**
 * 09.2-06 (D-537, D-538, D-539; T-09.2-28, T-09.2-29): which lane, which target and which Auth client each
 * invite function uses. The lane modules, the Auth registry and the project resolver are replaced by
 * recorders: what is asserted is WHERE each statement and each Auth call went, in what order, and that no
 * lane is ever opened while another is open (two databases, two transactions, never nested).
 */

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // lives in project 0
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // lives in project B
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const INVITED_USER = '99999999-9999-4999-8999-999999999999';
const HOST = 'comunidade.b.test';

type Rows = Record<string, unknown[]>;
type AuthCalls = {
  inviteUserByEmail: ReturnType<typeof vi.fn>;
  generateLink: ReturnType<typeof vi.fn>;
};

const h = vi.hoisted(() => ({
  /** Every lane opened and every Auth call, in order. */
  events: [] as string[],
  open: [] as string[],
  maxDepth: 0,
  /** Scripted rows per `<op>:<table>`; `execute` rows under `execute`. */
  rows: {} as Record<string, unknown[]>,
  /** Per `<op>:<table>`, answers consumed first, one per call, before `rows` applies. */
  seq: {} as Record<string, unknown[][]>,
  projects: {} as Record<string, { id: string }>,
  clients: new Map<string, unknown>(),
  enqueued: [] as { name: string; tx: unknown }[],
}));

function fakeTx(lane: string) {
  const answer = (op: string, table: string): unknown[] => {
    h.events.push(`${lane}:${op}:${table}`);
    const queued = h.seq[`${op}:${table}`]?.shift();
    return queued ?? h.rows[`${op}:${table}`] ?? [];
  };
  const chain = (op: string, table: string) => {
    const node: Record<string, unknown> = {};
    for (const method of [
      'where',
      'limit',
      'orderBy',
      'for',
      'innerJoin',
      'values',
      'set',
      'onConflictDoNothing',
      'returning',
    ]) {
      node[method] = () => node;
    }
    node.from = (t: unknown) => chain(op, getTableName(t as never));
    // biome-ignore lint/suspicious/noThenProperty: drizzle's query builders are thenables; the fake mimics them
    node.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(answer(op, table)).then(resolve, reject);
    return node;
  };
  return {
    lane,
    select: () => chain('select', ''),
    update: (t: unknown) => chain('update', getTableName(t as never)),
    insert: (t: unknown) => chain('insert', getTableName(t as never)),
    execute: async () => answer('execute', 'sql'),
  };
}

async function inLane<T>(name: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
  if (h.open.length > 0) {
    throw new Error(`lane ${name} opened while ${h.open.join(',')} is open`);
  }
  h.open.push(name);
  h.maxDepth = Math.max(h.maxDepth, h.open.length);
  h.events.push(`open:${name}`);
  try {
    return await fn(fakeTx(name));
  } finally {
    h.open.pop();
  }
}

vi.mock('../db/admin-tx', () => ({
  withAdminTx: vi.fn(
    async (target: { tenantId: string }, fn: (tx: unknown) => Promise<unknown>) => {
      if (typeof target === 'function') throw new Error('the legacy single-argument form was used');
      if (!h.projects[target.tenantId])
        throw new (await import('../server/tenancy/project-errors')).ProjectUnboundError();
      return inLane(`tenant:${target.tenantId === TENANT_B ? 'B' : 'A'}`, fn);
    },
  ),
}));

vi.mock('../db/platform-tx', () => ({
  withPlatformTx: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => inLane('platform', fn)),
}));

vi.mock('../server/tenancy/project-registry', async () => {
  const errors = await import('../server/tenancy/project-errors');
  return {
    resolveProject: vi.fn(async (tenantId: string) => {
      const project = h.projects[tenantId];
      if (!project) throw new errors.ProjectUnboundError();
      return project;
    }),
  };
});

vi.mock('../server/supabase-admin', () => ({
  supabaseAdminFor: (project: { id: string }) => ({ auth: { admin: h.clients.get(project.id) } }),
}));

vi.mock('../server/tenancy/access', () => ({ grantManualAccess: vi.fn() }));

vi.mock('../server/domains/index', () => ({ authAllowList: { name: 'local' } }));

vi.mock('../server/jobs/boss', () => ({
  registerJobQueues: vi.fn(),
  enqueueInTx: vi.fn(async (tx: unknown, name: string) => {
    h.enqueued.push({ name, tx });
    return 'job-1';
  }),
}));

vi.mock('../server/mail/index', () => ({
  mailTransport: { name: 'fake', send: vi.fn(async () => undefined) },
  toMailBrand: vi.fn(() => ({ displayName: 'Comunidade B' })),
}));
vi.mock('../server/mail/templates/invite', () => ({
  renderInvite: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}));
vi.mock('../server/mail/templates/invite-existing', () => ({
  renderInviteExisting: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}));

const { resendInvite, sendPendingInvites, listTenantInvites } = await import(
  '../server/platform/invites'
);
const { runScheduledInviteSend, scheduleInviteSends } = await import(
  '../server/platform/invite-send'
);

function client(name: string): AuthCalls {
  const calls: AuthCalls = {
    inviteUserByEmail: vi.fn(async () => {
      h.events.push(`auth:${name}:inviteUserByEmail`);
      return { data: { user: { id: INVITED_USER } }, error: null };
    }),
    generateLink: vi.fn(async () => {
      h.events.push(`auth:${name}:generateLink`);
      return {
        data: { properties: { hashed_token: 'hashed' }, user: { id: INVITED_USER } },
        error: null,
      };
    }),
  };
  h.clients.set(name, calls);
  return calls;
}

let central: AuthCalls;
let projectB: AuthCalls;

const actor = { userId: 'super-admin' };
const tenantRow = {
  slug: 'comunidade-b',
  displayName: 'Comunidade B',
  status: 'active',
  branding: {},
};
const inviteRow = (status: string, userId: string | null = null) => ({
  id: INVITE_ID,
  email: 'admin@b.test',
  role: 'admin_tenant',
  status,
  sentAt: null,
  acceptedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  userId,
});

/** The rows the control plane holds for a tenant: it exists, and has a verified primary host. */
function centralRows(host: string | null = HOST): Rows {
  return {
    'select:tenants': [{ id: TENANT_B }],
    'select:tenant_domains': host ? [{ host, id: 'domain-1' }] : [],
  };
}

beforeEach(() => {
  h.events.length = 0;
  h.open.length = 0;
  h.maxDepth = 0;
  h.enqueued.length = 0;
  h.clients.clear();
  h.projects = { [TENANT_A]: { id: 'p0' }, [TENANT_B]: { id: 'pB' } };
  central = client('p0');
  projectB = client('pB');
  h.rows = {};
  h.seq = {};
});

/** The sequence of lane opens and Auth calls, without the statements. */
const trail = () => h.events.filter((e) => e.startsWith('open:') || e.startsWith('auth:'));

describe('sendPendingInvites: central domain, tenant data, tenant Auth', () => {
  it('reads the verified host in the platform lane first, then the tenant lane with { tenantId }, and invites through project B', async () => {
    h.rows = {
      ...centralRows(),
      // The tenant lane reads the tenant row, then the pending invites (same table key as the central
      // `tenants` read, so the tenant row is what the tenant lane returns for `select:tenants`).
      'select:tenants': [tenantRow],
      'select:tenant_invites': [{ id: INVITE_ID, email: 'admin@b.test' }],
      'update:tenant_invites': [{ id: INVITE_ID }],
      'select:users': [{ id: INVITED_USER }],
      'insert:memberships': [{ id: 'm1' }],
      'update:member_profiles': [{ id: 'm1' }],
    };
    h.seq['select:users'] = [[]]; // identityKind: no identity yet, so GoTrue creates it
    const result = await sendPendingInvites(TENANT_B, actor);

    expect(result).toEqual({ sent: 1 });
    const steps = trail();
    // Platform first (the host the link is built on), the tenant lane after, Auth only after both reads.
    expect(steps[0]).toBe('open:platform');
    expect(steps[1]).toBe('open:tenant:B');
    expect(steps.indexOf('auth:pB:inviteUserByEmail')).toBeGreaterThan(1);
    // The host table is read in the platform lane and never in a tenant lane.
    expect(h.events).toContain('platform:select:tenant_domains');
    expect(
      h.events.filter((e) => e.startsWith('tenant:B:') && e.endsWith(':tenant_domains')),
    ).toEqual([]);
    // Project B's Auth issued the invite, and project 0's was never called (T-09.2-28).
    expect(projectB.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(central.inviteUserByEmail).not.toHaveBeenCalled();
    expect(central.generateLink).not.toHaveBeenCalled();
    expect(h.maxDepth).toBe(1);
  });

  it('a tenant of project 0 invites through the client of project 0', async () => {
    h.rows = {
      ...centralRows(),
      'select:tenants': [tenantRow],
      'select:tenant_invites': [{ id: INVITE_ID, email: 'admin@a.test' }],
      'update:tenant_invites': [{ id: INVITE_ID }],
      'select:users': [{ id: INVITED_USER }],
      'insert:memberships': [{ id: 'm1' }],
      'update:member_profiles': [{ id: 'm1' }],
    };
    h.seq['select:users'] = [[]];
    await sendPendingInvites(TENANT_A, actor);
    expect(central.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(projectB.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('without a verified primary host it opens no tenant lane and calls no Auth', async () => {
    h.rows = centralRows(null);
    const result = await sendPendingInvites(TENANT_B, actor);
    expect(result).toEqual({ sent: 0, reason: 'no_verified_primary' });
    expect(trail()).toEqual(['open:platform']);
  });

  it('an unbound tenant stops before any Auth call', async () => {
    delete h.projects[TENANT_B];
    h.rows = {
      ...centralRows(),
      'select:tenants': [tenantRow],
      'select:tenant_invites': [{ id: INVITE_ID, email: 'admin@b.test' }],
    };
    await expect(sendPendingInvites(TENANT_B, actor)).rejects.toBeInstanceOf(ProjectUnboundError);
    expect(projectB.inviteUserByEmail).not.toHaveBeenCalled();
    expect(central.inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe('resendInvite: the recovery and re-invite links come from the tenant project', () => {
  const resendRows = (userRef: string | null): Rows => ({
    ...centralRows(),
    'select:tenants': [tenantRow],
    'select:tenant_invites': [inviteRow('sent', userRef)],
    'select:users': [{ id: INVITED_USER }],
    'insert:memberships': [{ id: 'm1' }],
    'update:member_profiles': [{ id: 'm1' }],
  });

  it('a new identity gets a generateLink of project B, after the central read, and project 0 is never called', async () => {
    h.rows = resendRows(null);
    h.seq['select:users'] = [[]]; // identityKind: no identity, so the invite link is minted
    const invite = await resendInvite(TENANT_B, INVITE_ID, actor);
    expect(invite.id).toBe(INVITE_ID);

    const steps = trail();
    expect(steps[0]).toBe('open:platform');
    expect(steps.indexOf('auth:pB:generateLink')).toBeGreaterThan(steps.indexOf('open:tenant:B'));
    expect(projectB.generateLink).toHaveBeenCalledTimes(1);
    expect(projectB.generateLink.mock.calls[0]?.[0]).toMatchObject({ type: 'invite' });
    expect(central.generateLink).not.toHaveBeenCalled();
    expect(h.maxDepth).toBe(1);
  });

  it('an already confirmed identity gets the recovery link from project B too (both generateLink calls)', async () => {
    h.rows = {
      ...resendRows(INVITED_USER),
      'select:memberships': [{ status: 'invited' }],
    };
    h.seq['select:users'] = [[]];
    projectB.generateLink
      .mockImplementationOnce(async () => {
        h.events.push('auth:pB:generateLink');
        return { data: null, error: { code: 'email_exists', message: 'already registered' } };
      })
      .mockImplementationOnce(async () => {
        h.events.push('auth:pB:generateLink');
        return {
          data: { properties: { hashed_token: 'recovery' }, user: { id: INVITED_USER } },
          error: null,
        };
      });
    await resendInvite(TENANT_B, INVITE_ID, actor);

    expect(projectB.generateLink).toHaveBeenCalledTimes(2);
    expect(projectB.generateLink.mock.calls.map((call) => call[0].type)).toEqual([
      'invite',
      'recovery',
    ]);
    expect(central.generateLink).not.toHaveBeenCalled();
    expect(central.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('a tenant the control plane does not know is a 404 before any tenant lane or Auth call', async () => {
    h.rows = { 'select:tenants': [] };
    await expect(resendInvite(TENANT_B, INVITE_ID, actor)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(trail()).toEqual(['open:platform']);
    await expect(listTenantInvites(TENANT_B)).rejects.toBeInstanceOf(ApiError);
    expect(trail().filter((e) => e.startsWith('auth:'))).toEqual([]);
  });
});

describe("kernel.invite-send: the verified host is central, the invites are the tenant's", () => {
  it('scheduleInviteSends reads the host in the platform lane, the invites in the tenant lane of { tenantId }, then enqueues the platform queue from the platform lane', async () => {
    h.rows = {
      'select:tenant_domains': [{ id: 'domain-1' }],
      'select:tenant_invites': [{ id: INVITE_ID }],
    };
    const result = await scheduleInviteSends(TENANT_B, actor, { delayS: 0 });
    expect(result).toEqual({ scheduled: 1 });
    expect(trail()).toEqual(['open:platform', 'open:tenant:B', 'open:platform']);
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.name).toBe('kernel.invite-send');
    expect((h.enqueued[0]?.tx as { lane: string } | undefined)?.lane).toBe('platform');
    expect(h.maxDepth).toBe(1);
  });

  it('scheduleInviteSends without a verified primary opens no tenant lane and enqueues nothing', async () => {
    h.rows = { 'select:tenant_domains': [] };
    const result = await scheduleInviteSends(TENANT_B, actor, { delayS: 0 });
    expect(result).toEqual({ scheduled: 0, reason: 'no_verified_primary' });
    expect(trail()).toEqual(['open:platform']);
    expect(h.enqueued).toEqual([]);
  });

  it('a job for a tenant that has no binding any more is gone, not a retry', async () => {
    delete h.projects[TENANT_B];
    const outcome = await runScheduledInviteSend(
      { tenantId: TENANT_B, inviteId: INVITE_ID },
      actor,
    );
    expect(outcome).toBe('gone');
  });
});
