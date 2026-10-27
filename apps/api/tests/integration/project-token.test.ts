import { replaceTokenAnswerSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { authAllowListFor } from '@rede-social/core/server/domains/index';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { FakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { getProjectProviderFor } from '@rede-social/core/server/projects/provider-for';
import { open } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createReadyTenant,
  fakeProvider,
  fakeTarget,
  makeCustomerProject,
  resetB,
  restoreB,
} from './projects-setup';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * Every line any logger writes in this file is captured, so the secrets scan reads what a person tailing the
 * logs would see (T-09.4-36). The mock replaces the ONE root logger every kernel and API logger derives from.
 */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/logging')>();
  const text = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item,
    );
  const make = (bindings: Record<string, unknown>): unknown => {
    const record = (...args: unknown[]) => {
      captured.lines.push(text([bindings, ...args]));
    };
    return {
      info: record,
      warn: record,
      error: record,
      debug: record,
      trace: record,
      fatal: record,
      level: 'trace',
      bindings: () => bindings,
      child: (extra: Record<string, unknown>) => make({ ...bindings, ...extra }),
    };
  };
  const rootLogger = make({});
  return {
    ...real,
    rootLogger,
    moduleLogger: (name: string) =>
      (rootLogger as { child: (b: object) => unknown }).child({ name }),
  };
});

/**
 * Phase 09.4-10 (D-575, UI-D-555, D-576, D-539, CTK-19, CTK-20, CTK-27): replacing the management token of a
 * customer project. Real route, kernel, registry, sealing and audit table against the FAKE provider's customer
 * tokens.
 */

const RUN = Date.now().toString(36);
const ORG = `acme-rep-${RUN}`;
const REF_A = `tr-a-${RUN}`;
const REF_P = `tr-p-${RUN}`;
const REF_M = `tr-m-${RUN}`;
const REF_X = `tr-x-${RUN}`;
const SLUG_A = `tr-a-${RUN}`;
const SLUG_P = `tr-p-${RUN}`;
const SLUG_M = `tr-m-${RUN}`;

const TOKEN_OLD = `sbp_fc_fake_replace_old_${RUN}`;
const TOKEN_NEW = `sbp_fc_fake_replace_new_${RUN}`;

const provider: FakeProjectProvider = fakeProvider(
  {
    [REF_A]: fakeTarget(),
    [REF_P]: fakeTarget(),
    [REF_M]: fakeTarget(),
    [REF_X]: fakeTarget(),
  },
  {
    orgSlug: ORG,
    tokens: {
      [TOKEN_OLD]: { refs: [REF_A] },
      [TOKEN_NEW]: { refs: [REF_A] },
    },
  },
);

const tokens = { superAdmin: '', tenantAdmin: '', member: '' };
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** A date a month ahead: always inside the "after today, at most a year ahead" window. */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function put(tenantId: string, body: unknown, token: string | null = tokens.superAdmin) {
  const res = await api.request(`/v1/platform/tenants/${tenantId}/database/token`, {
    method: 'PUT',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { res, text: await res.text() };
}

type Row = {
  mgmt_token_sealed: string | null;
  mgmt_token_expires_at: string | null;
  credential_version: number;
  org_slug: string | null;
  owner: string;
  updated_at: string;
};
const rowOf = async (projectId: string): Promise<Row> => {
  const [row] = await adminSql<Row[]>`
    select mgmt_token_sealed, mgmt_token_expires_at::text as mgmt_token_expires_at, credential_version,
           org_slug, owner, updated_at::text as updated_at
      from platform.projects where id = ${projectId}::uuid`;
  if (!row) throw new Error('no such project');
  return row;
};

let tenantA = '';
let projectA = '';
let tenantP = '';
let tenantM = '';

async function cleanup(): Promise<void> {
  await adminSql`delete from public.tenants where slug in (${SLUG_A}, ${SLUG_P}, ${SLUG_M})`;
  await adminSql`delete from platform.project_token_events where project_ref in (${REF_A}, ${REF_P}, ${REF_M})`;
  await adminSql`delete from platform.projects where ref in (${REF_A}, ${REF_P}, ${REF_M})`;
  await adminSql`
    delete from public.access_grants where email like ${`admin-tr-%-${RUN}@rede-social-test.local`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD || !SUPER_ADMIN_PASSWORD) {
    throw new Error(
      'SEED_PASSWORD and SUPER_ADMIN_PASSWORD are required (same values as the seed)',
    );
  }
  await cleanup();
  resetB();
  setProjectProviderForTests(provider);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.tenantAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  // The two projects that are never bootstrapped come first: a bootstrapped B would fail their empty-database check.
  const platform = await createReadyTenant(provider, REF_P, SLUG_P, { run: false });
  tenantP = platform.tenantId;
  const moved = await createReadyTenant(provider, REF_M, SLUG_M, { run: false });
  tenantM = moved.tenantId;
  // The pin on file says another organisation than the one the project now reports.
  await makeCustomerProject(moved.projectId, TOKEN_OLD, `old-${ORG}`);
  ({ tenantId: tenantA, projectId: projectA } = await createReadyTenant(provider, REF_A, SLUG_A));
  await makeCustomerProject(projectA, TOKEN_OLD, ORG);
  captured.lines.length = 0;
}, 180_000);

afterAll(async () => {
  setProjectProviderForTests(undefined);
  await cleanup();
  await adminSql`alter role api_user with login password 'postgres'`;
  await stopBoss();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
  restoreB();
});

// Keep the unused fixtures referenced for the refusal cases added in the next task.
void tenantM;

describe('PUT /v1/platform/tenants/{id}/database/token (tracer, CTK-20)', () => {
  it('a valid token replaces the sealed one, bumps the version and keeps the pin', async () => {
    const before = await rowOf(projectA);
    expect(open(before.mgmt_token_sealed ?? '', `${projectA}:mgmt_token`)).toBe(TOKEN_OLD);
    const expiry = inDays(30);

    const { res, text } = await put(tenantA, { token: TOKEN_NEW, tokenExpiresAt: expiry });
    expect(res.status, text).toBe(200);
    expect(replaceTokenAnswerSchema.parse(JSON.parse(text))).toEqual({ ok: true });

    const after = await rowOf(projectA);
    expect(open(after.mgmt_token_sealed ?? '', `${projectA}:mgmt_token`)).toBe(TOKEN_NEW);
    expect(after.credential_version).toBe(before.credential_version + 1);
    expect(after.mgmt_token_expires_at).toBe(expiry);
    expect(after.org_slug).toBe(before.org_slug);
    expect(after.owner).toBe('customer');
    expect(after.updated_at).not.toBe(before.updated_at);
    expect(after.mgmt_token_sealed).not.toBe(before.mgmt_token_sealed);
  });

  it('an absent date stores null, and both caches forget the old version', async () => {
    const before = await rowOf(projectA);
    const record = (version: number) => ({
      id: projectA,
      ref: REF_A,
      provider: 'fake',
      credentialVersion: version,
      owner: 'customer',
      orgSlug: ORG,
      mgmtTokenSealed: before.mgmt_token_sealed,
    });
    const oldProvider = await getProjectProviderFor(record(before.credential_version));
    const oldAdapter = authAllowListFor(record(before.credential_version), { mode: 'local' });

    const { res, text } = await put(tenantA, { token: TOKEN_OLD });
    expect(res.status, text).toBe(200);

    const after = await rowOf(projectA);
    expect(after.credential_version).toBe(before.credential_version + 1);
    expect(after.mgmt_token_expires_at).toBeNull();
    expect(open(after.mgmt_token_sealed ?? '', `${projectA}:mgmt_token`)).toBe(TOKEN_OLD);
    // The entries of the old version were dropped: asking for it again builds new objects.
    expect(await getProjectProviderFor(record(before.credential_version))).not.toBe(oldProvider);
    expect(authAllowListFor(record(before.credential_version), { mode: 'local' })).not.toBe(
      oldAdapter,
    );
  });

  it('answers exactly { ok: true } and nothing about the token', async () => {
    const { res, text } = await put(tenantA, { token: TOKEN_NEW });
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toStrictEqual({ ok: true });
    expect(text).not.toContain(TOKEN_NEW);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a non-super_admin, an unknown tenant and a platform project, and a malformed body is a 400', async () => {
    for (const token of [tokens.tenantAdmin, tokens.member]) {
      expect((await put(tenantA, { token: TOKEN_NEW }, token)).res.status).toBe(403);
    }
    expect((await put(tenantA, { token: TOKEN_NEW }, null)).res.status).toBe(401);
    expect((await put(crypto.randomUUID(), { token: TOKEN_NEW })).res.status).toBe(404);
    expect((await put(tenantP, { token: TOKEN_NEW })).res.status).toBe(409);
    expect((await put(tenantA, { token: '' })).res.status).toBe(400);
    expect((await put(tenantA, { token: TOKEN_NEW, extra: 1 })).res.status).toBe(400);
  });
});
