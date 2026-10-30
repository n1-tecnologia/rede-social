import { createHash } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { applyDirectory } from '@rede-social/core/server/migrations/runner';
import {
  defaultMigrationDir,
  type MigrationFile,
  readMigrationDir,
} from '@rede-social/core/server/migrations/sets';
import { type MigrateDeps, migrateAll } from '@rede-social/core/server/projects/migrate';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { ProjectProviderError } from '@rede-social/core/server/projects/types';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  closeAllPools,
  type ProjectRecord,
} from '@rede-social/core/server/tenancy/project-registry';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as customerSetup from './projects-setup';
import { API_URL, B_ADMIN_URL, onB, resetB, restoreB } from './projects-setup';
import { adminSql, adminSqlB, ensureSecondDatabase } from './setup';

/**
 * Phase 09.2-15 (DBT-23, DBT-24, D-544): `migrateAll`, the fan-out of the migration sets. The real runner, the
 * real registry and the real second database `rede_tenant_b`; a project is registered by hand (a sealed DDL URL
 * of B, which `postgres` can open directly) so no Management API is involved.
 */

const RUN = Date.now().toString(36);
let counter = 0;

type Registered = { projectId: string; tenantId: string; ref: string; slug: string };
const live: Registered[] = [];
const extraTenants: string[] = [];
let touchedB = false;

/** A ready project whose sealed DDL URL opens `rede_tenant_b`, with one tenant bound to it. */
async function register(
  tag: string,
  options: { url?: string; tenant?: boolean; slug?: string; ref?: string } = {},
): Promise<Registered> {
  counter += 1;
  const projectId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const ref = options.ref ?? `ma-${tag}-${RUN}-${counter}`.slice(0, 40);
  const slug = options.slug ?? `ma-${tag}-${RUN}-${counter}`.slice(0, 40);
  await adminSql.begin(async (tx) => {
    await tx`
      insert into platform.projects
             (id, ref, provider, credential_source, state, api_url, secret_key_id, ddl_url_sealed)
      values (${projectId}::uuid, ${ref}, 'fake', 'sealed', 'ready', ${API_URL}, 1,
              ${seal(options.url ?? B_ADMIN_URL, `${projectId}:ddl_url`)})`;
    if (options.tenant !== false) {
      await tx`
        insert into public.tenants (id, slug, display_name, rules_text, rules_version)
        values (${tenantId}::uuid, ${slug}, 'Tenant migrate-all', 'Regras.', 1)`;
      await tx`
        insert into platform.tenant_projects (tenant_id, project_id)
        values (${tenantId}::uuid, ${projectId}::uuid)`;
    }
  });
  const registered = { projectId, tenantId, ref, slug };
  live.push(registered);
  return registered;
}

/** A second tenant bound to an already registered project (a shared non-production stack, D-540). */
async function addTenant(projectId: string, slug: string): Promise<void> {
  const tenantId = crypto.randomUUID();
  await adminSql.begin(async (tx) => {
    await tx`
      insert into public.tenants (id, slug, display_name, rules_text, rules_version)
      values (${tenantId}::uuid, ${slug}, 'Tenant migrate-all (shared)', 'Regras.', 1)`;
    await tx`
      insert into platform.tenant_projects (tenant_id, project_id)
      values (${tenantId}::uuid, ${projectId}::uuid)`;
  });
  extraTenants.push(tenantId);
}

/** A freshly created `rede_tenant_b` holding the tenant set minus its last `behind` files, applied by the runner. */
async function laggingB(behind: number): Promise<MigrationFile[]> {
  touchedB = true;
  resetB();
  const files = await readMigrationDir(defaultMigrationDir('tenant'), 'tenant');
  const b = postgres(B_ADMIN_URL, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const result = await applyDirectory(b, files.slice(0, files.length - behind), {
      set: 'tenant',
    });
    expect(result.errorCode).toBeUndefined();
  } finally {
    await b.end({ timeout: 5 });
  }
  return files;
}

const ledgerOfB = () =>
  onB(async (b) => {
    const [row] = await b<{ n: number; head: string | null }[]>`
      select count(*)::int as n, max(version) as head from supabase_migrations.schema_migrations`;
    return { count: row?.n ?? 0, head: row?.head ?? null };
  });

const centralLedger = async () => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from supabase_migrations.central_migrations`;
  return row?.n ?? 0;
};

const stateOf = async (projectId: string) => {
  const [row] = await adminSql<
    {
      status: string;
      applied_count: number | null;
      applied_head: string | null;
      required_count: number | null;
      required_head: string | null;
      failed_version: string | null;
      error_code: string | null;
    }[]
  >`
    select status, applied_count, applied_head, required_count, required_head, failed_version, error_code
      from platform.project_schema_state where project_id = ${projectId}::uuid`;
  return row ?? null;
};

/** Every table the fan-out may write: B's ledgers, project 0's ledgers, the central ledger and all state rows. */
async function snapshot(projectId: string) {
  const dump = async (sql: typeof adminSql, query: string) =>
    (await sql.unsafe<{ rows: unknown }[]>(query))[0]?.rows;
  const rows = (table: string, order: string) =>
    `select coalesce(jsonb_agg(to_jsonb(t) order by ${order}), '[]'::jsonb) as rows from ${table} t`;
  return {
    b: await dump(adminSqlB, rows('supabase_migrations.schema_migrations', 'version')),
    bSums: await dump(adminSqlB, rows('supabase_migrations.rede_checksums', 'set, version')),
    zero: await dump(adminSql, rows('supabase_migrations.schema_migrations', 'version')),
    zeroSums: await dump(adminSql, rows('supabase_migrations.rede_checksums', 'set, version')),
    central: await dump(adminSql, rows('supabase_migrations.central_migrations', 'version')),
    state: await dump(adminSql, rows('platform.project_schema_state', 'project_id')),
    mine: await stateOf(projectId),
  };
}

const lineOf = (lines: Array<Record<string, unknown>>, ref: string) =>
  lines.find((line) => line.kind === 'project' && line.ref === ref);

/** The fan-out also records project 0 (the local stack); a leftover row would hold its tenants out after the next migration. */
async function clearCentralState(): Promise<void> {
  await adminSql`
    delete from platform.project_schema_state
     where project_id in (select id from platform.projects where is_central)`;
}

async function cleanup(): Promise<void> {
  while (extraTenants.length > 0) {
    const id = extraTenants.pop();
    if (id) await adminSql`delete from public.tenants where id = ${id}::uuid`;
  }
  while (live.length > 0) {
    const f = live.pop();
    if (!f) break;
    await adminSql`delete from public.tenants where id = ${f.tenantId}::uuid`;
    await adminSql`delete from platform.projects where id = ${f.projectId}::uuid`;
  }
  await clearCentralState();
}

beforeAll(async () => {
  await ensureSecondDatabase();
  await adminSql`delete from public.tenants where slug like ${'ma-%'}`;
  await adminSql`delete from platform.projects where ref like ${'ma-%'}`;
});

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
  // Leave `rede_tenant_b` as the other suites expect it: the whole tenant set applied, no fixtures.
  if (touchedB) restoreB();
});

describe('the tracer: a lagging project is brought current by the fan-out', () => {
  it('brings a lagging project current', async () => {
    const files = await laggingB(2);
    const f = await register('tracer');
    expect((await ledgerOfB()).count).toBe(files.length - 2);
    expect(await stateOf(f.projectId)).toBeNull();
    const centralBefore = await centralLedger();

    const first = await migrateAll({ concurrency: 2 });
    expect(first.exitCode).toBe(0);

    // The central set ran first and found nothing to do; the lines are central, projects by ascending ref, summary.
    expect(first.lines[0]).toMatchObject({
      kind: 'central',
      set: 'central',
      status: 'ok',
      applied: 0,
    });
    expect(await centralLedger()).toBe(centralBefore);
    expect(first.lines.at(-1)).toMatchObject({ kind: 'summary', central: 'ok' });
    const refs = first.lines
      .filter((line) => line.kind === 'project')
      .map((line) => line.ref as string);
    expect(refs).toEqual([...refs].sort());
    expect(refs).toContain(f.ref);

    // B's ledger holds every file and the state says so.
    expect(lineOf(first.lines, f.ref)).toMatchObject({ status: 'current', applied: 2 });
    const head = files.at(-1)?.version;
    expect(await ledgerOfB()).toEqual({ count: files.length, head });
    expect(await stateOf(f.projectId)).toMatchObject({
      status: 'current',
      applied_count: files.length,
      applied_head: head,
      required_count: files.length,
      required_head: head,
      failed_version: null,
      error_code: null,
    });

    // A second run applies nothing and writes `current` again.
    const second = await migrateAll({ concurrency: 2 });
    expect(second.exitCode).toBe(0);
    expect(lineOf(second.lines, f.ref)).toMatchObject({ status: 'current', applied: 0 });
    expect(await ledgerOfB()).toEqual({ count: files.length, head });
    expect(await stateOf(f.projectId)).toMatchObject({ status: 'current' });

    // No line, in either run, carries a connection string.
    for (const line of [...first.lines, ...second.lines]) {
      const text = JSON.stringify(line);
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text).not.toContain('postgres://');
      expect(text).not.toContain('postgresql://');
    }
  }, 240_000);

  it('a dry run lists the pending versions and writes nothing', async () => {
    const files = await laggingB(2);
    const f = await register('dry');
    // A state row already exists, so "nothing written" can be compared byte for byte.
    await migrateAll({ projectIds: [f.projectId] });
    const last = files.at(-1)?.version ?? '';
    await adminSqlB`delete from supabase_migrations.schema_migrations where version = ${last}`;
    const before = await snapshot(f.projectId);

    const result = await migrateAll({ dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(lineOf(result.lines, f.ref)).toMatchObject({
      dryRun: true,
      status: 'behind',
      pending: [last],
    });
    expect(result.lines.at(-1)).toMatchObject({ kind: 'summary', dryRun: true });
    expect(await snapshot(f.projectId)).toEqual(before);
  }, 240_000);
});

// ---------------------------------------------------------------------------------------------------------
// Edge guarantees (Task 3): selectors, empty inputs, encoding, order, isolation, concurrency
// ---------------------------------------------------------------------------------------------------------

const PROBE = '99999999999999';
const probeFile = (text: string): MigrationFile => ({
  set: 'tenant',
  version: PROBE,
  name: 'edge_probe',
  text,
  sha256: createHash('sha256').update(text).digest('hex'),
});
const BROKEN = probeFile('select * from public.edge_probe_table_that_does_not_exist;');
const BROKEN_CENTRAL: MigrationFile = { ...BROKEN, set: 'central' };

const projectLines = (lines: Array<Record<string, unknown>>) =>
  lines.filter((line) => line.kind === 'project');

/** A registry record that exists only in a test (never inserted): for the stubbed fan-outs. */
const fakeRecord = (ref: string): ProjectRecord => ({
  id: crypto.randomUUID(),
  ref,
  provider: 'fake',
  isCentral: false,
  isDefault: false,
  credentialSource: 'sealed',
  credentialVersion: 1,
  apiUrl: API_URL,
  publishableKey: null,
  state: 'ready',
  secretKeyId: 1,
  databaseUrlTxSealed: null,
  databaseUrlSessionSealed: null,
  ddlUrlSealed: null,
  serviceKeySealed: null,
  serviceKeyKind: null,
  hookRef: null,
  hookSecretSealed: null,
  owner: 'platform',
  orgSlug: null,
  mgmtTokenSealed: null,
  mgmtTokenExpiresAt: null,
});

const toB = () => postgres(B_ADMIN_URL, { max: 1, prepare: false, onnotice: () => undefined });

describe('selectors (P46)', () => {
  it('tenant selector is exact: a prefix selects nothing and a longer slug never matches a shorter one', async () => {
    await laggingB(0);
    const a = await register('sel', { slug: `ma-x${RUN}`, ref: `ma-sela-${RUN}` });
    const ab = await register('sel', { slug: `ma-x${RUN}b`, ref: `ma-selab-${RUN}` });

    // `a` selects its own project and not the project of `ab` (which starts with the same letters).
    const onlyA = await migrateAll({ dryRun: true, tenantSlug: a.slug });
    expect(onlyA.exitCode).toBe(0);
    expect(projectLines(onlyA.lines).map((line) => line.ref)).toEqual([a.ref]);

    const onlyAb = await migrateAll({ dryRun: true, tenantSlug: ab.slug });
    expect(projectLines(onlyAb.lines).map((line) => line.ref)).toEqual([ab.ref]);

    // A prefix of a real slug is not a tenant: usage error, nothing selected.
    const prefix = await migrateAll({ dryRun: true, tenantSlug: a.slug.slice(0, -1) });
    expect(prefix.exitCode).toBe(2);
    expect(prefix.lines).toEqual([{ kind: 'usage', message: 'no tenant has that slug' }]);

    // The same holds for --project: an exact ref or nothing.
    const exactRef = await migrateAll({ dryRun: true, projectRef: a.ref });
    expect(projectLines(exactRef.lines).map((line) => line.ref)).toEqual([a.ref]);
    expect((await migrateAll({ dryRun: true, projectRef: a.ref.slice(0, -1) })).exitCode).toBe(2);
  }, 240_000);

  it('two tenants on one shared project migrate that project once, and adjacent refs stay independent', async () => {
    await laggingB(0);
    const first = await register('shared', { slug: `ma-sh${RUN}`, ref: `ma-sh-${RUN}` });
    await addTenant(first.projectId, `ma-sh${RUN}-two`);
    const neighbour = await register('shared', { slug: `ma-sh${RUN}n`, ref: `ma-sh-${RUN}n` });

    const result = await migrateAll({ concurrency: 3 });
    expect(result.exitCode).toBe(0);
    const refs = projectLines(result.lines).map((line) => line.ref);
    expect(refs.filter((ref) => ref === first.ref)).toHaveLength(1);
    expect(refs.filter((ref) => ref === neighbour.ref)).toHaveLength(1);
    // Each project has its own state row.
    expect(await stateOf(first.projectId)).toMatchObject({ status: 'current' });
    expect(await stateOf(neighbour.projectId)).toMatchObject({ status: 'current' });

    // Selecting either tenant of the shared project runs it once.
    const viaSecond = await migrateAll({ dryRun: true, tenantSlug: `ma-sh${RUN}-two` });
    expect(projectLines(viaSecond.lines).map((line) => line.ref)).toEqual([first.ref]);
  }, 240_000);
});

describe('zero and empty (P47)', () => {
  it('no ready project beyond the central one still prints the central line and exits 0', async () => {
    const result = await migrateAll({
      dryRun: true,
      deps: { listProjects: async () => [] },
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines.map((line) => line.kind)).toEqual(['central', 'summary']);
    expect(result.lines.at(-1)).toMatchObject({ projects: 0, current: 0, failed: 0, applied: 0 });
  });

  it('a project with zero pending files writes no ledger row and keeps current', async () => {
    const files = await laggingB(0);
    const f = await register('zero');
    await migrateAll({ projectIds: [f.projectId] });
    const before = await snapshot(f.projectId);

    const again = await migrateAll({ projectIds: [f.projectId] });
    expect(again.exitCode).toBe(0);
    expect(lineOf(again.lines, f.ref)).toMatchObject({ status: 'current', applied: 0 });
    const after = await snapshot(f.projectId);
    // The ledgers are untouched; only the state row's timestamps may move.
    expect(after.b).toEqual(before.b);
    expect(after.bSums).toEqual(before.bSums);
    expect(after.zero).toEqual(before.zero);
    expect(after.central).toEqual(before.central);
    expect(after.mine).toMatchObject({ status: 'current', applied_count: files.length });
  }, 240_000);

  it('an unknown --tenant slug exits 2 with a one-line usage message and changes nothing', async () => {
    const f = await register('unknown');
    const before = await snapshot(f.projectId);
    const result = await migrateAll({ tenantSlug: `nope-${RUN}` });
    expect(result.exitCode).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.kind).toBe('usage');
    expect(await snapshot(f.projectId)).toEqual(before);
  });

  it('an empty central directory still applies a pending tenant set', async () => {
    await laggingB(1);
    const f = await register('emptycentral');
    const result = await migrateAll({
      projectIds: undefined,
      deps: {
        loadFiles: async (set) =>
          set === 'central' ? [] : readMigrationDir(defaultMigrationDir('tenant'), 'tenant'),
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toMatchObject({ kind: 'central', status: 'ok', applied: 0 });
    expect(lineOf(result.lines, f.ref)).toMatchObject({ status: 'current', applied: 1 });
  }, 240_000);
});

describe('argument encoding (P48)', () => {
  it('a --tenant or --project that is not [a-z0-9-]+ exits 2 before any query', async () => {
    const listProjects = vi.fn(async () => [] as ProjectRecord[]);
    const projectIdOfTenant = vi.fn(async () => null);
    const ensureProjectZero = vi.fn(async () => undefined);
    const deps: Partial<MigrateDeps> = { listProjects, projectIdOfTenant, ensureProjectZero };

    for (const bad of ['a;b', 'A', 'ç', 'a b', 'a\nb', '', "x'--", 'a_b']) {
      const tenant = await migrateAll({ tenantSlug: bad, deps });
      expect(tenant.exitCode, `tenant ${JSON.stringify(bad)}`).toBe(2);
      expect(tenant.lines).toHaveLength(1);
      expect(tenant.lines[0]?.kind).toBe('usage');
      const project = await migrateAll({ projectRef: bad, deps });
      expect(project.exitCode, `project ${JSON.stringify(bad)}`).toBe(2);
    }
    expect(listProjects).not.toHaveBeenCalled();
    expect(projectIdOfTenant).not.toHaveBeenCalled();
    expect(ensureProjectZero).not.toHaveBeenCalled();
  });

  it('--concurrency must be a whole number from 1 to 16', async () => {
    const listProjects = vi.fn(async () => [] as ProjectRecord[]);
    for (const bad of [0, -1, 1.5, 17, Number.NaN]) {
      const result = await migrateAll({ concurrency: bad, deps: { listProjects } });
      expect(result.exitCode, `concurrency ${bad}`).toBe(2);
    }
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('every summary line is valid JSON with ASCII keys, and a label that could break a line is never printed', async () => {
    const b = toB();
    try {
      const hostile = fakeRecord('bad\nref"}{\u0000é');
      const result = await migrateAll({
        dryRun: true,
        deps: {
          listProjects: async () => [hostile],
          connect: () => b,
        },
      });
      expect(result.exitCode).toBe(0);
      const line = projectLines(result.lines)[0];
      expect(line?.ref).toBe('invalid');
      for (const each of result.lines) {
        const text = JSON.stringify(each);
        for (const control of ['\n', '\r', String.fromCharCode(0)]) {
          expect(text.includes(control)).toBe(false);
        }
        expect(JSON.parse(text)).toEqual(each);
        for (const key of Object.keys(each)) expect(key).toMatch(/^[A-Za-z]+$/);
      }
    } finally {
      await b.end({ timeout: 5 });
    }
  });
});

describe('order (P49)', () => {
  it('projects are printed in ascending ref whatever finished first, and the central line is first', async () => {
    const refs = ['ma-ord-a', 'ma-ord-b', 'ma-ord-c'];
    // Listed out of order, finishing in REVERSE order: c first, a last.
    const delays: Record<string, number> = { 'ma-ord-a': 250, 'ma-ord-b': 120, 'ma-ord-c': 10 };
    const records = [refs[1], refs[2], refs[0]].map((ref) => fakeRecord(ref as string));
    const owner = new WeakMap<object, string>();
    const clients: ReturnType<typeof toB>[] = [];
    const finished: string[] = [];

    const result = await migrateAll({
      concurrency: 3,
      deps: {
        ensureProjectZero: async () => undefined,
        listProjects: async () => records,
        connectCentral: () => {
          const client = toB();
          clients.push(client);
          return client;
        },
        connect: (project) => {
          const client = toB();
          clients.push(client);
          owner.set(client, project.ref);
          return client;
        },
        apply: async (client, files, options) => {
          const ref = owner.get(client);
          if (options.set === 'tenant' && ref) {
            await new Promise((resolve) => setTimeout(resolve, delays[ref] ?? 0));
            finished.push(ref);
          }
          return { applied: [], skipped: files.length, pending: [] };
        },
        loadFiles: async () => [probeFile('select 1;')],
      },
    });
    for (const client of clients) await client.end({ timeout: 5 }).catch(() => undefined);

    expect(finished).toEqual(['ma-ord-c', 'ma-ord-b', 'ma-ord-a']);
    expect(result.lines.map((line) => line.kind)).toEqual([
      'central',
      'project',
      'project',
      'project',
      'summary',
    ]);
    expect(projectLines(result.lines).map((line) => line.ref)).toEqual(refs);
  });
});

describe('isolation and exit codes (T-09.2-74)', () => {
  it('one broken project is failed and the others current; exit 0 by default, 1 with --strict', async () => {
    await laggingB(0);
    const good1 = await register('iso', { ref: `ma-iso-a-${RUN}` });
    const broken = await register('iso', { ref: `ma-iso-b-${RUN}` });
    const good2 = await register('iso', { ref: `ma-iso-c-${RUN}` });
    const down = await register('iso', {
      ref: `ma-iso-d-${RUN}`,
      url: 'postgres://postgres:postgres@127.0.0.1:1/rede_tenant_b',
    });
    const real = await readMigrationDir(defaultMigrationDir('tenant'), 'tenant');
    const deps: Partial<MigrateDeps> = {
      loadFiles: async (set, project) => {
        if (set === 'central') return readMigrationDir(defaultMigrationDir('central'), 'central');
        return project?.id === broken.projectId ? [...real, BROKEN] : real;
      },
    };
    const ids = [good1, broken, good2, down].map((f) => f.projectId);

    const lenient = await migrateAll({ projectIds: ids, concurrency: 4, deps });
    expect(lenient.exitCode).toBe(0);
    expect(lineOf(lenient.lines, good1.ref)).toMatchObject({ status: 'current' });
    expect(lineOf(lenient.lines, good2.ref)).toMatchObject({ status: 'current' });
    expect(lineOf(lenient.lines, broken.ref)).toMatchObject({
      status: 'failed',
      errorCode: 'file_failed',
      failedVersion: PROBE,
    });
    expect(lineOf(lenient.lines, down.ref)).toMatchObject({
      status: 'failed',
      errorCode: 'unreachable',
    });
    expect(lenient.lines.at(-1)).toMatchObject({
      kind: 'summary',
      projects: 4,
      current: 2,
      failed: 2,
    });
    expect(await stateOf(good1.projectId)).toMatchObject({ status: 'current' });
    expect(await stateOf(broken.projectId)).toMatchObject({
      status: 'failed',
      failed_version: PROBE,
      error_code: 'file_failed',
      applied_count: real.length,
    });
    expect(await stateOf(down.projectId)).toMatchObject({
      status: 'failed',
      error_code: 'unreachable',
    });
    // Neither the statement nor the address of a failure is printed or stored.
    const printed = JSON.stringify(lenient.lines);
    expect(printed).not.toContain('edge_probe_table_that_does_not_exist');
    expect(printed).not.toContain('127.0.0.1');
    expect(printed).not.toContain('postgres://');

    const strict = await migrateAll({ projectIds: ids, concurrency: 4, strict: true, deps });
    expect(strict.exitCode).toBe(1);
    expect(strict.ok).toBe(false);
    expect(lineOf(strict.lines, good1.ref)).toMatchObject({ status: 'current' });
  }, 240_000);

  it('a central failure exits 1 and no tenant project is touched', async () => {
    await laggingB(0);
    const f = await register('centralfail');
    await migrateAll({ projectIds: [f.projectId] });
    const before = await snapshot(f.projectId);

    const result = await migrateAll({
      deps: {
        ensureProjectZero: async () => undefined,
        loadFiles: async (set) =>
          set === 'central'
            ? [
                ...(await readMigrationDir(defaultMigrationDir('central'), 'central')),
                BROKEN_CENTRAL,
              ]
            : readMigrationDir(defaultMigrationDir('tenant'), 'tenant'),
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.lines.map((line) => line.kind)).toEqual(['central', 'summary']);
    expect(result.lines[0]).toMatchObject({
      status: 'failed',
      errorCode: 'file_failed',
      failedVersion: PROBE,
    });
    expect(result.lines.at(-1)).toMatchObject({ central: 'failed', projects: 0 });
    expect(await snapshot(f.projectId)).toEqual(before);
  }, 240_000);

  it('--central-only applies the central set and stops', async () => {
    const f = await register('centralonly');
    const result = await migrateAll({ centralOnly: true });
    expect(result.exitCode).toBe(0);
    expect(result.lines.map((line) => line.kind)).toEqual(['central', 'summary']);
    expect(await stateOf(f.projectId)).toBeNull();
  });
});

describe('concurrent runs (T-09.2-77)', () => {
  it('two migrateAll calls started together leave every file applied once', async () => {
    const files = await laggingB(2);
    const f = await register('race');

    const [one, two] = await Promise.all([
      migrateAll({ projectIds: [f.projectId] }),
      migrateAll({ projectIds: [f.projectId] }),
    ]);
    expect(one.exitCode).toBe(0);
    expect(two.exitCode).toBe(0);
    const applied = [one, two]
      .map((run) => Number(lineOf(run.lines, f.ref)?.applied))
      .sort((x, y) => x - y);
    // The advisory lock serialises them: one applied both files, the other found nothing left.
    expect(applied).toEqual([0, 2]);
    expect(await ledgerOfB()).toEqual({ count: files.length, head: files.at(-1)?.version });
    const [sums] = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from supabase_migrations.rede_checksums where set = 'tenant'`;
    expect(sums?.n).toBe(files.length);
    expect(await stateOf(f.projectId)).toMatchObject({ status: 'current' });
  }, 240_000);
});

describe('a dead management token never reaches the fan-out (D-574, CTK-19, T-09.4-27)', () => {
  afterEach(() => {
    setProjectProviderForTests(undefined);
  });

  it('a customer project with a dead token (invalid) is migrated like any other: the DDL connection is not the Management API', async () => {
    const files = await laggingB(2);
    const f = await register('deadtok');
    await customerSetup.makeCustomerProject(f.projectId, 'sbp_fc_fake_migrate_dead');

    // A provider whose every method refuses with the 401 a revoked token earns, and counts the calls.
    const calls: string[] = [];
    const everyCallRefused = new Proxy({} as object, {
      get: (_target, name) => () => {
        calls.push(String(name));
        throw new ProjectProviderError('forbidden', 401, 'token_invalid', true);
      },
    }) as never;
    setProjectProviderForTests(everyCallRefused);

    const result = await migrateAll({ projectIds: [f.projectId], concurrency: 2 });
    expect(result.exitCode).toBe(0);
    expect(lineOf(result.lines, f.ref)).toMatchObject({ status: 'current', applied: 2 });
    expect(await ledgerOfB()).toEqual({ count: files.length, head: files.at(-1)?.version });
    expect(await stateOf(f.projectId)).toMatchObject({ status: 'current', error_code: null });
    // The member-visible fact it protects: the schema fan-out never asked the Management API anything.
    expect(calls).toEqual([]);
  }, 240_000);
});

// ---------------------------------------------------------------------------------------------------------
// Phase 12 (PFORM-25): the profile form migrations fan out to every project
// ---------------------------------------------------------------------------------------------------------

/** The three tenant migrations of the profile form, in the order the runner applies them. */
const PROFILE_FORM_VERSIONS = ['20261029232606', '20261029233037', '20261029234918'] as const;

/** Every function the two hand-written Phase 12 migrations create in the `app` schema. */
const PROFILE_FORM_FUNCTIONS = [
  'membership_in_tenant_gate',
  'memberships_of_user_gate',
  'profile_form_lock_active',
  'profile_form_missing',
  'profile_form_missing_self',
  'profile_form_question_guard',
] as const;

describe('Phase 12 (PFORM-25): the profile form migrations reach the second project', () => {
  it('applies the three migrations to a project that lacks them, and a second run applies nothing', async () => {
    // B holds the tenant set up to the migration just before the first Phase 12 file; the three files are pending.
    const all = await readMigrationDir(defaultMigrationDir('tenant'), 'tenant');
    const first = all.findIndex((file) => file.version === PROFILE_FORM_VERSIONS[0]);
    expect(first, 'the first Phase 12 migration is in the tenant set').toBeGreaterThanOrEqual(0);
    expect(all.slice(first, first + 3).map((file) => file.version)).toEqual([
      ...PROFILE_FORM_VERSIONS,
    ]);
    const behind = all.length - first;
    const files = await laggingB(behind);
    const f = await register('pform');

    const missing = () =>
      onB(async (b) => {
        const [row] = await b<
          { questions: string | null; answers: string | null; tr: number; fns: number }[]
        >`
          select to_regclass('public.profile_form_questions')::text as questions,
                 to_regclass('public.profile_form_answers')::text as answers,
                 (select count(*)::int from pg_trigger
                   where tgname = 'profile_form_questions_guard' and not tgisinternal) as tr,
                 (select count(*)::int
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'app' and p.proname = any(${[...PROFILE_FORM_FUNCTIONS]}::text[])) as fns`;
        return row;
      });

    // Before: none of it exists in B.
    expect(await missing()).toEqual({ questions: null, answers: null, tr: 0, fns: 0 });
    expect((await ledgerOfB()).count).toBe(files.length - behind);

    const run = await migrateAll({ concurrency: 2 });
    expect(run.exitCode).toBe(0);
    expect(lineOf(run.lines, f.ref)).toMatchObject({ status: 'current', applied: behind });

    // After: both tables, the guard trigger and every function are there, and the ledger lists the three files.
    expect(await missing()).toEqual({
      questions: 'profile_form_questions',
      answers: 'profile_form_answers',
      tr: 1,
      fns: PROFILE_FORM_FUNCTIONS.length,
    });
    const listed = await onB(async (b) => {
      const rows = await b<{ version: string }[]>`
        select version from supabase_migrations.schema_migrations
         where version = any(${[...PROFILE_FORM_VERSIONS]}::text[]) order by version`;
      return rows.map((row) => row.version);
    });
    expect(listed).toEqual([...PROFILE_FORM_VERSIONS]);
    const head = files.at(-1)?.version;
    expect(await ledgerOfB()).toEqual({ count: files.length, head });
    expect(await stateOf(f.projectId)).toMatchObject({ status: 'current', error_code: null });

    // A tenant of that database with no module row owes nothing: the lookup answers 0.
    const owed = await onB(async (b) => {
      const [row] = await b<{ n: number }[]>`
        select app.profile_form_missing(gen_random_uuid(), gen_random_uuid()) as n`;
      return row?.n;
    });
    expect(owed).toBe(0);

    // The second run is a no-op: nothing applied, the ledger and the state are unchanged.
    const second = await migrateAll({ concurrency: 2 });
    expect(second.exitCode).toBe(0);
    expect(lineOf(second.lines, f.ref)).toMatchObject({ status: 'current', applied: 0 });
    expect(await ledgerOfB()).toEqual({ count: files.length, head });
    expect(await stateOf(f.projectId)).toMatchObject({ status: 'current' });
  }, 240_000);
});
