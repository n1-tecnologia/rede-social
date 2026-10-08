// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExclusiveBadge,
  LockedCount,
  LockedPostPlaceholder,
  LockedSection,
  ProductChoiceSheet,
  placeholderOpacity,
} from '../ui';

/**
 * UI-D-372 / UI-D-373 / UI-D-375 / UI-D-386 (08.2-09) — the locked community page's pieces as an
 * observable contract. Every piece ships NO words (PWA-03): each string is a prop, sentinel ASCII
 * here so a copy change cannot turn this file red, and the module routes nowhere (MOD-02).
 */

MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

describe('ExclusiveBadge (UI-D-372)', () => {
  it('1. renders the given label on the over-media ground with an aria-hidden Lock glyph', () => {
    render(<ExclusiveBadge label="badge-label" />);
    const pill = screen.getByTestId('exclusive-badge');
    expect(pill).toHaveTextContent('badge-label');
    expect(pill.className).toContain('bg-black/60');
    expect(pill.className).toContain('text-white');
    expect(pill.className).toContain('rounded-full');
    const glyph = pill.querySelector('svg');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    // The text is the pill's only accessible content.
    expect(pill.textContent).toBe('badge-label');
  });
});

describe('LockedSection (UI-D-373 top section)', () => {
  it('2. renders the given title, body and action, with a neutral aria-hidden disc', () => {
    render(
      <LockedSection title="title-x" body="body-x" action={<a href="/loja/p1">action-x</a>} />,
    );
    const section = screen.getByTestId('locked-section');
    expect(within(section).getByRole('heading', { name: 'title-x' })).toBeInTheDocument();
    expect(within(section).getByText('body-x')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'action-x' })).toHaveAttribute(
      'href',
      '/loja/p1',
    );
    expect(within(section).queryByTestId('locked-section-extra')).toBeNull();
    const disc = section.querySelector('span[aria-hidden="true"]');
    expect(disc?.className).toContain('bg-bg-tertiary');
    expect(disc?.className).not.toContain('bg-brand');
  });

  it('3. the optional extra line renders above the body, bold', () => {
    render(<LockedSection title="t" body="body-y" extraLine="extra-y" action={null} />);
    const extra = screen.getByTestId('locked-section-extra');
    expect(extra).toHaveTextContent('extra-y');
    expect(extra.className).toContain('font-bold');
    const body = screen.getByText('body-y');
    // DOCUMENT_POSITION_FOLLOWING: the body comes after the extra line.
    expect(extra.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('LockedCount (UI-D-373 count block)', () => {
  it('4. renders the given line in tabular figures, the body and the optional action', () => {
    render(<LockedCount line="line-x" body="body-x" action={<button type="button">act</button>} />);
    const block = screen.getByTestId('locked-count');
    const line = within(block).getByText('line-x');
    expect(line.className).toContain('tabular-nums');
    expect(within(block).getByText('body-x')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'act' })).toBeInTheDocument();
  });

  it('5. without an action no control renders; the extra line renders when given', () => {
    render(<LockedCount line="l" body="b" extraLine="extra-z" />);
    const block = screen.getByTestId('locked-count');
    expect(within(block).queryByRole('button')).toBeNull();
    expect(within(block).queryByRole('link')).toBeNull();
    expect(within(block).getByTestId('locked-count-extra')).toHaveTextContent('extra-z');
  });
});

describe('LockedPostPlaceholder (UI-D-373 placeholders)', () => {
  it('6. opacity is 100 / 70 / 40 % for index 0 / 1 / 2, and never animates', () => {
    render(
      <div>
        <LockedPostPlaceholder index={0} />
        <LockedPostPlaceholder index={1} />
        <LockedPostPlaceholder index={2} />
      </div>,
    );
    const cards = screen.getAllByTestId('locked-post-placeholder');
    expect(cards).toHaveLength(3);
    expect(cards[0]?.className).toContain('opacity-100');
    expect(cards[1]?.className).toContain('opacity-70');
    expect(cards[2]?.className).toContain('opacity-40');
    for (const card of cards) {
      expect(card.getAttribute('aria-hidden')).toBe('true');
      expect(card.outerHTML).not.toMatch(/animate-|shimmer/);
      expect(card.textContent).toBe('');
      expect(card.className).toContain('rounded-none');
      expect(card.className).toContain('shadow-none');
    }
  });

  it('7. placeholderOpacity clamps out-of-range indexes', () => {
    expect(placeholderOpacity(-1)).toBe('opacity-100');
    expect(placeholderOpacity(5)).toBe('opacity-40');
    expect(placeholderOpacity(Number.NaN)).toBe('opacity-40');
  });
});

describe('ProductChoiceSheet (UI-D-375)', () => {
  const items = [
    {
      href: '/loja/p1?comunidade=c1',
      name: 'product-one',
      priceLabel: 'price-one',
      ariaLabel: 'product-one, price-one',
      thumb: <span data-testid="thumb-1" />,
    },
    {
      href: '/loja/p2?comunidade=c1',
      name: 'product-two',
      priceLabel: 'free-label',
      ariaLabel: 'product-two, free-label',
      thumb: <span data-testid="thumb-2" />,
    },
  ];

  it('8. lists one link row per item with its href, name, price, thumb and chevron', () => {
    render(
      <ProductChoiceSheet
        open
        onClose={vi.fn()}
        title="sheet-title"
        helper="sheet-helper"
        items={items}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('sheet-title')).toBeInTheDocument();
    expect(screen.getByText('sheet-helper')).toBeInTheDocument();
    const links = within(screen.getByTestId('product-choice-list')).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/loja/p1?comunidade=c1');
    expect(links[0]).toHaveAccessibleName('product-one, price-one');
    expect(links[1]).toHaveAttribute('href', '/loja/p2?comunidade=c1');
    expect(within(links[0] as HTMLElement).getByText('product-one').className).toContain(
      'truncate',
    );
    expect(within(links[1] as HTMLElement).getByText('free-label').className).toContain(
      'tabular-nums',
    );
    expect(within(links[0] as HTMLElement).getByTestId('thumb-1')).toBeInTheDocument();
    expect((links[0] as HTMLElement).className).toContain('min-h-16');
    expect((links[0] as HTMLElement).querySelectorAll('svg').length).toBe(1);
  });

  it('9. closed, nothing renders', () => {
    render(
      <ProductChoiceSheet open={false} onClose={vi.fn()} title="t" helper="h" items={items} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('product-one')).toBeNull();
  });
});
