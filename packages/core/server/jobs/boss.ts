import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { type TxLane, txContextOf } from '../../db/project-handle';
import type { ProjectHandle } from '../../db/project-pools';
import type { Tx } from '../../db/tenant-tx';
import { env } from '../env';
import { open } from '../secrets/sealed';
import type { ProjectRecord } from '../tenancy/project-registry';
import { bossConnectionString } from './connection';

/**
 * pg-boss wiring (discretion item resolved in 01-07; per-project since 09.2-09, D-546).
 *
 * Properties this file exists to guarantee:
 *  1. **The runtime never issues DDL.** `migrate: false` + a schema chosen from a closed set
 *     (`pgboss` for tenant queues, `pgboss_platform` for platform queues): both are reviewed migrations
 *     (`*_pgboss_schema.sql` in the tenant set, `*_pgboss_platform_schema.sql` in the central set), so
 *     `api_user` needs DML only (threat T-07-05). A pg-boss upgrade means a NEW custom migration for both,
 *     never `migrate: true`.
 *  2. **The API never touches pg-boss at boot.** A sender is created and started lazily by the first
 *     `enqueueInTx` that needs it; `apps/api/src/main.ts` reaches nothing here in the `ROLE=api` branch,
 *     which is what keeps `GET /v1/health` answering with an unreachable database (the 01-09 DB-free-boot
 *     property).
 *  3. **Enqueue is transactional.** `fromDrizzle(tx, sql)` routes the insert through the caller's
 *     Drizzle transaction, so a rolled-back write takes its job with it.
 *  4. **A job lands in the database of the transaction that enqueued it (D-546, T-09.2-40).** pg-boss
 *     `send` reads the queue's definition from the SENDER's own database before inserting through the
 *     caller's transaction (pg-boss 12.31.0 `manager.js`), so one process-wide sender is only correct while
 *     there is one database. The sender is therefore chosen from the transaction itself: every lane records
 *     `{ handle, lane }` in `projectOfTx`, and `senderFor` keeps one lazily started sender per
 *     project, credential version and scope.
 *  5. **A queue has a scope, and a lane may only write to the queues of its scope.** Platform queues
 *     (domain checks, invite sends, the mirror reconcile, later the project bootstrap and health) carry
 *     control-plane facts and live in `pgboss_platform` of the central project; they are enqueued from
 *     `withPlatformTx` and never from a tenant transaction. Tenant queues live in `pgboss` of the project
 *     that owns the tenant, enqueued from a tenant or admin transaction. A mismatch throws before any insert.
 */

/** Where a queue lives: the control plane (`pgboss_platform`, central) or a tenant's own project (`pgboss`). */
export type JobScope = 'platform' | 'tenant';

const SCHEMA_OF_SCOPE: Record<JobScope, string> = {
  platform: 'pgboss_platform',
  tenant: 'pgboss',
};

/** Queue names the app tier owns, registered by `apps/api/src/modules/registry.ts` (MOD-02: the kernel never imports a module). */
const queueScopes = new Map<string, JobScope>();

/**
 * Idempotent: adding the same queue name twice with the same scope is a no-op; registering it again with
 * ANOTHER scope throws, because a queue cannot live in both schemas without one of them losing its jobs.
 * Called at registry import time.
 */
export function registerJobQueues(names: readonly string[], scope: JobScope = 'tenant'): void {
  for (const name of names) {
    const known = queueScopes.get(name);
    if (known !== undefined && known !== scope) {
      throw new Error(`queue ${name} is already registered as a ${known} queue`);
    }
    queueScopes.set(name, scope);
  }
}

/** Every queue name registered so far (of one scope when given) — a worker creates one queue per entry at start. */
export function registeredJobQueues(scope?: JobScope): string[] {
  return [...queueScopes]
    .filter(([, queueScope]) => scope === undefined || queueScope === scope)
    .map(([name]) => name);
}

/** The scope a queue was registered with, `undefined` for a name nobody registered. */
export function queueScope(name: string): JobScope | undefined {
  return queueScopes.get(name);
}

/**
 * The guard (T-09.2-40): a platform queue needs a platform transaction, a tenant queue a tenant or an admin
 * one. Throws before anything is written; an unregistered name is refused too, because no worker creates it.
 */
export function assertQueueScope(name: string, lane: TxLane): JobScope {
  const scope = queueScopes.get(name);
  if (scope === undefined) throw new Error(`enqueueInTx: ${name} is not a registered queue`);
  const allowed =
    scope === 'platform' ? lane === 'platform' : lane === 'tenant' || lane === 'admin';
  if (!allowed) throw new Error(`enqueueInTx: ${name} is a ${scope} queue`);
  return scope;
}

export type CreateBossOptions = {
  connectionString: string;
  max?: number;
  supervise?: boolean;
  schedule?: boolean;
  /** Which schema family the instance works: `tenant` (default, `pgboss`) or `platform` (`pgboss_platform`). */
  scope?: JobScope;
};

/**
 * The ONE constructor. `schema`/`migrate` are not options on purpose — every instance in this
 * codebase must agree on them or the "runtime issues no DDL" property is only true by accident. The scope
 * picks the schema from a closed set; no option accepts a schema string.
 */
export function createBoss(opts: CreateBossOptions): PgBoss {
  return new PgBoss({
    connectionString: bossConnectionString(opts.connectionString),
    schema: SCHEMA_OF_SCOPE[opts.scope ?? 'tenant'],
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

type Sender = { projectId: string; scope: JobScope; started: Promise<PgBoss> };

/** One sender per `${projectId}:${credentialVersion}:${scope}`, created on first use and kept until `stopBoss`. */
const senders = new Map<string, Sender>();

/**
 * The URL a sender connects with: the transaction-pooler URL of the project (project 0: `DATABASE_URL`, a
 * tenant project: its sealed `database_url_tx`). The registry and the sealed-value helper are imported on
 * demand so that loading this file (every module imports it) pulls neither the registry nor the keyring.
 */
async function senderConnectionString(handle: ProjectHandle): Promise<string> {
  if (handle.kind === 'central') return env.DATABASE_URL;
  const { resolveProjectById } = await import('../tenancy/project-registry');
  const project = await resolveProjectById(handle.projectId);
  if (!project?.databaseUrlTxSealed) {
    throw new Error('enqueueInTx: the project has no transaction url');
  }
  return open(project.databaseUrlTxSealed, `${project.id}:database_url_tx`);
}

/**
 * The SESSION-mode URL a supervised polling instance connects with (the worker holds long-lived listeners):
 * `centralUrl` for the project whose credentials live in the environment (project 0), the sealed
 * `database_url_session` of any other. Throws when a tenant project has none, so the supervisor backs that
 * project off instead of polling through the wrong database. Never logged.
 */
export function sessionConnectionString(
  project: Pick<ProjectRecord, 'id' | 'credentialSource' | 'databaseUrlSessionSealed'>,
  centralUrl: string,
): string {
  if (project.credentialSource === 'env') return centralUrl;
  if (!project.databaseUrlSessionSealed) {
    throw new Error('the project has no session url');
  }
  return open(project.databaseUrlSessionSealed, `${project.id}:database_url_session`);
}

/**
 * The API-side sender of one project and scope: no supervision, no scheduling, one connection — it only ever
 * reads the queue cache and lets the caller's transaction insert; the worker's supervisor does the polling and
 * the maintenance. Started on FIRST use, never at boot, with the queues of its scope created idempotently
 * (`createQueues` is `INSERT … ON CONFLICT DO NOTHING`, so a worker doing the same at its own start, or a
 * second instance, converges on the same rows), so `send` can never target a queue that does not exist yet.
 * A new credential version of a project replaces its older senders (the old connection is closed behind it).
 * A sender whose start failed is forgotten, so the next enqueue tries again instead of replaying the failure.
 */
export function senderFor(handle: ProjectHandle, scope: JobScope): Promise<PgBoss> {
  const key = `${handle.projectId}:${handle.credentialVersion}:${scope}`;
  const known = senders.get(key);
  if (known) return known.started;

  for (const [otherKey, other] of senders) {
    if (other.projectId === handle.projectId && other.scope === scope) {
      senders.delete(otherKey);
      void other.started.then(
        (boss) => boss.stop({ graceful: false }),
        () => undefined,
      );
    }
  }

  const started = (async () => {
    const boss = createBoss({
      connectionString: await senderConnectionString(handle),
      max: 1,
      supervise: false,
      schedule: false,
      scope,
    });
    // An idle error on the sender's socket must not crash the process; the next `send` surfaces a real failure.
    boss.on('error', () => undefined);
    try {
      await boss.start();
      await createQueues(boss, registeredJobQueues(scope));
    } catch (error) {
      await boss.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }
    return boss;
  })();
  const sender: Sender = { projectId: handle.projectId, scope, started };
  senders.set(key, sender);
  started.catch(() => {
    if (senders.get(key) === sender) senders.delete(key);
  });
  return started;
}

/**
 * Enqueue INSIDE the caller's transaction, into the database that owns it (D-546): the project and the lane
 * come from the transaction (`txContextOf`), the sender from the project (`senderFor`), and the queue's scope
 * must match the lane (`assertQueueScope`) — a platform queue from a platform transaction, a tenant queue from
 * a tenant or admin one — or nothing is written. (A17: `fromDrizzle(tx, sql)`, verified against
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
 *
 * `startAfter` (seconds, an ISO string or a Date — pg-boss 12 accepts all three) defers the job:
 * deferred jobs are how the kernel's domain poller (`kernel.domain-verify`, 02-09) paces itself at
 * its ~10-minute cadence without a scheduler, re-arming one deferred job per host under `short`.
 *
 * `retryLimit` / `retryDelay` (seconds) / `retryBackoff` / `retryDelayMax` (seconds) are pg-boss 12's
 * per-job retry options, spread into `send` like the rest; `kernel.invite-send` (quick 260929-g0s)
 * is the first user — its handler throws on purpose so a GoTrue/hook failure is retried with a
 * bounded exponential backoff instead of pg-boss's default two immediate-ish retries.
 *
 * `deleteAfterSeconds` / `retentionSeconds` override the queue's 7-day / 14-day retention for ONE job
 * (pg-boss 12 per-job queue options): a job whose payload must not linger in `pgboss.job` (the
 * rendered push body, 07 review B-WR-02) asks for a short one.
 */
export async function enqueueInTx(
  tx: Tx,
  name: string,
  payload: object,
  opts: {
    singletonKey?: string;
    startAfter?: number | string | Date;
    retryLimit?: number;
    retryDelay?: number;
    retryBackoff?: boolean;
    retryDelayMax?: number;
    deleteAfterSeconds?: number;
    retentionSeconds?: number;
  } = {},
): Promise<string | null> {
  const context = txContextOf(tx);
  if (!context) throw new Error('enqueueInTx: transaction was not opened by a lane');
  const scope = assertQueueScope(name, context.lane);
  const boss = await senderFor(context.handle, scope);
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

/** The keys (`${projectId}:${credentialVersion}:${scope}`) of the senders alive right now. For tests and diagnostics. */
export function activeSenders(): string[] {
  return [...senders.keys()];
}

/** Stops every lazily-started sender (tests and graceful shutdown). */
export async function stopBoss(): Promise<void> {
  const all = [...senders.values()];
  senders.clear();
  await Promise.allSettled(
    all.map(async (sender) => {
      const boss = await sender.started;
      await boss.stop({ graceful: false });
    }),
  );
}
