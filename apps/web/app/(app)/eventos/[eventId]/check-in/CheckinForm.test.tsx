// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 06-05 — the ticket's code form and its states (UI-D-208, UI E08; sketch 006 surface 3).
 *
 * The catalog is the REAL `events.json`, so a copy drift fails here. Stubbed: the server action and
 * the router. Real: the form, the shipped `Input` and `Button`, and `motion/react`.
 *
 * Claims:
 *  1. "Confirmar check-in" stays disabled until the code has its 4 characters, and no error renders
 *     before the first submit (E08/empty); a lowercase entry displays uppercase;
 *  1b. WR-02: spaces and hyphens (typed or pasted) are stripped as they arrive, so "K7 QM" and
 *     "k7-qm" are ready and send "K7QM", and a 5th symbol is dropped;
 *  2. while the action runs the button is busy ("Confirmando…") and the field read-only, and a second
 *     submit is a no-op (E08/loading);
 *  3. a wrong code: the inline `role="alert"` error, the value KEPT and SELECTED (E08/error);
 *  4. the guess bound: the inline error, and the submit stays disabled even after editing;
 *  5. a race (window closed, cancelled): the inline sentence, then a refresh;
 *  6. success: the done state swaps in place, its heading RECEIVES FOCUS, the server's "Realizado
 *     às …" line and the outline "Voltar para o evento"; one refresh; the spring plays;
 *  7. under reduced motion the circle renders still (no scale), and a page that LOADS done is still
 *     and unfocused.
 */

const { catalog, refresh, checkIn } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('events').events as Record<string, unknown>,
    refresh: vi.fn(),
    checkIn: vi.fn(),
  };
});

MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string) =>
  String(
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog) ?? key,
  );

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => lookup(key) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('../../actions', () => ({ checkInEventAction: checkIn }));

const { CheckinForm } = await import('./CheckinForm');

const C = catalog as {
  checkin: {
    codeLabel: string;
    submit: string;
    submitting: string;
    doneTitle: string;
    back: string;
    errors: { wrongCode: string; tooManyAttempts: string; notOpen: string; failed: string };
  };
  errors: { cancelled: string };
};

const ID = '44444444-4444-4444-8444-4444444444e1';
const DETAIL = `/eventos/${ID}`;

/** Every matchMedia query answers `reduce`; restored after each test. */
function preferReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  refresh.mockReset();
  checkIn.mockReset();
  preferReducedMotion(false);
});
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

const field = () => screen.getByLabelText(C.checkin.codeLabel) as HTMLInputElement;
const submit = () => screen.getByRole('button') as HTMLButtonElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const send = async () => {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('checkin-form'));
  });
};

function open() {
  return render(<CheckinForm eventId={ID} detailHref={DETAIL} doneLine={null} />);
}

describe('CheckinForm — the open section (UI-D-208, E08)', () => {
  it('1. the submit is disabled until 4 characters, no error before the first submit, and lowercase shows uppercase', () => {
    open();
    expect(field().getAttribute('maxlength')).toBe('16');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(field().getAttribute('autocapitalize')).toBe('characters');
    expect(field().getAttribute('spellcheck')).toBe('false');
    expect(submit().textContent).toContain(C.checkin.submit);
    expect(submit().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();

    type('k7q');
    expect(field().value).toBe('K7Q');
    expect(submit().disabled).toBe(true);
    type('k7qm');
    expect(field().value).toBe('K7QM');
    expect(submit().disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('1b. WR-02: separators typed or pasted are stripped, so "K7 QM" and a pasted "k7-qm" are ready, and a 5th symbol is dropped', async () => {
    checkIn.mockResolvedValue({ ok: false, error: 'failed' });
    open();
    type('K7 Q');
    expect(field().value).toBe('K7Q');
    expect(submit().disabled).toBe(true);
    type('K7QM');
    expect(submit().disabled).toBe(false);

    type('k7-qm');
    expect(field().value).toBe('K7QM');
    expect(submit().disabled).toBe(false);
    type(' K7 QM ');
    expect(field().value).toBe('K7QM');
    type('K7QMX');
    expect(field().value).toBe('K7QM');

    await send();
    expect(checkIn).toHaveBeenCalledWith(ID, 'K7QM');
  });

  it('2. while the action runs: busy "Confirmando…", the field read-only, and a double submit is a no-op', async () => {
    let settle: (value: unknown) => void = () => {};
    checkIn.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    open();
    type('k7qm');
    await send();
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith(ID, 'K7QM');
    expect(submit().getAttribute('aria-busy')).toBe('true');
    expect(submit().textContent).toContain(C.checkin.submitting);
    expect(field().readOnly).toBe(true);
    await send();
    expect(checkIn).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle({ ok: false, error: 'failed' });
    });
    expect(field().readOnly).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe(C.checkin.errors.failed);
  });

  it('3. a wrong code: the inline alert, and the value is KEPT and SELECTED for retyping', async () => {
    checkIn.mockResolvedValue({ ok: false, error: 'wrong_code' });
    open();
    type('k7qn');
    await send();
    expect(screen.getByRole('alert').textContent).toBe(C.checkin.errors.wrongCode);
    expect(field().value).toBe('K7QN');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(4);
    expect(refresh).not.toHaveBeenCalled();
    // Retyping clears the message and the submit works again.
    type('k7qm');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('4. the guess bound: the inline alert, and the submit stays disabled until a refresh, even after editing', async () => {
    checkIn.mockResolvedValue({ ok: false, error: 'too_many_attempts' });
    open();
    type('q2wx');
    await send();
    expect(screen.getByRole('alert').textContent).toBe(C.checkin.errors.tooManyAttempts);
    expect(submit().disabled).toBe(true);
    type('k7qm');
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(C.checkin.errors.tooManyAttempts);
    await send();
    expect(checkIn).toHaveBeenCalledTimes(1);
  });

  it('5. a race: the window closed or the event was cancelled while typing → the inline sentence, then a refresh', async () => {
    for (const [error, text] of [
      ['checkin_closed', C.checkin.errors.notOpen],
      ['checkin_not_open', C.checkin.errors.notOpen],
      ['cancelled', C.errors.cancelled],
    ] as const) {
      refresh.mockReset();
      checkIn.mockResolvedValue({ ok: false, error });
      const { unmount } = open();
      type('k7qm');
      await send();
      expect(screen.getByRole('alert').textContent, error).toBe(text);
      expect(refresh, error).toHaveBeenCalledTimes(1);
      unmount();
    }
  });
});

describe('CheckinForm — the done state (UI-D-208, E08/populated)', () => {
  it('6. success swaps in place: the heading receives focus, the server line, the outline link back; one refresh', async () => {
    checkIn.mockResolvedValue({ ok: true, outcome: 'walk_in', doneLine: 'Realizado às 18:42' });
    open();
    type('k7qm');
    await send();
    const heading = screen.getByRole('heading', { name: C.checkin.doneTitle });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
    expect(screen.getByTestId('checkin-done-at').textContent).toBe('Realizado às 18:42');
    const back = screen.getByRole('link', { name: C.checkin.back });
    expect(back.getAttribute('href')).toBe(DETAIL);
    expect(back.className).toContain('border');
    expect(back.className).not.toContain('bg-brand');
    // Before, the button; after, the circle: never both brand fills.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('checkin-form')).toBeNull();
    const circle = screen.getByTestId('checkin-done-circle');
    expect(circle.className).toContain('bg-brand');
    expect(circle.className).toContain('h-14');
    expect(circle.getAttribute('data-animate')).toBe('spring');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('7a. under prefers-reduced-motion the circle renders still, with no scale', async () => {
    preferReducedMotion(true);
    checkIn.mockResolvedValue({ ok: true, outcome: 'checked_in', doneLine: 'Realizado às 18:42' });
    open();
    type('k7qm');
    await send();
    const circle = screen.getByTestId('checkin-done-circle');
    expect(circle.getAttribute('data-animate')).toBe('still');
    expect(circle.getAttribute('style') ?? '').not.toContain('scale(0)');
    // Focus still moves: reduced motion changes the motion, not the announcement.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: C.checkin.doneTitle }));
  });

  it('7b. a page that LOADS already done shows the same state, still and unfocused, with no form', () => {
    render(<CheckinForm eventId={ID} detailHref={DETAIL} doneLine="Realizado às 18:42" />);
    expect(screen.getByRole('heading', { name: C.checkin.doneTitle })).toBeTruthy();
    expect(screen.getByTestId('checkin-done-at').textContent).toBe('Realizado às 18:42');
    expect(screen.getByTestId('checkin-done-circle').getAttribute('data-animate')).toBe('still');
    expect(document.activeElement).not.toBe(
      screen.getByRole('heading', { name: C.checkin.doneTitle }),
    );
    expect(screen.queryByTestId('checkin-form')).toBeNull();
    expect(checkIn).not.toHaveBeenCalled();
  });
});
