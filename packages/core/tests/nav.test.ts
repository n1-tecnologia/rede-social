import {
  Bell,
  GraduationCap,
  LayoutGrid,
  PackageCheck,
  Radio,
  Route,
  ShoppingBag,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  activeArea,
  activeTabChrome,
  activeTabKey,
  buildNav,
  iconFor,
  isNavItemActive,
  type NavArea,
  type NavItem,
  type NavLabels,
  type NavModule,
  type ShellNav,
  withAreas,
  withCollapsingTabs,
  isFixedTopSlot,
  phoneBarItems,
  phoneChrome,
  withPhoneLayout,
  withPhoneTabSlots,
  withRailMainSlots,
  withTabDots,
  withTabOverrides,
} from '../ui';
import { isAreaScreenCurrent, isAreaScreenHere } from '../ui/nav';

/**
 * MOD-04 / D-40: the shell's navigation is a pure function of the bootstrap's ENABLED module entries.
 * Kernel Início first, kernel Perfil last (no flag — D-16), module tabs by `nav.order` then key,
 * `placement: 'topbar'` entries in their own row, labels resolved through the module's own catalog
 * namespace before the manifest fallback.
 */

const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };

const modules: NavModule[] = [
  {
    key: 'events',
    nav: { order: 20, placement: 'tab', href: '/eventos', icon: 'calendar-days', label: 'Eventos' },
  },
  {
    key: 'communities',
    nav: { order: 20, href: '/comunidades', icon: 'users', label: 'Comunidades' },
  },
  {
    key: 'notifications',
    nav: {
      order: 5,
      placement: 'topbar',
      badge: 'unreadNotifications',
      href: '/notificacoes',
      icon: 'bell',
      label: 'Notificações',
    },
  },
  // Enabled but without a nav entry (stories-like): never a tab, never a slot.
  { key: 'feed' },
];

describe('buildNav (MOD-04 / D-40)', () => {
  it('MOD-04/empty: no modules → exactly Início and Perfil, no topbar slot', () => {
    const nav = buildNav([], labels);
    expect(nav.tabs).toEqual([
      { key: 'home', href: '/inicio', icon: 'home', label: 'Início' },
      { key: 'profile', href: '/perfil', icon: 'user', label: 'Perfil' },
    ]);
    expect(nav.topbar).toEqual([]);
  });

  it('MOD-04/ordering + adjacency: Início first, tabs by order then key, Perfil last; topbar apart', () => {
    const nav = buildNav(modules, labels);
    // Same order 20 → tie-break by key: communities before events.
    expect(nav.tabs.map((t) => t.key)).toEqual(['home', 'communities', 'events', 'profile']);
    expect(nav.topbar.map((t) => t.key)).toEqual(['notifications']);
    expect(nav.topbar[0]?.badge).toBe('unreadNotifications');
    expect(nav.topbar[0]?.icon).toBe('bell');
    // A module without nav contributes nothing anywhere.
    expect([...nav.tabs, ...nav.topbar].some((t) => t.key === 'feed')).toBe(false);
  });

  it('labels: the module catalog resolver wins over the manifest label; null falls back', () => {
    const nav = buildNav(modules, {
      ...labels,
      module: (key, fallback) => (key === 'events' ? 'Catálogo' : fallback === 'x' ? 'y' : null),
    });
    expect(nav.tabs.find((t) => t.key === 'events')?.label).toBe('Catálogo');
    expect(nav.tabs.find((t) => t.key === 'communities')?.label).toBe('Comunidades');
    expect(nav.tabs[0]?.label).toBe('Início');
    expect(nav.tabs.at(-1)?.label).toBe('Perfil');
  });
});

describe('store slot ordering (08.2-07 / P03 / UI-D-366)', () => {
  const slot = (key: string, order: number, icon: string, href: string) => ({
    key,
    nav: { order, placement: 'topbar' as const, href, icon, label: key },
  });

  it('P03: the topbar slots sort by manifest order, so the store (5) comes before notifications (10) and chat (20)', () => {
    // Declared out of order on purpose: the row is the sort, never the input order.
    const nav = buildNav(
      [
        slot('chat', 20, 'message-circle', '/suporte'),
        slot('notifications', 10, 'bell', '/notificacoes'),
        slot('store', 5, 'shopping-bag', '/loja'),
      ],
      labels,
    );
    expect(nav.topbar.map((s) => s.key)).toEqual(['store', 'notifications', 'chat']);
    expect(nav.topbar[0]).toEqual({
      key: 'store',
      href: '/loja',
      icon: 'shopping-bag',
      label: 'store',
    });
    // The store declares no badge key: the slot never draws a count.
    expect(nav.topbar[0]).not.toHaveProperty('badge');
    // The BottomNav is unchanged by a topbar entry (D-350).
    expect(nav.tabs.map((t) => t.key)).toEqual(['home', 'profile']);
    expect(iconFor('shopping-bag')).toBe(ShoppingBag);
  });

  it('P03: two slots with the same order keep the kernel tie-break (by key)', () => {
    const nav = buildNav(
      [slot('zeta', 5, 'bell', '/z'), slot('store', 5, 'shopping-bag', '/loja')],
      labels,
    );
    expect(nav.topbar.map((s) => s.key)).toEqual(['store', 'zeta']);
  });
});

describe('active state (longest match, ties to the first tab)', () => {
  it('isNavItemActive strips the hash/query and matches the path or a sub-path', () => {
    expect(isNavItemActive('/inicio', '/inicio#destaques')).toBe(true);
    expect(isNavItemActive('/inicio', '/inicio?tab=x')).toBe(true);
    expect(isNavItemActive('/eventos/123', '/eventos')).toBe(true);
    expect(isNavItemActive('/eventos-antigos', '/eventos')).toBe(false);
    expect(isNavItemActive('/perfil', '/inicio')).toBe(false);
  });

  it('activeTabKey: a module anchor on /inicio never steals Início; sub-paths resolve to their tab', () => {
    const tabs = buildNav(
      [
        ...modules,
        {
          key: 'stories',
          nav: { order: 90, href: '/inicio#destaques', icon: 'sparkles', label: 'Destaques' },
        },
      ],
      labels,
    ).tabs;
    expect(activeTabKey(tabs, '/inicio')).toBe('home');
    expect(activeTabKey(tabs, '/eventos/123')).toBe('events');
    expect(activeTabKey(tabs, '/perfil')).toBe('profile');
    expect(activeTabKey(tabs, '/configuracoes')).toBeNull();
  });
});

describe('media chrome (UI-D-81: declared by the nav entry, never a pathname in the kernel)', () => {
  const withReels: NavModule[] = [
    ...modules,
    {
      key: 'reels',
      nav: {
        order: 30,
        placement: 'tab',
        href: '/reels',
        icon: 'film',
        label: 'Reels',
        chrome: 'media',
      },
    },
  ];

  it('UI-D-81: an entry declaring chrome media yields a tab carrying it; others carry no chrome key', () => {
    const nav = buildNav(withReels, labels);
    expect(nav.tabs.find((t) => t.key === 'reels')?.chrome).toBe('media');
    for (const tab of nav.tabs.filter((t) => t.key !== 'reels')) {
      expect(Object.hasOwn(tab, 'chrome'), tab.key).toBe(false);
    }
    expect(nav.topbar.every((t) => !Object.hasOwn(t, 'chrome'))).toBe(true);
  });

  it('UI-D-81: activeTabKey selects the media tab on its path and its sub-paths', () => {
    const { tabs } = buildNav(withReels, labels);
    expect(activeTabKey(tabs, '/reels')).toBe('reels');
    expect(activeTabKey(tabs, '/reels/abc')).toBe('reels');
    expect(activeTabKey(tabs, '/reels-antigos')).toBeNull();
  });

  it('UI-D-81: activeTabChrome is media only while the media tab is active', () => {
    const { tabs } = buildNav(withReels, labels);
    expect(activeTabChrome(tabs, '/reels')).toBe('media');
    expect(activeTabChrome(tabs, '/reels/abc')).toBe('media');
    expect(activeTabChrome(tabs, '/inicio')).toBeNull();
    expect(activeTabChrome(tabs, '/eventos/123')).toBeNull();
    expect(activeTabChrome(tabs, '/configuracoes')).toBeNull();
    // A nav with no media entry never asks for the media chrome.
    expect(activeTabChrome(buildNav(modules, labels).tabs, '/reels')).toBeNull();
  });
});

describe('the Cursos tab and the Reels demotion (08.5-11: D-401, D-419, UI-D-423, COURSE-16)', () => {
  // The bootstrap's nav entries as rede-demo's manifests declare them (store, bell, support chat,
  // communities, courses, reels, events), deliberately out of order: the rows are the sort.
  const reels: NavModule = {
    key: 'reels',
    nav: {
      placement: 'tab',
      label: 'Reels',
      icon: 'film',
      href: '/reels',
      order: 30,
      chrome: 'media',
      yieldsTabTo: ['courses'],
      topbarOrder: 1,
    },
  };
  const courses: NavModule = {
    key: 'courses',
    nav: { placement: 'tab', label: 'Cursos', icon: 'graduation-cap', href: '/cursos', order: 30 },
  };
  const base: NavModule[] = [
    {
      key: 'events',
      nav: {
        placement: 'tab',
        label: 'Eventos',
        icon: 'calendar-days',
        href: '/eventos',
        order: 40,
      },
    },
    {
      key: 'chat',
      nav: {
        placement: 'topbar',
        label: 'Suporte',
        icon: 'message-circle',
        badge: 'unreadConversations',
        href: '/suporte',
        order: 20,
      },
    },
    {
      key: 'communities',
      nav: {
        placement: 'tab',
        label: 'Comunidades',
        icon: 'users',
        href: '/comunidades',
        order: 20,
      },
    },
    {
      key: 'notifications',
      nav: {
        placement: 'topbar',
        label: 'Notificações',
        icon: 'bell',
        badge: 'unreadNotifications',
        href: '/notificacoes',
        order: 10,
      },
    },
    {
      key: 'store',
      nav: { placement: 'topbar', label: 'Loja', icon: 'shopping-bag', href: '/loja', order: 5 },
    },
    { key: 'feed' },
  ];
  const keys = (items: ReadonlyArray<{ key: string }>) => items.map((item) => item.key);

  // 2026-10-23 (the product owner's call): the full row keeps Reels as a TAB and marks the kernel
  // Perfil `railOnly` (the phone's BottomNav drops it; the TopBar's avatar is its door).
  it('EP-01 (boundary): with courses present Reels stays a tab and Perfil turns railOnly; with it absent the row is the old one, Perfil included', () => {
    const on = buildNav([reels, ...base, courses], labels);
    expect(keys(on.tabs)).toContain('reels');
    expect(keys(on.topbar)).not.toContain('reels');
    expect(keys(on.tabs)).toContain('courses');
    expect(on.tabs.find((tab) => tab.key === 'profile')?.railOnly).toBe(true);

    const off = buildNav([reels, ...base], labels);
    expect(off.tabs.find((tab) => tab.key === 'profile')?.railOnly).toBeUndefined();
    expect(keys(off.tabs)).toEqual(['home', 'communities', 'reels', 'events', 'profile']);
    expect(keys(off.topbar)).toEqual(['store', 'notifications', 'chat']);
    // D-401: courses off is exactly the bar before this phase (the same nav without the new fields).
    const plainReels: NavModule = {
      key: 'reels',
      nav: {
        placement: 'tab',
        label: 'Reels',
        icon: 'film',
        href: '/reels',
        order: 30,
        chrome: 'media',
      },
    };
    expect(off).toEqual(buildNav([plainReels, ...base], labels));
  });

  it('EP-02 (adjacency): Cursos and Reels share order 30 (key order breaks the tie); with both on the row is home, communities, courses, reels, events, profile (railOnly), and the topbar has no Reels', () => {
    expect(reels.nav?.order).toBe(courses.nav?.order);
    const nav = buildNav([reels, ...base, courses], labels);
    expect(keys(nav.tabs)).toEqual([
      'home',
      'communities',
      'courses',
      'reels',
      'events',
      'profile',
    ]);
    expect(keys(nav.tabs.filter((tab) => !tab.railOnly))).toEqual([
      'home',
      'communities',
      'courses',
      'reels',
      'events',
    ]);
    expect(keys(nav.topbar)).toEqual(['store', 'notifications', 'chat']);
    // No duplicate slot anywhere: every key renders once across both rows.
    const all = keys([...nav.tabs, ...nav.topbar]);
    expect(new Set(all).size).toBe(all.length);
    expect(nav.tabs.find((t) => t.key === 'courses')).toEqual({
      key: 'courses',
      href: '/cursos',
      icon: 'graduation-cap',
      label: 'Cursos',
    });
    expect(iconFor('graduation-cap')).toBe(GraduationCap);
  });

  it('EP-03 (empty): buildNav([]) is Início + Perfil with an empty topbar; courses alone adds the tab and demotes nothing; reels alone stays a tab', () => {
    const empty = buildNav([], labels);
    expect(keys(empty.tabs)).toEqual(['home', 'profile']);
    expect(empty.topbar).toEqual([]);

    const coursesOnly = buildNav([courses], labels);
    expect(keys(coursesOnly.tabs)).toEqual(['home', 'courses', 'profile']);
    expect(coursesOnly.topbar).toEqual([]);

    const reelsOnly = buildNav([reels], labels);
    expect(keys(reelsOnly.tabs)).toEqual(['home', 'reels', 'profile']);
    expect(reelsOnly.topbar).toEqual([]);
  });

  it('EP-04 (ordering): the full row and the topbar (store 5, notifications 10, chat 20) are stable across calls and input orders', () => {
    const first = buildNav([reels, ...base, courses], labels);
    const second = buildNav([courses, ...[...base].reverse(), reels], labels);
    expect(keys(first.topbar)).toEqual(['store', 'notifications', 'chat']);
    expect(second).toEqual(first);
    // The Reels tab keeps its media chrome and carries no yield field.
    expect(first.tabs.find((tab) => tab.key === 'reels')).toEqual({
      key: 'reels',
      href: '/reels',
      icon: 'film',
      label: 'Reels',
      chrome: 'media',
    });
  });

  it('a yield names only the module it waits for: a disabled, slot-only or mutually yielding target keeps the tab', () => {
    // The named key is a topbar entry, not a tab: nothing to yield to.
    const slotTarget = buildNav(
      [
        reels,
        {
          key: 'courses',
          nav: { ...(courses.nav as NonNullable<NavModule['nav']>), placement: 'topbar' },
        },
      ],
      labels,
    );
    expect(keys(slotTarget.tabs)).toContain('reels');
    // Two entries naming each other both stay tabs (one hop, no oscillation).
    const mutual = buildNav(
      [
        reels,
        {
          key: 'courses',
          nav: { ...(courses.nav as NonNullable<NavModule['nav']>), yieldsTabTo: ['reels'] },
        },
      ],
      labels,
    );
    expect(keys(mutual.tabs)).toEqual(['home', 'courses', 'reels', 'profile']);
    expect(mutual.topbar).toEqual([]);
  });

  it('UI-D-423: the chrome of /reels is media and the Reels tab is current (2026-10-23: it keeps its tab)', () => {
    const { tabs, topbar } = buildNav([reels, ...base, courses], labels);
    expect(activeTabChrome([...tabs, ...topbar], '/reels')).toBe('media');
    expect(activeTabChrome([...tabs, ...topbar], '/reels/abc')).toBe('media');
    expect(activeTabKey(tabs, '/reels')).toBe('reels');
    expect(activeTabChrome(tabs, '/reels')).toBe('media');
    // The Cursos tab is the active one under /cursos, in the normal chrome.
    expect(activeTabKey(tabs, '/cursos')).toBe('courses');
    expect(activeTabKey(tabs, '/cursos/abc/aulas/def')).toBe('courses');
    expect(activeTabChrome([...tabs, ...topbar], '/cursos')).toBeNull();
    expect(activeTabChrome([...tabs, ...topbar], '/loja')).toBeNull();
  });
});

describe('withTabDots (2026-10-03: the host marks a tab with the red dot)', () => {
  const nav = buildNav(modules, labels);

  it('marks only the named tab with its description, and leaves the rest of the nav as built', () => {
    const dotted = withTabDots(nav, { events: 'Há eventos por vir' });
    expect(dotted.tabs.find((tab) => tab.key === 'events')?.dot).toEqual({
      description: 'Há eventos por vir',
    });
    expect(dotted.tabs.filter((tab) => tab.dot).map((tab) => tab.key)).toEqual(['events']);
    // The name is the tab's own: the dot only describes it.
    expect(dotted.tabs.map((tab) => tab.label)).toEqual(nav.tabs.map((tab) => tab.label));
    expect(dotted.tabs.map((tab) => tab.key)).toEqual(nav.tabs.map((tab) => tab.key));
    expect(dotted.topbar).toBe(nav.topbar);
    // The nav it was given is never mutated.
    expect(nav.tabs.some((tab) => tab.dot)).toBe(false);
  });

  it('ignores a slot key, a key with no tab and an empty description', () => {
    const dotted = withTabDots(nav, { notifications: 'x', reels: 'y', events: '' });
    expect(dotted.tabs.some((tab) => tab.dot)).toBe(false);
    expect(dotted.topbar.some((slot) => slot.dot)).toBe(false);
  });

  it('reads only the keys the map owns, never its prototype', () => {
    const odd: ShellNav = {
      tabs: [{ key: 'constructor', href: '/x', icon: 'home', label: 'X' }],
      topbar: [],
    };
    expect(withTabDots(odd, {}).tabs[0]?.dot).toBeUndefined();
  });
});

describe('withCollapsingTabs (2026-10-03: the host folds the BottomNav over a tab)', () => {
  const nav = buildNav(modules, labels);

  it('marks only the named tab with its button name, and leaves the rest of the nav as built', () => {
    const folding = withCollapsingTabs(nav, { communities: 'Comunidades: voltar ao topo' });
    expect(folding.tabs.find((tab) => tab.key === 'communities')?.collapse).toEqual({
      label: 'Comunidades: voltar ao topo',
    });
    expect(folding.tabs.filter((tab) => tab.collapse).map((tab) => tab.key)).toEqual([
      'communities',
    ]);
    expect(folding.tabs.map((tab) => tab.label)).toEqual(nav.tabs.map((tab) => tab.label));
    expect(folding.topbar).toBe(nav.topbar);
    // The nav it was given is never mutated, and a dot on the same tab stays.
    expect(nav.tabs.some((tab) => tab.collapse)).toBe(false);
    const both = withCollapsingTabs(withTabDots(nav, { communities: 'Novidades' }), {
      communities: 'Comunidades: voltar ao topo',
    });
    expect(both.tabs.find((tab) => tab.key === 'communities')?.dot).toEqual({
      description: 'Novidades',
    });
  });

  it('ignores a slot key, a key with no tab, an empty label and the map prototype', () => {
    const folding = withCollapsingTabs(nav, { notifications: 'x', reels: 'y', communities: '' });
    expect(folding.tabs.some((tab) => tab.collapse)).toBe(false);
    expect(folding.topbar.some((slot) => slot.collapse)).toBe(false);
    const odd: ShellNav = {
      tabs: [{ key: 'constructor', href: '/x', icon: 'home', label: 'X' }],
      topbar: [],
    };
    expect(withCollapsingTabs(odd, {}).tabs[0]?.collapse).toBeUndefined();
  });
});

describe('withRailMainSlots (2026-10-23: the host moves a slot up into the rail navigation)', () => {
  const nav = buildNav(
    [
      ...modules,
      {
        key: 'store',
        nav: { order: 5, placement: 'topbar', href: '/loja', icon: 'shopping-bag', label: 'Loja' },
      },
    ],
    labels,
  );

  it('marks only the named slot, keeps the row order and never touches the tabs or the input', () => {
    const moved = withRailMainSlots(nav, ['store']);
    expect(moved.topbar.map((slot) => [slot.key, slot.railMain ?? false])).toEqual([
      ['notifications', false],
      ['store', true],
    ]);
    expect(moved.tabs).toBe(nav.tabs);
    expect(nav.topbar.some((slot) => slot.railMain)).toBe(false);
  });

  it('ignores a tab key and a key with no slot', () => {
    const moved = withRailMainSlots(nav, ['communities', 'chat']);
    expect(moved.topbar.some((slot) => slot.railMain)).toBe(false);
    expect(moved.tabs.some((tab) => tab.railMain)).toBe(false);
  });
});

describe('withPhoneTabSlots (2026-10-28: the host moves a slot down into the phone BottomNav)', () => {
  const nav = buildNav(
    [
      ...modules,
      {
        key: 'store',
        nav: { order: 5, placement: 'topbar', href: '/loja', icon: 'shopping-bag', label: 'Loja' },
      },
    ],
    labels,
  );

  it('marks only the named slot, keeps the row order and never touches the tabs or the input', () => {
    const moved = withPhoneTabSlots(nav, ['store']);
    expect(moved.topbar.map((slot) => [slot.key, slot.phoneTab ?? false])).toEqual([
      ['notifications', false],
      ['store', true],
    ]);
    expect(moved.tabs).toBe(nav.tabs);
    expect(nav.topbar.some((slot) => slot.phoneTab)).toBe(false);
  });

  it('ignores a tab key and a key with no slot, and keeps a railMain mark it is given', () => {
    const moved = withPhoneTabSlots(nav, ['communities', 'chat']);
    expect(moved.topbar.some((slot) => slot.phoneTab)).toBe(false);
    expect(moved.tabs.some((tab) => tab.phoneTab)).toBe(false);
    const both = withPhoneTabSlots(withRailMainSlots(nav, ['store']), ['store']);
    const store = both.topbar.find((slot) => slot.key === 'store');
    expect([store?.railMain, store?.phoneTab]).toEqual([true, true]);
  });
});

describe('phoneChrome and withPhoneLayout (2026-11-05: the phone menu the administrator arranges)', () => {
  const nav = withPhoneTabSlots(
    buildNav(
      [
        ...modules,
        {
          key: 'store',
          nav: {
            order: 5,
            placement: 'topbar',
            href: '/loja',
            icon: 'shopping-bag',
            label: 'Loja',
          },
        },
      ],
      labels,
    ),
    ['store'],
  );
  const keys = (items: { key: string }[]) => items.map((item) => item.key);

  it("without a layout: the shell's own bar and top", () => {
    expect(keys(phoneBarItems(nav.tabs, nav.topbar))).toEqual([
      'home',
      'communities',
      'events',
      'profile',
      'store',
    ]);
    const chrome = phoneChrome(nav.tabs, nav.topbar);
    expect(keys(chrome.bar)).toEqual(['home', 'communities', 'events', 'profile', 'store']);
    expect(keys(chrome.top)).toEqual(['notifications']);
  });

  it('with a layout: the bar and the top in its order, the counter slots always at the top', () => {
    const chrome = phoneChrome(nav.tabs, nav.topbar, {
      bar: ['store', 'home', 'gone'],
      top: ['events', 'notifications'],
      hidden: ['profile'],
    });
    // Comunidades, named nowhere, keeps its place after the named ones.
    expect(keys(chrome.bar)).toEqual(['store', 'home', 'communities']);
    // A counter slot cannot be placed: it stays at the top, after the chosen ones.
    expect(keys(chrome.top)).toEqual(['events', 'notifications']);
    expect(nav.topbar.find((slot) => slot.key === 'notifications')).toSatisfy(isFixedTopSlot);
  });

  it('a key keeps its first list, and a layout that empties the bar is not applied', () => {
    const chrome = phoneChrome(nav.tabs, nav.topbar, {
      bar: ['home', 'events'],
      top: ['events', 'store'],
      hidden: [],
    });
    expect(keys(chrome.bar)).toEqual(['home', 'events', 'communities', 'profile']);
    expect(keys(chrome.top)).toEqual(['store', 'notifications']);
    const empty = phoneChrome(nav.tabs, nav.topbar, {
      bar: [],
      top: [],
      hidden: ['home', 'communities', 'events', 'profile', 'store'],
    });
    expect(keys(empty.bar)).toEqual(keys(phoneChrome(nav.tabs, nav.topbar).bar));
  });

  it('withPhoneLayout keeps the layout, and null leaves the nav as it was', () => {
    const layout = { bar: ['home'], top: [], hidden: [] };
    expect(withPhoneLayout(nav, layout).phoneLayout).toBe(layout);
    expect(withPhoneLayout(nav, null)).toBe(nav);
  });
});

describe('iconFor (serialisable icon names → lucide components)', () => {
  it('maps the known names and falls back to a neutral glyph without throwing', () => {
    expect(iconFor('bell')).toBe(Bell);
    expect(iconFor('unknown-icon')).toBe(LayoutGrid);
    expect(iconFor('nope')).toBe(LayoutGrid);
    expect(() => iconFor('')).not.toThrow();
    // 08.3-03 (UI-D-389): the Configurações "Cursos" row's glyph.
    expect(iconFor('graduation-cap')).toBe(GraduationCap);
    for (const name of [
      'home',
      'user',
      'users',
      'calendar-days',
      'message-circle',
      'sparkles',
      'building-2',
      'settings',
      'sun',
      'moon',
      'log-out',
      'shopping-bag',
      'graduation-cap',
      'route',
      'radio',
      'trending-up',
      'sliders-horizontal',
      'package-check',
    ]) {
      expect(iconFor(name), name).not.toBe(LayoutGrid);
    }
  });

  it('2026-10-22: the courses area screens wear the prototype glyphs (Trilhas, Lives, Progresso)', () => {
    expect(iconFor('route')).toBe(Route);
    expect(iconFor('radio')).toBe(Radio);
    expect(iconFor('trending-up')).toBe(TrendingUp);
  });

  it('2026-10-24: the store area screens wear their glyphs (Produtos, Comprados, Gerenciar)', () => {
    expect(iconFor('shopping-bag')).toBe(ShoppingBag);
    expect(iconFor('package-check')).toBe(PackageCheck);
    expect(iconFor('sliders-horizontal')).toBe(SlidersHorizontal);
  });
});

describe('activeTabKey with NavItem.matches (extra paths that mark a tab current)', () => {
  const tab = (key: string, href: string, matches?: string[]) => ({
    key,
    href,
    icon: 'home',
    label: key,
    ...(matches ? { matches } : {}),
  });

  it('a tab is current on its href and on every match, and not on a path that only shares a prefix', () => {
    const tabs = [tab('home', '/inicio'), tab('area', '/area-x', ['/detalhe'])];
    for (const path of ['/area-x', '/area-x/y', '/detalhe', '/detalhe/abc/aulas/def']) {
      expect(activeTabKey(tabs, path)).toBe('area');
    }
    expect(activeTabKey(tabs, '/detalhes')).toBeNull();
    expect(activeTabKey(tabs, '/detalheX')).toBeNull();
    expect(activeTabKey(tabs, '/inicio')).toBe('home');
  });

  it('the longest matching path wins across href and matches, and a tie goes to the first tab', () => {
    const tabs = [tab('wide', '/a', ['/b']), tab('deep', '/b/c'), tab('late', '/b')];
    expect(activeTabKey(tabs, '/b/c/d')).toBe('deep');
    expect(activeTabKey(tabs, '/b/z')).toBe('wide');
    expect(activeTabKey(tabs, '/a/z')).toBe('wide');
  });

  it('a module anchor on /inicio never steals Início, and a tab without matches behaves as before', () => {
    const tabs = [tab('home', '/inicio'), tab('anchor', '/inicio#exemplo'), tab('x', '/x')];
    expect(activeTabKey(tabs, '/inicio')).toBe('home');
    expect(activeTabKey(tabs, '/x/1')).toBe('x');
    expect(activeTabKey(tabs, '/y')).toBeNull();
  });
});

describe('withTabOverrides (the host rewrites one tab per request)', () => {
  const nav = buildNav(modules, labels);

  it('applies href, label and matches ONLY to the named tab and leaves everything else as built', () => {
    const next = withTabOverrides(nav, {
      events: { href: '/novo', label: 'Novo', matches: ['/eventos'] },
    });
    expect(next.tabs.find((t) => t.key === 'events')).toMatchObject({
      key: 'events',
      href: '/novo',
      label: 'Novo',
      matches: ['/eventos'],
      icon: 'calendar-days',
    });
    expect(next.tabs.map((t) => t.key)).toEqual(nav.tabs.map((t) => t.key));
    for (const tab of next.tabs.filter((t) => t.key !== 'events')) {
      expect(tab).toBe(nav.tabs.find((t) => t.key === tab.key));
    }
    // The topbar keeps its identity, and the input nav is never mutated.
    expect(next.topbar).toBe(nav.topbar);
    expect(nav.tabs.find((t) => t.key === 'events')?.href).toBe('/eventos');
    expect(nav.tabs.find((t) => t.key === 'events')?.matches).toBeUndefined();
  });

  it('ignores a slot key, a key with no tab, empty strings and the map prototype', () => {
    const next = withTabOverrides(nav, {
      notifications: { href: '/x', label: 'X' },
      nothing: { href: '/y' },
      events: { href: '', label: '' },
    });
    expect(next.tabs).toEqual(nav.tabs);
    expect(next.topbar).toBe(nav.topbar);
    const odd: ShellNav = {
      tabs: [{ key: 'constructor', href: '/x', icon: 'home', label: 'X' }],
      topbar: [],
    };
    expect(withTabOverrides(odd, {}).tabs[0]).toEqual(odd.tabs[0]);
  });

  it('keeps the areas of the nav it was given', () => {
    const withArea: ShellNav = {
      ...nav,
      areas: [{ key: 'events', label: 'Eventos', menuLabel: 'Menu de Eventos', screens: [] }],
    };
    expect(withTabOverrides(withArea, { events: { label: 'E' } }).areas).toBe(withArea.areas);
  });
});

describe('withTabOverrides composed over the courses fixture', () => {
  const reels: NavModule = {
    key: 'reels',
    nav: {
      placement: 'tab',
      label: 'Reels',
      icon: 'film',
      href: '/reels',
      order: 30,
      chrome: 'media',
      yieldsTabTo: ['courses'],
      topbarOrder: 1,
    },
  };
  const courses: NavModule = {
    key: 'courses',
    nav: { placement: 'tab', label: 'Cursos', icon: 'graduation-cap', href: '/cursos', order: 30 },
  };
  const events: NavModule = {
    key: 'events',
    nav: { placement: 'tab', label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
  };
  const keys = (items: ReadonlyArray<{ key: string }>) => items.map((item) => item.key);

  it('keeps the tab key, order and neighbours, the full row (Reels a tab, Perfil railOnly), and marks the tab current across both paths', () => {
    const built = buildNav([reels, courses, events], labels);
    const nav = withTabOverrides(built, {
      courses: { href: '/area', label: 'Membros', matches: ['/cursos'] },
    });
    expect(keys(nav.tabs)).toEqual(keys(built.tabs));
    expect(keys(nav.tabs)).toEqual(['home', 'courses', 'reels', 'events', 'profile']);
    expect(nav.tabs.find((t) => t.key === 'profile')?.railOnly).toBe(true);
    expect(nav.topbar).toEqual([]);
    expect(nav.tabs.find((t) => t.key === 'courses')).toMatchObject({
      href: '/area',
      label: 'Membros',
      icon: 'graduation-cap',
    });
    expect(activeTabKey(nav.tabs, '/area')).toBe('courses');
    expect(activeTabKey(nav.tabs, '/cursos/abc/aulas/def')).toBe('courses');
    expect(activeTabKey(nav.tabs, '/eventos')).toBe('events');
    expect(activeTabKey(nav.tabs, '/reels')).toBe('reels');
  });
});

/**
 * 2026-10-22 — the courses area: a tab may declare several areas under its key (`NavArea.within`).
 * A manager's courses tab is "Cursos" (the authoring screens) everywhere and "Membros" (the member's
 * screens, every link in preview) under the member area's path; Eventos keeps its single area.
 */
describe('areas with variants (NavArea.within)', () => {
  const tabs: NavItem[] = [
    { key: 'home', href: '/inicio', icon: 'home', label: 'Início' },
    {
      key: 'courses',
      href: '/cursos',
      icon: 'graduation-cap',
      label: 'Cursos',
      matches: ['/area-membros'],
    },
    { key: 'events', href: '/eventos', icon: 'calendar-days', label: 'Eventos' },
  ];
  const screen = (key: string, href: string): NavItem => ({ key, href, icon: 'home', label: key });
  const authoring: NavArea = {
    key: 'courses',
    label: 'Cursos',
    menuLabel: 'Menu de Cursos',
    screens: [
      screen('admin-cursos', '/cursos'),
      screen('admin-trilhas', '/cursos/trilhas'),
      screen('admin-lives', '/cursos/lives'),
    ],
  };
  const preview: NavArea = {
    key: 'courses',
    label: 'Membros',
    menuLabel: 'Menu de Membros',
    within: ['/area-membros'],
    screens: [
      screen('member-inicio', '/area-membros?ver=aluno'),
      screen('member-trilhas', '/area-membros/trilhas?ver=aluno'),
    ],
  };
  const events: NavArea = {
    key: 'events',
    label: 'Eventos',
    menuLabel: 'Menu de Eventos',
    screens: [screen('events-list', '/eventos')],
  };

  it('withAreas keeps two areas under the same tab key, each on its own terms', () => {
    const nav = withAreas({ tabs, topbar: [] }, [authoring, preview, events]);
    expect(nav.areas?.map((area) => [area.key, area.label])).toEqual([
      ['courses', 'Cursos'],
      ['courses', 'Membros'],
      ['events', 'Eventos'],
    ]);
    // An area with no screens, or for a tab or slot the shell does not have, is still dropped.
    const dropped = withAreas({ tabs, topbar: [] }, [
      { ...preview, screens: [] },
      { ...authoring, key: 'store' },
    ]);
    expect(dropped.areas).toBeUndefined();
  });

  it('activeArea picks the variant whose within holds the path, else the plain one', () => {
    const areas = [authoring, preview, events];
    expect(activeArea(tabs, areas, '/area-membros')?.label).toBe('Membros');
    expect(activeArea(tabs, areas, '/area-membros/trilhas')?.label).toBe('Membros');
    expect(activeArea(tabs, areas, '/cursos')?.label).toBe('Cursos');
    expect(activeArea(tabs, areas, '/cursos/trilhas/nova')?.label).toBe('Cursos');
    expect(activeArea(tabs, areas, '/cursos/abc/aulas/def')?.label).toBe('Cursos');
    expect(activeArea(tabs, areas, '/eventos/123')).toBe(events);
    expect(activeArea(tabs, areas, '/inicio')).toBeNull();
    expect(activeArea(tabs, areas, '/configuracoes')).toBeNull();
  });

  it('the order of the variants does not decide: the path does', () => {
    expect(activeArea(tabs, [preview, authoring], '/cursos/lives')?.label).toBe('Cursos');
    expect(activeArea(tabs, [preview, authoring], '/area-membros/lives')?.label).toBe('Membros');
  });

  it('a tab whose only area is scoped elsewhere has no area outside that scope', () => {
    expect(activeArea(tabs, [preview], '/cursos')).toBeNull();
    expect(activeArea(tabs, [preview], '/area-membros/progresso')).toBe(preview);
  });

  it('an area without within answers as before (Eventos), and no areas means no area', () => {
    expect(activeArea(tabs, [events], '/eventos')).toBe(events);
    expect(activeArea(tabs, undefined, '/eventos')).toBeNull();
    expect(activeArea(tabs, [], '/eventos')).toBeNull();
    // An empty within reads as the plain variant.
    const empty: NavArea = { ...events, within: [] };
    expect(activeArea(tabs, [empty], '/eventos/fotos')).toBe(empty);
  });
});

/**
 * 2026-10-24 — the Loja area: a TopBar SLOT may own an area (the store's "· Loja": Produtos,
 * Comprados and the manager's Gerenciar). A tab always wins: the slot's area applies only on the
 * pages no tab claims, and only when the caller hands `activeArea` the slots.
 */
describe('areas owned by a TopBar slot (2026-10-24: the Loja)', () => {
  const tabs: NavItem[] = [
    { key: 'home', href: '/inicio', icon: 'home', label: 'Início' },
    { key: 'events', href: '/eventos', icon: 'calendar-days', label: 'Eventos' },
    { key: 'profile', href: '/perfil', icon: 'user', label: 'Perfil' },
  ];
  const storeSlot: NavItem = { key: 'store', href: '/loja', icon: 'shopping-bag', label: 'Loja' };
  const bellSlot: NavItem = {
    key: 'notifications',
    href: '/notificacoes',
    icon: 'bell',
    label: 'Notificações',
    badge: 'unreadNotifications',
  };
  const slots = [storeSlot, bellSlot];
  const screen = (key: string, href: string, icon: string): NavItem => ({
    key,
    href,
    icon,
    label: key,
  });
  const store: NavArea = {
    key: 'store',
    label: 'Loja',
    menuLabel: 'Menu da Loja',
    screens: [
      screen('store-products', '/loja', 'shopping-bag'),
      screen('store-purchases', '/loja/comprados', 'package-check'),
      screen('store-manage', '/loja/gerenciar', 'sliders-horizontal'),
    ],
  };
  const events: NavArea = {
    key: 'events',
    label: 'Eventos',
    menuLabel: 'Menu de Eventos',
    screens: [screen('events-list', '/eventos', 'calendar-days')],
  };
  const areas = [store, events];

  it('withAreas keeps the store area while the shell has the store slot, and drops it without', () => {
    expect(withAreas({ tabs, topbar: slots }, areas).areas).toEqual([store, events]);
    expect(withAreas({ tabs, topbar: [bellSlot] }, [store]).areas).toBeUndefined();
    expect(withAreas({ tabs, topbar: [] }, [store]).areas).toBeUndefined();
    // Without screens it is dropped, slot or not.
    expect(withAreas({ tabs, topbar: slots }, [{ ...store, screens: [] }]).areas).toBeUndefined();
  });

  it('activeArea, given the slots, is the store area on the pages no tab claims', () => {
    for (const path of [
      '/loja',
      '/loja/comprados',
      '/loja/gerenciar',
      '/loja/6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f/compradores',
    ]) {
      expect(activeArea(tabs, areas, path, slots), path).toBe(store);
    }
    expect(activeArea(tabs, areas, '/inicio', slots)).toBeNull();
    expect(activeArea(tabs, areas, '/configuracoes', slots)).toBeNull();
    // A slot without an area of its own, or a path that only shares the prefix, has none.
    expect(activeArea(tabs, areas, '/notificacoes', slots)).toBeNull();
    expect(activeArea(tabs, areas, '/lojas', slots)).toBeNull();
    // The tabs' areas answer as before.
    expect(activeArea(tabs, areas, '/eventos/123', slots)).toBe(events);
  });

  it('a tab always wins: a slot under a tab gets the tab area, or none when that tab has none', () => {
    const underEvents: NavItem = { ...storeSlot, href: '/eventos/loja' };
    expect(activeArea(tabs, areas, '/eventos/loja', [underEvents])).toBe(events);
    expect(activeArea(tabs, areas, '/eventos/loja/comprados', [underEvents])).toBe(events);
    const underHome: NavItem = { ...storeSlot, href: '/inicio/loja' };
    expect(activeArea(tabs, areas, '/inicio/loja', [underHome])).toBeNull();
  });

  it('with the old three arguments a slot area never applies', () => {
    for (const path of ['/loja', '/loja/comprados', '/loja/gerenciar']) {
      expect(activeArea(tabs, areas, path), path).toBeNull();
    }
    expect(activeArea(tabs, areas, '/eventos')).toBe(events);
  });
});

describe('isAreaScreenHere (2026-10-22: a screen is marked by its path)', () => {
  it('ignores the query and the hash of the screen href', () => {
    expect(isAreaScreenHere('/area-membros', '/area-membros?ver=aluno')).toBe(true);
    expect(
      isAreaScreenHere('/area-membros/trilhas', '/area-membros/trilhas?trilha=T&ver=aluno'),
    ).toBe(true);
    expect(isAreaScreenHere('/eventos/fotos', '/eventos/fotos#topo')).toBe(true);
    expect(isAreaScreenHere('/eventos/meus', '/eventos/meus')).toBe(true);
  });

  it('a sub-path, a parent or a sibling is not the screen', () => {
    expect(isAreaScreenHere('/area-membros/cursos', '/area-membros')).toBe(false);
    expect(isAreaScreenHere('/eventos/6f2c', '/eventos')).toBe(false);
    expect(isAreaScreenHere('/cursos', '/cursos/trilhas')).toBe(false);
    expect(isAreaScreenHere('/cursos/lives', '/cursos/livesx')).toBe(false);
  });
});

describe('isAreaScreenCurrent (2026-10-23: a screen may gather pages by exact paths)', () => {
  const manage = {
    href: '/cursos/gerenciar',
    matches: ['/cursos', '/cursos/trilhas', '/cursos/lives', '/cursos/categorias'],
  };

  it('is its own page or one of its exact matches', () => {
    expect(isAreaScreenCurrent('/cursos/gerenciar', manage)).toBe(true);
    for (const path of manage.matches) expect(isAreaScreenCurrent(path, manage)).toBe(true);
  });

  it('a detail page under a match is not the screen (matches are not prefixes here)', () => {
    expect(isAreaScreenCurrent('/cursos/6f2c', manage)).toBe(false);
    expect(isAreaScreenCurrent('/cursos/lives/6f2c', manage)).toBe(false);
  });

  it('a screen without matches is its path alone', () => {
    expect(isAreaScreenCurrent('/area-membros', { href: '/area-membros?ver=aluno' })).toBe(true);
    expect(isAreaScreenCurrent('/area-membros/cursos', { href: '/area-membros' })).toBe(false);
  });
});
