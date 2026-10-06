import { revalidatePath } from 'next/cache';

/**
 * Revalidates every panel view of one tenant after a mutation: the tenant page's tabs
 * (`/plataforma/tenants/{id}`) and the tenant wizard's steps (`/plataforma/novo/{id}`), which render
 * the same panels on the same actions. Both explicitly: Next 16.3 still re-renders whatever page is
 * current on ANY `revalidatePath` (a TODO in its `revalidate.ts`), but its documented contract is
 * "if viewing the affected path", and the wizard must not depend on the TODO staying unfixed.
 */
export function revalidateTenantViews(tenantId: string): void {
  revalidatePath(`/plataforma/tenants/${tenantId}`, 'layout');
  revalidatePath(`/plataforma/novo/${tenantId}`, 'layout');
}
