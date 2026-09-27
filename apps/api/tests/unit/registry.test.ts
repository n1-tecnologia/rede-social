import {
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  REAL_TENANT_DEFAULT_MODULES,
  TOGGLEABLE_MODULES,
} from '@tria/contracts';
import { defineModule, type ModuleManifest } from '@tria/core/server/modules/manifest';
import { describe, expect, it } from 'vitest';
import {
  effectiveKeys,
  enabledModulesForBootstrap,
  MODULE_REGISTRY,
  permissionsFor,
} from '../../src/modules/registry';

/**
 * MOD-01/MOD-02 + ROLE-06 ordering, with no database: the registry is a pure composition of
 * manifests, so the whole contract (keys are typed and unique, an empty manifest is legal, the sort
 * is deterministic, an unknown key is refused by the VOCABULARY) is testable without a module.
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

/** Runs `fn` against a swapped registry, the same save/restore `bootstrapWith` does. */
function withRegistry<T>(registry: Partial<Record<ModuleKey, ModuleManifest>>, fn: () => T): T {
  const saved = { ...MODULE_REGISTRY };
  for (const key of Object.keys(MODULE_REGISTRY) as ModuleKey[]) delete MODULE_REGISTRY[key];
  Object.assign(MODULE_REGISTRY, registry);
  try {
    return fn();
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
    // 04-10 removed the throwaway reference module's entry with its package (D-19), leaving `feed`
    // — the first REAL module — as the only registration; 05-01 added `communities`, 05-05 added
    // `stories`, 05.3-01 added `reels` and 06-01 added `events`. The list is sorted so a new entry is one line, and this
    // assertion is what makes a silently-dropped registration fail rather than pass.
    expect(keys.sort()).toEqual(['communities', 'events', 'feed', 'reels', 'stories']);
    // D-55 (amends D-40): the feed contributes a HOME SLOT and no navigation tab, so Phases 5 and 6
    // keep the tab budget they are planning against. A nav entry here is a regression, not a feature.
    expect(MODULE_REGISTRY.feed?.nav).toBeUndefined();
    expect(MODULE_REGISTRY.feed?.home).toEqual([{ order: 10 }]);
    // UI-D-25: `stories` spends a HOME SLOT and no tab either — at order 5, ABOVE the feed's 10, so
    // `/inicio` reads welcome -> nudge -> strip -> feed. D-80 makes the strip's own circle the
    // publish door, so a nav entry here would be a regression as well.
    expect(MODULE_REGISTRY.stories?.nav).toBeUndefined();
    expect(MODULE_REGISTRY.stories?.home).toEqual([{ order: 5 }]);
    // D-121 / D-123 / UI-D-81: `reels` spends a TAB at order 30 (between Comunidades' 20 and Phase
    // 6's Eventos at 40), declares the media chrome, and contributes nothing while `feed` is off.
    expect(MODULE_REGISTRY.reels?.nav).toMatchObject({
      placement: 'tab',
      href: '/reels',
      order: 30,
      icon: 'film',
      chrome: 'media',
    });
    expect(MODULE_REGISTRY.reels?.requires).toEqual(['feed']);
    // D-55 / UI-D-215: `events` spends the Eventos TAB at order 40, after Reels' 30.
    expect(MODULE_REGISTRY.events?.nav).toMatchObject({
      placement: 'tab',
      href: '/eventos',
      order: 40,
      icon: 'calendar-days',
    });
    // 06-08 (D-202, UI-D-214): the Início "Próximo evento" card at order 7, strictly BETWEEN the
    // stories row (5) and the feed (10), pinned against both so a move on either side fails here.
    expect(MODULE_REGISTRY.events?.home).toEqual([{ order: 7 }]);
    const storiesOrder = MODULE_REGISTRY.stories?.home?.[0]?.order ?? Number.POSITIVE_INFINITY;
    const feedOrder = MODULE_REGISTRY.feed?.home?.[0]?.order ?? Number.NEGATIVE_INFINITY;
    expect(storiesOrder).toBeLessThan(7);
    expect(feedOrder).toBeGreaterThan(7);
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

  it('4. the key VOCABULARY is the seven real modules, and it is what refuses an unknown key', () => {
    expect(REAL_TENANT_DEFAULT_MODULES).toHaveLength(7);
    expect([...REAL_TENANT_DEFAULT_MODULES].sort()).toEqual([
      'chat',
      'communities',
      'events',
      'feed',
      'notifications',
      'reels',
      'stories',
    ]);
    // 04-10 closed D-19: the reference module's key is gone from the vocabulary itself, so nothing
    // needs a per-key special case to refuse it — `defineModule` already refuses any key that is not
    // in `TOGGLEABLE_MODULES`, which is the rule the retired platform branches used to duplicate.
    expect([...TOGGLEABLE_MODULES].sort()).toEqual([...REAL_TENANT_DEFAULT_MODULES].sort());
    expect(() => defineModule({ key: 'nao-existe' as unknown as ModuleKey })).toThrow(
      /unknown module key/,
    );
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

  it('6b. FEED-08: the posting policy is ONE value, composed here and nowhere else', () => {
    const noSettings = new Map<ModuleKey, Record<string, unknown>>();
    const membersPolicy = settingsFor([['feed', { postingPolicy: 'members' }]]);

    // Default (`admins_only`, and also a tenant whose settings blob simply has no such key).
    expect(permissionsFor('member', new Set<ModuleKey>(['feed']), noSettings)).not.toContain(
      'feed.post.create',
    );
    expect(
      permissionsFor('member', new Set<ModuleKey>(['feed']), settingsFor([['feed', {}]])),
    ).not.toContain('feed.post.create');

    // The ONE change that turns a member into an author — no migration, no route edit.
    expect(permissionsFor('member', new Set<ModuleKey>(['feed']), membersPolicy)).toContain(
      'feed.post.create',
    );

    // The admin holds both permissions from the manifest, whatever the policy says.
    const adminPermissions = permissionsFor(
      'admin_tenant',
      new Set<ModuleKey>(['feed']),
      noSettings,
    );
    expect(adminPermissions).toContain('feed.post.create');
    expect(adminPermissions).toContain('feed.post.manage');

    // A DISABLED module grants nothing, even with the setting turned on: turning `feed` off must
    // revoke what it granted, or a decommissioned module would leave live permissions behind.
    expect(permissionsFor('member', new Set<ModuleKey>(), membersPolicy)).not.toContain(
      'feed.post.create',
    );

    // A malformed settings blob falls back to the SAFE default rather than throwing or failing open.
    expect(
      permissionsFor(
        'member',
        new Set<ModuleKey>(['feed']),
        settingsFor([['feed', { postingPolicy: 'everyone' }]]),
      ),
    ).not.toContain('feed.post.create');
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

  it('10. D-121 requires: a module whose required key is off contributes no bootstrap entry', () => {
    const registry = {
      feed: defineModule({ key: 'feed', home: [{ order: 10 }] }),
      reels: defineModule({
        key: 'reels',
        nav: { placement: 'tab', label: 'Reels', icon: 'film', href: '/reels', order: 30 },
        requires: ['feed'],
      }),
    };
    // `reels` on, `feed` off: the flag is on, yet the entry is absent (Pitfall 6).
    expect(bootstrapWith(registry, ['reels']).map((m) => m.key)).toEqual([]);
    // Positive control: with `feed` on the entry comes back, nav and all.
    const both = bootstrapWith(registry, ['reels', 'feed']);
    expect(both.map((m) => m.key)).toEqual(['reels', 'feed']);
    expect(both[0]?.nav).toMatchObject({ href: '/reels', order: 30 });
  });

  it('11. D-121 requires: a module whose required key is off contributes no permission', () => {
    const registry = {
      feed: defineModule({ key: 'feed' }),
      reels: defineModule({
        key: 'reels',
        requires: ['feed'],
        defaultRolePermissions: { member: ['reels.fixture'] },
      }),
    };
    withRegistry(registry, () => {
      expect(permissionsFor('member', new Set<ModuleKey>(['reels']))).not.toContain(
        'reels.fixture',
      );
      expect(permissionsFor('member', new Set<ModuleKey>(['reels', 'feed']))).toContain(
        'reels.fixture',
      );
    });
  });

  it('12. effectiveKeys resolves a chain until a pass drops nothing', () => {
    // A requires B, B requires C. With C off, B drops on the first pass and A on the second.
    const registry = {
      reels: defineModule({ key: 'reels', requires: ['events'] }),
      events: defineModule({ key: 'events', requires: ['chat'] }),
      chat: defineModule({ key: 'chat' }),
    };
    withRegistry(registry, () => {
      expect([...effectiveKeys(new Set<ModuleKey>(['reels', 'events', 'feed']))]).toEqual(['feed']);
      // Positive control: with C on, the whole chain survives.
      expect([...effectiveKeys(new Set<ModuleKey>(['reels', 'events', 'chat']))].sort()).toEqual([
        'chat',
        'events',
        'reels',
      ]);
      // A key with no manifest (or no `requires`) is never dropped.
      expect([...effectiveKeys(new Set<ModuleKey>(['notifications']))]).toEqual(['notifications']);
    });
  });
});
