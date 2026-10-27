import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { eventsOf, latestMoveOf, runMove } from '@rede-social/core/server/projects/move/index';
import {
  type RegisterInput,
  registerMoveTarget,
} from '@rede-social/core/server/projects/move/target';
import { MoveError } from '@rede-social/core/server/projects/move/types';
import { isTenantMoving } from '@rede-social/core/server/projects/moving';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { open } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import {
  invalidateTenantHost,
  resolveTenantHost,
} from '@rede-social/core/server/tenancy/tenant-host';
import * as vt from 'vitest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adoptAsSource,
  type CustomerHarness,
  closeHelperClients,
  connect,
  createMoveTenant,
  customerHarness,
  footprint,
  harness,
  type MoveTenant,
  registerCustomerTarget,
  removeTargetProject,
  resetB,
  SRC_URL,
  TGT_URL,
} from './move-helpers';
import { adminSql, api, HOSTS } from './setup';

/**
 * Phase 09.2-23, the tracer (DBT-34, DBT-48, D-535, D-536): a throwaway tenant of project 0 is moved to a
 * freshly bootstrapped second database by the REAL tool (state machine, suspension, quiescence, the plan 22
 * copy, verification, the one-transaction repoint, cache invalidation, queue re-sync, branding mirror and
 * reactivation) and is then served from there, while the source still holds every row. The waits are 0 (the
 * real cache-expiry behaviour across instances is hosted proof H6). Nothing touches a hosted project.
 */

const RUN = Date.now().toString(36);
const SLUG = `mv-run-${RUN}`.slice(0, 40);
const ACTOR = 'cli:test';

let tenant: MoveTenant;
let h: ReturnType<typeof harness>;
let moveId = '';

beforeAll(async () => {
  resetB('bare');
  h = harness();
  tenant = await createMoveTenant(SLUG);
});

afterAll(async () => {
  await tenant?.cleanup();
  await removeTargetProject(h.ref).catch(() => undefined);
  await stopBoss();
  await closeAllPools();
  await closeHelperClients();
  await adminSql.end();
  await sqlClient.end();
  resetB('migrated');
});

const options = (mode: 'start' | 'resume' | 'status' | 'dry-run' = 'start') =>
  ({
    mode,
    tenantSlug: SLUG,
    toRef: h.ref,
    actor: ACTOR,
    quiesceMs: 0,
    registryWaitMs: 0,
  }) as const;

describe('the tracer: one command moves a tenant to its own database', () => {
  it('moves a tenant end to end', async () => {
    const source = connect(SRC_URL);
    const before = await footprint(source, tenant.tenantId);
    expect(before.feed_posts).toBe(1);
    expect(before.events).toBe(1);
    expect(before.event_secrets).toBe(1);
    const [demoBefore] = await adminSql<{ project_id: string }[]>`
      select tp.project_id from platform.tenant_projects tp
        join public.tenants t on t.id = tp.tenant_id where t.slug = 'rede-demo'`;

    const result = await runMove(options(), h.deps);
    expect(result.outcome).toBe('moved');
    expect(result.state).toBe('done');
    moveId = result.moveId ?? '';

    // The trail, in order.
    const events = await eventsOf(moveId);
    expect(events.map((e) => e.kind)).toEqual([
      'started',
      'target_ready',
      'suspended',
      'quiesced',
      'copied',
      'verified',
      'cutover',
      'reactivated',
      'done',
    ]);

    // The pointer: the target now, project 0 remembered.
    const [target] = await adminSql<{ id: string; state: string; publishable_key: string }[]>`
      select id, state, publishable_key from platform.projects where ref = ${h.ref}`;
    expect(target?.state).toBe('ready');
    const [binding] = await adminSql<{ project_id: string; previous_project_id: string | null }[]>`
      select project_id, previous_project_id from platform.tenant_projects
       where tenant_id = ${tenant.tenantId}::uuid`;
    expect(binding?.project_id).toBe(target?.id);
    const [central] = await adminSql<{ id: string }[]>`
      select id from platform.projects where is_central`;
    expect(binding?.previous_project_id).toBe(central?.id);

    // The host answers active, with the target's coordinates.
    invalidateTenantHost(tenant.host);
    const host = await resolveTenantHost(tenant.host);
    expect(host.kind).toBe('tenant');
    if (host.kind === 'tenant') {
      expect(host.status).toBe('active');
      expect(host.projectId).toBe(target?.id);
      expect(host.publishableKey).toBe(target?.publishable_key);
      expect(host.supabaseUrl).toBeTruthy();
    }

    // A session minted for a copied member is served FROM THE TARGET: B's own tenant row is the one read.
    const targetDb = connect(TGT_URL);
    await targetDb`update public.tenants set display_name = 'Movel (B)' where id = ${tenant.tenantId}::uuid`;
    const res = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${await tenant.token()}`, 'x-tenant-host': tenant.host },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { id: string; displayName: string } };
    expect(body.tenant.id).toBe(tenant.tenantId);
    expect(body.tenant.displayName).toBe('Movel (B)');

    // The copy holds every row; the source is untouched.
    expect(await footprint(targetDb, tenant.tenantId)).toEqual(before);
    expect(await footprint(source, tenant.tenantId)).toEqual(before);

    // Another tenant of project 0 is unaffected.
    const [demoAfter] = await adminSql<{ project_id: string }[]>`
      select tp.project_id from platform.tenant_projects tp
        join public.tenants t on t.id = tp.tenant_id where t.slug = 'rede-demo'`;
    expect(demoAfter?.project_id).toBe(demoBefore?.project_id);
    const demo = await resolveTenantHost(HOSTS.demo);
    expect(demo.kind === 'tenant' && demo.status).toBe('active');
    if (demo.kind === 'tenant') expect(demo.projectId).toBe(central?.id);

    expect(await isTenantMoving(tenant.tenantId)).toBe(false);
    const [row] = await adminSql<{ status: string }[]>`
      select status from public.tenants where id = ${tenant.tenantId}::uuid`;
    expect(row?.status).toBe('active');
  });

  it('answers already_done for a finished move and writes nothing', async () => {
    const countEvents = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from platform.tenant_move_events where move_id = ${moveId}::uuid`;
      return row?.n ?? -1;
    };
    const eventsBefore = await countEvents();
    const again = await runMove(options('start'), h.deps);
    expect(again.outcome).toBe('already_done');
    const resumed = await runMove(options('resume'), h.deps);
    expect(resumed.outcome).toBe('already_done');
    expect(await countEvents()).toBe(eventsBefore);
    const last = await latestMoveOf(tenant.tenantId);
    expect(last?.state).toBe('done');
  });

  it('keeps every report and event free of e-mails, hashes, tokens and connection strings', async () => {
    const status = await runMove(options('status'), h.deps);
    const text = JSON.stringify([status.lines, await eventsOf(moveId)]);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\$2[ab]\$/);
    expect(text).not.toContain('eyJ');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('sb_secret_');
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-12: the second journey of D-566, a tenant moved to a project of the customer's account
// ---------------------------------------------------------------------------------------------------------

type CustomerCase = {
  t: MoveTenant;
  ch: CustomerHarness;
  /** The customer project, registered ahead of time (plan 11). */
  customerRef: string;
  customerId: string;
  /** A second ref the fake maps, for the platform-owned target cases. */
  platformRef: string;
  token: string;
  centralId: string;
};

const customerCases: CustomerCase[] = [];

async function customerCase(
  label: string,
  options: { register?: boolean } = {},
): Promise<CustomerCase> {
  resetB('bare');
  const suffix = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const customerRef = `mvc-${suffix}`;
  const platformRef = `mvp-${suffix}`;
  const token = `sbp_fc_fake_mv12_${suffix}`;
  const ch = customerHarness({
    refs: [customerRef, platformRef],
    tokens: {
      [token]: { refs: [customerRef] },
      // A token of the same account that reaches only the OTHER project, and one that reaches everything.
      [`${token}_other`]: { refs: [platformRef] },
      [`${token}_wide`]: { refs: 'all' },
    },
    bootstrap: 'per-project',
  });
  // The per-project resolver builds the customer view from the pinned fake.
  setProjectProviderForTests(ch.provider);
  const t = await createMoveTenant(`mv12-${suffix}`.slice(0, 40));
  const customerId =
    options.register === false ? '' : await registerCustomerTarget(ch, customerRef, token);
  const [central] = await adminSql<
    { id: string }[]
  >`select id from platform.projects where is_central`;
  const made = { t, ch, customerRef, customerId, platformRef, token, centralId: central?.id ?? '' };
  customerCases.push(made);
  return made;
}

vt.afterEach(async () => {
  setProjectProviderForTests(undefined);
  for (const made of customerCases.splice(0)) {
    await made.t.cleanup().catch(() => undefined);
    await removeTargetProject(made.customerRef).catch(() => undefined);
    await removeTargetProject(made.platformRef).catch(() => undefined);
  }
});

const refusalOf = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return null;
};

const startInput = (
  c: CustomerCase,
  ref: string,
  owner?: 'platform' | 'customer',
  tokenExpiresAt?: string | null,
): RegisterInput => ({
  tenantId: c.t.tenantId,
  ref,
  actor: ACTOR,
  statusBefore: 'active',
  fromProjectId: c.centralId,
  owner,
  tokenExpiresAt,
});

async function dropOpenMove(tenantId: string): Promise<void> {
  await adminSql`
    delete from platform.tenant_move_events
     where move_id in (select id from platform.tenant_moves where tenant_id = ${tenantId}::uuid)`;
  await adminSql`delete from platform.tenant_moves where tenant_id = ${tenantId}::uuid`;
}

const moveRowsOf = async (tenantId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from platform.tenant_moves where tenant_id = ${tenantId}::uuid`;
  return row?.n ?? -1;
};

describe('a registered customer target (09.4-12, CTK-02, D-566 journey 2)', () => {
  it('tracer: moves a tenant to a customer project on the sealed token and asks for nothing', async () => {
    const c = await customerCase('trace');
    const readToken = vt.vi.fn(async () => {
      throw new Error('the prompt must not be called');
    });
    const result = await runMove(
      {
        mode: 'start',
        tenantSlug: c.t.slug,
        toRef: c.customerRef,
        owner: 'customer',
        actor: ACTOR,
        quiesceMs: 0,
        registryWaitMs: 0,
      },
      { ...c.ch.deps, target: { ...c.ch.deps.target, readToken } },
    );
    expect(result.outcome).toBe('moved');
    expect(result.state).toBe('done');
    expect(readToken).not.toHaveBeenCalled();

    // The target was bootstrapped by the SAME engine with the customer's own token, never the platform's.
    const uses = c.ch.provider.calls.tokenUses.filter((use) => use.ref === c.customerRef);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((use) => use.kind === 'platform')).toEqual([]);

    const [binding] = await adminSql<{ project_id: string }[]>`
      select project_id from platform.tenant_projects where tenant_id = ${c.t.tenantId}::uuid`;
    expect(binding?.project_id).toBe(c.customerId);
    const [project] = await adminSql<{ state: string; owner: string }[]>`
      select state, owner from platform.projects where id = ${c.customerId}::uuid`;
    expect(project).toEqual({ state: 'ready', owner: 'customer' });
  }, 240_000);

  it('an explicit platform owner on a new target registers a platform project (the old path)', async () => {
    const c = await customerCase('plat');
    const registered = await registerMoveTarget(
      startInput(c, c.platformRef, 'platform'),
      c.ch.deps.target,
    );
    expect(registered.registered).toBe(true);
    const [row] = await adminSql<{ owner: string; mgmt_token_sealed: string | null }[]>`
      select owner, mgmt_token_sealed from platform.projects where id = ${registered.projectId}::uuid`;
    expect(row).toEqual({ owner: 'platform', mgmt_token_sealed: null });
  });

  it('refuses a known PLATFORM project asked for as a customer target and writes nothing', async () => {
    const c = await customerCase('refuse');
    await registerMoveTarget(startInput(c, c.platformRef, 'platform'), c.ch.deps.target);
    await dropOpenMove(c.t.tenantId);

    const error = await refusalOf(
      registerMoveTarget(startInput(c, c.platformRef, 'customer'), c.ch.deps.target),
    );
    expect(error).toBeInstanceOf(MoveError);
    expect((error as MoveError).code).toBe('target_not_ready');
    expect((error as MoveError).tables).toEqual(['owner']);
    expect(await moveRowsOf(c.t.tenantId)).toBe(0);
  });

  it('accepts a known CUSTOMER project without an owner (the registry says what it is)', async () => {
    const c = await customerCase('known');
    const readToken = vt.vi.fn(async () => 'never');
    const accepted = await registerMoveTarget(startInput(c, c.customerRef), {
      ...c.ch.deps.target,
      readToken,
    });
    expect(accepted.registered).toBe(false);
    expect(accepted.projectId).toBe(c.customerId);
    expect(readToken).not.toHaveBeenCalled();
    expect(await moveRowsOf(c.t.tenantId)).toBe(1);

    // The same project asked for as a platform one is refused, and nothing more is written.
    await dropOpenMove(c.t.tenantId);
    const error = await refusalOf(
      registerMoveTarget(startInput(c, c.customerRef, 'platform'), c.ch.deps.target),
    );
    expect((error as MoveError).tables).toEqual(['owner']);
    expect(await moveRowsOf(c.t.tenantId)).toBe(0);
  });
});

async function rowsAbout(ref: string, tenantId: string) {
  const one = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? -1;
  return {
    projects: await one(
      adminSql<
        { n: number }[]
      >`select count(*)::int as n from platform.projects where ref = ${ref}`,
    ),
    events: await one(
      adminSql<{ n: number }[]>`
        select count(*)::int as n from platform.project_token_events where project_ref = ${ref}`,
    ),
    moves: await moveRowsOf(tenantId),
  };
}

describe('an unknown customer target (09.4-12, CTK-02, D-567, D-571)', () => {
  // The typed expiry rule: after today and within a year.
  const ASKED = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);

  it('registers the project, its sealed token and the move in one transaction, from the injected prompt', async () => {
    const c = await customerCase('reg', { register: false });
    const readToken = vt.vi.fn(async () => c.token);
    const done = await registerMoveTarget(startInput(c, c.customerRef, 'customer', ASKED), {
      ...c.ch.deps.target,
      readToken,
    });
    expect(done.registered).toBe(true);
    expect(readToken).toHaveBeenCalledTimes(1);

    const [row] = await adminSql<
      {
        owner: string;
        org_slug: string | null;
        state: string;
        sealed: string | null;
        expires: string | null;
      }[]
    >`
      select owner, org_slug, state, mgmt_token_sealed as sealed, mgmt_token_expires_at::text as expires
        from platform.projects where id = ${done.projectId}::uuid`;
    expect(row?.owner).toBe('customer');
    expect(row?.org_slug).toBe('acme-customer');
    expect(row?.state).toBe('preparing');
    expect(row?.expires).toBe(ASKED);
    // Sealed under the project's own AAD, and only opens to the typed token.
    expect(open(row?.sealed ?? '', `${done.projectId}:mgmt_token`)).toBe(c.token);

    const [move] = await adminSql<{ to_project_id: string }[]>`
      select to_project_id from platform.tenant_moves where tenant_id = ${c.t.tenantId}::uuid`;
    expect(move?.to_project_id).toBe(done.projectId);
    const events = await adminSql<{ kind: string; outcome: string; project_id: string | null }[]>`
      select kind, outcome, project_id from platform.project_token_events
       where project_ref = ${c.customerRef}`;
    expect(events).toEqual([{ kind: 'registered', outcome: 'ok', project_id: done.projectId }]);
  });

  it('writes nothing when the move row cannot be written: the registration rides the same transaction', async () => {
    const c = await customerCase('atomic', { register: false });
    const readToken = vt.vi.fn(async () => c.token);
    await expect(
      registerMoveTarget(
        { ...startInput(c, c.customerRef, 'customer'), fromProjectId: crypto.randomUUID() },
        { ...c.ch.deps.target, readToken },
      ),
    ).rejects.toThrow();
    expect(await rowsAbout(c.customerRef, c.t.tenantId)).toEqual({
      projects: 0,
      events: 0,
      moves: 0,
    });
  });

  it('fails closed with register_first when no prompt exists or the terminal is missing', async () => {
    const c = await customerCase('first', { register: false });
    const noTerminal = Object.assign(new Error('readSecret: stdin is not a terminal'), {
      name: 'NoTerminalError',
    });
    for (const target of [
      { ...c.ch.deps.target },
      {
        ...c.ch.deps.target,
        readToken: async (): Promise<string> => {
          throw noTerminal;
        },
      },
    ]) {
      const error = await refusalOf(
        registerMoveTarget(startInput(c, c.customerRef, 'customer'), target),
      );
      expect(error).toBeInstanceOf(MoveError);
      expect((error as MoveError).code).toBe('target_not_ready');
      expect((error as MoveError).tables).toEqual(['register_first']);
    }
    expect(await rowsAbout(c.customerRef, c.t.tenantId)).toEqual({
      projects: 0,
      events: 0,
      moves: 0,
    });
  });

  it('turns every token refusal into a closed code and writes nothing', async () => {
    const c = await customerCase('reasons', { register: false });
    const cases: Array<{ token: string; expires?: string; code: string }> = [
      { token: `${c.token}_unknown`, code: 'token_invalid' },
      { token: `${c.token}_other`, code: 'token_forbidden' },
      { token: `${c.token}_wide`, code: 'token_account_wide' },
      { token: 'plain_not_a_scoped_token_at_all', code: 'token_account_wide' },
      { token: c.token, expires: '2000-01-01', code: 'token_expiry_invalid' },
    ];
    for (const entry of cases) {
      const error = await refusalOf(
        registerMoveTarget(startInput(c, c.customerRef, 'customer', entry.expires ?? null), {
          ...c.ch.deps.target,
          readToken: async () => entry.token,
        }),
      );
      expect(error).toBeInstanceOf(MoveError);
      expect((error as MoveError).code).toBe('target_not_ready');
      expect((error as MoveError).tables).toEqual([entry.code]);
      expect((error as MoveError).message).not.toContain(entry.token);
    }
    expect(await rowsAbout(c.customerRef, c.t.tenantId)).toEqual({
      projects: 0,
      events: 0,
      moves: 0,
    });
  });

  it('a dry run never prompts and writes nothing', async () => {
    const c = await customerCase('dry', { register: false });
    const readToken = vt.vi.fn(async () => c.token);
    const result = await runMove(
      {
        mode: 'dry-run',
        tenantSlug: c.t.slug,
        toRef: c.customerRef,
        owner: 'customer',
        actor: ACTOR,
        quiesceMs: 0,
        registryWaitMs: 0,
      },
      { ...c.ch.deps, target: { ...c.ch.deps.target, readToken } },
    );
    expect(result.outcome).toBe('dry_run');
    expect(readToken).not.toHaveBeenCalled();
    const plan = result.lines.find((line) => line.kind === 'plan');
    expect(plan?.targetChecked).toBe(false);
    expect(await rowsAbout(c.customerRef, c.t.tenantId)).toEqual({
      projects: 0,
      events: 0,
      moves: 0,
    });
  });

  it('a resume of an interrupted move finds the target registered and prompts for nothing', async () => {
    const c = await customerCase('resume', { register: false });
    // The target cannot be prepared: the start registers it (one prompt), then stops at the schema step.
    c.ch.provider.arm({ step: 'schema', times: 'always' });
    const first = vt.vi.fn(async () => c.token);
    const base = {
      tenantSlug: c.t.slug,
      toRef: c.customerRef,
      actor: ACTOR,
      quiesceMs: 0,
      registryWaitMs: 0,
    } as const;
    const started = await refusalOf(
      runMove(
        { ...base, mode: 'start', owner: 'customer' },
        { ...c.ch.deps, target: { ...c.ch.deps.target, readToken: first } },
      ),
    );
    expect((started as MoveError).code).toBe('target_not_ready');
    expect(first).toHaveBeenCalledTimes(1);
    expect((await rowsAbout(c.customerRef, c.t.tenantId)).projects).toBe(1);

    const second = vt.vi.fn(async () => c.token);
    const resumed = await refusalOf(
      runMove(
        { ...base, mode: 'resume' },
        { ...c.ch.deps, target: { ...c.ch.deps.target, readToken: second } },
      ),
    );
    expect((resumed as MoveError).code).toBe('target_not_ready');
    expect(second).not.toHaveBeenCalled();
    // Still one project, one move, one audit event.
    expect(await rowsAbout(c.customerRef, c.t.tenantId)).toEqual({
      projects: 1,
      events: 1,
      moves: 1,
    });
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------
// The way back (CTK-05, D-566): customer project to platform project, no new code path
// ---------------------------------------------------------------------------------------------------------

type WayBack = {
  t: MoveTenant;
  ch: CustomerHarness;
  refA: string;
  refB: string;
  refC: string;
  idA: string;
  tokenA: string;
  tokenC: string;
  base: {
    tenantSlug: string;
    actor: string;
    quiesceMs: number;
    registryWaitMs: number;
  };
};

const wayBackCases: WayBack[] = [];

/** A tenant whose data sits in project 0's database but is BOUND to a customer project A (the source). */
async function wayBackCase(label: string, bootstrap: 'platform' | 'per-project'): Promise<WayBack> {
  resetB('bare');
  const suffix = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [refA, refB, refC] = [`mva-${suffix}`, `mvb-${suffix}`, `mvk-${suffix}`];
  const tokenA = `sbp_fc_fake_wb_a_${suffix}`;
  const tokenC = `sbp_fc_fake_wb_c_${suffix}`;
  const ch = customerHarness({
    refs: [refA, refB, refC],
    tokens: { [tokenA]: { refs: [refA] }, [tokenC]: { refs: [refC] } },
    sourceRefs: [refA],
    bootstrap,
  });
  setProjectProviderForTests(ch.provider);
  const t = await createMoveTenant(`mv12-${suffix}`.slice(0, 40));
  const idA = await registerCustomerTarget(ch, refA, tokenA);
  await adoptAsSource(t.tenantId, idA);
  const made = {
    t,
    ch,
    refA,
    refB,
    refC,
    idA,
    tokenA,
    tokenC,
    base: { tenantSlug: t.slug, actor: ACTOR, quiesceMs: 0, registryWaitMs: 0 },
  };
  wayBackCases.push(made);
  return made;
}

vt.afterEach(async () => {
  setProjectProviderForTests(undefined);
  for (const made of wayBackCases.splice(0)) {
    await made.t.cleanup().catch(() => undefined);
    for (const ref of [made.refA, made.refB, made.refC]) {
      await removeTargetProject(ref).catch(() => undefined);
    }
  }
});

/** The columns of a customer project's registry row that a move must never change, and its audit trail. */
async function customerRowOf(projectId: string) {
  const [row] = await adminSql<Record<string, unknown>[]>`
    select owner, org_slug, mgmt_token_sealed, mgmt_token_expires_at::text as expires,
           credential_version, state, credential_source, api_url
      from platform.projects where id = ${projectId}::uuid`;
  const [events] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from platform.project_token_events where project_id = ${projectId}::uuid`;
  return { row, events: events?.n };
}

describe('the way back: customer project to platform project (CTK-05, D-566, T-09.4-44)', () => {
  it('CTK-05: moves a tenant off a customer project with no call on the customer token and the customer row untouched', async () => {
    const w = await wayBackCase('back', 'platform');
    const before = await customerRowOf(w.idA);
    expect(before.row?.owner).toBe('customer');
    expect(before.events).toBe(1);
    // Registering the project validated its token (that is a customer use); the move is judged from here on.
    const mark = w.ch.provider.calls.tokenUses.length;
    const usesSince = () => w.ch.provider.calls.tokenUses.slice(mark);

    const readToken = vt.vi.fn(async () => {
      throw new Error('the way back asks for no token');
    });
    const result = await runMove(
      { ...w.base, mode: 'start', toRef: w.refB },
      { ...w.ch.deps, target: { ...w.ch.deps.target, readToken } },
    );
    expect(result.outcome).toBe('moved');
    expect(readToken).not.toHaveBeenCalled();

    // The tenant now lives on a platform project, remembering the customer project it came from.
    const [binding] = await adminSql<{ project_id: string; previous_project_id: string | null }[]>`
      select project_id, previous_project_id from platform.tenant_projects
       where tenant_id = ${w.t.tenantId}::uuid`;
    const [target] = await adminSql<{ id: string; owner: string; state: string }[]>`
      select id, owner, state from platform.projects where ref = ${w.refB}`;
    expect(binding?.project_id).toBe(target?.id);
    expect(binding?.previous_project_id).toBe(w.idA);
    expect(target).toMatchObject({ owner: 'platform', state: 'ready' });

    // CTK-05: nothing at all reached the customer's project (no customer token, and never the platform's).
    const calls = usesSince();
    expect(calls.filter((use) => use.ref === w.refA)).toEqual([]);
    // The target was bootstrapped with the platform token.
    const onTarget = calls.filter((use) => use.ref === w.refB);
    expect(onTarget.length).toBeGreaterThan(0);
    expect(onTarget.every((use) => use.kind === 'platform')).toBe(true);

    // CTK-05: the customer project's registry row and audit trail are byte for byte what they were.
    expect(await customerRowOf(w.idA)).toEqual(before);

    // No token, organisation or ref of the customer's side in anything the move printed or recorded.
    const text = JSON.stringify([result.lines, await eventsOf(result.moveId ?? '')]);
    for (const secret of [w.tokenA, 'sbp_fc', 'acme-customer', w.refA]) {
      expect(text).not.toContain(secret);
    }

    // After the source is deleted (the only step that removes anything), the customer row is still untouched
    // and still no call went to the customer's account.
    const deleted = await runMove(
      { ...w.base, mode: 'confirm-delete', confirmSlug: w.t.slug },
      w.ch.deps,
    );
    expect(deleted.outcome).toBe('source_deleted');
    expect(await customerRowOf(w.idA)).toEqual(before);
    expect(usesSince().filter((use) => use.ref === w.refA)).toEqual([]);
  }, 240_000);

  it("CTK-05: customer to customer uses the target project's own token and never the source's", async () => {
    const w = await wayBackCase('c2c', 'per-project');
    const idC = await registerCustomerTarget(w.ch, w.refC, w.tokenC);
    const before = await customerRowOf(w.idA);
    const rowC = await customerRowOf(idC);
    const mark = w.ch.provider.calls.tokenUses.length;

    const result = await runMove(
      { ...w.base, mode: 'start', toRef: w.refC, owner: 'customer' },
      w.ch.deps,
    );
    // Token A reaches only project A: had it been used on C the bootstrap would have been refused.
    expect(result.outcome).toBe('moved');

    const uses = w.ch.provider.calls.tokenUses.slice(mark);
    expect(uses.filter((use) => use.ref === w.refA)).toEqual([]);
    const onC = uses.filter((use) => use.ref === w.refC);
    expect(onC.length).toBeGreaterThan(0);
    expect(onC.every((use) => use.kind === 'customer')).toBe(true);
    expect(await customerRowOf(w.idA)).toEqual(before);
    // The target's own row is prepared by the bootstrap (state, access); its owner, pin and sealed token stay.
    const afterC = await customerRowOf(idC);
    for (const column of ['owner', 'org_slug', 'mgmt_token_sealed', 'expires']) {
      expect(afterC.row?.[column]).toBe(rowC.row?.[column]);
    }
    const [binding] = await adminSql<{ project_id: string }[]>`
      select project_id from platform.tenant_projects where tenant_id = ${w.t.tenantId}::uuid`;
    expect(binding?.project_id).toBe(idC);
  }, 240_000);
});
