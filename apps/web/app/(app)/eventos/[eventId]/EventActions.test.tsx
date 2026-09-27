// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventActionState } from '@/lib/events-view';

/**
 * 06-03 — the action zone's RSVP rows (UI-D-207, sketch 006 surface 2 "zona-de-acao-todas-as-linhas").
 *
 * The catalog is the REAL `events.json`, so a copy drift fails here. Stubbed: the server action, the
 * router and the toast. Real: the island and the `@tria/ui` `SegmentedControl`.
 *
 * Claims:
 *  1. every RSVP row of the §Action zone table renders exactly what the table says (in person
 *     P0/P1/P2/P3, checked in, and cancelled P0/P1/P2), a disabled pair still shows the stored answer,
 *     and no row carries more than one brand fill (the pair itself carries none);
 *  2. a tap moves `aria-pressed` optimistically, marks the group busy, calls the action once, and on
 *     success refreshes with NO toast;
 *  3. a failure reverts and toasts; `rsvp_closed` and `cancelled` toast their own lines and refresh;
 *  4. tapping the already-pressed answer writes nothing;
 *  5. the boundary refresh: one timer at the next boundary within 24 h, none beyond, cleared on
 *     unmount.
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

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

vi.mock('../actions', () => ({ rsvpEventAction: rsvp }));

const { EventActions } = await import('./EventActions');

const C = catalog as {
  rsvp: {
    label: string;
    going: string;
    notGoing: string;
    windowHint: string;
    answeredGoing: string;
    answeredNotGoing: string;
    errors: { failed: string; closed: string };
  };
  errors: { cancelled: string };
  checkin: { cta: string };
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

const group = () => screen.getByRole('group', { name: C.rsvp.label });
const vou = () => screen.getByRole('button', { name: C.rsvp.going });
const naoVou = () => screen.getByRole('button', { name: C.rsvp.notGoing });
const brandFills = (root: Element) =>
  Array.from(root.querySelectorAll('*')).filter((node) =>
    /(^|\s)bg-brand(\s|$)/.test(node.getAttribute('class') ?? ''),
  );

describe('EventActions — every RSVP row of the action-zone contract (UI-D-207)', () => {
  it('1a. in person P0: the enabled pair under its label, and the check-in window hint', () => {
    const { container } = render(<EventActions {...state({ answer: 'going' })} />);
    expect(group()).toBeTruthy();
    expect(vou().getAttribute('aria-pressed')).toBe('true');
    expect(naoVou().getAttribute('aria-pressed')).toBe('false');
    expect((vou() as HTMLButtonElement).disabled).toBe(false);
    expect((naoVou() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(C.rsvp.windowHint)).toBeTruthy();
    expect(screen.queryByTestId('event-actions-answer')).toBeNull();
    expect(brandFills(container).length).toBeLessThanOrEqual(1);
    // The pair itself spends no brand fill: the zone's one fill is reserved for its CTA.
    expect(brandFills(group())).toHaveLength(0);
  });

  it('1b. unanswered P0: both segments idle', () => {
    render(<EventActions {...state()} />);
    expect(vou().getAttribute('aria-pressed')).toBe('false');
    expect(naoVou().getAttribute('aria-pressed')).toBe('false');
  });

  it('1c. in person P1: the enabled pair and NO hint (the check-in CTA below is case 6a)', () => {
    const { container } = render(<EventActions {...state({ phase: 'P1', answer: 'not_going' })} />);
    expect(naoVou().getAttribute('aria-pressed')).toBe('true');
    expect((naoVou() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(C.rsvp.windowHint)).toBeNull();
    expect(brandFills(container).length).toBeLessThanOrEqual(1);
  });

  it('1d. online P0: the pair without the in-person hint', () => {
    render(<EventActions {...state({ format: 'online', answer: 'going' })} />);
    expect(group()).toBeTruthy();
    expect(screen.queryByText(C.rsvp.windowHint)).toBeNull();
  });

  it('1e. P2: the read-only answer line replaces the pair (RSVP closed at the start)', () => {
    const { rerender } = render(<EventActions {...state({ phase: 'P2', answer: 'going' })} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByTestId('event-actions-answer').textContent).toContain(C.rsvp.answeredGoing);

    rerender(<EventActions {...state({ phase: 'P2', answer: 'not_going' })} />);
    expect(screen.getByTestId('event-actions-answer').textContent).toContain(
      C.rsvp.answeredNotGoing,
    );
  });

  it('1f. P3 renders nothing at all; P2 unanswered keeps only the check-in CTA (06-05)', () => {
    const { container, rerender } = render(
      <EventActions {...state({ phase: 'P3', answer: 'going' })} />,
    );
    expect(container.innerHTML).toBe('');
    rerender(<EventActions {...state({ phase: 'P2' })} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByTestId('event-actions-answer')).toBeNull();
    expect(screen.getByRole('link', { name: C.checkin.cta })).toBeTruthy();
    // Online P2 is 06-06's `Entrar`: nothing from this plan.
    rerender(<EventActions {...state({ phase: 'P2', format: 'online' })} />);
    expect(container.innerHTML).toBe('');
  });

  it('1g. checked in (walk-in included), in any phase: no RSVP row, the banner above says it', () => {
    const { container, rerender } = render(
      <EventActions {...state({ phase: 'P1', checkedIn: true })} />,
    );
    expect(container.innerHTML).toBe('');
    rerender(<EventActions {...state({ phase: 'P2', checkedIn: true, answer: 'going' })} />);
    expect(container.innerHTML).toBe('');
  });

  it('1h. cancelled P0 and P1: the pair DISABLED, showing the stored answer, and no hint', () => {
    for (const phase of ['P0', 'P1'] as const) {
      const { container, unmount } = render(
        <EventActions {...state({ phase, cancelled: true, answer: 'going' })} />,
      );
      expect(group().className).toContain('opacity-50');
      expect((vou() as HTMLButtonElement).disabled).toBe(true);
      expect((naoVou() as HTMLButtonElement).disabled).toBe(true);
      expect(vou().getAttribute('aria-pressed')).toBe('true');
      expect(screen.queryByText(C.rsvp.windowHint)).toBeNull();
      expect(brandFills(container).length).toBeLessThanOrEqual(1);
      fireEvent.click(naoVou());
      expect(rsvp).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('1i. cancelled P2: no RSVP row and no read-only line (06-05 adds only the DISABLED CTA, case 6d)', () => {
    render(<EventActions {...state({ phase: 'P2', cancelled: true, answer: 'going' })} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByTestId('event-actions-answer')).toBeNull();
    // Online cancelled P2 is 06-06's disabled `Entrar`: nothing from this plan.
    const { container } = render(
      <EventActions
        {...state({ phase: 'P2', cancelled: true, answer: 'going', format: 'online' })}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('EventActions — answering (D-204, D-205, UI-D-206)', () => {
  it('2. a tap moves aria-pressed optimistically, marks the group busy, and on ok refreshes without a toast', async () => {
    let settle: (value: unknown) => void = () => {};
    rsvp.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(<EventActions {...state()} />);
    fireEvent.click(vou());

    expect(vou().getAttribute('aria-pressed')).toBe('true');
    expect(group().getAttribute('aria-busy')).toBe('true');
    expect((vou() as HTMLButtonElement).disabled).toBe(true);
    expect((naoVou() as HTMLButtonElement).disabled).toBe(true);
    expect(rsvp).toHaveBeenCalledTimes(1);
    expect(rsvp).toHaveBeenCalledWith(ID, 'going');

    // A second tap while the first is pending is inert.
    fireEvent.click(naoVou());
    expect(rsvp).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle({ ok: true, status: 'going' });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.show).not.toHaveBeenCalled();
    expect(group().hasAttribute('aria-busy')).toBe(false);
    // Until the refreshed server answer arrives, the recorded answer keeps showing.
    expect(vou().getAttribute('aria-pressed')).toBe('true');
  });

  it('2b. once the refresh brings the new recorded answer, the server value wins', async () => {
    rsvp.mockResolvedValue({ ok: true, status: 'not_going' });
    const { rerender } = render(<EventActions {...state({ answer: 'going' })} />);
    fireEvent.click(naoVou());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rerender(<EventActions {...state({ answer: 'not_going' })} />);
    expect(naoVou().getAttribute('aria-pressed')).toBe('true');
    expect(vou().getAttribute('aria-pressed')).toBe('false');
  });

  it('3a. a failure reverts the pair and toasts the generic line, without a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'failed' });
    render(<EventActions {...state({ answer: 'not_going' })} />);
    fireEvent.click(vou());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.failed }),
    );
    expect(naoVou().getAttribute('aria-pressed')).toBe('true');
    expect(vou().getAttribute('aria-pressed')).toBe('false');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('3b. rsvp_closed (the event started meanwhile): revert, the "encerraram" toast, and a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'rsvp_closed' });
    render(<EventActions {...state({ phase: 'P1', answer: 'not_going' })} />);
    fireEvent.click(vou());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.closed }),
    );
    expect(naoVou().getAttribute('aria-pressed')).toBe('true');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('3c. cancelled meanwhile: "Este evento foi cancelado." and a refresh', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'cancelled' });
    render(<EventActions {...state()} />);
    fireEvent.click(naoVou());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.errors.cancelled }),
    );
    expect(naoVou().getAttribute('aria-pressed')).toBe('false');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('3d. attendance_locked (a check-in landed meanwhile): the generic toast and a refresh into the banner', async () => {
    rsvp.mockResolvedValue({ ok: false, error: 'attendance_locked' });
    render(<EventActions {...state({ phase: 'P1' })} />);
    fireEvent.click(vou());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.rsvp.errors.failed }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('4. tapping the already-pressed answer writes nothing', () => {
    render(<EventActions {...state({ answer: 'going' })} />);
    fireEvent.click(vou());
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
});

describe('EventActions — the in-person check-in CTA (06-05, UI-D-207)', () => {
  const cta = () => screen.getByRole('link', { name: C.checkin.cta });

  it('6a. in person P1, not checked in: the pair, then ONE brand <a> to /check-in (the zone’s only fill)', () => {
    const { container } = render(<EventActions {...state({ phase: 'P1', answer: 'going' })} />);
    expect(group()).toBeTruthy();
    expect(cta().tagName).toBe('A');
    expect(cta().getAttribute('href')).toBe(`/eventos/${ID}/check-in`);
    expect(cta().className).toContain('bg-brand');
    expect(cta().className).toContain('w-full');
    expect(brandFills(container)).toHaveLength(1);
    // Below the pair, in the zone's reading order.
    const zone = screen.getByTestId('event-actions');
    const children = Array.from(zone.children);
    expect(children.indexOf(cta())).toBeGreaterThan(
      children.findIndex((node) => node.contains(group())),
    );
  });

  it('6b. in person P2, not checked in: the read-only answer line, then the brand CTA', () => {
    const { container } = render(<EventActions {...state({ phase: 'P2', answer: 'going' })} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByTestId('event-actions-answer').textContent).toContain(C.rsvp.answeredGoing);
    expect(cta().getAttribute('href')).toBe(`/eventos/${ID}/check-in`);
    expect(brandFills(container)).toHaveLength(1);
  });

  it('6c. no CTA before the window (P0), after the end (P3), once checked in (walk-in included), or online', () => {
    for (const overrides of [
      { phase: 'P0' as const },
      { phase: 'P3' as const },
      { phase: 'P1' as const, checkedIn: true },
      { phase: 'P2' as const, checkedIn: true },
      { phase: 'P1' as const, format: 'online' as const },
    ]) {
      const { unmount } = render(<EventActions {...state(overrides)} />);
      expect(screen.queryByTestId('event-actions-checkin'), JSON.stringify(overrides)).toBeNull();
      unmount();
    }
  });

  it('6d. cancelled P1 / P2: the CTA is DISABLED, not a link, and still one brand fill at most', () => {
    for (const phase of ['P1', 'P2'] as const) {
      const { container, unmount } = render(
        <EventActions {...state({ phase, cancelled: true, answer: 'going' })} />,
      );
      expect(screen.queryByRole('link', { name: C.checkin.cta })).toBeNull();
      const disabled = screen.getByTestId('event-actions-checkin');
      expect(disabled.tagName).toBe('SPAN');
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      expect(disabled.getAttribute('href')).toBeNull();
      expect(disabled.className).toContain('opacity-50');
      expect(disabled.textContent).toBe(C.checkin.cta);
      expect(brandFills(container).length).toBeLessThanOrEqual(1);
      unmount();
    }
    // Cancelled P0 and P3: no CTA at all.
    for (const phase of ['P0', 'P3'] as const) {
      const { unmount } = render(<EventActions {...state({ phase, cancelled: true })} />);
      expect(screen.queryByTestId('event-actions-checkin')).toBeNull();
      unmount();
    }
  });

  it('6e. the CTA only navigates: rendering or tapping it calls no action', () => {
    render(<EventActions {...state({ phase: 'P1' })} />);
    fireEvent.click(cta());
    expect(rsvp).not.toHaveBeenCalled();
  });
});
