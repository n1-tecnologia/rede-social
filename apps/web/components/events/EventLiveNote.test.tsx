// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.2-14 (OPEN-07, OPEN-20, D-785, D-786, D-790) - the host island that draws a card, hero or
 * `Meus eventos` note live from its descriptor. The catalog is the REAL merged pt-BR catalog through the
 * real next-intl translator. Real: the island, `LiveCountdown` and `useCountdownClock`. Stubbed: the router.
 *
 * Claims:
 *  1. with no descriptor the island draws the static finished note and arms no timer;
 *  2. with a descriptor it draws the live count in the server view's own words (price first on the
 *     opening, `Faltam ...` for a holder) and arms ONE timer per mounted note;
 *  3. the poster is inside a link, so its count is plain text; the hero and `Meus eventos` are a timer;
 *  4. the hero joins the count and the static `when` part, and a holder's count hands over to the live word;
 *  5. with no seed the island keeps the static note (never a count from the device clock).
 */

const refresh = vi.fn();
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

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { EventLiveNote } = await import('./EventLiveNote');

type Props = React.ComponentProps<typeof EventLiveNote>;

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const at = (ms: number) => new Date(SEED_MS + ms).toISOString();

function note(props: Partial<Props> & Pick<Props, 'note'>) {
  return render(<EventLiveNote {...({ surface: 'poster', ...props } as Props)} />);
}

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(SEED_MS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EventLiveNote (10.2-14)', () => {
  it('1. no descriptor: the static finished note, no timer', () => {
    const { container } = note({ note: 'R$ 80,00 · Últimas 3 vagas' });
    expect(container.textContent).toBe('R$ 80,00 · Últimas 3 vagas');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('2. the opening on a card: the price first and the live short count (the tracer)', () => {
    note({
      note: 'R$ 80,00 · Abre em 2 d 4 h 13 min',
      countdown: {
        kind: 'opening',
        targetIso: at(2 * DAY + 4 * HOUR + 13 * MIN),
        seedIso: SEED,
        price: 'R$ 80,00',
      },
    });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe(
      'R$ 80,00 · Abre em 2 d 4 h 13 min',
    );
  });

  it('3. one mounted note arms ONE timer, and the count follows the minute change', () => {
    note({
      note: 'x',
      countdown: { kind: 'opening', targetIso: at(2 * HOUR), seedIso: SEED, price: null },
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Abre em 2 h');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Abre em 1 h 59 min');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('4. the poster count is plain text inside the card link, a timer on the hero and Meus eventos', () => {
    const countdown = { kind: 'event' as const, targetIso: at(12 * DAY), seedIso: SEED };
    note({ note: 'x', countdown, surface: 'poster' });
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
    cleanup();
    note({ note: 'x', countdown: { ...countdown, when: 'seg., 12 de out.' }, surface: 'hero' });
    expect(screen.getAllByRole('timer')).toHaveLength(1);
    cleanup();
    note({ note: 'x', countdown, surface: 'reine' });
    expect(screen.getAllByRole('timer')).toHaveLength(1);
  });

  it('5. the hero joins the count and the static right part; the holder hand-off is the live word', () => {
    const countdown = {
      kind: 'event' as const,
      targetIso: at(12 * DAY + 4 * HOUR + 13 * MIN),
      seedIso: SEED,
      when: 'seg., 12 de out.',
    };
    note({ note: 'x', countdown, surface: 'hero' });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe(
      'Faltam 12 d 4 h 13 min · seg., 12 de out.',
    );
    cleanup();
    note({
      note: 'x',
      countdown: { kind: 'event', targetIso: at(0), seedIso: SEED, when: 'seg., 12 de out.' },
      surface: 'hero',
    });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Acontecendo agora');
  });

  it('6. the Meus eventos note speaks its own scope', () => {
    note({
      note: 'x',
      countdown: { kind: 'event', targetIso: at(12 * DAY + 4 * HOUR + 13 * MIN), seedIso: SEED },
      surface: 'reine',
    });
    expect(screen.getByTestId('live-countdown-text').textContent).toBe('Faltam 12 d 4 h 13 min');
  });

  it('7. no seed keeps the static note and arms nothing; the device clock never decides', () => {
    vi.setSystemTime(SEED_MS + 400 * DAY);
    const { container } = note({
      note: 'R$ 80,00 · Abre em 2 d',
      countdown: {
        kind: 'opening',
        targetIso: at(2 * DAY),
        seedIso: null as unknown as string,
        price: 'R$ 80,00',
      },
    });
    expect(container.textContent).toBe('R$ 80,00 · Abre em 2 d');
    expect(vi.getTimerCount()).toBe(0);
  });
});
