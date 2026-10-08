/**
 * Feature modules that can be toggled per tenant (rows in `tenant_modules`, D-16). Seven since 05.3
 * appended the `reels` key (D-122); eight since 08.2 appended `store` (STORE-01).
 * `tenant_modules_key_chk` is GENERATED from this list in this order, so a new key is appended LAST
 * and ships with the migration that widens the CHECK.
 */
export const TOGGLEABLE_MODULES = [
  'feed',
  'communities',
  'stories',
  'events',
  'chat',
  'notifications',
  'reels',
  'store',
] as const;
export type ModuleKey = (typeof TOGGLEABLE_MODULES)[number];

/**
 * Modules a newly created real tenant gets by default (D-17). The two lists stay SEPARATE names
 * because they answer different questions — "what may exist" and "what a new tenant gets" — and
 * the day a module ships behind a paid tier, only the second one changes.
 *
 * That day is 08.2: `store` is in `TOGGLEABLE_MODULES` and NOT here, so it is OFF by default for a
 * new tenant and no existing tenant gets a row for it (STORE-01; a missing row reads as disabled).
 * The other seven, `reels` included (D-122: on by default, backfilled by the `reels_module`
 * migration), are still offered to every new tenant.
 */
export const REAL_TENANT_DEFAULT_MODULES: readonly ModuleKey[] = [
  'feed',
  'communities',
  'stories',
  'events',
  'chat',
  'notifications',
  'reels',
];

/** Roles stored on `memberships.role` (ROLE-01). `super_admin` lives in `platform_admins`, never here. */
export const TENANT_ROLES = ['admin_tenant', 'support_tenant', 'member'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * Sort bucket for enabled keys that have no manifest yet (`nav?.order ?? MODULE_KEY_ORDER_FALLBACK`).
 * Keeps `/me/bootstrap` deterministic while some of the seven toggleable modules are still
 * unimplemented: they land after every navigable module, ordered by key.
 */
export const MODULE_KEY_ORDER_FALLBACK = 1000;
