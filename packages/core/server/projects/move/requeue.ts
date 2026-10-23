import type { PgBoss } from 'pg-boss';
import { createQueues, queueScope } from '../../jobs/boss';
import { assertUuid, type Db, run } from './types';

/**
 * Queued jobs follow the tenant (09.2-22, D-534 step 7, D-546).
 *
 * The tenant's waiting work (`created` or `retry` jobs of tenant queues whose `data->>'tenantId'` is the
 * tenant) lives in the SOURCE project's `pgboss`. Each such job is re-sent into the TARGET's `pgboss` with the
 * same name, data, `startAfter`, `singletonKey` and retention, and then cancelled in the source with the
 * source's own pg-boss API. Re-sending first and cancelling second means a crash between the two leaves a job
 * in both places, never in neither; the queues have the `short` policy, so a repeated `singletonKey` that is
 * still waiting in the target is dropped by `send` (returns `null`) and the source job is still cancelled.
 *
 * Untouched on purpose: platform queues (`pgboss_platform` of the central project, not this schema), jobs with
 * no `tenantId` in their data (including the self-arming `kernel.daily-tenant-dispatch`, which the target's
 * supervisor re-arms at start), and jobs that are `active` right now (plan 23 quiesces before the copy).
 *
 * The two pg-boss instances are the caller's: started, `supervise: false`, `schedule: false`, built with
 * `createBoss` for the matching project. Payloads are never logged; the result is a count.
 */

export type RequeuePorts = {
  /** Source project: a connection (to read the waiting rows) and its pg-boss (to cancel them). */
  source: { sql: Db; boss: PgBoss };
  /** Target project's pg-boss. */
  target: { boss: PgBoss };
};

type JobRow = {
  id: string;
  name: string;
  data: string;
  start_after: Date;
  singleton_key: string | null;
  priority: number;
  retry_limit: number;
  retry_delay: number;
  retry_backoff: boolean;
  retry_delay_max: number | null;
  expire_seconds: number;
  deletion_seconds: number | null;
};

export async function requeueJobs(
  ports: RequeuePorts,
  tenantId: string,
): Promise<{ requeued: number }> {
  assertUuid(tenantId);
  const jobs = await run<JobRow>(
    ports.source.sql,
    `select id::text, name, data::text as data, start_after, singleton_key, priority,
            retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, deletion_seconds
       from pgboss.job
      where state in ('created', 'retry') and data ->> 'tenantId' = $1
      order by created_on, id`,
    [tenantId],
  );

  let requeued = 0;
  for (const job of jobs) {
    if (queueScope(job.name) === 'platform') continue;
    await createQueues(ports.target.boss, [job.name]);
    await ports.target.boss.send(job.name, JSON.parse(job.data) as object, {
      startAfter: job.start_after,
      priority: job.priority,
      retryLimit: job.retry_limit,
      retryDelay: job.retry_delay,
      retryBackoff: job.retry_backoff,
      ...(job.retry_delay_max !== null ? { retryDelayMax: job.retry_delay_max } : {}),
      expireInSeconds: job.expire_seconds,
      ...(job.deletion_seconds !== null ? { deleteAfterSeconds: job.deletion_seconds } : {}),
      ...(job.singleton_key ? { singletonKey: job.singleton_key } : {}),
    });
    await ports.source.boss.cancel(job.name, job.id);
    requeued += 1;
  }
  return { requeued };
}
