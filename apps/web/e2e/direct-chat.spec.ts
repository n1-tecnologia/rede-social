import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import safetyMessages from '../messages/pt-BR/safety.json' with { type: 'json' };
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import { closeAdmin, setMembershipStatus } from './admin';
import { voiceAssetIdsOf } from './chat-admin';
import {
  blockAs,
  closeDirectAdmin,
  conversationBetween,
  type DirectTenant,
  directSlug,
  dropDirectTenant,
  followEdgeExists,
  memberBlockExists,
  membershipOf,
  type Person,
  provisionDirectTenant,
  resetDirectState,
  sendDirectAs,
} from './direct-admin';
import { login, SEED_PASSWORD } from './fixtures';
import { closeSocialAdmin, followMember } from './social-admin';
import { closeTenantFixtures } from './tenant-fixtures';
import { ensureWorker } from './worker';

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
const voiceChannel = process.env.PLAYWRIGHT_VOICE_CHANNEL;
test.use({
  serviceWorkers: 'block',
  // The fake microphone of Chromium stands in for a person in the voice case (see `chat-voice.spec.ts`).
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
  ...(voiceChannel ? { channel: voiceChannel } : {}),
});
/** Two browsers and a live signal: every case here gets the long budget. */
test.describe.configure({ timeout: 180_000 });

/** The catalogs are the source of copy, never a literal in a spec. */
const C = chatMessages.chat;
const S = socialMessages.social;
const SA = safetyMessages.safety;
const V = C.voice;
const tc = createTranslator({
  locale: 'pt-BR',
  messages: chatMessages,
  namespace: 'chat',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const run = Date.now().toString(36);
let tenant: DirectTenant;
/** A second throwaway tenant with `social` OFF: the same people, no direct conversation (D-719). */
let off: DirectTenant;

/** The voice case needs the worker's ffmpeg to derive the stored file; without it the case says so and skips. */
const ffmpegMissing = spawnSync('ffmpeg', ['-version']).status !== 0;

test.beforeAll(async ({ browserName }, testInfo) => {
  void browserName;
  test.setTimeout(240_000);
  tenant = await provisionDirectTenant(
    directSlug('chat', testInfo.project.name, run),
    SEED_PASSWORD,
  );
  off = await provisionDirectTenant(directSlug('off', testInfo.project.name, run), SEED_PASSWORD, {
    social: false,
    content: false,
  });
});

test.beforeEach(async () => {
  await resetDirectState(tenant);
});

test.afterAll(async () => {
  await dropDirectTenant(tenant ?? null).catch(() => {});
  await dropDirectTenant(off ?? null).catch(() => {});
  await closeDirectAdmin();
  await closeSocialAdmin();
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
async function contextAs(
  browser: Browser,
  person: Person,
  use: DeviceUse,
  on: DirectTenant = tenant,
) {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page, person.email, on.password, on.origin);
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

  // ── 2. the lazy start ──────────────────────────────────────────────────────────────────────────

  test('2. the lazy start: an existing pair lands on its conversation, one’s own membership on Conversas, every miss is one not-found screen', async ({
    page,
  }) => {
    const { ana, bia } = tenant;
    const first = `Primeira ${run}`;
    const conversationId = await sendDirectAs(tenant, bia, ana, first);
    const biaId = await membershipOf(tenant, bia);
    const anaId = await membershipOf(tenant, ana);
    await login(page, ana.email, tenant.password, tenant.origin);

    // A pair with a conversation never gets a second one: the address redirects to the existing thread.
    await page.goto(`${tenant.origin}/conversas/com/${biaId}`);
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversationId}$`));
    await expect(bubbles(page).filter({ hasText: first })).toHaveCount(1);

    // One's own membership goes back to the list without asking the API.
    await page.goto(`${tenant.origin}/conversas/com/${anaId}`);
    await expect(page).toHaveURL(/\/conversas$/);

    // A malformed id, an unknown member and an unknown conversation are the SAME screen, naming no reason.
    for (const path of [
      `/conversas/com/${randomUUID()}`,
      `/conversas/com/nao-e-um-id`,
      `/conversas/${randomUUID()}`,
    ]) {
      await page.goto(`${tenant.origin}${path}`);
      await expect(page.getByText(C.direct.notFound.title, { exact: true })).toBeVisible();
      await expect(
        page.getByRole('link', { name: C.direct.notFound.cta, exact: true }),
      ).toHaveAttribute('href', '/conversas');
    }
  });

  // ── 3. the block through the screens ───────────────────────────────────────────────────────────

  test('3. A blocks B from B’s incoming message menu: B’s composer is the closed strip, A’s is Desbloquear, one tap restores both', async ({
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
    const anaId = await membershipOf(tenant, ana);
    await followMember(ana.email, bia.email, tenant.slug);
    await followMember(bia.email, ana.email, tenant.slug);
    const text = `Mensagem da Bia ${run}`;
    const conversationId = await sendDirectAs(tenant, bia, ana, text);

    await login(page, ana.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/conversas/${conversationId}`);
    await expect(bubbles(page).filter({ hasText: text })).toHaveCount(1);

    // The gutter trigger beside the incoming bubble opens the sheet with the two rows.
    await page.getByRole('button', { name: C.direct.menu.trigger }).click();
    const sheet = page.getByRole('dialog', { name: C.direct.menu.title });
    await expect(sheet.getByRole('button', { name: C.direct.menu.report })).toBeVisible();
    await sheet.getByRole('button', { name: tc('direct.menu.block', { nome: bia.name }) }).click();

    // The dialog carries the `social`-on body, then the block lands.
    const dialog = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog'))
      .filter({ hasText: SA.block.title.replace('{nome}', bia.name) });
    await expect(
      dialog.getByText(SA.block.bodySocialOn.replaceAll('{nome}', bia.name)),
    ).toBeVisible();
    await dialog.getByRole('button', { name: SA.block.confirm, exact: true }).click();

    // A: the blocker's strip names the person and offers one tap; the composer and the microphone are gone.
    const strip = page.locator('[data-composer-strip="blocker"]');
    await expect(strip).toContainText(tc('direct.blocker.text', { nome: bia.name }));
    await expect(strip.getByRole('button', { name: C.direct.blocker.unblock })).toBeVisible();
    await expect(composerField(page)).toHaveCount(0);
    await expect.poll(() => memberBlockExists(tenant, ana, bia)).toBe(true);
    // The follow pair is gone in both directions (D-724).
    await expect.poll(() => followEdgeExists(tenant, ana, bia)).toBe(false);
    await expect.poll(() => followEdgeExists(tenant, bia, ana)).toBe(false);

    // B, in a second context: the thread is read-only with ONE sentence, and A's profile has no buttons.
    const other = await contextAs(
      browser,
      bia,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const bp = other.page;
      await bp.goto(`${tenant.origin}/conversas/${conversationId}`);
      const closed = bp.locator('[data-composer-strip="closed"]');
      await expect(closed).toHaveText(C.direct.closed);
      await expect(composerField(bp)).toHaveCount(0);
      await expect(bp.getByRole('button', { name: V.mic.label })).toHaveCount(0);

      await bp.goto(`${tenant.origin}/membros/${anaId}`);
      await expect(bp.getByRole('heading', { level: 1, name: ana.name })).toBeVisible();
      await expect(profileMessageLink(bp, ana.name)).toHaveCount(0);
      await expect(bp.getByRole('button', { name: /^Segui/ })).toHaveCount(0);
      await expect(bp.getByRole('button', { name: S.profile.unblock })).toHaveCount(0);

      // A lifts the block with one tap: the composer comes back with the focus and the toast names the person.
      await strip.getByRole('button', { name: C.direct.blocker.unblock }).click();
      await expect(strip).toHaveCount(0);
      await expect(composerField(page)).toBeVisible();
      await expect(toast(page)).toContainText(tc('direct.blocker.unblocked', { nome: bia.name }));
      await expect.poll(() => memberBlockExists(tenant, ana, bia)).toBe(false);

      // And B's side opens again, with no word about what happened.
      await bp.goto(`${tenant.origin}/conversas/${conversationId}`);
      await expect(composerField(bp)).toBeVisible();
      await expect(bp.locator('[data-composer-strip]')).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });

  // ── 4. the blocked member's screens, and the refused follow ────────────────────────────────────

  test('4. the blocked member’s screens never name the blocker in a refusal, and a follow refused from the directory reverts and loses its controls', async ({
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
    const anaId = await membershipOf(tenant, ana);
    const conversationId = await sendDirectAs(tenant, bia, ana, `Antes do bloqueio ${run}`);

    // B is on the directory with Seguir and the message control on A's row, BEFORE the block happens.
    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/membros`);
    const row = page
      .locator('main li')
      .filter({ has: page.locator(`a[href="/membros/${anaId}"]`) });
    const directoryMessage = S.directory.messageAria.replace('{nome}', ana.name);
    await expect(row.getByRole('link', { name: directoryMessage })).toBeVisible();
    await expect(row.getByRole('button', { name: `Seguir ${ana.name}` })).toBeVisible();

    // A blocks B (through the real API: nobody is told), then B taps Seguir.
    await blockAs(tenant, ana, bia);
    await row.getByRole('button', { name: `Seguir ${ana.name}` }).click();
    await expect(toast(page)).toContainText(S.errors.follow);
    // Reverted and refreshed: the row keeps its link to the profile and loses both controls.
    await expect(row.getByRole('button')).toHaveCount(0);
    await expect(row.getByRole('link', { name: directoryMessage })).toHaveCount(0);
    await expect(row.locator(`a[href="/membros/${anaId}"]`).first()).toBeVisible();
    await expect.poll(() => followEdgeExists(tenant, bia, ana)).toBe(false);

    // B's thread: ONE sentence, and no name, no reason and no word of the block anywhere in the strip.
    await page.goto(`${tenant.origin}/conversas/${conversationId}`);
    const closed = page.locator('[data-composer-strip="closed"]');
    await expect(closed).toHaveText(C.direct.closed);
    await expect(closed).toHaveAccessibleName(C.direct.closed);
    expect(await closed.innerText()).not.toContain(ana.name);
    expect(await closed.innerText()).not.toMatch(/bloque/i);
    await expect(page.getByText(tc('direct.blocker.text', { nome: ana.name }))).toHaveCount(0);
    await expect(page.getByRole('button', { name: C.direct.blocker.unblock })).toHaveCount(0);

    // B's profile of A: the zone is empty, not disabled.
    await page.goto(`${tenant.origin}/membros/${anaId}`);
    await expect(page.getByRole('heading', { level: 1, name: ana.name })).toBeVisible();
    await expect(profileMessageLink(page, ana.name)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Segui/ })).toHaveCount(0);

    // A, in a second context, sees the blocker's profile of B: one Desbloquear and nothing else.
    const other = await contextAs(
      browser,
      ana,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const biaId = await membershipOf(tenant, bia);
      await other.page.goto(`${tenant.origin}/membros/${biaId}`);
      await expect(
        other.page.getByRole('button', { name: S.profile.unblockAria.replace('{nome}', bia.name) }),
      ).toBeVisible();
      await expect(profileMessageLink(other.page, bia.name)).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });

  // ── 5. a refusal mid-session ───────────────────────────────────────────────────────────────────

  test('5. a send refused mid-session removes the optimistic bubble, toasts the neutral sentence with no name and draws the closed strip', async ({
    page,
  }) => {
    const { ana, bia } = tenant;
    const conversationId = await sendDirectAs(tenant, ana, bia, `Primeira ${run}`);
    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/conversas/${conversationId}`);
    await expect(composerField(page)).toBeVisible();
    const before = await bubbles(page).count();

    // The block lands while B's composer is open, then B sends.
    await blockAs(tenant, ana, bia);
    const refused = `Depois do bloqueio ${run}`;
    await composerField(page).fill(refused);
    await sendButton(page).click();

    await expect(toast(page)).toHaveText(C.direct.closed);
    expect(await toast(page).innerText()).not.toContain(ana.name);
    await expect(bubbles(page).filter({ hasText: refused })).toHaveCount(0);
    await expect(bubbles(page)).toHaveCount(before);
    await expect(page.locator('[data-composer-strip="closed"]')).toHaveText(C.direct.closed);
    await expect(composerField(page)).toHaveCount(0);
  });

  // ── 6. the administrator's block ───────────────────────────────────────────────────────────────

  test('6. the administrator’s block hides the conversation from the other member’s list and it returns on unblock', async ({
    page,
  }) => {
    const { ana, bia } = tenant;
    const conversationId = await sendDirectAs(tenant, ana, bia, `Oi ${run}`);
    await login(page, ana.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/conversas`);
    const row = page.locator(
      `[data-conversations] a[data-inbox-row][href="/conversas/${conversationId}"]`,
    );
    await expect(row).toHaveCount(1);

    await setMembershipStatus(bia.email, 'blocked');
    await page.reload();
    await expect(listRows(page).first()).toHaveAttribute('href', '/suporte');
    await expect(row).toHaveCount(0);
    await expect(page.getByText(bia.name)).toHaveCount(0);

    await setMembershipStatus(bia.email, 'active');
    await page.reload();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(bia.name);
  });

  // ── 7. social off ──────────────────────────────────────────────────────────────────────────────

  test('7. with social off, Conversas is the standard not-found screen, the chat slot stays Suporte and the profile has no message link', async ({
    page,
  }) => {
    const { ana, bia } = off;
    const biaId = await membershipOf(off, bia);
    await login(page, ana.email, off.password, off.origin);

    await expect(chatSlot(page)).toHaveAccessibleName(C.nav);
    await expect(chatSlot(page)).toHaveAttribute('href', '/suporte');

    await page.goto(`${off.origin}/conversas`);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();

    // The shipped support thread is untouched: the greeting of a member with no case.
    await page.goto(`${off.origin}/suporte`);
    await expect(thread(page).locator('[data-chat-greeting]')).toBeVisible();

    await page.goto(`${off.origin}/membros/${biaId}`);
    await expect(profileMessageLink(page, bia.name)).toHaveCount(0);
  });

  // ── 8. a member with no direct conversation ────────────────────────────────────────────────────

  test('8. a member with no direct conversation sees only the support row and the blank card', async ({
    page,
  }) => {
    const { caio } = tenant;
    await login(page, caio.email, tenant.password, tenant.origin);
    await expect(chatSlot(page)).toHaveAccessibleName(C.navConversations);
    await chatSlot(page).click();
    await expect(page).toHaveURL(/\/conversas$/);

    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).first()).toHaveAttribute('href', '/suporte');
    const blank = page.locator('[data-conversations-empty]');
    await expect(blank).toContainText(C.conversations.empty.title);
    await expect(blank).toContainText(C.conversations.empty.body);
    await expect(blank.getByRole('link', { name: C.conversations.empty.cta })).toHaveAttribute(
      'href',
      '/membros',
    );
  });

  // ── 9. staff ───────────────────────────────────────────────────────────────────────────────────

  test('9. the support user has no Conversas and no message link on a member’s profile', async ({
    page,
  }) => {
    const { support, ana } = tenant;
    const anaId = await membershipOf(tenant, ana);
    await login(page, support.email, tenant.password, tenant.origin);

    await page.goto(`${tenant.origin}/conversas`);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();

    await page.goto(`${tenant.origin}/membros/${anaId}`);
    await expect(profileMessageLink(page, ana.name)).toHaveCount(0);
  });

  // ── 10. a voice message in the thread ──────────────────────────────────────────────────────────

  test('10. a voice message sent in the thread is played by the other participant only', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    test.skip(
      ffmpegMissing,
      'the worker derives the stored recording with ffmpeg, which is missing here',
    );
    const stopWorker = await ensureWorker();
    const { ana, bia, caio } = tenant;
    const biaId = await membershipOf(tenant, bia);
    const device = deviceOf({
      contextOptions,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
    });
    const listener = await contextAs(browser, bia, device);
    const stranger = await contextAs(browser, caio, device);
    try {
      await login(page, ana.email, tenant.password, tenant.origin);
      await page.goto(`${tenant.origin}/conversas/com/${biaId}`);
      await page.getByRole('button', { name: V.mic.label, exact: true }).click();
      await expect(page.getByRole('timer', { name: V.recording.timer })).toHaveText(
        /^0:(0[2-9]|[1-5]\d)$/,
      );
      await page.getByRole('button', { name: V.recording.send, exact: true }).click();

      // The pending bubble first, then the settled one with a real audio element; the first take opens the pair.
      await expect(thread(page).locator('[data-chat-bubble="own"][data-pending]')).toBeVisible();
      const settled = thread(page)
        .locator('[data-chat-bubble="own"]:not([data-pending])')
        .filter({ has: page.locator('audio') });
      await expect(settled).toHaveCount(1, { timeout: 90_000 });
      await expect(page).toHaveURL(/\/conversas\/[0-9a-f]{8}-[0-9a-f-]{27}$/);
      const conversationId = await conversationBetween(tenant, ana, bia);
      if (!conversationId) throw new Error('the recording left no conversation');

      // B, the other participant, opens the thread and plays the file.
      const bp = listener.page;
      await bp.goto(`${tenant.origin}/conversas/${conversationId}`);
      const theirs = thread(bp)
        .locator('[data-chat-bubble="other"]')
        .filter({ has: bp.locator('audio') });
      await expect(theirs).toHaveCount(1, { timeout: 30_000 });
      const audio = thread(bp).locator('audio').first();
      const canPlayAac = await audio.evaluate((el) =>
        (el as HTMLAudioElement).canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      );
      expect(
        canPlayAac,
        'this Chromium build cannot decode AAC: run with the installed Chrome (PLAYWRIGHT_VOICE_CHANNEL=chrome)',
      ).not.toBe('');
      await theirs.getByRole('button', { name: V.player.play, exact: true }).click();
      const handle = await audio.elementHandle();
      if (!handle) throw new Error('the audio element is gone');
      await bp.waitForFunction(
        (el) => {
          const media = el as HTMLAudioElement;
          return !media.paused && media.currentTime > 0;
        },
        handle,
        { timeout: 30_000 },
      );

      // Only the two participants can open the file: a third member of the tenant meets the bare not-found.
      const [assetId] = await voiceAssetIdsOf(ana.email, tenant.slug);
      if (!assetId) throw new Error('the recording left no asset');
      const path = `${tenant.origin}/v1/media/${assetId}/original`;
      expect((await page.request.get(path, { maxRedirects: 0 })).status()).toBe(302);
      expect((await bp.request.get(path, { maxRedirects: 0 })).status()).toBe(302);
      const foreign = await stranger.page.request.get(path, { maxRedirects: 0 });
      expect(foreign.status()).toBe(404);
      expect(foreign.headers().location).toBeUndefined();
    } finally {
      await listener.context.close();
      await stranger.context.close();
      await stopWorker();
    }
  });
});
