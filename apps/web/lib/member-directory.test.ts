import { TENANT_ROLES, type TenantRole } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import { canBrowseMemberDirectory, memberProfileExit } from './member-directory';

/**
 * 2026-10-12 — the member directory is the staff's only. The claims: admin and support browse it
 * (by ROLE: support holds no kernel permission to test for), a member never does, and a member
 * profile's way back follows the same line, `/membros` for the staff and `/inicio` for a member.
 * Every role of the closed vocabulary is covered, so a new role cannot slip in unanswered.
 */

const EXPECTED: Record<TenantRole, { browse: boolean; exit: '/membros' | '/inicio' }> = {
  admin_tenant: { browse: true, exit: '/membros' },
  support_tenant: { browse: true, exit: '/membros' },
  member: { browse: false, exit: '/inicio' },
};

describe('canBrowseMemberDirectory and memberProfileExit', () => {
  it.each(TENANT_ROLES)('%s', (role) => {
    expect(canBrowseMemberDirectory(role)).toBe(EXPECTED[role].browse);
    expect(memberProfileExit(role)).toBe(EXPECTED[role].exit);
  });

  it('only the staff browse it', () => {
    expect(TENANT_ROLES.filter(canBrowseMemberDirectory)).toEqual([
      'admin_tenant',
      'support_tenant',
    ]);
  });
});
