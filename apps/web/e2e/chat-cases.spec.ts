import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import { closeAdmin, createMember, deleteUserByEmail, disallowEmail } from './admin';
import {
  blockMember,
  caseRowOf,
  closeCase,
  closeChatAdmin,
  createCase,
  insertMessages,
  resetMemberConversation,
  SUPPORT_EMAIL,
  SUPPORT_FIRST_NAME,
  setCaseState,
  unblockMember,
} from './chat-admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 12.4 (CASE-14, CASE-16, CASE-18, CASE-19, CASE-28; D-801, D-803, D-805, D-808, UI-D-818, UI-D-830):
 * the support CASE in the browser, on the phone (`mobile-chromium`).
 *
 * Test 1 is the tracer: one case walked from the member's opener to a second case through the real screens
 * of both sides (the member's opener and bar, the team's inbox, bar, dialogs and the bell row of the resolved
 * notice, which the worker writes). The others pin what only a browser can: the inbox view that lives in the
 * URL, the narrow layouts, the 44 px targets, the reader's place when the bar changes height, the read-only
 * notice of a blocked member and the admin's assignment.
 *
 * **Neutrality.** Everything here is a throwaway `e2ecase-` member (created and deleted by this file, never a
 * seeded one and never an account of the owner) and the seeded `support@` and `admin@` of the demo tenant. The
 * spec never resets or seeds the database, never touches the case counter (a number is READ from the screen
 * and the next one is asserted as that number plus one), never edits the seeded support thread, names no
 * payment gateway and no push provider. It leaves no row behind: `beforeEach` and `afterAll` delete the
 * member's own cases and the member.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering a navigation from its own cache would
 * make these assertions read what a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });
/** The tracer walks two browsers and a worker: every case here gets the long budget. */
test.describe.configure({ timeout: 240_000 });

/** The catalogs are the source of copy, never a literal in a spec. */
const C = chatMessages.chat;
const N = notificationMessages.notifications;
const tc = createTranslator({
  locale: 'pt-BR',
  messages: chatMessages,
  namespace: 'chat',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The bell's accessible name is the plain label at zero and "label, N nova(s)" above it (UI-D-253). */
const BELL_NAME = new RegExp(`^${escapeRegExp(N.nav)}(, .+)?$`);

/** The bell row's sentence as the catalog writes it, with the bold marks taken out. */
const resolvedSentence = (number: number) =>
  N.kinds.supportResolved.replace(/<\/?b>/g, '').replace('{number}', String(number));

const MEMBER = `e2ecase-${Date.now()}@rede-demo.local`;

/** A well-formed staff id that belongs to nobody: an owner filter that can match no case. */
const NOBODY = '0e2e0000-0000-4000-8000-0000000000e2';

let prepared = false;
let stopWorker: () => Promise<void> = async () => {};

test.beforeAll(async ({ browser: _browser }, testInfo) => {
  if (testInfo.project.name !== 'mobile-chromium') return;
  await createMember(MEMBER, SEED_PASSWORD, 'rede-demo');
  stopWorker = await ensureWorker();
  prepared = true;
});

test.beforeEach(async () => {
  if (prepared) await resetMemberConversation(MEMBER);
});

test.afterAll(async () => {
  if (prepared) {
    await unblockMember(MEMBER).catch(() => {});
    await resetMemberConversation(MEMBER);
    await deleteUserByEmail(MEMBER);
    await disallowEmail(MEMBER);
  }
  await closeAdmin();
  await closeChatAdmin();
  await stopWorker();
});

/** These cases drive the phone layouts; the desktop project skips them. */
function phoneOnly(testInfo: { project: { name: string } }): void {
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'the phone flow (list and thread are routes)',
  );
}

// ── locators ─────────────────────────────────────────────────────────────────────────────────────

/** The visible thread column (the dev server's Fast Refresh can leave a hidden stale copy). */
const thread = (page: Page) => page.locator('[data-chat-thread]').filter({ visible: true });
const bubbles = (page: Page) => thread(page).locator('[data-chat-message]');
const scroller = (page: Page) => thread(page).locator('[data-chat-scroller]');
const composerField = (page: Page) => page.getByRole('textbox', { name: C.composer.label });
/** The send button's name is "Abrir chamado" while there is no case and "Enviar mensagem" afterwards. */
const sendButton = (page: Page) =>
  page.getByRole('button', {
    name: new RegExp(`^(${escapeRegExp(C.composer.send)}|${escapeRegExp(C.composer.sendNew)})$`),
  });
/** The case bar of the page on screen (the member's or the team's). */
const caseBar = (page: Page) => page.locator('[data-case-bar]').filter({ visible: true });
/** A state pill of the bar: the word is always drawn (colour is never the only signal). */
const pill = (page: Page, word: string) => caseBar(page).getByText(word, { exact: true });
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });
const bellLink = (page: Page) =>
  page.getByRole('link', { name: BELL_NAME }).filter({ visible: true });

/** The inbox rows IN the list pane (scoped on purpose, see `chat.spec.ts`). */
const listPane = (page: Page) => page.locator('[data-support-list]');
/** The row of one case: its href may carry the view's query string, so only the prefix is matched. */
const inboxRow = (page: Page, conversationId: string) =>
  listPane(page).locator(`a[data-inbox-row][href^="/suporte/${conversationId}"]`);

async function send(page: Page, text: string): Promise<void> {
  await composerField(page).fill(text);
  await sendButton(page).click();
}

/** The number a screen drew ("Chamado #42 aberto.", "#42 · assunto"): read, never assumed. */
function numberIn(text: string): number {
  const match = /#(\d+)/.exec(text);
  if (!match?.[1]) throw new Error(`no case number in "${text}"`);
  return Number(match[1]);
}

/** The pathname and query of the page, to compare a view without caring for the host. */
const pathOf = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search;
};

/**
 * The height a finger gets: the box, or the transparent 44 px `::after` area the shipped `hitArea` buttons
 * draw (the 36 px look is unchanged, UI-D-443).
 */
async function tapHeight(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect().height;
    const after = Number.parseFloat(getComputedStyle(el, '::after').height);
    return Math.max(box, Number.isNaN(after) ? 0 : after);
  });
}

type DeviceUse = Parameters<Browser['newContext']>[0];

/** A second, independent browser context (its own cookies) signed in as `email` on the demo host. */
async function contextAs(browser: Browser, email: string, use: DeviceUse) {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page, email, SEED_PASSWORD, hosts.demo);
  return { context, page };
}

/** The pieces of the phone's device preset a second context must repeat to look the same. */
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

// ── 1. the tracer ────────────────────────────────────────────────────────────────────────────────

test.describe('chamados no navegador', () => {
  test('1. a case travels from the opener to the second case: open, take, answer, resolve, the notice, reopen by reply, close, open the next', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    phoneOnly(testInfo);
    const stamp = Date.now();
    const subjectA = `e2ecase-${stamp}-a`;
    const subjectB = `e2ecase-${stamp}-b`;

    // The member with no case sees the opener, with "Outro" pressed.
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(page.locator('[data-case-opener]')).toBeVisible();
    await expect(page.getByRole('group', { name: C.open.category })).toBeVisible();
    await expect(
      page.getByRole('button', { name: C.category.other, exact: true, pressed: true }),
    ).toBeVisible();
    await expect(caseBar(page)).toHaveCount(0);

    // "Pagamento", a subject, the message, and the send button reads "Abrir chamado".
    await page.getByRole('button', { name: C.category.payment, exact: true }).click();
    await expect(
      page.getByRole('button', { name: C.category.payment, exact: true, pressed: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: C.category.other, exact: true, pressed: true }),
    ).toHaveCount(0);
    await page.getByRole('textbox', { name: C.open.subject.label }).fill(subjectA);
    await composerField(page).fill(`Primeira mensagem de ${subjectA}`);
    await page.getByRole('button', { name: C.composer.sendNew, exact: true }).click();

    // The first-send confirmation names the number; the opener leaves and the bar arrives.
    const opened = page.locator('[data-case-opened]');
    await expect(opened).toContainText(/Chamado #\d+ aberto\./);
    const first = numberIn(await opened.innerText());
    await expect(opened).toContainText(C.case.opened.body);
    await expect(page.locator('[data-case-opener]')).toHaveCount(0);
    await expect(caseBar(page)).toContainText(tc('case.title', { number: String(first) }));
    await expect(pill(page, C.state.open)).toBeVisible();
    await expect(caseBar(page).locator('[data-case-subject]')).toHaveText(subjectA);
    await expect(caseBar(page).getByRole('link', { name: C.case.mine })).toHaveAttribute(
      'href',
      '/suporte/chamados',
    );

    // The team: a second context as the support user finds the case in "Em aberto" by number and subject.
    const staff = await contextAs(
      browser,
      SUPPORT_EMAIL,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const sp = staff.page;
      await sp.goto(`${hosts.demo}/suporte`);
      await expect(sp.getByRole('tab', { name: C.inbox.tab.open, selected: true })).toBeVisible();
      const line = tc('inbox.rowSubject', { number: String(first), subject: subjectA });
      const row = listPane(sp)
        .locator('a[data-inbox-row]')
        .filter({ has: sp.locator('[data-inbox-subject]', { hasText: line }) });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row).toHaveAttribute('data-awaiting', 'true');
      await expect(row.locator('[data-case-pill]')).toHaveText(C.state.open);
      await expect(row.locator('[data-inbox-meta-text]')).toHaveText(
        tc('inbox.meta.unowned', { category: C.category.payment }),
      );

      await row.click();
      await expect(sp).toHaveURL(/\/suporte\/[0-9a-f-]{36}$/);
      const conversationId = sp.url().split('/suporte/')[1]?.split(/[/?#]/)[0] ?? '';
      const bar = caseBar(sp);
      await expect(bar).toContainText(`#${first}`);
      await expect(bar.locator('[data-case-subject]')).toHaveText(subjectA);
      await expect(sp.locator('[data-case-take-hint]')).toContainText(C.staffCase.takeOnReply);

      // "Assumir": the case is the viewer's, and the meta text reads "Com você".
      await bar.getByRole('button', { name: C.action.take, exact: true }).click();
      await expect(toast(sp, tc('toast.taken', { number: String(first) }))).toBeVisible();
      await expect(bar.locator('[data-case-meta]')).toHaveText(
        tc('staffCase.meta.mine', { category: C.category.payment, priority: C.priority.normal }),
      );
      await expect(pill(sp, C.state.inProgress)).toBeVisible();
      await expect(sp.locator('[data-case-take-hint]')).toHaveCount(0);
      // The member's bar follows live, with no reload.
      await expect(pill(page, C.state.inProgress)).toBeVisible({ timeout: 20_000 });

      // The team replies; the member reads it live.
      const reply = `Resposta da equipe ${stamp}`;
      await send(sp, reply);
      await expect(bubbles(sp).filter({ hasText: reply })).toHaveCount(1);
      await expect(bubbles(page).filter({ hasText: reply })).toHaveCount(1, { timeout: 20_000 });

      // "Resolver" asks first; the confirm resolves, the team's pill and the toast say so.
      await bar.getByRole('button', { name: C.action.resolve, exact: true }).click();
      const resolveDialog = sp.getByRole('dialog', {
        name: tc('dialog.resolve.title', { number: String(first) }),
      });
      await expect(resolveDialog).toContainText(C.dialog.resolve.body);
      await resolveDialog.getByRole('button', { name: C.dialog.resolve.confirm }).click();
      await expect(toast(sp, tc('toast.resolved', { number: String(first) }))).toBeVisible();
      await expect(pill(sp, C.state.resolved)).toBeVisible();
      expect((await caseRowOf(conversationId)).state).toBe('resolved');

      // The member sees the Resolvido strip above an enabled composer, live.
      const resolvedStrip = page.locator('[data-case-resolved]');
      await expect(resolvedStrip).toBeVisible({ timeout: 20_000 });
      await expect(resolvedStrip).toContainText(C.case.resolvedNotice);
      await expect(pill(page, C.state.resolved)).toBeVisible();
      await expect(composerField(page)).toBeEnabled();

      // The bell row of the resolved notice (the worker writes it) and its link opens the case.
      await bellLink(page).click();
      await expect(page).toHaveURL(/\/notificacoes$/);
      const noticeRow = page
        .getByTestId('notification-item')
        .filter({ hasText: resolvedSentence(first) });
      await expect(async () => {
        await page.reload();
        await expect(noticeRow).toHaveCount(1, { timeout: 4_000 });
      }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 3_000] });
      await noticeRow.click();
      await expect(page).toHaveURL(/\/suporte(\/[0-9a-f-]{36})?$/);
      await expect(caseBar(page)).toContainText(tc('case.title', { number: String(first) }));
      await expect(page.locator('[data-case-resolved]')).toBeVisible();

      // The member replies: the case reopens, the pill is "Aberto" again and the toast says so.
      await send(page, `Ainda preciso de ajuda ${stamp}`);
      await expect(toast(page, tc('case.reopenedToast', { number: String(first) }))).toBeVisible();
      await expect(pill(page, C.state.open)).toBeVisible();
      await expect(page.locator('[data-case-resolved]')).toHaveCount(0);
      // The team's screen follows: open again, no owner, "Assumir" is back.
      await expect(pill(sp, C.state.open)).toBeVisible({ timeout: 20_000 });
      await expect(bar.getByRole('button', { name: C.action.take, exact: true })).toBeVisible();

      // "Mais ações", "Fechar" and the danger dialog.
      await bar.getByRole('button', { name: C.action.more, exact: true }).click();
      await sp
        .getByRole('dialog', { name: C.action.more })
        .getByRole('button', { name: C.action.close, exact: true })
        .click();
      const closeDialog = sp.getByRole('dialog', {
        name: tc('dialog.close.title', { number: String(first) }),
      });
      await expect(closeDialog).toContainText(C.dialog.close.body);
      await closeDialog.getByRole('button', { name: C.dialog.close.confirm }).click();
      await expect(toast(sp, tc('toast.closed', { number: String(first) }))).toBeVisible();
      await expect(sp.locator('[data-case-closed]')).toContainText(C.staffCase.closedNotice);
      await expect(composerField(sp)).toHaveCount(0);
      expect((await caseRowOf(conversationId)).state).toBe('closed');

      // The member sees the Fechado strip with "Novo chamado", and no composer.
      const closedStrip = page.locator('[data-case-closed]');
      await expect(closedStrip).toBeVisible({ timeout: 20_000 });
      await expect(closedStrip).toContainText(C.case.closedNotice);
      await expect(composerField(page)).toHaveCount(0);
      await closedStrip.getByRole('link', { name: C.case.newCase }).click();

      // A new message opens the NEXT case: exactly one number higher than the number the screen drew.
      await expect(page).toHaveURL(/\/suporte$/);
      await expect(page.locator('[data-case-opener]')).toBeVisible();
      await page.getByRole('button', { name: C.category.account, exact: true }).click();
      await page.getByRole('textbox', { name: C.open.subject.label }).fill(subjectB);
      await composerField(page).fill(`Segundo assunto de ${subjectB}`);
      await page.getByRole('button', { name: C.composer.sendNew, exact: true }).click();
      const openedAgain = page.locator('[data-case-opened]');
      await expect(openedAgain).toContainText(/Chamado #\d+ aberto\./);
      const second = numberIn(await openedAgain.innerText());
      expect(second).toBe(first + 1);

      // "Meus chamados": the new case is the current one, the first sits under "Anteriores".
      await caseBar(page).getByRole('link', { name: C.case.mine }).click();
      await expect(page).toHaveURL(/\/suporte\/chamados$/);
      const current = page.locator('[data-my-cases] section', { hasText: C.mine.current });
      await expect(current.locator('[data-case-card]')).toHaveCount(1);
      await expect(current).toContainText(tc('case.title', { number: String(second) }));
      await expect(current).toContainText(subjectB);
      const previous = page.locator('[data-my-cases] section', { hasText: C.mine.previous });
      const oldCard = previous
        .locator('[data-case-card]')
        .filter({ hasText: tc('case.title', { number: String(first) }) });
      await expect(oldCard).toHaveCount(1);
      await expect(oldCard).toContainText(subjectA);
      await expect(oldCard.locator('[data-case-pill]')).toHaveText(C.state.closed);
    } finally {
      await staff.context.close();
    }
  });

  // ── 2 and 3. the inbox view in the URL ────────────────────────────────────────────────────────

  test('2. the inbox view lives in the URL: tabs and filters survive a reload and a row click, the toggle is only on Em aberto, and Limpar filtros clears them', async ({
    page,
  }, testInfo) => {
    phoneOnly(testInfo);
    const subject = `e2ecase-${Date.now()}-fila`;
    const id = await createCase(MEMBER, { subject, priority: 'high' });
    await insertMessages(id, [{ side: 'member', body: `Pedido de ${subject}` }]);
    // Owned by the support user and still waiting (the last message is the member's and unread).
    await setCaseState(id, 'in_progress', SUPPORT_EMAIL);

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    const view = '/suporte?resp=eu&prio=alta&aguardando=1';
    const ownerChip = page.getByRole('button', {
      name: tc('inbox.filter.ownerValue', { value: C.inbox.filter.ownerMe }),
    });
    const priorityChip = page.getByRole('button', {
      name: tc('inbox.filter.priorityValue', { value: C.priority.high }),
    });
    const awaitingChip = page.getByRole('button', { name: C.inbox.filter.awaiting });

    await page.goto(`${hosts.demo}${view}`);
    await expect(inboxRow(page, id)).toBeVisible();
    await expect(ownerChip).toBeVisible();
    await expect(priorityChip).toBeVisible();
    await expect(awaitingChip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('tab', { name: C.inbox.tab.open, selected: true })).toBeVisible();

    // A reload keeps the whole view.
    await page.reload();
    expect(pathOf(page)).toBe(view);
    await expect(inboxRow(page, id)).toBeVisible();
    await expect(ownerChip).toBeVisible();
    await expect(priorityChip).toBeVisible();
    await expect(awaitingChip).toHaveAttribute('aria-pressed', 'true');

    // A row click carries the query to the thread, and back returns to the same view.
    await inboxRow(page, id).click();
    await expect.poll(() => pathOf(page)).toBe(`/suporte/${id}?resp=eu&prio=alta&aguardando=1`);
    await expect(caseBar(page)).toContainText(`#${(await caseRowOf(id)).number}`);
    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe(view);
    await expect(inboxRow(page, id)).toBeVisible();

    // "Resolvidos" keeps the owner and the priority, drops the toggle, and does not list an active case.
    await page.getByRole('tab', { name: C.inbox.tab.resolved }).click();
    await expect.poll(() => pathOf(page)).toBe('/suporte?aba=resolvidos&resp=eu&prio=alta');
    await expect(
      page.getByRole('tab', { name: C.inbox.tab.resolved, selected: true }),
    ).toBeVisible();
    await expect(awaitingChip).toHaveCount(0);
    await expect(inboxRow(page, id)).toHaveCount(0);

    // Once the case is resolved (same owner), the same URL lists it after a reload.
    await setCaseState(id, 'resolved');
    await page.reload();
    expect(pathOf(page)).toBe('/suporte?aba=resolvidos&resp=eu&prio=alta');
    await expect(inboxRow(page, id)).toBeVisible();
    await expect(inboxRow(page, id).locator('[data-case-pill]')).toHaveText(C.state.resolved);

    // "Limpar filtros" clears the owner and the priority and keeps the tab.
    await page.getByRole('button', { name: C.inbox.filter.clear }).click();
    await expect.poll(() => pathOf(page)).toBe('/suporte?aba=resolvidos');
    await expect(page.getByRole('button', { name: C.inbox.filter.clear })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: C.inbox.filter.owner, exact: true }),
    ).toBeVisible();
    await expect(inboxRow(page, id)).toBeVisible();

    // Back on "Em aberto" the toggle is there again.
    await page.getByRole('tab', { name: C.inbox.tab.open }).click();
    await expect.poll(() => pathOf(page)).toBe('/suporte');
    await expect(awaitingChip).toHaveCount(1);
  });

  test('3. a view with no case says why: the filtered-empty state has its own sentence and offers Limpar filtros', async ({
    page,
  }, testInfo) => {
    phoneOnly(testInfo);
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte?resp=${NOBODY}`);

    const empty = page.locator('[data-inbox-empty-cause="filtered"]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(C.inbox.empty.filtered.title);
    await expect(empty).toContainText(C.inbox.empty.filtered.body);
    await expect(empty).not.toContainText(C.inbox.empty.awaiting.title);

    await empty.getByRole('button', { name: C.inbox.filter.clear }).click();
    await expect.poll(() => pathOf(page)).toBe('/suporte');
    await expect(page.locator('[data-inbox-empty-cause="filtered"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: C.inbox.filter.clear })).toHaveCount(0);
  });

  // ── 4. the narrow layouts ────────────────────────────────────────────────────────────────────

  for (const width of [320, 390]) {
    test(`4. at ${width} px the five opener chips wrap to a second line with no sideways scroll, and the send button and the subject are tappable`, async ({
      page,
    }, testInfo) => {
      phoneOnly(testInfo);
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/suporte`);

      const opener = page.locator('[data-case-opener]');
      await expect(opener).toBeVisible();
      const chips = opener.getByRole('button');
      await expect(chips).toHaveCount(5);
      expect(await chips.allInnerTexts()).toEqual([
        C.category.checkIn,
        C.category.events,
        C.category.payment,
        C.category.account,
        C.category.other,
      ]);

      // All five stay visible inside the opener, on at least two lines (the opener never scrolls sideways).
      const boxes = await chips.evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { top: Math.round(r.top), left: r.left, right: r.right };
        }),
      );
      expect(new Set(boxes.map((box) => box.top)).size).toBeGreaterThanOrEqual(2);
      const frame = await opener.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(frame.left - 1);
        expect(box.right).toBeLessThanOrEqual(frame.right + 1);
      }
      for (const el of [opener, scroller(page)]) {
        const widths = await el.evaluate((node) => ({
          scroll: node.scrollWidth,
          client: node.clientWidth,
        }));
        expect(widths.scroll).toBe(widths.client);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );

      // The controls the member touches here are at least 44 px tall. (The chips are the shipped Chip
      // with no 44 px area, kept that way on purpose by the design: UI-SPEC "The Chip hit area".)
      await composerField(page).fill('Algo para enviar');
      expect(await tapHeight(sendButton(page))).toBeGreaterThanOrEqual(44);
      const subject = page.getByRole('textbox', { name: C.open.subject.label });
      expect(await tapHeight(subject)).toBeGreaterThanOrEqual(44);
    });
  }

  // ── 5. the reader's place when the bar changes height ──────────────────────────────────────

  test('5. the scroll position holds when the case bar changes height on a live state change', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    phoneOnly(testInfo);
    const subject = `e2ecase-${Date.now()}-rolagem`;
    const id = await createCase(MEMBER, { subject });
    // Member messages only: a team message would already take the case out of "Aberto".
    await insertMessages(
      id,
      Array.from({ length: 30 }, (_, index) => ({
        side: 'member' as const,
        body: `Rolagem ${index + 1} ${'palavra '.repeat(8)}`.trim(),
      })),
    );

    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(pill(page, C.state.open)).toBeVisible();
    await expect(bubbles(page)).toHaveCount(30);

    // The reader scrolled up, away from the bottom, and one message sits fully in view.
    await scroller(page).evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    });
    await expect
      .poll(() => scroller(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeGreaterThan(200);
    const probe = () =>
      scroller(page).evaluate((el) => {
        const frame = el.getBoundingClientRect();
        let anchor = el.querySelector<HTMLElement>('[data-e2e-anchor]');
        if (!anchor) {
          anchor =
            Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message]')).find((node) => {
              const r = node.getBoundingClientRect();
              return r.top >= frame.top + 8 && r.bottom <= frame.bottom - 8;
            }) ?? null;
          anchor?.setAttribute('data-e2e-anchor', '1');
        }
        const bar = document.querySelector('[data-case-bar]');
        return {
          anchorTop: anchor?.getBoundingClientRect().top ?? null,
          scrollTop: el.scrollTop,
          barHeight: bar?.getBoundingClientRect().height ?? 0,
        };
      });
    const before = await probe();
    expect(before.anchorTop).not.toBeNull();

    // The team takes the case in a second context: no message, only a live state change.
    const staff = await contextAs(
      browser,
      SUPPORT_EMAIL,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      await staff.page.goto(`${hosts.demo}/suporte/${id}`);
      await caseBar(staff.page).getByRole('button', { name: C.action.take, exact: true }).click();
      await expect(pill(staff.page, C.state.inProgress)).toBeVisible();

      await expect(pill(page, C.state.inProgress)).toBeVisible({ timeout: 20_000 });
      // At this width "Em atendimento" makes the "Meus chamados" link drop to its own line: the bar grows.
      await expect.poll(async () => (await probe()).barHeight).not.toBe(before.barHeight);
      const grown = await probe();
      const delta = grown.barHeight - before.barHeight;
      expect(Math.abs(delta)).toBeGreaterThanOrEqual(20);

      // The message the reader was looking at has not moved on the screen: the scroller moved by the bar's delta.
      await expect
        .poll(async () => Math.abs(((await probe()).anchorTop ?? 0) - (before.anchorTop ?? 0)))
        .toBeLessThanOrEqual(2);
      const after = await probe();
      expect(Math.abs(after.scrollTop - before.scrollTop - delta)).toBeLessThanOrEqual(2);
    } finally {
      await staff.context.close();
    }
  });

  // ── 6. the 44 px targets of both bars ────────────────────────────────────────────────────────

  test('6. the controls of the case bars and strips are at least 44 px tall, on the member side and on the team side', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    phoneOnly(testInfo);
    const subject = `e2ecase-${Date.now()}-alvos`;
    const id = await createCase(MEMBER, { subject });
    await insertMessages(id, [{ side: 'member', body: `Mensagem de ${subject}` }]);
    const { number } = await caseRowOf(id);

    // The team's bar on an open case: the details button, the primary action and "Mais ações".
    const staff = await contextAs(
      browser,
      SUPPORT_EMAIL,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      await staff.page.goto(`${hosts.demo}/suporte/${id}`);
      const bar = caseBar(staff.page);
      await expect(bar).toBeVisible();
      const details = bar.getByRole('button', {
        name: tc('staffCase.detailsLabel', { number: String(number) }),
      });
      for (const control of [
        details,
        bar.getByRole('button', { name: C.action.take, exact: true }),
        bar.getByRole('button', { name: C.action.more, exact: true }),
      ]) {
        expect(await tapHeight(control)).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await staff.context.close();
    }

    // The member's bar link and the send button, then the closed strip's "Novo chamado".
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte`);
    await expect(caseBar(page)).toContainText(tc('case.title', { number: String(number) }));
    expect(
      await tapHeight(caseBar(page).getByRole('link', { name: C.case.mine })),
    ).toBeGreaterThanOrEqual(44);
    expect(await tapHeight(sendButton(page))).toBeGreaterThanOrEqual(44);

    // A closed case is read at its own address (the member's /suporte shows the opener again).
    await closeCase(id);
    await page.goto(`${hosts.demo}/suporte/${id}`);
    const newCase = page.locator('[data-case-closed]').getByRole('link', { name: C.case.newCase });
    await expect(newCase).toBeVisible();
    expect(await tapHeight(newCase)).toBeGreaterThanOrEqual(44);
  });

  // ── 7. a blocked member ──────────────────────────────────────────────────────────────────────

  test("7. a blocked member's closed case keeps the blocked notice over the closed strip", async ({
    page,
  }, testInfo) => {
    phoneOnly(testInfo);
    const subject = `e2ecase-${Date.now()}-bloqueio`;
    const id = await createCase(MEMBER, { subject });
    await insertMessages(id, [{ side: 'member', body: `Mensagem de ${subject}` }]);
    await closeCase(id);
    // The notice names the member; the throwaway member has no profile name, so any name is accepted.
    const notice = new RegExp(
      `^${escapeRegExp(tc('blocked.notice', { name: '@@' })).replace('@@', '.+')}$`,
    );

    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await blockMember(MEMBER);
    try {
      await page.goto(`${hosts.demo}/suporte/${id}`);
      await expect(caseBar(page)).toContainText(`#${(await caseRowOf(id)).number}`);
      await expect(pill(page, C.state.closed)).toBeVisible();
      await expect(thread(page).locator('[data-chat-readonly]')).toHaveText(notice);
      // The blocked notice wins: the team's closed strip is not drawn, and there is no composer.
      await expect(page.locator('[data-case-closed]')).toHaveCount(0);
      await expect(composerField(page)).toHaveCount(0);
    } finally {
      await unblockMember(MEMBER);
    }
  });

  // ── 8. the admin's assignment ───────────────────────────────────────────────────────────────

  test('8. the admin assigns an open case to the support user; the support user is not offered "Atribuir a…"', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    phoneOnly(testInfo);
    const subject = `e2ecase-${Date.now()}-atribuir`;
    const id = await createCase(MEMBER, { subject, category: 'events' });
    await insertMessages(id, [{ side: 'member', body: `Mensagem de ${subject}` }]);
    const { number } = await caseRowOf(id);
    const device = deviceOf({
      contextOptions,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/suporte/${id}`);
    const bar = caseBar(page);
    await expect(bar).toContainText(`#${number}`);
    await bar.getByRole('button', { name: C.action.more, exact: true }).click();
    await page
      .getByRole('dialog', { name: C.action.more })
      .getByRole('button', { name: C.action.assign, exact: true })
      .click();

    const sheet = page.getByRole('dialog', {
      name: tc('sheet.assign.title', { number: String(number) }),
    });
    await expect(sheet).toContainText(C.sheet.assign.hint);
    await sheet.getByRole('radio', { name: new RegExp(escapeRegExp(SUPPORT_FIRST_NAME)) }).click();
    await sheet.getByRole('button', { name: C.sheet.assign.confirm, exact: true }).click();
    await expect(
      toast(page, new RegExp(`Chamado #${number} atribuído a ${escapeRegExp(SUPPORT_FIRST_NAME)}`)),
    ).toBeVisible();
    await expect(bar.locator('[data-case-meta]')).toContainText(`Com ${SUPPORT_FIRST_NAME}`);
    await expect(pill(page, C.state.inProgress)).toBeVisible();
    const row = await caseRowOf(id);
    expect(row.state).toBe('in_progress');
    expect(row.ownerEmail).toBe(SUPPORT_EMAIL);

    // The support user holds the case now and is never offered the assignment (the server lists the verbs).
    const staff = await contextAs(browser, SUPPORT_EMAIL, device);
    try {
      await staff.page.goto(`${hosts.demo}/suporte/${id}`);
      const supportBar = caseBar(staff.page);
      await expect(supportBar.locator('[data-case-meta]')).toHaveText(
        tc('staffCase.meta.mine', { category: C.category.events, priority: C.priority.normal }),
      );
      await supportBar.getByRole('button', { name: C.action.more, exact: true }).click();
      const menu = staff.page.getByRole('dialog', { name: C.action.more });
      await expect(menu.getByRole('button', { name: C.action.details, exact: true })).toBeVisible();
      await expect(menu.getByRole('button', { name: C.action.assign, exact: true })).toHaveCount(0);
    } finally {
      await staff.context.close();
    }
  });
});
