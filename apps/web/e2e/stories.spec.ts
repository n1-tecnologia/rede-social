import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { STORY_PAGE_SIZE } from '@tria/module-stories/contracts';
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  activeReadyStoryCount,
  cloneActiveStories,
  closeAdmin,
  deleteStoriesByCaptionPrefix,
  envValue,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const S = storyMessages.stories;

/**
 * STORY-01 / STORY-03 / D-78 / D-80 (plan 05-05): the `/inicio` stories strip and the full-screen
 * `/stories/publicar` route, on the phone (`mobile-chromium`, an iPhone 14 preset) and on desktop.
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

test.describe('the /inicio strip — one circle per active story, newest first (D-78, UI-D-26)', () => {
  test('a MEMBER sees the tenant’s active stories and NO publish door', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD);

    const row = strip(page);
    await expect(row).toBeVisible();
    // D-78: one circle per active STORY. Per-publisher grouping would collapse this to one.
    await expect(row.getByRole('listitem')).toHaveCount(activeStories);

    // D-80 / UI-D-28: the own-circle is the ONLY publish entry point, and a member has none.
    await expect(row.getByRole('link', { name: S.own.action })).toHaveCount(0);
    await expect(row.getByText(S.own.label)).toHaveCount(0);

    // STORY-03 at the surface a member actually looks at: the expired story is simply not there.
    await expect(page.getByText(SEEDED.expiredCaption)).toHaveCount(0);

    // UI-D-25: the strip sits ABOVE the feed and BELOW the welcome heading.
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
    await expect(items).toHaveCount(activeStories + 1);

    // UI-D-28: rendered FIRST, and an anchor rather than a button — `/stories/publicar` is a
    // full-screen route that must not live in a dismissible layer.
    await expect(items.first()).toContainText(S.own.label);
    const own = row.getByRole('link', { name: S.own.action });
    await expect(own).toHaveAttribute('href', '/stories/publicar');
  });

  test('the strip keeps IDENTICAL geometry on desktop — no arrows, no fade mask (UI-D-47)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the desktop-only claim needs the desktop project');
    await login(page, users.demoAdmin, SEED_PASSWORD);

    const row = strip(page);
    await expect(row).toBeVisible();
    await expect(row.getByRole('listitem')).toHaveCount(activeStories + 1);
    // The row is the only horizontal scroller, and its overscroll is contained so a trackpad swipe
    // never triggers the browser back-gesture.
    const overflow = await row.evaluate((node) => getComputedStyle(node).overflowX);
    expect(overflow).toBe('auto');
    const overscroll = await row.evaluate((node) => getComputedStyle(node).overscrollBehaviorX);
    expect(overscroll).toBe('contain');
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

  test('an admin taps the own-circle, publishes a photo, and sees it at the head of the strip', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD);

    // The circle is the door: this navigation is the whole of D-80's claim.
    await strip(page).getByRole('link', { name: S.own.action }).click();
    await expect(page).toHaveURL(/\/stories\/publicar$/);
    await expect(page.getByRole('heading', { name: S.publish.title })).toBeVisible();

    // UI empty/E07: before a pick there is nothing to publish, so the control does not exist.
    await expect(page.getByRole('button', { name: S.publish.submit })).toHaveCount(0);

    // The upload path itself is Phase 3's and already has its own suites; what matters here is
    // that the bytes are REAL, so the worker can derive the ladder the circle renders.
    await page.locator('#story-photo-input').setInputFiles(PHOTO);

    // Post-pick the screen becomes the story FRAME — the media, the overlaid caption and Publicar.
    const caption = page.getByLabel(S.publish.captionLabel);
    await expect(caption).toBeVisible({ timeout: 30_000 });
    await caption.fill(`${TEST_CAPTION_PREFIX}.`);

    await page.getByRole('button', { name: S.publish.submit }).click();
    await expect(page).toHaveURL(/\/inicio$/);

    // The new circle heads the strip, one slot after the admin's own circle. The wait is the
    // WORKER's: the asset is `processing` until variant derivation lands, and R-P8 keeps a
    // non-ready story out of the strip — so the poll is measuring the real pipeline, not a race.
    const items = strip(page).getByRole('listitem');
    await expect(async () => {
      await page.reload();
      await expect(items).toHaveCount(activeStories + 2);
    }).toPass({ timeout: 60_000 });

    // Clean up through the product's own surface, so the shared seed is exactly as it was found.
    await removeNewestStory();
    await page.goto('/inicio');
    await expect(strip(page).getByRole('listitem')).toHaveCount(activeStories + 1);
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

    await page.goto('/inicio');
    await expect(strip(page).getByRole('listitem')).toHaveCount(activeStories + 1);
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

  /** Opens the viewer on the FIRST circle of the member's strip, and waits for the clock to start. */
  async function openViewer(page: Page) {
    await login(page, users.demoMember, SEED_PASSWORD);
    await strip(page).getByRole('button').first().click();
    await expect(page.getByRole('dialog', { name: V.dialog })).toBeVisible();
    // The clock does not start until the media reports it is loaded (UI loading/E03), so the first
    // non-zero width is ALSO the proof that the image decoded.
    await expect.poll(() => fillWidth(page, 0), { timeout: 15_000 }).toBeGreaterThan(0);
  }

  test('a circle opens the viewer, the URL becomes /stories/{id}, and the first bar fills', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the gesture model is the phone’s');
    await openViewer(page);

    // The strip's circles were inert until this plan (05-05 left `onOpen` unbound on purpose).
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]{36}$/);
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
 * The overflow BACKSTOP (UI overflow/E03, E04): a FULL strip at 320px keeps every progress segment
 * at least 2px wide and does not wrap the bar row.
 *
 * **The UI-SPEC states this backstop at 25 stories, and 25 is not reachable through the product.**
 * The viewer's sequence IS the strip's page, and `STORY_PAGE_SIZE = 10` caps that page — so the
 * most segments a member can ever see is ten, and a 25-row fixture would only prove that the strip
 * paginates. This test therefore measures the REAL ceiling, and the 25-segment DOM shape is pinned
 * where it is actually reachable: `story-viewer.test.tsx` renders `StoryProgressBars` with 25 items
 * and asserts one non-wrapping row. The arithmetic between them closes the gap — at 320px the row
 * has 304px of content width and 24 four-pixel gaps, leaving 208px over 25 segments, or 8.3px each.
 *
 * It runs LAST and cleans up after itself, because it adds rows to the shared strip — and the whole
 * file measures the strip. `fullyParallel: false` and `workers: 1` make the declaration order the
 * execution order, which is what makes that safe rather than lucky.
 */
test.describe('the viewer at a FULL strip on a 320px screen (overflow backstop)', () => {
  const BACKSTOP_PREFIX = 'Story do backstop e2e';
  /** The strip renders ONE page, and the page size is the contract's. */
  const TARGET = STORY_PAGE_SIZE;
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
    await strip(page).getByRole('button').first().click();
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
