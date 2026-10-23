import { openDdlSql } from '../ddl';
import {
  defaultDeleteAccount,
  defaultPurgeStorage,
  defaultStorage,
  type MoveContext,
} from './context';
import { accountIdsOf, assertCoverage, MOVE_BUCKETS, planMove } from './plan';
import { markSourceDeleted, platformStore, recordEvent } from './state';
import { idsParam, MoveError, publicTable, run } from './types';

/**
 * `--confirm-delete` (09.2-23, D-534, D-533, PR-6, T-09.2-104): the ONLY code path that removes anything from
 * the source project. Resume, retry, rollback, recopy and every failure path never reach this module.
 *
 * It requires, in this order:
 *   1. the slug typed again equals the tenant's (`confirm_mismatch`);
 *   2. the source not deleted already (`source_deleted`), the move in state `done` (`not_done`);
 *   3. a reachable target that holds the tenant's `tenants` row and, for every table the verification counted
 *      rows in, at least one row (`target_not_ready`, `verify_failed`): the deletion never runs against a
 *      target that lost the data.
 * It then writes the per-table plan as an event BEFORE deleting, and deletes:
 *   - the tenant's rows from the copy-set tables of the SOURCE in reverse foreign-key order. Never `tenants`,
 *     `tenant_modules`, `tenant_domains`, `platform_admins`, `email_allowlist`: those are the central mirror or
 *     platform data and are not part of the copy set;
 *   - its Storage objects under `<tenantId>/` in `branding` and `media`;
 *   - the Auth accounts that have no membership or invite left anywhere in the source project and are not
 *     platform admins, through the project's Admin API, never a raw delete of `auth.users`. An account another
 *     tenant still uses is never touched (D-533).
 * and finally stamps `source_deleted_at`, which makes the move non-rollbackable.
 *
 * This is the only module that opens a WRITABLE client on the source. A repository test fails when any other
 * file of `projects/move/` deletes from the source side.
 */

export type DeleteReport = {
  tables: Record<string, number>;
  rows: number;
  files: number;
  accounts: number;
};

const CHUNK = 100;

export async function confirmDeleteSource(
  ctx: MoveContext,
  options: {
    confirmSlug: string | undefined;
    /** Called with the per-table plan right after it is recorded and BEFORE anything is deleted. */
    onPlan?: (plan: { tables: Record<string, number>; accounts: number; files: number }) => void;
  },
): Promise<DeleteReport> {
  const store = ctx.deps.store ?? platformStore;
  const move = ctx.move;
  const tenantId = ctx.tenant.id;

  if (options.confirmSlug === undefined || options.confirmSlug !== ctx.tenant.slug) {
    throw new MoveError('confirm_mismatch');
  }
  if (move.sourceDeletedAt) throw new MoveError('source_deleted');
  if (move.state !== 'done') throw new MoveError('not_done');

  // The target answers and still holds the tenant.
  const [held] = await run<{ n: number }>(
    ctx.target.sql,
    'select count(*)::int as n from public.tenants where id = $1::uuid',
    [tenantId],
  );
  if ((held?.n ?? 0) !== 1) throw new MoveError('target_not_ready', ['tenants']);

  const plan = await planMove(ctx.source, ctx.target);
  assertCoverage(plan);
  const recorded = (move.counts as { verified?: { tables?: Record<string, number> } }).verified
    ?.tables;
  const empty: string[] = [];
  for (const { name } of plan.tables) {
    if ((recorded?.[name] ?? 0) === 0) continue;
    const [row] = await run<{ n: number }>(
      ctx.target.sql,
      `select count(*)::int as n from ${publicTable(name)} where tenant_id = $1::uuid`,
      [tenantId],
    );
    if ((row?.n ?? 0) === 0) empty.push(name);
  }
  if (empty.length > 0) throw new MoveError('verify_failed', empty);

  // The accounts of the tenant, collected BEFORE its memberships and invites go.
  const candidates = await ctx.source.sql.begin('read only', (tx) => accountIdsOf(tx, tenantId));

  const sourceStorage = (ctx.deps.storage ?? defaultStorage)(ctx.sourceProject);
  const files: { bucket: string; key: string }[] = [];
  for (const bucket of MOVE_BUCKETS) {
    for await (const entry of sourceStorage.list(bucket, `${tenantId}/`)) {
      if (entry.key.startsWith(`${tenantId}/`)) files.push({ bucket, key: entry.key });
    }
  }

  const tables = Object.fromEntries(plan.tables.map((t) => [t.name, t.rows]));
  // The plan is the first thing on the trail, before a single row goes.
  await recordEvent(
    move.id,
    'delete_planned',
    { tables, accounts: candidates.length, files: files.length },
    store,
  );
  options.onPlan?.({ tables, accounts: candidates.length, files: files.length });

  const open = ctx.deps.openSql ?? ((project, o) => openDdlSql(project, { readOnly: o.readOnly }));
  const writable = open(ctx.sourceProject, { readOnly: false });
  let accounts = 0;
  let rows = 0;
  try {
    for (const group of [...plan.groups].reverse()) {
      rows += await writable.begin(async (tx) => {
        if (group.length > 1) await tx.unsafe('set constraints all deferred');
        const silenced = group.filter((table) => plan.info[table]?.userTriggers);
        for (const table of silenced) {
          await tx.unsafe(`alter table ${publicTable(table)} disable trigger user`);
        }
        let removed = 0;
        for (const table of group) {
          const result = await tx.unsafe(
            `delete from ${publicTable(table)} where tenant_id = $1::uuid`,
            [tenantId] as never[],
          );
          removed += result.count;
        }
        for (const table of silenced) {
          await tx.unsafe(`alter table ${publicTable(table)} enable trigger user`);
        }
        return removed;
      });
    }

    // Files, a hundred keys at a time.
    for (const bucket of MOVE_BUCKETS) {
      const keys = files.filter((f) => f.bucket === bucket).map((f) => f.key);
      for (let i = 0; i < keys.length; i += CHUNK) {
        await (ctx.deps.purgeStorage ?? defaultPurgeStorage)(
          ctx.sourceProject,
          bucket,
          keys.slice(i, i + CHUNK),
        );
      }
    }

    // Accounts nobody else uses: no membership, no invite and no platform admin row anywhere in the source.
    const stillUsed = await run<{ id: string }>(
      writable,
      `select distinct u::text as id from (
         select user_id as u from public.memberships
          where user_id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))
         union all
         select user_id from public.tenant_invites
          where user_id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))
         union all
         select user_id from public.platform_admins
          where user_id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))
       ) used`,
      [idsParam(candidates)],
    );
    const keep = new Set(stillUsed.map((row) => row.id));
    const deleteAccount = ctx.deps.deleteAccount ?? defaultDeleteAccount;
    for (const id of candidates) {
      if (keep.has(id)) continue;
      await deleteAccount(ctx.sourceProject, id);
      accounts += 1;
    }
  } finally {
    await writable.end({ timeout: 5 }).catch(() => undefined);
  }

  await markSourceDeleted(move.id, store);
  await recordEvent(
    move.id,
    'source_deleted',
    { rows, files: files.length, accounts, kept: candidates.length - accounts },
    store,
  );
  return { tables, rows, files: files.length, accounts };
}
