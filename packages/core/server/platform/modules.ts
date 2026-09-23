import type { ModuleKey } from '@tria/contracts';
import { eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantModules, tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { moduleFlags } from '../modules/flags-cache';
import { logFor, type PlatformActor } from './invites';

/**
 * ROLE-04 / MOD-04: flips one module of one tenant from the platform panel, without a redeploy.
 *
 * The write is a ROW UPSERT keyed by `(tenant_id, module_key)` — the same shape the seed uses — so
 * two concurrent toggles never read-modify-write a boolean set: the last committed value wins and
 * nothing is lost. `moduleFlags.invalidate(tenantId)` makes the change visible to THIS API instance
 * on the very next request; other instances converge within `MODULE_FLAGS_TTL_MS` (30 s).
 *
 * There is no per-key special case here (04-10 retired the one that refused the reference module):
 * what a panel may name is the KEY VOCABULARY itself — `z.enum(REAL_TENANT_DEFAULT_MODULES)` at the
 * route, and `tenant_modules_key_chk` in the database. A key that is not in the vocabulary is
 * refused before this function is ever called, so an extra branch here would be an unreachable line
 * that reads to the next person like a live rule.
 */
export async function setModuleEnabled(
  tenantId: string,
  key: ModuleKey,
  enabled: boolean,
  actor: PlatformActor,
): Promise<void> {
  await withAdminTx(async (tx) => {
    const exists = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!exists[0]) throw new ApiError(404, 'NOT_FOUND');

    await tx
      .insert(tenantModules)
      .values({ tenantId, moduleKey: key, enabled })
      .onConflictDoUpdate({
        target: [tenantModules.tenantId, tenantModules.moduleKey],
        set: { enabled, updatedAt: new Date() },
      });
  });

  moduleFlags.invalidate(tenantId);
  logFor(actor, 'platform.modules').info(
    { event: 'platform.modules.set', userId: actor.userId, tenantId, module: key, enabled },
    'module flag set',
  );
}
