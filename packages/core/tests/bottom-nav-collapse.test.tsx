// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomNav, buildNav, type NavLabels, type NavModule, withCollapsingTabs } from '../ui';

// The bar reads the route from Next's app router; each case may set it before rendering.
const route = vi.hoisted(() => ({ pathname: '/comunidades' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

/**
 * The BottomNav folds into the corner over a tab the host marked (2026-10-03, the REINE prototype's
 * "recolher", on Comunidades): scrolling down closes the pill on one button with the tab's icon,
 * scrolling up opens it, and the button takes the page back to the top. Everywhere else the bar
 * keeps shrinking as before. happy-dom has no layout, so the scroll root's position is stubbed and
 * its scroll events fired by hand, as a finger would.
 */

const labels: NavLabels = { home: 'Início', profile: 'Perfil', module: () => null };
const modules: NavModule[] = [
  {
    key: 'communities',
    nav: { label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
  },
  {
    key: 'reels',
    nav: { label: 'Reels', icon: 'film', href: '/reels', order: 30, chrome: 'media' },
  },
];
const BACK = 'Comunidades: voltar ao topo';
const tabs = withCollapsingTabs(buildNav(modules, labels), {
  communities: BACK,
  reels: 'Reels: voltar ao topo',
}).tabs;

const SHRUNK = 'translateY(12px) scale(0.78)';
const FULL = 'translateY(0) scale(1)';

/** The shell's scroll root (`main.app-scroll`), its position stubbed and its `scrollTo` spied. */
function scrollRoot() {
  const root = document.createElement('main');
  root.className = 'app-scroll';
  root.id = 'app-scroll';
  let y = 0;
  Object.defineProperty(root, 'scrollTop', { configurable: true, get: () => y });
  const scrollTo = vi.fn();
  root.scrollTo = scrollTo;
  document.body.append(root);
  const move = (to: number) =>
    act(() => {
      y = to;
      root.dispatchEvent(new Event('scroll'));
    });
  // The first event only registers the root; direction is judged from the next one.
  move(0);
  return { move, scrollTo };
}

function renderNav() {
  const view = render(<BottomNav tabs={tabs} label="Navegação principal" />);
  return { ...view, nav: screen.getByRole('navigation', { name: 'Navegação principal' }) };
}

beforeEach(() => {
  route.pathname = '/comunidades';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const root of document.querySelectorAll('main.app-scroll')) root.remove();
});

describe('BottomNav folding into the corner (NavItem.collapse)', () => {
  it('folds on the marked tab as the page scrolls down, and opens again as it scrolls up', () => {
    const { nav } = renderNav();
    const { move } = scrollRoot();
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(screen.queryByRole('button', { name: BACK })).toBeNull();

    move(120);
    expect(nav).toHaveAttribute('data-collapsed');
    // The pill closes on its one button in the corner, and never shrinks on top of it.
    expect(nav.style.width).toBe('56px');
    expect(nav.style.transform).toBe(FULL);
    const button = screen.getByRole('button', { name: BACK });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('svg.lucide-users')).not.toBeNull();
    // The tabs fade out and turn inert: no tap, keyboard or screen reader reaches them.
    const links = [...nav.querySelectorAll('a')];
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link).toHaveAttribute('inert');
      expect(link.style.opacity).toBe('0');
    }

    // Up past the hysteresis (10px of the 48 the way down built), still away from the top.
    move(60);
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(nav.style.width).toBe('calc(100% - 28px)');
    expect(screen.queryByRole('button', { name: BACK })).toBeNull();
    for (const link of nav.querySelectorAll('a')) {
      expect(link).not.toHaveAttribute('inert');
      expect(link.style.opacity).toBe('1');
    }
  });

  it('the button takes the page back to the top, then hands the focus to the current tab', () => {
    const { nav } = renderNav();
    const { move, scrollTo } = scrollRoot();
    move(400);
    fireEvent.click(screen.getByRole('button', { name: BACK }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(nav).toHaveAttribute('data-collapsed');

    // The smooth scroll arrives: the whole bar is back and the focus is not lost on <body>.
    move(0);
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(screen.getByRole('link', { name: 'Comunidades' })).toHaveFocus();
  });

  it('jumps to the top at once under prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
        }) as MediaQueryList,
    );
    renderNav();
    const { move, scrollTo } = scrollRoot();
    move(400);
    fireEvent.click(screen.getByRole('button', { name: BACK }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('a route change opens the folded bar, and never sends the focus into it', () => {
    const { nav, rerender } = renderNav();
    const { move } = scrollRoot();
    move(400);
    expect(nav).toHaveAttribute('data-collapsed');

    route.pathname = '/inicio';
    rerender(<BottomNav tabs={tabs} label="Navegação principal" />);
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(nav.style.transform).toBe(FULL);
    expect(nav.contains(document.activeElement)).toBe(false);
  });

  it('a tab nobody marked keeps the shrinking bar, and never folds', () => {
    route.pathname = '/inicio';
    const { nav } = renderNav();
    const { move } = scrollRoot();
    move(400);
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(nav.style.transform).toBe(SHRUNK);
    expect(nav.style.width).toBe('calc(100% - 28px)');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never folds on the media chrome, even on a marked tab', () => {
    route.pathname = '/reels';
    const { nav } = renderNav();
    const { move } = scrollRoot();
    move(400);
    expect(nav).toHaveAttribute('data-theme', 'dark');
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('only the shell scroll root moves it: an inner scroller never folds the bar', () => {
    const { nav } = renderNav();
    scrollRoot();
    const inner = document.createElement('div');
    Object.defineProperty(inner, 'scrollTop', { configurable: true, get: () => 400 });
    document.body.append(inner);
    act(() => {
      inner.dispatchEvent(new Event('scroll'));
      inner.dispatchEvent(new Event('scroll'));
    });
    expect(nav).not.toHaveAttribute('data-collapsed');
    inner.remove();
  });
});
