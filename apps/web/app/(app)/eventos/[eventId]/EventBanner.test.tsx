// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventBannerView } from '@/lib/events-view';
import { EventBanner } from './EventBanner';

/**
 * Phase 10.1-12 (D-748, D-752, D-754, UI-D-749) — the detail's banner. The strings arrive FINISHED from
 * `eventDetailView` (its own tests pin them, `{tenant}` included), so this file pins what the banner
 * draws from them: the three "Presença confirmada" variants in the checked-in banner's geometry, the
 * checked-in banner alone for a present viewer with its refunded line only when the payload carries it,
 * and the cancelled banner with a long tenant name as plain text, never markup.
 */

afterEach(cleanup);

const confirmed = (
  variant: 'ticket' | 'courtesy' | 'before_ticket',
  body: string,
): EventBannerView => ({
  kind: 'confirmed',
  variant,
  title: 'title-sentinel',
  body,
});

describe('EventBanner — Presença confirmada (UI-D-749)', () => {
  it('1. the three variants draw the title and the line of their origin in the success geometry', () => {
    for (const [variant, body] of [
      ['ticket', 'paid-line-sentinel'],
      ['courtesy', 'courtesy-line-sentinel'],
      ['before_ticket', 'before-line-sentinel'],
    ] as const) {
      const { unmount } = render(<EventBanner banner={confirmed(variant, body)} />);
      const banner = screen.getByTestId('event-banner');
      expect(banner.getAttribute('data-kind')).toBe('confirmed');
      expect(banner.getAttribute('data-variant')).toBe(variant);
      expect(banner.className).toContain('border-success/30');
      expect(banner.className).toContain('bg-success/10');
      expect(banner.className).not.toContain('danger');
      expect(screen.getByText('title-sentinel').className).toContain('font-bold');
      expect(screen.getByText(body).className).toContain('text-text-tertiary');
      expect(banner.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(banner.querySelector('svg')?.getAttribute('width')).toBe('20');
      unmount();
    }
  });

  it('2. the confirmed geometry is the checked-in banner’s, class for class', () => {
    const checkedIn = render(
      <EventBanner
        banner={{ kind: 'checkedIn', title: 'title-sentinel', body: 'body-sentinel' }}
      />,
    ).getByTestId('event-banner').className;
    cleanup();
    const sure = render(<EventBanner banner={confirmed('ticket', 'body-sentinel')} />).getByTestId(
      'event-banner',
    ).className;
    expect(sure).toBe(checkedIn);
  });

  it('3. a long tenant name wraps as text: the line is a single text node, never markup', () => {
    const name = '<b>Associação Brasileira de Estudos Avançados do Futuro e Inovação</b>';
    render(
      <EventBanner banner={confirmed('courtesy', `Cortesia. Fale com a equipe de ${name}.`)} />,
    );
    const line = screen.getByText(/Cortesia\. Fale com a equipe de/);
    expect(line.textContent).toContain(name);
    expect(line.querySelector('b')).toBeNull();
    expect(line.className).toContain('break-words');
  });
});

describe('EventBanner — checked in and cancelled (UI-D-749)', () => {
  it('4. a present viewer sees the checked-in banner alone; the refunded line only when it is carried', () => {
    render(
      <EventBanner
        banner={{ kind: 'checkedIn', title: 'title-sentinel', body: 'body-sentinel' }}
      />,
    );
    expect(screen.getByTestId('event-banner').getAttribute('data-kind')).toBe('checkedIn');
    expect(screen.queryByTestId('event-banner-note')).toBeNull();
    cleanup();
    render(
      <EventBanner
        banner={{
          kind: 'checkedIn',
          title: 'title-sentinel',
          body: 'body-sentinel',
          note: 'refunded-note-sentinel',
        }}
      />,
    );
    expect(screen.getByTestId('event-banner-note').textContent).toBe('refunded-note-sentinel');
    expect(screen.getAllByTestId('event-banner')).toHaveLength(1);
  });

  it('5. the cancelled banner keeps the danger geometry and carries the action slot', () => {
    render(
      <EventBanner
        banner={{ kind: 'cancelled', title: 'title-sentinel', body: 'body-sentinel' }}
        action={<button type="button">action-sentinel</button>}
      />,
    );
    const banner = screen.getByTestId('event-banner');
    expect(banner.className).toContain('border-danger/30');
    expect(banner.getAttribute('data-variant')).toBeNull();
    expect(screen.getByRole('button', { name: 'action-sentinel' })).toBeTruthy();
  });
});
