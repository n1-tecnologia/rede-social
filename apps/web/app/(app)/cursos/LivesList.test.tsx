// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type LiveRowInput, liveRowView } from '@/lib/courses-view';

/**
 * 2026-10-23 — the admin's Lives body (`LivesList` over `AdminLiveCard`), against the REAL pt-BR
 * catalog and the real row views (`liveRowView`): "Próximas" is the spotlight then the agenda rows,
 * "Passadas" the tile grid; every card keeps the row's link and name, and its "Editar" door is a
 * SIBLING link (never an `<a>` inside an `<a>`). The server actions are stubs; `PullToRefresh` is a
 * plain wrapper (happy-dom has no touch pull). No next page here, so the sentinel never mounts.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('./actions', () => ({
  loadMoreLivesAction: vi.fn(),
  refreshLivesAction: vi.fn(),
}));

vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    PullToRefresh: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { LivesList } = await import('./LivesList');

const t = createTranslator({ locale: 'pt-BR', messages });
const ZONE = 'America/Sao_Paulo';

function row(id: string, title: string, status: LiveRowInput['status'], startsAt: string) {
  return liveRowView(
    { id, title, coverAssetId: null, startsAt, durationMin: 60, status },
    { timezone: ZONE },
    t,
  );
}

const ON_AIR = row(
  '11111111-1111-4111-8111-111111111111',
  'Plantão de dúvidas',
  'live',
  '2026-10-23T22:00:00.000Z',
);
const NEXT = row(
  '22222222-2222-4222-8222-222222222222',
  'Aula de revisão',
  'scheduled',
  '2026-10-24T22:00:00.000Z',
);
const LATER = row(
  '33333333-3333-4333-8333-333333333333',
  'Mentoria aberta',
  'cancelled',
  '2026-10-30T13:00:00.000Z',
);
const PAST = row(
  '44444444-4444-4444-8444-444444444444',
  'Abertura do semestre',
  'recorded',
  '2026-10-01T22:00:00.000Z',
);

afterEach(cleanup);

describe('LivesList — the admin Lives body (2026-10-23)', () => {
  it('Próximas: the first live is the spotlight, the rest agenda rows; each card keeps its link and name and has a sibling "Editar"', () => {
    render(
      <LivesList
        filter="upcoming"
        tenantName="Escola Demo"
        initialItems={[ON_AIR, NEXT, LATER]}
        initialCursor={null}
      />,
    );
    const list = screen.getByRole('list', { name: 'Lives de Escola Demo' });
    expect(list.getAttribute('data-testid')).toBe('lives-list');
    expect(list.getAttribute('data-layout')).toBe('agenda');

    const cards = within(list).getAllByTestId('live-card');
    expect(cards.map((card) => card.getAttribute('data-variant'))).toEqual([
      'spotlight',
      'agenda',
      'agenda',
    ]);

    // The card is the row's link, named "{title}, {status}", to the live's form.
    const spotlight = screen.getByRole('link', { name: 'Plantão de dúvidas, Ao vivo' });
    expect(spotlight).toBe(cards[0]);
    expect(spotlight.getAttribute('href')).toBe(`/cursos/lives/${ON_AIR.id}`);
    const onAir = within(spotlight).getByTestId('live-card-status');
    expect(onAir.textContent).toBe('Ao vivo');
    expect(onAir.getAttribute('data-icon')).toBe('live');
    expect(within(spotlight).getByTestId('live-card-meta').textContent).toBe(ON_AIR.meta);

    // The agenda row: the date column, the status in words, the time line.
    const agenda = screen.getByRole('link', { name: 'Aula de revisão, Agendada' });
    expect(within(agenda).getByTestId('live-card-date').textContent).toBe('24out');
    expect(within(agenda).getByTestId('live-card-status').textContent).toBe('Agendada');
    expect(within(agenda).getByTestId('live-card-meta').textContent).toBe('19:00 · 60 min');
    const cancelled = screen.getByRole('link', { name: 'Mentoria aberta, Cancelada' });
    expect(cancelled.getAttribute('data-cancelled')).toBe('true');

    // One "Editar" door per live, named for it, to the same form; never nested in the card.
    const doors = screen.getAllByTestId('live-edit');
    expect(doors).toHaveLength(3);
    for (const item of [ON_AIR, NEXT, LATER]) {
      const door = screen.getByRole('link', { name: `Editar a live: ${item.title}` });
      expect(door.getAttribute('href')).toBe(`/cursos/lives/${item.id}`);
      expect(door.textContent).toBe('Editar');
    }
    expect(document.querySelectorAll('a a')).toHaveLength(0);
  });

  it('Passadas: the tile grid; the recorded chip is plain words; the door sits beside each tile', () => {
    render(
      <LivesList
        filter="past"
        tenantName="Escola Demo"
        initialItems={[PAST]}
        initialCursor={null}
      />,
    );
    const list = screen.getByTestId('lives-list');
    expect(list.getAttribute('data-layout')).toBe('grid');
    expect(list.className).toContain('grid-cols-2');
    expect(list.className).toContain('sm:grid-cols-3');

    const tile = screen.getByRole('link', { name: 'Abertura do semestre, Gravada' });
    expect(tile.getAttribute('data-variant')).toBe('tile');
    expect(within(tile).getByTestId('live-card-fallback')).toBeTruthy();
    const chip = within(tile).getByTestId('live-card-status');
    expect(chip.textContent).toBe('Gravada');
    expect(chip.getAttribute('data-icon')).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Editar a live: Abertura do semestre' })
        .getAttribute('href'),
    ).toBe(`/cursos/lives/${PAST.id}`);
    expect(document.querySelectorAll('a a')).toHaveLength(0);
  });

  it('the empty and error states are unchanged: "Agendar live" only on Próximas, the retry card on a failed first page', () => {
    render(
      <LivesList
        filter="upcoming"
        tenantName="Escola Demo"
        initialItems={[]}
        initialCursor={null}
      />,
    );
    const empty = screen.getByTestId('lives-empty');
    expect(within(empty).getByRole('link', { name: 'Agendar live' }).getAttribute('href')).toBe(
      '/cursos/lives/nova',
    );
    cleanup();

    render(
      <LivesList filter="past" tenantName="Escola Demo" initialItems={[]} initialCursor={null} />,
    );
    expect(within(screen.getByTestId('lives-empty-past')).queryByRole('link')).toBeNull();
    cleanup();

    render(
      <LivesList
        filter="upcoming"
        tenantName="Escola Demo"
        initialItems={[]}
        initialCursor={null}
        initialError
      />,
    );
    expect(within(screen.getByTestId('lives-error')).getByRole('button')).toBeTruthy();
  });
});
