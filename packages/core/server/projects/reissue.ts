import { eq, sql } from 'drizzle-orm';
import { projects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { moduleLogger } from '../logging';
import { processKeyring, seal } from '../secrets/sealed';
import { invalidateProject, resolveProjectById } from '../tenancy/project-registry';
import { STEP_LEASE_MINUTES } from './bootstrap';
import { checkProject } from './health';
import { getProjectProviderFor } from './provider-for';
import { type BootstrapReason, reasonOf } from './reasons';
import {
  type Connect,
  connectionUrl,
  defaultConnect,
  defaultSecrets,
  type StepSecrets,
} from './steps';
import type { ProjectProvider } from './types';

/**
 * Break-glass (09.2-14, DBT-47, D-539): re-derives a project's WHOLE credential set from the platform token
 * alone, for the day the master key is lost and the sealed columns can no longer be opened. It never reads a
 * stored credential (a corrupted column does not matter) and it never prints or logs a value.
 *
 *   keys            `ensureKeys`: revealed (or created) through the Management API
 *   postgres        a NEW generated password set with `setDatabasePassword`, proved with a DDL connection
 *   api_user        a NEW password through a server-side `format('%L')`, proved by logging in through both URLs
 *   hook secret     a NEW Standard-Webhooks secret written to the project's Auth configuration (the project's
 *                   `hook_ref` stays), so its mail keeps verifying
 *   registry        every sealed column re-sealed under the CURRENT master key, `credential_version` + 1,
 *                   the cached binding dropped so the next lane opens the new pool
 *
 * It runs under the project's advisory lock (`pg_try_advisory_xact_lock`: a second reissue, a credential
 * replacement or a create for the same ref answers `busy`, it does not queue) and holds the project's step rows
 * `for update`, so a bootstrap step claimed meanwhile waits for the commit and then uses the NEW credentials; a
 * step that is `running` (younger than its lease) answers `busy` before anything changes.
 *
 * Idempotent by construction: nothing it does depends on what was stored, so running it twice, or again after
 * an interruption between the provider calls and the store, always ends with a working set.
 */

const log = moduleLogger('project-reissue');

export type ReissueResult = { status: 'reissued'; credentialVersion: number } | { status: 'busy' };

/** A reissue that could not finish: only a closed-catalog code, never provider text. */
export class ReissueError extends Error {
  readonly reason: BootstrapReason;
  constructor(reason: BootstrapReason) {
    super(`reissue failed: ${reason}`);
    this.name = 'ReissueError';
    this.reason = reason;
  }
}

export type ReissueDeps = {
  provider?: ProjectProvider;
  connect?: Connect;
  secrets?: StepSecrets;
  /** Test seam: runs after every external change and before the registry is written. */
  beforeStore?: () => Promise<void> | void;
  /** Starts the follow-up health check (fire and forget by default). */
  startCheck?: (projectId: string) => void;
};

type LiveStep = { step: string; status: string; live: boolean };

export async function reissueCredentials(
  projectId: string,
  deps: ReissueDeps = {},
): Promise<ReissueResult> {
  const project = await resolveProjectById(projectId);
  if (!project) throw new ReissueError('unknown');
  // Project 0's credentials are the environment's: there is nothing in the registry to re-derive.
  if (project.isCentral || project.credentialSource === 'env') throw new ReissueError('unknown');

  const connect = deps.connect ?? defaultConnect;
  const secrets = deps.secrets ?? defaultSecrets;

  const outcome = await withPlatformTx(async (tx): Promise<ReissueResult> => {
    const [lock] = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext(${`project:${project.ref}`})) as ok`,
    )) as unknown as { ok: boolean }[];
    if (lock?.ok !== true) return { status: 'busy' };

    // Lock the step rows: a claim (a conditional UPDATE) now waits for this transaction.
    const steps = (await tx.execute(sql`
      select step, status,
             (started_at is not null
              and started_at > now() - make_interval(mins => ${STEP_LEASE_MINUTES})) as live
        from platform.project_bootstrap_steps
       where project_id = ${projectId}::uuid
         for update`)) as unknown as LiveStep[];
    if (steps.some((row) => row.status === 'running' && row.live)) return { status: 'busy' };

    try {
      const provider = deps.provider ?? (await getProjectProviderFor(project));
      const ref = project.ref;

      const keys = await provider.ensureKeys(ref);
      const serviceKey = keys.service.value;
      const publishableKey = keys.publishable.value;
      if (!serviceKey || !publishableKey) throw new ReissueError('access_denied');

      // The `postgres` password: new, set through the platform token, proved by connecting with it.
      const pooler = await provider.poolerConfig(ref);
      const postgresPassword = secrets.ddlPassword();
      await provider.setDatabasePassword(ref, postgresPassword);
      const ddlUrl = connectionUrl(
        pooler.userFor('postgres'),
        postgresPassword,
        pooler.host,
        pooler.sessionPort,
        pooler.dbName,
      );

      // `api_user`: a new password, bound as a parameter into `format('%L')`, never SQL text.
      const apiPassword = secrets.apiUserPassword();
      const txUrl = connectionUrl(
        pooler.userFor('api_user'),
        apiPassword,
        pooler.host,
        pooler.txPort,
        pooler.dbName,
      );
      const sessionUrl = connectionUrl(
        pooler.userFor('api_user'),
        apiPassword,
        pooler.host,
        pooler.sessionPort,
        pooler.dbName,
      );
      const ddl = connect('ddl', ddlUrl);
      try {
        await ddl`select 1`;
        await ddl.begin(async (inner) => {
          await inner`select set_config('rede.api_user_pw', ${apiPassword}, true)`;
          await inner.unsafe(
            `do $$ begin execute format('alter role api_user with login password %L', current_setting('rede.api_user_pw')); end $$`,
          );
        });
      } finally {
        await ddl.end({ timeout: 5 }).catch(() => undefined);
      }
      for (const url of [txUrl, sessionUrl]) {
        const probe = connect('api', url);
        try {
          const [who] = await probe<{ u: string }[]>`select current_user as u`;
          if (who?.u !== 'api_user') throw new ReissueError('unreachable');
        } finally {
          await probe.end({ timeout: 5 }).catch(() => undefined);
        }
      }

      // The hook secret: only for a project whose Auth was configured (it has a hook reference).
      let hookSecret: string | null = null;
      if (project.hookRef) {
        hookSecret = secrets.hookSecret();
        await provider.patchAuthConfig(ref, { hook_send_email_secrets: hookSecret });
      }

      await deps.beforeStore?.();

      const aad = (column: string) => `${projectId}:${column}`;
      const updated = await tx
        .update(projects)
        .set({
          ddlUrlSealed: seal(ddlUrl, aad('ddl_url')),
          databaseUrlTxSealed: seal(txUrl, aad('database_url_tx')),
          databaseUrlSessionSealed: seal(sessionUrl, aad('database_url_session')),
          serviceKeySealed: seal(serviceKey, aad('service_key')),
          serviceKeyKind: keys.service.kind,
          publishableKey,
          ...(hookSecret ? { hookSecretSealed: seal(hookSecret, aad('hook_secret')) } : {}),
          secretKeyId: processKeyring().currentId,
          credentialVersion: sql`${projects.credentialVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(projects.id, projectId))
        .returning({ credentialVersion: projects.credentialVersion });
      return { status: 'reissued', credentialVersion: updated[0]?.credentialVersion ?? 0 };
    } catch (error) {
      // A closed-catalog code is all that leaves this function: a driver or provider message can carry a host.
      throw error instanceof ReissueError ? error : new ReissueError(reasonOf(error, 'verify'));
    }
  });

  if (outcome.status === 'busy') {
    log.warn(
      { event: 'project.reissue.busy', projectId },
      'credential reissue refused: project busy',
    );
    return outcome;
  }
  invalidateProject();
  log.info(
    { event: 'project.reissue.done', projectId, credentialVersion: outcome.credentialVersion },
    'project credentials reissued',
  );
  (deps.startCheck ?? defaultStartCheck)(projectId);
  return outcome;
}

function defaultStartCheck(projectId: string): void {
  void checkProject(projectId).catch(() => undefined);
}

/** The registry id of a project by its ref (the operator command names the ref), or `null`. */
export async function projectIdByRef(ref: string): Promise<string | null> {
  const rows = await withPlatformTx((tx) =>
    tx.select({ id: projects.id }).from(projects).where(eq(projects.ref, ref)).limit(1),
  );
  return rows[0]?.id ?? null;
}
