import { PLATFORM_TERMS_VERSION, publicTenantSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { setRequiredTenantSchemaForTests } from '@rede-social/core/server/migrations/required';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminSql, adminSqlB, api, HOSTS, provisionTenantOnB, type TenantOnB } from './setup';

/**
 * Phase 09.2-11 (DBT-15, D-538, D-542): the two slug routes (`GET /v1/public/tenants/{slug}` and
 * `POST /v1/public/signup/{slug}`) carry no host, so the SLUG selects the project through the central mirror.
 * The record of a tenant in another project names that project's public Auth address and publishable key, a
 * tenant being prepared, updated or unreachable answers 503 and creates nothing, and a slug that is not
 * exactly canonical never reaches a project.
 *
 * Two tenants live ONLY in the second local database: `b` (the real `rede_tenant_b`, answers 200) and `held`
 * (a closed-port URL, so any request that got past the status gate would fail on the pool instead of
 * answering the gate's code). The two lane wrappers below count the transactions a request opens, which is
 * how "no project database opened" is made observable without a statement log.
 */

const lanes = vi.hoisted(() => ({ platform: 0, admin: 0 }));

vi.mock('@rede-social/core/db/platform-tx', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rede-social/core/db/platform-tx')>();
  return {
    ...original,
    withPlatformTx: ((fn: Parameters<typeof original.withPlatformTx>[0]) => {
      lanes.platform += 1;
      return original.withPlatformTx(fn);
    }) as typeof original.withPlatformTx,
  };
});

vi.mock('@rede-social/core/db/admin-tx', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rede-social/core/db/admin-tx')>();
  return {
    ...original,
    withAdminTx: ((...args: unknown[]) => {
      lanes.admin += 1;
      return (original.withAdminTx as (...a: unknown[]) => unknown)(...args);
    }) as typeof original.withAdminTx,
  };
});

const RUN = Date.now().toString(36);
const CLOSED = 'postgres://api_user:postgres@127.0.0.1:1/none';
const B_URL = 'http://127.0.0.1:54321';
const B_KEY = `sb_publishable_${RUN}_b`;
const RULES = 'Regras da comunidade 🌱 — coração, ação e união. Não aceitamos "spam".';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

let b: TenantOnB;
let held: TenantOnB;
const emails: string[] = [];

const reset = () => {
  lanes.platform = 0;
  lanes.admin = 0;
};

const get = (slug: string) => api.request(`/v1/public/tenants/${slug}`);
const codeOf = async (res: Response) => ((await res.json()) as Envelope).error.code;

let counter = 0;
function signupBody() {
  counter += 1;
  const email = `psb-${RUN}-${counter}@signup-test.local`;
  emails.push(email);
  return {
    name: 'Maria Teste',
    email,
    password: 'Segredo123',
    consents: { tenantRulesVersion: 7, platformTermsVersion: PLATFORM_TERMS_VERSION },
  };
}
const post = (slug: string, payload: unknown) =>
  api.request(`/v1/public/signup/${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

async function setHeld(patch: { state?: string; key?: string | null }) {
  if (patch.state) {
    await adminSql`update platform.projects set state = ${patch.state} where id = ${held.projectId}::uuid`;
  }
  if (patch.key !== undefined) {
    await adminSql`update platform.projects set publishable_key = ${patch.key} where id = ${held.projectId}::uuid`;
  }
  invalidateTenantHost(held.host);
}

async function heldOutReset() {
  setRequiredTenantSchemaForTests(undefined);
  await adminSql`
    update platform.projects set state = 'ready', publishable_key = ${`${B_KEY}_held`}
     where id = ${held.projectId}::uuid`;
  await adminSql`delete from platform.project_health where project_id = ${held.projectId}::uuid`;
  await adminSql`delete from platform.project_schema_state where project_id = ${held.projectId}::uuid`;
  await adminSql`update public.tenants set status = 'active' where id = ${held.tenantId}::uuid`;
  invalidateTenantHost(held.host);
}

async function authUsersWith(addresses: string[]): Promise<number> {
  const rows = await adminSql<{ n: number }[]>`
    select count(*)::int as n from auth.users where email = any(${addresses})`;
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: `psb-${RUN}`.slice(0, 40) });
  await adminSql`
    update platform.projects set api_url = ${B_URL}, publishable_key = ${B_KEY}
     where id = ${b.projectId}::uuid`;
  // The rules live in database B only: the central mirror keeps a different text and version.
  await adminSqlB`
    update public.tenants set rules_text = ${RULES}, rules_version = 7 where id = ${b.tenantId}::uuid`;
  held = await provisionTenantOnB({ slug: `psb-${RUN}-h`.slice(0, 40), databaseUrl: CLOSED });
  await adminSql`
    update platform.projects set api_url = ${B_URL}, publishable_key = ${`${B_KEY}_held`}
     where id = ${held.projectId}::uuid`;
  invalidateTenantHost(b.host);
  invalidateTenantHost(held.host);
}, 60_000);

afterEach(async () => {
  await heldOutReset();
});

afterAll(async () => {
  setRequiredTenantSchemaForTests(undefined);
  if (emails.length > 0) await adminSql`delete from auth.users where email = any(${emails})`;
  await b?.cleanup();
  await held?.cleanup();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/public/tenants/{slug} for a tenant in another project (DBT-15)', () => {
  it('tracer: answers the record with that project’s public coordinates and the rules read from B', async () => {
    const slug = b.host.replace('.localhost', '');
    const res = await get(slug);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const record = publicTenantSchema.parse(JSON.parse(raw));
    expect(record).toMatchObject({
      slug,
      // The display name is the mirror's; the rules and their version are database B's.
      displayName: 'Tenant B (central mirror)',
      rulesText: RULES,
      rulesVersion: 7,
      termsVersion: PLATFORM_TERMS_VERSION,
      supabaseUrl: B_URL,
      publishableKey: B_KEY,
    });
    // Public by design and nothing else: no sealed registry value, no key material, no project id.
    expect(raw).not.toMatch(/v1:\d+:|service|secret|database_url|fk-/i);
    expect(raw).not.toContain(b.projectId);
  });

  it('a tenant of the central project carries neither coordinate', async () => {
    const res = await get('rede-lab');
    expect(res.status).toBe(200);
    const record = (await res.json()) as Record<string, unknown>;
    expect(record).not.toHaveProperty('supabaseUrl');
    expect(record).not.toHaveProperty('publishableKey');
    expect(publicTenantSchema.parse(record).slug).toBe('rede-lab');
  });

  it('a slug that is not exactly canonical is a 404 and opens no project and no query at all', async () => {
    for (const slug of [
      'Rede-Demo',
      'REDE-LAB',
      encodeURIComponent('comunidáde'),
      encodeURIComponent('é'),
      '%2e',
      '%2e%2e',
      'rede_demo',
      `${'a'.repeat(41)}`,
      'ab',
    ]) {
      reset();
      const res = await get(slug);
      expect(res.status, slug).toBe(404);
      // `%2e` / `%2e%2e` are folded into dot segments by the router and miss every route (plain 404);
      // every other variant reaches the handler and fails `slugSchema` with the tenant envelope.
      if (!slug.startsWith('%2e')) expect(await codeOf(res), slug).toBe('TENANT_NOT_FOUND');
      expect(lanes.platform, slug).toBe(0);
      expect(lanes.admin, slug).toBe(0);
    }
  });

  it('an unknown slug costs ONE central read and no project database; an empty slug is no route', async () => {
    reset();
    const res = await get('nao-existe-aqui');
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('TENANT_NOT_FOUND');
    expect(lanes.platform).toBe(1);
    expect(lanes.admin).toBe(0);

    reset();
    const empty = await api.request('/v1/public/tenants/');
    expect(empty.status).toBe(404);
    expect(lanes.admin).toBe(0);
  });

  it('a suspended tenant keeps the 404 on both routes', async () => {
    await adminSql`update public.tenants set status = 'suspended' where id = ${held.tenantId}::uuid`;
    invalidateTenantHost(held.host);
    const slug = held.host.replace('.localhost', '');
    reset();
    const res = await get(slug);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('TENANT_NOT_FOUND');
    const out = await post(slug, signupBody());
    expect(out.status).toBe(404);
    expect(lanes.admin).toBe(0);
  });
});

describe('a tenant whose project is held out answers 503 and creates nothing', () => {
  const heldSlug = () => held.host.replace('.localhost', '');

  /** Puts `held` in one of the three held-out states. */
  const holdOut = {
    TENANT_PREPARING: () => setHeld({ state: 'preparing' }),
    TENANT_UPDATING: async () => {
      setRequiredTenantSchemaForTests({ count: 999, head: '99999999999999' });
      await adminSql`
        insert into platform.project_schema_state (project_id, applied_count, applied_head, status)
        values (${held.projectId}::uuid, 998, '99999999999998', 'behind')`;
      invalidateTenantHost(held.host);
    },
    TENANT_UNAVAILABLE: async () => {
      await adminSql`
        insert into platform.project_health (project_id, status, checked_at)
        values (${held.projectId}::uuid, 'paused', now())`;
      invalidateTenantHost(held.host);
    },
  } as const;

  for (const code of Object.keys(holdOut) as Array<keyof typeof holdOut>) {
    it(`${code}: the GET and the POST answer 503 with the code, before any tenant lane opens`, async () => {
      await holdOut[code]();
      reset();
      const read = await get(heldSlug());
      expect(read.status).toBe(503);
      const envelope = (await read.json()) as Envelope;
      expect(envelope.error.code).toBe(code);
      expect(envelope.error.details).toBeUndefined();
      expect(JSON.stringify(envelope)).not.toMatch(/127\.0\.0\.1|postgres|fk-/);
      expect(lanes.admin).toBe(0);

      const payload = signupBody();
      reset();
      const write = await post(heldSlug(), payload);
      expect(write.status).toBe(503);
      expect(await codeOf(write)).toBe(code);
      expect(lanes.admin).toBe(0);
      // No Auth user was created, and so no membership could have been.
      expect(await authUsersWith([payload.email])).toBe(0);
    });
  }

  it('a project without a publishable key is TENANT_PREPARING, never a record with a missing key', async () => {
    await setHeld({ key: null });
    reset();
    const read = await get(heldSlug());
    expect(read.status).toBe(503);
    expect(await codeOf(read)).toBe('TENANT_PREPARING');
    const payload = signupBody();
    const write = await post(heldSlug(), payload);
    expect(write.status).toBe(503);
    expect(await codeOf(write)).toBe('TENANT_PREPARING');
    expect(await authUsersWith([payload.email])).toBe(0);
    expect(lanes.admin).toBe(0);
  });

  it('the precedence is the host answer’s: preparing beats unavailable beats updating', async () => {
    await holdOut.TENANT_UPDATING();
    expect(await codeOf(await get(heldSlug()))).toBe('TENANT_UPDATING');
    await holdOut.TENANT_UNAVAILABLE();
    expect(await codeOf(await get(heldSlug()))).toBe('TENANT_UNAVAILABLE');
    await holdOut.TENANT_PREPARING();
    expect(await codeOf(await get(heldSlug()))).toBe('TENANT_PREPARING');
  });

  it('and the slug route agrees with the host route for the same tenant', async () => {
    await holdOut.TENANT_UNAVAILABLE();
    const byHost = await api.request(`/v1/public/tenants/by-host?host=${held.host}`);
    expect(((await byHost.json()) as { status: string }).status).toBe('unavailable');
    expect(await codeOf(await get(heldSlug()))).toBe('TENANT_UNAVAILABLE');
    // The project-0 tenants are untouched by any of it.
    expect((await get('rede-demo')).status).toBe(200);
    expect(HOSTS.demo).toContain('rede-demo');
  });
});
