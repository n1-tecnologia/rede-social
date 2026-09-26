import { describe, expect, it } from 'vitest';
import { reelsModule } from '../module';

/**
 * D-121 / D-123 / UI-D-81 — the `reels` manifest, as data (MOD-01).
 *
 * Reels is its own module with a navigation tab and NOTHING else: no routes (it reads posts only
 * through feed's published `GET /v1/feed?media=video`), no jobs, no events, no home slot and no
 * permission of its own. Each omitted key is asserted ABSENT, not `undefined`, so "declares none" and
 * "declares an empty one" stay two different statements.
 */
describe('reelsModule — the manifest (D-121, D-123, UI-D-81)', () => {
  it('has the reels key', () => {
    expect(reelsModule.key).toBe('reels');
  });

  it('spends a tab at order 30 with the film icon and the media chrome (D-123, UI-D-81)', () => {
    expect(reelsModule.nav).toEqual({
      placement: 'tab',
      label: 'Reels',
      icon: 'film',
      href: '/reels',
      order: 30,
      chrome: 'media',
    });
  });

  it('requires the feed module (D-121)', () => {
    expect(reelsModule.requires).toEqual(['feed']);
  });

  it('declares no routes, jobs, events, home slot or permissions', () => {
    for (const key of ['routes', 'jobs', 'events', 'home', 'defaultRolePermissions']) {
      expect(reelsModule, key).not.toHaveProperty(key);
    }
  });
});
