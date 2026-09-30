import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import postgres from 'postgres';
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import { closeChatAdmin, SEED_SUPPORT_CONVERSATION_ID, setMemberReadSeq } from './chat-admin';
import { hosts, login, SEED_PASSWORD, seededFeed, seededFeedPaging, users } from './fixtures';
import {
  clearNotifications,
  closeNotificationsAdmin,
  commentAs,
  createEventAs,
  deleteCommentsByBodyPrefix,
  deleteEventsByTitlePrefix,
  deletePostAs,
  deletePostsByCaptionPrefix,
  demoEventBody,
  foreignCommentId,
  insertExpiredStoryRow,
  insertLongRow,
  insertNotificationRows,
  insertReminderRow,
  likeCommentAs,
  publishPostAs,
  rowsOf,
  seedLongThread,
  softDeleteComment,
  updateEventAs,
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
  await closeChatAdmin();
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
    // 07-09 (D-239, chat half): the seeded support thread (07-08) carries a staff reply the member
    // has not read, so the icon also counts the member's chat dot as ONE. The read position is put
    // back to the seed's 0 first, so a previous visit to /suporte cannot change the sum.
    await setMemberReadSeq(SEED_SUPPORT_CONVERSATION_ID, 0);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(badgeOf(page)).toHaveText('3');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __appBadge: number[] }).__appBadge.at(-1)),
      )
      .toBe(3 + 1);
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

/**
 * NOTIF-01 kinds, D-232 routing, UI-D-251 variants and UI-D-254 landings (plan 07-04 Task 3), on the
 * phone and the desktop. Producers run through the REAL API and the worker's fan-out
 * (`ensureWorker` in the file's `beforeAll`); fixture rows cover only what no producer can reach on
 * demand (an expired story, a 60-character actor).
 */
const F = feedMessages.feed;
const TIPOS_PREFIX = 'Tipos e2e';

/** Waits until the worker has written `count` rows of `kind` for `email` (the fan-out is async). */
async function waitForRows(email: string, kind: string, count: number, removed?: boolean) {
  await expect
    .poll(() => rowsOf(email, kind, removed === undefined ? {} : { removed }), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(count);
}

test.describe('notifications tipos', () => {
  test.beforeEach(async () => {
    await clearNotifications('rede-demo');
  });

  test.afterAll(async () => {
    await deleteCommentsByBodyPrefix(TIPOS_PREFIX);
    await deletePostsByCaptionPrefix(TIPOS_PREFIX);
  });

  test('a like and a reply on the member comment reach the bell, and the reply lands tinted first', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const stamp = `${testInfo.project.name} ${Date.now()}`;
    const postId = await publishPostAs(users.demoAdmin, `${TIPOS_PREFIX} post ${stamp}`);
    const mine = await commentAs(users.demoMember, postId, `${TIPOS_PREFIX} meu ${stamp}`);
    // A NEWER root by someone else: without the pin, the member comment would not be first.
    await commentAs(users.demoAdmin, postId, `${TIPOS_PREFIX} outra raiz ${stamp}`);
    await likeCommentAs(users.demoAdmin, mine);
    const replyBody = `${TIPOS_PREFIX} resposta ${stamp}`;
    const reply = await commentAs(users.demoAdmin, postId, replyBody, mine);
    await waitForRows(users.demoMember, 'feed.comment_liked', 1);
    await waitForRows(users.demoMember, 'feed.comment_replied', 1);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const liked = page
      .getByTestId('notification-item')
      .filter({ hasText: 'curtiu seu comentário' });
    await expect(liked).toHaveCount(1);
    await expect(liked).toContainText(`“${TIPOS_PREFIX} meu ${stamp}”`);
    // UI-D-08: the one coloured glyph.
    await expect(liked.locator('svg.text-like')).toHaveCount(1);

    const replied = page
      .getByTestId('notification-item')
      .filter({ hasText: 'respondeu ao seu comentário' });
    await expect(replied).toHaveCount(1);
    await expect(replied.locator('svg.text-like')).toHaveCount(0);
    await replied.click();

    await expect(page).toHaveURL(new RegExp(`/post/${postId}\\?comentario=${reply}$`));
    const rows = page.locator('[data-comments-rows]').filter({ visible: true });
    await expect(rows.locator('[data-comment-kind="root"]').first()).toHaveAttribute(
      'data-comment-id',
      mine,
    );
    const target = rows.locator(`[data-comment-id="${reply}"]`);
    await expect(target).toBeVisible();
    await expect(target).toContainText(replyBody);
    await expect(target).toHaveAttribute('data-comment-highlighted', 'true');
    await expect(target).toHaveClass(/bg-brand\/10/);
    // The tint fades after 2.4 s; the row stays exactly where it is.
    await expect(target).not.toHaveAttribute('data-comment-highlighted', 'true', {
      timeout: 6_000,
    });
    await expect(target).toBeVisible();
  });

  test('E08 backstop: a target deep in a 200-comment post is first, tinted, and never repeats', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const { postId, targetId } = await seedLongThread(
      `${TIPOS_PREFIX} longo ${testInfo.project.name} ${Date.now()}`,
    );
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/post/${postId}?comentario=${targetId}`);

    // The visible list only: a route the router keeps hidden for back navigation is not the page.
    const rows = page.locator('[data-comments-rows]').filter({ visible: true });
    await expect(rows).toHaveCount(1);
    const roots = rows.locator('[data-comment-kind="root"]');
    await expect(roots.first()).toHaveAttribute('data-comment-id', targetId);
    await expect(roots.first()).toHaveAttribute('data-comment-highlighted', 'true');
    await expect(roots.first()).toBeInViewport();

    // Page to the end: 200 roots in pages of 20, with the pinned one drawn exactly once.
    const loadMore = page.getByRole('button', { name: F.comments.loadMore });
    for (let pageNo = 1; pageNo <= 12 && (await loadMore.count()) > 0; pageNo++) {
      await loadMore.click();
      // Page N adds 20 roots under the pinned one (the pinned root's own page adds 19).
      await expect
        .poll(() => roots.count())
        .toBeGreaterThanOrEqual(Math.min(1 + 20 * (pageNo + 1) - 1, 200));
    }
    await expect(loadMore).toHaveCount(0);
    await expect(roots).toHaveCount(200);
    await expect(rows.locator(`[data-comment-id="${targetId}"]`)).toHaveCount(1);
  });

  test('a foreign or deleted comentario shows the post and the missing toast; junk is ignored', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const stamp = `${testInfo.project.name} ${Date.now()}`;
    const postId = await publishPostAs(users.demoAdmin, `${TIPOS_PREFIX} ausente ${stamp}`);
    const gone = await commentAs(users.demoMember, postId, `${TIPOS_PREFIX} apagado ${stamp}`);
    await softDeleteComment(gone);
    const foreign = await foreignCommentId();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    for (const id of [foreign, gone]) {
      await page.goto(`${hosts.demo}/post/${postId}?comentario=${id}`);
      await expect(
        page.getByText(`${TIPOS_PREFIX} ausente ${stamp}`).filter({ visible: true }),
      ).toBeVisible();
      await expect(page.getByText(F.comments.targetMissing)).toHaveCount(1);
      await expect(page.locator('[data-comment-highlighted]')).toHaveCount(0);
      // The notice fires once: the parameter leaves the address, so a reload is silent.
      await expect(page).toHaveURL(new RegExp(`/post/${postId}$`));
    }

    await page.goto(`${hosts.demo}/post/${postId}?comentario=nao-e-um-id`);
    await expect(
      page.getByText(`${TIPOS_PREFIX} ausente ${stamp}`).filter({ visible: true }),
    ).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.getByText(F.comments.targetMissing)).toHaveCount(0);
  });

  test('an expired story row lands on Início with "Este story expirou." once', async ({ page }) => {
    test.setTimeout(90_000);
    await insertExpiredStoryRow(users.demoMember);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const story = page
      .getByTestId('notification-item')
      .filter({ hasText: 'publicou um novo story' });
    await expect(story).toHaveCount(1);
    await expect(story).toHaveAttribute('href', '/inicio?aviso=story-expirado');
    await story.click();

    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByText(N.fallback.storyExpired)).toHaveCount(1);

    await page.reload();
    await page.waitForTimeout(1_500);
    await expect(page.getByText(N.fallback.storyExpired)).toHaveCount(0);

    // Any other `aviso` is ignored in silence (D-93).
    await page.goto(`${hosts.demo}/inicio?aviso=qualquer-coisa`);
    await page.waitForTimeout(1_000);
    await expect(page.getByText(N.fallback.storyExpired)).toHaveCount(0);
  });

  test('deleting the post turns its rows into the removed button, and a tap toasts', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const stamp = `${testInfo.project.name} ${Date.now()}`;
    const postId = await publishPostAs(users.demoAdmin, `${TIPOS_PREFIX} removido ${stamp}`);
    const mine = await commentAs(users.demoMember, postId, `${TIPOS_PREFIX} alvo ${stamp}`);
    await likeCommentAs(users.demoAdmin, mine);
    await waitForRows(users.demoMember, 'feed.comment_liked', 1);
    await waitForRows(users.demoMember, 'feed.post', 1);

    await deletePostAs(users.demoAdmin, postId);
    await waitForRows(users.demoMember, 'feed.comment_liked', 1, true);
    await waitForRows(users.demoMember, 'feed.post', 1, true);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    const removed = page.locator('[data-testid="notification-item"][data-removed="true"]');
    await expect(removed).toHaveCount(2);
    await expect(page.getByTestId('notification-item').filter({ hasText: stamp })).toHaveCount(0);
    for (const row of await removed.all()) {
      await expect(row).toHaveText(new RegExp(N.kinds.removed.replace(/[.]/g, '\\.')));
      expect(await row.evaluate((node) => node.tagName)).toBe('BUTTON');
    }

    const first = removed.first();
    await expect(first).toHaveAttribute('data-unread', 'true');
    await first.click();
    await expect(page).toHaveURL(/\/notificacoes$/);
    await expect(page.getByText(N.fallback.removed)).toHaveCount(1);
    await expect(first).toHaveAttribute('data-unread', 'false');
  });

  test('E03 backstop: a 60-char actor with an 80-char excerpt clamps at three lines at 320px', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const displayName60 = 'Maria Aparecida dos Santos Figueiredo de Albuquerque Monteir';
    const excerpt80 =
      'Atenção: a reunião de planejamento do segundo semestre mudou para a sala 3 do p…';
    expect(displayName60).toHaveLength(60);
    expect([...excerpt80]).toHaveLength(80);
    const restore = await insertLongRow(users.demoMember, {
      longName: seededFeedPaging.longDisplayName,
      displayName60,
      excerpt80,
      community: 'Núcleo de Voluntários do Programa de Formação',
    });
    try {
      await page.setViewportSize({ width: 320, height: 720 });
      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/notificacoes`);

      const row = page.getByTestId('notification-item').filter({ hasText: displayName60 });
      await expect(row).toHaveCount(1);
      const sentence = row.locator('.line-clamp-3');
      // Measured only once the row is laid out (a count alone does not wait for layout).
      await expect(sentence).toBeVisible();
      await expect.poll(async () => (await sentence.boundingBox())?.height ?? 0).toBeGreaterThan(0);
      // The clamped height, against the same text laid out unclamped at the same width: the
      // sentence really is longer than three lines, and the row shows exactly three of them.
      const clamp = await sentence.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const clone = node.cloneNode(true) as HTMLElement;
        clone.classList.remove('line-clamp-3');
        Object.assign(clone.style, {
          display: 'block',
          position: 'absolute',
          visibility: 'hidden',
          width: `${rect.width}px`,
        });
        node.parentElement?.appendChild(clone);
        const full = clone.getBoundingClientRect().height;
        clone.remove();
        return {
          height: rect.height,
          full,
          lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
        };
      });
      expect(clamp.height).toBeLessThanOrEqual(clamp.lineHeight * 3 + 1);
      expect(clamp.height).toBeGreaterThan(clamp.lineHeight * 2);
      expect(clamp.full).toBeGreaterThan(clamp.height + clamp.lineHeight);

      const preview = row.locator('.h-11.w-11');
      await expect(preview).toBeVisible();
      const [rowBox, previewBox] = await Promise.all([row.boundingBox(), preview.boundingBox()]);
      expect(previewBox?.width).toBe(44);
      expect((previewBox?.x ?? 0) + (previewBox?.width ?? 0)).toBeLessThanOrEqual(
        (rowBox?.x ?? 0) + (rowBox?.width ?? 0),
      );
      expect(rowBox?.width).toBeLessThanOrEqual(320);
    } finally {
      await restore();
    }
  });
});

/**
 * EVENT-07 / D-226 / UI-D-251 / D-232 (plan 07-05 Task 2), on the phone and the desktop: the new
 * event row names its creator and prints the when-line in the TENANT's clock (São Paulo), even on a
 * device in Manaus; the actor-less reminder row sits on the clock disc; every event row opens
 * `/eventos/{id}`; and an edit stays silent (D-214). The event is created through the REAL API and
 * the worker's fan-out (`ensureWorker` in the file's `beforeAll`); the reminder row is a fixture,
 * because its job fires an hour before the start.
 */
const EVENTOS_PREFIX = 'Eventos e2e';
const EVENTS_ZONE = 'America/Sao_Paulo';

/** The catalog's own rendering of a sentence, with the `<b>` actor tag flattened to its text. */
const tr = createTranslator({
  locale: 'pt-BR',
  messages: notificationMessages,
  namespace: 'notifications',
}) as unknown as {
  (key: string, values?: Record<string, string>): string;
  rich: (key: string, values: Record<string, unknown>) => unknown;
};
const flat = (node: unknown): string =>
  Array.isArray(node) ? node.map(flat).join('') : typeof node === 'string' ? node : '';

/** `19:00` and `seg., 12 de out.` in a zone (the formats of `lib/events-view.ts`, UI-D-203). */
const eventTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
const eventDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));

/** The new-event sentence as the catalog renders it for `title` at `startsAt` in `timeZone`. */
function eventSentence(title: string, startsAt: string, timeZone: string): string {
  const when = tr('kinds.eventWhen', {
    date: eventDate(startsAt, timeZone),
    time: eventTime(startsAt, timeZone),
  });
  return flat(
    tr.rich('kinds.event', {
      actor: seededFeed.demoAuthor,
      title,
      when,
      b: (chunks: unknown) => flat(chunks),
    }),
  );
}

test.describe('notifications eventos', () => {
  test.beforeEach(async () => {
    await clearNotifications('rede-demo');
  });

  test.afterAll(async () => {
    await deleteEventsByTitlePrefix(EVENTOS_PREFIX);
  });

  test('a new event reaches the member list with the tenant-clock when-line and opens the event', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const title = `${EVENTOS_PREFIX} novo ${testInfo.project.name} ${Date.now()}`;
    const event = await createEventAs(users.demoAdmin, title);
    await waitForRows(users.demoMember, 'events.event', 1);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);
    const row = page.getByTestId('notification-item').filter({ hasText: `“${title}”` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(eventSentence(title, event.startsAt, EVENTS_ZONE));
    // The creator's avatar leads the row, with the calendar glyph on its disc.
    await expect(row.locator('svg.lucide-calendar-days')).toHaveCount(1);
    await expect(row.locator('.font-bold', { hasText: seededFeed.demoAuthor })).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${event.id}$`));
  });

  test('an actor-less reminder row sits on the clock disc and reads "Daqui a 1 hora"', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const title = `${EVENTOS_PREFIX} lembrete ${testInfo.project.name} ${Date.now()}`;
    const event = await createEventAs(users.demoAdmin, title);
    await waitForRows(users.demoMember, 'events.event', 1);
    await clearNotifications('rede-demo');
    await insertReminderRow(users.demoMember, { ...event, title }, '1h');

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);
    const row = page.getByTestId('notification-item').filter({ hasText: `“${title}”` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(
      tr('kinds.reminder1h', { title, time: eventTime(event.startsAt, EVENTS_ZONE) }),
    );
    // Actor-less (UI-D-251): the 40px tertiary disc with the clock glyph, and no bold actor.
    await expect(row.locator('.bg-bg-tertiary.rounded-full svg.lucide-calendar-clock')).toHaveCount(
      1,
    );
    await expect(row.locator('.font-bold')).toHaveCount(0);
    await expect(row.locator('img')).toHaveCount(0);

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${event.id}$`));
  });

  test("D-214: editing the event's title adds no new row", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const title = `${EVENTOS_PREFIX} editado ${testInfo.project.name} ${Date.now()}`;
    const event = await createEventAs(users.demoAdmin, title);
    await waitForRows(users.demoMember, 'events.event', 1);

    const renamed = `${title} renomeado`;
    await updateEventAs(users.demoAdmin, event.id, { ...demoEventBody(title), title: renamed });
    // The worker is live: give it the time a fan-out takes, then the count must not have moved.
    await page.waitForTimeout(3_000);
    await expect.poll(() => rowsOf(users.demoMember, 'events.event'), { timeout: 3_000 }).toBe(1);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);
    const about = page.getByTestId('notification-item').filter({ hasText: EVENTOS_PREFIX });
    await expect(about).toHaveCount(1);
  });

  test.describe('on a device in another timezone', () => {
    test.use({ timezoneId: 'America/Manaus' });

    test('the row reads the TENANT wall clock, not the device one', async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const title = `${EVENTOS_PREFIX} fuso ${testInfo.project.name} ${Date.now()}`;
      const event = await createEventAs(users.demoAdmin, title);
      await waitForRows(users.demoMember, 'events.event', 1);

      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
        'America/Manaus',
      );
      await page.goto(`${hosts.demo}/notificacoes`);
      const row = page.getByTestId('notification-item').filter({ hasText: `“${title}”` });
      await expect(row).toHaveCount(1);
      const tenantTime = eventTime(event.startsAt, EVENTS_ZONE);
      const deviceTime = eventTime(event.startsAt, 'America/Manaus');
      expect(tenantTime).not.toBe(deviceTime);
      await expect(row).toContainText(eventSentence(title, event.startsAt, EVENTS_ZONE));
      await expect(row).not.toContainText(deviceTime);
    });
  });
});
