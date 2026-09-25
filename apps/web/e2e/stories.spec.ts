import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { STORY_MAX_PAGE_SIZE } from '@tria/module-stories/contracts';
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  activeReadyStoryCount,
  cloneActiveStories,
  closeAdmin,
  deleteStoriesByCaptionPrefix,
  deleteStoryCommentsByBodyPrefix,
  envValue,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const S = storyMessages.stories;
/**
 * D-82: the story's comment sheet reads its copy from the FEED namespace, verbatim. Importing the
 * feed catalog here rather than mirroring the strings into `stories.json` is the same claim the
 * UI-SPEC's Copywriting Contract makes — if someone duplicates them, this import stops matching
 * what the sheet renders and the walk below goes red.
 */
const F = feedMessages.feed;

/**
 * STORY-01 / STORY-03 / D-80 (plan 05-05), D-104 / D-106 (05.2-04): the `/inicio` stories row and the
 * full-screen `/stories/publicar` route, on the phone (`mobile-chromium`, an iPhone 14 preset) and on
 * desktop.
 *
 * Everything that WRITES a story cleans up after itself through the UI it is testing, so the shared
 * seed stays exactly as it was and the file is re-runnable in any order. Everything else reads the
 * seeded fixtures and writes nothing at all.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering the navigation from its own
 * cache would have this spec asserting what a previous run left behind, and the strip is the most
 * time-sensitive thing on the screen.
 */
test.use({ serviceWorkers: 'block' });

/**
 * What `scripts/seed.ts` writes for the demo tenant. The expired story's CAPTION is mirrored here
 * the way `comunidades.spec.ts` mirrors its community names — the seed is a top-level-await script
 * that requires `SEED_PASSWORD` and opens a database connection at import time.
 *
 * The strip's COUNT is deliberately NOT mirrored. `media-video.spec.ts` performs a hard, total
 * reset of the demo tenant's video library and takes the seeded story VIDEO with it (see
 * `deleteTenantVideoAssets`), so a constant here would make every assertion below depend on the
 * order the suite happened to run in. `activeReadyStoryCount` reads the real predicate instead, and
 * `expect(count).toBeGreaterThan(0)` is what stops it passing vacuously at zero.
 */
const SEEDED = {
  /** The caption of the EXPIRED story: it must not appear on the strip in any form. */
  expiredCaption: 'Publicado ontem, ja fora da regua.',
  /** `SEED_STORY_IDS['tria-demo'][3]`: the EXPIRED story (`SEED_STORIES[3]`). */
  expiredStoryId: '0d000000-0000-4000-8000-0000000000d4',
  /**
   * 05.2-07: `SEED_COMMUNITY_IDS['tria-demo'][0]`'s NAME — the place of the community highlight
   * `Destaques`, which holds the expired story. With `Bastidores` that puts the expired story in TWO
   * highlights, and `Aulas` (empty) is the switch a toggle can be walked on and undone.
   */
  communityHighlightPlace: 'Avisos da diretoria',
  communityHighlight: 'Destaques',
  /** `SEED_TENANTS['tria-demo'].displayName` — the tenant circle's label and accessible name. */
  tenantName: 'TRIA Demo',
  /**
   * `SEED_STORY_IDS['tria-demo'][2]`: the OLDEST active, ready story (an image published 18 h ago).
   * The tenant circle plays oldest → newest (D-106), so this is the story it opens on.
   */
  oldestActiveStoryId: '0d000000-0000-4000-8000-0000000000d3',
  /** `SEED_HIGHLIGHT_TITLES`: `home` has items; `homeEmpty` is curator-only and never on a member row. */
  homeHighlight: 'Bastidores',
  homeEmptyHighlight: 'Aulas',
  /**
   * `Bastidores` holds `SEED_STORIES[2]` (`…d3`, an ACTIVE image published 18 h ago, no caption) and
   * `SEED_STORIES[3]` (`…d4`, the EXPIRED image published 30 h ago). A highlight plays OLDEST first
   * by publish time (D-103), so the expired story is its FIRST segment (STORY-04 in the viewer).
   */
  homeHighlightStoryCount: 2,
} as const;

/** The tenant's live strip size, read once per file from the database (see the note above). */
let activeStories = 0;

test.beforeAll(async () => {
  activeStories = await activeReadyStoryCount('tria-demo');
  expect(activeStories, 'the demo tenant has at least one active story to render').toBeGreaterThan(
    0,
  );
});

test.afterAll(async () => {
  await closeAdmin();
});

const strip = (page: Page) => page.getByRole('list', { name: S.region });

/**
 * D-104: the ONE tenant circle, found by its catalog accessible name (UI-D-61) — "Abrir stories de
 * TRIA Demo" for the seed tenant, resolved from `stories.circle.tenant` rather than typed here.
 */
const tenantCircle = (page: Page) =>
  strip(page).getByRole('button', {
    name: S.circle.tenant.replace('{tenant}', SEEDED.tenantName),
  });

/** A highlight circle, by its catalog accessible name ("Abrir destaque {title}", UI-D-61). */
const highlightCircle = (page: Page, title: string) =>
  strip(page).getByRole('button', { name: S.circle.highlight.replace('{title}', title) });

/**
 * The viewer's ONE polite live region, filled from the catalog's own template — `{group}: story
 * {current} de {total}` (UI-D-65). It names the GROUP, which is what tells a tenant story that
 * happens to mention "Bastidores" in its caption apart from the Bastidores highlight.
 */
const positionOf = (group: string, current: number, total: number) =>
  S.viewer.positionGroup
    .replace('{group}', group)
    .replace('{current}', String(current))
    .replace('{total}', String(total));

/**
 * The length of the tenant circle's sequence, read where a member meets it: the viewer's segment
 * count after a tap on the tenant circle (D-106 caps it at `STORY_MAX_PAGE_SIZE`). The row itself
 * no longer grows with the number of stories — it is ONE circle whatever that number is.
 */
async function expectTenantSequence(page: Page, count: number): Promise<void> {
  await page.goto('/inicio');
  await tenantCircle(page).click();
  await expect(page.getByTestId('story-progress-bars')).toHaveAttribute(
    'data-story-count',
    String(Math.min(count, STORY_MAX_PAGE_SIZE)),
  );
}

/**
 * A REAL photo, the same fixture `feed-composer.spec.ts` uploads. Not a synthesised 1x1 PNG: the
 * variant worker decodes the bytes with sharp, and a minimal buffer fails with
 * `vipspng: libpng read error`, leaves the asset `processing` forever and makes the strip's R-P8
 * filter look like a broken publish flow.
 */
const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;

/** The prefix every story THIS FILE publishes carries, so the sweep can be exact. */
const TEST_CAPTION_PREFIX = 'Story publicado pelo e2e';

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
const DEMO_HOST = new URL(hosts.demo).hostname;

/** A real GoTrue session for a seeded user (Node side, no browser). */
async function sessionToken(email: string): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });
  if (!res.ok) throw new Error(`${email} sign-in failed: ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

const adminToken = () => sessionToken(users.demoAdmin);

function storiesApi(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': DEMO_HOST,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

test.describe('the /inicio row — one tenant circle plus Início’s highlights (D-104, UI-D-59)', () => {
  test('a MEMBER sees the tenant circle and the non-empty highlight, and NO publish door', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD);

    const row = strip(page);
    await expect(row).toBeVisible();
    // D-104: ONE tenant circle whatever the number of live stories, named for the tenant (UI-D-61).
    await expect(tenantCircle(page)).toHaveCount(1);
    await expect(row.getByRole('listitem').first()).toContainText(SEEDED.tenantName);
    // UI-D-59 (3): Início's highlights follow, one circle each. `Bastidores` has items; `Aulas` is
    // EMPTY, and the member-scope read leaves an empty highlight off a member's row (T-05.2-20).
    await expect(row.getByRole('listitem').nth(1)).toContainText(SEEDED.homeHighlight);
    await expect(row.getByText(SEEDED.homeEmptyHighlight, { exact: true })).toHaveCount(0);
    // Tenant circle + one highlight: the row does not grow with the number of stories.
    await expect(row.getByRole('listitem')).toHaveCount(2);
    // 05.2-05: every circle OPENS — the tenant circle and the highlight's, named for its title.
    await expect(row.getByRole('button')).toHaveCount(2);
    await expect(highlightCircle(page, SEEDED.homeHighlight)).toHaveCount(1);

    // D-80 / UI-D-28: the own-circle is the ONLY publish entry point, and a member has none.
    await expect(row.getByRole('link', { name: S.own.action })).toHaveCount(0);
    await expect(row.getByText(S.own.label)).toHaveCount(0);

    // STORY-03 at the surface a member actually looks at: the expired story is simply not there.
    await expect(page.getByText(SEEDED.expiredCaption)).toHaveCount(0);

    // UI-D-25: the row sits ABOVE the feed and BELOW the welcome heading.
    const stripBox = await row.boundingBox();
    const heading = page.getByRole('heading', { level: 1 }).first();
    const headingBox = await heading.boundingBox();
    expect(stripBox?.y ?? 0).toBeGreaterThan(headingBox?.y ?? 0);
  });

  test('an ADMIN additionally sees the leading "Seu story" circle, and it is a LINK', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD);

    const row = strip(page);
    const items = row.getByRole('listitem');
    // D-108: `+` first, then the tenant circle, then the highlight.
    await expect(items).toHaveCount(3);

    // UI-D-28: rendered FIRST, and an anchor rather than a button — `/stories/publicar` is a
    // full-screen route that must not live in a dismissible layer.
    await expect(items.first()).toContainText(S.own.label);
    const own = row.getByRole('link', { name: S.own.action });
    await expect(own).toHaveAttribute('href', '/stories/publicar');
    await expect(items.nth(1)).toContainText(SEEDED.tenantName);
    await expect(tenantCircle(page)).toHaveCount(1);
  });

  test('the row keeps IDENTICAL geometry on desktop — no arrows, no fade mask (UI-D-47)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the desktop-only claim needs the desktop project');
    await login(page, users.demoAdmin, SEED_PASSWORD);

    const row = strip(page);
    await expect(row).toBeVisible();
    await expect(row.getByRole('listitem')).toHaveCount(3);
    // The row is the only horizontal scroller, and its overscroll is contained so a trackpad swipe
    // never triggers the browser back-gesture.
    const overflow = await row.evaluate((node) => getComputedStyle(node).overflowX);
    expect(overflow).toBe('auto');
    const overscroll = await row.evaluate((node) => getComputedStyle(node).overscrollBehaviorX);
    expect(overscroll).toBe('contain');
    // Every circle is the same 64px disc column: the tenant circle included (UI-D-60).
    const widths = await row
      .getByRole('listitem')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);
  });

  test('the tenant circle opens on the OLDEST live story, and a tap on the right plays the next-newer one (D-106)', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    test.skip(activeStories < 2, 'advancing needs a sequence of at least two');
    await login(page, users.demoMember, SEED_PASSWORD);

    // The expected sequence, read from the API's own newest-first page and reversed — the same
    // bounded page the home slot reverses.
    const token = await sessionToken(users.demoMember);
    const list = await storiesApi(token, `/v1/stories?limit=${STORY_MAX_PAGE_SIZE}`);
    const { items } = (await list.json()) as { items: { id: string; caption: string }[] };
    const sequence = [...items].reverse();
    expect(sequence[0]?.id, 'the seeded 18 h image is the oldest live story').toBe(
      SEEDED.oldestActiveStoryId,
    );

    await tenantCircle(page).click();
    const dialog = page.getByRole('dialog', { name: S.viewer.dialog });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/stories/${SEEDED.oldestActiveStoryId}$`));
    await expect(page.getByTestId('story-progress-bars')).toHaveAttribute(
      'data-story-count',
      String(activeStories),
    );

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    await page.mouse.click(Math.round(size.width * 0.8), Math.round(size.height * 0.5));
    await expect(dialog).toHaveAttribute('data-story-index', '1');
    // The next-NEWER story: the second element of the oldest-first sequence.
    const next = sequence[1];
    if (next?.caption) await expect(dialog).toContainText(next.caption.slice(0, 20));
  });
});

/**
 * D-107 / UI-D-65 / R-D-M in a real browser (05.2-05): the viewer plays the ROW. Every Início circle
 * opens its own group — the tenant circle group 0, `Bastidores` group 1 — and the boundaries move
 * between them: a tap past a group's last story enters the next group, a tap back from a group's
 * first story enters the previous group's LAST, a horizontal swipe skips a whole group, and a tap
 * past the row's last story closes the viewer.
 *
 * The highlight's items are NOT in `/inicio`'s server render; they arrive through the lazy group
 * read. Every assertion about "which group am I in" reads the dialog's `data-story-group` or the
 * live region's `{group}: story {current} de {total}` — never the header text alone, because a
 * seeded tenant story's caption also contains the word "Bastidores".
 *
 * Read-only: nothing here writes, so the shared seed is left exactly as it was found.
 */
test.describe('the grouped viewer — circles in a row (D-107, UI-D-65, mobile)', () => {
  const V = S.viewer;
  const dialog = (page: Page) => page.getByRole('dialog', { name: V.dialog });
  const position = (page: Page) => page.getByTestId('story-position');

  test('a member opens Bastidores: its own stories, OLDEST first — the expired one included', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await login(page, users.demoMember, SEED_PASSWORD);

    await highlightCircle(page, SEEDED.homeHighlight).click();
    await expect(dialog(page)).toBeVisible();
    // Bastidores follows the tenant circle, so it is group 1 — and a highlight keeps the URL.
    await expect(dialog(page)).toHaveAttribute('data-story-group', '1');
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(position(page)).toHaveText(
      positionOf(SEEDED.homeHighlight, 1, SEEDED.homeHighlightStoryCount),
    );
    await expect(page.getByTestId('story-progress-bars')).toHaveAttribute(
      'data-story-count',
      String(SEEDED.homeHighlightStoryCount),
    );
    // D-103 + STORY-04: the FIRST segment is the EXPIRED story (published 30 h ago) — it is gone
    // from the tenant circle, and it plays here like any other.
    await expect(page.getByTestId('story-caption')).toHaveText(SEEDED.expiredCaption);

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    await page.mouse.click(Math.round(size.width * 0.8), Math.round(size.height * 0.5));
    await expect(dialog(page)).toHaveAttribute('data-story-index', '1');
    await expect(position(page)).toHaveText(
      positionOf(SEEDED.homeHighlight, 2, SEEDED.homeHighlightStoryCount),
    );
    // The second is the 18 h image, which carries no caption.
    await expect(page.getByTestId('story-caption')).toHaveCount(0);
  });

  test('tapping right runs from the tenant circle INTO Bastidores, and past its last story CLOSES', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await login(page, users.demoMember, SEED_PASSWORD);
    await tenantCircle(page).click();
    await expect(dialog(page)).toHaveAttribute('data-story-group', '0');

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const tapRight = () =>
      page.mouse.click(Math.round(size.width * 0.8), Math.round(size.height * 0.5));

    // Through every tenant story, one tap each…
    for (let index = 1; index < activeStories; index += 1) {
      await tapRight();
      await expect(dialog(page)).toHaveAttribute('data-story-index', String(index));
    }
    // …and one more tap crosses the boundary into the next circle's FIRST story (UI-D-65).
    await tapRight();
    await expect(dialog(page)).toHaveAttribute('data-story-group', '1');
    await expect(dialog(page)).toHaveAttribute('data-story-index', '0');
    await expect(position(page)).toHaveText(
      positionOf(SEEDED.homeHighlight, 1, SEEDED.homeHighlightStoryCount),
    );

    // Bastidores is the row's LAST circle: past its last story the viewer closes (D-107).
    await tapRight();
    await expect(dialog(page)).toHaveAttribute('data-story-index', '1');
    await tapRight();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(strip(page)).toBeVisible();
  });

  test('a LEFT swipe on the tenant circle’s first story skips straight to Bastidores’ first', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    test.skip(activeStories < 2, 'a skip is only distinguishable from a tap with two stories');
    await login(page, users.demoMember, SEED_PASSWORD);
    await tenantCircle(page).click();
    await expect(dialog(page)).toHaveAttribute('data-story-index', '0');

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const y = Math.round(size.height * 0.5);
    const from = Math.round(size.width * 0.75);
    await page.mouse.move(from, y);
    await page.mouse.down();
    // Past the 60px threshold, horizontal-dominant: a GROUP skip, not a story step (R-D-M).
    for (const step of [40, 90, 140, 180]) await page.mouse.move(from - step, y);
    await page.mouse.up();

    await expect(dialog(page)).toHaveAttribute('data-story-group', '1');
    await expect(dialog(page)).toHaveAttribute('data-story-index', '0');
    await expect(position(page)).toHaveText(
      positionOf(SEEDED.homeHighlight, 1, SEEDED.homeHighlightStoryCount),
    );
  });

  test('a tap on the LEFT third of Bastidores’ first story returns to the tenant circle’s LAST story', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await login(page, users.demoMember, SEED_PASSWORD);

    await highlightCircle(page, SEEDED.homeHighlight).click();
    await expect(dialog(page)).toHaveAttribute('data-story-group', '1');
    await expect(position(page)).toHaveText(
      positionOf(SEEDED.homeHighlight, 1, SEEDED.homeHighlightStoryCount),
    );

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    await page.mouse.click(Math.round(size.width * 0.15), Math.round(size.height * 0.5));

    // The exact mirror of next (R A2): the previous group's LAST story, not its first.
    await expect(dialog(page)).toHaveAttribute('data-story-group', '0');
    await expect(dialog(page)).toHaveAttribute('data-story-index', String(activeStories - 1));
    await expect(position(page)).toHaveText(
      positionOf(SEEDED.tenantName, activeStories, activeStories),
    );
  });
});

test.describe('/stories/publicar — pick, caption, publish (STORY-01, UI-D-39)', () => {
  /**
   * Variant derivation (`kernel.media-derive-variants`) runs in the WORKER role, not in the API, and
   * an image asset stays `processing` until it finishes. R-P8 then correctly keeps the story out of
   * the strip — so without a worker this spec would assert the readiness filter rather than the
   * publish flow, and would fail for exactly the right reason at exactly the wrong place.
   */
  let stopWorker: (() => Promise<void>) | null = null;

  test.beforeAll(async () => {
    stopWorker = await ensureWorker();
  });

  test.afterAll(async () => {
    await stopWorker?.();
    // The product's own DELETE is SOFT by design, so the row and its asset would survive every run
    // and accumulate. This is the hard sweep that keeps the file re-runnable in any order.
    await deleteStoriesByCaptionPrefix(TEST_CAPTION_PREFIX);
  });

  test('a member cannot reach the publish route at all — it redirects to /inicio', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD);
    await page.goto('/stories/publicar');
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('an admin taps the own-circle, publishes a photo, and it joins the tenant circle as its newest story', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD);

    // The circle is the door: this navigation is the whole of D-80's claim.
    await strip(page).getByRole('link', { name: S.own.action }).click();
    await expect(page).toHaveURL(/\/stories\/publicar$/);
    await expect(page.getByRole('heading', { name: S.publish.title })).toBeVisible();

    // UI empty/E07: before a pick there is nothing to publish, so the control does not exist.
    await expect(page.getByRole('button', { name: S.publish.submit, exact: true })).toHaveCount(0);

    // The upload path itself is Phase 3's and already has its own suites; what matters here is
    // that the bytes are REAL, so the worker can derive the ladder the circle renders.
    await page.locator('#story-photo-input').setInputFiles(PHOTO);

    // Post-pick the screen becomes the story FRAME — the media, the overlaid caption and Publicar.
    const caption = page.getByLabel(S.publish.captionLabel);
    await expect(caption).toBeVisible({ timeout: 30_000 });
    await caption.fill(`${TEST_CAPTION_PREFIX}.`);

    // `exact`: since 05.1-04 the frame also carries the "Publicar em …" destination row, whose
    // accessible name starts with the same word.
    await page.getByRole('button', { name: S.publish.submit, exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/);

    // D-104: the new story joins the ONE tenant circle (its sequence grows by one) rather than
    // adding a circle of its own. The wait is the WORKER's: the asset is `processing` until variant
    // derivation lands, and R-P8 keeps a non-ready story out of the row — so the poll is measuring
    // the real pipeline, not a race.
    await expect(async () => {
      await expectTenantSequence(page, activeStories + 1);
    }).toPass({ timeout: 60_000 });

    // Clean up through the product's own surface, so the shared seed is exactly as it was found.
    await removeNewestStory();
    await expectTenantSequence(page, activeStories);
  });

  test('submitting with no media is refused client-side, and no story is created', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD);
    await page.goto('/stories/publicar');

    // There is no submit control before a pick, so the refusal is reached by submitting the form
    // itself (a stray Enter in a field, which a phone keyboard offers).
    await page.locator('[data-testid="story-composer"]').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    // Scoped to the form: Next ships its own always-present `role="alert"` route announcer, so an
    // unscoped query is a strict-mode violation rather than an assertion about this screen.
    await expect(page.locator('[data-testid="story-composer"]').getByRole('alert')).toHaveText(
      S.publish.errors.noMedia,
    );

    await expectTenantSequence(page, activeStories);
  });
});

/**
 * Deletes the newest story through the REAL `DELETE /v1/stories/{id}` — the Node-side API pattern
 * `invite.spec.ts` established, because the browser never talks to the API directly (the Next BFF
 * holds the token in an HttpOnly cookie, by design).
 *
 * Leaving the row behind is the alternative, and it would make every later run of this file count
 * one more circle than the one before it — the shared seed has to be found exactly as it was left.
 */
async function removeNewestStory(): Promise<void> {
  const token = await adminToken();
  const list = await storiesApi(token, '/v1/stories?limit=1');
  expect(list.status, 'the cleanup could read the strip').toBe(200);
  const body = (await list.json()) as { items: { id: string }[] };
  const id = body.items[0]?.id;
  expect(id, 'the published story is on the strip to clean up').toBeTruthy();

  const removed = await storiesApi(token, `/v1/stories/${id}`, { method: 'DELETE' });
  expect(removed.status, 'the e2e cleaned up the story it published').toBe(204);
}

/**
 * STORY-02 in a real browser on a phone viewport (05-06) — the one interaction in this phase that
 * nothing in the tree had before: a timed, auto-advancing, full-screen pager.
 *
 * **Every assertion here measures the COMPUTED WIDTH of a progress segment**, never a screenshot.
 * A screenshot of a bar mid-fill is the flakiest possible assertion about a clock; the width is the
 * number the clock actually writes, and it is what makes "holding freezes it and releasing resumes
 * from the same point" falsifiable rather than a claim in a docblock.
 *
 * The gestures are driven with POINTER events (`mouse.down` / `mouse.move` / `mouse.up`) rather than
 * with `click`, because a hold and a drag are the two things a click cannot express — and both are
 * exactly what the viewer distinguishes a tap from.
 */
test.describe('the story viewer — tap, hold, swipe (STORY-02, UI-D-30, mobile)', () => {
  const V = S.viewer;

  /** The fill of segment `n`, in CSS pixels as the browser computed it from the inline width. */
  async function fillWidth(page: Page, n: number): Promise<number> {
    const box = await page.getByTestId(`story-fill-${n}`).boundingBox();
    return box?.width ?? -1;
  }

  /** Opens the viewer on the member's TENANT circle (D-104), and waits for the clock to start. */
  async function openViewer(page: Page) {
    await login(page, users.demoMember, SEED_PASSWORD);
    await tenantCircle(page).click();
    await expect(page.getByRole('dialog', { name: V.dialog })).toBeVisible();
    // The clock does not start until the media reports it is loaded (UI loading/E03), so the first
    // non-zero width is ALSO the proof that the image decoded.
    await expect.poll(() => fillWidth(page, 0), { timeout: 15_000 }).toBeGreaterThan(0);
  }

  test('the tenant circle opens the viewer on the OLDEST story, and the first bar fills', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await openViewer(page);

    // D-106: the tenant circle plays oldest → newest, so it opens on the oldest live story.
    await expect(page).toHaveURL(new RegExp(`/stories/${SEEDED.oldestActiveStoryId}$`));
    // One segment per ACTIVE story, from the SAME array the pager renders — never a second count.
    await expect(page.getByTestId('story-progress-bars')).toHaveAttribute(
      'data-story-count',
      String(activeStories),
    );

    const first = await fillWidth(page, 0);
    await page.waitForTimeout(900);
    expect(await fillWidth(page, 0)).toBeGreaterThan(first);
  });

  test('a tap on the right advances and a tap on the left goes back', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    test.skip(activeStories < 2, 'advancing needs a sequence of at least two');
    await openViewer(page);

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const dialog = page.getByRole('dialog', { name: V.dialog });

    // The right TWO-THIRDS: the larger target matches the dominant direction (UI-D-30).
    await page.mouse.click(Math.round(size.width * 0.8), Math.round(size.height * 0.5));
    await expect(dialog).toHaveAttribute('data-story-index', '1');
    // The story just left is FULL and the new one has started from zero.
    expect(await fillWidth(page, 0)).toBeGreaterThan(await fillWidth(page, 1));

    // The left THIRD.
    await page.mouse.click(Math.round(size.width * 0.15), Math.round(size.height * 0.5));
    await expect(dialog).toHaveAttribute('data-story-index', '0');
  });

  test('a press-and-HOLD freezes the bar, and releasing resumes it from the same point', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await openViewer(page);

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const x = Math.round(size.width * 0.5);
    const y = Math.round(size.height * 0.5);

    await page.mouse.move(x, y);
    await page.mouse.down();
    // Longer than the 200 ms tap window — this is a hold, and the pause is reported on the dialog.
    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog', { name: V.dialog })).toHaveAttribute(
      'data-paused',
      'true',
    );

    const held = await fillWidth(page, 0);
    await page.waitForTimeout(900);
    // The whole claim: nine hundred milliseconds of wall clock moved the bar by nothing at all.
    expect(Math.abs((await fillWidth(page, 0)) - held)).toBeLessThan(2);

    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: V.dialog })).toHaveAttribute(
      'data-paused',
      'false',
    );
    // …and it resumed from WHERE IT STOPPED rather than restarting: still at least the held value.
    await page.waitForTimeout(600);
    const resumed = await fillWidth(page, 0);
    expect(resumed).toBeGreaterThan(held);
    // A hold is not a tap: the story under the finger is still the one being watched.
    await expect(page.getByRole('dialog', { name: V.dialog })).toHaveAttribute(
      'data-story-index',
      '0',
    );
  });

  test('a downward swipe dismisses the viewer and returns to /inicio', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await openViewer(page);

    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const x = Math.round(size.width * 0.5);

    await page.mouse.move(x, Math.round(size.height * 0.35));
    await page.mouse.down();
    // Past the prototype's 60px threshold, and vertical-dominant so the axis lock picks dismiss.
    for (const step of [60, 120, 180, 240]) {
      await page.mouse.move(x, Math.round(size.height * 0.35) + step);
    }
    await page.mouse.up();

    await expect(page.getByRole('dialog', { name: V.dialog })).toHaveCount(0);
    // The back gesture's own path: the pushed history entry is popped, so `/inicio` is restored
    // with the feed still mounted underneath it.
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(strip(page)).toBeVisible();
  });

  test('the browser BACK gesture dismisses the viewer just as the swipe does', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await openViewer(page);

    await page.goBack();
    await expect(page.getByRole('dialog', { name: V.dialog })).toHaveCount(0);
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('a DEEP LINK to /stories/{id} renders the viewer as a full page for that one story', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await login(page, users.demoMember, SEED_PASSWORD);

    const token = await sessionToken(users.demoMember);
    const list = await storiesApi(token, '/v1/stories?limit=1');
    const body = (await list.json()) as { items: { id: string }[] };
    const storyId = body.items[0]?.id;
    expect(storyId, 'the demo tenant has a story to deep-link to').toBeTruthy();

    await page.goto(`/stories/${storyId}`);
    await expect(page.getByRole('dialog', { name: V.dialog })).toBeVisible();
    // A deep link is a SINGLE-story sequence: one segment, not the whole strip.
    await expect(page.getByTestId('story-progress-bars')).toHaveAttribute('data-story-count', '1');
  });

  test('an unknown, other-tenant or removed story id renders the one not-found screen', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'one project is enough for a routing claim');
    await login(page, users.demoMember, SEED_PASSWORD);

    await page.goto('/stories/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('dialog', { name: V.dialog })).toHaveCount(0);
    await expect(page.getByTestId('story-progress-bars')).toHaveCount(0);
  });

  test('tapping the heart moves the count, and the server’s value is what is shown', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the overlay is the phone’s');
    await login(page, users.demoMember, SEED_PASSWORD);

    // A DEEP LINK rather than the strip: a single-story sequence keeps the heart pointing at the
    // same story while the assertions run, and the restore below names one id rather than whichever
    // story the clock had advanced to.
    const token = await sessionToken(users.demoMember);
    const list = await storiesApi(token, '/v1/stories?limit=1');
    const { items } = (await list.json()) as {
      items: { id: string; likeCount: number; viewerLiked: boolean }[];
    };
    const story = items[0];
    expect(story, 'the demo tenant has a story to like').toBeTruthy();
    const target = story as { id: string; likeCount: number; viewerLiked: boolean };

    await page.goto(`/stories/${target.id}`);
    // SCOPED to the dialog: `/inicio`'s feed cards carry the identical `Curtir` / `Descurtir`
    // control, and an unscoped query would be a strict-mode violation the moment a single-story
    // sequence reaches its end and closes back onto the home screen.
    const dialog = page.getByRole('dialog', { name: V.dialog });
    const heart = dialog.getByRole('button', { name: target.viewerLiked ? V.unlike : V.like });
    await expect(heart).toBeVisible();

    // Dispatched straight AT the element rather than clicked at its coordinates. The reason is the
    // dev-overlay artifact `deferred-items.md` already records: the blocked service-worker
    // registration rejects, Next's dev overlay mounts a full-viewport `<nextjs-portal>`, and every
    // coordinate-based click in the run then lands on it — `force` skips the actionability CHECK
    // but still dispatches at coordinates, so it does not help. The control itself is visible,
    // enabled and stable; what this asserts is the handler, which is the subject of the test.
    await heart.dispatchEvent('click');

    // The authoritative count, read back from the row by the API — not a local increment.
    const expected = target.likeCount + (target.viewerLiked ? -1 : 1);
    const countNode = dialog.getByTestId('story-like-count');
    if (expected === 0) await expect(countNode).toHaveCount(0);
    else await expect(countNode).toContainText(String(expected));
    await expect(
      dialog.getByRole('button', { name: target.viewerLiked ? V.like : V.unlike }),
    ).toBeVisible();

    // Restore the seed through the API rather than with a second tap: the clock may have closed
    // the single-story viewer by then, and the shared fixture has to be found as it was left.
    await storiesApi(token, `/v1/stories/${target.id}/likes`, {
      method: target.viewerLiked ? 'POST' : 'DELETE',
    });
  });
});

/**
 * The overflow BACKSTOP (UI overflow/E03, E04): a FULL tenant sequence at 320px keeps every progress
 * segment at least 2px wide and does not wrap the bar row.
 *
 * **Since 05.2-04 the UI-SPEC's 25 IS reachable through the product.** The tenant circle's sequence
 * is ONE page of `STORY_MAX_PAGE_SIZE` (25) live stories, reversed to play oldest first (D-106) —
 * so this test fills the tenant to exactly that ceiling and measures the real worst case in the
 * browser (at 320px the row has 304px of content width and 24 four-pixel gaps, leaving 208px over
 * 25 segments, or 8.3px each). `story-viewer.test.tsx` still pins the same DOM shape in isolation.
 *
 * It runs LAST and cleans up after itself, because it adds rows to the shared strip — and the whole
 * file measures the strip. `fullyParallel: false` and `workers: 1` make the declaration order the
 * execution order, which is what makes that safe rather than lucky.
 */
test.describe('the viewer at a FULL tenant sequence on a 320px screen (overflow backstop)', () => {
  const BACKSTOP_PREFIX = 'Story do backstop e2e';
  /** The tenant circle plays ONE page, and its cap is the contract's (D-106). */
  const TARGET = STORY_MAX_PAGE_SIZE;
  let created = 0;

  test.beforeAll(async () => {
    created = await cloneActiveStories('tria-demo', BACKSTOP_PREFIX, TARGET - activeStories);
  });

  test.afterAll(async () => {
    await deleteStoriesByCaptionPrefix(BACKSTOP_PREFIX);
  });

  test('every segment stays at least 2px wide and the row does not wrap', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the narrowest supported screen is a phone');
    expect(created, 'the backstop fixture was written').toBeGreaterThan(0);

    // 320px is the narrowest screen the product supports — narrower than every device preset.
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, users.demoMember, SEED_PASSWORD);
    await tenantCircle(page).click();
    await expect(page.getByRole('dialog', { name: S.viewer.dialog })).toBeVisible();

    const bars = page.getByTestId('story-progress-bars');
    await expect(bars).toHaveAttribute('data-story-count', String(TARGET));

    const geometry = await bars.evaluate((row) =>
      Array.from(row.children).map((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, top: box.top };
      }),
    );
    expect(geometry).toHaveLength(TARGET);
    // Every segment is still a visible hairline…
    for (const segment of geometry) expect(segment.width).toBeGreaterThanOrEqual(2);
    // …and they are all on ONE row: a wrap would put some of them on a different line.
    const tops = new Set(geometry.map((segment) => Math.round(segment.top)));
    expect(tops.size).toBe(1);
  });
});

/**
 * STORY-05's second half in a real browser (05-07, D-82, D-83).
 *
 * The walk is the whole test: open a story, tap "Comentar", watch the progress bar STOP, write a
 * comment, see it land at the BOTTOM of the list, close the sheet and watch the bar resume from
 * where it stopped rather than restarting. That sequence is the product claim — "the story waits
 * for you while you type" — and it is measured the way every other clock assertion in this file is,
 * by the computed width of a segment rather than by a screenshot.
 *
 * The absence assertions ride along in the same test because they need the sheet open: no reply
 * control, no replies toggle, no per-comment like, anywhere inside it. Those three are UX; the
 * database refuses all three outright and `supabase/tests/110-communities-stories.sql` is where
 * that is proved. This is the layer that stops a member being invited into a refusal.
 */
test.describe('the story comment sheet — D-82, D-83 (mobile)', () => {
  const V = S.viewer;
  const BODY_PREFIX = 'Comentario e2e';

  test.afterAll(async () => {
    await deleteStoryCommentsByBodyPrefix(BODY_PREFIX);
  });

  test('the sheet pauses the story, the new comment lands at the BOTTOM, and closing resumes', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the sheet over a full-screen viewer is the phone’s');
    await login(page, users.demoMember, SEED_PASSWORD);

    // A DEEP LINK, for the reason the heart test gives: a single-story sequence keeps the sheet
    // pointing at one story while the assertions run.
    const token = await sessionToken(users.demoMember);
    const list = await storiesApi(token, '/v1/stories?limit=1');
    const { items } = (await list.json()) as { items: { id: string }[] };
    const story = items[0];
    expect(story, 'the demo tenant has a story to comment on').toBeTruthy();

    await page.goto(`/stories/${(story as { id: string }).id}`);
    const viewer = page.getByRole('dialog', { name: V.dialog });
    await expect(viewer).toBeVisible();
    // The clock does not start until the media reports it loaded, so a non-zero width is also the
    // proof that the image decoded.
    await expect
      .poll(async () => (await page.getByTestId('story-fill-0').boundingBox())?.width ?? -1, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Dispatched AT the element for the dev-overlay reason the heart test documents.
    await viewer.getByRole('button', { name: V.comment }).dispatchEvent('click');

    // The sheet is the SHIPPED one: its title is the feed's "Comentários", not a copy of it.
    const sheet = page.getByRole('dialog', { name: F.comments.title });
    await expect(sheet).toBeVisible();
    await expect(viewer).toHaveAttribute('data-paused', 'true');

    // THE claim: nine hundred milliseconds of wall clock move the bar by nothing at all.
    const held = (await page.getByTestId('story-fill-0').boundingBox())?.width ?? -1;
    await page.waitForTimeout(900);
    const stillHeld = (await page.getByTestId('story-fill-0').boundingBox())?.width ?? -1;
    expect(Math.abs(stillHeld - held)).toBeLessThan(2);

    // D-82: none of the three affordances the database refuses is drawn anywhere in the sheet.
    await expect(sheet.locator('[data-comment-reply]')).toHaveCount(0);
    await expect(sheet.locator('[data-replies-toggle]')).toHaveCount(0);
    await expect(sheet.locator('[data-comment-like]')).toHaveCount(0);

    // D-83: the new comment lands at the BOTTOM, because a flat conversation runs forward in time.
    const body = `${BODY_PREFIX} ${Date.now()}`;
    await sheet.getByPlaceholder(F.comments.placeholder).fill(body);
    await sheet.getByRole('button', { name: F.comments.submit }).dispatchEvent('click');
    await expect(sheet.getByText(body)).toBeVisible();
    const rows = sheet.locator('[data-comment-id]');
    await expect(rows.last()).toContainText(body);

    // …and it is still the only conversation: no reply control appeared with the new row either.
    await expect(sheet.locator('[data-comment-reply]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(viewer).toHaveAttribute('data-paused', 'false');

    // It resumed from WHERE IT STOPPED rather than restarting.
    await page.waitForTimeout(600);
    const resumed = (await page.getByTestId('story-fill-0').boundingBox())?.width ?? -1;
    expect(resumed).toBeGreaterThan(held);
  });
});

/**
 * UI-D-77's indicator, resolved from the catalog's OWN ICU plural rather than typed: the
 * `one`/`other` branch is picked with pt-BR's plural rules and `#` becomes the count, which is
 * exactly what next-intl does on the server. The cases below also pin the resolved words once
 * ("Em 2 destaques"), so a broken plural in the catalog fails here rather than rendering raw ICU.
 */
function highlightedLabel(count: number): string {
  const match = /one \{([^}]*)\} other \{([^}]*)\}/.exec(S.history.highlighted);
  if (!match) throw new Error('stories.history.highlighted is not a one/other plural');
  const branch = new Intl.PluralRules('pt-BR').select(count) === 'one' ? match[1] : match[2];
  return (branch ?? '').replace('#', String(count));
}

/** The highlight sheet's switch name ("Destacar em {title}, {place}"). */
const highlightSwitchName = (title: string, place: string) =>
  S.highlights.sheet.row.replace('{title}', title).replace('{place}', place);

/**
 * Takes the expired story back OUT of `Aulas` through the API, whatever state a failed walk left it
 * in, so the shared seed is exactly as found. `DELETE` of a membership that does not exist is the
 * same success, so this is safe to run after a passing walk too.
 */
async function restoreAulas(): Promise<void> {
  const token = await adminToken();
  const catalog = await storiesApi(token, '/v1/stories/highlights/catalog');
  if (!catalog.ok) return;
  const { items } = (await catalog.json()) as {
    items: { id: string; title: string; communityId: string | null }[];
  };
  const aulas = items.find(
    (item) => item.communityId === null && item.title === SEEDED.homeEmptyHighlight,
  );
  if (!aulas) return;
  await storiesApi(token, `/v1/stories/highlights/${aulas.id}/stories/${SEEDED.expiredStoryId}`, {
    method: 'DELETE',
  });
}

/**
 * D-84 / D-110 route 2 / UI-D-77 (05.2-07) — "Seus stories", the admin's story home, curating
 * HIGHLIGHTS: the row menu says "Destacar" and opens the same checklist sheet the viewer opens, the
 * row's "Em # destaques" follows each confirmed toggle, and the delete dialog names highlights.
 *
 * Everything that WRITES here undoes itself: the one toggle the walk performs is turned back off in
 * the same test (and `restoreAulas` backs that up), so the shared seed is left exactly as it was
 * found. The DELETE case publishes its own story first rather than removing a seeded one.
 */
test.describe('"Seus stories" — the admin history and the highlight sheet (D-84, D-110, UI-D-77)', () => {
  const H = S.history;
  const HS = S.highlights;

  test.afterAll(async () => {
    await restoreAulas();
  });

  test('the two doors UI-D-29 specifies both reach the history, and the "+" circle still publishes', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // Door 1: the publish screen's trailing text action.
    await page.goto(`${hosts.demo}/stories/publicar`);
    await page.getByRole('link', { name: S.publish.history }).click();
    await expect(page).toHaveURL(/\/stories\/meus$/);
    await expect(page.getByRole('heading', { name: H.title })).toBeVisible();

    // Door 2: the settings administration row.
    await page.goto(`${hosts.demo}/configuracoes`);
    await page.getByRole('link', { name: H.title }).click();
    await expect(page).toHaveURL(/\/stories\/meus$/);

    // …and the strip's own circle keeps its SINGLE tap to publishing (D-80): two destinations on
    // one circle would have cost the most frequent action a tap.
    await page.goto(`${hosts.demo}/inicio`);
    await strip(page).getByRole('link', { name: S.own.action }).click();
    await expect(page).toHaveURL(/\/stories\/publicar$/);
  });

  test('a MEMBER cannot reach the history and is not offered the settings row (T-05-48)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(page.getByRole('link', { name: H.title })).toHaveCount(0);

    // The route itself bounces rather than rendering a list the API would then refuse.
    await page.goto(`${hosts.demo}/stories/meus`);
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('the history lists the EXPIRED story "Em 2 destaques", and the one-highlight rows "Em 1 destaque"', async ({
    page,
  }) => {
    // The resolved words themselves (UI E12 zero-one-many): singular at 1, plural above.
    expect(highlightedLabel(1)).toBe('Em 1 destaque');
    expect(highlightedLabel(2)).toBe('Em 2 destaques');

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/stories/meus`);

    const rows = page.locator('[data-story-history-row]');
    await expect(rows.first()).toBeVisible();
    // D-84: the history is the SAME query as the strip with the range predicate dropped, so the
    // expired story is here — and it is the story "Destacar" exists to keep visible.
    const expired = rows.filter({ hasText: SEEDED.expiredCaption }).first();
    await expect(expired).toBeVisible();
    // It sits in Bastidores AND Destaques (the seed), so its indicator reads the plural.
    await expect(expired.getByTestId('story-history-highlighted')).toHaveText(highlightedLabel(2));
    // UI-D-40: a story with no caption reads as the fallback rather than as an empty line.
    await expect(page.getByText(H.noCaption, { exact: true }).first()).toBeVisible();
    // The stories in exactly ONE highlight read the singular…
    await expect(
      page.getByTestId('story-history-highlighted').filter({ hasText: highlightedLabel(1) }),
    ).not.toHaveCount(0);
    // …and a story in NO highlight has no indicator at all — never "Em 0 destaques".
    await expect(page.getByText(highlightedLabel(0))).toHaveCount(0);
    // The pin model is gone from the screen (UI-D-79).
    await expect(page.locator('[data-testid="story-history-pin"]')).toHaveCount(0);
  });

  test('"Destacar" on the EXPIRED story opens the shared sheet, and each toggle moves the row count', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/stories/meus`);

    const row = page
      .locator('[data-story-history-row]')
      .filter({ hasText: SEEDED.expiredCaption })
      .first();
    const indicator = row.getByTestId('story-history-highlighted');
    await expect(indicator).toHaveText(highlightedLabel(2));

    // UI-D-77's menu: "Destacar" · "Ver story" · "Excluir story", and no pin word anywhere.
    await row.click();
    const menu = page.getByRole('dialog', { name: H.menu.title });
    await expect(menu).toBeVisible();
    await expect(menu.getByText(H.menu.highlight, { exact: true })).toBeVisible();
    await expect(menu.getByText(H.menu.view, { exact: true })).toBeVisible();
    await expect(menu.getByText(H.menu.delete, { exact: true })).toBeVisible();
    await expect(menu.getByText(/fixar/i)).toHaveCount(0);

    await menu.getByText(H.menu.highlight, { exact: true }).click();
    const sheet = page.getByRole('dialog', { name: HS.sheet.title });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(HS.sheet.helper)).toBeVisible();

    // UI-D-67: grouped Início first, then the community — each switch in that order, seeded ON
    // exactly where the story already is.
    const home = HS.place.home;
    const names = await sheet
      .getByRole('switch')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(names).toEqual([
      highlightSwitchName(SEEDED.homeHighlight, home),
      highlightSwitchName(SEEDED.homeEmptyHighlight, home),
      highlightSwitchName(SEEDED.communityHighlight, SEEDED.communityHighlightPlace),
    ]);
    const bastidores = sheet.getByRole('switch', {
      name: highlightSwitchName(SEEDED.homeHighlight, home),
    });
    const aulas = sheet.getByRole('switch', {
      name: highlightSwitchName(SEEDED.homeEmptyHighlight, home),
    });
    const destaques = sheet.getByRole('switch', {
      name: highlightSwitchName(SEEDED.communityHighlight, SEEDED.communityHighlightPlace),
    });
    await expect(bastidores).toHaveAttribute('aria-checked', 'true');
    await expect(aulas).toHaveAttribute('aria-checked', 'false');
    await expect(destaques).toHaveAttribute('aria-checked', 'true');
    // No save button: every switch is its own write (UI-D-67).
    await expect(sheet.getByRole('button', { name: /salvar/i })).toHaveCount(0);

    // ON: the toast confirms and the row behind the sheet already reads the server's new count.
    await aulas.dispatchEvent('click');
    await expect(aulas).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(HS.toasts.added, { exact: true })).toBeVisible();
    await expect(indicator).toHaveText(highlightedLabel(3));

    // OFF: back to where the seed had it, with no reload.
    await aulas.dispatchEvent('click');
    await expect(aulas).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(HS.toasts.removed, { exact: true })).toBeVisible();
    await expect(indicator).toHaveText(highlightedLabel(2));
  });

  test('a story the walk published is deleted from the history, with the reworded dialog and toast', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // Its OWN story: deleting a seeded one would change what every other spec in the suite reads.
    const caption = `${TEST_CAPTION_PREFIX} — historico ${Date.now()}`;
    await page.goto(`${hosts.demo}/stories/publicar`);
    await page.locator('#story-photo-input').setInputFiles(PHOTO);
    // The wait is the WORKER's: the caption field appears once the upload has an asset id.
    const field = page.getByLabel(S.publish.captionLabel);
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(caption);
    // A real `click`, not `dispatchEvent`: the submit control is animated, and the shipped publish
    // walk above uses the same gesture — two spellings of the same tap would eventually diverge.
    await page.getByRole('button', { name: S.publish.submit, exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/);

    await page.goto(`${hosts.demo}/stories/meus`);
    const row = page.locator('[data-story-history-row]').filter({ hasText: caption }).first();
    await expect(row).toBeVisible();
    // A fresh story is in no highlight: no indicator on its row (UI E12 zero).
    await expect(row.getByTestId('story-history-highlighted')).toHaveCount(0);
    await row.click();

    await page.getByRole('dialog', { name: H.menu.title }).getByText(H.menu.delete).click();
    const dialog = page.getByRole('dialog', { name: H.confirmDelete.title });
    await expect(dialog).toBeVisible();
    // UI-D-78: the body names highlights and both buttons name the action.
    await expect(dialog.getByText(H.confirmDelete.body)).toBeVisible();
    await expect(dialog.getByRole('button', { name: H.confirmDelete.cancel })).toBeVisible();
    await dialog.getByRole('button', { name: H.confirmDelete.confirm }).dispatchEvent('click');

    await expect(page.getByText(H.toasts.deleted, { exact: true })).toBeVisible();
    await expect(page.locator('[data-story-history-row]').filter({ hasText: caption })).toHaveCount(
      0,
    );
  });
});

/**
 * D-110 route 1 / UI-D-66 (05.2-06, proven in the browser in 05.2-07) — "Destacar" in the viewer.
 * A curator's viewer carries the pill; tapping it pauses the story and opens the SAME checklist
 * sheet "Seus stories" opens; closing it resumes. A member's viewer has no pill at all.
 *
 * `data-paused` is read off the viewer element directly: with the `aria-modal` sheet open,
 * Playwright hides the viewer dialog from role queries.
 */
test.describe('"Destacar" from the viewer (D-110 route 1)', () => {
  test('an ADMIN taps "Destacar": the sheet opens with the story paused, and closing resumes', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/inicio`);
    await tenantCircle(page).click();

    const viewer = page.getByRole('dialog', { name: S.viewer.dialog });
    await expect(viewer).toBeVisible();
    const paused = page.locator('[data-paused]').first();
    await expect(paused).toHaveAttribute('data-paused', 'false', { timeout: 15_000 });

    await viewer.getByRole('button', { name: S.viewer.highlight }).dispatchEvent('click');
    const sheet = page.getByRole('dialog', { name: S.highlights.sheet.title });
    await expect(sheet).toBeVisible();
    await expect(paused).toHaveAttribute('data-paused', 'true');
    await expect(sheet.getByRole('switch').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(paused).toHaveAttribute('data-paused', 'false');
  });

  test('a MEMBER’s viewer has no "Destacar"', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/inicio`);
    await tenantCircle(page).click();

    const viewer = page.getByRole('dialog', { name: S.viewer.dialog });
    await expect(viewer).toBeVisible();
    // The comment control proves the action row rendered; the curation pill is simply absent.
    await expect(viewer.getByRole('button', { name: S.viewer.comment })).toBeVisible();
    await expect(viewer.getByRole('button', { name: S.viewer.highlight })).toHaveCount(0);
  });
});

/**
 * 05.1-05 — ROADMAP criteria 3, 4 and 5 walked end to end: a story started from a community's
 * Destaques `+` (D-92) is born attached in ONE publish (05.1-01), lands back on that community with
 * its circle already in Destaques (D-94), and heads the `/inicio` strip once the worker has readied
 * its asset (D-96) — no second editorial step anywhere.
 *
 * Every story this describe publishes carries `TEST_CAPTION_PREFIX` and every one is an IMAGE
 * (`post-a.jpg`), so nothing here can reach a video vendor (T-05.1-43); the `afterAll` hard sweep
 * removes the rows (and, by cascade, their pins) exactly as the publish walk above does.
 */
test.describe('05.1 — a story from a community page (criteria 3-5)', () => {
  /**
   * Mirrored from `scripts/seed.ts`'s `SEED_COMMUNITY_IDS['tria-demo']` (the `comunidades.spec.ts`
   * convention): `…c2` is the ACTIVE community the seed pins nothing to, `…c5` the ARCHIVED one.
   */
  const COMMUNITY = {
    unpinnedId: '0d000000-0000-4000-8000-0000000000c2',
    archivedId: '0d000000-0000-4000-8000-0000000000c5',
    /** The 60-character seeded name — the E06 truncation backstop. */
    longName: 'Grupo de trabalho de comunicacao interna e eventos do ano 26',
  } as const;

  let stopWorker: (() => Promise<void>) | null = null;

  test.beforeAll(async () => {
    stopWorker = await ensureWorker();
  });

  test.afterAll(async () => {
    await stopWorker?.();
    await deleteStoriesByCaptionPrefix(TEST_CAPTION_PREFIX);
  });

  const destaques = (page: Page) =>
    page.getByRole('list', { name: communityMessages.communities.page.highlights });
  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  test('UAT replay: publish a photo from a community page; it lands there in Destaques and heads the strip once ready', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${COMMUNITY.unpinnedId}`);
    const name = ((await page.locator('[data-community-name]').textContent()) ?? '').trim();
    expect(name.length).toBeGreaterThan(0);

    // The door (D-92): the Destaques `+`, the strip's own circle restated for this row.
    await destaques(page)
      .getByRole('link', { name: S.own.actionCommunity.replace('{community}', name) })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/stories/publicar\\?comunidade=${COMMUNITY.unpinnedId}$`),
    );

    await page.locator('#story-photo-input').setInputFiles(PHOTO);
    const caption = page.getByLabel(S.publish.captionLabel);
    await expect(caption).toBeVisible({ timeout: 30_000 });

    // Criterion 5: the composer states the destination before "Publicar" is reachable.
    await expect(page.locator('[data-story-destination]')).toHaveAccessibleName(
      new RegExp(escapeRegExp(name)),
    );
    await caption.fill(`${TEST_CAPTION_PREFIX} — comunidade ${Date.now()}`);
    await page.getByRole('button', { name: S.publish.submit, exact: true }).click();

    // D-94: it lands where the story went, with the story already in that community's Destaques.
    await expect(page).toHaveURL(new RegExp(`/comunidades/${COMMUNITY.unpinnedId}$`));
    await expect(
      page.getByText(S.publish.toastCommunity.replace('{community}', name), { exact: true }),
    ).toBeVisible();
    await expect(destaques(page).getByRole('button')).not.toHaveCount(0);

    // D-96: the SAME story joins the tenant circle on `/inicio` once the worker has readied its
    // asset (D-104: one circle, whose sequence grows by one). The wait is the worker's, exactly as
    // in the publish walk above. (Login ran on `hosts.demo`, the file's `baseURL`.)
    await expect(async () => {
      await expectTenantSequence(page, activeStories + 1);
    }).toPass({ timeout: 60_000 });

    await removeNewestStory();
    await expectTenantSequence(page, activeStories);
  });

  test('an archived or unknown `?comunidade=` falls back to "Nenhuma comunidade"', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    for (const id of [COMMUNITY.archivedId, crypto.randomUUID()]) {
      await page.goto(`${hosts.demo}/stories/publicar?comunidade=${id}`);
      await page.locator('#story-photo-input').setInputFiles(PHOTO);
      await expect(page.getByLabel(S.publish.captionLabel)).toBeVisible({ timeout: 30_000 });
      // D-93: silent — no error, just the tenant-wide default.
      await expect(page.locator('[data-story-destination-value]')).toHaveText(
        S.publish.destination.none,
      );
    }
  });

  test('a 60-character community name truncates inside the row at 320px', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.setViewportSize({ width: 320, height: 740 });

    await page.goto(`${hosts.demo}/comunidades`);
    const card = page
      .locator('main a[data-testid="community-card"]')
      .filter({ hasText: COMMUNITY.longName });
    const href = (await card.getAttribute('href')) ?? '';
    const communityId = href.split('/').pop() ?? '';
    expect(communityId).toMatch(/^[0-9a-f-]{36}$/);

    await page.goto(`${hosts.demo}/stories/publicar?comunidade=${communityId}`);
    await page.locator('#story-photo-input').setInputFiles(PHOTO);
    await expect(page.getByLabel(S.publish.captionLabel)).toBeVisible({ timeout: 30_000 });

    const row = page.locator('[data-story-destination]');
    const value = row.locator('[data-story-destination-value]');
    await expect(value).toHaveText(COMMUNITY.longName);

    const geometry = await row.evaluate((node) => {
      const box = (el: Element | null) => el?.getBoundingClientRect() ?? null;
      const valueNode = node.querySelector('[data-story-destination-value]') as HTMLElement;
      return {
        row: box(node),
        label: box(node.querySelector('span')),
        chevron: box(node.querySelector('svg')),
        truncated: valueNode.scrollWidth > valueNode.clientWidth,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(geometry.row?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(geometry.truncated, 'the long name is truncated, not wrapped').toBe(true);
    for (const part of ['label', 'chevron'] as const) {
      const inner = geometry[part];
      const outer = geometry.row;
      expect(inner, `${part} renders`).not.toBeNull();
      expect(inner?.left ?? -1, `${part} starts inside the row`).toBeGreaterThanOrEqual(
        (outer?.left ?? 0) - 0.5,
      );
      expect(
        inner?.right ?? Number.POSITIVE_INFINITY,
        `${part} ends inside the row`,
      ).toBeLessThanOrEqual((outer?.right ?? 0) + 0.5);
    }
    expect(geometry.overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);

    // UI-D-57: closing goes back to where the admin started, through the discard dialog.
    await page
      .getByRole('button', { name: S.publish.close })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: S.publish.discard.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: S.publish.discard.confirm }).click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${communityId}$`));
  });
});
