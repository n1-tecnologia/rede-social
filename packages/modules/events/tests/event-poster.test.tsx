// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventCover } from '../ui/EventCover';
import { EventPoster } from '../ui/EventPoster';

/**
 * UI-D-201 / UI-D-202 — the poster as observable contract, not pixels.
 *
 * The poster ships NO words (PWA-03) and resolves no route (MOD-02): every string and the href are
 * props, sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';

function poster(overrides: Record<string, unknown> = {}) {
  const props = {
    href: '/eventos/e1',
    ariaLabel: 'aria-label-sentinel',
    title: 'title-sentinel',
    overline: 'overline-sentinel',
    place: 'place-sentinel',
    placeKind: 'venue' as const,
    pill: { kind: 'relative' as const, label: 'pill-sentinel' },
    coverAssetId: ASSET,
    coverVariantWidths: [640, 1080],
    coverAlt: 'cover-alt',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<EventPoster {...(props as any)} />);
}

describe('EventPoster', () => {
  it('1. is ONE anchor with the host href and the host-composed accessible name', () => {
    poster();
    const link = screen.getByRole('link', { name: 'aria-label-sentinel' });
    expect(link).toHaveAttribute('href', '/eventos/e1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('2. renders every string from props: overline, title, place and the pill', () => {
    poster();
    expect(screen.getByTestId('event-poster-overline')).toHaveTextContent('overline-sentinel');
    expect(screen.getByTestId('event-poster-title')).toHaveTextContent('title-sentinel');
    expect(screen.getByTestId('event-poster-place')).toHaveTextContent('place-sentinel');
    const pill = screen.getByTestId('event-poster-pill');
    expect(pill).toHaveTextContent('pill-sentinel');
    expect(pill).toHaveAttribute('data-kind', 'relative');
    // Over-media ground, never bg-danger (UI-D-202).
    expect(pill.className).toContain('bg-black/60');
    expect(pill.className).not.toContain('bg-danger');
  });

  it('3. the title clamps to two lines and the overline and place truncate (CSS only)', () => {
    poster();
    expect(screen.getByTestId('event-poster-title').className).toContain('line-clamp-2');
    expect(screen.getByTestId('event-poster-overline').className).toContain('truncate');
    expect(screen.getByTestId('event-poster-pill').className).toContain('whitespace-nowrap');
  });

  it('4. a null cover takes the gradient branch, which still carries the text', () => {
    poster({ coverAssetId: null, coverVariantWidths: [] });
    expect(screen.getByTestId('event-cover-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('event-cover-image')).toBeNull();
    expect(screen.getByTestId('event-poster-title')).toHaveTextContent('title-sentinel');
  });

  it('5. grayscale applies to the PHOTO branch only', () => {
    poster({ grayscale: true, pill: { kind: 'cancelled', label: 'cancelled-sentinel' } });
    expect(screen.getByTestId('event-cover-media').className).toContain('grayscale');
    expect(screen.getByTestId('event-poster-pill')).toHaveAttribute('data-kind', 'cancelled');
    cleanup();

    poster({ grayscale: true, coverAssetId: null, coverVariantWidths: [] });
    const fallback = screen.getByTestId('event-cover-fallback');
    expect(fallback.className).not.toContain('grayscale');
    expect(fallback.innerHTML).not.toContain('grayscale');
    cleanup();

    poster({ grayscale: false });
    expect(screen.getByTestId('event-cover-media').className).not.toContain('grayscale');
  });
});

describe('EventCover', () => {
  it('6. thumb renders no overlay on either branch', () => {
    render(
      <EventCover
        geometry="thumb"
        coverAssetId={null}
        coverVariantWidths={[]}
        coverAlt="alt"
        fallbackOverlay={<span>fallback-text</span>}
      />,
    );
    expect(screen.queryByText('fallback-text')).toBeNull();
    expect(screen.getByTestId('event-cover-fallback')).toHaveAttribute('data-geometry', 'thumb');
  });
});
