// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventHero } from '../ui/EventHero';
import { EventInfoGrid } from '../ui/EventInfoGrid';
import { EventPoster, type EventPosterPillKind } from '../ui/EventPoster';

/**
 * 06-03 — the detail page's module pieces and the poster's new states, as observable contract.
 * Every string is a sentinel prop (PWA-03): the module ships no words.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';

describe('EventHero (UI-D-204)', () => {
  const base = {
    title: 'title-sentinel',
    overline: 'overline-sentinel',
    place: 'place-sentinel',
    placeKind: 'venue' as const,
    coverVariantWidths: [640, 1080],
    coverAlt: 'cover-alt',
  };

  it('1. no cover takes the gradient branch at 16/10, carrying the overlay in on-primary ink', () => {
    render(<EventHero {...base} coverAssetId={null} />);
    const fallback = screen.getByTestId('event-cover-fallback');
    expect(fallback).toHaveAttribute('data-geometry', 'hero');
    expect(fallback.className).toContain('aspect-[16/10]');
    expect(screen.queryByTestId('event-cover-image')).toBeNull();
    // The overlay is drawn over the gradient, in the inherited ink (no white class).
    const title = screen.getByRole('heading', { level: 2, name: 'title-sentinel' });
    expect(title.className).toContain('line-clamp-3');
    expect(title.className).toContain('text-2xl');
    expect(title.className).not.toContain('text-white');
    expect(screen.getByTestId('event-hero-overline')).toHaveTextContent('overline-sentinel');
    expect(screen.getByTestId('event-hero-place')).toHaveTextContent('place-sentinel');
  });

  it('2. a cover renders the photo branch with the title in white over the veil', () => {
    render(<EventHero {...base} coverAssetId={ASSET} />);
    expect(screen.getByTestId('event-cover-image')).toHaveAttribute('data-geometry', 'hero');
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-white');
  });
});

describe('EventInfoGrid (UI-D-204)', () => {
  const cells = [
    { icon: 'date' as const, label: 'l-date', value: 'v-date' },
    { icon: 'time' as const, label: 'l-time', value: 'v-time' },
    { icon: 'place' as const, label: 'l-place', value: 'v-place' },
    { icon: 'people' as const, label: 'l-count', value: 'v-count' },
  ];

  it('3. four cells in a 2-column grid; only the count cell is aria-live polite', () => {
    render(<EventInfoGrid layout="grid" cells={cells} ariaLiveIndex={3} />);
    expect(screen.getByTestId('event-info-grid').className).toContain('grid-cols-2');
    const values = screen.getAllByTestId('event-info-value');
    expect(values).toHaveLength(4);
    expect(values.map((value) => value.getAttribute('aria-live'))).toEqual([
      null,
      null,
      null,
      'polite',
    ]);
    expect(values[3]).toHaveTextContent('v-count');
    // Values wrap inside their cell; nothing truncates.
    for (const value of values) {
      expect(value.className).toContain('break-words');
      expect(value.className).not.toContain('truncate');
    }
  });
});

describe('EventPoster — the viewer pills and the meta line (06-03)', () => {
  function poster(kind: EventPosterPillKind, meta?: string) {
    return render(
      <EventPoster
        href="/eventos/e1"
        ariaLabel="aria"
        title="t"
        overline="o"
        place="p"
        placeKind="venue"
        pill={{ kind, label: `pill-${kind}` }}
        meta={meta}
        coverAssetId={ASSET}
        coverVariantWidths={[640]}
        coverAlt="alt"
      />,
    );
  }

  it('4. the four pill kinds: going on the brand fill, the others on the over-media ground', () => {
    const grounds: Record<EventPosterPillKind, string> = {
      going: 'bg-brand',
      present: 'bg-black/60',
      cancelled: 'bg-black/60',
      relative: 'bg-black/60',
    };
    for (const kind of Object.keys(grounds) as EventPosterPillKind[]) {
      const { unmount, container } = poster(kind, 'meta');
      const pill = screen.getByTestId('event-poster-pill');
      expect(pill).toHaveAttribute('data-kind', kind);
      expect(pill).toHaveTextContent(`pill-${kind}`);
      expect(pill.className).toContain(grounds[kind]);
      if (kind === 'going') expect(pill.className).toContain('text-on-brand');
      // `present` carries its Check glyph, `cancelled` its CalendarX2; the others none.
      expect(container.querySelector('[data-testid="event-poster-pill"] svg') !== null).toBe(
        kind === 'present' || kind === 'cancelled',
      );
      unmount();
    }
  });

  it('5. the meta line renders the count, and is ABSENT when the host passes none', () => {
    poster('relative', '3 confirmados');
    expect(screen.getByTestId('event-poster-meta')).toHaveTextContent('3 confirmados');
    expect(screen.getByTestId('event-poster-meta').className).toContain('tabular-nums');
    cleanup();
    poster('cancelled');
    expect(screen.queryByTestId('event-poster-meta')).toBeNull();
  });
});
