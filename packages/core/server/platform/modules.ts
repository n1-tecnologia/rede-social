import type { ModuleKey } from '@rede-social/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantModules, tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { moduleFlags } from '../modules/flags-cache';
import { pushToTenant } from '../tenancy/mirror';
import { logFor, type PlatformActor } from './invites';

/**
 * ROLE-04 / MOD-04: flips one module of one tenant from the platform panel, without a redeploy.
 *
 * `enabled` is CENTRAL-owned (09.2-07, D-537): it is written in the control plane and a copy is pushed to the
 * tenant's own `tenant_modules` row afterwards (best effort, healed by the reconcile function). The module's
 * `settings` blob is TENANT-owned and stays in the tenant's project (`readModuleSettings`,
 * `patchModuleSettings`).
 *
 * The write is a ROW UPSERT keyed by `(tenant_id, module_key)` — the same shape the seed uses — so
 * two concurrent toggles never read-modify-write a boolean set: the last committed value wins and
 * nothing is lost. `moduleFlags.invalidate(tenantId)` makes the change visible to THIS API instance
 * on the very next request; other instances converge within `MODULE_FLAGS_TTL_MS` (30 s).
 *
 * There is no per-key special case here (04-10 retired the one that refused the reference module):
 * what a panel may name is the KEY VOCABULARY itself — `z.enum(TOGGLEABLE_MODULES)` at the route
 * (08.2-05: every toggleable key, `store` included; which keys a NEW tenant starts with is
 * `REAL_TENANT_DEFAULT_MODULES`, decided at creation and never here), and `tenant_modules_key_chk`
 * in the database. A key that is not in the vocabulary is
 * refused before this function is ever called, so an extra branch here would be an unreachable line
 * that reads to the next person like a live rule.
 */
export async function setModuleEnabled(
  tenantId: string,
  key: ModuleKey,
  enabled: boolean,
  actor: PlatformActor,
): Promise<void> {
  await withPlatformTx(async (tx) => {
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

  await pushToTenant(tenantId, ['modules']);
  moduleFlags.invalidate(tenantId);
  logFor(actor, 'platform.modules').info(
    { event: 'platform.modules.set', userId: actor.userId, tenantId, module: key, enabled },
    'module flag set',
  );
}

type Json = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The patch applied to a stored settings object: nested plain objects merge key by key, anything else
 * (a number, a boolean, an array, null) replaces. Returns ONLY the top-level keys the patch names, each
 * already merged with what is stored, so `settings || <result>` in SQL changes exactly those keys and
 * leaves every other key of the blob (a stray, another phase's, the legacy feed keys) untouched.
 *
 * A bare `settings || patch` is a SHALLOW concatenation: patching `{ media: { video: { enabled } } }`
 * would replace the whole `media` object and silently drop the tenant's photo cap. The nesting is why
 * this exists.
 */
export function mergeSettingsPatch(stored: Json, patch: Json): Json {
  const merge = (base: unknown, change: unknown): unknown =>
    isPlainObject(base) && isPlainObject(change)
      ? {
          ...base,
          ...Object.fromEntries(Object.entries(change).map(([k, v]) => [k, merge(base[k], v)])),
        }
      : change;
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, merge(stored[k], v)]));
}

/**
 * An unknown tenant is the bare 404, answered by the control plane BEFORE any tenant project is chosen
 * (a tenant with no binding would otherwise surface as `TENANT_PROJECT_UNBOUND`).
 */
async function assertTenantKnown(tenantId: string): Promise<void> {
  const [tenant] = await withPlatformTx((tx) =>
    tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
  );
  if (!tenant) throw new ApiError(404, 'NOT_FOUND');
}

/**
 * The stored `settings` blob of one module of one tenant, or `{}` when the tenant has no row for it.
 * An unknown TENANT is the bare 404. Raw: the caller parses it with the module's own tolerant schema.
 */
export async function readModuleSettings(tenantId: string, key: ModuleKey): Promise<Json> {
  await assertTenantKnown(tenantId);
  return withAdminTx({ tenantId }, async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new ApiError(404, 'NOT_FOUND');
    const [row] = await tx
      .select({ settings: tenantModules.settings })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)))
      .limit(1);
    return (row?.settings ?? {}) as Json;
  });
}

/**
 * D-474: merges a settings patch into one module's stored blob. Never replaces the blob (planning
 * decision 4): the row is locked, the patch is merged key by key onto what is stored
 * (`mergeSettingsPatch`) and written with `settings || <changed top-level keys>`, so two admins editing
 * different keys cannot lose each other's write and saving the same patch twice is a no-op.
 *
 * The module's row must already exist (it is created by the toggle, `setModuleEnabled`); a tenant with
 * no row for the key is the bare 404. The patch is validated by the ROUTE against the module's strict
 * patch schema; this kernel function knows nothing of any module's keys (MOD-02). Answers the stored
 * blob after the write. Logs ids and key names only, never values.
 */
export async function patchModuleSettings(
  tenantId: string,
  key: ModuleKey,
  patch: Json,
  actor: PlatformActor,
): Promise<Json> {
  await assertTenantKnown(tenantId);
  const stored = await withAdminTx({ tenantId }, async (tx) => {
    const [row] = await tx
      .select({ settings: tenantModules.settings })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)))
      .for('update');
    if (!row) throw new ApiError(404, 'NOT_FOUND');

    const changes = mergeSettingsPatch((row.settings ?? {}) as Json, patch);
    const [written] = await tx
      .update(tenantModules)
      .set({
        settings: sql`${tenantModules.settings} || ${JSON.stringify(changes)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)))
      .returning({ settings: tenantModules.settings });
    return (written?.settings ?? {}) as Json;
  });

  moduleFlags.invalidate(tenantId);
  logFor(actor, 'platform.modules').info(
    {
      event: 'platform.modules.settings',
      userId: actor.userId,
      tenantId,
      module: key,
      keys: Object.keys(patch),
    },
    'module settings patched',
  );
  return stored;
}
