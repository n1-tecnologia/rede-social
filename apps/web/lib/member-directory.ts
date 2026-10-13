import type { TenantRole } from '@rede-social/contracts';

/**
 * 2026-10-12 — who may browse the member directory (`/membros`): the community's staff only. A
 * member never learns who else is in the community, so the "Membros" row left `/perfil`, the list
 * page sends a member back to `/perfil` and its load-more action refuses them. A member's profile
 * (`/membros/{id}`, opened from an author's name) stays readable by everyone.
 *
 * ROLE-based on purpose, not permission-based: `support_tenant` holds no kernel permission
 * (`KERNEL_ROLE_PERMISSIONS`), so no permission names "the staff". The role is the viewer's OWN,
 * from the bootstrap.
 *
 * Front only: `GET /v1/members` still answers a member (a backend pendency), so this closes the
 * screens, not the data.
 */
export function canBrowseMemberDirectory(role: TenantRole): boolean {
  return role === 'admin_tenant' || role === 'support_tenant';
}

/**
 * Where a member profile's back link goes: the directory for the staff who can browse it, the home
 * screen for a member (who reached the profile from a post and has no directory to return to).
 */
export function memberProfileExit(role: TenantRole): '/membros' | '/inicio' {
  return canBrowseMemberDirectory(role) ? '/membros' : '/inicio';
}
