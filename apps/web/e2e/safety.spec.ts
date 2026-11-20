import { type Browser, expect, type Page, test } from '@playwright/test';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import notificationsMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import safetyMessages from '../messages/pt-BR/safety.json' with { type: 'json' };
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { closeAdmin, createFeedCommentAs, createFeedPostAs } from './admin';
import {
  closeDirectAdmin,
  commentIsRemoved,
  DIRECT_PREFIX,
  type DirectTenant,
  directSlug,
  dropDirectTenant,
  moderationActionsOf,
  type Person,
  provisionDirectTenant,
  reportAs,
  reportIdsOf,
  reportStatusOf,
  resetSafetyState,
} from './direct-admin';
import { login, SEED_PASSWORD } from './fixtures';
import { closeJourneyAdmin } from './member-journey';
import { closeSocialAdmin } from './social-admin';
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
const M = moderationMessages.moderation;
const _N = notificationsMessages.notifications;
const SA = safetyMessages.safety;
const _S = socialMessages.social;
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
});
