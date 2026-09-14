import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { Tx } from '../../db/tenant-tx';
import { env } from '../env';

/**
 * pg-boss wiring (discretion item resolved in 01-07).
 *
 * Three properties this file exists to guarantee:
 *  1. **The runtime never issues DDL.** `migrate: false` + a fixed `schema: 'pgboss'`: the schema is
 *     a reviewed Supabase migration (`*_pgboss_schema.sql`), so `api_user` needs DML only
 *     (threat T-07-05). A pg-boss upgrade means a NEW custom migration, never `migrate: true`.
 *  2. **The API never touches pg-boss at boot.** The API-side instance is created and started
 *     lazily by the first `enqueueInTx`; `apps/api/src/main.ts` reaches nothing here in the
 *     `ROLE=api` branch, which is what keeps `GET /v1/health` answering with an unreachable
 *     database (the 01-09 DB-free-boot property).
 *  3. **Enqueue is transactional.** `fromDrizzle(tx, sql)` routes the insert through the caller's
 *     Drizzle transaction, so a rolled-back write takes its job with it.
 */

/** Queue names the app tier owns, registered by `apps/api/src/modules/registry.ts` (MOD-02: the kernel never imports a module). */
const queueNames = new Set<string>();

/** Idempotent: adding the same queue name twice is a no-op. Called at registry import time. */
export function registerJobQueues(names: readonly string[]): void {
  for (const name of names) queueNames.add(name);
}

/** Every queue name registered so far — the worker creates one queue per entry at start. */
export function registeredJobQueues(): string[] {
  return [...queueNames];
}

export type CreateBossOptions = {
  connectionString: string;
  max?: number;
  supervise?: boolean;
  schedule?: boolean;
};

/**
 * The ONE constructor. `schema`/`migrate` are not options on purpose — every instance in this
 * codebase must agree on them or the "runtime issues no DDL" property is only true by accident.
 */
export function createBoss(opts: CreateBossOptions): PgBoss {
  return new PgBoss({
    connectionString: opts.connectionString,
    schema: 'pgboss',
    migrate: false,
    max: opts.max ?? 2,
    supervise: opts.supervise ?? true,
    schedule: opts.schedule ?? true,
  });
}

/**
 * The ONE queue policy in this codebase. `singletonKey` is only enforced through policy-specific
 * partial unique indexes (`job_i1` for `short`, …); on the default `standard` policy a key hits no
 * index and two `send` calls with the same key produce two jobs (phase-1 review WR-03). `short`
 * means: at most ONE job per `(queue, singletonKey)` in the `created` state — a retried request
 * that re-enqueues the same key while the first job is still waiting is a no-op (`send` returns
 * `null`). Once the job is active or done, the same key may be enqueued again.
 */
export const QUEUE_POLICY = 'short' as const;

/**
 * Creates every queue with `QUEUE_POLICY`, from the ONE place both processes call (the worker at
 * start, the API on its first lazy enqueue). `createQueue` is idempotent — pg-boss's `create_queue`
 * is `INSERT … ON CONFLICT DO NOTHING` — which is what makes two workers booting together safe.
 *
 * That same `DO NOTHING` is why the policy is verified afterwards: a queue row created earlier with
 * another policy silently keeps it, pg-boss refuses to change a policy after creation, and the
 * idempotency `enqueueInTx` documents would then not exist. Failing here is loud on purpose: the fix
 * is `boss.deleteQueue(name)` (or `delete from pgboss.queue where name = …`) and a restart.
 */
export async function createQueues(boss: PgBoss, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await boss.createQueue(name, { policy: QUEUE_POLICY });
  }
  if (names.length === 0) return;
  const queues = await boss.getQueues([...names]);
  const wrong = queues
    .filter((queue) => queue.policy !== QUEUE_POLICY)
    .map((queue) => `${queue.name} is '${queue.policy}'`);
  if (wrong.length > 0) {
    throw new Error(
      `pg-boss queue policy mismatch: ${wrong.join(', ')} (expected '${QUEUE_POLICY}'). ` +
        'A policy cannot be changed after creation: delete the queue row and restart.',
    );
  }
}

let apiBoss: PgBoss | null = null;
let apiBossStarted: Promise<PgBoss> | null = null;

/**
 * The API-side process singleton: no supervision, no scheduling, one connection — it only ever
 * writes jobs; the `ROLE=worker` process does the polling and maintenance.
 */
export function getBoss(): PgBoss {
  apiBoss ??= createBoss({
    connectionString: env.DATABASE_URL,
    max: 1,
    supervise: false,
    schedule: false,
  });
  return apiBoss;
}

/**
 * Started on FIRST enqueue, never at boot. The queue creation here is the API's half of the
 * concurrency story: `createQueues` is idempotent, so the worker doing the same at its own start
 * (and a second worker instance booting simultaneously) is safe, and `send` can never target a
 * queue that does not exist yet.
 */
async function startedBoss(): Promise<PgBoss> {
  apiBossStarted ??= (async () => {
    const boss = getBoss();
    await boss.start();
    await createQueues(boss, [...queueNames]);
    return boss;
  })();
  return apiBossStarted;
}

/**
 * Enqueue INSIDE the caller's transaction (A17: `fromDrizzle(tx, sql)`, verified against
 * pg-boss 12.31.0 `dist/adapters/drizzle.d.ts`). Use `singletonKey` for natural idempotency —
 * the example module keys on the item id (threat T-07-04). That idempotency exists ONLY because
 * every queue is created with `QUEUE_POLICY = 'short'` (see `createQueues`): the second enqueue of
 * a key whose job is still `created` is dropped by the `job_i1` partial unique index and `send`
 * returns `null`. On a `standard` queue the same call would insert a second job.
 *
 * The role dance is deliberate. `withTenantTx` runs as `authenticated`, and `authenticated` has NO
 * privileges on schema `pgboss` (the migration revokes them): a queue row is infrastructure, not
 * tenant data, and nothing reachable from the tenant lane should be able to read other tenants' job
 * payloads. So the enqueue — and only the enqueue — switches to the connection role that the
 * migration did grant, then restores whatever role the caller was in. Both switches are `LOCAL`, so
 * they die with the transaction, and the insert still rolls back with the caller's write.
 *
 * The restore runs on the SUCCESS path only (phase-1 review WR-02). If `boss.send` failed because
 * Postgres rejected the insert (constraint, missing queue, privilege), the transaction is already in
 * the aborted state: a `set local role` there fails with `current transaction is aborted` and that
 * second error would replace the real one on its way to the caller and the logs. Nothing needs
 * restoring on that path either — the caller's transaction is being rolled back and the LOCAL
 * setting dies with it.
 */
export async function enqueueInTx(
  tx: Tx,
  name: string,
  payload: object,
  opts: { singletonKey?: string } = {},
): Promise<string | null> {
  const boss = await startedBoss();
  const rows = (await tx.execute(sql`select current_role as role`)) as unknown as {
    role: string;
  }[];
  const callerRole = rows[0]?.role;
  await tx.execute(sql`set local role api_user`);
  // No try/finally on purpose: on failure the transaction is aborted, so the original error must
  // propagate untouched (see the docblock).
  const id = await boss.send(name, payload, { db: fromDrizzle(tx, sql), ...opts });
  if (callerRole && callerRole !== 'api_user') {
    await tx.execute(sql`set local role ${sql.identifier(callerRole)}`);
  }
  return id;
}

/** Stops the lazily-started API instance (tests and graceful shutdown). */
export async function stopBoss(): Promise<void> {
  if (!apiBossStarted) return;
  const boss = await apiBossStarted;
  apiBossStarted = null;
  apiBoss = null;
  await boss.stop({ graceful: false });
}
