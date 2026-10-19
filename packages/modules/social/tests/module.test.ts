import { describe, expect, it } from 'vitest';
import { SOCIAL_MODULE_KEY, SOCIAL_PERMISSIONS } from '../contracts/index';
import { socialModule } from '../module';

/**
 * 09-01 (SOCIAL-01, SOCIAL-02, D-482, D-121) - the `social` manifest, as data (MOD-01).
 *
 * The module owns one permission and no navigation. Each omitted key is asserted ABSENT, not
 * `undefined`, so "declares none" and "declares an empty one" stay two different statements.
 */
describe('socialModule - the manifest (D-482)', () => {
  it('has the social key', () => {
    expect(socialModule.key).toBe('social');
    expect(SOCIAL_MODULE_KEY).toBe('social');
  });

  it('requires the feed module (D-121)', () => {
    expect(socialModule.requires).toEqual(['feed']);
  });

  it('grants social.participate to the member role and to no staff role', () => {
    expect(SOCIAL_PERMISSIONS.participate).toBe('social.participate');
    expect(socialModule.defaultRolePermissions).toEqual({ member: ['social.participate'] });
    expect(socialModule.defaultRolePermissions).not.toHaveProperty('admin_tenant');
    expect(socialModule.defaultRolePermissions).not.toHaveProperty('support_tenant');
  });

  it('declares no navigation, routes, jobs, events, home slot or notification sources', () => {
    for (const key of [
      'nav',
      'routes',
      'jobs',
      'events',
      'home',
      'notificationSources',
      'notificationRetractions',
    ]) {
      expect(socialModule, key).not.toHaveProperty(key);
    }
  });

  it('does not name a feed permission (that edge belongs to the app-tier registry, MOD-02)', () => {
    const granted = Object.values(socialModule.defaultRolePermissions ?? {}).flat();
    expect(granted.filter((permission) => permission.startsWith('feed.'))).toEqual([]);
  });
});
