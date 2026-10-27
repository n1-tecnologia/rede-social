import { replaceTokenAnswerSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { authAllowListFor } from '@rede-social/core/server/domains/index';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { FakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { getProjectProviderFor } from '@rede-social/core/server/projects/provider-for';
import { replaceProjectToken } from '@rede-social/core/server/projects/token';
import { ProjectProviderError } from '@rede-social/core/server/projects/types';
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
const TOKEN_ELSEWHERE = `sbp_fc_fake_replace_elsewhere_${RUN}`;
const TOKEN_ALL = `sbp_fc_fake_replace_everything_${RUN}`;
const TOKEN_UNKNOWN = `sbp_fc_fake_replace_unknown_${RUN}`;
const TOKEN_UNPREFIXED = `plain_${RUN}_not_a_scoped_token_at_all`;
const TOKEN_M = `sbp_fc_fake_replace_other_org_${RUN}`;
const TOKEN_R1 = `sbp_fc_fake_replace_race_one_${RUN}`;
const TOKEN_R2 = `sbp_fc_fake_replace_race_two_${RUN}`;
const ACTOR = { userId: '00000000-0000-4000-8000-000000000010' };
const noFollowUp = () => undefined;

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
      [TOKEN_ELSEWHERE]: { refs: [REF_X] },
      [TOKEN_ALL]: { refs: 'all' },
      [TOKEN_M]: { refs: [REF_M] },
      [TOKEN_R1]: { refs: [REF_A] },
      [TOKEN_R2]: { refs: [REF_A] },
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

// ---------------------------------------------------------------------------------------------------------
// Validate first, replace second (D-575, UI-D-555, T-09.4-35, T-09.4-36)
// ---------------------------------------------------------------------------------------------------------

type EventRow = { kind: string; project_ref: string; actor: string; outcome: string };
const eventsOf = (ref: string) =>
  adminSql<EventRow[]>`
    select kind, project_ref, actor, outcome
      from platform.project_token_events where project_ref = ${ref} order by at, id`;

describe('a refused replacement changes nothing (CTK-20)', () => {
  const refusals: Array<{
    name: string;
    body: Record<string, string>;
    details: Record<string, string>;
    outcome: string;
  }> = [
    {
      name: 'an unknown token',
      body: { token: TOKEN_UNKNOWN },
      details: { token: 'token_invalid' },
      outcome: 'token_invalid',
    },
    {
      name: 'a token scoped to another project',
      body: { token: TOKEN_ELSEWHERE },
      details: { token: 'token_forbidden' },
      outcome: 'token_forbidden',
    },
    {
      name: 'a string without the fine-grained prefix',
      body: { token: TOKEN_UNPREFIXED },
      details: { token: 'token_account_wide' },
      outcome: 'token_account_wide',
    },
    {
      name: 'a token whose scope is every project',
      body: { token: TOKEN_ALL },
      details: { token: 'token_account_wide' },
      outcome: 'token_account_wide',
    },
    {
      name: 'a date in the past',
      body: { token: TOKEN_NEW, tokenExpiresAt: '2020-01-01' },
      details: { tokenExpiresAt: 'token_expiry_invalid' },
      outcome: 'token_expiry_invalid',
    },
  ];

  it('byte-identical: each refusal answers one closed code under its field, leaves the row as it was and writes one code-only event', async () => {
    for (const refusal of refusals) {
      const before = await rowOf(projectA);
      const eventsBefore = await eventsOf(REF_A);

      const { res, text } = await put(tenantA, refusal.body);
      expect(res.status, refusal.name).toBe(400);
      const error = (JSON.parse(text) as { error: { code: string; details: unknown } }).error;
      expect(error.code, refusal.name).toBe('VALIDATION_FAILED');
      expect(error.details, refusal.name).toEqual(refusal.details);

      // Not the sealed value, the expiry, the version nor the timestamp moved.
      expect(await rowOf(projectA), refusal.name).toEqual(before);
      const eventsAfter = await eventsOf(REF_A);
      expect(eventsAfter.length, refusal.name).toBe(eventsBefore.length + 1);
      const last = eventsAfter[eventsAfter.length - 1];
      expect(last).toMatchObject({
        kind: 'replaced',
        project_ref: REF_A,
        outcome: refusal.outcome,
      });
      expect(last?.actor).toMatch(/^platform:[0-9a-f-]{36}$/);
    }
  });

  it('a project that now reports another organisation refuses a token the project itself accepts (D-571)', async () => {
    const [moved] = await adminSql<
      { id: string }[]
    >`select id::text as id from platform.projects where ref = ${REF_M}`;
    const before = await rowOf(moved?.id ?? '');
    const { res, text } = await put(tenantM, { token: TOKEN_M });
    expect(res.status, text).toBe(400);
    expect((JSON.parse(text) as { error: { details: unknown } }).error.details).toEqual({
      token: 'org_mismatch',
    });
    expect(await rowOf(moved?.id ?? '')).toEqual(before);
    const events = await eventsOf(REF_M);
    expect(events.map((event) => event.outcome)).toEqual(['org_mismatch']);
  });

  it('a project that cannot be reached is { token: unchecked } and changes nothing', async () => {
    const before = await rowOf(projectA);
    const unreachable = {
      ...provider.forToken(TOKEN_NEW, { orgSlug: ORG }),
      describe: async () => {
        throw new ProjectProviderError('unavailable', 0, undefined, true);
      },
    };
    const refused = await replaceProjectToken(tenantA, { token: TOKEN_NEW }, ACTOR, {
      provider: unreachable,
      afterReplace: noFollowUp,
    }).catch((error: unknown) => error as { status?: number; details?: unknown });
    expect(refused).toMatchObject({ status: 400, details: { token: 'unchecked' } });
    expect(await rowOf(projectA)).toEqual(before);
  });

  it('the success of the tracer left its audit event', async () => {
    const events = await eventsOf(REF_A);
    expect(
      events.filter((event) => event.outcome === 'ok' && event.kind === 'replaced').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('race: two replacements of one project queue on the lock and the later one wins entirely', async () => {
    const before = await rowOf(projectA);
    const real = provider.forToken(TOKEN_R1, { orgSlug: ORG });
    const slow = {
      ...real,
      describe: async (ref: string) => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return real.describe(ref);
      },
    };
    const first = replaceProjectToken(tenantA, { token: TOKEN_R1 }, ACTOR, {
      provider: slow,
      afterReplace: noFollowUp,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = replaceProjectToken(tenantA, { token: TOKEN_R2 }, ACTOR, {
      afterReplace: noFollowUp,
    });
    const [one, two] = await Promise.all([first, second]);

    expect(two.credentialVersion).toBe(one.credentialVersion + 1);
    const after = await rowOf(projectA);
    expect(open(after.mgmt_token_sealed ?? '', `${projectA}:mgmt_token`)).toBe(TOKEN_R2);
    expect(after.credential_version).toBe(before.credential_version + 2);
  });

  it('no response, log line, error detail or audit row holds a refused token or its first 8 characters', async () => {
    captured.lines.length = 0;
    const outputs: string[] = [];
    for (const refusal of refusals) {
      outputs.push((await put(tenantA, refusal.body)).text);
    }
    outputs.push((await put(tenantM, { token: TOKEN_M })).text);
    outputs.push(JSON.stringify(await eventsOf(REF_A)), JSON.stringify(await eventsOf(REF_M)));
    outputs.push(captured.lines.join('\n'));
    const haystack = outputs.join('\n');
    for (const token of [
      TOKEN_UNKNOWN,
      TOKEN_ELSEWHERE,
      TOKEN_ALL,
      TOKEN_UNPREFIXED,
      TOKEN_NEW,
      TOKEN_M,
    ]) {
      expect(haystack).not.toContain(token);
      expect(haystack).not.toContain(token.slice(0, 8));
    }
  });
});
