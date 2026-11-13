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

const { catalog, refresh, checkIn, returnAfterSave } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('events').events as Record<string, unknown>,
    refresh: vi.fn(),
    checkIn: vi.fn(),
    returnAfterSave: vi.fn(() => false),
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
vi.mock('@/lib/form-exit', () => ({ returnAfterSave }));

const { CheckinForm } = await import('./CheckinForm');
const { CheckinState } = await import('./CheckinState');

const C = catalog as {
  checkin: {
    codeLabel: string;
    submit: string;
    submitting: string;
    doneTitle: string;
    doneBack: string;
    paid: string;
    closed: string;
    notOpenYet: string;
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
      // Phase 10.1-13 (D-742, UI-D-752): a paid event and no presence, from a page rendered earlier.
      ['payment_required', C.checkin.paid],
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
    const back = screen.getByRole('link', { name: C.checkin.doneBack });
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

  it('6b. "Voltar para o evento" steps back to the event it was opened from; otherwise it is a plain link', async () => {
    checkIn.mockResolvedValue({ ok: true, outcome: 'walk_in', doneLine: 'Realizado às 18:42' });
    open();
    type('k7qm');
    await send();
    const back = screen.getByRole('link', { name: C.checkin.doneBack });

    // A modified click keeps the link's own navigation, and asks nothing.
    expect(fireEvent.click(back, { ctrlKey: true })).toBe(true);
    expect(returnAfterSave).not.toHaveBeenCalled();

    // No event screen behind: the link navigates as before.
    returnAfterSave.mockReturnValueOnce(false);
    expect(fireEvent.click(back)).toBe(true);
    expect(returnAfterSave).toHaveBeenLastCalledWith(expect.anything(), DETAIL);

    // The event behind: the step back replaces the link's navigation (2026-10-09).
    returnAfterSave.mockReturnValueOnce(true);
    expect(fireEvent.click(back)).toBe(false);
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

describe('CheckinState — the paid section (Phase 10.1-13, D-742, UI-D-752, T-10.1-05, T-10.1-24)', () => {
  const E = catalog as { enter: { cta: string }; ticket: { cta: { buy: string; newTab: string } } };
  const BUY = 'https://pay.example.test/ingresso';
  const paid = {
    detailHref: DETAIL,
    buyLabel: E.ticket.cta.buy,
    newTabLabel: E.ticket.cta.newTab,
    detailLabel: E.enter.cta,
  };
  const section = (buyHref: string | null) =>
    ({ kind: 'paid', sentence: C.checkin.paid, buyHref, price: null }) as const;

  it('draws the Lock block and the sentence, then the brand buy anchor above the outline "Ver evento"', () => {
    const { container } = render(<CheckinState section={section(BUY)} paid={paid} />);
    const state = screen.getByTestId('checkin-state');
    expect(state.getAttribute('data-kind')).toBe('paid');
    expect(container.querySelector('svg.lucide-lock')?.getAttribute('width')).toBe('28');
    expect(screen.getByText(C.checkin.paid).className).toContain('max-w-[280px]');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    const [buy, view] = links as HTMLAnchorElement[];
    expect(buy?.textContent).toContain(E.ticket.cta.buy);
    expect(buy?.textContent).toContain(E.ticket.cta.newTab);
    expect(buy?.getAttribute('href')).toBe(BUY);
    expect(buy?.getAttribute('target')).toBe('_blank');
    expect(buy?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(buy?.className).toContain('bg-button');
    expect(view?.textContent).toBe(E.enter.cta);
    expect(view?.getAttribute('href')).toBe(DETAIL);
    expect(view?.className).toContain('border-border-secondary');
    expect(view?.className).not.toContain('bg-button');
    // The card's ONE brand fill, and no controls at all.
    expect(container.querySelectorAll('.bg-button')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('without a purchase link only the outline "Ver evento" remains', () => {
    render(<CheckinState section={section(null)} paid={paid} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe(E.enter.cta);
  });

  it.each([
    ['http://pay.example.test/x'],
    ['javascript:alert(1)'],
    ['https://user:pw@pay.example.test/x'],
    ['nao e uma url'],
  ])('a link that is not a clean https: URL (%s) never becomes an anchor (T-10.1-24)', (href) => {
    render(<CheckinState section={section(href)} paid={paid} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByTestId('ticket-door-buy')).toBeNull();
  });

  it('shows no code form, no "abre 1 hora antes" sentence and no venue code for a non-holder (T-10.1-05)', () => {
    const { container } = render(<CheckinState section={section(BUY)} paid={paid} />);
    expect(screen.queryByTestId('checkin-form')).toBeNull();
    expect(screen.queryByLabelText(C.checkin.codeLabel)).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toMatch(/1 hora antes/);
  });

  it('the other closed sections keep their block with no actions (a free or closed event is unchanged)', () => {
    for (const kind of ['notOpenYet', 'closed', 'cancelled'] as const) {
      const { container, unmount } = render(
        <CheckinState section={{ kind, sentence: 'frase' }} paid={paid} />,
      );
      expect(screen.getByTestId('checkin-state').getAttribute('data-kind')).toBe(kind);
      expect(container.querySelector('a')).toBeNull();
      unmount();
    }
  });
});
