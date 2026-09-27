// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NextEventCard, type NextEventCardProps } from '../ui/NextEventCard';

/**
 * UI-D-214 — the Início "Próximo evento" card as observable contract, not pixels.
 *
 * The card ships NO words (PWA-03) and resolves no route (MOD-02): every string, the href and the CTA
 * are props, sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';

function card(overrides: Partial<NextEventCardProps> = {}) {
  const props: NextEventCardProps = {
    heading: 'heading-sentinel',
    href: '/eventos/e1',
    ariaLabel: 'row-label-sentinel',
    title: 'title-sentinel',
    overline: 'overline-sentinel',
    place: 'place-sentinel',
    placeKind: 'venue',
    meta: 'meta-sentinel',
    pill: null,
    coverAssetId: ASSET,
    coverVariantWidths: [640, 1080],
    ...overrides,
  };
  return render(<NextEventCard {...props} />);
}

describe('NextEventCard', () => {
  it('1. the top row is ONE anchor with the host href and label, holding every string', () => {
    card();
    const row = screen.getByRole('link', { name: 'row-label-sentinel' });
    expect(row).toHaveAttribute('href', '/eventos/e1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'heading-sentinel' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'heading-sentinel' })).toBeInTheDocument();
    for (const id of ['overline', 'title', 'place', 'meta']) {
      expect(row).toContainElement(screen.getByTestId(`next-event-${id}`));
    }
    expect(screen.getByTestId('next-event-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('next-event-title')).toHaveClass('line-clamp-2');
    expect(screen.getByTestId('next-event-place')).toHaveTextContent('place-sentinel');
  });

  it('2. the CTA slot renders as a SIBLING below the row, never inside its anchor', () => {
    card({ cta: <a href="/eventos/e1/check-in">cta-sentinel</a> });
    const row = screen.getByRole('link', { name: 'row-label-sentinel' });
    const cta = screen.getByRole('link', { name: 'cta-sentinel' });
    expect(row).not.toContainElement(cta);
    expect(cta.closest('a[data-testid="next-event-row"]')).toBeNull();
    expect(screen.getByTestId('next-event-cta')).toContainElement(cta);
    expect(screen.getByTestId('next-event-cta')).toHaveClass('px-3', 'pb-3');
    // No nested anchors anywhere in the card.
    expect(document.querySelector('a a')).toBeNull();
  });

  it('3. without a CTA there is no CTA container at all', () => {
    card();
    expect(screen.queryByTestId('next-event-cta')).toBeNull();
  });

  it('4. no cover takes the brand-gradient thumb, with no text over it', () => {
    card({ coverAssetId: null, coverVariantWidths: [] });
    const thumb = screen.getByTestId('event-cover-fallback');
    expect(thumb).toHaveAttribute('data-geometry', 'thumb');
    expect(thumb).toHaveClass('h-20', 'w-16', 'shrink-0', 'rounded-lg');
    expect(thumb).toHaveTextContent('');
  });

  it('5. a cover takes the thumb photo branch, with no overlay or veil over it', () => {
    card();
    const thumb = screen.getByTestId('event-cover-image');
    expect(thumb).toHaveAttribute('data-geometry', 'thumb');
    expect(thumb).toHaveTextContent('');
    // No text sits on the thumb, so no veil either (and no image alt text is announced: the title
    // is right beside it; happy-dom fails the image load, so the alt is pinned by the source).
    expect(thumb.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('6. the pill slot renders the host tone and label, and is absent when null', () => {
    card({ pill: { tone: 'success', label: 'pill-sentinel' } });
    const pill = screen.getByTestId('next-event-pill');
    expect(pill).toHaveTextContent('pill-sentinel');
    expect(pill).toHaveClass('text-success');
    expect(screen.getByTestId('next-event-meta')).toContainElement(pill);
    cleanup();
    card({ pill: null });
    expect(screen.queryByTestId('next-event-pill')).toBeNull();
  });

  it('7. the online place line uses the video glyph slot and the column can shrink', () => {
    card({ placeKind: 'online', place: 'online-sentinel' });
    expect(screen.getByTestId('next-event-place')).toHaveTextContent('online-sentinel');
    const column = screen.getByTestId('next-event-title').parentElement;
    expect(column).toHaveClass('min-w-0', 'flex-1');
  });
});
