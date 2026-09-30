import { expect, test } from '@playwright/test';
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import { hosts, login, SEED_PASSWORD, seededFeed, users } from './fixtures';
import {
  clearNotifications,
  closeNotificationsAdmin,
  deletePostsByCaptionPrefix,
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
