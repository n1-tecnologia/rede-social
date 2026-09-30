// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BroadcastMessage,
  LiveCountersProvider,
  type RealtimeClientLike,
  RealtimeProvider,
  SlotBadgeLabelsProvider,
  TopBar,
  useLiveCounters,
} from '../ui';

/**
 * 07-03 (NOTIF-02, D-239, D-240, UI-D-253, UI-D-265): the kernel's live layer against a FAKE realtime
 * client injected through `RealtimeProvider`'s `clientFactory`. What is real: the provider's join
 * bookkeeping and hygiene, `LiveCountersProvider`, the TopBar's live read. What is fake: the socket
 * (the live service is `apps/api/tests/integration/realtime.test.ts`'s subject) and `fetch`.
 */

const route = vi.hoisted(() => ({ pathname: '/inicio' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const TENANT = '0d000000-0000-4000-8000-00000000aaaa';
const USER = '0d000000-0000-4000-8000-00000000bbbb';
const TOPICS = [`tenant:${TENANT}:user:${USER}`, `tenant:${TENANT}:all`];

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
    factory: vi.fn(() => client as unknown as RealtimeClientLike),
    channels,
    status: (topic: string, status: string) => act(() => latest(topic)?.onStatus?.(status)),
    emit: (topic: string, event: string, payload: unknown = { kind: 'feed.post' }) =>
      act(() => latest(topic)?.onBroadcast?.({ event, payload })),
  };
}

let answers: Array<{ unreadNotifications: number; unreadConversations: number } | 'fail'> = [];
const fetchMock = vi.fn(async (_url: string) => {
  const next = answers.shift();
  if (!next || next === 'fail') return new Response(null, { status: 502 });
  return new Response(JSON.stringify(next), { status: 200 });
});

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  answers = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Count() {
  const counters = useLiveCounters();
  return <span data-testid="count">{counters ? counters.unreadNotifications : 'none'}</span>;
}

function tree(fake: ReturnType<typeof fakeRealtime>, initial = 0) {
  return (
    <RealtimeProvider
      supabaseUrl="http://supabase.test"
      publishableKey="pk"
      tokenUrl="/api/realtime/token"
      clientFactory={fake.factory}
    >
      <LiveCountersProvider
        initial={{ unreadNotifications: initial, unreadConversations: 0 }}
        countersUrl="/api/me/counters"
        topics={TOPICS}
      >
        <Count />
      </LiveCountersProvider>
    </RealtimeProvider>
  );
}

async function mounted(fake: ReturnType<typeof fakeRealtime>, initial = 0) {
  const view = render(tree(fake, initial));
  await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(2));
  return view;
}

const counterFetches = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/me/counters').length;

describe('RealtimeProvider + LiveCountersProvider (07-03)', () => {
  it('joins each topic once, privately, after the token is resolved, on ONE client', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    expect(fake.factory).toHaveBeenCalledTimes(1);
    expect(fake.factory).toHaveBeenCalledWith('http://supabase.test/realtime/v1', {
      params: { apikey: 'pk' },
      accessToken: expect.any(Function),
    });
    expect(fake.client.setAuth).toHaveBeenCalledTimes(1);
    expect(fake.channels.map((c) => c.topic)).toEqual(TOPICS);
    for (const channel of fake.channels)
      expect(channel.options).toEqual({ config: { private: true } });
  });

  it('a notifications.changed signal triggers ONE refetch and updates the consumer', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    expect(screen.getByTestId('count')).toHaveTextContent('0');

    answers.push({ unreadNotifications: 1, unreadConversations: 0 });
    fake.emit(TOPICS[1] as string, 'notifications.changed');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(counterFetches()).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/me/counters', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
  });

  it('another event on the topic does not refetch', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    fake.emit(TOPICS[0] as string, 'chat.message', { conversationId: 'x', seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(counterFetches()).toBe(0);
  });

  it('D-240: SUBSCRIBED (first join and re-join) refetches', async () => {
    const fake = fakeRealtime();
    await mounted(fake, 0);
    answers.push({ unreadNotifications: 2, unreadConversations: 0 });
    fake.status(TOPICS[0] as string, 'SUBSCRIBED');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    answers.push({ unreadNotifications: 5, unreadConversations: 0 });
    fake.status(TOPICS[0] as string, 'SUBSCRIBED');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('5'));
    expect(counterFetches()).toBe(2);
  });

  it('D-240: visibilitychange to visible refetches', async () => {
    const fake = fakeRealtime();
    await mounted(fake);
    answers.push({ unreadNotifications: 3, unreadConversations: 0 });
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'));
  });

  it('UI-D-265: a failed refetch keeps the last value', async () => {
    const fake = fakeRealtime();
    await mounted(fake, 4);
    answers.push('fail');
    fake.emit(TOPICS[1] as string, 'notifications.changed');
    await waitFor(() => expect(counterFetches()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('count')).toHaveTextContent('4');
  });

  it('D-239: every counters change sets the app badge (clear at zero)', async () => {
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    Object.assign(navigator, { setAppBadge, clearAppBadge });
    try {
      const fake = fakeRealtime();
      await mounted(fake, 0);
      expect(clearAppBadge).toHaveBeenCalled();
      answers.push({ unreadNotifications: 2, unreadConversations: 1 });
      fake.emit(TOPICS[1] as string, 'notifications.changed');
      await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(3));
    } finally {
      Reflect.deleteProperty(navigator, 'setAppBadge');
      Reflect.deleteProperty(navigator, 'clearAppBadge');
    }
  });

  it('hidden for 60 s drops the socket; visible again re-joins and refetches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = fakeRealtime();
    await mounted(fake);

    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.client.removeChannel).toHaveBeenCalledTimes(2);

    answers.push({ unreadNotifications: 6, unreadConversations: 0 });
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(fake.client.channel).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('6'));
  });

  it('unmounting the tree disconnects the client exactly once', async () => {
    const fake = fakeRealtime();
    const view = await mounted(fake);
    view.unmount();
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('outside any provider the counters are null (the static prop stays in charge)', () => {
    render(<Count />);
    expect(screen.getByTestId('count')).toHaveTextContent('none');
  });
});

describe('TopBar reads the live counters and the host slot label (UI-D-253)', () => {
  const bell = {
    key: 'notifications',
    href: '/notificacoes',
    icon: 'bell',
    label: 'Notificações',
    badge: 'unreadNotifications' as const,
  };

  function bar(counters: { unreadNotifications: number; unreadConversations: number } | null) {
    const topBar = (
      <SlotBadgeLabelsProvider
        value={(badge, count) =>
          badge === 'unreadNotifications' ? `Notificações, ${count} novas` : undefined
        }
      >
        <TopBar
          brand={{ displayName: 'Rede Demo', logoUrl: null }}
          slots={[bell]}
          counters={{ unreadNotifications: 0, unreadConversations: 0 }}
          avatar={{ src: null, alt: 'Maria' }}
          profileLabel="Meu perfil"
        />
      </SlotBadgeLabelsProvider>
    );
    if (!counters) return topBar;
    return (
      <LiveCountersProvider initial={counters} countersUrl="/api/me/counters" topics={[]}>
        {topBar}
      </LiveCountersProvider>
    );
  }

  it('the live count wins over the static prop; the name carries the state; the badge is aria-hidden', () => {
    render(bar({ unreadNotifications: 3, unreadConversations: 0 }));
    const link = screen.getByRole('link', { name: 'Notificações, 3 novas' });
    expect(link).toHaveTextContent('3');
    expect(link.querySelector('[aria-hidden] span')).toHaveTextContent('3');
  });

  it('at zero the name is the plain label and no badge renders', () => {
    render(bar({ unreadNotifications: 0, unreadConversations: 0 }));
    const link = screen.getByRole('link', { name: 'Notificações' });
    expect(link).not.toHaveTextContent(/\d/);
  });

  it('without a provider the static prop (0) is shown', () => {
    render(bar(null));
    expect(screen.getByRole('link', { name: 'Notificações' })).not.toHaveTextContent(/\d/);
  });
});
