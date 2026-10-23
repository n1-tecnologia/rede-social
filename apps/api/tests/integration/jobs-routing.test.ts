import { sqlClient } from '@rede-social/core/db';
// biome-ignore lint/style/noRestrictedImports: this suite proves the kernel's lane-to-queue routing, which needs the lanes themselves
import { withAdminTx } from '@rede-social/core/db/admin-tx';
// biome-ignore lint/style/noRestrictedImports: this suite proves the kernel's lane-to-queue routing, which needs the lanes themselves
import { withPlatformTx } from '@rede-social/core/db/platform-tx';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { DOMAIN_VERIFY_QUEUE } from '@rede-social/core/server/domains/types';
import { activeSenders, enqueueInTx, stopBoss } from '@rede-social/core/server/jobs/boss';
import { MEDIA_SWEEP_QUEUE } from '@rede-social/core/server/media/sweep-job';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, adminSqlB, provisionTenantOnB, type TenantOnB } from './setup';

// The kernel-owned platform queues register themselves when their barrels load.
await import('@rede-social/core/server/domains/index');
await import('@rede-social/core/server/platform/invite-send');

/**
 * Phase 09.2-09, the tracer (DBT-29, DBT-38, D-546, T-09.2-40): a job lands in the database that owns the
 * transaction it was enqueued in, and in the schema its scope names. pg-boss reads the queue definition from
 * the SENDER's own database, so a wrong sender would put one tenant's payload into another tenant's project.
 *
 *  - a tenant-queue enqueue inside a tenant-lane or admin-lane transaction of a tenant living in database B
 *    lands in B's `pgboss.job` and in no other database;
 *  - the same enqueue for a tenant of project 0 still lands in the central `pgboss.job`;
 *  - a platform-queue enqueue inside `withPlatformTx` lands in the central `pgboss_platform.job`;
 *  - a platform queue from a tenant transaction, and a tenant queue from a platform transaction, throw before
 *    anything is written.
 */

const RUN = Date.now().toString(36);
const key = (name: string) => `routing-${RUN}-${name}`;
const KEYS = {
  adminB: key('admin-b'),
  tenantB: key('tenant-b'),
  central: key('central'),
  platform: key('platform'),
  wrongA: key('wrong-a'),
  wrongB: key('wrong-b'),
  wrongC: key('wrong-c'),
};

let b: TenantOnB;
let demoTenantId = '';

type Row = { name: string; singleton_key: string | null; data: Record<string, unknown> };

/** Rows this run created, in one database and one pg-boss schema. */
async function rows(db: typeof adminSql, schema: 'pgboss' | 'pgboss_platform'): Promise<Row[]> {
  return db.unsafe<Row[]>(
    `select name, singleton_key, data from ${schema}.job_common where singleton_key like $1 order by singleton_key`,
    [`routing-${RUN}-%`],
  );
}

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: `jr-b-${RUN}`.slice(0, 40) });
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = demo?.id ?? '';
});

afterAll(async () => {
  await adminSql`delete from pgboss.job_common where singleton_key like ${`routing-${RUN}-%`}`;
  await adminSql`delete from pgboss_platform.job_common where singleton_key like ${`routing-${RUN}-%`}`;
  await adminSqlB`delete from pgboss.job_common where singleton_key like ${`routing-${RUN}-%`}`;
  await b?.cleanup();
  await stopBoss();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer: a job lands in its own database', () => {
  it('an admin-lane enqueue for a tenant living in B lands in B and in no other database', async () => {
    const id = await withAdminTx({ tenantId: b.tenantId }, (tx) =>
      enqueueInTx(tx, MEDIA_SWEEP_QUEUE, { probe: 'admin-b' }, { singletonKey: KEYS.adminB }),
    );
    expect(id).not.toBeNull();

    const inB = await rows(adminSqlB, 'pgboss');
    expect(inB.map((row) => row.singleton_key)).toContain(KEYS.adminB);
    expect(inB.find((row) => row.singleton_key === KEYS.adminB)).toMatchObject({
      name: MEDIA_SWEEP_QUEUE,
      data: { probe: 'admin-b' },
    });
    expect((await rows(adminSql, 'pgboss')).map((row) => row.singleton_key)).not.toContain(
      KEYS.adminB,
    );
    expect((await rows(adminSql, 'pgboss_platform')).map((row) => row.singleton_key)).not.toContain(
      KEYS.adminB,
    );
  });

  it('a tenant-lane enqueue for a tenant living in B lands in B, with the caller role restored afterwards', async () => {
    const role = await withTenantTx(
      { userId: b.userId, tenantId: b.tenantId, role: 'member' },
      async (tx) => {
        await enqueueInTx(
          tx,
          MEDIA_SWEEP_QUEUE,
          { probe: 'tenant-b' },
          { singletonKey: KEYS.tenantB },
        );
        const [r] = await tx.execute<{ role: string }>(sql`select current_role as role`);
        return r?.role;
      },
    );
    expect(role).toBe('authenticated');
    expect((await rows(adminSqlB, 'pgboss')).map((row) => row.singleton_key)).toContain(
      KEYS.tenantB,
    );
    expect((await rows(adminSql, 'pgboss')).map((row) => row.singleton_key)).not.toContain(
      KEYS.tenantB,
    );
  });

  it('a project-0 tenant still lands in the central pgboss schema, exactly as before', async () => {
    await withAdminTx({ tenantId: demoTenantId }, (tx) =>
      enqueueInTx(tx, MEDIA_SWEEP_QUEUE, { probe: 'central' }, { singletonKey: KEYS.central }),
    );
    expect((await rows(adminSql, 'pgboss')).map((row) => row.singleton_key)).toContain(
      KEYS.central,
    );
    expect((await rows(adminSqlB, 'pgboss')).map((row) => row.singleton_key)).not.toContain(
      KEYS.central,
    );
  });

  it('a platform enqueue lands in the central pgboss_platform schema and nowhere else', async () => {
    await withPlatformTx((tx) =>
      enqueueInTx(
        tx,
        DOMAIN_VERIFY_QUEUE,
        { domainId: crypto.randomUUID() },
        { singletonKey: KEYS.platform },
      ),
    );
    expect((await rows(adminSql, 'pgboss_platform')).map((row) => row.singleton_key)).toEqual([
      KEYS.platform,
    ]);
    expect((await rows(adminSql, 'pgboss')).map((row) => row.singleton_key)).not.toContain(
      KEYS.platform,
    );
    expect((await rows(adminSqlB, 'pgboss')).map((row) => row.singleton_key)).not.toContain(
      KEYS.platform,
    );
  });
});

describe('the scope guard refuses before it writes', () => {
  it('a platform queue from an admin-lane transaction throws and leaves no row', async () => {
    await expect(
      withAdminTx({ tenantId: b.tenantId }, (tx) =>
        enqueueInTx(
          tx,
          DOMAIN_VERIFY_QUEUE,
          { domainId: crypto.randomUUID() },
          { singletonKey: KEYS.wrongA },
        ),
      ),
    ).rejects.toThrow(`enqueueInTx: ${DOMAIN_VERIFY_QUEUE} is a platform queue`);
  });

  it('a platform queue from a tenant-lane transaction throws and leaves no row', async () => {
    await expect(
      withTenantTx({ userId: b.userId, tenantId: b.tenantId, role: 'member' }, (tx) =>
        enqueueInTx(
          tx,
          DOMAIN_VERIFY_QUEUE,
          { domainId: crypto.randomUUID() },
          { singletonKey: KEYS.wrongB },
        ),
      ),
    ).rejects.toThrow('is a platform queue');
  });

  it('a tenant queue from a platform transaction throws and leaves no row', async () => {
    await expect(
      withPlatformTx((tx) => enqueueInTx(tx, MEDIA_SWEEP_QUEUE, {}, { singletonKey: KEYS.wrongC })),
    ).rejects.toThrow(`enqueueInTx: ${MEDIA_SWEEP_QUEUE} is a tenant queue`);
  });

  it('none of the refused enqueues wrote a row anywhere', async () => {
    const wrong = [KEYS.wrongA, KEYS.wrongB, KEYS.wrongC];
    for (const [db, schema] of [
      [adminSql, 'pgboss'],
      [adminSql, 'pgboss_platform'],
      [adminSqlB, 'pgboss'],
    ] as const) {
      const keys = (await rows(db, schema)).map((row) => row.singleton_key);
      for (const k of wrong) expect(keys).not.toContain(k);
    }
  });
});

describe('senders', () => {
  it('there is one sender per project and scope, and stopBoss closes them all', async () => {
    const senders = activeSenders();
    // central tenant scope, B tenant scope, central platform scope
    expect(senders).toHaveLength(3);
    expect(senders.filter((s) => s.endsWith(':platform'))).toHaveLength(1);
    expect(senders.filter((s) => s.endsWith(':tenant'))).toHaveLength(2);
    expect(senders.some((s) => s.startsWith(`${b.projectId}:`))).toBe(true);
    await stopBoss();
    expect(activeSenders()).toEqual([]);
  });
});
