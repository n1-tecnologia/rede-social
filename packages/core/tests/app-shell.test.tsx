// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, buildNav, HomeSlots, type NavLabels, type NavModule } from '../ui';

// The shell reads the route from Next's app router; outside Next the hook returns nothing useful.
vi.mock('next/navigation', () => ({ usePathname: () => '/inicio' }));

afterEach(() => {
  cleanup();
});

const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };
const demoModules: NavModule[] = [
  {
    key: 'example',
    nav: { label: 'Exemplo', icon: 'sparkles', href: '/inicio#exemplo', order: 90 },
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

  it('with a logo it renders <img alt=displayName> twice (TopBar + rail) and never a bare "TRIA"', () => {
    const { container } = render(
      shell({ brand: { displayName: 'Associação São José', logoUrl: '/logo.svg' } }),
    );
    const imgs = container.querySelectorAll('img[alt="Associação São José"]');
    expect(imgs).toHaveLength(2);
    expect(screen.queryByText('TRIA', { exact: true })).not.toBeInTheDocument();
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

  it('MOD-04: a tab exists only for an enabled module — the lab-like nav has no Exemplo link', () => {
    render(shell());
    expect(screen.queryAllByRole('link', { name: 'Exemplo' })).toHaveLength(0);
  });

  it('MOD-04: the demo-like nav renders the Exemplo tab in both trees, between Início and Perfil', () => {
    const { container } = render(shell({ nav: buildNav(demoModules, labels) }));
    const bottom = container.querySelector('[data-shell-nav="bottom"]');
    expect(
      [...(bottom?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('aria-label')),
    ).toEqual(['Início', 'Exemplo', 'Perfil']);
    const rail = container.querySelector('[data-shell-nav="rail"]');
    expect(rail?.getAttribute('aria-label')).toBe('Navegação principal');
    expect(rail?.textContent).toContain('Exemplo');
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
