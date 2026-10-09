import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  createFeedCommentAs,
  createFeedPostAs,
  createVideoPostAs,
  deleteReelsFixtures,
  membershipIdFor,
} from './admin';
import {
  closeFeedAdmin,
  createEmptyFeedTenant,
  deleteEmptyFeedTenant,
  type EmptyFeedTenant,
} from './feed-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';

/**
 * Phase 05.3 — Reels, end to end. Plan 05.3-08 shipped the first case (e1); plan 05.3-09 adds the
 * rest of the phase's walk: lanes, paging on both input models, the visit-long sound state and the
 * desktop breakpoint (e2..e5, e16), then like parity, comments, share, links, the two long-text
 * backstops, the empty state and the requires-feed rule on throwaway tenants, and every error state
 * by routing the network (e6..e15, e17). 2026-10-09 adds the fit of a video whose size was never
 * stored, which is every real upload (e18), the press-and-hold that pauses on a frame (e19), and
 * the feed's single tap that opens Reels over Início at that video, whose return arrow brings the
 * member back to the same post at the same scroll position (e20, reversing D-124).
 *
 * **What the seed provides.** `scripts/seed.ts` writes ONE ready video post per seed tenant through
 * the `fake` provider (demo: post `0d000000-0000-4000-8000-000000000004`, asset `…0000000000a4`), in
 * no community. The run needs `VIDEO_PROVIDER=fake` so the API mints the fake provider's credential.
 *
 * **What this spec adds, and takes back.** Every post, asset and community it writes carries the
 * `Teste reels` prefix and goes in `afterAll` (`deleteReelsFixtures`), so the pinned feed total and
 * the community counts the seed-pinned specs read never move (T-05.3-22). The `beforeAll` fixture,
 * per project, is: communities A and B holding one ready video each (B's newer, so the lane row
 * reads Todos, B, A — D-119), C holding only a PROCESSING video (so it never gets a lane and the
 * video never appears — REELS-03), and three tenant-wide ready videos at increasing ages.
 *
 * **The stream never answers.** `**\/stream.mux.com/**` is routed to a handler that never responds
 * (except where a case aborts it on purpose): the vendor element stays loading and never raises an
 * error, so the cases assert the page the host built rather than a decode no local stack can do.
 *
 * **Gestures are pointer events** (`mouse.down`/`move`/`up`), the stories spec's technique: the
 * pager listens to pointers, and a drag is the one thing a click cannot express. They are driven on
 * the desktop project too, where the same pager takes a mouse drag.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a registered worker could answer a navigation from
 * its own cache instead of the server.
 */

test.skip(
  isRemote,
  'local stack only (fake-provider fixtures written through the admin connection)',
);
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy — never a literal in a spec. */
const R = reelsMessages.reels;
const F = feedMessages.feed;
const NAV = appMessages.app.nav;

/** Every row this spec writes starts with this, and `afterAll` removes it by this. */
const PREFIX = 'Teste reels';
const DEMO = 'rede-demo';
/** The demo tenant's VERIFIED primary origin — what FEED-07's link is built on (feed-share.spec). */
const DEMO_SHARE_ORIGIN = 'https://rede-demo.localhost';
/**
 * A per-run stamp for the throwaway tenants' hosts (03-05's finding, phase4-smoke's technique): the
 * web tier and the API cache a host for up to 60 s, so a slug reused across runs could resolve to a
 * tenant a previous run already deleted.
 */
const RUN = Date.now().toString(36);

const fixture = {
  communityA: '',
  communityB: '',
};
/** The throwaway tenants of e12 (empty) and e13 (feed off), removed in `afterAll`. */
let emptyTenant: EmptyFeedTenant | null = null;
let noFeedTenant: EmptyFeedTenant | null = null;
const NAME_A = `${PREFIX} A comunidade`;
const NAME_B = `${PREFIX} B comunidade`;
const NAME_C = `${PREFIX} C processando`;
const CAPTION_A = `${PREFIX} A: o video da comunidade A.`;
const CAPTION_B = `${PREFIX} B: o video da comunidade B.`;

function isMobile(projectName: string): boolean {
  return projectName !== 'desktop-chromium';
}

/** The visible navigation: the floating BottomNav on the phone, the rail on the desktop. */
function nav(page: Page, mobile: boolean): Locator {
  return page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]');
}

function stage(page: Page): Locator {
  return page.getByRole('region', { name: R.region });
}

/** The CURRENT page of the pager: its neighbours are `inert` (and `aria-hidden`). */
function currentPage(page: Page): Locator {
  return page.locator('[data-reel-page]:not([inert])');
}

/** The polite live region: "Vídeo {n}, de {author}". */
function position(page: Page): Locator {
  return page.getByTestId('reels-position');
}

async function expectVideo(page: Page, n: number): Promise<void> {
  await expect(position(page)).toHaveText(new RegExp(`^Vídeo ${n},`));
}

/** Streams stay loading forever: the element never errors (see the header). */
async function hangStreams(page: Page): Promise<void> {
  await page.route('**/stream.mux.com/**', () => undefined);
}

/**
 * Signs the demo member in and opens Reels, waiting for video 1's credential. Through the tab by
 * default; `direct` navigates instead, for the 320 px backstops: there `next dev`'s issues pill sits
 * over the floating BottomNav and intercepts the tap (a dev-only overlay — e1 proves the tab).
 */
async function openReels(
  page: Page,
  mobile: boolean,
  options: { direct?: boolean } = {},
): Promise<void> {
  await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
  if (options.direct) await page.goto(`${hosts.demo}/reels`);
  else await nav(page, mobile).getByRole('link', { name: R.nav }).click();
  await expect(page).toHaveURL(/\/reels$/);
  await expect(stage(page)).toBeVisible();
  await expectVideo(page, 1);
  await expectPlaybackToken(currentPage(page));
}

/** `tokens` is a PROPERTY-only path on mux-player (media-video.spec's note). */
async function expectPlaybackToken(scope: Locator): Promise<void> {
  const player = scope.locator('mux-player').first();
  await expect(player).toBeAttached({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        player.evaluate(
          (node) => (node as unknown as { tokens?: { playback?: string } }).tokens?.playback ?? '',
        ),
      { timeout: 20_000 },
    )
    .not.toBe('');
}

/** A property of the current page's `mux-player` (`muted`, `paused`). */
async function playerProperty(page: Page, name: 'muted' | 'paused'): Promise<unknown> {
  return currentPage(page)
    .locator('mux-player')
    .first()
    .evaluate((node, key) => (node as unknown as Record<string, unknown>)[key], name);
}

/**
 * A pointer drag on the pager's stack. It starts in the upper-middle of the column — clear of the
 * lane row, the rail, the caption block and a centred error block — and moves in five steps, so
 * the pager sees a real `pointermove` sequence before the `pointerup` that decides.
 */
async function drag(page: Page, dy: number, dx = 0): Promise<void> {
  const box = await page.getByTestId('reels-stack').boundingBox();
  if (!box) throw new Error('the reels stack has no box');
  const x = box.x + box.width * (dx < 0 ? 0.7 : 0.3);
  const y = box.y + box.height * 0.32;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(x + (dx * step) / 5, y + (dy * step) / 5);
  }
  await page.mouse.up();
}

/**
 * Makes every server action on `/reels` FAIL (the lane read, the load-more and the mint alike):
 * actions POST to the page's own URL, and only POSTs are answered here.
 *
 * They are answered with a 500 rather than aborted at the network, and that is deliberate: with
 * `experimental.useOffline` on (PWA-01), Next 16.3 treats a network-level failure of an action as
 * "offline", probes `HEAD /reels?_rsc` and re-sends the action until connectivity returns, so an
 * aborted POST never rejects and the host would wait in its loading state. A 500 is the failure the
 * host's `catch` actually receives (an API that answered badly), which is what UI-D-93a/c are about.
 */
async function failServerActions(page: Page): Promise<void> {
  await page.route('**/reels', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, body: '' })
      : route.fallback(),
  );
}

/** A per-project, per-run throwaway slug (the two projects never provision the same host). */
function throwawaySlug(kind: string, projectName: string): string {
  const project = projectName.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return `reels-${kind}-${project}-${RUN}`.slice(0, 40);
}

/** The newest video of the tenant, so it heads "Todos" (and Início) for the case that made it. */
async function freshVideo(caption: string): Promise<{ postId: string; assetId: string }> {
  return createVideoPostAs(users.demoAdmin, DEMO, caption);
}

function laneTab(page: Page, name: string): Locator {
  return page.getByRole('tablist', { name: R.lanes.label }).getByRole('tab', { name });
}

test.describe('05.3 Reels', () => {
  test.beforeAll(async () => {
    await deleteReelsFixtures(PREFIX);
    // Both communities are back-dated past their videos, so the VIDEO decides the lane order.
    fixture.communityA = await createCommunityAs(users.demoAdmin, DEMO, NAME_A, {
      minutesAgo: 120,
    });
    fixture.communityB = await createCommunityAs(users.demoAdmin, DEMO, NAME_B, {
      minutesAgo: 120,
    });
    const communityC = await createCommunityAs(users.demoAdmin, DEMO, NAME_C, {
      minutesAgo: 120,
    });
    await createVideoPostAs(users.demoAdmin, DEMO, CAPTION_A, {
      communityId: fixture.communityA,
      minutesAgo: 30,
    });
    await createVideoPostAs(users.demoAdmin, DEMO, CAPTION_B, {
      communityId: fixture.communityB,
      minutesAgo: 20,
    });
    // The NEWEST video of the fixture is still processing: it must never get a lane or a page.
    await createVideoPostAs(users.demoAdmin, DEMO, `${PREFIX} C: ainda processando.`, {
      communityId: communityC,
      status: 'processing',
      minutesAgo: 10,
    });
    for (const [n, minutesAgo] of [5, 6, 7].entries()) {
      await createVideoPostAs(users.demoAdmin, DEMO, `${PREFIX} geral ${n + 1}.`, { minutesAgo });
    }
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    if (emptyTenant) await deleteEmptyFeedTenant(emptyTenant.slug);
    if (noFeedTenant) await deleteEmptyFeedTenant(noFeedTenant.slug);
    emptyTenant = null;
    noFeedTenant = null;
    await closeFeedAdmin();
    await closeTenantFixtures();
    await closeAdmin();
  });

  test('e1: the Reels tab opens the media-chrome stage on the first video', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(page.locator('header:visible')).toHaveCount(mobile ? 1 : 0);

    await nav(page, mobile).getByRole('link', { name: R.nav }).click();
    await expect(page).toHaveURL(/\/reels$/);

    await expect(stage(page)).toBeVisible();

    if (mobile) {
      // UI-D-81: no TopBar on the media tab, and the BottomNav under the dark-token scope.
      await expect(page.locator('header:visible')).toHaveCount(0);
      await expect(nav(page, mobile)).toHaveAttribute('data-theme', 'dark');
    }

    // The first page's element exists and carries a minted credential.
    await expectPlaybackToken(stage(page));

    // Every visit starts muted (D-126).
    await expect(stage(page).getByRole('button', { name: R.sound.unmute })).toBeVisible();

    // Dispatched AT the tab: under `next dev` the dev overlay's `<nextjs-portal>` sits over the
    // phone BottomNav's first tab and intercepts a coordinate click (06-01 deviation 8, 06-09).
    await nav(page, mobile).getByRole('link', { name: NAV.home }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/inicio$/);
    if (mobile) {
      await expect(page.locator('header:visible')).toHaveCount(1);
      await expect(nav(page, mobile)).not.toHaveAttribute('data-theme', 'dark');
    }
  });

  test('e2 lanes: Todos then the communities by their newest video, a tap and a swipe change lane, one lane hides the row', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    await openReels(page, mobile);

    // D-119: "Todos" first, then B (its video is newer) and A. C holds only a processing video
    // and never gets a lane (REELS-03, D-117).
    const tablist = page.getByRole('tablist', { name: R.lanes.label });
    await expect(tablist.getByRole('tab')).toHaveText([R.lanes.all, NAME_B, NAME_A]);
    await expect(tablist.getByRole('tab', { name: NAME_C })).toHaveCount(0);
    await expect(laneTab(page, R.lanes.all)).toHaveAttribute('aria-selected', 'true');

    // A tap on A shows A's video on the current page.
    await laneTab(page, NAME_A).click();
    await expect(laneTab(page, NAME_A)).toHaveAttribute('aria-selected', 'true');
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(CAPTION_A);
    await expectVideo(page, 1);

    // A horizontal drag right steps back to the neighbouring lane (B), and never pages the video.
    await drag(page, 0, 120);
    await expect(laneTab(page, NAME_B)).toHaveAttribute('aria-selected', 'true');
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(CAPTION_B);
    await expectVideo(page, 1);

    // D-120: the lab tenant has communities OFF, so one lane — no tablist, the sound button alone.
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/reels`);
    await expect(stage(page)).toBeVisible();
    await expectVideo(page, 1);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(stage(page).getByRole('button', { name: R.sound.unmute })).toBeVisible();
  });

  test('e3 touch paging: a 100 px upward drag pages, a 40 px drag does not, nothing before the first', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.skip(!mobile, 'the touch gesture model is the phone’s');
    await hangStreams(page);
    await openReels(page, mobile);

    // Below the 60 px threshold: the page springs back.
    await drag(page, -40);
    await page.waitForTimeout(500);
    await expectVideo(page, 1);

    // A downward drag at the first video has nowhere to go.
    await drag(page, 100);
    await page.waitForTimeout(500);
    await expectVideo(page, 1);

    await drag(page, -100);
    await expectVideo(page, 2);
  });

  test('e4 desktop paging: ↑ disabled at the first video, ↓, the arrow keys and one locked wheel burst each move one video', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.skip(mobile, 'the ↑/↓ buttons, keys and wheel are the desktop input model');
    await hangStreams(page);
    await openReels(page, mobile);

    const previous = page.getByRole('button', { name: R.previous });
    const next = page.getByRole('button', { name: R.next });
    await expect(previous).toBeDisabled();

    await next.click();
    await expectVideo(page, 2);
    await expect(previous).toBeEnabled();

    await page.keyboard.press('ArrowDown');
    await expectVideo(page, 3);
    await page.keyboard.press('ArrowUp');
    await expectVideo(page, 2);
    await previous.click();
    await expectVideo(page, 1);

    // E08's synthetic half: three 20 px wheel events within 100 ms cross the 50 px threshold ONCE,
    // and everything inside the 600 ms lock that follows is swallowed.
    const box = await page.getByTestId('reels-stack').boundingBox();
    if (!box) throw new Error('the reels stack has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.32);
    const burstStarted = Date.now();
    await page.mouse.wheel(0, 20);
    await page.mouse.wheel(0, 20);
    await page.mouse.wheel(0, 20);
    expect(Date.now() - burstStarted).toBeLessThan(600);
    await expectVideo(page, 2);
    await page.mouse.wheel(0, 60);
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(300);
    await expectVideo(page, 2);
  });

  test('e5 sound: muted on arrival, sound on carries to the next video, a new visit starts muted at the top of Todos', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    await openReels(page, mobile);

    await expect.poll(() => playerProperty(page, 'muted')).toBe(true);
    await stage(page).getByRole('button', { name: R.sound.unmute }).click();
    await expect(stage(page).getByRole('button', { name: R.sound.mute })).toBeVisible();

    await drag(page, -100);
    await expectVideo(page, 2);
    await expectPlaybackToken(currentPage(page));
    await expect.poll(() => playerProperty(page, 'muted')).toBe(false);

    // D-126: the sound state lives for the visit. Leaving through the tab and coming back is a new
    // visit — muted, at video 1 of "Todos" (the guard against a route kept alive, RESEARCH A8).
    // Dispatched AT the tab: under `next dev` the dev overlay's `<nextjs-portal>` sits over the
    // phone BottomNav's first tab and intercepts a coordinate click (06-01 deviation 8, 06-09).
    await nav(page, mobile).getByRole('link', { name: NAV.home }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/inicio$/);
    await nav(page, mobile).getByRole('link', { name: R.nav }).click();
    await expect(page).toHaveURL(/\/reels$/);
    await expect(stage(page).getByRole('button', { name: R.sound.unmute })).toBeVisible();
    await expectVideo(page, 1);
    await expect(laneTab(page, R.lanes.all)).toHaveAttribute('aria-selected', 'true');
    await expectPlaybackToken(currentPage(page));
    await expect.poll(() => playerProperty(page, 'muted')).toBe(true);
  });

  test('e6 like parity: a double tap likes once and never unlikes, and Início shows the same like', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    const caption = `${PREFIX} e6 curtir ${testInfo.project.name}.`;
    const { postId } = await freshVideo(caption);
    await openReels(page, mobile);
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(caption);

    const heart = currentPage(page).locator('[data-like-state]');
    await expect(heart).toHaveAttribute('data-like-state', 'unliked');

    // Every like/unlike is a server-action POST whose arguments carry the post id (a mint carries
    // asset ids only), so this counts exactly the like engine's requests for THIS post.
    let likeRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && (request.postData() ?? '').includes(postId)) {
        likeRequests += 1;
      }
    });
    const liked = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        (response.request().postData() ?? '').includes(postId),
    );

    const box = await page.getByTestId('reels-stack').boundingBox();
    if (!box) throw new Error('the reels stack has no box');
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.45;

    await page.mouse.dblclick(x, y);
    await expect(heart).toHaveAttribute('data-like-state', 'liked');
    await liked;
    expect(likeRequests).toBe(1);

    // A second double tap, after the 300 ms window closed: still liked, and NOTHING is sent (D-128).
    await page.waitForTimeout(400);
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(800);
    await expect(heart).toHaveAttribute('data-like-state', 'liked');
    expect(likeRequests).toBe(1);
    // A double tap never also pauses (UI-D-86): no play badge came up.
    await expect(page.getByTestId('reels-play-badge')).toHaveCount(0);

    // CR-01: the like survives its page leaving the ±1 window. Two videos on, page 0 holds no
    // heart at all; coming back, it is remounted from the host's per-post state and reads liked,
    // first as a neighbour, then as the current page — and a remount sends nothing.
    await drag(page, -100);
    await expectVideo(page, 2);
    await drag(page, -100);
    await expectVideo(page, 3);
    await expect(page.locator('[data-reel-page="0"] [data-like-state]')).toHaveCount(0);
    await drag(page, 100);
    await expectVideo(page, 2);
    await expect(page.locator('[data-reel-page="0"] [data-like-state]')).toHaveAttribute(
      'data-like-state',
      'liked',
    );
    await drag(page, 100);
    await expectVideo(page, 1);
    await expect(heart).toHaveAttribute('data-like-state', 'liked');
    expect(likeRequests).toBe(1);

    // Planning decision 3 of plan 01: back to Início THROUGH THE TAB, the same post reads liked.
    // Dispatched AT the tab: under `next dev` the dev overlay's `<nextjs-portal>` sits over the
    // phone BottomNav's first tab and intercepts a coordinate click (06-01 deviation 8, 06-09).
    await nav(page, mobile).getByRole('link', { name: NAV.home }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/inicio$/);
    const card = page.getByRole('article').filter({ hasText: caption });
    await expect(card.locator('[data-like-state]').first()).toHaveAttribute(
      'data-like-state',
      'liked',
    );
  });

  test('e7 comments: the threaded sheet opens over Reels, pauses the video, and closing resumes it', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    const caption = `${PREFIX} e7 comentarios ${testInfo.project.name}.`;
    const { postId } = await freshVideo(caption);
    await createFeedCommentAs(users.demoAdmin, postId, `${PREFIX} e7: um comentario raiz.`);
    await openReels(page, mobile);
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(caption);
    await expect.poll(() => playerProperty(page, 'paused')).toBe(false);

    await currentPage(page).getByRole('button', { name: F.actions.comment }).click();
    const sheet = page.getByRole('dialog', { name: F.comments.title });
    await expect(sheet).toBeVisible();
    // D-59: the feed's THREADED sheet — a root carries the reply affordance the flat variant lacks.
    await expect(sheet.getByRole('button', { name: F.comments.reply }).first()).toBeVisible();
    // UI-D-90: the open sheet is a pause source.
    await expect.poll(() => playerProperty(page, 'paused')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => playerProperty(page, 'paused')).toBe(false);
  });

  test('e8 share: the control copies the post link on the tenant primary host and toasts', async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.skip(mobile, 'the clipboard path is asserted on the desktop project (feed-share.spec)');
    test.skip(browserName !== 'chromium', 'clipboard permissions are a Chromium grant');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: hosts.demo });
    await hangStreams(page);
    const caption = `${PREFIX} e8 compartilhar.`;
    const { postId } = await freshVideo(caption);
    await openReels(page, mobile);
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(caption);

    await currentPage(page).getByRole('button', { name: F.actions.share }).click();
    await expect(page.getByText(F.share.copied, { exact: true })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // D-130 / FEED-07: the VERIFIED primary origin, not the `http://…:3000` the tab is on.
    expect(copied).toBe(`${DEMO_SHARE_ORIGIN}/post/${postId}`);
  });

  test('e9 links: the avatar and the name open the author profile, the chip opens the community, a tenant-wide video has no chip', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    const profile = `/membros/${await membershipIdFor(users.demoAdmin, DEMO)}`;
    await openReels(page, mobile);

    // "Todos" opens on a tenant-wide video (every fixture video in no community is newer than A/B).
    const block = currentPage(page).locator('[data-reel-caption]');
    const authorName = (await block.getByRole('link').first().textContent()) ?? '';
    expect(authorName).not.toBe('');
    await expect(
      currentPage(page).getByRole('link', { name: R.rail.author.replace('{name}', authorName) }),
    ).toHaveAttribute('href', profile);
    await expect(block.getByRole('link', { name: authorName, exact: true })).toHaveAttribute(
      'href',
      profile,
    );
    // D-129: no community, no chip (the chip is the one caption link with its own accessible name).
    await expect(block.locator('a[aria-label]')).toHaveCount(0);

    await laneTab(page, NAME_A).click();
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(CAPTION_A);
    const chip = currentPage(page).locator('[data-reel-caption] a[aria-label]');
    await expect(chip).toHaveText(NAME_A);
    await expect(chip).toHaveAttribute('href', `/comunidades/${fixture.communityA}`);
  });

  test('e10 long caption (E06 backstop): 2,000 characters clamp to two lines, expand within 40vh, and a link opens without toggling', async ({
    page,
    context,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.skip(!mobile, 'the 320 px phone is the long-text backstop’s viewport');
    await page.setViewportSize({ width: 320, height: 568 });
    await hangStreams(page);
    // The three links are answered locally, so opening one never leaves the machine.
    await context.route('https://example.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }),
    );

    const links = [
      'https://example.com/reels-e10-um',
      'https://example.com/reels-e10-dois',
      'https://example.com/reels-e10-tres',
    ];
    const filler = 'Uma legenda longa para medir o bloco sobre o video. '.repeat(14);
    const head = `${PREFIX} e10 legenda longa ${links[0]} `;
    const body = `${head}${filler}${links[1]} ${filler}${links[2]} ${filler}`;
    const caption = body.slice(0, 2000);
    expect(caption.length).toBe(2000);
    expect(caption).toContain(links[2]);
    await freshVideo(caption);
    await openReels(page, mobile, { direct: true });

    const text = currentPage(page).locator('[data-reel-caption-text]');
    const more = currentPage(page).getByRole('button', { name: F.caption.more });
    await expect(more).toBeVisible();
    // Collapsed is exactly two rendered lines.
    const lines = await text.evaluate(
      (node) => node.clientHeight / Number.parseFloat(getComputedStyle(node).lineHeight),
    );
    expect(Math.round(lines)).toBe(2);

    await more.click();
    const less = currentPage(page).getByRole('button', { name: R.caption.less });
    await expect(less).toBeVisible();
    const box = await text.boundingBox();
    if (!box) throw new Error('the caption has no box');
    expect(box.height).toBeLessThanOrEqual(568 * 0.4 + 1);
    // …and it scrolls inside that box rather than growing past it.
    expect(await text.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

    const opened = context.waitForEvent('page');
    await text.locator(`a[href="${links[0]}"]`).click();
    const popup = await opened;
    await popup.waitForLoadState();
    expect(popup.url()).toBe(links[0]);
    await popup.close();
    // The link navigated; the caption did not toggle under it.
    await expect(less).toBeVisible();
  });

  test('e11 long lane row (E02 backstop): six more lanes at 320 px scroll, the active lane is fully visible after a swipe, and no label runs under the sound button', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.skip(!mobile, 'the 320 px phone is the long-text backstop’s viewport');
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await hangStreams(page);

    const local = `${PREFIX} e11`;
    const long = `${local} comunidade com um nome muito longo mesmo`.padEnd(60, '.');
    expect(long.length).toBe(60);
    const names = [1, 2, 3, 4, 5].map((n) => `${local} lane ${n}`).concat(long);
    try {
      for (const [n, name] of names.entries()) {
        const id = await createCommunityAs(users.demoAdmin, DEMO, name, { minutesAgo: 120 });
        // Older than A and B, and the 60-character lane the oldest, so it is the LAST tab.
        await createVideoPostAs(users.demoAdmin, DEMO, `${local} video ${n + 1}.`, {
          communityId: id,
          minutesAgo: 40 + n,
        });
      }
      await openReels(page, mobile, { direct: true });

      const tablist = page.getByRole('tablist', { name: R.lanes.label });
      const tabs = tablist.getByRole('tab');
      await expect(tabs).toHaveCount(3 + names.length);
      await expect(tabs.last()).toHaveText(long);
      const scroller = tablist.locator('xpath=..');
      expect(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

      // The second-to-last lane by a tap, then the last one by a horizontal swipe (left = next).
      await tabs.nth(-2).click();
      await expect(tabs.nth(-2)).toHaveAttribute('aria-selected', 'true');
      await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(
        `${local} video 5.`,
      );
      await drag(page, 0, -120);
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
      await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(
        `${local} video 6.`,
      );

      // The active tab is scrolled fully into the row (a smooth scroll, so polled).
      await expect
        .poll(async () => {
          const tab = await tabs.last().boundingBox();
          const row = await scroller.boundingBox();
          if (!tab || !row) return false;
          return tab.x >= row.x - 0.5 && tab.x + tab.width <= row.x + row.width + 0.5;
        })
        .toBe(true);

      // No tab's VISIBLE part (its box clipped to the row) intersects the sound button's box.
      const sound = await stage(page).getByRole('button', { name: R.sound.unmute }).boundingBox();
      const row = await scroller.boundingBox();
      if (!sound || !row) throw new Error('the sound button or the lane row has no box');
      for (const tab of await tabs.all()) {
        const b = await tab.boundingBox();
        if (!b) continue;
        const left = Math.max(b.x, row.x);
        const right = Math.min(b.x + b.width, row.x + row.width);
        if (right <= left) continue;
        const overlaps =
          left < sound.x + sound.width &&
          right > sound.x &&
          b.y < sound.y + sound.height &&
          b.y + b.height > sound.y;
        expect(overlaps).toBe(false);
      }
    } finally {
      await deleteReelsFixtures(local);
    }
  });

  test('e12 empty state: a tenant with feed and reels on and no video shows the empty state, with the CTA for the admin only', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(120_000);
    const mobile = isMobile(testInfo.project.name);
    const slug = throwawaySlug('empty', testInfo.project.name);
    // Flags before any session exists: the API and the web tier cache a tenant's modules.
    const tenant = await createEmptyFeedTenant(slug, SEED_PASSWORD);
    emptyTenant = tenant;
    await setTenantModuleFlag(slug, 'reels', true);

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await nav(page, mobile).getByRole('link', { name: R.nav }).click();
    await expect(page).toHaveURL(/\/reels$/);
    await expect(stage(page).getByText(R.empty.title, { exact: true })).toBeVisible();
    await expect(
      stage(page).getByText(R.empty.body.replace('{tenant}', `Comunidade ${slug}`)),
    ).toBeVisible();
    await expect(stage(page).getByRole('link', { name: F.empty.cta })).toHaveCount(0);
    // UI-D-94: no sound button and no pager, so no ↑/↓ either.
    await expect(stage(page).getByRole('button', { name: R.sound.unmute })).toHaveCount(0);
    await expect(page.getByRole('button', { name: R.previous })).toHaveCount(0);
    await expect(page.getByRole('button', { name: R.next })).toHaveCount(0);

    await context.clearCookies();
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/reels`);
    await expect(stage(page).getByText(R.empty.title, { exact: true })).toBeVisible();
    await expect(stage(page).getByRole('link', { name: F.empty.cta })).toHaveAttribute(
      'href',
      '/criar',
    );
    await expect(stage(page).getByRole('button', { name: R.sound.unmute })).toHaveCount(0);
    await expect(page.getByRole('button', { name: R.next })).toHaveCount(0);
  });

  test('e13 requires feed: with reels ON and feed OFF there is no Reels tab and /reels is not found', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const mobile = isMobile(testInfo.project.name);
    const slug = throwawaySlug('nofeed', testInfo.project.name);
    const tenant = await createEmptyFeedTenant(slug, SEED_PASSWORD);
    noFeedTenant = tenant;
    // D-121, set before any session: reels stays ON, and feed OFF must still remove it.
    await setTenantModuleFlag(slug, 'reels', true);
    await setTenantModuleFlag(slug, 'feed', false);

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await expect(nav(page, mobile).getByRole('link', { name: NAV.home })).toBeVisible();
    await expect(nav(page, mobile).getByRole('link', { name: R.nav })).toHaveCount(0);

    await page.goto(`${tenant.origin}/reels`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(stage(page)).toHaveCount(0);
    await expect(page.locator('mux-player')).toHaveCount(0);
  });

  test('e14 playback error: a video that will not play shows its block, the page still swipes, and the retry mints afresh', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    // Every stream request FAILS: the element raises its error (UI-D-93b).
    await page.route('**/stream.mux.com/**', (route) => route.abort());
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await nav(page, mobile).getByRole('link', { name: R.nav }).click();
    await expect(page).toHaveURL(/\/reels$/);
    await expectVideo(page, 1);

    await expect(currentPage(page).getByText(R.errors.playback, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(currentPage(page).getByRole('button', { name: R.errors.retry })).toBeVisible();

    // REELS-08 adjacency: a broken video never traps the viewer.
    await drag(page, -100);
    await expectVideo(page, 2);
    await drag(page, 100);
    await expectVideo(page, 1);

    // The stream now hangs instead of failing, and the pill remounts the element on a fresh token.
    await page.unroute('**/stream.mux.com/**');
    await hangStreams(page);
    await currentPage(page).getByRole('button', { name: R.errors.retry }).click();
    await expect(currentPage(page).getByText(R.errors.playback, { exact: true })).toHaveCount(0);
    await expectPlaybackToken(currentPage(page));
  });

  test('e15 lane error: a lane whose first page fails shows the stage error, and its retry loads the lane', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    await openReels(page, mobile);

    await failServerActions(page);
    await laneTab(page, NAME_A).click();
    await expect(stage(page).getByText(R.errors.load, { exact: true })).toBeVisible();
    // UI-D-93a: the lane row stays usable under the error.
    await expect(laneTab(page, NAME_A)).toHaveAttribute('aria-selected', 'true');

    await page.unroute('**/reels');
    await stage(page).getByRole('button', { name: R.errors.retry }).click();
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(CAPTION_A);
    await expect(stage(page).getByText(R.errors.load, { exact: true })).toHaveCount(0);
  });

  test('e16 md boundary: the ↑/↓ buttons render beside the column at 768 px and not at 767 px', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.skip(mobile, 'a viewport-width boundary, measured once on the desktop project');
    await hangStreams(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await openReels(page, mobile);

    await expect(page.getByRole('button', { name: R.next })).toBeVisible();

    await page.setViewportSize({ width: 767, height: 900 });
    await expect(page.getByRole('button', { name: R.next })).not.toBeVisible();
    // Below md the stage is full-bleed: the column box spans the viewport's width.
    await expect
      .poll(async () => (await page.getByTestId('reels-stack').boundingBox())?.width ?? 0)
      .toBe(767);
  });

  test('e17 next-page error: a failed load-more at the prefetch point raises exactly one toast', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    test.setTimeout(120_000);
    const local = `${PREFIX} e17`;
    const laneName = `${local} D comunidade`;
    try {
      // Twelve ready videos: a first keyset page of REELS_PAGE_SIZE (10) plus a second one, so the
      // prefetch is due at video 9 (loaded − 2). D is the oldest lane, so it sits last in the row.
      const communityD = await createCommunityAs(users.demoAdmin, DEMO, laneName, {
        minutesAgo: 300,
      });
      for (let n = 0; n < 12; n += 1) {
        await createVideoPostAs(users.demoAdmin, DEMO, `${local} video ${n + 1}.`, {
          communityId: communityD,
          minutesAgo: 189 + n,
        });
      }
      await hangStreams(page);
      await openReels(page, mobile);

      await laneTab(page, laneName).click();
      await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(
        `${local} video 1.`,
      );
      for (let n = 2; n <= 7; n += 1) {
        await drag(page, -100);
        await expectVideo(page, n);
      }

      // From video 7 on, every server action fails (the mints and the load-more alike).
      await failServerActions(page);
      await drag(page, -100);
      await expectVideo(page, 8);
      await drag(page, -100);
      await expectVideo(page, 9);

      const toast = page.getByText(R.errors.loadMore, { exact: true });
      await expect(toast).toHaveCount(1);
      // The prefetch stands down after a failure: no second attempt, so no second toast.
      await page.waitForTimeout(1_000);
      await expect(toast).toHaveCount(1);
    } finally {
      await page.unroute('**/reels');
      await deleteReelsFixtures(local);
    }
  });

  test('e18 unknown size: a reel whose size was never stored fills the stage, with no black bars', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    const caption = `${PREFIX} e18 sem tamanho ${testInfo.project.name}.`;
    // What every real upload looks like to the feed: no width and no height (only images are probed).
    await createVideoPostAs(users.demoAdmin, DEMO, caption, { width: null, height: null });
    await openReels(page, mobile);
    await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(caption);

    // Reels is vertical-first: until the proportion is known the video covers the stage. Locally
    // nothing teaches it (the fake provider derives no poster and the stream never answers).
    const player = currentPage(page).locator('mux-player').first();
    await expect
      .poll(() =>
        player.evaluate((node) =>
          getComputedStyle(node).getPropertyValue('--media-object-fit').trim(),
        ),
      )
      .toBe('cover');
    await expect(currentPage(page).getByTestId('reel-video')).toHaveAttribute('data-fit', 'cover');
    await expect(currentPage(page).getByTestId('reel-backdrop')).toHaveCount(0);
  });

  test('e19 hold: pressing and holding the video pauses it, and letting go resumes it, never a tap', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await hangStreams(page);
    await openReels(page, mobile);
    await expect.poll(() => playerProperty(page, 'paused')).toBe(false);

    // The media, clear of the rail and the caption (e6's spot).
    const box = await page.getByTestId('reels-stack').boundingBox();
    if (!box) throw new Error('the reels stack has no box');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
    await page.mouse.down();
    await expect.poll(() => playerProperty(page, 'paused')).toBe(true);
    // Held, not paused by the viewer: no play badge.
    await expect(page.getByTestId('reels-play-badge')).toHaveCount(0);

    await page.mouse.up();
    await expect.poll(() => playerProperty(page, 'paused')).toBe(false);
    // The release was no tap: once the double-tap window has closed, still playing, still video 1.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('reels-play-badge')).toHaveCount(0);
    await expect.poll(() => playerProperty(page, 'paused')).toBe(false);
    await expectVideo(page, 1);
  });

  test('e20 feed tap: one tap on a feed video opens Reels at that video, and the arrow returns to the same post at the same place', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const mobile = isMobile(testInfo.project.name);
    const local = `${PREFIX} e20 ${testInfo.project.name}`;
    const caption = `${local} video tocado.`;
    try {
      // The tapped video sits past the feed's FIRST page: ten newer text posts push it out of it
      // (FEED_PAGE_SIZE is 10), so the overlay reads its Reels page from a later page's cursor.
      const { postId } = await createVideoPostAs(users.demoAdmin, DEMO, caption, { minutesAgo: 1 });
      for (let n = 1; n <= 10; n += 1) {
        await createFeedPostAs(users.demoAdmin, DEMO, `${local} texto ${n}.`);
      }
      await hangStreams(page);
      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

      // Scroll the feed (its infinite scroll brings the next pages) until the video's card exists.
      const scroller = page.locator('#app-scroll');
      const card = page.locator(`[data-post-id="${postId}"]`);
      await expect
        .poll(
          async () => {
            if ((await card.count()) > 0) return true;
            await scroller.evaluate((node) => node.scrollBy(0, node.clientHeight));
            return false;
          },
          { timeout: 60_000 },
        )
        .toBe(true);
      const frame = card.getByTestId('feed-video-frame');
      await frame.scrollIntoViewIfNeeded();
      await expect(card.locator('mux-player')).toBeAttached({ timeout: 20_000 });
      // Settled: the place to come back to.
      await page.waitForTimeout(500);
      const before = await scroller.evaluate((node) => node.scrollTop);

      // One tap inside the frame's visible part, clear of the sound button in its corner.
      const box = await frame.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) throw new Error('the video frame has no box');
      const top = Math.max(box.y, 120);
      const bottom = Math.min(box.y + box.height, viewport.height - 120);
      await page.mouse.click(box.x + box.width * 0.3, (top + bottom) / 2);

      // Reels over the feed, on the SAME pathname, already on that video.
      const overlay = page.getByRole('dialog', { name: R.region });
      await expect(overlay).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/inicio\\?reel=${postId}$`));
      await expect(currentPage(page).locator('[data-reel-caption-text]')).toHaveText(caption, {
        timeout: 15_000,
      });
      await expect(overlay.getByRole('button', { name: R.backToPost })).toBeVisible();

      // The next video, in the feed's order.
      if (mobile) await drag(page, -100);
      else await page.keyboard.press('ArrowDown');
      await expect(currentPage(page).locator('[data-reel-caption-text]')).not.toHaveText(caption);

      // The arrow: the overlay is gone, the address is the feed's, and the post is where it was.
      await overlay.getByRole('button', { name: R.backToPost }).click();
      await expect(overlay).toHaveCount(0);
      await expect(page).toHaveURL(/\/inicio$/);
      await expect(card).toBeInViewport();
      const after = await scroller.evaluate((node) => node.scrollTop);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
    } finally {
      await deleteReelsFixtures(local);
    }
  });
});
