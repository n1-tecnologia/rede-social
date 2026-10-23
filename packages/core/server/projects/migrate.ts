import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenants } from '../../db/schema';
import { summarize } from '../migrations/manifest';
import type { RequiredTenantSchema } from '../migrations/required';
import {
  type ApplyOptions,
  type ApplyResult,
  applyDirectory,
  MigrationError,
} from '../migrations/runner';
import {
  defaultMigrationDir,
  type MigrationFile,
  type MigrationSetName,
  readMigrationDir,
} from '../migrations/sets';
import { open } from '../secrets/sealed';
import { listReadyProjects, type ProjectRecord } from '../tenancy/project-registry';
import { ensureProjectZero } from '../tenancy/project-zero';
import {
  type AppliedCounts,
  invalidateProjectHosts,
  readAppliedSchema,
  recordSchemaState,
  type SchemaStatus,
  stateOf,
} from './schema-state';

/**
 * `migrateAll` (09.2-15, D-544, DBT-23, DBT-24): the one command that makes "a migration reaches every tenant
 * database" true.
 *
 *  1. The CENTRAL set is applied to the central project first (`MIGRATION_DATABASE_URL`). A failure there stops
 *     everything: nothing else is attempted, because the registry the next steps read is what failed.
 *  2. The TENANT set is applied to every `ready` project in ascending `ref`, project 0 included (it is a tenant
 *     project until the last move; when the CLI already applied its set the runner finds the ledger complete and
 *     only the state is recorded). Each project is its own connection and its own advisory lock (the runner's).
 *     A project that fails is recorded `failed` with its first failing version and a content-free code and never
 *     stops the others.
 *  3. Each project's applied-versus-required state is stored in `platform.project_schema_state`. A project
 *     whose applied schema is below the image's is held out (`updating`) by the host answer until it is current.
 *
 * Output is a list of JSON-able lines: the central line, one per project in ASCENDING `ref` (the printed order
 * never follows completion order), then a summary. A line holds the `ref`, counts, 14-digit versions and a
 * code; never a connection string, a statement or a driver message (PR-4, T-09.2-75).
 *
 * Exit codes: 0 ok (a tenant failure is a warning unless `strict`), 1 the central set failed or `strict` saw a
 * tenant failure, 2 a usage error (nothing changed).
 */

export type MigrateLine = Record<string, string | number | boolean | string[] | null>;

export type MigrateResult = { ok: boolean; exitCode: 0 | 1 | 2; lines: MigrateLine[] };

export type MigrateOptions = {
  /** Report the pending versions per project and write NOTHING (no ledger, no state, no registry fix-up). */
  dryRun?: boolean;
  /** Only the project of this tenant (exact slug). */
  tenantSlug?: string;
  /** Only the project with this exact `ref`. */
  projectRef?: string;
  /** Only these projects (the retry job); implies no central set. */
  projectIds?: string[];
  /** Projects migrated at the same time. Default 4. */
  concurrency?: number;
  /** A tenant failure exits 1. */
  strict?: boolean;
  /** Apply the central set and stop. */
  centralOnly?: boolean;
  deps?: Partial<MigrateDeps>;
};

export type MigrateDeps = {
  /** One connection (`max: 1`) to the central project as `postgres`. */
  connectCentral: () => Sql;
  /** One connection (`max: 1`) to a project as `postgres`; project 0 reuses the central URL. */
  connect: (project: ProjectRecord) => Sql;
  /** The files of a set; the tenant set may differ per project in a test. */
  loadFiles: (set: MigrationSetName, project?: ProjectRecord) => Promise<MigrationFile[]>;
  apply: (sql: Sql, files: MigrationFile[], options: ApplyOptions) => Promise<ApplyResult>;
  listProjects: () => Promise<ProjectRecord[]>;
  /** The project id of a tenant slug, `null` when no tenant has it. */
  projectIdOfTenant: (slug: string) => Promise<string | null>;
  ensureProjectZero: () => Promise<unknown>;
};

const LOCAL_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const SLUG_SHAPE = /^[a-z0-9-]+$/;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

/** A failure that is the fan-out's own, with a fixed code. */
class FanOutError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'FanOutError';
    this.code = code;
  }
}

/** The central URL: `MIGRATION_DATABASE_URL`, the local stack outside production, nothing in production. */
function centralUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (url && url.length > 0) return url;
  if (process.env.NODE_ENV === 'production') throw new FanOutError('credential_missing');
  return LOCAL_URL;
}

const connectOptions = { max: 1, prepare: false, connect_timeout: 15, onnotice: () => undefined };

function defaultDeps(): MigrateDeps {
  return {
    connectCentral: () => postgres(centralUrl(), connectOptions),
    connect: (project) => {
      if (project.isCentral || project.credentialSource === 'env') {
        return postgres(centralUrl(), connectOptions);
      }
      if (!project.ddlUrlSealed) throw new FanOutError('credential_missing');
      let url: string;
      try {
        url = open(project.ddlUrlSealed, `${project.id}:ddl_url`);
      } catch {
        throw new FanOutError('credential_unreadable');
      }
      return postgres(url, connectOptions);
    },
    loadFiles: (set) => readMigrationDir(defaultMigrationDir(set), set),
    apply: applyDirectory,
    listProjects: listReadyProjects,
    projectIdOfTenant: async (slug) => {
      const rows = await withPlatformTx((tx) =>
        tx
          .select({ projectId: tenantProjects.projectId })
          .from(tenants)
          .innerJoin(tenantProjects, eq(tenantProjects.tenantId, tenants.id))
          .where(eq(tenants.slug, slug))
          .limit(1),
      );
      return rows[0]?.projectId ?? null;
    },
    ensureProjectZero,
  };
}

/** A fixed code for any thrown value: never the message, which may carry a statement or an address. */
function codeOf(error: unknown): string {
  if (error instanceof MigrationError) return error.code;
  if (error instanceof FanOutError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (code === '28P01' || code === '28000') return 'credential_rejected';
    if (
      code.startsWith('ECONN') ||
      code.startsWith('CONNECT') ||
      code.startsWith('CONNECTION') ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'EAI_AGAIN'
    ) {
      return 'unreachable';
    }
  }
  return 'unexpected';
}

/** A `ref` safe to print: the registry shape, else a constant (a label can never break a line, P48). */
const printable = (ref: string): string => (/^[a-z0-9-]{1,40}$/.test(ref) ? ref : 'invalid');

const usage = (message: string): MigrateResult => ({
  ok: false,
  exitCode: 2,
  lines: [{ kind: 'usage', message }],
});

type ProjectOutcome = {
  line: MigrateLine;
  status: SchemaStatus | 'pending';
  applied: number;
};

async function closeQuietly(client: Sql | undefined): Promise<void> {
  if (client) await client.end({ timeout: 5 }).catch(() => undefined);
}

async function migrateProject(
  project: ProjectRecord,
  dryRun: boolean,
  deps: MigrateDeps,
): Promise<ProjectOutcome> {
  const ref = printable(project.ref);
  let client: Sql | undefined;
  let required: RequiredTenantSchema | null = null;
  let appliedAfter: AppliedCounts | undefined;
  let failure: {
    code: string;
    version?: string | undefined;
    sqlstate?: string | undefined;
  } | null = null;
  let result: ApplyResult | undefined;

  try {
    const files = await deps.loadFiles('tenant', project);
    required = summarize(files.map((file) => file.version));
    client = deps.connect(project);
    result = await deps.apply(client, files, { set: 'tenant', dryRun });
    if (result.errorCode) {
      failure = {
        code: result.errorCode,
        version: result.failedVersion,
        sqlstate: result.sqlstate,
      };
    }
    if (!dryRun) {
      try {
        appliedAfter = await readAppliedSchema(client);
      } catch {
        appliedAfter = undefined;
      }
    }
  } catch (error) {
    failure = {
      code: codeOf(error),
      ...(error instanceof MigrationError && error.version ? { version: error.version } : {}),
    };
    if (client && !dryRun) {
      try {
        appliedAfter = await readAppliedSchema(client);
      } catch {
        appliedAfter = undefined;
      }
    }
  } finally {
    await closeQuietly(client);
  }

  const appliedNow = result?.applied.length ?? 0;
  const base: MigrateLine = {
    kind: 'project',
    ref,
    set: 'tenant',
    dryRun,
    applied: appliedNow,
    skipped: result?.skipped ?? 0,
  };

  if (dryRun) {
    const pending = result?.pending ?? [];
    if (failure) {
      return {
        status: 'failed',
        applied: 0,
        line: { ...base, status: 'failed', errorCode: failure.code },
      };
    }
    return {
      status: pending.length > 0 ? 'pending' : 'current',
      applied: 0,
      line: { ...base, status: pending.length > 0 ? 'behind' : 'current', pending },
    };
  }

  const status: SchemaStatus = failure ? 'failed' : stateOf(appliedAfter, required);
  let stateRecorded = true;
  try {
    const { changed } = await recordSchemaState(project.id, {
      ...(appliedAfter ? { applied: appliedAfter } : {}),
      required,
      status,
      failedVersion: failure?.version ?? null,
      errorCode: failure?.code ?? null,
    });
    if (changed) await invalidateProjectHosts(project.id);
  } catch {
    stateRecorded = false;
  }

  const line: MigrateLine = {
    ...base,
    status,
    head: appliedAfter?.appliedHead ?? null,
    ledgerCount: appliedAfter?.appliedCount ?? null,
    ...(failure
      ? {
          errorCode: failure.code,
          failedVersion: failure.version ?? null,
          sqlstate: failure.sqlstate ?? null,
        }
      : {}),
    ...(stateRecorded ? {} : { stateRecorded: false }),
  };
  return { status, applied: appliedNow, line };
}

export async function migrateAll(options: MigrateOptions = {}): Promise<MigrateResult> {
  const deps: MigrateDeps = { ...defaultDeps(), ...options.deps };
  const dryRun = options.dryRun === true;
  const strict = options.strict === true;

  // Validate every argument before any query (P48).
  const requested = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_CONCURRENCY) {
    return usage(`--concurrency must be a whole number from 1 to ${MAX_CONCURRENCY}`);
  }
  if (options.tenantSlug !== undefined && !SLUG_SHAPE.test(options.tenantSlug)) {
    return usage('--tenant must be a slug of lowercase letters, digits and hyphens');
  }
  if (options.projectRef !== undefined && !SLUG_SHAPE.test(options.projectRef)) {
    return usage('--project must be a ref of lowercase letters, digits and hyphens');
  }

  // Resolve the selectors (read-only) before anything is applied: an unknown one changes nothing (P47).
  let onlyIds: Set<string> | null = options.projectIds ? new Set(options.projectIds) : null;
  if (options.tenantSlug !== undefined) {
    const projectId = await deps.projectIdOfTenant(options.tenantSlug);
    if (!projectId) return usage('no tenant has that slug');
    onlyIds = new Set([projectId]);
  }

  const ready = await deps.listProjects();
  let selected = ready;
  if (onlyIds) selected = selected.filter((project) => onlyIds?.has(project.id));
  if (options.projectRef !== undefined) {
    selected = selected.filter((project) => project.ref === options.projectRef);
  }
  if (
    (options.tenantSlug !== undefined || options.projectRef !== undefined) &&
    selected.length === 0
  ) {
    return usage('no ready project matches');
  }
  // One project once (a project bound to two tenants is listed once by the registry; guard anyway), ascending ref.
  const byId = new Map(selected.map((project) => [project.id, project]));
  const targets = [...byId.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  const lines: MigrateLine[] = [];

  // 1. The central set, first. `projectIds` (the retry job) heals tenant projects only.
  let centralStatus: 'ok' | 'failed' | 'skipped' = 'skipped';
  if (!options.projectIds) {
    if (!dryRun) {
      try {
        await deps.ensureProjectZero();
      } catch {
        // Cosmetic alignment of project 0's coordinates; never a reason to stop the fan-out.
      }
    }
    let central: Sql | undefined;
    let failure: { code: string; version?: string | undefined } | null = null;
    let result: ApplyResult | undefined;
    try {
      const files = await deps.loadFiles('central');
      central = deps.connectCentral();
      result = await deps.apply(central, files, { set: 'central', dryRun });
      if (result.errorCode) failure = { code: result.errorCode, version: result.failedVersion };
    } catch (error) {
      failure = {
        code: codeOf(error),
        ...(error instanceof MigrationError && error.version ? { version: error.version } : {}),
      };
    } finally {
      await closeQuietly(central);
    }
    centralStatus = failure ? 'failed' : 'ok';
    lines.push({
      kind: 'central',
      set: 'central',
      dryRun,
      status: centralStatus,
      applied: result?.applied.length ?? 0,
      skipped: result?.skipped ?? 0,
      ...(dryRun && result ? { pending: result.pending } : {}),
      ...(failure ? { errorCode: failure.code, failedVersion: failure.version ?? null } : {}),
    });
    if (failure) {
      lines.push({
        kind: 'summary',
        dryRun,
        central: 'failed',
        projects: 0,
        current: 0,
        failed: 0,
        applied: 0,
      });
      return { ok: false, exitCode: 1, lines };
    }
  }

  // 2. The tenant set, project by project with isolation.
  const outcomes: ProjectOutcome[] = [];
  if (!options.centralOnly) {
    const slots: ProjectOutcome[] = new Array(targets.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        next += 1;
        const project = targets[index];
        if (!project) return;
        slots[index] = await migrateProject(project, dryRun, deps);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(requested, Math.max(targets.length, 1)) }, () => worker()),
    );
    // Slots are filled by index, so the printed order is the ascending-ref order whatever finished first (P49).
    outcomes.push(...slots);
  }
  for (const outcome of outcomes) lines.push(outcome.line);

  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length;
  lines.push({
    kind: 'summary',
    dryRun,
    central: centralStatus,
    projects: outcomes.length,
    current: outcomes.filter((outcome) => outcome.status === 'current').length,
    failed,
    applied: outcomes.reduce((sum, outcome) => sum + outcome.applied, 0),
  });

  const exitCode = strict && failed > 0 ? 1 : 0;
  return { ok: exitCode === 0, exitCode, lines };
}
