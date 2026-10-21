// @vitest-environment happy-dom
import { type BroadcastMessage, RealtimeProvider } from '@rede-social/core/ui';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-17 (PAY-24, PAY-34, D-506, D-508, UI-D-525, UI-D-532, T-09.1-79, T-09.1-83, flagged P78) — the
 * gateway action zone: a link to the tenant's payment page, the disabled "Indisponível" branch, and the
 * live refresh into the owned block. The socket is a FAKE realtime client injected through the REAL
 * `RealtimeProvider` (the `live-counters.test.tsx` shape); `router.refresh` is a spy. A signal only
 * requests a refetch, so the assertions count refreshes.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const { GatewayPurchase } = await import('./GatewayPurchase');

const TENANT = '0d000000-0000-4000-8000-00000000aaaa';
const USER = '0d000000-0000-4000-8000-00000000bbbb';
const TOPIC = `tenant:${TENANT}:user:${USER}`;
const OTHER = `tenant:${TENANT}:user:0d000000-0000-4000-8000-00000000cccc`;
const HREF = 'https://pay.example/checkout/abc';

const LABELS = {
  buy: 'Comprar',
  newTab: '(abre a página de pagamento em uma nova aba)',
  helper:
    'O valor final e a forma de pagamento aparecem na página de pagamento. Quando o pagamento for confirmado, o produto é liberado aqui.',
  unavailable: 'Indisponível',
  unavailableNote: 'Este produto não está à venda no momento.',
};

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
    status: (topic: string, status: string) => act(() => latest(topic)?.onStatus?.(status)),
    emit: (topic: string, event: string, payload: unknown = { kind: 'payments.purchase' }) =>
      act(() => latest(topic)?.onBroadcast?.({ event, payload })),
  };
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  nav.refresh.mockClear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function zone(fake: ReturnType<typeof fakeRealtime>, checkoutHref: string | null = HREF) {
  return (
    <RealtimeProvider
      supabaseUrl="http://supabase.test"
      publishableKey="pk"
      tokenUrl="/api/realtime/token"
      clientFactory={fake.factory}
    >
      <GatewayPurchase
        checkoutHref={checkoutHref}
        tenantId={TENANT}
        userId={USER}
        labels={LABELS}
      />
    </RealtimeProvider>
  );
}

async function mounted(fake: ReturnType<typeof fakeRealtime>, checkoutHref: string | null = HREF) {
  const view = render(zone(fake, checkoutHref));
  await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
  return view;
}

describe('GatewayPurchase render (D-506, D-508, UI-D-525, UI-D-532, T-09.1-79)', () => {
  it('with a link: one anchor to the checkout, a new tab with noopener noreferrer, the glyph, the word and the hidden suffix', () => {
    render(zone(fakeRealtime()));
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(HREF);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.hasAttribute('data-store-buy-gateway')).toBe(true);
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(link.textContent).toContain('Comprar');
    const suffix = link.querySelector('.sr-only');
    expect(suffix?.textContent).toBe(LABELS.newTab);
    // The accessible name carries the suffix, so a screen reader hears the new tab.
    expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe(`Comprar ${LABELS.newTab}`);
  });

  it('the link is the brand lg full-width button look; it carries no click handler or action', () => {
    render(zone(fakeRealtime()));
    const link = screen.getByRole('link');
    expect(link.className).toContain('bg-button');
    expect(link.className).toContain('h-13');
    expect(link.className).toContain('w-full');
  });

  it('prints the helper 8px under the link as 12/400 tertiary text', () => {
    render(zone(fakeRealtime()));
    const helper = screen.getByText(LABELS.helper);
    expect(helper.className).toContain('mt-2');
    expect(helper.className).toContain('text-xs');
    expect(helper.className).toContain('font-normal');
    expect(helper.className).toContain('text-text-tertiary');
    expect(screen.queryByText(LABELS.unavailable)).toBeNull();
  });

  it('without a link: a disabled outline lg full-width Indisponível button, the note, and no anchor', () => {
    render(zone(fakeRealtime(), null));
    expect(screen.queryByRole('link')).toBeNull();
    const button = screen.getByRole('button', { name: 'Indisponível' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.className).toContain('border-border-secondary');
    expect(button.className).toContain('h-13');
    expect(button.className).toContain('w-full');
    expect(screen.getByText(LABELS.unavailableNote)).toBeTruthy();
    expect(screen.queryByText(LABELS.helper)).toBeNull();
    expect(screen.queryByText('Comprar')).toBeNull();
  });
});

describe('GatewayPurchase live refresh (PAY-34, D-240, T-09.1-83, flagged P78)', () => {
  it('joins ONLY the member own user topic, privately', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    expect(fake.channels.map((c) => c.topic)).toEqual([TOPIC]);
    expect(fake.channels[0]?.options).toEqual({ config: { private: true } });
  });

  it('a notifications.changed signal refreshes the page once', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('another event on the topic does not refresh', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fake.emit(TOPIC, 'chat.message', { conversationId: 'x', seq: 1 });
    fake.emit(TOPIC, 'feed.changed');
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('a broadcast on another member topic never reaches this page', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    expect(fake.channels.some((c) => c.topic === OTHER)).toBe(false);
  });

  it('skips the redundant first-join callback and refreshes on every re-join', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fake.status(TOPIC, 'SUBSCRIBED');
    expect(nav.refresh).not.toHaveBeenCalled();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);
    fake.status(TOPIC, 'CLOSED');
    fake.status(TOPIC, 'SUBSCRIBED');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('throttles a burst to one immediate and one trailing refresh per 1500 ms, never looping', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });

  it('a signal after the window passed refreshes at once again', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    fake.emit(TOPIC, 'notifications.changed');
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });

  it('the pending trailing refresh is cleared when the zone unmounts', async () => {
    const fake = fakeRealtime();
    const view = await mounted(fake);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the tab becomes visible again (a person who paid in the new tab), not when it hides', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(nav.refresh).not.toHaveBeenCalled();
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('outside a realtime provider it is a no-op, and the visibility refresh still works', () => {
    render(<GatewayPurchase checkoutHref={HREF} tenantId={TENANT} userId={USER} labels={LABELS} />);
    expect(nav.refresh).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('the Indisponível branch keeps the same live refresh', async () => {
    const fake = fakeRealtime();
    await mounted(fake, null);
    fake.emit(TOPIC, 'notifications.changed');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});
