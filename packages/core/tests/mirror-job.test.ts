import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `platform.mirror-reconcile` (09.2-09, D-537, DBT-05) at unit level: the queue is a platform queue, the run
 * never throws, it re-arms itself 600 s out under a constant key, and the boot arm uses a different key so a
 * pending re-arm cannot swallow it. The reconcile itself is proved in `mirror-reconcile.test.ts` (integration).
 */

const h = vi.hoisted(() => ({
  enqueued: [] as { name: string; options: Record<string, unknown>; lane: string }[],
  registered: [] as { names: readonly string[]; scope: string | undefined }[],
  reconcile: vi.fn(),
  enqueueFails: false,
  dropDuplicate: false,
}));

vi.mock('../db/platform-tx', () => ({
  withPlatformTx: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ lane: 'platform' })),
}));
vi.mock('../server/jobs/boss', () => ({
  registerJobQueues: vi.fn((names: readonly string[], scope?: string) => {
    h.registered.push({ names, scope });
  }),
  enqueueInTx: vi.fn(
    async (tx: { lane: string }, name: string, _p: unknown, options: Record<string, unknown>) => {
      if (h.enqueueFails) throw new Error('queue down');
      h.enqueued.push({ name, options, lane: tx.lane });
      return h.dropDuplicate ? null : 'job';
    },
  ),
}));
vi.mock('../server/tenancy/mirror', () => ({ reconcileAllMirrors: h.reconcile }));

const {
  armMirrorReconcile,
  mirrorReconcileJob,
  MIRROR_RECONCILE_BOOT_SINGLETON,
  MIRROR_RECONCILE_QUEUE,
  MIRROR_RECONCILE_SINGLETON,
} = await import('../server/tenancy/mirror-job');

beforeEach(() => {
  h.enqueued.length = 0;
  h.enqueueFails = false;
  h.dropDuplicate = false;
  h.reconcile.mockReset();
  h.reconcile.mockResolvedValue({ tenants: 2, healed: 1, failed: 0, results: [] });
});

describe('platform.mirror-reconcile', () => {
  it('is a platform queue named platform.mirror-reconcile', () => {
    expect(MIRROR_RECONCILE_QUEUE).toBe('platform.mirror-reconcile');
    expect(h.registered).toContainEqual({ names: [MIRROR_RECONCILE_QUEUE], scope: 'platform' });
    expect(mirrorReconcileJob.scope).toBe('platform');
    expect(mirrorReconcileJob.name).toBe(MIRROR_RECONCILE_QUEUE);
  });

  it('runs the reconcile and re-arms itself 600 s out under the constant key, from the platform lane', async () => {
    await mirrorReconcileJob.handler({});
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.enqueued).toEqual([
      {
        name: MIRROR_RECONCILE_QUEUE,
        options: { singletonKey: MIRROR_RECONCILE_SINGLETON, startAfter: 600 },
        lane: 'platform',
      },
    ]);
  });

  it('never throws: a failed reconcile still re-arms, a failed re-arm is swallowed', async () => {
    h.reconcile.mockRejectedValue(new Error('central down'));
    await expect(mirrorReconcileJob.handler({})).resolves.toBeUndefined();
    expect(h.enqueued).toHaveLength(1);

    h.enqueueFails = true;
    await expect(mirrorReconcileJob.handler({})).resolves.toBeUndefined();
  });

  it('the boot arm uses a key that is not the re-arm key, and a dropped duplicate is a false', async () => {
    expect(MIRROR_RECONCILE_BOOT_SINGLETON).not.toBe(MIRROR_RECONCILE_SINGLETON);
    expect(await armMirrorReconcile()).toBe(true);
    expect(h.enqueued[0]?.options).toEqual({ singletonKey: MIRROR_RECONCILE_BOOT_SINGLETON });
    h.dropDuplicate = true;
    expect(await armMirrorReconcile()).toBe(false);
  });
});
