// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { formatBrl } from '@rede-social/contracts/money';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductCard, ProductCardSkeleton } from '../ui';

/**
 * UI-D-368 — the product tile as an observable contract, not pixels.
 *
 * The tile ships NO words (PWA-03) and resolves no route (MOD-02): every string and the href are
 * props, sentinel ASCII here so a copy change cannot turn this file red. The price is whatever the
 * host formatted; the money cases assert against `formatBrl(...)` itself, so the U+00A0 after "R$"
 * is compared exactly (Pitfall 12) and never retyped as an ASCII space.
 *
 * 2026-10-27 ("Vitrine de loja", picked among four directions): ONE light card holding the product
 * on an inset 4:5 stage and its words inside the same surface: the category's eyebrow, then the name
 * and the price together at the foot with the arrow; the state on the stage's corner as a dark glass
 * with its colour in the glyph's disc.
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

describe('ProductCard (UI-D-368, "Vitrine de loja")', () => {
  it('1. is ONE anchor with the host href and the host-composed accessible name, and no button', () => {
    const { container } = card({ imageSlot: IMAGE });
    const link = screen.getByRole('link', { name: 'aria-label-sentinel' });
    expect(link).toHaveAttribute('href', '/loja/p1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(link.className).toContain('active:opacity-90');
    expect(link.className).toContain('focus-visible:ring-2');
    // The member skin's interactive card and its glass (inert outside the skin).
    expect(link.className).toContain('ms-card');
    expect(link.className).toContain('ms-panel');
    // The sizes follow the tile's own width: the root is the container the link reads.
    expect(container.firstElementChild?.className).toContain('@container');
    expect(container.firstElementChild?.contains(link)).toBe(true);
  });

  it('2. the image branch: the inset 4:5 stage holds the host slot, the words sit under it', () => {
    card({ imageSlot: IMAGE });
    const stage = screen.getByTestId('product-card-image');
    expect(stage.className).toContain('aspect-[4/5]');
    expect(stage.contains(screen.getByTestId('host-image'))).toBe(true);
    // The words live in the card, never over the picture.
    expect(stage.contains(screen.getByTestId('product-card-name'))).toBe(false);
    expect(stage.contains(screen.getByTestId('product-card-price'))).toBe(false);
    expect(screen.getByTestId('product-card-name').className).toContain('text-text');
    expect(screen.getByTestId('product-card-price').className).toContain('text-text');
    expect(screen.queryByTestId('product-card-fallback')).toBeNull();
  });

  it("3. no image takes the brand gradient, with the name's initial drawn by CSS", () => {
    card({ name: 'perfume' });
    const stage = screen.getByTestId('product-card-fallback');
    expect(stage.className).toContain('aspect-[4/5]');
    expect(stage.getAttribute('style')).toContain('var(--brand-gradient)');
    expect(stage).toHaveAttribute('data-initial', 'P');
    expect(stage.className).toContain('before:content-[attr(data-initial)]');
    // The initial is a pseudo-element: no text of its own in the DOM.
    expect(stage.textContent).toBe('');
  });

  it('4. the state is a dark glass on the stage, its colour in the glyph disc; archived is bare', () => {
    card({ imageSlot: IMAGE, pill: { kind: 'owned', label: 'owned-sentinel' } });
    let pill = screen.getByTestId('product-card-pill');
    expect(pill).toHaveTextContent('owned-sentinel');
    expect(pill).toHaveAttribute('data-kind', 'owned');
    expect(pill.className).toContain('bg-black/65');
    expect(pill.className).toContain('uppercase');
    expect(pill.className).not.toMatch(/\bbg-success\b|\bbg-brand\b/);
    const disc = pill.querySelector('svg')?.parentElement;
    expect(disc?.className).toContain('bg-success');
    expect(disc).toHaveAttribute('aria-hidden', 'true');
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
    // A price too wide for the arrow beside it pushes the arrow to its own row, never gets cut.
    expect(price.parentElement?.className).toContain('flex-wrap');
    expect(price.parentElement?.className).not.toContain('overflow-hidden');
    cleanup();
    card({ priceLabel: formatBrl(1990) });
    expect(screen.getByTestId('product-card-price').textContent).toBe('R$ 19,90');
  });

  it('6. E03 long-text: an 80-character name clamps to two lines in both branches (CSS only)', () => {
    const long = 'x'.repeat(80);
    card({ imageSlot: IMAGE, name: long });
    const name = screen.getByTestId('product-card-name');
    expect(name.className).toContain('line-clamp-2');
    expect(name.className).not.toMatch(/(^|\s)block(\s|$)/);
    // The long property only: the `text-wrap` shorthand would undo the clamp's wrapping.
    expect(name.className).not.toMatch(/(^|\s)text-(balance|pretty)(\s|$)/);
    expect(name.textContent).toBe(long);
    cleanup();
    card({ name: long });
    expect(screen.getByTestId('product-card-name').className).toContain('line-clamp-2');
    expect(screen.getByTestId('product-card-name').textContent).toBe(long);
  });

  it('7. never draws a lock, grayscale or any text it was not given; reads name, price, state', () => {
    const { container } = card({
      imageSlot: IMAGE,
      pill: { kind: 'owned', label: 'owned-sentinel' },
    });
    expect(container.innerHTML).not.toContain('grayscale');
    // Two glyphs: the arrow and the owned check.
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(container.textContent).toBe('name-sentinelprice-sentinelowned-sentinel');
  });

  it('8. the name and the price sit together at the foot, the arrow a ring that fills on hover', () => {
    card({ imageSlot: IMAGE });
    const name = screen.getByTestId('product-card-name');
    const price = screen.getByTestId('product-card-price');
    const foot = name.parentElement;
    expect(foot?.className).toContain('mt-auto');
    expect(foot?.contains(price)).toBe(true);
    const go = screen.getByTestId('product-card-go');
    expect(go).toHaveAttribute('aria-hidden', 'true');
    expect(go.className).toContain('ring-brand/30');
    expect(go.className).toContain('group-hover:bg-brand');
    expect(go.className).toContain('group-focus-visible:bg-brand');
    // Out on the narrowest tile.
    expect(go.className).toContain('hidden');
    expect(go.className).toContain('@min-[150px]:inline-flex');
    expect(go.querySelector('svg')?.getAttribute('class')).toContain('lucide-arrow-right');
  });

  it('9. the image zooms with the skin, and every motion waits for "reduzir movimento" to allow it', () => {
    card({ imageSlot: IMAGE });
    expect(screen.getByTestId('host-image').parentElement?.className).toContain('ms-zoom');
    expect(screen.getByTestId('product-card-image').className).toContain(
      'motion-safe:group-hover:-translate-y-0.5',
    );
    expect(
      screen.getByTestId('product-card-go').querySelector('svg')?.getAttribute('class'),
    ).toContain('motion-safe:group-hover:translate-x-0.5');
  });
});

describe('ProductCard category eyebrow (2026-10-27, the storefront)', () => {
  it('draws the host tag over the name, in the secondary ink after a brand dash', () => {
    const { container } = card({ imageSlot: IMAGE, tag: 'tag-sentinel' });
    const tag = screen.getByTestId('product-card-tag');
    expect(tag).toHaveTextContent('tag-sentinel');
    expect(tag.className).toContain('text-text-secondary');
    expect(tag.className).not.toMatch(/(^|\s)text-brand(\s|$)/);
    expect(tag.querySelector('[aria-hidden="true"]')?.className).toContain('bg-brand');
    // Out of the picture, before the name.
    expect(screen.getByTestId('product-card-image').contains(tag)).toBe(false);
    expect(container.textContent).toBe('tag-sentinelname-sentinelprice-sentinel');
  });

  it('without a tag the name leads, and the state stays on the stage', () => {
    card({ pill: { kind: 'owned', label: 'owned-sentinel' } });
    expect(screen.queryByTestId('product-card-tag')).toBeNull();
    expect(screen.getByTestId('product-card-pill')).toHaveTextContent('owned-sentinel');
  });
});

describe('ProductCard noLink badge (09.1-17, UI-D-525, UI-D-520, A-P31)', () => {
  it('draws the label with a CircleAlert in a warning disc, never colour alone', () => {
    card({ imageSlot: IMAGE, pill: { kind: 'noLink', label: 'nolink-sentinel' } });
    const pill = screen.getByTestId('product-card-pill');
    expect(pill).toHaveTextContent('nolink-sentinel');
    expect(pill).toHaveAttribute('data-kind', 'noLink');
    const glyph = pill.querySelector('svg');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('width')).toBe('10');
    expect(glyph?.getAttribute('class')).toContain('lucide-circle-alert');
    expect(glyph?.parentElement?.className).toContain('bg-warning');
    expect(glyph?.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('works on the gradient branch too, and the owned and archived badges keep their glyphs', () => {
    card({ pill: { kind: 'noLink', label: 'nolink-sentinel' } });
    expect(screen.getByTestId('product-card-pill')).toHaveTextContent('nolink-sentinel');
    cleanup();
    card({ imageSlot: IMAGE, pill: { kind: 'owned', label: 'owned-sentinel' } });
    expect(
      screen.getByTestId('product-card-pill').querySelector('svg')?.getAttribute('class'),
    ).toContain('lucide-check');
    cleanup();
    card({ imageSlot: IMAGE, pill: { kind: 'archived', label: 'archived-sentinel' } });
    expect(screen.getByTestId('product-card-pill').querySelector('svg')).toBeNull();
  });

  it('the badge adds no word the host did not give', () => {
    const { container } = card({
      imageSlot: IMAGE,
      pill: { kind: 'noLink', label: 'nolink-sentinel' },
    });
    expect(container.textContent).toBe('name-sentinelprice-sentinelnolink-sentinel');
  });
});

describe('ProductCardSkeleton (UI-D-384)', () => {
  it("is the tile's shape: the card, the inset 4:5 stage and the bars at the foot, no words", () => {
    const { container } = render(<ProductCardSkeleton />);
    const root = screen.getByTestId('product-card-skeleton');
    expect(root.className).toContain('@container');
    const stage = container.querySelector('.aspect-\\[4\\/5\\]');
    expect(stage).not.toBeNull();
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
    expect(container.textContent).toBe('');
  });

  it("takes the host grid's class on its wrapper (a placeholder hidden at one width)", () => {
    render(<ProductCardSkeleton className="hidden sm:block" />);
    const wrapper = screen.getByTestId('product-card-skeleton');
    expect(wrapper.className).toContain('hidden');
    expect(wrapper.className).toContain('sm:block');
  });
});
