import { sqlClient } from '@rede-social/core/db';
import { applyDirectory } from '@rede-social/core/server/migrations/runner';
import {
  defaultMigrationDir,
  type MigrationFile,
  readMigrationDir,
} from '@rede-social/core/server/migrations/sets';
import { migrateAll } from '@rede-social/core/server/projects/migrate';
import { seal } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, B_ADMIN_URL, onB, resetB, restoreB } from './projects-setup';
import { adminSql, ensureSecondDatabase } from './setup';

/**
 * Phase 09.2-15 (DBT-23, DBT-24, D-544): `migrateAll`, the fan-out of the migration sets. The real runner, the
 * real registry and the real second database `rede_tenant_b`; a project is registered by hand (a sealed DDL URL
 * of B, which `postgres` can open directly) so no Management API is involved.
 */

const RUN = Date.now().toString(36);
let counter = 0;

type Registered = { projectId: string; tenantId: string; ref: string; slug: string };
const live: Registered[] = [];
let touchedB = false;

/** A ready project whose sealed DDL URL opens `rede_tenant_b`, with one tenant bound to it. */
async function register(
  tag: string,
  options: { url?: string; tenant?: boolean } = {},
): Promise<Registered> {
  counter += 1;
  const projectId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const ref = `ma-${tag}-${RUN}-${counter}`.slice(0, 40);
  const slug = `ma-${tag}-${RUN}-${counter}`.slice(0, 40);
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

const lineOf = (lines: Array<Record<string, unknown>>, ref: string) =>
  lines.find((line) => line.kind === 'project' && line.ref === ref);

/** The fan-out also records project 0 (the local stack); a leftover row would hold its tenants out after the next migration. */
async function clearCentralState(): Promise<void> {
  await adminSql`
    delete from platform.project_schema_state
     where project_id in (select id from platform.projects where is_central)`;
}

async function cleanup(): Promise<void> {
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
    const before = await ledgerOfB();

    const result = await migrateAll({ dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(lineOf(result.lines, f.ref)).toMatchObject({
      dryRun: true,
      status: 'behind',
      pending: files.slice(-2).map((file) => file.version),
    });
    expect(result.lines.at(-1)).toMatchObject({ kind: 'summary', dryRun: true });
    expect(await ledgerOfB()).toEqual(before);
    expect(await stateOf(f.projectId)).toBeNull();
  }, 240_000);
});
