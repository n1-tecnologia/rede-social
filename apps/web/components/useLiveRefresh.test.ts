// @vitest-environment happy-dom
import { type BroadcastMessage, RealtimeProvider } from '@rede-social/core/ui';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_REFRESH_THROTTLE_MS, useLiveRefresh } from './useLiveRefresh';

/**
 * Phase 10.1-12 (D-756, PAY-34, D-240, T-09.1-83, UI-D-748) — the Realtime-to-refresh machine extracted
 * from `GatewayPurchase` and shared with the paid event's zone. The socket is a FAKE realtime client
 * injected through the REAL `RealtimeProvider` (the `GatewayPurchase.test.tsx` shape); the refresh
 * callback is a spy. A signal only requests a refetch, so every assertion counts refreshes.
 *
 * Claims: it joins ONLY the member's own user topic, privately; one immediate and one trailing refresh
 * per 1500 ms; the redundant first join is skipped and every re-join refreshes; the tab turning visible
 * refreshes (and hiding does not); timers die with the component; outside a provider, or without a
 * user, only the visibility refresh runs; a fresh closure is used without a leave and a join.
 */

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
    status: (topic: string, status: string) => act(() => latest(topic)?.onStatus?.(status)),
    emit: (topic: string, event: string, payload: unknown = { kind: 'payments.ticket' }) =>
      act(() => latest(topic)?.onBroadcast?.({ event, payload })),
  };
}

let visibility: DocumentVisibilityState = 'visible';
const refresh = vi.fn();

beforeEach(() => {
  refresh.mockReset();
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

function mount(
  fake: ReturnType<typeof fakeRealtime>,
  ids: [string | null, string | null] = [TENANT, USER],
) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(RealtimeProvider, {
      supabaseUrl: 'http://supabase.test',
      publishableKey: 'pk',
      tokenUrl: '/api/realtime/token',
      clientFactory: fake.factory,
      children,
    });
  return renderHook(({ cb }: { cb: () => void }) => useLiveRefresh(ids[0], ids[1], cb), {
    wrapper,
    initialProps: { cb: refresh },
  });
}

async function mounted(fake: ReturnType<typeof fakeRealtime>) {
  const view = mount(fake);
  await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(1));
  return view;
}

const fakeClock = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(Date.now() + 10_000);
};

describe('useLiveRefresh (D-756, UI-D-748)', () => {
  it('the window is 1500 ms', () => {
    expect(LIVE_REFRESH_THROTTLE_MS).toBe(1500);
  });

  it('joins ONLY the member own user topic, privately', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    expect(fake.channels.map((c) => c.topic)).toEqual([TOPIC]);
    expect(fake.channels[0]?.options).toEqual({ config: { private: true } });
  });

  it('a notifications.changed signal refreshes once; another event does not', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fake.emit(TOPIC, 'chat.message', { conversationId: 'x', seq: 1 });
    fake.emit(TOPIC, 'feed.changed');
    expect(refresh).not.toHaveBeenCalled();
    fake.emit(TOPIC, 'notifications.changed');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('throttles a burst to one immediate and one trailing call, never looping', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fakeClock();
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a signal after the window passed refreshes at once again', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fakeClock();
    fake.emit(TOPIC, 'notifications.changed');
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    fake.emit(TOPIC, 'notifications.changed');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('skips the redundant first join and refreshes on every re-join', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fake.status(TOPIC, 'SUBSCRIBED');
    expect(refresh).not.toHaveBeenCalled();
    fakeClock();
    fake.status(TOPIC, 'CLOSED');
    fake.status(TOPIC, 'SUBSCRIBED');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the tab becomes visible again, not when it hides', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fakeClock();
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).not.toHaveBeenCalled();
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the pending trailing call and the visibility listener on unmount', async () => {
    const fake = fakeRealtime();
    const view = await mounted(fake);
    fakeClock();
    fake.emit(TOPIC, 'notifications.changed');
    fake.emit(TOPIC, 'notifications.changed');
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('outside a realtime provider it is a no-op, and the visibility refresh still works', () => {
    renderHook(() => useLiveRefresh(TENANT, USER, refresh));
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('with no tenant or user it joins nothing', async () => {
    const fake = fakeRealtime();
    mount(fake, [null, null]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.client.channel).not.toHaveBeenCalled();
  });

  it('uses the latest closure without leaving and joining again', async () => {
    const fake = fakeRealtime();
    const view = await mounted(fake);
    const later = vi.fn();
    view.rerender({ cb: later });
    fake.emit(TOPIC, 'notifications.changed');
    expect(later).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(fake.client.channel).toHaveBeenCalledTimes(1);
  });
});
