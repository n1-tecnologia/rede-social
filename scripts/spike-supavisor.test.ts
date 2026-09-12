/**
 * Supavisor / PgBouncer transaction-mode lane spike (plan 01-03, TENANT-03, threat T-03-01).
 *
 * Proves that the two statements `withTenantTx` runs — a bound
 * `select set_config('request.jwt.claims', $1, true)` and `set local role authenticated` — never leak
 * across pooled transactions: 40 interleaved lanes alternating between two tenants share a
 * postgres.js pool of `max: 2`, so every lane necessarily reuses a physical connection another
 * tenant's lane just released.
 *
 * Runs:
 *   1. local (this plan):   SPIKE_DATABASE_URL defaults to the local pooler, port 54329
 *   2. staging (plan 01-12): SPIKE_DATABASE_URL=postgres://api_user.<ref>:<pw>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
 *
 * The test is parameterised ONLY by SPIKE_DATABASE_URL, so the same file proves either pooler mode
 * (transaction 6543 / session 5432) — the fallback is a configuration switch, never a code fork
 * (see packages/core/db/README.md).
 *
 * Local contingency (recorded in 01-01-SUMMARY): the local Supavisor image only knows its own
 * tenant, so it may refuse `api_user`. When — and only when — the target is the LOCAL pooler
 * (loopback host, port 54329) this spike retries with the Supavisor username form
 * `[ROLE].[PROJECT-REF]` and, if still refused, falls back to the direct port 54322 with the
 * refusal errors printed. `max: 2` still forces the 40 lanes to reuse two physical connections, so
 * the LOCAL-scope and NOINHERIT assertions stay meaningful. An explicit non-local URL never falls
 * back: a pooler refusal on staging is a real failure.
 *
 * Never skipped: a missing tenant, an unreachable database or an unexpected error fails the run.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LOCAL_POOLER_PORT = '54329';
const LOCAL_DIRECT_URL = 'postgres://api_user:postgres@127.0.0.1:54322/postgres';
const DEFAULT_SPIKE_URL = `postgres://api_user:postgres@127.0.0.1:${LOCAL_POOLER_PORT}/postgres`;
const DEFAULT_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
/** `project_id` from supabase/config.toml — the local stand-in for the hosted project ref. */
const PROJECT_REF = process.env.SPIKE_PROJECT_REF ?? 'rede-social';
const LANES = 40;
const BARE_PROBES = 4; // > pool size, so both physical connections get a post-batch probe
const SPIKE_SUB = '00000000-0000-0000-0000-000000000001';

type LaneRow = { u: string; t: string | null; n: number };
type BareRow = { u: string; c: string | null };
type Db = ReturnType<typeof drizzle>;

/** Errors that mean "this pooler does not know this user", as opposed to a real failure. */
const REFUSAL =
  /password authentication failed|no such user|Tenant or user not found|ENOIDENTIFIER|ENOTFOUND|tenant\/user .* not found/i;

function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}`;
}

function withUsername(url: string, username: string): string {
  const u = new URL(url);
  u.username = username;
  return u.toString();
}

function isLocalPooler(url: string): boolean {
  const u = new URL(url);
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  return loopback && u.port === LOCAL_POOLER_PORT;
}

function openPool(url: string): postgres.Sql {
  // Same driver options as packages/core/db/client.ts (prepare: false) with a deliberately tiny pool.
  return postgres(url, { prepare: false, max: 2, connect_timeout: 10 });
}

async function probe(client: postgres.Sql): Promise<void> {
  await client`select 1`;
}

/**
 * Connects to the configured target; on a local-pooler refusal walks the contingency chain
 * (Supavisor username form, then the direct port). Returns the live pool and its description.
 */
async function connectWithContingency(configured: string): Promise<{
  client: postgres.Sql;
  url: string;
  contingency: string[];
}> {
  const candidates: { url: string; label: string }[] = [{ url: configured, label: 'api_user' }];
  if (isLocalPooler(configured)) {
    candidates.push({
      url: withUsername(configured, `api_user.${PROJECT_REF}`),
      label: `api_user.${PROJECT_REF}`,
    });
    candidates.push({ url: LOCAL_DIRECT_URL, label: 'direct port 54322' });
  }

  const contingency: string[] = [];
  for (const candidate of candidates) {
    const client = openPool(candidate.url);
    try {
      await probe(client);
      return { client, url: candidate.url, contingency };
    } catch (error) {
      await client.end({ timeout: 1 }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const isLast = candidate === candidates[candidates.length - 1];
      if (!REFUSAL.test(message) || isLast) throw error;
      contingency.push(`${candidate.label} @ ${describeTarget(candidate.url)}: ${message}`);
    }
  }
  throw new Error('unreachable: no candidate connection succeeded');
}

let client: postgres.Sql;
let db: Db;
let admin: postgres.Sql;
let tenantA = '';
let tenantB = '';

/** Exactly the two statements of packages/core/db/tenant-tx.ts#withTenantTx, then a read under RLS. */
const lane = (tenantId: string): Promise<LaneRow> =>
  db.transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: SPIKE_SUB,
      role: 'authenticated',
      tenant_id: tenantId,
      tenant_role: 'member',
    });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    const rows = (await tx.execute(
      sql`select current_user::text as u, app.tenant_id()::text as t, (select count(*) from public.tenants)::int as n`,
    )) as unknown as LaneRow[];
    const row = rows[0];
    if (!row) throw new Error('lane returned no row');
    return row;
  });

/** A statement outside any lane: must see the connection role and no claims. */
async function bare(): Promise<BareRow> {
  const rows = (await db.execute(
    sql`select current_user::text as u, current_setting('request.jwt.claims', true) as c`,
  )) as unknown as BareRow[];
  const row = rows[0];
  if (!row) throw new Error('bare probe returned no row');
  return row;
}

const tenantFor = (i: number): string => (i % 2 ? tenantA : tenantB);

beforeAll(async () => {
  const configured = process.env.SPIKE_DATABASE_URL ?? DEFAULT_SPIKE_URL;
  const connected = await connectWithContingency(configured);
  client = connected.client;
  db = drizzle(client);

  console.log(`spike target: ${describeTarget(connected.url)}`);
  if (connected.contingency.length > 0) {
    console.log(
      `spike contingency: local pooler refused ${connected.contingency.join(' | ')} — ` +
        `Local spike ran on the direct port 54322 (max: 2 still forces connection reuse)`,
    );
  }

  admin = postgres(process.env.SPIKE_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
  });
  const rows = await admin<{ slug: string; id: string }[]>`
    select slug, id::text as id from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  tenantA = process.env.TENANT_A ?? bySlug.get('tria-demo') ?? '';
  tenantB = process.env.TENANT_B ?? bySlug.get('tria-lab') ?? '';
  if (!tenantA || !tenantB || tenantA === tenantB) {
    throw new Error(
      'spike needs two distinct seeded tenants (run `SEED_PASSWORD=... pnpm db:seed`) or TENANT_A/TENANT_B',
    );
  }
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await admin?.end({ timeout: 5 });
});

describe('supavisor tenant lane (transaction pooling)', () => {
  it('keeps claims and role inside each transaction and drops them after, under connection reuse', async () => {
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: LANES }, (_, i) => lane(tenantFor(i))));
    const elapsedMs = performance.now() - started;
    console.log(
      `spike timing: ${LANES} interleaved lanes on max:2 in ${elapsedMs.toFixed(0)} ms ` +
        `(${((LANES * 1000) / elapsedMs).toFixed(0)} lanes/s)`,
    );

    for (const [i, r] of results.entries()) {
      expect(r.u).toBe('authenticated');
      expect(r.t).toBe(tenantFor(i));
      // tenants_self_select: `id = app.tenant_id()` -> exactly the lane's own tenant row.
      expect(r.n).toBe(1);
    }
    const countsA = new Set(results.filter((_, i) => i % 2).map((r) => r.n));
    const countsB = new Set(results.filter((_, i) => !(i % 2)).map((r) => r.n));
    expect(countsA.size).toBe(1);
    expect(countsB.size).toBe(1);

    // Bare statements after the batch (more probes than pooled connections): role and claims are gone.
    for (let i = 0; i < BARE_PROBES; i++) {
      const after = await bare();
      expect(after.u).toBe('api_user');
      expect(after.c ?? '').toBe('');
    }
  });

  it('api_user outside a lane cannot read tenant tables (NOINHERIT, SQLSTATE 42501)', async () => {
    // drizzle-orm 0.45 wraps the driver error in DrizzleQueryError, whose own message is only
    // "Failed query: ..." — both the SQLSTATE and the server message live on `cause` (01-01 case 6).
    const raised: unknown = await db
      .execute(sql`select count(*) from public.tenants`)
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(raised).toMatchObject({ cause: { code: '42501' } });
    const driverMessage = (raised as { cause?: { message?: string } })?.cause?.message ?? '';
    expect(driverMessage).toMatch(/permission denied/i);
    console.log(
      `spike noinherit: bare select on public.tenants raised 42501 — ${driverMessage} (A2)`,
    );
  });

  it('an error inside a lane is isolated: malformed claims abort that transaction only', async () => {
    const broken = db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${'not-json'}, true)`);
      await tx.execute(sql`set local role authenticated`);
      await tx.execute(sql`select app.tenant_id()`); // ::jsonb cast of 'not-json' -> 22P02
    });
    await expect(broken).rejects.toMatchObject({ cause: { code: '22P02' } });

    // The very next lanes (both pooled connections) are unaffected...
    const next = await Promise.all([lane(tenantA), lane(tenantB), lane(tenantA)]);
    expect(next.map((r) => r.u)).toEqual(['authenticated', 'authenticated', 'authenticated']);
    expect(next.map((r) => r.t)).toEqual([tenantA, tenantB, tenantA]);
    expect(next.map((r) => r.n)).toEqual([1, 1, 1]);

    // ...and nothing from the aborted transaction survives on the connection.
    for (let i = 0; i < BARE_PROBES; i++) {
      const after = await bare();
      expect(after.u).toBe('api_user');
      expect(after.c ?? '').toBe('');
    }
  });
});
