import {
  type Bootstrap,
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  type TenantRole,
} from '@tria/contracts';
import type { ModuleManifest } from '@tria/core/server/modules/manifest';
import { KERNEL_ROLE_PERMISSIONS } from '@tria/core/server/rbac/require-role';

/**
 * MOD-02: the registry lives in the APP tier, not in `@tria/core`. The kernel defines the manifest
 * SHAPE and must never import a module (`turbo boundaries`: `kernel` denies `module`); this file is
 * the single composition point where both sides meet, so adding a module is one entry here.
 *
 * Empty in this plan: plan 01-07 registers `@tria/module-example`. Until then every enabled key is
 * manifest-less, which is exactly the "no nav, fallback order" case the tests pin down.
 */
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {};

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
