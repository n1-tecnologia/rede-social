import { Bell, LayoutGrid, ShoppingBag } from 'lucide-react';
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
    expect(() => iconFor('')).not.toThrow();
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
    ]) {
      expect(iconFor(name), name).not.toBe(LayoutGrid);
    }
  });
});
