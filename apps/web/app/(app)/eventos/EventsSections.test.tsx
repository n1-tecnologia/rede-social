// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventCardView } from '@/lib/events-view';

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

const { catalog } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return { catalog: read('events').events as Record<string, unknown> };
});

MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => lookup(key, values),
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ refreshEventSectionsAction: refresh }));

const { EventsSections } = await import('./EventsSections');

afterEach(() => {
  cleanup();
  refresh.mockReset();
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
