import { OpenAPIHono } from '@hono/zod-openapi';
import {
  type PlatformEnv,
  requireSuperAdmin,
} from '@tria/core/server/platform/require-super-admin';
import { platformDefaultHook } from '../../http/openapi';
import { tenantsRoutes } from './tenants';

/**
 * The platform lane (ROLE-01, D-21/D-23). Its own `OpenAPIHono` because its environment is
 * `PlatformEnv`, not `AppEnv`: there is no `ctx` here — a `super_admin` has no membership and no
 * tenant, which is the whole point of keeping TRIA staff out of `memberships`.
 *
 * `requireSuperAdmin()` (never `requireAuth`, which would answer 403 NO_MEMBERSHIP first) guards
 * every path — including every sub-router mounted below, because the middleware is registered on
 * this parent BEFORE the `.route()` calls (T-02-15) — and it also refuses a registered tenant host
 * with 403 TENANT_HOST_MISMATCH.
 *
 * Sub-routers are chained with `.route('/', …)` so `AppType` carries every platform route for
 * `hc<AppType>()`. 02-09 appends `.route('/', domainsRoutes)`, 02-13 `.route('/', brandingRoutes)`.
 */
const platform = new OpenAPIHono<PlatformEnv>({ defaultHook: platformDefaultHook });

platform.use('*', requireSuperAdmin());

export const platformRoutes = platform.route('/', tenantsRoutes);
