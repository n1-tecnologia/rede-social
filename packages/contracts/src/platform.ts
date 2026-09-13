import { z } from 'zod';
import { TOGGLEABLE_MODULES } from './modules';

/**
 * `GET /v1/platform/tenants` (ROLE-01, D-21). The ONE shape shared by the route, this plan's
 * platform-host `/inicio` and Phase 2's platform panel.
 *
 * Deliberately thin: slug, display name, status, creation date and which modules are on. The
 * platform lane crosses tenant boundaries, so nothing here may carry a tenant's content, its members
 * or its domains — a super_admin listing communities does not need any of that (threat T-06-07).
 */
export const platformTenantsSchema = z.object({
  tenants: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      displayName: z.string(),
      status: z.string(),
      createdAt: z.string(),
      enabledModules: z.array(z.enum(TOGGLEABLE_MODULES)),
    }),
  ),
});
export type PlatformTenants = z.infer<typeof platformTenantsSchema>;
