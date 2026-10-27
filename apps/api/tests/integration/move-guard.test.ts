import { sqlClient } from '@rede-social/core/db';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { createQueues, stopBoss } from '@rede-social/core/server/jobs/boss';
import { setTenantStatus } from '@rede-social/core/server/platform/tenants';
import {
  claimLease,
  defaultBossFor,
  eventsOf,
  latestMoveOf,
  type MoveDeps,
  MoveError,
  type MoveOptions,
  releaseLease,
  runMove,
} from '@rede-social/core/server/projects/move/index';
import { isTenantMoving } from '@rede-social/core/server/projects/moving';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { reconcileTenantMirror } from '@rede-social/core/server/tenancy/mirror';
import {
  closeAllPools,
  invalidateProject,
  resolveProjectById,
} from '@rede-social/core/server/tenancy/project-registry';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMoveCli } from '../../src/move';
import {
  closeHelperClients,
  connect,
  createMoveTenant,
  customerHarness,
  footprint,
  type Harness,
  harness,
  type MoveTenant,
  removeTargetProject,
  resetB,
  SRC_URL,
  TGT_URL,
} from './move-helpers';
import { adminSql, api, signInAs } from './setup';

/**
 * Phase 09.2-23 (DBT-34, DBT-48, D-535, D-536, T-09.2-101, T-09.2-102, T-09.2-105): the guards and the
 * concurrency, idempotency and audit matrix of the move tool, on two real local databases.
 *
 *  - nothing can edit or reactivate a tenant halfway through its move (every platform mutation answers 409
 *    TENANT_MOVING; `setTenantStatus` needs the move's own id; the mirror reconcile skips the tenant);
 *  - P95: two starts at once leave one move and one winner; a reactivation fired during the registry wait is
 *    refused; two resumers are separated by the lease;
 *  - P96: a crash after each state boundary, resumed, reaches `done` exactly once;
 *  - a dry run and `--status` write nothing; a failed run is audited; no report holds a secret.
 */

const RUN = Date.now().toString(36);
let counter = 0;
const ACTOR = 'cli:guard';
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const QUEUE = 'kernel.branding-derive-icons';

let h: Harness;
let t: MoveTenant;
let other: MoveTenant | null = null;
let adminToken = '';
/** Everything the cases printed or recorded, scanned for secrets by the last case. */
const seen: unknown[] = [];

const slug = () => {
  counter += 1;
  return `mvgd-${RUN}-${counter}`.slice(0, 40);
};

const opts = (mode: MoveOptions['mode'], more: Partial<MoveOptions> = {}): MoveOptions => ({
  mode,
  tenantSlug: t.slug,
  toRef: h.ref,
  actor: ACTOR,
  quiesceMs: 0,
  registryWaitMs: 0,
  ...more,
});

const crashAfter = (state: string): MoveDeps => ({
  ...h.deps,
  afterState: async (reached) => {
    if (reached === state) throw new Error('simulated crash');
  },
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof MoveError ? error.code : `other:${String(error)}`;
  }
}

async function platformReq(method: string, path: string, body?: unknown, token = adminToken) {
  return api.request(`/v1/platform${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

async function centralId(): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`select id from platform.projects where is_central`;
  return row?.id ?? '';
}

async function seedSourceJob(tenantId: string): Promise<void> {
  const central = await resolveProjectById(await centralId());
  if (!central) throw new Error('no central project');
  const boss = await defaultBossFor(central);
  try {
    await createQueues(boss, [QUEUE]);
    await boss.send(QUEUE, { tenantId }, { startAfter: 3600, singletonKey: `guard-${tenantId}` });
  } finally {
    await boss.stop({ graceful: false });
  }
}

async function moveCounts() {
  const one = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? -1;
  return {
    moves: await one(
      adminSql<{ n: number }[]>`select count(*)::int as n from platform.tenant_moves`,
    ),
    events: await one(
      adminSql<{ n: number }[]>`select count(*)::int as n from platform.tenant_move_events`,
    ),
    projects: await one(
      adminSql<{ n: number }[]>`select count(*)::int as n from platform.projects`,
    ),
    bindings: await one(
      adminSql<{ n: number }[]>`select count(*)::int as n from platform.tenant_projects`,
    ),
  };
}

async function tenantStatus(id: string): Promise<string | undefined> {
  const [row] = await adminSql<
    { status: string }[]
  >`select status from public.tenants where id = ${id}::uuid`;
  return row?.status;
}

beforeEach(async () => {
  resetB('bare');
  h = harness();
  t = await createMoveTenant(slug());
  if (!adminToken) adminToken = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

afterEach(async () => {
  if (other) {
    await other.cleanup();
    other = null;
  }
  await t?.cleanup();
  await removeTargetProject(h?.ref ?? 'none').catch(() => undefined);
  await closeAllPools();
});

afterAll(async () => {
  await stopBoss();
  await closeAllPools();
  await closeHelperClients();
  await adminSql.end();
  await sqlClient.end();
  resetB('migrated');
});

describe('the guard (T-09.2-101)', () => {
  it('guard refuses while moving, and lets the same calls through for another tenant and after the move', async () => {
    other = await createMoveTenant(slug());
    expect(await codeOf(runMove(opts('start'), crashAfter('suspended')))).toBe(
      'other:Error: simulated crash',
    );
    expect(await isTenantMoving(t.tenantId)).toBe(true);
    const before = await moveCounts();

    const calls: [string, string, unknown][] = [
      ['POST', `/tenants/${t.tenantId}/status`, { status: 'active' }],
      ['PATCH', `/tenants/${t.tenantId}`, { displayName: 'Outro nome' }],
      ['PUT', `/tenants/${t.tenantId}/modules/feed`, { enabled: false }],
      ['POST', `/tenants/${t.tenantId}/invites/${crypto.randomUUID()}/resend`, undefined],
      ['POST', `/tenants/${t.tenantId}/database/bootstrap/resume`, undefined],
      ['POST', `/tenants/${t.tenantId}/domains`, { host: 'novo.localhost' }],
    ];
    for (const [method, path, body] of calls) {
      const res = await platformReq(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(await errorCode(res), `${method} ${path}`).toBe('TENANT_MOVING');
    }
    // Nothing changed, and the reads still answer.
    expect(await tenantStatus(t.tenantId)).toBe('suspended');
    const [name] = await adminSql<{ display_name: string }[]>`
      select display_name from public.tenants where id = ${t.tenantId}::uuid`;
    expect(name?.display_name).toBe('Movel');
    expect((await platformReq('GET', `/tenants/${t.tenantId}`)).status).toBe(200);
    expect((await platformReq('GET', `/tenants/${t.tenantId}/database`)).status).toBe(200);
    expect(await moveCounts()).toEqual(before);

    // The same calls succeed for a tenant that is not moving.
    const otherId = other.tenantId;
    expect(
      (await platformReq('POST', `/tenants/${otherId}/status`, { status: 'suspended' })).status,
    ).toBe(200);
    expect(
      (await platformReq('POST', `/tenants/${otherId}/status`, { status: 'active' })).status,
    ).toBe(200);
    expect(
      (await platformReq('PATCH', `/tenants/${otherId}`, { displayName: 'Outro' })).status,
    ).toBe(200);

    // After the move the status call goes through.
    const done = await runMove(opts('resume'), h.deps);
    expect(done.state).toBe('done');
    expect(await isTenantMoving(t.tenantId)).toBe(false);
    expect(
      (await platformReq('POST', `/tenants/${t.tenantId}/status`, { status: 'suspended' })).status,
    ).toBe(200);
    expect(
      (await platformReq('POST', `/tenants/${t.tenantId}/status`, { status: 'active' })).status,
    ).toBe(200);
  });

  it('setTenantStatus needs the move id', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('planned')))).toBe(
      'other:Error: simulated crash',
    );
    const move = await latestMoveOf(t.tenantId);
    expect(move?.state).toBe('planned');
    const actor = { userId: 'move:test' };

    const refused = await setTenantStatus(t.tenantId, 'suspended', actor).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).code).toBe('TENANT_MOVING');
    const wrong = await setTenantStatus(t.tenantId, 'suspended', actor, {
      moveId: crypto.randomUUID(),
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((wrong as ApiError).code).toBe('TENANT_MOVING');
    expect(await tenantStatus(t.tenantId)).toBe('active');

    await setTenantStatus(t.tenantId, 'suspended', actor, { moveId: move?.id ?? '' });
    expect(await tenantStatus(t.tenantId)).toBe('suspended');
    await setTenantStatus(t.tenantId, 'active', actor, { moveId: move?.id ?? '' });
  });

  it('mirror reconcile skips a moving tenant', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('planned')))).toBe(
      'other:Error: simulated crash',
    );
    const held = await reconcileTenantMirror(t.tenantId);
    expect(held.skipped).toBe('moving');
    expect(held.healed).toEqual([]);

    const done = await runMove(opts('resume'), h.deps);
    expect(done.state).toBe('done');
    const after = await reconcileTenantMirror(t.tenantId);
    expect(after.skipped).not.toBe('moving');
  });
});

describe('concurrency (P95)', () => {
  it('two starts at once leave one open move and one winner; the loser writes nothing', async () => {
    const results = await Promise.allSettled([
      runMove(opts('start'), crashAfter('planned')),
      runMove(opts('start'), crashAfter('planned')),
    ]);
    const codes = results.map((r) =>
      r.status === 'rejected'
        ? r.reason instanceof MoveError
          ? r.reason.code
          : `other:${String(r.reason)}`
        : 'resolved',
    );
    expect(codes.sort()).toEqual(['move_in_progress', 'other:Error: simulated crash']);

    const [moves] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.tenant_moves where tenant_id = ${t.tenantId}::uuid`;
    expect(moves?.n).toBe(1);
    const move = await latestMoveOf(t.tenantId);
    const kinds = (await eventsOf(move?.id ?? '')).map((e) => e.kind);
    expect(kinds).toEqual(['started']);
    const [projects] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where ref = ${h.ref}`;
    expect(projects?.n).toBe(1);
  });

  it('a status request fired during the registry wait is refused until the move is done', async () => {
    let during = 0;
    let duringCode = '';
    const marker = 777;
    const deps: MoveDeps = {
      ...h.deps,
      sleep: async (ms) => {
        if (ms !== marker) return;
        const res = await platformReq('POST', `/tenants/${t.tenantId}/status`, {
          status: 'active',
        });
        during = res.status;
        duringCode = await errorCode(res);
      },
    };
    const result = await runMove(opts('start', { registryWaitMs: marker }), deps);
    expect(result.state).toBe('done');
    expect(during).toBe(409);
    expect(duringCode).toBe('TENANT_MOVING');
    const after = await platformReq('POST', `/tenants/${t.tenantId}/status`, { status: 'active' });
    expect(after.status).toBe(200);
  });

  it('two resumers are separated by the lease: the second gets lease_held and changes nothing', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('suspended')))).toBe(
      'other:Error: simulated crash',
    );
    const move = await latestMoveOf(t.tenantId);
    if (!move) throw new Error('no move');
    await claimLease(move.id, crypto.randomUUID());
    const before = { state: (await latestMoveOf(t.tenantId))?.state, ...(await moveCounts()) };

    expect(await codeOf(runMove(opts('resume'), h.deps))).toBe('lease_held');
    expect({ state: (await latestMoveOf(t.tenantId))?.state, ...(await moveCounts()) }).toEqual(
      before,
    );

    // The holder lets go: the resume now runs to the end.
    const held = await latestMoveOf(t.tenantId);
    await releaseLease(move.id, held?.leaseOwner ?? '');
    const done = await runMove(opts('resume'), h.deps);
    expect(done.state).toBe('done');
  });
});

describe('idempotency (P96): a crash after each boundary, resumed, reaches done exactly once', () => {
  for (const boundary of ['planned', 'suspended', 'copied', 'verified', 'cutover'] as const) {
    it(`after ${boundary}`, async () => {
      await seedSourceJob(t.tenantId);
      const source = connect(SRC_URL);
      const before = await footprint(source, t.tenantId);

      expect(await codeOf(runMove(opts('start'), crashAfter(boundary)))).toBe(
        'other:Error: simulated crash',
      );
      const crashed = await latestMoveOf(t.tenantId);
      expect(crashed?.state).toBe(boundary);

      const done = await runMove(opts('resume'), h.deps);
      expect(done.state).toBe('done');
      seen.push(done.lines);

      const kinds = (await eventsOf(done.moveId ?? '')).map((e) => e.kind);
      expect(kinds.filter((k) => k === 'reactivated')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'cutover')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'done')).toHaveLength(1);

      const central = await centralId();
      const [row] = await adminSql<{ project_id: string; previous_project_id: string | null }[]>`
        select project_id, previous_project_id from platform.tenant_projects
         where tenant_id = ${t.tenantId}::uuid`;
      expect(row?.previous_project_id).toBe(central);
      expect(row?.project_id).not.toBe(central);

      // Same rows on both sides, the source untouched, the status back to what it was.
      const target = connect(TGT_URL);
      expect(await footprint(target, t.tenantId)).toEqual(before);
      expect(await footprint(source, t.tenantId)).toEqual(before);
      expect(await tenantStatus(t.tenantId)).toBe('active');

      // The waiting job lives in the target once, and in the source not at all.
      const [inTarget] = await target<{ n: number }[]>`
        select count(*)::int as n from pgboss.job
         where name = ${QUEUE} and data ->> 'tenantId' = ${t.tenantId} and state = 'created'`;
      const [inSource] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from pgboss.job
         where name = ${QUEUE} and data ->> 'tenantId' = ${t.tenantId} and state = 'created'`;
      expect(inTarget?.n).toBe(1);
      expect(inSource?.n).toBe(0);
    });
  }

  it('running a finished move again answers already_done and writes nothing; --status is read only', async () => {
    const done = await runMove(opts('start'), h.deps);
    expect(done.state).toBe('done');
    const before = await moveCounts();
    const again = await runMove(opts('start'), h.deps);
    expect(again.outcome).toBe('already_done');
    const resumed = await runMove(opts('resume'), h.deps);
    expect(resumed.outcome).toBe('already_done');
    const status = await runMove(opts('status'), h.deps);
    expect(status.outcome).toBe('status');
    expect(await runMove(opts('status'), h.deps).then((r) => r.lines)).toEqual(status.lines);
    expect(await moveCounts()).toEqual(before);
    seen.push(status.lines);
  });
});

describe('refusals before anything is written', () => {
  it('a plain start with an open move is move_in_progress and writes nothing', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('planned')))).toBe(
      'other:Error: simulated crash',
    );
    const before = await moveCounts();
    expect(await codeOf(runMove(opts('start'), h.deps))).toBe('move_in_progress');
    expect(await moveCounts()).toEqual(before);
  });

  it('resume without an open move, an unknown tenant and a malformed slug are refused by code', async () => {
    const before = await moveCounts();
    expect(await codeOf(runMove(opts('resume'), h.deps))).toBe('usage');
    expect(
      await codeOf(runMove(opts('start', { tenantSlug: 'no-such-tenant-here' }), h.deps)),
    ).toBe('tenant_not_found');
    expect(await codeOf(runMove(opts('start', { tenantSlug: 'Bad Slug!' }), h.deps))).toBe('usage');
    expect(await codeOf(runMove(opts('start', { toRef: 'Bad Ref' }), h.deps))).toBe('usage');
    expect(await codeOf(runMove(opts('start', { actor: 'igor vboas' }), h.deps))).toBe('usage');
    expect(await moveCounts()).toEqual(before);
  });
});

describe('dry run and audit', () => {
  it('a dry run writes nothing: no row, no registration, no suspension, no write in the target', async () => {
    // A target that exists and is ready (another tenant went there), and one that does not exist yet.
    other = await createMoveTenant(slug());
    const first = await runMove({ ...opts('start'), tenantSlug: other.slug }, h.deps);
    expect(first.state).toBe('done');

    const target = connect(TGT_URL);
    const writes = async () => {
      await target`select pg_stat_force_next_flush()`;
      const [row] = await target<{ n: string }[]>`
        select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::text as n
          from pg_stat_user_tables`;
      return row?.n;
    };
    const before = {
      ...(await moveCounts()),
      status: await tenantStatus(t.tenantId),
      writes: await writes(),
    };

    for (const ref of [h.ref, `mv-nothere-${RUN}`.slice(0, 30)]) {
      const planned = await runMove(opts('dry-run', { toRef: ref }), h.deps);
      expect(planned.outcome).toBe('dry_run');
      expect(planned.moveId).toBeNull();
      const line = planned.lines[0];
      expect(line?.kind).toBe('plan');
      expect(line?.targetChecked).toBe(ref === h.ref);
      expect(line?.uncovered).toEqual([]);
      seen.push(planned.lines);
    }
    const after = {
      ...(await moveCounts()),
      status: await tenantStatus(t.tenantId),
      writes: await writes(),
    };
    expect(after).toEqual(before);
  });

  it('audit on failure: a corrupted copy stops the move, is recorded, and the tenant stays suspended', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('copied')))).toBe(
      'other:Error: simulated crash',
    );
    const target = connect(TGT_URL);
    await target`update public.communities set name = 'Corrompida' where tenant_id = ${t.tenantId}::uuid`;

    expect(await codeOf(runMove(opts('resume'), h.deps))).toBe('verify_failed');
    const move = await latestMoveOf(t.tenantId);
    expect(move?.state).toBe('copied');
    expect(move?.errorCode).toBe('verify_failed');
    expect(await tenantStatus(t.tenantId)).toBe('suspended');
    expect(await isTenantMoving(t.tenantId)).toBe(true);

    const events = await eventsOf(move?.id ?? '');
    const kinds = events.map((e) => e.kind);
    expect(kinds.slice(0, 5)).toEqual([
      'started',
      'target_ready',
      'suspended',
      'quiesced',
      'copied',
    ]);
    expect(kinds).toContain('verify_failed');
    expect(kinds.at(-1)).toBe('failed');
    const failure = events.find((e) => e.kind === 'verify_failed');
    expect(JSON.stringify(failure?.detail)).toContain('communities');
    seen.push(events);
  });
});

describe('the command', () => {
  const run = async (args: string[]) => {
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line) => void out.push(String(line)));
    const err = vi
      .spyOn(console, 'error')
      .mockImplementation((line) => void out.push(String(line)));
    try {
      const code = await runMoveCli(args);
      return { code, out };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  it('cli: exit 0 on success, 1 on a MoveError, 2 on usage', async () => {
    const ok = await run(['--tenant', t.slug, '--status']);
    expect(ok.code).toBe(0);
    const unknown = await run(['--tenant', 'no-such-tenant-here', '--status']);
    expect(unknown.code).toBe(1);
    expect(unknown.out.join('')).toContain('tenant_not_found');
    const twoModes = await run(['--tenant', t.slug, '--status', '--rollback']);
    expect(twoModes.code).toBe(2);
    const badSlug = await run(['--tenant', 'Bad Slug!', '--status']);
    expect(badSlug.code).toBe(2);
    const noTarget = await run(['--tenant', t.slug]);
    expect(noTarget.code).toBe(2);
    const noSlug = await run(['--tenant', t.slug, '--confirm-delete']);
    expect(noSlug.code).toBe(2);
    const stray = await run(['--tenant', t.slug, '--accept-loss', '--status']);
    expect(stray.code).toBe(2);
    const unknownFlag = await run(['--tenant', t.slug, '--nope']);
    expect(unknownFlag.code).toBe(2);
    const noMove = await run(['--tenant', t.slug, '--rollback']);
    expect(noMove.code).toBe(2);
    seen.push(ok.out, unknown.out);
  });

  it('cli --dry-run runs on the real defaults and writes nothing', async () => {
    const before = await moveCounts();
    const planned = await run([
      '--tenant',
      t.slug,
      '--to',
      `mv-cli-${RUN}`.slice(0, 30),
      '--dry-run',
    ]);
    expect(planned.code).toBe(0);
    expect(planned.out).toHaveLength(1);
    const line = JSON.parse(planned.out[0] ?? '{}') as Record<string, unknown>;
    expect(line.kind).toBe('plan');
    expect(line.targetChecked).toBe(false);
    expect(line.accounts).toBe(1);
    expect(await moveCounts()).toEqual(before);
    seen.push(planned.out);
  });
});

describe('reports (T-09.2-105)', () => {
  it('reports are clean: no e-mail, no password hash, no token, no connection string', async () => {
    expect(seen.length).toBeGreaterThan(0);
    const text = JSON.stringify(seen);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\$2[aby]\$/);
    expect(text).not.toContain('eyJ');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('sb_secret_');
    invalidateProject();
    invalidateTenantHost(t.host);
  });
});

describe('the command, customer target (09.4-12, CTK-02, D-567, T-09.4-43)', () => {
  const TOKEN = `sbp_fc_fake_guard12_${RUN}`;
  const LABEL_SEEN: string[] = [];

  afterEach(() => {
    setProjectProviderForTests(undefined);
  });

  const runWith = async (args: string[], readSecret?: (label: string) => Promise<string>) => {
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line) => void out.push(String(line)));
    const err = vi
      .spyOn(console, 'error')
      .mockImplementation((line) => void out.push(String(line)));
    try {
      const code = await runMoveCli(args, readSecret ? { readSecret } : {});
      return { code, out };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  const projectsOf = async (ref: string) =>
    (
      await adminSql<{ n: number }[]>`
        select count(*)::int as n from platform.projects where ref = ${ref}`
    )[0]?.n;

  it('rejects a malformed --owner or --expires and an owner outside a start as a usage error', async () => {
    const ref = `mvg-${RUN}`.slice(0, 30);
    const base = ['--tenant', t.slug, '--to', ref];
    expect((await runWith([...base, '--owner', 'other'])).code).toBe(2);
    expect((await runWith([...base, '--expires', '2999-12-31'])).code).toBe(2);
    expect((await runWith([...base, '--owner', 'platform', '--expires', '2999-12-31'])).code).toBe(
      2,
    );
    expect((await runWith([...base, '--owner', 'customer', '--expires', '31/12/2999'])).code).toBe(
      2,
    );
    expect((await runWith(['--tenant', t.slug, '--resume', '--owner', 'customer'])).code).toBe(2);
    expect((await runWith(['--tenant', t.slug, '--status', '--owner', 'customer'])).code).toBe(2);
    expect((await runWith([...base, '--token', 'x'])).code).toBe(2);
    expect(await projectsOf(ref)).toBe(0);
  });

  it('with no hidden prompt (the Job) an unknown customer target fails closed with register_first', async () => {
    const ref = `mvg-${RUN}`.slice(0, 30);
    const before = await moveCounts();
    const result = await runWith(['--tenant', t.slug, '--to', ref, '--owner', 'customer']);
    expect(result.code).toBe(1);
    const text = result.out.join('\n');
    expect(text).toContain('register_first');
    expect(text).toContain('platform:set-owner --register');
    expect(await moveCounts()).toEqual(before);
    expect(await projectsOf(ref)).toBe(0);
    seen.push(result.out);
  });

  it('with the local prompt the token is asked for once, only for an unknown target, and never printed', async () => {
    const ref = `mvg-${RUN}`.slice(0, 30);
    const ch = customerHarness({
      refs: [ref],
      tokens: { [TOKEN]: { refs: [ref] } },
      bootstrap: 'per-project',
    });
    setProjectProviderForTests(ch.provider);
    const before = await moveCounts();

    // A token the account does not know: refused as a closed code, nothing written.
    const readSecret = vi.fn(async (label: string) => {
      LABEL_SEEN.push(label);
      return `${TOKEN}_unknown`;
    });
    const refused = await runWith(
      ['--tenant', t.slug, '--to', ref, '--owner', 'customer'],
      readSecret,
    );
    expect(refused.code).toBe(1);
    expect(readSecret).toHaveBeenCalledTimes(1);
    const text = refused.out.join('\n');
    expect(text).toContain('token_invalid');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('sbp_fc');
    expect(LABEL_SEEN.join('')).not.toContain(TOKEN);
    expect(await moveCounts()).toEqual(before);
    expect(await projectsOf(ref)).toBe(0);

    // A dry run never asks.
    readSecret.mockClear();
    const planned = await runWith(
      ['--tenant', t.slug, '--to', ref, '--owner', 'customer', '--dry-run'],
      readSecret,
    );
    expect(planned.code).toBe(0);
    expect(readSecret).not.toHaveBeenCalled();
    expect(await moveCounts()).toEqual(before);
    seen.push(refused.out, planned.out);
  });
});
