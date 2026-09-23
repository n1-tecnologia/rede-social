import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { activeReadyStoryCount, closeAdmin, deleteStoriesByCaptionPrefix, envValue } from './admin';
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

/** A real GoTrue session for the seeded demo admin (Node side, no browser). */
async function adminToken(): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email: users.demoAdmin, password: SEED_PASSWORD }),
  });
  if (!res.ok) throw new Error(`demo admin sign-in failed: ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

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
