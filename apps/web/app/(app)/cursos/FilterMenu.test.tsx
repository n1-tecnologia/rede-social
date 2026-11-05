// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FilterMenu, type FilterOption } from './FilterMenu';

/**
 * 2026-10-23 — the admin lists' filter as an icon button that opens a dropdown (`FilterMenu`): the
 * closed button names the choice on screen, the panel lists the `?filtro=` links with the current
 * one marked, and a tap outside or Escape closes it. The web workspace has no jest-dom: plain DOM
 * assertions only.
 */

const options = (active: string): FilterOption[] =>
  [
    ['all', 'Todos', '/cursos'],
    ['draft', 'Rascunhos', '/cursos?filtro=rascunhos'],
    ['published', 'Publicados', '/cursos?filtro=publicados'],
    ['archived', 'Arquivados', '/cursos?filtro=arquivados'],
  ].map(([key, label, href]) => ({
    key: key as string,
    label: label as string,
    href: href as string,
    active: key === active,
  }));

function renderMenu(active = 'all', current = 'Todos') {
  render(
    <FilterMenu
      label="Filtrar cursos"
      buttonLabel={`Filtrar cursos: ${current}`}
      options={options(active)}
      testId="courses-filters"
    />,
  );
  return screen.getByRole('button', { name: `Filtrar cursos: ${current}` });
}

afterEach(cleanup);

describe('FilterMenu', () => {
  it('starts closed: one 44px icon button that names the current choice, no panel and no dot on the default', () => {
    const button = renderMenu();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).toContain('h-11');
    expect(button.className).toContain('w-11');
    expect(button.hasAttribute('data-filtered')).toBe(false);
    expect(button.querySelector('[data-filter-dot]')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('opens the panel of links in order, the current one marked; a pick closes it', () => {
    const button = renderMenu('draft', 'Rascunhos');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('navigation', { name: 'Filtrar cursos' });
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    const links = within(panel).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Todos',
      'Rascunhos',
      'Publicados',
      'Arquivados',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/cursos',
      '/cursos?filtro=rascunhos',
      '/cursos?filtro=publicados',
      '/cursos?filtro=arquivados',
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
    ]);
    expect(links[1]?.querySelector('svg')).not.toBeNull();
    expect(links[0]?.querySelector('svg')).toBeNull();

    fireEvent.click(links[2] as HTMLElement);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('a choice other than the default tints the button and adds the dot', () => {
    const button = renderMenu('archived', 'Arquivados');
    expect(button.hasAttribute('data-filtered')).toBe(true);
    expect(button.querySelector('[data-filter-dot]')).not.toBeNull();
    expect(button.className).toContain('text-brand');
  });

  it('Escape closes it with the focus back on the button; a tap outside closes it too', () => {
    const button = renderMenu();
    fireEvent.click(button);
    expect(screen.getByRole('navigation')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(screen.getByRole('navigation')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
