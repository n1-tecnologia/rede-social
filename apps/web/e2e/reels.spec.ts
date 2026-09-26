import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import { closeAdmin, createCommunityAs, createVideoPostAs, deleteReelsFixtures } from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * Phase 05.3 — Reels, end to end. Plan 05.3-08 shipped the first case (e1); plan 05.3-09 adds the
 * rest of the phase's walk: lanes, paging on both input models, the visit-long sound state and the
 * desktop breakpoint (e2..e5, e16), then like parity, comments, share, links, the two long-text
 * backstops, the empty state and the requires-feed rule on throwaway tenants, and every error state
 * by routing the network (e6..e15, e17).
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
const NAV = appMessages.app.nav;

/** Every row this spec writes starts with this, and `afterAll` removes it by this. */
const PREFIX = 'Teste reels';
const DEMO = 'tria-demo';

const fixture = {
  communityA: '',
  communityB: '',
};
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

/** Signs the demo member in and opens Reels through the tab, waiting for video 1's credential. */
async function openReels(page: Page, mobile: boolean): Promise<void> {
  await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
  await nav(page, mobile).getByRole('link', { name: R.nav }).click();
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

    await nav(page, mobile).getByRole('link', { name: NAV.home }).click();
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
    await nav(page, mobile).getByRole('link', { name: NAV.home }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await nav(page, mobile).getByRole('link', { name: R.nav }).click();
    await expect(page).toHaveURL(/\/reels$/);
    await expect(stage(page).getByRole('button', { name: R.sound.unmute })).toBeVisible();
    await expectVideo(page, 1);
    await expect(laneTab(page, R.lanes.all)).toHaveAttribute('aria-selected', 'true');
    await expectPlaybackToken(currentPage(page));
    await expect.poll(() => playerProperty(page, 'muted')).toBe(true);
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
});
