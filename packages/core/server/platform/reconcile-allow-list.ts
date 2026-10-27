import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains } from '../../db/schema';
import { authAllowListFor } from '../domains/index';
import { moduleLogger } from '../logging';
import {
  listReadyProjects,
  type ProjectRecord,
  resolveProjectById,
} from '../tenancy/project-registry';
import { withAllowListLock } from './allow-list-lock';

const log = moduleLogger('domains-allow-list');

/**
 * 09.4-10 (D-575(c), CTK-27): after a host has been ensured in its project's list, the `allow_list` error the
 * panel was showing on that domain is stale. Clears `last_error` for THAT value only (an `invite` or any other
 * error is not this reconcile's to clear). A failure of this update is logged by host and swallowed: the host
 * is already in the list, and the loop must go on.
 */
export async function clearAllowListError(host: string): Promise<void> {
  try {
    await withPlatformTx(async (tx) => {
      await tx
        .update(tenantDomains)
        .set({ lastError: null })
        .where(and(eq(tenantDomains.host, host), eq(tenantDomains.lastError, 'allow_list')));
    });
  } catch (error) {
    log.warn(
      {
        event: 'platform.domains.allow_list_error_clear_failed',
        host,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not clear the allow_list error of a host',
    );
  }
}

export type AllowListReconcileResult = {
  hosts: number;
  added: number;
  failed: number;
  /** Per project, ascending by `ref`: the same three counts (09.2-11). */
  projects: Array<{ projectId: string; ref: string; hosts: number; added: number; failed: number }>;
};

/**
 * Ensures one `https://<host>/auth/confirm**` allow-list entry per VERIFIED `tenant_domains` row
 * (`verified_at is not null`) in the allow-list of the PROJECT that tenant is bound to — quick 261012-s0v,
 * made per project by 09.2-11 (DBT-42, D-538).
 *
 * Why at worker start: `supabase config push` in `deploy-api.yml` re-applies
 * `[remotes.production.auth] additional_redirect_urls` from `config.toml` and wipes the runtime per-domain
 * entries of project 0 (docs/DEPLOY.md WR-09); the same pipeline then rolls a new worker revision, so
 * reconciling when the supervisor starts a project heals the list on every deploy. A tenant project is
 * configured through the Management API alone and no config push ever touches it, but it is reconciled the same
 * way so a list edited by hand heals as well. With the `local` adapter this only touches that project's
 * in-memory ledger; with the `supabase` adapter each `add` is one GET plus a PATCH only when the entry is
 * missing.
 *
 * `{ projectId }` reconciles one project (what the worker's start hook calls); without it every ready project
 * is visited, ascending by `ref`. A project with no verified host performs no adapter call at all (nothing to
 * read, nothing to write). Hosts are visited in ascending order, one lock per host so a boot-time reconcile of
 * many hosts never blocks a panel "Verificar agora" for long; the lock is the PROJECT's, so two tenants of one
 * project are serialised and two projects never wait for each other. The adapters are idempotent, so `added`
 * means "ensured". A per-host failure (a project whose Management API cannot be reached included) is counted
 * and logged (`platform.domains.allow_list_reconcile_failed`), never thrown and never aborts the other
 * projects; only the initial reads may throw, and the worker catches that.
 */
export async function reconcileAuthAllowList(
  options: {
    projectId?: string;
    /** 09.4-10: after each successful `add`, clear `last_error = 'allow_list'` of that host (and no other error). */
    clearAllowListErrors?: boolean;
  } = {},
): Promise<AllowListReconcileResult> {
  let targets: ProjectRecord[];
  if (options.projectId !== undefined) {
    const one = await resolveProjectById(options.projectId);
    targets = one ? [one] : [];
  } else {
    targets = await listReadyProjects();
  }

  const rows = await withPlatformTx((tx) =>
    tx
      .select({ host: tenantDomains.host, projectId: tenantProjects.projectId })
      .from(tenantDomains)
      .innerJoin(tenantProjects, eq(tenantProjects.tenantId, tenantDomains.tenantId))
      .where(and(isNotNull(tenantDomains.verifiedAt)))
      .orderBy(asc(tenantDomains.host)),
  );
  const hostsOf = new Map<string, string[]>();
  for (const { host, projectId } of rows) {
    const list = hostsOf.get(projectId) ?? [];
    list.push(host);
    hostsOf.set(projectId, list);
  }

  const total: AllowListReconcileResult = { hosts: 0, added: 0, failed: 0, projects: [] };
  for (const project of targets) {
    const hosts = hostsOf.get(project.id) ?? [];
    const result = {
      projectId: project.id,
      ref: project.ref,
      hosts: hosts.length,
      added: 0,
      failed: 0,
    };
    if (hosts.length > 0) {
      const adapter = authAllowListFor(project);
      for (const host of hosts) {
        try {
          await withAllowListLock(project.ref, () => adapter.add(host));
          result.added += 1;
          if (options.clearAllowListErrors) await clearAllowListError(host);
        } catch (error) {
          result.failed += 1;
          log.error(
            {
              event: 'platform.domains.allow_list_reconcile_failed',
              projectId: project.id,
              host,
              err: error instanceof Error ? error.message : String(error),
            },
            'allow-list reconcile failed for a host; "Verificar agora" re-adds it by hand',
          );
        }
      }
    }
    total.hosts += result.hosts;
    total.added += result.added;
    total.failed += result.failed;
    total.projects.push(result);
  }
  return total;
}

/**
 * 09.4-10 (D-575(b)(c), CTK-27): the allow-list half of the follow-up to a token replacement. Re-adds every
 * verified host of the tenants bound to ONE project through that project's own guarded provider and clears the
 * `allow_list` errors that now succeed; a host that still fails keeps its error, is counted and logged, and never
 * stops the others.
 */
export async function reconcileProjectAllowList(
  projectId: string,
): Promise<AllowListReconcileResult> {
  return reconcileAuthAllowList({ projectId, clearAllowListErrors: true });
}
