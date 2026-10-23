import { eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../../db/admin-tx';
import { tenantProjects } from '../../../db/central';
import { withPlatformTx } from '../../../db/platform-tx';
import { tenants } from '../../../db/schema';
import type { MoveContext, MoveDeps } from './context';
import { currentStatus, dropCaches } from './cutover';
import { assertCoverage, planMove } from './plan';
import { requeueJobs } from './requeue';
import { rewriteStorageOrigins } from './rewrite';
import {
  advance,
  type MoveRow,
  PRE_FLIP_STATES,
  platformStore,
  recordEvent,
  setMoveError,
} from './state';
import { MoveError, type MovePlan, type MoveSide, publicTable, run } from './types';

/**
 * Rollback and recopy (09.2-23, D-534, D-535, D-536, T-09.2-107).
 *
 *  - BEFORE the pointer flipped (`planned` .. `verified`) a rollback restores the tenant's previous status and
 *    ends the move `rolled_back`; the target is left exactly as it is, and nothing is opened on it.
 *  - AFTER the flip (`cutover`, and `done` until the source is deleted) the tenant is held (suspended), the rows
 *    written in the TARGET since `cutover_at` are counted (per table: rows with `greatest(created_at,
 *    updated_at) > cutover_at`, or the count difference where a table has neither column, plus rows that were
 *    deleted since), and the rollback REFUSES with `writes_since_cutover` unless `--accept-loss`. Then ONE
 *    central transaction repoints the tenant to `previous_project_id` (swapping the columns, so a second
 *    rollback is recognised) and ends the move; the inverse origin rewrite is applied to the central branding,
 *    the queue is re-synchronised back, the caches are dropped and the status is restored. The count is
 *    reported, never the rows.
 *  - `source_deleted_at` set makes the move non-rollbackable (`source_deleted`).
 *  - The RECOPY (`recopyTarget`) is the only way to repeat a copy whose verification failed or whose source
 *    changed. It is allowed in `suspended` or `copied`, never after the flip, and it writes to the TARGET only:
 *    this module contains no statement that deletes from the source.
 */

export type WriteReport = { total: number; tables: Record<string, number> };

type Counts = { verified?: { tables?: Record<string, number> } };

/**
 * Rows of the tenant changed in `target` since `cutoverAt`. `recorded` is the per-table count the verification
 * stored. Counts only.
 */
export async function writesSinceCutover(
  target: MoveSide,
  plan: MovePlan,
  cutoverAt: Date,
  recorded: Record<string, number>,
): Promise<WriteReport> {
  const tables: Record<string, number> = {};
  let total = 0;
  for (const { name } of plan.tables) {
    const columns = new Set((plan.info[name]?.columns ?? []).map((c) => c.name));
    const stamps = ['created_at', 'updated_at']
      .filter((c) => columns.has(c))
      .map((c) => `coalesce("${c}", '-infinity'::timestamptz)`);
    const changed =
      stamps.length > 0
        ? `count(*) filter (where greatest(${stamps.join(', ')}) > $2::timestamptz)::int`
        : '0';
    const [row] = await run<{ total: number; changed: number }>(
      target.sql,
      `select count(*)::int as total, ${changed} as changed
         from ${publicTable(name)} where tenant_id = $1::uuid`,
      stamps.length > 0 ? [target.tenantId, cutoverAt.toISOString()] : [target.tenantId],
    );
    const now = row?.total ?? 0;
    const before = recorded[name] ?? 0;
    const writes =
      stamps.length > 0 ? (row?.changed ?? 0) + Math.max(0, before - now) : Math.abs(now - before);
    if (writes > 0) {
      tables[name] = writes;
      total += writes;
    }
  }
  return { total, tables };
}

const recordedCounts = (move: MoveRow): Record<string, number> =>
  (move.counts as Counts).verified?.tables ?? {};

export type RollbackOutcome = {
  outcome: 'rolled_back' | 'already_rolled_back';
  flipped: boolean;
  lost: number;
};

/** Restores the status the tenant had when the move started, when the move changed it. */
async function restoreStatus(
  deps: MoveDeps,
  move: MoveRow,
  wasSuspendedByMove: boolean,
): Promise<void> {
  if (move.statusBefore !== 'active' || !wasSuspendedByMove) return;
  if ((await currentStatus(move.tenantId)) === 'active') return;
  if (!deps.setStatus) throw new MoveError('unknown');
  await deps.setStatus(move.tenantId, 'active', move.actor, move.id);
}

/**
 * A rollback before the flip: only the status is restored and the move ends. The target and the source are not
 * opened. `planned` never suspended the tenant, every later state did.
 */
export async function rollbackBeforeFlip(move: MoveRow, deps: MoveDeps): Promise<RollbackOutcome> {
  const store = deps.store ?? platformStore;
  if (move.sourceDeletedAt) throw new MoveError('source_deleted');
  if (move.state === 'rolled_back') {
    return { outcome: 'already_rolled_back', flipped: false, lost: 0 };
  }
  if (!PRE_FLIP_STATES.includes(move.state)) throw new MoveError('move_conflict');

  // The status goes back BEFORE the move closes: the guard only lets the move's own id change a moving tenant.
  await restoreStatus(deps, move, move.state !== 'planned');
  await advance(move.id, move.state, 'rolled_back', { finishedAt: true, errorCode: null }, store);
  await recordEvent(move.id, 'rolled_back', { flipped: false, from: move.state }, store);
  await deps.afterState?.('rolled_back', { ...move, state: 'rolled_back' });
  return { outcome: 'rolled_back', flipped: false, lost: 0 };
}

const SQL_LOCK = (id: string) =>
  sql`select state, source_deleted_at as deleted from platform.tenant_moves where id = ${id}::uuid for update`;

/**
 * A rollback after the flip (`cutover`, `done`): hold the tenant, count the writes, repoint, put the branding
 * back, send the queue back, restore the status.
 */
export async function rollbackAfterFlip(
  ctx: MoveContext,
  options: { acceptLoss: boolean },
): Promise<RollbackOutcome> {
  const store = ctx.deps.store ?? platformStore;
  const move = ctx.move;
  const tenantId = move.tenantId;
  const setStatus = ctx.deps.setStatus;
  if (!setStatus) throw new MoveError('unknown');
  if (move.sourceDeletedAt) throw new MoveError('source_deleted');
  if (move.state !== 'cutover' && move.state !== 'done') throw new MoveError('move_conflict');

  // Hold the tenant: nothing may be written to the target while the writes are counted and the pointer moves.
  const wasActive = (await currentStatus(tenantId)) === 'active';
  if (wasActive) await setStatus(tenantId, 'suspended', move.actor, move.id);
  await ctx.sleep(ctx.waits.quiesceMs);

  const plan = await planMove(ctx.source, ctx.target);
  assertCoverage(plan);
  const writes = await writesSinceCutover(
    ctx.target,
    plan,
    move.cutoverAt ?? move.startedAt,
    recordedCounts(move),
  );
  if (writes.total > 0 && !options.acceptLoss) {
    // Nothing changes: the tenant is released again and the refusal is part of the trail.
    if (wasActive) await setStatus(tenantId, 'active', move.actor, move.id);
    await recordEvent(
      move.id,
      'rollback_refused',
      { writes: writes.total, tables: writes.tables },
      store,
    );
    throw new MoveError('writes_since_cutover', Object.keys(writes.tables), writes);
  }

  // ONE central transaction: the pointer goes back and the move ends. `project_id` and `previous_project_id`
  // swap, so the binding says where the tenant was and a second rollback finds a closed move.
  await withPlatformTx(async (tx) => {
    const locked = (await tx.execute(SQL_LOCK(move.id))) as unknown as {
      state: string;
      deleted: Date | null;
    }[];
    const row = locked[0];
    if (!row || (row.state !== 'cutover' && row.state !== 'done')) {
      throw new MoveError('move_conflict');
    }
    if (row.deleted) throw new MoveError('source_deleted');
    const back = await tx
      .update(tenantProjects)
      .set({
        projectId: move.fromProjectId,
        previousProjectId: move.toProjectId,
        boundAt: new Date(),
      })
      .where(eq(tenantProjects.tenantId, tenantId))
      .returning({ projectId: tenantProjects.projectId });
    if (back.length !== 1) throw new MoveError('move_conflict');
    await tx.execute(sql`
      update platform.tenant_moves
         set state = 'rolled_back', finished_at = coalesce(finished_at, now()),
             updated_at = now(), error_code = null
       where id = ${move.id}::uuid`);
  });
  await dropCaches(tenantId);

  // The inverse origin rewrite: the files live in the previous project again.
  const from = ctx.targetProject.apiUrl;
  const to = ctx.sourceProject.apiUrl;
  if (from && to && from !== to) {
    await withPlatformTx(async (tx) => {
      const [central] = await tx
        .select({ branding: tenants.branding })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!central) return;
      const next = rewriteStorageOrigins(central.branding, from, to);
      if (JSON.stringify(next) !== JSON.stringify(central.branding)) {
        await tx
          .update(tenants)
          .set({ branding: next, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));
      }
    });
    if (!ctx.sourceProject.isCentral && ctx.sourceProject.credentialSource !== 'env') {
      await withAdminTx({ tenantId }, async (tx) => {
        const [own] = await tx
          .select({ branding: tenants.branding })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (!own) return;
        const next = rewriteStorageOrigins(own.branding, from, to);
        if (JSON.stringify(next) !== JSON.stringify(own.branding)) {
          await tx
            .update(tenants)
            .set({ branding: next, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
        }
      });
    }
  }

  // The queue goes back: what waits in the target is re-sent to the source and cancelled here.
  const bosses = await ctx.bosses();
  await requeueJobs(
    { source: { sql: ctx.target.sql, boss: bosses.target }, target: { boss: bosses.source } },
    tenantId,
  );

  await ctx.sleep(ctx.waits.registryWaitMs);
  await dropCaches(tenantId);

  // The status the tenant had when the move started (the move is closed now, so the guard lets it through).
  if (move.statusBefore === 'active' && (await currentStatus(tenantId)) !== 'active') {
    await setStatus(tenantId, 'active', move.actor, move.id);
  }
  await recordEvent(
    move.id,
    'rolled_back',
    { flipped: true, from: move.state, lost: writes.total, tables: writes.tables },
    store,
  );
  await ctx.deps.afterState?.('rolled_back', { ...move, state: 'rolled_back' });
  return { outcome: 'rolled_back', flipped: true, lost: writes.total };
}

// ---------------------------------------------------------------------------------------------------------
// The recopy
// ---------------------------------------------------------------------------------------------------------

/**
 * Wipes the tenant's rows in the TARGET, in reverse foreign-key order (the deferrable `events` /
 * `event_secrets` group in one transaction with the constraints deferred), keeping the `tenants` and
 * `tenant_modules` rows and the accounts, and puts the move back in `suspended` so the copy restarts. The
 * source is never written. Allowed in `suspended` or `copied` only, and never when the target already is the
 * tenant's binding.
 */
export async function recopyTarget(ctx: MoveContext): Promise<MoveRow> {
  const store = ctx.deps.store ?? platformStore;
  const move = ctx.move;
  if (move.sourceDeletedAt) throw new MoveError('source_deleted');
  if (move.state !== 'suspended' && move.state !== 'copied') throw new MoveError('not_done');

  const [binding] = await withPlatformTx((tx) =>
    tx
      .select({ projectId: tenantProjects.projectId })
      .from(tenantProjects)
      .where(eq(tenantProjects.tenantId, move.tenantId))
      .limit(1),
  );
  if (binding?.projectId === move.toProjectId) throw new MoveError('move_conflict');

  const plan = await planMove(ctx.source, ctx.target);
  assertCoverage(plan);

  for (const group of [...plan.groups].reverse()) {
    await ctx.target.sql.begin(async (tgt) => {
      if (group.length > 1) await tgt.unsafe('set constraints all deferred');
      const silenced = group.filter((table) => plan.info[table]?.userTriggers);
      for (const table of silenced) {
        await tgt.unsafe(`alter table ${publicTable(table)} disable trigger user`);
      }
      for (const table of group) {
        await tgt.unsafe(`delete from ${publicTable(table)} where tenant_id = $1::uuid`, [
          move.tenantId,
        ] as never[]);
      }
      for (const table of silenced) {
        await tgt.unsafe(`alter table ${publicTable(table)} enable trigger user`);
      }
    });
  }

  let next = move;
  if (move.state === 'copied') {
    next = await advance(move.id, 'copied', 'suspended', { errorCode: null }, store);
  } else {
    await setMoveError(move.id, null, store);
  }
  await recordEvent(move.id, 'recopy_wiped', { tables: plan.tables.length }, store);
  ctx.move = next;
  return next;
}
