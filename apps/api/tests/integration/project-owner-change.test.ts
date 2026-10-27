import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const REF_D = `ow-d-${RUN}`;
const REF_E = `ow-e-${RUN}`;
const REF_F = `ow-f-${RUN}`;
const REF_G = `ow-g-${RUN}`;
const REF_H = `ow-h-${RUN}`;
const SLUG_A = `ow-a-${RUN}`;
const SLUG_B = `ow-b-${RUN}`;
const SLUG_C = `ow-c-${RUN}`;
const SLUG_R = `ow-r-${RUN}`;
const SLUG_D = `ow-d-${RUN}`;
const SLUG_E = `ow-e-${RUN}`;
const SLUG_F = `ow-f-${RUN}`;
const SLUG_NOPE = `ow-nope-${RUN}`;
const ACTOR = 'tester';

const TOKEN_A = `sbp_fc_fake_owner_aaaa_${RUN}`;
const TOKEN_B = `sbp_fc_fake_owner_bbbb_${RUN}`;
const TOKEN_C = `sbp_fc_fake_owner_cccc_${RUN}`;
const TOKEN_R_OLD = `sbp_fc_fake_owner_rold_${RUN}`;
const TOKEN_R_NEW = `sbp_fc_fake_owner_rnew_${RUN}`;
const TOKEN_D = `sbp_fc_fake_owner_dddd_${RUN}`;
const TOKEN_E = `sbp_fc_fake_owner_eeee_${RUN}`;
const TOKEN_F = `sbp_fc_fake_owner_ffff_${RUN}`;
const TOKEN_F_DEAD = `sbp_fc_fake_owner_fdead_${RUN}`;
const TOKEN_F_FORBIDDEN = `sbp_fc_fake_owner_fforb_${RUN}`;
const TOKEN_WIDE = `sbp_fc_fake_owner_wide_${RUN}`;
const TOKEN_UNPREFIXED = `plain_${RUN}_not_a_scoped_token_at_all`;
const TOKEN_G = `sbp_fc_fake_owner_gggg_${RUN}`;
const TOKEN_H = `sbp_fc_fake_owner_hhhh_${RUN}`;
const TOKEN_H_DEAD = `sbp_fc_fake_owner_hdead_${RUN}`;

const provider: FakeProjectProvider = fakeProvider(
  {
    [REF_A]: fakeTarget(),
    [REF_B]: fakeTarget(),
    [REF_C]: fakeTarget(),
    [REF_R]: fakeTarget(),
    [REF_D]: fakeTarget(),
    [REF_E]: fakeTarget(),
    [REF_F]: fakeTarget(),
    [REF_G]: fakeTarget(),
    [REF_H]: fakeTarget(),
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
      [TOKEN_D]: { refs: [REF_D] },
      [TOKEN_E]: { refs: [REF_E] },
      [TOKEN_F]: { refs: [REF_F] },
      [TOKEN_F_DEAD]: { refs: [REF_F], state: 'dead' },
      [TOKEN_F_FORBIDDEN]: { refs: [REF_F], state: 'forbidden' },
      [TOKEN_WIDE]: { refs: 'all' },
      [TOKEN_G]: { refs: [REF_G] },
      [TOKEN_H]: { refs: [REF_H] },
      [TOKEN_H_DEAD]: { refs: [REF_H], state: 'dead' },
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

const REFS = [REF_A, REF_B, REF_C, REF_R, REF_D, REF_E, REF_F, REF_G, REF_H];
const SLUGS = [SLUG_A, SLUG_B, SLUG_C, SLUG_R, SLUG_D, SLUG_E, SLUG_F];

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
let projectD = '';
let projectF = '';
let projectR = '';

beforeAll(async () => {
  await cleanup();
  resetB();
  setProjectProviderForTests(provider);
  projectA = (await createReadyTenant(provider, REF_A, SLUG_A, { run: false })).projectId;
  ({ tenantId: tenantB, projectId: projectB } = await createReadyTenant(provider, REF_B, SLUG_B, {
    run: false,
  }));
  projectC = (await createReadyTenant(provider, REF_C, SLUG_C, { run: false })).projectId;
  projectR = (await createReadyTenant(provider, REF_R, SLUG_R, { run: false })).projectId;
  await makeCustomerProject(projectR, TOKEN_R_OLD, ORG);
  projectD = (await createReadyTenant(provider, REF_D, SLUG_D, { run: false })).projectId;
  projectF = (await createReadyTenant(provider, REF_F, SLUG_F, { run: false })).projectId;
  // A tenant with an open move: the owner change must refuse it before the prompt.
  const moving = await createReadyTenant(provider, REF_E, SLUG_E, { run: false });
  await adminSql`
    insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, state, status_before, actor)
    values (${moving.tenantId}::uuid, ${moving.projectId}::uuid, ${projectC}::uuid, 'planned', 'active', 'tester')`;
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

describe('re-pin (CTK-04, D-568)', () => {
  it('re-pin: a customer project reads the organisation again and stores the new pin and token', async () => {
    const before = await rowOf(projectR);
    expect(before.org_slug).toBe(ORG);
    const term = terminal(TOKEN_R_NEW);

    const code = await main(['--tenant', SLUG_R, '--actor', ACTOR], term.deps);

    expect(code, term.stderr.join('\n')).toBe(0);
    expect(JSON.parse(term.stdout[0] as string)).toStrictEqual({
      kind: 'repinned',
      projectId: projectR,
      repinned: true,
      dryRun: false,
    });
    const after = await rowOf(projectR);
    expect(after.org_slug).toBe(NEW_ORG);
    expect(open(after.mgmt_token_sealed ?? '', `${projectR}:mgmt_token`)).toBe(TOKEN_R_NEW);
    expect(after.credential_version).toBe(before.credential_version + 1);
    const events = await eventsOf(projectR);
    expect(events.map((event) => event.kind)).toEqual(['repinned']);
    expect(events[0]).toMatchObject({ outcome: 'ok', actor: ACTOR });
  });
});

describe('register (orchestrator ruling 2, D-568)', () => {
  it('register: a project the registry does not know becomes a customer project with no tenant and no move', async () => {
    const term = terminal(TOKEN_G);

    const code = await main(['--register', '--ref', REF_G], term.deps);

    expect(code, term.stderr.join('\n')).toBe(0);
    const line = JSON.parse(term.stdout[0] as string) as {
      kind: string;
      projectId: string;
      dryRun: boolean;
    };
    expect(line.kind).toBe('registered');
    expect(line.dryRun).toBe(false);
    const [row] = await adminSql<
      { id: string; owner: string; state: string; org_slug: string; sealed: string }[]
    >`
      select id::text as id, owner, state, org_slug, mgmt_token_sealed as sealed
        from platform.projects where ref = ${REF_G}`;
    expect(row).toMatchObject({
      id: line.projectId,
      owner: 'customer',
      state: 'preparing',
      org_slug: ORG,
    });
    expect(open(row?.sealed ?? '', `${line.projectId}:mgmt_token`)).toBe(TOKEN_G);
    const [bound] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.tenant_projects where project_id = ${line.projectId}::uuid`;
    const [moves] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.tenant_moves
       where to_project_id = ${line.projectId}::uuid or from_project_id = ${line.projectId}::uuid`;
    expect(bound?.n).toBe(0);
    expect(moves?.n).toBe(0);
    expect((await eventsOf(line.projectId)).map((event) => event.kind)).toEqual(['registered']);
  });

  it('register: the same ref again is refused as already_registered and writes nothing', async () => {
    const [known] = await adminSql<{ id: string; v: number }[]>`
      select id::text as id, credential_version as v from platform.projects where ref = ${REF_G}`;
    const eventsBefore = await eventsOf(known?.id ?? '');
    const term = terminal(TOKEN_G);

    const code = await main(['--register', '--ref', REF_G], term.deps);

    expect(code).toBe(1);
    expect(JSON.parse(term.stdout[0] as string)).toStrictEqual({
      kind: 'refused',
      code: 'already_registered',
    });
    // The refusal comes from the database facts, before the prompt.
    expect(term.prompts).toHaveLength(0);
    const [after] = await adminSql<{ n: number; v: number }[]>`
      select count(*)::int as n, max(credential_version) as v from platform.projects where ref = ${REF_G}`;
    expect(after).toMatchObject({ n: 1, v: known?.v });
    expect(await eventsOf(known?.id ?? '')).toEqual(eventsBefore);
  });

  it('register: a token that does not work registers nothing and leaves one code-only event', async () => {
    const term = terminal(TOKEN_H_DEAD);

    const code = await main(['--register', '--ref', REF_H], term.deps);

    expect(code).toBe(1);
    expect(JSON.parse(term.stdout[0] as string)).toStrictEqual({
      kind: 'refused',
      code: 'token_invalid',
    });
    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where ref = ${REF_H}`;
    expect(rows?.n).toBe(0);
    const events = await adminSql<{ kind: string; outcome: string }[]>`
      select kind, outcome from platform.project_token_events where project_ref = ${REF_H}`;
    expect(events).toEqual([{ kind: 'registered', outcome: 'token_invalid' }]);
  });
});

describe('dry run', () => {
  it('dry: the tenant mode validates and writes no row, no version and no event', async () => {
    const before = await rowOf(projectD);
    const term = terminal(TOKEN_D);

    const code = await main(['--tenant', SLUG_D, '--dry-run'], term.deps);

    expect(code, term.stderr.join('\n')).toBe(0);
    expect(JSON.parse(term.stdout[0] as string)).toStrictEqual({
      kind: 'owner_changed',
      projectId: projectD,
      repinned: false,
      dryRun: true,
    });
    expect(term.prompts).toHaveLength(1);
    expect(await rowOf(projectD)).toEqual(before);
    expect(await eventsOf(projectD)).toHaveLength(0);
    expect(term.afterChange).not.toHaveBeenCalled();
  });

  it('dry: the register mode validates, writes nothing, and a refused dry run leaves no event either', async () => {
    const ok = terminal(TOKEN_H);
    expect(await main(['--register', '--ref', REF_H, '--dry-run'], ok.deps)).toBe(0);
    expect(JSON.parse(ok.stdout[0] as string)).toMatchObject({ kind: 'registered', dryRun: true });
    const dead = terminal(TOKEN_H_DEAD);
    expect(await main(['--register', '--ref', REF_H, '--dry-run'], dead.deps)).toBe(1);
    expect(JSON.parse(dead.stdout[0] as string)).toStrictEqual({
      kind: 'refused',
      code: 'token_invalid',
    });

    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where ref = ${REF_H}`;
    expect(rows?.n).toBe(0);
    const [events] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.project_token_events where project_ref = ${REF_H}`;
    // Only the real (non dry) refusal of the register test above exists for this ref.
    expect(events?.n).toBe(1);
  });

  it('dry: a refused tenant dry run appends no event', async () => {
    const before = await eventsOf(projectD);
    const term = terminal(TOKEN_UNPREFIXED);
    expect(await main(['--tenant', SLUG_D, '--dry-run'], term.deps)).toBe(1);
    expect(JSON.parse(term.stdout[0] as string)).toStrictEqual({
      kind: 'refused',
      code: 'token_account_wide',
    });
    expect(await eventsOf(projectD)).toEqual(before);
  });
});

describe('refusals before the prompt', () => {
  it('before the prompt: an unknown tenant, the central project and an open move never ask for a token', async () => {
    const cases: Array<[string, string]> = [
      [SLUG_NOPE, 'tenant_not_found'],
      ['rede-demo', 'project_central'],
      [SLUG_E, 'tenant_moving'],
    ];
    for (const [slug, expected] of cases) {
      const term = terminal(TOKEN_E);
      const code = await main(['--tenant', slug], term.deps);
      expect(code, slug).toBe(1);
      expect(JSON.parse(term.stdout[0] as string), slug).toStrictEqual({
        kind: 'refused',
        code: expected,
      });
      expect(term.prompts, slug).toHaveLength(0);
    }
  });

  it('before the prompt: usage errors exit 2 with the prompt untouched', async () => {
    const bad: string[][] = [
      [],
      ['--tenant'],
      ['--tenant', 'Bad Slug'],
      ['--tenant', SLUG_A, '--register'],
      ['--tenant', SLUG_A, '--register', '--ref', REF_G],
      ['--register'],
      ['--register', '--ref'],
      ['--register', '--ref', 'NOT A REF'],
      ['--tenant', SLUG_A, '--expires', 'tomorrow'],
    ];
    for (const argv of bad) {
      const term = terminal(TOKEN_A);
      expect(await main(argv, term.deps), argv.join(' ')).toBe(2);
      expect(term.prompts, argv.join(' ')).toHaveLength(0);
      expect(term.stdout).toHaveLength(0);
    }
  });
});

describe('token refusals, no terminal and abort', () => {
  it('each token refusal exits 1 with its code, changes nothing and appends one event', async () => {
    const cases: Array<[string, string[], string]> = [
      [TOKEN_UNPREFIXED, [], 'token_account_wide'],
      [TOKEN_WIDE, [], 'token_account_wide'],
      [TOKEN_F_DEAD, [], 'token_invalid'],
      [TOKEN_F_FORBIDDEN, [], 'token_forbidden'],
      [TOKEN_F, ['--expires', '2001-01-01'], 'token_expiry_invalid'],
    ];
    const before = await rowOf(projectF);
    for (const [token, extra, expected] of cases) {
      const term = terminal(token);
      const code = await main(['--tenant', SLUG_F, ...extra], term.deps);
      expect(code, expected).toBe(1);
      expect(JSON.parse(term.stdout[0] as string), expected).toStrictEqual({
        kind: 'refused',
        code: expected,
      });
      expect(term.afterChange).not.toHaveBeenCalled();
    }
    expect(await rowOf(projectF)).toEqual(before);
    const events = await eventsOf(projectF);
    expect(events.map((event) => event.outcome)).toEqual(cases.map(([, , expected]) => expected));
    expect(events.every((event) => event.kind === 'owner_changed')).toBe(true);
  });

  it('a stdin that is not a terminal exits 2 before any request, and Ctrl-C exits 130', async () => {
    const { NoTerminalError, SecretAbortError } = (await import(
      /* @vite-ignore */ new URL('../../../../scripts/lib/read-secret.ts', import.meta.url).href
    )) as typeof import('../../../../scripts/lib/read-secret');
    const usesBefore = provider.calls.tokenUses.length;

    const noTty = terminal(TOKEN_F);
    noTty.deps.readSecret = async () => {
      throw new NoTerminalError();
    };
    expect(await main(['--tenant', SLUG_F], noTty.deps)).toBe(2);
    expect(noTty.stdout).toHaveLength(0);

    const abort = terminal(TOKEN_F);
    abort.deps.readSecret = async () => {
      throw new SecretAbortError();
    };
    expect(await main(['--tenant', SLUG_F], abort.deps)).toBe(130);
    expect(abort.stdout).toHaveLength(0);

    expect(provider.calls.tokenUses.length).toBe(usesBefore);
  });
});

describe('command discipline (T-09.4-39, D-567)', () => {
  it('--token and every other flag that is not on the list is an unknown argument (exit 2)', async () => {
    const unknown: string[][] = [
      ['--tenant', SLUG_A, '--token', TOKEN_A],
      ['--tenant', SLUG_A, `--token=${TOKEN_A}`],
      ['--tenant', SLUG_A, '--pat', TOKEN_A],
      ['--tenant', SLUG_A, '--access-token', TOKEN_A],
      ['--tenant', SLUG_A, '--password', 'x'],
      ['--tenant', SLUG_A, '-t', TOKEN_A],
      ['--tenant', SLUG_A, TOKEN_A],
      [TOKEN_A],
      ['--tenant', SLUG_A, '--dry-run=true'],
      ['--tenant', SLUG_A, '--register=1'],
    ];
    for (const argv of unknown) {
      expect(parseSetOwnerArgs(argv), argv.join(' ')).toStrictEqual({ error: 'unknown argument' });
      const term = terminal(TOKEN_A);
      expect(await main(argv, term.deps)).toBe(2);
      expect(term.prompts).toHaveLength(0);
      // The refusal never repeats an argument: a token typed by mistake does not land in the terminal log.
      expect([...term.stdout, ...term.stderr].join('\n')).not.toContain(TOKEN_A);
    }
  });

  it('the parser is strict about shapes, repeats and `--`', () => {
    expect(parseSetOwnerArgs(['--', '--tenant', SLUG_A, '--dry-run'])).toMatchObject({
      mode: 'tenant',
      tenant: SLUG_A,
      dryRun: true,
      actor: 'cli',
      expires: null,
    });
    expect(parseSetOwnerArgs([`--tenant=${SLUG_A}`, `--expires=${inDays(3)}`])).toMatchObject({
      mode: 'tenant',
      expires: inDays(3),
    });
    expect(parseSetOwnerArgs(['--register', '--ref', REF_G])).toMatchObject({
      mode: 'register',
      ref: REF_G,
    });
    const errors: string[][] = [
      [],
      ['--tenant'],
      ['--tenant', '--dry-run'],
      ['--tenant', SLUG_A, '--tenant', SLUG_B],
      ['--tenant', SLUG_A, '--dry-run', '--dry-run'],
      ['--tenant', 'UPPER'],
      ['--tenant', 'a b'],
      ['--tenant', SLUG_A, '--expires', '2026-1-1'],
      ['--tenant', SLUG_A, '--expires', 'next week'],
      ['--tenant', SLUG_A, '--actor', 'two words'],
      ['--tenant', SLUG_A, '--actor', 'x'.repeat(65)],
      ['--tenant', SLUG_A, '--ref', REF_G],
      ['--register', '--ref', REF_G, '--tenant', SLUG_A],
      ['--register'],
      ['--register', '--ref', 'UPPER'],
    ];
    for (const argv of errors) {
      expect(parseSetOwnerArgs(argv), argv.join(' ')).toHaveProperty('error');
    }
  });

  it('the source reads no environment variable for a token and no stdin outside readSecret', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../scripts/set-project-owner.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/process\.stdin|\breadline\b/);
    // The only argv read is the flag list handed to the parser.
    const argvReads = source.match(/process\.argv[^\n]*/g) ?? [];
    for (const read of argvReads) expect(read).toMatch(/slice\(2\)|\[1\]/);
    // And the prompt is the only way a token is obtained.
    expect(source).toMatch(/from '\.\/lib\/read-secret'/);
  });

  it('sweep: no outcome prints or stores a token, a prefix, the organisation or the ref', async () => {
    const { NoTerminalError, SecretAbortError } = (await import(
      /* @vite-ignore */ new URL('../../../../scripts/lib/read-secret.ts', import.meta.url).href
    )) as typeof import('../../../../scripts/lib/read-secret');
    const seen: string[] = [];
    const run = async (
      argv: string[],
      token: string,
      expectedCode: number,
      prompt?: () => Promise<string>,
    ) => {
      const term = terminal(token);
      if (prompt) term.deps.readSecret = prompt;
      expect(await main(argv, term.deps), argv.join(' ')).toBe(expectedCode);
      seen.push(...term.stdout, ...term.stderr, ...term.prompts);
    };

    captured.lines.length = 0;
    await run(['--tenant', SLUG_A], TOKEN_A, 0); // an owner change, or a re-pin when it ran before
    await run(['--tenant', SLUG_R], TOKEN_R_OLD, 0); // another re-pin
    await run(['--register', '--ref', REF_H], TOKEN_H, 0); // registered
    await run(['--register', '--ref', REF_H], TOKEN_H, 1); // already_registered
    await run(['--tenant', SLUG_D, '--dry-run'], TOKEN_D, 0); // dry run
    await run(['--register', '--ref', REF_H, '--dry-run'], TOKEN_H, 1); // dry run of a known ref
    await run(['--tenant', SLUG_F], TOKEN_UNPREFIXED, 1);
    await run(['--tenant', SLUG_F], TOKEN_WIDE, 1);
    await run(['--tenant', SLUG_F], TOKEN_F_DEAD, 1);
    await run(['--tenant', SLUG_F], TOKEN_F_FORBIDDEN, 1);
    await run(['--tenant', SLUG_F, '--expires', '2001-01-01'], TOKEN_F, 1);
    await run(['--tenant', SLUG_NOPE], TOKEN_F, 1);
    await run(['--tenant', 'rede-demo'], TOKEN_F, 1);
    await run(['--tenant', SLUG_E], TOKEN_F, 1);
    await run(['--tenant', SLUG_F, '--token', TOKEN_F], TOKEN_F, 2);
    await run([], TOKEN_F, 2);
    await run(['--tenant', SLUG_F], TOKEN_F, 2, async () => {
      throw new NoTerminalError();
    });
    await run(['--tenant', SLUG_F], TOKEN_F, 130, async () => {
      throw new SecretAbortError();
    });

    // Every audit column except the registry's own `project_ref` (the ref is that column's whole purpose).
    const rows = await adminSql`
      select id::text as id, kind, project_id::text as project_id, actor, outcome, at::text as at
        from platform.project_token_events where project_ref = any(${REFS}::text[])`;
    const everything = [...seen, ...captured.lines, JSON.stringify(rows)].join('\n');

    const tokens = [
      TOKEN_A,
      TOKEN_B,
      TOKEN_C,
      TOKEN_D,
      TOKEN_E,
      TOKEN_F,
      TOKEN_F_DEAD,
      TOKEN_F_FORBIDDEN,
      TOKEN_G,
      TOKEN_H,
      TOKEN_H_DEAD,
      TOKEN_R_OLD,
      TOKEN_R_NEW,
      TOKEN_WIDE,
      TOKEN_UNPREFIXED,
    ];
    const shapes = [
      ...tokens,
      ...tokens.map((token) => token.slice(0, 8)),
      'sbp_',
      'Bearer',
      'eyJ',
      ORG,
      NEW_ORG,
      ...REFS,
    ];
    for (const shape of shapes) {
      expect(everything.includes(shape), `a ${shape.length}-character secret shape leaked`).toBe(
        false,
      );
    }
    expect(seen.length).toBeGreaterThan(10);
  });
});
