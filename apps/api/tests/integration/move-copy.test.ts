import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sqlClient } from '@rede-social/core/db';
import { createBoss, createQueues, stopBoss } from '@rede-social/core/server/jobs/boss';
import { runBootstrap } from '@rede-social/core/server/projects/bootstrap';
import { createFakeProjectProvider } from '@rede-social/core/server/projects/fake';
import {
  type AuthCopyReport,
  assertCoverage,
  type CopyOptions,
  type CopyReport,
  copyAuth,
  copyRows,
  copyStorage,
  EmailConflictError,
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
import { adminSql, SEED_PASSWORD } from './setup';

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

/**
 * An account of rede-lab, read from the seeded source. GoTrue gives every seeded user a fresh id on each
 * `db reset`, so no id is pinned here (09.2-23: three cases failed on a freshly seeded stack because they were).
 */
async function labMemberId(): Promise<string> {
  const [row] = await source<{ user_id: string }[]>`
    select user_id::text as user_id from public.memberships
     where tenant_id = ${labId}::uuid order by user_id limit 1`;
  if (!row) throw new Error('the seed has no member in rede-lab');
  return row.user_id;
}

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
    expect(Object.values(targetCounts).reduce((a, b) => a + b, 0)).toBeGreaterThan(100);

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
      created_by_user_id: await labMemberId(),
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

// ---------------------------------------------------------------------------------------------------------
// Task 3: resume, conflicts, identity safety, reporting
// ---------------------------------------------------------------------------------------------------------

const PROBE_PASSWORD = 'Probe-Segredo-123';

/** An account that is a member of BOTH seed tenants, with a password the test knows. */
async function insertTwoTenantUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await source`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', ${id}::uuid, 'authenticated', 'authenticated', ${email},
            extensions.crypt(${PROBE_PASSWORD}, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"Duas Casas"}'::jsonb, now(), now())`;
  await source`
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (${id}, ${id}::uuid, ${JSON.stringify({ sub: id, email })}::jsonb, 'email', now(), now())`;
  for (const tenantId of [labId, demoId]) {
    await source`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${tenantId}::uuid, ${id}::uuid, 'member', 'active')`;
  }
  return id;
}

async function removeTwoTenantUser(id: string): Promise<void> {
  await source`delete from public.member_profiles where user_id = ${id}::uuid`;
  await source`delete from public.memberships where user_id = ${id}::uuid`;
  await source`delete from auth.identities where user_id = ${id}::uuid`;
  await source`delete from auth.users where id = ${id}::uuid`;
  await source`delete from public.users where id = ${id}::uuid`;
}

describe('resume, conflicts, identity safety and reports', () => {
  it('resumes after a crash between groups without duplicating anything', async () => {
    const target = await freshTarget(labId);
    const src = side(source, labId, 'p0');
    const tgt = side(target, labId, 'tb');
    const plan = await planMove(src, tgt);
    await copyAuth(src, tgt);

    await expect(
      copyRows(plan, src, tgt, {
        afterGroup: ({ tables }) => {
          if (tables.includes('events')) throw new Error('simulated crash');
        },
      }),
    ).rejects.toThrow('simulated crash');
    // The groups before the cycle are committed; the later ones are not there yet.
    const partial = await tenantCounts(target, labId, [
      'events',
      'event_secrets',
      'event_attendances',
      'memberships',
    ]);
    expect(partial.events).toBeGreaterThan(0);
    expect(partial.event_secrets).toBeGreaterThan(0);
    expect(partial.event_attendances).toBe(0);

    const rerun = await copyRows(plan, src, tgt);
    expect(rerun.groups).toBe(plan.groups.length);
    const report = await verifyCopy(plan, src, tgt);
    expect(report.ok).toBe(true);
    const counts = await tenantCounts(
      target,
      labId,
      plan.tables.map((t) => t.name),
    );
    for (const entry of plan.tables) expect(counts[entry.name]).toBe(entry.rows);
  });

  it('inserts a reply after its parent even when the reply sorts first (feed_comments.parent_depth)', async () => {
    const root = 'ffffffff-ffff-4fff-8fff-ffffffffff01';
    const reply = '00000000-0000-4000-8000-00000000fe01';
    const fixture = async (sql: string, params: unknown[]) =>
      source.begin(async (tx) => {
        // Fixtures only: the counters of the seeded post are not this case's business.
        await tx.unsafe('set local session_replication_role = replica');
        await tx.unsafe(sql, params as never[]);
      });
    const target = await freshTarget(labId);
    const author = await labMemberId();
    try {
      await fixture(
        `insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth)
         values ($1::uuid, $2::uuid, '0e000000-0000-4000-8000-000000000001', $3::uuid, 'raiz', 0)`,
        [root, labId, author],
      );
      await fixture(
        `insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
         values ($1::uuid, $2::uuid, '0e000000-0000-4000-8000-000000000001', $4::uuid, 'resposta', 1, $3::uuid, 0, 'post')`,
        [reply, labId, root, author],
      );
      // One row per statement: the reply (the smallest id) is read BEFORE its parent by key order, so only the
      // parent-first rule keeps the foreign key satisfied.
      const { src, tgt, plan } = await fullMove(target, labId, { batchSize: 1 });
      expect((await verifyCopy(plan, src, tgt)).ok).toBe(true);
      const [copied] = await target`
        select count(*)::int as n from public.feed_comments where id in (${root}::uuid, ${reply}::uuid)`;
      expect(copied?.n).toBe(2);
    } finally {
      await fixture('delete from public.feed_comments where id in ($1::uuid, $2::uuid)', [
        reply,
        root,
      ]);
    }
  });

  it('copies an account held in two tenants independently: same id and hash, the source keeps it', async () => {
    const email = `duas-casas-${RUN}@example.test`;
    const id = await insertTwoTenantUser(email);
    try {
      const [original] = await source<{ encrypted_password: string }[]>`
        select encrypted_password from auth.users where id = ${id}::uuid`;

      // Move 1: rede-lab to a target.
      const first = await freshTarget(labId);
      const one = await fullMove(first, labId);
      expect(one.auth.accounts).toBe(8);
      const [copied] = await first<{ encrypted_password: string; ok: boolean }[]>`
        select encrypted_password, extensions.crypt(${PROBE_PASSWORD}, encrypted_password) = encrypted_password as ok
          from auth.users where id = ${id}::uuid`;
      expect(copied?.encrypted_password).toBe(original?.encrypted_password);
      expect(copied?.ok).toBe(true);
      const [stillThere] =
        await source`select count(*)::int as n from auth.users where id = ${id}::uuid`;
      expect(stillThere?.n).toBe(1);
      // The mirror row carries the source's name and creation time exactly.
      const [mirrorA] =
        await source`select name, created_at from public.users where id = ${id}::uuid`;
      const [mirrorB] =
        await first`select name, created_at from public.users where id = ${id}::uuid`;
      expect(mirrorB).toEqual(mirrorA);

      // Move 2: rede-demo to a NEW target. The account is copied again, the source still holds it.
      const second = await freshTarget(demoId);
      await fullMove(second, demoId);
      const [again] = await second<{ encrypted_password: string }[]>`
        select encrypted_password from auth.users where id = ${id}::uuid`;
      expect(again?.encrypted_password).toBe(original?.encrypted_password);

      // Independence: a password change in the target does not reach the source.
      await second`update auth.users set encrypted_password = extensions.crypt('Outra-Senha-9', extensions.gen_salt('bf')) where id = ${id}::uuid`;
      const [afterChange] = await source<{ encrypted_password: string }[]>`
        select encrypted_password from auth.users where id = ${id}::uuid`;
      expect(afterChange?.encrypted_password).toBe(original?.encrypted_password);
    } finally {
      await removeTwoTenantUser(id);
    }
  });

  it('aborts with email_conflict before any write when the target holds the e-mail under another id', async () => {
    const target = await freshTarget(labId);
    const marker = 'member@rede-lab.local';
    await target`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', ${crypto.randomUUID()}::uuid, 'authenticated',
              'authenticated', ${marker}, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`;
    const snapshot = async () => ({
      users: (await target`select count(*)::int as n from auth.users`)[0]?.n,
      identities: (await target`select count(*)::int as n from auth.identities`)[0]?.n,
      mirror: (await target`select count(*)::int as n from public.users`)[0]?.n,
      memberships: (await target`select count(*)::int as n from public.memberships`)[0]?.n,
    });
    const before = await snapshot();

    let caught: unknown;
    try {
      await copyAuth(side(source, labId, 'p0'), side(target, labId, 'tb'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EmailConflictError);
    expect((caught as MoveError).code).toBe('email_conflict');
    // The message and the report carry no address.
    expect(JSON.stringify([(caught as Error).message, (caught as MoveError).report])).not.toContain(
      '@',
    );
    expect(await snapshot()).toEqual(before);
  });

  it('preserves the password hash byte for byte and the copy still verifies with crypt', async () => {
    const target = await freshTarget(labId);
    const { src, tgt, plan } = await fullMove(target, labId);
    await verifyCopy(plan, src, tgt);

    const sourceHashes = await source<{ id: string; encrypted_password: string }[]>`
      select id, encrypted_password from auth.users
       where id in (select user_id from public.memberships where tenant_id = ${labId}::uuid) order by id`;
    const targetHashes = await target<{ id: string; encrypted_password: string }[]>`
      select id, encrypted_password from auth.users order by id`;
    expect(targetHashes).toEqual(sourceHashes);
    expect(sourceHashes.length).toBe(7);
    if (SEED_PASSWORD) {
      const [ok] = await target`
        select extensions.crypt(${SEED_PASSWORD}, encrypted_password) = encrypted_password as ok
          from auth.users where email = 'member@rede-lab.local'`;
      expect(ok?.ok).toBe(true);
    }
  });

  it('does not double anything when the copy runs twice', async () => {
    const target = await freshTarget(labId);
    const { src, tgt, plan, rows } = await fullMove(target, labId);
    const first = await tenantCounts(
      target,
      labId,
      plan.tables.map((t) => t.name),
    );
    const total = rows.tables.reduce((n, t) => n + t.inserted, 0);
    expect(total).toBeGreaterThan(0);

    const again = await copyRows(plan, src, tgt);
    expect(again.tables.every((t) => t.inserted === 0)).toBe(true);
    const authAgain = await copyAuth(src, tgt);
    expect(authAgain.usersWritten).toBe(0);
    expect(
      await tenantCounts(
        target,
        labId,
        plan.tables.map((t) => t.name),
      ),
    ).toEqual(first);
    expect((await verifyCopy(plan, src, tgt)).ok).toBe(true);
  });

  it('writes nothing to either database during a dry run', async () => {
    const target = await freshTarget(labId);
    // Close the fixture's own connection first: a backend flushes its statistics when it exits.
    await target.end({ timeout: 5 });
    const writes = async () => {
      const reader = open(TGT_URL);
      try {
        const [row] = await reader`
          select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint as n from pg_stat_user_tables`;
        return Number(row?.n ?? 0);
      } finally {
        await reader.end({ timeout: 5 });
      }
    };
    // The dry run opens its own connections and releases them, which flushes their statistics.
    const planner = open(TGT_URL);
    const before = await writes();
    const plan = await planMove(side(source, labId, 'p0'), side(planner, labId, 'tb'));
    assertCoverage(plan);
    await planner.end({ timeout: 5 });
    expect(await writes()).toBe(before);

    // And the transactions it opens are read only: a write through the same entry point is refused.
    await expect(
      source.begin('read only', (tx) => tx`update public.tenants set slug = slug`),
    ).rejects.toThrow(/read-only/);
  });

  it('refuses a table it cannot place, and names it (T-09.2-100)', async () => {
    const target = await freshTarget(labId);
    const withTenant = `mv_probe_t_${RUN}`;
    const orphan = `mv_probe_o_${RUN}`;
    try {
      await source.unsafe(
        `create table public.${withTenant} (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id))`,
      );
      await source.unsafe(
        `create table public.${orphan} (id uuid primary key default gen_random_uuid(), note text)`,
      );

      // Held by the source but not by the target: it cannot be copied.
      const withTarget = await planMove(side(source, labId, 'p0'), side(target, labId, 'tb'));
      expect(withTarget.uncovered).toEqual([orphan, withTenant].sort());
      let caught: unknown;
      try {
        assertCoverage(withTarget);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MoveError);
      expect((caught as MoveError).code).toBe('uncovered_tables');
      expect((caught as MoveError).tables).toEqual([orphan, withTenant].sort());

      // copyRows checks again: a caller that forgot assertCoverage still cannot skip the table.
      await expect(
        copyRows(withTarget, side(source, labId, 'p0'), side(target, labId, 'tb')),
      ).rejects.toThrow('uncovered_tables');

      // Without a target the tenant-scoped table is part of the derived set, but the orphan has no home.
      const dry = await planMove(side(source, labId, 'p0'));
      expect(dry.uncovered).toEqual([orphan]);
    } finally {
      await source.unsafe(`drop table if exists public.${withTenant}`);
      await source.unsafe(`drop table if exists public.${orphan}`);
    }
  });

  it('refuses a row that references a user outside the tenant accounts and never widens the account set', async () => {
    const target = await freshTarget(labId);
    const stray = crypto.randomUUID();
    const [community] = await source<{ id: string; created_by_user_id: string | null }[]>`
      select id, created_by_user_id from public.communities where tenant_id = ${labId}::uuid order by id limit 1`;
    try {
      // An account that exists (public.users references auth.users) but belongs to no membership or invite.
      await source`
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', ${stray}::uuid, 'authenticated', 'authenticated',
                ${`stray-${RUN}@example.test`}, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`;
      await source`update public.communities set created_by_user_id = ${stray}::uuid where id = ${community?.id ?? ''}::uuid`;

      const plan = await planMove(side(source, labId, 'p0'), side(target, labId, 'tb'));
      expect(plan.danglingUsers).toEqual(['communities.created_by_user_id']);
      let caught: unknown;
      try {
        assertCoverage(plan);
      } catch (error) {
        caught = error;
      }
      expect((caught as MoveError).code).toBe('account_missing');

      // The Auth copy takes memberships and invitees only: the stray person gets no account in the target.
      await copyAuth(side(source, labId, 'p0'), side(target, labId, 'tb'));
      const [there] =
        await target`select count(*)::int as n from public.users where id = ${stray}::uuid`;
      expect(there?.n).toBe(0);
    } finally {
      await source`update public.communities set created_by_user_id = ${community?.created_by_user_id ?? null} where id = ${community?.id ?? ''}::uuid`;
      await source`delete from public.users where id = ${stray}::uuid`;
      await source`delete from auth.users where id = ${stray}::uuid`;
    }
  });

  it('keeps every report free of e-mails, hashes, tokens and connection strings', async () => {
    const target = await freshTarget(labId);
    const { src, tgt, plan, auth, rows } = await fullMove(target, labId);
    const verified = await verifyCopy(plan, src, tgt, {
      oldOrigin: SUPABASE_URL,
      newOrigin: NEW_ORIGIN,
    }).catch((error: MoveError) => error);
    const reports: unknown[] = [
      { ...plan, info: undefined },
      auth satisfies AuthCopyReport,
      rows satisfies CopyReport,
      verified instanceof MoveError
        ? { code: verified.code, tables: verified.tables, report: verified.report }
        : verified,
    ];

    // A conflict error as well.
    const clash = await freshTarget(labId);
    await clash`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', ${crypto.randomUUID()}::uuid, 'authenticated',
              'authenticated', 'admin@rede-lab.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`;
    const conflict = await copyAuth(side(source, labId, 'p0'), side(clash, labId, 'tb')).catch(
      (error: MoveError) => error,
    );
    reports.push({ message: (conflict as Error).message, report: (conflict as MoveError).report });

    const text = JSON.stringify(reports);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(text).not.toMatch(/\$2[aby]\$/);
    expect(text).not.toContain('eyJ');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('sb_secret_');
    // And it does say something: tables and counts are there.
    expect(text).toContain('feed_posts');
  });
});
