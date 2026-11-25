import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import communitiesMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  createFeedCommentAs,
  deleteHighlightsByTitlePrefix,
  deleteReelsFixtures,
  deleteStoriesByCaptionPrefix,
  getTenantModuleFlag,
  insertHighlightFixture,
  setHighlightOpenToBuyers,
} from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { untilHydrated } from './hydration';
import {
  closeStoreAdmin,
  createCommunityPostAs,
  createProduct,
  deleteCommunitiesByPrefix,
  deleteProductsByPrefix,
  grantEntitlement,
  revokeEntitlement,
  setLinkPermissions,
} from './store-admin';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const F = feedMessages.feed;
const C = communitiesMessages.communities;
const S = storiesMessages.stories;

const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;
const DEMO = 'rede-demo';

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/**
 * 11.1-17 (UI-D-888, UI-D-889, UI-D-891, UI-D-892, UI-D-893, BPERM-21, BPERM-24): the buyer's side of the
 * permissions, as one walk on a phone and then on the narrowest phone.
 *
 * 1. a buyer who holds only `Curtir`: the post card shows the heart and nothing else, the comment sheet
 *    has no composer and the community page has no compose entry;
 * 2. with `Postar na comunidade` and `Postar story` ticked and one open highlight: the entry appears, the
 *    buyer publishes ONE post from the community page and sees it at the top of that page and nowhere in
 *    Início or Explorar, and saves an own story into the open highlight from `/stories/publicar` with the
 *    notice visible;
 * 3. the entitlement is revoked: after a refresh the controls are gone.
 *
 * **WRITTEN FOR THE OWNER TO RUN.** The phase's agents only ever `playwright test --list` this file (the
 * full e2e takes about 1.5 h and fills the disk); the ledger rows that depend on it are Igor's. It follows
 * `buyer-permissions-admin.spec.ts` and `social.spec.ts`: every row is a fixture written through the
 * helpers, prefixed per run and project, and removed in `afterAll`, and the `social` module of `rede-demo`
 * (seeded OFF) is switched on for the walk and put back as it was.
 *
 * `serviceWorkers: 'block'`: a worker answering navigations from its cache would have these assertions
 * read what a previous run left behind (the 03-05 lesson).
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 180_000 });

function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'mobile-chromium';
}

/** The widths one case walks: the phone preset's 390, then the narrowest phone; desktop keeps its own. */
function widths(testInfo: TestInfo): (number | null)[] {
  return isMobile(testInfo) ? [390, 320] : [null];
}

async function resize(page: Page, width: number | null): Promise<void> {
  if (width !== null) await page.setViewportSize({ width, height: 844 });
}

/** True when the document scrolls sideways - nothing here may. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.describe('buyer permissions, the member', () => {
  test.skip(isRemote, 'the fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let highlightPrefix = '';
  const names = { community: '', product: '', highlight: '', post: '', comment: '', story: '' };
  const ids = { community: '', product: '', highlight: '', seededPost: '', entitlement: '' };
  let socialWas: boolean | null = null;

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    const project = testInfo.project.name;
    prefix = `e2e-bpm-${project}-${run}`;
    // The highlight title is capped at 50 characters, so it carries a shorter prefix of its own.
    highlightPrefix = `e2e-bpm-${isMobile(testInfo) ? 'm' : 'd'}-${run}`;
    await deleteReelsFixtures(`e2e-bpm-${project}-`);
    await deleteStoriesByCaptionPrefix(`e2e-bpm-${project}-`);
    await deleteHighlightsByTitlePrefix(DEMO, `e2e-bpm-${isMobile(testInfo) ? 'm' : 'd'}-`);
    await deleteProductsByPrefix(`e2e-bpm-${project}-`);
    await deleteCommunitiesByPrefix(`e2e-bpm-${project}-`);

    names.community = `${prefix} Mentoria Aurora`;
    names.product = `${prefix} Mentoria`;
    names.highlight = `${highlightPrefix} Bastidores`;
    names.post = `${prefix} publicação do comprador`;
    names.comment = `${prefix} comentário já existente`;
    names.story = `${prefix} story do comprador`;

    // `rede-demo` is seeded with `social` OFF: the buyer's post and story flow needs it on.
    socialWas = await getTenantModuleFlag(DEMO, 'social');
    await setTenantModuleFlag(DEMO, 'social', true);

    ids.community = await createCommunityAs(users.demoAdmin, DEMO, names.community);
    ids.product = await createProduct({
      tenantSlug: DEMO,
      name: names.product,
      priceCents: 1990,
      communityIds: [ids.community],
    });
    // A link starts with like, comment and share ticked; this walk begins with ONLY `Curtir`.
    await setLinkPermissions(ids.product, ids.community, {
      like: true,
      comment: false,
      share: false,
      post: false,
      story: false,
    });
    ids.highlight = await insertHighlightFixture(DEMO, ids.community, names.highlight);
    const seeded = await createCommunityPostAs(
      users.demoAdmin,
      DEMO,
      `${prefix} novidade da comunidade`,
      { communityId: ids.community, minutesAgo: 30 },
    );
    ids.seededPost = seeded.postId;
    await createFeedCommentAs(users.demoAdmin, ids.seededPost, names.comment);
    ids.entitlement = await grantEntitlement(users.demoMember, ids.product);
  });

  test.afterAll(async () => {
    await deleteReelsFixtures(prefix);
    await deleteStoriesByCaptionPrefix(prefix);
    await deleteHighlightsByTitlePrefix(DEMO, highlightPrefix);
    await deleteProductsByPrefix(prefix);
    await deleteCommunitiesByPrefix(prefix);
    await setTenantModuleFlag(DEMO, 'social', socialWas ?? false);
    await closeTenantFixtures();
    await closeStoreAdmin();
    await closeAdmin();
  });

  const communityUrl = () => `${hosts.demo}/comunidades/${ids.community}`;
  const seededCard = (page: Page) =>
    page.locator('[data-post-id]').filter({ hasText: `${prefix} novidade da comunidade` });
  /** Both compose entries of the page by their one name: the desktop button and the floating link. */
  const composeEntries = (page: Page) =>
    page.getByRole('link', { name: C.page.compose, exact: true });
  const storyDoor = (page: Page) =>
    page.getByRole('link', { name: fill(S.own.actionCommunity, { community: names.community }) });

  test('with only "Curtir": the card shows the heart and nothing else, the comment sheet has no composer, the page has no compose entry', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    for (const width of widths(testInfo)) {
      await resize(page, width);
      await page.goto(communityUrl());
      const card = seededCard(page);
      await expect(card).toBeVisible();

      // The heart is there; the comment and the share controls are ABSENT, not disabled.
      await expect(card.getByRole('button', { name: F.actions.like })).toBeVisible();
      await expect(card.getByRole('button', { name: F.actions.comment })).toHaveCount(0);
      await expect(card.getByRole('button', { name: F.actions.share })).toHaveCount(0);

      // The page offers no way to publish or to save a story: no entry, no "+" circle.
      await expect(composeEntries(page)).toHaveCount(0);
      await expect(page.locator('[data-compose-fab]')).toHaveCount(0);
      await expect(storyDoor(page)).toHaveCount(0);

      // The comment count still opens the thread, and the sheet has no composer and no Responder.
      await card.getByRole('button', { name: /1 comentário/ }).click();
      const sheet = page.getByRole('dialog', { name: F.comments.title });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(names.comment)).toBeVisible();
      await expect(sheet.getByPlaceholder(F.comments.placeholder)).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: F.comments.submit })).toHaveCount(0);
      expect(await scrollsSideways(page)).toBe(false);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
    }
  });

  test('with "Postar na comunidade": the entry appears, one post is published from the community page and shows only there', async ({
    page,
  }, testInfo) => {
    await setLinkPermissions(ids.product, ids.community, {
      comment: true,
      share: true,
      post: true,
    });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    for (const width of widths(testInfo)) {
      await resize(page, width);
      await page.goto(communityUrl());
      await expect(seededCard(page)).toBeVisible();

      // The controls follow the raised flags: the three card controls and a compose entry.
      const card = seededCard(page);
      await expect(card.getByRole('button', { name: F.actions.comment })).toBeVisible();
      await expect(card.getByRole('button', { name: F.actions.share })).toBeVisible();
      await expect(composeEntries(page).first()).toBeVisible();
      expect(await scrollsSideways(page)).toBe(false);
    }

    // The entry opens the composer pinned to THIS community: the read-only audience line, no picker.
    await resize(page, widths(testInfo)[0] ?? null);
    await page.goto(communityUrl());
    await composeEntries(page).first().click();
    await expect(page).toHaveURL(new RegExp(`/criar\\?comunidade=${ids.community}$`));
    const form = page.locator('form[data-composer]');
    await untilHydrated(form);
    await expect(
      page.getByText(fill(F.composer.audienceCommunity, { community: names.community })),
    ).toBeVisible();
    await expect(page.locator('[data-composer-destination]')).toHaveCount(0);

    await page.getByLabel(F.composer.captionLabel).fill(names.post);
    await page.getByRole('button', { name: F.composer.publish, exact: true }).click();

    // The member lands on the community page and the post is the first card, with no promise of a notice.
    await expect(page).toHaveURL(new RegExp(`/comunidades/${ids.community}$`));
    await expect(page.locator('[data-post-id]').first()).toContainText(names.post);

    // It lives ONLY there: Início and Explorar never list it.
    for (const path of ['/inicio', '/inicio?aba=explorar']) {
      await page.goto(`${hosts.demo}${path}`);
      await expect(page.getByText(names.post)).toHaveCount(0);
    }
  });

  test('with "Postar story" and an open highlight: the buyer saves an own story into it, the notice visible', async ({
    page,
  }) => {
    await setLinkPermissions(ids.product, ids.community, { story: true });
    await setHighlightOpenToBuyers(ids.highlight, true);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The "+" circle of the community page opens the composer for this community.
    await page.goto(communityUrl());
    await expect(storyDoor(page)).toBeVisible();
    await storyDoor(page).click();
    await expect(page).toHaveURL(new RegExp(`/stories/publicar\\?comunidade=${ids.community}$`));

    await page.locator('#story-photo-input').setInputFiles(PHOTO);
    await expect(page.getByLabel(S.publish.captionLabel)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(S.publish.captionLabel).fill(names.story);

    // The destination is the open highlight and the notice says where the story goes.
    await expect(page.locator('[data-story-destination-value]')).toHaveText(
      fill(S.publish.destination.value, {
        place: names.community,
        title: names.highlight,
      }),
    );
    await expect(page.getByText(S.highlights.select.memberHelper)).toBeVisible();

    await page.getByRole('button', { name: S.publish.submit, exact: true }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: fill(S.publish.toastHighlight, { title: names.highlight }) }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('after the entitlement is revoked and the page refreshed, the controls are gone', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(communityUrl());
    await expect(composeEntries(page).first()).toBeVisible();

    await revokeEntitlement(ids.entitlement);

    for (const width of widths(testInfo)) {
      await resize(page, width);
      await page.goto(communityUrl());
      await untilHydrated(page.locator('main'));

      // No entry, no "+" circle, no heart, no composer: whatever the page still draws is read-only.
      await expect(composeEntries(page)).toHaveCount(0);
      await expect(page.locator('[data-compose-fab]')).toHaveCount(0);
      await expect(storyDoor(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: F.actions.like })).toHaveCount(0);
      await expect(page.getByRole('button', { name: F.actions.comment })).toHaveCount(0);
      expect(await scrollsSideways(page)).toBe(false);
    }

    // The composer link typed by hand falls back silently to the Explorar composer.
    await page.goto(`${hosts.demo}/criar?comunidade=${ids.community}`);
    await untilHydrated(page.locator('form[data-composer]'));
    await expect(
      page.getByText(fill(F.composer.audienceCommunity, { community: names.community })),
    ).toHaveCount(0);
    await expect(page.getByText(F.composer.audience)).toBeVisible();
  });
});
