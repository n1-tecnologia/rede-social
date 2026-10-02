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
  /**
   * 07-08/07-09 (D-237, D-238): how the chat slot draws `unreadConversations`: a member's `dot` (0 or
   * 1, "the team answered") or the staff `count` of conversations awaiting a reply. Absent means
   * `count` (the platform shell, older callers).
   */
  conversationsBadge?: 'dot' | 'count';
}

/** The chat slot's style, defaulting to the count. */
export const conversationsBadgeOf = (counters: LiveCounters): 'dot' | 'count' =>
  counters.conversationsBadge === 'dot' ? 'dot' : 'count';

const LiveCountersContext = createContext<LiveCounters | null>(null);

/** The live counters, or `null` outside a provider (TopBar/DesktopRail then keep their static prop). */
export function useLiveCounters(): LiveCounters | null {
  return useContext(LiveCountersContext);
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isBadgeStyle = (value: unknown): boolean =>
  value === undefined || value === 'dot' || value === 'count';

const isCounters = (value: unknown): value is LiveCounters =>
  typeof value === 'object' &&
  value !== null &&
  isCount((value as LiveCounters).unreadNotifications) &&
  isCount((value as LiveCounters).unreadConversations) &&
  isBadgeStyle((value as LiveCounters).conversationsBadge);

const sameCounters = (a: LiveCounters, b: LiveCounters): boolean =>
  a.unreadNotifications === b.unreadNotifications &&
  a.unreadConversations === b.unreadConversations &&
  a.conversationsBadge === b.conversationsBadge;

const copyCounters = (value: LiveCounters): LiveCounters => ({
  unreadNotifications: value.unreadNotifications,
  unreadConversations: value.unreadConversations,
  ...(value.conversationsBadge ? { conversationsBadge: value.conversationsBadge } : {}),
});

export interface LiveCountersProviderProps {
  /** The bootstrap's `counters`: what the server rendered, shown until the first refetch. */
  initial: LiveCounters;
  /** The BFF counters route, `/api/me/counters` in the web app (a GET route handler, `no-store`). */
  countersUrl: string;
  /** The private topics whose signals mean "refetch". */
  topics: ReadonlyArray<string>;
  /**
   * The signal events that mean "refetch" (default: `notifications.changed` only). 07-09's shell
   * adds the chat events: `chat.unread` on the member's user topic (the dot), and `chat.message` /
   * `chat.read` on the support inbox for staff (the awaiting count).
   */
  events?: ReadonlyArray<string>;
  /**
   * 08-04 (MODER-02, T-08-24): called with the refused response when a refetch answers a non-2xx. The
   * counters still keep their last value (UI-D-265); the HOST decides what a refusal means — the web
   * shell reads a 403 `MEMBERSHIP_BLOCKED` and lands on the blocked flow. The kernel never interprets
   * the body. A throwing callback is contained.
   */
  onRefused?: (response: Response) => void | Promise<void>;
  children: ReactNode;
}

const DEFAULT_EVENTS: ReadonlyArray<string> = [REALTIME_EVENTS.notificationsChanged];

/**
 * NOTIF-02 live bell (07-03, D-239, D-240, UI-D-265). Holds the counters, seeded from the bootstrap,
 * and refetches them from `countersUrl`:
 *
 * - on every signal in `events` (default `notifications.changed`; the chat events since 07-09) on
 *   `topics` (the signal carries ids only; the numbers always come from the API);
 * - on every `SUBSCRIBED`, first join and re-join alike, and on every `visibilitychange` to visible:
 *   a signal missed while the window was away or the socket was down never matters (D-240);
 * - a failed refetch keeps the last value: with Realtime or the route down, the bell still shows the
 *   server's count and nothing else changes (UI-D-265: no "Conectando…" indicator, no toast); a
 *   REFUSED one (non-2xx) is also handed to the host's `onRefused` (08-04: the blocked flow).
 *
 * After every change the installed app's icon badge follows (`applyAppBadge`, D-239).
 */
export function LiveCountersProvider({
  initial,
  countersUrl,
  topics,
  events = DEFAULT_EVENTS,
  onRefused,
  children,
}: LiveCountersProviderProps) {
  const [counters, setCounters] = useState<LiveCounters>(initial);
  const realtime = useRealtime();

  // A newer server render (a navigation that re-rendered the layout) re-seeds the value.
  const seeded = useRef(
    `${initial.unreadNotifications}:${initial.unreadConversations}:${initial.conversationsBadge}`,
  );
  useEffect(() => {
    const key = `${initial.unreadNotifications}:${initial.unreadConversations}:${initial.conversationsBadge}`;
    if (key === seeded.current) return;
    seeded.current = key;
    setCounters(
      copyCounters({
        unreadNotifications: initial.unreadNotifications,
        unreadConversations: initial.unreadConversations,
        conversationsBadge: initial.conversationsBadge,
      }),
    );
  }, [initial.unreadNotifications, initial.unreadConversations, initial.conversationsBadge]);

  // Out-of-order answers: only an answer newer than the last one applied may land.
  const issued = useRef(0);
  const applied = useRef(0);
  const onRefusedRef = useRef(onRefused);
  onRefusedRef.current = onRefused;
  const refetch = useCallback(async () => {
    const seq = ++issued.current;
    try {
      const res = await fetch(countersUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'manual',
      });
      if (!res.ok) {
        try {
          await onRefusedRef.current?.(res);
        } catch {
          // A host callback never breaks the live layer.
        }
        return;
      }
      const body: unknown = await res.json();
      if (!isCounters(body) || seq < applied.current) return;
      applied.current = seq;
      const next = copyCounters(body);
      setCounters((previous) => (sameCounters(previous, next) ? previous : next));
    } catch {
      // Keep the last value (UI-D-265).
    }
  }, [countersUrl]);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const topicsKey = topics.join('\n');
  const eventsKey = events.join('\n');
  useEffect(() => {
    if (!realtime || !topicsKey) return;
    const list = eventsKey.split('\n').filter(Boolean);
    const leaves = topicsKey
      .split('\n')
      .filter(Boolean)
      .map((topic) =>
        realtime.join(
          topic,
          list,
          () => void refetchRef.current(),
          () => void refetchRef.current(),
        ),
      );
    return () => {
      for (const leave of leaves) leave();
    };
  }, [realtime, topicsKey, eventsKey]);

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
