import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import { closeAdmin, createFeedPostAs, deleteReelsFixtures } from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, seededFeed, users } from './fixtures';
import { closeSocialAdmin, markAsMemberPost } from './social-admin';

/**
 * Phase 09 - Rede social, web end to end (started by plan 09-08, extended by 09-10..09-13).
 *
 * **09-08 (Explorar).** A member of a tenant with `social` on sees the Início · Explorar chip row,
 * opens Explorar and reads the posts of the people they follow and their own; the chip row and
 * Explorar are absent for a tenant without `social`, and `?aba=explorar` there reads as Início with
 * no notice. The rows below are the walk; later tasks of the plan add the empty states, the
 * composer entry by tab, the Administrador mark by audience and Reels over Explorar.
 *
 * **Seed.** `scripts/seed.ts` runs rede-lab with `social` ON and two follow edges (Álvaro follows
 * Helena, Helena follows Marcos); rede-demo has it OFF. This spec never edits the seeded graph: the
 * posts it adds carry the `Teste social` prefix and go in `afterAll`, so the pinned feed totals other
 * specs read never move.
 *
 * **Held-out visual backstops (verified by eye, not asserted here).** The Phase 3 `processando` card
 * of a member video that is still transcoding; a member photo or video that fails to load degrading
 * to the neutral box; the loading frame of member media matching an administrator's; and, at 320px,
 * a long unbroken caption plus a long display name (the header name truncates; the DOM check for no
 * horizontal scroll is asserted below). Run them on a phone-width window against a lab member's
 * Explorar before a release.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a registered worker could answer a navigation from
 * its own cache instead of the server.
 */

test.skip(isRemote, 'local stack only (member posts are stamped through the admin connection)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy - never a literal in a spec. */
const S = socialMessages.social;
const F = feedMessages.feed;
const NAV = appMessages.app.nav;

/** Every row this spec writes starts with this, and `afterAll` removes it by this. */
const PREFIX = 'Teste social';
const LAB = 'rede-lab';
const ALVARO = 'alvaro.pinheiro@rede-lab.local';
const HELENA = 'helena.kuster@rede-lab.local';

function isMobile(projectName: string): boolean {
  return projectName !== 'desktop-chromium';
}

/** The visible navigation: the floating BottomNav on the phone, the rail on the desktop. */
function nav(page: Page, mobile: boolean): Locator {
  return page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]');
}

/** The chip row: a tablist of links named "Áreas do início". */
function chipRow(page: Page): Locator {
  return page.getByRole('tablist', { name: S.tabs.label });
}

test.describe('09-08 Explorar - the chip row and the feed of the people you follow', () => {
  const memberPost = `${PREFIX} publicação de Helena para quem a segue.`;

  test.beforeAll(async () => {
    const id = await createFeedPostAs(HELENA, LAB, memberPost);
    await markAsMemberPost(id);
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeSocialAdmin();
    await closeAdmin();
  });

  test('a lab member opens Explorar from the chip row and reads the post of the person they follow', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);

    // Início: the chip row is there, Início is the active chip, and the member post is NOT here.
    const row = chipRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByRole('tab')).toHaveText([S.tabs.home, S.tabs.explore]);
    await expect(row.getByRole('tab', { name: S.tabs.home })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(page.getByText(memberPost)).toHaveCount(0);

    // "Encontrar pessoas": the directory, as a labelled button (one of the two controls is hidden).
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveAttribute('href', '/membros');

    // Explorar: the chip is a link, the URL carries the tab, and the followed member's post is here.
    await row.getByRole('tab', { name: S.tabs.explore }).click();
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    await expect(chipRow(page).getByRole('tab', { name: S.tabs.explore })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(memberPost)).toBeVisible();

    // Clean: the administrator's post is not in Explorar, and the BottomNav keeps Início active.
    await expect(page.getByText(seededFeed.newest)).toHaveCount(0);
    await expect(
      nav(page, mobile).getByRole('link', { name: NAV.home, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveAttribute('href', '/membros');

    // Back to Início through the first chip: the member post is gone again.
    await chipRow(page).getByRole('tab', { name: S.tabs.home }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByText(memberPost)).toHaveCount(0);
  });

  test('an unknown or repeated ?aba= reads as Início with no notice and no 404', async ({
    page,
  }) => {
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);
    for (const query of ['?aba=xyz', '?aba=explorar&aba=explorar', '?aba=']) {
      await page.goto(`${hosts.lab}/inicio${query}`);
      await expect(chipRow(page).getByRole('tab', { name: S.tabs.home })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByText(memberPost)).toHaveCount(0);
      await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    }
  });

  test('a rede-demo member (social off) has no chip row, and ?aba=explorar reads as Início', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(chipRow(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveCount(0);

    await page.goto(`${hosts.demo}/inicio?aba=explorar`);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(chipRow(page)).toHaveCount(0);
  });
});
