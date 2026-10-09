// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { canGoBack, resetBackStack } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, buildNav, HomeSlots, type NavLabels, type NavModule, withTabDots } from '../ui';

// The shell reads the route from Next's app router; outside Next the hook returns nothing useful.
// The pathname is a hoisted variable each case may set (the mock itself stays top-level — Vitest 5).
const route = vi.hoisted(() => ({ pathname: '/inicio' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

beforeEach(() => {
  route.pathname = '/inicio';
});

afterEach(() => {
  cleanup();
});

const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };
const demoModules: NavModule[] = [
  {
    key: 'stories',
    nav: { label: 'Destaques', icon: 'sparkles', href: '/destaques', order: 90 },
  },
];
const noop = async () => {};

function shell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return (
    <AppShell
      brand={{ displayName: 'Associação São José', logoUrl: null }}
      nav={buildNav([], labels)}
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
      logoutAction={noop}
      {...overrides}
    >
      <p>conteúdo</p>
    </AppShell>
  );
}

describe('AppShell (UI-03, D-39, D-26)', () => {
  it('UI-03/empty: without a logo the display name renders as text in the TopBar and the rail, no <img>', () => {
    const { container } = render(shell());
    expect(screen.getAllByText('Associação São José')).toHaveLength(2);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('with a logo it renders <img alt=displayName> twice (TopBar + rail) and never a bare "Rede Social"', () => {
    const { container } = render(
      shell({ brand: { displayName: 'Associação São José', logoUrl: '/logo.svg' } }),
    );
    const imgs = container.querySelectorAll('img[alt="Associação São José"]');
    expect(imgs).toHaveLength(2);
    expect(screen.queryByText('Rede Social', { exact: true })).not.toBeInTheDocument();
  });

  /**
   * Product decision 2026-10-02 (PDF #1): with a logo the TopBar shows the logo ALONE (no name beside
   * it on any phone width), and the rail follows the same rule. The home link is named by the img's
   * alt, so its accessible name is the display name exactly once (it read "X X" with the name beside
   * the logo). `data-shell-topbar` is what tokens.css hides under a full-screen surface.
   */
  it('PDF #1: with a logo the TopBar and the rail show the logo ALONE, named once by its alt', () => {
    const { container } = render(
      shell({ brand: { displayName: 'Associação São José', logoUrl: '/logo.svg' } }),
    );
    const header = container.querySelector('header') as HTMLElement;
    expect(header).toHaveAttribute('data-shell-topbar');
    expect(within(header).queryByText('Associação São José')).not.toBeInTheDocument();
    const brand = within(header).getByRole('link', { name: 'Associação São José' });
    expect(brand).toHaveAttribute('href', '/inicio');
    expect(brand).toHaveAttribute('data-shell-brand');
    expect(brand.textContent).toBe('');
    // The logo alone can be 28px wide (a square mark): the link keeps the bar's 44px tap target.
    // A minimum, not a width: a long fallback name still shrinks the link down to it and truncates.
    expect(brand).toHaveClass('min-w-11');
    expect(brand).not.toHaveClass('min-w-0');

    const rail = container.querySelector('aside') as HTMLElement;
    expect(within(rail).queryByText('Associação São José')).not.toBeInTheDocument();
    const railBrand = within(rail).getByRole('link', { name: 'Associação São José' });
    expect(railBrand).toHaveAttribute('data-shell-brand');
    expect(railBrand.textContent).toBe('');
  });

  it('PDF #1: a TopBar logo that fails to load gives way to the display name (never an empty bar)', () => {
    const { container } = render(
      shell({ brand: { displayName: 'Associação São José', logoUrl: '/broken.svg' } }),
    );
    const header = container.querySelector('header') as HTMLElement;
    fireEvent.error(within(header).getByRole('img', { name: 'Associação São José' }));
    expect(within(header).getByText('Associação São José')).toBeInTheDocument();
    expect(
      within(header).queryByRole('img', { name: 'Associação São José' }),
    ).not.toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Associação São José' })).toHaveAttribute(
      'href',
      '/inicio',
    );
  });

  it('renders the children exactly once and owns the scroll root', () => {
    const { container } = render(shell());
    expect(screen.getAllByText('conteúdo')).toHaveLength(1);
    expect(container.querySelectorAll('main.app-scroll')).toHaveLength(1);
    expect(container.querySelector('[data-brand-root]')).not.toBeNull();
    expect(container.querySelector('#liquid-glass')).not.toBeNull();
  });

  it('BottomNav: labelled <nav>, icon-only links with aria-label in order, Início current on /inicio', () => {
    const { container } = render(shell());
    const bottom = container.querySelector('[data-shell-nav="bottom"]');
    expect(bottom).not.toBeNull();
    expect(bottom?.tagName).toBe('NAV');
    expect(bottom?.getAttribute('aria-label')).toBe('Navegação principal');
    const links = [...(bottom?.querySelectorAll('a') ?? [])];
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual(['Início', 'Perfil']);
    for (const a of links) expect(a.textContent).toBe('');
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(links[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('MOD-04: a tab exists only for an enabled module — the lab-like nav has no Destaques link', () => {
    render(shell());
    expect(screen.queryAllByRole('link', { name: 'Destaques' })).toHaveLength(0);
  });

  it('MOD-04: the demo-like nav renders the Destaques tab in both trees, between Início and Perfil', () => {
    const { container } = render(shell({ nav: buildNav(demoModules, labels) }));
    const bottom = container.querySelector('[data-shell-nav="bottom"]');
    expect(
      [...(bottom?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('aria-label')),
    ).toEqual(['Início', 'Destaques', 'Perfil']);
    const rail = container.querySelector('[data-shell-nav="rail"]');
    expect(rail?.getAttribute('aria-label')).toBe('Navegação principal');
    expect(rail?.textContent).toContain('Destaques');
  });

  it('D-40: a topbar slot renders with its aria-label and count badge; the rail shows it as a row', () => {
    const nav = buildNav(
      [
        {
          key: 'notifications',
          nav: {
            label: 'Notificações',
            icon: 'bell',
            href: '/notificacoes',
            order: 5,
            placement: 'topbar',
            badge: 'unreadNotifications',
          },
        },
      ],
      labels,
    );
    render(shell({ nav, counters: { unreadNotifications: 3, unreadConversations: 0 } }));
    const slots = screen.getAllByRole('link', { name: 'Notificações' });
    expect(slots).toHaveLength(2);
    expect(screen.getAllByText('3')).toHaveLength(2);
    // The kernel rail rows are present too: Configurações link, Sair button.
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'href',
      '/configuracoes',
    );
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });
});

describe('tab dot (2026-10-03: Eventos while an event is to come)', () => {
  const eventsModules: NavModule[] = [
    {
      key: 'events',
      nav: { label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
    },
  ];
  const trees = (container: HTMLElement) =>
    ['bottom', 'rail'].map((tree) => {
      const link = container.querySelector<HTMLAnchorElement>(
        `[data-shell-nav="${tree}"] a[href="/eventos"]`,
      );
      if (!link) throw new Error(`no Eventos tab in the ${tree} nav`);
      return link;
    });

  it('draws the red dot on the marked tab in the BottomNav and the rail, the name unchanged and the state as its description', () => {
    const nav = withTabDots(buildNav(eventsModules, labels), { events: 'Há eventos por vir' });
    const { container } = render(shell({ nav }));
    for (const link of trees(container)) {
      expect(link.querySelectorAll('[data-badge-dot]')).toHaveLength(1);
      // Decoration: hidden from assistive tech, which hears the description instead.
      expect(
        link.querySelector('[data-badge-dot]')?.closest('[aria-hidden="true"]'),
      ).not.toBeNull();
      expect(link).toHaveAccessibleName('Eventos');
      expect(link).toHaveAccessibleDescription('Há eventos por vir');
    }
    // The tab is still found by its name, once per tree, and no other tab has a dot.
    expect(screen.getAllByRole('link', { name: 'Eventos' })).toHaveLength(2);
    expect(container.querySelectorAll('[data-badge-dot]')).toHaveLength(2);
    // The two trees describe it with their own ids: an id never repeats in the document.
    const ids = trees(container).map((link) => link.getAttribute('aria-describedby'));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(container.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  });

  it('without a dot the tab has no badge and no description', () => {
    const { container } = render(shell({ nav: buildNav(eventsModules, labels) }));
    for (const link of trees(container)) {
      expect(link.querySelector('[data-badge-dot]')).toBeNull();
      expect(link.hasAttribute('aria-describedby')).toBe(false);
      expect(link).toHaveAccessibleName('Eventos');
    }
  });
});

describe('media chrome (UI-D-81, REELS-02)', () => {
  const mediaNav = buildNav(
    [
      {
        key: 'communities',
        nav: { label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
      },
      {
        key: 'reels',
        nav: { label: 'Reels', icon: 'film', href: '/reels', order: 30, chrome: 'media' },
      },
    ],
    labels,
  );
  const plainNav = buildNav(
    [
      {
        key: 'communities',
        nav: { label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
      },
    ],
    labels,
  );

  it('REELS-02/populated: on the media tab the mobile TopBar is not rendered and the BottomNav is dark', () => {
    route.pathname = '/reels';
    const { container } = render(shell({ nav: mediaNav }));
    expect(container.querySelector('header')).toBeNull();
    const bottom = container.querySelector('[data-shell-nav="bottom"]');
    expect(bottom?.getAttribute('data-theme')).toBe('dark');
    // Geometry and breakpoint unchanged; the Reels chip is the current tab.
    expect(bottom?.className).toContain('glass-bar');
    expect(bottom?.className).toContain('md:hidden');
    expect(
      [...(bottom?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('aria-label')),
    ).toEqual(['Início', 'Comunidades', 'Reels', 'Perfil']);
    expect(bottom?.querySelector('a[aria-current="page"]')?.getAttribute('aria-label')).toBe(
      'Reels',
    );
    // T-05.3-09: the desktop rail keeps the tenant identity on the media tab too.
    expect(container.querySelector('[data-shell-nav="rail"]')).not.toBeNull();
    expect(screen.getAllByText('Associação São José')).toHaveLength(1);
  });

  it('REELS-02/sub-path: a media tab sub-path keeps the media chrome', () => {
    route.pathname = '/reels/abc';
    const { container } = render(shell({ nav: mediaNav }));
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('[data-shell-nav="bottom"]')?.getAttribute('data-theme')).toBe(
      'dark',
    );
  });

  it('T-05.3-09: off the media tab (same nav, /inicio) the TopBar renders and the BottomNav has no data-theme', () => {
    route.pathname = '/inicio';
    const { container } = render(shell({ nav: mediaNav }));
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelector('[data-shell-nav="bottom"]')?.hasAttribute('data-theme')).toBe(
      false,
    );
    expect(screen.getAllByText('Associação São José')).toHaveLength(2);
  });

  it('a nav without any media entry renders as before on /comunidades (TopBar present, no data-theme)', () => {
    route.pathname = '/comunidades';
    const { container } = render(shell({ nav: plainNav }));
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelector('[data-shell-nav="bottom"]')?.hasAttribute('data-theme')).toBe(
      false,
    );
  });
});

/**
 * 2026-10-09: the shell feeds the back stack every header's "Voltar" reads (`BackStackTracker`), so
 * back returns to the screen the member came from. Here the URL moves as Next moves it, and the
 * mocked `usePathname` follows.
 */
describe('back stack (2026-10-09: "voltar" returns to the previous screen)', () => {
  beforeEach(() => {
    resetBackStack();
    window.history.replaceState(null, '', '/perfil');
    route.pathname = '/perfil';
  });

  afterEach(() => {
    cleanup();
    resetBackStack();
  });

  it('records each screen it shows: from Perfil to Configurações, there is a screen to go back to', () => {
    const { rerender } = render(shell());
    expect(canGoBack()).toBe(false);

    window.history.pushState(null, '', '/configuracoes');
    route.pathname = '/configuracoes';
    rerender(shell());
    expect(canGoBack()).toBe(true);
  });

  it('the first screen alone has nothing behind it', () => {
    render(shell());
    expect(canGoBack()).toBe(false);
  });
});

describe('HomeSlots (D-42)', () => {
  it('E04/empty: renders the empty node when no slot is registered', () => {
    render(<HomeSlots slots={[]} empty={<p>vazio</p>} />);
    expect(screen.getByText('vazio')).toBeInTheDocument();
  });

  it('E04/populated: renders the slots in order (10 before 20) and hides the empty node', () => {
    const { container } = render(
      <HomeSlots
        slots={[
          { key: 'b', order: 20, node: <p>segundo</p> },
          { key: 'a', order: 10, node: <p>primeiro</p> },
          { key: 'c', order: 30, node: null },
        ]}
        empty={<p>vazio</p>}
      />,
    );
    const texts = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(texts).toEqual(['primeiro', 'segundo']);
    expect(screen.queryByText('vazio')).not.toBeInTheDocument();
  });
});
