import { type Browser, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import { closeAdmin } from './admin';
import {
  closeDirectAdmin,
  conversationBetween,
  type DirectTenant,
  directSlug,
  dropDirectTenant,
  membershipOf,
  type Person,
  provisionDirectTenant,
  resetDirectState,
} from './direct-admin';
import { login, SEED_PASSWORD } from './fixtures';
import { closeTenantFixtures } from './tenant-fixtures';

/**
 * Phase 11 (CHAT-06, CHAT-07; D-719 to D-728): the direct conversation between two members in a real browser, on the
 * phone (`mobile-chromium`) and on the desktop (`desktop-chromium`), both Chromium. The browser and the app user agent
 * run the same flows (D-616): the entries are the same links and menus in both.
 *
 * Test 1 is the tracer: one conversation walked through two browser contexts on a tenant with `chat`, `social` and
 * `notifications` on. Member A opens B's profile, taps `Enviar mensagem`, sees the empty thread, sends the first
 * message (the address becomes the conversation's and no toast appears), B's top-bar badge shows the count, B opens
 * Conversas (the support row pinned first), opens the row, reads the message and replies, and A sees the reply live.
 * The other tests pin the block through the screens, the closed strip, the states of Conversas and the refusals.
 *
 * **WRITTEN AND LISTED, NEVER RUN BY AN AGENT** (project rule, Igor's word, as `chat-cases.spec.ts` and
 * `chat-voice.spec.ts` were): this file was loaded with `playwright test --list` and typechecked, nothing more. The run
 * is a manual ledger row of plan 11-28 and happens on Igor's word. A run needs the API, the web app and, for the voice
 * case, the worker with ffmpeg (`ensureWorker` brings one) on a seeded local stack, and disk the local machine does
 * not spare (clear `.turbo/cache` and `apps/web/.next/dev` first).
 *
 * **Fixtures (T-11-38, T-11-39).** Everything lives on a THROWAWAY tenant created by `direct-admin.ts` with the three
 * modules on before any session exists (the 30 s flag cache); a second throwaway tenant has `social` off. The spec
 * never touches rede-demo, rede-lab, a seeded member or the seeded support thread, resets or seeds nothing, prints no
 * token and writes no pt-BR sentence: every string is read from the real catalogs. `beforeEach` clears the tenant's
 * direct state and `afterAll` drops both tenants and every row they held.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering a navigation from its own cache would make these
 * assertions read what a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });
/** Two browsers and a live signal: every case here gets the long budget. */
test.describe.configure({ timeout: 180_000 });

/** The catalogs are the source of copy, never a literal in a spec. */
const C = chatMessages.chat;
const S = socialMessages.social;
const tc = createTranslator({
  locale: 'pt-BR',
  messages: chatMessages,
  namespace: 'chat',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const run = Date.now().toString(36);
let tenant: DirectTenant;

test.beforeAll(async ({ browserName }, testInfo) => {
  void browserName;
  test.setTimeout(240_000);
  tenant = await provisionDirectTenant(
    directSlug('chat', testInfo.project.name, run),
    SEED_PASSWORD,
  );
});

test.beforeEach(async () => {
  await resetDirectState(tenant);
});

test.afterAll(async () => {
  await dropDirectTenant(tenant ?? null).catch(() => {});
  await closeDirectAdmin();
  await closeTenantFixtures();
  await closeAdmin();
});

// ── locators ─────────────────────────────────────────────────────────────────────────────────────

/** The chat slot's link in whichever chrome is visible (the TopBar on the phone, the rail on desktop). */
const chatSlot = (page: Page) => page.locator('a[data-slot="chat"]').filter({ visible: true });
/** The visible thread column. */
const thread = (page: Page) => page.locator('[data-chat-thread]').filter({ visible: true });
const bubbles = (page: Page) => thread(page).locator('[data-chat-message]');
const composerField = (page: Page) => page.getByRole('textbox', { name: C.composer.label });
const sendButton = (page: Page) => page.getByRole('button', { name: C.composer.send, exact: true });
/** The rows of the Conversas list: the support row first, then the direct ones. */
const listRows = (page: Page) => page.locator('[data-conversations] a[data-inbox-row]');
/** The one visible toast. */
const toast = (page: Page) => page.locator('[role="status"][style*="safe-top"]');
const profileMessageLink = (page: Page, name: string) =>
  page.getByRole('link', { name: S.profile.messageAria.replace('{nome}', name) });

// ── contexts ─────────────────────────────────────────────────────────────────────────────────────

type DeviceUse = Parameters<Browser['newContext']>[0];

/** The pieces of the project's device preset a second context must repeat to look the same. */
interface Device {
  contextOptions: DeviceUse;
  viewport: { width: number; height: number } | null;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string | undefined;
  deviceScaleFactor: number | undefined;
}

const deviceOf = (device: Device): DeviceUse => ({
  ...device.contextOptions,
  viewport: device.viewport,
  isMobile: device.isMobile,
  hasTouch: device.hasTouch,
  userAgent: device.userAgent,
  deviceScaleFactor: device.deviceScaleFactor,
});

/** A second, independent browser context (its own cookies) signed in as `person` on the throwaway tenant's host. */
async function contextAs(browser: Browser, person: Person, use: DeviceUse) {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page, person.email, tenant.password, tenant.origin);
  return { context, page };
}

// ── 1. the tracer ────────────────────────────────────────────────────────────────────────────────

test.describe('conversa direta no navegador', () => {
  test('1. direct tracer: A writes from B’s profile, B sees the badge, opens Conversas, replies, and A sees it live', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    const { ana, bia } = tenant;
    const biaId = await membershipOf(tenant, bia);

    // B is already signed in and idle on Início, so the badge arrives by the live signal.
    const other = await contextAs(
      browser,
      bia,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const bp = other.page;
      await expect(chatSlot(bp)).toHaveAccessibleName(C.navConversations);

      // A: B's profile, the outline link, the empty thread (nothing exists until the first message).
      await login(page, ana.email, tenant.password, tenant.origin);
      await page.goto(`${tenant.origin}/membros/${biaId}`);
      await expect(page.getByRole('heading', { level: 1, name: bia.name })).toBeVisible();
      await profileMessageLink(page, bia.name).click();
      await expect(page).toHaveURL(new RegExp(`/conversas/com/${biaId}$`));
      await expect(page.locator('[data-direct-empty]')).toContainText(
        tc('direct.empty.title', { nome: bia.name }),
      );
      expect(await conversationBetween(tenant, ana, bia)).toBeNull();

      // The first send creates the conversation in place: the address swaps, the field keeps focus, no toast.
      const first = `Oi ${run}`;
      await composerField(page).fill(first);
      await sendButton(page).click();
      await expect(page).toHaveURL(/\/conversas\/[0-9a-f]{8}-[0-9a-f-]{27}$/);
      await expect(page).not.toHaveURL(/\/conversas\/com\//);
      await expect(bubbles(page).filter({ hasText: first })).toHaveCount(1);
      await expect(page.locator('[data-direct-empty]')).toHaveCount(0);
      await expect(composerField(page)).toBeFocused();
      await expect(toast(page)).toHaveCount(0);
      const conversationId = await conversationBetween(tenant, ana, bia);
      if (!conversationId) throw new Error('the first send left no conversation');
      await expect(page).toHaveURL(new RegExp(`/conversas/${conversationId}$`));

      // B: the top-bar badge counts one conversation, Conversas lists the support row first, then A.
      await expect(chatSlot(bp)).toHaveAccessibleName(tc('navConversationsBadge', { count: 1 }), {
        timeout: 30_000,
      });
      await chatSlot(bp).click();
      await expect(bp).toHaveURL(/\/conversas$/);
      await expect(listRows(bp).first()).toHaveAttribute('href', '/suporte');
      await expect(listRows(bp).first()).toContainText(
        tc('conversations.support.name', { tenant: tenant.displayName }),
      );
      const row = listRows(bp).nth(1);
      await expect(row).toHaveAttribute('href', `/conversas/${conversationId}`);
      await expect(row).toContainText(ana.name);
      await expect(row).toContainText(first);

      // B opens the row, reads the message on the left (the other person's) and replies.
      await row.click();
      await expect(bp).toHaveURL(new RegExp(`/conversas/${conversationId}$`));
      await expect(
        bubbles(bp).filter({ hasText: first }).locator('[data-chat-bubble="other"]'),
      ).toHaveCount(1);
      const reply = `Oi, Ana ${run}`;
      await composerField(bp).fill(reply);
      await sendButton(bp).click();
      await expect(bubbles(bp).filter({ hasText: reply })).toHaveCount(1);

      // A sees the reply live, on the left, with no reload.
      await expect(
        bubbles(page).filter({ hasText: reply }).locator('[data-chat-bubble="other"]'),
      ).toHaveCount(1, { timeout: 30_000 });
    } finally {
      await other.context.close();
    }
  });
});
