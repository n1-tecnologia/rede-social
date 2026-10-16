import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '../src/index';

/**
 * 08.6-08 — `Tabs` (UI-D-446, UI-D-458): the shipped underline tablist gains `density`. The default
 * must render the shipped item classes unchanged (every 08.x hub and the manager's row), and
 * `compact` only swaps the item padding `px-4` for `px-3` (the five-item member row at 390px). The
 * roving tabindex and the arrow keys stay exactly as shipped.
 */

const ITEMS = [
  { key: 'inicio', label: 'Início', href: '/cursos' },
  { key: 'cursos', label: 'Cursos', href: '/cursos?aba=cursos' },
  { key: 'lives', label: 'Lives', href: '/cursos?aba=lives' },
];

function renderTabs(props: Partial<Parameters<typeof Tabs>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <Tabs label="Áreas de Cursos" items={ITEMS} value="inicio" onChange={onChange} {...props} />,
  );
  return { onChange };
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('renders the shipped item padding by default (px-4 py-3, no px-3)', () => {
    renderTabs();
    for (const item of screen.getAllByRole('tab')) {
      expect(item.className).toContain('px-4');
      expect(item.className).toContain('py-3');
      expect(item.className).not.toContain('px-3');
      expect(item.className).toContain('relative shrink-0 whitespace-nowrap px-4 py-3 text-sm');
    }
  });

  it('density="default" is the same as no density', () => {
    renderTabs({ density: 'default' });
    for (const item of screen.getAllByRole('tab')) {
      expect(item.className).toContain('px-4');
      expect(item.className).not.toContain('px-3');
    }
  });

  it('density="compact" swaps px-4 for px-3 and keeps everything else', () => {
    renderTabs({ density: 'compact' });
    for (const item of screen.getAllByRole('tab')) {
      expect(item.className).toContain('px-3');
      expect(item.className).toContain('py-3');
      expect(item.className).not.toContain('px-4');
      expect(item.className).toContain('whitespace-nowrap');
    }
  });

  it('is a named tablist of links with one roving tab stop on the active item', () => {
    renderTabs({ density: 'compact' });
    expect(screen.getByRole('tablist', { name: 'Áreas de Cursos' })).toBeInTheDocument();
    expect(tab('Início')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Início')).toHaveAttribute('tabindex', '0');
    expect(tab('Início')).toHaveAttribute('href', '/cursos');
    expect(tab('Cursos')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Cursos')).toHaveAttribute('tabindex', '-1');
    expect(tab('Lives')).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight / ArrowLeft / Home / End call onChange with the wrapped neighbour', () => {
    const { onChange } = renderTabs();
    fireEvent.keyDown(tab('Início'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('cursos');
    fireEvent.keyDown(tab('Início'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('lives');
    fireEvent.keyDown(tab('Início'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('lives');
    fireEvent.keyDown(tab('Início'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('inicio');
    fireEvent.keyDown(tab('Início'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
