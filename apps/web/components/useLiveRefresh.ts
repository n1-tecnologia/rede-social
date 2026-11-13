'use client';

import { REALTIME_EVENTS, userTopic } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { useCallback, useEffect, useRef } from 'react';

/** One refresh per window; a burst gets one leading and at most one trailing call. */
export const LIVE_REFRESH_THROTTLE_MS = 1500;

const LIVE_EVENTS = [REALTIME_EVENTS.notificationsChanged];

/**
 * The Realtime-to-refresh machine of a page that waits for a payment to land (09.1-17 PAY-34, extracted
 * in Phase 10.1-12 for UI-D-748 and shared by `GatewayPurchase` and the paid event's zone).
 *
 * The signed webhook creates the order or the presence, the existing sink nudges the buyer's own user
 * topic with `notifications.changed`, and `onRefresh` (a `router.refresh()`) makes the SERVER answer
 * the new state. The signal only requests a refetch, it never carries state. It is throttled to one
 * refresh per 1500 ms with a trailing call (never dropped, never looped, cleared on unmount;
 * T-09.1-83), skips the redundant first-join callback (the first join is the page's own render),
 * refreshes on every re-join (D-240: refetch, never rely on replay) and when the tab becomes visible
 * again, which covers a person who paid in the other tab or a device that dropped its socket meanwhile.
 * Outside a Realtime provider (or with no user) the topic hook is a no-op and the visibility refresh
 * still works.
 *
 * `onRefresh` is read through a ref, so a caller can pass a fresh closure on every render without
 * costing a leave and a join.
 */
export function useLiveRefresh(
  tenantId: string | null,
  userId: string | null,
  onRefresh: () => void,
): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinedOnce = useRef(false);

  const refresh = useCallback(() => {
    const wait = lastAt.current + LIVE_REFRESH_THROTTLE_MS - Date.now();
    if (wait <= 0) {
      lastAt.current = Date.now();
      onRefreshRef.current();
      return;
    }
    if (pending.current !== null) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      lastAt.current = Date.now();
      onRefreshRef.current();
    }, wait);
  }, []);

  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
      pending.current = null;
    },
    [],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const onSubscribed = useCallback(() => {
    // The first join is the page's own render; every re-join is a catch-up (D-240).
    if (!joinedOnce.current) {
      joinedOnce.current = true;
      return;
    }
    refresh();
  }, [refresh]);

  useRealtimeTopic(tenantId && userId ? userTopic(tenantId, userId) : null, LIVE_EVENTS, refresh, {
    onSubscribed,
  });
}
