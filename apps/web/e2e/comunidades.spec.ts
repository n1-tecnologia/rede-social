import { expect, type Locator, type Page, test } from '@playwright/test';
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const C = communityMessages.communities;

/**
 * COMM-02 / COMM-03 / D-40 (plan 05-01): the `Comunidades` tab and the `/comunidades` list, on the
 * phone (`mobile-chromium`, an iPhone 14 preset) and on the desktop.
 *
 * Everything here runs against the SEEDED `tria-demo` community and writes nothing, so the shared
 * seed stays exactly as it was and the file is re-runnable in any order.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson, and it is load-bearing here for a second reason:
 * this spec asserts a COMPUTED BACKGROUND, and a worker answering the navigation from its own cache
 * would have it asserting what a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });

/**
 * What `scripts/seed.ts` writes for the demo tenant, mirrored here for the same reason
 * `members.spec.ts` mirrors its member names: the seed is a top-level-await script that requires
 * `SEED_PASSWORD` and opens a database connection at import time.
 */
const SEEDED = {
  /** Newest activity first — this heads the list and carries a cover. */
  first: 'Avisos da diretoria',
  /** The one WITHOUT a cover: the D-69 / UI-D-35 gradient fixture. */
  noCover: 'Eventos e encontros',
  /** 60 characters — the card's `truncate` backstop. */
  longName: 'Grupo de trabalho de comunicacao interna e eventos do ano 26',
  /** The tie partner of `longName`, one slot below it on `id desc`. */
  tied: 'Projetos em andamento',
  total: 4,
} as const;

/**
 * The prototype chrome D-75 / UI-D-42 DROPPED. Asserted as absent TEXT rather than as a snapshot,
 * so the assertion says what it means and survives a legitimate visual change.
 */
const DROPPED_COPY = [/Novas interações/i, /Nova interação/i, /membros?\b/i, /Atualizado/i];

function list(page: Page): Locator {
  return page.getByRole('region', { name: new RegExp(C.region.replace('{tenant}', '.*')) });
}

/** Every community card is ONE link to `/comunidades/{id}` (the whole card is the target). */
function cards(page: Page): Locator {
  return page.locator('main a[href^="/comunidades/"]');
}

function cardWith(page: Page, name: string): Locator {
  return cards(page).filter({ hasText: name });
}

test.describe('the Comunidades tab and the /comunidades list (COMM-02, COMM-03)', () => {
  test('the tab is in the shell and reaches the list, which shows the tenant’s communities', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // D-40: the tab is there because the MODULE'S MANIFEST declares it, not because the shell
    // changed. It is reached by its catalog label (`communities.nav`), so a copy drift fails here.
    const tab = page.locator('nav').getByRole('link', { name: C.nav }).first();
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/\/comunidades$/);

    // The screen's only Title-role heading, plus the proto subheading beneath it.
    await expect(page.getByRole('heading', { name: C.list.title, level: 1 })).toBeVisible();
    await expect(page.getByText(C.list.subtitle)).toBeVisible();

    await expect(list(page)).toBeVisible();
    // At least three cards — the seed writes four, and a list that rendered one would pass a
    // ">= 1" assertion while proving nothing about the column.
    await expect(cards(page)).toHaveCount(SEEDED.total);
    expect(await cards(page).count()).toBeGreaterThanOrEqual(3);
  });

  test('the cards carry COMM-03’s four fields, in the server’s activity order', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    const names = await cards(page).evaluateAll((nodes) =>
      nodes.map((node) => node.textContent ?? ''),
    );
    // D-76's ordering, rendered: newest activity first, and the tie broken by `id desc` — which is
    // why the long-name community sits ABOVE its tie partner.
    expect(names[0]).toContain(SEEDED.first);
    expect(names[1]).toContain(SEEDED.noCover);
    expect(names[2]).toContain(SEEDED.longName);
    expect(names[3]).toContain(SEEDED.tied);

    // The count row: the post count and a name, and no other fact. The count is the catalog's ICU
    // plural, so the zero case really is "0 publicações" rather than an empty string.
    const card = cardWith(page, SEEDED.first);
    await expect(card).toContainText(/\d+\s+publica/i);
  });

  test('a cover-less community renders the brand gradient, not a broken image', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    const coverless = cardWith(page, SEEDED.noCover);
    await expect(coverless).toBeVisible();

    const fallback = coverless.locator('[data-testid="community-cover-fallback"]');
    await expect(fallback).toBeVisible();
    // UI-D-35, asserted by the COMPUTED background rather than by a screenshot: the block really is
    // painted with the tenant's `--brand-gradient`, which is a gradient and not a flat neutral.
    const backgroundImage = await fallback.evaluate(
      (node) => getComputedStyle(node).backgroundImage,
    );
    expect(backgroundImage).toContain('gradient');
    expect(backgroundImage).not.toBe('none');
    // The fallback carries the community's NAME (the list card's rule), so the card is never a
    // nameless coloured block.
    await expect(fallback).toContainText(SEEDED.noCover);
    // …and there is no `<img>` inside it to break.
    await expect(fallback.locator('img')).toHaveCount(0);

    // The positive control in the same test: a community WITH a cover takes the IMAGE branch, so
    // the gradient above is the null-cover fallback and not a global default every card gets.
    //
    // The control is the rendered BRANCH, deliberately not a loaded bitmap. `MediaImage`'s whole
    // error contract is that a missing object degrades to the neutral `bg-bg-tertiary` box rather
    // than a broken-image glyph — so an `<img>` assertion here would be asserting that the shared
    // local stack still holds the seeded bytes, which is a property of the suite that ran before
    // this one (`media-sweeper.test.ts` empties the bucket), not a property of the card.
    const withCover = cardWith(page, SEEDED.first);
    await expect(withCover.locator('[data-testid="community-cover-image"]')).toBeVisible();
    await expect(withCover.locator('[data-testid="community-cover-fallback"]')).toHaveCount(0);
    // …and symmetrically, the cover-less card never takes the image branch.
    await expect(coverless.locator('[data-testid="community-cover-image"]')).toHaveCount(0);
  });

  test('the D-75 drops are absent: no activity badge, no member count, no timestamp', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page).first()).toBeVisible();

    const text = (await list(page).textContent()) ?? '';
    expect(text.length).toBeGreaterThan(0);
    for (const dropped of DROPPED_COPY) {
      expect(text, `UI-D-42 drops this from the card: ${dropped}`).not.toMatch(dropped);
    }
  });

  test('a member sees no create CTA; the admin’s empty-state CTA is a permission, not a role', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page).first()).toBeVisible();

    // T-05-03 rendered: the member holds no `communities.community.manage`, so the list offers no
    // creation affordance at all. (The CTA itself lives in the empty state, which 05-04 exercises.)
    await expect(page.locator('main').getByRole('link', { name: C.actions.create })).toHaveCount(0);
  });
});
