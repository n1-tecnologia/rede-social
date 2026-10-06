// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, buildNav, type NavLabels, type NavModule, withAreas } from '../ui';

// The shell reads the route from Next's app router; each case may set it before rendering.
const route = vi.hoisted(() => ({ pathname: '/eventos' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

/**
 * 2026-10-06 — an AREA (the REINE prototype's Eventos): inside it the TopBar names the area beside
 * the logo and folds its shortcuts into one sandwich menu (the area's screens, then the shortcuts
 * and the profile); the rail lists the screens under the tab. Outside it, nothing changes.
 */

const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };
const modules: NavModule[] = [
  { key: 'events', nav: { label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 30 } },
  {
    key: 'notifications',
    nav: {
      label: 'Notificações',
      icon: 'bell',
      href: '/notificacoes',
      order: 90,
      placement: 'topbar',
      badge: 'unreadNotifications',
    },
  },
];
const nav = withAreas(buildNav(modules, labels), [
  {
    key: 'events',
    label: 'Eventos',
    menuLabel: 'Menu de Eventos',
    screens: [
      { key: 'events-list', href: '/eventos', icon: 'calendar-days', label: 'Eventos' },
      { key: 'events-photos', href: '/eventos/fotos', icon: 'camera', label: 'Fotos' },
      { key: 'events-checkin', href: '/eventos/check-in', icon: 'qr-code', label: 'Check-in' },
      { key: 'events-mine', href: '/eventos/meus', icon: 'ticket', label: 'Meus' },
    ],
  },
]);

function shell(unread = 3) {
  return (
    <AppShell
      brand={{ displayName: 'REINE', logoUrl: null }}
      nav={nav}
      counters={{ unreadNotifications: unread, unreadConversations: 0 }}
      avatar={{ src: null, alt: 'Maria' }}
      labels={{
        mainNav: 'Navegação principal',
        profile: 'Meu perfil',
        settings: 'Configurações',
        logout: 'Sair',
        theme: 'Tema',
      }}
      settingsHref="/configuracoes"
      logoutAction={async () => {}}
    >
      <p>conteúdo</p>
    </AppShell>
  );
}

const topbar = () => document.querySelector('[data-shell-topbar]') as HTMLElement;
const menuButton = () => within(topbar()).getByRole('button', { name: 'Menu de Eventos' });

beforeEach(() => {
  route.pathname = '/eventos';
});
afterEach(cleanup);

describe('the events area in the TopBar', () => {
  it('names the area beside the logo and folds the shortcuts into the menu, its dot on the button', () => {
    render(shell(3));
    expect(topbar().querySelector('[data-shell-area="events"]')).toHaveTextContent('· Eventos');
    // The shortcuts and the avatar are inside the menu now.
    expect(within(topbar()).queryByRole('link', { name: /Notificações/ })).toBeNull();
    expect(within(topbar()).queryByRole('link', { name: 'Meu perfil' })).toBeNull();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(topbar().querySelector('[data-area-menu-dot]')).not.toBeNull();
  });

  it('opens on the area screens (the page marked), then the shortcuts with their count and the profile', () => {
    route.pathname = '/eventos/fotos';
    render(shell(3));
    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    const panel = topbar().querySelector('[data-area-menu-panel]') as HTMLElement;
    const names = within(panel)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? link.textContent?.trim());
    expect(names.slice(0, 4)).toEqual(['Eventos', 'Fotos', 'Check-in', 'Meus']);
    expect(names[5]).toBe('Meu perfil');
    expect(within(panel).getByRole('link', { name: 'Fotos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(panel).getByText('3')).toBeInTheDocument();
    // The dot leaves the open button.
    expect(topbar().querySelector('[data-area-menu-dot]')).toBeNull();
  });

  it('closes on a tap outside and on Escape, which hands the focus back to the button', () => {
    render(shell(0));
    fireEvent.click(menuButton());
    fireEvent.pointerDown(document.body);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(menuButton());
  });

  it('outside the area the bar is the usual one: shortcuts, avatar, no area label', () => {
    route.pathname = '/inicio';
    render(shell(1));
    expect(topbar().querySelector('[data-shell-area]')).toBeNull();
    expect(within(topbar()).queryByRole('button', { name: 'Menu de Eventos' })).toBeNull();
    expect(within(topbar()).getByRole('link', { name: 'Meu perfil' })).toBeInTheDocument();
  });
});

describe('the events area in the rail', () => {
  it('lists the screens under the tab; the page that is a screen takes the highlight', () => {
    route.pathname = '/eventos/meus';
    render(shell(0));
    const rail = document.querySelector('[data-shell-nav="rail"]') as HTMLElement;
    const list = rail.querySelector('[data-rail-area="events"]') as HTMLElement;
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Eventos', 'Fotos', 'Check-in', 'Meus']);
    expect(within(list).getByRole('link', { name: 'Meus' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('on an event page (no screen) the tab keeps the highlight', () => {
    route.pathname = '/eventos/6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';
    render(shell(0));
    const rail = document.querySelector('[data-shell-nav="rail"]') as HTMLElement;
    expect(rail.querySelector('[data-rail-area="events"] [aria-current="page"]')).toBeNull();
    expect(rail.querySelector('a[data-slot="events"]')).toHaveAttribute('aria-current', 'page');
  });
});
