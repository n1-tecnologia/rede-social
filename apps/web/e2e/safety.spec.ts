import { type Browser, expect, type Page, test } from '@playwright/test';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import notificationsMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import safetyMessages from '../messages/pt-BR/safety.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { closeAdmin, createFeedCommentAs, createFeedPostAs, membershipForEmail } from './admin';
import {
  blockAs,
  closeDirectAdmin,
  commentIsRemoved,
  communityStatusOf,
  DIRECT_PREFIX,
  type DirectTenant,
  directSlug,
  dropDirectTenant,
  memberBlockExists,
  moderationActionsOf,
  type Person,
  provisionDirectTenant,
  reportAs,
  reportCountOf,
  reportIdsOf,
  reportStatusOf,
  resetSafetyState,
  sendDirectAs,
} from './direct-admin';
import { hosts, isRemote, login, SEED_PASSWORD } from './fixtures';
import { closeJourneyAdmin, createMemberCommunityAs, createMemberStoryAs } from './member-journey';
import { closeSocialAdmin, followMember } from './social-admin';
import { closeTenantFixtures } from './tenant-fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 11 (MODER-04, MODER-05; D-729, D-731, D-732): a report walked from each subject's menu to the administrator's
 * queue in a real browser, on the phone (`mobile-chromium`) and on the desktop (`desktop-chromium`), both Chromium.
 * The report and block entries are visible in both, because the browser and the app user agent run the same flows
 * (D-616).
 *
 * What it walks: a comment is reported and ignored; a comment is reported and removed (it leaves the feed, the log
 * shows the removal); a story is reported from the viewer's menu; a member community is reported and archived; a
 * direct message is reported (its queue row shows only the copy, no link; its sheet offers only ignore and block); the
 * author of a post is blocked from the queue and the report reads `Autor bloqueado`; the moderators' `Nova denúncia`
 * bell row; two administrators resolving one report leave one winner; a second report of the same thing reads the
 * already-reported sentence; the staff viewer is offered `Denunciar` but never `Bloquear`; Membros bloqueados lists and
 * unblocks; a non-moderator and the platform host meet the not-found screen.
 *
 * **WRITTEN AND LISTED, NEVER RUN BY AN AGENT** (project rule, Igor's word, as `chat-cases.spec.ts` was): this file
 * was loaded with `playwright test --list` and typechecked, nothing more. The run is a manual ledger row of plan
 * 11-28 and happens on Igor's word; it needs the API and the web app (and the worker for the bell row) on a seeded
 * local stack.
 *
 * **Fixtures (T-11-38, T-11-39).** A THROWAWAY tenant from `direct-admin.ts` with `chat`, `social`, `notifications`,
 * `stories` and `communities` on before any session exists. Reports that are not the subject of a case are filed
 * through the REAL API so the excerpt, the author and the bell row are the API's. The spec never touches rede-demo,
 * a seeded member or the seeded threads, resets or seeds nothing, prints no token and writes no pt-BR sentence: every
 * string is read from the real catalogs. `beforeEach` clears the tenant's reports, blocks and conversations;
 * `afterAll` drops the tenant and every row it held.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson.
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 180_000 });

const _C = chatMessages.chat;
const C = chatMessages.chat;
const M = moderationMessages.moderation;
const N = notificationsMessages.notifications;
const _N = notificationsMessages.notifications;
const SA = safetyMessages.safety;
const ST = storiesMessages.stories;
const _ST = storiesMessages.stories;

const run = Date.now().toString(36);
let tenant: DirectTenant;
let stopWorker: () => Promise<void> = async () => {};

test.beforeAll(async ({ browserName }, testInfo) => {
  void browserName;
  test.setTimeout(240_000);
  tenant = await provisionDirectTenant(
    directSlug('safe', testInfo.project.name, run),
    SEED_PASSWORD,
  );
  stopWorker = await ensureWorker();
});

test.beforeEach(async () => {
  await resetSafetyState(tenant);
});

test.afterAll(async () => {
  await dropDirectTenant(tenant ?? null).catch(() => {});
  await stopWorker();
  await closeJourneyAdmin();
  await closeDirectAdmin();
  await closeSocialAdmin();
  await closeTenantFixtures();
  await closeAdmin();
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

type DeviceUse = Parameters<Browser['newContext']>[0];

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

/** A second, independent browser context signed in as `person` on the throwaway tenant's host. */
async function contextAs(browser: Browser, person: Person, use: DeviceUse) {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page, person.email, tenant.password, tenant.origin);
  return { context, page };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The one visible toast. */
const toast = (page: Page) => page.locator('[role="status"][style*="safe-top"]');
const commentRow = (page: Page, id: string) => page.locator(`article[data-comment-id="${id}"]`);
const queueRow = (page: Page, reportId: string) => page.locator(`[data-report-row="${reportId}"]`);
const dialogTitled = (page: Page, title: string) =>
  page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: title });

/** Chooses a reason in the report sheet titled `title` and sends it. */
async function fileReport(page: Page, title: string, reason: string = SA.reasons.spam) {
  const sheet = page.getByRole('dialog', { name: title, exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByText(reason, { exact: true }).click();
  await sheet.getByRole('button', { name: SA.sheet.submit, exact: true }).click();
}

/** Opens a comment's menu and returns the row, so the caller reads the rows of THAT menu. */
async function openCommentMenu(page: Page, commentId: string) {
  const row = commentRow(page, commentId);
  await expect(row).toBeVisible();
  await row.locator('[data-comment-more]').click();
  return row;
}

async function openQueue(page: Page) {
  await page.goto(`${tenant.origin}/configuracoes/denuncias`);
  await expect(page.getByRole('heading', { level: 1, name: SA.queue.title })).toBeVisible();
}

/** Opens the resolve sheet of a queue row. */
async function openResolve(page: Page, reportId: string) {
  await queueRow(page, reportId).locator('[data-report-resolve]').click();
  const sheet = page.getByRole('dialog', { name: SA.queue.resolveTitle, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** A post by the administrator with one comment by Ana: the surface of the comment cases. */
async function postWithComment(tag: string) {
  const postId = await createFeedPostAs(
    tenant.admin.email,
    tenant.slug,
    `${DIRECT_PREFIX}post ${tag} ${run}`,
  );
  const body = `${DIRECT_PREFIX}comentario ${tag} ${run}`;
  const commentId = await createFeedCommentAs(tenant.ana.email, postId, body);
  return { postId, commentId, body };
}

// ── 1. report a comment, ignore it ───────────────────────────────────────────────────────────────

test.describe('denúncia e bloqueio no navegador', () => {
  test('1. a member reports a comment from its menu; the administrator sees it in the queue and ignores it', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    const { bia, ana } = tenant;
    const { postId, commentId, body } = await postWithComment('ignorar');

    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/post/${postId}`);
    const row = await openCommentMenu(page, commentId);
    await row.locator('[data-comment-report]').click();
    await fileReport(page, SA.subject.postComment.title);
    await expect(toast(page)).toContainText(SA.sheet.success);
    await expect.poll(() => reportIdsOf(tenant, 'post_comment')).toHaveLength(1);
    const [reportId] = await reportIdsOf(tenant, 'post_comment');
    if (!reportId) throw new Error('the report was not stored');

    // The administrator, in a second context: the row carries the pills, the text, Ver conteúdo and Resolver.
    const admin = await contextAs(
      browser,
      tenant.admin,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const ap = admin.page;
      await openQueue(ap);
      const queued = queueRow(ap, reportId);
      await expect(queued).toContainText(SA.subject.postComment.pill);
      await expect(queued).toContainText(SA.queue.state.open);
      await expect(queued).toContainText(body);
      await expect(queued).toContainText(SA.queue.author.replace('{nome}', ana.name));
      await expect(queued.locator('[data-report-view]')).toBeVisible();

      const sheet = await openResolve(ap, reportId);
      await sheet.getByRole('button', { name: M.report.resolve.dismiss }).click();
      await expect(toast(ap)).toContainText(SA.queue.toasts.resolved);
      await expect(queued).toContainText(SA.queue.state.dismissed);
      await expect(queued.locator('[data-report-resolve]')).toHaveCount(0);
      expect(await reportStatusOf(reportId)).toBe('dismissed');
    } finally {
      await admin.context.close();
    }
  });

  // ── 2. report a comment, remove it ─────────────────────────────────────────────────────────────

  test('2. a reported comment is removed from the queue: it leaves the feed, the log shows the removal and the row reads Conteúdo removido', async ({
    page,
  }) => {
    const { bia, ana } = tenant;
    const { postId, commentId } = await postWithComment('remover');
    const reportId = await reportAs(tenant, bia, 'post_comment', commentId, 'offensive');

    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openQueue(page);
    const sheet = await openResolve(page, reportId);
    await sheet.getByRole('button', { name: M.report.resolve.remove }).click();
    const confirm = dialogTitled(page, SA.queue.removeDialog.title);
    await expect(confirm.getByText(SA.queue.removeDialog.body)).toBeVisible();
    await confirm.getByRole('button', { name: SA.queue.removeDialog.confirm, exact: true }).click();

    await expect(toast(page)).toContainText(SA.queue.toasts.resolved);
    await expect(queueRow(page, reportId)).toContainText(SA.queue.state.contentRemoved);
    expect(await reportStatusOf(reportId)).toBe('content_removed');
    expect(await commentIsRemoved(commentId)).toBe(true);
    expect((await moderationActionsOf(tenant))[0]).toBe('comment_removed');

    // It left the post, and the moderation log names the removal.
    await page.goto(`${tenant.origin}/post/${postId}`);
    await expect(page.locator('main')).toBeVisible();
    await expect(commentRow(page, commentId)).toHaveCount(0);
    await page.goto(`${tenant.origin}/configuracoes/moderacao`);
    const first = page.getByRole('list', { name: M.log.label }).getByRole('listitem').first();
    await expect(first).toContainText(
      M.log.rows.commentRemoved.replace('{actor}', M.log.you).replace('{target}', ana.name),
    );
  });

  // ── 3. a story ─────────────────────────────────────────────────────────────────────────────────

  test('3. a member reports a story from the viewer’s menu, which also offers Bloquear for a member author', async ({
    page,
  }) => {
    const { ana, bia } = tenant;
    await followMember(bia.email, ana.email, tenant.slug);
    const storyId = await createMemberStoryAs(
      ana.email,
      tenant.slug,
      `${DIRECT_PREFIX}story ${run}`,
    );

    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/stories/${storyId}`);
    const viewer = page.getByRole('dialog', { name: ST.viewer.dialog });
    await expect(viewer).toBeVisible();
    // Dispatched AT the element: the stories spec's dev-overlay rule.
    await viewer.getByRole('button', { name: ST.viewer.more, exact: true }).dispatchEvent('click');
    const menu = page.getByRole('dialog', { name: ST.history.menu.title });
    await expect(
      menu.getByRole('button', { name: SA.menu.block.replace('{nome}', ana.name) }),
    ).toBeVisible();
    await expect(menu.getByRole('button', { name: ST.history.menu.delete })).toHaveCount(0);
    await menu.getByRole('button', { name: SA.menu.reportStory }).dispatchEvent('click');

    await fileReport(page, SA.subject.story.title);
    await expect(toast(page)).toContainText(SA.sheet.success);
    await expect.poll(() => reportCountOf(tenant, 'story')).toBe(1);
  });

  // ── 4. a community, archived ───────────────────────────────────────────────────────────────────

  test('4. a member reports a member community; the administrator archives it: Comunidade arquivada, and it leaves the list', async ({
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
    const name = `${DIRECT_PREFIX}comunidade ${run}`;
    const communityId = await createMemberCommunityAs(ana.email, tenant.slug, name);

    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/comunidades/${communityId}`);
    await page.getByRole('button', { name: SA.menu.communityTrigger }).click();
    const menu = page.getByRole('dialog', { name: SA.menu.communityTitle });
    await expect(
      menu.getByRole('button', { name: SA.menu.block.replace('{nome}', ana.name) }),
    ).toBeVisible();
    await menu.getByRole('button', { name: SA.menu.reportCommunity }).click();
    await fileReport(page, SA.subject.community.title);
    await expect(toast(page)).toContainText(SA.sheet.success);
    await expect.poll(() => reportIdsOf(tenant, 'community')).toHaveLength(1);
    const [reportId] = await reportIdsOf(tenant, 'community');
    if (!reportId) throw new Error('the report was not stored');

    const admin = await contextAs(
      browser,
      tenant.admin,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const ap = admin.page;
      await openQueue(ap);
      await expect(queueRow(ap, reportId)).toContainText(name);
      const sheet = await openResolve(ap, reportId);
      // A community ARCHIVES: the row says so and nothing in the sheet is called "Remover".
      await expect(sheet.getByRole('button', { name: M.report.resolve.remove })).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: M.report.resolve.dismiss })).toBeVisible();
      await sheet.getByRole('button', { name: M.report.resolve.archive }).click();
      const confirm = dialogTitled(ap, M.report.archiveDialog.title);
      await expect(confirm.getByText(M.report.archiveDialog.body)).toBeVisible();
      await confirm
        .getByRole('button', { name: M.report.archiveDialog.confirm, exact: true })
        .click();

      await expect(toast(ap)).toContainText(SA.queue.toasts.resolved);
      await expect(queueRow(ap, reportId)).toContainText(SA.queue.state.communityArchived);
      expect(await communityStatusOf(communityId)).toBe('archived');
      expect((await moderationActionsOf(tenant))[0]).toBe('community_archived');
    } finally {
      await admin.context.close();
    }

    // It left the list the members read.
    await page.goto(`${tenant.origin}/comunidades`);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  // ── 5. a direct message ────────────────────────────────────────────────────────────────────────

  test('5. a direct message is reported from its menu; the queue row shows only the copy with no link and the sheet offers only ignore and block', async ({
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
    const text = `Mensagem denunciada ${run}`;
    const conversationId = await sendDirectAs(tenant, ana, bia, text);

    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/conversas/${conversationId}`);
    await page.getByRole('button', { name: C.direct.menu.trigger }).click();
    await page
      .getByRole('dialog', { name: C.direct.menu.title })
      .getByRole('button', { name: C.direct.menu.report })
      .click();
    const report = page.getByRole('dialog', {
      name: SA.subject.directMessage.title,
      exact: true,
    });
    await expect(report.locator('[data-report-privacy]')).toHaveText(
      SA.subject.directMessage.privacy,
    );
    await fileReport(page, SA.subject.directMessage.title);
    await expect(toast(page)).toContainText(SA.sheet.success);
    await expect.poll(() => reportIdsOf(tenant, 'direct_message')).toHaveLength(1);
    const [reportId] = await reportIdsOf(tenant, 'direct_message');
    if (!reportId) throw new Error('the report was not stored');

    const admin = await contextAs(
      browser,
      tenant.admin,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const ap = admin.page;
      await openQueue(ap);
      const queued = queueRow(ap, reportId);
      await expect(queued).toContainText(SA.subject.directMessage.pill);
      await expect(queued.locator('[data-report-message-text]')).toHaveText(text);
      await expect(queued.locator('[data-report-message-note]')).toHaveText(
        SA.queue.body.messageNote,
      );
      // No link to the conversation and no "Ver conteúdo": the rest of the thread is never reachable from here.
      await expect(queued.getByRole('link')).toHaveCount(0);
      await expect(queued.locator('[data-report-view]')).toHaveCount(0);

      const sheet = await openResolve(ap, reportId);
      await expect(sheet.getByRole('button', { name: M.report.resolve.dismiss })).toBeVisible();
      await expect(sheet.getByRole('button', { name: M.report.resolve.block })).toBeVisible();
      await expect(sheet.getByRole('button', { name: M.report.resolve.remove })).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: M.report.resolve.archive })).toHaveCount(0);
      await expect(sheet.locator('[data-resolve-helper]')).toHaveText(
        M.report.resolve.helperMessage,
      );
    } finally {
      await admin.context.close();
    }
  });

  // ── 6. block the author from the queue ─────────────────────────────────────────────────────────

  test('6. the administrator blocks the author of a reported post: Autor bloqueado, and the author’s membership is blocked', async ({
    page,
  }) => {
    const { ana, bia } = tenant;
    const postId = await createFeedPostAs(ana.email, tenant.slug, `${DIRECT_PREFIX}autor ${run}`);
    const reportId = await reportAs(tenant, bia, 'feed_post', postId, 'harassment');

    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openQueue(page);
    const sheet = await openResolve(page, reportId);
    await sheet.getByRole('button', { name: M.report.resolve.block }).click();

    // The Phase 8 block step, with its optional internal reason.
    const step = page.getByRole('dialog', {
      name: M.member.blockStep.title.replace('{name}', ana.name),
    });
    await expect(step).toBeVisible();
    await step.getByLabel(M.member.reason.label).fill(`Denúncia ${run}`);
    await step.locator('[data-resolve-block-confirm]').click();

    await expect(toast(page)).toContainText(SA.queue.toasts.resolved);
    await expect(queueRow(page, reportId)).toContainText(SA.queue.state.authorBlocked);
    expect(await reportStatusOf(reportId)).toBe('author_blocked');
    expect((await membershipForEmail(ana.email))?.status).toBe('blocked');
    expect((await moderationActionsOf(tenant))[0]).toBe('member_blocked');
  });

  // ── 7. the moderators' bell row ────────────────────────────────────────────────────────────────

  test('7. the administrator’s bell shows Nova denúncia and the row opens the queue', async ({
    page,
  }) => {
    const { bia } = tenant;
    const postId = await createFeedPostAs(
      tenant.admin.email,
      tenant.slug,
      `${DIRECT_PREFIX}sino ${run}`,
    );
    await reportAs(tenant, bia, 'feed_post', postId);

    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/notificacoes`);
    const sentence = N.kinds.moderationReport.replace(/<\/?b>/g, '');
    const bell = page.getByRole('link', { name: new RegExp(escapeRegExp(sentence)) }).first();
    await expect(bell).toBeVisible({ timeout: 30_000 });
    await expect(bell).toHaveAttribute('href', '/configuracoes/denuncias');
    // The row names no reporter and no content: the fixed sentence only.
    expect(await bell.innerText()).not.toContain(bia.name);
    await bell.click();
    await expect(page).toHaveURL(/\/configuracoes\/denuncias$/);
    await expect(page.locator('[data-reports-list]')).toBeVisible();
  });

  // ── 8. two administrators ──────────────────────────────────────────────────────────────────────

  test('8. two administrators resolving one report leave one winner; the other reads that it was already resolved', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    const { bia } = tenant;
    const postId = await createFeedPostAs(
      tenant.admin.email,
      tenant.slug,
      `${DIRECT_PREFIX}duas ${run}`,
    );
    const reportId = await reportAs(tenant, bia, 'feed_post', postId);

    // Both administrators have the same open row on screen.
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openQueue(page);
    const second = await contextAs(
      browser,
      tenant.admin2,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const sp = second.page;
      await openQueue(sp);
      await expect(queueRow(page, reportId).locator('[data-report-resolve]')).toBeVisible();
      await expect(queueRow(sp, reportId).locator('[data-report-resolve]')).toBeVisible();

      // The first one ignores it.
      const first = await openResolve(page, reportId);
      await first.getByRole('button', { name: M.report.resolve.dismiss }).click();
      await expect(toast(page)).toContainText(SA.queue.toasts.resolved);
      await expect(queueRow(page, reportId)).toContainText(SA.queue.state.dismissed);

      // The second, still holding the stale row, asks for the same thing and meets the 409 sentence.
      const stale = await openResolve(sp, reportId);
      await stale.getByRole('button', { name: M.report.resolve.dismiss }).click();
      await expect(toast(sp)).toContainText(SA.queue.toasts.alreadyResolved);
      await expect(queueRow(sp, reportId).locator('[data-report-resolve]')).toHaveCount(0);
      expect(await reportStatusOf(reportId)).toBe('dismissed');
    } finally {
      await second.context.close();
    }
  });

  // ── 9. already reported ────────────────────────────────────────────────────────────────────────

  test('9. reporting the same thing twice reads the already-reported sentence and stores one report', async ({
    page,
  }) => {
    const { bia } = tenant;
    const { postId, commentId } = await postWithComment('repetida');
    await reportAs(tenant, bia, 'post_comment', commentId);

    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/post/${postId}`);
    const row = await openCommentMenu(page, commentId);
    await row.locator('[data-comment-report]').click();
    await fileReport(page, SA.subject.postComment.title, SA.reasons.harassment);
    await expect(toast(page)).toContainText(SA.sheet.already);
    expect(await reportCountOf(tenant, 'post_comment')).toBe(1);
  });

  // ── 10. the staff viewer ───────────────────────────────────────────────────────────────────────

  test('10. the support user is offered Denunciar on a member’s comment but never Bloquear', async ({
    page,
  }) => {
    const { support } = tenant;
    const { postId, commentId } = await postWithComment('equipe');

    await login(page, support.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/post/${postId}`);
    const row = await openCommentMenu(page, commentId);
    await expect(row.locator('[data-comment-report]')).toBeVisible();
    await expect(row.locator('[data-comment-block]')).toHaveCount(0);
    await expect(row.locator('[data-comment-delete]')).toHaveCount(0);
  });

  // ── 11. Membros bloqueados ─────────────────────────────────────────────────────────────────────

  test('11. Membros bloqueados lists the person with one-tap Desbloquear, then the empty state; only the administrator has the Denúncias row', async ({
    page,
  }) => {
    const { ana, bia } = tenant;
    await blockAs(tenant, bia, ana);

    await login(page, bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes`);
    await expect(
      page.locator('main').getByRole('link', { name: SA.settings.blockedRow }),
    ).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: SA.settings.reportsRow }),
    ).toHaveCount(0);

    await page.goto(`${tenant.origin}/configuracoes/bloqueados`);
    const list = page.locator('main');
    await expect(list.getByText(ana.name)).toBeVisible();
    await list.getByRole('button', { name: SA.blocked.unblock }).click();
    await expect(toast(page)).toContainText(SA.block.unblocked.replace('{nome}', ana.name));
    await expect(list.getByText(SA.blocked.emptyTitle)).toBeVisible();
    expect(await memberBlockExists(tenant, bia, ana)).toBe(false);

    // The administrator's own settings carry the Denúncias row and it opens the queue.
    await page.context().clearCookies();
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes`);
    await page.locator('main').getByRole('link', { name: SA.settings.reportsRow }).click();
    await expect(page).toHaveURL(/\/configuracoes\/denuncias$/);
  });

  // ── 12. not found ──────────────────────────────────────────────────────────────────────────────

  test('12. a member who does not moderate meets the standard not-found screen on the queue', async ({
    page,
  }) => {
    await login(page, tenant.bia.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes/denuncias`);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.locator('[data-reports-list]')).toHaveCount(0);
  });

  test('13. the platform host meets the not-found screen on the queue, Membros bloqueados and Conversas', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const superEmail = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
    const superPassword = process.env.SUPER_ADMIN_PASSWORD;
    test.skip(!superPassword, 'SUPER_ADMIN_PASSWORD is required for the platform host');
    await login(page, superEmail, superPassword ?? '', hosts.platform);
    for (const path of ['/configuracoes/denuncias', '/configuracoes/bloqueados', '/conversas']) {
      await page.goto(`${hosts.platform}${path}`);
      await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    }
  });
});
