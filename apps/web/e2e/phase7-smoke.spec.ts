import { type Browser, devices, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import postgres from 'postgres';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import pwaMessages from '../messages/pt-BR/pwa.json' with { type: 'json' };
import { closeAdmin } from './admin';
import {
  closeChatAdmin,
  replyAsSupport,
  resetMemberConversation,
  resetStaffInbox,
  SUPPORT_EMAIL,
} from './chat-admin';
import { type ApiFetch, apiSession, closeDomainsAdmin } from './domains-admin';
import {
  closeEventsAdmin,
  createEventsTenant,
  deleteEventsTenant,
  type EventsTenant,
} from './events-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  clearNotifications,
  closeNotificationsAdmin,
  createEventAs,
  deleteEventsByTitlePrefix,
  deletePostsByCaptionPrefix,
  insertReminderRow,
  publishPostAs,
  rowsOf,
} from './notifications-admin';
import { fakeEndpoint, installFakePush, pushLog } from './push-fake';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 7 smoke (plan 07-11): the phase's witness, in the shape 02-16 established and 03-08, 04-10,
 * 05-08 and 06-09 repeated. One serial spec on the local stack, real fixtures, each ROADMAP Phase 7
 * success criterion asserted once, and the module flags witnessed in both directions.
 *
 *   1. NOTIF-01/02 (SC 1): an admin publish reaches a member's bell WITHOUT a reload, the list shows
 *      the row and a tap opens the post; an actor-less reminder row renders on the clock disc; and
 *      mark-all clears every tint.
 *   2. NOTIF-03 / PWA-02 (SC 2): with a MOCKED push stack (`push-fake.ts`, no real push service), the
 *      Configurações switch subscribes and a `push_subscriptions` row exists; an iPhone UA outside
 *      the Home Screen app gets the install hint from the soft-ask CTA and no permission call.
 *   3. CHAT-02/03/04 (SC 3): a member's message appears live in the support user's inbox, the staff
 *      reply appears live in the member's thread, and a later reply turns the member's chat slot
 *      into the dot while the member is on Início.
 *   4. SC 4 / D-40 / MOD-*: with `notifications` and `chat` DISABLED for a tenant, neither TopBar
 *      slot renders and `/v1/notifications` plus `/v1/chat/support` answer 404 `MODULE_DISABLED`;
 *      the flags flip back ON and both slots return within the flags-cache window.
 *
 * Criterion 4 runs on a THROWAWAY tenant rather than rede-demo: `tenant-fixtures.ts` forbids flipping
 * a seed tenant's flags (they sit in the API's 30 s cache, so every later spec in the run would read
 * a disabled module). The throwaway tenant starts with both modules ON, so the witness is a tenant
 * that demonstrably HAD the slots.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a worker answering a navigation from its cache would
 * have these assertions reading what a previous run left behind.
 *
 * **What this spec deliberately does not prove**, carried to `docs/phase-07-device-test-plan.md` and
 * the phase UAT rather than counted as passing: a real push delivered by FCM/APNs/Mozilla (local and
 * CI run `PUSH_TRANSPORT=fake`), the iOS 16.4+ prompt from a Home Screen app, the banner's tenant
 * name and icon, the tag replacing a banner, the foreground quiet on Android, the app-icon badge on a
 * device, and the composer above a real keyboard. Every one of those rows is `blocked — not run`.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (seeded rede-demo, a throwaway tenant, direct DB fixtures)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const N = notificationMessages.notifications;
const C = chatMessages.chat;
const APP = appMessages.app;
const INSTALL_PUSH = pwaMessages.pwa.install.push;

const ANDROID_UA = devices['Pixel 7'].userAgent;
const IPHONE_UA = devices['iPhone 14'].userAgent;

/** A seeded demo member no other spec opens a support thread for. */
const CHAT_MEMBER = 'cristovao.nobrega@rede-demo.local';
const CAPTION_PREFIX = 'Smoke fase 7';
const EVENT_PREFIX = 'Smoke fase 7 evento';

/** Per-run, per-project slug for the throwaway tenant (hosts sit in 60 s caches: never reuse one). */
const RUN = Date.now().toString(36);
const slugFor = (project: string) => `p7off-${RUN}-${project.startsWith('mobile') ? 'm' : 'd'}`;

// ── locators ─────────────────────────────────────────────────────────────────────────────────────

/** A module's TopBar slot (the phone) or rail row (the desktop), whichever chrome is visible. */
const slot = (page: Page, key: 'notifications' | 'chat') =>
  page.locator(`a[data-slot="${key}"]`).filter({ visible: true });
/** The count badge inside the visible bell (UI-D-253: the number is `aria-hidden`). */
const bellBadge = (page: Page) => slot(page, 'notifications').locator('[aria-hidden] > span');
const notificationRow = (page: Page, text: string) =>
  page.getByTestId('notification-item').filter({ hasText: text });

const listPane = (page: Page) => page.locator('[data-support-list]');
const thread = (page: Page) => page.locator('[data-chat-thread]').filter({ visible: true });
const bubbles = (page: Page) => thread(page).locator('[data-chat-message]');
const composerField = (page: Page) => page.getByRole('textbox', { name: C.composer.label });
const sendButton = (page: Page) => page.getByRole('button', { name: C.composer.send });

const pushSwitch = (page: Page) =>
  page.locator('main').getByRole('switch', { name: N.push.switchLabel });
const pushRow = (page: Page) => page.locator('main [data-push-row]');
const softAsk = (page: Page) => page.locator('[data-push-softask]');

const tn = createTranslator({
  locale: 'pt-BR',
  messages: notificationMessages,
  namespace: 'notifications',
}) as unknown as (key: string, values?: Record<string, number>) => string;

async function send(page: Page, text: string): Promise<void> {
  await composerField(page).fill(text);
  await sendButton(page).click();
}

/** `{ status, code }` of one API call, so a 403 can never be read as a 404 by accident. */
async function answer(api: ApiFetch, path: string, host: string) {
  const res = await api(path, {}, host);
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return { status: res.status, code: body.error?.code ?? null };
}

type DeviceUse = Parameters<Browser['newContext']>[0];

// ── direct database reads (the superuser fixture connection) ────────────────────────────────────

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

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

let stopWorker: () => Promise<void> = async () => {};
let off: EventsTenant | null = null;
let offApi: ApiFetch | null = null;

test.beforeAll(async ({ browser: _browser }, testInfo) => {
  test.setTimeout(180_000);
  // The fan-out (`notifications.fanout`) runs in the worker, as in production.
  stopWorker = await ensureWorker();
  off = await createEventsTenant(slugFor(testInfo.project.name), SEED_PASSWORD, [
    'feed',
    'notifications',
    'chat',
  ]);
  offApi = await apiSession(off.memberEmail, SEED_PASSWORD);
});

test.afterAll(async ({ browser: _browser }, testInfo) => {
  await deleteEventsTenant(slugFor(testInfo.project.name));
  await clearNotifications('rede-demo');
  await deletePostsByCaptionPrefix(CAPTION_PREFIX);
  await deleteEventsByTitlePrefix(EVENT_PREFIX);
  await clearSubscriptionsOf(users.demoMember);
  await resetMemberConversation(CHAT_MEMBER);
  await resetStaffInbox();
  await client?.end();
  client = null;
  await closeNotificationsAdmin();
  await closeChatAdmin();
  await closeEventsAdmin();
  await closeTenantFixtures();
  await closeDomainsAdmin();
  await closeAdmin();
  await stopWorker();
});

test.describe('Phase 7 smoke — notifications, Web Push and support chat, and the four criteria', () => {
  test('1. criterion 1: an admin publish reaches the bell live, the list opens the post, a reminder renders actor-less, and mark-all clears the tints', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await clearNotifications('rede-demo');
    const caption = `${CAPTION_PREFIX} ${testInfo.project.name} ${Date.now()}`;

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(slot(page, 'notifications')).toHaveCount(1);
    await expect(bellBadge(page)).toHaveCount(0);
    await expect(slot(page, 'notifications')).toHaveAccessibleName(N.nav);
    // Let the window's one Realtime client join `tenant:<t>:user:<u>` before the publish.
    await page.waitForTimeout(1_500);

    // NO-RELOAD WINDOW: from the publish to the badge, the member's page is never navigated. The
    // badge can only arrive through the Realtime signal and the counters refetch it triggers.
    const postId = await publishPostAs(users.demoAdmin, caption);
    await expect(bellBadge(page)).toHaveText('1', { timeout: 30_000 });
    await expect(slot(page, 'notifications')).toHaveAccessibleName(tn('navBadge', { count: 1 }));

    // The list shows the row, unread, and a tap opens the post (D-232).
    await slot(page, 'notifications').click();
    await expect(page).toHaveURL(/\/notificacoes$/);
    await expect(page.getByRole('heading', { level: 1, name: N.title })).toBeVisible();
    const postRow = notificationRow(page, caption);
    await expect(postRow).toHaveCount(1);
    await expect(postRow).toHaveAttribute('data-unread', 'true');
    await postRow.click();
    await expect(page).toHaveURL(new RegExp(`/post/${postId}$`));

    // A reminder row (the job fires an hour before the start, so the row is a fixture): actor-less,
    // on the 40px tertiary disc with the clock glyph, and no bold actor (UI-D-251).
    const title = `${EVENT_PREFIX} ${testInfo.project.name} ${Date.now()}`;
    const event = await createEventAs(users.demoAdmin, title);
    await expect
      .poll(() => rowsOf(users.demoMember, 'events.event'), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(1);
    await sql()`
      delete from public.notifications n using auth.users u
       where u.id = n.user_id and u.email = ${users.demoMember} and n.kind = 'events.event'`;
    await insertReminderRow(users.demoMember, { ...event, title }, '1h');

    await page.goto(`${hosts.demo}/notificacoes`);
    const reminder = notificationRow(page, `“${title}”`);
    await expect(reminder).toHaveCount(1);
    await expect(
      reminder.locator('.bg-bg-tertiary.rounded-full svg.lucide-calendar-clock'),
    ).toHaveCount(1);
    await expect(reminder.locator('.font-bold')).toHaveCount(0);
    await expect(reminder).toHaveAttribute('data-unread', 'true');

    // Mark-all: every tint clears, the control disappears, and the next load has no Novas section.
    const markAll = page.getByTestId('notifications-mark-all');
    await expect(markAll).toHaveText(N.markAll);
    await markAll.click();
    const items = page.getByTestId('notification-item');
    await expect(items.first()).toBeVisible();
    for (const row of await items.all()) {
      await expect(row).toHaveAttribute('data-unread', 'false');
    }
    await expect(markAll).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: N.sections.unread })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: N.sections.read })).toBeVisible();
  });

  test('2. criterion 2: the Configurações switch subscribes with a mocked PushManager, and an iPhone outside the Home Screen gets the install hint instead of a prompt', async ({
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  }) => {
    test.setTimeout(120_000);
    await clearSubscriptionsOf(users.demoMember);
    const use = (userAgent: string): DeviceUse => ({
      ...contextOptions,
      viewport,
      isMobile,
      hasTouch,
      deviceScaleFactor,
      userAgent,
      serviceWorkers: 'block',
    });

    // A browser that can subscribe (the Pixel 7 UA): off → on prompts ONCE and saves ONE row.
    const android = await browser.newContext(use(ANDROID_UA));
    try {
      const phone = await android.newPage();
      await installFakePush(phone, { permission: 'default', answer: 'granted', pushManager: true });
      await login(phone, users.demoMember, SEED_PASSWORD, hosts.demo);
      await phone.goto(`${hosts.demo}/configuracoes`);
      await expect(pushRow(phone)).toHaveAttribute('data-push-row', 'off');
      await pushSwitch(phone).click();
      await expect(phone.getByText(N.push.toasts.enabled)).toBeVisible();
      await expect(pushRow(phone)).toHaveAttribute('data-push-row', 'on');
      await expect(pushSwitch(phone)).toHaveAttribute('aria-checked', 'true');
      expect((await pushLog(phone)).filter((e) => e === 'requestPermission')).toHaveLength(1);
      const endpoint = await fakeEndpoint(phone);
      expect(endpoint).toMatch(/^https:\/\/push\.fake\.test\/sub\/e2e-/);
      await expect.poll(() => subscriptionsOf(users.demoMember)).toEqual([endpoint]);
    } finally {
      await android.close();
      await clearSubscriptionsOf(users.demoMember);
    }

    // iPhone Safari outside the Home Screen app (D-234 / PWA-02): the soft-ask CTA opens the
    // InstallHint push variant, and nothing ever asks for permission or subscribes.
    const iphone = await browser.newContext(use(IPHONE_UA));
    try {
      const phone = await iphone.newPage();
      await installFakePush(phone, { permission: 'default', answer: 'granted', pushManager: true });
      await login(phone, users.demoMember, SEED_PASSWORD, hosts.demo);
      await phone.goto(`${hosts.demo}/notificacoes`);
      await softAsk(phone).getByRole('button', { name: N.softAsk.cta }).click();
      const sheet = phone.getByRole('dialog').filter({ hasText: INSTALL_PUSH.title });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(INSTALL_PUSH.body);
      await sheet.getByRole('button', { name: INSTALL_PUSH.confirm }).click();
      await expect(sheet).toHaveCount(0);
      expect(await pushLog(phone)).not.toContain('requestPermission');
      expect(await pushLog(phone)).not.toContain('subscribe');
      expect(await subscriptionsOf(users.demoMember)).toEqual([]);
    } finally {
      await iphone.close();
    }
  });

  test('3. criterion 3: a member message reaches the staff inbox live, the staff reply reaches the member live, and a later reply shows the member the dot on Início', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    test.setTimeout(180_000);
    await resetMemberConversation(CHAT_MEMBER);
    await resetStaffInbox();
    const question = `Pergunta do smoke ${testInfo.project.name} ${Date.now()}`;
    const answerText = `Resposta do smoke ${Date.now()}`;

    // The support user watches the inbox (the seeded thread is the only row).
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(page.getByRole('heading', { level: 1, name: C.inbox.title })).toBeVisible();
    await expect(listPane(page).locator('a[data-inbox-row]')).toHaveCount(1);
    await page.waitForTimeout(1_500);

    const memberContext = await browser.newContext({
      ...contextOptions,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      serviceWorkers: 'block',
    });
    try {
      const member = await memberContext.newPage();
      await login(member, CHAT_MEMBER, SEED_PASSWORD, hosts.demo);
      await member.goto(`${hosts.demo}/suporte`);
      await expect(composerField(member)).toBeEnabled();
      await send(member, question);
      await expect(bubbles(member).filter({ hasText: question })).toHaveCount(1);

      // LIVE: the staff inbox is never reloaded; the new row arrives over `support-inbox`.
      const row = listPane(page).locator('a[data-inbox-row]').filter({ hasText: question });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row).toHaveAttribute('data-awaiting', 'true');
      await row.click();
      await expect(page).toHaveURL(/\/suporte\/[0-9a-f-]{36}$/);
      const conversationId = page.url().split('/suporte/')[1]?.split(/[/?#]/)[0] ?? '';
      await expect(bubbles(page).filter({ hasText: question })).toHaveCount(1);
      await member.waitForTimeout(1_500);

      // LIVE: the staff reply reaches the member's open thread with no reload.
      await send(page, answerText);
      await expect(bubbles(page).filter({ hasText: answerText })).toHaveCount(1);
      await expect(bubbles(member).filter({ hasText: answerText })).toHaveCount(1, {
        timeout: 30_000,
      });

      // D-237: the member leaves for Início, a later reply arrives, and the slot becomes the dot.
      await member.goto(`${hosts.demo}/inicio`);
      await expect(slot(member, 'chat')).toHaveAccessibleName(C.nav);
      await expect(slot(member, 'chat').locator('[data-badge-dot]')).toHaveCount(0);
      await member.waitForTimeout(1_500);
      await replyAsSupport(conversationId, `Segunda resposta do smoke ${Date.now()}`);
      await expect(slot(member, 'chat')).toHaveAccessibleName(C.navBadge.member, {
        timeout: 30_000,
      });
      await expect(slot(member, 'chat').locator('[data-badge-dot]')).toBeVisible();
      await expect(slot(member, 'chat')).not.toContainText(/\d/);
    } finally {
      await memberContext.close();
    }
  });

  test('4. criterion 4: with notifications and chat DISABLED the slots disappear and the routes answer 404 MODULE_DISABLED; flipped back ON they return', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tenant = off;
    const api = offApi;
    if (!tenant || !api) throw new Error('the throwaway tenant fixture did not initialise');
    const host = new URL(tenant.origin).hostname;

    // ENABLED first: the tenant demonstrably has both slots and both routes.
    await login(page, tenant.memberEmail, SEED_PASSWORD, tenant.origin);
    await expect(slot(page, 'notifications')).toHaveCount(1);
    await expect(slot(page, 'chat')).toHaveCount(1);
    expect((await answer(api, '/v1/notifications', host)).status).toBe(200);
    expect((await answer(api, '/v1/chat/support', host)).status).toBe(200);

    try {
      await setTenantModuleFlag(tenant.slug, 'notifications', false);
      await setTenantModuleFlag(tenant.slug, 'chat', false);
      await expect
        .poll(async () => (await answer(api, '/v1/notifications', host)).status, {
          timeout: 35_000,
        })
        .toBe(404);

      // 404 MODULE_DISABLED, never 403: a member must not learn what the tenant did not buy.
      for (const path of ['/v1/notifications', '/v1/chat/support']) {
        expect(await answer(api, path, host), path).toEqual({
          status: 404,
          code: 'MODULE_DISABLED',
        });
      }
      await page.goto(`${tenant.origin}/inicio`);
      await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);
      await expect(page.locator('a[data-slot="notifications"]')).toHaveCount(0);
      await expect(page.locator('a[data-slot="chat"]')).toHaveCount(0);
    } finally {
      // FLIP back ON, whatever happened above.
      await setTenantModuleFlag(tenant.slug, 'notifications', true);
      await setTenantModuleFlag(tenant.slug, 'chat', true);
    }

    const flippedAt = Date.now();
    await expect
      .poll(
        async () => [
          (await answer(api, '/v1/notifications', host)).status,
          (await answer(api, '/v1/chat/support', host)).status,
        ],
        { timeout: 35_000 },
      )
      .toEqual([200, 200]);
    test.info().annotations.push({
      type: 'flags-cache',
      description: `notifications + chat visible to the API after ${Date.now() - flippedAt} ms (ceiling 35 s, MODULE_FLAGS_TTL_MS 30 s)`,
    });
    await page.goto(`${tenant.origin}/inicio`);
    await expect(slot(page, 'notifications')).toHaveCount(1);
    await expect(slot(page, 'chat')).toHaveCount(1);
    await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);
  });
});
