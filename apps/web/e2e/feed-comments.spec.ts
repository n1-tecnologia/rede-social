import { expect, type Locator, type Page, test } from '@playwright/test';
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import { closeAdmin, feedPostIdFor } from './admin';
import { hosts, login, SEED_PASSWORD, seededComments, seededFeedPaging, users } from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const F = feedMessages.feed;
const C = F.comments;

/**
 * FEED-05 / FEED-06 / UI-02 (plan 04-07): the comment surface, driven on a real mobile browser.
 *
 * Six things are proved here that no unit test can prove:
 *  - **D-59.** The sheet opens OVER the feed without navigating away, and the list inside it is the
 *    same one the post page renders inline.
 *  - **D-60, and this is the point of the file.** A reply carries NO reply affordance and NO toggle
 *    of its own. The database has refused a second level since 04-03; until now nothing showed that
 *    the UI refuses it too, which is the coverage item 04-03 left open (D13).
 *  - **UI-D-24.** The seeded comment whose author was removed still renders, with the fixed label
 *    instead of a name and no profile link — and the LIVE member's reply is still beneath it.
 *  - **UI-D-22.** A failed comment load says so and offers a retry, and the empty-comments copy is
 *    NOT on screen — asserted as an absence, because the whole decision is about not asserting a
 *    false fact. A failed replies load does the same WITHOUT collapsing the thread.
 *  - **D-61.** A member deletes their own comment behind the confirmation and no one else's.
 *  - **The 04-06 long-text backstop, comment-row half.** The 40-character seeded member's name
 *    wraps with the comment text at 320px instead of clipping or pushing the like control off-row.
 *
 * `serviceWorkers: 'block'` is mandatory here and not a precaution: this file intercepts requests,
 * and a registered Serwist worker can answer one from its own cache — the interception would then
 * be asserting what a previous run left behind (the 03-05 lesson).
 */
test.use({ serviceWorkers: 'block' });

/**
 * UI-02 is a PHONE contract and this file drives it on the phone: the sheet, the pinned composer
 * and the 320px reply indent are all mobile geometry. `/post/[id]`'s desktop surface is 04-08's.
 */
test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'UI-02 is a phone contract (04-08 owns desktop)',
  );
});

/** `feedPostIdFor` opens the e2e fixture connection; release it so Playwright can exit. */
test.afterAll(async () => {
  await closeAdmin();
});

/** Every write this file makes is prefixed, so a leftover from a failed run is identifiable. */
const WRITE_PREFIX = 'e2e comentario';
const unique = () => `${WRITE_PREFIX} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** The 40-character seeded member (04-06 fixture) — the comment-row half of the backstop. */
const LONG_NAME_MEMBER = 'ana.carolina.vasconcellos@rede-demo.local';

function feedRegion(page: Page): Locator {
  return page.getByRole('region', { name: F.region });
}

function cardWith(page: Page, caption: string): Locator {
  return feedRegion(page).getByRole('article').filter({ hasText: caption });
}

/**
 * The comment sheet. `exact: true` because Playwright's accessible-name match is a case-insensitive
 * SUBSTRING by default, and this app has other surfaces whose names contain "Comentários" — the
 * 04-06 lesson, applied before it costs an hour again.
 */
function sheet(page: Page): Locator {
  return page.getByRole('dialog', { name: C.title, exact: true });
}

function commentsList(page: Page): Locator {
  return sheet(page).locator('[data-comments-list]');
}

/** One comment row, found by the body text the seed (or this spec) actually wrote. */
function row(page: Page, body: string): Locator {
  return commentsList(page).locator('article[data-comment-id]').filter({ hasText: body });
}

/** Opens the sheet for the card carrying `caption` and waits for page 1 to have landed. */
async function openComments(page: Page, caption: string): Promise<void> {
  await cardWith(page, caption)
    .getByRole('button', { name: F.actions.comment, exact: true })
    .click();
  await expect(sheet(page)).toBeVisible();
  await expect(commentsList(page).locator('[data-testid="comments-skeleton"]')).toHaveCount(0);
}

/** Types `body` into the pinned composer and submits it, waiting for the row to be reconciled. */
async function submitComment(page: Page, body: string): Promise<void> {
  const input = sheet(page).locator('[data-comment-input] input');
  await input.fill(body);
  await sheet(page).locator('[data-comment-submit]').click();
  // Reconciled, not merely optimistic: the row loses `aria-busy` once the server's row replaces it.
  await expect(row(page, body)).toBeVisible();
  await expect(row(page, body)).not.toHaveAttribute('aria-busy', 'true');
}

/** Deletes a row this spec created, so the shared seed is left exactly as it was found. */
async function deleteOwnComment(page: Page, body: string): Promise<void> {
  await row(page, body).locator('[data-comment-delete]').click();
  await page.getByRole('button', { name: C.delete.confirm, exact: true }).click();
  await expect(row(page, body)).toHaveCount(0);
}

/**
 * Fails the next `count` server actions aimed at `targetId` and returns `{ restore, failedCount }`.
 *
 * A request is failed only when all three hold: it is a `POST` to `/inicio`, it carries the
 * `next-action` header (a server action, not a navigation or an RSC fetch), and its arguments
 * (`postData()`) contain `targetId`. Every other request continues untouched.
 *
 * Why the id and not ordering (07-12): every comment action is a POST to the same path, and arming
 * the helper just before the interaction was meant to make the next action the one under test. On a
 * cold dev server it was not: the video card's `fetchPlaybackTokenAction(assetId)` fired after the
 * helper was armed and consumed the forced failure (`media.playback_token_failed` with "forced
 * failure" in the log, the 07-04 deferred entry), so the comment list loaded and the case went red.
 * A comment-list action's arguments carry the post id and a replies action's carry the root comment
 * id, while a playback mint carries only an asset id (the reels e6 precedent). Action ids are
 * build-generated and unknown to a spec, so they are not matched.
 *
 * `failedCount()` lets each case prove it failed exactly the request it meant to (T-07-79): a matcher
 * that misses, or fails something else, turns the case red.
 */
async function failNextActions(
  page: Page,
  targetId: string,
  count = 1,
): Promise<{ restore: () => Promise<void>; failedCount: () => number }> {
  let failed = 0;
  const handler = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    if (
      failed < count &&
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      (request.postData() ?? '').includes(targetId)
    ) {
      failed += 1;
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
      return;
    }
    await route.continue();
  };
  await page.route(/\/inicio/, handler);
  return {
    restore: () => page.unroute(/\/inicio/, handler),
    failedCount: () => failed,
  };
}

test.describe('D-59 — the comment sheet opens over the feed', () => {
  test('tapping the comment control opens the sheet without navigating away, and lists the roots', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const before = page.url();

    await openComments(page, seededComments.firstPost);

    // OVER the feed (D-59): the URL never changed and the card is still behind the sheet.
    expect(page.url()).toBe(before);
    await expect(row(page, seededComments.firstPostRootBody)).toBeVisible();

    // The root's REPLY is not inlined — it lives behind the toggle (D-60), which is what keeps a
    // page of N roots at zero reply requests.
    await expect(row(page, seededComments.firstPostReplyBody)).toHaveCount(0);
    await expect(commentsList(page).locator('[data-replies-toggle]').first()).toBeVisible();

    // …and the empty copy is nowhere near a list that has rows.
    await expect(commentsList(page).locator('[data-comments-empty]')).toHaveCount(0);
  });

  test('a thread expands on demand, and its reply can neither be replied to nor expanded (D-60)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await openComments(page, seededComments.firstPost);

    const root = row(page, seededComments.firstPostRootBody);
    await root.locator('[data-replies-toggle]').click();

    const reply = row(page, seededComments.firstPostReplyBody);
    await expect(reply).toBeVisible();
    await expect(reply).toHaveAttribute('data-comment-kind', 'reply');

    // THE CAP, made visible. This is the assertion 04-03 could not make: the database has refused a
    // second reply level all along, and here is the UI refusing to offer one.
    await expect(reply.locator('[data-comment-reply]')).toHaveCount(0);
    await expect(reply.locator('[data-replies-toggle]')).toHaveCount(0);

    // The root still offers "Responder" — the absence above is about replies, not about the list.
    await expect(root.locator('[data-comment-reply]').first()).toBeVisible();
  });
});

test.describe('FEED-05/FEED-06 — writing, replying, liking and deleting', () => {
  test('a new comment lands at the top and the card’s meta count follows it, and delete puts both back', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const card = cardWith(page, seededComments.firstPost);
    const metaBefore = (await card.locator('[data-post-meta]').innerText()).trim();

    await openComments(page, seededComments.firstPost);
    const body = unique();
    await submitComment(page, body);

    // Roots are newest-first (D-62), so the comment just written heads the list.
    const ids = await commentsList(page)
      .locator('article[data-comment-id][data-comment-kind="root"]')
      .allInnerTexts();
    expect(ids[0]).toContain(body);

    // The card's meta count is SERVER-owned and moved by one — never recomputed on the client.
    const twoComments = F.meta.comments.other.replace('{count}', '3');
    await expect(card.locator('[data-post-meta]')).toContainText(twoComments);
    expect(metaBefore).not.toContain(twoComments);

    // D-61: the member removes their OWN comment behind the confirmation, and the count follows.
    await deleteOwnComment(page, body);
    await expect(card.locator('[data-post-meta]')).not.toContainText(twoComments);
  });

  test('the reply chip targets a root, and dismissing it makes the next submit a root comment', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await openComments(page, seededComments.firstPost);

    const root = row(page, seededComments.firstPostRootBody);
    await root.locator('[data-comment-reply]').first().click();

    // The chip names the root's author — the target is visible before a single character is typed.
    const chip = sheet(page).locator('[data-reply-chip]');
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveText('');

    const replyBody = unique();
    await submitComment(page, replyBody);
    await expect(row(page, replyBody)).toHaveAttribute('data-comment-kind', 'reply');
    await deleteOwnComment(page, replyBody);

    // E12/partial: the chip and the field are independent. With the chip dismissed, the identical
    // gesture creates a ROOT — the submit gate reads the trimmed text and nothing else.
    await root.locator('[data-comment-reply]').first().click();
    await expect(sheet(page).locator('[data-reply-chip]')).toBeVisible();
    await sheet(page).locator('[data-reply-chip-dismiss]').click();
    await expect(sheet(page).locator('[data-reply-chip]')).toHaveCount(0);

    const rootBody = unique();
    await submitComment(page, rootBody);
    await expect(row(page, rootBody)).toHaveAttribute('data-comment-kind', 'root');
    await deleteOwnComment(page, rootBody);
  });

  test('liking a comment and liking a reply take the same path, and someone else’s row offers no delete', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await openComments(page, seededComments.firstPost);

    const root = row(page, seededComments.firstPostRootBody);
    const heart = root.locator('[data-comment-like]').first();
    const wasLiked = (await heart.getAttribute('data-comment-like')) === 'liked';

    await heart.click();
    await expect(heart).toHaveAttribute('data-comment-like', wasLiked ? 'unliked' : 'liked');
    // Back to where it started, so the shared seed is untouched by this file.
    await heart.click();
    await expect(heart).toHaveAttribute('data-comment-like', wasLiked ? 'liked' : 'unliked');

    // A reply's heart is the same control on the same path (FEED-06).
    await root.locator('[data-replies-toggle]').click();
    const replyHeart = row(page, seededComments.firstPostReplyBody)
      .locator('[data-comment-like]')
      .first();
    const replyWasLiked = (await replyHeart.getAttribute('data-comment-like')) === 'liked';
    await replyHeart.click();
    await expect(replyHeart).toHaveAttribute(
      'data-comment-like',
      replyWasLiked ? 'unliked' : 'liked',
    );
    await replyHeart.click();

    // T-04-44: the reply belongs to a DIFFERENT seeded member, so no delete control is drawn on it.
    await expect(
      row(page, seededComments.firstPostReplyBody).locator('[data-comment-delete]'),
    ).toHaveCount(0);
  });
});

test.describe('UI-D-24 — a removed author keeps their thread', () => {
  test('the row survives with the fixed label and no profile link, and its reply is still listed', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await openComments(page, seededComments.removedAuthorPost);

    const orphan = row(page, seededComments.removedAuthorBody);
    await expect(orphan).toBeVisible();
    await expect(orphan).toHaveAttribute('data-comment-author-removed', 'true');
    await expect(orphan).toContainText(C.removedAuthor);
    // Plain text, not a link: there is no membership id left to point one at (T-04-45).
    await expect(orphan.getByRole('link', { name: C.removedAuthor, exact: true })).toHaveCount(0);

    // THE POSITIVE CONTROL, on the same page: a live author's root reads as a real name with a
    // profile link, so "removed" cannot be what every row renders.
    const live = row(page, seededComments.liveRootBody);
    await expect(live).toBeVisible();
    await expect(live).not.toHaveAttribute('data-comment-author-removed', 'true');
    await expect(live.getByRole('link').first()).toHaveAttribute('href', /^\/membros\//);

    // The live member's reply is STILL THERE — an inner join on `memberships` would have taken the
    // root out of the page and orphaned this row with it.
    await orphan.locator('[data-replies-toggle]').click();
    const reply = row(page, seededComments.removedAuthorReplyBody);
    await expect(reply).toBeVisible();
    await expect(reply).not.toHaveAttribute('data-comment-author-removed', 'true');
  });
});

test.describe('UI-D-22 — a failed load says so; it never claims the post has no comments', () => {
  test('a failed comment list renders the inline error and retry where the rows would be', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // `loadCommentsAction(postId)` carries the post id; nothing else the feed fires here does.
    const postId = await feedPostIdFor(seededComments.firstPost, 'rede-demo');
    const forced = await failNextActions(page, postId);
    await cardWith(page, seededComments.firstPost)
      .getByRole('button', { name: F.actions.comment, exact: true })
      .click();
    await expect(sheet(page)).toBeVisible();

    const list = commentsList(page);
    await expect(list.locator('[data-comments-error]')).toBeVisible();
    await expect(list.locator('[data-comments-error]')).toContainText(F.errors.comments);

    // THE WHOLE DECISION, as an absence: the empty copy would assert that a post with comments has
    // none, and it must not be on screen. No rows either — the error is where the rows would be.
    await expect(list.locator('[data-comments-empty]')).toHaveCount(0);
    await expect(list.locator('article[data-comment-id]')).toHaveCount(0);

    // …and the composer stays usable throughout (E10/partial).
    await expect(sheet(page).locator('[data-comment-input] input')).toBeVisible();

    // Exactly the comment-list action was failed, and nothing else (T-07-79).
    expect(forced.failedCount()).toBe(1);

    await forced.restore();
    await list.getByRole('button', { name: C.retry, exact: true }).click();
    await expect(row(page, seededComments.firstPostRootBody)).toBeVisible();
    await expect(list.locator('[data-comments-error]')).toHaveCount(0);
  });

  test('a failed replies load retries under the toggle without collapsing the thread', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await openComments(page, seededComments.firstPost);

    const root = row(page, seededComments.firstPostRootBody);
    // `loadRepliesAction(commentId)` carries the root comment id.
    const rootId = await root.getAttribute('data-comment-id');
    expect(rootId).not.toBeNull();
    const forced = await failNextActions(page, rootId as string);
    await root.locator('[data-replies-toggle]').click();

    const failed = commentsList(page).locator('[data-replies-error]');
    await expect(failed).toBeVisible();
    await expect(failed).toContainText(F.errors.replies);
    // NOT collapsed: the toggle still reads as expanded, so the retry the member needs is reachable.
    await expect(root.locator('[data-replies-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(commentsList(page).locator('[data-comments-empty]')).toHaveCount(0);

    // Exactly the replies action was failed, and nothing else (T-07-79).
    expect(forced.failedCount()).toBe(1);

    await forced.restore();
    await failed.getByRole('button', { name: C.retry, exact: true }).click();
    await expect(row(page, seededComments.firstPostReplyBody)).toBeVisible();
  });
});

test.describe('E11/long-text — the 40-character member in a comment row at 320px', () => {
  test('the long display name wraps with the comment text instead of clipping the row', async ({
    page,
  }) => {
    // The narrowest viewport the UI-SPEC commits to. The post-header half of this backstop is
    // 04-06's; this is the comment-row half, against the SAME seeded member.
    await page.setViewportSize({ width: 320, height: 720 });
    await login(page, LONG_NAME_MEMBER, SEED_PASSWORD, hosts.demo);
    await openComments(page, seededComments.firstPost);

    const body = unique();
    await submitComment(page, body);

    const written = row(page, body);
    await expect(written).toContainText(seededFeedPaging.longDisplayName);

    // The row keeps its geometry: the avatar is not clipped and the like control is still ON the
    // row rather than pushed past its right edge.
    const rowBox = await written.boundingBox();
    const avatarBox = await written.locator('span[role="img"]').first().boundingBox();
    const likeBox = await written.locator('[data-comment-like]').first().boundingBox();
    expect(rowBox).not.toBeNull();
    expect(avatarBox).not.toBeNull();
    expect(likeBox).not.toBeNull();
    const bounds = rowBox as NonNullable<typeof rowBox>;
    const avatar = avatarBox as NonNullable<typeof avatarBox>;
    const like = likeBox as NonNullable<typeof likeBox>;
    expect(avatar.width).toBeGreaterThanOrEqual(28);
    expect(like.x + like.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    // Wrapped, not truncated to one line: the name plus the body is taller than a single 14px line.
    expect(bounds.height).toBeGreaterThan(40);

    await deleteOwnComment(page, body);
  });
});
