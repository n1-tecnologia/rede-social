import {
  type Bootstrap,
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  type TenantRole,
} from '@rede-social/contracts';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { subscribe } from '@rede-social/core/server/events/bus';
import { registerJobQueues } from '@rede-social/core/server/jobs/boss';
import { registerSweepFunctions } from '@rede-social/core/server/jobs/sweep-functions';
import { moduleLogger } from '@rede-social/core/server/logging';
import {
  type Counters,
  setCountersResolver,
  ZERO_COUNTERS,
} from '@rede-social/core/server/modules/counters';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { ModuleManifest } from '@rede-social/core/server/modules/manifest';
import { notificationSink, setNotificationSink } from '@rede-social/core/server/notifications/sink';
import {
  notificationEvents,
  registerNotificationRetraction,
  registerNotificationSource,
} from '@rede-social/core/server/notifications/source';
import { setPermissionResolver } from '@rede-social/core/server/rbac/permissions';
import { KERNEL_ROLE_PERMISSIONS } from '@rede-social/core/server/rbac/require-role';
import { chatModule } from '@rede-social/module-chat/module';
import { communitiesModule } from '@rede-social/module-communities/module';
import { eventsModule } from '@rede-social/module-events/module';
import { FEED_PERMISSIONS, feedSettingsSchema } from '@rede-social/module-feed/contracts';
import { feedModule } from '@rede-social/module-feed/module';
import { notificationsModule } from '@rede-social/module-notifications/module';
import { notificationsSink } from '@rede-social/module-notifications/server';
import { reelsModule } from '@rede-social/module-reels/module';
import { storiesModule } from '@rede-social/module-stories/module';

/**
 * MOD-02: the registry lives in the APP tier, not in `@rede-social/core`. The kernel defines the manifest
 * SHAPE and must never import a module (`turbo boundaries`: `kernel` denies `module`); this file is
 * the single composition point where both sides meet, so adding a module is one entry here.
 *
 * 04-10 removed the throwaway reference module's entry (D-19) — one line here and its package — and
 * nothing else in this file moved. That is MOD-03 demonstrated rather than asserted: a module comes
 * out the same way it went in.
 */
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {
  chat: chatModule,
  communities: communitiesModule,
  events: eventsModule,
  feed: feedModule,
  notifications: notificationsModule,
  reels: reelsModule,
  stories: storiesModule,
};

/**
 * Composition side effects, done once at import time and ONLY here:
 *  - every manifest's event subscriptions land on the kernel bus, so a module never reaches into
 *    the bus itself and the set of live subscribers is exactly what this registry holds;
 *  - every job name is registered with the kernel's queue list, which the worker creates at start
 *    and the API's lazy enqueue path re-creates idempotently;
 *  - every `sweepFunctions` name (07-04) is registered for the kernel's hourly sweeper. Nothing here
 *    opens a connection.
 */
for (const manifest of Object.values(MODULE_REGISTRY)) {
  for (const subscription of manifest?.events ?? []) {
    subscribe(subscription.event, subscription.handler);
  }
  registerJobQueues((manifest?.jobs ?? []).map((job) => job.name));
  // 07-04: the hourly sweeper runs these through the admin lane; a bad name throws HERE, at import.
  registerSweepFunctions(manifest?.sweepFunctions ?? []);
}

/**
 * 07-01 (RESEARCH Pattern 1): the notification seam, composed HERE and only here. Every manifest's
 * `notificationSources` / `notificationRetractions` land on the kernel map, then the bus gets ONE
 * subscription per distinct event name that any of them listens to, which hands the payload to
 * whatever sink is registered. The notifications module registers the sink; without it the kernel's
 * default is a no-op, so removing the module removes only its half (MOD-03). Producers and the
 * notifications module never import each other (MOD-02).
 */
for (const manifest of Object.values(MODULE_REGISTRY)) {
  for (const source of manifest?.notificationSources ?? []) registerNotificationSource(source);
  for (const retraction of manifest?.notificationRetractions ?? []) {
    registerNotificationRetraction(retraction);
  }
}
setNotificationSink(notificationsSink);
for (const event of notificationEvents()) {
  subscribe(event, (payload) => notificationSink()(event, payload));
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

const countersLog = moduleLogger('counters');

/**
 * D-40 / RESEARCH Pattern 13: `bootstrap.counters`, composed from every EFFECTIVE module's manifest
 * `counters` over zeros, inside the caller's tenant-lane transaction. A disabled module (or one whose
 * `requires` are off) contributes nothing, so its badge reads zero rather than a stale count.
 *
 * 07-08 (planning decision 4): each contributor also receives the caller's composed permission set
 * (`permissionsFor`, the same value the route guards read), so the chat module picks the staff count
 * or the member dot by `chat.support` rather than by a role literal.
 *
 * 07 review A-WR-02: each contributor runs in its own SAVEPOINT and a failure falls back to that
 * contributor's zeros (logged), so one module's broken count can neither abort the caller's
 * transaction nor take the whole bootstrap (every signed-in page) down with a 500. A counter is a
 * hint, never an authority (the kernel's `counters.ts` rule), applied per contributor.
 */
export async function countersFor(
  tx: Tx,
  ctx: RequestContext,
  flags: { keys: Set<ModuleKey>; settings: Map<ModuleKey, Record<string, unknown>> },
): Promise<Counters> {
  const counters: Counters = { ...ZERO_COUNTERS };
  const permissions = permissionsFor(ctx.role, flags.keys, flags.settings);
  for (const key of effectiveKeys(flags.keys)) {
    const contribute = MODULE_REGISTRY[key]?.counters;
    if (!contribute) continue;
    try {
      Object.assign(
        counters,
        await tx.transaction((savepoint) => contribute(savepoint, ctx, permissions)),
      );
    } catch (error) {
      countersLog.warn(
        { event: 'counters.contributor_failed', key, tenantId: ctx.tenantId, err: String(error) },
        'counter contributor failed; its badge reads zero',
      );
    }
  }
  return counters;
}

/**
 * The kernel's counters seam (`setCountersResolver`, the permission inversion again).
 *
 * 07 review A-WR-03: the flags are read BEFORE the tenant-lane transaction opens. A flags-cache miss
 * runs its own `withTenantTx`, so reading it inside an open transaction needed a second pooled
 * connection while holding the first; five push jobs doing that at once would hold the whole pool
 * (`max: 5`) and wait on each other. This is the order `GET /v1/me/bootstrap` already uses.
 */
setCountersResolver(async (ctx) => {
  const flags = await moduleFlags.flags(ctx);
  return withTenantTx(ctx, (tx) => countersFor(tx, ctx, flags));
});
