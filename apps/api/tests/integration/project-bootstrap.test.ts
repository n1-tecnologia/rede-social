import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import {
  defaultMigrationDir,
  type MigrationFile,
  readMigrationDir,
} from '@rede-social/core/server/migrations/sets';
import {
  type BootstrapDeps,
  claimStep,
  listSteps,
  resumeBootstrap,
  runBootstrap,
  startBootstrap,
} from '@rede-social/core/server/projects/bootstrap';
import { PROJECT_BOOTSTRAP_QUEUE } from '@rede-social/core/server/projects/bootstrap-job';
import {
  createFakeProjectProvider,
  type FakeFailAt,
  type FakeProjectProvider,
} from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { BOOTSTRAP_REASONS, BOOTSTRAP_STEPS } from '@rede-social/core/server/projects/reasons';
import { defaultSecrets } from '@rede-social/core/server/projects/steps';
import { open, seal } from '@rede-social/core/server/secrets/sealed';
import {
  closeAllPools,
  resolveProjectById,
} from '@rede-social/core/server/tenancy/project-registry';
import { resolveTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_ORG, makeCustomerProject } from './projects-setup';
import { adminSql, api, authAdmin, SEED_PASSWORD, signInAs } from './setup';

/**
 * The log lines of the bootstrap engine are captured so the secrets scan can read what a person tailing the
 * logs would see (PR-4). Every other logger keeps its real behaviour.
 */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/logging')>();
  const record = (...args: unknown[]) => {
    captured.lines.push(JSON.stringify(args));
  };
  const spy = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
    fatal: record,
  };
  return {
    ...real,
    moduleLogger: (name: string) =>
      name === 'project-bootstrap' ? (spy as never) : real.moduleLogger(name),
  };
});

/**
 * Phase 09.2-13 (DBT-17, DBT-18, DBT-19, DBT-36), the tracer and the engine's guarantees. Every case drives the
 * REAL engine, steps, runner, sealing, registry and queue against the FAKE project provider mapped to the
 * second local database `rede_tenant_b`; nothing here touches a hosted project. The `postgres` password the
 * fake "sets" is never applied (the fake records it), so the DDL connection is redirected to the local
 * superuser; the `api_user` URLs are the real ones, and the stored credentials are proven by logging in with
 * them.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const B_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54322/rede_tenant_b';
const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const QUEUE = PROJECT_BOOTSTRAP_QUEUE;

const RUN = Date.now().toString(36);
let counter = 0;

/**
 * A freshly created, EMPTY `rede_tenant_b`, like a new hosted project: the Supabase platform schemas and
 * nothing else (`--bare` skips the tenant set the bootstrap is about to apply).
 */
function resetB(): void {
  execFileSync('bash', ['scripts/db-two-databases.sh', '--reset', '--bare'], {
    cwd: ROOT,
    timeout: 120_000,
    stdio: 'pipe',
  });
}

/** A short-lived connection to B (the database is dropped between cases, so no long-lived client survives). */
async function onB<T>(fn: (b: postgres.Sql) => Promise<T>): Promise<T> {
  const b = postgres(B_ADMIN_URL, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    return await fn(b);
  } finally {
    await b.end({ timeout: 5 });
  }
}

let manifest: MigrationFile[] = [];

type Fixture = {
  projectId: string;
  tenantId: string;
  ref: string;
  slug: string;
  host: string;
  email: string;
  provider: FakeProjectProvider;
  deps: BootstrapDeps & { sendInvites: ReturnType<typeof vi.fn>; connects: string[] };
  cleanup: () => Promise<void>;
};

const SECRET_MARKERS = {
  ddlPassword: () => `DDL${randomBytes(18).toString('hex')}`,
};

/**
 * One throwaway project in `preparing` with one tenant bound to it explicitly, a verified host, one central
 * module row and (optionally) the first admin's pending invite. The fake provider maps the project's ref to B.
 */
async function newProject(
  options: {
    failAt?: FakeFailAt;
    pendingInvite?: boolean;
    bindTenant?: boolean;
    sealed?: boolean;
    apiUserPassword?: () => string;
    /** 09.4-06: the row is a CUSTOMER project whose sealed management token is this fake token. */
    customerToken?: string;
  } = {},
): Promise<Fixture> {
  counter += 1;
  const projectId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const ref = `fk-${randomBytes(6).toString('hex')}`;
  const slug = `bs-${RUN}-${counter}`;
  const host = `${slug}.localhost`;
  const email = `admin-${slug}@rede-demo.local`;
  const pending = options.pendingInvite ?? true;

  await adminSql.begin(async (tx) => {
    await tx`
      insert into platform.projects (id, ref, provider, credential_source, state, api_url)
      values (${projectId}::uuid, ${ref}, 'fake', 'sealed', 'preparing', '')`;
    await tx`
      insert into public.tenants (id, slug, display_name, rules_text, rules_version)
      values (${tenantId}::uuid, ${slug}, 'Tenant (central mirror)', 'Regras.', 1)`;
    await tx`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'feed', true), (${tenantId}::uuid, 'store', false)`;
    await tx`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${host}, true, now())`;
    if (options.bindTenant !== false) {
      await tx`
        insert into platform.tenant_projects (tenant_id, project_id, pending_invite)
        values (${tenantId}::uuid, ${projectId}::uuid,
                ${pending ? JSON.stringify({ email, createdBy: crypto.randomUUID() }) : null}::jsonb)`;
    }
  });

  const provider = createFakeProjectProvider({
    targets: {
      [ref]: {
        apiUrl: API_URL,
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
    ...(options.failAt ? { failAt: options.failAt } : {}),
    ...(options.customerToken
      ? { orgSlug: CUSTOMER_ORG, tokens: { [options.customerToken]: { refs: 'all' as const } } }
      : {}),
  });
  if (options.customerToken) await makeCustomerProject(projectId, options.customerToken);

  const connects: string[] = [];
  const sendInvites = vi.fn(async () => undefined);
  const deps = {
    provider,
    // The fake never applies the `postgres` password it records: the DDL connection goes to the local
    // superuser. Everything else (the `api_user` URLs) is used exactly as stored.
    connect: (kind: 'ddl' | 'api', url: string) => {
      connects.push(kind);
      return postgres(kind === 'ddl' ? B_ADMIN_URL : url, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 2,
        onnotice: () => undefined,
      });
    },
    secrets: {
      ...defaultSecrets,
      ddlPassword: SECRET_MARKERS.ddlPassword,
      // The local cluster shares its roles: a generated password would lock project 0 out of `api_user`.
      apiUserPassword: options.apiUserPassword ?? (() => 'postgres'),
    },
    config: () => ({
      platformOrigin: 'https://app.example.test',
      apiPublicUrl: 'https://api.example.test',
      mailDomain: 'mail.example.test',
      smtpPass: `SMTP${randomBytes(12).toString('hex')}`,
    }),
    sendInvites,
    connects,
  } satisfies BootstrapDeps & { connects: string[]; sendInvites: ReturnType<typeof vi.fn> };

  if (options.sealed) {
    await adminSql`
      update platform.projects
         set api_url = ${API_URL},
             publishable_key = 'manual_publishable',
             service_key_sealed = ${seal('manual-service-key', `${projectId}:service_key`)},
             service_key_kind = 'secret',
             ddl_url_sealed = ${seal('postgres://postgres:manual@127.0.0.1:54322/rede_tenant_b', `${projectId}:ddl_url`)},
             secret_key_id = 1
       where id = ${projectId}::uuid`;
  }

  const cleanup = async () => {
    await adminSql`
      delete from pgboss_platform.job where name = ${QUEUE} and data->>'projectId' = ${projectId}`;
    await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
    await adminSql`delete from platform.projects where id = ${projectId}::uuid`;
  };
  return { projectId, tenantId, ref, slug, host, email, provider, deps, cleanup };
}

const stepStatuses = async (projectId: string) =>
  (await listSteps(projectId)).map((row) => [row.step, row.status] as const);

const allDone = BOOTSTRAP_STEPS.map((step) => [step, 'done'] as const);

beforeAll(async () => {
  manifest = await readMigrationDir(defaultMigrationDir('tenant'), 'tenant');
});

afterAll(async () => {
  // Locally the roles are shared by the whole cluster: whatever a test did to `api_user`, put it back.
  await adminSql`alter role api_user with login password 'postgres'`;
  await stopBoss();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
  // Leave `rede_tenant_b` as the other suites expect it: the tenant set applied and no fixtures.
  execFileSync('bash', ['scripts/db-two-databases.sh', '--reset'], {
    cwd: ROOT,
    timeout: 120_000,
    stdio: 'pipe',
  });
});

const live: Fixture[] = [];
async function fixture(options: Parameters<typeof newProject>[0] = {}): Promise<Fixture> {
  const f = await newProject(options);
  live.push(f);
  return f;
}
afterEach(async () => {
  captured.lines.length = 0;
  while (live.length > 0) await live.pop()?.cleanup();
});

// ---------------------------------------------------------------------------------------------------------
// The tracer
// ---------------------------------------------------------------------------------------------------------

describe('the tracer: an empty database becomes a ready tenant database and serves a request', () => {
  it('tracer: eight steps, a ready project, a request served from the new database', async () => {
    resetB();
    const f = await fixture();

    // startBootstrap: eight pending rows and a job whose payload is the project id and nothing else.
    const started = await startBootstrap(f.projectId);
    expect(started.jobId).toEqual(expect.any(String));
    expect(await stepStatuses(f.projectId)).toEqual(BOOTSTRAP_STEPS.map((s) => [s, 'pending']));
    const jobs = await adminSql<{ data: unknown; singleton_key: string }[]>`
      select data, singleton_key from pgboss_platform.job_common
       where name = ${QUEUE} and data->>'projectId' = ${f.projectId}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ projectId: f.projectId });
    expect(jobs[0]?.singleton_key).toBe(f.projectId);

    // While nothing is done the host answers "preparing".
    const before = await resolveTenantHost(f.host);
    expect(before).toMatchObject({ kind: 'tenant', status: 'preparing' });

    const outcome = await runBootstrap(f.projectId, f.deps);
    expect(outcome).toEqual({ status: 'ready' });

    expect(await stepStatuses(f.projectId)).toEqual(allDone);
    const project = await resolveProjectById(f.projectId);
    expect(project?.state).toBe('ready');

    // Database B: the tenant ledger is complete and the control-plane schema is absent.
    await onB(async (b) => {
      const [ledger] = await b<{ n: number }[]>`
        select count(*)::int as n from supabase_migrations.schema_migrations`;
      expect(ledger?.n).toBe(manifest.length);
      const [gone] = await b<
        { gone: boolean }[]
      >`select to_regnamespace('platform') is null as gone`;
      expect(gone?.gone).toBe(true);
      // The tenant and its modules were copied; the invite has no creator (DBT-36).
      const [tenant] = await b<{ n: number }[]>`
        select count(*)::int as n from public.tenants where id = ${f.tenantId}::uuid`;
      expect(tenant?.n).toBe(1);
      const [modules] = await b<{ n: number }[]>`
        select count(*)::int as n from public.tenant_modules where tenant_id = ${f.tenantId}::uuid`;
      expect(modules?.n).toBe(2);
      const invites = await b<{ email: string; created_by: string | null; status: string }[]>`
        select email::text as email, created_by, status from public.tenant_invites
         where tenant_id = ${f.tenantId}::uuid`;
      expect(invites).toEqual([{ email: f.email, created_by: null, status: 'pending' }]);
    });
    expect(f.deps.sendInvites).toHaveBeenCalledTimes(1);
    expect(f.deps.sendInvites).toHaveBeenCalledWith(f.tenantId);

    // The stored sealed URLs work: api_user logs in through both.
    expect(project?.databaseUrlTxSealed).toBeTruthy();
    expect(project?.databaseUrlSessionSealed).toBeTruthy();
    for (const [sealed, column] of [
      [project?.databaseUrlTxSealed, 'database_url_tx'],
      [project?.databaseUrlSessionSealed, 'database_url_session'],
    ] as const) {
      const url = open(sealed as string, `${f.projectId}:${column}`);
      const probe = postgres(url, { max: 1, prepare: false });
      try {
        const [row] = await probe<{ u: string }[]>`select current_user as u`;
        expect(row?.u).toBe('api_user');
      } finally {
        await probe.end({ timeout: 5 });
      }
    }
    // credential_version moved once (roles), the project's own coordinates are stored.
    expect(project?.credentialVersion).toBe(2);
    expect(project?.apiUrl).toBe(API_URL);
    expect(project?.publishableKey).toBe(`fake_publishable_${f.ref}`);
    expect(project?.serviceKeyKind).toBe('secret');
    expect(project?.hookRef).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // The Auth PATCH: the send-email hook on with this project's URI, both access hooks off (T-09.2-64).
    const authPatches = (f.provider.calls.patches[f.ref] ?? []).filter((p) => p.target === 'auth');
    expect(authPatches).toHaveLength(1);
    const body = authPatches[0]?.body ?? {};
    expect(body.hook_send_email_enabled).toBe(true);
    expect(String(body.hook_send_email_uri)).toMatch(
      new RegExp(`/v1/hooks/auth/send-email/${project?.hookRef}$`),
    );
    expect(body.hook_before_user_created_enabled).toBe(false);
    expect(body.hook_custom_access_token_enabled).toBe(false);
    expect(body.disable_signup).toBe(true);
    // The Data API closure PATCH carries the closed schema.
    const postgrestPatches = (f.provider.calls.patches[f.ref] ?? []).filter(
      (p) => p.target === 'postgrest',
    );
    expect(postgrestPatches).toHaveLength(1);
    expect(postgrestPatches[0]?.body.db_schema).toBe('data_api_closed');

    // The pending invite was consumed.
    const [left] = await adminSql<{ pending_invite: unknown }[]>`
      select pending_invite from platform.tenant_projects where tenant_id = ${f.tenantId}::uuid`;
    expect(left?.pending_invite).toBeNull();

    // The host leaves "preparing" at once on this instance, and the tenant is SERVED FROM THE NEW DATABASE:
    // the name below exists only in B, the central mirror carries another.
    expect(await resolveTenantHost(f.host)).toMatchObject({ kind: 'tenant', status: 'active' });
    const userEmail = `member-${f.slug}@rede-demo.local`;
    const created = await authAdmin().createUser({
      email: userEmail,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const userId = created.data.user?.id ?? '';
    try {
      await onB(async (b) => {
        await b`update public.tenants set display_name = 'Served from the new database' where id = ${f.tenantId}::uuid`;
        await b`
          insert into auth.users (id, email, aud, role, email_confirmed_at)
          values (${userId}::uuid, ${userEmail}, 'authenticated', 'authenticated', now())`;
        await b`
          insert into public.memberships (tenant_id, user_id, role, status)
          values (${f.tenantId}::uuid, ${userId}::uuid, 'member', 'active')`;
      });
      const token = await signInAs(userEmail, SEED_PASSWORD);
      const res = await api.request('/v1/me/bootstrap', {
        headers: { authorization: `Bearer ${token}`, 'x-tenant-host': f.host },
      });
      expect(res.status).toBe(200);
      const served = (await res.json()) as { tenant: { id: string; displayName: string } };
      expect(served.tenant.id).toBe(f.tenantId);
      expect(served.tenant.displayName).toBe('Served from the new database');
    } finally {
      await authAdmin().deleteUser(userId);
      await adminSql`delete from public.access_grants where email = ${userEmail}`;
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------------
// Failure and resume (DBT-18, P36)
// ---------------------------------------------------------------------------------------------------------

describe('per-step failure and resume (DBT-18, P36)', () => {
  for (const [index, step] of BOOTSTRAP_STEPS.entries()) {
    it(`${step}: fails once, stops, resumes at that step and repeats no finished step`, async () => {
      resetB();
      const f = await fixture({ failAt: { step, times: 1 } });

      const failed = await runBootstrap(f.projectId, f.deps);
      expect(failed).toMatchObject({ status: 'failed', step });
      const reason = (failed as { reason: string }).reason;
      expect(BOOTSTRAP_REASONS).toContain(reason);

      const rows = await listSteps(f.projectId);
      expect(rows.map((row) => row.status)).toEqual(
        BOOTSTRAP_STEPS.map((_, i) => (i < index ? 'done' : i === index ? 'failed' : 'pending')),
      );
      expect(rows[index]).toMatchObject({ attempt: 1, reasonCode: reason });
      // A stopped run leaves the project preparing and the host answering "preparing".
      expect((await resolveProjectById(f.projectId))?.state).toBe('preparing');
      expect(await resolveTenantHost(f.host)).toMatchObject({ status: 'preparing' });

      const snapshot = {
        patches: structuredClone(f.provider.calls.patches[f.ref] ?? []),
        describes: f.provider.calls.describes[f.ref] ?? 0,
        keys: f.provider.calls.ensureKeys[f.ref] ?? 0,
        passwords: f.provider.calls.passwords.length,
        version: (await resolveProjectById(f.projectId))?.credentialVersion,
        hookRef: (await resolveProjectById(f.projectId))?.hookRef,
      };

      await resumeBootstrap(f.projectId);
      // "Tentar de novo" put only the failed step back.
      expect((await listSteps(f.projectId))[index]?.status).toBe('pending');
      expect((await listSteps(f.projectId))[index]?.reasonCode).toBeNull();
      for (const earlier of (await listSteps(f.projectId)).slice(0, index)) {
        expect(earlier.status).toBe('done');
      }

      expect(await runBootstrap(f.projectId, f.deps)).toEqual({ status: 'ready' });
      const final = await listSteps(f.projectId);
      expect(final.map((row) => row.status)).toEqual(BOOTSTRAP_STEPS.map(() => 'done'));
      // Finished steps ran exactly once; the failed one ran twice.
      expect(final.map((row) => row.attempt)).toEqual(
        BOOTSTRAP_STEPS.map((_, i) => (i === index ? 2 : 1)),
      );

      // Side effects of the finished steps are unchanged: the recorded PATCHes of the first run are a prefix
      // of the final list, and the single-shot provider calls did not repeat.
      const patches = f.provider.calls.patches[f.ref] ?? [];
      expect(patches.slice(0, snapshot.patches.length)).toEqual(snapshot.patches);
      if (index > 0) {
        expect(f.provider.calls.describes[f.ref]).toBe(snapshot.describes);
        expect(f.provider.calls.ensureKeys[f.ref]).toBe(snapshot.keys);
        expect(f.provider.calls.passwords).toHaveLength(snapshot.passwords);
      }
      if (index > 1) {
        const now = await resolveProjectById(f.projectId);
        expect(now?.credentialVersion).toBe(snapshot.version);
      }
      if (index > 3)
        expect((await resolveProjectById(f.projectId))?.hookRef).toBe(snapshot.hookRef);
      await onB(async (b) => {
        const [ledger] = await b<{ n: number }[]>`
          select count(*)::int as n from supabase_migrations.schema_migrations`;
        expect(ledger?.n).toBe(manifest.length);
      });
      // Exactly one closure PATCH and one Auth PATCH in the whole story, unless their own step failed.
      const count = (target: string) => patches.filter((p) => p.target === target).length;
      expect(count('postgrest')).toBe(1);
      expect(count('auth')).toBe(1);
    }, 180_000);
  }

  it('a failure that is not the provider maps to the step code, and a migration failure stops the run', async () => {
    resetB();
    const f = await fixture();
    const broken: MigrationFile[] = [
      ...manifest.slice(0, 10),
      {
        set: 'tenant',
        version: '99990101000000',
        name: 'broken',
        text: 'select no_such_function();',
        sha256: 'f'.repeat(64),
      },
    ];
    const failed = await runBootstrap(f.projectId, {
      ...f.deps,
      loadTenantSet: async () => broken,
    });
    expect(failed).toEqual({ status: 'failed', step: 'schema', reason: 'migration_failed' });
    // A prefix of the manifest was applied; nothing after it, and no Data API closure was sent.
    expect((f.provider.calls.patches[f.ref] ?? []).filter((p) => p.target === 'postgrest')).toEqual(
      [],
    );
    expect((await stepStatuses(f.projectId)).slice(0, 3)).toEqual([
      ['verify', 'done'],
      ['roles', 'done'],
      ['schema', 'failed'],
    ]);

    // Pitfall 13: a ledger that is a prefix of the manifest RESUMES once the schema step has started.
    await resumeBootstrap(f.projectId);
    expect(await runBootstrap(f.projectId, f.deps)).toEqual({ status: 'ready' });
    await onB(async (b) => {
      const [ledger] = await b<{ n: number }[]>`
        select count(*)::int as n from supabase_migrations.schema_migrations`;
      expect(ledger?.n).toBe(manifest.length);
    });
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------------
// Claims, order, empty, non-empty, manual access (P32-P35)
// ---------------------------------------------------------------------------------------------------------

describe('steps are claimed once (P35)', () => {
  it('two runs started together execute each step once and the loser returns skipped', async () => {
    resetB();
    const f = await fixture();
    const outcomes = await Promise.all([
      runBootstrap(f.projectId, f.deps),
      runBootstrap(f.projectId, f.deps),
    ]);
    const statuses = outcomes.map((o) => o.status);
    expect(statuses).toContain('ready');
    expect(statuses).toContain('skipped');
    expect((await listSteps(f.projectId)).map((row) => row.attempt)).toEqual(
      BOOTSTRAP_STEPS.map(() => 1),
    );
    expect(f.provider.calls.ensureKeys[f.ref]).toBe(1);
    expect(f.provider.calls.passwords).toHaveLength(1);
    expect((await resolveProjectById(f.projectId))?.state).toBe('ready');
  }, 180_000);

  it('a running step older than 15 minutes is reclaimed, one that is 14 minutes old is not', async () => {
    const f = await fixture();
    await startBootstrap(f.projectId);
    const age = (minutes: number) => adminSql`
      update platform.project_bootstrap_steps
         set status = 'running', started_at = now() - make_interval(mins => ${minutes})
       where project_id = ${f.projectId}::uuid and step = 'verify'`;

    await age(14);
    expect(await claimStep(f.projectId, 'verify')).toBeNull();
    await age(16);
    expect(await claimStep(f.projectId, 'verify')).toEqual({ attempt: 1 });
    // The fresh claim is now itself running and not reclaimable.
    expect(await claimStep(f.projectId, 'verify')).toBeNull();
    // A done step is never claimed.
    await adminSql`
      update platform.project_bootstrap_steps set status = 'done'
       where project_id = ${f.projectId}::uuid and step = 'roles'`;
    expect(await claimStep(f.projectId, 'roles')).toBeNull();
  });
});

describe('adjacency and order (P32, P34)', () => {
  it('the fixed order of the eight steps', () => {
    expect([...BOOTSTRAP_STEPS]).toEqual([
      'verify',
      'roles',
      'schema',
      'auth',
      'buckets',
      'realtime',
      'tenant',
      'invite',
    ]);
  });

  it('the Data API closure comes after the last ledger row, and steps run once each in order', async () => {
    resetB();
    const f = await fixture();
    const events: string[] = [];
    let ledgerAtClosure = -1;
    const wrapped: FakeProjectProvider = {
      ...f.provider,
      async patchPostgrest(ref, body) {
        ledgerAtClosure = await onB(async (b) => {
          const [row] = await b<{ n: number }[]>`
            select count(*)::int as n from supabase_migrations.schema_migrations`;
          return row?.n ?? 0;
        });
        events.push('patchPostgrest');
        return f.provider.patchPostgrest(ref, body);
      },
      async patchAuthConfig(ref, body) {
        events.push('patchAuthConfig');
        return f.provider.patchAuthConfig(ref, body);
      },
      async patchStorage(ref, body) {
        events.push('patchStorage');
        return f.provider.patchStorage(ref, body);
      },
      async patchRealtime(ref, body) {
        events.push('patchRealtime');
        return f.provider.patchRealtime(ref, body);
      },
    };
    expect(await runBootstrap(f.projectId, { ...f.deps, provider: wrapped })).toEqual({
      status: 'ready',
    });
    expect(ledgerAtClosure).toBe(manifest.length);
    expect(events).toEqual(['patchPostgrest', 'patchAuthConfig', 'patchStorage', 'patchRealtime']);

    // Step N+1 never starts before step N is done.
    const rows = await listSteps(f.projectId);
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1];
      const current = rows[i];
      const finished = previous?.finishedAt;
      const started = current?.startedAt;
      expect(finished).toBeInstanceOf(Date);
      expect(started).toBeInstanceOf(Date);
      expect((started as Date).getTime()).toBeGreaterThanOrEqual((finished as Date).getTime());
    }
  }, 180_000);

  it('finished_at and started_at come from the same clock: a process clock an hour behind never ends a step before it started', async () => {
    resetB();
    const f = await fixture({ failAt: { step: 'roles', times: 1 } });
    // Only `Date` is faked (postgres.js and the fake provider keep real timers). Before the fix `finishStep` and
    // `failStep` stamped `new Date()`, so `finished_at` landed an hour before the database's `started_at`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 3_600_000);
    try {
      expect(await runBootstrap(f.projectId, f.deps)).toMatchObject({
        status: 'failed',
        step: 'roles',
      });
    } finally {
      vi.useRealTimers();
    }
    const rows = await listSteps(f.projectId);
    // 'verify' ended `done` (finishStep) and 'roles' ended `failed` (failStep): both are checked.
    expect(rows.slice(0, 2).map((row) => row.status)).toEqual(['done', 'failed']);
    for (const row of rows.slice(0, 2)) {
      expect((row.finishedAt as Date).getTime()).toBeGreaterThanOrEqual(
        (row.startedAt as Date).getTime(),
      );
    }
  }, 120_000);

  it('listSteps returns the fixed order whatever the insertion order and the timestamps', async () => {
    const f = await fixture();
    await adminSql.begin(async (tx) => {
      let i = 0;
      for (const step of [...BOOTSTRAP_STEPS].reverse()) {
        i += 1;
        await tx`
          insert into platform.project_bootstrap_steps (project_id, step, status, started_at, finished_at)
          values (${f.projectId}::uuid, ${step}, 'done',
                  now() - make_interval(mins => ${(i * 7) % 5}),
                  now() - make_interval(mins => ${(i * 3) % 4}))`;
      }
    });
    expect((await listSteps(f.projectId)).map((row) => row.step)).toEqual([...BOOTSTRAP_STEPS]);
  });
});

describe('empty and degenerate projects (P33)', () => {
  it('zero rows become exactly eight, twice still eight; one job waits per project', async () => {
    const f = await fixture();
    expect(await listSteps(f.projectId)).toEqual([]);
    const first = await startBootstrap(f.projectId);
    expect(first.jobId).toEqual(expect.any(String));
    expect(await listSteps(f.projectId)).toHaveLength(8);
    const second = await startBootstrap(f.projectId);
    expect(second.jobId).toBeNull();
    expect(await listSteps(f.projectId)).toHaveLength(8);
    const [jobs] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss_platform.job_common
       where name = ${QUEUE} and data->>'projectId' = ${f.projectId}`;
    expect(jobs?.n).toBe(1);
  });

  it('a project with no tenant bound fails closed with reason unknown before any database is touched', async () => {
    const f = await fixture({ bindTenant: false });
    const outcome = await runBootstrap(f.projectId, f.deps);
    expect(outcome).toEqual({ status: 'failed', step: 'verify', reason: 'unknown' });
    expect(f.deps.connects).toEqual([]);
    expect(f.provider.calls.describes[f.ref]).toBeUndefined();
    expect((await resolveProjectById(f.projectId))?.serviceKeySealed).toBeNull();
  });

  it('an invite step with no pending input is done and creates nothing', async () => {
    resetB();
    const f = await fixture({ pendingInvite: false });
    expect(await runBootstrap(f.projectId, f.deps)).toEqual({ status: 'ready' });
    expect(f.deps.sendInvites).not.toHaveBeenCalled();
    await onB(async (b) => {
      const [row] = await b<{ n: number }[]>`select count(*)::int as n from public.tenant_invites`;
      expect(row?.n).toBe(0);
    });
  }, 180_000);

  it('the central project (credential_source env) is never bootstrapped', async () => {
    const [central] = await adminSql<{ id: string }[]>`
      select id::text as id from platform.projects where is_central`;
    const before = await adminSql`select count(*)::int as n from platform.project_bootstrap_steps`;
    expect(await runBootstrap(central?.id ?? '', {})).toEqual({ status: 'not_applicable' });
    const after = await adminSql`select count(*)::int as n from platform.project_bootstrap_steps`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('a project that already holds data is refused (T-09.2-63)', () => {
  it('a public table fails verify with not_empty and applies nothing', async () => {
    resetB();
    await onB((b) => b`create table public.somebody_elses_data (id int)`);
    const f = await fixture();
    const outcome = await runBootstrap(f.projectId, f.deps);
    expect(outcome).toEqual({ status: 'failed', step: 'verify', reason: 'not_empty' });
    await onB(async (b) => {
      const [ledger] = await b<{ present: boolean }[]>`
        select to_regclass('supabase_migrations.schema_migrations') is not null as present`;
      // Nothing was applied: the runner never created its ledger.
      expect(ledger?.present).toBe(false);
      const [tenants] = await b<{ present: boolean }[]>`
        select to_regclass('public.tenants') is not null as present`;
      expect(tenants?.present).toBe(false);
    });
    expect((await stepStatuses(f.projectId)).slice(1).every(([, s]) => s === 'pending')).toBe(true);
  }, 120_000);
});

describe('manual access (D-541)', () => {
  it('credentials sealed beforehand are used as found and never re-obtained', async () => {
    resetB();
    const f = await fixture({ sealed: true });
    const before = await resolveProjectById(f.projectId);
    expect(await runBootstrap(f.projectId, f.deps)).toEqual({ status: 'ready' });
    expect(f.provider.calls.passwords).toHaveLength(0);
    expect(f.provider.calls.ensureKeys[f.ref]).toBeUndefined();
    const after = await resolveProjectById(f.projectId);
    expect(after?.serviceKeySealed).toBe(before?.serviceKeySealed);
    expect(after?.ddlUrlSealed).toBe(before?.ddlUrlSealed);
    expect(after?.publishableKey).toBe('manual_publishable');
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------------
// Secrets (PR-4, T-09.2-61)
// ---------------------------------------------------------------------------------------------------------

describe('no credential outside the sealed registry (PR-4)', () => {
  async function scan(f: Fixture, plaintexts: string[]): Promise<void> {
    const jobs = await adminSql`
      select data from pgboss_platform.job_common where data->>'projectId' = ${f.projectId}`;
    const steps = await adminSql`
      select * from platform.project_bootstrap_steps where project_id = ${f.projectId}::uuid`;
    const row = await adminSql`
      select id, ref, state, api_url, publishable_key, hook_ref, credential_version
        from platform.projects where id = ${f.projectId}::uuid`;
    const haystacks = {
      jobs: JSON.stringify(jobs),
      steps: JSON.stringify(steps),
      registryPlain: JSON.stringify(row),
      logs: captured.lines.join('\n'),
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of [...plaintexts, 'postgres://', 'sb_secret_', 'v1,whsec_']) {
        expect(text.includes(secret), `${where} contains a credential`).toBe(false);
      }
    }
  }

  it('after a complete run, with a generated api_user password', async () => {
    resetB();
    const apiPassword = `API${randomBytes(18).toString('hex')}`;
    const f = await fixture({ apiUserPassword: () => apiPassword });
    await startBootstrap(f.projectId);
    try {
      expect(await runBootstrap(f.projectId, f.deps)).toEqual({ status: 'ready' });
    } finally {
      // The local cluster shares its roles.
      await adminSql`alter role api_user with login password 'postgres'`;
    }
    const project = await resolveProjectById(f.projectId);
    const hookSecret = open(project?.hookSecretSealed as string, `${f.projectId}:hook_secret`);
    const ddlUrl = open(project?.ddlUrlSealed as string, `${f.projectId}:ddl_url`);
    const ddlPassword = decodeURIComponent(new URL(ddlUrl).password);
    expect(ddlPassword).toMatch(/^DDL/);
    // The stored session URL carries the generated api_user password (it is sealed, so only the opened value shows it).
    const session = open(
      project?.databaseUrlSessionSealed as string,
      `${f.projectId}:database_url_session`,
    );
    expect(new URL(session).password).toBe(apiPassword);
    await scan(f, [apiPassword, ddlPassword, hookSecret, `fake_secret_${f.ref}`]);
    // The sealed columns themselves are ciphertext of the v1 wire format.
    expect(project?.serviceKeySealed).toMatch(/^v1:\d+:/);
    expect(project?.hookSecretSealed).toMatch(/^v1:\d+:/);
  }, 180_000);

  it('after a failed run', async () => {
    resetB();
    const f = await fixture({ failAt: { step: 'buckets', times: 'always' } });
    await startBootstrap(f.projectId);
    const outcome = await runBootstrap(f.projectId, f.deps);
    expect(outcome).toMatchObject({ status: 'failed', step: 'buckets' });
    const project = await resolveProjectById(f.projectId);
    const ddlPassword = decodeURIComponent(
      new URL(open(project?.ddlUrlSealed as string, `${f.projectId}:ddl_url`)).password,
    );
    const hookSecret = open(project?.hookSecretSealed as string, `${f.projectId}:hook_secret`);
    await scan(f, [ddlPassword, hookSecret, `fake_secret_${f.ref}`]);
  }, 180_000);

  it('a run that fails inside the runner names no SQL in the stored reason', async () => {
    resetB();
    const f = await fixture();
    const secretish: MigrationFile = {
      set: 'tenant',
      version: '99990101000001',
      name: 'leaky',
      text: "select 'LEAKME-should-never-be-stored'::int;",
      sha256: 'e'.repeat(64),
    };
    const outcome = await runBootstrap(f.projectId, {
      ...f.deps,
      loadTenantSet: async () => [...manifest, secretish],
    });
    expect(outcome).toMatchObject({ status: 'failed', step: 'schema', reason: 'migration_failed' });
    const steps = await adminSql`
      select * from platform.project_bootstrap_steps where project_id = ${f.projectId}::uuid`;
    expect(JSON.stringify(steps)).not.toContain('LEAKME');
    expect(captured.lines.join('\n')).not.toContain('LEAKME');
  }, 180_000);
});

describe('hooks stay disabled (T-09.2-64)', () => {
  it('the recorded Auth PATCH keeps both access hooks off on every attempt', async () => {
    resetB();
    const f = await fixture({ failAt: { step: 'auth', times: 1 } });
    await runBootstrap(f.projectId, f.deps);
    await resumeBootstrap(f.projectId);
    await runBootstrap(f.projectId, f.deps);
    const bodies = (f.provider.calls.patches[f.ref] ?? [])
      .filter((p) => p.target === 'auth')
      .map((p) => p.body);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.hook_before_user_created_enabled).toBe(false);
      expect(body.hook_custom_access_token_enabled).toBe(false);
    }
  }, 180_000);
});

describe('a customer project runs on its own token (09.4-06, CTK-22, T-09.4-19)', () => {
  it('customer: the provider steps use the project token and the platform token is never used', async () => {
    resetB();
    const f = await fixture({ customerToken: 'sbp_fc_fake_boot' });
    setProjectProviderForTests(f.provider);
    try {
      // No injected provider: the engine must resolve one per project.
      const { provider: _injected, ...withoutProvider } = f.deps;
      expect(await runBootstrap(f.projectId, withoutProvider)).toEqual({ status: 'ready' });
    } finally {
      setProjectProviderForTests(undefined);
    }
    const uses = f.provider.calls.tokenUses.filter((use) => use.ref === f.ref);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((use) => use.kind === 'platform')).toEqual([]);
  }, 120_000);

  it('a platform project is unchanged: the injected provider is used and its calls are platform uses', async () => {
    resetB();
    const f = await fixture();
    expect(await runBootstrap(f.projectId, f.deps)).toEqual({ status: 'ready' });
    const uses = f.provider.calls.tokenUses.filter((use) => use.ref === f.ref);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((use) => use.kind === 'platform')).toBe(true);
  }, 120_000);
});
