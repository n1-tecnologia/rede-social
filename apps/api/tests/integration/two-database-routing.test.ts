import { createServer, type Server, type Socket } from 'node:net';
import { sqlClient } from '@rede-social/core/db';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { env } from '@rede-social/core/server/env';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  closeAllPools,
  invalidateProject,
  resolveProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { ensureProjectZero } from '@rede-social/core/server/tenancy/project-zero';
import {
  cachedTenantHostCount,
  resolveTenantHost,
} from '@rede-social/core/server/tenancy/tenant-host';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  adminSqlB,
  api,
  authAdmin,
  HOSTS,
  provisionTenantOnB,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  type TenantOnB,
} from './setup';

/**
 * Phase 09.2-03, the tracer (DBT-06, DBT-38, D-538): a tenant that lives ONLY in a second database
 * (`rede_tenant_b`) is served by an ordinary request. Its connection string comes out of the registry as a
 * SEALED value, its pool is held in the bounded cache, and `withTenantTx` / `membershipInTenant` route by the
 * tenant id. The central project holds a DIFFERENT display name for the same tenant id, so a read that wrongly
 * lands centrally shows in the assertion.
 */

const RUN = Date.now().toString(36);
const SLUG = `routing-b-${RUN}`.slice(0, 40);

type Bootstrap = { tenant: { id: string; displayName: string }; membership: { tenantId: string } };

let b: TenantOnB;

/**
 * Teardown that outlives a test body. CI run 40039284864 showed why: a test that hits its time limit is not
 * cancelled by vitest, and a `finally` inside its body never runs while the body is stuck awaiting something,
 * so the tenant it bound to an unreachable project stayed in the central database and failed ten other suites.
 * A hook still runs after a timed-out test, so a test registers each cleanup here right after the resource
 * exists, and the hooks below drain the list. Each entry leaves the list before it runs, so a second drain
 * finds nothing to do. Registration order is run order: a test registers the listener close before the tenant
 * cleanup, so the listener goes first, which ends any postgres.js retry loop still spinning against it, and
 * only then are the tenant rows removed.
 */
type Teardown = () => Promise<void>;
const teardowns: Teardown[] = [];
const onTeardown = (fn: Teardown): void => {
  teardowns.push(fn);
};
const drainTeardowns = async (): Promise<void> => {
  let first: unknown;
  let failed = false;
  for (let next = teardowns.shift(); next; next = teardowns.shift()) {
    try {
      await next();
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
    }
  }
  if (failed) throw first;
};

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: SLUG });
});

afterAll(async () => {
  try {
    await drainTeardowns();
    await b?.cleanup();
    await closeAllPools();
  } finally {
    await adminSqlB.end();
    await adminSql.end();
    await sqlClient.end();
  }
}, 120_000);

afterEach(async () => {
  await drainTeardowns();
}, 60_000);

const bootstrap = (token: string, host: string) =>
  api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });

describe('the tracer: a tenant bound to database B is served from database B', () => {
  it('tracer: GET /v1/me/bootstrap reads the tenant row of B while the central row differs', async () => {
    const res = await bootstrap(b.token, b.host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Bootstrap;
    expect(body.tenant.id).toBe(b.tenantId);
    expect(body.tenant.displayName).toBe('Tenant B (database B)');

    // The central project holds the same tenant id under another name: the answer did not come from there.
    const [central] = await adminSql<{ display_name: string }[]>`
      select display_name from public.tenants where id = ${b.tenantId}::uuid`;
    expect(central?.display_name).toBe('Tenant B (central mirror)');
  });

  it('the membership of that user exists in B and in no central table', async () => {
    const [inB] = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.memberships where user_id = ${b.userId}::uuid`;
    const [central] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships where user_id = ${b.userId}::uuid`;
    expect(inB?.n).toBe(1);
    expect(central?.n).toBe(0);
  });

  it('a request for a project-0 tenant (rede-lab) is unchanged and still reads project 0', async () => {
    const prefix = `routing-lab-${RUN}`;
    await removeIdentitiesByPrefix(prefix);
    const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@rede-demo.local`;
    const created = await authAdmin().createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    try {
      await adminSql`
        insert into public.memberships (tenant_id, user_id, role, status)
        select d.tenant_id, ${created.data.user?.id ?? ''}::uuid, 'member', 'active'
          from public.tenant_domains d
         where d.host = ${HOSTS.lab} and d.verified_at is not null
         limit 1`;
      const token = await signInAs(email, SEED_PASSWORD);
      const res = await bootstrap(token, HOSTS.lab);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Bootstrap;
      const [lab] = await adminSql<{ id: string; display_name: string }[]>`
        select id, display_name from public.tenants where slug = 'rede-lab'`;
      expect(body.tenant.id).toBe(lab?.id);
      expect(body.tenant.displayName).toBe(lab?.display_name);
      // ...and that tenant is bound to project 0, the central project.
      const [bound] = await adminSql<{ is_central: boolean; credential_source: string }[]>`
        select p.is_central, p.credential_source
          from platform.tenant_projects tp
          join platform.projects p on p.id = tp.project_id
         where tp.tenant_id = ${lab?.id ?? ''}::uuid`;
      expect(bound).toEqual({ is_central: true, credential_source: 'env' });
    } finally {
      await removeIdentitiesByPrefix(prefix);
    }
  });
});

type Envelope = { error: { code: string; message: string; details?: unknown } };

const ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

describe('every tenant is bound exactly once (DBT-46, P92)', () => {
  it('every tenant row of the central project has exactly one platform.tenant_projects row', async () => {
    const rows = await adminSql<{ tenant_id: string; n: number }[]>`
      select t.id as tenant_id, count(tp.tenant_id)::int as n
        from public.tenants t
        left join platform.tenant_projects tp on tp.tenant_id = t.id
       group by t.id
      having count(tp.tenant_id) <> 1`;
    expect(rows).toEqual([]);
  });

  it('P91: a tenant inserted while no project is flagged default fails at COMMIT, and the flag is restored', async () => {
    const slug = `unbound-${RUN}`.slice(0, 40);
    let failure: { code?: string } | undefined;
    try {
      await adminSql.begin(async (tx) => {
        await tx`update platform.projects set is_default = false where is_default`;
        await tx`
          insert into public.tenants (slug, display_name, rules_text, rules_version)
          values (${slug}, 'Sem vinculo', 'Regras.', 1)`;
      });
    } catch (error) {
      failure = error as { code?: string };
    } finally {
      await adminSql`
        update platform.projects set is_default = true
         where is_central and not exists (select 1 from platform.projects where is_default)`;
      await adminSql`delete from public.tenants where slug = ${slug}`;
    }
    expect(failure?.code).toBe('P0001');
    const [flag] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where is_default`;
    expect(flag?.n).toBe(1);
  });

  it('P92: two tenants inserted in parallel both end bound to the flagged default', async () => {
    const par = postgres(ADMIN_URL, { prepare: false, max: 4 });
    const slugs = [`par-a-${RUN}`.slice(0, 40), `par-b-${RUN}`.slice(0, 40)];
    try {
      await Promise.all(
        slugs.map((slug) =>
          par.begin(async (tx) => {
            await tx`
              insert into public.tenants (slug, display_name, rules_text, rules_version)
              values (${slug}, ${slug}, 'Regras.', 1)`;
            await tx`select pg_sleep(0.2)`;
          }),
        ),
      );
      const rows = await adminSql<{ slug: string; is_default: boolean }[]>`
        select t.slug, p.is_default
          from public.tenants t
          join platform.tenant_projects tp on tp.tenant_id = t.id
          join platform.projects p on p.id = tp.project_id
         where t.slug = any(${slugs})`;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.is_default)).toBe(true);
    } finally {
      await par`delete from public.tenants where slug = any(${slugs})`;
      await par.end();
    }
  });

  it('P92: a tenant inserted while another transaction clears is_default ends bound or fails at commit, never half-bound', async () => {
    const par = postgres(ADMIN_URL, { prepare: false, max: 4 });
    const slugs = [`race-a-${RUN}`.slice(0, 40), `race-b-${RUN}`.slice(0, 40)];
    const insert = (conn: postgres.Sql, slug: string) =>
      conn.unsafe(
        `insert into public.tenants (slug, display_name, rules_text, rules_version)
         values ('${slug}', '${slug}', 'Regras.', 1)`,
      );
    try {
      // Order 1: the clearing transaction is still open when the tenant commits: the tenant binds.
      const clearer = await par.reserve();
      const inserter = await par.reserve();
      await clearer.unsafe('begin');
      await clearer.unsafe('update platform.projects set is_default = false where is_default');
      await inserter.unsafe('begin');
      await insert(inserter, slugs[0] as string);
      await inserter.unsafe('commit');
      await clearer.unsafe('rollback');
      clearer.release();
      inserter.release();

      // Order 2: the tenant is pending when the flag is cleared and committed: its commit must fail.
      const pending = await par.reserve();
      await pending.unsafe('begin');
      await insert(pending, slugs[1] as string);
      await par`update platform.projects set is_default = false where is_default`;
      let failure: { code?: string } | undefined;
      try {
        await pending.unsafe('commit');
      } catch (error) {
        failure = error as { code?: string };
        await pending.unsafe('rollback').catch(() => undefined);
      }
      pending.release();
      expect(failure?.code).toBe('P0001');

      const bound = await par<{ slug: string }[]>`
        select t.slug
          from public.tenants t join platform.tenant_projects tp on tp.tenant_id = t.id
         where t.slug = any(${slugs})`;
      expect(bound.map((row) => row.slug)).toEqual([slugs[0]]);
      const unbound = await par<{ n: number }[]>`
        select count(*)::int as n from public.tenants t
         where t.slug = any(${slugs}) and not exists
               (select 1 from platform.tenant_projects tp where tp.tenant_id = t.id)`;
      expect(unbound[0]?.n).toBe(0);
    } finally {
      await par`
        update platform.projects set is_default = true
         where is_central and not exists (select 1 from platform.projects where is_default)`;
      await par`delete from public.tenants where slug = any(${slugs})`;
      await par.end();
    }
  });
});

describe('the lane opens on the registered project and no other (DBT-06, P14 / DBT-38, P75)', () => {
  const lane = async (tenantId: string) =>
    withTenantTx({ userId: crypto.randomUUID(), tenantId, role: 'member' }, async (tx) => {
      const db = await tx.execute<{ name: string }>(sql`select current_database() as name`);
      const names = await tx.execute<{ display_name: string }>(
        sql`select display_name from public.tenants`,
      );
      return { database: db[0]?.name, tenants: names.map((row) => row.display_name) };
    });

  it('a lane for tenant B runs on rede_tenant_b and sees only B; a lane for rede-lab runs on project 0 and never sees B', async () => {
    const [lab] = await adminSql<{ id: string; display_name: string }[]>`
      select id, display_name from public.tenants where slug = 'rede-lab'`;
    const inB = await lane(b.tenantId);
    expect(inB.database).toBe('rede_tenant_b');
    expect(inB.tenants).toEqual(['Tenant B (database B)']);

    const inLab = await lane(lab?.id ?? '');
    expect(inLab.database).toBe('postgres');
    expect(inLab.tenants).toEqual([lab?.display_name]);
    expect(inLab.tenants).not.toContain('Tenant B (database B)');
    expect(inLab.tenants).not.toContain('Tenant B (central mirror)');
  });
});

describe('fail closed: an unbound or unreachable tenant is never served from another project (T-09.2-14, PR-3)', () => {
  const connections = async () => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
       where datname = 'rede_tenant_b' and usename = 'api_user'`;
    return row?.n ?? 0;
  };

  it('a tenant that lost its binding answers 503 TENANT_PROJECT_UNBOUND and opens no tenant connection', async () => {
    const before = await connections();
    await adminSql`delete from platform.tenant_projects where tenant_id = ${b.tenantId}::uuid`;
    invalidateProject(b.tenantId);
    try {
      const res = await bootstrap(b.token, b.host);
      expect(res.status).toBe(503);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('TENANT_PROJECT_UNBOUND');
      expect(body.error.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/central mirror|database B|rede_tenant_b/);
      expect(await connections()).toBeLessThanOrEqual(before);
    } finally {
      await adminSql`
        insert into platform.tenant_projects (tenant_id, project_id)
        values (${b.tenantId}::uuid, ${b.projectId}::uuid)
        on conflict (tenant_id) do nothing`;
      invalidateProject(b.tenantId);
    }
    // ...and the restored binding serves again.
    expect((await bootstrap(b.token, b.host)).status).toBe(200);
  });

  it('a tenant whose project cannot be reached answers 503 TENANT_UNAVAILABLE, not a read of the central mirror', async () => {
    const down = await provisionTenantOnB({
      slug: `down-b-${RUN}`.slice(0, 40),
      databaseUrl: 'postgres://api_user:postgres@127.0.0.1:1/rede_tenant_b',
    });
    onTeardown(down.cleanup);
    const res = await bootstrap(down.token, down.host);
    expect(res.status).toBe(503);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('TENANT_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/central mirror|127\.0\.0\.1|postgres:\/\//);
  });
});

/**
 * 09.2-04, the tracer (DBT-04, D-537): the shell's by-host answer is read from the CENTRAL mirror through the
 * platform lane, never from the tenant's own database, so it survives an unreachable tenant project. Every
 * tenant project in this block points at a port nothing answers on (closed, or a listener that drops the
 * connection and counts it), so a read that wrongly reached the tenant database could not succeed.
 */
describe('by-host is served from the mirror while the tenant database is down (DBT-04, D-537)', () => {
  const CLOSED_PORT_URL = 'postgres://api_user:postgres@127.0.0.1:1/none';
  type ByHostBody = {
    slug: string;
    displayName: string;
    isPrimary: boolean;
    primaryHost: string;
    status: string;
  };
  const byHost = (host: string) =>
    api.request(`/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`);

  /**
   * A listener that accepts a TCP connection and resets it at once: an unreachable Postgres that counts. It
   * RESETS the connection, it does not close it cleanly, because postgres.js 3.4.9 retries a clean close
   * without end (the connect timer is re-armed on every attempt, src/connection.js lines 343, 445, 450-451)
   * and only an error event, which a reset produces, rejects the startup on every platform. net.Server has no
   * closeAllConnections (that belongs to http.Server), so the listener tracks the sockets it accepted and
   * destroys them in its own close.
   */
  const listen = (): Promise<{
    server: Server;
    port: number;
    attempts: () => number;
    close: () => Promise<void>;
  }> =>
    new Promise((resolve) => {
      let attempts = 0;
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        attempts += 1;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.resetAndDestroy();
      });
      const close = () =>
        new Promise<void>((done) => {
          server.close(() => done());
          for (const socket of sockets) socket.destroy();
        });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve({
          server,
          port: typeof address === 'object' && address ? address.port : 0,
          attempts: () => attempts,
          close,
        });
      });
    });

  let down: TenantOnB;
  const alias = `alias-${RUN}.localhost`;
  const unverified = `unverified-${RUN}.localhost`;

  beforeAll(async () => {
    down = await provisionTenantOnB({
      slug: `mirror-down-${RUN}`.slice(0, 40),
      databaseUrl: CLOSED_PORT_URL,
    });
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${down.tenantId}::uuid, ${alias}, false, now()),
             (${down.tenantId}::uuid, ${unverified}, false, null)`;
  });

  afterAll(async () => {
    await adminSql`delete from public.tenant_domains where host in (${alias}, ${unverified})`;
    await down?.cleanup();
  });

  it('tracer: the primary host answers 200 from the mirror, and the same tenant answers 503 TENANT_UNAVAILABLE on bootstrap', async () => {
    const res = await byHost(down.host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ByHostBody;
    // The central mirror carries the tenant row: the answer names ITS slug, and no database B row exists
    // behind a closed port to contradict it.
    expect(body.slug).toBe(`mirror-down-${RUN}`.slice(0, 40));
    expect(body.displayName).toBe('Tenant B (central mirror)');
    expect(body.isPrimary).toBe(true);
    expect(body.primaryHost).toBe(down.host);
    expect(body.status).toBe('active');

    // The data plane of the same tenant is down: 503 once the breaker has opened (and before it, too).
    let last: Envelope | undefined;
    let status = 0;
    for (let i = 0; i < 4; i += 1) {
      const res2 = await bootstrap(down.token, down.host);
      status = res2.status;
      last = (await res2.json()) as Envelope;
      expect(status).toBe(503);
    }
    expect(last?.error.code).toBe('TENANT_UNAVAILABLE');

    // ...and the shell's answer is unchanged with the breaker open.
    expect((await byHost(down.host)).status).toBe(200);
  });

  it('P8 adjacency: a verified alias answers from the mirror and names the primary; an unverified one is unknown', async () => {
    const res = await byHost(alias);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ByHostBody;
    expect(body.isPrimary).toBe(false);
    expect(body.primaryHost).toBe(down.host);

    const unknown = await byHost(unverified);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
  });

  it('P8 adjacency: hosts of two tenants that differ by one label never cross-resolve', async () => {
    const other = `${down.host.replace(/^[^.]+/, (label) => `${label}x`)}`;
    const near = await byHost(other);
    expect(near.status).toBe(404);
    // ...while the exact host of the first tenant still answers its own tenant.
    const own = (await (await byHost(down.host)).json()) as ByHostBody;
    expect(own.slug).toBe(`mirror-down-${RUN}`.slice(0, 40));
  });

  it('P9 empty: unknown, unverified, whitespace and no-row hosts answer 404 with no tenant database opened', async () => {
    const probe = await listen();
    onTeardown(probe.close);
    const counted = await provisionTenantOnB({
      slug: `mirror-count-${RUN}`.slice(0, 40),
      databaseUrl: `postgres://api_user:postgres@127.0.0.1:${probe.port}/none`,
    });
    onTeardown(counted.cleanup);
    const noRow = `no-row-${RUN}.example.com`;
    const cases = [noRow, unverified, '  ', ' '];
    for (const host of cases) {
      const res = await byHost(host);
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
    }
    // The query-level empty string fails validation before any lookup (no resolver, no database).
    const empty = await api.request('/v1/public/tenants/by-host?host=');
    expect(empty.status).toBe(400);
    // The resolver itself treats empty and whitespace as unknown.
    expect(await resolveTenantHost('')).toEqual({ kind: 'unknown' });
    expect(await resolveTenantHost('   ')).toEqual({ kind: 'unknown' });

    // A host that exists for the tenant bound to the probe port is served from the mirror too...
    expect((await byHost(counted.host)).status).toBe(200);
    // ...and none of this opened a connection to a tenant database.
    expect(probe.attempts()).toBe(0);

    // One central read per registrable no-row host: it is cached once, a second request adds no entry.
    const before = cachedTenantHostCount();
    expect((await byHost(noRow)).status).toBe(404);
    expect(cachedTenantHostCount()).toBe(before);
  });

  it('the breaker of a tenant project opens at the third failed connection: the 4th request touches no socket', async () => {
    const probe = await listen();
    onTeardown(probe.close);
    const counted = await provisionTenantOnB({
      slug: `breaker-${RUN}`.slice(0, 40),
      databaseUrl: `postgres://api_user:postgres@127.0.0.1:${probe.port}/none`,
    });
    onTeardown(counted.cleanup);
    for (let i = 0; i < 3; i += 1) {
      expect((await bootstrap(counted.token, counted.host)).status).toBe(503);
    }
    const afterThree = probe.attempts();
    expect(afterThree).toBeGreaterThanOrEqual(3);
    const res = await bootstrap(counted.token, counted.host);
    expect(res.status).toBe(503);
    expect(((await res.json()) as Envelope).error.code).toBe('TENANT_UNAVAILABLE');
    expect(probe.attempts()).toBe(afterThree);
    // The by-host answer of that tenant is unaffected.
    expect((await byHost(counted.host)).status).toBe(200);
  }, 120_000);

  it('P10 encoding: case, port and a trailing dot share one answer; an underscore, an IDN label and 300 characters are unknown before the cache', async () => {
    const upper = down.host.toUpperCase();
    const variants = [`${upper}:3000`, `${down.host}.`, `${down.host}:8080`, upper];
    for (const variant of variants) {
      const res = await byHost(variant);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ByHostBody).primaryHost).toBe(down.host);
    }

    const before = cachedTenantHostCount();
    const malformed = [
      `under_score-${RUN}.localhost`,
      `münchen-${RUN}.localhost`,
      `${'a'.repeat(300)}.localhost`,
    ];
    for (const host of malformed) {
      const res = await byHost(host);
      expect([400, 404]).toContain(res.status);
      if (res.status === 404) {
        expect(((await res.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
      }
    }
    // None of them was ever admitted as a cache key (the registrable-host predicate runs first).
    expect(cachedTenantHostCount()).toBe(before);
    expect(await resolveTenantHost('under_score.localhost')).toEqual({ kind: 'unknown' });
    expect(await resolveTenantHost('münchen.localhost')).toEqual({ kind: 'unknown' });
    expect(await resolveTenantHost(`${'a'.repeat(300)}.localhost`)).toEqual({ kind: 'unknown' });
  });
});

/**
 * 09.2-04, D-539 / T-09.2-22: `ensureProjectZero()` makes the central registry row describe the running
 * environment, idempotently, and touches nothing else. The seed already called it (`pnpm db:seed`), so the
 * first assertion is the state every local and CI stack is left in.
 */
describe('project 0 describes the environment (D-539, T-09.2-22)', () => {
  type Row = {
    id: string;
    ref: string;
    api_url: string;
    is_central: boolean;
    is_default: boolean;
    state: string;
    credential_source: string;
    credential_version: number;
    secret_key_id: number | null;
    service_key_sealed: string | null;
    database_url_tx_sealed: string | null;
    updated_at: Date;
  };
  const central = async () => {
    const [row] = await adminSql<Row[]>`
      select id, ref, api_url, is_central, is_default, state, credential_source, credential_version,
             secret_key_id, service_key_sealed, database_url_tx_sealed, updated_at
        from platform.projects where is_central`;
    return row as Row;
  };

  it('after the seed the central row carries the ref and api_url of the environment', async () => {
    const row = await central();
    expect(row.ref).toBe(env.SUPABASE_PROJECT_REF ?? 'local');
    expect(row.api_url).toBe(env.SUPABASE_URL);
    expect(row.api_url).toMatch(/^https?:\/\//);
    expect(row).toMatchObject({ is_central: true, credential_source: 'env', state: 'ready' });
  });

  it('twice in a row reports changed:false the second time', async () => {
    await ensureProjectZero();
    expect(await ensureProjectZero()).toEqual({ changed: false });
  });

  it('a drifted row is restored (changed:true) without touching any other column', async () => {
    const before = await central();
    await adminSql`update platform.projects set api_url = '' where is_central`;
    try {
      expect(await ensureProjectZero()).toEqual({ changed: true });
    } finally {
      await adminSql`update platform.projects set api_url = ${before.api_url} where is_central`;
    }
    const after = await central();
    expect({ ...after, updated_at: undefined }).toEqual({ ...before, updated_at: undefined });
    expect(await ensureProjectZero()).toEqual({ changed: false });
  });

  it('a registry row for another project is not changed by it', async () => {
    const other = await provisionTenantOnB({ slug: `zero-${RUN}`.slice(0, 40) });
    onTeardown(other.cleanup);
    const snapshot = async () => {
      const [row] = await adminSql<Row[]>`
        select id, ref, api_url, is_central, is_default, state, credential_source, credential_version,
               secret_key_id, service_key_sealed, database_url_tx_sealed, updated_at
          from platform.projects where id = ${other.projectId}::uuid`;
      return row;
    };
    const before = await snapshot();
    await adminSql`update platform.projects set api_url = '' where is_central`;
    try {
      await ensureProjectZero();
    } finally {
      await adminSql`
        update platform.projects set api_url = ${env.SUPABASE_URL}
         where is_central and api_url = ''`;
    }
    expect(await snapshot()).toEqual(before);
  });
});

/**
 * 09.2-05, the tracer of the tenant-scoped admin lane (DBT-06, DBT-08, D-538): an `admin_tenant` of a tenant
 * that lives ONLY in database B edits the community rules and lists the members. `withAdminTx({ tenantId })`
 * opens `service_role` on B, so the write and the read happen there and nowhere else. The central project
 * holds a mirror row of the same tenant id with another text and another version, and one central-only
 * membership, so a statement that wrongly lands centrally shows in the assertion.
 */
describe('the admin lane addresses the tenant database (D-538)', () => {
  const ADMIN_SLUG = `admin-b-${RUN}`.slice(0, 40);
  let admin: TenantOnB;
  const memberIdsInB: string[] = [];
  const memberEmails: string[] = [];
  let centralUserId = '';
  let centralEmail = '';

  const call = (
    path: string,
    token: string,
    host: string,
    init: { method?: string; body?: unknown } = {},
  ) =>
    api.request(path, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-host': host,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  const rulesIn = async (db: typeof adminSql | typeof adminSqlB) => {
    const [row] = await db<{ rules_text: string; rules_version: number }[]>`
      select rules_text, rules_version from public.tenants where id = ${admin.tenantId}::uuid`;
    return row;
  };

  beforeAll(async () => {
    admin = await provisionTenantOnB({ slug: ADMIN_SLUG, role: 'admin_tenant' });
    await adminSqlB`
      update public.tenants set rules_text = 'Regras de B', rules_version = 4
       where id = ${admin.tenantId}::uuid`;
    await adminSql`
      update public.tenants set rules_text = 'Regras centrais', rules_version = 1
       where id = ${admin.tenantId}::uuid`;

    for (const n of [1, 2]) {
      const email = `${ADMIN_SLUG}-m${n}-${crypto.randomUUID().slice(0, 6)}@rede-demo.local`;
      const id = crypto.randomUUID();
      await adminSqlB`
        insert into auth.users (id, email, aud, role, email_confirmed_at)
        values (${id}::uuid, ${email}, 'authenticated', 'authenticated', now())`;
      await adminSqlB`
        insert into public.memberships (tenant_id, user_id, role, status)
        values (${admin.tenantId}::uuid, ${id}::uuid, 'member', 'active')`;
      memberIdsInB.push(id);
      memberEmails.push(email);
    }

    // A membership of the same tenant id that exists ONLY in the central project.
    centralEmail = `${ADMIN_SLUG}-central-${crypto.randomUUID().slice(0, 6)}@rede-demo.local`;
    const created = await authAdmin().createUser({
      email: centralEmail,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error('central fixture user not created');
    centralUserId = created.data.user.id;
    await adminSql`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${admin.tenantId}::uuid, ${centralUserId}::uuid, 'member', 'active')`;
  });

  afterAll(async () => {
    await adminSql`delete from public.memberships where user_id = ${centralUserId}::uuid`;
    await admin?.cleanup();
    for (const id of memberIdsInB) await adminSqlB`delete from auth.users where id = ${id}::uuid`;
    if (centralUserId) await authAdmin().deleteUser(centralUserId);
  });

  it('admin rules on B: GET reads, PUT bumps rules_version in B only, the same text again changes nothing', async () => {
    const read = await call('/v1/admin/rules', admin.token, admin.host);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ rulesText: 'Regras de B', rulesVersion: 4 });

    const put = await call('/v1/admin/rules', admin.token, admin.host, {
      method: 'PUT',
      body: { rulesText: 'Novas regras de B' },
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ rulesText: 'Novas regras de B', rulesVersion: 5 });
    expect(await rulesIn(adminSqlB)).toEqual({ rules_text: 'Novas regras de B', rules_version: 5 });
    // The central row of the same tenant id keeps its old text and version.
    expect(await rulesIn(adminSql)).toEqual({ rules_text: 'Regras centrais', rules_version: 1 });

    const again = await call('/v1/admin/rules', admin.token, admin.host, {
      method: 'PUT',
      body: { rulesText: 'Novas regras de B' },
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ rulesText: 'Novas regras de B', rulesVersion: 5 });
    expect(await rulesIn(adminSqlB)).toEqual({ rules_text: 'Novas regras de B', rules_version: 5 });
    expect(await rulesIn(adminSql)).toEqual({ rules_text: 'Regras centrais', rules_version: 1 });
  });

  it('admin members on B: the list is the members of B and none of the central tenant', async () => {
    const res = await call('/v1/admin/members?limit=50', admin.token, admin.host);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: { email: string; role: string }[] };
    const emails = page.items.map((item) => item.email).sort();
    expect(emails).toEqual([admin.email, ...memberEmails].sort());
    expect(emails).not.toContain(centralEmail);
  });
});

/**
 * 09.2-05 (D-538), payments: the admin overview, the integration save and an access product of a tenant on
 * database B read and write B. The central project holds a payment integration for the same tenant id, so an
 * admin-lane statement that wrongly lands centrally shows (the overview would say "connected" before anything
 * was saved).
 */
describe('payments admin on B (D-538)', () => {
  const PAY_SLUG = `pay-b-${RUN}`.slice(0, 40);
  let pay: TenantOnB;

  const payCall = (method: string, path: string, body?: unknown) =>
    api.request(`/v1/payments${path}`, {
      method,
      headers: {
        authorization: `Bearer ${pay.token}`,
        'x-tenant-host': pay.host,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const countIn = async (db: typeof adminSql | typeof adminSqlB, table: string) => {
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from ${db(table)} where tenant_id = ${pay.tenantId}::uuid`;
    return row?.n;
  };

  beforeAll(async () => {
    pay = await provisionTenantOnB({ slug: PAY_SLUG, role: 'admin_tenant' });
    await adminSqlB`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${pay.tenantId}::uuid, 'payments', true)`;
    // A gateway connection of the same tenant id that exists ONLY in the central project.
    await adminSql`
      insert into public.payment_integrations (tenant_id, provider, secret_sealed)
      values (${pay.tenantId}::uuid, 'fake', 'central-only')`;
  });

  afterAll(async () => {
    await adminSqlB`delete from public.payment_products where tenant_id = ${pay.tenantId}::uuid`;
    await adminSqlB`delete from public.payment_integrations where tenant_id = ${pay.tenantId}::uuid`;
    await adminSql`delete from public.payment_integrations where tenant_id = ${pay.tenantId}::uuid`;
    await adminSql`delete from platform.payment_integration_routes where tenant_id = ${pay.tenantId}::uuid`;
    await adminSql`delete from platform.payment_product_routes where tenant_id = ${pay.tenantId}::uuid`;
    await pay?.cleanup();
  });

  it('payments admin on B: the overview answers from B, the token and the access product are written in B only', async () => {
    const before = await payCall('GET', '/overview');
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as { integration: { connected: boolean } };
    // The central row would make this true; B has none.
    expect(beforeBody.integration.connected).toBe(false);

    const saved = await payCall('PUT', '/integration', { token: `tok-${RUN}`, provider: 'fake' });
    expect(saved.status).toBe(200);
    expect(await countIn(adminSqlB, 'payment_integrations')).toBe(1);
    expect(await countIn(adminSql, 'payment_integrations')).toBe(1); // the central-only row, untouched
    const [central] = await adminSql<{ secret_sealed: string }[]>`
      select secret_sealed from public.payment_integrations where tenant_id = ${pay.tenantId}::uuid`;
    expect(central?.secret_sealed).toBe('central-only');

    const created = await payCall('POST', '/access-products', {
      name: 'Assinatura B',
      externalProductId: `ext-${crypto.randomUUID()}`,
    });
    expect(created.status).toBe(201);
    expect(await countIn(adminSqlB, 'payment_products')).toBe(1);
    expect(await countIn(adminSql, 'payment_products')).toBe(0);

    const after = await payCall('GET', '/overview');
    const afterBody = (await after.json()) as {
      integration: { connected: boolean };
      accessProducts: unknown[];
      gate: { canEnable: boolean };
    };
    expect(afterBody.integration.connected).toBe(true);
    expect(afterBody.accessProducts).toHaveLength(1);
    expect(afterBody.gate.canEnable).toBe(true);
  });
});

/**
 * 09.2-05 (D-538, D-539), media: the upload a tenant admin starts on database B records its `media_assets` row
 * in B only, and the Storage call it makes is routed by the tenant segment of the key to the project the
 * registry holds for that tenant. The project's service key is sealed here from the local stack's own key, so
 * the sealed client path (credential_source 'sealed') is the one that signs the upload; a real second Storage
 * is not needed, the resolver is what is asserted.
 */
describe('media row on B (D-538, D-539)', () => {
  const MEDIA_SLUG = `media-b-${RUN}`.slice(0, 40);
  let media: TenantOnB;

  beforeAll(async () => {
    media = await provisionTenantOnB({ slug: MEDIA_SLUG, role: 'admin_tenant' });
    await adminSql`
      update platform.projects
         set service_key_sealed = ${seal(env.SUPABASE_SERVICE_KEY, `${media.projectId}:service_key`)}
       where id = ${media.projectId}::uuid`;
    invalidateProject(media.tenantId);
  });

  afterAll(async () => {
    await adminSqlB`delete from public.media_assets where tenant_id = ${media.tenantId}::uuid`;
    await media?.cleanup();
  });

  it('media row on B: the pending row exists only in B and its key routes to the project of that tenant', async () => {
    const res = await api.request('/v1/media/uploads', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${media.token}`,
        'x-tenant-host': media.host,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ kind: 'image', purpose: 'avatar', mime: 'image/jpeg', size: 1024 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetId: string; path: string; signedUrl: string };
    expect(body.path).toBe(`${media.tenantId}/media/${body.assetId}/original`);
    expect(body.signedUrl).toContain(`/object/upload/sign/media/${media.tenantId}/media/`);

    const count = async (db: typeof adminSql | typeof adminSqlB) => {
      const [row] = await db<{ n: number }[]>`
        select count(*)::int as n from public.media_assets where id = ${body.assetId}::uuid`;
      return row?.n;
    };
    expect(await count(adminSqlB)).toBe(1);
    expect(await count(adminSql)).toBe(0);

    // The tenant segment of the key resolves to the tenant's own project, never the central one.
    const project = await resolveProject(body.path.split('/', 1)[0] ?? '');
    expect(project.id).toBe(media.projectId);
    expect(project.isCentral).toBe(false);
  });
});
