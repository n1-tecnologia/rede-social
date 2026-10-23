import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sqlClient } from '@rede-social/core/db';
import { createBoss, createQueues, stopBoss } from '@rede-social/core/server/jobs/boss';
import { runBootstrap } from '@rede-social/core/server/projects/bootstrap';
import { createFakeProjectProvider } from '@rede-social/core/server/projects/fake';
import {
  assertCoverage,
  type CopyOptions,
  copyAuth,
  copyRows,
  copyStorage,
  MoveError,
  type MoveSide,
  planMove,
  requeueJobs,
  type StoragePort,
  scanForOrigin,
  storageTotalsOf,
  supabaseStoragePort,
  type VerifyReport,
  verifyCopy,
} from '@rede-social/core/server/projects/move/index';
import { defaultSecrets } from '@rede-social/core/server/projects/steps';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminSql } from './setup';

/**
 * Phase 09.2-22 (DBT-33, D-534, D-536, D-533): the copy engine of the move tool, rehearsed end to end on TWO
 * real local databases. The SOURCE is the local stack's project 0 database (`postgres`, holding the seeded
 * tenants `rede-lab` and `rede-demo`); the TARGET is `rede_tenant_b`, reset between cases. Nothing here touches
 * a hosted project; Storage is exercised against the local stack with throwaway buckets of a few bytes.
 *
 * The source is never written by the engine; the cases that need a source fixture (a second membership, a
 * throwaway table, a job) create it and remove exactly that in `finally`.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SRC_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const TGT_URL = 'postgres://postgres:postgres@127.0.0.1:54322/rede_tenant_b';
const API_USER_SRC = 'postgres://api_user:postgres@127.0.0.1:54322/postgres';
const API_USER_TGT = 'postgres://api_user:postgres@127.0.0.1:54322/rede_tenant_b';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const RUN = Date.now().toString(36);

const open = (url: string) =>
  postgres(url, { max: 4, prepare: false, onnotice: () => undefined, idle_timeout: 2 });

const clients: postgres.Sql[] = [];
function connect(url: string): postgres.Sql {
  const client = open(url);
  clients.push(client);
  return client;
}

function resetB(mode: 'migrated' | 'bare'): void {
  execFileSync(
    'bash',
    ['scripts/db-two-databases.sh', '--reset', ...(mode === 'bare' ? ['--bare'] : [])],
    {
      cwd: ROOT,
      timeout: 120_000,
      stdio: 'pipe',
    },
  );
}

let source: postgres.Sql;
let labId = '';
let demoId = '';

const side = (sql: postgres.Sql, tenantId: string, projectId: string): MoveSide => ({
  sql,
  tenantId,
  projectId,
});

/** What the bootstrap's `tenant` step leaves in a new project: the tenant row and its module rows. */
async function seedTargetTenant(target: postgres.Sql, tenantId: string): Promise<void> {
  const [row] = await source<{ tenant: string; modules: string }[]>`
    select (select to_jsonb(t)::text from public.tenants t where t.id = ${tenantId}::uuid) as tenant,
           (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)::text
              from public.tenant_modules m where m.tenant_id = ${tenantId}::uuid) as modules`;
  await target.begin(async (tx) => {
    await tx.unsafe(
      `insert into public.tenants select * from jsonb_populate_record(null::public.tenants, $1::text::jsonb)`,
      [row?.tenant ?? '{}'],
    );
    await tx.unsafe(
      `insert into public.tenant_modules select * from jsonb_populate_recordset(null::public.tenant_modules, $1::text::jsonb)`,
      [row?.modules ?? '[]'],
    );
  });
}

/** A migrated, fixture-free `rede_tenant_b` that holds the tenant row, like a bootstrapped project does. */
async function freshTarget(tenantId: string): Promise<postgres.Sql> {
  resetB('migrated');
  const target = connect(TGT_URL);
  await seedTargetTenant(target, tenantId);
  return target;
}

const qi = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function tenantCounts(db: postgres.Sql, tenantId: string, tables: string[]) {
  const out: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await db.unsafe(
      `select count(*)::int as n from public.${qi(table)} where tenant_id = $1::uuid`,
      [tenantId],
    );
    out[table] = Number(row?.n ?? 0);
  }
  return out;
}

/** Whole-table counts of the source: the proof that a run did not change it. */
async function sourceFingerprint(): Promise<Record<string, number>> {
  const tables = await source<{ name: string }[]>`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by 1`;
  const out: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = await source.unsafe(`select count(*)::int as n from public.${qi(name)}`);
    out[name] = Number(row?.n ?? 0);
  }
  const [auth] = await source`select count(*)::int as n from auth.users`;
  const [identities] = await source`select count(*)::int as n from auth.identities`;
  out['auth.users'] = Number(auth?.n ?? 0);
  out['auth.identities'] = Number(identities?.n ?? 0);
  return out;
}

async function fullMove(target: postgres.Sql, tenantId: string, copyOptions: CopyOptions = {}) {
  const src = side(source, tenantId, 'p0');
  const tgt = side(target, tenantId, 'tb');
  const plan = await planMove(src, tgt);
  assertCoverage(plan);
  const auth = await copyAuth(src, tgt);
  const rows = await copyRows(plan, src, tgt, copyOptions);
  return { src, tgt, plan, auth, rows };
}

beforeAll(async () => {
  source = connect(SRC_URL);
  const tenants = await source<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  labId = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  demoId = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  expect(labId).toBeTruthy();
  expect(demoId).toBeTruthy();
});

afterEach(async () => {
  // Whatever a case left on the source's wire; the cases remove their own fixtures in `finally`.
  await source`select 1`;
});

afterAll(async () => {
  await adminSql`alter role api_user with login password 'postgres'`;
  await stopBoss();
  await closeAllPools();
  for (const client of clients) await client.end({ timeout: 5 });
  await adminSql.end();
  await sqlClient.end();
  // Leave `rede_tenant_b` as the other suites expect it: the tenant set applied and no fixtures.
  resetB('migrated');
});

// ---------------------------------------------------------------------------------------------------------
// Task 1: the tracer
// ---------------------------------------------------------------------------------------------------------

describe('the tracer: a seeded tenant is copied into a bootstrapped second database', () => {
  it('copies rede-lab', async () => {
    // A BOOTSTRAPPED target (plan 13 engine, fake provider), whose tenant seed names rede-lab although the
    // tenant stays bound to project 0 (the seam of this plan: `tenantsToSeed`).
    resetB('bare');
    const projectId = crypto.randomUUID();
    const ref = `mv-${randomBytes(6).toString('hex')}`;
    await adminSql`
      insert into platform.projects (id, ref, provider, credential_source, state, api_url)
      values (${projectId}::uuid, ${ref}, 'fake', 'sealed', 'preparing', '')`;
    try {
      const provider = createFakeProjectProvider({
        targets: {
          [ref]: {
            apiUrl: SUPABASE_URL,
            host: '127.0.0.1',
            port: 54322,
            txPort: 54322,
            dbName: 'rede_tenant_b',
            buckets: [
              { id: 'branding', name: 'branding', public: true },
              { id: 'media', name: 'media', public: false },
            ],
          },
        },
      });
      const outcome = await runBootstrap(projectId, {
        provider,
        tenantsToSeed: async () => [labId],
        connect: (kind, url) =>
          postgres(kind === 'ddl' ? TGT_URL : url, {
            max: 1,
            prepare: false,
            connect_timeout: 10,
            idle_timeout: 2,
            onnotice: () => undefined,
          }),
        secrets: {
          ...defaultSecrets,
          // The local cluster shares its roles: a generated password would lock project 0 out of api_user.
          apiUserPassword: () => 'postgres',
        },
        config: () => ({
          platformOrigin: 'https://app.example.test',
          apiPublicUrl: 'https://api.example.test',
          mailDomain: 'mail.example.test',
          smtpPass: `SMTP${randomBytes(12).toString('hex')}`,
        }),
        sendInvites: async () => undefined,
      });
      expect(outcome).toEqual({ status: 'ready' });
    } finally {
      await adminSql`delete from platform.projects where id = ${projectId}::uuid`;
    }

    const target = connect(TGT_URL);
    const [seeded] = await target`select count(*)::int as n from public.tenants`;
    expect(seeded?.n).toBe(1);

    const before = await sourceFingerprint();
    const src = side(source, labId, 'p0');
    const tgt = side(target, labId, 'tb');

    const plan = await planMove(src, tgt);
    expect(plan.uncovered).toEqual([]);
    expect(plan.schemaMismatch).toEqual([]);
    expect(plan.targetChecked).toBe(true);
    assertCoverage(plan);
    const sourceCounts = await tenantCounts(
      source,
      labId,
      plan.tables.map((t) => t.name),
    );
    for (const entry of plan.tables) expect(entry.rows).toBe(sourceCounts[entry.name]);
    expect(plan.authUsers).toBe(7);

    const auth = await copyAuth(src, tgt);
    expect(auth.accounts).toBe(7);
    expect(auth.usersWritten).toBe(7);

    const rows = await copyRows(plan, src, tgt, {
      origins: { from: SUPABASE_URL, to: 'https://target-ref.supabase.co' },
    });
    expect(rows.tenantUpdated).toBe(true);

    const report = await verifyCopy(plan, src, tgt, {
      oldOrigin: SUPABASE_URL,
      newOrigin: 'https://target-ref.supabase.co',
    });
    expect(report.ok).toBe(true);

    // Every table's tenant row count in the target equals the source's.
    const targetCounts = await tenantCounts(
      target,
      labId,
      plan.tables.map((t) => t.name),
    );
    expect(targetCounts).toEqual(sourceCounts);
    // The seed is not empty: the copy moved real rows in most modules.
    expect(Object.values(targetCounts).reduce((a, b) => a + b, 0)).toBeGreaterThan(150);

    // Nothing of any other tenant exists in the target, in any table or in Auth.
    for (const table of plan.tables) {
      const [foreign] = await target.unsafe(
        `select count(*)::int as n from public.${qi(table.name)} where tenant_id <> $1::uuid`,
        [labId],
      );
      expect(foreign?.n).toBe(0);
    }
    const [demoRows] =
      await target`select count(*)::int as n from public.tenants where id = ${demoId}::uuid`;
    expect(demoRows?.n).toBe(0);
    const [demoUsers] = await target`
      select count(*)::int as n from auth.users where email like '%@rede-demo.local'`;
    expect(demoUsers?.n).toBe(0);

    // The source did not change.
    expect(await sourceFingerprint()).toEqual(before);
  });

  it('derives the order from the real catalog: the deferrable cycle is one group, replies follow their post', async () => {
    const plan = await planMove(side(source, labId, 'p0'));
    expect(plan.targetChecked).toBe(false);
    expect(plan.uncovered).toEqual([]);
    expect([...plan.special].sort()).toEqual(['tenant_modules', 'tenants', 'users']);

    const group = plan.groups.find((g) => g.includes('events'));
    expect(group).toEqual(['event_secrets', 'events']);
    expect(plan.order.indexOf('feed_posts')).toBeLessThan(plan.order.indexOf('feed_comments'));
    expect(plan.order.indexOf('events')).toBeLessThan(plan.order.indexOf('event_attendances'));
    expect(plan.tables.map((t) => t.name)).not.toContain('tenant_domains');
    expect(plan.tables.map((t) => t.name)).not.toContain('tenant_modules');
    // The table set is the catalog's, not a list: 57 public tables minus the five without tenant_id,
    // tenant_domains and tenant_modules.
    expect(plan.tables.length).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Task 2: URLs, jobs, checksums, Storage
// ---------------------------------------------------------------------------------------------------------

const NEW_ORIGIN = 'https://tgt-ref.supabase.co';

describe('URLs, queued jobs, checksums and files', () => {
  it('rewrites the branding URLs to the target origin and leaves nothing of the old one', async () => {
    const target = await freshTarget(labId);
    // The copy rewrites the public branding URLs while it copies the mirrored tenant row.
    const { src, tgt, plan } = await fullMove(target, labId, {
      origins: { from: SUPABASE_URL, to: NEW_ORIGIN },
    });

    const [row] = await target<
      { branding: { logoUrl: string; iconUrls: Record<string, string> } }[]
    >`
      select branding from public.tenants where id = ${labId}::uuid`;
    expect(
      row?.branding.iconUrls.i192?.startsWith(`${NEW_ORIGIN}/storage/v1/object/public/branding/`),
    ).toBe(true);
    // A relative logo is not a storage URL: untouched.
    expect(row?.branding.logoUrl).toBe('/seed-logos/rede-lab.svg');

    expect(
      await scanForOrigin(
        target,
        plan.tables.map((t) => t.name).concat('tenants'),
        SUPABASE_URL,
        labId,
      ),
    ).toEqual([]);
    const report = await verifyCopy(plan, src, tgt, {
      oldOrigin: SUPABASE_URL,
      newOrigin: NEW_ORIGIN,
    });
    expect(report.leftovers).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('fails with origin_leftover when the old origin survives anywhere in the copied data', async () => {
    const target = await freshTarget(labId);
    const [original] = await source<{ rules_text: string }[]>`
      select rules_text from public.tenants where id = ${labId}::uuid`;
    try {
      // A reference that is NOT a public branding URL: the rewrite must leave it and the scan must find it.
      await source`
        update public.tenants set rules_text = rules_text || ${` ${SUPABASE_URL}/storage/v1/object/sign/media/x`}
         where id = ${labId}::uuid`;
      const { src, tgt, plan } = await fullMove(target, labId, {
        origins: { from: SUPABASE_URL, to: NEW_ORIGIN },
      });
      let caught: unknown;
      try {
        await verifyCopy(plan, src, tgt, { oldOrigin: SUPABASE_URL, newOrigin: NEW_ORIGIN });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MoveError);
      expect((caught as MoveError).code).toBe('origin_leftover');
      expect((caught as MoveError).tables).toEqual(['tenants.rules_text']);
      // The message names a column, never the text.
      expect((caught as MoveError).message).not.toContain('storage/v1');
    } finally {
      await source`update public.tenants set rules_text = ${original?.rules_text ?? ''} where id = ${labId}::uuid`;
    }
  });

  it('re-sends the waiting jobs of the tenant to the target and cancels them in the source', async () => {
    const target = await freshTarget(labId);
    const stranger = crypto.randomUUID();
    const queue = 'kernel.media-provider-event';
    const sourceBoss = createBoss({
      connectionString: API_USER_SRC,
      max: 1,
      supervise: false,
      schedule: false,
    });
    const targetBoss = createBoss({
      connectionString: API_USER_TGT,
      max: 1,
      supervise: false,
      schedule: false,
    });
    sourceBoss.on('error', () => undefined);
    targetBoss.on('error', () => undefined);
    await sourceBoss.start();
    await targetBoss.start();
    const mine = `mv-${RUN}-mine`;
    const others = `mv-${RUN}-other`;
    try {
      await createQueues(sourceBoss, [queue]);
      const startAfter = new Date(Date.now() + 3_600_000);
      const mineId = await sourceBoss.send(
        queue,
        { tenantId: labId, marker: mine },
        { singletonKey: mine, startAfter },
      );
      const otherId = await sourceBoss.send(
        queue,
        { tenantId: stranger, marker: others },
        { singletonKey: others, startAfter },
      );
      expect(mineId).toBeTruthy();
      expect(otherId).toBeTruthy();
      const waitingBefore = await source`
        select count(*)::int as n from pgboss.job where state in ('created','retry') and data ->> 'tenantId' is null`;

      // The throwaway jobs carry a tenant id of their own (`stranger`) and a marker: the seeded tenants' real
      // waiting jobs stay in the source, so the case never changes them.
      const result = await requeueJobs(
        { source: { sql: source, boss: sourceBoss }, target: { boss: targetBoss } },
        stranger,
      );
      expect(result.requeued).toBe(1);

      const inTarget = await target<
        { data: { tenantId: string }; singleton_key: string; start_after: Date; state: string }[]
      >`
        select data, singleton_key, start_after, state::text as state from pgboss.job where name = ${queue}`;
      expect(inTarget).toHaveLength(1);
      expect(inTarget[0]?.data.tenantId).toBe(stranger);
      expect(inTarget[0]?.singleton_key).toBe(others);
      expect(
        Math.abs((inTarget[0]?.start_after.getTime() ?? 0) - startAfter.getTime()),
      ).toBeLessThan(2000);

      const [movedSource] =
        await source`select state::text as state from pgboss.job where id = ${otherId}::uuid`;
      expect(movedSource?.state).toBe('cancelled');
      // Another tenant's job and the jobs without a tenant stay exactly as they were.
      const [kept] =
        await source`select state::text as state from pgboss.job where id = ${mineId}::uuid`;
      expect(kept?.state).toBe('created');
      const waitingAfter = await source`
        select count(*)::int as n from pgboss.job where state in ('created','retry') and data ->> 'tenantId' is null`;
      expect(waitingAfter[0]?.n).toBe(waitingBefore[0]?.n);

      // A second run finds nothing left to move.
      expect(
        (
          await requeueJobs(
            { source: { sql: source, boss: sourceBoss }, target: { boss: targetBoss } },
            stranger,
          )
        ).requeued,
      ).toBe(0);
    } finally {
      await source`delete from pgboss.job where data ->> 'marker' in (${mine}, ${others})`;
      await sourceBoss.stop({ graceful: false });
      await targetBoss.stop({ graceful: false });
    }
  });

  it('fails the verification with the table name when a copied row was altered', async () => {
    const target = await freshTarget(labId);
    const { src, tgt, plan } = await fullMove(target, labId);
    await verifyCopy(plan, src, tgt);

    await target`update public.communities set name = name || '!' where id = (select id from public.communities where tenant_id = ${labId}::uuid order by id limit 1)`;
    let caught: unknown;
    try {
      await verifyCopy(plan, src, tgt);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MoveError);
    expect((caught as MoveError).code).toBe('verify_failed');
    expect((caught as MoveError).tables).toEqual(['communities:checksum']);
    const report = (caught as MoveError).report as VerifyReport;
    expect(report.tables.find((t) => t.name === 'communities')?.checksum).toBe('mismatch');
    expect(report.ok).toBe(false);
  });

  it('fails the verification when a row of another tenant is present in the target (T-09.2-96)', async () => {
    const target = await freshTarget(labId);
    const { src, tgt, plan } = await fullMove(target, labId);
    expect((await verifyCopy(plan, src, tgt)).ok).toBe(true);

    // The other seed tenant's mirror row and one of its communities slip into the dedicated target.
    await seedTargetTenant(target, demoId);
    const [community] = await source<{ j: string }[]>`
      select to_jsonb(c)::text as j from public.communities c where c.tenant_id = ${demoId}::uuid order by id limit 1`;
    // Re-pointed at an account the target holds: only the tenant_id says whose row it is.
    const row = {
      ...JSON.parse(community?.j ?? '{}'),
      created_by_user_id: '91d2a0c3-4037-41d5-9e0b-2d3a72115ca0',
      cover_asset_id: null,
    };
    await target.unsafe(
      'insert into public.communities select * from jsonb_populate_record(null::public.communities, $1::text::jsonb)',
      [JSON.stringify(row)],
    );
    let caught: unknown;
    try {
      await verifyCopy(plan, src, tgt);
    } catch (error) {
      caught = error;
    }
    expect((caught as MoveError).code).toBe('verify_failed');
    expect((caught as MoveError).tables).toEqual(
      expect.arrayContaining(['communities:foreign_tenant_rows', 'tenants:foreign_tenant_rows']),
    );
  });

  it('copies the objects of the tenant and only those, through the local Storage', async () => {
    const service = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const from = `mvtest-a-${RUN}`;
    const to = `mvtest-b-${RUN}`;
    const mapped = (port: StoragePort): StoragePort => ({
      list: (bucket, prefix) => port.list(bucket === from ? to : bucket, prefix),
      download: (bucket, key) => port.download(bucket === from ? to : bucket, key),
      upload: (bucket, key, body, options) =>
        port.upload(bucket === from ? to : bucket, key, body, options),
      info: (bucket, key) => port.info(bucket === from ? to : bucket, key),
    });
    const uploaded: string[] = [];
    try {
      for (const bucket of [from, to]) {
        const created = await service.storage.createBucket(bucket, { public: false });
        expect(created.error).toBeNull();
      }
      const put = async (key: string, bytes: string, contentType: string) => {
        const { error } = await service.storage
          .from(from)
          .upload(key, Buffer.from(bytes), { contentType, upsert: true });
        expect(error).toBeNull();
        uploaded.push(key);
      };
      await put(`${labId}/branding/logo.txt`, 'abcde', 'text/plain');
      await put(`${labId}/media/deep/nested/clip.bin`, 'xyz', 'application/octet-stream');
      await put(`${demoId}/branding/other.txt`, 'not mine', 'text/plain');

      const sourcePort = supabaseStoragePort(service);
      const targetPort = mapped(supabaseStoragePort(service));
      const report = await copyStorage({
        source: sourcePort,
        target: targetPort,
        tenantId: labId,
        buckets: [from],
      });
      expect(report).toEqual({ copied: 2, skipped: 0, bytes: 8 });

      const listed = await service.storage.from(to).list(labId, { limit: 10 });
      expect(listed.data?.map((entry) => entry.name).sort()).toEqual(['branding', 'media']);
      const other = await service.storage.from(to).list(demoId, { limit: 10 });
      expect(other.data ?? []).toHaveLength(0);
      const info = await service.storage.from(to).info(`${labId}/branding/logo.txt`);
      expect(info.data?.contentType).toBe('text/plain');

      // A second run skips both objects.
      expect(
        await copyStorage({
          source: sourcePort,
          target: targetPort,
          tenantId: labId,
          buckets: [from],
        }),
      ).toEqual({
        copied: 0,
        skipped: 2,
        bytes: 8,
      });
      expect(await storageTotalsOf(sourcePort, labId, [from])).toEqual({ objects: 2, bytes: 8 });
    } finally {
      for (const bucket of [from, to]) {
        const listed = await service.storage.from(bucket).list('', { limit: 100 });
        const keys: string[] = [];
        const walk = async (folder: string) => {
          const entries =
            (await service.storage.from(bucket).list(folder, { limit: 100 })).data ?? [];
          for (const entry of entries) {
            const key = folder ? `${folder}/${entry.name}` : entry.name;
            if (entry.id === null) await walk(key);
            else keys.push(key);
          }
        };
        for (const entry of listed.data ?? []) await walk(entry.name);
        if (keys.length > 0) await service.storage.from(bucket).remove(keys);
        await service.storage.emptyBucket(bucket);
        await service.storage.deleteBucket(bucket);
      }
    }
  });
});
