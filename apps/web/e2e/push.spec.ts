import { randomUUID } from 'node:crypto';
import { devices, expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import pwaMessages from '../messages/pt-BR/pwa.json' with { type: 'json' };
import { closeAdmin, createMember, deleteUserByEmail } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { fakeEndpoint, installFakePush, pushLog } from './push-fake';

/**
 * 07-07 (NOTIF-03, PWA-02, D-233, D-234): the push flows in the browser with a MOCKED push stack.
 *
 * An init script replaces `Notification` (its permission comes from the test; `requestPermission`
 * records its call and resolves to the configured answer), `PushManager` and
 * `navigator.serviceWorker` (a fake `ready` registration whose `pushManager` subscribes to
 * `https://push.fake.test/sub/<random>` with keys of valid lengths and echoes the VAPID key in
 * `options`). The fake subscription, the granted/denied permission and the call log live in
 * localStorage, so they survive a reload the way a real browser's do. Everything after the browser
 * is REAL: the BFF route, the API (`push.fake.test` is allowed under `PUSH_TRANSPORT=fake`, 07-06)
 * and the `push_subscriptions` row the assertions read.
 *
 * `serviceWorkers: 'block'`: the service worker is not under test here (lib/push-sw.test.ts pins
 * it), and a real worker answering navigations would read a previous run's cache (03-05).
 *
 * The UA matters: the phone project is an iPhone 14, which IS the iOS gate. Every case except the
 * iOS one runs with the Pixel 7 UA, so the 390px phone layout is exercised with a browser that can
 * subscribe; the iOS case runs with the iPhone 14 UA on both projects.
 *
 * Copy comes from the catalog, never from a literal.
 */

const N = notificationMessages.notifications;
const INSTALL_PUSH = pwaMessages.pwa.install.push;

test.use({ serviceWorkers: 'block' });

const ANDROID_UA = devices['Pixel 7'].userAgent;
const IPHONE_UA = devices['iPhone 14'].userAgent;

// ── database reads (a direct superuser connection, fixtures only) ─────────────────────────────────

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 2 },
  );
  return client;
}

async function subscriptionsOf(email: string): Promise<string[]> {
  const rows = await sql()<{ endpoint: string }[]>`
    select ps.endpoint from public.push_subscriptions ps
      join public.users u on u.id = ps.user_id
     where u.email = ${email}
     order by ps.created_at`;
  return rows.map((r) => r.endpoint);
}

async function clearSubscriptionsOf(email: string): Promise<void> {
  await sql()`
    delete from public.push_subscriptions ps using public.users u
     where u.id = ps.user_id and u.email = ${email}`;
}

const SUPPORT_EMAIL = `push-support-${randomUUID().slice(0, 8)}@rede-demo.test`;

test.afterAll(async () => {
  await clearSubscriptionsOf(users.demoMember);
  await deleteUserByEmail(SUPPORT_EMAIL);
  await closeAdmin();
  await client?.end();
  client = null;
});

const pushSwitch = (page: Page) =>
  page.locator('main').getByRole('switch', { name: N.push.switchLabel });
const pushRow = (page: Page) => page.locator('main [data-push-row]');
const softAsk = (page: Page) => page.locator('[data-push-softask]');

test.describe('push (a browser that can subscribe)', () => {
  // The phone project is an iPhone (the iOS gate); these cases need a subscribable browser, so both
  // projects browse with the Pixel 7 UA (the phone keeps its 390px iPhone viewport).
  test.use({ userAgent: ANDROID_UA });

  test.beforeEach(async () => {
    await clearSubscriptionsOf(users.demoMember);
  });

  test('1-2. Configurações: off → on saves ONE subscription; on → off deletes it', async ({
    page,
  }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);

    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'off');
    await expect(pushRow(page).locator('[data-push-subline]')).toHaveText(N.push.state.off);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');
    expect(await pushLog(page)).not.toContain('requestPermission');

    // Turn on: the prompt ONCE, then subscribe, then the save reaches the database.
    await pushSwitch(page).click();
    await expect(page.getByText(N.push.toasts.enabled)).toBeVisible();
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'on');
    await expect(pushRow(page).locator('[data-push-subline]')).toHaveText(N.push.state.on);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'true');
    const log = await pushLog(page);
    expect(log.filter((e) => e === 'requestPermission')).toHaveLength(1);
    expect(log.indexOf('requestPermission')).toBeLessThan(log.indexOf('subscribe'));
    const endpoint = await fakeEndpoint(page);
    expect(endpoint).toMatch(/^https:\/\/push\.fake\.test\/sub\/e2e-/);
    await expect.poll(() => subscriptionsOf(users.demoMember)).toEqual([endpoint]);

    // Turn off: unsubscribe, the row is deleted, the disabled toast.
    await pushSwitch(page).click();
    await expect(page.getByText(N.push.toasts.disabled)).toBeVisible();
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'off');
    expect(await pushLog(page)).toContain('unsubscribe');
    await expect.poll(() => subscriptionsOf(users.demoMember)).toEqual([]);
    // Turning off never prompts.
    expect((await pushLog(page)).filter((e) => e === 'requestPermission')).toHaveLength(1);
  });

  test('3. denied: the switch is disabled, the long denied line wraps at 320px, no prompt', async ({
    page,
  }) => {
    const longName = 'Associação de Moradores do Sul';
    expect(longName).toHaveLength(30);
    const [original] = await sql()<{ display_name: string }[]>`
      select display_name from public.tenants where slug = 'rede-demo'`;
    await sql()`update public.tenants set display_name = ${longName} where slug = 'rede-demo'`;
    try {
      await installFakePush(page, { permission: 'denied', answer: 'denied', pushManager: true });
      await page.setViewportSize({ width: 320, height: 720 });
      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/configuracoes`);

      await expect(pushRow(page)).toHaveAttribute('data-push-row', 'denied');
      await expect(pushSwitch(page)).toBeDisabled();
      const subline = pushRow(page).locator('[data-push-subline]');
      await expect(subline).toHaveText(N.push.state.denied.replace('{tenant}', longName));

      // E06 overflow backstop: the 44×24 track stays inside the row and the text wraps.
      const track = await pushSwitch(page).boundingBox();
      const row = await pushRow(page).boundingBox();
      const line = await subline.boundingBox();
      expect(track && row && line).toBeTruthy();
      if (track && row && line) {
        expect(Math.round(track.width)).toBe(44);
        expect(Math.round(track.height)).toBe(24);
        expect(track.x + track.width).toBeLessThanOrEqual(row.x + row.width);
        expect(track.x + track.width).toBeLessThanOrEqual(320);
        expect(line.height).toBeGreaterThan(18 * 2);
      }
      expect(await pushLog(page)).not.toContain('requestPermission');
    } finally {
      await sql()`update public.tenants set display_name = ${original?.display_name ?? 'Rede Demo'}
                  where slug = 'rede-demo'`;
    }
  });

  test('4. no PushManager: the row is unsupported and disabled', async ({ page }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: false });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'unsupported');
    await expect(pushRow(page).locator('[data-push-subline]')).toHaveText(N.push.state.unsupported);
    await expect(pushSwitch(page)).toBeDisabled();
  });

  test('6. the soft-ask card: member body, X dismisses for good on this device', async ({
    page,
  }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);

    await expect(softAsk(page)).toBeVisible();
    await expect(softAsk(page)).toContainText(N.softAsk.title);
    await expect(softAsk(page)).toContainText(
      N.softAsk.bodyMember.replace('{tenant}', 'Rede Demo'),
    );
    await expect(softAsk(page)).toHaveCount(1);

    await softAsk(page).getByRole('button', { name: N.softAsk.dismiss }).click();
    await expect(softAsk(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: N.title })).toBeVisible();
    // Decided after mount: give the client a beat, then it must still be absent.
    await page.waitForTimeout(1_000);
    await expect(softAsk(page)).toHaveCount(0);
    expect(await pushLog(page)).not.toContain('requestPermission');
  });

  test('6b. staff (a support member) get the staff body', async ({ page }) => {
    await deleteUserByEmail(SUPPORT_EMAIL);
    await createMember(SUPPORT_EMAIL, SEED_PASSWORD, 'rede-demo', 'support_tenant');
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/notificacoes`);
    await expect(softAsk(page)).toContainText(N.softAsk.bodyStaff);
    await expect(softAsk(page)).not.toContainText(
      N.softAsk.bodyMember.replace('{tenant}', 'Rede Demo'),
    );
  });

  test('7. the card turns push on and is absent once subscribed, and never on Configurações', async ({
    page,
  }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'off');
    await expect(softAsk(page)).toHaveCount(0);

    await page.goto(`${hosts.demo}/notificacoes`);
    await softAsk(page).getByRole('button', { name: N.softAsk.cta }).click();
    await expect(page.getByText(N.push.toasts.enabled)).toBeVisible();
    await expect(softAsk(page)).toHaveCount(0);
    await expect.poll(async () => (await subscriptionsOf(users.demoMember)).length).toBe(1);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: N.title })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(softAsk(page)).toHaveCount(0);
    expect((await pushLog(page)).filter((e) => e === 'requestPermission')).toHaveLength(1);
  });

  test('8. logging out from Configurações unsubscribes and deletes this device first', async ({
    page,
  }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await pushSwitch(page).click();
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'on');
    await expect.poll(async () => (await subscriptionsOf(users.demoMember)).length).toBe(1);

    await page.locator('main').getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    expect(await pushLog(page)).toContain('unsubscribe');
    expect(await fakeEndpoint(page)).toBeNull();
    await expect.poll(() => subscriptionsOf(users.demoMember)).toEqual([]);
  });

  test('8b. the desktop rail Sair awaits the same cleanup (the kernel BeforeLogout seam)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the rail exists only on the desktop');
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await pushSwitch(page).click();
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'on');
    await expect.poll(async () => (await subscriptionsOf(users.demoMember)).length).toBe(1);

    await page.goto(`${hosts.demo}/inicio`);
    await page.locator('aside').getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    expect(await pushLog(page)).toContain('unsubscribe');
    await expect.poll(() => subscriptionsOf(users.demoMember)).toEqual([]);
  });

  test('9. no page load ever prompts (D-233)', async ({ page }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    for (const path of ['/inicio', '/notificacoes', '/configuracoes']) {
      await page.goto(`${hosts.demo}${path}`);
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(1_000);
    expect(await pushLog(page)).not.toContain('requestPermission');
    expect(await subscriptionsOf(users.demoMember)).toEqual([]);
  });
});

test.describe('push (iPhone Safari outside the Home Screen app, D-234 / PWA-02)', () => {
  test.use({ userAgent: IPHONE_UA });

  test('5. the switch and the soft-ask open the InstallHint push variant and NEVER prompt', async ({
    page,
  }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted', pushManager: true });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const sheet = page.getByRole('dialog').filter({ hasText: INSTALL_PUSH.title });

    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(pushRow(page)).toHaveAttribute('data-push-row', 'ios-install');
    await expect(pushRow(page).locator('[data-push-subline]')).toHaveText(N.push.state.iosInstall);
    await expect(pushSwitch(page)).toBeEnabled();
    await pushSwitch(page).click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(INSTALL_PUSH.body);
    await expect(sheet.getByRole('button')).toHaveCount(1);
    await sheet.getByRole('button', { name: INSTALL_PUSH.confirm }).click();
    await expect(sheet).toHaveCount(0);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');

    await page.goto(`${hosts.demo}/notificacoes`);
    await softAsk(page).getByRole('button', { name: N.softAsk.cta }).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(softAsk(page)).toBeVisible();

    expect(await pushLog(page)).not.toContain('requestPermission');
    expect(await pushLog(page)).not.toContain('subscribe');
  });
});

/**
 * 07 review C-WR-01: rede-lab has the notifications module OFF, so the API refuses every push route.
 * The tenant shell offers no push switch (no permission prompt spent for nothing), never re-saves a
 * subscription on open, and `/notificacoes` is a plain miss like any module page whose module is off.
 */
test.describe('push com o módulo de notificações desligado', () => {
  test.use({ userAgent: ANDROID_UA });

  test('rede-lab: no push row, no subscription POST, and /notificacoes is not found', async ({
    page,
  }) => {
    await installFakePush(page, { permission: 'granted', answer: 'granted', pushManager: true });
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/push/subscriptions')) {
        posts.push(req.url());
      }
    });
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/configuracoes`);
    // The row is server-rendered (its `checking` state) wherever it exists, so absence is decided here.
    await expect(page.locator('main')).toBeVisible();
    await expect(pushRow(page)).toHaveCount(0);

    // The default not-found screen (the streamed shell answers 200; the reels e13 precedent).
    await page.goto(`${hosts.lab}/notificacoes`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(softAsk(page)).toHaveCount(0);
    expect(posts).toEqual([]);
  });
});
