import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';

/**
 * `kernel.daily-tenant-dispatch` (08.7-01, D-464, INSIGHT-16): the kernel's once-a-day-per-tenant
 * seam. Every run enqueues, for every ACTIVE tenant and every queue registered through
 * `registerDailyTenantJobs`, one job `{ tenantId, day }` for that tenant's local YESTERDAY, then
 * re-arms itself an hour later. The dashboard's nightly snapshot build is its first user.
 *
 * **No scheduler, on purpose** (R-Pitfall 10). `boss.schedule()` stays unused in this codebase: like
 * the media sweeper (`armSweeper`) and the domain poller, this job paces itself with a deferred
 * re-arm under a CONSTANT singleton key, which the `short` queue policy turns into "at most one
 * dispatcher is ever queued". The worker opens the cadence at boot (`armDailyTenantDispatch`) under a
 * DIFFERENT key, so a pending hourly job never swallows the boot run (EP-55). A tenant therefore
 * gets its build during the first run after its local midnight (at most an hour late), a missed night
 * heals on the next run, and a new worker revision rebuilds within minutes.
 *
 * **The kernel never names a module queue (MOD-02).** It knows only its own `tenants` table; the app
 * registry registers the queue names (`registerDailyTenantJobs`, validated here like
 * `registerSweepFunctions`), so removing a module removes only its line there.
 *
 * **Days come from SQL** (D-440, EP-57): each tenant's day is
 * `(now() at time zone tenants.timezone)::date - 1`, so a tenant whose local midnight has not passed
 * keeps its previous day, and the cadence is DST-safe. A tenant whose `timezone` is not a name in
 * `pg_timezone_names` (the column has no CHECK) or whose status is `suspended` gets no job, while
 * every other active tenant still gets one (EP-56); the skip is logged by count only.
 *
 * **Idempotent.** Each job's singleton key is `<tenantId>:<day>`: two dispatches while a build is
 * still `created` leave exactly one job (EP-55), and a job of an already-built day costs the
 * handler one cheap check. The build jobs and the re-arm are enqueued in ONE admin transaction.
 *
 * Log lines carry counts only, never a tenant's name.
 */

/** The dispatcher's own queue. */
export const DAILY_TENANT_DISPATCH_QUEUE = 'kernel.daily-tenant-dispatch';

/** The hourly re-arm's constant singleton key. */
export const DAILY_TENANT_DISPATCH_SINGLETON = 'daily-tenant-dispatch';

/** The boot arm's singleton key: never the hourly one, so a pending re-arm cannot swallow it. */
export const DAILY_TENANT_DISPATCH_BOOT_SINGLETON = 'daily-tenant-dispatch:boot';

/** Seconds between two dispatcher runs. */
export const DAILY_TENANT_DISPATCH_INTERVAL_S = 3600;

/** How long a finished per-tenant job is kept (pg-boss per-job retention): a day. */
const DAILY_TENANT_JOB_DELETE_AFTER_S = 86_400;

registerJobQueues([DAILY_TENANT_DISPATCH_QUEUE]);

const log = moduleLogger('kernel-jobs');

/** A queue name: lower-case letters, digits, dots and dashes, starting with a letter. */
export const DAILY_TENANT_JOB_NAME = /^[a-z][a-z0-9.-]+$/;

const names = new Set<string>();

/**
 * Registers every queue that runs once a day per tenant (idempotent). Throws on the FIRST name that
 * fails `DAILY_TENANT_JOB_NAME`, before registering any name of the list. Names come from the app
 * registry's code, never from input.
 */
export function registerDailyTenantJobs(list: readonly string[]): void {
  for (const name of list) {
    if (!DAILY_TENANT_JOB_NAME.test(name)) {
      throw new Error(`invalid daily tenant job name: ${JSON.stringify(name)}`);
    }
  }
  for (const name of list) names.add(name);
}

/** Every registered daily queue, in registration order, each once. */
export function registeredDailyTenantJobs(): string[] {
  return [...names];
}

/** The singleton key of one tenant's job for one local day. */
export function dailyTenantSingletonKey(tenantId: string, day: string): string {
  return `${tenantId}:${day}`;
}

/** What one dispatch did: the tenants it read, the jobs it queued, the tenants it skipped. */
export type DailyTenantDispatchResult = { tenants: number; enqueued: number; skipped: number };

/** Queues the next hourly run inside `tx`; a `null` id is the dropped duplicate (a success). */
async function rearm(tx: Parameters<Parameters<typeof withAdminTx>[0]>[0]): Promise<void> {
  await enqueueInTx(
    tx,
    DAILY_TENANT_DISPATCH_QUEUE,
    {},
    { singletonKey: DAILY_TENANT_DISPATCH_SINGLETON, startAfter: DAILY_TENANT_DISPATCH_INTERVAL_S },
  );
}

/**
 * One dispatch, in ONE admin transaction: read every active tenant with a valid zone and its local
 * yesterday, enqueue one job per tenant × registered queue, then the deferred re-arm. With no daily
 * queue registered it enqueues only the re-arm (EP-56).
 */
export async function runDailyTenantDispatch(): Promise<DailyTenantDispatchResult> {
  const queues = registeredDailyTenantJobs();
  const result = await withAdminTx(async (tx) => {
    const tenants = await tx.execute<{ id: string; day: string }>(sql`
      select t.id::text as id,
             ((now() at time zone t.timezone)::date - 1)::text as day
        from public.tenants t
       where t.status = 'active'
         and t.timezone in (select z.name from pg_catalog.pg_timezone_names z)
       order by t.id`);
    const [skippedRow] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from public.tenants t
       where t.status <> 'active'
          or t.timezone not in (select z.name from pg_catalog.pg_timezone_names z)`);
    let enqueued = 0;
    for (const tenant of tenants) {
      for (const queue of queues) {
        const id = await enqueueInTx(
          tx,
          queue,
          { tenantId: tenant.id, day: tenant.day },
          {
            singletonKey: dailyTenantSingletonKey(tenant.id, tenant.day),
            deleteAfterSeconds: DAILY_TENANT_JOB_DELETE_AFTER_S,
          },
        );
        if (id !== null) enqueued += 1;
      }
    }
    await rearm(tx);
    return { tenants: tenants.length, enqueued, skipped: Number(skippedRow?.n ?? 0) };
  });
  log.info({ event: 'kernel.daily_dispatch.ran', ...result }, 'daily tenant dispatch');
  return result;
}

/**
 * `kernel.daily-tenant-dispatch`. Never throws (the sweeper rule): a failed dispatch is logged and
 * the cadence is re-armed on its own, best-effort, so one bad run cannot stop the nightly builds.
 */
export const dailyTenantDispatchJob: JobDefinition<Record<string, never>> = {
  name: DAILY_TENANT_DISPATCH_QUEUE,
  handler: async () => {
    try {
      await runDailyTenantDispatch();
    } catch (err) {
      log.error({ err, event: 'kernel.daily_dispatch.failed' }, 'daily tenant dispatch failed');
      try {
        await withAdminTx(rearm);
      } catch (rearmErr) {
        log.error(
          { err: rearmErr },
          'daily tenant dispatch re-arm failed; the worker boot re-opens it',
        );
      }
    }
  },
};

/**
 * Queues ONE immediate dispatch under the boot singleton (EP-55), called best-effort by the worker
 * at start. Returns whether THIS call queued it (a `null` id is the dropped duplicate of a boot job
 * still waiting, which is a success).
 */
export async function armDailyTenantDispatch(): Promise<boolean> {
  const id = await withAdminTx((tx) =>
    enqueueInTx(
      tx,
      DAILY_TENANT_DISPATCH_QUEUE,
      {},
      {
        singletonKey: DAILY_TENANT_DISPATCH_BOOT_SINGLETON,
      },
    ),
  );
  return id !== null;
}
