import { TENANT_ROLES, type TenantRole } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import { canBrowseMemberDirectory, canFollowMembers, memberProfileExit } from './member-directory';

/**
 * 09-10 (D-466, D-482, UI-D-503) - who may browse the member directory (`/membros`). Since
 * 2026-10-12 it was the staff's only; with `social` on, a MEMBER may too, and the single switch is the
 * composed permission `social.participate` (the same value the API checks), never the tenant flag
 * read separately. The claims, over every role of the closed vocabulary x with and without the
 * permission:
 *
 *  - admin and support always browse, whatever the permissions (support holds no kernel permission,
 *    so the rule is ROLE-based for the staff);
 *  - a member browses only with `social.participate`;
 *  - the member profile's way back follows the same line: `/membros` for whoever can browse,
 *    `/inicio` for a member who cannot (they reached the profile from a post and have no list);
 *  - the follow button in the directory is a MEMBER-with-permission thing: staff never get one.
 */

const PARTICIPATE = ['social.participate'];

const EXPECTED: Record<TenantRole, { without: boolean; withPermission: boolean; follow: boolean }> =
  {
    admin_tenant: { without: true, withPermission: true, follow: false },
    support_tenant: { without: true, withPermission: true, follow: false },
    member: { without: false, withPermission: true, follow: true },
  };

describe('canBrowseMemberDirectory, canFollowMembers and memberProfileExit', () => {
  it.each(TENANT_ROLES)('%s without the permission', (role) => {
    const viewer = { role, permissions: [] };
    expect(canBrowseMemberDirectory(viewer)).toBe(EXPECTED[role].without);
    expect(memberProfileExit(viewer)).toBe(EXPECTED[role].without ? '/membros' : '/inicio');
    expect(canFollowMembers(viewer)).toBe(false);
  });

  it.each(TENANT_ROLES)('%s with social.participate', (role) => {
    const viewer = { role, permissions: PARTICIPATE };
    expect(canBrowseMemberDirectory(viewer)).toBe(EXPECTED[role].withPermission);
    expect(memberProfileExit(viewer)).toBe(EXPECTED[role].withPermission ? '/membros' : '/inicio');
    expect(canFollowMembers(viewer)).toBe(EXPECTED[role].follow);
  });

  it('a member holding other permissions but not social.participate cannot browse', () => {
    const viewer = {
      role: 'member' as const,
      permissions: ['feed.post.create', 'content.publish'],
    };
    expect(canBrowseMemberDirectory(viewer)).toBe(false);
    expect(memberProfileExit(viewer)).toBe('/inicio');
  });

  it('only the staff browse it without the permission', () => {
    expect(
      TENANT_ROLES.filter((role) => canBrowseMemberDirectory({ role, permissions: [] })),
    ).toEqual(['admin_tenant', 'support_tenant']);
  });
});
