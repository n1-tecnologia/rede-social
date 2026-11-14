// @vitest-environment happy-dom

import { formatBrl } from '@rede-social/contracts/money';
import type { EventSummary } from '@rede-social/module-events/contracts';
import { EventPoster } from '@rede-social/module-events/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EventCardView, eventCardView } from '@/lib/events-view';

/**
 * 2026-10-03 — the `/eventos` galleries (the REINE prototype's "Meus eventos" and "Outros eventos").
 *
 * The catalog is the REAL `events.json`, so an assertion here fails when the pt-BR copy drifts. The
 * refresh action is stubbed. Four claims:
 *  1. each gallery is a region named by its title, holding one poster link per view, in order;
 *  2. an empty gallery has its own card, and the manager's "Outros" one offers "Criar evento";
 *  3. the manager's create control sits beside the first gallery's title;
 *  4. an unreadable first load renders the generic error card, whose retry refreshes the galleries.
 */

const { catalog, icu } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  // The real ICU translator, for the plural and select keys of the live count (Phase 10.2-14).
  const real = createTranslator({
    locale: 'pt-BR',
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    namespace: 'events' as never,
  }) as unknown as (key: string, values?: Record<string, unknown>) => string;
  return { catalog: read('events').events as Record<string, unknown>, icu: real };
});

MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  if (typeof raw === 'string' && /\{\w+, (plural|select)/.test(raw)) return icu(key, values);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => lookup(key, values),
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ refreshEventSectionsAction: refresh }));
// The shared refresh island has its own suite: here only what the gallery hands it is under test.
const island = vi.hoisted(() => ({ mounts: [] as Array<Record<string, unknown>> }));
vi.mock('@/components/events/GalleryBoundaryRefresh', () => ({
  GalleryBoundaryRefresh: (props: Record<string, unknown>) => {
    island.mounts.push(props);
    return <span data-testid="gallery-boundary-refresh" />;
  },
}));
// A STABLE router, as Next's is (the countdown hooks depend on it).
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const { EventsSections } = await import('./EventsSections');

afterEach(() => {
  cleanup();
  refresh.mockReset();
  nav.refresh.mockReset();
  island.mounts.length = 0;
  vi.useRealTimers();
});

const TENANT = 'Tenant Demo';
const sections = catalog.sections as {
  mine: Record<string, string>;
  others: Record<string, string>;
};

function card(id: string, overrides: Partial<EventCardView> = {}): EventCardView {
  return {
    id,
    href: `/eventos/${id}`,
    title: `Evento ${id}`,
    category: 'Evento presencial',
    place: 'Sede',
    placeKind: 'venue',
    badge: { kind: 'date', label: '12 OUT' },
    ariaLabel: `Evento ${id}, seg., 12 de out. · 19:00`,
    // Cover-less, so no media request is involved.
    coverAssetId: null,
    coverVariantWidths: [],
    coverAlt: `Capa do evento Evento ${id}`,
    grayscale: false,
    ...overrides,
  };
}

const gallery = (name: string) => screen.getByRole('region', { name });

describe('EventsSections', () => {
  it('1. each gallery is a region named by its title, one poster link per view, in order', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [
            card('a', { badge: { kind: 'registered', label: 'Inscrito' }, note: 'Faltam 4 dias' }),
          ],
          others: [card('b'), card('c')],
        }}
      />,
    );
    const mine = gallery(sections.mine.title ?? '');
    const others = gallery(sections.others.title ?? '');
    expect(within(mine).getByText(sections.mine.subtitle ?? '')).toBeTruthy();
    expect(within(others).getByText(sections.others.subtitle ?? '')).toBeTruthy();
    expect(
      within(mine)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/eventos/a']);
    expect(
      within(others)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['Evento b, seg., 12 de out. · 19:00', 'Evento c, seg., 12 de out. · 19:00']);
    // A list each, so assistive tech announces how many; "Meus eventos" comes first.
    expect(within(others).getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([sections.mine.title, sections.others.title]);
    expect(within(mine).getByTestId('event-poster-note').textContent).toBe('Faltam 4 dias');
  });

  it('2. an empty gallery has its own card; the manager’s "Outros" one offers "Criar evento"', () => {
    render(<EventsSections tenantName={TENANT} initial={{ mine: [], others: [] }} />);
    expect(screen.getByTestId('events-empty-mine').textContent).toContain(sections.mine.emptyBody);
    const others = screen.getByTestId('events-empty-others');
    expect(others.textContent).toContain(`Os eventos de ${TENANT}`);
    expect(others.querySelector('[data-events-empty-create]')).toBeNull();
    cleanup();

    render(
      <EventsSections tenantName={TENANT} canManage initial={{ mine: [card('a')], others: [] }} />,
    );
    const managed = screen.getByTestId('events-empty-others');
    expect(managed.textContent).toContain(sections.others.emptyBodyManager);
    expect(managed.querySelector('a[data-events-empty-create]')).toHaveProperty(
      'href',
      expect.stringMatching(/\/eventos\/novo$/),
    );
    expect(screen.queryByTestId('events-empty-mine')).toBeNull();
  });

  it('3. the manager’s create control sits beside the first gallery’s title', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        canManage
        initial={{ mine: [], others: [card('b')] }}
        createControl={<a href="/eventos/novo" data-events-create aria-label="create" />}
      />,
    );
    const mine = gallery(sections.mine.title ?? '');
    expect(mine.querySelector('[data-events-create]')).not.toBeNull();
    expect(gallery(sections.others.title ?? '').querySelector('[data-events-create]')).toBeNull();
  });

  it('4. an unreadable first load renders the error card, whose retry refreshes the galleries', async () => {
    refresh.mockResolvedValue({ ok: true, sections: { mine: [], others: [card('b')] } });
    render(<EventsSections tenantName={TENANT} initial={null} />);
    expect(
      screen.getByText(String((catalog.errors as Record<string, string>).generic)),
    ).toBeTruthy();
    expect(screen.queryByRole('region')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: (catalog.errors as Record<string, string>).retry }),
    );
    await waitFor(() => expect(gallery(sections.others.title ?? '')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/eventos/b',
    ]);
  });
});

/**
 * 12.3-08 (NOVF-04, UI-D-693): the list card draws the vertical poster when the event has one, else
 * the horizontal cover as it always did, else the brand gradient. The event's own page keeps the
 * horizontal cover (it never reads the poster; see `lib/events-view.ts`'s detail view).
 */
describe('EventsSections — the poster of the list card (NOVF-04, UI-D-693)', () => {
  const POSTER = '0b000000-0000-4000-8000-0000000000b1';
  const COVER = '0c000000-0000-4000-8000-0000000000c1';
  const imageSrc = (id: string) =>
    screen
      .getByRole('link', { name: new RegExp(`Evento ${id},`) })
      .querySelector('[data-testid="event-cover-media"] img')
      ?.getAttribute('src') ?? '';

  it('5. poster first: a card with a poster and a cover draws the poster, not the cover', () => {
    // happy-dom loads no image: say every picture decoded, so `MediaImage` keeps its `<img>`.
    const decoded = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(640);
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [
            card('both', {
              posterAssetId: POSTER,
              posterVariantWidths: [640],
              coverAssetId: COVER,
              coverVariantWidths: [640],
            }),
          ],
        }}
      />,
    );
    expect(imageSrc('both')).toContain(POSTER);
    expect(imageSrc('both')).not.toContain(COVER);
    decoded.mockRestore();
  });

  it('6. without a poster the card keeps the horizontal cover cropped, as before; a null or an older answer is the same', () => {
    const decoded = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(640);
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [
            card('nulled', {
              posterAssetId: null,
              posterVariantWidths: [],
              coverAssetId: COVER,
              coverVariantWidths: [640],
            }),
            card('older', { coverAssetId: COVER, coverVariantWidths: [640] }),
          ],
        }}
      />,
    );
    expect(imageSrc('nulled')).toContain(COVER);
    expect(imageSrc('older')).toContain(COVER);
    decoded.mockRestore();
  });

  it('7. a poster with no horizontal cover still draws the poster', () => {
    const decoded = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(640);
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [card('only', { posterAssetId: POSTER, posterVariantWidths: [640] })],
        }}
      />,
    );
    expect(imageSrc('only')).toContain(POSTER);
    decoded.mockRestore();
  });

  it('8. with neither image the card draws the brand gradient', () => {
    render(<EventsSections tenantName={TENANT} initial={{ mine: [], others: [card('none')] }} />);
    expect(screen.getByTestId('event-cover-fallback')).toBeTruthy();
    expect(screen.queryByTestId('event-cover-media')).toBeNull();
  });
});

/**
 * Phase 10.1-12 (D-753, D-755, UI-D-744): the card's "Pago" tag and its price-first note reach the
 * poster; a card without a `tag` key (a free event, or a viewer who is in) draws none and stays ONE
 * anchor per card.
 */
describe('EventsSections — the paid card (10.1-12, UI-D-744)', () => {
  it('9. a paid card draws the tag and the price-first note inside its one link; a free card draws none', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [
            card('paid', {
              tag: 'Pago',
              note: 'R$ 80,00 · Últimas 3 vagas',
              ariaLabel: 'Evento paid, evento pago, R$ 80,00',
            }),
            card('free'),
          ],
        }}
      />,
    );
    const items = within(gallery(sections.others.title ?? '')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [paid, free] = items as [HTMLElement, HTMLElement];
    expect(within(paid).getByTestId('event-poster-tag').textContent).toBe('Pago');
    expect(within(paid).getByTestId('event-poster-note').textContent).toBe(
      'R$ 80,00 · Últimas 3 vagas',
    );
    expect(within(paid).getAllByRole('link')).toHaveLength(1);
    expect(within(paid).getByRole('link').getAttribute('aria-label')).toContain('evento pago');
    expect(within(free).queryByTestId('event-poster-tag')).toBeNull();
    expect(within(free).getAllByRole('link')).toHaveLength(1);
  });
});

/**
 * Phase 10.2-14 (D-784, D-785, D-786, OPEN-07) - the card of a paid event whose opening is ahead: the
 * `Em breve` tag with the Clock, the price-first note with the live short count, the static accessible
 * name (the absolute opening date, never the ticking value), one anchor, and a free card unchanged. The
 * view is the REAL `eventCardView` over a summary, so the descriptor, the note and the name are the
 * server's own words.
 */
describe('EventsSections — the Em breve card (10.2-14, D-784, D-785)', () => {
  const PRICE = formatBrl(8000);
  const SEED = '2026-10-05T08:47:00.000000Z';
  const OPENS = '2026-10-07T13:00:00.000000Z';
  const summary = (overrides: Partial<EventSummary> = {}): EventSummary => ({
    id: 'soon',
    title: 'Encontro anual',
    format: 'in_person',
    category: null,
    capacity: null,
    venueName: 'Auditório da sede',
    address: null,
    coverAssetId: null,
    coverVariantWidths: [],
    startsAt: '2026-10-12T22:00:00.000000Z',
    endsAt: '2026-10-13T00:00:00.000000Z',
    status: 'active',
    viewerStatus: null,
    viewerCheckedInAt: null,
    confirmedCount: 0,
    presentCount: 0,
    paid: true,
    ticketPriceCents: 8000,
    registrationOpensAt: OPENS,
    serverNow: SEED,
    ...overrides,
  });
  const view = (overrides: Partial<EventSummary> = {}) =>
    eventCardView(summary(overrides), {
      tz: 'America/Sao_Paulo',
      nowMs: Date.parse(SEED),
      t: icu as unknown as Parameters<typeof eventCardView>[1]['t'],
    });

  it('the tracer: the Em breve tag with the Clock and the live price-first note inside ONE link', () => {
    render(<EventsSections tenantName={TENANT} initial={{ mine: [], others: [view()] }} />);
    const [item] = within(gallery(sections.others.title ?? '')).getAllByRole('listitem');
    const tag = within(item as HTMLElement).getByTestId('event-poster-tag');
    expect(tag.textContent).toBe('Em breve');
    expect(tag.querySelector('svg.lucide-clock')).not.toBeNull();
    expect(tag.querySelector('svg.lucide-ticket')).toBeNull();
    expect(within(item as HTMLElement).getByTestId('event-poster-note').textContent).toBe(
      `${PRICE} · Abre em 2 d 4 h 13 min`,
    );
    expect(within(item as HTMLElement).getAllByRole('link')).toHaveLength(1);
    // The card's count is plain text: a link never holds a timer.
    expect(within(item as HTMLElement).queryAllByRole('timer')).toHaveLength(0);
  });

  it('the accessible name is static: the absolute opening date and time, no count unit', () => {
    render(<EventsSections tenantName={TENANT} initial={{ mine: [], others: [view()] }} />);
    const label = screen.getByRole('link').getAttribute('aria-label') ?? '';
    expect(label).toBe(view().ariaLabel);
    expect(label).toContain('10:00');
    expect(label).toMatch(/abre 7 out, 10:00/);
    expect(label).not.toMatch(/\d\s?(d|h|min)\b/);
    expect(label).not.toContain('Abre em');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('the count follows the minute change from the server seed, and the name never changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(SEED));
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [view({ registrationOpensAt: '2026-10-05T10:47:00.000000Z' })],
        }}
      />,
    );
    const label = screen.getByRole('link').getAttribute('aria-label');
    expect(screen.getByTestId('event-poster-note').textContent).toBe(`${PRICE} · Abre em 2 h`);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('event-poster-note').textContent).toBe(
      `${PRICE} · Abre em 1 h 59 min`,
    );
    expect(screen.getByRole('link').getAttribute('aria-label')).toBe(label);
  });

  it('with no seed the card keeps its static note (an older API) and draws no count', () => {
    const older = eventCardView(summary({ serverNow: undefined }), {
      tz: 'America/Sao_Paulo',
      nowMs: Date.parse(SEED),
      t: icu as unknown as Parameters<typeof eventCardView>[1]['t'],
    });
    render(<EventsSections tenantName={TENANT} initial={{ mine: [], others: [older] }} />);
    expect(screen.queryByTestId('live-countdown-text')).toBeNull();
    expect(screen.getByTestId('event-poster-tag').querySelector('svg.lucide-clock')).toBeNull();
  });

  it('a card with no descriptor draws its static note, and a paid card keeps the Ticket', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [
            card('paid', { tag: 'Pago', note: 'R$ 80,00 · Últimas 3 vagas' }),
            card('free', { note: 'Faltam 4 dias' }),
          ],
        }}
      />,
    );
    const [paid, free] = within(gallery(sections.others.title ?? '')).getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
    ];
    expect(
      within(paid).getByTestId('event-poster-tag').querySelector('svg.lucide-ticket'),
    ).not.toBeNull();
    expect(within(paid).getByTestId('event-poster-note').innerHTML).toBe(
      'R$ 80,00 · Últimas 3 vagas',
    );
    expect(within(free).getByTestId('event-poster-note').innerHTML).toBe('Faltam 4 dias');
    expect(within(free).queryByTestId('event-poster-tag')).toBeNull();
  });

  it('a free event card is byte-identical to the shipped poster markup', () => {
    // The oracle is the poster rendered straight from the same props the page used before this plan.
    const free = card('free', { note: 'Faltam 4 dias' });
    const { container } = render(
      <EventsSections tenantName={TENANT} initial={{ mine: [], others: [free] }} />,
    );
    const html = within(container).getByTestId('event-poster').outerHTML;
    cleanup();
    const direct = render(
      <EventPoster
        href={free.href}
        ariaLabel={free.ariaLabel}
        title={free.title}
        category={free.category}
        place={free.place}
        placeKind={free.placeKind}
        badge={free.badge}
        note={free.note}
        tag={free.tag}
        coverAssetId={null}
        coverVariantWidths={[]}
        coverAlt={free.coverAlt}
        grayscale={free.grayscale}
        eager
      />,
    );
    expect(within(direct.container).getByTestId('event-poster').outerHTML).toBe(html);
  });
});

/**
 * Phase 10.2-14 (D-788, OPEN-10, UI-D-786, T-10.2-06) - the gallery mounts the ONE shared refresh island with
 * the openings of its `Em breve` cards, the server seed and a key carrying the tags; a gallery with no such
 * card mounts none.
 */
describe('EventsSections - the one shared refresh of the openings (10.2-14)', () => {
  const SEED = '2026-10-05T08:47:00.000000Z';
  const soonCard = (id: string, opens: string) =>
    card(id, {
      tag: 'Em breve',
      note: 'x',
      countdown: { kind: 'opening', targetIso: opens, seedIso: SEED, price: null },
    });

  it('mounts the island exactly once, with every Em breve opening, the seed and the tags key', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [],
          others: [
            soonCard('a', '2026-10-05T10:00:00.000000Z'),
            soonCard('b', '2026-10-05T09:00:00.000000Z'),
            card('p', { tag: 'Pago', note: 'x' }),
            card('f'),
          ],
        }}
      />,
    );
    expect(screen.getAllByTestId('gallery-boundary-refresh')).toHaveLength(1);
    const props = island.mounts.at(-1) as Record<string, unknown>;
    expect(props.openings).toEqual(['2026-10-05T10:00:00.000000Z', '2026-10-05T09:00:00.000000Z']);
    expect(props.serverNow).toBe(SEED);
    expect(props.tags).toBe('a:Em breve|b:Em breve|p:Pago');
  });

  it('a gallery with no Em breve card mounts none, and neither does an unreadable first load', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{ mine: [], others: [card('p', { tag: 'Pago', note: 'x' }), card('f')] }}
      />,
    );
    expect(screen.queryByTestId('gallery-boundary-refresh')).toBeNull();
    cleanup();
    render(<EventsSections tenantName={TENANT} initial={null} />);
    expect(screen.queryByTestId('gallery-boundary-refresh')).toBeNull();
  });

  it('a holder card (a count to the event) is not an opening and mounts none', () => {
    render(
      <EventsSections
        tenantName={TENANT}
        initial={{
          mine: [
            card('h', {
              note: 'Faltam 2 dias',
              countdown: {
                kind: 'event',
                targetIso: '2026-10-07T13:00:00.000000Z',
                seedIso: SEED,
                price: null,
              },
            }),
          ],
          others: [],
        }}
      />,
    );
    expect(screen.queryByTestId('gallery-boundary-refresh')).toBeNull();
  });
});
