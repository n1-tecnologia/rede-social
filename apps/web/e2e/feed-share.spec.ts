import { expect, test } from '@playwright/test';
import { closeAdmin, feedPostIdFor, setFeedPostRemoved } from './admin';
import { baseURL, hosts, isRemote, login, SEED_PASSWORD, seededFeed, users } from './fixtures';

/**
 * FEED-07 / D-56 / UI-D-16 — the deep link, end to end.
 *
 * Four claims, and the last two are the security half:
 *   1. a `/post/{id}` link opened LOGGED OUT routes through login and lands on the post;
 *   2. the desktop share control copies `https://{primaryHost}/post/{id}` — the tenant's verified
 *      origin, never the browser's current one — and raises the copied toast;
 *   3. a member of ANOTHER tenant opening the same URL gets the not-found screen, and the rendered
 *      page names neither the other community's post nor the community itself;
 *   4. a post of the member's OWN tenant carrying a soft-delete stamp renders the BYTE-IDENTICAL
 *      screen, asserted as an equality between the two renderings rather than against a literal —
 *      a future copy change on one branch alone would fail it, which is the point.
 *
 * The positive control ("a live post of my own tenant opens") runs in the same file, so a globally
 * broken route could not make claims 3 and 4 pass vacuously (the 03-08 rule).
 *
 * The NATIVE share sheet is deliberately absent: an OS-level sheet is outside the browser
 * automation boundary, so it is carried as a manual UAT item for the phase. The desktop clipboard
 * half IS automated, with real permissions granted rather than a stubbed `writeText`, so the
 * assertion is about the path a member actually takes.
 *
 * `serviceWorkers: 'block'`: the 02-11 worker would serve the app shell from its own cache and turn
 * a logged-out navigation into a cached render instead of the proxy redirect this file measures.
 */
test.use({ serviceWorkers: 'block' });

/** `https://{primaryHost}` — what `primaryHostOrigin()` composes for tria-demo (UI-SPEC E16). */
const DEMO_SHARE_ORIGIN = 'https://tria-demo.localhost';

let demoPostId = '';

test.beforeAll(async () => {
  demoPostId = await feedPostIdFor(seededFeed.newest, 'tria-demo');
});

test.afterAll(async () => {
  await closeAdmin();
});

test.describe('FEED-07 — the shared post link', () => {
  test('1. a logged-out visitor is routed through login and lands on the post', async ({
    browser,
  }) => {
    // A fresh context: no session, exactly as a member opening a link from a message has.
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();

    await page.goto(`${baseURL}/post/${demoPostId}`);
    await expect(page).toHaveURL(/\/entrar$/);

    await page.locator('#email').fill(users.demoMember);
    await page.locator('#password').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    // The link survived the round trip: the same post id, with the post's own caption on screen.
    await expect(page).toHaveURL(new RegExp(`/post/${demoPostId}$`));
    await expect(page.getByRole('main').getByText(seededFeed.newest)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Publicação', exact: true })).toBeVisible();

    await context.close();
  });

  test('2. the post page renders the full card with its comments inline (the positive control)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD);
    await page.goto(`${baseURL}/post/${demoPostId}`);

    // The SAME card component the feed renders — `role="article"` with the author's accessible name.
    await expect(
      page.getByRole('article', { name: `Publicação de ${seededFeed.demoAuthor}`, exact: true }),
    ).toBeVisible();
    // E10/E13 partial: the comment surface is inline beneath it, not behind a sheet.
    await expect(page.getByRole('region', { name: 'Comentários da publicação' })).toBeVisible();
  });

  /**
   * Runs on BOTH projects, deliberately. Neither Chromium under test exposes `navigator.share`
   * (verified: `typeof navigator.share === 'undefined'` on the iPhone-emulated project too), so
   * the mobile run proves the plan's fallback clause — the control reaches the clipboard rather
   * than failing when the Web Share API is absent — on exactly the device profile that would
   * otherwise have taken the native path. The native sheet itself is the manual UAT item.
   */
  test('3. the share control copies the tenant primary-host link and toasts', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are a Chromium grant');

    // Real permissions rather than a stubbed write: the assertion is about the path a member takes.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: hosts.demo });

    await login(page, users.demoMember, SEED_PASSWORD);
    await page.goto(`${baseURL}/post/${demoPostId}`);

    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: 'Compartilhar', exact: true })
      .click();

    await expect(page.getByText('Link copiado.', { exact: true })).toBeVisible();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // The tenant's VERIFIED primary origin, not the `http://…:3000` the tab happens to be on.
    expect(copied.startsWith(DEMO_SHARE_ORIGIN)).toBe(true);
    expect(copied).toBe(`${DEMO_SHARE_ORIGIN}/post/${demoPostId}`);
  });

  test('4. another tenant and a removed post render the byte-identical not-found screen', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only — needs the tria-lab host and the admin connection');

    // (a) A tria-lab member opening the tria-demo post id on the LAB host.
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/post/${demoPostId}`);

    const foreignScreen = await page
      .getByRole('heading', { name: 'Publicação não encontrada', exact: true })
      .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
      .innerText();

    // Nothing about the other community reaches the page: not its post, not its name.
    await expect(page.getByText(seededFeed.newest, { exact: true })).not.toBeVisible();
    await expect(page.getByText(seededFeed.demoAuthor, { exact: true })).not.toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(seededFeed.newest);

    // (b) The SAME member's own tenant, with the post carrying a soft-delete stamp. The seeded
    // posts are shared by the whole suite, so the stamp is cleared again in the finally block.
    const labPostId = await feedPostIdFor(seededFeed.newest, 'tria-lab');
    await setFeedPostRemoved(labPostId, true);
    try {
      await page.goto(`${hosts.lab}/post/${labPostId}`);
      const removedScreen = await page
        .getByRole('heading', { name: 'Publicação não encontrada', exact: true })
        .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
        .innerText();

      // The claim, as an equality: the two renderings are the same text, not merely both "a 404".
      expect(removedScreen).toEqual(foreignScreen);
    } finally {
      await setFeedPostRemoved(labPostId, false);
    }

    // Positive control — the same member, the same host, a LIVE post of their own community.
    await page.goto(`${hosts.lab}/post/${labPostId}`);
    await expect(
      page.getByRole('article', { name: `Publicação de ${seededFeed.labAuthor}`, exact: true }),
    ).toBeVisible();
  });

  test('5. an id that is not a uuid takes the same not-found screen', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD);
    await page.goto(`${baseURL}/post/nao-e-um-uuid`);
    await expect(
      page.getByRole('heading', { name: 'Publicação não encontrada', exact: true }),
    ).toBeVisible();
  });
});
