import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev server binds one port for every local host: the tenant hosts (`tria-demo.localhost`,
  // `tria-lab.localhost`) and the platform host (`tria.localhost`) must be allowed to load `/_next/*`
  // assets and post server actions (D-20/D-21). Chromium resolves `*.localhost` to loopback (RFC 6761).
  allowedDevOrigins: ['*.localhost'],
  // `/termos` and `/privacidade` read the versioned markdown from `@tria/contracts/legal` at
  // request time, and `i18n/messages.ts` reads the per-namespace pt-BR catalog with `fs` (PWA-03);
  // without this neither set of files is traced into the Vercel function bundle.
  outputFileTracingIncludes: {
    '/**': ['../../packages/contracts/legal/**', './messages/pt-BR/**'],
  },
  // PWA-01: `useOffline()` (next/offline) only reports connectivity when this flag is on; the
  // OfflineBanner in the root layout reads it and Next retries navigations that failed offline.
  experimental: { useOffline: true },
  // Response headers the PWA plumbing relies on (CLAUDE.md PWA §1, T-02-71/T-02-75):
  //  - the service-worker script is never served from an HTTP cache (`updateViaCache: 'none'` on the
  //    registration covers the SW cache; this covers proxies/CDNs) and is never content-sniffed;
  //  - the per-tenant manifest is private and uncacheable (D-25: it carries one tenant's brand and
  //    is selected by the host, so a shared cache must never hand it to another origin).
  async headers() {
    return [
      {
        source: '/serwist/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        source: '/m/:slug/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

// next-intl without locale routing: one pt-BR catalog resolved by ./i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// @serwist/turbopack (never next-pwa / @serwist/next — Next 16 builds with Turbopack): only marks
// esbuild as a server-external package; the worker itself is built by app/serwist/[path]/route.ts.
export default withSerwist(withNextIntl(nextConfig));
