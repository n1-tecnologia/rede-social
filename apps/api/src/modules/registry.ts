import {
  type Bootstrap,
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  type TenantRole,
} from '@tria/contracts';
import { subscribe } from '@tria/core/server/events/bus';
import { registerJobQueues } from '@tria/core/server/jobs/boss';
import type { ModuleManifest } from '@tria/core/server/modules/manifest';
import { KERNEL_ROLE_PERMISSIONS } from '@tria/core/server/rbac/require-role';
import { exampleModule } from '@tria/module-example/module';

/**
 * MOD-02: the registry lives in the APP tier, not in `@tria/core`. The kernel defines the manifest
 * SHAPE and must never import a module (`turbo boundaries`: `kernel` denies `module`); this file is
 * the single composition point where both sides meet, so adding a module is one entry here.
 *
 * `example` is the throwaway reference module (D-19); Phase 4 deletes the entry and the package.
 */
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {
  example: exampleModule,
};

/**
 * Composition side effects, done once at import time and ONLY here:
 *  - every manifest's event subscriptions land on the kernel bus, so a module never reaches into
 *    the bus itself and the set of live subscribers is exactly what this registry holds;
 *  - every job name is registered with the kernel's queue list, which the worker creates at start
 *    and the API's lazy enqueue path re-creates idempotently. Nothing here opens a connection.
 */
for (const manifest of Object.values(MODULE_REGISTRY)) {
  for (const subscription of manifest?.events ?? []) {
    subscribe(subscription.event, subscription.handler);
  }
  registerJobQueues((manifest?.jobs ?? []).map((job) => job.name));
}

/**
 * ROLE-06 ordering: enabled keys sorted by `nav.order` ascending, then key ascending, with
 * manifest-less keys last (`MODULE_KEY_ORDER_FALLBACK`). Deterministic for every tenant, so the
 * shell's navigation never reshuffles between requests.
 *
 * The tenant's ENABLED FLAGS decide membership of the list; the registry only decorates it. A key
 * enabled for a tenant but not yet implemented still appears (without `nav`), which is what makes
 * `/me/bootstrap` honest about what the tenant bought.
 */
export function enabledModulesForBootstrap(
  enabled: Set<ModuleKey>,
  settings: Map<ModuleKey, Record<string, unknown>>,
): Bootstrap['modules'] {
  return [...enabled]
    .map((key) => {
      const nav = MODULE_REGISTRY[key]?.nav;
      return {
        key,
        ...(nav ? { nav } : {}),
        settings: settings.get(key) ?? {},
      };
    })
    .sort((a, b) => {
      const orderA = a.nav?.order ?? MODULE_KEY_ORDER_FALLBACK;
      const orderB = b.nav?.order ?? MODULE_KEY_ORDER_FALLBACK;
      return orderA === orderB ? a.key.localeCompare(b.key) : orderA - orderB;
    });
}

/**
 * Kernel permissions for the role plus every ENABLED module's `defaultRolePermissions` for it,
 * de-duplicated and sorted. A disabled module never contributes a permission, so turning a module
 * off also revokes what it granted.
 */
export function permissionsFor(role: TenantRole, enabled: Set<ModuleKey> = new Set()): string[] {
  const permissions = new Set<string>(KERNEL_ROLE_PERMISSIONS[role]);
  for (const key of enabled) {
    for (const permission of MODULE_REGISTRY[key]?.defaultRolePermissions?.[role] ?? []) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}
