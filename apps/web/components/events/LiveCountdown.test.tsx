// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.2-13 (OPEN-08, OPEN-10, OPEN-21, D-785, D-786, D-787, D-788, UI-D-785, UI-D-787) - the live
 * count. The catalog is the REAL merged pt-BR catalog through the real next-intl translator, so an ICU
 * plural that stops parsing or a key that goes missing fails here. Real: the component, the formatter
 * and `useCountdownClock`. Stubbed: the router. Fake timers drive the minute changes.
 *
 * Claims:
 *  1. the `blocks` variant draws one cell per NON-ZERO unit (`02 dias`, `04 horas`, `13 min`), a zero
 *     interior unit is absent, the last minute is ONE `Menos de 1 min` cell and zero is ONE
 *     `Abrindo agora` cell, a day count above 99 grows and is never capped;
 *  2. the cells show whole minutes floored (13 min 40 s is `13 min`), never seconds;
 *  3. the first client render is the server string whatever the device clock says;
 *  4. with no seed the component draws no count and arms no timer;
 *  5. the `text` variant is the card, hero and `Meus eventos` count, in the server view's own words.
 */

const refresh = vi.fn();
// A STABLE router, as Next's is: a new object per render would rebuild the server clock every render.
const router = { refresh };
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

// The device clock is read in exactly one place (`serverClock`); counting `now()` proves the value
// never comes from it when there is no seed.
const clockReads = vi.hoisted(() => ({ now: 0 }));
vi.mock('./serverClock', async (orig) => {
  const real = await orig<typeof import('./serverClock')>();
  return {
    ...real,
    serverClock: (seedIso?: string | null) => {
      const clock = real.serverClock(seedIso);
      return {
        ...clock,
        now: () => {
          clockReads.now += 1;
          return clock.now();
        },
      };
    },
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { LiveCountdown } = await import('./LiveCountdown');

type Props = React.ComponentProps<typeof LiveCountdown>;

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The opening `ms` after the seed, as an ISO string. */
const opening = (ms: number) => new Date(SEED_MS + ms).toISOString();

function count(ms: number, overrides: Partial<Props> = {}) {
  const props: Props = {
    targetIso: opening(ms),
    seedIso: SEED,
    kind: 'opening',
    variant: 'blocks',
    ...overrides,
  };
  return render(<LiveCountdown {...props} />);
}

/** The visible cells as `[number, label]` rows (the label alone for a single full-width cell). */
function cells(): string[] {
  return screen.queryAllByTestId('live-countdown-cell').map(
    (cell) =>
      Array.from(cell.querySelectorAll('span'))
        .map((s) => s.textContent)
        .join(' ') ||
      cell.textContent ||
      '',
  );
}

beforeEach(() => {
  refresh.mockReset();
  clockReads.now = 0;
  vi.useFakeTimers();
  vi.setSystemTime(SEED_MS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LiveCountdown blocks, the tracer: a seeded count in three cells (OPEN-08, D-785)', () => {
  it('draws 02 dias, 04 horas and 13 min for 2 days 4 hours 13 minutes, aria-hidden, with the hidden timer', () => {
    count(2 * DAY + 4 * HOUR + 13 * MIN);
    expect(cells()).toEqual(['02 dias', '04 horas', '13 min']);
    expect(screen.getByTestId('live-countdown-cells').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('live-countdown-timer').textContent).toBe(
      'Tempo restante para a abertura: 2 dias, 4 horas e 13 minutos.',
    );
  });

  it('draws the cells as flex-1 tertiary blocks with a 24px tabular number and a 12px label', () => {
    count(2 * DAY + 4 * HOUR + 13 * MIN);
    const first = screen.getAllByTestId('live-countdown-cell')[0] as HTMLElement;
    expect(first.className).toContain('flex-1');
    expect(first.className).toContain('bg-bg-tertiary');
    expect(first.className).toContain('rounded-xl');
    expect(first.querySelectorAll('span')[0]?.className).toContain('tabular-nums');
    expect(first.querySelectorAll('span')[0]?.className).toContain('text-2xl');
    expect(first.querySelectorAll('span')[1]?.className).toContain('text-xs');
  });

  it('drops a zero interior unit: 1 day 0 hours 5 minutes is exactly two cells (01 dia, 05 min)', () => {
    count(DAY + 5 * MIN);
    expect(cells()).toEqual(['01 dia', '05 min']);
    expect(screen.getAllByTestId('live-countdown-cell')).toHaveLength(2);
  });

  it('is a single timer element, outside any cell', () => {
    count(2 * HOUR);
    const timers = screen.getAllByRole('timer');
    expect(timers).toHaveLength(1);
    expect(timers[0]?.closest('[aria-hidden="true"]')).toBeNull();
    expect(timers[0]?.className).toContain('sr-only');
  });
});

describe('LiveCountdown blocks, the populated variants and the plurals (UI-D-785)', () => {
  it('hours and minutes only, minutes only', () => {
    count(23 * HOUR + 40 * MIN);
    expect(cells()).toEqual(['23 horas', '40 min']);
    cleanup();
    count(40 * MIN);
    expect(cells()).toEqual(['40 min']);
  });

  it('1 dia / 2 dias and 1 hora / 2 horas by ICU plural', () => {
    count(DAY + HOUR);
    expect(cells()).toEqual(['01 dia', '01 hora']);
    cleanup();
    count(2 * DAY + 2 * HOUR);
    expect(cells()).toEqual(['02 dias', '02 horas']);
  });
});

describe('LiveCountdown blocks, the boundaries one step either side (EP-17)', () => {
  const rows: Array<[string, number, string[]]> = [
    ['one day', DAY, ['01 dia']],
    ['one minute under a day', DAY - MIN, ['23 horas', '59 min']],
    ['23 hours 59 minutes', 23 * HOUR + 59 * MIN, ['23 horas', '59 min']],
    ['one minute', MIN, ['01 min']],
    ['one millisecond under one minute', MIN - 1, ['Menos de 1 min']],
    ['59 999 ms', 59_999, ['Menos de 1 min']],
    ['one millisecond', 1, ['Menos de 1 min']],
    ['zero', 0, ['Abrindo agora']],
    ['below zero', -5_000, ['Abrindo agora']],
    ['99 days', 99 * DAY, ['99 dias']],
    ['100 days', 100 * DAY, ['100 dias']],
    ['365 days', 365 * DAY, ['365 dias']],
  ];
  it.each(rows)('%s', (_label, ms, expected) => {
    count(ms);
    expect(cells()).toEqual(expected);
  });

  it('the single wide cells carry no number and no label under them', () => {
    count(30_000);
    const only = screen.getAllByTestId('live-countdown-cell');
    expect(only).toHaveLength(1);
    expect(only[0]?.querySelectorAll('span')).toHaveLength(0);
    expect(only[0]?.className).toContain('font-bold');
    expect(only[0]?.className).toContain('flex-1');
  });

  it('a day count above 99 grows and is never capped', () => {
    count(1234 * DAY);
    expect(screen.getAllByTestId('live-countdown-cell')[0]?.textContent).toBe('1234dias');
  });
});

describe('LiveCountdown blocks, precision: whole minutes, floored (EP-18)', () => {
  it('13 minutes 40 seconds reads 13 min, never seconds', () => {
    count(13 * MIN + 40_000);
    expect(cells()).toEqual(['13 min']);
    expect(screen.getByTestId('live-countdown-cells').textContent).not.toMatch(/40|seg/);
  });
});

describe('LiveCountdown, hydration (D-788)', () => {
  it('the first client render is the server string, whatever the device clock says', () => {
    const props: Props = {
      targetIso: opening(2 * DAY + 4 * HOUR + 13 * MIN),
      seedIso: SEED,
      kind: 'opening',
      variant: 'blocks',
    };
    const server = renderToString(<LiveCountdown {...props} />);
    // The device clock is a day fast: the first client render must not move.
    vi.setSystemTime(SEED_MS + DAY);
    const { container } = render(<LiveCountdown {...props} />);
    const text = (html: string) => html.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|');
    expect(text(container.innerHTML)).toBe(text(server));
    expect(cells()).toEqual(['02 dias', '04 horas', '13 min']);
  });

  it('follows the minute change with one timer and no interval', () => {
    count(2 * MIN + 5_000);
    expect(cells()).toEqual(['02 min']);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(cells()).toEqual(['01 min']);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('LiveCountdown, no seed (OPEN-21, D-788)', () => {
  it('draws no count and arms no timer', () => {
    const { container } = count(2 * DAY, { seedIso: null });
    expect(container.innerHTML).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a text count with no seed draws the static fallback and nothing else', () => {
    const { container } = count(2 * DAY, {
      seedIso: null,
      variant: 'text',
      fallback: 'Abertura: 20 nov, 10:00',
    });
    expect(container.textContent).toBe('Abertura: 20 nov, 10:00');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('LiveCountdown text, the surfaces draw the server view words (UI-D-782, UI-D-788)', () => {
  const at = 2 * DAY + 4 * HOUR + 13 * MIN;

  it('the poster note: Abre em 2 d 4 h 13 min, with the price first', () => {
    count(at, { variant: 'text', surface: 'poster' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Abre em 2 d 4 h 13 min');
    cleanup();
    count(at, { variant: 'text', surface: 'poster', price: 'R$ 80,00' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe(
      'R$ 80,00 · Abre em 2 d 4 h 13 min',
    );
  });

  it('the last minute and zero of the opening', () => {
    count(30_000, { variant: 'text' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Abre em menos de 1 min');
    cleanup();
    count(0, { variant: 'text' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Abrindo agora');
  });

  it('the holder count to the event: Faltam, the singular Falta, the last minute, the live word', () => {
    count(12 * DAY + 4 * HOUR + 13 * MIN, { variant: 'text', kind: 'event', surface: 'reine' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Faltam 12 d 4 h 13 min');
    cleanup();
    count(HOUR, { variant: 'text', kind: 'event', surface: 'reine' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Falta 1 h');
    cleanup();
    count(20_000, { variant: 'text', kind: 'event', surface: 'poster' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Falta menos de 1 min');
    cleanup();
    count(0, { variant: 'text', kind: 'event', surface: 'poster' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Acontecendo agora');
  });

  it('the hero overline joins the count and the finished right part', () => {
    count(12 * DAY + 4 * HOUR + 13 * MIN, {
      variant: 'text',
      kind: 'event',
      surface: 'hero',
      when: 'seg., 12 de out.',
    });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe(
      'Faltam 12 d 4 h 13 min · seg., 12 de out.',
    );
  });

  it('announce timer wraps the text in role=timer, none leaves it plain', () => {
    count(at, { variant: 'text', announce: 'timer' });
    expect(screen.getAllByRole('timer')).toHaveLength(1);
    cleanup();
    count(at, { variant: 'text', announce: 'none' });
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
  });
});

describe('LiveCountdown, accessibility and silence (UI-D-787, OPEN-21)', () => {
  it('the role=timer element exists exactly once per blocks instance, is visually hidden and has no aria-live ancestor', () => {
    const { container } = count(2 * DAY + 4 * HOUR + 13 * MIN);
    const timers = screen.getAllByRole('timer');
    expect(timers).toHaveLength(1);
    expect(timers[0]?.className).toContain('sr-only');
    expect(timers[0]?.closest('[aria-live]')).toBeNull();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
    expect(timers[0]?.textContent).toBe(
      'Tempo restante para a abertura: 2 dias, 4 horas e 13 minutos.',
    );
  });

  it('the visible cells are aria-hidden and sit inside no live region', () => {
    const { container } = count(2 * DAY);
    const wrap = screen.getByTestId('live-countdown-cells');
    expect(wrap.getAttribute('aria-hidden')).toBe('true');
    expect(wrap.closest('[aria-live]')).toBeNull();
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  it('the spoken value changes silently with each advanced minute, in no live region', () => {
    count(3 * MIN + 30_000);
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toBe('Tempo restante para a abertura: 3 minutos.');
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(timer.textContent).toBe('Tempo restante para a abertura: 2 minutos.');
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(timer.textContent).toBe('Tempo restante para a abertura: 1 minuto.');
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(timer.textContent).toBe('Tempo restante para a abertura: menos de 1 minuto.');
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(timer.textContent).toBe('Abrindo agora');
    expect(timer.closest('[aria-live]')).toBeNull();
  });

  it('draws no animation and no transition: the digits change in place', () => {
    const { container } = count(2 * DAY + 4 * HOUR + 13 * MIN);
    const classes = Array.from(container.querySelectorAll('*'))
      .map((node) => node.getAttribute('class') ?? '')
      .join(' ');
    expect(classes).not.toMatch(/animate-|transition|duration-|motion-|ease-|pulse|spin|flip/);
    // No seconds counter exists: the text never shows a seconds unit.
    expect(container.textContent).not.toMatch(/\bseg|\bs\b/);
  });

  it('moves no focus on a tick, a threshold or zero', () => {
    const { baseElement } = render(
      <>
        <button type="button" data-testid="anchor">
          x
        </button>
        <LiveCountdown
          targetIso={opening(2 * MIN + 5_000)}
          seedIso={SEED}
          kind="opening"
          variant="blocks"
        />
      </>,
    );
    const anchor = screen.getByTestId('anchor') as HTMLButtonElement;
    anchor.focus();
    expect(baseElement.ownerDocument.activeElement).toBe(anchor);
    for (let step = 0; step < 4; step += 1) {
      act(() => {
        vi.advanceTimersByTime(MIN);
      });
      expect(baseElement.ownerDocument.activeElement).toBe(anchor);
    }
    expect(cells()).toEqual(['Abrindo agora']);
  });
});

describe('LiveCountdown, the device clock never decides the value (OPEN-21, D-788, T-10.2-01)', () => {
  it('with no seed the clock is never asked for the value, no timer is armed and nothing is drawn', () => {
    const { container } = count(2 * DAY, { seedIso: null });
    expect(clockReads.now).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(container.innerHTML).toBe('');
    // Even a device in 2099 draws nothing: there is no fallback to it.
    cleanup();
    vi.setSystemTime(Date.parse('2099-01-01T00:00:00.000Z'));
    const far = count(2 * DAY, { seedIso: null });
    expect(clockReads.now).toBe(0);
    expect(far.container.innerHTML).toBe('');
  });

  it('with a seed the displayed count is the same with the device clock a day fast, a day slow and in 2099', () => {
    for (const device of [SEED_MS + DAY, SEED_MS - DAY, Date.parse('2099-01-01T00:00:00.000Z')]) {
      vi.setSystemTime(device);
      count(2 * DAY + 4 * HOUR + 13 * MIN);
      expect(cells()).toEqual(['02 dias', '04 horas', '13 min']);
      cleanup();
    }
  });
});
