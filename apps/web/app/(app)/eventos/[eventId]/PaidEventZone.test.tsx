// @vitest-environment happy-dom
import { type BroadcastMessage, RealtimeProvider } from '@rede-social/core/ui';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.1-12 (D-741, D-746, D-750, D-751, D-753, UI-D-746, UI-D-747) — the paid branch of the action
 * zone for a member WITHOUT a presence. The catalog is the REAL `events.json`, so a copy drift fails
 * here. Real: the island and `@rede-social/ui`'s `Button`. Stubbed: the router.
 *
 * Claims:
 *  1. the precedence of the zone, first match wins: cancelled and ended draw nothing, under way is the
 *     disabled "Vendas encerradas", an unavailable sale the disabled "Venda indisponível", a full event
 *     the disabled "Esgotado", otherwise the buy control;
 *  2. the buy control is ONE external anchor (`target="_blank"`, `rel="noopener noreferrer"`) whose href
 *     is the validated `https:` value and nothing else, with the hidden new-tab suffix, the hint under
 *     it and no processing text anywhere;
 *  3. an online event adds the Lock hint and never an `Entrar` button; an in-person one adds nothing;
 *  4. a member without a presence never meets Vou, Garantir minha vaga, Cancelar inscrição or the
 *     walk-in link; at most one brand fill;
 *  5. a non-`https:` href never reaches an anchor (T-10.1-24);
 *  6. (Task 3) the zone sits in a PERSISTENT polite live region from the first render of a paid event the
 *     member is not in, and a `notifications.changed` signal on the buyer's own topic refreshes the page
 *     (throttled, with a trailing call) so the server answers a presence: no toast, no state in the signal.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const { catalog, icu } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  // The real ICU translator, for the plural and select keys of the count (Phase 10.2).
  const real = createTranslator({
    locale: 'pt-BR',
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    namespace: 'events' as never,
  }) as unknown as (key: string, values?: Record<string, unknown>) => string;
  return { catalog: read('events').events as Record<string, unknown>, icu: real };
});

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  if (typeof raw === 'string' && /\{\w+, (plural|select)/.test(raw)) return icu(key, values);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => lookup(key, values),
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const { PaidEventZone } = await import('./PaidEventZone');

type Props = React.ComponentProps<typeof PaidEventZone>;

const HREF = 'https://pay.example/checkout/abc';
const T = catalog.ticket as {
  badge: string;
  cta: {
    buy: string;
    buyPrice: string;
    newTab: string;
    soldOut: string;
    salesClosed: string;
    unavailable: string;
  };
  hint: { afterPay: string; salesClosed: string; unavailable: string; onlineLink: string };
};
const FULL_HINT = (catalog.rsvp as { fullHint: string }).fullHint;

function zone(overrides: Partial<Props> = {}) {
  const props: Props = {
    zone: 'buy',
    phase: 'P0',
    format: 'in_person',
    cancelled: false,
    checkoutHref: HREF,
    priceLabel: null,
    ...overrides,
  };
  return render(<PaidEventZone {...props} />);
}

beforeEach(() => nav.refresh.mockReset());
afterEach(cleanup);

/** Every solid brand fill under `root`, as EventActions.test counts them. */
const brandFills = (root: Element) =>
  Array.from(root.querySelectorAll('*')).filter((node) =>
    /(^|\s)bg-(button|brand)(\s|$)/.test(node.getAttribute('class') ?? ''),
  );

const buy = () => screen.queryByTestId('event-actions-buy') as HTMLAnchorElement | null;

describe('PaidEventZone — the tracer: a paid event the member is not in (UI-D-747)', () => {
  it('1. draws ONE buy anchor to the validated href, in a new tab, with the hidden suffix and the hint', () => {
    const { container } = zone();
    const link = buy() as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(HREF);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe(`${T.cta.buy} ${T.cta.newTab}`);
    expect(link.querySelector('.sr-only')?.textContent).toBe(T.cta.newTab);
    expect(screen.getByText(T.hint.afterPay)).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    // The zone's one brand fill, at least 44px tall.
    expect(brandFills(container)).toHaveLength(1);
    expect(link.className).toContain('h-12');
    expect(link.className).toContain('bg-button');
  });

  it('2. no Vou, Garantir minha vaga, Cancelar inscrição, Entrar or walk-in link, and no processing text', () => {
    zone();
    const reine = (catalog.reine as { cta: { register: string; cancel: string } }).cta;
    expect(screen.queryByRole('button', { name: reine.register })).toBeNull();
    expect(screen.queryByRole('button', { name: reine.cancel })).toBeNull();
    expect(screen.queryByText(reine.cancel)).toBeNull();
    expect(screen.queryByTestId('event-actions-register')).toBeNull();
    expect(screen.queryByTestId('event-actions-unregister')).toBeNull();
    expect(screen.queryByTestId('event-actions-enter')).toBeNull();
    expect(screen.queryByTestId('event-actions-checkin')).toBeNull();
    expect(screen.queryByText(/processando/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('3. the label carries the price when the event has one, tabular, even at the longest realistic value', () => {
    zone({ priceLabel: 'R$ 80,00' });
    expect(buy()?.textContent).toContain('Comprar ingresso · R$ 80,00');
    cleanup();
    zone({ priceLabel: 'R$ 100.000,00' });
    const link = buy() as HTMLAnchorElement;
    expect(link.textContent).toContain('Comprar ingresso · R$ 100.000,00');
    // One text run on one line: the label is a single node, not split across wrapping blocks.
    expect(link.className).toContain('tabular-nums');
    expect(link.querySelectorAll('.sr-only')).toHaveLength(1);
  });

  it('4. the zone shell is the shipped one: data-testid, phase and the gap', () => {
    zone({ phase: 'P1' });
    const shell = screen.getByTestId('event-actions');
    expect(shell.getAttribute('data-phase')).toBe('P1');
    expect(shell.className).toContain('flex-col');
    expect(shell.className).toContain('gap-3');
  });
});

describe('PaidEventZone — the precedence of UI-D-746, first match wins', () => {
  const disabled = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('5. cancelled draws nothing, whatever else is true', () => {
    for (const zoneKind of ['none', 'buy', 'soldOut', 'salesClosed', 'unavailable'] as const) {
      const { container, unmount } = zone({ zone: zoneKind, cancelled: true });
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('6. ended (P3) draws nothing', () => {
    for (const zoneKind of ['none', 'buy', 'soldOut', 'unavailable'] as const) {
      const { container, unmount } = zone({ zone: zoneKind, phase: 'P3' });
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('7. under way: the disabled "Vendas encerradas" with its hint, no anchor', () => {
    const { container } = zone({ zone: 'salesClosed', phase: 'P2', checkoutHref: null });
    const button = disabled(T.cta.salesClosed);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(T.hint.salesClosed)).toBeTruthy();
    expect(buy()).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(brandFills(container).length).toBeLessThanOrEqual(1);
  });

  it('8. sale unavailable: the disabled "Venda indisponível" with its hint', () => {
    zone({ zone: 'unavailable', checkoutHref: null });
    expect(disabled(T.cta.unavailable).disabled).toBe(true);
    expect(screen.getByText(T.hint.unavailable)).toBeTruthy();
    expect(buy()).toBeNull();
  });

  it('9. full: the disabled "Esgotado" with the shipped full hint', () => {
    zone({ zone: 'soldOut', checkoutHref: null });
    expect(disabled(T.cta.soldOut).disabled).toBe(true);
    expect(screen.getByText(FULL_HINT)).toBeTruthy();
    expect(buy()).toBeNull();
  });

  it('10. a "buy" zone whose href is not https draws the unavailable state, never an anchor (T-10.1-24)', () => {
    for (const bad of [
      'http://pay.example/x',
      'javascript:alert(1)',
      'data:text/html,x',
      '/relative',
      'not a url',
      null,
    ]) {
      const { unmount } = zone({ zone: 'buy', checkoutHref: bad });
      expect(buy(), String(bad)).toBeNull();
      expect(screen.queryAllByRole('link'), String(bad)).toHaveLength(0);
      expect(disabled(T.cta.unavailable).disabled).toBe(true);
      unmount();
    }
  });

  it('11. every disabled state keeps at most one brand fill and the 44px height', () => {
    for (const zoneKind of ['salesClosed', 'unavailable', 'soldOut'] as const) {
      const { container, unmount } = zone({ zone: zoneKind, phase: 'P0', checkoutHref: null });
      expect(brandFills(container).length).toBeLessThanOrEqual(1);
      expect(container.querySelector('button')?.className).toContain('h-13');
      unmount();
    }
  });
});

describe('PaidEventZone — online and in person (D-742, UI-D-746)', () => {
  const lock = () => screen.queryByTestId('event-actions-online-hint');

  it('12. an online event adds the Lock hint under whichever state draws, and never an Entrar button', () => {
    for (const [zoneKind, phase] of [
      ['buy', 'P0'],
      ['unavailable', 'P0'],
      ['soldOut', 'P1'],
      ['salesClosed', 'P2'],
    ] as const) {
      const { unmount } = zone({
        zone: zoneKind,
        phase,
        format: 'online',
        checkoutHref: zoneKind === 'buy' ? HREF : null,
      });
      expect(lock()?.textContent).toBe(T.hint.onlineLink);
      expect(lock()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(screen.queryByTestId('event-actions-enter')).toBeNull();
      expect(screen.queryByText((catalog.online as { enter: string }).enter)).toBeNull();
      unmount();
    }
  });

  it('13. an in-person event adds no lock hint', () => {
    zone({ format: 'in_person' });
    expect(lock()).toBeNull();
  });
});

/* ── Task 3: the persistent live wrapper and the refresh into the confirmed state (UI-D-748) ───── */

const TENANT = '0d000000-0000-4000-8000-00000000aaaa';
const USER = '0d000000-0000-4000-8000-00000000bbbb';
const TOPIC = `tenant:${TENANT}:user:${USER}`;

interface FakeChannel {
  topic: string;
  options: { config: { private: boolean } };
  onBroadcast?: (message: BroadcastMessage) => void;
  onStatus?: (status: string) => void;
}

function fakeRealtime() {
  const channels: FakeChannel[] = [];
  const client = {
    setAuth: vi.fn(async () => {}),
    channel: vi.fn((topic: string, options: { config: { private: boolean } }) => {
      const channel: FakeChannel = { topic, options };
      channels.push(channel);
      const handle = {
        on: (_type: 'broadcast', _filter: { event: string }, cb: (m: BroadcastMessage) => void) => {
          channel.onBroadcast = cb;
          return handle;
        },
        subscribe: (cb?: (status: string) => void) => {
          channel.onStatus = cb;
          return handle;
        },
      };
      return handle;
    }),
    removeChannel: vi.fn(async () => 'ok'),
    disconnect: vi.fn(async () => 'ok'),
  };
  const latest = (topic: string) => [...channels].reverse().find((c) => c.topic === topic);
  return {
    client,
    factory: vi.fn(() => client as never),
    channels,
    emit: (topic: string, event: string, payload: unknown = { kind: 'payments.ticket' }) =>
      act(() => latest(topic)?.onBroadcast?.({ event, payload })),
  };
}

function live(fake: ReturnType<typeof fakeRealtime>, overrides: Partial<Props> = {}) {
  return (
    <RealtimeProvider
      supabaseUrl="http://supabase.test"
      publishableKey="pk"
      tokenUrl="/api/realtime/token"
      clientFactory={fake.factory}
    >
      <PaidEventZone
        zone="buy"
        phase="P0"
        format="in_person"
        cancelled={false}
        checkoutHref={HREF}
        priceLabel={null}
        tenantId={TENANT}
        userId={USER}
        {...overrides}
      />
    </RealtimeProvider>
  );
}

describe('PaidEventZone — the persistent live region (D-756, UI-D-748)', () => {
  it('14. the polite wrapper is in the DOM before any signal, around the zone, for every drawn state', () => {
    for (const [zoneKind, phase] of [
      ['buy', 'P0'],
      ['unavailable', 'P0'],
      ['soldOut', 'P1'],
      ['salesClosed', 'P2'],
    ] as const) {
      const { unmount } = zone({
        zone: zoneKind,
        phase,
        checkoutHref: zoneKind === 'buy' ? HREF : null,
      });
      const wrapper = screen.getByTestId('event-actions-live');
      expect(wrapper.getAttribute('aria-live')).toBe('polite');
      expect(wrapper.contains(screen.getByTestId('event-actions'))).toBe(true);
      unmount();
    }
  });

  it('15. a cancelled or ended event has nothing to wait for: no wrapper', () => {
    zone({ cancelled: true });
    expect(screen.queryByTestId('event-actions-live')).toBeNull();
    cleanup();
    zone({ phase: 'P3', zone: 'none' });
    expect(screen.queryByTestId('event-actions-live')).toBeNull();
  });

  it('16. joins ONLY the member own user topic, privately', async () => {
    const fake = fakeRealtime();
    render(live(fake));
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    expect(fake.channels.map((c) => c.topic)).toEqual([TOPIC]);
    expect(fake.channels[0]?.options).toEqual({ config: { private: true } });
  });

  it('17. a notifications.changed signal refreshes the page once; another event does not', async () => {
    const fake = fakeRealtime();
    render(live(fake));
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    fake.emit(TOPIC, 'chat.message', { conversationId: 'x', seq: 1 });
    expect(nav.refresh).not.toHaveBeenCalled();
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    // The signal changed nothing on its own: the zone is exactly what the server last said.
    expect(screen.getByTestId('event-actions-buy').getAttribute('href')).toBe(HREF);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/presença confirmada/i)).toBeNull();
  });

  it('18. two signals inside 1500 ms give one immediate and one trailing refresh', async () => {
    const fake = fakeRealtime();
    render(live(fake));
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('19. once the server answers a presence the wrapper stays, holds the shipped zone and the hook is gone', async () => {
    const fake = fakeRealtime();
    const view = render(live(fake));
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
    const wrapper = screen.getByTestId('event-actions-live');
    view.rerender(
      live(fake, { waiting: false, children: <p data-testid="shipped-zone">shipped</p> }),
    );
    // The SAME node: a live region that is replaced is not announced.
    expect(screen.getByTestId('event-actions-live')).toBe(wrapper);
    expect(wrapper.getAttribute('aria-live')).toBe('polite');
    expect(wrapper.contains(screen.getByTestId('shipped-zone'))).toBe(true);
    expect(screen.queryByTestId('event-actions-buy')).toBeNull();
    // Nothing listens any more: a later signal refreshes nothing.
    nav.refresh.mockReset();
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

/* ── Phase 10.2-13: the `soon` branch (OPEN-08, D-786, D-789, UI-D-784) ─────────────────────────── */

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function soonBlock(remainingMs: number, overrides: Record<string, unknown> = {}) {
  return {
    opensAt: new Date(SEED_MS + remainingMs).toISOString(),
    serverNow: SEED,
    dateLabel: '20 nov',
    timeLabel: '10:00',
    zoneLabel: 'Horário de Brasília',
    price: 'R$ 80,00',
    ...overrides,
  } as NonNullable<Props['soon']>;
}

function soonZone(remainingMs: number, overrides: Partial<Props> = {}) {
  return zone({ zone: 'soon', checkoutHref: null, soon: soonBlock(remainingMs), ...overrides });
}

const cellTexts = () =>
  screen.queryAllByTestId('live-countdown-cell').map((cell) => cell.textContent);

describe('PaidEventZone — the soon branch, the tracer (OPEN-08, D-786, D-789)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SEED_MS);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('S1. a paid event before its opening draws the seeded cells, the exact opening and nothing to click', () => {
    const { container } = soonZone(2 * DAY + 4 * HOUR + 13 * MIN, { priceLabel: 'R$ 80,00' });
    expect(cellTexts()).toEqual(['02dias', '04horas', '13min']);
    expect(screen.getByTestId('event-soon-opens-at').textContent).toBe('Abertura: 20 nov, 10:00');
    expect(screen.getByTestId('event-soon-zone-label').textContent).toBe(
      'Fuso horário: Horário de Brasília',
    );
    expect(screen.getByTestId('event-soon-price').textContent).toBe('Ingresso: R$ 80,00');
    expect(container.querySelectorAll('button, a, [href]')).toHaveLength(0);
    expect(buy()).toBeNull();
    expect(screen.queryByTestId('event-actions-disabled')).toBeNull();
  });

  it('S2. a link prop is present and IGNORED: no anchor and no href anywhere in the soon zone (D-789, T-10.2-01)', () => {
    const { container } = soonZone(2 * DAY, { checkoutHref: HREF });
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('[href]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain(HREF);
    expect(container.innerHTML).not.toContain('pay.example');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // And the zone has none of the sale words before the opening.
    expect(screen.queryByText(T.cta.soldOut)).toBeNull();
    expect(screen.queryByText(T.cta.salesClosed)).toBeNull();
    expect(screen.queryByText(T.cta.unavailable)).toBeNull();
    expect(screen.queryByText(T.cta.buy)).toBeNull();
  });

  it('S3. zero by the seeded clock says Abrindo agora and still draws no link, even with a link prop', () => {
    const { container } = soonZone(0, { checkoutHref: HREF });
    expect(cellTexts()).toEqual(['Abrindo agora']);
    expect(container.querySelectorAll('a, button, [href]')).toHaveLength(0);
  });

  it('S4. the zone is a SIBLING of the polite wrapper, never inside it, and the wrapper holds no cell', () => {
    soonZone(2 * DAY + 4 * HOUR + 13 * MIN);
    const wrapper = screen.getByTestId('event-actions-live');
    expect(wrapper.getAttribute('aria-live')).toBe('polite');
    expect(wrapper.contains(screen.getByTestId('event-actions'))).toBe(false);
    expect(wrapper.querySelectorAll('[data-testid="live-countdown-cell"]')).toHaveLength(0);
    expect(wrapper.querySelectorAll('[role="timer"]')).toHaveLength(0);
    expect(screen.getAllByRole('timer')).toHaveLength(1);
    expect(screen.getByRole('timer').closest('[aria-live]')).toBeNull();
  });

  it('S5. an unseeded answer (an older API) draws the static opening line and no count', () => {
    soonZone(2 * DAY, { soon: soonBlock(2 * DAY, { serverNow: null }) });
    expect(cellTexts()).toEqual([]);
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
    expect(screen.getByTestId('event-soon-opens-at').textContent).toBe('Abertura: 20 nov, 10:00');
    expect(screen.getByTestId('event-soon-hint')).toBeTruthy();
  });

  it('S6. an online event adds the Lock hint and never an Entrar button', () => {
    soonZone(2 * DAY, { format: 'online' });
    expect(screen.getByTestId('event-actions-online-hint').textContent).toBe(T.hint.onlineLink);
    expect(screen.queryByTestId('event-actions-enter')).toBeNull();
  });

  it('S7. a cancelled or ended event draws nothing even if the zone says soon', () => {
    const { container } = soonZone(2 * DAY, { cancelled: true });
    expect(container.innerHTML).toBe('');
    cleanup();
    const ended = soonZone(2 * DAY, { phase: 'P3' });
    expect(ended.container.innerHTML).toBe('');
  });
});

/* ── Phase 10.2-13 Task 2: the polite wrapper speaks only the unit thresholds and the opening ───── */

describe('PaidEventZone — what the polite wrapper speaks while soon (UI-D-787, A-UI-16)', () => {
  const MS = (days: number, hours: number, minutes: number, seconds = 0) =>
    days * DAY + hours * HOUR + minutes * MIN + seconds * 1000;
  const MILESTONE = (
    catalog.ticket as { soon: { milestone: Record<string, string>; opened: string } }
  ).soon;
  const wrapperText = () => (screen.getByTestId('event-actions-live').textContent ?? '').trim();
  const tick = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SEED_MS);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('T1. the wrapper holds ONLY the hidden status sentence, never a cell, never the timer', () => {
    soonZone(2 * DAY);
    const wrapper = screen.getByTestId('event-actions-live');
    expect(wrapper.querySelectorAll('[data-testid="live-countdown-cell"]')).toHaveLength(0);
    expect(wrapper.querySelectorAll('[role="timer"]')).toHaveLength(0);
    // Nothing earlier than 24 h: the wrapper is silent.
    expect(wrapperText()).toBe('');
    expect(wrapper.querySelector('[data-testid="event-soon-status"]')?.className).toContain(
      'sr-only',
    );
  });

  it.each([
    ['25 hours', MS(1, 1, 0), ''],
    ['exactly 24 hours', DAY, ''],
    ['one minute under 24 hours', DAY - MIN, MILESTONE.milestone.day],
    ['one hour and one minute', HOUR + MIN, MILESTONE.milestone.day],
    ['exactly one hour', HOUR, MILESTONE.milestone.day],
    ['59 minutes', 59 * MIN, MILESTONE.milestone.hour],
    ['one minute', MIN, MILESTONE.milestone.hour],
    ['59 999 ms', 59_999, MILESTONE.milestone.minute],
    ['30 seconds', 30_000, MILESTONE.milestone.minute],
    ['zero', 0, ''],
  ])('T2. at %s the sentence is %j', (_label, remaining, sentence) => {
    soonZone(remaining as number);
    expect(wrapperText()).toBe(sentence);
  });

  it('T3. the whole wait speaks at most three status sentences, one per threshold, whatever the minutes', () => {
    soonZone(DAY + 2 * MIN);
    const spoken: string[] = [];
    let changes = 0;
    let last = wrapperText();
    for (let minute = 0; minute < DAY / MIN + 4; minute += 1) {
      tick(MIN);
      const now = wrapperText();
      if (now !== last) {
        changes += 1;
        if (now !== '') spoken.push(now);
        last = now;
      }
    }
    expect(spoken).toEqual([
      MILESTONE.milestone.day,
      MILESTONE.milestone.hour,
      MILESTONE.milestone.minute,
    ]);
    // Three sentences in, and the last one clears at zero without speaking.
    expect(changes).toBe(4);
  });

  it('T4. across a 10-minute advance the polite wrapper changes at most 3 times', () => {
    soonZone(HOUR + 5 * MIN);
    let changes = 0;
    let last = wrapperText();
    for (let minute = 0; minute < 10; minute += 1) {
      tick(MIN);
      const now = wrapperText();
      if (now !== last) changes += 1;
      last = now;
    }
    expect(changes).toBeLessThanOrEqual(3);
    // The day sentence is already there at 65 minutes; the hour sentence replaces it once.
    expect(changes).toBe(1);
  });

  it('T5. the one-time lead: a soon to buy swap announces As inscrições abriram. once, inside the same wrapper', () => {
    const view = soonZone(30_000);
    const wrapper = screen.getByTestId('event-actions-live');
    expect(screen.queryByTestId('event-actions-opened')).toBeNull();
    view.rerender(<PaidEventZone {...buyProps()} />);
    expect(screen.getByTestId('event-actions-live')).toBe(wrapper);
    const lead = screen.getByTestId('event-actions-opened');
    expect(lead.textContent).toBe(MILESTONE.opened);
    expect(lead.className).toContain('sr-only');
    expect(wrapper.contains(lead)).toBe(true);
    expect(buy()?.getAttribute('href')).toBe(HREF);
    expect(screen.getAllByText(MILESTONE.opened)).toHaveLength(1);
  });

  it('T6. a first load of an already-open event draws no lead, and a swap to sold out or unavailable none either', () => {
    zone();
    expect(screen.queryByTestId('event-actions-opened')).toBeNull();
    cleanup();
    for (const next of ['soldOut', 'unavailable'] as const) {
      const view = soonZone(30_000);
      view.rerender(<PaidEventZone {...buyProps({ zone: next, checkoutHref: null })} />);
      expect(screen.queryByTestId('event-actions-opened')).toBeNull();
      expect(screen.queryAllByTestId('live-countdown-cell')).toHaveLength(0);
      cleanup();
    }
  });
});

function buyProps(overrides: Partial<Props> = {}): Props {
  return {
    zone: 'buy',
    phase: 'P0',
    format: 'in_person',
    cancelled: false,
    checkoutHref: HREF,
    priceLabel: null,
    ...overrides,
  };
}
