'use client';

import { REALTIME_EVENTS, userTopic } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { buttonClasses } from '@rede-social/ui';
import { ShoppingBag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

/**
 * The product page's action zone for a product sold through the tenant's payment page (09.1-17, PAY-24,
 * PAY-34, D-506, D-508, UI-D-525, UI-D-529, UI-D-532).
 *
 * **Nothing is faked (D-506).** The buy button is a plain link to the stored checkout URL in a new tab:
 * no action, no dialog, no local pending state and no optimistic unlock. This file imports no
 * purchase action and no simulated purchase control (flagged P58). The page decides the mode ONCE on the server
 * (`productPageView().buyMode`) and hands this component either a validated `https:` href or `null`, so
 * a stale or tampered client state can never reach the simulated control (T-09.1-81).
 *
 * **Trust (UI-D-532, T-09.1-78, T-09.1-79).** The href is the server-validated stored URL, rendered as
 * an attribute and never as HTML; the tab opens with `rel="noopener noreferrer"`. With no href the zone
 * is a disabled unavailable button and a note: a product with no link cannot be bought (D-508).
 *
 * **Live refresh (PAY-34, D-240, flagged P78).** The signed webhook creates the order, the existing sink
 * nudges the buyer's own user topic with `notifications.changed`, and this component calls
 * `router.refresh()`: the SERVER then says `owned` and the page swaps into the owned block. The signal
 * only requests a refetch, never carries state. It is throttled to one refresh per 1500 ms with a
 * trailing call (never dropped, never looped, cleared on unmount; T-09.1-83), skips the redundant
 * first-join callback, refreshes on every re-join and when the tab becomes visible again, which covers
 * a person who paid in the other tab or a device that dropped its socket meanwhile. Outside a realtime
 * provider the topic hook is a no-op and the visibility refresh still works. The persistent
 * `aria-live` wrapper that announces the swap belongs to the page.
 */

/** One refresh per window; a burst gets one leading and at most one trailing call. */
export const GATEWAY_REFRESH_THROTTLE_MS = 1500;

const LIVE_EVENTS = [REALTIME_EVENTS.notificationsChanged];

/** The finished catalog strings, read on the server (`store.purchase.gateway.*`). */
export interface GatewayPurchaseLabels {
  buy: string;
  newTab: string;
  helper: string;
  unavailable: string;
  unavailableNote: string;
}

export function GatewayPurchase({
  checkoutHref,
  tenantId,
  userId,
  labels,
}: {
  /** The validated `https:` checkout URL, or `null` for the unavailable branch. */
  checkoutHref: string | null;
  tenantId: string;
  userId: string;
  labels: GatewayPurchaseLabels;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinedOnce = useRef(false);

  const refresh = useCallback(() => {
    const wait = lastAt.current + GATEWAY_REFRESH_THROTTLE_MS - Date.now();
    if (wait <= 0) {
      lastAt.current = Date.now();
      routerRef.current.refresh();
      return;
    }
    if (pending.current !== null) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      lastAt.current = Date.now();
      routerRef.current.refresh();
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

  useRealtimeTopic(userTopic(tenantId, userId), LIVE_EVENTS, refresh, { onSubscribed });

  if (checkoutHref === null) {
    return (
      <>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={buttonClasses({ variant: 'outline', size: 'lg', fullWidth: true })}
        >
          {labels.unavailable}
        </button>
        <p className="mt-2 text-xs font-normal text-text-tertiary">{labels.unavailableNote}</p>
      </>
    );
  }

  return (
    <>
      <a
        href={checkoutHref}
        target="_blank"
        rel="noopener noreferrer"
        data-store-buy-gateway
        className={buttonClasses({ variant: 'brand', size: 'lg', fullWidth: true })}
      >
        <ShoppingBag aria-hidden size={18} className="shrink-0" />
        {labels.buy} <span className="sr-only">{labels.newTab}</span>
      </a>
      <p className="mt-2 text-xs font-normal text-text-tertiary">{labels.helper}</p>
    </>
  );
}
