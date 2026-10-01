// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RealtimeApi, type RealtimeClientLike, RealtimeProvider, useRealtime } from '../ui';

/**
 * 07 review A-WR-05: leaving a topic and joining it again before the leave completed. realtime-js keeps
 * a leaving channel in `client.channels` until its leave finishes, and `client.channel(topic)` hands
 * that same channel back; its `subscribe()` is then a silent no-op and the topic stays dead. The
 * provider must wait for the removal before it opens the topic again.
 */

afterEach(() => {
  cleanup();
});

function fakeRealtime() {
  let finishLeave: () => void = () => {};
  const subscribed: string[] = [];
  const client = {
    setAuth: vi.fn(async () => {}),
    channel: vi.fn((topic: string) => {
      const handle = {
        on: () => handle,
        subscribe: (cb?: (status: string) => void) => {
          subscribed.push(topic);
          cb?.('SUBSCRIBED');
          return handle;
        },
      };
      return handle;
    }),
    // The leave completes only when the test says so.
    removeChannel: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishLeave = () => resolve('ok');
        }),
    ),
    disconnect: vi.fn(async () => 'ok'),
  };
  return {
    client,
    factory: () => client as unknown as RealtimeClientLike,
    subscribed,
    finishLeave: () => finishLeave(),
  };
}

function Capture({ onApi }: { onApi: (api: RealtimeApi | null) => void }) {
  const api = useRealtime();
  useEffect(() => onApi(api), [api, onApi]);
  return null;
}

describe('RealtimeProvider: a same-topic re-join while the leave is in flight (A-WR-05)', () => {
  it('opens the topic again only after the removal finished, and the new channel joins', async () => {
    const fake = fakeRealtime();
    let api: RealtimeApi | null = null;
    render(
      <RealtimeProvider
        supabaseUrl="http://supabase.test"
        publishableKey="pk"
        tokenUrl="/api/realtime/token"
        clientFactory={fake.factory}
      >
        <Capture
          onApi={(value) => {
            api = value;
          }}
        />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(api).not.toBeNull());
    const topic = 'tenant:t:user:u';
    const first = vi.fn();
    const leave = (api as unknown as RealtimeApi).join(topic, ['x'], () => {}, first);
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(fake.client.channel).toHaveBeenCalledTimes(1);

    // Leave, then re-join at once: the leave has not completed yet.
    leave();
    const second = vi.fn();
    (api as unknown as RealtimeApi).join(topic, ['x'], () => {}, second);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fake.client.channel).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // The leave completes: only now is a FRESH channel created, and it joins.
    await act(async () => {
      fake.finishLeave();
    });
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(fake.client.channel).toHaveBeenCalledTimes(2);
    expect(fake.subscribed).toEqual([topic, topic]);
  });
});
