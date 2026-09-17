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

serwist.addEventListeners();
