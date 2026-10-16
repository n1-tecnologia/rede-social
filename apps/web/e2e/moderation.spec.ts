import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  createFeedCommentAs,
  createFeedPostAs,
  createStoryCommentAs,
  createStoryLike,
  createVideoPostAs,
  deleteReelsFixtures,
  deleteStoriesByCaptionPrefix,
  insertModerationLogRow,
  memberProfileForEmail,
  softDeleteCommentOutOfBand,
} from './admin';
import { login, SEED_PASSWORD, users } from './fixtures';

/** The catalog is the source of copy — never a literal in a spec. */
const M = moderationMessages.moderation;
const F = feedMessages.feed;
const S = storiesMessages.stories;

/**
 * 08-01 — the Phase 8 tracer in a real browser (MODER-01 into MODER-03, UI-D-276/277/278).
 *
 * The demo admin opens a post where the demo member wrote a root comment with two replies by another
 * member, taps the SHIPPED trash control on the member's comment (UI-D-276: same control, moderation
 * name), reads the MODERATION dialog, confirms, and sees the root and its replies leave together
 * (D-334). Then Configurações → Moderação (D-339) shows "Você removeu um comentário de {member}" with
 * the excerpt (D-337).
 *
 * The moderation log is append-only, so each run adds one row; the spec reads the FIRST row, which is
 * the one it just wrote (newest first). Its post — and with it the comments — is removed in teardown.
 */
test.use({ serviceWorkers: 'block' });

const CAPTION_PREFIX = 'e2e moderacao';
const REPLIER = 'ana.carolina.vasconcellos@rede-demo.local';

test.afterAll(async () => {
  // Posts (with their comments and media rows), their video assets, and the communities by prefix.
  await deleteReelsFixtures(CAPTION_PREFIX);
  await deleteStoriesByCaptionPrefix(CAPTION_PREFIX);
  await closeAdmin();
});

function commentRow(page: Page, commentId: string) {
  return page.locator(`article[data-comment-id="${commentId}"]`);
}

test('moderation tracer', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  const caption = `${CAPTION_PREFIX} ${run}`;
  const rootBody = `Comentario a remover ${run}`;
  const postId = await createFeedPostAs(users.demoAdmin, 'rede-demo', caption);
  const rootId = await createFeedCommentAs(users.demoMember, postId, rootBody);
  const replyOne = await createFeedCommentAs(REPLIER, postId, `Resposta um ${run}`, rootId);
  const replyTwo = await createFeedCommentAs(REPLIER, postId, `Resposta dois ${run}`, rootId);
  const member = await memberProfileForEmail(users.demoMember);
  if (!member) throw new Error('the seeded demo member has no profile');

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/post/${postId}`);

  const root = commentRow(page, rootId);
  await expect(root).toBeVisible();
  // Load the thread so the cascade is visible on screen.
  await root.locator('[data-replies-toggle]').click();
  await expect(commentRow(page, replyOne)).toBeVisible();
  await expect(commentRow(page, replyTwo)).toBeVisible();

  // UI-D-276: the shipped control, named for a moderator's act on someone else's comment.
  const control = root.locator('[data-comment-delete]');
  await expect(control).toHaveAttribute('data-comment-removal', 'moderation');
  await expect(control).toHaveAccessibleName(
    M.comment.label.replace('{author}', member.displayName),
  );
  await control.click();

  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog.getByText(M.comment.title, { exact: true })).toBeVisible();
  await expect(dialog.getByText(F.comments.delete.title, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: M.comment.confirm, exact: true }).click();

  // D-334: the root and both replies leave together; the moderation toast confirms it.
  await expect(commentRow(page, rootId)).toHaveCount(0);
  await expect(commentRow(page, replyOne)).toHaveCount(0);
  await expect(commentRow(page, replyTwo)).toHaveCount(0);
  await expect(page.getByText(M.comment.toasts.removed, { exact: true })).toBeVisible();

  // D-339: the Administração group's Moderação row opens the log.
  await page.goto('/configuracoes');
  await page
    .locator('main')
    .getByRole('link', { name: appMessages.app.settings.rows.moderation })
    .click();
  await expect(page).toHaveURL(/\/configuracoes\/moderacao$/);
  await expect(page.getByText(M.log.permanent, { exact: true })).toBeVisible();

  const first = page.getByRole('list', { name: M.log.label }).getByRole('listitem').first();
  const sentence = M.log.rows.commentRemoved
    .replace('{actor}', M.log.you)
    .replace('{target}', member.displayName);
  await expect(first).toContainText(sentence);
  await expect(first).toContainText(M.log.context.post);
  await expect(first.locator('[data-moderation-log-excerpt]')).toHaveText(
    M.log.excerpt.replace('{excerpt}', rootBody),
  );
});

/**
 * 08-03 (D-336): the story half of the tracer. The demo admin opens a story's deep link, opens the
 * SHIPPED comment sheet, taps the same trash control on the member's flat comment (named for a
 * moderator), confirms the moderation dialog, and finds the row in Moderação with the story context.
 */
test('story removal', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  const storyId = await createStoryLike('rede-demo', `${CAPTION_PREFIX} story ${run}`);
  const body = `Comentario de story a remover ${run}`;
  const commentId = await createStoryCommentAs(users.demoMember, storyId, body);
  const member = await memberProfileForEmail(users.demoMember);
  if (!member) throw new Error('the seeded demo member has no profile');

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/stories/${storyId}`);
  const viewer = page.getByRole('dialog', { name: S.viewer.dialog });
  await expect(viewer).toBeVisible();
  // Dispatched AT the element: the stories spec's dev-overlay rule.
  await viewer.getByRole('button', { name: S.viewer.comment }).dispatchEvent('click');

  const sheet = page.getByRole('dialog', { name: F.comments.title });
  await expect(sheet).toBeVisible();
  const row = commentRow(page, commentId);
  await expect(row).toBeVisible();

  const control = row.locator('[data-comment-delete]');
  await expect(control).toHaveAttribute('data-comment-removal', 'moderation');
  await expect(control).toHaveAccessibleName(
    M.comment.label.replace('{author}', member.displayName),
  );
  await control.dispatchEvent('click');

  const dialog = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: M.comment.title }));
  await expect(dialog.getByText(M.comment.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: M.comment.confirm, exact: true }).dispatchEvent('click');

  await expect(commentRow(page, commentId)).toHaveCount(0);
  await expect(page.getByText(M.comment.toasts.removed, { exact: true })).toBeVisible();

  await page.goto('/configuracoes/moderacao');
  const first = page.getByRole('list', { name: M.log.label }).getByRole('listitem').first();
  await expect(first).toContainText(
    M.log.rows.commentRemoved.replace('{actor}', M.log.you).replace('{target}', member.displayName),
  );
  await expect(first).toContainText(M.log.context.story);
  await expect(first.locator('[data-moderation-log-excerpt]')).toHaveText(
    M.log.excerpt.replace('{excerpt}', body),
  );
});

/**
 * 08-03 (D-337, UI-D-277, UI E09): the chip row is bound to `?acao=`, an unknown value reads as
 * "Tudo", the filtered list holds only that action, and the five chips scroll sideways at 320px
 * instead of wrapping, with no scrollbar drawn over them (2026-10-09). The log always holds at
 * least the removals the cases above just wrote.
 */
test('log filters', async ({ page }) => {
  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.setViewportSize({ width: 320, height: 640 });

  await page.goto('/configuracoes/moderacao?acao=nao-existe');
  const filters = page.locator('[data-moderation-log-filters]');
  const all = filters.getByRole('button', { name: M.log.filters.all, exact: true });
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  for (const key of ['comments', 'blocks', 'unblocks', 'roles'] as const) {
    await expect(
      filters.getByRole('button', { name: M.log.filters[key], exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  }
  // UI E09/overflow: one line that scrolls, never a wrap, and no scrollbar over the chips.
  const box = await filters.evaluate((node) => ({
    scroll: node.scrollWidth,
    client: node.clientHeight,
    overflowX: getComputedStyle(node).overflowX,
    scrollbarWidth: getComputedStyle(node).scrollbarWidth,
    chipTops: [...node.children].map((child) => (child as HTMLElement).offsetTop),
  }));
  expect(box.overflowX).toBe('auto');
  expect(box.scrollbarWidth).toBe('none');
  expect(new Set(box.chipTops).size).toBe(1);

  // "Comentários": the URL carries the API value and every row is a comment removal.
  await filters.getByRole('button', { name: M.log.filters.comments, exact: true }).click();
  await expect(page).toHaveURL(/\?acao=comment_removed$/);
  const list = page.getByRole('list', { name: M.log.label });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  const kinds = await list
    .locator('[data-moderation-log-row]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-moderation-log-row')));
  expect(kinds.length).toBeGreaterThan(0);
  expect(new Set(kinds)).toEqual(new Set(['comment_removed']));

  // Back to "Tudo": the bare route.
  await filters.getByRole('button', { name: M.log.filters.all, exact: true }).click();
  await expect(page).toHaveURL(/\/configuracoes\/moderacao$/);
  await expect(list.getByRole('listitem').first()).toBeVisible();
});

/* ── 08-03 Task 3: the removal finish on every comment surface (UI-D-276, UI-D-288, UI E08) ──── */

const SUPPORT = 'support@rede-demo.local';

/** The comment sheet (feed card, community card, reel): `exact`, the feed-comments rule. */
function sheet(page: Page): Locator {
  return page.getByRole('dialog', { name: F.comments.title, exact: true });
}

/** Taps the row's own trash control (never a reply's) and confirms the MODERATION dialog. */
async function removeAsModerator(page: Page, commentId: string): Promise<void> {
  const own = commentRow(page, commentId).locator(':scope > div > div [data-comment-delete]');
  await expect(own).toHaveAttribute('data-comment-removal', 'moderation');
  await own.click();
  await expect(page.getByText(M.comment.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: M.comment.confirm, exact: true }).click();
}

/**
 * Fails the NEXT server action whose body names `targetId` — the delete action carries the comment
 * id, nothing else on the page does (the feed-comments `failNextActions` rule, T-07-79). Answered
 * with a 500, never aborted (the `useOffline` re-send note in reels.spec).
 */
async function failNextAction(page: Page, targetId: string) {
  let failed = 0;
  const handler = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    if (
      failed < 1 &&
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      (request.postData() ?? '').includes(targetId)
    ) {
      failed += 1;
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
      return;
    }
    await route.fallback();
  };
  await page.route('**/*', handler);
  return { restore: () => page.unroute('**/*', handler), failedCount: () => failed };
}

test('removal on a community post', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  const communityId = await createCommunityAs(
    users.demoAdmin,
    'rede-demo',
    `${CAPTION_PREFIX} comunidade ${run}`,
  );
  const caption = `${CAPTION_PREFIX} post da comunidade ${run}`;
  const postId = await createFeedPostAs(users.demoAdmin, 'rede-demo', caption, { communityId });
  const commentId = await createFeedCommentAs(users.demoMember, postId, `Na comunidade ${run}`);

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/comunidades/${communityId}`);
  const card = page.getByRole('article').filter({ hasText: caption });
  await card.getByRole('button', { name: F.actions.comment, exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(commentRow(page, commentId)).toBeVisible();

  await removeAsModerator(page, commentId);
  await expect(commentRow(page, commentId)).toHaveCount(0);
  await expect(page.getByText(M.comment.toasts.removed, { exact: true })).toBeVisible();
  // E08/empty: the last comment gone, the shipped empty copy shows, and focus is on the composer.
  await expect(sheet(page).getByText(F.comments.empty, { exact: true })).toBeVisible();
  await expect(sheet(page).locator('[data-comment-input] input')).toBeFocused();
});

test('removal on a reel', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  // Streams stay loading forever: the element never errors (the reels spec's posture).
  await page.route('**/stream.mux.com/**', () => undefined);
  const caption = `${CAPTION_PREFIX} reel ${run}`;
  const { postId } = await createVideoPostAs(users.demoAdmin, 'rede-demo', caption);
  const commentId = await createFeedCommentAs(users.demoMember, postId, `No reel ${run}`);

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto('/reels');
  const current = page.locator('[data-reel-page]:not([inert])');
  await expect(current.locator('[data-reel-caption-text]')).toHaveText(caption);
  await current.getByRole('button', { name: F.actions.comment }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(commentRow(page, commentId)).toBeVisible();

  await removeAsModerator(page, commentId);
  await expect(commentRow(page, commentId)).toHaveCount(0);
  await expect(page.getByText(M.comment.toasts.removed, { exact: true })).toBeVisible();
});

test('removal of a root with replies beyond the first page', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  const postId = await createFeedPostAs(
    users.demoAdmin,
    'rede-demo',
    `${CAPTION_PREFIX} fio ${run}`,
  );
  const rootId = await createFeedCommentAs(users.demoMember, postId, `Raiz longa ${run}`);
  const replyIds: string[] = [];
  // 12 replies: the replies page is 10, so two of them sit beyond the first loaded page.
  for (let n = 1; n <= 12; n += 1) {
    replyIds.push(await createFeedCommentAs(REPLIER, postId, `Resposta ${n} ${run}`, rootId));
  }
  const other = await createFeedCommentAs(REPLIER, postId, `Outra raiz ${run}`);

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/post/${postId}`);
  const root = commentRow(page, rootId);
  await root.locator('[data-replies-toggle]').click();
  await expect(commentRow(page, replyIds[9] ?? '')).toBeVisible();
  await expect(commentRow(page, replyIds[11] ?? '')).toHaveCount(0);
  await page.getByRole('button', { name: F.comments.loadMoreReplies, exact: true }).click();
  await expect(commentRow(page, replyIds[11] ?? '')).toBeVisible();

  await removeAsModerator(page, rootId);
  await expect(commentRow(page, rootId)).toHaveCount(0);
  for (const id of replyIds) await expect(commentRow(page, id)).toHaveCount(0);
  // UI-D-288: focus moves to the next comment row.
  await expect(commentRow(page, other)).toBeFocused();

  // …and from a fresh load too.
  await page.reload();
  await expect(commentRow(page, other)).toBeVisible();
  await expect(commentRow(page, rootId)).toHaveCount(0);
});

test('removal failure and the 404 race', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  const postId = await createFeedPostAs(
    users.demoAdmin,
    'rede-demo',
    `${CAPTION_PREFIX} falha ${run}`,
  );
  const first = await createFeedCommentAs(users.demoMember, postId, `Vai falhar ${run}`);
  const second = await createFeedCommentAs(users.demoMember, postId, `Ja removido ${run}`);

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/post/${postId}`);
  await expect(commentRow(page, first)).toBeVisible();

  // A forced failure of exactly the delete action: the row STAYS and the failure toast fires.
  const forced = await failNextAction(page, first);
  await removeAsModerator(page, first);
  await expect(page.getByText(M.comment.errors.failed, { exact: true })).toBeVisible();
  await expect(commentRow(page, first)).toBeVisible();
  expect(forced.failedCount()).toBe(1);
  await forced.restore();

  // Someone removed it first: the API answers the bare 404, the row leaves, the race toast says so.
  await softDeleteCommentOutOfBand(second);
  await removeAsModerator(page, second);
  await expect(page.getByText(M.comment.errors.gone, { exact: true })).toBeVisible();
  await expect(commentRow(page, second)).toHaveCount(0);
  await expect(page.getByText(M.comment.toasts.removed, { exact: true })).toHaveCount(0);
});

test('no moderation control for support or a member; the own dialog keeps parity', async ({
  page,
}, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  const postId = await createFeedPostAs(
    users.demoAdmin,
    'rede-demo',
    `${CAPTION_PREFIX} papeis ${run}`,
  );
  const theirs = await createFeedCommentAs(REPLIER, postId, `De outra pessoa ${run}`);

  for (const email of [SUPPORT, users.demoMember]) {
    await page.context().clearCookies();
    await login(page, email, SEED_PASSWORD);
    await page.goto(`/post/${postId}`);
    await expect(commentRow(page, theirs)).toBeVisible();
    await expect(commentRow(page, theirs).locator('[data-comment-delete]')).toHaveCount(0);
  }

  // D-334 parity: the admin's OWN root with a reply opens the own dialog with the with-replies body.
  const mine = await createFeedCommentAs(users.demoAdmin, postId, `Meu com resposta ${run}`);
  await createFeedCommentAs(REPLIER, postId, `Resposta ao admin ${run}`, mine);
  await page.context().clearCookies();
  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/post/${postId}`);
  const own = commentRow(page, mine).locator(':scope > div > div [data-comment-delete]');
  await expect(own).toHaveAttribute('data-comment-removal', 'own');
  await expect(own).toHaveAccessibleName(F.comments.delete.label);
  await own.click();
  await expect(page.getByText(F.comments.delete.title, { exact: true })).toBeVisible();
  await expect(page.getByText(F.comments.delete.bodyWithReplies, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: F.comments.delete.cancel, exact: true }).click();
  await expect(commentRow(page, mine)).toBeVisible();
});

test('long excerpt and reason render whole at 320px', async ({ page }, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now()}`;
  // 280 characters with line breaks and an unbroken URL; a 500-character reason.
  const url = `https://exemplo.com.br/${'caminho'.repeat(9)}`;
  const head = `Trecho ${run}\nsegunda linha\n${url}\n`;
  const excerpt = `${head}${'x'.repeat(280 - head.length)}`;
  expect(excerpt.length).toBe(280);
  const reason = `Motivo longo ${run} `.padEnd(500, 'r');
  const member = await memberProfileForEmail(users.demoMember);
  if (!member) throw new Error('the seeded demo member has no profile');
  const removalId = await insertModerationLogRow('rede-demo', users.demoAdmin, users.demoMember, {
    action: 'comment_removed',
    excerpt,
  });
  const blockId = await insertModerationLogRow('rede-demo', users.demoAdmin, users.demoMember, {
    action: 'member_blocked',
    reason,
  });
  expect(removalId).not.toBe(blockId);

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/configuracoes/moderacao');
  const rows = page.getByRole('list', { name: M.log.label }).locator('[data-moderation-log-row]');
  const blocked = rows.filter({ hasText: `Motivo longo ${run}` });
  const removed = rows.filter({ hasText: `Trecho ${run}` });

  const excerptBlock = removed.locator('[data-moderation-log-excerpt]');
  // Whole, never clamped: the text is all there and the block is as tall as its content.
  expect(await excerptBlock.textContent()).toBe(M.log.excerpt.replace('{excerpt}', excerpt));
  const fits = async (locator: Locator) =>
    locator.evaluate((node) => ({
      wide: node.scrollWidth <= node.clientWidth + 1,
      tall: node.scrollHeight <= node.clientHeight + 1,
      clamp: getComputedStyle(node).webkitLineClamp,
      right: node.getBoundingClientRect().right <= window.innerWidth,
    }));
  expect(await fits(excerptBlock)).toEqual({ wide: true, tall: true, clamp: 'none', right: true });

  const reasonLine = blocked.getByText(M.log.reason.replace('{reason}', reason), { exact: true });
  await expect(reasonLine).toBeVisible();
  expect(await fits(reasonLine)).toEqual({ wide: true, tall: true, clamp: 'none', right: true });
  // The page never scrolls sideways at 320px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
