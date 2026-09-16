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
 * `example` is refused (D-19): a real tenant never gets the sample module, whatever the panel sends.
 */
export async function setModuleEnabled(
  tenantId: string,
  key: ModuleKey,
  enabled: boolean,
  actor: PlatformActor,
): Promise<void> {
  if (key === 'example') {
    throw new ApiError(400, 'VALIDATION_FAILED', { module: 'not_toggleable' });
  }

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
