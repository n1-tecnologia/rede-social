// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventSoonView } from '@/lib/events-view';

/**
 * Phase 10.2-13 (OPEN-08, OPEN-10, D-785, D-786, UI-D-784; sketch 022 `zona-em-breve-*`) - the `Em breve`
 * zone of a paid event before its registration opening. The catalog is the REAL merged pt-BR catalog
 * through the real next-intl translator. Real: `SoonZone`, `LiveCountdown`, `useCountdownClock`.
 * Stubbed: the router.
 *
 * Claims:
 *  1. top to bottom: the heading, the seeded cells, the exact opening, the zone line, the price (only
 *     when the admin filled it), the hint, and for an online event the Lock hint;
 *  2. there is NO button, NO anchor and NO href anywhere in the zone, and no brand fill, so nothing can
 *     reveal a link before the server returns it (D-789);
 *  3. the zone line wraps (`break-words`, no truncation) however long the tenant's zone name is.
 */

const router = { refresh: vi.fn() };
const { translate } = await vi.hoisted(async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  const real = createTranslator({
    locale: 'pt-BR',
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    namespace: 'events' as never,
  }) as unknown as (key: string, values?: Record<string, unknown>) => string;
  return { translate: real };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { SoonZone } = await import('./SoonZone');

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function soonView(remainingMs: number, overrides: Partial<EventSoonView> = {}): EventSoonView {
  return {
    opensAt: new Date(SEED_MS + remainingMs).toISOString(),
    serverNow: SEED,
    dateLabel: '20 nov',
    timeLabel: '10:00',
    zoneLabel: 'Horário de Brasília',
    price: 'R$ 80,00',
    ...overrides,
  };
}

function zone(
  remainingMs: number,
  overrides: Partial<EventSoonView> = {},
  format: 'in_person' | 'online' = 'in_person',
) {
  return render(<SoonZone soon={soonView(remainingMs, overrides)} phase="P0" format={format} />);
}

const cellTexts = () =>
  screen.queryAllByTestId('live-countdown-cell').map(
    (cell) =>
      Array.from(cell.querySelectorAll('span'))
        .map((s) => s.textContent)
        .join(' ') || cell.textContent,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SEED_MS);
  router.refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SoonZone, the tracer: the seeded zone with three cells, the exact opening and nothing to click (OPEN-08, D-786)', () => {
  it('draws the heading, 02 dias, 04 horas, 13 min, the opening, the zone, the price and the hint', () => {
    zone(2 * DAY + 4 * HOUR + 13 * MIN);
    expect(screen.getByRole('heading', { name: 'As inscrições abrem em' })).toBeTruthy();
    expect(cellTexts()).toEqual(['02 dias', '04 horas', '13 min']);
    expect(screen.getByTestId('event-soon-opens-at').textContent).toBe('Abertura: 20 nov, 10:00');
    expect(screen.getByTestId('event-soon-zone-label').textContent).toBe(
      'Fuso horário: Horário de Brasília',
    );
    expect(screen.getByTestId('event-soon-price').textContent).toBe('Ingresso: R$ 80,00');
    expect(screen.getByTestId('event-soon-hint').textContent).toBe(
      'Quando abrir, o botão Comprar ingresso aparece aqui sozinho.',
    );
    // The shipped zone shell.
    const shell = screen.getByTestId('event-actions');
    expect(shell.className).toContain('flex-col');
    expect(shell.getAttribute('data-phase')).toBe('P0');
    expect(within(shell).getByTestId('event-soon-zone')).toBeTruthy();
  });

  it('has NO button, NO anchor and NO href anywhere, and no brand fill', () => {
    const { container } = zone(2 * DAY + 4 * HOUR + 13 * MIN);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('[href]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="button"], [role="link"]')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const fills = Array.from(container.querySelectorAll('*')).filter((node) =>
      /(^|\s)bg-(button|brand)(\s|$)/.test(node.getAttribute('class') ?? ''),
    );
    expect(fills).toHaveLength(0);
    // No sale word before the opening.
    const hint = 'Quando abrir, o botão Comprar ingresso aparece aqui sozinho.';
    expect((container.textContent ?? '').replace(hint, '')).not.toContain('Comprar ingresso');
    expect(screen.queryByText('Esgotado')).toBeNull();
    expect(screen.queryByText('Vendas encerradas')).toBeNull();
  });

  it('has no skeleton and no loading state of its own', () => {
    const { container } = zone(2 * DAY);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
    expect(container.querySelector('[class*="skeleton"]')).toBeNull();
  });

  it('draws the price row only when the admin filled it', () => {
    zone(2 * DAY, { price: null });
    expect(screen.queryByTestId('event-soon-price')).toBeNull();
    expect(screen.queryByText(/Ingresso:/)).toBeNull();
    // The rest of the zone is unchanged.
    expect(screen.getByTestId('event-soon-opens-at')).toBeTruthy();
    expect(screen.getByTestId('event-soon-hint')).toBeTruthy();
  });

  it('an online event ends with the Lock hint and never an Entrar button', () => {
    const { container } = zone(2 * DAY, {}, 'online');
    const hint = screen.getByTestId('event-actions-online-hint');
    expect(hint.textContent).toBe('O link da transmissão é só para quem tem ingresso.');
    expect(hint.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.queryByTestId('event-actions-enter')).toBeNull();
    // Last child of the zone content.
    const content = screen.getByTestId('event-soon-zone');
    expect(content.lastElementChild).toBe(hint);
  });

  it('an in-person event has no transmission hint', () => {
    zone(2 * DAY);
    expect(screen.queryByTestId('event-actions-online-hint')).toBeNull();
  });

  it('1 day 0 hours 5 minutes draws exactly two cells (the interior zero is absent)', () => {
    zone(DAY + 5 * MIN);
    expect(cellTexts()).toEqual(['01 dia', '05 min']);
    expect(screen.getAllByTestId('live-countdown-cell')).toHaveLength(2);
  });
});

describe('SoonZone, the states of the count', () => {
  it('under a minute is one Menos de 1 min cell, zero is one Abrindo agora cell, and still no control', () => {
    const { container } = zone(30_000);
    expect(cellTexts()).toEqual(['Menos de 1 min']);
    cleanup();
    const zero = zone(0);
    expect(cellTexts()).toEqual(['Abrindo agora']);
    expect(zero.container.querySelectorAll('a, button, [href]')).toHaveLength(0);
    // The tag text and the opening line do not change at zero.
    expect(screen.getByTestId('event-soon-opens-at').textContent).toBe('Abertura: 20 nov, 10:00');
    expect(container).toBeTruthy();
  });
});

describe('SoonZone, the long zone name wraps and nothing is clipped (A-UI-8, EP backstop)', () => {
  const LONG =
    'Horário Padrão da Austrália Central Ocidental, com horário de verão do hemisfério sul e mais um trecho longo para forçar três linhas';

  it('the zone line carries the whole long name, wraps and has no truncation class', () => {
    zone(2 * DAY, { zoneLabel: LONG });
    const line = screen.getByTestId('event-soon-zone-label');
    expect(line.textContent).toBe(`Fuso horário: ${LONG}`);
    expect(line.className).toContain('break-words');
    expect(line.className).toContain('text-xs');
    expect(line.className).not.toMatch(
      /truncate|line-clamp|overflow-hidden|text-ellipsis|whitespace-nowrap/,
    );
  });

  it('every text row of the zone wraps instead of clipping', () => {
    const { container } = zone(2 * DAY, { zoneLabel: LONG });
    const rows = container.querySelectorAll('p');
    for (const row of Array.from(rows)) {
      expect(row.className).not.toMatch(
        /truncate|line-clamp|overflow-hidden|text-ellipsis|whitespace-nowrap/,
      );
    }
  });

  it('an untrusted zone name is a React text node, never markup', () => {
    zone(2 * DAY, { zoneLabel: '<img src=x onerror=alert(1)><b>x</b>' });
    expect(screen.getByTestId('event-soon-zone-label').textContent).toBe(
      'Fuso horário: <img src=x onerror=alert(1)><b>x</b>',
    );
    expect(screen.getByTestId('event-soon-zone-label').querySelector('img, b')).toBeNull();
  });

  it('the cells carry no animation or transition class', () => {
    const { container } = zone(2 * DAY);
    expect(container.innerHTML).not.toMatch(/animate-|transition|duration-/);
  });
});
