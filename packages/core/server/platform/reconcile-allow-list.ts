import { asc, isNotNull } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains } from '../../db/schema';
import { authAllowList } from '../domains/index';
import { moduleLogger } from '../logging';
import { withAllowListLock } from './allow-list-lock';

const log = moduleLogger('domains-allow-list');

export type AllowListReconcileResult = { hosts: number; added: number; failed: number };

/**
 * Ensures one `https://<host>/auth/confirm**` allow-list entry per VERIFIED `tenant_domains` row
 * (`verified_at is not null`) — quick 261012-s0v.
 *
 * Why at worker boot: `supabase config push` in `deploy-api.yml` re-applies
 * `[remotes.production.auth] additional_redirect_urls` from `config.toml` and wipes the runtime
 * per-domain entries (docs/DEPLOY.md WR-09); the same pipeline then rolls a new worker revision, so
 * reconciling at boot heals the list on every deploy. With the `local` adapter this only touches the
 * in-memory `localAllowListEntries` ledger; with the `supabase` adapter each `add` is one GET plus a
 * PATCH only when the entry is missing (the worker service already carries
 * `AUTH_ALLOW_LIST=supabase` and `SUPABASE_PAT` for the `kernel.domain-verify` job).
 *
 * One lock per host, not one around the whole loop, so a boot-time reconcile of many hosts never
 * blocks a panel "Verificar agora" for long. The adapters are idempotent, so `added` means "ensured".
 * A per-host failure is counted and logged (`platform.domains.allow_list_reconcile_failed`), never
 * thrown; only the initial select may throw, and the worker catches that.
 */
export async function reconcileAuthAllowList(): Promise<AllowListReconcileResult> {
  const rows = await withAdminTx((tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(isNotNull(tenantDomains.verifiedAt))
      .orderBy(asc(tenantDomains.host)),
  );

  let added = 0;
  let failed = 0;
  for (const { host } of rows) {
    try {
      await withAllowListLock(() => authAllowList.add(host));
      added += 1;
    } catch (error) {
      failed += 1;
      log.error(
        {
          event: 'platform.domains.allow_list_reconcile_failed',
          host,
          err: error instanceof Error ? error.message : String(error),
        },
        'allow-list reconcile failed for a host; "Verificar agora" re-adds it by hand',
      );
    }
  }
  return { hosts: rows.length, added, failed };
}
