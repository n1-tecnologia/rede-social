/**
 * The ONE source of the e2e origins (D-20/D-21), shared by the specs and the Playwright config (07-12).
 *
 * The specs read these through `fixtures.ts` (`export const hosts = e2eHosts()`); the config reads
 * `e2ePlatformHostname()` to tell every server it launches which host is the platform shell, so the
 * host the specs browse and the host the servers serve can never drift apart.
 *
 * Read at CALL time, not at import time: `playwright.pwa.config.ts` re-points the four URLs to port
 * 3100 after importing the base config, and a value captured at import would miss that.
 *
 * This file imports nothing from the e2e folder on purpose. `fixtures.ts` throws at import when
 * `SEED_PASSWORD` is missing, and the config must never pull that in.
 */

export interface E2eHosts {
  demo: string;
  lab: string;
  platform: string;
  generic: string;
}

/** Distinct origins. Chromium resolves `*.localhost` to loopback without `/etc/hosts` (RFC 6761). */
export function e2eHosts(): E2eHosts {
  return {
    demo: process.env.PLAYWRIGHT_DEMO_URL ?? 'http://rede-demo.localhost:3000',
    lab: process.env.PLAYWRIGHT_LAB_URL ?? 'http://rede-lab.localhost:3000',
    platform: process.env.PLAYWRIGHT_PLATFORM_URL ?? 'http://rede-social.localhost:3000',
    generic: process.env.PLAYWRIGHT_GENERIC_URL ?? 'http://localhost:3000',
  };
}

/** The hostname (no scheme, no port) of the platform origin the specs browse. */
export function e2ePlatformHostname(): string {
  return new URL(e2eHosts().platform).hostname;
}
