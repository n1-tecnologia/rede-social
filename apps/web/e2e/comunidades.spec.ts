import { expect, type Locator, type Page, test } from '@playwright/test';
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { hosts, login, SEED_PASSWORD, seededCommunityFeed, seededFeed, users } from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const C = communityMessages.communities;
const F = feedMessages.feed;

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
  /** ACTIVE communities only — the archived fifth is absent from every list read (UI-D-37). */
  total: 4,
  /** 05-04's archived fixture: absent from the list, still reachable by its own link. */
  archived: 'Mutirao de 2025 (encerrado)',
  /**
   * Its FIXED id in the demo tenant (`SEED_COMMUNITY_IDS`), because an archived community has no
   * card anywhere to scrape a href from — which is the very property this fixture exists to prove.
   */
  archivedId: '0d000000-0000-4000-8000-0000000000c5',
  /**
   * 05-08 / STORY-04: `SEED_COMMUNITY_IDS['tria-demo'][0]` — the community the seed pins BOTH the
   * EXPIRED story and an active one to, and `SEED_COMMUNITY_IDS[1]`, which has no pin at all. The
   * pair is what makes the Destaques assertions below say something: one renders the row and its
   * `SectionTitle`, the other renders NEITHER (UI-SPEC E12/empty).
   */
  pinnedId: '0d000000-0000-4000-8000-0000000000c1',
  unpinnedId: '0d000000-0000-4000-8000-0000000000c2',
  /** The caption of the EXPIRED story the seed pins — absent from `/inicio`, present here. */
  pinnedExpiredCaption: 'Publicado ontem, ja fora da regua.',
} as const;

/**
 * The name prefix the ONE writing case below uses. It is the SAME prefix
 * `apps/api/tests/integration/communities.test.ts` sweeps, so a crash between "create" and
 * "archive" leaves a row that the next integration run removes — and an archived row is invisible
 * to every list assertion in the meantime.
 */
const E2E_COMMUNITY_PREFIX = 'Comunidade de teste e2e';

/**
 * The prototype chrome D-75 / UI-D-42 DROPPED. Asserted as absent TEXT rather than as a snapshot,
 * so the assertion says what it means and survives a legitimate visual change.
 */
const DROPPED_COPY = [/Novas interações/i, /Nova interação/i, /membros?\b/i, /Atualizado/i];

function list(page: Page): Locator {
  // `list.region` names the LIST. 05-04 moved it off `communities.region`, which the UI-SPEC
  // reserves for ONE community's post list on its own page ("Publicações de {community}").
  return page.getByRole('region', { name: new RegExp(C.list.region.replace('{tenant}', '.*')) });
}

/**
 * Every community card is ONE link to `/comunidades/{id}` (the whole card is the target), located by
 * the card's OWN anchor. Not by the `/comunidades/` href prefix: since 05.1 a manager's title row
 * carries the create link to `/comunidades/nova`, which starts with the same prefix and would be
 * counted as a card on every admin screen.
 */
function cards(page: Page): Locator {
  return page.locator('main a[data-testid="community-card"]');
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

/**
 * 05-03 — the two halves of the phase's first criterion, in a real browser: the READ (a community
 * post inside the main feed, labelled and linked) and the WRITE (the composer opened from a
 * community, with its destination already chosen).
 *
 * Both run against the SEEDED fixtures and write nothing, so the shared seed stays as it was and
 * the file remains re-runnable in any order.
 */
test.describe('the merged feed and the “Publicar em” picker (D-71, D-72, COMM-04)', () => {
  test('a community post in the MAIN feed says where it came from, and links there', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/inicio`);

    // D-73 rendered: the post is on `/inicio`, not on a separate community screen.
    const card = page
      .locator('[role="article"]')
      .filter({ hasText: seededCommunityFeed.inCommunity })
      .first();
    await expect(card).toBeVisible();

    // D-71 / UI-D-36: the label is the catalog's own template, interpolated with the container's
    // name, and it is a LINK to that community — which is also the only discovery path from the
    // feed into a community.
    const expectedLabel = F.post.communityLabel.replace(
      '{community}',
      seededCommunityFeed.communityName,
    );
    const expectedAria = F.post.communityAriaLabel.replace(
      '{community}',
      seededCommunityFeed.communityName,
    );
    const label = card.getByRole('link', { name: expectedAria });
    await expect(label).toBeVisible();
    await expect(label).toHaveText(expectedLabel);
    // The href is the community's own route. The destination SCREEN is 05-04's
    // (`/comunidades/[communityId]`), so this asserts the link the member would follow rather than
    // the page it lands on — the walk-through itself belongs to the plan that builds that page.
    await expect(label).toHaveAttribute('href', /^\/comunidades\/[0-9a-f-]{36}$/);

    // …and a TENANT-WIDE post carries no such segment at all — no middot, no empty node. Without
    // this control the assertion above would pass on a feed that labelled every post.
    const tenantWide = page
      .locator('[role="article"]')
      .filter({ hasText: seededFeed.newest })
      .first();
    await expect(tenantWide).toBeVisible();
    await expect(tenantWide.locator('[data-post-community]')).toHaveCount(0);
  });

  test('the admin’s composer opens on “Feed principal”, and pre-filled from ?comunidade=', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // UI-D-45's default: the destination row exists, sits in the composer body, and reads
    // "Feed principal" until the admin chooses otherwise.
    await page.goto(`${hosts.demo}/criar`);
    const row = page.locator('[data-composer-destination]');
    await expect(row).toBeVisible();
    await expect(row).toContainText(C.picker.label);
    await expect(page.locator('[data-composer-destination-value]')).toHaveText(C.picker.default);

    // The sheet lists "Feed principal" FIRST and then every active community, so it is never empty.
    await row.click();
    const sheet = page.getByRole('dialog', { name: C.picker.title });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-picker-default]')).toBeVisible();
    await expect(
      sheet.getByRole('button', {
        name: C.picker.row.replace('{community}', seededCommunityFeed.communityName),
      }),
    ).toBeVisible();

    // Choosing one closes the sheet and updates the row's value.
    await sheet
      .getByRole('button', {
        name: C.picker.row.replace('{community}', seededCommunityFeed.otherCommunityName),
      })
      .click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-composer-destination-value]')).toHaveText(
      seededCommunityFeed.otherCommunityName,
    );

    // D-70: arriving from a community's FAB pre-fills the row on the server, with no round trip —
    // the value is correct on the very first paint.
    const communityHref = await page
      .goto(`${hosts.demo}/comunidades`)
      .then(() =>
        page
          .locator('main a[href^="/comunidades/"]')
          .filter({ hasText: seededCommunityFeed.communityName })
          .first()
          .getAttribute('href'),
      );
    const communityId = (communityHref ?? '').split('/').pop() ?? '';
    expect(communityId).toMatch(/^[0-9a-f-]{36}$/);

    await page.goto(`${hosts.demo}/criar?comunidade=${communityId}`);
    await expect(page.locator('[data-composer-destination-value]')).toHaveText(
      seededCommunityFeed.communityName,
    );
  });

  test('the EDIT screen renders the destination read-only with its helper (UI-D-45)', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    // Direct URL, by the seed's FIXED id: the admin authored this post, so the edit route is
    // reachable for it. The card carries no `/post/{id}` link to scrape (the post page is reached
    // through the overflow menu), and scraping one would assert a navigation affordance rather than
    // the row this case is about.
    await page.goto(`${hosts.demo}/post/${seededCommunityFeed.inCommunityPostId}/editar`);

    // UI-D-45: the row is PRESENT and inert, with its helper — rendering it read-only TEACHES
    // D-72's rule, where hiding it would read as a bug to the admin who used it moments ago.
    const row = page.locator('[data-composer-destination][data-readonly="true"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText(C.picker.label);
    await expect(row).toContainText(seededCommunityFeed.communityName);
    await expect(page.locator('[data-composer-destination-helper]')).toHaveText(
      C.picker.editHelper,
    );
    // …and there is no chevron and nothing to tap: the sheet cannot be opened from here at all.
    await expect(page.getByRole('dialog', { name: C.picker.title })).toHaveCount(0);
  });
});

/**
 * 05-04 — COMM-03's other half and COMM-01's write half, walked in a real browser: the list, a
 * community's own page, a post inside it, the admin's pre-filled compose entry, and what an
 * ARCHIVED community looks like from both sides.
 *
 * The read cases write NOTHING: the archived state has its own seeded fixture
 * (`SEEDED.archived`, added by 05-04 precisely so a spec never has to archive a seeded container
 * and leave the shared seed in a different state than it found it).
 *
 * The one WRITE case creates a community and archives it in the same test, so the list is back to
 * `SEEDED.total` by the time it returns. It names the community with the SAME prefix
 * `apps/api/tests/integration/communities.test.ts` sweeps, so a crash between the two steps leaves a
 * row that the next integration run (or `pnpm db:reset`) removes — and an archived row is invisible
 * to every list assertion in the meantime.
 */
test.describe('a community’s own page, the compose entry and the archived state (COMM-01, COMM-03)', () => {
  test('list → card → page → a post, with the D-71 label suppressed inside the community', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    await cardWith(page, SEEDED.first).click();
    await expect(page).toHaveURL(/\/comunidades\/[0-9a-f-]{36}$/);

    // UI-D-43: the name is the page's anchor, as its only Title-role heading, with the description
    // beneath it — and NO owner block, which D-67 removed from the prototype's header.
    await expect(page.getByRole('heading', { name: SEEDED.first, level: 1 })).toBeVisible();

    // The posts are the identical PostCard the feed renders…
    const posts = page.locator('[role="article"]');
    await expect(posts.first()).toBeVisible();
    await expect(posts.first()).toContainText(seededCommunityFeed.inCommunity);

    // …with the D-71 segment SUPPRESSED (UI-D-36): inside a community the label would restate the
    // page the reader is standing on. The positive control is `/inicio`, asserted above in this
    // same file, where the very same post DOES carry it.
    await expect(page.locator('[data-post-community]')).toHaveCount(0);

    // The post-list landmark names the CONTAINER, not the tenant-wide feed (UI-D-46).
    await expect(
      page.getByRole('region', { name: C.region.replace('{community}', SEEDED.first) }),
    ).toBeVisible();
  });

  test('the admin’s compose entry pre-fills the destination; a member has none', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await cardWith(page, SEEDED.first).click();
    const communityId = (page.url().split('/').pop() ?? '').trim();
    expect(communityId).toMatch(/^[0-9a-f-]{36}$/);

    // T-05-03 rendered: a member holds no `feed.post.create`, so there is no compose entry at all —
    // not a disabled one.
    await expect(page.locator('a[href^="/criar?comunidade="]:visible')).toHaveCount(0);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${communityId}`);

    // D-70 / UI-D-44: the shipped ComposeFab on mobile, the header-row brand button on desktop —
    // one href either way, already carrying the destination.
    const compose = page.locator('a[href^="/criar?comunidade="]:visible').first();
    await expect(compose).toBeVisible();
    await expect(compose).toHaveAttribute('href', `/criar?comunidade=${communityId}`);

    // …and following it opens the composer with that destination already chosen, on first paint.
    await compose.click();
    await expect(page.locator('[data-composer-destination-value]')).toHaveText(SEEDED.first);
  });

  test('an ARCHIVED community is absent from the list, and its page still opens read-only', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    // 1. Absent from the list — the one predicate archiving changes.
    await expect(cards(page)).toHaveCount(SEEDED.total);
    await expect(cardWith(page, SEEDED.archived)).toHaveCount(0);

    // 2. …and still OPENS by direct link, by the seed's own FIXED id. A 404 here would break every
    // shared link and every feed post that names the container, which is exactly what an archive
    // must not do (UI-D-37). The id is mirrored from the seed rather than scraped, because an
    // archived community has no card anywhere — which is the property being asserted one line up.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}`);
    await expect(page.getByRole('heading', { name: SEEDED.archived, level: 1 })).toBeVisible();
    await expect(page.getByText(C.archived.pill, { exact: true })).toBeVisible();
    await expect(page.getByText(C.archived.note)).toBeVisible();

    // 3. Read-only: no compose entry on either breakpoint, and the post list renders its own empty
    // state rather than an error.
    await expect(page.locator('a[href^="/criar?comunidade="]:visible')).toHaveCount(0);
    await expect(page.getByText(C.emptyPosts.title)).toBeVisible();
  });

  test('an admin creates a cover-less community, lands on its page, and archives it', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/nova`);

    // UI-D-38 / E13/empty: placeholders only, the gradient preview in the cover picker, and a
    // submit that is disabled until "Nome" is non-empty.
    await expect(page.getByRole('heading', { name: C.form.createTitle })).toBeVisible();
    await expect(page.locator('[data-cover-preview-fallback]')).toBeVisible();
    const submit = page.getByRole('button', { name: C.actions.create });
    await expect(submit).toBeDisabled();

    const name = `${E2E_COMMUNITY_PREFIX} ${Date.now()}`;
    await page.getByLabel(C.form.name.label).fill(name);
    await expect(submit).toBeEnabled();
    await submit.click();

    // It lands on the community's OWN page, and the cover-less community is painted with the
    // tenant's `--brand-gradient` rather than a neutral grey block (D-69, UI-D-35).
    await page.waitForURL(/\/comunidades\/[0-9a-f-]{36}$/);
    const communityId = page.url().split('/').pop() ?? '';
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    const fallback = page.locator('[data-testid="community-cover-fallback"]').first();
    const backgroundImage = await fallback.evaluate(
      (node) => getComputedStyle(node).backgroundImage,
    );
    expect(backgroundImage).toContain('gradient');
    // UI-D-35: on the PAGE the fallback carries no text — the name renders below the cover.
    await expect(fallback).not.toContainText(name);

    // …and the archive row lives at the bottom of the EDIT form only, behind its confirmation.
    await page.goto(`${hosts.demo}/comunidades/${communityId}/editar`);
    await expect(page.getByRole('heading', { name: C.form.editTitle })).toBeVisible();
    await page.locator('[data-community-archive]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(C.confirm.archive.body);
    await dialog.getByRole('button', { name: C.confirm.archive.confirm }).click();

    // Archiving returns to the list, where the community is now absent — and the seed's own count
    // is restored, so this test leaves the shared fixture exactly as it found it.
    await page.waitForURL(/\/comunidades$/);
    await expect(cardWith(page, name)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(SEEDED.total);

    // …while its page still opens, read-only.
    await page.goto(`${hosts.demo}/comunidades/${communityId}`);
    await expect(page.getByText(C.archived.pill, { exact: true })).toBeVisible();
  });
});

/**
 * 05-04 — COMM-01's round trip made REACHABLE. Archive is only reversible if "Reativar" is
 * reachable from a phone, and edit is only shipped if something navigates to the form.
 *
 * The case reuses the SEEDED archived community (a read for the permission assertions) and does its
 * one write on a community it creates itself, archives and reactivates, ending with it archived
 * again so the list is back to `SEEDED.total`.
 */
test.describe('the edit entry and the reactivate control (COMM-01, UI-D-37)', () => {
  test('a member sees no edit control; the admin reaches the form from the cover', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}`);
    await expect(page.getByRole('heading', { name: SEEDED.archived, level: 1 })).toBeVisible();
    await expect(page.locator('[data-community-edit]')).toHaveCount(0);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}`);
    const edit = page.locator('[data-community-edit]');
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute('href', `/comunidades/${SEEDED.archivedId}/editar`);
  });

  test('an archived community offers Reativar where an active one offers Arquivar', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // The seeded ARCHIVED community: the outline reactivate row, and no archive row at all.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}/editar`);
    await expect(page.locator('[data-community-reactivate]')).toBeVisible();
    await expect(page.locator('[data-community-reactivate]')).toContainText(C.archived.reactivate);
    await expect(page.locator('[data-community-archive]')).toHaveCount(0);

    // Its ACTIVE positive control, in the same case: the danger archive row, and no reactivate row.
    await page.goto(`${hosts.demo}/comunidades`);
    await cardWith(page, SEEDED.first).click();
    const activeId = page.url().split('/').pop() ?? '';
    await page.goto(`${hosts.demo}/comunidades/${activeId}/editar`);
    await expect(page.locator('[data-community-archive]')).toBeVisible();
    await expect(page.locator('[data-community-reactivate]')).toHaveCount(0);
  });

  test('archive → reactivate → archive is a round trip the list follows each way', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/nova`);

    const name = `${E2E_COMMUNITY_PREFIX} reversivel ${Date.now()}`;
    await page.getByLabel(C.form.name.label).fill(name);
    await page.getByRole('button', { name: C.actions.create }).click();
    await page.waitForURL(/\/comunidades\/[0-9a-f-]{36}$/);
    const communityId = page.url().split('/').pop() ?? '';

    const archive = async () => {
      await page.goto(`${hosts.demo}/comunidades/${communityId}/editar`);
      await page.locator('[data-community-archive]').click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: C.confirm.archive.confirm })
        .click();
      await page.waitForURL(/\/comunidades$/);
    };

    await archive();
    await expect(cardWith(page, name)).toHaveCount(0);

    // Reactivate — from the edit form the community page's own cover control reaches.
    await page.goto(`${hosts.demo}/comunidades/${communityId}/editar`);
    await page.locator('[data-community-reactivate]').click();
    await page.waitForURL(new RegExp(`/comunidades/${communityId}$`));
    await expect(page.getByText(C.archived.pill, { exact: true })).toHaveCount(0);

    // …and the list carries it again, which is the half that makes archive an organisational
    // tidy-up rather than a deletion.
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cardWith(page, name)).toHaveCount(1);

    // Leave the shared seed exactly as it was found.
    await archive();
    await expect(cards(page)).toHaveCount(SEEDED.total);
  });
});

/**
 * D-68 / STORY-04 (05-08) — the answer to PROTOTYPE.md's open question 1, walked in a browser.
 *
 * The claim is not "a circle row renders". It is that a story whose 24 h window CLOSED is still on
 * its community's page while being absent from the tenant-wide strip at the same instant — the two
 * surfaces disagreeing on purpose. Only an end-to-end walk can put both on one screen sequence;
 * pgTAP proves the same pair of predicates inside one transaction.
 */
test.describe('Destaques — the pinned circles, and the expiry they outlive (D-68, STORY-04)', () => {
  const ST = storyMessages.stories;

  /** The Destaques row, named by the catalog label the page passes as its `aria-label`. */
  function destaques(page: Page): Locator {
    return page.getByRole('list', { name: C.page.highlights });
  }

  test('a community with pins renders the row AND its section title; one without renders neither', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await page.goto(`${hosts.demo}/comunidades/${SEEDED.pinnedId}`);
    await expect(destaques(page)).toBeVisible();
    await expect(page.getByText(C.page.highlights, { exact: true }).first()).toBeVisible();
    // At least one circle, never an exact count — the SAME reason `stories.spec.ts` refuses to
    // mirror the strip's size. The seed pins two stories here (the expired one and an active
    // VIDEO), but `media-video.spec.ts` performs a hard, total reset of the demo tenant's video
    // library and takes that video's ASSET with it; the highlights read inner-joins `media_assets`,
    // so under a full-suite run the video's circle is legitimately gone. A constant here would make
    // this assertion depend on the order the suite happened to run in.
    //
    // The claim an exact count would have carried — that an active and an expired pinned story come
    // back from ONE query distinguished only by the projected flag — is asserted exactly where it
    // can be: `110-communities-stories.sql` case 53 and `stories.test.ts` case 29.
    await expect(destaques(page).getByRole('button')).not.toHaveCount(0);

    // UI-SPEC E12/empty: with nothing pinned the ROW and its `SectionTitle` are both ABSENT — not
    // an empty state, not a reserved height. This is the half a "renders the row" test would miss.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.unpinnedId}`);
    await expect(destaques(page)).toHaveCount(0);
    await expect(page.getByText(C.page.highlights, { exact: true })).toHaveCount(0);
  });

  test('a member opens the pinned EXPIRED story from Destaques, and the same story is absent from /inicio', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.pinnedId}`);

    // Newest pin first: the seed writes the EXPIRED story's pin last, so it leads the row.
    await destaques(page).getByRole('button').first().click();
    const viewer = page.getByRole('dialog', { name: ST.viewer.dialog });
    await expect(viewer).toBeVisible();
    // The caption is the identity: this is the story `stories.spec.ts` asserts is NOT on the strip.
    await expect(viewer.getByText(SEEDED.pinnedExpiredCaption)).toBeVisible();
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]{36}$/);
    const storyId = page.url().split('/').pop() ?? '';
    expect(storyId).toMatch(/^[0-9a-f-]{36}$/);

    // THE SAME STORY, the same session, the tenant-wide strip: absent. Its window closed, and the
    // pin is what kept it on the community page — the two surfaces disagree deliberately.
    await page.goto(`${hosts.demo}/inicio`);
    const strip = page.getByRole('list', { name: ST.region });
    await expect(strip).toBeVisible();
    await expect(strip.locator(`a[href="/stories/${storyId}"]`)).toHaveCount(0);
    await expect(page.getByText(SEEDED.pinnedExpiredCaption)).toHaveCount(0);

    // …and it is still READABLE by id: expiry gates the strip's read and nothing else (A-4).
    await page.goto(`${hosts.demo}/stories/${storyId}`);
    await expect(page.getByRole('dialog', { name: ST.viewer.dialog })).toBeVisible();
    await expect(page.getByText(SEEDED.pinnedExpiredCaption)).toBeVisible();
  });
});

/**
 * 05.1-03 — COMM-01 reachability on the list itself: ROADMAP criterion 1 (an admin who ALREADY has
 * communities reaches the create form) and the finding half of criterion 2 (an admin finds an
 * archived community without knowing its id).
 *
 * The create control is ONE anchor in the title row (D-86, UI-D-48): an icon-only 44×44 square
 * below `sm` and a labelled control from `sm`, with the same accessible name at every width. The
 * `Ativas` / `Arquivadas` chips are manager-only links read on the server (D-88, UI-D-49), and a
 * member who types `?status=arquivadas` lands on today's list (D-89's web half; the API's 403 is the
 * real control, 05.1-02 case 34).
 *
 * The one writing case creates a community and archives it again, so `SEEDED.total` holds for every
 * case after it; every case here runs on both `mobile-chromium` and `desktop-chromium`.
 */
test.describe('05.1 — the create control and the archived filter (COMM-01 reachability)', () => {
  function createLink(page: Page): Locator {
    return page.locator('main').getByRole('link', { name: C.actions.create, exact: true });
  }

  function filterNav(page: Page): Locator {
    return page.getByRole('navigation', { name: C.list.filter.label });
  }

  /** Horizontal overflow of the DOCUMENT and of the shell's scroll root, which is where the list lives. */
  async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => {
      const root = document.querySelector('main.app-scroll');
      return {
        document: document.documentElement.scrollWidth - window.innerWidth,
        main: root ? root.scrollWidth - root.clientWidth : 0,
      };
    });
    expect(overflow.document, 'the page scrolls sideways').toBeLessThanOrEqual(0);
    expect(overflow.main, 'the scroll root scrolls sideways').toBeLessThanOrEqual(0);
  }

  /**
   * Pages the list until `target` renders. The archived list is ordered by the server (most recently
   * archived first, D-91), so on a database that earlier runs have archived into, the seeded row can
   * sit past page 1. The sentinel observes the shell's scroll root, never the window (the
   * `feed.spec.ts` lesson).
   */
  async function scrollUntilPresent(page: Page, target: Locator): Promise<void> {
    for (let attempt = 0; attempt < 10 && (await target.count()) === 0; attempt += 1) {
      const before = await cards(page).count();
      await page.locator('main.app-scroll').evaluate((el) => {
        el.scrollTo(0, el.scrollHeight);
      });
      const grew = await expect
        .poll(async () => (await cards(page).count()) > before || (await target.count()) > 0, {
          timeout: 5_000,
        })
        .toBe(true)
        .then(
          () => true,
          () => false,
        );
      if (!grew) break;
    }
  }

  test('an admin reaches the create form from a NON-empty list, with one accessible name at 320px and at 640px', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page).first()).toBeVisible();

    // D-86: exactly ONE create link on a populated list — the empty state's own CTA (D-87) only
    // exists when there is nothing to list.
    await expect(createLink(page)).toHaveCount(1);
    await expect(createLink(page)).toHaveAttribute('href', '/comunidades/nova');

    // UI-D-48 below `sm`: an icon-only 44×44 brand square, still named by the catalog string.
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(createLink(page)).toBeVisible();
    const narrow = await createLink(page).boundingBox();
    expect(narrow).not.toBeNull();
    expect(narrow?.width ?? 0).toBeLessThanOrEqual(48);
    expect(narrow?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);

    // …and from `sm` the SAME node widens into "+ Criar comunidade", with the same name.
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(createLink(page)).toBeVisible();
    const wide = await createLink(page).boundingBox();
    expect(wide?.width ?? 0).toBeGreaterThan(100);
    await expect(createLink(page)).toHaveAccessibleName(C.actions.create);
    await expectNoHorizontalOverflow(page);
  });

  test('UAT replay: an admin creates a SECOND community from a non-empty list and lands on it', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page)).toHaveCount(SEEDED.total);

    // ROADMAP criterion 1, the report that re-opened COMM-01: the form is reachable from the list
    // itself, not only from the zero-communities empty state.
    await page.locator('main a[data-communities-create]').click();
    await page.waitForURL(/\/comunidades\/nova$/);
    await expect(page.getByRole('heading', { name: C.form.createTitle })).toBeVisible();

    const name = `${E2E_COMMUNITY_PREFIX} segunda ${Date.now()}`;
    await page.getByLabel(C.form.name.label).fill(name);
    await page.getByRole('button', { name: C.actions.create }).click();
    await page.waitForURL(/\/comunidades\/[0-9a-f-]{36}$/);
    const communityId = page.url().split('/').pop() ?? '';
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    // Leave the shared seed as found: archive it through the edit form, behind its confirmation.
    await page.goto(`${hosts.demo}/comunidades/${communityId}/editar`);
    await page.locator('[data-community-archive]').click();
    await page.getByRole('dialog').getByRole('button', { name: C.confirm.archive.confirm }).click();
    await page.waitForURL(/\/comunidades$/);
    await expect(cards(page)).toHaveCount(SEEDED.total);
  });

  test('a manager filters Ativas and Arquivadas; archived cards carry the pill and open read-only', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    // UI-D-49: two chip LINKS under the heading, the default one current.
    const nav = filterNav(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(2);
    const active = nav.getByRole('link', { name: C.list.filter.active, exact: true });
    const archived = nav.getByRole('link', { name: C.list.filter.archived, exact: true });
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(archived).not.toHaveAttribute('aria-current', 'page');
    await expect(cards(page)).toHaveCount(SEEDED.total);

    // D-88: Arquivadas is a navigation the server renders, carried in a shareable URL.
    await archived.click();
    await expect(page).toHaveURL(/\/comunidades\?status=arquivadas$/);
    await expect(
      filterNav(page).getByRole('link', { name: C.list.filter.archived, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('region', {
        name: new RegExp(C.list.regionArchived.replace('{tenant}', '.*')),
      }),
    ).toBeVisible();

    // UI-D-50: the seeded archived community is here, with its pill — and so is EVERY other card.
    const seededArchived = cardWith(page, SEEDED.archived);
    await scrollUntilPresent(page, seededArchived);
    await expect(seededArchived).toBeVisible();
    await expect(seededArchived).toContainText(C.archived.pill);
    const total = await cards(page).count();
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      await expect(cards(page).nth(index)).toContainText(C.archived.pill);
    }
    // No active row leaks in, and the create control stays in the title row under either filter.
    await expect(cardWith(page, SEEDED.first)).toHaveCount(0);
    await expect(createLink(page)).toHaveCount(1);

    // The card opens the community's page, read-only, by the id the admin never had to know.
    await seededArchived.click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${SEEDED.archivedId}$`));
    await expect(page.getByRole('heading', { name: SEEDED.archived, level: 1 })).toBeVisible();
    await expect(page.getByText(C.archived.pill, { exact: true })).toBeVisible();
    await expect(page.getByText(C.archived.note)).toBeVisible();
  });

  test('a member sees no chips and no create control, and ?status=arquivadas lands on today’s list', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades?status=arquivadas`);

    // D-89, web half: no error and no archived row — the ACTIVE list, exactly as a member sees it.
    await expect(list(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(SEEDED.total);
    await expect(cardWith(page, SEEDED.archived)).toHaveCount(0);
    await expect(filterNav(page)).toHaveCount(0);
    await expect(page.locator('main a[data-communities-create]')).toHaveCount(0);
    await expect(createLink(page)).toHaveCount(0);
  });
});
