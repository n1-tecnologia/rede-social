import type { Page } from '@playwright/test';

/**
 * Records every `securitypolicyviolation` the browser fires (08-08, D-346). Under the enforced policy
 * the e2e harness runs, each one is something the app tried to do and was stopped from doing: a
 * script without the nonce, a frame or a connection to a host the policy does not list.
 *
 * An init script (installed before any page script, on every navigation and in every frame) listens
 * for the event and hands it straight to Node through an exposed binding, so violations survive the
 * navigations of a multi-page walk. It records only the effective directive, the blocked resource's
 * host (or the CSP keyword: `inline`, `eval`, `data`, `blob`) and the document path; never a full URL.
 *
 * Usage: `const violations = await collectCspViolations(page);` before the first `goto`, then
 * `expect(violations()).toEqual([])` at any point.
 */
export type CspViolation = { directive: string; blocked: string; path: string };

const BINDING = '__e2eCspViolation';

export async function collectCspViolations(page: Page): Promise<() => CspViolation[]> {
  const seen: CspViolation[] = [];
  await page.exposeFunction(BINDING, (violation: CspViolation) => {
    seen.push(violation);
  });
  await page.addInitScript((binding) => {
    document.addEventListener('securitypolicyviolation', (event) => {
      let blocked = event.blockedURI;
      try {
        blocked = new URL(event.blockedURI).host || event.blockedURI;
      } catch {
        // A keyword such as `inline` or `eval` is not a URL: keep it as is.
      }
      const report = (window as unknown as Record<string, (v: unknown) => void>)[binding];
      report?.({ directive: event.effectiveDirective, blocked, path: location.pathname });
    });
  }, BINDING);
  return () => [...seen];
}
