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
const { catalog } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return { catalog: read('events').events as Record<string, unknown> };
});

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
