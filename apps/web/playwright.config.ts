import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * `baseURL` is the tria-demo TENANT host (D-20). Chromium resolves every `*.localhost` name to loopback
 * (RFC 6761), so no `/etc/hosts` entry is needed and the two seed tenants plus the platform host are
 * distinct origins with separate cookies. Readiness is probed on plain `localhost` (a generic host that
 * needs no API lookup); the Next dev server binds one port for all of them.
 * Node-side helpers must use `127.0.0.1` URLs: Node's resolver does not special-case `*.localhost`.
 */
export default defineConfig({
  testDir: './e2e',
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://tria-demo.localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    // iPhone 14 viewport/UA/touch on Chromium (the device preset defaults to WebKit).
    { name: 'mobile-chromium', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @tria/api dev',
      url: 'http://localhost:8787/v1/health',
      reuseExistingServer: true,
      cwd: repoRoot,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000/entrar',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
