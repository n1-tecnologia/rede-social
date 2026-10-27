import { sqlClient } from '@rede-social/core/db';
import { apiUrlFor } from '@rede-social/core/server/projects/access';
import type { FakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import {
  recordTokenEvent,
  registerCustomerProject,
  sealManagementToken,
  TokenRefusal,
} from '@rede-social/core/server/projects/token';
import type { ProjectProvider } from '@rede-social/core/server/projects/types';
import { open } from '@rede-social/core/server/secrets/sealed';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeProvider, fakeTarget } from './projects-setup';
import { adminSql } from './setup';

/**
 * Every line any logger writes in this file is captured, so the scan reads what a person tailing the logs
 * would see (T-09.4-24). The mock replaces the ONE root logger every kernel and API logger derives from.
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
 * Phase 09.4-07 Task 2 (D-567, D-568, D-571, D-539, CTK-12, CTK-28): `registerCustomerProject` validates the
 * token, then in ONE locked platform transaction inserts the project (owner customer, the pin, the sealed
 * token, the typed expiry) and the audit event. Real registry, sealing and audit table against the FAKE
 * provider's customer tokens.
 */

const RUN = Date.now().toString(36);
const ORG = `acme-reg-${RUN}`;
const REF_A = `tk-a-${RUN}`;
const REF_B = `tk-b-${RUN}`;
const REF_C = `tk-c-${RUN}`;
const REF_D = `tk-d-${RUN}`;
const REF_E = `tk-e-${RUN}`;
const REFS = [REF_A, REF_B, REF_C, REF_D, REF_E];
const ACTOR = 'platform:00000000-0000-4000-8000-000000000007';

const TOKEN_A = `sbp_fc_fake_register_aaaa_${RUN}`;
const TOKEN_B = `sbp_fc_fake_register_bbbb_${RUN}`;
const TOKEN_C = `sbp_fc_fake_register_cccc_${RUN}`;
const TOKEN_D = `sbp_fc_fake_register_dddd_${RUN}`;
const TOKEN_DEAD = `sbp_fc_fake_register_dead_${RUN}`;
const ALL_TOKENS = [TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_D, TOKEN_DEAD];

const provider: FakeProjectProvider = fakeProvider(
  Object.fromEntries(REFS.map((ref) => [ref, fakeTarget()])),
  {
    orgSlug: ORG,
    tokens: {
      [TOKEN_A]: { refs: [REF_A] },
      [TOKEN_B]: { refs: [REF_B] },
      [TOKEN_C]: { refs: [REF_C] },
      [TOKEN_D]: { refs: [REF_D] },
      [TOKEN_DEAD]: { refs: [REF_E], state: 'dead' },
    },
  },
);

type ProjectRow = {
  id: string;
  ref: string;
  owner: string;
  org_slug: string | null;
  mgmt_token_sealed: string | null;
  mgmt_token_expires_at: string | null;
  state: string;
  credential_source: string;
  provider: string;
  secret_key_id: number | null;
};
const projectsOf = (ref: string) =>
  adminSql<ProjectRow[]>`
    select id::text as id, ref, owner, org_slug, mgmt_token_sealed, mgmt_token_expires_at::text as mgmt_token_expires_at,
           state, credential_source, provider, secret_key_id
      from platform.projects where ref = ${ref}`;
const eventsOf = (ref: string) =>
  adminSql<
    {
      kind: string;
      project_id: string | null;
      project_ref: string;
      actor: string;
      outcome: string;
    }[]
  >`
    select kind, project_id::text as project_id, project_ref, actor, outcome
      from platform.project_token_events where project_ref = ${ref} order by at, id`;

async function cleanup(): Promise<void> {
  await adminSql`delete from platform.projects where ref = any(${REFS}::text[])`;
  await adminSql`delete from platform.project_token_events where project_ref = any(${REFS}::text[])`;
}

beforeAll(async () => {
  await cleanup();
  setProjectProviderForTests(provider);
});
afterEach(() => {
  captured.lines.length = 0;
});
afterAll(async () => {
  setProjectProviderForTests(undefined);
  await cleanup();
  await adminSql.end();
  await sqlClient.end();
});

describe('registerCustomerProject (D-567, D-568, D-571)', () => {
  it('inserts one customer project with the sealed token, the learned pin and the typed expiry, plus one ok event', async () => {
    const out = await registerCustomerProject({
      ref: REF_A,
      token: TOKEN_A,
      expiresAt: '2026-12-31',
      actor: ACTOR,
      today: '2026-10-27',
    });
    expect(out.orgSlug).toBe(ORG);

    const rows = await projectsOf(REF_A);
    expect(rows).toHaveLength(1);
    const row = rows[0] as ProjectRow;
    expect(row.id).toBe(out.projectId);
    expect(row.owner).toBe('customer');
    expect(row.org_slug).toBe(ORG);
    expect(row.state).toBe('preparing');
    expect(row.credential_source).toBe('sealed');
    expect(row.provider).toBe('fake');
    expect(row.mgmt_token_expires_at).toBe('2026-12-31');
    expect(row.secret_key_id).not.toBeNull();
    // The sealed column opens with the AAD <project id>:mgmt_token and with no other.
    expect(open(row.mgmt_token_sealed as string, `${row.id}:mgmt_token`)).toBe(TOKEN_A);
    expect(() => open(row.mgmt_token_sealed as string, `${row.id}:service_key`)).toThrow();

    const events = await eventsOf(REF_A);
    expect(events).toEqual([
      { kind: 'registered', project_id: row.id, project_ref: REF_A, actor: ACTOR, outcome: 'ok' },
    ]);
  });

  it('a typed expiry of null is stored as null', async () => {
    const out = await registerCustomerProject({
      ref: REF_D,
      token: TOKEN_D,
      expiresAt: null,
      actor: ACTOR,
    });
    const [row] = await projectsOf(REF_D);
    expect(row?.id).toBe(out.projectId);
    expect(row?.mgmt_token_expires_at).toBeNull();
  });

  it('a ref that is already in the registry is refused as already_registered and nothing is written', async () => {
    const [before] = await projectsOf(REF_A);
    const eventsBefore = await eventsOf(REF_A);

    await expect(
      registerCustomerProject({ ref: REF_A, token: TOKEN_A, expiresAt: null, actor: ACTOR }),
    ).rejects.toMatchObject({ name: 'TokenRefusal', code: 'already_registered' });

    expect(await projectsOf(REF_A)).toEqual([before]);
    expect(await eventsOf(REF_A)).toEqual(eventsBefore);
  });

  it('a refused token writes no project row and one event with that outcome and a null project', async () => {
    await expect(
      registerCustomerProject({ ref: REF_E, token: TOKEN_DEAD, expiresAt: null, actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'token_invalid' });

    expect(await projectsOf(REF_E)).toEqual([]);
    expect(await eventsOf(REF_E)).toEqual([
      {
        kind: 'registered',
        project_id: null,
        project_ref: REF_E,
        actor: ACTOR,
        outcome: 'token_invalid',
      },
    ]);
  });

  it('a refusal for a malformed expiry is recorded without the date and writes no project', async () => {
    await expect(
      registerCustomerProject({
        ref: REF_E,
        token: TOKEN_DEAD,
        expiresAt: '2020-01-01',
        actor: ACTOR,
        today: '2026-10-27',
      }),
    ).rejects.toMatchObject({ code: 'token_expiry_invalid' });
    expect(await projectsOf(REF_E)).toEqual([]);
    const events = await eventsOf(REF_E);
    expect(events.at(-1)?.outcome).toBe('token_expiry_invalid');
    expect(JSON.stringify(events)).not.toContain('2020');
  });

  it('concurrent registrations of one ref leave exactly one project row: one wins, the other is already_registered', async () => {
    const attempts = await Promise.allSettled([
      registerCustomerProject({ ref: REF_B, token: TOKEN_B, expiresAt: null, actor: ACTOR }),
      registerCustomerProject({ ref: REF_B, token: TOKEN_B, expiresAt: null, actor: ACTOR }),
    ]);
    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(TokenRefusal);
    expect(rejected[0]?.reason).toMatchObject({ code: 'already_registered' });

    expect(await projectsOf(REF_B)).toHaveLength(1);
    expect((await eventsOf(REF_B)).filter((event) => event.outcome === 'ok')).toHaveLength(1);
  });
});

describe('no token anywhere (T-09.4-24)', () => {
  it('no token reaches a log line, a project row or an event row, in whole or by its first characters', async () => {
    captured.lines.length = 0;
    await registerCustomerProject({
      ref: REF_C,
      token: TOKEN_C,
      expiresAt: '2026-12-31',
      actor: ACTOR,
      today: '2026-10-27',
    });
    await expect(
      registerCustomerProject({ ref: REF_C, token: TOKEN_C, expiresAt: null, actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'already_registered' });
    await expect(
      registerCustomerProject({ ref: REF_E, token: TOKEN_DEAD, expiresAt: null, actor: ACTOR }),
    ).rejects.toBeInstanceOf(TokenRefusal);

    const everything = JSON.stringify([
      captured.lines,
      await adminSql`select * from platform.projects where ref = any(${REFS}::text[])`,
      await adminSql`select * from platform.project_token_events where project_ref = any(${REFS}::text[])`,
    ]);
    for (const token of ALL_TOKENS) {
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(token.slice(0, 8));
    }
    // The registration did log one line, with ids only.
    const registered = captured.lines.filter((line) => line.includes('project.token.registered'));
    expect(registered).toHaveLength(1);
    expect(registered[0]).toContain(ACTOR);
  });
});

describe('the audit append (CTK-28)', () => {
  it('run alone it appends one row, and a failing append is swallowed and never masks the caller', async () => {
    await recordTokenEvent(undefined, {
      kind: 'repinned',
      projectId: null,
      projectRef: REF_E,
      actor: ACTOR,
      outcome: 'org_mismatch',
    });
    expect(await eventsOf(REF_E)).toContainEqual(
      expect.objectContaining({ kind: 'repinned', outcome: 'org_mismatch' }),
    );

    // A ref the table refuses (CHECK) fails inside the insert; alone, that is logged by id and swallowed.
    captured.lines.length = 0;
    await expect(
      recordTokenEvent(undefined, {
        kind: 'repinned',
        projectId: null,
        projectRef: 'NOT A REF',
        actor: ACTOR,
        outcome: 'ok',
      }),
    ).resolves.toBeUndefined();
    expect(captured.lines.some((line) => line.includes('project.token.event_failed'))).toBe(true);
  });
});

describe('the helpers', () => {
  it('sealManagementToken seals under the AAD <project id>:mgmt_token', () => {
    const id = crypto.randomUUID();
    const sealed = sealManagementToken(TOKEN_A, id);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(TOKEN_A);
    expect(open(sealed, `${id}:mgmt_token`)).toBe(TOKEN_A);
  });

  it('apiUrlFor gives https://<ref>.supabase.co for the real provider and the fake target otherwise', () => {
    expect(apiUrlFor({ name: 'supabase' } as ProjectProvider, 'abcdefghijklmnopqrst')).toBe(
      'https://abcdefghijklmnopqrst.supabase.co',
    );
    expect(apiUrlFor(provider, REF_A)).toBe(fakeTarget().apiUrl);
  });
});
