import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import postgres from 'postgres';
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
 * 07-03 (UI-D-253): the bell's accessible name is the plain label at zero and the catalog's
 * `navBadge` plural above it ("Notificações, 1 nova"), so the locator accepts the label alone or the
 * label followed by that state.
 */
const BELL_NAME = new RegExp(`^${N.nav.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, .+)?$`);

/** The catalog's own ICU rendering of the stateful name (never a hand-written plural). */
const tn = createTranslator({
  locale: 'pt-BR',
  messages: notificationMessages,
  namespace: 'notifications',
}) as unknown as (key: string, values?: Record<string, number>) => string;
const bellNameFor = (count: number) => tn('navBadge', { count });

/**
 * NOTIF-01 / NOTIF-02 / D-40 (plan 07-01): the Phase 7 tracer in the browser, on the phone
 * (`mobile-chromium`) and on the desktop.
 *
 * The demo admin publishes through the real API; the worker (`ensureWorker`) runs the
 * `notifications.fanout` job; the member's bell (the TopBar slot on the phone, the rail row on the
 * desktop) shows a count badge after a reload (the LIVE badge is `notifications ao vivo` below); `/notificacoes` lists the
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
    const bell = page.getByRole('link', { name: BELL_NAME }).filter({ visible: true });
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
  page.getByRole('link', { name: BELL_NAME }).filter({ visible: true });

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

/* ── 07-03: the live bell ─────────────────────────────────────────────────────────────────────── */

/** The feed catalog's composer copy (the admin publishes through the real composer in case 1). */
const feedCopy = JSON.parse(
  readFileSync(fileURLToPath(new URL('../messages/pt-BR/feed.json', import.meta.url)), 'utf8'),
).feed as { composer: { publish: string } };

const LIVE_PREFIX = `${CAPTION_PREFIX} ao vivo`;

/**
 * The count badge inside the visible bell: the `Badge` span, the direct child of the `aria-hidden`
 * wrapper (UI-D-253: the number is hidden from assistive technology; the link's name carries it).
 */
const badgeOf = (page: Page) => bellOf(page).locator('[aria-hidden] > span');

let liveDb: ReturnType<typeof postgres> | null = null;
const db = () => {
  liveDb ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 2 },
  );
  return liveDb;
};

/** The member's unseen rows (what the bell counts), read as the migration role. */
async function unseenOf(email: string): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from public.notifications n
      join auth.users u on u.id = n.user_id
     where u.email = ${email} and n.seen_at is null`;
  return row?.n ?? 0;
}

/** A second, independent browser context (its own cookies) signed in as `email` on the demo host. */
async function contextAs(browser: Browser, email: string, use: object) {
  const context = await browser.newContext(use);
  const page = await context.newPage();
  await login(page, email, SEED_PASSWORD, hosts.demo);
  return { context, page };
}

/**
 * NOTIF-02 live (ROADMAP SC 1), D-239, D-240, UI-D-253, UI-D-265 (plan 07-03): the bell and the open
 * list follow the organisation's publishing WITHOUT a reload, over the one Realtime client of the
 * window. The worker runs the fan-out (`ensureWorker` in the file's `beforeAll`); every signal is
 * ids-only and every number is refetched from the API through the BFF.
 */
test.describe('notifications ao vivo', () => {
  test.beforeEach(async () => {
    await clearNotifications('rede-demo');
  });

  test.afterAll(async () => {
    await deletePostsByCaptionPrefix(LIVE_PREFIX);
    await liveDb?.end();
    liveDb = null;
  });

  test('an admin publishing in another browser context moves the member bell from 0 to 1 without a reload', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    test.setTimeout(120_000);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(bellOf(page)).toHaveCount(1);
    await expect(badgeOf(page)).toHaveCount(0);
    await expect(bellOf(page)).toHaveAccessibleName(N.nav);

    const admin = await contextAs(browser, users.demoAdmin, {
      ...contextOptions,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      serviceWorkers: 'block',
    });
    try {
      const caption = `${LIVE_PREFIX} ${testInfo.project.name} ${Date.now()}`;
      await admin.page.goto(`${hosts.demo}/criar`);
      await admin.page.locator('#composer-caption').fill(caption);
      await admin.page
        .getByRole('button', { name: feedCopy.composer.publish, exact: true })
        .click();
      await expect(admin.page).toHaveURL(/\/post\/[0-9a-f-]{36}$/, { timeout: 30_000 });

      // NO-RELOAD WINDOW: from the admin's publish to the badge assertion below, the member's page is
      // never reloaded or navigated. The badge can only arrive through the Realtime signal.
      await expect(badgeOf(page)).toHaveText('1', { timeout: 15_000 });
      await expect(bellOf(page)).toHaveAccessibleName(bellNameFor(1));
    } finally {
      await admin.context.close();
    }
  });

  test('opening Notificações in one tab drops the badge in the other tab without a reload', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await insertNotificationRows(users.demoMember, { unread: 2, read: 0 }, 'Aba');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(badgeOf(page)).toHaveText('2');
    await expect(bellOf(page)).toHaveAccessibleName(bellNameFor(2));

    const tabA = await context.newPage();
    await tabA.goto(`${hosts.demo}/notificacoes`);
    await expect(tabA.getByTestId('notification-item')).toHaveCount(2);

    // NO-RELOAD WINDOW for `page` (tab B): the seen POST in tab A signals the member's own topic.
    await expect(badgeOf(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(bellOf(page)).toHaveAccessibleName(N.nav);
    await tabA.close();
  });

  test('with Notificações open, an admin publish adds a row at the top of Novas without a reload', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await insertNotificationRows(users.demoMember, { unread: 1, read: 0 }, 'Antiga');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);
    await expect(page.getByTestId('notification-item')).toHaveCount(1);

    const caption = `${LIVE_PREFIX} lista ${testInfo.project.name} ${Date.now()}`;
    await publishPostAs(users.demoAdmin, caption);

    // NO-RELOAD WINDOW: the row arrives through the signal and the list's own refetch.
    const fresh = rowFor(page, caption);
    await expect(fresh).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('notification-item').first()).toContainText(caption);
    await expect(fresh).toHaveAttribute('data-unread', 'true');
    await expect(rowFor(page, 'Antiga 1')).toBeVisible();
    // Seen is posted again for the merged row, so the member's bell stays at zero.
    await expect.poll(() => unseenOf(users.demoMember), { timeout: 10_000 }).toBe(0);
  });

  test('D-240: a signal the socket missed is caught up on refocus, not before', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    // A pass-through to the real Realtime server that discards the server's signal frames while
    // `dropping` is set (everything else — joins, heartbeats — flows untouched).
    const drop = { dropping: false, dropped: 0 };
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString('latin1');
        if (drop.dropping && text.includes('notifications.changed')) {
          drop.dropped++;
          return;
        }
        ws.send(message);
      });
    });

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(badgeOf(page)).toHaveCount(0);

    drop.dropping = true;
    await publishPostAs(
      users.demoAdmin,
      `${LIVE_PREFIX} perdida ${testInfo.project.name} ${Date.now()}`,
    );
    await expect.poll(() => unseenOf(users.demoMember), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => drop.dropped, { timeout: 15_000 }).toBeGreaterThan(0);
    drop.dropping = false;

    // The signal is gone: nothing moves on its own.
    await page.waitForTimeout(2_000);
    await expect(badgeOf(page)).toHaveCount(0);

    // Refocus: hidden, then visible again (D-240 refetch on visibilitychange).
    await page.evaluate(() => {
      let state: DocumentVisibilityState = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => state === 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10_000 });
  });

  test('D-239: the app badge mirrors the bell count', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: number[] = [];
      (window as unknown as { __appBadge: number[] }).__appBadge = calls;
      Object.defineProperty(navigator, 'setAppBadge', {
        configurable: true,
        value: (count?: number) => {
          calls.push(count ?? 0);
          return Promise.resolve();
        },
      });
      Object.defineProperty(navigator, 'clearAppBadge', {
        configurable: true,
        value: () => {
          calls.push(0);
          return Promise.resolve();
        },
      });
    });
    await insertNotificationRows(users.demoMember, { unread: 3, read: 0 }, 'Icone');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(badgeOf(page)).toHaveText('3');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __appBadge: number[] }).__appBadge.at(-1)),
      )
      .toBe(3);
  });

  test('UI-D-265: with Realtime unreachable the bell still shows the server count, and nothing says Conectando', async ({
    page,
  }) => {
    await page.route('**/api/realtime/token', (route) => route.fulfill({ status: 500, body: '' }));
    await insertNotificationRows(users.demoMember, { unread: 2, read: 0 }, 'Sem rede');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(badgeOf(page)).toHaveText('2');
    await expect(bellOf(page)).toHaveAccessibleName(bellNameFor(2));
    await page.goto(`${hosts.demo}/notificacoes`);
    await expect(page.getByTestId('notification-item')).toHaveCount(2);
    await expect(page.getByText(/conectando/i)).toHaveCount(0);
  });
});
