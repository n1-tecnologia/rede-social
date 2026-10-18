import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `dashboard.snapshot-build` (08.7-01, D-464) at unit level: the payload guard, the lane it opens and
 * the outcome it reports. The lane is mocked (no database); the builder's own guards and numbers are
 * proven in pgTAP 198 and `apps/api/tests/integration/dashboard-snapshot.test.ts`.
 */

const TENANT = '22222222-2222-4222-8222-222222222222';

const lane = vi.hoisted(() => ({
  ctx: null as unknown,
  statements: [] as string[],
  built: true as boolean | null,
  calls: 0,
}));
vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => {
    lane.ctx = ctx;
    lane.calls += 1;
    return fn({
      execute: async (query: unknown) => {
        const text = JSON.stringify(query);
        lane.statements.push(text);
        return text.includes('dashboard_build_snapshot') ? [{ built: lane.built }] : [];
      },
    });
  },
}));

const logs = vi.hoisted(() => [] as { level: string; obj: Record<string, unknown> }[]);
vi.mock('@rede-social/core/server/logging', () => ({
  moduleLogger: () => ({
    info: (obj: Record<string, unknown>) => logs.push({ level: 'info', obj }),
    warn: (obj: Record<string, unknown>) => logs.push({ level: 'warn', obj }),
    error: (obj: Record<string, unknown>) => logs.push({ level: 'error', obj }),
  }),
}));

const { runSnapshotBuild, snapshotBuildJob } = await import('../server/snapshot-job');
const { dashboardSystemCtx } = await import('../server/system-context');

beforeEach(() => {
  lane.ctx = null;
  lane.statements.length = 0;
  lane.built = true;
  lane.calls = 0;
  logs.length = 0;
});

describe('runSnapshotBuild — the payload guard', () => {
  it('a bad payload logs dashboard.snapshot.bad_payload, opens no lane and resolves', async () => {
    for (const bad of [
      null,
      { tenantId: 'x', day: '2026-10-17' },
      { tenantId: TENANT, day: 'ontem' },
      { tenantId: TENANT, day: '2026-10-17', extra: 1 },
    ]) {
      await expect(runSnapshotBuild(bad)).resolves.toBe('dropped');
    }
    expect(lane.calls).toBe(0);
    expect(logs.map((line) => line.obj.event)).toEqual(
      Array(4).fill('dashboard.snapshot.bad_payload'),
    );
    expect(logs.every((line) => line.level === 'warn')).toBe(true);
  });
});

describe('runSnapshotBuild — the build', () => {
  it('runs the builder for the payload day in the zero-user lane, with a statement timeout', async () => {
    await expect(runSnapshotBuild({ tenantId: TENANT, day: '2026-10-17' })).resolves.toBe('built');
    expect(lane.ctx).toEqual(dashboardSystemCtx(TENANT));
    expect(lane.ctx).toMatchObject({
      userId: '00000000-0000-0000-0000-000000000000',
      tenantId: TENANT,
      role: 'support_tenant',
    });
    expect(lane.statements[0]).toContain('statement_timeout');
    expect(lane.statements[1]).toContain('app.dashboard_build_snapshot');
    expect(lane.statements[1]).toContain('2026-10-17');
  });

  it('reports a skipped build when the row already exists, and logs ids and timings only', async () => {
    lane.built = false;
    await expect(runSnapshotBuild({ tenantId: TENANT, day: '2026-10-17' })).resolves.toBe(
      'skipped',
    );
    expect(logs).toHaveLength(1);
    const line = logs[0]?.obj ?? {};
    expect(line.event).toBe('dashboard.snapshot.skipped');
    expect(Object.keys(line).sort()).toEqual(['day', 'event', 'ms', 'tenantId']);
  });

  it('is the dashboard.snapshot-build job, one at a time', () => {
    expect(snapshotBuildJob.name).toBe('dashboard.snapshot-build');
    expect(snapshotBuildJob.concurrency).toBe(1);
  });
});
