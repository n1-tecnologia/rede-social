// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, buildNav, type NavLabels, type NavModule } from '../ui';
import { reselectTab } from '../ui/tab-reselect';

// The shell reads the route from Next's app router; each case may set it before rendering.
const route = vi.hoisted(() => ({ pathname: '/inicio' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

/**
 * 2026-10-06 — re-tapping the tab whose page is already open (Instagram's gesture): on the feed, a
 * tap on Início takes the page back to the top instead of navigating, in the phone's bottom bar and
 * in the desktop rail. A page below the tab, another tab and a modified click navigate as before.
 * happy-dom has no layout, so the scroll root's `scrollTo` is spied.
 */

const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };
const modules: NavModule[] = [
  {
    key: 'communities',
    nav: { label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
  },
];

function shell() {
  return (
    <AppShell
      brand={{ displayName: 'Associação São José', logoUrl: null }}
      nav={buildNav(modules, labels)}
      counters={{ unreadNotifications: 0, unreadConversations: 0 }}
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
      <p>feed</p>
    </AppShell>
  );
}

/** The shell's own scroll root with its `scrollTo` spied (after the mount's own reset). */
function spyScrollRoot() {
  const root = document.getElementById('app-scroll') as HTMLElement;
  const scrollTo = vi.fn();
  root.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
  return scrollTo;
}

const activeLink = (bar: 'bottom' | 'rail') =>
  document.querySelector(`[data-shell-nav="${bar}"] a[aria-current="page"]`) as HTMLAnchorElement;

/** A plain left click on a link, as React hands it to `onClick`. */
function click(overrides: Partial<Record<string, unknown>> = {}) {
  const preventDefault = vi.fn();
  const event = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault,
    ...overrides,
  } as unknown as MouseEvent<HTMLAnchorElement>;
  return { event, preventDefault };
}

beforeEach(() => {
  route.pathname = '/inicio';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.getElementById('app-scroll')?.remove();
});

describe('re-tapping the open tab (reselectTab)', () => {
  it('on the feed, Início in the bottom bar takes the page to the top instead of navigating', () => {
    render(shell());
    const scrollTo = spyScrollRoot();
    const link = activeLink('bottom');
    expect(link).toHaveAttribute('aria-label', 'Início');

    // `fireEvent` answers false when a handler prevented the default: no navigation.
    expect(fireEvent.click(link)).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('the desktop rail does the same', () => {
    render(shell());
    const scrollTo = spyScrollRoot();
    const link = activeLink('rail');
    expect(link).toHaveTextContent('Início');

    expect(fireEvent.click(link)).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('under reduced motion the page jumps to the top at once', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    render(shell());
    const scrollTo = spyScrollRoot();
    fireEvent.click(activeLink('bottom'));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('another tab, a page below the tab and a modified click navigate as before', () => {
    const root = document.createElement('main');
    root.id = 'app-scroll';
    const scrollTo = vi.fn();
    root.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    document.body.append(root);

    // Another tab.
    let tap = click();
    expect(reselectTab(tap.event, '/inicio', '/comunidades')).toBe(false);
    expect(tap.preventDefault).not.toHaveBeenCalled();

    // A community page is below Comunidades: the tap goes back to the list.
    tap = click();
    expect(reselectTab(tap.event, '/comunidades/abc', '/comunidades')).toBe(false);
    expect(tap.preventDefault).not.toHaveBeenCalled();

    // New tab or window, and the middle button, are the browser's.
    for (const modifier of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      tap = click(modifier);
      expect(reselectTab(tap.event, '/inicio', '/inicio')).toBe(false);
      expect(tap.preventDefault).not.toHaveBeenCalled();
    }
    expect(scrollTo).not.toHaveBeenCalled();

    // The tab's own page, written with a trailing slash or a query, still counts.
    tap = click();
    expect(reselectTab(tap.event, '/inicio/', '/inicio?aba=feed')).toBe(true);
    expect(tap.preventDefault).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
