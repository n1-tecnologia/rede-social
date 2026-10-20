import type { TenantRole } from '@rede-social/contracts';

/**
 * The viewer as the directory rules read them: their OWN role and their composed permissions, both
 * from the bootstrap (09-10, D-466, D-482).
 *
 * RED stub (09-10 Task 2): the signature carries the viewer but the behaviour is still 2026-10-12's
 * staff-only rule; the GREEN commit makes `social.participate` the second way in.
 */
export interface DirectoryViewer {
  role: TenantRole;
  permissions: readonly string[];
}

export function canBrowseMemberDirectory(viewer: DirectoryViewer): boolean {
  return viewer.role === 'admin_tenant' || viewer.role === 'support_tenant';
}

export function canFollowMembers(_viewer: DirectoryViewer): boolean {
  return false;
}

export function memberProfileExit(viewer: DirectoryViewer): '/membros' | '/inicio' {
  return canBrowseMemberDirectory(viewer) ? '/membros' : '/inicio';
}
