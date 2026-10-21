import {
  MODULE_KEY_ORDER_FALLBACK,
  type ModuleKey,
  REAL_TENANT_DEFAULT_MODULES,
  TENANT_ROLES,
  TOGGLEABLE_MODULES,
} from '@rede-social/contracts';
import { defineModule, type ModuleManifest } from '@rede-social/core/server/modules/manifest';
import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { FEED_MAX_IMAGES } from '@rede-social/module-feed/contracts';
import {
  NOTIFICATIONS_QUEUES,
  PUSH_SEND_JOB_CONCURRENCY,
} from '@rede-social/module-notifications/contracts';
import { PAYMENTS_PERMISSIONS } from '@rede-social/module-payments/contracts';
import { SOCIAL_MAX_PHOTOS_PER_POST } from '@rede-social/module-social/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
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
    // `stories`, 05.3-01 added `reels`, 06-01 added `events`, 07-01 `notifications`, 07-08 `chat`,
    // 08.2-01 `store`, 08.3-01 `courses`, 09-01 `social` and 09.1-09 `payments`. The list is sorted so a new entry is one line, and this
    // assertion is what makes a silently-dropped registration fail rather than pass.
    expect(keys.sort()).toEqual([
      'chat',
      'communities',
      'courses',
      'events',
      'feed',
      'notifications',
      'payments',
      'reels',
      'social',
      'store',
      'stories',
    ]);
    // D-482 (09-01): `social` is the module switch for member authoring. It spends no tab (D-479),
    // requires `feed` (D-121) and composes `social.participate` for the member role only.
    expect(MODULE_REGISTRY.social?.nav).toBeUndefined();
    expect(MODULE_REGISTRY.social?.requires).toEqual(['feed']);
    expect(MODULE_REGISTRY.social?.defaultRolePermissions).toEqual({
      member: ['social.participate'],
    });
    // D-40 / UI-D-268 (07-01): the bell is a TOPBAR slot at order 10, badged by the unread count.
    expect(MODULE_REGISTRY.notifications?.nav).toEqual({
      placement: 'topbar',
      label: 'Notificações',
      icon: 'bell',
      badge: 'unreadNotifications',
      href: '/notificacoes',
      order: 10,
    });
    expect(MODULE_REGISTRY.notifications?.counters).toBeTypeOf('function');
    expect(MODULE_REGISTRY.notifications?.defaultRolePermissions).toBeUndefined();
    // D-40 / D-224 (07-08): the support chat is the TOPBAR slot after the bell, badged by the
    // conversations counter, and ONE href for everybody (the web picks thread or inbox).
    expect(MODULE_REGISTRY.chat?.nav).toEqual({
      placement: 'topbar',
      label: 'Suporte',
      icon: 'message-circle',
      badge: 'unreadConversations',
      href: '/suporte',
      order: 20,
    });
    // D-223: `chat.support` comes from the chat manifest for BOTH staff roles (so disabling chat
    // revokes it), and members get only the right to write to the team.
    expect(MODULE_REGISTRY.chat?.defaultRolePermissions).toEqual({
      admin_tenant: ['chat.support'],
      support_tenant: ['chat.support'],
      member: ['chat.support.contact'],
    });
    expect(permissionsFor('admin_tenant', new Set<ModuleKey>(['chat']))).toContain('chat.support');
    expect(permissionsFor('member', new Set<ModuleKey>(['chat']))).toEqual([
      'chat.support.contact',
    ]);
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
    // 08.5-11 (D-401, D-419, UI-D-423): Reels yields its tab to the school's Cursos tab and becomes
    // the LEFTMOST TopBar slot (topbarOrder 1, before Loja's 5) while `courses` is on. The bootstrap
    // contract declares both fields, so they reach the shell unchanged.
    expect(MODULE_REGISTRY.reels?.nav).toMatchObject({
      placement: 'tab',
      href: '/reels',
      order: 30,
      icon: 'film',
      chrome: 'media',
      yieldsTabTo: ['courses'],
      topbarOrder: 1,
    });
    expect(MODULE_REGISTRY.reels?.nav?.topbarOrder).toBeLessThan(
      MODULE_REGISTRY.store?.nav?.order ?? Number.NEGATIVE_INFINITY,
    );
    expect(MODULE_REGISTRY.reels?.requires).toEqual(['feed']);
    // 08.5-11 (D-419, UI-D-423, COURSE-16): the Cursos TAB at order 30, beside Reels' 30.
    expect(MODULE_REGISTRY.courses?.nav).toEqual({
      placement: 'tab',
      label: 'Cursos',
      icon: 'graduation-cap',
      href: '/cursos',
      order: 30,
    });
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

  it('4. the key VOCABULARY is the seven default modules plus store, courses, social and payments, and it refuses an unknown key', () => {
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
    // 08.2 (STORE-01): `store` is the first key that may exist but is NOT offered to a new tenant by
    // default (a module behind a paid tier changes only the second list). 08.3 (COURSE-01): `courses`
    // is the second, appended LAST so the generated `tenant_modules_key_chk` keeps the list's order.
    // 09-01 (D-482, SOCIAL-01, EP-03): `social` is the third, appended LAST in turn and absent from
    // the default list, so a new tenant starts with it off and no existing tenant gets a row.
    // 09.1-02 (D-501): `payments` is the fourth, appended LAST the same way.
    expect([...TOGGLEABLE_MODULES].sort()).toEqual(
      [...REAL_TENANT_DEFAULT_MODULES, 'store', 'courses', 'social', 'payments'].sort(),
    );
    expect(TOGGLEABLE_MODULES.at(-1)).toBe('payments');
    expect(REAL_TENANT_DEFAULT_MODULES).not.toContain('store');
    expect(REAL_TENANT_DEFAULT_MODULES).not.toContain('courses');
    expect(REAL_TENANT_DEFAULT_MODULES).not.toContain('social');
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
    // 07-08 (D-223): the kernel grants support nothing; `chat.support` comes from the chat manifest.
    expect(permissionsFor('support_tenant')).toEqual([]);
    expect(permissionsFor('admin_tenant')).toEqual([
      'content.publish',
      'members.manage',
      'moderation.manage',
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

  it('6b. D-482: the `social` module is the ONE switch that turns a member into an author', () => {
    const noSettings = new Map<ModuleKey, Record<string, unknown>>();
    const authoring = ['feed.post.create', 'feed.post.manage', 'social.participate'];
    const hasAll = (permissions: string[]) => authoring.every((p) => permissions.includes(p));
    const hasNone = (permissions: string[]) => authoring.every((p) => !permissions.includes(p));

    // `feed` + `social`: the member holds the three, each once.
    const on = permissionsFor('member', new Set<ModuleKey>(['feed', 'social']), noSettings);
    expect(hasAll(on)).toBe(true);
    for (const permission of authoring) {
      expect(
        on.filter((p) => p === permission),
        permission,
      ).toHaveLength(1);
    }

    // `feed` alone (the default of every tenant) and `social` without `feed` (D-121): none.
    expect(hasNone(permissionsFor('member', new Set<ModuleKey>(['feed']), noSettings))).toBe(true);
    expect(hasNone(permissionsFor('member', new Set<ModuleKey>(['social']), noSettings))).toBe(
      true,
    );
    expect(hasNone(permissionsFor('member', new Set<ModuleKey>(), noSettings))).toBe(true);

    // T-09-45: the legacy posting-policy blob is IGNORED. A members value on `feed` grants nothing
    // by itself, and a garbage value changes no set in either direction.
    const membersBlob = settingsFor([['feed', { postingPolicy: 'members' }]]);
    const garbageBlob = settingsFor([['feed', { postingPolicy: 'everyone', junk: [1, 2] }]]);
    expect(hasNone(permissionsFor('member', new Set<ModuleKey>(['feed']), membersBlob))).toBe(true);
    expect(hasNone(permissionsFor('member', new Set<ModuleKey>(['feed']), garbageBlob))).toBe(true);
    for (const blob of [membersBlob, garbageBlob]) {
      expect(permissionsFor('member', new Set<ModuleKey>(['feed', 'social']), blob)).toEqual(on);
    }

    // EP-05: an empty settings map, a missing `feed` blob and a malformed blob give the SAME set.
    const social = new Set<ModuleKey>(['feed', 'social']);
    for (const settings of [
      noSettings,
      settingsFor([['feed', {}]]),
      settingsFor([['stories', { ttlHours: 24 }]]),
      settingsFor([['feed', null as unknown as Record<string, unknown>]]),
    ]) {
      expect(permissionsFor('member', social, settings)).toEqual(on);
    }

    // The admin holds create and manage from the feed manifest whatever `social` says.
    for (const enabled of [new Set<ModuleKey>(['feed']), social]) {
      const admin = permissionsFor('admin_tenant', enabled, noSettings);
      expect(admin).toContain('feed.post.create');
      expect(admin).toContain('feed.post.manage');
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

  it('13. quick 261006-fs9: only notifications.push-send declares a worker concurrency, and it is 4', () => {
    const declared = Object.values(MODULE_REGISTRY)
      .flatMap((manifest) => manifest?.jobs ?? [])
      .filter((job) => job.concurrency !== undefined)
      .map((job) => [job.name, job.concurrency]);
    // Every other queue runs at pg-boss's default 1; the worker pool (DATABASE_POOL_MAX=10) is sized
    // for exactly this (docs/DEPLOY.md "Connection budget (Pro)").
    expect(declared).toEqual([[NOTIFICATIONS_QUEUES.pushSend, PUSH_SEND_JOB_CONCURRENCY]]);
    expect(PUSH_SEND_JOB_CONCURRENCY).toBe(4);
  });

  it('14. 08.2 review WR-03: store.product.manage is composed for admin_tenant ONLY, whatever is enabled or set', () => {
    // The database authorises the store by the `admin_tenant` CLAIM, not by this permission: the
    // ledgers' select policies (other members' orders and entitlements), the catalogue and link
    // write policies (CR-01) and the grant/revoke definers. The routes authorise by the permission.
    // They agree only while this permission is admin-only by construction; composing it for another
    // role would make the buyers list, holderCount and the lock preview silently wrong. This is the
    // tripwire: widen the SQL with it, or never compose it elsewhere.
    const everything = new Set<ModuleKey>(TOGGLEABLE_MODULES);
    const generous = settingsFor([
      ['feed', { postingPolicy: 'members' }],
      ['store', { managers: ['support_tenant', 'member'] }],
    ]);
    for (const role of TENANT_ROLES) {
      for (const settings of [new Map<ModuleKey, Record<string, unknown>>(), generous]) {
        expect(
          permissionsFor(role, everything, settings).includes(STORE_PERMISSIONS.manage),
          `${role}: store.product.manage`,
        ).toBe(role === 'admin_tenant');
      }
    }
  });

  it('15. 08.3 D-403: courses.manage is composed for admin_tenant ONLY, whatever is enabled or set', () => {
    // The database authorises the school by the `admin_tenant` CLAIM, not by this permission: every
    // write policy of the eleven course tables, the draft branch of `courses_select_published_or_admin`
    // and the admin branch of the restrictive lesson gate. The routes authorise by the permission.
    // They agree only while this permission is admin-only by construction; composing it for another
    // role would make that role's writes fail under RLS and its reads silently miss drafts. This is
    // the tripwire: widen the SQL with it, or never compose it elsewhere. `courses` has no `requires`
    // (D-405), so the store's flag never decides whether the permission exists.
    const everything = new Set<ModuleKey>(TOGGLEABLE_MODULES);
    const withoutStore = new Set<ModuleKey>(TOGGLEABLE_MODULES.filter((key) => key !== 'store'));
    const generous = settingsFor([
      ['feed', { postingPolicy: 'members' }],
      ['courses', { managers: ['support_tenant', 'member'], memberPublishing: true }],
    ]);
    for (const role of TENANT_ROLES) {
      for (const enabled of [everything, withoutStore]) {
        for (const settings of [new Map<ModuleKey, Record<string, unknown>>(), generous]) {
          expect(
            permissionsFor(role, enabled, settings).includes(COURSE_PERMISSIONS.manage),
            `${role}: courses.manage`,
          ).toBe(role === 'admin_tenant');
        }
      }
    }
    // Turning the module off revokes it, even for the admin.
    expect(
      permissionsFor('admin_tenant', new Set<ModuleKey>(['feed', 'store'])).includes(
        COURSE_PERMISSIONS.manage,
      ),
    ).toBe(false);
    // D-405: no requires. (D-401's "no nav" held through 08.3; 08.5-11 adds the Cursos tab, D-419.)
    expect(MODULE_REGISTRY.courses?.nav).toMatchObject({ placement: 'tab', href: '/cursos' });
    expect(MODULE_REGISTRY.courses?.requires).toBeUndefined();
  });

  it('16. 09-01 EP-04: social.participate is composed for the member role ONLY, whatever is enabled or set', () => {
    // The follow routes and the member branch of the directory check this permission, and the RLS
    // and definers they reach key on the MEMBER role. Granting it to staff would let `support_tenant`
    // into routes whose SQL does not expect it (the store case 14 shape, mirrored).
    const everything = new Set<ModuleKey>(TOGGLEABLE_MODULES);
    const withoutSocial = new Set<ModuleKey>(TOGGLEABLE_MODULES.filter((key) => key !== 'social'));
    const generous = settingsFor([
      ['feed', { postingPolicy: 'members' }],
      ['social', { participants: ['support_tenant', 'admin_tenant'] }],
    ]);
    for (const role of TENANT_ROLES) {
      for (const settings of [new Map<ModuleKey, Record<string, unknown>>(), generous]) {
        expect(
          permissionsFor(role, everything, settings).includes('social.participate'),
          `${role}: social.participate`,
        ).toBe(role === 'member');
      }
    }
    // The composed set of both staff roles is identical with and without `social`.
    for (const role of ['admin_tenant', 'support_tenant'] as const) {
      expect(permissionsFor(role, everything)).toEqual(permissionsFor(role, withoutSocial));
    }
  });

  it('17. 09-01 EP-06/EP-07: the composed set is sorted, de-duplicated and idempotent', () => {
    const forward = new Set<ModuleKey>(['feed', 'social', 'store', 'chat']);
    const reverse = new Set<ModuleKey>(['chat', 'store', 'social', 'feed']);
    const first = permissionsFor('member', forward);
    // EP-06: ascending order whatever the iteration order of the enabled set.
    expect(first).toEqual([...first].sort());
    expect(permissionsFor('member', reverse)).toEqual(first);
    expect(first.indexOf('feed.post.manage')).toBeLessThan(first.indexOf('social.participate'));
    // EP-07: two calls with identical inputs are deep-equal and `feed.post.create` appears once,
    // although both the feed manifest and the social branch could add it for some role.
    expect(permissionsFor('member', forward)).toEqual(first);
    expect(first.filter((p) => p === 'feed.post.create')).toHaveLength(1);
    expect(new Set(first).size).toBe(first.length);
  });

  it('18. 09-01 D-121: `social` requires `feed` - the bootstrap lists it only while feed is on', () => {
    const social = defineModule({ key: 'social', requires: ['feed'] });
    const feed = defineModule({ key: 'feed', home: [{ order: 10 }] });
    // EP-01: social on with feed off contributes no entry; feed back on restores it.
    expect(bootstrapWith({ social, feed }, ['social']).map((m) => m.key)).toEqual([]);
    expect(bootstrapWith({ social, feed }, ['social', 'feed']).map((m) => m.key)).toEqual([
      'feed',
      'social',
    ]);
    // EP-03: it has no nav, so it sorts after every navigable module and ties by key.
    expect(bootstrapWith({ social, feed }, ['social', 'feed']).at(-1)?.nav).toBeUndefined();
  });

  it('19. 09-06 D-474: the settings cap on photos per post is the feed’s own image cap', () => {
    // The social settings schema cannot import the feed contract (module to module), so the number is
    // written twice; this is the only place that reads both and fails the day they drift.
    expect(SOCIAL_MAX_PHOTOS_PER_POST).toBe(FEED_MAX_IMAGES);
  });

  it('20. 09.1-09 D-338/D-501: payments.manage is composed for admin_tenant ONLY while the module is on', () => {
    // The database authorises the setup tables by the `admin_tenant` CLAIM (the `payment_products`
    // policies, the settings write and the integration through the kernel lane); the routes authorise
    // by this permission. They agree only while it is admin-only by construction (the store case 14
    // shape, mirrored): widen the SQL with it, or never compose it elsewhere.
    const everything = new Set<ModuleKey>(TOGGLEABLE_MODULES);
    const withoutPayments = new Set<ModuleKey>(
      TOGGLEABLE_MODULES.filter((key) => key !== 'payments'),
    );
    const generous = settingsFor([
      ['feed', { postingPolicy: 'members' }],
      ['payments', { managers: ['support_tenant', 'member'] }],
    ]);
    for (const role of TENANT_ROLES) {
      for (const settings of [new Map<ModuleKey, Record<string, unknown>>(), generous]) {
        expect(
          permissionsFor(role, everything, settings).includes(PAYMENTS_PERMISSIONS.manage),
          `${role}: payments.manage`,
        ).toBe(role === 'admin_tenant');
      }
      // Turning the module off revokes it, even for the admin.
      expect(permissionsFor(role, withoutPayments).includes(PAYMENTS_PERMISSIONS.manage)).toBe(
        false,
      );
    }
    const manifest = MODULE_REGISTRY.payments;
    expect(manifest?.key).toBe('payments');
    // UI-D-513 / UI-D-527: no nav (its door is a Configuracoes row) and no `requires` (it works with
    // the store off).
    expect(manifest).not.toHaveProperty('nav');
    expect(manifest?.requires).toBeUndefined();
    expect(manifest?.sweepFunctions).toEqual(['payment_events_prune']);
    // A tenant with the module on lists it in the bootstrap without a nav entry; off, it is absent.
    const on = enabledModulesForBootstrap(new Set<ModuleKey>(['payments']), new Map());
    expect(on.map((entry) => entry.key)).toEqual(['payments']);
    expect(on[0]).not.toHaveProperty('nav');
    expect(enabledModulesForBootstrap(new Set<ModuleKey>(), new Map())).toEqual([]);
  });

  it('21. 09.1-09: adding the payments entry changes no other module’s composed permissions or bootstrap entry', () => {
    // The permission map for each role, and the bootstrap list, with and without the `payments` manifest.
    // The only difference the new entry may make is `payments.manage` for admin_tenant and its own
    // (nav-less) bootstrap entry; a snapshot per role fails if the registration ever leaks into another
    // module's grants.
    const everything = new Set<ModuleKey>(TOGGLEABLE_MODULES);
    const withoutManifest = Object.fromEntries(
      Object.entries(MODULE_REGISTRY).filter(([key]) => key !== 'payments'),
    ) as Partial<Record<ModuleKey, ModuleManifest>>;
    for (const role of TENANT_ROLES) {
      const before = withRegistry(withoutManifest, () => permissionsFor(role, everything));
      const after = permissionsFor(role, everything);
      expect(
        after.filter((permission) => permission !== PAYMENTS_PERMISSIONS.manage),
        role,
      ).toEqual(before);
      expect(after.length - before.length, role).toBe(role === 'admin_tenant' ? 1 : 0);
    }
    const settings = new Map<ModuleKey, Record<string, unknown>>();
    const bootstrapBefore = withRegistry(withoutManifest, () =>
      enabledModulesForBootstrap(everything, settings),
    );
    const bootstrapAfter = enabledModulesForBootstrap(everything, settings);
    expect(bootstrapAfter.filter((entry) => entry.key !== 'payments')).toEqual(
      bootstrapBefore.filter((entry) => entry.key !== 'payments'),
    );
    expect(bootstrapAfter.filter((entry) => entry.key === 'payments')).toEqual([
      { key: 'payments', settings: {} },
    ]);
  });
});
