import { describe, expect, it } from 'vitest';
import { SOCIAL_MODULE_KEY, SOCIAL_PERMISSIONS } from '../contracts/index';
import { socialModule } from '../module';

/**
 * 09-01 (SOCIAL-01, SOCIAL-02, D-482, D-121) - the `social` manifest, as data (MOD-01).
 *
 * The module owns one permission, one notification source (11-11) and no navigation. Each omitted key is asserted ABSENT, not
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

  it('declares a routes loader (09-02) and no navigation, jobs, events or home slot', () => {
    expect(typeof socialModule.routes).toBe('function');
    for (const key of ['nav', 'jobs', 'events', 'home', 'notificationRetractions']) {
      expect(socialModule, key).not.toHaveProperty(key);
    }
  });

  // 11-11 (D-727): the one source of the module, "começou a te seguir". No retraction: the row is never taken back.
  it('declares exactly one notification source, for social.followed, and no retraction', () => {
    expect(socialModule.notificationSources?.map((source) => source.event)).toEqual([
      'social.followed',
    ]);
    expect(socialModule).not.toHaveProperty('notificationRetractions');
  });

  it('does not name a feed permission (that edge belongs to the app-tier registry, MOD-02)', () => {
    const granted = Object.values(socialModule.defaultRolePermissions ?? {}).flat();
    expect(granted.filter((permission) => permission.startsWith('feed.'))).toEqual([]);
  });
});
