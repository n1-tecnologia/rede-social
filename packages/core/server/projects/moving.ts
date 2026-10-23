/**
 * Whether a tenant is being moved to a project of its own (09.2-14, A-UI-5, UI-D-541). The move tool (plan
 * 22/23) writes an audit row while it holds the tenant; this plan only supplies the field so the overview, the
 * list and the derived state already carry it. Until plan 23 replaces the body with a read of
 * `platform.tenant_moves`, no tenant is ever moving.
 */
export async function isTenantMoving(_tenantId: string): Promise<boolean> {
  return false;
}

/** The subset of `tenantIds` being moved: one read for a whole page of the list. Empty until plan 23. */
export async function tenantsMoving(_tenantIds: readonly string[]): Promise<ReadonlySet<string>> {
  return new Set();
}
