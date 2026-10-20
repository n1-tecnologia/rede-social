import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import communitiesMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  createFeedPostAs,
  createMember,
  createVideoPostAs,
  deleteReelsFixtures,
  deleteUserByEmail,
  membershipIdFor,
  setMemberDisplayName,
} from './admin';
import {
  closeFeedAdmin,
  createEmptyFeedTenant,
  deleteEmptyFeedTenant,
  type EmptyFeedTenant,
} from './feed-admin';
import { hosts, isRemote, login, SEED_PASSWORD, seededFeed, users } from './fixtures';
import {
  closeSocialAdmin,
  createMemberPhotoPostAs,
  deleteFollowsOfPrefix,
  followMember,
  markAsMemberPost,
} from './social-admin';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';

/**
 * Phase 09 - Rede social, web end to end (started by plan 09-08, extended by 09-10..09-13).
 *
 * **09-08 (Explorar).** A member of a tenant with `social` on sees the Início · Explorar chip row,
 * opens Explorar and reads the posts of the people they follow and their own; the chip row and
 * Explorar are absent for a tenant without `social`, and `?aba=explorar` there reads as Início with
 * no notice. The rows below are the walk; later tasks of the plan add the empty states, the
 * composer entry by tab, the Administrador mark by audience and Reels over Explorar.
 *
 * **Seed.** `scripts/seed.ts` runs rede-lab with `social` ON and two follow edges (Álvaro follows
 * Helena, Helena follows Marcos); rede-demo has it OFF. This spec never edits the seeded graph: the
 * posts it adds carry the `Teste social` prefix and go in `afterAll`, so the pinned feed totals other
 * specs read never move.
 *
 * **Held-out visual backstops (verified by eye, not asserted here).** The Phase 3 `processando` card
 * of a member video that is still transcoding; a member photo or video that fails to load degrading
 * to the neutral box; the loading frame of member media matching an administrator's; and, at 320px,
 * a long unbroken caption plus a long display name (the header name truncates; the DOM check for no
 * horizontal scroll is asserted below). Run them on a phone-width window against a lab member's
 * Explorar before a release.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a registered worker could answer a navigation from
 * its own cache instead of the server.
 */

test.skip(isRemote, 'local stack only (member posts are stamped through the admin connection)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy - never a literal in a spec. */
const S = socialMessages.social;
const F = feedMessages.feed;
const NAV = appMessages.app.nav;
const R = reelsMessages.reels;
const C = communitiesMessages.communities;

/** Every row this spec writes starts with this, and `afterAll` removes it by this. */
const PREFIX = 'Teste social';
const LAB = 'rede-lab';
const DEMO = 'rede-demo';
/** A per-run stamp for the throwaway tenants' hosts (the web tier and the API cache a host 60 s). */
const RUN = Date.now().toString(36);
const ALVARO = 'alvaro.pinheiro@rede-lab.local';
const HELENA = 'helena.kuster@rede-lab.local';

function isMobile(projectName: string): boolean {
  return projectName !== 'desktop-chromium';
}

/** The visible navigation: the floating BottomNav on the phone, the rail on the desktop. */
function nav(page: Page, mobile: boolean): Locator {
  return page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]');
}

/** The chip row: a tablist of links named "Áreas do início". */
function chipRow(page: Page): Locator {
  return page.getByRole('tablist', { name: S.tabs.label });
}

test.describe('09-08 Explorar - the chip row and the feed of the people you follow', () => {
  const memberPost = `${PREFIX} publicação de Helena para quem a segue.`;

  test.beforeAll(async () => {
    const id = await createFeedPostAs(HELENA, LAB, memberPost);
    await markAsMemberPost(id);
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeSocialAdmin();
    await closeAdmin();
  });

  test('a lab member opens Explorar from the chip row and reads the post of the person they follow', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);

    // Início: the chip row is there, Início is the active chip, and the member post is NOT here.
    const row = chipRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByRole('tab')).toHaveText([S.tabs.home, S.tabs.explore]);
    await expect(row.getByRole('tab', { name: S.tabs.home })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(page.getByText(memberPost)).toHaveCount(0);

    // "Encontrar pessoas": the directory, as a labelled button (one of the two controls is hidden).
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveAttribute('href', '/membros');

    // Explorar: the chip is a link, the URL carries the tab, and the followed member's post is here.
    await row.getByRole('tab', { name: S.tabs.explore }).click();
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    await expect(chipRow(page).getByRole('tab', { name: S.tabs.explore })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(memberPost)).toBeVisible();

    // Clean: the administrator's post is not in Explorar, and the BottomNav keeps Início active.
    await expect(page.getByText(seededFeed.newest)).toHaveCount(0);
    await expect(
      nav(page, mobile).getByRole('link', { name: NAV.home, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveAttribute('href', '/membros');

    // Back to Início through the first chip: the member post is gone again.
    await chipRow(page).getByRole('tab', { name: S.tabs.home }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByText(memberPost)).toHaveCount(0);
  });

  test('an unknown or repeated ?aba= reads as Início with no notice and no 404', async ({
    page,
  }) => {
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);
    for (const query of ['?aba=xyz', '?aba=explorar&aba=explorar', '?aba=']) {
      await page.goto(`${hosts.lab}/inicio${query}`);
      await expect(chipRow(page).getByRole('tab', { name: S.tabs.home })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByText(memberPost)).toHaveCount(0);
      await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    }
  });

  test('a rede-demo member (social off) has no chip row, and ?aba=explorar reads as Início', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(chipRow(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveCount(0);

    await page.goto(`${hosts.demo}/inicio?aba=explorar`);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(chipRow(page)).toHaveCount(0);
  });
});

/** The composer entry, wherever the shell put it: the phone's FAB, or the desktop header button. */
function composerEntry(page: Page): Locator {
  return page.getByRole('link', { name: F.empty.cta });
}

/**
 * A community page's compose entry (FAB on the phone, header button on desktop): its own label, one
 * href that already names the destination (comunidades.spec's locator).
 */
function communityComposer(page: Page): Locator {
  return page.locator('a[href^="/criar?comunidade="]:visible');
}

test.describe('09-08 composer entry, the Administrador mark and the three empty states (lab)', () => {
  const adminPost = `${PREFIX} publicação da administração.`;
  const memberPost = `${PREFIX} publicação de Helena, com a marca por público.`;

  test.beforeAll(async () => {
    await createFeedPostAs(users.labAdmin, LAB, adminPost);
    const id = await createFeedPostAs(HELENA, LAB, memberPost);
    await markAsMemberPost(id);
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeSocialAdmin();
    await closeAdmin();
  });

  test('a lab member is offered the composer in Explorar only; the lab admin in Início only', async ({
    page,
    context,
  }) => {
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(composerEntry(page)).toHaveCount(0);

    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    await expect(page.getByText(memberPost)).toBeVisible();
    await expect(composerEntry(page)).toHaveAttribute('href', '/criar');

    await context.clearCookies();
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(composerEntry(page)).toHaveAttribute('href', '/criar');

    // The admin is a moderator: the chip row is there, Explorar lists the member post, no composer
    // entry, and no "Encontrar pessoas" (a moderator is outside the follow graph).
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    await expect(chipRow(page)).toBeVisible();
    await expect(page.getByText(memberPost)).toBeVisible();
    await expect(composerEntry(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveCount(0);
  });

  test('the Administrador mark follows the post’s audience: the admin’s keeps it, a member’s never wears it', async ({
    page,
  }) => {
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);
    const adminCard = page.getByRole('article').filter({ hasText: adminPost });
    await expect(adminCard).toBeVisible();
    await expect(adminCard.getByRole('img', { name: F.post.adminBadge })).toHaveCount(1);

    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    const memberCard = page.getByRole('article').filter({ hasText: memberPost });
    await expect(memberCard).toBeVisible();
    await expect(memberCard.getByRole('img', { name: F.post.adminBadge })).toHaveCount(0);
  });
});

test.describe('09-08 a tenant with the social module: empty states, community and Reels', () => {
  let tenant: EmptyFeedTenant | null = null;
  let communityId = '';
  const quietEmail = (slug: string) => `silencioso@${slug}.local`;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const project = test
      .info()
      .project.name.replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();
    const slug = `social-${project}-${RUN}`.slice(0, 40);
    tenant = await createEmptyFeedTenant(slug, SEED_PASSWORD);
    // Flags before any session exists: the API and the web tier cache a tenant's modules.
    for (const key of ['reels', 'social', 'communities'])
      await setTenantModuleFlag(slug, key, true);
    await createMember(quietEmail(slug), SEED_PASSWORD, slug, 'member');
    communityId = await createCommunityAs(tenant.adminEmail, slug, `${PREFIX} comunidade`);
  });

  test.afterAll(async () => {
    if (tenant) {
      await deleteFollowsOfPrefix('membro@social-');
      await deleteFollowsOfPrefix('silencioso@social-');
      await deleteUserByEmail(quietEmail(tenant.slug));
      await deleteEmptyFeedTenant(tenant.slug);
    }
    await closeSocialAdmin();
    await closeFeedAdmin();
    await closeTenantFixtures();
    await closeAdmin();
  });

  test('a member who follows nobody meets the first empty state, then the second once they follow a silent member', async ({
    page,
  }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    const name = `Comunidade ${tenant.slug}`;
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);

    // (a) follows nobody: the title, the body with the tenant, the outline action to the directory.
    await expect(page.getByRole('heading', { name: S.explore.emptyNone.title })).toBeVisible();
    await expect(page.getByText(S.explore.emptyNone.body.replace('{tenant}', name))).toBeVisible();
    const region = page.getByRole('region', { name: F.region });
    await expect(region.getByRole('link', { name: S.explore.emptyNone.cta })).toHaveAttribute(
      'href',
      '/membros',
    );
    // UI-D-496: this empty state's action is not a composer, so the composer entry stays.
    await expect(composerEntry(page)).toHaveAttribute('href', '/criar');

    // (b) follows someone who has not posted: the server picks the other state.
    await followMember(tenant.memberEmail, quietEmail(tenant.slug), tenant.slug);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);
    await expect(page.getByRole('heading', { name: S.explore.emptyQuiet.title })).toBeVisible();
    await expect(page.getByText(S.explore.emptyQuiet.body)).toBeVisible();
    await expect(region.getByRole('link', { name: S.explore.emptyQuiet.cta })).toHaveAttribute(
      'href',
      '/membros',
    );
    await expect(page.getByRole('heading', { name: S.explore.emptyNone.title })).toHaveCount(0);

    // Início is the organization's voice: no composer entry for a member.
    await page.goto(`${tenant.origin}/inicio`);
    await expect(region).toBeVisible();
    await expect(composerEntry(page)).toHaveCount(0);
  });

  test('the moderator’s empty state has no action and no composer entry', async ({ page }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);
    await expect(page.getByRole('heading', { name: S.explore.emptyStaff.title })).toBeVisible();
    await expect(page.getByText(S.explore.emptyStaff.body)).toBeVisible();
    const region = page.getByRole('region', { name: F.region });
    await expect(region.getByRole('link')).toHaveCount(0);
    await expect(composerEntry(page)).toHaveCount(0);
  });

  test('a member meets no composer on a community page or in the empty Reels; the admin does', async ({
    page,
    context,
  }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    const stage = page.getByRole('region', { name: R.region });
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);

    await page.goto(`${tenant.origin}/comunidades/${communityId}`);
    await expect(
      page.getByRole('region', { name: C.region.replace('{community}', `${PREFIX} comunidade`) }),
    ).toBeVisible();
    await expect(communityComposer(page)).toHaveCount(0);

    await page.goto(`${tenant.origin}/reels`);
    await expect(stage.getByText(R.empty.title, { exact: true })).toBeVisible();
    await expect(stage.getByRole('link', { name: F.empty.cta })).toHaveCount(0);

    await context.clearCookies();
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/comunidades/${communityId}`);
    await expect(communityComposer(page).first()).toHaveAttribute(
      'href',
      `/criar?comunidade=${communityId}`,
    );
    await page.goto(`${tenant.origin}/reels`);
    await expect(stage.getByRole('link', { name: F.empty.cta })).toHaveAttribute('href', '/criar');
  });
});

test.describe('09-08 a tenant without the social module offers a member no composer (demo)', () => {
  const COMMUNITY_DEMO = `${PREFIX} comunidade demo`;
  let communityId = '';

  test.beforeAll(async () => {
    communityId = await createCommunityAs(users.demoAdmin, DEMO, COMMUNITY_DEMO);
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeAdmin();
  });

  test('a rede-demo member sees no composer in Início or on a community page', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(composerEntry(page)).toHaveCount(0);
    await page.goto(`${hosts.demo}/comunidades/${communityId}`);
    await expect(
      page.getByRole('region', { name: C.region.replace('{community}', COMMUNITY_DEMO) }),
    ).toBeVisible();
    await expect(communityComposer(page)).toHaveCount(0);
  });
});

/** The CURRENT page of the Reels pager: its neighbours are `inert`. */
function reelPage(page: Page): Locator {
  return page.locator('[data-reel-page]:not([inert])');
}

/** The streams stay loading forever, so the cases assert the page the host built (reels.spec). */
async function hangStreams(page: Page): Promise<void> {
  await page.route('**/stream.mux.com/**', () => undefined);
}

/** Every server action on `/inicio` posts back to `/inicio`: failing them fails a load-more. */
async function breakServerActions(page: Page): Promise<void> {
  await page.route(/\/inicio/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
      return;
    }
    await route.continue();
  });
}

/** The feed region's cards. */
function cards(page: Page): Locator {
  return page.getByRole('region', { name: F.region }).getByRole('article');
}

/** Waits for React to own the shell's scroll root, then scrolls it to the bottom (feed.spec). */
async function scrollToBottom(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('main.app-scroll');
      return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps'));
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.locator('main.app-scroll').evaluate((el) => {
    el.scrollTo(0, el.scrollHeight);
  });
}

test.describe('09-08 Reels over Explorar: a tap on a member video (D-481, UI-D-508, EXPL-06)', () => {
  const caption = `${PREFIX} vídeo de Helena visto em Explorar.`;
  let postId = '';
  let helenaProfile = '';

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    ({ postId } = await createVideoPostAs(HELENA, LAB, caption));
    await markAsMemberPost(postId);
    helenaProfile = `/membros/${await membershipIdFor(HELENA, LAB)}`;
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeSocialAdmin();
    await closeAdmin();
  });

  /** Taps the video of the member post in Explorar and returns what the way back must restore. */
  async function tapVideoInExplorar(page: Page): Promise<{ before: number; card: Locator }> {
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    const card = page.locator(`[data-post-id="${postId}"]`);
    await expect(card).toBeVisible();
    const frame = card.getByTestId('feed-video-frame');
    await frame.scrollIntoViewIfNeeded();
    await expect(card.locator('mux-player')).toBeAttached({ timeout: 20_000 });
    // Settled: the place to come back to.
    await page.waitForTimeout(500);
    const scroller = page.locator('#app-scroll');
    const before = await scroller.evaluate((node) => node.scrollTop);

    // One tap inside the frame's visible part, clear of the sound button in its corner.
    const box = await frame.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('the video frame has no box');
    const top = Math.max(box.y, 120);
    const bottom = Math.min(box.y + box.height, viewport.height - 120);
    await page.mouse.click(box.x + box.width * 0.3, (top + bottom) / 2);
    return { before, card };
  }

  test('a follower’s tap opens Reels at the followed member’s video, and the arrow returns to the same place in Explorar', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await hangStreams(page);
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);
    const { before, card } = await tapVideoInExplorar(page);

    // Reels over Explorar, on the SAME pathname and query, already on that video (the queue is "Todos").
    const overlay = page.getByRole('dialog', { name: R.region });
    await expect(overlay).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/inicio\\?aba=explorar&reel=${postId}$`));
    await expect(reelPage(page).locator('[data-reel-caption-text]')).toHaveText(caption, {
      timeout: 15_000,
    });

    // Rendered like an administrator's video: the author opens the profile, no community chip, and
    // no follow control anywhere in the overlay (D-470).
    await expect(
      reelPage(page).getByRole('link', { name: R.rail.author.replace('{name}', 'Helena Küster') }),
    ).toHaveAttribute('href', helenaProfile);
    await expect(reelPage(page).locator('[data-reel-caption] a[aria-label]')).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: /seguir/i })).toHaveCount(0);

    // The arrow: the overlay is gone, the address is Explorar's, and the card is where it was.
    await overlay.getByRole('button', { name: R.backToPost }).click();
    await expect(overlay).toHaveCount(0);
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    await expect(chipRow(page).getByRole('tab', { name: S.tabs.explore })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(card).toBeInViewport();
    const after = await page.locator('#app-scroll').evaluate((node) => node.scrollTop);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
  });

  test('a moderator’s tap opens a member video that "Todos" does not hold, through the single-post fallback', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await hangStreams(page);
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    const { card } = await tapVideoInExplorar(page);

    const overlay = page.getByRole('dialog', { name: R.region });
    await expect(overlay).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/inicio\\?aba=explorar&reel=${postId}$`));
    await expect(reelPage(page).locator('[data-reel-caption-text]')).toHaveText(caption, {
      timeout: 15_000,
    });
    await expect(overlay.getByRole('button', { name: /seguir/i })).toHaveCount(0);

    await overlay.getByRole('button', { name: R.backToPost }).click();
    await expect(overlay).toHaveCount(0);
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    await expect(card).toBeInViewport();
  });
});

test.describe('09-08 the post-card rows of Explorar: shapes, many, one, long text and a failed page', () => {
  const LONG_NAME = 'Ana Carolina Albuquerque de Vasconcellos';
  const UNBROKEN = `${PREFIX}${'x'.repeat(180)}`;
  let tenant: EmptyFeedTenant | null = null;
  let authorEmail = '';
  let soloAuthorEmail = '';
  let soloReaderEmail = '';
  const captions = {
    text: `${PREFIX} só texto, sem mídia.`,
    link: `${PREFIX} uma leitura: https://example.com/pagina-de-teste`,
    photo: `${PREFIX} uma foto da autora.`,
    video: `${PREFIX} um vídeo da autora.`,
    solo: `${PREFIX} a única publicação da pessoa que a leitora segue.`,
  };
  const fillers = [1, 2, 3, 4, 5, 6].map((n) => `${PREFIX} preenchimento ${n}.`);

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const project = test
      .info()
      .project.name.replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();
    const slug = `social-cards-${project}-${RUN}`.slice(0, 40);
    tenant = await createEmptyFeedTenant(slug, SEED_PASSWORD);
    await setTenantModuleFlag(slug, 'social', true);
    await setTenantModuleFlag(slug, 'reels', true);
    authorEmail = `autora@${slug}.local`;
    soloAuthorEmail = `unica@${slug}.local`;
    soloReaderEmail = `leitora@${slug}.local`;
    for (const email of [authorEmail, soloAuthorEmail, soloReaderEmail]) {
      await createMember(email, SEED_PASSWORD, slug, 'member');
    }
    await setMemberDisplayName(authorEmail, slug, LONG_NAME);
    await followMember(tenant.memberEmail, authorEmail, slug);
    await followMember(soloReaderEmail, soloAuthorEmail, slug);

    // Oldest first, so the newest-first page reads: unbroken, video, photo, link, text, fillers 6..2
    // on page 1 (10 cards) and filler 1 alone on page 2.
    for (const caption of fillers) {
      await markAsMemberPost(await createFeedPostAs(authorEmail, slug, caption));
    }
    await markAsMemberPost(await createFeedPostAs(authorEmail, slug, captions.text));
    await markAsMemberPost(await createFeedPostAs(authorEmail, slug, captions.link));
    await markAsMemberPost(await createMemberPhotoPostAs(authorEmail, slug, captions.photo));
    const video = await createVideoPostAs(authorEmail, slug, captions.video);
    await markAsMemberPost(video.postId);
    await markAsMemberPost(await createFeedPostAs(authorEmail, slug, UNBROKEN));
    await markAsMemberPost(await createFeedPostAs(soloAuthorEmail, slug, captions.solo));
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    if (tenant) {
      await deleteFollowsOfPrefix('membro@social-');
      await deleteFollowsOfPrefix('leitora@social-');
      for (const email of [authorEmail, soloAuthorEmail, soloReaderEmail]) {
        await deleteUserByEmail(email);
      }
      await deleteEmptyFeedTenant(tenant.slug);
    }
    await closeSocialAdmin();
    await closeFeedAdmin();
    await closeTenantFixtures();
    await closeAdmin();
  });

  test('text, photo, video and link posts of one member share the one column and the one card, newest first, with no marker', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (!tenant) throw new Error('the tenant was not provisioned');
    await hangStreams(page);
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);

    // A full first page, newest first (E02 populated); the captions are the order's witness.
    await expect(cards(page)).toHaveCount(10);
    await expect(cards(page).nth(1)).toContainText(captions.video);
    await expect(cards(page).nth(2)).toContainText(captions.photo);
    await expect(cards(page).nth(3)).toContainText(captions.link);
    await expect(cards(page).nth(4)).toContainText(captions.text);
    await expect(cards(page).nth(5)).toContainText(fillers[5] ?? '');

    // Partial (E02): every shape is the one card in the one column, and none wears a mark.
    const widths = new Set<number>();
    for (const index of [0, 1, 2, 3, 4]) {
      const card = cards(page).nth(index);
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      if (!box) throw new Error(`card ${index} has no box`);
      widths.add(Math.round(box.width));
      await expect(card.getByRole('img', { name: F.post.adminBadge })).toHaveCount(0);
      await expect(card.getByRole('link', { name: LONG_NAME }).first()).toBeVisible();
    }
    expect(widths.size).toBe(1);
    await expect(page.getByText('Você', { exact: true })).toHaveCount(0);

    // Many (E02 zero-one-many): the sentinel brings the one remaining card, with no end-of-list copy.
    await scrollToBottom(page);
    await expect(cards(page)).toHaveCount(11);
    await expect(page.getByText(/chegou ao fim|fim da lista|não há mais/i)).toHaveCount(0);
  });

  test('a long unbroken caption and a 40-character display name cause no horizontal scroll at 320px', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (!tenant) throw new Error('the tenant was not provisioned');
    await page.setViewportSize({ width: 320, height: 720 });
    await hangStreams(page);
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);

    const card = cards(page).first();
    await expect(card).toContainText(UNBROKEN.slice(0, 40));
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);
    // The header name truncates inside the 320px column instead of pushing it wider.
    const name = card.getByRole('link', { name: LONG_NAME }).first();
    const box = await name.boundingBox();
    if (!box) throw new Error('the author name has no box');
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    // The chip row fits too: two tabs and the collapsed icon control, no scrolling tablist.
    const row = chipRow(page);
    expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(page.getByTestId('inicio-find-people-icon')).toBeVisible();
  });

  test('one post is one card: no cursor, no end-of-list copy', async ({ page }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    await login(page, soloReaderEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(captions.solo);
    await scrollToBottom(page);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByText(/chegou ao fim|fim da lista|não há mais/i)).toHaveCount(0);
    await expect(page.locator('[data-feed-page-error]')).toHaveCount(0);
  });

  test('a failed next page keeps every loaded card and offers a retry at the sentinel', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (!tenant) throw new Error('the tenant was not provisioned');
    await hangStreams(page);
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/inicio?aba=explorar`);
    await expect(cards(page)).toHaveCount(10);

    await breakServerActions(page);
    await scrollToBottom(page);
    const inlineError = page.locator('[data-feed-page-error]');
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toContainText(F.errors.loadMore);
    await expect(cards(page)).toHaveCount(10);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await hangStreams(page);
    await inlineError.getByRole('button', { name: appMessages.app.error.retry }).click();
    await expect(cards(page)).toHaveCount(11);
    await expect(inlineError).toHaveCount(0);
  });
});
