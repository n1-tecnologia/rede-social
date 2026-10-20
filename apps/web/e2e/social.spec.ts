import { fileURLToPath } from 'node:url';
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
  markVideoReady,
  membershipIdFor,
  newestVideoAsset,
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
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  MEMBERS_TENANT_SIZE,
  type MembersTenant,
  membersTenantSlug,
  sweepMembersTenants,
} from './members-admin';
import {
  closeSocialAdmin,
  createMemberPhotoPostAs,
  deleteFollowsOfPrefix,
  deleteMediaAssetsOfTenant,
  followerCountOf,
  followMember,
  markAsMemberPost,
  markVideoTooLong,
  notificationCountFor,
  setSocialSettings,
  unfollowMember,
  visibilityOfPostWithCaption,
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

/** The composer's own controls, by the catalog (never a literal). */
const COMPOSER = F.composer;

function captionField(page: Page): Locator {
  return page.getByLabel(COMPOSER.captionLabel);
}

test.describe('09-09 the member composer: a member publishes from Explorar and lands on top of it', () => {
  const memberCaption = `${PREFIX} publicação de Helena feita no compositor.`;
  const adminCaption = `${PREFIX} publicação da administração feita no compositor.`;

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeSocialAdmin();
    await closeAdmin();
  });

  test('Helena opens the composer from the Explorar entry, sees the audience line and no PDF or community row, publishes and lands on top of Explorar', async ({
    page,
  }) => {
    await login(page, HELENA, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    await composerEntry(page).click();
    await expect(page).toHaveURL(/\/criar$/);

    // UI-D-504 (a-c): the member variant. The controls the API forbids are ABSENT, not disabled.
    await expect(captionField(page)).toHaveAttribute('placeholder', COMPOSER.placeholderMember);
    await expect(page.getByText(COMPOSER.audience)).toBeVisible();
    await expect(page.getByText(COMPOSER.addFile)).toHaveCount(0);
    await expect(page.getByTestId('composer-add-file')).toHaveCount(0);
    await expect(page.locator('[data-composer-destination]')).toHaveCount(0);
    await expect(page.getByTestId('composer-add-photos')).toBeAttached();
    // E08 empty: nothing typed, nothing attached - Publicar waits.
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeDisabled();

    await captionField(page).fill(memberCaption);
    await page.getByRole('button', { name: COMPOSER.publish, exact: true }).click();

    // UI-D-495: Explorar, the new card on top, the created toast.
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    await expect(page.getByText(F.toasts.created)).toBeVisible();
    await expect(cards(page).first()).toContainText(memberCaption);
    await expect(chipRow(page).getByRole('tab', { name: S.tabs.explore })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The API stamped the audience: the member's post is for followers (D-473), whatever the screen did.
    expect(await visibilityOfPostWithCaption(memberCaption)).toBe('followers');
  });

  test('the lab administrator composes from Início with the full composer and keeps landing on the post', async ({
    page,
  }) => {
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await composerEntry(page).click();
    await expect(page).toHaveURL(/\/criar$/);

    // The administrator's composer is the shipped one: the attachment row and the destination row.
    await expect(page.getByTestId('composer-add-file')).toBeVisible();
    await expect(page.locator('[data-composer-destination]')).toHaveCount(1);
    await expect(page.getByText(COMPOSER.audience)).toHaveCount(0);

    await captionField(page).fill(adminCaption);
    await page.getByRole('button', { name: COMPOSER.publish, exact: true }).click();
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/);
    await expect(page.getByText(F.toasts.created)).toBeVisible();
    expect(await visibilityOfPostWithCaption(adminCaption)).toBe('tenant');
  });
});

/** 186 KiB of real H.264, the Phase 3 fixture (`fixtures/README.md`). */
const SAMPLE_MP4 = fileURLToPath(new URL('./fixtures/sample.mp4', import.meta.url));
const MIB = 1024 * 1024;
const FEED_CAPTION_MAX = 2200;

/** The tenant's limits: 4 photos of 1 MB, video up to 45 s and 20 MB (on or off per scenario). */
function memberLimits(videoEnabled: boolean) {
  return {
    media: {
      photoMaxBytes: 1 * MIB,
      photosPerPost: 4,
      video: { enabled: videoEnabled, maxDurationSeconds: 45, maxBytes: 20 * MIB },
    },
  };
}

/** A throwaway tenant with `social` on and its member limits written BEFORE any request reaches it. */
async function provisionLimitsTenant(tag: string, videoEnabled: boolean): Promise<EmptyFeedTenant> {
  const project = test
    .info()
    .project.name.replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
  const slug = `social-comp-${tag}-${project}-${RUN}`.slice(0, 40);
  const tenant = await createEmptyFeedTenant(slug, SEED_PASSWORD);
  await setTenantModuleFlag(slug, 'social', true);
  await setSocialSettings(slug, memberLimits(videoEnabled));
  return tenant;
}

async function dropLimitsTenant(tenant: EmptyFeedTenant | null): Promise<void> {
  // Posts first (they name the assets), then the assets nothing names, then the tenant.
  await deleteReelsFixtures(PREFIX);
  if (tenant) {
    await deleteFollowsOfPrefix('membro@social-comp');
    await deleteMediaAssetsOfTenant(tenant.slug);
    await deleteEmptyFeedTenant(tenant.slug);
  }
  await closeSocialAdmin();
  await closeFeedAdmin();
  await closeTenantFixtures();
  await closeAdmin();
}

/** Opens `/criar` as the tenant's member and waits until React owns the form (typing flips Publicar). */
async function openMemberComposer(page: Page, tenant: EmptyFeedTenant): Promise<void> {
  await login(page, tenant.memberEmail, tenant.password, tenant.origin);
  await page.goto(`${tenant.origin}/criar`);
  const caption = captionField(page);
  await expect(caption).toBeVisible();
  await caption.press('x');
  await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeEnabled();
  await caption.press('Backspace');
  await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeDisabled();
}

test.describe('09-09 the member composer under the tenant limits (video off)', () => {
  let tenant: EmptyFeedTenant | null = null;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    tenant = await provisionLimitsTenant('a', false);
  });
  test.afterAll(async () => dropLimitsTenant(tenant));

  test('the photos row promises the tenant limits, a 2 MB photo is refused at pick time and there is no video control (SOCIAL-05)', async ({
    page,
  }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    await openMemberComposer(page, tenant);

    // (d) the helper is the tenant's numbers, interpolated from the catalog.
    await expect(
      page.getByText(COMPOSER.memberPhotoHelper.replace('{count}', '4').replace('{size}', '1 MB')),
    ).toBeVisible();
    // (e) video off: the control is ABSENT from the DOM, in every form it takes.
    await expect(page.getByTestId('composer-add-video')).toHaveCount(0);
    await expect(page.getByLabel(COMPOSER.addVideo)).toHaveCount(0);
    await expect(page.locator('#composer-video-dropzone')).toHaveCount(0);
    await expect(page.getByText(/^Vídeos de até/)).toHaveCount(0);

    // (h) a 2 MB photo against the 1 MB cap: the inline line, no thumbnail, nothing to publish.
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: 'grande.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(2 * MIB),
    });
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: F.errors.memberPhotoSize.replace('{size}', '1 MB') }),
    ).toBeVisible();
    await expect(page.locator('[data-composer-thumbs] li')).toHaveCount(0);
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeDisabled();
  });

  test('a caption at the feed limit publishes and shows truncated with "… mais" in Explorar', async ({
    page,
  }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    await openMemberComposer(page, tenant);

    const tail = 'FIMDALEGENDA';
    const caption =
      `${PREFIX} longa ${'texto '.repeat(400)}`.slice(0, FEED_CAPTION_MAX - tail.length) + tail;
    expect(caption.length).toBe(FEED_CAPTION_MAX);
    await captionField(page).fill(caption);
    await page.getByRole('button', { name: COMPOSER.publish, exact: true }).click();

    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    const card = cards(page).first();
    await expect(card).toContainText(PREFIX);
    await expect(card).toContainText(F.caption.more);
    await expect(card).not.toContainText(tail);
  });
});

test.describe('09-09 the member composer under the tenant limits (video on)', () => {
  let tenant: EmptyFeedTenant | null = null;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    tenant = await provisionLimitsTenant('b', true);
  });
  test.afterAll(async () => dropLimitsTenant(tenant));

  /** Picks the sample video through the phone row's file chooser. */
  async function pickVideo(page: Page): Promise<string> {
    const opening = page.waitForEvent('filechooser');
    await page.getByTestId('composer-add-video').click();
    await (await opening).setFiles(SAMPLE_MP4);
    await expect(page.locator('[data-composer-video]')).toBeVisible({ timeout: 60_000 });
    if (!tenant) throw new Error('the tenant was not provisioned');
    const asset = await newestVideoAsset(tenant.slug);
    if (!asset) throw new Error('the video asset was not recorded');
    return asset.id;
  }

  test('the video row and helper show the tenant numbers; a video waits for ready, then publishes into Explorar', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the picker row is the phone entry');
    test.setTimeout(180_000);
    if (!tenant) throw new Error('the tenant was not provisioned');
    await hangStreams(page);
    await openMemberComposer(page, tenant);

    await expect(
      page.getByText(
        COMPOSER.memberVideoHelper.replace('{seconds}', '45').replace('{size}', '20 MB'),
      ),
    ).toBeVisible();

    const assetId = await pickVideo(page);
    await captionField(page).fill(`${PREFIX} vídeo de membro dentro do limite.`);
    // (f) processing: the Phase 3 state, the member line and a disabled Publicar.
    await expect(page.getByText(COMPOSER.memberVideoWaiting)).toBeVisible();
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeDisabled();

    await markVideoReady(assetId, { durationSeconds: 12 });
    await expect(page.getByText(COMPOSER.memberVideoWaiting)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeEnabled();

    await page.getByRole('button', { name: COMPOSER.publish, exact: true }).click();
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    await expect(cards(page).first()).toContainText(`${PREFIX} vídeo de membro dentro do limite.`);
    await expect(cards(page).first().getByTestId('feed-video-frame')).toBeVisible();
  });

  test('a video refused for its duration shows the failed state and the tenant seconds until it is removed', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the picker row is the phone entry');
    test.setTimeout(180_000);
    if (!tenant) throw new Error('the tenant was not provisioned');
    await hangStreams(page);
    await openMemberComposer(page, tenant);

    const assetId = await pickVideo(page);
    await captionField(page).fill(`${PREFIX} vídeo de membro longo demais.`);
    await markVideoTooLong(assetId);

    // (g) the line in the tenant's own seconds, one way out, Publicar off.
    await expect(
      page.getByText(COMPOSER.memberVideoTooLong.replace('{seconds}', '45')),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeDisabled();
    await page.getByRole('button', { name: COMPOSER.removeVideo }).click();
    await expect(
      page.getByText(COMPOSER.memberVideoTooLong.replace('{seconds}', '45')),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeEnabled();
  });

  test('a stale tab that still offers video gets the off message once the tenant switches it off', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the picker row is the phone entry');
    test.setTimeout(240_000);
    if (!tenant) throw new Error('the tenant was not provisioned');
    await hangStreams(page);
    await openMemberComposer(page, tenant);

    const assetId = await pickVideo(page);
    await markVideoReady(assetId, { durationSeconds: 12 });
    await captionField(page).fill(`${PREFIX} vídeo que o espaço desligou.`);
    await expect(page.getByRole('button', { name: COMPOSER.publish, exact: true })).toBeEnabled({
      timeout: 30_000,
    });

    // The tenant switches member video off under the open tab. The API caches a tenant's module
    // settings for 30 s per instance, so the write only counts once that window has passed.
    await setSocialSettings(tenant.slug, memberLimits(false));
    await page.waitForTimeout(32_000);

    await page.getByRole('button', { name: COMPOSER.publish, exact: true }).click();
    await expect(page.locator('[data-composer-error]')).toHaveText(F.errors.memberVideoOff);
    await expect(page).toHaveURL(/\/criar$/);
  });
});

/** The removal confirmation (its confirm label repeats the menu row's, so it is scoped to the dialog). */
function removalDialog(page: Page): Locator {
  return page.getByRole('alertdialog').or(page.getByRole('dialog', { name: F.remove.title }));
}

/** A card by post id, wherever it sits in the column. */
function cardById(page: Page, id: string): Locator {
  return page.locator(`[data-post-id="${id}"]`);
}

test.describe('09-09 the moderator removal and the member wording of the author delete', () => {
  const removeCaption = `${PREFIX} publicação de Helena que a moderação remove.`;
  const failCaption = `${PREFIX} publicação de Helena cuja remoção falha.`;
  const ownCaption = `${PREFIX} publicação de Helena para o menu dela.`;
  const adminCaption = `${PREFIX} publicação da administração para o menu.`;
  let removeId = '';
  let failId = '';
  let ownId = '';
  let adminId = '';

  test.beforeAll(async () => {
    adminId = await createFeedPostAs(users.labAdmin, LAB, adminCaption);
    for (const [caption, assign] of [
      [removeCaption, (id: string) => (removeId = id)],
      [failCaption, (id: string) => (failId = id)],
      [ownCaption, (id: string) => (ownId = id)],
    ] as const) {
      const id = await createFeedPostAs(HELENA, LAB, caption);
      await markAsMemberPost(id);
      assign(id);
    }
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(PREFIX);
    await closeSocialAdmin();
    await closeAdmin();
  });

  test('the administrator removes a member post from the menu: the row set, the dialog, the toast, and the author is not told', async ({
    page,
  }) => {
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    const card = cardById(page, removeId);
    await expect(card).toBeVisible();
    const told = await notificationCountFor(HELENA, LAB);

    await card.getByRole('button', { name: F.actions.more }).click();
    // UI-D-497: Copiar link and the danger Remover row; "Editar publicação" is author-only.
    await expect(page.getByRole('button', { name: F.share.copyLink })).toBeVisible();
    await expect(page.getByRole('button', { name: F.menu.remove })).toBeVisible();
    await expect(page.getByRole('link', { name: F.menu.edit })).toHaveCount(0);
    await expect(page.getByRole('button', { name: F.menu.delete })).toHaveCount(0);

    await page.getByRole('button', { name: F.menu.remove }).click();
    const dialog = removalDialog(page);
    await expect(dialog.getByText(F.remove.title)).toBeVisible();
    await expect(dialog.getByText(F.remove.body)).toBeVisible();
    await dialog.getByRole('button', { name: F.remove.confirm }).click();

    await expect(page.getByText(F.toasts.removed)).toBeVisible();
    await expect(cardById(page, removeId)).toHaveCount(0);
    // The sibling cards are still there, and nobody was notified of the removal.
    await expect(cardById(page, failId)).toBeVisible();
    expect(await notificationCountFor(HELENA, LAB)).toBe(told);

    // And the post is gone for its author too.
    await page.context().clearCookies();
    await login(page, HELENA, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    await expect(cardById(page, ownId)).toBeVisible();
    await expect(cardById(page, removeId)).toHaveCount(0);
  });

  test('a failed removal keeps the card and raises the generic error toast; no optimistic removal', async ({
    page,
  }) => {
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    const card = cardById(page, failId);
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: F.actions.more }).click();
    await page.getByRole('button', { name: F.menu.remove }).click();
    await breakServerActions(page);
    await removalDialog(page).getByRole('button', { name: F.remove.confirm }).click();

    await expect(page.getByText(F.errors.generic).first()).toBeVisible();
    await expect(cardById(page, failId)).toBeVisible();
  });

  test('the author of a member post sees the member wording in the delete dialog, and an administrator post keeps 04', async ({
    page,
    context,
  }) => {
    await login(page, HELENA, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    const own = cardById(page, ownId);
    await expect(own).toBeVisible();

    await own.getByRole('button', { name: F.actions.more }).click();
    await expect(page.getByRole('link', { name: F.menu.edit })).toBeVisible();
    await expect(page.getByRole('button', { name: F.share.copyLink })).toBeVisible();
    await expect(page.getByRole('button', { name: F.menu.remove })).toHaveCount(0);
    await page.getByRole('button', { name: F.menu.delete }).click();
    await expect(page.getByText(F.delete.title)).toBeVisible();
    await expect(page.getByText(F.deleteMember.body)).toBeVisible();
    await expect(page.getByText(F.delete.body)).toHaveCount(0);
    await page.getByRole('button', { name: F.delete.cancel }).click();
    await expect(own).toBeVisible();

    // The administrator's own post, opened by the administrator: 04's rows and 04's body.
    await context.clearCookies();
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    const adminCard = cardById(page, adminId);
    await expect(adminCard).toBeVisible();
    await adminCard.getByRole('button', { name: F.actions.more }).click();
    await expect(page.getByRole('link', { name: F.menu.edit })).toBeVisible();
    await expect(page.getByRole('button', { name: F.menu.remove })).toHaveCount(0);
    await page.getByRole('button', { name: F.menu.delete }).click();
    await expect(page.getByText(F.delete.body)).toBeVisible();
    await expect(page.getByText(F.deleteMember.body)).toHaveCount(0);
    await page.getByRole('button', { name: F.delete.cancel }).click();
  });
});

/**
 * 09-10 Task 1 (the tracer, FOLLOW-04, D-470, UI-D-498, UI-D-501): follow and unfollow from another
 * member's profile.
 *
 * Alvaro opens Marcos (Alvaro follows Helena, Helena follows Marcos; Alvaro does NOT follow Marcos in
 * the seed). The walk: the D-45 header, two PLAIN count cells and a brand "Seguir"; one tap shows
 * "Seguindo" at once, the follower count rises by one, a reload keeps it; a second tap unfollows with
 * no dialog and no toast. A staff viewer and a viewer in a tenant with `social` off see the header
 * only, and no request is made for them (the block is gated on the composed permission).
 *
 * The edge Alvaro -> Marcos is created and removed by this spec alone (`unfollowMember`), so the
 * seeded graph other specs read never moves. The "social read fails" state is not driven from the
 * browser: the read is made by the Next server, which Playwright cannot intercept; it is asserted by
 * `components/social/SocialProfileBlock.test.tsx` (B4) instead.
 */
test.describe('09-10 the follow button and the counts on a member profile', () => {
  const MARCOS = 'marcos.vinicius@rede-lab.local';
  const MARCOS_NAME = 'Marcos Vinícius';
  const demoOther = `social-prof-${RUN}@rede-demo.local`;
  const DEMO_OTHER_NAME = 'Teste social perfil demo';

  test.beforeAll(async () => {
    await unfollowMember(ALVARO, MARCOS, LAB);
    await createMember(demoOther, SEED_PASSWORD, DEMO);
    await setMemberDisplayName(demoOther, DEMO, DEMO_OTHER_NAME);
  });

  test.afterAll(async () => {
    await unfollowMember(ALVARO, MARCOS, LAB);
    await deleteUserByEmail(demoOther);
    await closeSocialAdmin();
    await closeAdmin();
  });

  /** The two count cells of the profile block, or an empty locator when there is none. */
  function counts(page: Page): Locator {
    return page.locator('div.grid.grid-cols-2.border-y');
  }

  test('Alvaro follows and unfollows Marcos: optimistic, reconciled, kept after a reload', async ({
    page,
  }) => {
    const marcosId = await membershipIdFor(MARCOS, LAB);
    const before = await followerCountOf(MARCOS, LAB);
    await login(page, ALVARO, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/membros/${marcosId}`);

    // The unchanged D-45 header, then two plain cells, then the brand button.
    await expect(page.getByRole('heading', { level: 1, name: MARCOS_NAME })).toBeVisible();
    await expect(counts(page)).toBeVisible();
    await expect(counts(page).getByRole('link')).toHaveCount(0);
    await expect(counts(page)).toContainText(S.counts.following);
    const follow = page.getByRole('button', { name: `Seguir ${MARCOS_NAME}` });
    await expect(follow).toBeVisible();
    await expect(follow).toHaveText(S.follow.follow);
    await expect(counts(page).locator('> div').first()).toContainText(String(before));

    // One tap: Seguindo at once, and the follower count follows the server's answer.
    await follow.click();
    const following = page.getByRole('button', { name: new RegExp(`^Seguindo ${MARCOS_NAME}`) });
    await expect(following).toHaveText(S.follow.following);
    await expect(counts(page).locator('> div').first()).toContainText(String(before + 1));
    await expect.poll(() => followerCountOf(MARCOS, LAB)).toBe(before + 1);

    // A reload shows the same state, from the server.
    await page.reload();
    await expect(
      page.getByRole('button', { name: new RegExp(`^Seguindo ${MARCOS_NAME}`) }),
    ).toHaveText(S.follow.following);
    await expect(counts(page).locator('> div').first()).toContainText(String(before + 1));

    // A second tap unfollows: no dialog, no toast, the count comes back.
    await page.getByRole('button', { name: new RegExp(`^Seguindo ${MARCOS_NAME}`) }).click();
    await expect(page.getByRole('button', { name: `Seguir ${MARCOS_NAME}` })).toHaveText(
      S.follow.follow,
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(counts(page).locator('> div').first()).toContainText(String(before));
    await expect.poll(() => followerCountOf(MARCOS, LAB)).toBe(before);
  });

  test('a staff viewer sees the D-45 header only: no counts, no Seguir', async ({ page }) => {
    const marcosId = await membershipIdFor(MARCOS, LAB);
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/membros/${marcosId}`);

    await expect(page.getByRole('heading', { level: 1, name: MARCOS_NAME })).toBeVisible();
    await expect(counts(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Seguir/ })).toHaveCount(0);
    await expect(page.getByText(S.follow.follow, { exact: true })).toHaveCount(0);
  });

  test('a member of a tenant with social off sees the D-45 header only', async ({ page }) => {
    const id = await membershipIdFor(demoOther, DEMO);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/membros/${id}`);

    await expect(page.getByRole('heading', { level: 1, name: DEMO_OTHER_NAME })).toBeVisible();
    await expect(counts(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Seguir/ })).toHaveCount(0);
  });
});

/**
 * 09-10 Task 2 (D-466, D-470, UI-D-503, FOLLOW-05/06, EP-42..EP-44): `/membros` for a MEMBER, over a
 * throwaway community with `feed` and `social` on and a real second page (27 members, an admin, a
 * blocked and a removed membership - `members-admin.ts`). The caller is member 01, who sits at the top
 * of page one. A pre-seeded edge from the caller to the LAST member puts a "Seguindo" on page two, so
 * the load-more state merge is asserted on a real second page.
 *
 * The flags are written BEFORE the first request (the API caches a tenant's modules for 30 s per
 * instance). The staff and the `social`-off walks reuse the same fixtures and the seeded rede-demo.
 */
test.describe('09-10 /membros for a member: the split row, Você, the batch state and the back links', () => {
  test.use({ serviceWorkers: 'block' });

  let tenant: MembersTenant;

  const rowsOf = (page: Page) =>
    page.locator('main li').filter({ has: page.locator('a[href^="/membros/"]') });
  const seguiButtons = (page: Page) => page.getByRole('button', { name: /^Segui/ });

  test.beforeAll(async ({ browserName }, testInfo) => {
    test.setTimeout(240_000);
    void browserName;
    await sweepMembersTenants('socd');
    tenant = await createMembersTenant(
      membersTenantSlug('socd', testInfo.project.name),
      SEED_PASSWORD,
    );
    await setTenantModuleFlag(tenant.slug, 'feed', true);
    await setTenantModuleFlag(tenant.slug, 'social', true);
    const last = tenant.members[tenant.members.length - 1];
    if (!last) throw new Error('the fixture has no last member');
    await followMember(tenant.caller.email, last.email, tenant.slug);
  });

  test.afterAll(async () => {
    if (tenant) await deleteMembersTenant(tenant.slug);
    await closeMembersAdmin();
    await closeSocialAdmin();
    await closeTenantFixtures();
    await closeAdmin();
  });

  test('a member is no longer sent away: page one has a button on every row but their own, who reads Você', async ({
    page,
  }) => {
    await login(page, tenant.caller.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/membros`);

    await expect(rowsOf(page)).toHaveCount(25);
    await expect(page).toHaveURL(/\/membros$/);
    // 24 buttons (every row but the caller's) and exactly one "Você", on the caller's own row.
    await expect(seguiButtons(page)).toHaveCount(24);
    await expect(page.getByText(S.directory.you, { exact: true })).toHaveCount(1);
    const own = rowsOf(page).filter({ hasText: S.directory.you });
    await expect(own.getByRole('button')).toHaveCount(0);
    await expect(own).toContainText(tenant.caller.displayName.slice(0, 20));

    // The directory lists members only: no admin, no blocked and no removed membership.
    for (const name of [tenant.admin.displayName, 'Membro Bloqueado', 'Membro Removido']) {
      await expect(page.getByText(name)).toHaveCount(0);
    }

    // The back link of a member viewer goes to Explorar.
    await expect(page.getByRole('link', { name: 'Voltar' }).first()).toHaveAttribute(
      'href',
      '/inicio?aba=explorar',
    );
  });

  test('a row is the person link then the button, and the long name truncates inside the link', async ({
    page,
  }) => {
    await login(page, tenant.caller.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/membros`);

    const second = tenant.members[1];
    if (!second) throw new Error('the fixture has no second member');
    const row = rowsOf(page).filter({ hasText: second.displayName });
    const link = row.locator('a[href^="/membros/"]');
    await expect(link).toHaveAttribute('href', `/membros/${second.membershipId}`);
    const button = row.getByRole('button', { name: `Seguir ${second.displayName}` });
    await expect(button).toBeVisible();
    // The DOM order: link first, then the button.
    const order = await row.evaluate((el) => {
      const a = el.querySelector('a[href^="/membros/"]');
      const b = el.querySelector('button');
      return a && b ? a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy();
    // The button keeps its fixed width.
    const box = await button.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(96);
  });

  test('"Carregar mais" brings page two with its own states: the pre-followed member reads Seguindo', async ({
    page,
  }) => {
    await login(page, tenant.caller.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/membros`);
    await expect(rowsOf(page)).toHaveCount(25);

    await page.getByRole('button', { name: 'Carregar mais' }).click();
    await expect(rowsOf(page)).toHaveCount(MEMBERS_TENANT_SIZE);
    const last = tenant.members[tenant.members.length - 1];
    const beforeLast = tenant.members[tenant.members.length - 2];
    if (!last || !beforeLast) throw new Error('the fixture is too small');
    await expect(
      rowsOf(page)
        .filter({ hasText: last.displayName })
        .getByRole('button', { name: new RegExp(`^Seguindo ${last.displayName}`) }),
    ).toBeVisible();
    await expect(
      rowsOf(page)
        .filter({ hasText: beforeLast.displayName })
        .getByRole('button', { name: `Seguir ${beforeLast.displayName}` }),
    ).toBeVisible();
    // The first page kept its buttons; no second "Você".
    await expect(seguiButtons(page)).toHaveCount(MEMBERS_TENANT_SIZE - 1);
    await expect(page.getByText(S.directory.you, { exact: true })).toHaveCount(1);
  });

  test("following from a row and the profile agree; the profile's back link is the directory", async ({
    page,
  }) => {
    const target = tenant.members[3];
    if (!target) throw new Error('the fixture has no fourth member');
    await login(page, tenant.caller.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/membros`);

    const row = rowsOf(page).filter({ hasText: target.displayName });
    await row.getByRole('button', { name: `Seguir ${target.displayName}` }).click();
    await expect(
      row.getByRole('button', { name: new RegExp(`^Seguindo ${target.displayName}`) }),
    ).toHaveText(S.follow.following);

    // The profile reads the same state from the server, and its way back is the directory.
    await row.locator('a[href^="/membros/"]').click();
    await expect(page).toHaveURL(new RegExp(`/membros/${target.membershipId}$`));
    await expect(
      page.getByRole('button', { name: new RegExp(`^Seguindo ${target.displayName}`) }),
    ).toHaveText(S.follow.following);
    await expect(page.getByRole('link', { name: 'Voltar' }).first()).toHaveAttribute(
      'href',
      '/membros',
    );
  });

  test('the staff keep a button-free list; a member with social off is redirected to /perfil', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/membros`);
    await expect(rowsOf(page).first()).toBeVisible();
    await expect(seguiButtons(page)).toHaveCount(0);
    await expect(page.getByText(S.directory.you, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Voltar' }).first()).toHaveAttribute(
      'href',
      '/perfil',
    );
  });

  test('a rede-demo member (social off) is still redirected to /perfil', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/membros`);
    await expect(page).toHaveURL(/\/perfil$/);
  });
});
