import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyDirectory, MigrationError } from '@rede-social/core/server/migrations/runner';
import {
  defaultMigrationDir,
  type MigrationSetName,
  readMigrationDir,
} from '@rede-social/core/server/migrations/sets';
import postgres, { type Sql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { adminSql } from './setup';

/**
 * Phase 09.2-02 (DBT-22, DBT-32, T-09.2-04/05/07/09; P45, P65, P66, P67, P68, P69): the in-house migration
 * runner against real Postgres. Every case that mutates a schema owns a SCRATCH database
 * (`rede_runner_<run>_<n>`) created through `adminSql` and dropped in `afterAll`, with a throwaway directory of
 * synthetic files under the OS temp dir. The two cases that look at real sets use `rede_tenant_b` (built by
 * `scripts/db-two-databases.sh`) and the local stack's central ledger, read-only apart from idempotent re-runs.
 */
const RUN = Date.now();
const HOST = '127.0.0.1:54322';
const REPO_ROOT = resolve(__dirname, '../../../..');

const created: string[] = [];
const clients: Sql[] = [];
const dirs: string[] = [];
let counter = 0;

const url = (db: string, user = 'postgres', password = 'postgres') =>
  `postgres://${user}:${password}@${HOST}/${db}`;

function connect(db: string, user = 'postgres', password = 'postgres'): Sql {
  const client = postgres(url(db, user, password), {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  clients.push(client);
  return client;
}

async function scratch(): Promise<string> {
  counter += 1;
  const db = `rede_runner_${RUN}_${counter}`;
  await adminSql.unsafe(`create database ${db}`);
  created.push(db);
  return db;
}

async function files(
  entries: Record<string, string>,
  set: MigrationSetName = 'tenant',
): Promise<{ dir: string; read: () => ReturnType<typeof readMigrationDir> }> {
  const dir = await mkdtemp(join(tmpdir(), 'rede-runner-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(entries)) await writeFile(join(dir, name), text);
  return { dir, read: () => readMigrationDir(dir, set) };
}

const THREE = {
  '20260101000001_a.sql': 'create table run_a (id int primary key);',
  '20260101000002_b.sql': 'create table run_b (id int primary key);\ninsert into run_b values (1);',
  '20260101000003_c.sql': 'create table run_c (id int primary key);',
};

const tableExists = async (sql: Sql, name: string) =>
  (await sql<{ present: boolean }[]>`select to_regclass(${name}) is not null as present`)[0]
    ?.present === true;

afterAll(async () => {
  for (const client of clients) await client.end({ timeout: 2 }).catch(() => undefined);
  for (const db of created) await adminSql.unsafe(`drop database if exists ${db} with (force)`);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  await adminSql.end();
});

describe('applyDirectory', () => {
  it('applies the files in order and writes the ledger and the checksum rows', async () => {
    const db = await scratch();
    const sql = connect(db);
    const { read } = await files(THREE);
    const events: string[] = [];

    const result = await applyDirectory(sql, await read(), {
      set: 'tenant',
      onFile: (e) => events.push(`${e.version}:${e.status}`),
    });

    expect(result.applied).toEqual(['20260101000001', '20260101000002', '20260101000003']);
    expect(events).toEqual([
      '20260101000001:applied',
      '20260101000002:applied',
      '20260101000003:applied',
    ]);
    const ledger =
      await sql`select version, name from supabase_migrations.schema_migrations order by version`;
    expect(ledger.map((r) => `${r.version}_${r.name}`)).toEqual([
      '20260101000001_a',
      '20260101000002_b',
      '20260101000003_c',
    ]);
    const sums =
      await sql`select version from supabase_migrations.rede_checksums where set = 'tenant' order by version`;
    expect(sums).toHaveLength(3);
    expect(await sql`select count(*)::int as n from run_b`).toEqual([{ n: 1 }]);
    expect(await tableExists(sql, 'supabase_migrations.central_migrations')).toBe(false);
  });

  it('a failing third file leaves 1-2 committed and 3 rolled back; a fixed file 3 applies alone (P45)', async () => {
    const db = await scratch();
    const sql = connect(db);
    const dir = await files({
      ...THREE,
      '20260101000003_c.sql':
        'create table run_partial (secret_marker int); select 1/0 as secret_statement_text;',
    });

    const first = await applyDirectory(sql, await dir.read(), { set: 'tenant' });

    expect(first.applied).toEqual(['20260101000001', '20260101000002']);
    expect(first.failedVersion).toBe('20260101000003');
    expect(first.errorCode).toBe('file_failed');
    expect(first.sqlstate).toBe('22012');
    expect(first.pending).toEqual(['20260101000003']);
    expect(first.error).toBeInstanceOf(MigrationError);
    // T-09.2-04: the message names the code and the version, never the statement or its text.
    expect(first.error?.message).toBe('file_failed:20260101000003');
    expect(first.error?.message).not.toMatch(/secret|run_partial|select/i);
    expect(await tableExists(sql, 'run_partial')).toBe(false);
    expect(await tableExists(sql, 'run_b')).toBe(true);

    await writeFile(join(dir.dir, '20260101000003_c.sql'), THREE['20260101000003_c.sql']);
    const second = await applyDirectory(sql, await dir.read(), { set: 'tenant' });
    expect(second.applied).toEqual(['20260101000003']);
    expect(second.errorCode).toBeUndefined();

    const third = await applyDirectory(sql, await dir.read(), { set: 'tenant' });
    expect(third.applied).toEqual([]);
    expect(third.skipped).toBe(3);
  });

  it('refuses an applied file that was edited (checksum_changed) and applies nothing (T-09.2-05)', async () => {
    const db = await scratch();
    const sql = connect(db);
    const dir = await files(THREE);
    await applyDirectory(sql, await dir.read(), { set: 'tenant' });

    await writeFile(join(dir.dir, '20260101000002_b.sql'), 'create table run_b_edited (id int);');
    await writeFile(join(dir.dir, '20260101000004_d.sql'), 'create table run_d (id int);');

    await expect(applyDirectory(sql, await dir.read(), { set: 'tenant' })).rejects.toMatchObject({
      code: 'checksum_changed',
      version: '20260101000002',
    });
    expect(await tableExists(sql, 'run_d')).toBe(false);
  });

  it('adopts the checksum of a row applied before the runner existed (first run), then guards it', async () => {
    const db = await scratch();
    const sql = connect(db);
    const dir = await files(THREE);
    // As the Supabase CLI leaves it: ledger rows, no checksum rows.
    await sql.unsafe('create schema supabase_migrations');
    await sql.unsafe(
      'create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)',
    );
    await sql.unsafe(
      "insert into supabase_migrations.schema_migrations (version, name) values ('20260101000001', 'a')",
    );

    const result = await applyDirectory(sql, await dir.read(), { set: 'tenant' });

    expect(result.applied).toEqual(['20260101000002', '20260101000003']);
    const adopted =
      await sql`select version from supabase_migrations.rede_checksums where set = 'tenant' order by version`;
    expect(adopted.map((r) => r.version)).toEqual([
      '20260101000001',
      '20260101000002',
      '20260101000003',
    ]);
    await writeFile(join(dir.dir, '20260101000001_a.sql'), 'create table run_a_edited (id int);');
    await expect(applyDirectory(sql, await dir.read(), { set: 'tenant' })).rejects.toMatchObject({
      code: 'checksum_changed',
    });
  });

  it('refuses any role but postgres (wrong_role) before it changes anything (T-09.2-09)', async () => {
    const db = await scratch();
    const sql = connect(db, 'api_user');
    const { read } = await files(THREE);

    await expect(applyDirectory(sql, await read(), { set: 'tenant' })).rejects.toMatchObject({
      code: 'wrong_role',
    });
    expect(await tableExists(connect(db), 'run_a')).toBe(false);
  });

  it('fails with lock_timeout while another session holds the set lock, and applies nothing (P45)', async () => {
    const db = await scratch();
    const holder = connect(db);
    const sql = connect(db);
    const { read } = await files(THREE);
    await holder`select pg_advisory_lock(hashtext('rede.migrate:tenant'))`;

    const started = Date.now();
    await expect(
      applyDirectory(sql, await read(), { set: 'tenant', lockTimeoutMs: 500 }),
    ).rejects.toMatchObject({ code: 'lock_timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await tableExists(holder, 'run_a')).toBe(false);
    expect(await tableExists(holder, 'supabase_migrations.schema_migrations')).toBe(false);

    // The central set has its own lock: it is not blocked by the tenant one.
    const central = await files(
      { '20260102000000_reg.sql': 'create table run_central (id int);' },
      'central',
    );
    const ok = await applyDirectory(sql, await central.read(), {
      set: 'central',
      lockTimeoutMs: 500,
    });
    expect(ok.applied).toEqual(['20260102000000']);
    await holder`select pg_advisory_unlock(hashtext('rede.migrate:tenant'))`;
  });

  it('two runners racing on one database apply every file exactly once; the loser applies 0 (P45, P69)', async () => {
    const db = await scratch();
    const a = connect(db);
    const b = connect(db);
    const { read } = await files(THREE);
    const list = await read();

    const [ra, rb] = await Promise.all([
      applyDirectory(a, list, { set: 'tenant' }),
      applyDirectory(b, list, { set: 'tenant' }),
    ]);

    expect([ra.applied.length, rb.applied.length].sort()).toEqual([0, 3]);
    expect(ra.errorCode).toBeUndefined();
    expect(rb.errorCode).toBeUndefined();
    const rows = await a`select count(*)::int as n from supabase_migrations.schema_migrations`;
    expect(rows).toEqual([{ n: 3 }]);
  });

  it('a runner PROCESS killed mid-file leaves that file rolled back (P45)', async () => {
    const db = await scratch();
    const dir = await files({
      '20260101000001_a.sql': 'create table run_a (id int primary key);',
      '20260101000002_slow.sql':
        'create table run_slow (id int); select pg_sleep(30); -- rede_kill_marker',
    });
    const child = spawn(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['scripts/migrate-set.ts', '--set', 'tenant', '--url', url(db), '--dir', dir.dir],
      { cwd: REPO_ROOT, stdio: 'ignore' },
    );
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));

    const running = async () =>
      adminSql<{ pid: number }[]>`
        select pid from pg_stat_activity where datname = ${db} and query like '%rede_kill_marker%'`;
    let pid: number | undefined;
    for (let i = 0; i < 150 && pid === undefined; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      pid = (await running())[0]?.pid;
    }
    expect(pid).toBeDefined();

    child.kill('SIGKILL');
    await exited;
    // The server only notices the dead client when its statement ends, so end the sleep too.
    await adminSql`select pg_cancel_backend(${pid as number})`;
    for (let i = 0; i < 100 && (await running()).length > 0; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const check = connect(db);
    expect(await tableExists(check, 'run_slow')).toBe(false);
    expect(await check`select version from supabase_migrations.schema_migrations`).toEqual([
      { version: '20260101000001' },
    ]);
  }, 40_000);

  it('dryRun lists the pending versions and writes nothing', async () => {
    const db = await scratch();
    const sql = connect(db);
    const { read } = await files(THREE);

    const result = await applyDirectory(sql, await read(), { set: 'tenant', dryRun: true });

    expect(result.pending).toEqual(['20260101000001', '20260101000002', '20260101000003']);
    expect(result.applied).toEqual([]);
    expect(await tableExists(sql, 'supabase_migrations.schema_migrations')).toBe(false);
    expect(await tableExists(sql, 'run_a')).toBe(false);
  });

  it('refuses a new file below the applied head (out_of_order) unless includeAll (P67)', async () => {
    const db = await scratch();
    const sql = connect(db);
    const dir = await files({
      '20260101000001_a.sql': THREE['20260101000001_a.sql'],
      '20260101000003_c.sql': THREE['20260101000003_c.sql'],
    });
    await applyDirectory(sql, await dir.read(), { set: 'tenant' });
    await writeFile(join(dir.dir, '20260101000002_b.sql'), THREE['20260101000002_b.sql']);

    await expect(applyDirectory(sql, await dir.read(), { set: 'tenant' })).rejects.toMatchObject({
      code: 'out_of_order',
      version: '20260101000002',
    });
    expect(await tableExists(sql, 'run_b')).toBe(false);

    const result = await applyDirectory(sql, await dir.read(), { set: 'tenant', includeAll: true });
    expect(result.applied).toEqual(['20260101000002']);
  });

  it('a tenant file and a central file with the SAME version both apply to their own ledgers (P65)', async () => {
    const db = await scratch();
    const sql = connect(db);
    const tenant = await files({
      '20260101000000_same.sql': 'create table run_tenant_side (id int);',
    });
    const central = await files(
      { '20260101000000_same.sql': 'create table run_central_side (id int);' },
      'central',
    );

    const t = await applyDirectory(sql, await tenant.read(), { set: 'tenant' });
    const c = await applyDirectory(sql, await central.read(), { set: 'central' });

    expect(t.applied).toEqual(['20260101000000']);
    expect(c.applied).toEqual(['20260101000000']);
    expect(await tableExists(sql, 'run_tenant_side')).toBe(true);
    expect(await tableExists(sql, 'run_central_side')).toBe(true);
    const sums =
      await sql`select set from supabase_migrations.rede_checksums where version = '20260101000000' order by set`;
    expect(sums.map((r) => r.set)).toEqual(['central', 'tenant']);
  });
});

describe('the real sets', () => {
  it('the tenant set on rede_tenant_b: a ledger row per file, no platform schema, no central ledger (P66, DBT-32)', async () => {
    execFileSync('bash', ['scripts/db-two-databases.sh'], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('bash', ['scripts/db-two-databases.sh', '--assert-no-platform'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    const tenantFiles = await readMigrationDir(defaultMigrationDir('tenant'), 'tenant');
    const sql = connect('rede_tenant_b');

    const [row] = await sql<
      { n: number }[]
    >`select count(*)::int as n from supabase_migrations.schema_migrations`;
    expect(row?.n).toBe(tenantFiles.length);
    expect(await sql`select to_regnamespace('platform') as ns`).toEqual([{ ns: null }]);
    expect(await tableExists(sql, 'supabase_migrations.central_migrations')).toBe(false);

    const again = await applyDirectory(sql, tenantFiles, { set: 'tenant' });
    expect(again.applied).toEqual([]);
  }, 120_000);

  it('the central set applied twice to the local stack leaves the same checksums (P68)', async () => {
    const sql = connect('postgres');
    const centralFiles = await readMigrationDir(defaultMigrationDir('central'), 'central');
    const snapshot = async () =>
      sql`select set, version, sha256 from supabase_migrations.rede_checksums where set = 'central' order by version`;

    const first = await applyDirectory(sql, centralFiles, { set: 'central' });
    const before = await snapshot();
    const second = await applyDirectory(sql, centralFiles, { set: 'central' });
    const after = await snapshot();

    expect(first.errorCode).toBeUndefined();
    expect(second.applied).toEqual([]);
    expect(after).toEqual(before);
    expect(after.map((r) => r.version)).toEqual(centralFiles.map((f) => f.version));
  });

  it('an empty central directory is a no-op that creates its ledger; an empty tenant directory is empty_set (P66)', async () => {
    const db = await scratch();
    const sql = connect(db);
    const empty = join(tmpdir(), `rede-runner-empty-${RUN}`);
    await mkdir(empty, { recursive: true });
    dirs.push(empty);

    const result = await applyDirectory(sql, await readMigrationDir(empty, 'central'), {
      set: 'central',
    });

    expect(result.applied).toEqual([]);
    expect(await tableExists(sql, 'supabase_migrations.central_migrations')).toBe(true);
    await expect(readMigrationDir(empty, 'tenant')).rejects.toMatchObject({ code: 'empty_set' });
  });
});
