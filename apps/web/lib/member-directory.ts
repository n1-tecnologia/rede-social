import type { TenantRole } from '@rede-social/contracts';
import { SOCIAL_PERMISSIONS } from '@rede-social/module-social/contracts';

/**
 * The viewer as the directory rules read them: their OWN role and their COMPOSED permissions, both
 * straight from the bootstrap (the layout's `cache`d read: no second request).
 */
export interface DirectoryViewer {
  role: TenantRole;
  permissions: readonly string[];
}

/** The composed permission that opens the social surfaces to a member (09-01, D-482). */
function participates(viewer: DirectoryViewer): boolean {
  return viewer.permissions.includes(SOCIAL_PERMISSIONS.participate);
}

/**
 * Who may browse the member directory (`/membros`).
 *
 * 2026-10-12 it was the community's STAFF only: a member never learned who else was in the community,
 * so the "Membros" row left `/perfil`, the list page sent a member back to `/perfil` and its load-more
 * action refused them. **Since 09-10 (D-466, UI-D-503) it is also the member's way to find people to
 * follow while `social` is on**: the single switch is the composed permission `social.participate`,
 * the same value the API's directory gate checks (`GET /v1/members`, 09-02), so a tenant with `social`
 * off - where nobody holds it - keeps the 2026-10-12 behaviour exactly. A member's profile
 * (`/membros/{id}`, opened from an author's name) stays readable by everyone, as before.
 *
 * ROLE-based for the staff on purpose, permission-based for the member: `support_tenant` holds no
 * kernel permission (`KERNEL_ROLE_PERMISSIONS`), so no permission names "the staff". The directory the
 * member gets lists MEMBERS only (D-47: staff are absent from the API's answer, blocked members too),
 * so opening it to them does not reveal who the staff are.
 */
export function canBrowseMemberDirectory(viewer: DirectoryViewer): boolean {
  if (viewer.role === 'admin_tenant' || viewer.role === 'support_tenant') return true;
  return viewer.role === 'member' && participates(viewer);
}

/**
 * Whether the directory shows the Seguir button on its rows (D-470): a MEMBER holding
 * `social.participate`, the only role the follow graph admits (D-467). The staff keep today's
 * button-free single-link row.
 */
export function canFollowMembers(viewer: DirectoryViewer): boolean {
  return viewer.role === 'member' && participates(viewer);
}

/**
 * Where a member profile's back link goes: the directory for whoever can browse it, the home screen
 * for a member who cannot (they reached the profile from a post and have no list to return to).
 */
export function memberProfileExit(viewer: DirectoryViewer): '/membros' | '/inicio' {
  return canBrowseMemberDirectory(viewer) ? '/membros' : '/inicio';
}
