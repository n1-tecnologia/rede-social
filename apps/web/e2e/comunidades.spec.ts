import { expect, type Locator, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  deleteHighlightsByTitlePrefix,
  insertHighlightFixture,
  setStoryViews,
} from './admin';
import { hosts, login, SEED_PASSWORD, seededCommunityFeed, seededFeed, users } from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const C = communityMessages.communities;
const F = feedMessages.feed;

/**
 * COMM-02 / COMM-03 / D-40 (plan 05-01): the `Comunidades` tab and the `/comunidades` list, on the
 * phone (`mobile-chromium`, an iPhone 14 preset) and on the desktop.
 *
 * Everything here runs against the SEEDED `rede-demo` community and writes nothing, so the shared
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
   * 05.2 / HIGHLIGHT-04: `SEED_COMMUNITY_IDS['rede-demo'][0]` — the community holding the seeded
   * community highlight `Destaques` (the EXPIRED story and an active one) — and
   * `SEED_COMMUNITY_IDS[1]`, which has no highlight at all. The pair is what makes the Destaques
   * assertions below say something: one renders the row and its `SectionTitle`, the other renders
   * NEITHER for a member (UI E02 empty).
   */
  withHighlightId: '0d000000-0000-4000-8000-0000000000c1',
  withoutHighlightId: '0d000000-0000-4000-8000-0000000000c2',
  /** `SEED_HIGHLIGHT_TITLES.community`: the one seeded community highlight. */
  communityHighlight: 'Destaques',
  /** `SEED_TENANTS['rede-demo'].displayName` — the tenant circle's name on Início, never here. */
  tenantName: 'Rede Demo',
  /** The caption of the EXPIRED story `Destaques` holds — absent from `/inicio`, present here. */
  expiredCaption: 'Publicado ontem, ja fora da regua.',
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
    // Dispatched AT the tab: under `next dev` the dev overlay's `<nextjs-portal>` can sit over the
    // phone BottomNav and intercept a coordinate click (06-01 deviation 8, 06-09). The tab is
    // visible; its navigation is what this asserts.
    await tab.dispatchEvent('click');
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
    // why the long-name community sits ABOVE its tie partner. Since 2026-10-03 the list orders by the
    // admin's `position` first; the seed leaves every position at 0, and the reorder cases at the end
    // of this file put back every position they move, so this is still the activity order.
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
/**
 * HIGHLIGHT-04 / UI-D-64 (05.2-08): under "Destaques", a community page shows ONLY that community's
 * named highlights — the same row Início draws, minus the tenant circle (D-104 is Início's alone).
 * The pinned-story row this replaced is gone. Every case reads; nothing here writes.
 */
test.describe("Destaques — the community's highlights (HIGHLIGHT-04, UI-D-64)", () => {
  const ST = storyMessages.stories;

  /** The Destaques row, named by the catalog label the page passes as its `aria-label`. */
  function destaques(page: Page): Locator {
    return page.getByRole('list', { name: C.page.highlights });
  }

  const highlightCircle = (page: Page, title: string) =>
    destaques(page).getByRole('button', { name: ST.circle.highlight.replace('{title}', title) });

  test('a member sees the section with the Destaques highlight and NO tenant circle; a community with none renders neither', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withHighlightId}`);
    await expect(destaques(page)).toBeVisible();
    await expect(page.getByText(C.page.highlights, { exact: true }).first()).toBeVisible();
    await expect(highlightCircle(page, SEEDED.communityHighlight)).toBeVisible();
    // D-104: the tenant circle belongs to Início. Here there is none, by name or by count.
    await expect(
      destaques(page).getByRole('button', {
        name: ST.circle.tenant.replace('{tenant}', SEEDED.tenantName),
      }),
    ).toHaveCount(0);
    // UI E02 zero-one-many: ONE seeded highlight is ONE circle — a member has no `+` beside it.
    await expect(destaques(page).getByRole('listitem')).toHaveCount(1);

    // UI E02 empty: with no non-empty highlight the ROW and its `SectionTitle` are both ABSENT —
    // not an empty state, not a reserved height.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withoutHighlightId}`);
    await expect(page.locator('[data-community-name]')).toBeVisible();
    await expect(destaques(page)).toHaveCount(0);
    await expect(page.getByText(C.page.highlights, { exact: true })).toHaveCount(0);
  });

  test('a member opens Destaques and plays the EXPIRED story first; the same story is not in Início’s tenant circle', async ({
    page,
  }) => {
    // 05.2-10 (D-105): the tenant circle RESUMES at the member's first unseen story, and the seed
    // marks the oldest one seen. This walk starts at index 0, so it starts from "nothing seen" —
    // and `stories.spec.ts`'s `afterAll` puts the seed's seen state back.
    await setStoryViews(users.demoMember, 'rede-demo', []);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withHighlightId}`);

    await highlightCircle(page, SEEDED.communityHighlight).click();
    const viewer = page.getByRole('dialog', { name: ST.viewer.dialog });
    await expect(viewer).toBeVisible();
    // A highlight group keeps the URL (D-107), and it is the row's only group.
    await expect(page).toHaveURL(new RegExp(`/comunidades/${SEEDED.withHighlightId}$`));
    await expect(viewer).toHaveAttribute('data-story-group', '0');
    // D-103: oldest first by publish time, so the EXPIRED story (30 h ago) is the first segment —
    // the item row is the expiry override (STORY-04 re-delivered through a highlight).
    await expect(viewer).toHaveAttribute('data-story-index', '0');
    await expect(page.getByTestId('story-caption')).toHaveText(SEEDED.expiredCaption);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // THE SAME STORY, the same session, Início's tenant circle: walk its whole group (group 0) and
    // the expired caption never plays. Its window closed; the highlight is what keeps it here.
    await page.goto(`${hosts.demo}/inicio`);
    const strip = page.getByRole('list', { name: ST.region });
    await strip
      .getByRole('button', { name: ST.circle.tenant.replace('{tenant}', SEEDED.tenantName) })
      .click();
    const tenantViewer = page.getByRole('dialog', { name: ST.viewer.dialog });
    await expect(tenantViewer).toBeVisible();
    const count = Number(
      await page.getByTestId('story-progress-bars').getAttribute('data-story-count'),
    );
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(tenantViewer).toHaveAttribute('data-story-group', '0');
      await expect(tenantViewer).toHaveAttribute('data-story-index', String(index));
      await expect(page.getByText(SEEDED.expiredCaption)).toHaveCount(0);
      if (index < count - 1) await page.keyboard.press('ArrowRight');
    }
    // Put the seed's seen state back (the member saw only the oldest active story, 05.2-10).
    await setStoryViews(users.demoMember, 'rede-demo', ['0d000000-0000-4000-8000-0000000000d3']);
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

/**
 * 05.1-05 — the last two entry points on the community page itself: ROADMAP criterion 2's
 * reactivation half (D-90, UI-D-52) and criterion 3's door (D-92, D-93, UI-D-53).
 *
 * Reactivation is ONE tap plus an explained confirm, from the archived community's own page, for a
 * manager only; the page refreshes itself into the active state (Pitfall 8). The Destaques `+` is
 * the strip's own circle restated for this row, drawn only for the attach permission pair on an
 * ACTIVE community — never for a member, never on an archived one.
 *
 * The one writing case creates a community, archives it, reactivates it from its page and archives
 * it again, so `SEEDED.total` holds for every case after it. Every case runs on both
 * `mobile-chromium` and `desktop-chromium`.
 */
test.describe('05.1 — reactivate from the page, and the Destaques `+` (D-90, D-92, D-93)', () => {
  const ST = storyMessages.stories;

  /** The Destaques row, named by the catalog label the page passes as its `aria-label`. */
  function destaques(page: Page): Locator {
    return page.getByRole('list', { name: C.page.highlights });
  }

  /** Every community-scoped story door on the page, whatever its label. */
  function storyDoors(page: Page): Locator {
    return page.locator('a[href^="/stories/publicar?comunidade="]');
  }

  async function heading(page: Page): Promise<string> {
    return ((await page.locator('[data-community-name]').textContent()) ?? '').trim();
  }

  async function archiveThroughTheForm(page: Page, communityId: string): Promise<void> {
    await page.goto(`${hosts.demo}/comunidades/${communityId}/editar`);
    await page.locator('[data-community-archive]').click();
    await page.getByRole('dialog').getByRole('button', { name: C.confirm.archive.confirm }).click();
    await page.waitForURL(/\/comunidades$/);
  }

  test('UAT replay: archive one, find it under Arquivadas, reactivate it from its page', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/nova`);

    const name = `${E2E_COMMUNITY_PREFIX} reativada ${Date.now()}`;
    await page.getByLabel(C.form.name.label).fill(name);
    await page.getByRole('button', { name: C.actions.create }).click();
    await page.waitForURL(/\/comunidades\/[0-9a-f-]{36}$/);
    const communityId = page.url().split('/').pop() ?? '';

    // Archive it, landing on the list — where it is now absent.
    await archiveThroughTheForm(page, communityId);
    await expect(cardWith(page, name)).toHaveCount(0);

    // Find it under Arquivadas (05.1-03): the most recently archived heads the list.
    await page
      .getByRole('navigation', { name: C.list.filter.label })
      .getByRole('link', { name: C.list.filter.archived, exact: true })
      .click();
    await expect(page).toHaveURL(/\/comunidades\?status=arquivadas$/);
    const card = cardWith(page, name);
    await expect(card).toBeVisible();
    await expect(card).toContainText(C.archived.pill);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${communityId}$`));

    // D-90 / UI-D-52: the one-tap Reativar under the archived note, behind the explained confirm.
    await expect(page.getByText(C.archived.pill, { exact: true })).toBeVisible();
    const reactivate = page.locator('[data-community-page-reactivate]');
    await expect(reactivate).toBeVisible();
    await expect(reactivate).toHaveText(C.archived.reactivate);
    // An archived community offers no story door (D-93) — the `+` appears only after the refresh.
    await expect(storyDoors(page)).toHaveCount(0);
    await reactivate.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(C.confirm.reactivate.title);
    await expect(dialog).toContainText(C.confirm.reactivate.body);
    await dialog.getByRole('button', { name: C.confirm.reactivate.confirm, exact: true }).click();

    // The page refreshes itself into the active state, in place (Pitfall 8): the pill, the note and
    // the button are gone, and the Destaques `+` is there.
    await expect(page.getByText(C.toasts.reactivated, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${communityId}$`));
    await expect(page.getByText(C.archived.pill, { exact: true })).toHaveCount(0);
    await expect(page.getByText(C.archived.note)).toHaveCount(0);
    await expect(page.locator('[data-community-page-reactivate]')).toHaveCount(0);
    await expect(
      destaques(page).getByRole('link', {
        name: ST.own.actionCommunity.replace('{community}', name),
      }),
    ).toBeVisible();

    // …and it is back in Ativas.
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cardWith(page, name)).toHaveCount(1);

    // Leave the shared seed exactly as it was found.
    await archiveThroughTheForm(page, communityId);
    await expect(cards(page)).toHaveCount(SEEDED.total);
  });

  test('a member sees the archived note and no Reativar', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}`);

    await expect(page.getByRole('heading', { name: SEEDED.archived, level: 1 })).toBeVisible();
    await expect(page.getByText(C.archived.note)).toBeVisible();
    await expect(page.locator('[data-community-page-reactivate]')).toHaveCount(0);
  });

  test('the `+` belongs to the admin, on active communities only', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // No highlight + publish AND manage: the section renders with the `+` and the curator's
    // trailing "Gerenciar" (UI-D-53, UI E02; D-108 / D-109 since 05.2-09) — nothing else.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withoutHighlightId}`);
    const plainName = await heading(page);
    expect(plainName.length).toBeGreaterThan(0);
    await expect(destaques(page)).toBeVisible();
    await expect(destaques(page).getByRole('listitem')).toHaveCount(2);
    const door = destaques(page).getByRole('link', {
      name: ST.own.actionCommunity.replace('{community}', plainName),
    });
    await expect(door).toBeVisible();
    await expect(door).toHaveAttribute(
      'href',
      `/stories/publicar?comunidade=${SEEDED.withoutHighlightId}`,
    );
    // "Seu story" is the circle's visible caption, a sibling of the link (the link's name is the
    // community-scoped action label).
    await expect(destaques(page).getByRole('listitem').first()).toContainText(ST.own.label);
    // UI-D-28 as amended (2026-10-02), exactly as on Início: a centred `+` in the dashed "only you
    // see this" ring, never the admin's photo with a badge.
    await expect(door.getByTestId('story-disc-own')).toBeVisible();
    await expect(door.locator('img')).toHaveCount(0);
    await expect(door.getByTestId('story-circle-ring')).toHaveClass(/border-dashed/);

    // A highlight + the permission: the `+` FIRST, then the community's highlight circles.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withHighlightId}`);
    const highlightedName = await heading(page);
    const first = destaques(page).getByRole('listitem').first();
    await expect(
      first.getByRole('link', {
        name: ST.own.actionCommunity.replace('{community}', highlightedName),
      }),
    ).toHaveAttribute('href', `/stories/publicar?comunidade=${SEEDED.withHighlightId}`);
    await expect(first.getByTestId('story-disc-own')).toBeVisible();
    await expect(destaques(page).getByRole('button')).not.toHaveCount(0);

    // D-93 / UI-D-64: an archived community offers no story entry at all — not a disabled one.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}`);
    await expect(page.getByRole('heading', { name: SEEDED.archived, level: 1 })).toBeVisible();
    await expect(storyDoors(page)).toHaveCount(0);

    // A member holds neither permission: no `+`, and with no highlight no section at all.
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withoutHighlightId}`);
    await expect(page.locator('[data-community-name]')).toBeVisible();
    await expect(destaques(page)).toHaveCount(0);
    await expect(storyDoors(page)).toHaveCount(0);
  });
});

/**
 * D-109 / UI-D-72 / UI-D-80 (05.2-09) — a community's highlight MANAGE screen. The admin's row on an
 * ACTIVE community ends with "Gerenciar", which opens `/comunidades/{id}/destaques`; an ARCHIVED
 * community's manage screen, reached by direct link, keeps only the take-downs; a member gets the
 * community's one not-found screen; and the page header of a 60-character community truncates at
 * 320px without pushing the back control off-screen (the UI E04 long-text backstop).
 *
 * The one fixture written — a highlight on the ARCHIVED community, which the API refuses to create —
 * is named `Teste …` and removed in `afterAll`.
 */
test.describe('05.2-09 — the community manage screen (D-109, UI-D-72, UI-D-80)', () => {
  const ST = storyMessages.stories;
  const H = ST.highlights;
  const ARCHIVED_FIXTURE = 'Teste Arquivo';
  /** `SEED_COMMUNITY_IDS['rede-demo'][3]` — the 60-character `SEED_LONG_COMMUNITY_NAME`. */
  const LONG_NAME_ID = '0d000000-0000-4000-8000-0000000000c4';

  test.beforeAll(async () => {
    await deleteHighlightsByTitlePrefix('rede-demo', ARCHIVED_FIXTURE);
    await insertHighlightFixture('rede-demo', SEEDED.archivedId, ARCHIVED_FIXTURE);
  });

  test.afterAll(async () => {
    await deleteHighlightsByTitlePrefix('rede-demo', ARCHIVED_FIXTURE);
    await closeAdmin();
  });

  function destaques(page: Page): Locator {
    return page.getByRole('list', { name: C.page.highlights });
  }

  test('the admin row of an active community ends with "Gerenciar", which opens its manage screen', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withHighlightId}`);
    const name = ((await page.locator('[data-community-name]').textContent()) ?? '').trim();

    const manage = destaques(page).getByRole('link', {
      name: H.circle.actionCommunity.replace('{community}', name),
    });
    await expect(manage).toHaveAttribute(
      'href',
      `/comunidades/${SEEDED.withHighlightId}/destaques`,
    );
    await expect(destaques(page).getByRole('listitem').last()).toContainText(H.circle.label);

    await manage.click();
    await expect(
      page.getByRole('heading', {
        name: H.manage.titleCommunity.replace('{community}', name),
        level: 1,
      }),
    ).toBeVisible();
    const list = page.getByRole('list', { name: H.manage.region });
    await expect(
      list.getByRole('button', {
        name: H.manage.edit.replace('{title}', SEEDED.communityHighlight),
      }),
    ).toBeVisible();
    // One highlight: the handle is there, the drag helper is not (UI E04 zero-one-many).
    await expect(
      list.getByRole('button', {
        name: H.manage.drag.replace('{title}', SEEDED.communityHighlight),
      }),
    ).toBeVisible();
    await expect(page.getByText(H.manage.helper)).toHaveCount(0);
    await expect(page.getByRole('button', { name: H.manage.create })).toBeVisible();
  });

  test('an ARCHIVED community: no "Gerenciar" on its row; its manage screen keeps only the take-downs', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}`);
    await expect(page.getByRole('heading', { name: SEEDED.archived, level: 1 })).toBeVisible();
    await expect(page.locator(`a[href="/comunidades/${SEEDED.archivedId}/destaques"]`)).toHaveCount(
      0,
    );

    // UI-D-80: reached by direct link, the note, no "Novo destaque", no handles.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.archivedId}/destaques`);
    await expect(page.getByText(H.manage.archivedNote)).toBeVisible();
    await expect(page.getByRole('button', { name: H.manage.create })).toHaveCount(0);
    const list = page.getByRole('list', { name: H.manage.region });
    await expect(
      list.getByRole('button', { name: H.manage.drag.replace('{title}', ARCHIVED_FIXTURE) }),
    ).toHaveCount(0);

    // The row still opens the REDUCED edit sheet: only remove and delete remain.
    await list
      .getByRole('button', { name: H.manage.edit.replace('{title}', ARCHIVED_FIXTURE) })
      .click();
    const sheet = page.getByRole('dialog', { name: H.edit.title });
    await expect(sheet.getByText(H.edit.archivedNote)).toBeVisible();
    await expect(sheet.getByRole('button', { name: H.edit.changeCover })).toHaveCount(0);
    await expect(sheet.getByLabel(H.edit.name)).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: H.edit.moveUp })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: H.edit.addStories })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: H.edit.delete })).toBeVisible();
  });

  test('a MEMBER gets the community not-found screen at the manage route', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.withHighlightId}/destaques`);
    await expect(page.getByText(C.notFound.title)).toBeVisible();
    await expect(page.getByRole('button', { name: H.manage.create })).toHaveCount(0);
  });

  test('UI E04 long-text backstop: a 60-character community title truncates at 320px and the back control stays on screen', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the backstop is a phone-width claim');
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${LONG_NAME_ID}/destaques`);

    const title = page.getByRole('heading', {
      name: H.manage.titleCommunity.replace('{community}', SEEDED.longName),
      level: 1,
    });
    await expect(title).toBeVisible();
    // Truncated in CSS (one line, clipped), never wrapped or cut in the string.
    const clipped = await title.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(clipped).toBe(true);
    const back = page.getByRole('link', { name: H.manage.back });
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    const titleBox = await title.boundingBox();
    expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(320);
  });
});

/**
 * 2026-10-03 — the admin's order of the `Ativas` list: "Reordenar" opens a mode of compact rows, each
 * with "Mover para cima" / "Mover para baixo" buttons named after its community (disabled at the
 * ends, focus following the moved row), "Salvar ordem" writes it through `PUT /v1/communities/order`,
 * and every member then reads that order. A member, and `Arquivadas`, never see the control.
 *
 * The moves are made from the KEYBOARD (focus + Enter): that is the path the mode was built for, and
 * it also keeps the phone BottomNav (and the dev overlay over it) out of the way.
 *
 * **It leaves the seed as it found it.** The block runs LAST, records `position` and `updated_at` of
 * every demo community first and puts back each one it moved in `afterAll`, and deletes the one
 * community its stale case creates — so `SEEDED`'s activity order holds for the next project and the
 * next run.
 */
test.describe('2026-10-03 — Reordenar: the admin’s order of the Ativas list', () => {
  const R = C.reorder;
  /** The prefix of the one community this block writes (the stale case's "created meanwhile"). */
  const ORDER_PREFIX = `${E2E_COMMUNITY_PREFIX} ordem`;

  const moveUp = (name: string) => R.moveUp.replace('{community}', name);
  const moveDown = (name: string) => R.moveDown.replace('{community}', name);

  function reorderButton(page: Page): Locator {
    return page.locator('main').getByRole('button', { name: R.start, exact: true });
  }

  function reorderList(page: Page): Locator {
    return page.getByRole('list', { name: R.title });
  }

  async function cardNames(page: Page): Promise<string[]> {
    return cards(page).evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  }

  /** A keyboard user's move: focus the named button, press Enter. */
  async function press(page: Page, name: string): Promise<void> {
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
  }

  type Stamp = { id: string; position: number; updated_at: string };
  let found: Stamp[] = [];
  let db: ReturnType<typeof postgres> | null = null;
  const sql = () => {
    db ??= postgres(
      process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
      { prepare: false, max: 1 },
    );
    return db;
  };

  test.beforeAll(async () => {
    found = await sql()<Stamp[]>`
      select c.id::text as id, c.position, c.updated_at::text as updated_at
        from public.communities c
        join public.tenants t on t.id = c.tenant_id
       where t.slug = 'rede-demo'`;
  });

  test.afterAll(async () => {
    await sql()`delete from public.communities where name like ${`${ORDER_PREFIX}%`}`;
    for (const row of found) {
      await sql()`
        update public.communities
           set position = ${row.position},
               updated_at = ${row.updated_at}::timestamptz
         where id = ${row.id}::uuid
           and (position <> ${row.position} or updated_at <> ${row.updated_at}::timestamptz)`;
    }
    await db?.end();
    db = null;
    await closeAdmin();
  });

  test('a member never sees Reordenar, and neither does Arquivadas', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page)).toHaveCount(SEEDED.total);
    await expect(reorderButton(page)).toHaveCount(0);

    // The positive control: the manager on Ativas has it…
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(reorderButton(page)).toBeVisible();
    // …and not on Arquivadas, where the order of the ACTIVE list has nothing to say.
    await page.goto(`${hosts.demo}/comunidades?status=arquivadas`);
    await expect(cards(page).first()).toBeVisible();
    await expect(reorderButton(page)).toHaveCount(0);
  });

  test('an admin moves a community with the keyboard, saves, and every member reads the new order', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page)).toHaveCount(SEEDED.total);

    await reorderButton(page).click();
    await expect(reorderList(page)).toBeVisible();
    // The mode's heading takes focus, so a screen reader lands on what just opened.
    await expect(page.getByRole('heading', { name: R.title, level: 2 })).toBeFocused();
    await expect(reorderList(page).getByRole('listitem')).toHaveCount(SEEDED.total);
    // Disabled at the ends: the first row cannot go up, the last cannot go down.
    await expect(page.getByRole('button', { name: moveUp(SEEDED.first) })).toBeDisabled();
    await expect(page.getByRole('button', { name: moveDown(SEEDED.tied) })).toBeDisabled();
    // The cards are not on screen while the mode is open.
    await expect(cards(page)).toHaveCount(0);

    // One move down: focus FOLLOWS the row to its new place.
    await press(page, moveDown(SEEDED.first));
    await expect(page.getByRole('button', { name: moveDown(SEEDED.first) })).toBeFocused();
    await expect(reorderList(page).getByRole('listitem').nth(1)).toContainText(SEEDED.first);
    await expect(page.getByRole('button', { name: moveUp(SEEDED.noCover) })).toBeDisabled();

    await page.getByRole('button', { name: R.save, exact: true }).click();
    await expect(page.getByText(C.toasts.reordered, { exact: true })).toBeVisible();
    await expect(reorderList(page)).toHaveCount(0);

    const expected = [SEEDED.noCover, SEEDED.first, SEEDED.longName, SEEDED.tied];
    const check = async () => {
      const names = await cardNames(page);
      expected.forEach((name, index) => {
        expect(names[index], `slot ${index}`).toContain(name);
      });
    };
    await expect(cards(page)).toHaveCount(SEEDED.total);
    await check();

    // It persisted: the server renders the same order on a fresh load…
    await page.reload();
    await expect(cards(page)).toHaveCount(SEEDED.total);
    await check();

    // …and a member reads exactly that order too, with no control of their own.
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page)).toHaveCount(SEEDED.total);
    await check();
    await expect(reorderButton(page)).toHaveCount(0);
  });

  test('Cancelar leaves the order exactly as it was', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(cards(page)).toHaveCount(SEEDED.total);
    const before = await cardNames(page);

    await reorderButton(page).click();
    await expect(reorderList(page)).toBeVisible();
    const firstRow = (await reorderList(page).getByRole('listitem').first().textContent()) ?? '';
    const firstName = [SEEDED.first, SEEDED.noCover, SEEDED.longName, SEEDED.tied].find((name) =>
      firstRow.includes(name),
    );
    expect(firstName, 'the first row is a seeded community').toBeDefined();
    await press(page, moveDown(firstName as string));

    await page.getByRole('button', { name: R.cancel, exact: true }).click();
    await expect(reorderList(page)).toHaveCount(0);
    // Focus returns to the control that opened the mode.
    await expect(reorderButton(page)).toBeFocused();
    expect(await cardNames(page)).toEqual(before);
    await page.reload();
    await expect(cards(page)).toHaveCount(SEEDED.total);
    expect(await cardNames(page)).toEqual(before);
  });

  test('a community created while the mode is open makes the order stale: the list reloads and says so', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await reorderButton(page).click();
    await expect(reorderList(page)).toBeVisible();

    // Somebody else creates a community after this screen read the set.
    const name = `${ORDER_PREFIX} concorrente ${Date.now()}`;
    await createCommunityAs(users.demoAdmin, 'rede-demo', name);

    await press(page, moveUp(SEEDED.tied));
    await page.getByRole('button', { name: R.save, exact: true }).click();

    // The refusal is explained, the mode closes, and the list the admin sees is the server's NOW —
    // the new community (position 0, newest) at its head.
    await expect(page.getByText(R.errors.stale, { exact: true })).toBeVisible();
    await expect(reorderList(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(SEEDED.total + 1);
    await expect(cards(page).first()).toContainText(name);

    // Leave the shared seed as found for every case after this one.
    await sql()`delete from public.communities where name = ${name}`;
  });
});
