import { eq, sql } from 'drizzle-orm';
import { projects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { ApiError } from '../http/api-error';
import { logFor, type PlatformActor } from '../platform/invites';
import { processKeyring, seal } from '../secrets/sealed';
import { invalidateProject } from '../tenancy/project-registry';
import {
  type AccessDeps,
  type AccessValues,
  ddlTargetOf,
  ddlUrlFor,
  presentAccess,
  validateAccess,
} from './access';
import { checkProject } from './health';
import { projectOfTenant } from './overview';
import { getProjectProvider } from './provider-access';
import type { ProjectProvider } from './types';

/**
 * "Substituir credenciais" (09.2-14, D-539, DBT-40, T-09.2-70): replaces the sealed `postgres` password, service
 * key or publishable key of a tenant's project, and NEVER before checking the new value against the project.
 *
 * Inside ONE platform transaction, under `pg_advisory_xact_lock(hashtext('project:' || ref))` (the same lock the
 * create call, the bootstrap-adjacent operator commands and the break-glass reissue take), the project row is
 * read `for update`, each supplied value is tried against the project (`access.ts`: a candidate DDL connection,
 * a candidate admin client, a candidate publishable key), and only when every one works are the changed columns
 * sealed (AAD `<projectId>:<column>`) and written, together with `credential_version + 1` and `updated_at`, in
 * ONE statement. Two replacements for one project therefore queue on the lock and the later one wins ENTIRELY:
 * a reader never sees an old password next to a new key.
 *
 * A refusal throws `VALIDATION_FAILED { access: 'invalid' }` and changes nothing: not a column, not the version.
 * Nothing in this function logs, returns or throws a value; the log line names the columns that changed, not
 * what they became. The check is outbound I/O inside the transaction on purpose (the lock must cover the
 * validate-then-write pair); it is an operator action of seconds, bounded by the checks' own timeouts.
 */

export type ReplaceCredentialsDeps = {
  provider?: ProjectProvider;
  access?: AccessDeps;
  /** Starts the follow-up health check (fire and forget by default). */
  startCheck?: (projectId: string) => void;
};

type LockedProject = {
  id: string;
  ref: string;
  api_url: string;
  credential_source: string;
  ddl_url_sealed: string | null;
  state: string;
};

export async function replaceCredentials(
  tenantId: string,
  input: AccessValues,
  actor: PlatformActor,
  deps: ReplaceCredentialsDeps = {},
): Promise<{ ok: true; credentialVersion: number }> {
  const values = presentAccess(input);
  if (Object.keys(values).length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { access: 'invalid' });
  }
  const target = await projectOfTenant(tenantId);
  if (!target) throw new ApiError(404, 'NOT_FOUND');
  // Project 0's credentials live in the environment, not in the registry: there is nothing to replace here.
  if (target.central) throw new ApiError(409, 'CONFLICT');

  const outcome = await withPlatformTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project:${target.ref}`}))`);

    const found = (await tx.execute(sql`
      select id::text as id, ref, api_url, credential_source, ddl_url_sealed, state
        from platform.projects
       where id = ${target.id}::uuid
         for update`)) as unknown as LockedProject[];
    const row = found[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');

    // Where the candidate `postgres` password is tried: the stored DDL coordinates, else the provider's pooler.
    let ddlTarget: Awaited<ReturnType<typeof ddlTargetOf>> | null = null;
    if (values.databasePassword !== undefined) {
      try {
        const provider = deps.provider ?? (await getProjectProvider());
        ddlTarget = await ddlTargetOf(
          { id: row.id, ref: row.ref, ddlUrlSealed: row.ddl_url_sealed },
          provider,
        );
      } catch {
        ddlTarget = null;
      }
    }
    const works = await validateAccess({ apiUrl: row.api_url }, ddlTarget, values, deps.access);
    if (!works) throw new ApiError(400, 'VALIDATION_FAILED', { access: 'invalid' });

    const columns: string[] = [];
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (values.databasePassword !== undefined && ddlTarget) {
      patch.ddlUrlSealed = seal(ddlUrlFor(ddlTarget, values.databasePassword), `${row.id}:ddl_url`);
      columns.push('ddl_url');
    }
    if (values.serviceKey !== undefined) {
      patch.serviceKeySealed = seal(values.serviceKey, `${row.id}:service_key`);
      patch.serviceKeyKind = values.serviceKey.startsWith('sb_secret_')
        ? 'secret'
        : 'legacy_service_role';
      columns.push('service_key');
    }
    if (values.publishableKey !== undefined) {
      patch.publishableKey = values.publishableKey;
      columns.push('publishable_key');
    }

    // ONE statement: the changed columns, the new key id, the version and the timestamp move together.
    const updated = await tx
      .update(projects)
      .set({
        ...patch,
        // Bookkeeping only (the reseal command owns it once set): each string carries its own key id.
        secretKeyId: sql`coalesce(${projects.secretKeyId}, ${processKeyring().currentId}::smallint)`,
        credentialVersion: sql`${projects.credentialVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, row.id))
      .returning({ credentialVersion: projects.credentialVersion });
    return { projectId: row.id, columns, credentialVersion: updated[0]?.credentialVersion ?? 0 };
  });

  // The pools and the binding cached under the old version are dropped; the next lane opens the new ones.
  invalidateProject();
  logFor(actor, 'platform.projects').info(
    {
      event: 'platform.projects.credentials_replaced',
      userId: actor.userId,
      tenantId,
      projectId: outcome.projectId,
      columns: outcome.columns,
      credentialVersion: outcome.credentialVersion,
    },
    'project credentials replaced',
  );
  (deps.startCheck ?? defaultStartCheck)(outcome.projectId);
  return { ok: true, credentialVersion: outcome.credentialVersion };
}

function defaultStartCheck(projectId: string): void {
  void checkProject(projectId).catch(() => undefined);
}
