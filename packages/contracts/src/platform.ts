import { z } from 'zod';
import { slugSchema } from './auth';
import {
  brandingLookBodySchema,
  contrastReportSchema,
  hexColorSchema,
  tenantBrandingSchema,
  tenantDisplayNameSchema,
} from './branding';
import { tenantDomainSchema } from './domains';
import { tenantInviteSchema } from './invites';
import { REAL_TENANT_DEFAULT_MODULES, TOGGLEABLE_MODULES } from './modules';

/**
 * `GET /v1/platform/tenants` (ROLE-01, D-21). The ONE shape shared by the route, the platform-host
 * `/inicio` and the platform panel list.
 *
 * Deliberately thin: slug, display name, status, creation date, which modules are on and the primary
 * host (null → "Sem domínio" pill). The platform lane crosses tenant boundaries, so nothing here may
 * carry a tenant's content, its members or its full domain list — a super_admin listing communities
 * does not need any of that (threat T-06-07). `nextCursor` is the slug to pass back as `cursor`.
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
      primaryHost: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type PlatformTenants = z.infer<typeof platformTenantsSchema>;

/** Query of `GET /v1/platform/tenants`: search, status filter, slug cursor, page size 1..100 (25). */
export const platformTenantsQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  cursor: slugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformTenantsQuery = z.infer<typeof platformTenantsQuerySchema>;

/** The six real module keys a tenant may toggle; `example` is never offered (D-19). */
const realModuleKeySchema = z.enum(REAL_TENANT_DEFAULT_MODULES);

/** The two source colors the panel edits (D-25); derivations are computed server-side. */
const brandSourceColorsSchema = z.object({
  primary: hexColorSchema,
  secondary: hexColorSchema,
});

/**
 * Body of `POST /v1/platform/tenants` (ROLE-03/MOD-04, D-30/D-31):
 * - `displayName` 1..60 UTF-16 code units, accents kept;
 * - `slug` is the ASCII regex of `tenants_slug_chk` and is immutable afterwards;
 * - `modules` defaults to the six real modules, `example` is not a valid value;
 * - `adminEmail` is trimmed and lower-cased BEFORE validation and stored in a citext column, so a
 *   different casing can never create a second invite (edge ROLE-03/encoding);
 * - `look` (2026-10-03, optional) is the wizard's look beyond the pair, validated exactly as the
 *   look's own route validates it (`brandingLookBodySchema`, strict); absent, the tenant starts on
 *   the system's look.
 */
export const createTenantBodySchema = z.object({
  displayName: tenantDisplayNameSchema,
  slug: slugSchema,
  colors: brandSourceColorsSchema,
  modules: z.array(realModuleKeySchema).default([...REAL_TENANT_DEFAULT_MODULES]),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email()),
  look: brandingLookBodySchema.optional(),
});
export type CreateTenantBody = z.infer<typeof createTenantBodySchema>;

/**
 * Body of `PATCH /v1/platform/tenants/{id}`: at least one of the editable fields (slug is immutable).
 * `displayName` is THE shared rule (`tenantDisplayNameSchema`), the same the tenant lane's
 * `PATCH /v1/admin/tenant` validates with (08-06, ADMIN-01 encoding).
 */
export const updateTenantBodySchema = z
  .object({
    displayName: tenantDisplayNameSchema.optional(),
    colors: brandSourceColorsSchema.optional(),
  })
  .refine((b) => b.displayName !== undefined || b.colors !== undefined, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateTenantBody = z.infer<typeof updateTenantBodySchema>;

/** Body of `POST /v1/platform/tenants/{id}/status` (D-32). */
export const setTenantStatusBodySchema = z.object({
  status: z.enum(['active', 'suspended']),
});
export type SetTenantStatusBody = z.infer<typeof setTenantStatusBodySchema>;

/** Body of `PUT /v1/platform/tenants/{id}/modules/{key}` (MOD-04). */
export const setModuleBodySchema = z.object({ enabled: z.boolean() });
export type SetModuleBody = z.infer<typeof setModuleBodySchema>;

/**
 * `GET /v1/platform/tenants/{id}` — the ONLY platform-lane answer that carries a tenant's domains,
 * invites and admins (T-06-07 stays true for the list). Strict at the top level so a route cannot
 * leak a new section without the contract changing.
 */
export const platformTenantDetailSchema = z
  .object({
    tenant: z.object({
      id: z.uuid(),
      slug: z.string(),
      displayName: z.string(),
      status: z.enum(['active', 'suspended']),
      timezone: z.string(),
      createdAt: z.string(),
      branding: tenantBrandingSchema,
      contrast: contrastReportSchema,
    }),
    modules: z.array(z.object({ key: realModuleKeySchema, enabled: z.boolean() })),
    domains: z.array(tenantDomainSchema),
    invites: z.array(tenantInviteSchema),
    admins: z.array(
      z.object({
        userId: z.uuid(),
        email: z.string(),
        name: z.string(),
        joinedAt: z.string(),
      }),
    ),
  })
  .strict();
export type PlatformTenantDetail = z.infer<typeof platformTenantDetailSchema>;
