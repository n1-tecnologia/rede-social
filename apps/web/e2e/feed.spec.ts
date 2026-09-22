import { expect, type Locator, type Page, test } from '@playwright/test';
import { hosts, login, SEED_PASSWORD, seededFeed, users } from './fixtures';

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
  return page.getByRole('region', { name: 'Publicações da comunidade' });
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
