import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import { membershipIdFor } from './admin';
import {
  blockMember,
  closeChatAdmin,
  displayNameOf,
  ensureConversation,
  insertMessages,
  memberReadSeq,
  messagesOf,
  replyAsSupport,
  resetMemberConversation,
  resetStaffInbox,
  SEED_SUPPORT_CONVERSATION_ID,
  SEED_SUPPORT_MESSAGES,
  SUPPORT_EMAIL,
  SUPPORT_FIRST_NAME,
  seedInboxConversations,
  sendAsMember,
  setMemberReadSeq,
  setStaffReadSeq,
  unblockMember,
} from './chat-admin';
import { hosts, login, SEED_PASSWORD, signOut, users } from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const C = chatMessages.chat;
const tc = createTranslator({
  locale: 'pt-BR',
  messages: chatMessages,
  namespace: 'chat',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

/** The seeded demo tenant's display name (the greeting and the header name it). */
const TENANT = 'Rede Demo';

/**
 * A member with no seeded thread, so these cases can delete and recreate a conversation without
 * touching the seeded `member@rede-demo.local` thread other suites read.
 */
const MEMBER = 'beatriz.almeida@rede-demo.local';

/**
 * CHAT-02 / CHAT-04 / CHAT-05 (plan 07-09): the member's side of the support conversation in the
 * browser, on the phone (`mobile-chromium`, a touch device: only the button sends) and the desktop.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering a navigation from its own cache
 * would have these assertions reading what a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });

test.afterAll(async () => {
  await resetMemberConversation(MEMBER);
  await closeChatAdmin();
});

/** The chat slot's link in whichever chrome is visible (the TopBar on the phone, the rail on desktop). */
const chatSlot = (page: Page) => page.locator('a[data-slot="chat"]').filter({ visible: true });

const log = (page: Page) => page.getByRole('log', { name: C.thread.label });
/** The visible thread column (the dev server's Fast Refresh can leave a hidden stale copy). */
const thread = (page: Page) => page.locator('[data-chat-thread]').filter({ visible: true });
/** The composer's own inline error (Next's route announcer is another `role="alert"`). */
const sendError = (page: Page) => page.locator('[data-chat-send-error][role="alert"]');
const bubbles = (page: Page) => thread(page).locator('[data-chat-message]');
const composerField = (page: Page) => page.getByRole('textbox', { name: C.composer.label });
const sendButton = (page: Page) => page.getByRole('button', { name: C.composer.send });

async function send(page: Page, text: string): Promise<void> {
  await composerField(page).fill(text);
  await sendButton(page).click();
}

/** The scroller's distance from the bottom, in px. */
const distanceFromBottom = (page: Page) =>
  thread(page)
    .locator('[data-chat-scroller]')
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

/** Hidden, then visible again (the D-240 refocus). */
async function refocus(page: Page): Promise<void> {
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
}

test.describe('chat membro', () => {
  test.beforeEach(async () => {
    await resetMemberConversation(MEMBER);
  });

  test('1. the chat slot opens the greeting; the first message replaces it and survives a reload', async ({
    page,
  }) => {
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await expect(chatSlot(page)).toHaveAccessibleName(C.nav);
    await chatSlot(page).click();
    await expect(page).toHaveURL(/\/suporte$/);

    await expect(
      page.getByRole('heading', { level: 1, name: tc('member.title', { tenant: TENANT }) }),
    ).toBeVisible();
    const greeting = thread(page).locator('[data-chat-greeting]');
    await expect(greeting).toContainText(tc('member.empty.title', { tenant: TENANT }));
    await expect(greeting).toContainText(C.member.empty.body);
    await expect(composerField(page)).toBeEnabled();

    await send(page, 'Oi');
    await expect(greeting).toHaveCount(0);
    const own = bubbles(page).filter({ hasText: 'Oi' });
    await expect(own).toHaveCount(1);
    await expect(own.locator('[data-chat-bubble="own"]')).toBeVisible();
    await expect(own.locator('[data-chat-time]')).toHaveText(/^\d{2}:\d{2}$/);

    await page.reload();
    await expect(bubbles(page).filter({ hasText: 'Oi' })).toHaveCount(1);
    await expect(thread(page).locator('[data-chat-greeting]')).toHaveCount(0);
  });

  test('2. a staff reply appears live, labelled with the first name, with no staff avatar', async ({
    page,
  }) => {
    const conversationId = await sendAsMember(MEMBER, 'Preciso de ajuda');
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(bubbles(page)).toHaveCount(1);

    const reply = `Resposta ao vivo ${Date.now()}`;
    await replyAsSupport(conversationId, reply);
    const staff = bubbles(page).filter({ hasText: reply });
    await expect(staff).toHaveCount(1, { timeout: 15_000 });
    await expect(staff.locator('[data-chat-bubble="other"]')).toBeVisible();
    const sender = staff.locator('[data-chat-sender]');
    await expect(sender).toHaveText(`${SUPPORT_FIRST_NAME}${C.sender.staffSr}`);
    await expect(sender.locator('svg')).toHaveCount(1);

    // D-222: the only image in the thread is the tenant logo; never a staff avatar.
    const images = thread(page).locator('img');
    const alts = await images.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('alt')));
    expect(alts.every((alt) => alt === TENANT)).toBe(true);
    await expect(thread(page)).not.toContainText('Rocha');
  });

  test('3. a staff reply turns the chat slot into the dot elsewhere; opening the thread clears it', async ({
    page,
  }) => {
    const conversationId = await sendAsMember(MEMBER, 'Tenho uma dúvida');
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await expect(chatSlot(page)).toHaveAccessibleName(C.nav);
    await expect(chatSlot(page).locator('[data-badge-dot]')).toHaveCount(0);

    await replyAsSupport(conversationId, `Resposta com ponto ${Date.now()}`);
    await expect(chatSlot(page)).toHaveAccessibleName(C.navBadge.member, { timeout: 15_000 });
    await expect(chatSlot(page).locator('[data-badge-dot]')).toBeVisible();
    await expect(chatSlot(page)).not.toContainText(/\d/);

    const read = page.waitForResponse((res) =>
      /\/api\/chat\/conversations\/[^/]+\/read$/.test(res.url()),
    );
    await chatSlot(page).click();
    await expect(page).toHaveURL(/\/suporte$/);
    expect((await read).status()).toBe(204);

    await page.goto(`${hosts.demo}/inicio`);
    await expect(chatSlot(page)).toHaveAccessibleName(C.nav);
    await expect(chatSlot(page).locator('[data-badge-dot]')).toHaveCount(0);
  });

  test('4. catch-up after dropped signals shows both replies exactly once, in order', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const drop = { dropping: false, dropped: 0 };
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString('latin1');
        if (drop.dropping && text.includes('chat.message')) {
          drop.dropped++;
          return;
        }
        ws.send(message);
      });
    });

    const conversationId = await sendAsMember(MEMBER, 'Aguardando');
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(bubbles(page)).toHaveCount(1);
    // The pane joins its conversation topic before the drop starts.
    await page.waitForTimeout(2_000);

    drop.dropping = true;
    const stamp = Date.now();
    const first = `Perdida um ${stamp}`;
    const second = `Perdida dois ${stamp}`;
    await replyAsSupport(conversationId, first);
    await replyAsSupport(conversationId, second);
    await expect.poll(() => drop.dropped, { timeout: 15_000 }).toBeGreaterThan(1);
    drop.dropping = false;

    await page.waitForTimeout(2_000);
    await expect(bubbles(page).filter({ hasText: first })).toHaveCount(0);

    await refocus(page);
    await expect(bubbles(page).filter({ hasText: first })).toHaveCount(1, { timeout: 10_000 });
    await expect(bubbles(page).filter({ hasText: second })).toHaveCount(1);
    await refocus(page);
    await page.waitForTimeout(1_000);
    const texts = await bubbles(page).allTextContents();
    expect(texts.filter((text) => text.includes(first))).toHaveLength(1);
    expect(texts.filter((text) => text.includes(second))).toHaveLength(1);
    expect(texts.findIndex((text) => text.includes(first))).toBeLessThan(
      texts.findIndex((text) => text.includes(second)),
    );
  });

  test('5. the composer: spaces keep send disabled, the counter from 1,800, a failed send keeps the draft', async ({
    page,
  }) => {
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);

    await composerField(page).fill('    ');
    await expect(sendButton(page)).toBeDisabled();
    await expect(sendError(page)).toHaveCount(0);

    await composerField(page).fill('a'.repeat(1799));
    await expect(thread(page).locator('[data-chat-counter]')).toHaveCount(0);
    await composerField(page).fill('a'.repeat(1800));
    await expect(thread(page).locator('[data-chat-counter]')).toHaveText(
      tc('composer.counter', { count: (1800).toLocaleString('pt-BR') }),
    );

    // The send is a server action: a POST to the page carrying `next-action`. Answer it with a 500
    // (a transport abort is not a failure here: with `experimental.useOffline` Next treats it as
    // "offline" and retries the action once the connection is back, so it never settles).
    const draft = 'Mensagem que não pode se perder';
    await page.route(`${hosts.demo}/suporte`, async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await route.fulfill({ status: 500, contentType: 'text/plain', body: 'falha simulada' });
        return;
      }
      await route.continue();
    });
    await send(page, draft);
    await expect(sendError(page)).toHaveText(C.composer.errors.failed);
    await expect(composerField(page)).toHaveValue(draft);
    await expect(bubbles(page)).toHaveCount(0);

    await composerField(page).press('End');
    await composerField(page).pressSequentially('!');
    await expect(sendError(page)).toHaveCount(0);
  });

  test('6. a 2,000-character message with 40 line breaks arrives live in full, at the bottom, and a long URL never scrolls sideways', async ({
    page,
  }) => {
    const conversationId = await sendAsMember(MEMBER, 'Início da conversa');
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(bubbles(page)).toHaveCount(1);
    await page.waitForTimeout(1_500);

    const line = 'Linha longa de teste com palavras. ';
    const lines = Array.from({ length: 41 }, (_, i) => `${i + 1}. ${line}`);
    let body = lines.join('\n');
    body = (body + 'x'.repeat(2000)).slice(0, 2000);
    expect([...body].length).toBe(2000);
    expect(body.split('\n')).toHaveLength(41);

    await insertMessages(conversationId, [{ side: 'staff', body }]);
    const long = bubbles(page).filter({ hasText: '41. Linha longa' });
    await expect(long).toHaveCount(1, { timeout: 15_000 });
    const text = await long.locator('[data-chat-bubble] > div').evaluate((el) => el.textContent);
    expect(text).toBe(body);
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);

    const url = `https://exemplo.com.br/${'a'.repeat(300)}`;
    await insertMessages(conversationId, [{ side: 'staff', body: url }]);
    await expect(thread(page).locator(`a[href="${url}"]`)).toHaveCount(1, { timeout: 15_000 });
    const widths = await thread(page)
      .locator('[data-chat-scroller]')
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(widths.scroll).toBe(widths.client);
  });

  test('8. history: the pane opens at the bottom with 50, and older messages prepend with the top kept in view', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const conversationId = await ensureConversation(MEMBER);
    await insertMessages(
      conversationId,
      Array.from({ length: 60 }, (_, i) => ({
        side: i % 2 === 0 ? ('staff' as const) : ('member' as const),
        body: `Historico ${String(i + 1).padStart(2, '0')}`,
      })),
    );

    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(bubbles(page)).toHaveCount(50);
    await expect(bubbles(page).first()).toContainText('Historico 11');
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);

    const older = page.getByRole('button', { name: C.thread.older });
    await older.scrollIntoViewIfNeeded();
    await older.click();
    await expect(bubbles(page)).toHaveCount(60);
    await expect(bubbles(page).first()).toContainText('Historico 01');
    await expect(older).toHaveCount(0);
    // The message that was on top before the load is still in the scroller's viewport.
    const kept = bubbles(page).filter({ hasText: 'Historico 11' });
    await expect(kept).toBeInViewport();
  });
});

test.describe('chat membro — relógio do tenant', () => {
  test.use({ timezoneId: 'America/Manaus' });

  test('7. bubble times are the São Paulo wall clock, not the device clock', async ({ page }) => {
    const readBefore = await memberReadSeq(SEED_SUPPORT_CONVERSATION_ID);
    try {
      const rows = await messagesOf(SEED_SUPPORT_CONVERSATION_ID);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const spClock = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const manausClock = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Manaus',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });

      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/suporte`);
      await expect(log(page)).toBeVisible();
      // The device really is in Manaus.
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
        'America/Manaus',
      );

      const times = await thread(page).locator('[data-chat-time]').allTextContents();
      for (const row of rows.slice(0, 3)) {
        const bubble = bubbles(page).filter({ hasText: row.body });
        await expect(bubble).toHaveCount(1);
        const sp = spClock.format(new Date(row.createdAt));
        const time = bubble.locator('[data-chat-time]');
        if ((await time.count()) > 0) await expect(time).toHaveText(sp);
      }
      const expected = rows.slice(0, 3).map((row) => spClock.format(new Date(row.createdAt)));
      const deviceClock = rows
        .slice(0, 3)
        .map((row) => manausClock.format(new Date(row.createdAt)));
      expect(times.some((time) => expected.includes(time))).toBe(true);
      expect(times.some((time) => deviceClock.includes(time) && !expected.includes(time))).toBe(
        false,
      );
    } finally {
      await setMemberReadSeq(SEED_SUPPORT_CONVERSATION_ID, readBefore);
    }
  });
});

/* ── 07-10: the staff side ─────────────────────────────────────────────────────────────────────── */

/** A second demo member for the staff cases, so the seeded thread and 07-09's MEMBER stay untouched. */
const STAFF_CASE_MEMBER = 'rafael.teixeira@rede-demo.local';

/**
 * The inbox rows IN the list pane (the list is rendered once, in the shared `/suporte` layout). Scoped
 * on purpose: React streams a resolved Suspense boundary into a hidden `<div hidden id="S:…">` at the
 * end of the body before revealing it, so an unscoped count can match rows that are not on screen yet.
 */
const listPane = (page: Page) => page.locator('[data-support-list]');
const inboxRows = (page: Page) => listPane(page).locator('a[data-inbox-row]');
const inboxRow = (page: Page, conversationId: string) =>
  listPane(page).locator(`a[data-inbox-row][href="/suporte/${conversationId}"]`);
const staffCount = (count: number) => tc('navBadge.staff', { count });

type DeviceUse = Parameters<Browser['newContext']>[0];

/** A second, independent browser context (its own cookies) signed in as `email` on the demo host. */
async function contextAs(browser: Browser, email: string, use: DeviceUse) {
  const context = await browser.newContext(use);
  const page = await context.newPage();
  await login(page, email, SEED_PASSWORD, hosts.demo);
  return { context, page };
}

/** The ONE not-found screen (D-23), whatever the cause. */
async function expectConversationNotFound(page: Page): Promise<void> {
  const screen = page.locator('[data-chat-not-found]').filter({ visible: true });
  await expect(screen.getByRole('heading', { name: C.notFound.title })).toBeVisible();
  await expect(screen).toContainText(tc('notFound.body', { tenant: TENANT }));
  await expect(screen.getByRole('link', { name: C.notFound.cta })).toHaveAttribute(
    'href',
    '/suporte',
  );
  await expect(thread(page)).toHaveCount(0);
}

/**
 * CHAT-03 / CHAT-04 (plan 07-10, ROADMAP SC 3): the staff side of support in the browser. The same
 * chat slot lands a `chat.support` holder on the inbox (D-224); the list is ordered by activity with the
 * awaiting dot, refreshes itself live, and the team shares one read state (D-225, D-238). The staff
 * thread links the member's profile, labels team bubbles with first names or "Você", is read-only for a
 * blocked member, and every miss is one not-found screen. From `lg` the list and the thread share one
 * split card, and a row click swaps only the right pane.
 *
 * Every case starts from a clean inbox: only the seeded thread, "awaiting", staff count 1.
 */
test.describe('chat equipe', () => {
  test.beforeEach(async () => {
    await unblockMember(STAFF_CASE_MEMBER);
    await resetStaffInbox();
  });

  test.afterAll(async () => {
    await unblockMember(STAFF_CASE_MEMBER);
    await resetMemberConversation(users.labMember, 'rede-lab');
    await resetStaffInbox();
  });

  test('1. the support user: the slot counts 1, the inbox marks the seeded thread, the thread links the profile and labels its own reply "Você"', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-chromium',
      'the phone flow (list and thread are routes)',
    );
    const memberName = await displayNameOf(users.demoMember);
    const membershipId = await membershipIdFor(users.demoMember, 'rede-demo');

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await expect(chatSlot(page)).toHaveAccessibleName(staffCount(1));
    await chatSlot(page).click();
    await expect(page).toHaveURL(/\/suporte$/);
    await expect(page.getByRole('heading', { level: 1, name: C.inbox.title })).toBeVisible();

    const row = inboxRow(page, SEED_SUPPORT_CONVERSATION_ID);
    await expect(inboxRows(page)).toHaveCount(1);
    await expect(row).toHaveAttribute('data-awaiting', 'true');
    await expect(row.locator('[data-inbox-dot]')).toBeVisible();
    await expect(row.locator('[data-inbox-name]')).toHaveText(`${memberName}${C.inbox.awaitingSr}`);
    await expect(row.locator('[data-inbox-preview]')).toHaveText(
      SEED_SUPPORT_MESSAGES.memberSecond,
    );
    await expect(row.locator('[data-inbox-time]')).toHaveText(/^(\d{2}:\d{2}|Ontem|\d{2}\/\d{2})$/);
    // D-221: one list, no status chips, no filters.
    await expect(page.getByRole('tab')).toHaveCount(0);

    const read = page.waitForResponse((res) =>
      /\/api\/chat\/conversations\/[^/]+\/read$/.test(res.url()),
    );
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/suporte/${SEED_SUPPORT_CONVERSATION_ID}$`));
    expect((await read).status()).toBe(204);

    const profile = page.getByRole('link', { name: tc('staff.profile', { name: memberName }) });
    await expect(profile).toHaveAttribute('href', `/membros/${membershipId}`);
    await expect(profile.getByRole('heading', { level: 1 })).toHaveText(memberName);
    await expect(page.getByRole('link', { name: C.staff.back })).toHaveAttribute(
      'href',
      '/suporte',
    );

    const reply = bubbles(page).filter({ hasText: SEED_SUPPORT_MESSAGES.staffReply });
    await expect(reply.locator('[data-chat-bubble="own"]')).toBeVisible();
    await expect(reply.locator('[data-chat-sender]')).toHaveText(C.sender.you);
    const fromMember = bubbles(page).filter({ hasText: SEED_SUPPORT_MESSAGES.memberFirst });
    await expect(fromMember.locator('[data-chat-bubble="other"]')).toBeVisible();
    await expect(fromMember.locator('[data-chat-sender]')).toHaveCount(0);

    // Opening the thread while visible read it for the team: the count clears live.
    await expect(chatSlot(page)).toHaveAccessibleName(C.nav, { timeout: 15_000 });
  });

  test('2. two staff members share the thread: a member message moves the row up live in both inboxes, and one read clears the dot and the count for both without a reload', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    test.setTimeout(120_000);
    // The member's thread exists and is read, BELOW newer read threads; only the seeded one awaits.
    const conversationId = await ensureConversation(STAFF_CASE_MEMBER);
    await insertMessages(conversationId, [{ side: 'member', body: 'Mensagem antiga' }]);
    const others = await seedInboxConversations([STAFF_CASE_MEMBER]);
    for (const id of [conversationId, ...others]) await setStaffReadSeq(id, 1);

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
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
      for (const p of [page, admin.page]) {
        await p.goto(`${hosts.demo}/suporte`);
        await expect(inboxRows(p)).toHaveCount(others.length + 2);
        await expect(inboxRows(p).first()).not.toHaveAttribute(
          'href',
          `/suporte/${conversationId}`,
        );
        await expect(inboxRow(p, conversationId)).not.toHaveAttribute('data-awaiting', 'true');
        await expect(chatSlot(p)).toHaveAccessibleName(staffCount(1));
        await p.evaluate(() => {
          (window as unknown as { __noReload: boolean }).__noReload = true;
        });
      }
      // Both inboxes join the support-inbox topic before the member writes.
      await page.waitForTimeout(2_000);

      const text = `Mensagem ao vivo ${Date.now()}`;
      expect(await sendAsMember(STAFF_CASE_MEMBER, text)).toBe(conversationId);
      for (const p of [page, admin.page]) {
        const first = inboxRows(p).first();
        await expect(first).toHaveAttribute('href', `/suporte/${conversationId}`, {
          timeout: 15_000,
        });
        await expect(first).toHaveAttribute('data-awaiting', 'true');
        await expect(first.locator('[data-inbox-preview]')).toHaveText(text);
        await expect(first.locator('[data-inbox-time]')).toHaveText(/^\d{2}:\d{2}$/);
        await expect(chatSlot(p)).toHaveAccessibleName(staffCount(2), { timeout: 15_000 });
      }

      // The support user opens it; the admin's dot and count clear with no reload (D-225, D-238).
      await inboxRow(page, conversationId).click();
      await expect(page).toHaveURL(new RegExp(`/suporte/${conversationId}$`));
      const adminRow = inboxRow(admin.page, conversationId);
      await expect(adminRow).not.toHaveAttribute('data-awaiting', 'true', { timeout: 15_000 });
      await expect(adminRow.locator('[data-inbox-dot]')).toHaveCount(0);
      await expect(chatSlot(admin.page)).toHaveAccessibleName(staffCount(1), { timeout: 15_000 });
      expect(
        await admin.page.evaluate(
          () => (window as unknown as { __noReload?: boolean }).__noReload === true,
        ),
      ).toBe(true);

      // The admin reads the team's bubbles by first name (UI-D-259).
      await admin.page.goto(`${hosts.demo}/suporte/${SEED_SUPPORT_CONVERSATION_ID}`);
      const reply = bubbles(admin.page).filter({ hasText: SEED_SUPPORT_MESSAGES.staffReply });
      await expect(reply.locator('[data-chat-sender]')).toHaveText(SUPPORT_FIRST_NAME);
    } finally {
      await admin.context.close();
    }
  });

  test('3. a staff reply reaches the member live; its author reads it as "Você"', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    test.setTimeout(120_000);
    const conversationId = await sendAsMember(STAFF_CASE_MEMBER, 'Preciso de ajuda com o evento');
    const member = await contextAs(browser, STAFF_CASE_MEMBER, {
      ...contextOptions,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      serviceWorkers: 'block',
    });
    try {
      await member.page.goto(`${hosts.demo}/suporte`);
      await expect(bubbles(member.page)).toHaveCount(1);

      await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/suporte/${conversationId}`);
      await expect(bubbles(page)).toHaveCount(1);
      await member.page.waitForTimeout(1_500);

      const reply = `Resposta da equipe ${Date.now()}`;
      await send(page, reply);
      const own = bubbles(page).filter({ hasText: reply });
      await expect(own.locator('[data-chat-bubble="own"]')).toBeVisible();
      await expect(own.locator('[data-chat-sender]')).toHaveText(C.sender.you);

      const live = bubbles(member.page).filter({ hasText: reply });
      await expect(live).toHaveCount(1, { timeout: 15_000 });
      await expect(live.locator('[data-chat-sender]')).toHaveText(
        `${SUPPORT_FIRST_NAME}${C.sender.staffSr}`,
      );
    } finally {
      await member.context.close();
    }
  });

  test('4. a blocked member: the inbox pill, a read-only thread, and a reply racing the block toasts the notice and swaps it in', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const conversationId = await sendAsMember(STAFF_CASE_MEMBER, 'Mensagem antes do bloqueio');
    const name = await displayNameOf(STAFF_CASE_MEMBER);
    const notice = tc('blocked.notice', { name });
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);

    await blockMember(STAFF_CASE_MEMBER);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(inboxRow(page, conversationId).locator('[data-inbox-blocked]')).toHaveText(
      C.blocked.pill,
    );
    await page.goto(`${hosts.demo}/suporte/${conversationId}`);
    await expect(thread(page).locator('[data-chat-readonly]')).toHaveText(notice);
    await expect(composerField(page)).toHaveCount(0);
    await expect(bubbles(page)).toHaveCount(1);

    // The race: the composer is open when the block lands.
    await unblockMember(STAFF_CASE_MEMBER);
    await page.reload();
    await expect(composerField(page)).toBeEnabled();
    await blockMember(STAFF_CASE_MEMBER);
    const draft = `Resposta que corre com o bloqueio ${Date.now()}`;
    await send(page, draft);
    await expect(page.getByRole('status').filter({ hasText: notice })).toBeVisible();
    await expect(thread(page).locator('[data-chat-readonly]')).toHaveText(notice, {
      timeout: 15_000,
    });
    await expect(composerField(page)).toHaveCount(0);
    await expect(bubbles(page).filter({ hasText: draft })).toHaveCount(0);
  });

  test("5. every miss is one screen: a member on a staff URL, another tenant's id, an unknown id, a malformed id", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const labConversation = await ensureConversation(users.labMember, 'rede-lab');

    await login(page, STAFF_CASE_MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte/${SEED_SUPPORT_CONVERSATION_ID}`);
    await expectConversationNotFound(page);
    await signOut(page, hosts.demo);

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    for (const id of [labConversation, randomUUID(), 'nao-e-um-id']) {
      await page.goto(`${hosts.demo}/suporte/${id}`);
      await expectConversationNotFound(page);
    }
  });

  test('6. desktop split: the list beside the idle pane; a row click swaps only the right pane and keeps the list scroll', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the lg split view');
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const extra = await seedInboxConversations();

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    const split = page.locator('[data-support-split]');
    await expect(split).toBeVisible();
    expect(
      await split.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ')[0]),
    ).toBe('288px');
    await expect(page.locator('[data-support-idle]')).toContainText(C.inbox.idle.title);
    await expect(
      listPane(page).getByRole('heading', { level: 1, name: C.inbox.title }),
    ).toBeVisible();
    await expect(inboxRows(page)).toHaveCount(extra.length + 1);
    await expect(inboxRows(page).last()).toBeVisible();

    // The list pane scrolls on its own (its rows overflow the card's height).
    await expect
      .poll(() =>
        listPane(page).evaluate((el) => {
          el.scrollTop = el.scrollHeight;
          return el.scrollTop;
        }),
      )
      .toBeGreaterThan(0);
    const top = await listPane(page).evaluate((el) => el.scrollTop);
    await page.evaluate(() => {
      (window as unknown as { __split: boolean }).__split = true;
    });

    const target = inboxRows(page).last();
    const href = (await target.getAttribute('href')) ?? '';
    const row = listPane(page).locator(`a[data-inbox-row][href="${href}"]`);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(row).toHaveAttribute('aria-current', 'page');
    await expect(row).toHaveClass(/bg-bg-active/);
    await expect(thread(page).locator('[data-thread-header]')).toBeVisible();
    await expect(page.locator('[data-support-idle]')).toHaveCount(0);
    // A client navigation (no document reload), and the list kept its scroll position.
    expect(
      await page.evaluate(() => (window as unknown as { __split?: boolean }).__split === true),
    ).toBe(true);
    await page.waitForTimeout(1_000);
    const after = await listPane(page).evaluate((el) => el.scrollTop);
    expect(Math.abs(after - top)).toBeLessThanOrEqual(1);
    await expect(listPane(page).locator('a[data-inbox-row][aria-current="page"]')).toHaveCount(1);
  });

  test('7. E13 backstop: 1280 → 900 keeps the open conversation URL and shows the thread alone; back returns to the list', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the lg split view');
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await inboxRow(page, SEED_SUPPORT_CONVERSATION_ID).click();
    await expect(page).toHaveURL(new RegExp(`/suporte/${SEED_SUPPORT_CONVERSATION_ID}$`));
    await expect(listPane(page)).toBeVisible();
    await expect(thread(page).locator('[data-thread-header]')).toBeVisible();

    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page).toHaveURL(new RegExp(`/suporte/${SEED_SUPPORT_CONVERSATION_ID}$`));
    await expect(listPane(page)).toBeHidden();
    await expect(thread(page).locator('[data-thread-header]')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/suporte$/);
    await expect(listPane(page)).toBeVisible();
    await expect(inboxRow(page, SEED_SUPPORT_CONVERSATION_ID)).toBeVisible();
    await expect(page.locator('[data-support-idle]')).toBeHidden();
  });
});

test.describe('chat equipe — relógio do tenant', () => {
  test.use({ timezoneId: 'America/Manaus' });

  test.beforeEach(async () => {
    await resetStaffInbox();
  });

  test('8. inbox times are the São Paulo wall clock, not the device clock', async ({ page }) => {
    const rows = await messagesOf(SEED_SUPPORT_CONVERSATION_ID);
    const last = rows.at(-1);
    expect(last).toBeDefined();
    const instant = new Date(last?.createdAt ?? 0);
    const clock = (timeZone: string) =>
      new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(instant);
    const day = (timeZone: string, at: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'America/Manaus',
    );
    const time = inboxRow(page, SEED_SUPPORT_CONVERSATION_ID).locator('[data-inbox-time]');
    await expect(time).toBeVisible();
    const shown = (await time.textContent()) ?? '';
    if (day('America/Sao_Paulo', instant) === day('America/Sao_Paulo', new Date())) {
      expect(shown).toBe(clock('America/Sao_Paulo'));
    }
    expect(shown).not.toBe(clock('America/Manaus'));
  });
});
