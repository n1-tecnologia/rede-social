import { expect, type Page, test } from '@playwright/test';
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import { hosts, login, SEED_PASSWORD, seededFeed, users } from './fixtures';
import {
  clearNotifications,
  closeNotificationsAdmin,
  deletePostsByCaptionPrefix,
  insertNotificationRows,
  publishPostAs,
} from './notifications-admin';
import { ensureWorker } from './worker';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const N = notificationMessages.notifications;

/**
 * NOTIF-01 / NOTIF-02 / D-40 (plan 07-01): the Phase 7 tracer in the browser, on the phone
 * (`mobile-chromium`) and on the desktop.
 *
 * The demo admin publishes through the real API; the worker (`ensureWorker`) runs the
 * `notifications.fanout` job; the member's bell (the TopBar slot on the phone, the rail row on the
 * desktop) shows a count badge after a reload (the LIVE badge is 07-03's); `/notificacoes` lists the
 * row with the admin's name, and a tap opens `/post/{postId}` (D-232).
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering the navigation from its own cache
 * would have these assertions reading what a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });

const CAPTION_PREFIX = 'Notificacao e2e';

let stopWorker: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  test.setTimeout(120_000);
  stopWorker = await ensureWorker();
});

test.afterAll(async () => {
  await deletePostsByCaptionPrefix(CAPTION_PREFIX);
  await closeNotificationsAdmin();
  await stopWorker();
});

test.describe('notifications tracer', () => {
  test('an admin post reaches the member bell and Notificações opens the post', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await clearNotifications('rede-demo');
    const caption = `${CAPTION_PREFIX} ${testInfo.project.name} ${Date.now()}`;

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const postId = await publishPostAs(users.demoAdmin, caption);

    // The bell's link carries the catalog label; exactly one of the TopBar / rail copies is visible.
    const bell = page.getByRole('link', { name: N.nav, exact: true }).filter({ visible: true });
    await expect(async () => {
      await page.goto(`${hosts.demo}/inicio`);
      await expect(bell).toHaveCount(1);
      await expect(
        bell
          .locator('span')
          .filter({ hasText: /^\d+\+?$/ })
          .first(),
      ).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });

    await bell.click();
    await expect(page).toHaveURL(/\/notificacoes$/);
    await expect(page.getByRole('heading', { level: 1, name: N.title })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: N.sections.unread })).toBeVisible();

    const row = page.getByTestId('notification-item').filter({ hasText: caption });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(seededFeed.demoAuthor);
    await expect(row.locator('.font-bold', { hasText: seededFeed.demoAuthor })).toBeVisible();
    await expect(row).toHaveAttribute('data-unread', 'true');

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/post/${postId}$`));
  });
});

/** One row by its excerpt, which the sentence prints between curly quotes (unique per fixture). */
const rowFor = (page: Page, excerpt: string) =>
  page.getByTestId('notification-item').filter({ hasText: `“${excerpt}”` });

/** The bell's link in whichever chrome is visible (the TopBar on the phone, the rail on desktop). */
const bellOf = (page: Page) =>
  page.getByRole('link', { name: N.nav, exact: true }).filter({ visible: true });

/**
 * NOTIF-02 / D-230 / D-231 / UI-D-250 / UI-D-252 (plan 07-01 Task 3): the list itself, on fixture
 * rows written as the migration role (`insertNotificationRows`), so every count here is exact.
 */
test.describe('notifications lista', () => {
  test.beforeEach(async () => {
    await clearNotifications('rede-demo');
  });

  test('Novas first with the mark-all control, then Anteriores, then the 90-day footer', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const rows = await insertNotificationRows(users.demoMember, { unread: 25, read: 5 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.first()).toHaveText(N.sections.unread);
    await expect(page.getByTestId('notifications-mark-all')).toHaveText(N.markAll);
    await expect(rowFor(page, rows.unread[0] as string)).toBeVisible();

    // Scroll the sentinel until the true end: Novas pages to its end BEFORE Anteriores starts.
    const footer = page.getByTestId('notifications-retention');
    await expect(async () => {
      await page.getByTestId('notification-item').last().scrollIntoViewIfNeeded();
      await expect(footer).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 45_000 });
    await expect(footer).toHaveText(N.retention);
    await expect(page.getByRole('heading', { level: 2, name: N.sections.read })).toBeVisible();
    await expect(page.getByTestId('notification-item')).toHaveCount(30);

    // Order on screen: every unread row, newest first, then every read row.
    const texts = await page.getByTestId('notification-item').allTextContents();
    const order = [...rows.unread, ...rows.read].map((excerpt) =>
      texts.findIndex((text) => text.includes(`“${excerpt}”`)),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  test('opening the list clears the bell on the next navigation, while the rows keep their tint', async ({
    page,
  }) => {
    const rows = await insertNotificationRows(users.demoMember, { unread: 3, read: 0 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(bellOf(page).locator('span').filter({ hasText: /^3$/ }).first()).toBeVisible();

    const seen = page.waitForResponse(
      (res) => res.url().endsWith('/api/notifications/seen') && res.request().method() === 'POST',
    );
    await page.goto(`${hosts.demo}/notificacoes`);
    expect((await seen).status()).toBe(204);

    await page.goto(`${hosts.demo}/inicio`);
    await expect(bellOf(page)).toHaveCount(1);
    await expect(
      bellOf(page)
        .locator('span')
        .filter({ hasText: /^\d+\+?$/ }),
    ).toHaveCount(0);

    await page.goto(`${hosts.demo}/notificacoes`);
    for (const excerpt of rows.unread) {
      await expect(rowFor(page, excerpt)).toHaveAttribute('data-unread', 'true');
    }
  });

  test('a tap on an unread row navigates to the post, and the row is read on the way back', async ({
    page,
  }) => {
    const rows = await insertNotificationRows(users.demoMember, { unread: 2, read: 0 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const target = rows.unread[0] as string;
    await expect(rowFor(page, target)).toHaveAttribute('data-unread', 'true');
    const read = page.waitForRequest(
      (req) =>
        /\/api\/notifications\/[0-9a-f-]{36}\/read$/.test(req.url()) && req.method() === 'POST',
    );
    await rowFor(page, target).click();
    await read;
    await expect(page).toHaveURL(new RegExp(`/post/${rows.postId}$`));

    // Back: the row is untinted — in place when the page cache restored the surface, or in
    // Anteriores after a fresh load. A fresh load that raced the keepalive POST is reloaded once more.
    await page.goBack();
    await expect(async () => {
      const state = await rowFor(page, target).getAttribute('data-unread', { timeout: 5_000 });
      if (state !== 'false') await page.reload();
      await expect(rowFor(page, target)).toHaveAttribute('data-unread', 'false', {
        timeout: 1_500,
      });
    }).toPass({ timeout: 20_000 });
    await expect(rowFor(page, rows.unread[1] as string)).toHaveAttribute('data-unread', 'true');
  });

  test('mark-all clears every tint and the control disappears', async ({ page }) => {
    const rows = await insertNotificationRows(users.demoMember, { unread: 4, read: 1 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const markAll = page.getByTestId('notifications-mark-all');
    await expect(markAll).toBeVisible();
    await markAll.click();
    for (const excerpt of rows.unread) {
      await expect(rowFor(page, excerpt)).toHaveAttribute('data-unread', 'false');
    }
    await expect(markAll).toHaveCount(0);

    // Persisted: the next load has no Novas section at all.
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: N.sections.unread })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: N.sections.read })).toBeVisible();
  });

  test('a member with no rows sees the empty state', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);
    await expect(page.getByTestId('notifications-empty')).toBeVisible();
    await expect(page.getByText(N.empty.title, { exact: true })).toBeVisible();
    await expect(page.getByTestId('notification-item')).toHaveCount(0);
  });

  test('at 320px the mark-all label stays on one line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px case is the phone project');
    await insertNotificationRows(users.demoMember, { unread: 2, read: 0 });
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const markAll = page.getByTestId('notifications-mark-all');
    await expect(markAll).toBeVisible();
    const box = await markAll.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(40);
    const wraps = await markAll.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(wraps).toBe(false);
    const heading = page.getByRole('heading', { level: 2, name: N.sections.unread });
    const headingBox = await heading.boundingBox();
    expect(
      Math.abs(
        (headingBox?.y ?? 0) +
          (headingBox?.height ?? 0) / 2 -
          ((box?.y ?? 0) + (box?.height ?? 0) / 2),
      ),
    ).toBeLessThan(12);
  });
});
