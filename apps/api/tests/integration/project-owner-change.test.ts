import { sqlClient } from '@rede-social/core/db';
import type { FakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { open } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createReadyTenant,
  fakeProvider,
  fakeTarget,
  makeCustomerProject,
  resetB,
  restoreB,
} from './projects-setup';
import { adminSql } from './setup';

/**
 * Every line any logger writes in this file is captured, so the scan reads what a person tailing the logs
 * would see (T-09.4-39). The mock replaces the ONE root logger every kernel and API logger derives from.
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

// The command lives in the repo's `scripts/`, outside this package: a static import would leave the package
// and fail `turbo boundaries`. The module is loaded by URL instead; its type is still checked.
const { main, parseSetOwnerArgs } = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/set-project-owner.ts', import.meta.url).href
)) as typeof import('../../../../scripts/set-project-owner');

/**
 * Phase 09.4-11 (D-566 journey 3, D-567, D-568, D-571, CTK-03, CTK-04): the owner-change command. Real
 * registry, sealing, audit table and kernel against the FAKE provider's customer tokens; the command is driven
 * through `main` with an injected hidden prompt, exactly as the terminal would.
 */

const RUN = Date.now().toString(36);
const ORG = `acme-own-${RUN}`;
const NEW_ORG = `new-org-${RUN}`;
const REF_A = `ow-a-${RUN}`;
const REF_B = `ow-b-${RUN}`;
const REF_C = `ow-c-${RUN}`;
const REF_R = `ow-r-${RUN}`;
const SLUG_A = `ow-a-${RUN}`;
const SLUG_B = `ow-b-${RUN}`;
const SLUG_C = `ow-c-${RUN}`;
const SLUG_R = `ow-r-${RUN}`;
const ACTOR = 'tester';

const TOKEN_A = `sbp_fc_fake_owner_aaaa_${RUN}`;
const TOKEN_B = `sbp_fc_fake_owner_bbbb_${RUN}`;
const TOKEN_C = `sbp_fc_fake_owner_cccc_${RUN}`;
const TOKEN_R_OLD = `sbp_fc_fake_owner_rold_${RUN}`;
const TOKEN_R_NEW = `sbp_fc_fake_owner_rnew_${RUN}`;

const provider: FakeProjectProvider = fakeProvider(
  {
    [REF_A]: fakeTarget(),
    [REF_B]: fakeTarget(),
    [REF_C]: fakeTarget(),
    [REF_R]: fakeTarget(),
  },
  {
    orgSlug: ORG,
    orgs: { [REF_R]: NEW_ORG },
    tokens: {
      [TOKEN_A]: { refs: [REF_A] },
      [TOKEN_B]: { refs: [REF_B] },
      [TOKEN_C]: { refs: [REF_C] },
      [TOKEN_R_OLD]: { refs: [REF_R] },
      [TOKEN_R_NEW]: { refs: [REF_R] },
    },
  },
);

/** The terminal, faked: `main` is given the hidden prompt and the two output channels. */
function terminal(token: string) {
  const prompts: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const afterChange = vi.fn();
  return {
    prompts,
    stdout,
    stderr,
    afterChange,
    deps: {
      readSecret: async (label: string) => {
        prompts.push(label);
        return token;
      },
      out: (line: string) => stdout.push(line),
      err: (line: string) => stderr.push(line),
      afterChange,
    },
  };
}

type Row = {
  owner: string;
  org_slug: string | null;
  mgmt_token_sealed: string | null;
  credential_version: number;
};
const rowOf = async (projectId: string): Promise<Row> => {
  const [row] = await adminSql<Row[]>`
    select owner, org_slug, mgmt_token_sealed, credential_version
      from platform.projects where id = ${projectId}::uuid`;
  if (!row) throw new Error('no such project');
  return row;
};
const eventsOf = (projectId: string) =>
  adminSql<{ kind: string; outcome: string; actor: string }[]>`
    select kind, outcome, actor from platform.project_token_events
     where project_id = ${projectId}::uuid order by at, id`;

/** Everything about a tenant that a data copy would touch. */
async function snapshot(tenantId: string, projectId: string) {
  const [tenant] = await adminSql<{ status: string; display_name: string }[]>`
    select status, display_name from public.tenants where id = ${tenantId}::uuid`;
  const [bound] = await adminSql<{ project_id: string }[]>`
    select project_id::text as project_id from platform.tenant_projects where tenant_id = ${tenantId}::uuid`;
  const [counts] = await adminSql<
    { memberships: number; modules: number; moves: number; projects: number }[]
  >`
    select (select count(*)::int from public.memberships where tenant_id = ${tenantId}::uuid) as memberships,
           (select count(*)::int from public.tenant_modules where tenant_id = ${tenantId}::uuid) as modules,
           (select count(*)::int from platform.tenant_moves where tenant_id = ${tenantId}::uuid) as moves,
           (select count(*)::int from platform.projects) as projects`;
  if (!counts) throw new Error('no counts');
  return { tenant, bound, counts, projectId };
}

/** A date a month ahead: always inside the "after today, at most a year ahead" window. */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const REFS = [REF_A, REF_B, REF_C, REF_R];
const SLUGS = [SLUG_A, SLUG_B, SLUG_C, SLUG_R];

async function cleanup(): Promise<void> {
  await adminSql`delete from public.tenants where slug = any(${SLUGS}::text[])`;
  await adminSql`delete from platform.project_token_events where project_ref = any(${REFS}::text[])`;
  await adminSql`delete from platform.projects where ref = any(${REFS}::text[])`;
  await adminSql`
    delete from public.access_grants where email like ${`admin-ow-%-${RUN}@rede-social-test.local`}`;
}

let projectA = '';
let tenantB = '';
let projectB = '';
let projectC = '';

beforeAll(async () => {
  await cleanup();
  resetB();
  setProjectProviderForTests(provider);
  projectA = (await createReadyTenant(provider, REF_A, SLUG_A, { run: false })).projectId;
  ({ tenantId: tenantB, projectId: projectB } = await createReadyTenant(provider, REF_B, SLUG_B, {
    run: false,
  }));
  projectC = (await createReadyTenant(provider, REF_C, SLUG_C, { run: false })).projectId;
  await createReadyTenant(provider, REF_R, SLUG_R, { run: false }).then(async (made) => {
    await makeCustomerProject(made.projectId, TOKEN_R_OLD, ORG);
  });
  captured.lines.length = 0;
}, 180_000);

afterEach(() => {
  captured.lines.length = 0;
});

afterAll(async () => {
  setProjectProviderForTests(undefined);
  await cleanup();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
  restoreB();
});

describe('platform to customer (tracer, CTK-03)', () => {
  it('seals the token, pins the learned organisation, bumps the version and appends owner_changed', async () => {
    const before = await rowOf(projectA);
    expect(before.owner).toBe('platform');
    const term = terminal(TOKEN_A);

    const code = await main(['--tenant', SLUG_A], term.deps);

    expect(code, term.stderr.join('\n')).toBe(0);
    expect(term.stdout).toHaveLength(1);
    expect(JSON.parse(term.stdout[0] as string)).toStrictEqual({
      kind: 'owner_changed',
      projectId: projectA,
      repinned: false,
      dryRun: false,
    });
    const after = await rowOf(projectA);
    expect(after.owner).toBe('customer');
    expect(after.org_slug).toBe(ORG);
    expect(open(after.mgmt_token_sealed ?? '', `${projectA}:mgmt_token`)).toBe(TOKEN_A);
    expect(after.credential_version).toBe(before.credential_version + 1);
    const events = await eventsOf(projectA);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'owner_changed', outcome: 'ok' });
    expect(term.afterChange).toHaveBeenCalledWith(projectA);
  });

  it('copies nothing: no row moves, the binding and the status stay, no tenant_moves row exists', async () => {
    const before = await snapshot(tenantB, projectB);
    const term = terminal(TOKEN_B);

    const code = await main(['--tenant', SLUG_B], term.deps);

    expect(code, term.stderr.join('\n')).toBe(0);
    const after = await snapshot(tenantB, projectB);
    expect(after.tenant).toEqual(before.tenant);
    expect(after.bound).toEqual(before.bound);
    expect(after.counts.memberships).toBe(before.counts.memberships);
    expect(after.counts.modules).toBe(before.counts.modules);
    // No tenant_moves row for the tenant, and no project row was added.
    expect(after.counts.moves).toBe(0);
    expect(after.counts.projects).toBe(before.counts.projects);
  });

  it('prints and stores no token, prefix, organisation slug or ref', async () => {
    const term = terminal(TOKEN_C);
    const code = await main(['--tenant', SLUG_C], term.deps);
    expect(code, term.stderr.join('\n')).toBe(0);

    // The audit table holds the project ref by design (its own column); the scan covers every other column.
    const events = await adminSql`
      select kind, outcome, actor, project_id::text as project_id
        from platform.project_token_events where project_id = ${projectC}::uuid`;
    const seen = [
      ...term.stdout,
      ...term.stderr,
      ...term.prompts,
      ...captured.lines,
      JSON.stringify(events),
    ].join('\n');
    for (const secret of [TOKEN_C, TOKEN_C.slice(0, 8), ORG, REF_C]) {
      expect(seen, `leaked ${secret.length} characters`).not.toContain(secret);
    }
  });
});

describe('arguments', () => {
  it('parses the tenant, the expiry, the actor and the dry run', () => {
    expect(
      parseSetOwnerArgs(['--tenant', SLUG_A, '--expires', inDays(5), '--actor', ACTOR]),
    ).toMatchObject({
      tenant: SLUG_A,
      expires: inDays(5),
      actor: ACTOR,
      dryRun: false,
    });
  });
});
