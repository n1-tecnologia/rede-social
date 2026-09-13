/** Feature modules that can be toggled per tenant (rows in `tenant_modules`, D-16). */
export const TOGGLEABLE_MODULES = [
  'feed',
  'communities',
  'stories',
  'events',
  'chat',
  'notifications',
  'example',
] as const;
export type ModuleKey = (typeof TOGGLEABLE_MODULES)[number];

/** Modules a newly created real tenant gets by default (D-17). `example` is never here (D-19). */
export const REAL_TENANT_DEFAULT_MODULES: readonly ModuleKey[] = [
  'feed',
  'communities',
  'stories',
  'events',
  'chat',
  'notifications',
];

/** Roles stored on `memberships.role` (ROLE-01). `super_admin` lives in `platform_admins`, never here. */
export const TENANT_ROLES = ['admin_tenant', 'support_tenant', 'member'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * Sort bucket for enabled keys that have no manifest yet (`nav?.order ?? MODULE_KEY_ORDER_FALLBACK`).
 * Keeps `/me/bootstrap` deterministic while the six toggleable modules are still unimplemented: they
 * land after every navigable module, ordered by key.
 */
export const MODULE_KEY_ORDER_FALLBACK = 1000;
