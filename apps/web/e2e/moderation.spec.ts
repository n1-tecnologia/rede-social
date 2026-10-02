import { expect, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  closeAdmin,
  createFeedCommentAs,
  createFeedPostAs,
  createStoryCommentAs,
  createStoryLike,
  deleteFeedPostsLike,
  deleteStoriesByCaptionPrefix,
  memberProfileForEmail,
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
  await deleteFeedPostsLike(CAPTION_PREFIX);
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
 * instead of wrapping. The log always holds at least the removals the cases above just wrote.
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
  // UI E09/overflow: one line that scrolls, never a wrap.
  const box = await filters.evaluate((node) => ({
    scroll: node.scrollWidth,
    client: node.clientHeight,
    overflowX: getComputedStyle(node).overflowX,
    chipTops: [...node.children].map((child) => (child as HTMLElement).offsetTop),
  }));
  expect(box.overflowX).toBe('auto');
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
