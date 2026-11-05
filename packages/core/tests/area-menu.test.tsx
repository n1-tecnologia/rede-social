// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppShell,
  buildNav,
  type NavArea,
  type NavLabels,
  type NavModule,
  type ShellNav,
  withAreas,
  withRailMainSlots,
  withTabOverrides,
} from '../ui';

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

function shell(unread = 3, shellNav: ShellNav = nav) {
  return (
    <AppShell
      brand={{ displayName: 'REINE', logoUrl: null }}
      nav={shellNav}
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

/**
 * 2026-10-22 — the courses area (the social-igoralves prototype's "· Membros" menu). A manager's
 * courses tab carries two variants: "Cursos" (the three authoring screens) everywhere, and
 * "Membros" (the member's five screens, every link in preview) under the member area, where the tab
 * stays current through `matches`. A screen is marked by its PATH, so the preview links still mark
 * the page; the screens' list is `data-area-menu-screens`; the rail names its sub-list.
 */
const coursesModules: NavModule[] = [
  { key: 'courses', nav: { label: 'Cursos', icon: 'graduation-cap', href: '/cursos', order: 30 } },
  modules[1] as NavModule,
];
const managerNav = withAreas(
  withTabOverrides(buildNav(coursesModules, labels), {
    courses: { matches: ['/area-membros'] },
  }),
  [
    {
      key: 'courses',
      label: 'Cursos',
      menuLabel: 'Menu de Cursos',
      screens: [
        { key: 'admin-cursos', href: '/cursos', icon: 'graduation-cap', label: 'Cursos' },
        { key: 'admin-trilhas', href: '/cursos/trilhas', icon: 'route', label: 'Trilhas' },
        { key: 'admin-lives', href: '/cursos/lives', icon: 'radio', label: 'Lives' },
      ],
    },
    {
      key: 'courses',
      label: 'Membros',
      menuLabel: 'Menu de Membros',
      within: ['/area-membros'],
      screens: [
        { key: 'member-inicio', href: '/area-membros?ver=aluno', icon: 'home', label: 'Início' },
        {
          key: 'member-cursos',
          href: '/area-membros/cursos?ver=aluno',
          icon: 'graduation-cap',
          label: 'Cursos',
        },
        {
          key: 'member-trilhas',
          href: '/area-membros/trilhas?ver=aluno',
          icon: 'route',
          label: 'Trilhas',
        },
        {
          key: 'member-lives',
          href: '/area-membros/lives?ver=aluno',
          icon: 'radio',
          label: 'Lives',
        },
        {
          key: 'member-progresso',
          href: '/area-membros/progresso?ver=aluno',
          icon: 'trending-up',
          label: 'Progresso',
        },
      ],
    },
  ],
);

const screensOf = (panel: HTMLElement) =>
  panel.querySelector('[data-area-menu-screens]') as HTMLElement;

describe('the courses area in the TopBar (2026-10-22)', () => {
  it('in the authoring screens: "· Cursos", its three screens, the page marked', () => {
    route.pathname = '/cursos/trilhas';
    render(shell(0, managerNav));
    expect(topbar().querySelector('[data-shell-area="courses"]')).toHaveTextContent('· Cursos');
    const button = within(topbar()).getByRole('button', { name: 'Menu de Cursos' });
    fireEvent.click(button);
    const panel = topbar().querySelector('[data-area-menu-panel]') as HTMLElement;
    const list = screensOf(panel);
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Cursos', 'Trilhas', 'Lives']);
    expect(within(list).getByRole('link', { name: 'Trilhas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(list).getByRole('link', { name: 'Cursos' })).not.toHaveAttribute('aria-current');
  });

  it('previewing the member area: "· Membros", the five screens in preview, the page marked by its path', () => {
    route.pathname = '/area-membros/lives';
    render(shell(0, managerNav));
    expect(topbar().querySelector('[data-shell-area="courses"]')).toHaveTextContent('· Membros');
    fireEvent.click(within(topbar()).getByRole('button', { name: 'Menu de Membros' }));
    const list = screensOf(topbar().querySelector('[data-area-menu-panel]') as HTMLElement);
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Início',
      'Cursos',
      'Trilhas',
      'Lives',
      'Progresso',
    ]);
    for (const link of links) expect(link.getAttribute('href')).toMatch(/\?ver=aluno$/);
    expect(within(list).getByRole('link', { name: 'Lives' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('the panel scrolls inside the screen when it does not fit a short phone', () => {
    route.pathname = '/area-membros';
    render(shell(0, managerNav));
    fireEvent.click(within(topbar()).getByRole('button', { name: 'Menu de Membros' }));
    const panel = topbar().querySelector('[data-area-menu-panel]') as HTMLElement;
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.className).toContain('max-h-[calc(var(--screen-h)-var(--safe-top)-4.5rem)]');
    expect(within(screensOf(panel)).getByRole('link', { name: 'Início' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('the courses area in the rail (2026-10-22)', () => {
  const rail = () => document.querySelector('[data-shell-nav="rail"]') as HTMLElement;

  it('lists the variant of the path under the tab, named by its menu label; the screen takes the highlight', () => {
    route.pathname = '/area-membros/progresso';
    render(shell(0, managerNav));
    const list = rail().querySelector('[data-rail-area="courses"]') as HTMLElement;
    expect(list).toHaveAttribute('aria-label', 'Menu de Membros');
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Início', 'Cursos', 'Trilhas', 'Lives', 'Progresso']);
    expect(within(list).getByRole('link', { name: 'Progresso' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(rail().querySelector('a[data-slot="courses"]')).not.toHaveAttribute('aria-current');
  });

  it('on a course page (no screen) the authoring variant is listed and the tab keeps the highlight', () => {
    route.pathname = '/cursos/6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';
    render(shell(0, managerNav));
    const list = rail().querySelector('[data-rail-area="courses"]') as HTMLElement;
    expect(list).toHaveAttribute('aria-label', 'Menu de Cursos');
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Cursos', 'Trilhas', 'Lives']);
    expect(list.querySelector('[aria-current="page"]')).toBeNull();
    expect(rail().querySelector('a[data-slot="courses"]')).toHaveAttribute('aria-current', 'page');
  });
});

/**
 * 2026-10-24 — the Loja area: the store is a TopBar SLOT, drawn under Principal in the rail
 * (`railMain`), whose pages form an area of their own (Produtos, Comprados, the manager's
 * Gerenciar). No tab claims `/loja`, so there the TopBar reads "· Loja" and folds into its menu,
 * which leaves the Loja out of its own shortcuts, and the rail lists the screens under the slot's
 * row. A tab always wins: beside it the events area behaves as before.
 */
const storeArea: NavArea = {
  key: 'store',
  label: 'Loja',
  menuLabel: 'Menu da Loja',
  screens: [
    { key: 'store-products', href: '/loja', icon: 'shopping-bag', label: 'Produtos' },
    { key: 'store-purchases', href: '/loja/comprados', icon: 'package-check', label: 'Comprados' },
    {
      key: 'store-manage',
      href: '/loja/gerenciar',
      icon: 'sliders-horizontal',
      label: 'Gerenciar',
    },
  ],
};
const storeModules: NavModule[] = [
  ...modules,
  {
    key: 'store',
    nav: { label: 'Loja', icon: 'shopping-bag', href: '/loja', order: 5, placement: 'topbar' },
  },
];
// The Loja left among the shortcuts (no `railMain`: the desktop header's since 2026-10-26, the
// rail's Atalhos before), and moved up under Principal.
const storeShortcutNav = withAreas(buildNav(storeModules, labels), [
  ...(nav.areas ?? []),
  storeArea,
]);
const storeNav = withRailMainSlots(storeShortcutNav, ['store']);
const PRODUCT_PAGE = '/loja/6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';

/** The open panel's rows after the screens: the shortcuts, then the profile. */
const shortcutNames = (panel: HTMLElement) => {
  const list = screensOf(panel);
  return within(panel)
    .getAllByRole('link')
    .filter((link) => !list.contains(link))
    .map((link) => link.getAttribute('aria-label') ?? link.textContent?.trim());
};

describe('the Loja area in the TopBar (2026-10-24: an area owned by a slot)', () => {
  const openStoreMenu = () => {
    fireEvent.click(within(topbar()).getByRole('button', { name: 'Menu da Loja' }));
    return topbar().querySelector('[data-area-menu-panel]') as HTMLElement;
  };

  it('on Comprados: "· Loja" and its menu instead of the slots, Comprados marked, the Loja not among the shortcuts', () => {
    route.pathname = '/loja/comprados';
    render(shell(2, storeNav));
    expect(topbar().querySelector('[data-shell-area="store"]')).toHaveTextContent('· Loja');
    expect(topbar().querySelector('[data-shell-slots]')).toBeNull();
    const panel = openStoreMenu();
    const list = screensOf(panel);
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Produtos', 'Comprados', 'Gerenciar']);
    expect(within(list).getByRole('link', { name: 'Comprados' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(list.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // The Loja's own page is its Produtos screen: the slot is not repeated among the shortcuts.
    expect(shortcutNames(panel)).toEqual(['Notificações', 'Meu perfil']);
    expect(within(panel).queryByRole('link', { name: 'Loja' })).toBeNull();
    expect(panel.querySelectorAll('a[href="/loja"]')).toHaveLength(1);
    expect(within(panel).getByText('2')).toBeInTheDocument();
  });

  it('on Gerenciar the manager screen is the one marked', () => {
    route.pathname = '/loja/gerenciar';
    render(shell(0, storeNav));
    const list = screensOf(openStoreMenu());
    expect(within(list).getByRole('link', { name: 'Gerenciar' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(list.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('on a product page (no screen) the area is named and no screen is marked', () => {
    route.pathname = PRODUCT_PAGE;
    render(shell(0, storeNav));
    expect(topbar().querySelector('[data-shell-area="store"]')).toHaveTextContent('· Loja');
    expect(screensOf(openStoreMenu()).querySelector('[aria-current="page"]')).toBeNull();
  });

  it('outside it the bar is the usual one: the Loja among the slots, the avatar, no area label', () => {
    route.pathname = '/inicio';
    render(shell(0, storeNav));
    expect(topbar().querySelector('[data-shell-area]')).toBeNull();
    expect(within(topbar()).queryByRole('button', { name: 'Menu da Loja' })).toBeNull();
    const slots = topbar().querySelector('[data-shell-slots]') as HTMLElement;
    expect(
      Array.from(slots.querySelectorAll('a[data-slot]')).map((a) => a.getAttribute('data-slot')),
    ).toEqual(['store', 'notifications']);
    expect(within(slots).getByRole('link', { name: 'Meu perfil' })).toBeInTheDocument();
  });

  it('a tab always wins: on an events page the events menu holds, with the Loja among its shortcuts', () => {
    route.pathname = '/eventos/fotos';
    render(shell(0, storeNav));
    expect(topbar().querySelector('[data-shell-area="events"]')).toHaveTextContent('· Eventos');
    expect(within(topbar()).queryByRole('button', { name: 'Menu da Loja' })).toBeNull();
    fireEvent.click(menuButton());
    const panel = topbar().querySelector('[data-area-menu-panel]') as HTMLElement;
    expect(shortcutNames(panel)).toEqual(['Loja', 'Notificações', 'Meu perfil']);
  });
});

describe('the Loja area in the rail (2026-10-24)', () => {
  const rail = () => document.querySelector('[data-shell-nav="rail"]') as HTMLElement;
  const storeRow = () => rail().querySelector('a[data-slot="store"]') as HTMLElement;

  it('on Comprados: the screens right under the Loja row, named by the menu label; Comprados marked, the row not; no Loja among the header shortcuts', () => {
    route.pathname = '/loja/comprados';
    render(shell(0, storeNav));
    const list = rail().querySelector('ul[data-rail-area="store"]') as HTMLElement;
    expect(storeRow().nextElementSibling).toBe(list);
    expect(list).toHaveAttribute('aria-label', 'Menu da Loja');
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Produtos', 'Comprados', 'Gerenciar']);
    expect(within(list).getByRole('link', { name: 'Comprados' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(storeRow()).not.toHaveAttribute('aria-current');
    // One area at a time: the events tab lists nothing here.
    expect(rail().querySelectorAll('[data-rail-area]')).toHaveLength(1);
    const shortcuts = document.querySelector('[data-shell-shortcuts]') as HTMLElement;
    expect(within(shortcuts).queryByRole('link', { name: 'Loja' })).toBeNull();
    expect(within(shortcuts).getByRole('link', { name: 'Notificações' })).toBeInTheDocument();
  });

  it('on the Loja page itself its Produtos screen takes the highlight from the row', () => {
    route.pathname = '/loja';
    render(shell(0, storeNav));
    const list = rail().querySelector('ul[data-rail-area="store"]') as HTMLElement;
    expect(within(list).getByRole('link', { name: 'Produtos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(storeRow()).not.toHaveAttribute('aria-current');
  });

  it('on a product page (no screen) the Loja row keeps the highlight', () => {
    route.pathname = PRODUCT_PAGE;
    render(shell(0, storeNav));
    expect(rail().querySelector('[data-rail-area="store"] [aria-current="page"]')).toBeNull();
    expect(storeRow()).toHaveAttribute('aria-current', 'page');
  });

  it('on an events page the events tab keeps its list and the Loja row is a plain row', () => {
    route.pathname = '/eventos/meus';
    render(shell(0, storeNav));
    expect(rail().querySelector('[data-rail-area="store"]')).toBeNull();
    const list = rail().querySelector('[data-rail-area="events"]') as HTMLElement;
    expect(within(list).getByRole('link', { name: 'Meus' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(storeRow()).not.toHaveAttribute('aria-current');
  });

  it('a slot area whose slot stays among the shortcuts draws no list in the rail: the phone alone has it', () => {
    route.pathname = '/loja/comprados';
    render(shell(0, storeShortcutNav));
    expect(document.querySelector('aside [data-rail-area]')).toBeNull();
    // 2026-10-26: the shortcut is the desktop header's icon link, current inside its area.
    const shortcuts = document.querySelector(
      'header[data-shell-header] [data-shell-shortcuts]',
    ) as HTMLElement;
    expect(within(shortcuts).getByRole('link', { name: 'Loja' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(topbar().querySelector('[data-shell-area="store"]')).toHaveTextContent('· Loja');
  });
});

/**
 * 2026-10-26 — the desktop header names the page from the nav alone: inside an area, the screen
 * that IS the page, else the area; a tab always wins over a slot's area, as in the rail.
 */
describe("the page's name in the desktop header (2026-10-26)", () => {
  const EVENT_PAGE = '/eventos/6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';
  const COURSE_PAGE = '/cursos/6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';

  it.each<[string, string, string, ShellNav]>([
    ['the events list screen', '/eventos', 'Eventos', nav],
    ['an events screen', '/eventos/fotos', 'Fotos', nav],
    ['an event page (no screen): the area', EVENT_PAGE, 'Eventos', nav],
    ['a member screen in preview', '/area-membros/progresso', 'Progresso', managerNav],
    ['the member area home', '/area-membros', 'Início', managerNav],
    ['an authoring screen', '/cursos/trilhas', 'Trilhas', managerNav],
    ['a course page (no screen): the area', COURSE_PAGE, 'Cursos', managerNav],
    ['a store screen', '/loja/comprados', 'Comprados', storeNav],
    ['a product page (no screen): the area', PRODUCT_PAGE, 'Loja', storeNav],
    ['an events screen beside the store', '/eventos/meus', 'Meus', storeNav],
    ['a slot with no area', '/notificacoes', 'Notificações', nav],
  ])('%s (%s) reads "%s"', (_case, path, title, shellNav) => {
    route.pathname = path;
    render(shell(0, shellNav));
    const header = document.querySelector('header[data-shell-header]') as HTMLElement;
    expect(header.querySelector('[data-shell-header-title]')?.textContent).toBe(title);
  });
});
