import type { ModuleKey, TenantRole } from '@tria/contracts';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../auth/context';
import { ApiError } from '../http/api-error';
import { type FlagsContext, moduleFlags } from '../modules/flags-cache';

/**
 * The permission seam (FEED-08) — `registerJobQueues` applied to RBAC.
 *
 * A route must be able to say `requirePermission('feed.post.create')`, but the COMPOSITION of that
 * permission set lives in `apps/api/src/modules/registry.ts` (kernel permissions ∪ every enabled
 * module's `defaultRolePermissions` ∪ per-module settings), and the kernel may never import a module
 * (MOD-02). So the kernel declares the SHAPE and the app tier fills it at import time, exactly like
 * the queue-name registry in `../jobs/boss.ts`.
 *
 * The payoff is that the route guard and `GET /v1/me/bootstrap`'s `permissions` array read the SAME
 * composed value: the composer's visibility can never disagree with what the API will allow.
 */

export type PermissionResolver = (
  role: TenantRole,
  enabled: Set<ModuleKey>,
  settings: Map<ModuleKey, Record<string, unknown>>,
) => string[];

let resolver: PermissionResolver | null = null;

/** Called once, at import time, by the app tier's module registry. Last registration wins (tests). */
export function setPermissionResolver(fn: PermissionResolver): void {
  resolver = fn;
}

/**
 * The composed permission set for this request's role and the tenant's ENABLED modules + settings.
 *
 * A missing registration throws rather than returning `[]`: failing OPEN here would turn every
 * `requirePermission` into a silent allow-all the moment an import order changed. A guarded request
 * in a build with no registry must fail loudly on the very first call.
 */
export async function permissionsForRequest(ctx: FlagsContext): Promise<string[]> {
  if (!resolver) {
    throw new Error(
      'no permission resolver registered — apps/api/src/modules/registry.ts must call setPermissionResolver() at import time',
    );
  }
  const flags = await moduleFlags.flags(ctx);
  return resolver(ctx.role, flags.keys, flags.settings);
}

/**
 * ROLE-06 mount order, extended by one: `requireAuth` -> `requireModule` -> `requirePermission`.
 *
 * Without a `ctx` (i.e. mounted before `requireAuth`) this throws 401, so an unauthenticated request
 * never learns whether the permission exists. Holding ANY of the named permissions passes — the
 * common case is a single name.
 *
 * Deliberately NOT `requireRole`: a role comparison in a route hard-codes the V1 product rule into
 * code, and FEED-08 requires it to be a value a tenant can flip (SCHEMA-CONVENTIONS §(c).2-3).
 */
export const requirePermission = (...permissions: string[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const ctx = c.get('ctx');
    if (!ctx) throw new ApiError(401, 'UNAUTHENTICATED');
    const granted = await permissionsForRequest(ctx);
    if (!permissions.some((permission) => granted.includes(permission))) {
      throw new ApiError(403, 'FORBIDDEN');
    }
    await next();
  });
