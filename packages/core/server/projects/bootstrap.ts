import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { projectBootstrapSteps, projects, tenantMoves, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { moduleLogger } from '../logging';
import { invalidateProject, resolveProjectById } from '../tenancy/project-registry';
import { invalidateTenantHost } from '../tenancy/tenant-host';
import { enqueueBootstrap } from './bootstrap-job';
import { getProjectProviderFor, type ProviderProject } from './provider-for';
import { BOOTSTRAP_STEPS, type BootstrapReason, type BootstrapStep, reasonOf } from './reasons';
import {
  BootstrapStepError,
  type BoundTenant,
  defaultStepDeps,
  STEP_RUNNERS,
  type StepContext,
  type StepDeps,
} from './steps';
import { type ProjectProvider, ProjectProviderError } from './types';

export { BOOTSTRAP_STEPS, type BootstrapStep };

/**
 * The bootstrap engine (09.2-13, DBT-17/18/19, D-542): turns "an empty Supabase project that the platform
 * may use" into a ready tenant database through eight recorded, idempotent, resumable steps.
 *
 *  - `startBootstrap` writes the eight `pending` rows (once) and enqueues the durable platform job;
 *  - `runBootstrap` is what the job runs: it walks `BOOTSTRAP_STEPS` in their FIXED order from the first
 *    step that is not `done`, CLAIMING each one with a conditional UPDATE so a second job for the same
 *    project (a double click on "Tentar de novo") gets zero rows and returns `skipped` instead of executing
 *    a step twice (P35). No session-level lock is used, so a transaction pooler cannot lose it;
 *  - a step that throws is stored `failed` with its attempt and a reason CODE from the closed catalog
 *    (`reasons.ts`), never provider text, and the run stops there; the project stays `preparing`, so the
 *    shell answers `preparing` and `requireAuth` refuses with TENANT_PREPARING until the eighth step passes;
 *  - `resumeBootstrap` puts the failed step back to `pending` and enqueues again; every `done` step is kept;
 *  - the eighth step passing sets `state = 'ready'` and drops the cached binding and the host cache of the
 *    project's tenants, in the same breath (DBT-19).
 *
 * Credentials never travel through this file: the job payload is `{ projectId }`, the step rows hold keys,
 * numbers and codes, and every log line is built from ids, step keys, attempts and reason codes. A failed
 * step's line also names the error's class and, for a provider error, its kind, status and code, never the
 * message.
 */

const log = moduleLogger('project-bootstrap');

/** A `running` step older than this is a crashed worker's: reclaimable (T-09.2-65). */
export const STEP_LEASE_MINUTES = 15;

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export type StepRow = {
  projectId: string;
  step: BootstrapStep;
  status: StepStatus;
  attempt: number;
  reasonCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type BootstrapDeps = Partial<StepDeps> & {
  /** The provider, resolved lazily so a process that never bootstraps never needs `PROJECT_PROVIDER`. */
  provider?: ProjectProvider | (() => Promise<ProjectProvider>);
  /**
   * The tenants whose `tenants`/`tenant_modules` rows the `tenant` step seeds and whose pending invite the
   * `invite` step creates (09.2-22). Default: the tenants bound to the project, exactly as before. A MOVE
   * target has no binding yet (the tenant stays bound to its source until the cutover). Since 09.2-23 the
   * default is the bound tenants PLUS the tenants of an open move that targets the project (bound first, no
   * duplicates), so a move target is bootstrapped without the caller naming anything; a caller that does name
   * the tenants replaces the default. An empty list still fails closed with reason `unknown`.
   */
  tenantsToSeed?: (projectId: string) => Promise<string[]>;
};

export type RunOutcome =
  | { status: 'ready' }
  | { status: 'failed'; step: BootstrapStep; reason: BootstrapReason }
  | { status: 'skipped'; step: BootstrapStep | null }
  | { status: 'not_applicable' };

const stepIndex = (step: string): number => BOOTSTRAP_STEPS.indexOf(step as BootstrapStep);

// ---------------------------------------------------------------------------------------------------------
// Step rows
// ---------------------------------------------------------------------------------------------------------

async function insertRows(tx: Tx, projectId: string): Promise<void> {
  await tx
    .insert(projectBootstrapSteps)
    .values(BOOTSTRAP_STEPS.map((step) => ({ projectId, step })))
    .onConflictDoNothing();
}

/** The eight rows in the fixed order of `BOOTSTRAP_STEPS`, whatever the insertion order or timestamps (P34). */
export async function listSteps(projectId: string): Promise<StepRow[]> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select()
      .from(projectBootstrapSteps)
      .where(eq(projectBootstrapSteps.projectId, projectId))
      .orderBy(asc(projectBootstrapSteps.step)),
  );
  return rows
    .map((row) => ({ ...row, step: row.step as BootstrapStep, status: row.status as StepStatus }))
    .sort((a, b) => stepIndex(a.step) - stepIndex(b.step));
}

/**
 * Claims one step for this run: `pending` or `failed` becomes `running` with the attempt counted, a `running`
 * step older than the lease is reclaimed, anything else yields zero rows (`null`): another run holds it, or it
 * is already `done` (P35).
 */
export async function claimStep(
  projectId: string,
  step: BootstrapStep,
): Promise<{ attempt: number } | null> {
  const rows = (await withPlatformTx((tx) =>
    tx.execute(sql`
      update platform.project_bootstrap_steps
         set status = 'running', started_at = now(), finished_at = null,
             attempt = attempt + 1, reason_code = null
       where project_id = ${projectId}::uuid and step = ${step}
         and (status in ('pending', 'failed')
              or (status = 'running'
                  and started_at < now() - make_interval(mins => ${STEP_LEASE_MINUTES})))
       returning attempt`),
  )) as unknown as { attempt: number }[];
  const row = rows[0];
  return row ? { attempt: row.attempt } : null;
}

/**
 * `started_at` is stamped by the DATABASE clock (`claimStep`), so `finished_at` is too: a process clock that
 * differs by a millisecond would put step N's end after step N+1's start (found in plans 11 and 14).
 */
async function finishStep(projectId: string, step: BootstrapStep): Promise<void> {
  await withPlatformTx((tx) =>
    tx
      .update(projectBootstrapSteps)
      .set({ status: 'done', finishedAt: sql`now()`, reasonCode: null })
      .where(
        and(eq(projectBootstrapSteps.projectId, projectId), eq(projectBootstrapSteps.step, step)),
      ),
  );
}

async function failStep(
  projectId: string,
  step: BootstrapStep,
  reason: BootstrapReason,
): Promise<void> {
  await withPlatformTx((tx) =>
    tx
      .update(projectBootstrapSteps)
      .set({ status: 'failed', finishedAt: sql`now()`, reasonCode: reason })
      .where(
        and(eq(projectBootstrapSteps.projectId, projectId), eq(projectBootstrapSteps.step, step)),
      ),
  );
}

// ---------------------------------------------------------------------------------------------------------
// start / resume
// ---------------------------------------------------------------------------------------------------------

/**
 * Registers the eight `pending` rows (a second call leaves eight, P33) and enqueues the platform job with the
 * payload `{ projectId }` only. Both happen in one platform transaction: a rolled-back call leaves no job.
 */
export async function startBootstrap(projectId: string): Promise<{ jobId: string | null }> {
  return withPlatformTx((tx) => startBootstrapInTx(tx, projectId));
}

/**
 * `startBootstrap` inside the caller's PLATFORM transaction (09.2-14, D-541): the create call registers the
 * project, binds the tenant, stores the first-admin input and queues the job in ONE transaction, so a rolled
 * back create leaves neither a tenant nor a job behind. Same rows, same payload, same singleton.
 */
export async function startBootstrapInTx(
  tx: Tx,
  projectId: string,
): Promise<{ jobId: string | null }> {
  await insertRows(tx, projectId);
  return { jobId: await enqueueBootstrap(tx, projectId) };
}

/**
 * "Tentar de novo": the failed step goes back to `pending` (its reason cleared), every `done` step is kept,
 * and the job is enqueued again. Singleton-keyed by project, so a double click queues at most one waiting job;
 * a run that is already active makes the second one return `skipped` at the claim.
 */
export async function resumeBootstrap(projectId: string): Promise<{ jobId: string | null }> {
  return withPlatformTx(async (tx) => {
    await insertRows(tx, projectId);
    await tx
      .update(projectBootstrapSteps)
      .set({ status: 'pending', reasonCode: null })
      .where(
        and(
          eq(projectBootstrapSteps.projectId, projectId),
          eq(projectBootstrapSteps.status, 'failed'),
        ),
      );
    return { jobId: await enqueueBootstrap(tx, projectId) };
  });
}

// ---------------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------------

async function boundTenants(projectId: string): Promise<BoundTenant[]> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ tenantId: tenantProjects.tenantId, pendingInvite: tenantProjects.pendingInvite })
      .from(tenantProjects)
      .where(eq(tenantProjects.projectId, projectId))
      .orderBy(asc(tenantProjects.tenantId)),
  );
  return rows.map((row) => ({ tenantId: row.tenantId, pendingInvite: row.pendingInvite ?? null }));
}

/**
 * The tenants of an OPEN move that targets the project (09.2-23): the target has no binding yet, the tenant
 * stays bound to its source until the cutover, and the target still has to be seeded for it.
 */
async function movingTenants(projectId: string): Promise<string[]> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ tenantId: tenantMoves.tenantId })
      .from(tenantMoves)
      .where(
        and(
          eq(tenantMoves.toProjectId, projectId),
          notInArray(tenantMoves.state, ['done', 'rolled_back']),
        ),
      )
      .orderBy(asc(tenantMoves.startedAt), asc(tenantMoves.tenantId)),
  );
  return rows.map((row) => row.tenantId);
}

/**
 * The tenants this run seeds: by default the ones bound to the project and then the tenants of an open move
 * that targets it; or exactly the ids the caller names. A named tenant that is also bound keeps its pending
 * invite; one with no binding has none.
 */
async function tenantsOf(projectId: string, deps: BootstrapDeps): Promise<BoundTenant[]> {
  const bound = await boundTenants(projectId);
  const named = deps.tenantsToSeed
    ? await deps.tenantsToSeed(projectId)
    : [...bound.map((entry) => entry.tenantId), ...(await movingTenants(projectId))];
  return [...new Set(named)].map(
    (tenantId) =>
      bound.find((entry) => entry.tenantId === tenantId) ?? { tenantId, pendingInvite: null },
  );
}

/** DBT-19: the project is `ready`; the cached binding and the host answers of its tenants are dropped at once. */
async function finalize(projectId: string, tenants: BoundTenant[]): Promise<void> {
  await withPlatformTx((tx) =>
    tx
      .update(projects)
      .set({ state: 'ready', updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.state, 'preparing'))),
  );
  invalidateProject();
  const hosts = await withPlatformTx(async (tx) => {
    const found: string[] = [];
    for (const bound of tenants) {
      const rows = await tx
        .select({ host: tenantDomains.host })
        .from(tenantDomains)
        .where(eq(tenantDomains.tenantId, bound.tenantId));
      for (const row of rows) found.push(row.host);
    }
    return found;
  });
  for (const host of hosts) invalidateTenantHost(host);
}

async function resolveProvider(
  deps: BootstrapDeps,
  project: ProviderProject,
): Promise<ProjectProvider> {
  const given = deps.provider;
  if (given && typeof given !== 'function') return given;
  if (typeof given === 'function') return given();
  // A customer project runs on its OWN token (09.4-06, D-566): the platform singleton below would silently
  // have sent the platform token to an account that is not ours (T-09.4-19). Platform projects keep the
  // direct singleton import byte for byte.
  if (project.owner === 'customer') return getProjectProviderFor(project);
  // The singleton module throws in production without `PROJECT_PROVIDER=supabase`: loaded on demand, so
  // booting a worker that never bootstraps does not depend on it.
  return (await import('./index')).projectProvider;
}

function stepDeps(deps: BootstrapDeps): StepDeps {
  const base = defaultStepDeps();
  return {
    connect: deps.connect ?? base.connect,
    secrets: deps.secrets ?? base.secrets,
    config: deps.config ?? base.config,
    loadTenantSet: deps.loadTenantSet ?? base.loadTenantSet,
    readRolesSql: deps.readRolesSql ?? base.readRolesSql,
    sendInvites: deps.sendInvites ?? base.sendInvites,
  };
}

/**
 * What the `step_failed` line says about the thrown value, so the several causes that end in one reason code
 * can be told apart. Identifiers only, from a closed set: the class name (the constructor's, never the
 * instance's own name, which a provider or a bug can overwrite), and for a `ProjectProviderError` its kind,
 * status and code. The error's message, stack, cause and any response body are never read (D-539, the rule
 * in `reasonOf`).
 */
function failureFields(error: unknown): {
  errorName: string;
  kind?: string;
  status?: number;
  code?: string;
} {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const constructorName = error.constructor?.name;
  const errorName =
    typeof constructorName === 'string' && constructorName !== '' ? constructorName : 'Error';
  if (!(error instanceof ProjectProviderError)) return { errorName };
  return {
    errorName,
    kind: error.kind,
    status: error.status,
    ...(error.code !== undefined ? { code: error.code } : {}),
  };
}

/**
 * Drives the project through the steps. Never throws for a step failure (it is recorded and returned), so the
 * job handler stays a thin wrapper. Project 0 (`credential_source = 'env'`) is never bootstrapped and its
 * credentials are never replaced by these steps.
 */
export async function runBootstrap(
  projectId: string,
  deps: BootstrapDeps = {},
): Promise<RunOutcome> {
  const first = await resolveProjectById(projectId);
  if (!first || first.isCentral || first.credentialSource === 'env') {
    return { status: 'not_applicable' };
  }

  await withPlatformTx((tx) => insertRows(tx, projectId));
  const rows = await listSteps(projectId);
  const tenants = await tenantsOf(projectId, deps);

  if (rows.every((row) => row.status === 'done')) {
    if (first.state === 'preparing') await finalize(projectId, tenants);
    return { status: 'ready' };
  }

  const firstOpen = rows.find((row) => row.status !== 'done')?.step ?? BOOTSTRAP_STEPS[0];

  // A project nobody is bound to has no tenant to serve and nothing to copy: fail closed before any database
  // is touched.
  if (tenants.length === 0) {
    const claimed = await claimStep(projectId, firstOpen);
    if (!claimed) return { status: 'skipped', step: firstOpen };
    await failStep(projectId, firstOpen, 'unknown');
    log.warn(
      { event: 'project.bootstrap.step_failed', projectId, step: firstOpen, reason: 'unknown' },
      'bootstrap refused: no tenant is bound to the project',
    );
    return { status: 'failed', step: firstOpen, reason: 'unknown' };
  }

  const resolved = stepDeps(deps);
  const attempts = Object.fromEntries(rows.map((row) => [row.step, row.attempt])) as Record<
    BootstrapStep,
    number
  >;

  for (const step of BOOTSTRAP_STEPS) {
    const row = rows.find((candidate) => candidate.step === step);
    if (row?.status === 'done') continue;

    const claimed = await claimStep(projectId, step);
    if (!claimed) return { status: 'skipped', step };
    log.info(
      { event: 'project.bootstrap.step_started', projectId, step, attempt: claimed.attempt },
      'bootstrap step started',
    );

    try {
      const project = await resolveProjectById(projectId);
      if (!project) throw new BootstrapStepError('unknown');
      const provider = await resolveProvider(deps, project);
      const context: StepContext = {
        project,
        tenants,
        provider,
        deps: resolved,
        attempts,
      };
      await STEP_RUNNERS[step](context);
    } catch (error) {
      const reason = error instanceof BootstrapStepError ? error.reason : reasonOf(error, step);
      await failStep(projectId, step, reason);
      log.warn(
        {
          event: 'project.bootstrap.step_failed',
          projectId,
          step,
          attempt: claimed.attempt,
          reason,
          ...failureFields(error),
        },
        'bootstrap step failed',
      );
      return { status: 'failed', step, reason };
    }

    await finishStep(projectId, step);
    log.info(
      { event: 'project.bootstrap.step_done', projectId, step, attempt: claimed.attempt },
      'bootstrap step done',
    );
  }

  await finalize(projectId, tenants);
  log.info({ event: 'project.bootstrap.ready', projectId }, 'project is ready');
  return { status: 'ready' };
}
