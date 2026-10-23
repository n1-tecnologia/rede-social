import { and, eq, sql } from 'drizzle-orm';
import { tenantProjects } from '../../../db/central';
import { withPlatformTx } from '../../../db/platform-tx';
import { tenantDomains, tenants } from '../../../db/schema';
import { pushToCentral, pushToTenant } from '../../tenancy/mirror';
import { invalidateProject } from '../../tenancy/project-registry';
import { invalidateTenantHost } from '../../tenancy/tenant-host';
import type { MoveContext } from './context';
import { fingerprintOf } from './quiesce';
import { requeueJobs } from './requeue';
import { advance, hasEvent, type MoveRow, platformStore, recordEvent, setMoveError } from './state';
import { MoveError, type MovePlan } from './types';

/**
 * The cutover (09.2-23, D-535, D-536, T-09.2-102): from `verified` to `done`, in the order the decision lists.
 *
 *  1. `flipPointer` (state `verified`): the source fingerprint is recomputed and must equal the one stored at
 *     `verified` (`source_changed`); then ONE central transaction locks the move row, repoints
 *     `platform.tenant_projects` (`previous_project_id = project_id, project_id = <target>, bound_at = now()`)
 *     and sets the state `cutover` with `cutover_at`. Nothing else is part of the transaction, so a crash can
 *     never leave the pointer and the state apart.
 *  2. `completeCutover` (state `cutover`): the cached binding and the host answers are dropped, the registry
 *     wait lets other instances' 15 s binding cache expire, the rewritten branding becomes the central mirror,
 *     every central-owned field is pushed to the target's copy, the queue is re-synchronised a second time
 *     (jobs created since the copy), the tenant is reactivated when it was active, and the state becomes
 *     `done`. Each of these is idempotent, so `--resume` from `cutover` repeats only what is safe to repeat; a
 *     reactivation that is already in place is not repeated and not logged twice.
 *
 * Sessions do not migrate: members sign in again (D-535).
 */

/** Every host of the tenant leaves the in-process host cache. */
export async function dropTenantHostCache(tenantId: string): Promise<void> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId)),
  );
  for (const row of rows) invalidateTenantHost(row.host);
}

/** The moments that matter: the binding and the host answer of the tenant are read afresh from here on. */
export async function dropCaches(tenantId: string): Promise<void> {
  invalidateProject();
  await dropTenantHostCache(tenantId);
}

const CENTRAL_FIELDS = ['slug', 'status', 'displayName', 'timezone', 'plan', 'modules'] as const;

/** A push that did not reach the project is a failure of the cutover (it is repeated on resume), not a log line. */
function assertPushed(result: { pushed: boolean; reason?: string }): void {
  if (!result.pushed && result.reason !== 'central_project') {
    throw new MoveError('unknown', [result.reason ?? 'push_failed']);
  }
}

export async function currentStatus(tenantId: string): Promise<string | null> {
  const rows = await withPlatformTx((tx) =>
    tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
  );
  return rows[0]?.status ?? null;
}

/** Step 1: the central transaction. Returns the move in state `cutover`. */
export async function flipPointer(ctx: MoveContext, plan: MovePlan): Promise<MoveRow> {
  const store = ctx.deps.store ?? platformStore;
  const move = ctx.move;
  if (move.state !== 'verified') throw new MoveError('move_conflict');

  const now = await fingerprintOf(ctx.source, plan);
  if (move.fingerprint === null || now.digest !== move.fingerprint) {
    await setMoveError(move.id, 'source_changed', store);
    await recordEvent(move.id, 'source_changed', {}, store);
    throw new MoveError('source_changed');
  }

  await withPlatformTx(async (tx) => {
    // The move row is locked for the length of the flip: a rollback or another runner waits here.
    const locked = (await tx.execute(sqlLock(move.id))) as unknown as { state: string }[];
    if (locked[0]?.state !== 'verified') throw new MoveError('move_conflict');

    const repointed = await tx
      .update(tenantProjects)
      .set({
        previousProjectId: move.fromProjectId,
        projectId: move.toProjectId,
        boundAt: new Date(),
      })
      .where(
        and(
          eq(tenantProjects.tenantId, move.tenantId),
          eq(tenantProjects.projectId, move.fromProjectId),
        ),
      )
      .returning({ projectId: tenantProjects.projectId });
    if (repointed.length !== 1) throw new MoveError('move_conflict');

    const updated = (await tx.execute(sqlCutover(move.id))) as unknown as { id: string }[];
    if (updated.length !== 1) throw new MoveError('move_conflict');
  });

  const row = await store.load(move.id);
  if (!row) throw new MoveError('move_conflict');
  ctx.move = row;
  await recordEvent(move.id, 'cutover', { toProjectId: move.toProjectId }, store);
  await ctx.deps.afterState?.('cutover', row);
  return row;
}

/** Step 2: everything after the flip. Safe to run again. */
export async function completeCutover(ctx: MoveContext): Promise<MoveRow> {
  const store = ctx.deps.store ?? platformStore;
  const move = ctx.move;
  if (move.state !== 'cutover') throw new MoveError('move_conflict');
  const tenantId = move.tenantId;

  await dropCaches(tenantId);
  await ctx.sleep(ctx.waits.registryWaitMs);
  // The wait is over: drop once more, in case a request of this very process re-read the old row meanwhile.
  await dropCaches(tenantId);

  assertPushed(await pushToCentral(tenantId, ['branding']));
  assertPushed(await pushToTenant(tenantId, CENTRAL_FIELDS));

  const bosses = await ctx.bosses();
  const second = await requeueJobs(
    { source: { sql: ctx.source.sql, boss: bosses.source }, target: { boss: bosses.target } },
    tenantId,
  );

  const setStatus = ctx.deps.setStatus;
  if (!setStatus) throw new MoveError('unknown');
  if (move.statusBefore === 'active') {
    // Reactivate once: when the tenant is already active nothing is written and nothing is logged again.
    if ((await currentStatus(tenantId)) !== 'active') {
      await setStatus(tenantId, 'active', move.actor, move.id);
    }
    if (!(await hasEvent(move.id, 'reactivated', store))) {
      await recordEvent(move.id, 'reactivated', {}, store);
    }
  } else if (!(await hasEvent(move.id, 'kept_suspended', store))) {
    await recordEvent(move.id, 'kept_suspended', {}, store);
  }

  const done = await advance(
    move.id,
    'cutover',
    'done',
    { finishedAt: true, errorCode: null },
    store,
  );
  ctx.move = done;
  await recordEvent(move.id, 'done', { requeued: second.requeued }, store);
  await ctx.deps.afterState?.('done', done);
  return done;
}

// The two statements that need a row lock or a clock the query builder does not express.
const sqlLock = (id: string) =>
  sql`select state from platform.tenant_moves where id = ${id}::uuid for update`;

const sqlCutover = (id: string) =>
  sql`update platform.tenant_moves
         set state = 'cutover', cutover_at = now(), updated_at = now(), error_code = null
       where id = ${id}::uuid and state = 'verified'
   returning id`;
