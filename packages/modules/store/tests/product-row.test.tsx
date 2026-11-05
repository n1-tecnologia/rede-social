// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductRow, ProductRowSkeleton } from '../ui';

/**
 * 2026-10-24 — the Gerenciar row (the Loja area) as an observable contract: one anchor with the
 * host's name, the 4:5 48px thumb (or the brand gradient), the clamped name, the one-line price and
 * the catalogue pill as a toned `StatusPill` with its glyph. Every string is a sentinel prop: the
 * row ships no words (PWA-03).
 */

afterEach(cleanup);

const IMAGE = <img data-testid="host-image" alt="image-alt-sentinel" src="data:," />;

function row(overrides: Record<string, unknown> = {}) {
  const props = {
    href: '/loja/p1',
    ariaLabel: 'aria-label-sentinel',
    name: 'name-sentinel',
    priceLabel: 'price-sentinel',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<ProductRow {...(props as any)} />);
}

describe('ProductRow (2026-10-24, Gerenciar)', () => {
  it('is ONE anchor with the host href and accessible name', () => {
    row({ imageSlot: IMAGE });
    const link = screen.getByRole('link', { name: 'aria-label-sentinel' });
    expect(link).toHaveAttribute('href', '/loja/p1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link.className).toContain('hover:bg-card-hover');
  });

  it('draws the host image in the 4:5 48px thumb, or the brand gradient without one', () => {
    row({ imageSlot: IMAGE });
    const thumb = screen.getByTestId('product-row-thumb');
    expect(thumb.className).toContain('aspect-[4/5]');
    expect(thumb.className).toContain('w-12');
    expect(screen.getByTestId('host-image')).toBeInTheDocument();
    cleanup();

    row();
    const fallback = screen.getByTestId('product-row-fallback');
    expect(fallback.className).toContain('aspect-[4/5]');
    expect(fallback.getAttribute('style')).toContain('var(--brand-gradient)');
  });

  it('clamps the name to two lines and keeps the price on one', () => {
    const long = 'x'.repeat(80);
    row({ name: long });
    const name = screen.getByTestId('product-row-name');
    expect(name.className).toContain('line-clamp-2');
    expect(name.className).not.toMatch(/(^|\s)block(\s|$)/);
    expect(name.textContent).toBe(long);
    expect(screen.getByTestId('product-row-price').className).toContain('whitespace-nowrap');
  });

  it.each([
    ['archived', 'bg-bg-tertiary', 'lucide-archive'],
    ['noLink', 'bg-warning/10', 'lucide-circle-alert'],
    ['owned', 'bg-success/10', 'lucide-check'],
  ] as const)(
    'draws the %s pill toned, with its glyph (never colour alone)',
    (kind, tone, glyph) => {
      row({ pill: { kind, label: 'pill-sentinel' } });
      const pill = screen.getByTestId('product-row-pill');
      expect(pill).toHaveAttribute('data-kind', kind);
      expect(pill).toHaveTextContent('pill-sentinel');
      expect(pill.className).toContain(tone);
      const svg = pill.querySelector('svg');
      expect(svg?.getAttribute('class')).toContain(glyph);
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('adds no word the host did not give', () => {
    const { container } = row({ pill: { kind: 'noLink', label: 'pill-sentinel' } });
    expect(container.textContent).toBe('name-sentinelprice-sentinelpill-sentinel');
    cleanup();
    expect(row().container.querySelector('[data-testid="product-row-pill"]')).toBeNull();
  });

  it('hides the chevron below 360px, so the name keeps whole words', () => {
    const { container } = row();
    const chevron = container.querySelector('.lucide-chevron-right');
    expect(chevron?.getAttribute('class')).toContain('hidden');
    expect(chevron?.getAttribute('class')).toContain('min-[360px]:block');
  });
});

describe('ProductRowSkeleton', () => {
  it('is a wordless placeholder hidden from the tree, in the row geometry', () => {
    const { container } = render(<ProductRowSkeleton />);
    const skeleton = screen.getByTestId('product-row-skeleton');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton.querySelector('.aspect-\\[4\\/5\\]')).not.toBeNull();
    expect(container.textContent).toBe('');
  });
});
