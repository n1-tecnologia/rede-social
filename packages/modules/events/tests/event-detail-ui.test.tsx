// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventHero } from '../ui/EventHero';
import { EventInfoGrid } from '../ui/EventInfoGrid';
import { EventPoster, type EventPosterBadgeKind } from '../ui/EventPoster';

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
    // 2026-10-06 (REINE): one step smaller, in the tenant's title font (globals.css).
    expect(title.className).toContain('text-xl');
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

describe('EventPoster — the gallery pills and the countdown (2026-10-03, the REINE poster)', () => {
  function poster(kind: EventPosterBadgeKind, note?: string) {
    return render(
      <EventPoster
        href="/eventos/e1"
        ariaLabel="aria"
        title="t"
        category="c"
        place="p"
        placeKind="venue"
        badge={{ kind, label: `pill-${kind}` }}
        note={note}
        coverAssetId={ASSET}
        coverVariantWidths={[640]}
        coverAlt="alt"
      />,
    );
  }

  it('4. the six pill kinds: registered on the button colour, the others on the over-media ground', () => {
    const kinds: EventPosterBadgeKind[] = [
      'registered',
      'participated',
      'date',
      'live',
      'ended',
      'cancelled',
    ];
    for (const kind of kinds) {
      const { unmount, container } = poster(kind, 'note');
      const pill = screen.getByTestId('event-poster-pill');
      expect(pill).toHaveAttribute('data-kind', kind);
      expect(pill).toHaveTextContent(`pill-${kind}`);
      const classes = pill.className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(['uppercase', 'whitespace-nowrap']));
      if (kind === 'registered') {
        // The prototype's gold pill is its button's gold: the tenant's button fill and text.
        expect(classes).toEqual(
          expect.arrayContaining(['bg-button', 'bg-(image:--button-image)', 'text-on-button']),
        );
        expect(classes).not.toContain('bg-black/60');
      } else {
        expect(classes).toEqual(expect.arrayContaining(['bg-black/60', 'text-white']));
        expect(classes).not.toContain('bg-danger');
      }
      // `participated` carries its Check glyph, `cancelled` its CalendarX2; the others none.
      expect(container.querySelector('[data-testid="event-poster-pill"] svg') !== null).toBe(
        kind === 'participated' || kind === 'cancelled',
      );
      unmount();
    }
  });

  it('5. the countdown renders when the host passes one, and is ABSENT otherwise', () => {
    poster('registered', 'Faltam 4 dias');
    expect(screen.getByTestId('event-poster-note')).toHaveTextContent('Faltam 4 dias');
    expect(screen.getByTestId('event-poster-note').className).toContain('tabular-nums');
    cleanup();
    poster('date');
    expect(screen.queryByTestId('event-poster-note')).toBeNull();
  });
});
