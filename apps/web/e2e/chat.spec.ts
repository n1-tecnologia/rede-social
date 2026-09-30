import { expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import {
  closeChatAdmin,
  ensureConversation,
  insertMessages,
  memberReadSeq,
  messagesOf,
  replyAsSupport,
  resetMemberConversation,
  SEED_SUPPORT_CONVERSATION_ID,
  SUPPORT_FIRST_NAME,
  sendAsMember,
  setMemberReadSeq,
} from './chat-admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

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
