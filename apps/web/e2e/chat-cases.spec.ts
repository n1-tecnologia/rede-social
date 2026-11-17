import { type Browser, expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import { closeAdmin, createMember, deleteUserByEmail, disallowEmail } from './admin';
import {
  caseRowOf,
  closeChatAdmin,
  resetMemberConversation,
  SUPPORT_EMAIL,
  unblockMember,
} from './chat-admin';
import { hosts, login, SEED_PASSWORD } from './fixtures';
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
});
