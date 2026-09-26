import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * Phase 05.3 — Reels, end to end. Plan 05.3-08 ships the first case (e1); plan 05.3-09 extends this
 * spec with the rest of the phase's walk (lanes, sound, pause, like, comments, share, empty and
 * error states, the desktop column and the module flag).
 *
 * **What the seed provides.** `scripts/seed.ts` writes ONE ready video post per seed tenant through
 * the `fake` provider (demo: post `0d000000-0000-4000-8000-000000000004`, asset `…0000000000a4`), in
 * no community, so tria-demo's Reels is a single "Todos" page with no lane row. The run needs
 * `VIDEO_PROVIDER=fake` so the API mints the fake provider's credential for that row.
 *
 * **The stream never answers.** `**\/stream.mux.com/**` is routed to a handler that never responds:
 * the vendor element stays loading and never raises an error, so the case asserts the page the host
 * built (the credential reached the element) rather than a video decode no local stack can do.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a registered worker could answer a navigation from
 * its own cache instead of the server.
 */

test.skip(isRemote, 'local stack only (the seeded fake-provider video post)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy — never a literal in a spec. */
const R = reelsMessages.reels;
const NAV = appMessages.app.nav;

function isMobile(projectName: string): boolean {
  return projectName !== 'desktop-chromium';
}

/** The visible navigation: the floating BottomNav on the phone, the rail on the desktop. */
function nav(page: Page, mobile: boolean): Locator {
  return page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]');
}

test.describe('05.3 Reels', () => {
  test('e1: the Reels tab opens the media-chrome stage on the first video', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    // Never answered: the element stays loading and never errors (see the header).
    await page.route('**/stream.mux.com/**', () => undefined);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(page.locator('header:visible')).toHaveCount(mobile ? 1 : 0);

    await nav(page, mobile).getByRole('link', { name: R.nav }).click();
    await expect(page).toHaveURL(/\/reels$/);

    const stage = page.getByRole('region', { name: R.region });
    await expect(stage).toBeVisible();

    if (mobile) {
      // UI-D-81: no TopBar on the media tab, and the BottomNav under the dark-token scope.
      await expect(page.locator('header:visible')).toHaveCount(0);
      await expect(nav(page, mobile)).toHaveAttribute('data-theme', 'dark');
    }

    // The first page's element exists and carries a minted credential. `tokens` is a PROPERTY-only
    // path on mux-player (media-video.spec's note), so the element's own getter is what is read.
    const player = stage.locator('mux-player').first();
    await expect(player).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          player.evaluate(
            (node) =>
              (node as unknown as { tokens?: { playback?: string } }).tokens?.playback ?? '',
          ),
        { timeout: 20_000 },
      )
      .not.toBe('');

    // Every visit starts muted (D-126).
    await expect(stage.getByRole('button', { name: R.sound.unmute })).toBeVisible();

    await nav(page, mobile).getByRole('link', { name: NAV.home }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    if (mobile) {
      await expect(page.locator('header:visible')).toHaveCount(1);
      await expect(nav(page, mobile)).not.toHaveAttribute('data-theme', 'dark');
    }
  });
});
