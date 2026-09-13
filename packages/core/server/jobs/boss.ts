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
 * concurrency story: `createQueue` is idempotent, so the worker doing the same at its own start
 * (and a second worker instance booting simultaneously) is safe, and `send` can never target a
 * queue that does not exist yet.
 */
async function startedBoss(): Promise<PgBoss> {
  apiBossStarted ??= (async () => {
    const boss = getBoss();
    await boss.start();
    for (const name of queueNames) await boss.createQueue(name);
    return boss;
  })();
  return apiBossStarted;
}

/**
 * Enqueue INSIDE the caller's transaction (A17: `fromDrizzle(tx, sql)`, verified against
 * pg-boss 12.31.0 `dist/adapters/drizzle.d.ts`). Use `singletonKey` for natural idempotency —
 * the example module keys on the item id (threat T-07-04).
 */
export async function enqueueInTx(
  tx: Tx,
  name: string,
  payload: object,
  opts: { singletonKey?: string } = {},
): Promise<string | null> {
  const boss = await startedBoss();
  return boss.send(name, payload, { db: fromDrizzle(tx, sql), ...opts });
}

/** Stops the lazily-started API instance (tests and graceful shutdown). */
export async function stopBoss(): Promise<void> {
  if (!apiBossStarted) return;
  const boss = await apiBossStarted;
  apiBossStarted = null;
  apiBoss = null;
  await boss.stop({ graceful: false });
}
