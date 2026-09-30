'use client';

import { useEffect, useRef } from 'react';
import { type SignalHandler, useRealtime } from './RealtimeProvider';

export interface UseRealtimeTopicOptions {
  /** Runs on the first join and on every re-join (D-240: refetch, never rely on replay). */
  onSubscribed?: () => void;
}

/**
 * Listen to `events` on one private topic through the window's `RealtimeProvider`.
 *
 * A no-op outside a provider (the platform shell, unit tests) and for a `null` topic. It re-joins when
 * the topic or the event list changes; the handlers are read through refs, so a re-render with new
 * closures never costs a leave and a join. Topics come from the `@rede-social/contracts/realtime`
 * builders, never from string concatenation in a component.
 */
export function useRealtimeTopic(
  topic: string | null,
  events: ReadonlyArray<string>,
  onSignal: SignalHandler,
  options: UseRealtimeTopicOptions = {},
): void {
  const realtime = useRealtime();
  const signalRef = useRef(onSignal);
  const subscribedRef = useRef(options.onSubscribed);
  signalRef.current = onSignal;
  subscribedRef.current = options.onSubscribed;

  const eventsKey = events.join('\n');

  useEffect(() => {
    if (!realtime || !topic) return;
    const list = eventsKey.split('\n').filter(Boolean);
    return realtime.join(
      topic,
      list,
      (event, payload) => signalRef.current(event, payload),
      () => subscribedRef.current?.(),
    );
  }, [realtime, topic, eventsKey]);
}
