// @vitest-environment happy-dom
import { type BroadcastMessage, RealtimeProvider } from '@rede-social/core/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventActionState } from '@/lib/events-view';

/**
 * The action zone in the REINE prototype's shape (2026-10-06; 06-03, 06-05, 06-06 before it). The
 * catalog is the REAL `events.json`, so a copy drift fails here. Stubbed: the server action, the
 * router and the toast. Real: the island and `@rede-social/ui`'s `Button`.
 *
 * Claims:
 *  1. every row of the zone's table: "Garantir minha vaga" while not going; for a Vou in person,
 *     "Ver meu check-in" (with the window hint in P0) and the quiet "Cancelar inscrição"; the
 *     read-only line once answers close; "Ver meu check-in" once present; "Ver meu certificado"
 *     after an event with a certificate; a cancelled event's CTA disabled; at most one gold fill;
 *  2. a tap answers optimistically, calls the action once and on success refreshes with NO toast;
 *  3. a failure reverts and toasts; `rsvp_closed`, `cancelled` and `event_full` toast their own lines
 *     and refresh; a full event offers "Vagas esgotadas", disabled, with its quiet line;
 *  4. the zone writes only on a tap;
 *  5. the boundary refresh: one timer at the next boundary within 24 h, none beyond, cleared on
 *     unmount; a refresh that brings the SAME phase back is retried, a phase change stops the chain;
 *  6. the in-person check-in link (06-05): a link only, never an action;
 *  7. (06-06) the online rows, for every phase, and the whole table: every `Entrar` a plain `<a>`
 *     with `target="_blank"`, `rel` with `noopener` and `data-no-prefetch`, no meeting URL anywhere
 *     (D-207), at most one gold fill.
 */

const { catalog, toast, refresh, rsvp } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('events').events as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    refresh: vi.fn(),
    rsvp: vi.fn(),
  };
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('../actions', () => ({ rsvpEventAction: rsvp }));

const { EventActions } = await import('./EventActions');

const C = catalog as {
  rsvp: {
    windowHint: string;
    answeredGoing: string;
    answeredNotGoing: string;
    fullHint: string;
    errors: { failed: string; closed: string; full: string };
  };
  errors: { cancelled: string };
  checkin: { cta: string };
  online: { enter: string; hintBefore: string; confirmToGetLink: string; hintLive: string };
  reine: {
    cta: { checkin: string; register: string; full: string; cancel: string; certificate: string };
  };
};

const ID = '44444444-4444-4444-8444-4444444444e1';
const HOUR = 60 * 60 * 1000;

/** Instants far from the test clock, so no boundary timer fires unless a case sets one up. */
function state(overrides: Partial<EventActionState> = {}): EventActionState {
  return {
    eventId: ID,
    phase: 'P0',
    format: 'in_person',
    cancelled: false,
    answer: null,
    checkedIn: false,
    checkinOpensAt: '2099-10-12T21:00:00.000Z',
    startsAt: '2099-10-12T22:00:00.000Z',
    endsAt: '2099-10-13T00:00:00.000Z',
    startTime: '19:00',
    ...overrides,
  };
}

beforeEach(() => {
  toast.show.mockReset();
  refresh.mockReset();
  rsvp.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const register = () => screen.queryByRole('button', { name: C.reine.cta.register });
const unregister = () => screen.queryByRole('button', { name: C.reine.cta.cancel });
const checkin = () => screen.queryByTestId('event-actions-checkin');
/**
 * Every solid gold fill under `root`: the button colour the CTAs paint with (`bg-button`) or the
 * primary itself (`bg-brand`, which no element of the zone should spend), so "one fill at most"
 * keeps counting both.
 */
const brandFills = (root: Element) =>
  Array.from(root.querySelectorAll('*')).filter((node) =>
    /(^|\s)bg-(button|brand)(\s|$)/.test(node.getAttribute('class') ?? ''),
  );

describe('EventActions — the REINE rows (2026-10-06)', () => {
  it('1a. not going, P0/P1: "Garantir minha vaga" alone, the zone’s one gold fill', () => {
    for (const phase of ['P0', 'P1'] as const) {
      for (const answer of [null, 'not_going'] as const) {
        const { container, unmount } = render(<EventActions {...state({ phase, answer })} />);
        expect(register()).not.toBeNull();
        expect(unregister()).toBeNull();
        expect(screen.queryByText(C.rsvp.windowHint)).toBeNull();
        if (phase === 'P0') expect(checkin()).toBeNull();
        expect(brandFills(container).length).toBeLessThanOrEqual(1);
        unmount();
      }
    }
  });

  it('1b. going in person, P0: "Ver meu check-in" to the ticket, the window hint, and "Cancelar inscrição"', () => {
    const { container } = render(<EventActions {...state({ answer: 'going' })} />);
    expect(register()).toBeNull();
    const link = checkin() as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(`/eventos/${ID}/check-in`);
    expect(link.textContent).toBe(C.reine.cta.checkin);
    expect(screen.getByText(C.rsvp.windowHint)).toBeTruthy();
    expect(unregister()).not.toBeNull();
    expect(brandFills(container)).toHaveLength(1);
  });

  it('1c. P2 answered: the read-only line; the check-in link for anyone in the window', () => {
    render(<EventActions {...state({ phase: 'P2', answer: 'not_going' })} />);
    expect(screen.getByTestId('event-actions-answer').textContent).toBe(C.rsvp.answeredNotGoing);
    expect(register()).toBeNull();
    expect(unregister()).toBeNull();
    expect(checkin()?.textContent).toBe(C.checkin.cta);
    cleanup();
    render(<EventActions {...state({ phase: 'P2', answer: 'going' })} />);
    expect(screen.getByTestId('event-actions-answer').textContent).toBe(C.rsvp.answeredGoing);
    expect(checkin()?.textContent).toBe(C.reine.cta.checkin);
  });

  it('1d. P3 not present: nothing at all', () => {
    for (const answer of [null, 'going', 'not_going'] as const) {
      const { container, unmount } = render(<EventActions {...state({ phase: 'P3', answer })} />);
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('1e. present in person, not over: "Ver meu check-in" (the ticket’s done state)', () => {
    for (const phase of ['P1', 'P2'] as const) {
      const { unmount } = render(
        <EventActions {...state({ phase, answer: 'going', checkedIn: true })} />,
      );
      expect(checkin()?.textContent).toBe(C.reine.cta.checkin);
      expect(register()).toBeNull();
      expect(unregister()).toBeNull();
      unmount();
    }
  });

  it('1f. present after the end: "Ver meu certificado" only when the event has one', () => {
    const { unmount } = render(
      <EventActions {...state({ phase: 'P3', checkedIn: true })} certificate />,
    );
    const link = screen.getByTestId('event-actions-certificate');
    expect(link.getAttribute('href')).toBe('/eventos/meus');
    expect(link.textContent).toBe(C.reine.cta.certificate);
    unmount();
    const { container } = render(<EventActions {...state({ phase: 'P3', checkedIn: true })} />);
    expect(container.innerHTML).toBe('');
  });

  it('1g. cancelled: the CTA is disabled and nothing records', () => {
    render(<EventActions {...state({ cancelled: true })} />);
    const button = register() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(rsvp).not.toHaveBeenCalled();
    cleanup();
    render(<EventActions {...state({ cancelled: true, phase: 'P1', answer: 'going' })} />);
    expect(checkin()?.getAttribute('aria-disabled')).toBe('true');
    expect(checkin()?.tagName).toBe('SPAN');
    expect(unregister()).toBeNull();
  });
});

describe('EventActions — answering (D-204, D-205, UI-D-206)', () => {
  it('2. "Garantir minha vaga" answers Vou optimistically, calls the action once and refreshes, no toast', async () => {
    let resolve: (value: { ok: true }) => void = () => {};
    rsvp.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    // Optimistic: the Vou rows already show while the action runs.
    expect(checkin()?.textContent).toBe(C.reine.cta.checkin);
    expect(rsvp).toHaveBeenCalledTimes(1);
    expect(rsvp).toHaveBeenCalledWith(ID, 'going');
    await act(async () => resolve({ ok: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('2b. "Cancelar inscrição" answers Não vou, and the server value wins once it arrives', async () => {
    rsvp.mockResolvedValue({ ok: true });
    const { rerender } = render(<EventActions {...state({ answer: 'going' })} />);
    fireEvent.click(unregister() as HTMLElement);
    expect(rsvp).toHaveBeenCalledWith(ID, 'not_going');
    expect(register()).not.toBeNull();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(<EventActions {...state({ answer: 'not_going' })} />);
    expect(register()).not.toBeNull();
  });

  it('3a. a failure reverts and toasts the generic line, without a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'failed' });
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.failed }),
    );
    expect(register()).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('3b. rsvp_closed: revert, the "encerraram" toast, and a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'rsvp_closed' });
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.closed }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('3c. cancelled meanwhile: "Este evento foi cancelado." and a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'cancelled' });
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.errors.cancelled }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('3d. attendance_locked: the generic toast and a refresh into the banner', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'attendance_locked' });
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.failed }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('3e. event_full: revert, "Este evento está lotado." and a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'event_full' });
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.full }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(register()).not.toBeNull();
  });

  it('3f. a full event: "Vagas esgotadas", disabled, with the quiet line, for a viewer not going', () => {
    render(<EventActions {...state({ full: true })} />);
    const full = screen.getByRole('button', { name: C.reine.cta.full }) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    expect(screen.getByTestId('event-actions-full').textContent).toBe(C.rsvp.fullHint);
    cleanup();
    // Going already: the ticket, never the full line.
    render(<EventActions {...state({ full: true, answer: 'going' })} />);
    expect(screen.queryByTestId('event-actions-full')).toBeNull();
    expect(checkin()).not.toBeNull();
  });

  it('4. the zone writes only on a tap', () => {
    render(<EventActions {...state({ answer: 'going' })} />);
    expect(rsvp).not.toHaveBeenCalled();
  });
});

describe('EventActions — the boundary refresh (UI-D-203)', () => {
  const NOW = Date.parse('2026-10-12T20:30:00.000Z');

  it('5a. schedules ONE refresh just after the next boundary within 24 h, and clears it on unmount', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    const { unmount } = render(
      <EventActions
        {...state({
          checkinOpensAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
          startsAt: new Date(NOW + 90 * 60 * 1000).toISOString(),
          endsAt: new Date(NOW + 3 * HOUR).toISOString(),
        })}
      />,
    );
    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Unmounting clears whatever is armed: nothing fires afterwards.
    refresh.mockReset();
    unmount();
    vi.advanceTimersByTime(4 * HOUR);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('5b. re-arms at the next boundary when the refreshed phase arrives', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    const instants = {
      checkinOpensAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
      startsAt: new Date(NOW + 20 * 60 * 1000).toISOString(),
      endsAt: new Date(NOW + 2 * HOUR).toISOString(),
    };
    const { rerender } = render(<EventActions {...state({ phase: 'P1', ...instants })} />);
    vi.advanceTimersByTime(20 * 60 * 1000 + 1_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(<EventActions {...state({ phase: 'P2', answer: 'going', ...instants })} />);
    vi.advanceTimersByTime(100 * 60 * 1000 + 1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('5c. schedules nothing when the next boundary is more than 24 h away, or all are past', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    const { unmount } = render(
      <EventActions
        {...state({
          checkinOpensAt: new Date(NOW + 25 * HOUR).toISOString(),
          startsAt: new Date(NOW + 26 * HOUR).toISOString(),
          endsAt: new Date(NOW + 28 * HOUR).toISOString(),
        })}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
    unmount();

    render(
      <EventActions
        {...state({
          phase: 'P3',
          checkinOpensAt: new Date(NOW - 5 * HOUR).toISOString(),
          startsAt: new Date(NOW - 4 * HOUR).toISOString(),
          endsAt: new Date(NOW - 2 * HOUR).toISOString(),
        })}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(48 * HOUR);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('5d. WR-03: a refresh that brings the SAME phase back (device clock ahead) is retried after 2, 5, 15 and 30 s, and a phase change stops the chain', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    const instants = {
      checkinOpensAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
      startsAt: new Date(NOW + 70 * 60 * 1000).toISOString(),
      endsAt: new Date(NOW + 3 * HOUR).toISOString(),
    };
    const { rerender, unmount } = render(<EventActions {...state({ phase: 'P0', ...instants })} />);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The server still drew P0 (no rerender with a new phase): the chain retries.
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    // The server's clock caught up: P1 arrives, the pending retry is cleared, the next boundary armed.
    rerender(<EventActions {...state({ phase: 'P1', ...instants })} />);
    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();

    // With no phase change at all, the chain is bounded: the boundary refresh plus four retries.
    refresh.mockReset();
    vi.setSystemTime(NOW);
    render(<EventActions {...state({ phase: 'P0', ...instants })} />);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1_000 + 2_000 + 5_000 + 15_000 + 30_000);
    expect(refresh).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(40 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(5);
  });
});

describe('EventActions — the in-person check-in link (06-05)', () => {
  it('6a. one gold call at a time: in P1 not going only "Garantir minha vaga"; in P2 the walk-in "Fazer check-in"', () => {
    const p1 = render(<EventActions {...state({ phase: 'P1' })} />);
    expect(register()).not.toBeNull();
    expect(checkin()).toBeNull();
    expect(brandFills(p1.container)).toHaveLength(1);
    p1.unmount();
    const { container } = render(<EventActions {...state({ phase: 'P2' })} />);
    expect(checkin()?.textContent).toBe(C.checkin.cta);
    expect(checkin()?.getAttribute('href')).toBe(`/eventos/${ID}/check-in`);
    expect(register()).toBeNull();
    expect(brandFills(container)).toHaveLength(1);
  });

  it('6b. online never draws the check-in link', () => {
    for (const phase of ['P0', 'P1', 'P2', 'P3'] as const) {
      const { unmount } = render(
        <EventActions {...state({ format: 'online', phase, answer: 'going' })} />,
      );
      expect(checkin()).toBeNull();
      unmount();
    }
  });

  it('6c. the link only navigates: rendering or tapping it calls no action', () => {
    render(<EventActions {...state({ answer: 'going' })} />);
    const link = checkin() as HTMLAnchorElement;
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(rsvp).not.toHaveBeenCalled();
  });
});

describe('EventActions — the online rows and the whole table (06-06, UI-D-209)', () => {
  const enter = () => screen.queryByTestId('event-actions-enter');
  const hint = () => screen.queryByTestId('event-actions-online-hint');

  /** Every link stays in the app, every `Entrar` is the D-218 shape, and no meeting URL anywhere. */
  function assertSafe(container: HTMLElement) {
    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href.startsWith('/eventos/'), href).toBe(true);
      if (href.endsWith('/entrar')) {
        expect(anchor.getAttribute('target')).toBe('_blank');
        expect(anchor.getAttribute('rel') ?? '').toContain('noopener');
        expect(anchor.getAttribute('rel') ?? '').toContain('noreferrer');
        expect(anchor.hasAttribute('data-no-prefetch')).toBe(true);
      }
    }
    const markup = container.innerHTML.replace(/xmlns="[^"]*"/g, '');
    expect(markup).not.toMatch(/https?:|meet\.|zoom\.|teams\./i);
  }

  it('7a. online P0 with Vou: the OUTLINE Entrar, "A transmissão começa às {time}." and "Cancelar inscrição"', () => {
    const { container } = render(
      <EventActions {...state({ format: 'online', phase: 'P0', answer: 'going' })} />,
    );
    expect(enter()?.getAttribute('data-tone')).toBe('outline');
    expect(hint()?.textContent).toBe(C.online.hintBefore.replace('{time}', '19:00'));
    expect(unregister()).not.toBeNull();
    assertSafe(container);
  });

  it('7b. online P0 without Vou: "Garantir minha vaga", the Lock hint, and NO Entrar', () => {
    render(<EventActions {...state({ format: 'online', phase: 'P0' })} />);
    expect(register()).not.toBeNull();
    expect(enter()).toBeNull();
    expect(hint()?.textContent).toBe(C.online.confirmToGetLink);
  });

  it('7c. online P1/P2, not present: the GOLD Entrar and "Ao entrar, sua presença é registrada."', () => {
    for (const phase of ['P1', 'P2'] as const) {
      const { container, unmount } = render(
        <EventActions {...state({ format: 'online', phase, answer: 'going' })} />,
      );
      expect(enter()?.getAttribute('data-tone')).toBe('brand');
      expect(hint()?.textContent).toBe(C.online.hintLive);
      assertSafe(container);
      unmount();
    }
  });

  it('7c2. online P1 without an answer: the gold Entrar ALONE, no "Garantir minha vaga"', () => {
    render(<EventActions {...state({ format: 'online', phase: 'P1' })} />);
    expect(enter()?.getAttribute('data-tone')).toBe('brand');
    expect(hint()?.textContent).toBe(C.online.hintLive);
    expect(register()).toBeNull();
  });

  it('7d. online P1/P2 present: ONLY the gold Entrar (rejoin)', () => {
    render(<EventActions {...state({ format: 'online', phase: 'P2', checkedIn: true })} />);
    expect(enter()?.getAttribute('data-tone')).toBe('brand');
    expect(hint()).toBeNull();
    expect(register()).toBeNull();
  });

  it('7e. cancelled online in the window: Entrar DISABLED, not a link', () => {
    render(<EventActions {...state({ format: 'online', phase: 'P1', cancelled: true })} />);
    expect(enter()?.tagName).toBe('SPAN');
    expect(enter()?.getAttribute('aria-disabled')).toBe('true');
  });

  it('7f. the whole table: only safe links, Entrar never in person, the check-in link never online', () => {
    for (const format of ['in_person', 'online'] as const) {
      for (const phase of ['P0', 'P1', 'P2', 'P3'] as const) {
        for (const answer of [null, 'going', 'not_going'] as const) {
          for (const checkedIn of [false, true]) {
            for (const cancelled of [false, true]) {
              const { container, unmount } = render(
                <EventActions
                  {...state({ format, phase, answer, checkedIn, cancelled })}
                  certificate
                />,
              );
              assertSafe(container);
              if (format === 'in_person') expect(enter()).toBeNull();
              else expect(checkin()).toBeNull();
              // REINE: one gold call at a time, in every state.
              expect(
                container.querySelectorAll('.bg-button').length,
                `${format} ${phase} ${answer} checkedIn=${checkedIn} cancelled=${cancelled}`,
              ).toBeLessThanOrEqual(1);
              unmount();
            }
          }
        }
      }
    }
  });

  it('7g. Entrar only navigates: rendering or tapping it calls no action', () => {
    render(<EventActions {...state({ format: 'online', phase: 'P1' })} />);
    const link = screen.getByRole('link', { name: C.online.enter });
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(rsvp).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * Phase 10.1-12 (D-741, D-753, UI-D-746): a paid event routes to the paid zone ONLY for a member without
 * a presence; every other member keeps the shipped zone, and a free event is untouched.
 */
describe('EventActions — the paid branch (10.1-12)', () => {
  const HREF = 'https://pay.example/checkout/abc';
  const T = catalog.ticket as { cta: { buy: string; unavailable: string } };
  const paid = (overrides: Partial<EventActionState> = {}) =>
    state({
      paid: true,
      zone: 'buy',
      checkoutHref: HREF,
      priceLabel: null,
      viewerOrigin: null,
      ...overrides,
    });
  const buy = () => screen.queryByTestId('event-actions-buy');

  it('8a. a member without a presence gets the buy control and none of the free controls', () => {
    for (const answer of [null, 'not_going'] as const) {
      const { container, unmount } = render(<EventActions {...paid({ answer })} />);
      expect(buy()?.getAttribute('href')).toBe(HREF);
      expect(buy()?.textContent).toContain(T.cta.buy);
      expect(register()).toBeNull();
      expect(unregister()).toBeNull();
      expect(checkin()).toBeNull();
      expect(screen.queryByTestId('event-actions-enter')).toBeNull();
      expect(container.querySelectorAll('.bg-button').length).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it('8b. an online paid event without a presence has no Entrar, in any phase', () => {
    for (const phase of ['P0', 'P1', 'P2'] as const) {
      const { unmount } = render(
        <EventActions
          {...paid({ format: 'online', phase, zone: phase === 'P2' ? 'salesClosed' : 'buy' })}
        />,
      );
      expect(screen.queryByTestId('event-actions-enter')).toBeNull();
      expect(screen.queryByText(C.online.enter)).toBeNull();
      unmount();
    }
  });

  it('8c. the server’s answer routes, not the optimistic one: a member with a presence keeps the shipped zone', () => {
    render(<EventActions {...paid({ answer: 'going', zone: null, viewerOrigin: 'ticket' })} />);
    expect(buy()).toBeNull();
    expect(checkin()?.textContent).toBe(C.reine.cta.checkin);
    cleanup();
    render(<EventActions {...paid({ checkedIn: true, zone: null })} />);
    expect(buy()).toBeNull();
    expect(checkin()?.textContent).toBe(C.reine.cta.checkin);
  });

  it('8d. cancelled or ended draws nothing, and a free event never shows the buy control', () => {
    const { container, unmount } = render(<EventActions {...paid({ cancelled: true })} />);
    expect(container.innerHTML).toBe('');
    unmount();
    const ended = render(<EventActions {...paid({ phase: 'P3', zone: 'none' })} />);
    expect(ended.container.innerHTML).toBe('');
    ended.unmount();
    render(<EventActions {...state()} />);
    expect(buy()).toBeNull();
    expect(register()).not.toBeNull();
  });

  it('8e. the paid zone never calls the action by being rendered or by a tap on the anchor', () => {
    render(<EventActions {...paid()} />);
    const link = buy() as HTMLElement;
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(rsvp).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * Phase 10.1-12 (D-741, D-754, UI-D-750, UI-D-753): giving up. A paid or courtesy presence has NO
 * "Não vou" and no "Cancelar inscrição"; a presence from before the ticket keeps the quiet button behind
 * a danger dialog, answers nothing optimistically and refreshes into the buy state; a stale tab is told
 * what changed and refreshed.
 */
describe('EventActions — giving up a paid presence (10.1-12, UI-D-750, UI-D-753)', () => {
  const HREF = 'https://pay.example/checkout/abc';
  const T = catalog.ticket as {
    giveUp: { title: string; body: string; confirm: string; dismiss: string };
  };
  const E = (catalog.rsvp as { errors: { paid: string; ticketLocked: string } }).errors;
  const going = (viewerOrigin: EventActionState['viewerOrigin'], overrides = {}) =>
    state({
      paid: true,
      zone: null,
      answer: 'going',
      viewerOrigin,
      checkoutHref: null,
      priceLabel: null,
      ...overrides,
    });
  const dialog = () => screen.queryByRole('dialog');

  it('9a. a ticket or courtesy presence renders no "Não vou" and no "Cancelar inscrição", in any phase', () => {
    for (const origin of ['ticket', 'courtesy', null] as const) {
      for (const phase of ['P0', 'P1', 'P2'] as const) {
        for (const format of ['in_person', 'online'] as const) {
          const { unmount } = render(<EventActions {...going(origin, { phase, format })} />);
          expect(unregister(), `${origin} ${phase} ${format}`).toBeNull();
          expect(screen.queryByTestId('event-actions-unregister')).toBeNull();
          expect(screen.queryByRole('button', { name: /não vou|cancelar inscrição/i })).toBeNull();
          expect(screen.queryByText(/não vou|cancelar inscrição/i)).toBeNull();
          expect(register()).toBeNull();
          unmount();
        }
      }
    }
  });

  it('9b. a presence from before the ticket keeps the quiet "Cancelar inscrição", which opens the danger dialog', () => {
    render(<EventActions {...going('before_ticket')} />);
    expect(dialog()).toBeNull();
    fireEvent.click(unregister() as HTMLElement);
    const open = dialog() as HTMLElement;
    expect(open).not.toBeNull();
    expect(within(open).getByRole('heading', { name: T.giveUp.title })).toBeTruthy();
    expect(within(open).getByText(T.giveUp.body)).toBeTruthy();
    // The safe action comes first and the dismiss label is "Manter inscrição".
    const buttons = within(open).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      T.giveUp.dismiss,
      T.giveUp.confirm,
    ]);
    // Nothing was written by opening the dialog.
    expect(rsvp).not.toHaveBeenCalled();
  });

  it('9c. dismissing the dialog keeps the presence: no write, no refresh', async () => {
    render(<EventActions {...going('before_ticket')} />);
    fireEvent.click(unregister() as HTMLElement);
    fireEvent.click(
      within(dialog() as HTMLElement).getByRole('button', { name: T.giveUp.dismiss }),
    );
    await waitFor(() => expect(dialog()).toBeNull());
    expect(rsvp).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(unregister()).not.toBeNull();
  });

  it('9d. confirming answers Não vou once, shows no optimistic buy state, and refreshes into the buy zone', async () => {
    rsvp.mockResolvedValue({ ok: true });
    const { rerender } = render(<EventActions {...going('before_ticket')} />);
    fireEvent.click(unregister() as HTMLElement);
    fireEvent.click(
      within(dialog() as HTMLElement).getByRole('button', { name: T.giveUp.confirm }),
    );
    await waitFor(() => expect(rsvp).toHaveBeenCalledWith(ID, 'not_going'));
    expect(rsvp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.show).not.toHaveBeenCalled();
    // The server has not answered yet: still no buy control and no free "Garantir minha vaga".
    expect(screen.queryByTestId('event-actions-buy')).toBeNull();
    expect(register()).toBeNull();
    // The refetch lands: the member is a buyer now.
    rerender(
      <EventActions
        {...state({
          paid: true,
          zone: 'buy',
          answer: 'not_going',
          viewerOrigin: null,
          checkoutHref: HREF,
          priceLabel: null,
        })}
      />,
    );
    expect(screen.getByTestId('event-actions-buy').getAttribute('href')).toBe(HREF);
    expect(unregister()).toBeNull();
    expect(register()).toBeNull();
  });

  it('9e. the free event’s "Cancelar inscrição" still answers at once, with no dialog', async () => {
    rsvp.mockResolvedValue({ ok: true });
    render(<EventActions {...state({ answer: 'going' })} />);
    fireEvent.click(unregister() as HTMLElement);
    expect(dialog()).toBeNull();
    expect(rsvp).toHaveBeenCalledWith(ID, 'not_going');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('10a. a stale tab hitting payment_required toasts the new sentence, refreshes and reverts', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'payment_required' });
    render(<EventActions {...state()} />);
    fireEvent.click(register() as HTMLElement);
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: E.paid }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(E.paid).toBe('Este evento passou a ter ingresso pago. A página foi atualizada.');
    // Reverted: the free page is back until the refresh lands.
    expect(register()).not.toBeNull();
  });

  it('10b. a before-the-ticket member who paid meanwhile gets ticket_locked: the toast and a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'ticket_locked' });
    render(<EventActions {...going('before_ticket')} />);
    fireEvent.click(unregister() as HTMLElement);
    fireEvent.click(
      within(dialog() as HTMLElement).getByRole('button', { name: T.giveUp.confirm }),
    );
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: E.ticketLocked }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(E.ticketLocked).toBe(
      'Sua presença já está confirmada pelo ingresso. A página foi atualizada.',
    );
  });

  it('10c. the shipped refusals keep their own toasts next to the new ones', async () => {
    for (const [error, message] of [
      ['rsvp_closed', C.rsvp.errors.closed],
      ['cancelled', C.errors.cancelled],
      ['event_full', C.rsvp.errors.full],
    ] as const) {
      toast.show.mockReset();
      refresh.mockReset();
      rsvp.mockResolvedValue({ ok: false, error });
      const { unmount } = render(<EventActions {...state()} />);
      fireEvent.click(register() as HTMLElement);
      await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message }));
      expect(refresh).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('11. no paid-event state draws "processando" or a second brand fill', () => {
    for (const answer of [null, 'not_going', 'going'] as const) {
      for (const origin of [null, 'ticket', 'courtesy', 'before_ticket'] as const) {
        const { container, unmount } = render(
          <EventActions
            {...state({
              paid: true,
              zone: answer === 'going' ? null : 'buy',
              answer,
              viewerOrigin: origin,
              checkoutHref: HREF,
            })}
          />,
        );
        expect(container.textContent).not.toMatch(/processando/i);
        expect(brandFills(container).length).toBeLessThanOrEqual(1);
        unmount();
      }
    }
  });
});

/**
 * Phase 10.1-12 (D-756, PAY-34, UI-D-747, UI-D-748): the persistent live region and the boundary of the
 * paid zone. The wrapper and the listener exist only for a paid event the member is not in; when the
 * server answers a presence the SAME wrapper holds the shipped zone (so the swap is announced) and no
 * toast speaks; the buy control leaves at `starts_at` by the refresh of the server's boundary.
 */
describe('EventActions — the live swap of a paid event (10.1-12, UI-D-747, UI-D-748)', () => {
  const HREF = 'https://pay.example/checkout/abc';
  const TENANT = '0d000000-0000-4000-8000-00000000aaaa';
  const USER = '0d000000-0000-4000-8000-00000000bbbb';
  const TOPIC = `tenant:${TENANT}:user:${USER}`;

  function fakeRealtime() {
    const channels: { topic: string; onBroadcast?: (m: BroadcastMessage) => void }[] = [];
    const client = {
      setAuth: vi.fn(async () => {}),
      channel: vi.fn((topic: string) => {
        const channel: { topic: string; onBroadcast?: (m: BroadcastMessage) => void } = { topic };
        channels.push(channel);
        const handle = {
          on: (_t: 'broadcast', _f: { event: string }, cb: (m: BroadcastMessage) => void) => {
            channel.onBroadcast = cb;
            return handle;
          },
          subscribe: () => handle,
        };
        return handle;
      }),
      removeChannel: vi.fn(async () => 'ok'),
      disconnect: vi.fn(async () => 'ok'),
    };
    return {
      client,
      factory: vi.fn(() => client as never),
      emit: (event: string) =>
        act(() =>
          [...channels]
            .reverse()
            .find((c) => c.topic === TOPIC)
            ?.onBroadcast?.({ event, payload: { kind: 'payments.ticket' } }),
        ),
    };
  }

  const inProvider = (fake: ReturnType<typeof fakeRealtime>, props: EventActionState) => (
    <RealtimeProvider
      supabaseUrl="http://supabase.test"
      publishableKey="pk"
      tokenUrl="/api/realtime/token"
      clientFactory={fake.factory}
    >
      <EventActions {...props} tenantId={TENANT} userId={USER} />
    </RealtimeProvider>
  );
  const buyer = (overrides: Partial<EventActionState> = {}) =>
    state({
      paid: true,
      zone: 'buy',
      checkoutHref: HREF,
      priceLabel: null,
      viewerOrigin: null,
      ...overrides,
    });
  const live = () => screen.queryByTestId('event-actions-live');

  it('12a. the wrapper and the listener exist for a paid event the member is not in, from the first render', async () => {
    const fake = fakeRealtime();
    render(inProvider(fake, buyer()));
    expect(live()?.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    fake.emit('notifications.changed');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('12b. neither the wrapper nor the listener mounts for a free event or for a member already in', async () => {
    const fake = fakeRealtime();
    render(inProvider(fake, state()));
    expect(live()).toBeNull();
    cleanup();
    for (const props of [
      buyer({ answer: 'going', zone: null, viewerOrigin: 'ticket' }),
      buyer({ checkedIn: true, zone: null }),
    ]) {
      render(inProvider(fake, props));
      expect(live()).toBeNull();
      cleanup();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.client.channel).not.toHaveBeenCalled();
  });

  it('12c. the swap: the server answers a presence and the SAME wrapper holds the shipped zone, with no toast', async () => {
    const fake = fakeRealtime();
    const view = render(inProvider(fake, buyer()));
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    const wrapper = live() as HTMLElement;
    expect(screen.getByTestId('event-actions-buy')).toBeTruthy();

    view.rerender(inProvider(fake, buyer({ answer: 'going', zone: null, viewerOrigin: 'ticket' })));
    expect(live()).toBe(wrapper);
    expect(wrapper.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByTestId('event-actions-buy')).toBeNull();
    expect(wrapper.contains(checkin())).toBe(true);
    expect(checkin()?.textContent).toBe(C.reine.cta.checkin);
    expect(unregister()).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
    // The wait is over: a later signal refreshes nothing.
    refresh.mockReset();
    fake.emit('notifications.changed');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('12d. the buy control leaves at starts_at by the boundary refresh, and the timer dies with the zone', () => {
    const NOW = Date.parse('2026-10-12T20:30:00.000Z');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    const { unmount } = render(
      <EventActions
        {...buyer({
          checkinOpensAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
          startsAt: new Date(NOW + 90 * 60 * 1000).toISOString(),
          endsAt: new Date(NOW + 3 * HOUR).toISOString(),
        })}
      />,
    );
    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockReset();
    unmount();
    vi.advanceTimersByTime(4 * HOUR);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('12e. a member who gives up a before-the-ticket presence ends up in the buy zone, listening', async () => {
    const fake = fakeRealtime();
    const view = render(
      inProvider(fake, buyer({ answer: 'going', zone: null, viewerOrigin: 'before_ticket' })),
    );
    expect(live()).toBeNull();
    view.rerender(inProvider(fake, buyer({ answer: 'not_going' })));
    expect(screen.getByTestId('event-actions-buy').getAttribute('href')).toBe(HREF);
    expect(live()?.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    fake.emit('notifications.changed');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
