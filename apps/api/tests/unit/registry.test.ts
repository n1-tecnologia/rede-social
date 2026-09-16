import {
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  REAL_TENANT_DEFAULT_MODULES,
  TOGGLEABLE_MODULES,
} from '@tria/contracts';
import { defineModule, type ModuleManifest } from '@tria/core/server/modules/manifest';
import { describe, expect, it } from 'vitest';
import {
  enabledModulesForBootstrap,
  MODULE_REGISTRY,
  permissionsFor,
} from '../../src/modules/registry';

/**
 * MOD-01/MOD-02 + ROLE-06 ordering, with no database: the registry is a pure composition of
 * manifests, so the whole contract (keys are typed and unique, an empty manifest is legal, the sort
 * is deterministic, `example` never reaches a real tenant) is testable before any module exists.
 */

const settingsFor = (entries: [ModuleKey, Record<string, unknown>][]) => new Map(entries);

/** A registry built for one test, so the real (empty) one is never mutated. */
function bootstrapWith(
  registry: Partial<Record<ModuleKey, ModuleManifest>>,
  enabled: ModuleKey[],
  settings = new Map<ModuleKey, Record<string, unknown>>(),
) {
  const saved = { ...MODULE_REGISTRY };
  for (const key of Object.keys(MODULE_REGISTRY) as ModuleKey[]) delete MODULE_REGISTRY[key];
  Object.assign(MODULE_REGISTRY, registry);
  try {
    return enabledModulesForBootstrap(new Set(enabled), settings);
  } finally {
    for (const key of Object.keys(MODULE_REGISTRY) as ModuleKey[]) delete MODULE_REGISTRY[key];
    Object.assign(MODULE_REGISTRY, saved);
  }
}

describe('MODULE_REGISTRY — the kernel/module contract composed in the app tier', () => {
  it('1. every registered key equals its manifest key and is a known module key (MOD-01 adjacency)', () => {
    const keys = Object.keys(MODULE_REGISTRY) as ModuleKey[];
    // Uniqueness is structural: a Record cannot hold the same key twice.
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(MODULE_REGISTRY[key]?.key).toBe(key);
      expect(TOGGLEABLE_MODULES).toContain(key);
    }
    // 01-07 registered the throwaway reference module (D-19); Phase 4 removes it with the package.
    expect(keys).toEqual(['example']);
    expect(MODULE_REGISTRY.example?.nav?.order).toBe(90);
  });

  it('2. defineModule accepts a manifest with only a key, and it lists without nav (MOD-01 empty)', () => {
    const bare = defineModule({ key: 'chat' });
    expect(bare).toEqual({ key: 'chat' });
    expect(() => defineModule({ key: 'nope' as ModuleKey })).toThrow(/unknown module key/);

    const [entry, ...rest] = bootstrapWith({ chat: bare }, ['chat']);
    expect(rest).toHaveLength(0);
    expect(entry).toEqual({ key: 'chat', settings: {} });
    expect(entry).not.toHaveProperty('nav');
  });

  it('3. ordering: nav.order ascending, then key ascending, manifest-less keys last (ROLE-06)', () => {
    const later = defineModule({
      key: 'events',
      nav: { label: 'Eventos', icon: 'calendar', href: '/eventos', order: 20 },
    });
    const earlier = defineModule({
      key: 'feed',
      nav: { label: 'Feed', icon: 'home', href: '/feed', order: 10 },
    });

    expect(
      bootstrapWith({ events: later, feed: earlier }, ['chat', 'events', 'feed']).map((m) => m.key),
    ).toEqual(['feed', 'events', 'chat']);

    // Ties on the same order fall back to the key, and so do the manifest-less ones.
    const tie = defineModule({
      key: 'communities',
      nav: { label: 'Comunidades', icon: 'users', href: '/comunidades', order: 10 },
    });
    expect(
      bootstrapWith({ communities: tie, feed: earlier }, [
        'stories',
        'notifications',
        'feed',
        'communities',
      ]).map((m) => m.key),
    ).toEqual(['communities', 'feed', 'notifications', 'stories']);
  });

  it('4. prohibition: REAL_TENANT_DEFAULT_MODULES holds the six toggleable keys and never `example`', () => {
    expect(REAL_TENANT_DEFAULT_MODULES).toHaveLength(6);
    expect(REAL_TENANT_DEFAULT_MODULES).not.toContain('example');
    expect([...REAL_TENANT_DEFAULT_MODULES].sort()).toEqual([
      'chat',
      'communities',
      'events',
      'feed',
      'notifications',
      'stories',
    ]);
    // `example` is a real key (it can be enabled per tenant) — it is simply never a default (D-19).
    expect(TOGGLEABLE_MODULES).toContain('example');
  });

  it('5. settings ride along per key, defaulting to an empty object', () => {
    const list = bootstrapWith(
      {},
      ['stories', 'feed'],
      settingsFor([['stories', { ttlHours: 24 }]]),
    );
    expect(list.map((m) => [m.key, m.settings])).toEqual([
      ['feed', {}],
      ['stories', { ttlHours: 24 }],
    ]);
    // Manifest-less keys share the fallback bucket, so the key decides the order among them.
    expect(MODULE_KEY_ORDER_FALLBACK).toBe(1000);
  });

  it('6. permissions: kernel defaults, plus only the ENABLED modules’ contributions', () => {
    expect(permissionsFor('member')).toEqual([]);
    expect(permissionsFor('support_tenant')).toEqual(['chat.support']);
    expect(permissionsFor('admin_tenant')).toEqual([
      'content.publish',
      'members.manage',
      'tenant.manage',
    ]);

    const saved = { ...MODULE_REGISTRY };
    Object.assign(MODULE_REGISTRY, {
      feed: defineModule({
        key: 'feed',
        defaultRolePermissions: { member: ['feed.like', 'feed.comment.create'] },
      }),
      chat: defineModule({ key: 'chat', defaultRolePermissions: { member: ['chat.write'] } }),
    });
    try {
      // Enabled contributes; disabled (`chat`) does not — turning a module off revokes its grants.
      expect(permissionsFor('member', new Set<ModuleKey>(['feed']))).toEqual([
        'feed.comment.create',
        'feed.like',
      ]);
      expect(permissionsFor('member', new Set<ModuleKey>())).toEqual([]);
    } finally {
      for (const key of Object.keys(MODULE_REGISTRY) as ModuleKey[]) delete MODULE_REGISTRY[key];
      Object.assign(MODULE_REGISTRY, saved);
    }
  });

  it('7. D-42 home slots: a manifest `home` array reaches the bootstrap entry verbatim', () => {
    const widget = defineModule({
      key: 'feed',
      nav: { label: 'Feed', icon: 'home', href: '/feed', order: 10 },
      home: [{ order: 5 }],
    });
    const [entry] = bootstrapWith({ feed: widget }, ['feed']);
    expect(entry?.home).toEqual([{ order: 5 }]);
  });

  it('8. D-42 home slots: a manifest without `home` produces an entry without a `home` key', () => {
    const bare = defineModule({
      key: 'events',
      nav: { label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 20 },
    });
    const [entry] = bootstrapWith({ events: bare }, ['events']);
    expect(entry).not.toHaveProperty('home');
    expect(entry).toEqual({
      key: 'events',
      nav: { label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 20 },
      settings: {},
    });
  });

  it('9. D-40 placement: a `topbar` nav entry with a badge passes through unchanged', () => {
    const bell = defineModule({
      key: 'notifications',
      nav: {
        label: 'Notificações',
        icon: 'bell',
        href: '/notificacoes',
        order: 5,
        placement: 'topbar',
        badge: 'unreadNotifications',
      },
    });
    const [entry] = bootstrapWith({ notifications: bell }, ['notifications']);
    expect(entry?.nav).toEqual({
      label: 'Notificações',
      icon: 'bell',
      href: '/notificacoes',
      order: 5,
      placement: 'topbar',
      badge: 'unreadNotifications',
    });
  });
});
