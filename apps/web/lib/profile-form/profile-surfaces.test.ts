import { describe, expect, it } from 'vitest';
import { profileFormSurfaces } from './profile-surfaces';

/** 12-14 (D-584, D-586): the member role with the module on, and only then; the notice needs news. */
describe('profileFormSurfaces', () => {
  it('shows both surfaces to a member with the module on, the notice only above zero', () => {
    expect(profileFormSurfaces('member', { pendingRequired: 0, newOptional: 2 })).toEqual({
      showAnswers: true,
      noticeCount: 2,
    });
    expect(profileFormSurfaces('member', { pendingRequired: 0, newOptional: 0 })).toEqual({
      showAnswers: true,
      noticeCount: 0,
    });
  });

  it('shows nothing to staff, whatever the block says', () => {
    for (const role of ['admin_tenant', 'support_tenant', 'super_admin']) {
      expect(profileFormSurfaces(role, { pendingRequired: 0, newOptional: 5 })).toEqual({
        showAnswers: false,
        noticeCount: 0,
      });
    }
  });

  it('shows nothing with the module off (no block in the bootstrap)', () => {
    expect(profileFormSurfaces('member', undefined)).toEqual({
      showAnswers: false,
      noticeCount: 0,
    });
  });
});
