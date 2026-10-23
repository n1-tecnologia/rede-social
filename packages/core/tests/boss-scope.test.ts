import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHandle } from '../db/project-pools';
import type { Tx } from '../db/tenant-tx';

/**
 * 09.2-09 (DBT-29, D-546, T-09.2-40): queue scopes and the enqueue guard. No database, no network: pg-boss is
 * replaced by a recorder that keeps the options it was constructed with and every call made to it, and the
 * transactions are plain objects registered in `projectOfTx` the way the lanes register them.
 */

type Constructed = { options: Record<string, unknown>; calls: string[]; sent: unknown[] };
const constructed: Constructed[] = [];

vi.mock('pg-boss', () => {
  class FakeBoss {
    readonly record: Constructed;
    constructor(options: Record<string, unknown>) {
      this.record = { options, calls: [], sent: [] };
      constructed.push(this.record);
    }
    on() {
      return this;
    }
    async start() {
      this.record.calls.push('start');
    }
    async stop() {
      this.record.calls.push('stop');
    }
    async createQueue(name: string, options: unknown) {
      this.record.calls.push(`createQueue:${name}:${JSON.stringify(options)}`);
    }
    async getQueues(names: string[]) {
      return names.map((name) => ({ name, policy: 'short' }));
    }
    async send(name: string, payload: unknown, options: unknown) {
      this.record.sent.push({ name, payload, options });
      return 'job-id';
    }
  }
  return { PgBoss: FakeBoss, fromDrizzle: (tx: unknown) => ({ executeSql: tx }) };
});

vi.mock('../server/tenancy/project-registry', () => ({
  resolveProjectById: vi.fn(async (id: string) => ({
    id,
    databaseUrlTxSealed: `sealed-${id}`,
  })),
}));
vi.mock('../server/secrets/sealed', () => ({
  open: (sealed: string) => `postgres://api_user:pw@host-of-${sealed}:6543/postgres`,
}));

const boss = await import('../server/jobs/boss');
const { projectOfTx } = await import('../db/project-handle');

function handle(projectId: string, kind: 'central' | 'tenant', version = 1): ProjectHandle {
  return { projectId, ref: projectId, kind, credentialVersion: version } as ProjectHandle;
}

type FakeTx = { statements: string[]; execute: (q: unknown) => Promise<unknown> };

function fakeTx(
  h: ProjectHandle | null,
  lane: 'tenant' | 'admin' | 'platform',
  callerRole = 'authenticated',
) {
  const tx: FakeTx = {
    statements: [],
    execute: async (query: unknown) => {
      const text = JSON.stringify(query);
      tx.statements.push(text);
      return text.includes('current_role') ? [{ role: callerRole }] : [];
    },
  };
  if (h) projectOfTx.set(tx as unknown as Tx, { handle: h, lane });
  return tx as unknown as Tx;
}

beforeEach(async () => {
  await boss.stopBoss();
  constructed.length = 0;
});

describe('registerJobQueues scopes', () => {
  it('defaults to tenant, records platform, and lists by scope', () => {
    boss.registerJobQueues(['scope.t-1']);
    boss.registerJobQueues(['scope.p-1'], 'platform');
    expect(boss.queueScope('scope.t-1')).toBe('tenant');
    expect(boss.queueScope('scope.p-1')).toBe('platform');
    expect(boss.queueScope('scope.unknown')).toBeUndefined();
    expect(boss.registeredJobQueues('platform')).toContain('scope.p-1');
    expect(boss.registeredJobQueues('platform')).not.toContain('scope.t-1');
    expect(boss.registeredJobQueues('tenant')).toContain('scope.t-1');
    expect(boss.registeredJobQueues()).toEqual(expect.arrayContaining(['scope.t-1', 'scope.p-1']));
  });

  it('is idempotent for the same scope and throws for a different one', () => {
    boss.registerJobQueues(['scope.dup'], 'platform');
    expect(() => boss.registerJobQueues(['scope.dup'], 'platform')).not.toThrow();
    expect(() => boss.registerJobQueues(['scope.dup'])).toThrow(/already registered as a platform/);
    expect(boss.queueScope('scope.dup')).toBe('platform');
  });

  // Loads the whole kernel: a cold CI runner needs more than the 5000 ms default (5696 ms measured in run 40039284864).
  it('the kernel registers its platform queues at import', async () => {
    await import('../server/domains/index');
    await import('../server/platform/invite-send');
    expect(boss.queueScope('kernel.domain-verify')).toBe('platform');
    expect(boss.queueScope('kernel.invite-send')).toBe('platform');
  }, 30_000);
});

describe('createBoss maps a scope to a schema from a closed set', () => {
  it('tenant is pgboss, platform is pgboss_platform, never migrating', () => {
    boss.createBoss({ connectionString: 'postgres://x/y' });
    boss.createBoss({ connectionString: 'postgres://x/y', scope: 'tenant' });
    boss.createBoss({ connectionString: 'postgres://x/y', scope: 'platform', max: 2 });
    expect(constructed.map((c) => c.options.schema)).toEqual([
      'pgboss',
      'pgboss',
      'pgboss_platform',
    ]);
    expect(constructed.every((c) => c.options.migrate === false)).toBe(true);
    expect(constructed[2]?.options.max).toBe(2);
  });
});

describe('assertQueueScope', () => {
  beforeEach(() => {
    boss.registerJobQueues(['guard.tenant']);
    boss.registerJobQueues(['guard.platform'], 'platform');
  });

  it('a platform queue needs the platform lane; a tenant queue needs a tenant or admin lane', () => {
    expect(boss.assertQueueScope('guard.platform', 'platform')).toBe('platform');
    expect(boss.assertQueueScope('guard.tenant', 'tenant')).toBe('tenant');
    expect(boss.assertQueueScope('guard.tenant', 'admin')).toBe('tenant');
    for (const lane of ['tenant', 'admin'] as const) {
      expect(() => boss.assertQueueScope('guard.platform', lane)).toThrow(
        'enqueueInTx: guard.platform is a platform queue',
      );
    }
    expect(() => boss.assertQueueScope('guard.tenant', 'platform')).toThrow(
      'enqueueInTx: guard.tenant is a tenant queue',
    );
  });

  it('refuses a queue nobody registered', () => {
    expect(() => boss.assertQueueScope('guard.nobody', 'admin')).toThrow(/not a registered queue/);
  });
});

describe('createQueues keeps the short policy', () => {
  it('creates every queue with the short policy and verifies it', async () => {
    const stub = boss.createBoss({ connectionString: 'postgres://x/y' });
    await boss.createQueues(stub, ['a.one', 'a.two']);
    expect(constructed[0]?.calls).toEqual([
      'createQueue:a.one:{"policy":"short"}',
      'createQueue:a.two:{"policy":"short"}',
    ]);
  });
});

describe('enqueueInTx routing', () => {
  beforeEach(() => {
    boss.registerJobQueues(['route.tenant']);
    boss.registerJobQueues(['route.platform'], 'platform');
  });

  it('an unknown transaction is refused before anything is created', async () => {
    await expect(boss.enqueueInTx(fakeTx(null, 'tenant'), 'route.tenant', {})).rejects.toThrow(
      'enqueueInTx: transaction was not opened by a lane',
    );
    expect(constructed).toEqual([]);
  });

  it('a wrong-scope enqueue throws before any sender exists and before any statement', async () => {
    const central = handle('p0', 'central');
    const platformTx = fakeTx(central, 'platform');
    const tenantTx = fakeTx(central, 'tenant');
    await expect(boss.enqueueInTx(tenantTx, 'route.platform', {})).rejects.toThrow(
      'route.platform is a platform queue',
    );
    await expect(boss.enqueueInTx(platformTx, 'route.tenant', {})).rejects.toThrow(
      'route.tenant is a tenant queue',
    );
    expect(constructed).toEqual([]);
    expect((platformTx as unknown as FakeTx).statements).toEqual([]);
    expect((tenantTx as unknown as FakeTx).statements).toEqual([]);
  });

  it('the sender follows the transaction: one per project and scope, the right schema and url', async () => {
    const central = handle('p0', 'central');
    const other = handle('pb', 'tenant');
    await boss.enqueueInTx(fakeTx(central, 'admin'), 'route.tenant', { n: 1 });
    await boss.enqueueInTx(fakeTx(central, 'tenant'), 'route.tenant', { n: 2 });
    await boss.enqueueInTx(fakeTx(other, 'tenant'), 'route.tenant', { n: 3 });
    await boss.enqueueInTx(fakeTx(central, 'platform'), 'route.platform', { n: 4 });

    // Three senders: central tenant scope, B tenant scope, central platform scope (the repeat reused one).
    expect(constructed).toHaveLength(3);
    const [centralTenant, bTenant, centralPlatform] = constructed;
    expect(centralTenant?.options.schema).toBe('pgboss');
    expect(centralTenant?.options.connectionString).toBe(
      'postgres://api_user:postgres@127.0.0.1:54322/postgres',
    );
    expect(centralTenant?.sent).toHaveLength(2);
    expect(bTenant?.options.schema).toBe('pgboss');
    expect(String(bTenant?.options.connectionString)).toContain('host-of-sealed-pb');
    expect(bTenant?.sent).toHaveLength(1);
    expect(centralPlatform?.options.schema).toBe('pgboss_platform');
    expect(centralPlatform?.sent).toHaveLength(1);
    for (const sender of constructed) {
      expect(sender.options.max).toBe(1);
      expect(sender.options.supervise).toBe(false);
      expect(sender.options.schedule).toBe(false);
      expect(sender.options.migrate).toBe(false);
    }
  });

  it('a sender creates only the queues of its scope', async () => {
    const central = handle('p0', 'central');
    await boss.enqueueInTx(fakeTx(central, 'platform'), 'route.platform', {});
    const created = (constructed[0]?.calls ?? []).filter((c) => c.startsWith('createQueue:'));
    expect(created.some((c) => c.includes('route.platform'))).toBe(true);
    expect(created.some((c) => c.includes('route.tenant'))).toBe(false);
  });

  it('a new credential version replaces the sender of the same project', async () => {
    await boss.enqueueInTx(fakeTx(handle('pb', 'tenant', 1), 'admin'), 'route.tenant', {});
    await boss.enqueueInTx(fakeTx(handle('pb', 'tenant', 2), 'admin'), 'route.tenant', {});
    expect(constructed).toHaveLength(2);
    await vi.waitFor(() => expect(constructed[0]?.calls).toContain('stop'));
    expect(constructed[1]?.calls).not.toContain('stop');
  });

  it('keeps the role dance: api_user for the insert, the caller role restored after', async () => {
    const central = handle('p0', 'central');
    const tx = fakeTx(central, 'tenant', 'authenticated');
    await boss.enqueueInTx(tx, 'route.tenant', { n: 1 }, { singletonKey: 'k' });
    const statements = (tx as unknown as FakeTx).statements.join('\n');
    expect(statements).toContain('set local role api_user');
    expect(statements.lastIndexOf('authenticated')).toBeGreaterThan(
      statements.indexOf('set local role api_user'),
    );
    expect(constructed[0]?.sent[0]).toMatchObject({
      name: 'route.tenant',
      payload: { n: 1 },
      options: { singletonKey: 'k' },
    });
  });

  it('stopBoss stops every sender', async () => {
    await boss.enqueueInTx(fakeTx(handle('p0', 'central'), 'admin'), 'route.tenant', {});
    await boss.enqueueInTx(fakeTx(handle('p0', 'central'), 'platform'), 'route.platform', {});
    await boss.stopBoss();
    expect(constructed.map((c) => c.calls.at(-1))).toEqual(['stop', 'stop']);
  });
});
