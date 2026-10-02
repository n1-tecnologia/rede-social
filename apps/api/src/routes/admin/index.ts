import { createOpenApiApp } from '../../http/openapi';
import { adminBrandingRoutes } from './branding';
import { adminMembersRoutes } from './members';
import { moderationLogRoutes } from './moderation';

/**
 * `/v1/admin/*` — the tenant admin panel's API (Phase 8, D-339): the `admin_tenant` running their own
 * community from inside the app, as opposed to `/v1/platform`, which is the `super_admin`'s.
 *
 * TENANT LANE, ALWAYS. Every sub-router carries its own `requireAuth`, so `ctx.tenantId` (the
 * membership of record) is the ONLY tenant any handler here can act on — never a path, query or body
 * value. Every route is guarded by a PERMISSION (`moderation.manage`, `members.manage`,
 * `tenant.manage`, D-338), never by a role comparison.
 *
 * Sub-routers are chained with `.route()` so `AppType` carries every admin route for `hc<AppType>()`.
 * 08-01 mounts the moderation log; 08-04 chains the Membros routes (`/members`); 08-06 chains the
 * brand (`/branding`) and the display name (`/tenant`); later plans chain the rules here.
 */
export const adminRoutes = createOpenApiApp()
  .route('/moderation-log', moderationLogRoutes)
  .route('/members', adminMembersRoutes)
  .route('/branding', adminBrandingRoutes);
