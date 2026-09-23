import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import {
  closeFeedAdmin,
  createEmptyFeedTenant,
  deleteEmptyFeedTenant,
  type EmptyFeedTenant,
  emptyFeedSlug,
} from './feed-admin';
import {
  hosts,
  login,
  SEED_PASSWORD,
  seededFeed,
  seededFeedMedia,
  seededFeedPaging,
  users,
} from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const F = feedMessages.feed;
const APP = appMessages.app;

/**
 * FEED-02 / D-55 / UI-02 (plan 04-01): the feed home slot on `/inicio`, on the phone
 * (`mobile-chromium`, an iPhone 14 preset) and on the desktop.
 *
 * Everything here runs against the SEEDED communities and writes nothing, so the shared seed stays
 * exactly as it was and the file is re-runnable in any order.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a registered Serwist worker can answer a navigation
 * from its own cache, and a spec that asserts what the SERVER rendered would then be asserting what
 * a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });

/** D-52 / PROF-02: where a post's author name must point. Named so a route change fails HERE. */
const PROFILE_PREFIX = '/membros/';

/** The feed widget's region, named by its catalog `aria-label` — a copy drift fails here. */
function feedRegion(page: Page): Locator {
  return page.getByRole('region', { name: F.region });
}

/** Every post card. `role="article"` is on the `Card` surface itself (04-01). */
function postCards(page: Page): Locator {
  return feedRegion(page).getByRole('article');
}

/** The one card carrying `caption` — the seeded captions are unique within a tenant. */
function cardWith(page: Page, caption: string): Locator {
  return postCards(page).filter({ hasText: caption });
}

/**
 * Drives the app's scroll root to the bottom. The sentinel's IntersectionObserver takes its root
 * from `ScrollContainerContext` (the shell's `main.app-scroll`), never from the document — so a
 * spec that scrolled the WINDOW would leave the sentinel permanently out of view and time out.
 */
async function scrollFeedToBottom(page: Page): Promise<void> {
  await page.locator('main.app-scroll').evaluate((el) => {
    el.scrollTo(0, el.scrollHeight);
  });
}

/**
 * A real pull-to-refresh: `usePullToRefresh` listens for touch events on the wrapper and arms only
 * while the scroll root is at the top, so the gesture is synthesised as touchstart -> two moves past
 * the 80px threshold -> touchend. Playwright's `touchscreen` API has no drag, and a `mouse` drag
 * would not produce the TouchEvents the hook binds.
 */
async function pullToRefresh(page: Page): Promise<void> {
  await page.locator('main.app-scroll').evaluate((el) => {
    el.scrollTo(0, 0);
  });
  await feedRegion(page).evaluate((section) => {
    const target = (section.querySelector('[role="article"]') ?? section) as Element;
    const fire = (type: string, clientY: number) => {
      const touch = new Touch({ identifier: 1, target, clientX: 100, clientY });
      target.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
        }),
      );
    };
    fire('touchstart', 10);
    fire('touchmove', 90);
    fire('touchmove', 170);
    fire('touchend', 170);
  });
}

/** Every server action on `/inicio` posts back to `/inicio`; this counts them. */
function countActionPosts(page: Page): () => number {
  let calls = 0;
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname === '/inicio') calls += 1;
  });
  return () => calls;
}

/** Fails every server action on `/inicio` — the only way to fail a call the Next SERVER makes. */
async function breakServerActions(page: Page): Promise<void> {
  await page.route(/\/inicio/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
      return;
    }
    await route.continue();
  });
}

/** The count segment as the catalog spells it (UI-D-21: no segment at all below one). */
function likeSegment(count: number): string {
  const template = count === 1 ? F.meta.likes.one : F.meta.likes.other;
  return template.replace('{count}', String(count));
}

/** The navigation tree visible on this project (BottomNav on the phone, the rail on desktop). */
function visibleNav(page: Page, mobile: boolean): Locator {
  return page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]');
}

test.describe('D-55 — the feed is a home slot on /inicio, and no navigation tab', () => {
  test('a tria-demo member sees the seeded posts as cards, newest first, below the welcome', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const region = feedRegion(page);
    await expect(region).toBeVisible();

    // Both seeded captions render, as plain text the member actually typed.
    await expect(region.getByText(seededFeed.newest, { exact: false })).toBeVisible();
    await expect(region.getByText(seededFeed.oldest, { exact: false })).toBeVisible();

    // Newest first: the seed writes `newest` one minute after `oldest`, so `created_at desc, id desc`
    // must place it ABOVE. Asserted as relative DOM order rather than "the first card", because the
    // local stack is shared and a sibling suite's leftover post must not make this read as a
    // regression in the ORDERING, which is the only thing this line is about.
    const cards = region.getByRole('article');
    const captions = await cards.allInnerTexts();
    const newestAt = captions.findIndex((text) => text.includes(seededFeed.newest));
    const oldestAt = captions.findIndex((text) => text.includes(seededFeed.oldest));
    expect(newestAt).toBeGreaterThanOrEqual(0);
    expect(newestAt).toBeLessThan(oldestAt);

    // D-52: the post is attributed to the PERSON, and the name links to their profile.
    const seededCard = cards.nth(newestAt);
    const author = seededCard.getByRole('link', { name: seededFeed.demoAuthor });
    await expect(author).toBeVisible();
    const href = await author.getAttribute('href');
    expect(href?.startsWith(PROFILE_PREFIX)).toBe(true);
    // …and the target is a membership id, not a user id: the profile route is membership-scoped.
    expect(href).toMatch(/^\/membros\/[0-9a-f-]{36}$/);

    // The card's accessible name carries the author, so a screen reader can tell two cards apart.
    await expect(seededCard).toHaveAttribute(
      'aria-label',
      `Publicação de ${seededFeed.demoAuthor}`,
    );

    // UI-D-19: the widget sits BELOW the welcome block, which is still the page's h1.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à TRIA Demo');
  });

  test('the feed adds NO navigation tab — the shell keeps the tabs it had', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await expect(feedRegion(page)).toBeVisible();

    const names = await visibleNav(page, mobile)
      .locator('a')
      .evaluateAll((links) =>
        links.map((a) => a.getAttribute('aria-label') ?? a.textContent?.trim() ?? ''),
      );
    // D-55 amends D-40: the feed contributes a home slot, so the BottomNav / rail budget Phases 5
    // and 6 are planning against is untouched. A "Feed" tab here is a regression, not a feature.
    expect(names.some((name) => /feed|publica/i.test(name))).toBe(false);
  });

  test('a tria-lab member never sees the tria-demo feed, even though the captions match', async ({
    page,
  }) => {
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);

    const region = feedRegion(page);
    await expect(region).toBeVisible();

    // The captions are IDENTICAL across tenants by design, so the honest assertion is about the
    // AUTHOR: the lab member sees the lab admin's posts and never the demo admin's.
    await expect(region.getByText(seededFeed.newest, { exact: false }).first()).toBeVisible();
    await expect(region.getByRole('link', { name: seededFeed.labAuthor }).first()).toBeVisible();
    await expect(region.getByRole('link', { name: seededFeed.demoAuthor })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à TRIA Lab');
  });
});

test.describe('FEED-02 / D-58 — paging the feed forward and backward', () => {
  test('the sentinel appends one page per intersection and then stops', async ({ page }) => {
    const actionPosts = countActionPosts(page);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The SERVER rendered exactly one page; everything below is the client's doing.
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize);
    // The video card mounts its own playback-token action (D-44), so the count is taken as a
    // BASELINE once the first page has settled: what this test measures is the DELTA the sentinel
    // adds, not every server action on the page.
    await page.waitForTimeout(1_000);
    const base = actionPosts();

    await scrollFeedToBottom(page);
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize * 2);
    expect(actionPosts() - base).toBe(1);

    await scrollFeedToBottom(page);
    await expect(postCards(page)).toHaveCount(seededFeedPaging.total);
    expect(actionPosts() - base).toBe(2);

    // Past the last page the sentinel renders NOTHING — no terminal spacer, and above all no third
    // request. `hasMore` is false because the API returned a null cursor, not because of a guess.
    await scrollFeedToBottom(page);
    await page.waitForTimeout(500);
    await expect(postCards(page)).toHaveCount(seededFeedPaging.total);
    expect(actionPosts() - base).toBe(2);

    // Every caption is distinct: an off-by-one keyset would duplicate a row across the boundary.
    const captions = await postCards(page).allInnerTexts();
    expect(new Set(captions).size).toBe(captions.length);
  });

  test('pull-to-refresh re-reads page 1 and replaces the list', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the gesture is mobile-only');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await scrollFeedToBottom(page);
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize * 2);

    await pullToRefresh(page);

    // Page 1 REPLACES the list rather than appending to it, and the newest post heads it again.
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize);
    await expect(postCards(page).first()).toContainText(seededFeedMedia.attachmentCaption);
    // The cards never became skeletons on the way (UI-SPEC E1/loading).
    await expect(page.getByTestId('feed-skeleton')).toHaveCount(0);
  });

  test('a failed page keeps every loaded card and offers a retry at the sentinel', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize);

    await breakServerActions(page);
    await scrollFeedToBottom(page);

    const inlineError = page.locator('[data-feed-page-error]');
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toContainText(F.errors.loadMore);
    // The 03-05 rule: a failed PAGE never discards the page that already arrived.
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await inlineError.getByRole('button', { name: APP.error.retry }).click();

    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize * 2);
    await expect(inlineError).toHaveCount(0);
  });
});

test.describe('FEED-04 — the like, by tap and by double tap', () => {
  test('a tap fills the heart and adds the count; a second tap takes both away', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardWith(page, seededFeedPaging.firstFiller);
    await expect(card).toBeVisible();
    const meta = card.locator('[data-post-meta]');
    // UI-D-21: a post nobody has touched shows its time alone — never "0 curtidas".
    await expect(meta).not.toContainText(likeSegment(0).replace('0 ', ''));

    await card.getByRole('button', { name: F.actions.like }).click();

    // Optimistic AND reconciled: the control flips at once, and the count the server answered with
    // is the one that stays on screen.
    await expect(card.getByRole('button', { name: F.actions.unlike })).toBeVisible();
    await expect(meta).toContainText(likeSegment(1));
    await page.reload();
    const reloaded = cardWith(page, seededFeedPaging.firstFiller);
    await expect(reloaded.getByRole('button', { name: F.actions.unlike })).toBeVisible();
    await expect(reloaded.locator('[data-post-meta]')).toContainText(likeSegment(1));

    // Undo, so the shared seed is exactly as it was and the file re-runs in any order.
    await reloaded.getByRole('button', { name: F.actions.unlike }).click();
    await expect(reloaded.getByRole('button', { name: F.actions.like })).toBeVisible();
    await expect(reloaded.locator('[data-post-meta]')).not.toContainText(likeSegment(1));
  });

  test('a double tap on the gallery likes exactly ONCE, not twice', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardWith(page, seededFeedMedia.galleryCaption);
    await expect(card).toBeVisible();

    // The GALLERY, explicitly: the card also carries the author's avatar, and a double tap there
    // lands outside the gesture wrapper and would make this test pass or fail for the wrong reason.
    await card.getByTestId('post-gallery-strip').dblclick();

    await expect(card.getByRole('button', { name: F.actions.unlike })).toBeVisible();
    await expect(card.locator('[data-post-meta]')).toContainText(likeSegment(1));

    // The whole point: the toggle is idempotent at the API, so the double tap produced ONE row —
    // a reload reads the database, not the optimistic value.
    await page.reload();
    const reloaded = cardWith(page, seededFeedMedia.galleryCaption);
    await expect(reloaded.locator('[data-post-meta]')).toContainText(likeSegment(1));
    await expect(reloaded.locator('[data-post-meta]')).not.toContainText(likeSegment(2));

    await reloaded.getByRole('button', { name: F.actions.unlike }).click();
    await expect(reloaded.getByRole('button', { name: F.actions.like })).toBeVisible();
  });

  test('a failed like reverts, toasts, and never removes the card', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardWith(page, seededFeedPaging.firstFiller);
    await expect(card).toBeVisible();

    await breakServerActions(page);
    await card.getByRole('button', { name: F.actions.like }).click();

    // Reverted…
    await expect(card.getByRole('button', { name: F.actions.like })).toBeVisible();
    await expect(card.locator('[data-post-meta]')).not.toContainText(likeSegment(1));
    // …surfaced as the GENERIC toast, with no inline message…
    await expect(page.getByRole('status')).toContainText(F.errors.generic);
    // …and the card is still exactly where it was (the no-optimistic-removal rule).
    await expect(card).toBeVisible();
    await expect(postCards(page)).toHaveCount(seededFeedPaging.pageSize);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.reload();
    await expect(
      cardWith(page, seededFeedPaging.firstFiller).getByRole('button', { name: F.actions.like }),
    ).toBeVisible();
  });
});

test.describe('UI-02 — the meta row and the header under pressure', () => {
  test('the edited marker follows the time, and the row stays inside a 320px viewport', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone case');
    await page.setViewportSize({ width: 320, height: 720 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const meta = cardWith(page, seededFeedPaging.editedCaption).locator('[data-post-meta]');
    await expect(meta).toContainText(F.meta.edited);
    // UI-D-15: the marker carries NO date of its own — the only digits in the row are the counts.
    await expect(meta).toContainText(likeSegment(10));

    // It wraps rather than clipping: a clipped count is a wrong count (UI-SPEC E02/overflow).
    const overflow = await meta.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a 40-character display name truncates beside the avatar', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-chromium',
      'the truncation backstop is a phone case',
    );
    await page.setViewportSize({ width: 320, height: 720 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardWith(page, seededFeedPaging.longNameCaption);
    const author = card.getByRole('link', { name: seededFeedPaging.longDisplayName });
    await expect(author).toBeVisible();

    // The NAME overflows its box and is clipped by `truncate` — the box itself never grows, which
    // is what keeps the header one line beside the avatar.
    const box = await author.evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth,
      width: el.clientWidth,
    }));
    expect(box.clipped).toBe(true);
    expect(box.width).toBeLessThan(320);
  });
});

test.describe('UI-D-20 — a community with nothing published', () => {
  let tenant: EmptyFeedTenant | null = null;

  test.beforeAll(async ({ browserName }, testInfo) => {
    test.setTimeout(120_000);
    void browserName;
    tenant = await createEmptyFeedTenant(emptyFeedSlug(testInfo.project.name), SEED_PASSWORD);
  });

  test.afterAll(async () => {
    if (tenant) await deleteEmptyFeedTenant(tenant.slug);
    await closeFeedAdmin();
  });

  test('a member reads the feed OWN empty card, not the kernel "Em breve" placeholder', async ({
    page,
  }) => {
    if (!tenant) throw new Error('fixture: no empty tenant');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);

    const region = feedRegion(page);
    await expect(region).toBeVisible();
    await expect(region).toContainText(F.empty.title);
    await expect(region).toContainText(
      F.empty.body.replace('{tenant}', `Comunidade ${tenant.slug}`),
    );
    // The kernel's "no module contributed anything" card must NOT appear: a slot IS registered.
    await expect(page.getByText(APP.home.soonTitle, { exact: true })).toHaveCount(0);
    await expect(postCards(page)).toHaveCount(0);
  });

  test('the admin of the same community reads the author variant of the copy', async ({ page }) => {
    if (!tenant) throw new Error('fixture: no empty tenant');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);

    const region = feedRegion(page);
    await expect(region).toContainText(F.empty.title);
    await expect(region).toContainText(
      F.empty.bodyAuthor.replace('{tenant}', `Comunidade ${tenant.slug}`),
    );
    await expect(region).not.toContainText(F.empty.body.slice(0, 20));
    // 04-09 closed the stub this line used to pin (WINDOWS #18): the widget renders the CTA now
    // that the host passes a `createHref`, and it points at the composer route rather than at the
    // 404 an earlier CTA would have been. `.first()` because at the desktop breakpoint the same
    // label also sits in the widget's header row (UI-D-17) — one affordance, two placements.
    const emptyCta = region.getByRole('link', { name: F.empty.cta, exact: true }).first();
    await expect(emptyCta).toBeVisible();
    await expect(emptyCta).toHaveAttribute('href', '/criar');
  });
});
