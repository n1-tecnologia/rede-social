import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { env } from '../../env';
import { createBoss } from '../../jobs/boss';
import { open } from '../../secrets/sealed';
import { supabaseAdminFor } from '../../supabase-admin';
import type { ProjectRecord } from '../../tenancy/project-registry';
import { openDdlSql } from '../ddl';
import { type StoragePort, supabaseStoragePort } from './copy-storage';
import type { MoveRow, MoveState, MoveStore } from './state';
import type { TargetDeps } from './target';
import type { MoveSide } from './types';

/**
 * What a move needs at hand (09.2-23): the move row, the two projects, the two database sides and the seams a
 * test replaces. The SOURCE side is opened read only and stays so for every path except `--confirm-delete`,
 * which opens its own writable client (PR-6). The pg-boss instances are opened on first use and closed with
 * the context, so a dry run or a status call never connects to a queue.
 */

export type StatusSetter = (
  tenantId: string,
  status: 'active' | 'suspended',
  actor: string,
  moveId: string,
) => Promise<void>;

export type MoveDeps = {
  /** Provider, production flag, bootstrap seams (a test maps the fake provider to a local database). */
  target?: TargetDeps;
  /** Opens a project's database as `postgres`. Default `openDdlSql` (the sealed DDL URL, or the central one). */
  openSql?: (project: ProjectRecord, options: { readOnly: boolean }) => Sql;
  /** Storage of a project (list, download, upload, info). Default: its service-key client. */
  storage?: (project: ProjectRecord) => StoragePort;
  /** A STARTED tenant-scope pg-boss for a project. Default: `createBoss` on its transaction URL. */
  bossFor?: (project: ProjectRecord) => Promise<PgBoss>;
  /** Status changes go through the kernel (`setTenantStatus`) by default; tests may observe. */
  setStatus?: StatusSetter;
  /** The clock; every real wait of the tool goes through it. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after every COMMITTED transition. A hook that throws simulates a crash at that boundary. */
  afterState?: (state: MoveState, move: MoveRow) => void | Promise<void>;
  /** The owner id of this runner's lease. */
  newOwner?: () => string;
  /** The store of the state machine (the platform lane by default). */
  store?: MoveStore;
  /** Test seam: deletes an account of a project (default: the Admin API of the project). */
  deleteAccount?: (project: ProjectRecord, userId: string) => Promise<void>;
  /** Test seam: removes Storage objects of a project (default: its service-key client). */
  purgeStorage?: (project: ProjectRecord, bucket: string, keys: readonly string[]) => Promise<void>;
  /** Rows per insert of the copy (tests lower it). */
  batchSize?: number;
};

export type MoveWaits = { quiesceMs: number; registryWaitMs: number };

export type MoveContext = {
  move: MoveRow;
  tenant: { id: string; slug: string };
  sourceProject: ProjectRecord;
  targetProject: ProjectRecord;
  /** Read only. */
  source: MoveSide;
  /** Writable (the copy writes here and nowhere else). */
  target: MoveSide;
  waits: MoveWaits;
  deps: MoveDeps;
  sleep: (ms: number) => Promise<void>;
  bosses: () => Promise<{ source: PgBoss; target: PgBoss }>;
  close: () => Promise<void>;
};

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** A pg-boss on the project's transaction URL (project 0: `DATABASE_URL`), started, tenant scope, no polling. */
export async function defaultBossFor(project: ProjectRecord): Promise<PgBoss> {
  let url: string;
  if (project.isCentral || project.credentialSource === 'env') {
    url = env.DATABASE_URL;
  } else {
    if (!project.databaseUrlTxSealed) throw new Error('the project has no transaction url');
    url = open(project.databaseUrlTxSealed, `${project.id}:database_url_tx`);
  }
  const boss = createBoss({
    connectionString: url,
    max: 1,
    supervise: false,
    schedule: false,
    scope: 'tenant',
  });
  boss.on('error', () => undefined);
  await boss.start();
  return boss;
}

export function defaultStorage(project: ProjectRecord): StoragePort {
  return supabaseStoragePort(supabaseAdminFor(project));
}

export async function openContext(input: {
  move: MoveRow;
  tenant: { id: string; slug: string };
  sourceProject: ProjectRecord;
  targetProject: ProjectRecord;
  waits: MoveWaits;
  deps: MoveDeps;
}): Promise<MoveContext> {
  const { deps } = input;
  const openSql = deps.openSql ?? ((project, o) => openDdlSql(project, { readOnly: o.readOnly }));
  const sourceSql = openSql(input.sourceProject, { readOnly: true });
  let targetSql: Sql;
  try {
    targetSql = openSql(input.targetProject, { readOnly: false });
  } catch (error) {
    await sourceSql.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }

  const bossFor = deps.bossFor ?? defaultBossFor;
  let started: Promise<{ source: PgBoss; target: PgBoss }> | undefined;
  const opened: PgBoss[] = [];
  const bosses = (): Promise<{ source: PgBoss; target: PgBoss }> => {
    started ??= (async () => {
      const source = await bossFor(input.sourceProject);
      opened.push(source);
      const target = await bossFor(input.targetProject);
      opened.push(target);
      return { source, target };
    })();
    return started;
  };

  return {
    move: input.move,
    tenant: input.tenant,
    sourceProject: input.sourceProject,
    targetProject: input.targetProject,
    source: { sql: sourceSql, tenantId: input.tenant.id, projectId: input.sourceProject.id },
    target: { sql: targetSql, tenantId: input.tenant.id, projectId: input.targetProject.id },
    waits: input.waits,
    deps,
    sleep: deps.sleep ?? realSleep,
    bosses,
    async close() {
      for (const boss of opened) await boss.stop({ graceful: false }).catch(() => undefined);
      await Promise.all([
        sourceSql.end({ timeout: 5 }).catch(() => undefined),
        targetSql.end({ timeout: 5 }).catch(() => undefined),
      ]);
    },
  };
}
