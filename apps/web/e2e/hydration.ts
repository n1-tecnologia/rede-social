import { expect, type Locator } from '@playwright/test';

/**
 * Waits until React has hydrated the element `target` resolves to.
 *
 * A `page.goto` / `page.reload` resolves on the document's `load` event, but the App Router
 * hydrates concurrently, so on a slow machine (the GitHub runner) the server HTML is on screen and
 * clickable for a while before React attaches its handlers. A click in that window is lost (a
 * `type="button"` does nothing, a link navigates natively, a form submits natively), and the case
 * then fails far from its cause. React tags every DOM node it hydrated with its internal props key
 * (`__reactProps$…`), the signal 02-14 found and `stories.spec.ts` / `admin-branding.spec.ts`
 * already wait on; this is the shared form of it. Call it on the control about to be used, right
 * before the first interaction after a full document load.
 */
export async function untilHydrated(target: Locator): Promise<void> {
  await expect
    .poll(
      () => target.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps'))),
      { timeout: 30_000 },
    )
    .toBe(true);
}
