// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventPosterView } from '@/lib/events-view';

/**
 * 06-01 — the `/eventos` list body under its two periods (UI-D-200, UI-D-216, UI E03).
 *
 * The catalog is the REAL `events.json`, so an assertion here fails when the pt-BR copy drifts. The
 * two server actions are stubbed (a render never calls them). Four claims:
 *  1. posters render from FINISHED views, in the server's order, as one link each;
 *  2. an empty Próximos names the tenant, an empty Passados has its own copy and no action;
 *  3. an unreadable first page renders the generic error card with a retry;
 *  4. the region says which period and which tenant it is.
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

vi.mock('./actions', () => ({
  loadMoreEventsAction: vi.fn(),
  refreshEventsAction: vi.fn(),
}));

const { EventsList } = await import('./EventsList');

afterEach(cleanup);

const TENANT = 'Tenant Demo';

function view(overrides: Partial<EventPosterView> = {}): EventPosterView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    href: '/eventos/11111111-1111-4111-8111-111111111111',
    title: 'Encontro',
    overline: 'seg., 12 de out. · 19:00',
    overlineLive: false,
    place: 'Sede',
    placeKind: 'venue',
    pill: { kind: 'relative', label: 'Hoje' },
    ariaLabel: 'Encontro, seg., 12 de out. · 19:00',
    // Cover-less, so no media request is involved.
    coverAssetId: null,
    coverVariantWidths: [],
    coverAlt: 'Capa do evento Encontro',
    grayscale: false,
    ...overrides,
  };
}

describe('EventsList', () => {
  it('1. renders one poster link per view, in the order given', () => {
    render(
      <EventsList
        period="upcoming"
        tenantName={TENANT}
        initialCursor={null}
        initialItems={[
          view(),
          view({
            id: '22222222-2222-4222-8222-222222222222',
            href: '/eventos/22222222-2222-4222-8222-222222222222',
            title: 'Segundo',
            ariaLabel: 'Segundo, amanhã',
          }),
        ]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Encontro, seg., 12 de out. · 19:00',
      'Segundo, amanhã',
    ]);
    expect(screen.getByRole('region', { name: `Próximos eventos de ${TENANT}` })).toBeTruthy();
  });

  it('2. an empty Próximos names the tenant; an empty Passados has its own copy and no action', () => {
    render(
      <EventsList period="upcoming" tenantName={TENANT} initialCursor={null} initialItems={[]} />,
    );
    expect(screen.getByText(lookup('empty.upcoming.title'))).toBeTruthy();
    expect(screen.getByText(`Os próximos eventos de ${TENANT} vão aparecer aqui.`)).toBeTruthy();
    cleanup();

    render(<EventsList period="past" tenantName={TENANT} initialCursor={null} initialItems={[]} />);
    expect(screen.getByText(lookup('empty.past.title'))).toBeTruthy();
    expect(screen.getByText(lookup('empty.past.body'))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('region', { name: `Eventos passados de ${TENANT}` })).toBeTruthy();
  });

  it('3. an unreadable first page renders the generic error card with a retry', () => {
    render(
      <EventsList
        period="upcoming"
        tenantName={TENANT}
        initialCursor={null}
        initialItems={[]}
        initialError
      />,
    );
    expect(screen.getByText(lookup('errors.title'))).toBeTruthy();
    expect(screen.getByRole('button', { name: lookup('errors.retry') })).toBeTruthy();
  });
});
