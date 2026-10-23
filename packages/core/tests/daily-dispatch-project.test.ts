import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../db/tenant-tx';

/**
 * `runDailyTenantDispatch(projectId)` (09.2-09, DBT-31, D-546, P62-P64) at unit level: which lane the run opens,
 * the SQL it sends, the order it enqueues in. The two-database behaviour against real Postgres is proved in
 * `apps/api/tests/integration/dashboard-snapshot.test.ts` ("09.2 dispatch over two databases").
 */

type Call = { kind: 'sql'; text: string } | { kind: 'enqueue'; name: string; payload: unknown };
const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  tenantRows: [] as { id: string; day: string }[],
  targets: [] as unknown[],
  kind: 'tenant' as 'central' | 'tenant',
}));

vi.mock('../db/admin-tx', async () => {
  const { projectOfTx } = await import('../db/project-handle');
  return {
    withAdminTx: vi.fn(async (target: unknown, fn: (tx: Tx) => Promise<unknown>) => {
      h.targets.push(target);
      const dialect = new PgDialect();
      const tx = {
        execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
          const text = dialect.sqlToQuery(query).sql;
          h.calls.push({ kind: 'sql', text } satisfies Call);
          return text.includes('select count(*)') ? [{ n: 0 }] : h.tenantRows;
        },
      } as unknown as Tx;
      projectOfTx.set(tx, { handle: { kind: h.kind } as never, lane: 'admin' });
      return fn(tx);
    }),
  };
});
vi.mock('../server/jobs/boss', () => ({
  registerJobQueues: vi.fn(),
  enqueueInTx: vi.fn(async (_tx: unknown, name: string, payload: unknown) => {
    h.calls.push({ kind: 'enqueue', name, payload } satisfies Call);
    return 'job';
  }),
}));
vi.mock('../server/tenancy/project-registry', () => ({
  centralProjectId: vi.fn(async () => 'p0'),
}));

const { registerDailyTenantJobs, runDailyTenantDispatch, DAILY_TENANT_DISPATCH_QUEUE } =
  await import('../server/tenancy/daily-dispatch');

const sqlTexts = () =>
  (h.calls as Call[]).filter((c): c is Extract<Call, { kind: 'sql' }> => c.kind === 'sql');
const enqueues = () =>
  (h.calls as Call[]).filter((c): c is Extract<Call, { kind: 'enqueue' }> => c.kind === 'enqueue');

beforeEach(() => {
  h.calls.length = 0;
  h.targets.length = 0;
  h.tenantRows = [];
  h.kind = 'tenant';
  registerDailyTenantJobs(['unit.daily']);
});

describe('runDailyTenantDispatch(projectId)', () => {
  it('opens an admin lane on the project it was given', async () => {
    await runDailyTenantDispatch('pb');
    expect(h.targets).toEqual([{ projectId: 'pb' }]);
  });

  it('P64: reads tenants in ascending id and enqueues in exactly that order, then re-arms last', async () => {
    h.tenantRows = [
      { id: 'a-1', day: '2026-10-22' },
      { id: 'b-2', day: '2026-10-22' },
      { id: 'c-3', day: '2026-10-21' },
    ];
    const result = await runDailyTenantDispatch('pb');
    expect(result).toEqual({ tenants: 3, enqueued: 3, skipped: 0 });
    expect(sqlTexts()[0]?.text).toMatch(/order by t\.id\s*$/);
    const order = enqueues();
    expect(order.at(-1)?.name).toBe(DAILY_TENANT_DISPATCH_QUEUE);
    const perTenant = order.slice(0, -1).filter((c) => c.name === 'unit.daily');
    expect(perTenant.map((c) => (c.payload as { tenantId: string }).tenantId)).toEqual([
      'a-1',
      'b-2',
      'c-3',
    ]);
  });

  it('P62: the central project adds the binding filter to both queries, a tenant project adds none', async () => {
    h.kind = 'central';
    await runDailyTenantDispatch('p0');
    const central = sqlTexts().map((c) => c.text);
    expect(central).toHaveLength(2);
    for (const text of central) {
      expect(text).toContain('platform.tenant_projects');
      expect(text).toContain('tp.project_id =');
    }

    h.calls.length = 0;
    h.kind = 'tenant';
    await runDailyTenantDispatch('pb');
    for (const { text } of sqlTexts()) expect(text).not.toContain('tenant_projects');
  });

  it('P63: no tenant enqueues nothing but the re-arm', async () => {
    const result = await runDailyTenantDispatch('pb');
    expect(result).toEqual({ tenants: 0, enqueued: 0, skipped: 0 });
    expect(enqueues().map((c) => c.name)).toEqual([DAILY_TENANT_DISPATCH_QUEUE]);
  });
});
