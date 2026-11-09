// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { canGoBack, resetBackStack } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppShell,
  buildNav,
  HomeSlots,
  type NavLabels,
  type NavModule,
  withPhoneTabSlots,
  withRailMainSlots,
  withTabDots,
} from '../ui';

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
        sections: { main: 'Principal', shortcuts: 'Atalhos' },
        accountMenu: 'Menu da conta',
        viewProfile: 'Ver perfil',
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
  // 2026-10-26: on the collapsed desktop rail the name (or the logo) sits beside the mark and shows
  // once the rail opens; it is in the rail all the same.
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
    // The first <header> is still the TopBar: the desktop header follows it in the DOM.
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
    const header = container.querySelector('[data-shell-topbar]') as HTMLElement;
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

  it('D-40: a topbar slot renders with its aria-label and count badge; on the desktop it is an icon link of the header (2026-10-26), with the account menu after it', () => {
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
    const { container } = render(
      shell({ nav, counters: { unreadNotifications: 3, unreadConversations: 0 } }),
    );
    const slots = screen.getAllByRole('link', { name: 'Notificações' });
    expect(slots).toHaveLength(2);
    expect(screen.getAllByText('3')).toHaveLength(2);
    // 2026-10-26: the shortcuts (the rail's "Atalhos" until then) are the desktop header's round
    // icon links, a navigation named "Atalhos", and the account's own rows (Ver perfil,
    // Configurações, Tema, Sair) sit in the menu of its account button, closed until it opens.
    const desktopHeader = container.querySelector('header[data-shell-header]') as HTMLElement;
    const shortcuts = desktopHeader.querySelector('[data-shell-shortcuts]') as HTMLElement;
    expect(shortcuts).toHaveRole('navigation');
    expect(shortcuts).toHaveAccessibleName('Atalhos');
    const bell = within(shortcuts).getByRole('link', { name: 'Notificações' });
    expect(bell).toHaveAttribute('data-slot', 'notifications');
    expect(bell).toHaveClass('h-11', 'w-11', 'rounded-full');
    expect(bell.textContent).toBe('3');
    expect(container.querySelector('aside [data-shell-shortcuts]')).toBeNull();
    expect(container.querySelector('aside [data-shell-account]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Configurações' })).toBeNull();
    const account = within(desktopHeader).getByRole('button', { name: 'Menu da conta' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account.textContent).toContain('Maria');
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    const menu = desktopHeader.querySelector('[data-shell-account-menu]') as HTMLElement;
    expect(account).toHaveAttribute('aria-controls', menu.id);
    // It drops DOWN, right-aligned under the button.
    expect(menu).toHaveClass('top-full', 'right-0');
    expect(within(menu).getByRole('link', { name: 'Ver perfil' })).toHaveAttribute(
      'href',
      '/perfil',
    );
    expect(within(menu).getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'href',
      '/configuracoes',
    );
    expect(within(menu).getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
  });

  it('2026-10-23: a slot the host moved up closes Principal inside the rail navigation; the other slots are the desktop header shortcuts (2026-10-26), before the account button; the TopBar keeps both', () => {
    const nav = withRailMainSlots(
      buildNav(
        [
          ...demoModules,
          {
            key: 'store',
            nav: {
              label: 'Loja',
              icon: 'shopping-bag',
              href: '/loja',
              order: 5,
              placement: 'topbar',
            },
          },
          {
            key: 'notifications',
            nav: {
              label: 'Notificações',
              icon: 'bell',
              href: '/notificacoes',
              order: 10,
              placement: 'topbar',
              badge: 'unreadNotifications',
            },
          },
        ],
        labels,
      ),
      ['store'],
    );
    const { container } = render(shell({ nav }));
    const rail = container.querySelector('[data-shell-nav="rail"]') as HTMLElement;
    expect(Array.from(rail.querySelectorAll('a')).map((a) => a.textContent?.trim())).toEqual([
      'Início',
      'Destaques',
      'Loja',
    ]);
    const shortcuts = container.querySelector('[data-shell-shortcuts]') as HTMLElement;
    expect(within(shortcuts).queryByRole('link', { name: 'Loja' })).toBeNull();
    expect(within(shortcuts).getByRole('link', { name: 'Notificações' })).toBeTruthy();
    // The header's right side holds the shortcuts first, then the account button.
    const account = container.querySelector('[data-shell-account]') as HTMLElement;
    expect(account.parentElement).toBe(shortcuts.parentElement);
    expect(shortcuts.nextElementSibling).toBe(account);
    expect(account.closest('header')).toHaveAttribute('data-shell-header');
    // The phone's TopBar is unchanged: both slots, in their order.
    const topbar = container.querySelector('[data-shell-topbar]') as HTMLElement;
    expect(
      Array.from(topbar.querySelectorAll('a[data-slot]')).map((a) => a.getAttribute('data-slot')),
    ).toEqual(['store', 'notifications']);
  });

  it('2026-10-28: a phoneTab slot closes the phone BottomNav, current on its pages, and leaves the TopBar; the desktop keeps it under Principal', () => {
    route.pathname = '/loja/comprados';
    const nav = withPhoneTabSlots(
      withRailMainSlots(
        buildNav(
          [
            ...demoModules,
            {
              key: 'store',
              nav: {
                label: 'Loja',
                icon: 'shopping-bag',
                href: '/loja',
                order: 5,
                placement: 'topbar',
              },
            },
            {
              key: 'notifications',
              nav: {
                label: 'Notificações',
                icon: 'bell',
                href: '/notificacoes',
                order: 10,
                placement: 'topbar',
                badge: 'unreadNotifications',
              },
            },
          ],
          labels,
        ),
        ['store'],
      ),
      ['store'],
    );
    const { container } = render(shell({ nav }));
    const bottom = container.querySelector('[data-shell-nav="bottom"]') as HTMLElement;
    const tabs = Array.from(bottom.querySelectorAll('a'));
    expect(tabs.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Início',
      'Destaques',
      'Perfil',
      'Loja',
    ]);
    expect(tabs.at(-1)).toHaveAttribute('href', '/loja');
    expect(tabs.at(-1)).toHaveAttribute('aria-current', 'page');
    expect(bottom.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // The phone's TopBar keeps only the other slot.
    const topbar = container.querySelector('[data-shell-topbar]') as HTMLElement;
    expect(
      Array.from(topbar.querySelectorAll('a[data-slot]')).map((a) => a.getAttribute('data-slot')),
    ).toEqual(['notifications']);
    // The desktop rail still closes Principal with it.
    const rail = container.querySelector('[data-shell-nav="rail"]') as HTMLElement;
    expect(Array.from(rail.querySelectorAll('a')).map((a) => a.textContent?.trim())).toContain(
      'Loja',
    );
  });
});

/**
 * 2026-10-26 — the desktop header (the product owner: "no sistema todo em modo desktop um header com
 * as informações que estão no rodapé da navbar lateral"): a 64px bar over the content column, in its
 * own row of the shell's grid, OUTSIDE the scroll root; the page's name on the left, the shortcuts
 * and the account menu on the right. The rail keeps its brand band and Principal.
 */
describe('the desktop header (2026-10-26)', () => {
  const notifications: NavModule = {
    key: 'notifications',
    nav: {
      label: 'Notificações',
      icon: 'bell',
      href: '/notificacoes',
      order: 5,
      placement: 'topbar',
      badge: 'unreadNotifications',
    },
  };
  const desktopHeader = (container: HTMLElement) =>
    container.querySelector('header[data-shell-header]') as HTMLElement;
  const titleOf = (container: HTMLElement) =>
    desktopHeader(container).querySelector('[data-shell-header-title]')?.textContent ?? null;

  /**
   * 2026-10-26 (end of day) — Instagram's chrome (the product owner: "a menu bar lateral igual ao
   * instagram desktop, sem bg, e o header também não, porém ao scrollar ele deve desfocar o fundo na
   * área dele"; then "quero o mesmo efeito de recolhido"): ONE grid row, the header over the scroll
   * root's top in the same cell, the rail its 72px of glyphs on every width, neither with a ground.
   */
  it('sits over the top of the scroll root, in its cell and outside it, with no ground until the page scrolls; the rail keeps the brand band and Sair with no ground', () => {
    const { container } = render(shell({ nav: buildNav([notifications], labels) }));
    const root = container.querySelector('[data-brand-root]') as HTMLElement;
    expect(root).toHaveClass('md:grid', 'md:grid-cols-[72px_1fr]', 'md:grid-rows-[minmax(0,1fr)]');
    const header = desktopHeader(container);
    expect(header).toHaveClass(
      'hidden',
      'md:flex',
      'h-16',
      'md:col-start-2',
      'md:row-start-1',
      'md:self-start',
    );
    // On the chrome rung of the stacking ladder (the TopBar's), so its menu covers the page's
    // sticky layer (40) and the sheets and dialogs (55) still cover it.
    expect(header).toHaveClass('z-50');
    // No ground on the header itself: the blur is a layer behind its content, shown once the page
    // scrolls (the page is at its top here), so the header never holds a containing block.
    expect(header.className).not.toMatch(/(^|\s)(bg-|backdrop-|border-)/);
    expect(header).not.toHaveAttribute('data-scrolled');
    const ground = header.querySelector('[data-shell-header-ground]') as HTMLElement;
    expect(ground).toHaveAttribute('aria-hidden', 'true');
    // The shell's frosted glass (tokens.css), the open rail's too.
    expect(ground).toHaveClass('shell-glass', 'opacity-0', 'pointer-events-none');
    const main = container.querySelector('main.app-scroll') as HTMLElement;
    expect(main.contains(header)).toBe(false);
    expect(header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The same cell as the header; its top padding is the header's 4rem plus the 1.5rem over the
    // page, so the desktop chrome keeps its 7rem.
    expect(main).toHaveClass('md:col-start-2', 'md:row-start-1', 'md:pt-[5.5rem]', 'md:pb-6');
    expect(main).not.toHaveClass('md:pt-6');
    // The header shows no brand (the rail's band does), and the rail holds no shortcut or account.
    expect(header.querySelector('[data-shell-brand]')).toBeNull();
    const rail = container.querySelector('aside') as HTMLElement;
    // One rung over the header (50), so the open panel passes over it; under the surfaces (52, 55).
    expect(rail).toHaveClass('w-[72px]', 'z-[51]');
    // No dividing line beside the page ("remova essa linha de divisão").
    expect(rail.querySelector('[data-shell-rail-panel]')?.className).not.toMatch(/(^|\s)border-/);
    expect(root.className).not.toContain('240px');
    expect(rail.className).not.toContain('xl:w-60');
    expect(rail.className).not.toMatch(/(^|\s)bg-/);
    expect(rail).not.toHaveClass('md:row-span-2');
    expect(rail.querySelector('[data-shell-shortcuts], [data-shell-account]')).toBeNull();
    // 2026-10-26: the rail's one button is "Sair" at its foot (the product owner's request), the
    // sign-out form's submit, like the account menu's.
    const buttons = within(rail).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-shell-logout');
    expect(buttons[0]).toHaveAttribute('type', 'submit');
    expect(buttons[0]?.closest('form')).not.toBeNull();
    expect(buttons[0]).toHaveTextContent('Sair');
    expect(within(rail).queryByRole('link', { name: 'Notificações' })).toBeNull();
    // The brand band is as tall as the header, with no hairline (Instagram's rail has none).
    expect(rail.querySelector('[data-shell-brand]')?.parentElement).toHaveClass('h-16');
    expect(rail.querySelector('[data-shell-brand]')?.parentElement).not.toHaveClass('border-b');
  });

  it("blurs what passes beneath once the page scrolls, and clears again at the page's top", () => {
    const { container } = render(shell({ nav: buildNav([notifications], labels) }));
    const header = desktopHeader(container);
    const ground = header.querySelector('[data-shell-header-ground]') as HTMLElement;
    const main = container.querySelector('main.app-scroll') as HTMLElement;
    act(() => {
      main.scrollTop = 120;
      main.dispatchEvent(new Event('scroll'));
    });
    expect(header).toHaveAttribute('data-scrolled', 'true');
    expect(ground).toHaveClass('opacity-100');
    act(() => {
      main.scrollTop = 0;
      main.dispatchEvent(new Event('scroll'));
    });
    expect(header).not.toHaveAttribute('data-scrolled');
    expect(ground).toHaveClass('opacity-0');
  });

  it("Instagram's collapsed rail that opens on hover: every row its glyph and its name in the panel, the names shown by the rail's CSS, the tenant's initial as its mark, no section title", () => {
    const { container } = render(shell({ nav: buildNav(demoModules, labels) }));
    const rail = container.querySelector('aside') as HTMLElement;
    expect(rail).toHaveAttribute('data-shell-rail');
    // The rows live in the panel that opens over the page (tokens.css: `[data-shell-rail]:hover`).
    const panel = rail.querySelector('[data-shell-rail-panel]') as HTMLElement;
    expect(panel).toHaveClass('absolute', 'w-[72px]', 'overflow-hidden');
    expect(panel.className).not.toMatch(/(^|\s)bg-/);
    // Each row's name is in the row, beside the glyph, shown once the rail opens.
    for (const link of rail.querySelectorAll('[data-shell-nav="rail"] a')) {
      const label = link.querySelector('[data-shell-rail-label]');
      expect(label?.textContent?.trim()).not.toBe('');
    }
    expect(rail.querySelector('[data-shell-rail-tip]')).toBeNull();
    // The open panel's ground is the header's glass, shown by the rail's CSS while it is open.
    const ground = panel.querySelector('[data-shell-rail-ground]');
    expect(ground).toHaveClass('shell-glass', 'pointer-events-none');
    expect(ground).toHaveAttribute('aria-hidden', 'true');
    for (const link of within(rail).getAllByRole('link')) {
      expect(link).toHaveAccessibleName();
    }
    expect(within(rail).getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    const brand = rail.querySelector('[data-shell-brand]') as HTMLElement;
    expect(brand.querySelector('[data-shell-brand-mark]')).toHaveAttribute('data-initial');
    expect(brand.querySelector('[data-shell-brand-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(rail).queryByText('Principal')).toBeNull();
  });

  it.each([
    ['/inicio', 'Feed'],
    ['/destaques', 'Destaques'],
    ['/destaques/abc', 'Destaques'],
    ['/notificacoes', 'Notificações'],
    ['/configuracoes', 'Configurações'],
    ['/configuracoes/marca', 'Configurações'],
    ['/perfil', 'Perfil'],
  ])(
    'names the page on %s "%s": a tab (the home one by its desktop name), a slot, Configurações',
    (path, title) => {
      route.pathname = path;
      const { container } = render(
        shell({
          nav: buildNav([...demoModules, notifications], labels),
          labels: {
            mainNav: 'Navegação principal',
            profile: 'Meu perfil',
            settings: 'Configurações',
            logout: 'Sair',
            theme: 'Tema',
            accountMenu: 'Menu da conta',
            homeTab: 'Feed',
          },
        }),
      );
      expect(titleOf(container)).toBe(title);
      // Plain text, never a heading: the page keeps its one h1.
      expect(within(desktopHeader(container)).queryByRole('heading')).toBeNull();
    },
  );

  it('names nothing where no entry claims the page', () => {
    route.pathname = '/membros';
    const { container } = render(shell());
    expect(desktopHeader(container)).not.toBeNull();
    expect(desktopHeader(container).querySelector('[data-shell-header-title]')).toBeNull();
  });

  it('the account menu closes on a tap outside and on a route change; on the profile the photo wears the brand ring', () => {
    const { container, rerender } = render(shell());
    const account = within(desktopHeader(container)).getByRole('button', { name: 'Menu da conta' });
    expect(account.querySelector('.border-brand')).toBeNull();
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[data-shell-account-menu]')).toBeNull();

    fireEvent.click(account);
    expect(container.querySelector('[data-shell-account-menu]')).not.toBeNull();
    route.pathname = '/perfil';
    rerender(shell());
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account.querySelector('.border-brand')).not.toBeNull();
    fireEvent.click(account);
    expect(screen.getByRole('link', { name: 'Ver perfil' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('with a theme toggle the menu holds the Tema row; Sair is the submit of the sign-out form', () => {
    const { container } = render(shell({ themeToggle: <span data-testid="theme-toggle" /> }));
    expect(screen.queryByTestId('theme-toggle')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Menu da conta' }));
    const menu = container.querySelector('[data-shell-account-menu]') as HTMLElement;
    expect(within(menu).getByText('Tema')).toBeInTheDocument();
    expect(within(menu).getByTestId('theme-toggle')).toBeInTheDocument();
    const logout = within(menu).getByRole('button', { name: 'Sair' });
    expect(logout).toHaveAttribute('type', 'submit');
    expect(logout.closest('form')).not.toBeNull();
  });

  it('without a name (the platform shell) a generic account button opens Configurações, Tema and Sair, and no profile row', () => {
    route.pathname = '/configuracoes';
    const { container } = render(
      shell({
        nav: {
          tabs: [{ key: 'tenants', href: '/plataforma', icon: 'building-2', label: 'Tenants' }],
          topbar: [],
        },
        avatar: { src: null, alt: '' },
        themeToggle: <span data-testid="theme-toggle" />,
      }),
    );
    const header = desktopHeader(container);
    // No shortcuts on the platform: the account button alone, its photo the generic one.
    expect(header.querySelector('[data-shell-shortcuts]')).toBeNull();
    const account = within(header).getByRole('button', { name: 'Menu da conta' });
    expect(account.textContent).toBe('');
    fireEvent.click(account);
    const menu = header.querySelector('[data-shell-account-menu]') as HTMLElement;
    expect(within(menu).queryByRole('link', { name: 'Ver perfil' })).toBeNull();
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Configurações']);
    expect(within(menu).getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(menu).getByTestId('theme-toggle')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    expect(titleOf(container)).toBe('Configurações');
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
    // Neither the phone's TopBar nor (2026-10-26) the desktop header: the stage owns the top.
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

  it('T-05.3-09: off the media tab (same nav, /inicio) the TopBar and the desktop header render and the BottomNav has no data-theme', () => {
    route.pathname = '/inicio';
    const { container } = render(shell({ nav: mediaNav }));
    expect(container.querySelectorAll('header[data-shell-topbar]')).toHaveLength(1);
    expect(container.querySelectorAll('header[data-shell-header]')).toHaveLength(1);
    expect(container.querySelectorAll('header')).toHaveLength(2);
    expect(container.querySelector('[data-shell-nav="bottom"]')?.hasAttribute('data-theme')).toBe(
      false,
    );
    expect(screen.getAllByText('Associação São José')).toHaveLength(2);
  });

  describe('08.5-11 (UI-D-423, D-419) and 2026-10-23: the full row while Cursos is a tab', () => {
    const demotedNav = buildNav(
      [
        {
          key: 'communities',
          nav: { label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
        },
        {
          key: 'courses',
          nav: {
            placement: 'tab',
            label: 'Cursos',
            icon: 'graduation-cap',
            href: '/cursos',
            order: 30,
          },
        },
        {
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
        },
        {
          key: 'store',
          nav: {
            placement: 'topbar',
            label: 'Loja',
            icon: 'shopping-bag',
            href: '/loja',
            order: 5,
          },
        },
      ],
      labels,
    );

    // 2026-10-23 (the product owner's call): the full row no longer sends Reels up. Reels keeps
    // its tab and the kernel Perfil leaves the PHONE's bar (the TopBar's avatar is its door there);
    // on the desktop Perfil is the account menu's (the rail's account card until 2026-10-26, the
    // desktop header's since), not one of the tabs.
    it('on /inicio the BottomNav reads Início · Comunidades · Cursos · Reels, Perfil is the TopBar avatar and the desktop account menu, and no Reels slot', () => {
      const { container } = render(shell({ nav: demotedNav }));
      const bottom = container.querySelector('[data-shell-nav="bottom"]');
      expect(
        [...(bottom?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('aria-label')),
      ).toEqual(['Início', 'Comunidades', 'Cursos', 'Reels']);
      const header = container.querySelector('[data-shell-topbar]') as HTMLElement;
      expect(
        [...header.querySelectorAll('a[data-slot]')].map((a) => a.getAttribute('data-slot')),
      ).toEqual(['store']);
      expect(header.querySelector('a[href="/perfil"]')).not.toBeNull();
      const railNav = container.querySelector('[data-shell-nav="rail"]') as HTMLElement;
      expect(within(railNav).getByRole('link', { name: 'Reels' })).toBeTruthy();
      expect(within(railNav).queryByRole('link', { name: 'Perfil' })).toBeNull();
      expect(container.querySelector('[data-shell-account]')).not.toBeNull();
    });

    it('on /reels from its tab: no mobile TopBar, the dark BottomNav, and Reels current', () => {
      route.pathname = '/reels';
      const { container } = render(shell({ nav: demotedNav }));
      expect(container.querySelector('header')).toBeNull();
      const bottom = container.querySelector('[data-shell-nav="bottom"]');
      expect(bottom?.getAttribute('data-theme')).toBe('dark');
      expect(bottom?.querySelector('a[aria-current="page"]')?.getAttribute('aria-label')).toBe(
        'Reels',
      );
    });

    it('on /cursos the Cursos tab is current in the normal chrome', () => {
      route.pathname = '/cursos';
      const { container } = render(shell({ nav: demotedNav }));
      expect(container.querySelectorAll('header[data-shell-topbar]')).toHaveLength(1);
      const bottom = container.querySelector('[data-shell-nav="bottom"]');
      expect(bottom?.hasAttribute('data-theme')).toBe(false);
      expect(bottom?.querySelector('a[aria-current="page"]')?.getAttribute('aria-label')).toBe(
        'Cursos',
      );
    });

    it('UI-D-423 320px fit: the TopBar right group carries gap-1 and min-[360px]:gap-3, and every slot keeps h-11 w-11', () => {
      const { container } = render(shell({ nav: demotedNav }));
      const group = container.querySelector('header [data-shell-slots]') as HTMLElement;
      expect(group).not.toBeNull();
      expect(group.classList.contains('gap-1')).toBe(true);
      expect(group.classList.contains('min-[360px]:gap-3')).toBe(true);
      expect(group.classList.contains('gap-3')).toBe(false);
      for (const slot of group.querySelectorAll('a[data-slot]')) {
        expect(slot.classList.contains('h-11')).toBe(true);
        expect(slot.classList.contains('w-11')).toBe(true);
      }
      // The home link never narrows under 44px.
      expect(container.querySelector('header [data-shell-brand]')?.classList).toContain('min-w-11');
    });
  });

  it('a nav without any media entry renders as before on /comunidades (TopBar present, no data-theme)', () => {
    route.pathname = '/comunidades';
    const { container } = render(shell({ nav: plainNav }));
    expect(container.querySelectorAll('header[data-shell-topbar]')).toHaveLength(1);
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
