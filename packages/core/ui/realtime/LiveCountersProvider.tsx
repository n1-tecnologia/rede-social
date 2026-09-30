'use client';

import { REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { applyAppBadge } from './app-badge';
import { useRealtime } from './RealtimeProvider';

/** The shell's badge counters (`bootstrapSchema.shape.counters`, kept structural: no server import). */
export interface LiveCounters {
  unreadNotifications: number;
  unreadConversations: number;
}

const LiveCountersContext = createContext<LiveCounters | null>(null);

/** The live counters, or `null` outside a provider (TopBar/DesktopRail then keep their static prop). */
export function useLiveCounters(): LiveCounters | null {
  return useContext(LiveCountersContext);
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isCounters = (value: unknown): value is LiveCounters =>
  typeof value === 'object' &&
  value !== null &&
  isCount((value as LiveCounters).unreadNotifications) &&
  isCount((value as LiveCounters).unreadConversations);

export interface LiveCountersProviderProps {
  /** The bootstrap's `counters`: what the server rendered, shown until the first refetch. */
  initial: LiveCounters;
  /** The BFF counters route, `/api/me/counters` in the web app (a GET route handler, `no-store`). */
  countersUrl: string;
  /** The private topics whose `notifications.changed` signal means "refetch". */
  topics: ReadonlyArray<string>;
  children: ReactNode;
}

/**
 * NOTIF-02 live bell (07-03, D-239, D-240, UI-D-265). Holds the counters, seeded from the bootstrap,
 * and refetches them from `countersUrl`:
 *
 * - on every `notifications.changed` signal on `topics` (the signal carries ids only; the numbers
 *   always come from the API);
 * - on every `SUBSCRIBED`, first join and re-join alike, and on every `visibilitychange` to visible:
 *   a signal missed while the window was away or the socket was down never matters (D-240);
 * - a failed refetch keeps the last value: with Realtime or the route down, the bell still shows the
 *   server's count and nothing else changes (UI-D-265: no "Conectando…" indicator, no toast).
 *
 * After every change the installed app's icon badge follows (`applyAppBadge`, D-239).
 */
export function LiveCountersProvider({
  initial,
  countersUrl,
  topics,
  children,
}: LiveCountersProviderProps) {
  const [counters, setCounters] = useState<LiveCounters>(initial);
  const realtime = useRealtime();

  // A newer server render (a navigation that re-rendered the layout) re-seeds the value.
  const seeded = useRef(`${initial.unreadNotifications}:${initial.unreadConversations}`);
  useEffect(() => {
    const key = `${initial.unreadNotifications}:${initial.unreadConversations}`;
    if (key === seeded.current) return;
    seeded.current = key;
    setCounters({
      unreadNotifications: initial.unreadNotifications,
      unreadConversations: initial.unreadConversations,
    });
  }, [initial.unreadNotifications, initial.unreadConversations]);

  // Out-of-order answers: only an answer newer than the last one applied may land.
  const issued = useRef(0);
  const applied = useRef(0);
  const refetch = useCallback(async () => {
    const seq = ++issued.current;
    try {
      const res = await fetch(countersUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'manual',
      });
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (!isCounters(body) || seq < applied.current) return;
      applied.current = seq;
      setCounters((previous) =>
        previous.unreadNotifications === body.unreadNotifications &&
        previous.unreadConversations === body.unreadConversations
          ? previous
          : {
              unreadNotifications: body.unreadNotifications,
              unreadConversations: body.unreadConversations,
            },
      );
    } catch {
      // Keep the last value (UI-D-265).
    }
  }, [countersUrl]);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const topicsKey = topics.join('\n');
  useEffect(() => {
    if (!realtime || !topicsKey) return;
    const leaves = topicsKey
      .split('\n')
      .filter(Boolean)
      .map((topic) =>
        realtime.join(
          topic,
          [REALTIME_EVENTS.notificationsChanged],
          () => void refetchRef.current(),
          () => void refetchRef.current(),
        ),
      );
    return () => {
      for (const leave of leaves) leave();
    };
  }, [realtime, topicsKey]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refetchRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    applyAppBadge(counters);
  }, [counters]);

  return <LiveCountersContext.Provider value={counters}>{children}</LiveCountersContext.Provider>;
}
