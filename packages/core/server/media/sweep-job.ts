import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { mediaAssets } from '../../db/schema';
import { registeredSweepFunctions } from '../jobs/sweep-functions';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { MEDIA_SWEEP_QUEUE } from './index';
import {
  MEDIA_DELETED_TTL_MS,
  MEDIA_PENDING_TTL_MS,
  MEDIA_SWEEP_BATCH,
  MEDIA_SWEEP_INTERVAL_S,
} from './limits';
import { armSweeper, type PurgeableAsset, purgeAsset } from './service';
import { videoProvider } from './video/index';
import { type ReconcilableVideo, reconcileVideoAsset } from './video/reconcile';

/**
 * `kernel.media-sweep-orphans` (R-07) — the collector that makes the broker's lifecycle complete.
 *
 * 03-01 left the gap deliberately: `DELETE /v1/media/{assetId}` is a SOFT delete (the row is marked,
 * the bytes stay) so the request path stays fast, and an upload a member abandoned leaves a `pending`
 * row forever. This job closes both, and it is the only thing in the codebase that deletes a
 * `media_assets` row.
 *
 * **No scheduler exists anywhere in this repo and this job does not introduce one.** `boss.schedule()`
 * is unused; `kernel.domain-verify` (02-09) paces itself with deferred `startAfter` re-arms, and so
 * does this: every run ends by queueing the next one an hour later under a CONSTANT `singletonKey`,
 * which the `short` queue policy turns into "at most one sweeper is ever queued". One mechanism for
 * periodic work means the one the team already debugs is the one the sweeper uses.
 *
 * **Two windows, written as a flat SQL disjunction over `status` plus an age** (T-03-53):
 *   - `pending` older than `MEDIA_PENDING_TTL_MS` (24 h) — an abandoned upload. The window is aligned
 *     to the Supabase TUS URL's own 24 h validity, so nothing legitimate can still be in flight;
 *   - `deleted` or `rejected` older than `MEDIA_DELETED_TTL_MS` (1 h), measured from
 *     `coalesce(deleted_at, created_at)` — a retired photo, kept long enough that a member who
 *     removes it and puts it back is not racing the collector.
 *
 * A `processing` or a `ready` asset is therefore outside the predicate BY CONSTRUCTION rather than by
 * a runtime guard that a later edit could invert, and every age is measured with the database's own
 * `now()`, never a client clock.
 *
 * **A reconcile pass runs FIRST** (quick-260929-ltf). A `pending`/`processing` video of the active
 * provider, older than five minutes and carrying its upload id, is checked with the provider through
 * `reconcileVideoAsset`, which applies the webhook's own transition. So a video the provider finished
 * while its webhook was lost becomes `ready` and falls out of the pending window instead of being
 * purged as an abandoned upload (and instead of `purgeAsset` deleting by the UPLOAD id, which would
 * orphan the finished provider asset). The pass never deletes anything; the two windows above and
 * their by-construction exclusions are unchanged.
 *
 * Never throws (the `domains/verify-job.ts` rule): pg-boss would otherwise retry a crashing job twice
 * and then park it, leaving the tenant without a collector. One asset's failure increments `failed`
 * and the batch continues; the re-arm happens whatever the outcome, so a bad row cannot stop the
 * cadence.
 *
 * **A third pass runs the registered sweep functions** (07-04, planning decision 3). Every name a
 * module manifest declared in `sweepFunctions` is executed as `select app.<name>(<batch>)` through
 * the admin lane, repeated while it deletes a full batch, at most `SWEEP_FUNCTION_MAX_CALLS` times per
 * run. The kernel never names the table behind it (MOD-02): it only knows the function contract
 * (`../jobs/sweep-functions.ts`). Each name has its own try/catch, AFTER the media passes and BEFORE
 * the re-arm, so a failing function stops neither another function, nor the media collection, nor
 * the cadence.
 *
 * Import direction is service -> job only: the queue NAME and the singleton key come from `./index`
 * (where `MEDIA_DERIVE_QUEUE` lives), never from this file, so `service.ts` can own `purgeAsset` and
 * `armSweeper` without a cycle.
 */
const log = moduleLogger('kernel-jobs');

/** Log-only actor id — nothing writes it to a `created_by` column. */
export const SYSTEM_ACTOR = 'system:media-sweep-orphans';

// Re-exported so "the sweeper's constants" are reachable from the sweeper's own module, even though
// they are DECLARED where the import graph allows them to be (see the docblock's last paragraph).
export { MEDIA_SWEEP_QUEUE, MEDIA_SWEEP_SINGLETON } from './index';
export {
  MEDIA_DELETED_TTL_MS,
  MEDIA_PENDING_TTL_MS,
  MEDIA_SWEEP_BATCH,
  MEDIA_SWEEP_INTERVAL_S,
} from './limits';

const seconds = (ms: number): number => ms / 1000;

/** Rows one sweep-function call may delete (07-04). The functions clamp to their own ceiling too. */
export const SWEEP_FUNCTION_BATCH = 500;

/** Calls per name per hourly run: at most `SWEEP_FUNCTION_BATCH * 20` rows, then the next hour. */
export const SWEEP_FUNCTION_MAX_CALLS = 20;

/**
 * One registered sweep function, repeated while it returns a full batch. Returns the rows deleted.
 * `name` was validated at registration and still travels only as an IDENTIFIER, never as text.
 */
async function runSweepFunction(name: string): Promise<number> {
  let deleted = 0;
  for (let call = 0; call < SWEEP_FUNCTION_MAX_CALLS; call += 1) {
    const rows = await withAdminTx(async (tx) =>
      tx.execute<{ n: number | null }>(
        sql`select ${sql.identifier('app')}.${sql.identifier(name)}(${SWEEP_FUNCTION_BATCH}::int) as n`,
      ),
    );
    const n = Number(rows[0]?.n ?? 0);
    deleted += n;
    if (n < SWEEP_FUNCTION_BATCH) break;
  }
  return deleted;
}

/** A video younger than this is left to its webhook and to the browser's readiness poll. */
const RECONCILE_SWEEP_MIN_AGE_S = 300;

/** One bounded batch of stale videos the reconcile pass asks the provider about. */
async function reconcilable(): Promise<ReconcilableVideo[]> {
  return withAdminTx(async (tx) =>
    tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        kind: mediaAssets.kind,
        status: mediaAssets.status,
        provider: mediaAssets.provider,
        providerAssetId: mediaAssets.providerAssetId,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.kind, 'video'),
          inArray(mediaAssets.status, ['pending', 'processing']),
          eq(mediaAssets.provider, videoProvider.name),
          isNotNull(mediaAssets.providerAssetId),
          isNull(mediaAssets.deletedAt),
          sql`${mediaAssets.createdAt} < now() - make_interval(secs => ${RECONCILE_SWEEP_MIN_AGE_S}::double precision)`,
        ),
      )
      .orderBy(mediaAssets.createdAt)
      .limit(MEDIA_SWEEP_BATCH),
  );
}

/** One bounded batch of collectable assets, newest constraint applied in SQL rather than in JS. */
async function collectable(): Promise<PurgeableAsset[]> {
  return withAdminTx(async (tx) =>
    tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        kind: mediaAssets.kind,
        providerAssetId: mediaAssets.providerAssetId,
      })
      .from(mediaAssets)
      .where(
        or(
          // window 1 — an abandoned upload: `pending` past the TUS URL's own 24 h validity.
          and(
            eq(mediaAssets.status, 'pending'),
            sql`${mediaAssets.createdAt} < now() - make_interval(secs => ${seconds(MEDIA_PENDING_TTL_MS)}::double precision)`,
          ),
          // window 2 — a retired asset: `deleted` or `rejected` for longer than an hour.
          and(
            inArray(mediaAssets.status, ['deleted', 'rejected']),
            sql`coalesce(${mediaAssets.deletedAt}, ${mediaAssets.createdAt}) < now() - make_interval(secs => ${seconds(MEDIA_DELETED_TTL_MS)}::double precision)`,
          ),
        ),
      )
      .orderBy(mediaAssets.createdAt)
      .limit(MEDIA_SWEEP_BATCH),
  );
}

export const sweepOrphansJob: JobDefinition<Record<string, never>> = {
  name: MEDIA_SWEEP_QUEUE,
  handler: async () => {
    const t0 = Date.now();
    let collected = 0;
    let failed = 0;
    let reconciled = 0;

    // BEFORE collecting, so a finished video leaves the pending window instead of being purged.
    // Sequential, bounded and throttled by the same per-asset map the read path uses; it never
    // deletes, and a failure here never stops the purge below.
    try {
      for (const row of await reconcilable()) {
        if (await reconcileVideoAsset(row)) reconciled += 1;
      }
    } catch (error) {
      log.error(
        {
          event: 'media.sweep.reconcile_failed',
          err: error instanceof Error ? error.message : String(error),
        },
        'the reconcile pass failed; collecting anyway',
      );
    }

    try {
      const rows = await collectable();
      // Sequential on purpose: each purge is several Storage round-trips, and a fan-out would let one
      // busy tenant's backlog saturate the worker (T-03-58). The batch is bounded; the re-arm below
      // picks up whatever is left, so "slow" only ever means "next hour", never "never".
      for (const row of rows) {
        try {
          const outcome = await purgeAsset(row);
          if (outcome.purged) collected += 1;
          else failed += 1;
        } catch (error) {
          failed += 1;
          log.error(
            {
              event: 'media.sweep.purge_failed',
              tenantId: row.tenantId,
              assetId: row.id,
              err: error instanceof Error ? error.message : String(error),
            },
            'could not purge an asset; the row stays for the next sweep',
          );
        }
      }
    } catch (error) {
      log.error(
        {
          event: 'media.sweep.failed',
          err: error instanceof Error ? error.message : String(error),
        },
        'kernel.media-sweep-orphans failed unexpectedly',
      );
    }

    // 07-04: the registered sweep functions, each isolated from the others and from the media passes.
    for (const name of registeredSweepFunctions()) {
      try {
        const deleted = await runSweepFunction(name);
        log.info({ event: 'sweep.function', name, deleted }, 'sweep function ran');
      } catch (error) {
        log.error(
          {
            event: 'sweep.function_failed',
            name,
            err: error instanceof Error ? error.message : String(error),
          },
          'a sweep function failed; the others and the re-arm still run',
        );
      }
    }

    // Outside the try/catch above so the cadence survives ANY failure inside the batch: a run that
    // collected nothing and a run that crashed on its very first read both still queue the next one.
    try {
      await armSweeper();
    } catch (error) {
      log.error(
        {
          event: 'media.sweep.rearm_failed',
          err: error instanceof Error ? error.message : String(error),
        },
        'could not re-arm the sweeper; the next worker start re-opens the cadence',
      );
    }

    log.info(
      {
        event: 'media.sweep.done',
        actor: SYSTEM_ACTOR,
        collected,
        failed,
        reconciled,
        batch: MEDIA_SWEEP_BATCH,
        nextInSeconds: MEDIA_SWEEP_INTERVAL_S,
        ms: Date.now() - t0,
      },
      'kernel.media-sweep-orphans ran',
    );
  },
};
