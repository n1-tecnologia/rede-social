// @vitest-environment happy-dom
import type { EventDetail } from '@rede-social/module-events/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.1-14 (D-751, UI-D-757 a) — the manage card of the event detail: the "Acima do limite" pill under
 * the Participantes sub-line. The page is rendered from the RSC itself with its loaders and bootstrap mocked
 * and the REAL `events.json`; the client islands that have their own suites are stubbed, because only the
 * manage card is under test here.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'events' }),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace: 'events' });
  return { ...actual, useTranslations: () => tr };
});

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  event: null as unknown,
}));

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: state.permissions,
    tenant: { id: 'tenant-1', timezone: 'America/Sao_Paulo', displayName: 'Rede Demo' },
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/lib/events', () => ({
  loadEvent: vi.fn(async () => ({ status: 'ok', event: state.event })),
  loadEventPhotos: vi.fn(async () => null),
}));

vi.mock('@/lib/tenant-host', () => ({ primaryHostOrigin: async () => 'https://rede.test' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
// A STABLE router, as Next's is: the countdown hooks depend on it (a new object per render rebuilds the clock).
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => router,
}));

// Islands with their own suites: only the manage card matters here.
vi.mock('./EventActions', () => ({ EventActions: () => null }));
vi.mock('./EventPhotos', () => ({ EventPhotos: () => null }));
vi.mock('./EventLocationMap', () => ({ EventLocationMap: () => null }));
vi.mock('./EventSchedule', () => ({ EventSchedule: () => null }));
vi.mock('./EventRefresh', () => ({
  EventRefresh: ({ children }: { children: ReactElement }) => children,
}));
vi.mock('./DeleteEventControl', () => ({ DeleteEventControl: () => null }));
vi.mock('./ReactivateEventControl', () => ({ ReactivateEventControl: () => null }));

const { default: EventPage } = await import('./page');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = ['events.event.manage', 'events.attendance.read'];

const detail = (overrides: Partial<EventDetail> = {}): EventDetail =>
  ({
    id: EVENT_ID,
    title: 'Encontro anual',
    format: 'in_person',
    category: null,
    capacity: 50,
    venueName: 'Auditório da sede',
    address: null,
    coverAssetId: null,
    coverVariantWidths: [],
    startsAt: '2099-10-12T22:00:00.000000Z',
    endsAt: '2099-10-13T00:00:00.000000Z',
    status: 'active',
    viewerStatus: null,
    viewerCheckedInAt: null,
    confirmedCount: 10,
    presentCount: 0,
    description: 'Uma descrição.',
    viewerRespondedAt: null,
    paid: true,
    ...overrides,
  }) as EventDetail;

async function renderPage() {
  const element = (await EventPage({
    params: Promise.resolve({ eventId: EVENT_ID }),
  })) as ReactElement;
  return render(element);
}

const pill = () => document.querySelector('[data-event-manage-over-limit]');

beforeEach(() => {
  state.permissions = ADMIN;
  state.event = detail();
});
afterEach(cleanup);

describe('the manage card: "Acima do limite" (D-751, UI-D-757 a)', () => {
  it('1. a paid event past its limit shows the warning pill under the Participantes sub-line', async () => {
    state.event = detail({ confirmedCount: 51 });
    await renderPage();
    const element = pill() as HTMLElement;
    expect(element.textContent).toBe('Acima do limite');
    expect(element.className).toContain('bg-warning/10');
    expect(element.className).toContain('mt-1');
    const sub = document.querySelector('[data-event-manage-participants-sub]') as HTMLElement;
    expect(sub.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The same link as before: the pill sits inside the Participantes row.
    expect(element.closest('[data-event-manage-participants]')).not.toBeNull();
  });

  it('2. at the limit, under it, or with no limit there is no pill', async () => {
    for (const overrides of [
      { confirmedCount: 50 },
      { confirmedCount: 49 },
      { capacity: null, confirmedCount: 9999 },
    ]) {
      state.event = detail(overrides);
      const { unmount } = await renderPage();
      expect(pill(), JSON.stringify(overrides)).toBeNull();
      unmount();
    }
  });

  it('3. a free event has no pill, whatever the count', async () => {
    state.event = detail({ paid: false, confirmedCount: 51 });
    await renderPage();
    expect(pill()).toBeNull();
    cleanup();
    state.event = detail({ confirmedCount: 51 });
    delete (state.event as Partial<EventDetail>).paid;
    await renderPage();
    expect(pill()).toBeNull();
  });

  it('4. a member never sees the manage card, so never the pill', async () => {
    state.permissions = [];
    state.event = detail({ confirmedCount: 51 });
    await renderPage();
    expect(document.querySelector('[data-event-manage]')).toBeNull();
    expect(pill()).toBeNull();
    expect(screen.queryByText('Acima do limite')).toBeNull();
  });

  it('5. manage without the attendance read draws no Participantes row, so no pill', async () => {
    state.permissions = ['events.event.manage'];
    state.event = detail({ confirmedCount: 51 });
    await renderPage();
    expect(document.querySelector('[data-event-manage-participants]')).toBeNull();
    expect(pill()).toBeNull();
  });
});

/**
 * Phase 10.2-14 (D-784, D-790, OPEN-07, OPEN-20, UI-D-783, UI-D-788, A-UI-15) - the hero of the page: the
 * `Em breve` tag with the Clock for a paid viewer who is not in (the SHIPPED overline, no competing
 * counter), the holder's live count for a paid event only (through the check-in window, the live word at
 * the start, no milestone sentence), and a free event or a holder with no seed exactly as before. The
 * page is the RSC itself over the REAL catalog; only the request instant is pinned.
 */
describe('the hero: Em breve tag and the holder count (10.2-14)', () => {
  const NOW = '2026-10-01T12:00:00.000Z';
  const OPENS = '2026-10-08T13:00:00.000000Z';
  // 12 d 4 h 13 min after NOW, which is Tuesday 13 Oct at 13:13 in São Paulo.
  const STARTS = '2026-10-13T16:13:00.000000Z';
  const ENDS = '2026-10-13T18:13:00.000000Z';
  const SEED = '2026-10-01T12:00:00.000000Z';

  const at = (iso: string) => vi.setSystemTime(Date.parse(iso));
  const overline = () => screen.getByTestId('event-hero-overline');
  const seeded = (overrides: Partial<EventDetail> = {}) =>
    detail({
      startsAt: STARTS,
      endsAt: ENDS,
      serverNow: SEED,
      ...overrides,
    } as Partial<EventDetail>);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a paid viewer who is not in, before the opening: Em breve with the Clock, and the SHIPPED overline', async () => {
    state.event = seeded({ registrationOpensAt: OPENS } as Partial<EventDetail>);
    await renderPage();
    const tag = screen.getByTestId('event-hero-tag');
    expect(tag.textContent).toBe('Em breve');
    expect(tag.querySelector('svg.lucide-clock')).not.toBeNull();
    expect(tag.querySelector('svg.lucide-ticket')).toBeNull();
    const shipped = overline().textContent;
    expect(shipped).toBe('Faltam 12 dias · ter., 13 de out.');
    // No competing counter in the hero (UI-D-783).
    expect(within(overline()).queryAllByRole('timer')).toHaveLength(0);
    expect(screen.queryByTestId('live-countdown-text')).toBeNull();
    cleanup();

    // The same event, free: the overline is the same text, byte for byte.
    state.event = seeded({ paid: false });
    await renderPage();
    expect(overline().textContent).toBe(shipped);
  });

  it('after the opening the same viewer sees Pago with the Ticket', async () => {
    state.event = seeded({
      registrationOpensAt: '2026-10-01T11:00:00.000000Z',
    } as Partial<EventDetail>);
    await renderPage();
    const tag = screen.getByTestId('event-hero-tag');
    expect(tag.textContent).toBe('Pago');
    expect(tag.querySelector('svg.lucide-ticket')).not.toBeNull();
    expect(tag.querySelector('svg.lucide-clock')).toBeNull();
  });

  it('a paid holder gets the live overline with ONE role=timer, no aria-live ancestor and no milestone sentence', async () => {
    state.event = seeded({ viewerStatus: 'going' });
    await renderPage();
    expect(overline().textContent).toBe('Faltam 12 d 4 h 13 min · ter., 13 de out.');
    const timers = within(overline()).getAllByRole('timer');
    expect(timers).toHaveLength(1);
    expect(screen.getAllByRole('timer')).toHaveLength(1);
    expect(timers[0]?.closest('[aria-live]')).toBeNull();
    expect(screen.queryByTestId('event-hero-tag')).toBeNull();
    // Silent by design: the page draws no polite milestone sentence for the holder.
    expect(document.body.textContent).not.toMatch(
      /Falta(m)? (menos de )?\d* ?(dia|hora|minuto)s? para/i,
    );
  });

  it('the holder count keeps running inside the check-in window, with the right part of the day', async () => {
    at('2026-10-13T15:43:00.000Z'); // 30 min before the start, inside the check-in window
    state.event = seeded({ viewerStatus: 'going', serverNow: '2026-10-13T15:43:00.000000Z' });
    await renderPage();
    expect(overline().textContent).toBe('Faltam 30 min · hoje, 13:13');
    expect(within(overline()).getAllByRole('timer')).toHaveLength(1);
  });

  it('at the start the hero hands over to Acontecendo agora, with no count', async () => {
    at('2026-10-13T16:13:00.000Z');
    state.event = seeded({ viewerStatus: 'going', serverNow: '2026-10-13T16:13:00.000000Z' });
    await renderPage();
    expect(overline().textContent).toBe('Acontecendo agora');
    expect(within(overline()).queryAllByRole('timer')).toHaveLength(0);
  });

  it('a free event keeps Faltam N dias and É hoje! byte for byte, holder or not', async () => {
    state.event = seeded({ paid: false, viewerStatus: 'going' });
    await renderPage();
    expect(overline().textContent).toBe('Faltam 12 dias · ter., 13 de out.');
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
    cleanup();
    at('2026-10-13T12:00:00.000Z');
    state.event = seeded({
      paid: false,
      viewerStatus: 'going',
      serverNow: '2026-10-13T12:00:00.000000Z',
    });
    await renderPage();
    expect(overline().textContent).toBe('É hoje! · 13:13');
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
  });

  it('a paid holder with no seed keeps the shipped overline', async () => {
    state.event = seeded({ viewerStatus: 'going', serverNow: undefined });
    await renderPage();
    expect(overline().textContent).toBe('Faltam 12 dias · ter., 13 de out.');
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
    expect(screen.queryByTestId('live-countdown-text')).toBeNull();
  });
});
