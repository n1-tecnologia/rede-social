import { describe, expect, it } from 'vitest';
import { PROFILE_FORM_PERMISSIONS } from '../contracts/index';
import { profileFormModule } from '../module';

describe('12-02 - the profile_form manifest (D-596)', () => {
  it('has the confirmed key and permission names', () => {
    expect(profileFormModule.key).toBe('profile_form');
    expect(PROFILE_FORM_PERMISSIONS).toEqual({
      manage: 'profile_form.manage',
      read: 'profile_form.read',
    });
  });

  it('composes manage for the admin only and read for both staff roles', () => {
    expect(profileFormModule.defaultRolePermissions).toEqual({
      admin_tenant: ['profile_form.manage', 'profile_form.read'],
      support_tenant: ['profile_form.read'],
    });
    expect(profileFormModule.defaultRolePermissions).not.toHaveProperty('member');
  });

  it('has no nav entry and no requires', () => {
    expect(profileFormModule).not.toHaveProperty('nav');
    expect(profileFormModule.requires).toBeUndefined();
  });
});
