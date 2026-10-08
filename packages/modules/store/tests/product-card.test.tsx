// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { formatBrl } from '@rede-social/contracts/money';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductCard, ProductCardSkeleton } from '../ui';

/**
 * UI-D-368 — the product poster as an observable contract, not pixels.
 *
 * The card ships NO words (PWA-03) and resolves no route (MOD-02): every string and the href are
 * props, sentinel ASCII here so a copy change cannot turn this file red. The price is whatever the
 * host formatted; the money cases assert against `formatBrl(...)` itself, so the U+00A0 after "R$"
 * is compared exactly (Pitfall 12) and never retyped as an ASCII space.
 */

afterEach(cleanup);

const IMAGE = <img data-testid="host-image" alt="image-alt-sentinel" src="data:," />;

function card(overrides: Record<string, unknown> = {}) {
  const props = {
    href: '/loja/p1',
    ariaLabel: 'aria-label-sentinel',
    name: 'name-sentinel',
    priceLabel: 'price-sentinel',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<ProductCard {...(props as any)} />);
}

describe('ProductCard (UI-D-368)', () => {
  it('1. is ONE anchor with the host href and the host-composed accessible name', () => {
    card({ imageSlot: IMAGE });
    const link = screen.getByRole('link', { name: 'aria-label-sentinel' });
    expect(link).toHaveAttribute('href', '/loja/p1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link.className).toContain('active:opacity-80');
    expect(link.className).toContain('focus-visible:ring-2');
  });

  it('2. the image branch renders the host slot under the veil, in white ink', () => {
    const { container } = card({ imageSlot: IMAGE });
    const box = screen.getByTestId('product-card-image');
    expect(box.className).toContain('aspect-[4/5]');
    expect(box.className).toContain('rounded-xl');
    expect(screen.getByTestId('host-image')).toBeInTheDocument();
    expect(container.querySelector('.from-black\\/80.via-black\\/25')).not.toBeNull();
    expect(screen.getByTestId('product-card-name').className).toContain('text-white');
    expect(screen.getByTestId('product-card-price').className).toContain('text-white/80');
    expect(screen.queryByTestId('product-card-fallback')).toBeNull();
  });

  it('3. no image takes the brand-gradient branch with the --brand-on-primary ink, no veil', () => {
    const { container } = card();
    const box = screen.getByTestId('product-card-fallback');
    expect(box.className).toContain('aspect-[4/5]');
    expect(box.getAttribute('style')).toContain('var(--brand-gradient)');
    expect(container.innerHTML).toContain('var(--brand-on-primary)');
    expect(container.querySelector('.from-black\\/80')).toBeNull();
    expect(screen.getByTestId('product-card-name').className).not.toContain('text-white');
    expect(screen.getByTestId('product-card-price').className).toContain('opacity-80');
    expect(screen.getByTestId('product-card-name')).toHaveTextContent('name-sentinel');
  });

  it('4. the owned pill carries a check; the archived pill is bare; both on the over-media ground', () => {
    card({ imageSlot: IMAGE, pill: { kind: 'owned', label: 'owned-sentinel' } });
    let pill = screen.getByTestId('product-card-pill');
    expect(pill).toHaveTextContent('owned-sentinel');
    expect(pill).toHaveAttribute('data-kind', 'owned');
    expect(pill.querySelector('svg')).not.toBeNull();
    expect(pill.className).toContain('bg-black/60');
    expect(pill.className).toContain('whitespace-nowrap');
    expect(pill.className).not.toMatch(/\bbg-brand\b|bg-button/);
    cleanup();

    card({ pill: { kind: 'archived', label: 'archived-sentinel' } });
    pill = screen.getByTestId('product-card-pill');
    expect(pill).toHaveTextContent('archived-sentinel');
    expect(pill).toHaveAttribute('data-kind', 'archived');
    expect(pill.querySelector('svg')).toBeNull();
    cleanup();

    card({ imageSlot: IMAGE });
    expect(screen.queryByTestId('product-card-pill')).toBeNull();
  });

  it('5. P20/P22: the price is the host string verbatim, NBSP included, on one line', () => {
    const top = formatBrl(10_000_000);
    expect(top).toBe('R$ 100.000,00');
    card({ imageSlot: IMAGE, priceLabel: top });
    const price = screen.getByTestId('product-card-price');
    expect(price.textContent).toBe(top);
    expect(price.textContent).not.toContain('R$ ');
    expect(price.className).toContain('tabular-nums');
    expect(price.className).toContain('whitespace-nowrap');
    cleanup();
    card({ priceLabel: formatBrl(1990) });
    expect(screen.getByTestId('product-card-price').textContent).toBe('R$ 19,90');
  });

  it('6. E03 long-text: an 80-character name clamps to two lines in both branches (CSS only)', () => {
    const long = 'x'.repeat(80);
    card({ imageSlot: IMAGE, name: long });
    expect(screen.getByTestId('product-card-name').className).toContain('line-clamp-2');
    expect(screen.getByTestId('product-card-name').textContent).toBe(long);
    cleanup();
    card({ name: long });
    expect(screen.getByTestId('product-card-name').className).toContain('line-clamp-2');
    expect(screen.getByTestId('product-card-name').textContent).toBe(long);
  });

  it('7. never draws a lock, grayscale or any text it was not given', () => {
    const { container } = card({
      imageSlot: IMAGE,
      pill: { kind: 'owned', label: 'owned-sentinel' },
    });
    expect(container.innerHTML).not.toContain('grayscale');
    // One glyph only: the owned check inside the pill.
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.textContent).toBe('name-sentinelprice-sentinelowned-sentinel');
  });
});

describe('ProductCardSkeleton (UI-D-384)', () => {
  it('is a hidden 4:5 rect with the card radius', () => {
    const { container } = render(<ProductCardSkeleton />);
    const rect = container.querySelector('[aria-hidden]');
    expect(rect).not.toBeNull();
    expect(rect?.className).toContain('aspect-[4/5]');
    expect(rect?.className).toContain('rounded-xl');
    expect(rect?.className).not.toContain('h-24');
    expect(container.textContent).toBe('');
  });
});
