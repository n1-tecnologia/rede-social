import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  type RuntimeCaching,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from 'serwist';
import {
  decidePushDisplay,
  focusOrOpen,
  parsePushPayload,
  resolveClickUrl,
  subscriptionBody,
} from '../lib/push-sw';

/**
 * Service worker (PWA-01), built by `app/serwist/[path]/route.ts` and served at `/serwist/sw.js`.
 *
 * Caching contract (T-02-70 — a shared device must never keep one member's data after logout):
 *  - the precache is the build's static assets (`self.__SW_MANIFEST`: `/_next/static/*` + `public/`)
 *    plus `/~offline`, injected per build by the route handler;
 *  - rule (a): every navigation/document, React Server Component payload (`RSC` request header),
 *    server action (`Next-Action` header) and same-origin `/auth/*`, `/v1/*`, `/api/*`, `/m/*`
 *    (manifests, D-25) and `/serwist/*` request goes to the network only — nothing is stored;
 *  - rule (b): hashed `/_next/static/*` chunks are cache-first with a bounded expiration (immutable);
 *  - rule (c): public brand assets — `/icons/*`, `/seed-logos/*` and the public `branding` bucket
 *    (`/storage/v1/object/public/branding/*`, D-28 derived icons) — are stale-while-revalidate with a
 *    small bounded cache so the installed app keeps its icon/logo offline;
 *  - anything else is left to the browser (no route). The library's default strategy list is NOT
 *    used: it persists documents, RSC payloads and `/api/` answers in Cache Storage.
 *  - development (`next dev`): one network-only rule for everything so Turbopack HMR chunks are
 *    never served stale (the precache is already empty there by library design).
 *
 * Offline: when rule (a) fails for a document request the precached `/~offline` page answers
 * (fallback plugin attached by Serwist); the page is neutral and session-free (T-02-74).
 * Updates are silent (`skipWaiting` + `clientsClaim`, UI-SPEC §PWA) — no toast this phase.
 *
 * Web Push (NOTIF-03, 07-07): three listeners sit beside Serwist's. Each does ALL of its work inside
 * ONE `event.waitUntil(async …)` (RESEARCH Pitfall 7), and every decision lives in the pure
 * `lib/push-sw.ts` (payload fallback, the foreground rule, the same-origin click target, the badge).
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// esbuild (`platform: 'browser'`) defines `process.env.NODE_ENV` from the build's minify flag.
const isProd = process.env.NODE_ENV === 'production';

const NETWORK_ONLY_PREFIXES = ['/auth/', '/v1/', '/api/', '/m/', '/serwist/'];
const BRAND_ASSET_PREFIXES = ['/icons/', '/seed-logos/'];
const BRANDING_BUCKET_PREFIX = '/storage/v1/object/public/branding/';

const DAY_S = 24 * 3600;

const productionRules: RuntimeCaching[] = [
  {
    // (a) never stored: documents, RSC payloads, server actions, auth/API/manifest/SW endpoints.
    matcher: ({ request, url, sameOrigin }) =>
      request.mode === 'navigate' ||
      request.destination === 'document' ||
      request.headers.get('RSC') === '1' ||
      request.headers.has('Next-Action') ||
      (sameOrigin && NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))),
    handler: new NetworkOnly(),
  },
  {
    // (b) hashed build chunks.
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
    handler: new CacheFirst({
      cacheName: 'next-static',
      plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * DAY_S })],
    }),
  },
  {
    // (c) public brand assets (neutral set, seed logos, the public branding bucket on any origin).
    matcher: ({ url, sameOrigin }) =>
      (sameOrigin && BRAND_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) ||
      url.pathname.startsWith(BRANDING_BUCKET_PREFIX),
    handler: new StaleWhileRevalidate({
      cacheName: 'brand-assets',
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 7 * DAY_S })],
    }),
  },
];

const developmentRules: RuntimeCaching[] = [{ matcher: /.*/i, handler: new NetworkOnly() }];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: isProd ? productionRules : developmentRules,
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

type BadgingNavigator = { setAppBadge?: (count?: number) => Promise<void> };

// push: badge (D-239), then either the tenant banner or, in front on Chromium/Firefox, a quiet
// message to the open windows (D-236). A malformed payload shows the fallback banner (UI-D-267).
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = parsePushPayload(event.data);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const decision = decidePushDisplay({ payload, windows, ua: self.navigator.userAgent });
      const nav = self.navigator as unknown as BadgingNavigator;
      if (decision.badge !== null && typeof nav.setAppBadge === 'function') {
        await nav.setAppBadge(decision.badge).catch(() => {});
      }
      if (!decision.show) {
        for (const w of windows) w.postMessage({ type: 'push-received', tag: payload.tag });
        return;
      }
      // UI-D-266: no `badge` image in V1 (the tenant branding has no monochrome asset).
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: payload.icon,
        tag: payload.tag,
        renotify: payload.renotify,
        data: { url: resolveClickUrl(payload.url) },
      } as NotificationOptions);
    })(),
  );
});

// notificationclick: focus a window of THIS origin and navigate it, or open one (T-07-42).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = resolveClickUrl((event.notification.data as { url?: unknown } | null)?.url);
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(focusOrOpen(self.clients, url, self.location.origin));
});

type SubscriptionChangeEvent = ExtendableEvent & {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
};

// pushsubscriptionchange: re-subscribe with the old options and save through the same BFF route
// (the same-origin fetch carries the session cookie). Best effort: the page re-syncs on every open.
self.addEventListener('pushsubscriptionchange', (rawEvent: Event) => {
  const event = rawEvent as SubscriptionChangeEvent;
  event.waitUntil(
    (async () => {
      try {
        let subscription = event.newSubscription ?? null;
        if (!subscription) {
          const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
          if (!applicationServerKey) return;
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }
        await fetch('/api/push/subscriptions', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscriptionBody(subscription.toJSON(), self.navigator.userAgent)),
        });
      } catch {
        // Best effort (the page's sync on open covers a failure here).
      }
    })(),
  );
});

serwist.addEventListeners();
