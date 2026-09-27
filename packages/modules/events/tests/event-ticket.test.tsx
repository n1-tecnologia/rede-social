// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventInfoGrid } from '../ui/EventInfoGrid';
import { EventTicket } from '../ui/EventTicket';

/**
 * 06-05 — the check-in boarding pass (UI-D-208) and the ticket layout of the info grid, as
 * observable contract. Every string is a sentinel prop (PWA-03): the module ships no words.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';

const cells = [
  { icon: 'date' as const, label: 'l-date', value: 'v-date' },
  { icon: 'time' as const, label: 'l-time', value: 'v-time' },
  { icon: 'place' as const, label: 'l-place', value: 'v-place'.repeat(10) },
];

const base = {
  title: 'title-sentinel',
  overline: 'overline-sentinel',
  place: 'place-sentinel',
  coverVariantWidths: [640, 1080],
  coverAlt: 'cover-alt',
  cells,
};

describe('EventTicket (UI-D-208)', () => {
  it('1. the slot renders the host bottom section, below the perforation', () => {
    render(
      <EventTicket {...base} coverAssetId={ASSET}>
        <p>slot-sentinel</p>
      </EventTicket>,
    );
    const ticket = screen.getByTestId('event-ticket');
    expect(ticket.className).toContain('mx-4');
    const section = screen.getByTestId('event-ticket-section');
    expect(within(section).getByText('slot-sentinel')).toBeInTheDocument();
    // Order: cover, details row, perforation, slot.
    const order = Array.from(ticket.children).map((node) => node.getAttribute('data-testid') ?? '');
    expect(order).toEqual([
      'event-cover-image',
      'event-info-grid',
      'event-ticket-perforation',
      'event-ticket-section',
    ]);
    // The perforation's two notches are the page background, clipped by the card.
    const notches = screen.getByTestId('event-ticket-perforation').querySelectorAll('.bg-bg');
    expect(notches).toHaveLength(2);
    expect(
      screen.getByTestId('event-ticket-perforation').querySelector('.border-dashed'),
    ).not.toBeNull();
  });

  it('2. a cover: the ticket geometry photo branch, with the title in white over the veil', () => {
    render(
      <EventTicket {...base} coverAssetId={ASSET}>
        <span />
      </EventTicket>,
    );
    expect(screen.getByTestId('event-cover-image')).toHaveAttribute('data-geometry', 'ticket');
    const title = screen.getByRole('heading', { level: 2, name: 'title-sentinel' });
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).toContain('text-white');
    expect(screen.getByTestId('event-ticket-overline')).toHaveTextContent('overline-sentinel');
    expect(screen.getByTestId('event-ticket-place')).toHaveTextContent('place-sentinel');
  });

  it('3. no cover: the gradient branch in the ticket geometry, the overlay in on-primary ink', () => {
    render(
      <EventTicket {...base} coverAssetId={null}>
        <span />
      </EventTicket>,
    );
    const fallback = screen.getByTestId('event-cover-fallback');
    expect(fallback).toHaveAttribute('data-geometry', 'ticket');
    expect(fallback.className).toContain('aspect-video');
    expect(screen.queryByTestId('event-cover-image')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).className).not.toContain('text-white');
  });
});

describe('EventInfoGrid layout="ticket" (UI-D-208, UI E08 overflow)', () => {
  it('4. three centred cells in a 3-column row, the middle one bordered on both sides', () => {
    render(<EventInfoGrid layout="ticket" cells={cells} />);
    const grid = screen.getByTestId('event-info-grid');
    expect(grid).toHaveAttribute('data-layout', 'ticket');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('px-2');
    expect(grid.className).toContain('py-4');
    const items = screen.getAllByTestId('event-info-cell');
    expect(items).toHaveLength(3);
    expect(items[1]?.className).toContain('border-x');
    expect(items[0]?.className).not.toContain('border-x');
    for (const item of items) {
      expect(item.className).toContain('min-w-0');
      expect(item.className).toContain('text-center');
    }
  });

  it('5. every value truncates on one line instead of wrapping (a long venue never widens its column)', () => {
    render(<EventInfoGrid layout="ticket" cells={cells} />);
    const values = screen.getAllByTestId('event-info-value');
    expect(values.map((node) => node.textContent)).toEqual([
      'v-date',
      'v-time',
      'v-place'.repeat(10),
    ]);
    for (const value of values) {
      expect(value.className).toContain('truncate');
      expect(value.className).not.toContain('break-words');
    }
    // The full value stays reachable when it is cut.
    expect(values[2]).toHaveAttribute('title', 'v-place'.repeat(10));
  });

  it('6. the detail layout is unchanged: 2 columns, wrapping values', () => {
    render(<EventInfoGrid layout="grid" cells={cells} />);
    expect(screen.getByTestId('event-info-grid').className).toContain('grid-cols-2');
    expect(screen.getAllByTestId('event-info-value')[0]?.className).toContain('break-words');
  });
});
