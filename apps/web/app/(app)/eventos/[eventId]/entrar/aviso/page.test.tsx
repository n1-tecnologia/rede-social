// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 06-06 / Phase 10.1-13 — `/eventos/{id}/entrar/aviso?motivo=` (UI-D-209, UI-D-751, A-UI-7, D-93, T-10.1-05,
 * T-10.1-24, T-10.1-33). Stubbed: `loadEvent` (the one read of the `ingresso` reason) and `redirect`.
 * Real: the page, the catalog, the sale state.
 *
 *  1. the three old reasons draw their icon, title, body and the one outline "Ver evento", and read nothing;
 *  2. `ingresso` draws Ticket 28, the title and body of UI-D-751, then the brand "Comprar ingresso" anchor
 *     (new tab) only while the event can be bought, then the outline "Ver evento";
 *  3. any failure of the read, a sale under way or closed, no valid link: the screen without the anchor;
 *  4. the screen never carries the meeting URL, the venue code or the title; no gateway name;
 *  5. an unknown, repeated or absent `?motivo=` and a malformed id redirect to the detail, silently.
 */

const { loadEvent, redirect } = vi.hoisted(() => ({
  loadEvent: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/events', () => ({ loadEvent }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: Page } = await import('./page');

const ID = '0e000000-0000-4000-8000-000000000e02';
const DETAIL = `/eventos/${ID}`;
const BUY = 'https://pay.example.test/ingresso';
const NOW = Date.parse('2026-10-10T12:00:00Z');

const paidEvent = (over: Record<string, unknown> = {}) => ({
  status: 'ok' as const,
  event: {
    id: ID,
    title: 'Encontro <b>anual</b>',
    status: 'published',
    startsAt: '2026-10-12T22:00:00Z',
    endsAt: '2026-10-13T01:00:00Z',
    capacity: null,
    confirmedCount: 3,
    paid: true,
    ticketPriceCents: 8000,
    checkoutUrl: BUY,
    meetingUrl: 'https://meet.example.test/sala',
    ...over,
  },
});

const render_ = async (motivo?: string | string[]) =>
  render(
    await Page({
      params: Promise.resolve({ eventId: ID }),
      searchParams: Promise.resolve(motivo === undefined ? {} : { motivo }),
    }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  loadEvent.mockReset();
  redirect.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the three old reasons (UI-D-209) are unchanged', () => {
  it.each([
    ['encerrado', 'Este evento já terminou', 'lucide-calendar-clock'],
    ['cancelado', 'Este evento foi cancelado', 'lucide-calendar-x'],
    ['confirmar', 'Confirme sua presença', 'lucide-lock'],
  ])(
    '%s: its icon, title and the single outline "Ver evento", with no read',
    async (motivo, title, icon) => {
      const { container } = await render_(motivo);
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
      expect(container.querySelector(`svg[class*="${icon}"]`)).not.toBeNull();
      const links = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === DETAIL);
      expect(links).toHaveLength(2); // the header back link and the CTA
      expect(screen.getByTestId('enter-notice-cta').textContent).toBe('Ver evento');
      expect(screen.queryByTestId('ticket-door-buy')).toBeNull();
      expect(loadEvent).not.toHaveBeenCalled();
    },
  );
});

describe('the ingresso reason (D-742, UI-D-751, A-UI-7)', () => {
  it('draws Ticket 28, the title and the body, then the brand buy anchor above the outline "Ver evento"', async () => {
    loadEvent.mockResolvedValue(paidEvent());
    const { container } = await render_('ingresso');
    expect(screen.getByTestId('enter-notice').getAttribute('data-reason')).toBe('ingresso');
    expect(screen.getByRole('heading', { name: 'Este evento tem ingresso' })).toBeTruthy();
    expect(
      screen.getByText(
        'O link da transmissão é só para quem tem ingresso. Compre o seu na página do evento.',
      ),
    ).toBeTruthy();
    expect(container.querySelector('svg.lucide-ticket')).not.toBeNull();
    expect(loadEvent).toHaveBeenCalledTimes(1);
    expect(loadEvent).toHaveBeenCalledWith(ID);

    const buy = screen.getByTestId('ticket-door-buy') as HTMLAnchorElement;
    expect(buy.getAttribute('href')).toBe(BUY);
    expect(buy.getAttribute('target')).toBe('_blank');
    expect(buy.getAttribute('rel')).toBe('noopener noreferrer');
    expect(buy.textContent).toContain('Comprar ingresso');
    const view = screen.getByTestId('enter-notice-cta');
    expect(view.textContent).toBe('Ver evento');
    expect(view.getAttribute('href')).toBe(DETAIL);
    expect(buy.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('.bg-button')).toHaveLength(1);
  });

  it.each([
    ['the read says not found', { status: 'not-found' as const }],
    ['the read failed', { status: 'error' as const }],
    ['the sale closed when the event started', paidEvent({ startsAt: '2026-10-10T11:00:00Z' })],
    [
      'the event is over',
      paidEvent({ startsAt: '2026-10-09T10:00:00Z', endsAt: '2026-10-09T12:00:00Z' }),
    ],
    ['the event was cancelled', paidEvent({ status: 'cancelled' })],
    ['the event is full', paidEvent({ capacity: 3, confirmedCount: 3 })],
    ['there is no purchase link', paidEvent({ checkoutUrl: null })],
    ['the link is not https', paidEvent({ checkoutUrl: 'http://pay.example.test/x' })],
    ['the link is a script', paidEvent({ checkoutUrl: 'javascript:alert(1)' })],
  ])('%s: the screen without the anchor, only "Ver evento"', async (_name, result) => {
    loadEvent.mockResolvedValue(result);
    await render_('ingresso');
    expect(screen.getByRole('heading', { name: 'Este evento tem ingresso' })).toBeTruthy();
    expect(screen.queryByTestId('ticket-door-buy')).toBeNull();
    expect(screen.getByTestId('enter-notice-cta').textContent).toBe('Ver evento');
  });

  it('never carries the meeting URL, the venue code, the title or a gateway name (T-10.1-05)', async () => {
    loadEvent.mockResolvedValue(paidEvent());
    const { container } = await render_('ingresso');
    expect(container.innerHTML).not.toContain('meet.example.test');
    expect(container.textContent).not.toContain('anual');
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toMatch(/gateway|kiwify|webhook|pedido/i);
  });
});

describe('anything else redirects to the detail, silently (D-93, T-10.1-33)', () => {
  it.each([
    ['an unknown reason', 'outro'],
    ['a reason in the wrong case', 'Ingresso'],
    ['a repeated reason', ['ingresso', 'ingresso']],
    ['an absent reason', undefined],
    ['a URL', 'https://evil.example/'],
  ])('%s', async (_name, motivo) => {
    await expect(render_(motivo as string | string[] | undefined)).rejects.toThrow(
      `NEXT_REDIRECT:${DETAIL}`,
    );
    expect(loadEvent).not.toHaveBeenCalled();
  });

  it('a malformed id redirects before any read', async () => {
    await expect(
      Page({
        params: Promise.resolve({ eventId: 'nao-e-um-id' }),
        searchParams: Promise.resolve({ motivo: 'ingresso' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/eventos/nao-e-um-id');
    expect(loadEvent).not.toHaveBeenCalled();
  });
});
