// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { Hourglass, RefreshCw } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { UnavailableCard } from './UnavailableCard';

/**
 * 09.2-21 (UI-D-542): the card takes an optional `icon`; without it every call renders byte-identically
 * to the shipped suspended-host card.
 */
afterEach(cleanup);

describe('UnavailableCard', () => {
  it('without an icon renders the shipped warning triangle, the h2 title and the body', () => {
    const { container } = render(<UnavailableCard title="Título" body="Corpo" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Título' })).toBeTruthy();
    expect(screen.getByText('Corpo')).toBeTruthy();
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('lucide-triangle-alert')).toBe(true);
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('28');
    expect(svg?.getAttribute('class')).toContain('text-warning');
  });

  it('keeps the shipped structure: a centred Card column of glyph, h2 16/700 and a 14/400 secondary body', () => {
    const { container } = render(<UnavailableCard title="T" body="B" />);
    const card = container.firstElementChild;
    expect(card?.className).toContain('flex flex-col items-center gap-3 p-6 text-center');
    expect(Array.from(card?.children ?? []).map((n) => n.tagName.toLowerCase())).toEqual([
      'svg',
      'h2',
      'p',
    ]);
    expect(card?.children[1]?.className).toBe('text-base font-bold text-text');
    expect(card?.children[2]?.className).toBe('text-sm text-text-secondary');
  });

  it.each([
    [RefreshCw, 'lucide-refresh-cw'],
    [Hourglass, 'lucide-hourglass'],
  ])('renders a custom icon decoratively at 28 in the warning tone', (icon, cls) => {
    const { container } = render(<UnavailableCard title="T" body="B" icon={icon} />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains(cls)).toBe(true);
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('28');
    expect(svg?.getAttribute('class')).toContain('text-warning');
  });
});
