import { Bell, GraduationCap, LayoutGrid, ShoppingBag } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  activeTabChrome,
  activeTabKey,
  buildNav,
  iconFor,
  isNavItemActive,
  type NavLabels,
  type NavModule,
  type ShellNav,
  withCollapsingTabs,
  withTabDots,
  withTabOverrides,
} from '../ui';

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

  it('EP-01 (boundary): with courses present Reels is a slot and not a tab; with it absent Reels is a tab and the topbar is unchanged', () => {
    const on = buildNav([reels, ...base, courses], labels);
    expect(keys(on.tabs)).not.toContain('reels');
    expect(keys(on.topbar)).toContain('reels');
    expect(keys(on.tabs)).toContain('courses');

    const off = buildNav([reels, ...base], labels);
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

  it('EP-02 (adjacency): Cursos and Reels share order 30; with both on the tab keys are exactly home, communities, courses, events, profile, and the topbar starts with reels', () => {
    expect(reels.nav?.order).toBe(courses.nav?.order);
    const nav = buildNav([reels, ...base, courses], labels);
    expect(keys(nav.tabs)).toEqual(['home', 'communities', 'courses', 'events', 'profile']);
    expect(keys(nav.topbar)[0]).toBe('reels');
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

  it('EP-04 (ordering): the demoted topbar reads reels (1), store (5), notifications (10), chat (20), stable across calls and input orders', () => {
    const first = buildNav([reels, ...base, courses], labels);
    const second = buildNav([courses, ...[...base].reverse(), reels], labels);
    expect(keys(first.topbar)).toEqual(['reels', 'store', 'notifications', 'chat']);
    expect(second).toEqual(first);
    // The yielded slot keeps its media chrome and carries no badge; the kernel item has no yield fields.
    expect(first.topbar[0]).toEqual({
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

  it('UI-D-423: the chrome of /reels read over [...tabs, ...topbar] is media while no tab is aria-current', () => {
    const { tabs, topbar } = buildNav([reels, ...base, courses], labels);
    expect(activeTabChrome([...tabs, ...topbar], '/reels')).toBe('media');
    expect(activeTabChrome([...tabs, ...topbar], '/reels/abc')).toBe('media');
    expect(activeTabKey(tabs, '/reels')).toBeNull();
    // Tabs alone no longer carry the media entry: the lookup must be given the slots.
    expect(activeTabChrome(tabs, '/reels')).toBeNull();
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
    ]) {
      expect(iconFor(name), name).not.toBe(LayoutGrid);
    }
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

  it('keeps the tab key, order and neighbours, the Reels yield, and marks the tab current across both paths', () => {
    const built = buildNav([reels, courses, events], labels);
    const nav = withTabOverrides(built, {
      courses: { href: '/area', label: 'Membros', matches: ['/cursos'] },
    });
    expect(keys(nav.tabs)).toEqual(keys(built.tabs));
    expect(keys(nav.tabs)).toEqual(['home', 'courses', 'events', 'profile']);
    expect(keys(nav.topbar)).toEqual(['reels']);
    expect(nav.tabs.find((t) => t.key === 'courses')).toMatchObject({
      href: '/area',
      label: 'Membros',
      icon: 'graduation-cap',
    });
    expect(activeTabKey(nav.tabs, '/area')).toBe('courses');
    expect(activeTabKey(nav.tabs, '/cursos/abc/aulas/def')).toBe('courses');
    expect(activeTabKey(nav.tabs, '/eventos')).toBe('events');
    expect(activeTabKey(nav.tabs, '/reels')).toBeNull();
  });
});
