import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * PWA suite (02-11) against a PRODUCTION build: `pnpm --filter @tria/web e2e:pwa`.
 *
 * Why production: `@serwist/turbopack` forces the precache to `[]` in `next dev` and `app/sw.ts` is
 * network-only there, so the offline fallback and the caching contract are only observable on
 * `next build && next start`. Why port 3100: it never fights a running dev server on :3000 (the
 * seed hosts resolve to loopback on any port). The API server entry is reused from the base config.
 * A stale production server from an aborted run: `lsof -ti:3100 | xargs kill`.
 *
 * `pwa.spec.ts` self-skips unless `PWA_PROD=1`, so the default `pnpm e2e` (dev server) ignores it.
 * Importing the base config loads `.env.local` first (SEED_PASSWORD for the login cases).
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 3100;

process.env.PWA_PROD ??= '1';
process.env.PLAYWRIGHT_DEMO_URL ??= `http://tria-demo.localhost:${PORT}`;
process.env.PLAYWRIGHT_LAB_URL ??= `http://tria-lab.localhost:${PORT}`;
process.env.PLAYWRIGHT_PLATFORM_URL ??= `http://tria.localhost:${PORT}`;
process.env.PLAYWRIGHT_GENERIC_URL ??= `http://localhost:${PORT}`;

const apiServer = (Array.isArray(base.webServer) ? base.webServer : [base.webServer]).find(
  (server) => server?.url?.includes('8787'),
);

export default defineConfig({
  ...base,
  testMatch: /pwa\.spec\.ts$/,
  use: { ...base.use, baseURL: process.env.PLAYWRIGHT_DEMO_URL },
  projects: [
    { name: 'iphone-chromium', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    { name: 'pixel-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    ...(apiServer ? [apiServer] : []),
    {
      command: `pnpm --filter @tria/web exec next build && pnpm --filter @tria/web exec next start -p ${PORT}`,
      url: `http://localhost:${PORT}/entrar`,
      reuseExistingServer: false,
      timeout: 300_000,
      cwd: repoRoot,
    },
  ],
});
