import type { BootstrapReasonCode, TokenCheck, TokenState } from '@rede-social/contracts/projects';
import { eq, sql } from 'drizzle-orm';
import { projectHealth, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { withHandle } from '../../db/project-pools';
import { tenantDomains } from '../../db/schema';
import { moduleLogger } from '../logging';
import {
  invalidateProject,
  listReadyProjects,
  type ProjectRecord,
  resolveProjectById,
} from '../tenancy/project-registry';
import { invalidateTenantHost } from '../tenancy/tenant-host';
import { getProjectProviderFor } from './provider-for';
import { tokenChangeFields, tokenStateOf } from './token-state';
import { type ProjectProvider, ProjectProviderError, type ProjectStatus } from './types';
import { REQUIRED_SERVICES } from './wait';

/**
 * The health of a tenant's project (09.2-14, D-543, DBT-27): one check of one project, and the sweep of every
 * ready project the self-re-arming `platform.project-health` job runs.
 *
 * A check asks two independent questions and stores one row in `platform.project_health`:
 *
 *   the provider   `describe` + `health` through the Management API, each bounded by `timeoutMs`: is the project
 *                  paused, are all of its services healthy;
 *   the pool       `select 1` through the project's own pool (project 0: the process pool): can the API reach it.
 *
 * Paused-class status wins over everything (`paused`, and no ping: a paused project cannot answer); every
 * service healthy and the ping answered is `healthy`; a provider failure, a timeout, an unhealthy service or a
 * dead pool is `unreachable` with a `detail_code` from the closed reason catalog (`access_denied` for a refused
 * token, `unreachable` otherwise); `unknown` is only what a project that was never checked reads as (no row).
 *
 * The token axis (09.4-08, D-573, D-574, UI-D-551): a CUSTOMER project is asked through its OWN provider, and
 * the same check also stores `token_check` (`ok | invalid | forbidden | org_mismatch`). A refusal that is a
 * customer-token error (`token_invalid`, `token_forbidden`, `org_mismatch`) is a TOKEN verdict, not an outage:
 * it is recorded and the database state then comes from the pool ping alone, so a dead token with a working
 * pool is `healthy` and the tenant is never held out of the shell. A timeout, a 5xx or an unhealthy service is
 * not a token verdict: it keeps `unreachable` and leaves the stored `token_check` as it was. A platform project
 * never has a token verdict. The one thing a dead token costs is the paused-or-not fact.
 *
 * When the DATABASE state changed, the cached binding and the host answers of every tenant on the project are
 * dropped, so the shell and `requireAuth` show the new state on the very next request instead of up to a minute
 * later. A token-only change drops nothing: members never feel the token. Nothing here logs more than ids,
 * states and codes.
 */

const log = moduleLogger('project-health');

export type HealthStatus = 'healthy' | 'paused' | 'unreachable' | 'unknown';

export type HealthResult = {
  projectId: string;
  status: HealthStatus;
  detailCode: BootstrapReasonCode | null;
  /** The previous stored status (`null` when the project was never checked). */
  previous: HealthStatus | null;
  changed: boolean;
  /**
   * 09.4-08 (D-573): the token verdict of this check (`null`: none was made, the stored one stays) and the one it
   * replaced. Optional so a result built before the token axis existed still satisfies the type.
   */
  tokenCheck?: TokenCheck | null;
  previousTokenCheck?: TokenCheck | null;
  /** 09.4-08 (D-576): the change of the derived token state this check made, `null` when it made none. */
  token?: { from: TokenState | null; to: TokenState | null } | null;
};

export type HealthDeps = {
  /** The provider; default is the env-selected one, resolved lazily. */
  provider?: ProjectProvider;
  /** `select 1` through the project's pool. Default: the project's pooled handle (project 0: the process pool). */
  ping?: (project: ProjectRecord) => Promise<void>;
  /** Bound of each provider call and of the ping (default 10 s). */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

const PAUSED_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  'INACTIVE',
  'PAUSING',
  'PAUSE_FAILED',
  'GOING_DOWN',
]);

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProjectProviderError('timeout', 0)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const defaultPing = (project: ProjectRecord): Promise<void> =>
  withHandle(project, async (handle) => {
    await handle.sql`select 1`;
  });

function codeOf(error: unknown): BootstrapReasonCode {
  return error instanceof ProjectProviderError && error.kind === 'forbidden'
    ? 'access_denied'
    : 'unreachable';
}

/** `tokenCheck` is the token verdict of this check; `null` means "none was made, leave the stored one". */
type Verdict = {
  status: HealthStatus;
  detailCode: BootstrapReasonCode | null;
  tokenCheck: TokenCheck | null;
};

/**
 * The token verdict a provider failure stands for: only an error that carries `customerToken` and one of the
 * three token codes counts (a platform `forbidden`, a timeout or a 5xx never does, T-09.4-29).
 */
function tokenVerdictOf(error: unknown): TokenCheck | null {
  if (!(error instanceof ProjectProviderError) || !error.customerToken) return null;
  if (error.code === 'token_invalid') return 'invalid';
  if (error.code === 'token_forbidden') return 'forbidden';
  if (error.code === 'org_mismatch') return 'org_mismatch';
  return null;
}

async function judge(project: ProjectRecord, deps: HealthDeps): Promise<Verdict> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ping = deps.ping ?? defaultPing;
  const customer = project.owner === 'customer';
  let tokenCheck: TokenCheck | null = null;

  // Project 0 has no Management API entry the platform manages: the pool alone answers for it.
  if (!project.isCentral && project.credentialSource !== 'env') {
    try {
      const provider = deps.provider ?? (await getProjectProviderFor(project));
      const described = await withTimeout(provider.describe(project.ref), timeoutMs);
      // The token reached the project: the verdict is `ok` for whatever the project itself then says.
      if (customer) tokenCheck = 'ok';
      if (PAUSED_STATUSES.has(described.status))
        return { status: 'paused', detailCode: null, tokenCheck };
      if (described.status !== 'ACTIVE_HEALTHY') {
        return { status: 'unreachable', detailCode: 'unreachable', tokenCheck };
      }
      const { services } = await withTimeout(provider.health(project.ref), timeoutMs);
      const healthy = REQUIRED_SERVICES.every((name) => services[name] === 'ACTIVE_HEALTHY');
      if (!healthy) return { status: 'unreachable', detailCode: 'unreachable', tokenCheck };
    } catch (error) {
      const verdict = customer ? tokenVerdictOf(error) : null;
      // Not a token verdict (a timeout, a 5xx, a platform refusal): an outage, and the stored check stays.
      if (verdict === null) {
        return { status: 'unreachable', detailCode: codeOf(error), tokenCheck: null };
      }
      // A token verdict (D-573): record it and let the pool alone answer for the database.
      tokenCheck = verdict;
    }
  }

  try {
    await withTimeout(ping(project), timeoutMs);
  } catch {
    return { status: 'unreachable', detailCode: 'unreachable', tokenCheck };
  }
  return { status: 'healthy', detailCode: null, tokenCheck };
}

/** The hosts of every tenant bound to the project, read in one platform transaction. */
async function hostsOf(projectId: string): Promise<string[]> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantProjects)
      .innerJoin(tenantDomains, eq(tenantDomains.tenantId, tenantProjects.tenantId))
      .where(eq(tenantProjects.projectId, projectId)),
  );
  return rows.map((row) => row.host);
}

/**
 * Checks one project and stores the result. `null` when the project does not exist. A project that is not
 * `ready` is not checked (its bootstrap is the thing to watch): the stored row, if any, is returned as is.
 */
export async function checkProject(
  projectId: string,
  deps: HealthDeps = {},
): Promise<HealthResult | null> {
  const project = await resolveProjectById(projectId);
  if (!project) return null;

  const [before] = await withPlatformTx((tx) =>
    tx.select().from(projectHealth).where(eq(projectHealth.projectId, projectId)).limit(1),
  );
  const previous = (before?.status ?? null) as HealthStatus | null;
  const previousTokenCheck = (before?.tokenCheck ?? null) as TokenCheck | null;
  if (project.state !== 'ready') {
    return {
      projectId,
      status: previous ?? 'unknown',
      detailCode: null,
      previous,
      changed: false,
      tokenCheck: null,
      previousTokenCheck,
      token: null,
    };
  }

  const verdict = await judge(project, deps);

  // The token columns are written ONLY on a token verdict (T-09.4-30): any other outcome leaves them as they were.
  const tokenColumns =
    verdict.tokenCheck === null
      ? {}
      : { tokenCheck: verdict.tokenCheck, tokenCheckedAt: sql`now()` };
  await withPlatformTx((tx) =>
    tx
      .insert(projectHealth)
      .values({
        projectId,
        status: verdict.status,
        detailCode: verdict.detailCode,
        checkedAt: sql`now()`,
        ...tokenColumns,
      })
      .onConflictDoUpdate({
        target: projectHealth.projectId,
        set: {
          status: verdict.status,
          detailCode: verdict.detailCode,
          checkedAt: sql`now()`,
          ...tokenColumns,
        },
      }),
  );

  // The token state before and after, derived by the one contracts function (D-573, D-576). A platform project
  // has none. A change writes ONE line of ids and states and nothing else about the token.
  const effectiveCheck = verdict.tokenCheck ?? previousTokenCheck;
  const tokenFrom = tokenStateOf({
    owner: project.owner,
    tokenCheck: previousTokenCheck,
    expiresAt: project.mgmtTokenExpiresAt,
  });
  const tokenTo = tokenStateOf({
    owner: project.owner,
    tokenCheck: effectiveCheck,
    expiresAt: project.mgmtTokenExpiresAt,
  });
  const token = tokenFrom === tokenTo ? null : { from: tokenFrom, to: tokenTo };
  if (token)
    log.info(tokenChangeFields(projectId, token.from, token.to), 'project token state changed');

  const changed = previous !== verdict.status;
  if (changed) {
    invalidateProject();
    for (const host of await hostsOf(projectId)) invalidateTenantHost(host);
    log.info(
      {
        event: 'project.health.changed',
        projectId,
        from: previous,
        to: verdict.status,
        code: verdict.detailCode,
      },
      'project health changed',
    );
  }
  return {
    projectId,
    status: verdict.status,
    detailCode: verdict.detailCode,
    previous,
    changed,
    tokenCheck: verdict.tokenCheck,
    previousTokenCheck,
    token,
  };
}

export type CheckAllResult = {
  checked: number;
  changed: number;
  failed: number;
  results: HealthResult[];
};

/** Concurrency of the sweep: the Management API shares one rate limit (T-09.2-72). */
export const HEALTH_CONCURRENCY = 4;

/**
 * Checks every ready project, ascending `ref`, at most `concurrency` at a time. A project whose check throws
 * counts as failed and never stops the others; a project that hangs holds one slot until its own timeout and
 * delays nobody else.
 */
export async function checkAllProjects(
  options: { concurrency?: number; deps?: HealthDeps; check?: typeof checkProject } = {},
): Promise<CheckAllResult> {
  const check = options.check ?? checkProject;
  const concurrency = Math.max(1, options.concurrency ?? HEALTH_CONCURRENCY);
  const queue = [...(await listReadyProjects())];
  const results: HealthResult[] = [];
  let failed = 0;

  async function worker(): Promise<void> {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      try {
        const result = await check(next.id, options.deps);
        if (result) results.push(result);
      } catch {
        failed += 1;
        log.warn(
          { event: 'project.health.check_failed', projectId: next.id },
          'health check failed',
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    checked: results.length,
    changed: results.filter((result) => result.changed).length,
    failed,
    results,
  };
}
