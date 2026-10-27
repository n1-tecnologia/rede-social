import { eq } from 'drizzle-orm';
import { projects, tenantProjects } from '../../../db/central';
import { withPlatformTx } from '../../../db/platform-tx';
import { tenants } from '../../../db/schema';
import { setTenantStatus } from '../../platform/tenants';
import { type ProjectRecord, resolveProjectById } from '../../tenancy/project-registry';
import { defaultStorage, type MoveContext, type MoveDeps, openContext } from './context';
import { copyAuth } from './copy-auth';
import { copyRows } from './copy-rows';
import { copyStorage } from './copy-storage';
import { completeCutover, flipPointer } from './cutover';
import { confirmDeleteSource } from './delete-source';
import { assertCoverage, planMove } from './plan';
import { DEFAULT_GAP_MS, DEFAULT_QUIESCE_MS, fingerprintOf, quiesce } from './quiesce';
import { requeueJobs } from './requeue';
import { recopyTarget, rollbackAfterFlip, rollbackBeforeFlip } from './rollback';
import {
  advance,
  claimLease,
  eventsOf,
  hasEvent,
  isOpen,
  latestMoveOf,
  type MoveRow,
  type MoveState,
  type MoveStore,
  openMoveOf,
  PRE_FLIP_STATES,
  platformStore,
  recordEvent,
  releaseLease,
  setMoveError,
} from './state';
import { assertTargetReady, bootstrapTarget, registerMoveTarget } from './target';
import { MoveError, type MovePlan, type VerifyReport } from './types';
import { verifyCopy } from './verify';

export { MoveError };

/**
 * `runMove` (09.2-23, D-535, D-536, DBT-34, DBT-48): the operator's tool, one function that the command, the
 * Cloud Run job and the tests all call. It never decides anything the state machine has not recorded: every
 * step is a transition of `platform.tenant_moves` (compare-and-set), every transition is followed by an
 * append-only event, and a crash at any point is continued by `--resume` from the recorded state.
 *
 * The modes: `start` (a new move), `dry-run` (writes NOTHING), `resume`, `status` (read only); `rollback`,
 * `recopy` and `confirm-delete` are added by `rollback.ts` and `delete-source.ts`.
 *
 * Reports are lists of JSON-able lines made of ids, states, counts, table names, hashes and codes: never a
 * row, an e-mail, a password hash, a key or a connection string (T-09.2-105).
 */

export type MoveMode =
  | 'start'
  | 'dry-run'
  | 'resume'
  | 'status'
  | 'rollback'
  | 'recopy'
  | 'confirm-delete';

export type MoveOptions = {
  mode: MoveMode;
  tenantSlug: string;
  /** The `ref` of the target project (`start`, `dry-run`). */
  toRef?: string | undefined;
  /** An operator label recorded on the move (`cli` by default). */
  actor: string;
  /** Wait before the quiescence samples. Production default 65,000 ms. */
  quiesceMs?: number | undefined;
  /** Wait after the pointer flip. Production default 20,000 ms. */
  registryWaitMs?: number | undefined;
  /** `rollback`: accept losing the rows written in the target since the cutover. */
  acceptLoss?: boolean | undefined;
  /** `confirm-delete`: the slug typed again. */
  confirmSlug?: string | undefined;
  /** `start` (09.4-12): whose project the target is; absent lets the registry say, `platform` is the old path. */
  owner?: 'platform' | 'customer' | undefined;
  /** `start` with `owner: 'customer'`: the typed expiry of the token the move registers. */
  tokenExpiresAt?: string | null | undefined;
};

export type MoveLine = Record<
  string,
  string | number | boolean | null | string[] | Record<string, unknown>
>;

export type MoveResult = {
  ok: true;
  mode: MoveMode;
  /** `moved`, `already_done`, `dry_run`, `status`, ... */
  outcome: string;
  moveId: string | null;
  state: MoveState | null;
  lines: MoveLine[];
};

export const DEFAULT_REGISTRY_WAIT_MS = 20_000;

const SLUG_SHAPE = /^[a-z0-9-]+$/;
const REF_SHAPE = /^[a-z][a-z0-9-]{2,39}$/;
const ACTOR_SHAPE = /^[A-Za-z0-9:_@.-]{1,64}$/;

// ---------------------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------------------

type TenantFacts = {
  id: string;
  slug: string;
  status: 'active' | 'suspended';
  sourceProject: ProjectRecord;
};

async function resolveTenant(slug: string): Promise<TenantFacts> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        status: tenants.status,
        projectId: tenantProjects.projectId,
      })
      .from(tenants)
      .leftJoin(tenantProjects, eq(tenantProjects.tenantId, tenants.id))
      .where(eq(tenants.slug, slug))
      .limit(1),
  );
  const row = rows[0];
  if (!row) throw new MoveError('tenant_not_found');
  if (!row.projectId) throw new MoveError('tenant_unbound');
  const sourceProject = await resolveProjectById(row.projectId);
  if (!sourceProject) throw new MoveError('tenant_unbound');
  return {
    id: row.id,
    slug: row.slug,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    sourceProject,
  };
}

async function projectByRef(ref: string): Promise<ProjectRecord | null> {
  const rows = await withPlatformTx((tx) =>
    tx.select({ id: projects.id }).from(projects).where(eq(projects.ref, ref)).limit(1),
  );
  return rows[0] ? resolveProjectById(rows[0].id) : null;
}

const tableCounts = (plan: MovePlan): Record<string, number> =>
  Object.fromEntries(plan.tables.map((t) => [t.name, t.rows]));

/** A code for any thrown value: the move's own, or `unknown` (a message may carry a statement or an address). */
export const codeOfError = (error: unknown): MoveError['code'] =>
  error instanceof MoveError ? error.code : 'unknown';

// ---------------------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------------------

function assertUsage(options: MoveOptions): void {
  if (!SLUG_SHAPE.test(options.tenantSlug)) throw new MoveError('usage', ['tenant']);
  if (!ACTOR_SHAPE.test(options.actor)) throw new MoveError('usage', ['actor']);
  const needsRef = options.mode === 'start' || options.mode === 'dry-run';
  if (needsRef && !options.toRef) throw new MoveError('usage', ['to']);
  if (options.toRef !== undefined && !REF_SHAPE.test(options.toRef)) {
    throw new MoveError('usage', ['to']);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------------------

type Runner = {
  options: MoveOptions;
  deps: MoveDeps;
  lines: MoveLine[];
  emit: (line: MoveLine) => void;
};

function newRunner(
  options: MoveOptions,
  deps: MoveDeps & { emit?: (line: MoveLine) => void },
): Runner {
  const lines: MoveLine[] = [];
  return {
    options,
    deps,
    lines,
    emit(line) {
      lines.push(line);
      deps.emit?.(line);
    },
  };
}

export async function runMove(
  options: MoveOptions,
  deps: MoveDeps & { emit?: (line: MoveLine) => void } = {},
): Promise<MoveResult> {
  assertUsage(options);
  const resolved: MoveDeps = {
    setStatus: async (tenantId, status, actor, moveId) =>
      setTenantStatus(tenantId, status, { userId: `move:${actor}` }, { moveId }),
    storage: defaultStorage,
    ...deps,
  };
  const runner = newRunner(options, resolved);
  runner.deps = resolved;

  switch (options.mode) {
    case 'dry-run':
      return dryRun(runner);
    case 'status':
      return statusOf(runner);
    case 'start':
    case 'resume':
      return startOrResume(runner);
    case 'recopy':
      return recopyMode(runner);
    case 'rollback':
      return rollbackMode(runner);
    case 'confirm-delete':
      return confirmDeleteMode(runner);
    default:
      throw new MoveError('usage', ['mode']);
  }
}

// ---------------------------------------------------------------------------------------------------------
// dry run (writes nothing)
// ---------------------------------------------------------------------------------------------------------

async function dryRun(runner: Runner): Promise<MoveResult> {
  const tenant = await resolveTenant(runner.options.tenantSlug);
  const target = runner.options.toRef ? await projectByRef(runner.options.toRef) : null;
  if (target && target.id === tenant.sourceProject.id) throw new MoveError('already_on_target');

  const { openDdlSql } = await import('../ddl');
  const open =
    runner.deps.openSql ?? ((project, o) => openDdlSql(project, { readOnly: o.readOnly }));
  const sourceSql = open(tenant.sourceProject, { readOnly: true });
  // A target that is registered and ready can be compared; one that does not exist yet cannot (targetChecked
  // false): the dry run never registers, bootstraps or connects to anything it would have to create.
  let targetSql: ReturnType<typeof open> | null = null;
  try {
    if (target && target.state === 'ready') {
      try {
        targetSql = open(target, { readOnly: true });
      } catch {
        targetSql = null;
      }
    }
    const plan = await planMove(
      { sql: sourceSql, tenantId: tenant.id, projectId: tenant.sourceProject.id },
      targetSql ? { sql: targetSql, tenantId: tenant.id, projectId: target?.id ?? '' } : undefined,
    );
    runner.emit({
      kind: 'plan',
      tenant: tenant.slug,
      targetChecked: plan.targetChecked,
      tables: Object.fromEntries(plan.tables.map((t) => [t.name, t.rows])),
      order: plan.order,
      accounts: plan.authUsers,
      storageObjects: plan.storageObjects,
      storageBytes: plan.storageBytes,
      uncovered: plan.uncovered,
      schemaMismatch: plan.schemaMismatch,
      danglingUsers: plan.danglingUsers,
    });
  } finally {
    await sourceSql.end({ timeout: 5 }).catch(() => undefined);
    if (targetSql) await targetSql.end({ timeout: 5 }).catch(() => undefined);
  }
  return {
    ok: true,
    mode: 'dry-run',
    outcome: 'dry_run',
    moveId: null,
    state: null,
    lines: runner.lines,
  };
}

// ---------------------------------------------------------------------------------------------------------
// status (read only)
// ---------------------------------------------------------------------------------------------------------

async function statusOf(runner: Runner): Promise<MoveResult> {
  const tenant = await resolveTenant(runner.options.tenantSlug);
  const move = await latestMoveOf(tenant.id);
  if (!move) {
    runner.emit({ kind: 'status', tenant: tenant.slug, move: false });
    return {
      ok: true,
      mode: 'status',
      outcome: 'status',
      moveId: null,
      state: null,
      lines: runner.lines,
    };
  }
  runner.emit({
    kind: 'status',
    tenant: tenant.slug,
    move: true,
    moveId: move.id,
    state: move.state,
    open: isOpen(move.state),
    errorCode: move.errorCode,
    cutoverAt: move.cutoverAt ? move.cutoverAt.toISOString() : null,
    sourceDeleted: move.sourceDeletedAt !== null,
  });
  for (const event of await eventsOf(move.id, runner.deps.store)) {
    runner.emit({
      kind: 'event',
      event: event.kind,
      at: event.at.toISOString(),
      detail: event.detail,
    });
  }
  return {
    ok: true,
    mode: 'status',
    outcome: 'status',
    moveId: move.id,
    state: move.state,
    lines: runner.lines,
  };
}

// ---------------------------------------------------------------------------------------------------------
// start / resume
// ---------------------------------------------------------------------------------------------------------

async function startOrResume(runner: Runner): Promise<MoveResult> {
  const { options, deps } = runner;
  const store = deps.store ?? platformStore;
  const tenant = await resolveTenant(options.tenantSlug);
  const target = options.toRef ? await projectByRef(options.toRef) : null;

  let move = await openMoveOf(tenant.id, store);
  if (options.mode === 'start') {
    if (move) throw new MoveError('move_in_progress');
    if (target && target.id === tenant.sourceProject.id) {
      // The tenant already lives there: a finished move to it is "already done", anything else an error.
      const last = await latestMoveOf(tenant.id);
      if (last && last.state === 'done' && last.toProjectId === target.id) {
        return alreadyDone(runner, last);
      }
      throw new MoveError('already_on_target');
    }
  } else {
    if (!move) {
      const last = await latestMoveOf(tenant.id);
      if (last && last.state === 'done') return alreadyDone(runner, last);
      throw new MoveError('usage', ['no_open_move']);
    }
  }

  const owner = (deps.newOwner ?? (() => crypto.randomUUID()))();

  if (!move) {
    if (!options.toRef) throw new MoveError('usage', ['to']);
    const registered = await registerMoveTarget(
      {
        tenantId: tenant.id,
        ref: options.toRef,
        actor: options.actor,
        statusBefore: tenant.status,
        fromProjectId: tenant.sourceProject.id,
        owner: options.owner,
        tokenExpiresAt: options.tokenExpiresAt,
      },
      deps.target,
    );
    move = registered.move;
    runner.emit({
      kind: 'move',
      moveId: move.id,
      state: move.state,
      registered: registered.registered,
    });
    await deps.afterState?.('planned', move);
  }

  await claimLease(move.id, owner, store);
  try {
    return await drive(runner, tenant, move, owner);
  } finally {
    await releaseLease(move.id, owner, store).catch(() => undefined);
  }
}

function alreadyDone(runner: Runner, move: MoveRow): MoveResult {
  runner.emit({ kind: 'already_done', moveId: move.id, state: move.state });
  return {
    ok: true,
    mode: runner.options.mode,
    outcome: 'already_done',
    moveId: move.id,
    state: move.state,
    lines: runner.lines,
  };
}

/** The state loop. Each pass handles the move's current state and ends in the next one (or in a thrown code). */
async function drive(
  runner: Runner,
  tenant: TenantFacts,
  initial: MoveRow,
  owner: string,
  flags: { recopy?: boolean } = {},
): Promise<MoveResult> {
  const { options, deps } = runner;
  const store = deps.store ?? platformStore;
  let move = initial;

  // The target must be `ready` before a connection to it is opened: its DDL URL is sealed by the bootstrap.
  if (move.state === 'planned') {
    try {
      await bootstrapTarget(move, deps.target);
    } catch (error) {
      await fail(move, 'bootstrap', error, store);
      throw error;
    }
  }
  const ctx = await contextOf(runner, tenant, move);

  try {
    if (flags.recopy) {
      move = await guarded(runner, ctx, 'recopy', () => recopyTarget(ctx));
      runner.emit({ kind: 'state', moveId: move.id, state: move.state, recopied: true });
    }
    for (;;) {
      await claimLease(move.id, owner, store);
      ctx.move = move;
      switch (move.state) {
        case 'planned':
          move = await stepPlanned(runner, ctx);
          break;
        case 'suspended':
          move = await stepCopy(runner, ctx);
          break;
        case 'copied':
          move = await stepVerify(runner, ctx);
          break;
        case 'verified':
          move = await stepFlip(runner, ctx);
          break;
        case 'cutover':
          move = await stepComplete(runner, ctx);
          break;
        case 'done':
          runner.emit({ kind: 'done', moveId: move.id, state: move.state });
          return {
            ok: true,
            mode: options.mode,
            outcome: 'moved',
            moveId: move.id,
            state: move.state,
            lines: runner.lines,
          };
        case 'rolled_back':
          throw new MoveError('move_conflict');
      }
    }
  } finally {
    await ctx.close();
  }
}

/** The move's own two projects (never the binding, which has moved after the flip) and the open sides. */
async function contextOf(runner: Runner, tenant: TenantFacts, move: MoveRow): Promise<MoveContext> {
  const [sourceProject, targetProject] = await Promise.all([
    resolveProjectById(move.fromProjectId),
    resolveProjectById(move.toProjectId),
  ]);
  if (!sourceProject) throw new MoveError('tenant_unbound');
  if (!targetProject) throw new MoveError('target_not_ready', ['unregistered']);
  return openContext({
    move,
    tenant: { id: tenant.id, slug: tenant.slug },
    sourceProject,
    targetProject,
    waits: {
      quiesceMs: runner.options.quiesceMs ?? DEFAULT_QUIESCE_MS,
      registryWaitMs: runner.options.registryWaitMs ?? DEFAULT_REGISTRY_WAIT_MS,
    },
    deps: runner.deps,
  });
}

/** Records the failure (a code, never text) and keeps the move where it was, so `--resume` can continue. */
async function fail(move: MoveRow, step: string, error: unknown, store: MoveStore): Promise<void> {
  const code = codeOfError(error);
  const tables = error instanceof MoveError ? error.tables : [];
  await setMoveError(move.id, code, store).catch(() => undefined);
  await recordEvent(move.id, 'failed', { step, code, tables: [...tables] }, store).catch(
    () => undefined,
  );
}

async function guarded<T>(
  runner: Runner,
  ctx: MoveContext,
  step: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await fail(ctx.move, step, error, runner.deps.store ?? platformStore);
    throw error;
  }
}

// planned -> suspended ------------------------------------------------------------------------------------

async function stepPlanned(runner: Runner, ctx: MoveContext): Promise<MoveRow> {
  const store = runner.deps.store ?? platformStore;
  const { move } = ctx;
  return guarded(runner, ctx, 'suspend', async () => {
    await assertTargetReady(move, { source: ctx.source.sql, target: ctx.target.sql });
    if (!(await hasEvent(move.id, 'target_ready', store))) {
      await recordEvent(move.id, 'target_ready', { toProjectId: move.toProjectId }, store);
    }
    // The member-facing screen is the existing branded "indisponivel" one (the tenant's status).
    const setStatus = runner.deps.setStatus;
    if (!setStatus) throw new MoveError('unknown');
    await setStatus(ctx.tenant.id, 'suspended', move.actor, move.id);
    const next = await advance(move.id, 'planned', 'suspended', { errorCode: null }, store);
    await recordEvent(move.id, 'suspended', { statusBefore: move.statusBefore }, store);
    runner.emit({ kind: 'state', moveId: move.id, state: next.state });
    await runner.deps.afterState?.('suspended', next);
    return next;
  });
}

// suspended -> copied -------------------------------------------------------------------------------------

async function stepCopy(runner: Runner, ctx: MoveContext): Promise<MoveRow> {
  const store = runner.deps.store ?? platformStore;
  const { move } = ctx;
  return guarded(runner, ctx, 'copy', async () => {
    const early = await planMove(ctx.source, ctx.target);
    assertCoverage(early);
    const calm = await quiesce({
      source: ctx.source,
      plan: early,
      waitMs: ctx.waits.quiesceMs,
      gapMs: ctx.waits.quiesceMs === 0 ? 0 : DEFAULT_GAP_MS,
      sleep: ctx.sleep,
    });
    await recordEvent(
      move.id,
      'quiesced',
      { tables: early.tables.length, jobsWaitedMs: calm.jobsWaitedMs },
      store,
    );

    // Planned again after the wait: the counts and the account set are the ones the copy will see.
    const plan = await planMove(ctx.source, ctx.target);
    assertCoverage(plan);

    const accounts = await copyAuth(ctx.source, ctx.target);
    const origins = originsOf(ctx);
    const rows = await copyRows(plan, ctx.source, ctx.target, {
      ...(origins ? { origins } : {}),
      ...(runner.deps.batchSize ? { batchSize: runner.deps.batchSize } : {}),
    });
    const files = await copyStorage({
      source: storageOf(ctx, ctx.sourceProject),
      target: storageOf(ctx, ctx.targetProject),
      tenantId: ctx.tenant.id,
    });
    const bosses = await ctx.bosses();
    const jobs = await requeueJobs(
      { source: { sql: ctx.source.sql, boss: bosses.source }, target: { boss: bosses.target } },
      ctx.tenant.id,
    );

    const counts = {
      copy: {
        tables: tableCounts(plan),
        accounts: accounts.accounts,
        files: files.copied + files.skipped,
        bytes: files.bytes,
        requeued: jobs.requeued,
        rows: rows.tables.reduce((n, t) => n + t.read, 0),
      },
      quiesceDigest: calm.fingerprint.digest,
    };
    const next = await advance(move.id, 'suspended', 'copied', { counts, errorCode: null }, store);
    await recordEvent(
      move.id,
      'copied',
      {
        tables: plan.tables.length,
        rows: counts.copy.rows,
        accounts: accounts.accounts,
        files: counts.copy.files,
        requeued: jobs.requeued,
      },
      store,
    );
    runner.emit({ kind: 'state', moveId: move.id, state: next.state, rows: counts.copy.rows });
    await runner.deps.afterState?.('copied', next);
    return next;
  });
}

const storageOf = (ctx: MoveContext, project: ProjectRecord) =>
  (ctx.deps.storage ?? defaultStorage)(project);

function originsOf(ctx: MoveContext): { from: string; to: string } | undefined {
  const from = ctx.sourceProject.apiUrl;
  const to = ctx.targetProject.apiUrl;
  return from && to && from !== to ? { from, to } : undefined;
}

// copied -> verified --------------------------------------------------------------------------------------

async function stepVerify(runner: Runner, ctx: MoveContext): Promise<MoveRow> {
  const store = runner.deps.store ?? platformStore;
  const { move } = ctx;
  return guarded(runner, ctx, 'verify', async () => {
    const plan = await planMove(ctx.source, ctx.target);
    assertCoverage(plan);
    const origins = originsOf(ctx);
    let report: VerifyReport;
    try {
      report = await verifyCopy(plan, ctx.source, ctx.target, {
        ...(origins ? { oldOrigin: origins.from, newOrigin: origins.to } : {}),
        storage: {
          source: storageOf(ctx, ctx.sourceProject),
          target: storageOf(ctx, ctx.targetProject),
        },
      });
    } catch (error) {
      if (error instanceof MoveError) {
        await recordEvent(
          move.id,
          'verify_failed',
          { code: error.code, tables: [...error.tables] },
          store,
        );
      }
      throw error;
    }

    // Nothing may have changed in the source since the quiescence samples.
    const now = await fingerprintOf(ctx.source, plan);
    const calm = (move.counts as { quiesceDigest?: string }).quiesceDigest;
    if (calm !== undefined && calm !== now.digest) throw new MoveError('source_changed');

    const next = await advance(
      move.id,
      'copied',
      'verified',
      {
        fingerprint: now.digest,
        counts: {
          verified: { tables: Object.fromEntries(report.tables.map((t) => [t.name, t.target])) },
        },
        errorCode: null,
      },
      store,
    );
    await recordEvent(
      move.id,
      'verified',
      { tables: report.tables.length, passwords: report.accounts.passwords },
      store,
    );
    runner.emit({ kind: 'state', moveId: move.id, state: next.state });
    await runner.deps.afterState?.('verified', next);
    return next;
  });
}

// verified -> cutover -> done -----------------------------------------------------------------------------

async function stepFlip(runner: Runner, ctx: MoveContext): Promise<MoveRow> {
  return guarded(runner, ctx, 'cutover', async () => {
    const plan = await planMove(ctx.source, ctx.target);
    const next = await flipPointer(ctx, plan);
    runner.emit({ kind: 'state', moveId: next.id, state: next.state });
    return next;
  });
}

async function stepComplete(runner: Runner, ctx: MoveContext): Promise<MoveRow> {
  return guarded(runner, ctx, 'cutover', async () => {
    const next = await completeCutover(ctx);
    runner.emit({ kind: 'state', moveId: next.id, state: next.state });
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------------
// recopy, rollback, confirm-delete
// ---------------------------------------------------------------------------------------------------------

/** The move a mode acts on: the open one, else the most recent. */
async function moveForMode(runner: Runner, tenantId: string): Promise<MoveRow> {
  const store = runner.deps.store ?? platformStore;
  const move = (await openMoveOf(tenantId, store)) ?? (await latestMoveOf(tenantId));
  if (!move) throw new MoveError('usage', ['no_move']);
  return move;
}

/** `--recopy`: wipe the target's rows of the tenant and restart the copy from `suspended`. */
async function recopyMode(runner: Runner): Promise<MoveResult> {
  const { deps } = runner;
  const store = deps.store ?? platformStore;
  const tenant = await resolveTenant(runner.options.tenantSlug);
  const move = await openMoveOf(tenant.id, store);
  if (!move) throw new MoveError('not_done');
  if (move.state !== 'suspended' && move.state !== 'copied') throw new MoveError('not_done');
  const owner = (deps.newOwner ?? (() => crypto.randomUUID()))();
  await claimLease(move.id, owner, store);
  try {
    return await drive(runner, tenant, move, owner, { recopy: true });
  } finally {
    await releaseLease(move.id, owner, store).catch(() => undefined);
  }
}

/** `--rollback`: valid from every state before `done`, and after it until the source is deleted. */
async function rollbackMode(runner: Runner): Promise<MoveResult> {
  const { options, deps } = runner;
  const store = deps.store ?? platformStore;
  const tenant = await resolveTenant(options.tenantSlug);
  const move = await moveForMode(runner, tenant.id);
  const report = (outcome: string, state: MoveState, extra: MoveLine = {}): MoveResult => {
    runner.emit({ kind: 'rollback', moveId: move.id, outcome, state, ...extra });
    return {
      ok: true,
      mode: 'rollback',
      outcome,
      moveId: move.id,
      state,
      lines: runner.lines,
    };
  };

  if (move.state === 'rolled_back') return report('already_rolled_back', 'rolled_back');
  if (move.sourceDeletedAt) throw new MoveError('source_deleted');

  const owner = (deps.newOwner ?? (() => crypto.randomUUID()))();
  await claimLease(move.id, owner, store);
  try {
    if (PRE_FLIP_STATES.includes(move.state)) {
      const done = await rollbackBeforeFlip(move, deps);
      return report(done.outcome, 'rolled_back', { flipped: false });
    }
    const ctx = await contextOf(runner, tenant, move);
    try {
      const done = await rollbackAfterFlip(ctx, { acceptLoss: options.acceptLoss === true });
      return report(done.outcome, 'rolled_back', { flipped: true, lost: done.lost });
    } finally {
      await ctx.close();
    }
  } finally {
    await releaseLease(move.id, owner, store).catch(() => undefined);
  }
}

/** `--confirm-delete --confirm-slug <slug>`: the only path that removes anything from the source. */
async function confirmDeleteMode(runner: Runner): Promise<MoveResult> {
  const { options, deps } = runner;
  const store = deps.store ?? platformStore;
  // The typed slug is checked before anything is opened or read about the move.
  if (options.confirmSlug === undefined || options.confirmSlug !== options.tenantSlug) {
    throw new MoveError('confirm_mismatch');
  }
  const tenant = await resolveTenant(options.tenantSlug);
  const move = await moveForMode(runner, tenant.id);
  if (move.sourceDeletedAt) throw new MoveError('source_deleted');
  if (move.state !== 'done') throw new MoveError('not_done');

  const owner = (deps.newOwner ?? (() => crypto.randomUUID()))();
  await claimLease(move.id, owner, store);
  try {
    const ctx = await contextOf(runner, tenant, move);
    try {
      const deleted = await confirmDeleteSource(ctx, {
        confirmSlug: options.confirmSlug,
        onPlan: (plan) => runner.emit({ kind: 'delete_plan', ...plan }),
      });
      runner.emit({
        kind: 'source_deleted',
        moveId: move.id,
        rows: deleted.rows,
        files: deleted.files,
        accounts: deleted.accounts,
      });
      return {
        ok: true,
        mode: 'confirm-delete',
        outcome: 'source_deleted',
        moveId: move.id,
        state: move.state,
        lines: runner.lines,
      };
    } finally {
      await ctx.close();
    }
  } finally {
    await releaseLease(move.id, owner, store).catch(() => undefined);
  }
}
