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
import { communitiesModule } from '@tria/module-communities/module';
import { FEED_PERMISSIONS, feedSettingsSchema } from '@tria/module-feed/contracts';
import { feedModule } from '@tria/module-feed/module';
import { reelsModule } from '@tria/module-reels/module';
import { storiesModule } from '@tria/module-stories/module';

/**
 * MOD-02: the registry lives in the APP tier, not in `@tria/core`. The kernel defines the manifest
 * SHAPE and must never import a module (`turbo boundaries`: `kernel` denies `module`); this file is
 * the single composition point where both sides meet, so adding a module is one entry here.
 *
 * 04-10 removed the throwaway reference module's entry (D-19) — one line here and its package — and
 * nothing else in this file moved. That is MOD-03 demonstrated rather than asserted: a module comes
 * out the same way it went in.
 */
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {
  communities: communitiesModule,
  feed: feedModule,
  reels: reelsModule,
  stories: storiesModule,
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
 * D-121: the enabled keys that actually CONTRIBUTE — every enabled key whose manifest `requires` are
 * all enabled too. Removal repeats until a pass removes nothing, so a chain resolves fully (A requires
 * B, B requires C, C off: B drops on the first pass, A on the second). A key with no manifest or no
 * `requires` is never dropped.
 *
 * **Both composition functions below call this first** (05.3-RESEARCH Pitfall 6). Enforcing
 * `requires` in only one of them would let feed-off + reels-on either show a Reels tab that has
 * nothing behind it, or grant a permission from a module that contributes nothing.
 *
 * **Scope (05.3-01 planning decision 7):** `requires` is enforced in the COMPOSITION, not in
 * `requireModule`, because the only module declaring it today (`reels`) owns no routes — the
 * bootstrap and the permission set are its whole surface. A future module with BOTH routes and
 * `requires` must also teach `requireModule` this rule, through a kernel seam in the
 * `setPermissionResolver` pattern (the kernel cannot import this registry).
 */
export function effectiveKeys(enabled: Set<ModuleKey>): Set<ModuleKey> {
  const working = new Set(enabled);
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (const key of working) {
      const requires = MODULE_REGISTRY[key]?.requires ?? [];
      if (requires.some((required) => !working.has(required))) {
        working.delete(key);
        dropped = true;
      }
    }
  }
  return working;
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
  // D-121: a module whose required keys are off contributes no entry (see `effectiveKeys`).
  return [...effectiveKeys(enabled)]
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
  // D-121: the SAME effective set as the bootstrap, so a module that contributes no entry contributes
  // no permission either — and the feed posting-policy branch below reads it too.
  const effective = effectiveKeys(enabled);
  const permissions = new Set<string>(KERNEL_ROLE_PERMISSIONS[role]);
  for (const key of effective) {
    for (const permission of MODULE_REGISTRY[key]?.defaultRolePermissions?.[role] ?? []) {
      permissions.add(permission);
    }
  }

  if (effective.has('feed') && role === 'member') {
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
