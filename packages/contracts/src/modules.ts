/** Feature modules that can be toggled per tenant (rows in `tenant_modules`, D-16). */
export const TOGGLEABLE_MODULES = [
  'feed',
  'communities',
  'stories',
  'events',
  'chat',
  'notifications',
] as const;
export type ModuleKey = (typeof TOGGLEABLE_MODULES)[number];

/**
 * Modules a newly created real tenant gets by default (D-17). Identical to `TOGGLEABLE_MODULES`
 * since 04-10 closed D-19 and deleted the reference module: there is no longer any key a tenant can
 * hold that a new tenant is not offered. The two lists stay SEPARATE names because they answer
 * different questions — "what may exist" and "what a new tenant gets" — and the day a module ships
 * behind a paid tier, only the second one changes.
 */
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
