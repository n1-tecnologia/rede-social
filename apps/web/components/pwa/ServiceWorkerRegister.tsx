'use client';

import { SerwistProvider } from '@serwist/turbopack/react';
import { useEffect } from 'react';

const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Registers the service worker (PWA-01) and mirrors the display mode onto `<html>`.
 *
 * Registration: `/serwist/sw.js`, scope `/`, `updateViaCache: 'none'` (the browser re-fetches the
 * script on every update check instead of trusting its HTTP cache — T-02-75), module type.
 * Two library defaults are deliberately turned OFF:
 *  - `cacheOnNavigation` (default true) messages the worker to cache the CURRENT PATHNAME on every
 *    client navigation — that would push every authenticated page into Cache Storage (T-02-70);
 *  - `reloadOnOnline` (default true) reloads the page when connectivity returns — that drops
 *    in-progress forms and duplicates Next's own `experimental.useOffline` retry.
 * Updates are silent (the worker calls skipWaiting + clientsClaim); no toast this phase.
 *
 * Display mode: `data-display-mode="standalone" | "browser"` on `<html>` follows
 * `matchMedia('(display-mode: standalone)')` and its `change` event, so styles and Phase 7's push
 * gate ("installed" is a precondition for iOS push) can read it. There is intentionally NO Android
 * install-prompt listener here (CONTEXT Deferred Ideas — Phase 7).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(STANDALONE_QUERY);
    const apply = () => {
      document.documentElement.dataset.displayMode = list.matches ? 'standalone' : 'browser';
    };
    apply();
    list.addEventListener('change', apply);
    return () => list.removeEventListener('change', apply);
  }, []);

  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      options={{ scope: '/', updateViaCache: 'none', type: 'module' }}
      cacheOnNavigation={false}
      reloadOnOnline={false}
    />
  );
}
