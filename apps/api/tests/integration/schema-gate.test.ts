import { createHash } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { setRequiredTenantSchemaForTests } from '@rede-social/core/server/migrations/required';
import {
  defaultMigrationDir,
  type MigrationFile,
  readMigrationDir,
} from '@rede-social/core/server/migrations/sets';
import { migrateAll } from '@rede-social/core/server/projects/migrate';
import {
  armMigrationRetry,
  MIGRATION_RETRY_BOOT_SINGLETON,
  MIGRATION_RETRY_QUEUE,
  MIGRATION_RETRY_SINGLETON,
  migrationRetryJob,
  runMigrationRetry,
} from '@rede-social/core/server/projects/migration-retry-job';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import {
  invalidateTenantHost,
  resolveTenantHost,
} from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type JwksServer, startJwksServer } from './jwks-server';
import { B_ADMIN_URL } from './projects-setup';
import {
  adminSql,
  adminSqlB,
  api,
  HOSTS,
  provisionTenantOnB,
  SEED_PASSWORD,
  signInAs,
  type TenantOnB,
} from './setup';

/**
 * Phase 09.2-15 (DBT-25, D-545; flagged assumption P53): a tenant whose applied schema lacks a version the
 * running image requires is answered `updating` from the cached host mirror with zero extra queries, the other
 * tenants keep running, and a self-re-arming job retries what failed. Real registry, real host cache, the real
 * runner on the second database; the "newer image" is a harmless extra migration file (`gate_probe`) that only
 * this test applies and removes.
 */

// Count the statements the platform lane runs, delegating to the real lane.
const lane = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@rede-social/core/db/platform-tx', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/db/platform-tx')>();
  return {
    ...real,
    withPlatformTx: (...args: Parameters<typeof real.withPlatformTx>) => {
      lane.calls += 1;
      return real.withPlatformTx(...args);
    },
  };
});

const RUN = Date.now().toString(36);
const PROBE = '99999999999999';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const probe = (text: string): MigrationFile => ({
  set: 'tenant',
  version: PROBE,
  name: 'gate_probe',
  text,
  sha256: sha(text),
});
const FIXED = probe('create table if not exists public.gate_probe (id int);');
const BROKEN = probe('select * from public.gate_probe_table_that_does_not_exist;');

type Envelope = { error: { code: string; details?: unknown } };

let files: MigrationFile[] = [];
let required = { count: 0, head: '' };
let withProbe = { count: 0, head: PROBE };
let jwks: JwksServer;
let b: TenantOnB;
let bearer = '';
let labToken = '';

const me = (token: string, host: string) =>
  api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });
const codeOf = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** Run the fan-out for B's project only, with the real files plus (optionally) the probe. */
const migrateB = (extra?: MigrationFile) =>
  migrateAll({
    projectIds: [b.projectId],
    concurrency: 1,
    deps: { loadFiles: async () => (extra ? [...files, extra] : files) },
  });

const stateOfB = async () => {
  const [row] = await adminSql<
    {
      status: string;
      applied_count: number | null;
      applied_head: string | null;
      failed_version: string | null;
      error_code: string | null;
    }[]
  >`
    select status, applied_count, applied_head, failed_version, error_code
      from platform.project_schema_state where project_id = ${b.projectId}::uuid`;
  return row ?? null;
};

/** Removes everything the probe left in B and forgets B's state. */
async function resetProbe(): Promise<void> {
  await adminSqlB`drop table if exists public.gate_probe`;
  await adminSqlB`delete from supabase_migrations.schema_migrations where version = ${PROBE}`;
  await adminSqlB`delete from supabase_migrations.rede_checksums where version = ${PROBE}`;
  await adminSql`delete from platform.project_schema_state where project_id = ${b.projectId}::uuid`;
  setRequiredTenantSchemaForTests(undefined);
  invalidateTenantHost(b.host);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as the seed)');
  files = await readMigrationDir(defaultMigrationDir('tenant'), 'tenant');
  required = { count: files.length, head: files.at(-1)?.version ?? '' };
  withProbe = { count: files.length + 1, head: PROBE };

  jwks = await startJwksServer();
  b = await provisionTenantOnB({ slug: `sg-${RUN}`.slice(0, 40) });
  // B's project answers at the stand-in Auth, and the migration command may open B as `postgres`.
  await adminSql`
    update platform.projects
       set api_url = ${jwks.url}, ddl_url_sealed = ${seal(B_ADMIN_URL, `${b.projectId}:ddl_url`)}
     where id = ${b.projectId}::uuid`;
  invalidateProject(b.tenantId);
  invalidateTenantHost(b.host);
  bearer = await jwks.signBearer({ sub: b.userId, email: b.email });
  labToken = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  await adminSql`delete from pgboss_platform.job where name = ${MIGRATION_RETRY_QUEUE}`;
});

afterEach(resetProbe);

afterAll(async () => {
  await resetProbe();
  await adminSql`delete from pgboss_platform.job where name = ${MIGRATION_RETRY_QUEUE}`;
  await b?.cleanup();
  await jwks?.stop();
  await stopBoss();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('the hold-out and the others (P53)', () => {
  it('behind is held out, others run', async () => {
    // B has applied every file the repository has...
    const first = await migrateB();
    expect(await stateOfB()).toMatchObject({
      status: 'current',
      applied_count: required.count,
      applied_head: required.head,
    });
    invalidateTenantHost(b.host);
    expect((await me(bearer, b.host)).status).toBe(200);

    // ...and the "newer image" requires one more. B's tenants wait, project 0's tenants do not.
    setRequiredTenantSchemaForTests(withProbe);
    invalidateTenantHost(b.host);
    jwks.resetFetches();
    const held = await me(bearer, b.host);
    expect(held.status).toBe(503);
    const body = (await held.json()) as Envelope;
    expect(body.error.code).toBe('TENANT_UPDATING');
    expect(body.error.details).toBeUndefined();
    expect(jwks.fetches).toBe(0);

    const other = await me(labToken, HOSTS.lab);
    expect(other.status).toBe(200);
    expect(first.exitCode).toBe(0);
  }, 120_000);

  it('cache hit costs no query', async () => {
    await migrateB();
    setRequiredTenantSchemaForTests(withProbe);
    invalidateTenantHost(b.host);

    lane.calls = 0;
    expect((await resolveTenantHost(b.host)).kind).toBe('tenant');
    expect(lane.calls).toBeGreaterThan(0);

    // The second answer for the same host, and the request that is turned away by it, run nothing on the lane.
    lane.calls = 0;
    const again = await resolveTenantHost(b.host);
    expect(again).toMatchObject({ kind: 'tenant', status: 'updating' });
    expect(lane.calls).toBe(0);

    const held = await me(bearer, b.host);
    expect(held.status).toBe(503);
    expect(await codeOf(held)).toBe('TENANT_UPDATING');
    expect(lane.calls).toBe(0);
  }, 120_000);

  it('catch up lifts it', async () => {
    await migrateB();
    setRequiredTenantSchemaForTests(withProbe);
    invalidateTenantHost(b.host);
    expect(await codeOf(await me(bearer, b.host))).toBe('TENANT_UPDATING');

    // The fan-out applies the missing file with the real runner and drops the cached host answer itself.
    const result = await migrateB(FIXED);
    expect(result.exitCode).toBe(0);
    expect(result.lines.find((line) => line.kind === 'project')).toMatchObject({
      status: 'current',
      applied: 1,
    });
    expect(await stateOfB()).toMatchObject({
      status: 'current',
      applied_count: withProbe.count,
      applied_head: PROBE,
    });
    const [ledger] = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from supabase_migrations.schema_migrations where version = ${PROBE}`;
    expect(ledger?.n).toBe(1);

    expect((await me(bearer, b.host)).status).toBe(200);
  }, 120_000);

  it('ahead is not behind', async () => {
    await migrateB(FIXED);
    // The database has the probe, the "image" does not (a rolled-back image): nothing is held out.
    setRequiredTenantSchemaForTests(required);
    invalidateTenantHost(b.host);
    expect(await stateOfB()).toMatchObject({ applied_count: withProbe.count, applied_head: PROBE });
    expect((await me(bearer, b.host)).status).toBe(200);
  }, 120_000);
});

describe('platform.migration-retry (D-545)', () => {
  const queued = () =>
    adminSql<{ singleton_key: string | null; delay: number; state: string }[]>`
      select singleton_key,
             extract(epoch from (start_after - created_on))::int as delay,
             state::text as state
        from pgboss_platform.job_common
       where name = ${MIGRATION_RETRY_QUEUE}
       order by created_on`;

  it('retry job: a project left failed by a broken file is retried after the file is fixed and ends current', async () => {
    await migrateB();

    // A broken file fails the project: failed, with the first failing version and a content-free code.
    const broken = await migrateB(BROKEN);
    expect(broken.exitCode).toBe(0);
    expect(broken.lines.find((line) => line.kind === 'project')).toMatchObject({
      status: 'failed',
      errorCode: 'file_failed',
      failedVersion: PROBE,
    });
    expect(JSON.stringify(broken.lines)).not.toContain('gate_probe_table_that_does_not_exist');
    expect(await stateOfB()).toMatchObject({
      status: 'failed',
      failed_version: PROBE,
      error_code: 'file_failed',
      applied_count: required.count,
    });

    // One run of the job's pass, with the file now fixed: B is picked up and ends current.
    const pass = await runMigrationRetry({ deps: { loadFiles: async () => [...files, FIXED] } });
    expect(pass.retried).toBeGreaterThanOrEqual(1);
    expect(pass.healed).toBeGreaterThanOrEqual(1);
    expect(await stateOfB()).toMatchObject({
      status: 'current',
      failed_version: null,
      error_code: null,
      applied_count: withProbe.count,
    });

    // Nothing left to retry: a pass retries nobody.
    expect((await runMigrationRetry()).retried).toBe(0);
  }, 180_000);

  it('is a platform queue; a run never throws and re-arms itself 300 s out under the constant key', async () => {
    expect(MIGRATION_RETRY_QUEUE).toBe('platform.migration-retry');
    expect(migrationRetryJob.scope).toBe('platform');
    await adminSql`delete from pgboss_platform.job where name = ${MIGRATION_RETRY_QUEUE}`;

    await expect(migrationRetryJob.handler({})).resolves.toBeUndefined();
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ singleton_key: MIGRATION_RETRY_SINGLETON, state: 'created' });
    expect(rows[0]?.delay).toBe(300);

    // A second run while a re-arm waits adds no second waiting job.
    await expect(migrationRetryJob.handler({})).resolves.toBeUndefined();
    expect((await queued()).filter((job) => job.state === 'created')).toHaveLength(1);
  });

  it('the boot arm uses a key that is not the re-arm key, and a duplicate boot arm is dropped', async () => {
    await adminSql`delete from pgboss_platform.job where name = ${MIGRATION_RETRY_QUEUE}`;
    expect(MIGRATION_RETRY_BOOT_SINGLETON).not.toBe(MIGRATION_RETRY_SINGLETON);
    expect(await armMigrationRetry()).toBe(true);
    expect(await armMigrationRetry()).toBe(false);
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ singleton_key: MIGRATION_RETRY_BOOT_SINGLETON });
    expect(rows[0]?.delay).toBe(0);
  });
});
