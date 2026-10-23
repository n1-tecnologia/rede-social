import { sqlClient } from '@rede-social/core/db';
// biome-ignore lint/style/noRestrictedImports: this suite enqueues from the lanes to prove the supervisor reads what they write
import { withAdminTx } from '@rede-social/core/db/admin-tx';
// biome-ignore lint/style/noRestrictedImports: this suite enqueues from the lanes to prove the supervisor reads what they write
import { withPlatformTx } from '@rede-social/core/db/platform-tx';
import {
  createBoss,
  createQueues,
  enqueueInTx,
  registerJobQueues,
  sessionConnectionString,
  stopBoss,
} from '@rede-social/core/server/jobs/boss';
import type { AnyJobDefinition } from '@rede-social/core/server/modules/manifest';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  centralProjectId,
  closeAllPools,
  listReadyProjects,
} from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupervisor, type SupervisedBoss } from '../../src/worker-supervisor';
import { adminSql, adminSqlB, provisionTenantOnB, TENANT_B_URL, type TenantOnB } from './setup';

/**
 * Phase 09.2-09 (DBT-30, D-546, P61, T-09.2-41): the REAL supervisor against the real local databases. Project 0
 * is the central project, `rede_tenant_b` is registered as a second project with a sealed session URL, and a
 * third project points at a port nobody listens on. The jobs are throwaway queues of this suite, so no real
 * handler runs.
 *
 *  - a tenant job enqueued for the tenant in B is run by B's instance with `{ projectId }` of B and completes
 *    in B's own `pgboss.job`; a project-0 tenant job runs on project 0's instance;
 *  - a platform job is run by the platform instance and completes in the central `pgboss_platform.job`;
 *  - the unreachable project backs off alone and never delays the others;
 *  - making B unreachable does not stop project 0's processing.
 */

const RUN = Date.now().toString(36);
const TENANT_QUEUE = `test.sup-tenant-${RUN}`;
const PLATFORM_QUEUE = `test.sup-platform-${RUN}`;
registerJobQueues([TENANT_QUEUE]);
registerJobQueues([PLATFORM_QUEUE], 'platform');

const handled: { queue: string; data: Record<string, unknown>; projectId: string | undefined }[] =
  [];
const job = (name: string, scope?: 'platform'): AnyJobDefinition => ({
  name,
  scope,
  handler: async (data: Record<string, unknown>, ctx?: { projectId: string }) => {
    handled.push({ queue: name, data, projectId: ctx?.projectId });
  },
});

let b: TenantOnB;
let central = '';
let demoTenantId = '';
let deadProjectId = '';
const deadRef = `dead-${RUN}`.slice(0, 30);
let supervisor: ReturnType<typeof createSupervisor> | undefined;

async function waitFor(check: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('condition not met in time');
}
const handledBy = (queue: string, tag: string) =>
  handled.find((h) => h.queue === queue && h.data.tag === tag);

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: `sup-b-${RUN}`.slice(0, 40) });
  central = await centralProjectId();
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = demo?.id ?? '';
  // B's SESSION url (the supervisor's polling connection); the local stack has one door, so it is the same URL.
  await adminSql`
    update platform.projects
       set database_url_session_sealed = ${seal(TENANT_B_URL, `${b.projectId}:database_url_session`)}
     where id = ${b.projectId}::uuid`;
  // A project that is "ready" but whose database nobody serves.
  deadProjectId = crypto.randomUUID();
  const deadUrl = 'postgres://api_user:postgres@127.0.0.1:1/nope';
  await adminSql`
    insert into platform.projects
           (id, ref, provider, credential_source, state, api_url, secret_key_id,
            database_url_tx_sealed, database_url_session_sealed)
    values (${deadProjectId}::uuid, ${deadRef}, 'fake', 'sealed', 'ready', 'http://127.0.0.1:54321', 1,
            ${seal(deadUrl, `${deadProjectId}:database_url_tx`)},
            ${seal(deadUrl, `${deadProjectId}:database_url_session`)})`;
});

afterAll(async () => {
  await supervisor?.stop();
  await stopBoss();
  await adminSql`alter database rede_tenant_b with allow_connections true`;
  for (const db of [adminSql, adminSqlB]) {
    await db`delete from pgboss.job_common where name = ${TENANT_QUEUE}`;
    await db`select pgboss.delete_queue(${TENANT_QUEUE}) where exists (select 1 from pgboss.queue where name = ${TENANT_QUEUE})`;
  }
  await adminSql`delete from pgboss_platform.job_common where name = ${PLATFORM_QUEUE}`;
  await adminSql`select pgboss_platform.delete_queue(${PLATFORM_QUEUE}) where exists (select 1 from pgboss_platform.queue where name = ${PLATFORM_QUEUE})`;
  await adminSql`delete from platform.projects where id = ${deadProjectId}::uuid`;
  await b?.cleanup();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('the real supervisor over two databases plus a dead one', () => {
  it('starts the platform instance and the reachable projects, and backs the dead project off alone', async () => {
    const ours = new Set([central, b.projectId, deadProjectId]);
    const centralUrl = process.env.BOSS_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
    supervisor = createSupervisor({
      listProjects: async () => (await listReadyProjects()).filter((p) => ours.has(p.id)),
      makeBoss: (target) =>
        createBoss(
          target.scope === 'platform'
            ? { connectionString: centralUrl, max: 2, scope: 'platform' }
            : {
                connectionString: sessionConnectionString(target.project, centralUrl),
                max: 2,
                scope: 'tenant',
              },
        ) as unknown as SupervisedBoss,
      createQueues: (boss, names) => createQueues(boss as never, names),
      centralProjectId: async () => central,
      platformJobs: [job(PLATFORM_QUEUE, 'platform')],
      tenantJobs: [job(TENANT_QUEUE)],
      now: () => Date.now(),
      schedule: () => () => undefined,
      random: Math.random,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    await supervisor.start();

    const state = supervisor.state();
    expect(state.platform).toBe(true);
    expect(state.projects.map((p) => p.projectId).sort()).toEqual([b.projectId, central].sort());
    expect(state.backoff.map((x) => x.projectId)).toEqual([deadProjectId]);
    expect(state.backoff[0]?.attempts).toBe(1);
  }, 60_000);

  it("runs a tenant job enqueued for the tenant in B on B's instance, and leaves it completed in B's own pgboss.job", async () => {
    await withAdminTx({ tenantId: b.tenantId }, (tx) =>
      enqueueInTx(tx, TENANT_QUEUE, { tag: 'b' }, { singletonKey: `sup-b-${RUN}` }),
    );
    await waitFor(() => handledBy(TENANT_QUEUE, 'b') !== undefined);
    expect(handledBy(TENANT_QUEUE, 'b')?.projectId).toBe(b.projectId);

    await waitFor(async () => {
      const [row] = await adminSqlB<{ state: string }[]>`
        select state::text as state from pgboss.job_common
         where name = ${TENANT_QUEUE} and data->>'tag' = 'b'`;
      return row?.state === 'completed';
    });
    const [inCentral] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss.job_common where name = ${TENANT_QUEUE} and data->>'tag' = 'b'`;
    expect(inCentral?.n).toBe(0);
  }, 40_000);

  it("runs a project-0 tenant job on project 0's instance", async () => {
    await withAdminTx({ tenantId: demoTenantId }, (tx) =>
      enqueueInTx(tx, TENANT_QUEUE, { tag: 'c' }, { singletonKey: `sup-c-${RUN}` }),
    );
    await waitFor(() => handledBy(TENANT_QUEUE, 'c') !== undefined);
    expect(handledBy(TENANT_QUEUE, 'c')?.projectId).toBe(central);
  }, 40_000);

  it('runs a platform job on the platform instance and completes it in pgboss_platform', async () => {
    await withPlatformTx((tx) =>
      enqueueInTx(tx, PLATFORM_QUEUE, { tag: 'p' }, { singletonKey: `sup-p-${RUN}` }),
    );
    await waitFor(() => handledBy(PLATFORM_QUEUE, 'p') !== undefined);
    expect(handledBy(PLATFORM_QUEUE, 'p')?.projectId).toBe(central);
    await waitFor(async () => {
      const [row] = await adminSql<{ state: string }[]>`
        select state::text as state from pgboss_platform.job_common where name = ${PLATFORM_QUEUE}`;
      return row?.state === 'completed';
    });
  }, 40_000);

  it('a project that becomes unreachable does not stop project 0 from processing', async () => {
    // Close the door of B and drop every connection to it.
    await adminSql`alter database rede_tenant_b with allow_connections false`;
    await adminSql`
      select pg_terminate_backend(pid) from pg_stat_activity
       where datname = 'rede_tenant_b' and pid <> pg_backend_pid()`;
    try {
      await withAdminTx({ tenantId: demoTenantId }, (tx) =>
        enqueueInTx(tx, TENANT_QUEUE, { tag: 'c2' }, { singletonKey: `sup-c2-${RUN}` }),
      );
      await waitFor(() => handledBy(TENANT_QUEUE, 'c2') !== undefined);
      expect(handledBy(TENANT_QUEUE, 'c2')?.projectId).toBe(central);
    } finally {
      await adminSql`alter database rede_tenant_b with allow_connections true`;
    }
  }, 60_000);

  it('stops every instance on stop()', async () => {
    await supervisor?.stop();
    expect(supervisor?.state()).toMatchObject({ platform: false, projects: [] });
  }, 60_000);
});
