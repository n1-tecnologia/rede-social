import { Bell, LayoutGrid } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  activeTabKey,
  buildNav,
  iconFor,
  isNavItemActive,
  type NavLabels,
  type NavModule,
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

describe('active state (longest match, ties to the first tab)', () => {
  it('isNavItemActive strips the hash/query and matches the path or a sub-path', () => {
    expect(isNavItemActive('/inicio', '/inicio#exemplo')).toBe(true);
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
          key: 'example',
          nav: { order: 90, href: '/inicio#exemplo', icon: 'sparkles', label: 'Exemplo' },
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
    ]) {
      expect(iconFor(name), name).not.toBe(LayoutGrid);
    }
  });
});
