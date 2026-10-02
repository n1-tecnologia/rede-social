import type { TenantRole } from '@rede-social/contracts';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../auth/context';
import { ApiError } from '../http/api-error';

/**
 * Permissions the KERNEL grants per tenant role, independently of any module. Each enabled module's
 * `defaultRolePermissions` is unioned on top (composed in `apps/api/src/modules/registry.ts`).
 *
 * `support_tenant` holds nothing here on purpose (07-08, D-223): its one power, answering support,
 * is granted by the CHAT manifest (to `admin_tenant` too), so turning chat off for a tenant revokes
 * it. A kernel grant would survive the toggle and keep the inbox's permission alive with no inbox.
 */
export const KERNEL_ROLE_PERMISSIONS: Record<TenantRole, string[]> = {
  // 08-01 (D-338): `moderation.manage` — remove anyone's comment, block and unblock, read the
  // moderation log. A KERNEL grant because moderation is a kernel capability with no flag
  // (SCHEMA-CONVENTIONS §(f).2). `support_tenant` gets it only through a later, explicit grant, never
  // by default: it is a permission rather than a role check precisely so that grant needs no code.
  admin_tenant: ['tenant.manage', 'members.manage', 'content.publish', 'moderation.manage'],
  support_tenant: [],
  // V1: members consume. V2 member posting is a permission change here plus a flag, never a migration.
  member: [],
};

/**
 * ROLE-06: the role comes from `ctx`, which `requireAuth` read from the MEMBERSHIP ROW on this very
 * request — never from a JWT claim (threat T-06-03). Mount AFTER `requireModule`, so a member hitting
 * an admin-only route of an enabled module gets 403 `FORBIDDEN` while a disabled module still 404s.
 */
export const requireRole = (...roles: TenantRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const ctx = c.get('ctx');
    if (!ctx) throw new ApiError(401, 'UNAUTHENTICATED');
    if (!roles.includes(ctx.role)) throw new ApiError(403, 'FORBIDDEN');
    await next();
  });
