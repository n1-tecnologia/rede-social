import {
  type Bootstrap,
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  type TenantRole,
} from '@tria/contracts';
import { subscribe } from '@tria/core/server/events/bus';
import { registerJobQueues } from '@tria/core/server/jobs/boss';
import type { ModuleManifest } from '@tria/core/server/modules/manifest';
import { setPermissionResolver } from '@tria/core/server/rbac/permissions';
import { KERNEL_ROLE_PERMISSIONS } from '@tria/core/server/rbac/require-role';
import { exampleModule } from '@tria/module-example/module';
import { FEED_PERMISSIONS, feedSettingsSchema } from '@tria/module-feed/contracts';
import { feedModule } from '@tria/module-feed/module';

/**
 * MOD-02: the registry lives in the APP tier, not in `@tria/core`. The kernel defines the manifest
 * SHAPE and must never import a module (`turbo boundaries`: `kernel` denies `module`); this file is
 * the single composition point where both sides meet, so adding a module is one entry here.
 *
 * `example` is the throwaway reference module (D-19); 04-10 deletes the entry and the package once
 * `feed` has taken over its role as the worked example of the module contract.
 */
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {
  example: exampleModule,
  feed: feedModule,
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
      const manifest = MODULE_REGISTRY[key];
      const nav = manifest?.nav;
      return {
        key,
        ...(nav ? { nav } : {}),
        // D-42: home-slot declarations ride along so the web composition point can place the widgets.
        ...(manifest?.home ? { home: manifest.home } : {}),
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
 * Kernel permissions for the role plus every ENABLED module's `defaultRolePermissions` for it, plus
 * whatever the tenant's per-module SETTINGS grant, de-duplicated and sorted. A disabled module never
 * contributes a permission, so turning a module off also revokes what it granted — including what its
 * settings would otherwise have added.
 *
 * **This is the single composition point FEED-08 requires.** The route guard
 * (`requirePermission('feed.post.create')`, through `setPermissionResolver` below) and
 * `GET /v1/me/bootstrap`'s `permissions` array both read THIS function, so the composer's visibility
 * can never disagree with what the API will allow. Turning members into authors is
 * `update tenant_modules set settings = settings || '{"postingPolicy":"members"}'` — no migration, no
 * route edit.
 */
export function permissionsFor(
  role: TenantRole,
  enabled: Set<ModuleKey> = new Set(),
  settings: Map<ModuleKey, Record<string, unknown>> = new Map(),
): string[] {
  const permissions = new Set<string>(KERNEL_ROLE_PERMISSIONS[role]);
  for (const key of enabled) {
    for (const permission of MODULE_REGISTRY[key]?.defaultRolePermissions?.[role] ?? []) {
      permissions.add(permission);
    }
  }

  if (enabled.has('feed') && role === 'member') {
    // `safeParse` on purpose: an unknown or malformed settings blob must fall back to the SAFE
    // default (`admins_only`), never throw on a request path and never fail open.
    const parsed = feedSettingsSchema.safeParse(settings.get('feed') ?? {});
    const policy = parsed.success ? parsed.data.postingPolicy : 'admins_only';
    if (policy === 'members') permissions.add(FEED_PERMISSIONS.create);
  }

  return [...permissions].sort();
}

/**
 * MOD-02, one more time: the kernel owns `requirePermission` but may not import a module, so the APP
 * tier teaches it how to compose a permission set — exactly the inversion `registerJobQueues` uses
 * above for queue names. Done at import time, and only here.
 */
setPermissionResolver(permissionsFor);
