import { expect, type Locator, type Page, test } from '@playwright/test';
import { hosts, login, SEED_PASSWORD, seededFeedMedia, users } from './fixtures';

/**
 * FEED-01 / UI-02 / D-53 (plan 04-04) — the post media band on a real phone viewport: the gallery
 * carousel (UI-D-09/UI-D-10), the inline video frame, and the attachment row's pending state
 * (UI-D-23).
 *
 * Everything runs against the SEEDED communities and writes nothing, so the shared seed stays as it
 * was and the file is re-runnable in any order.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a registered Serwist worker can answer a navigation
 * from its own cache, and a spec that asserts what the SERVER rendered would then be asserting what
 * a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });

function feedRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'Feed principal' });
}

/** The card whose caption is `caption` — named by content, never by index in a shared stack. */
function cardFor(page: Page, caption: string): Locator {
  return feedRegion(page).getByRole('article').filter({ hasText: caption });
}

/** The active dot's zero-based index, read off the dot row rather than off internal state. */
async function activeDot(card: Locator): Promise<number> {
  return card
    .getByTestId('post-gallery-dot')
    .evaluateAll((dots) => dots.findIndex((dot) => dot.getAttribute('data-active') === 'true'));
}

test.describe('UI-D-09 / UI-D-10 — the gallery is a shared-ratio snap carousel', () => {
  test('a member swipes the seeded three-photo post and the dots track the active slide', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardFor(page, seededFeedMedia.galleryCaption);
    await expect(card).toBeVisible();

    const strip = card.getByTestId('post-gallery-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('aria-roledescription', 'carrossel');

    const slides = card.getByTestId('post-gallery-slide');
    await expect(slides).toHaveCount(3);
    await expect(slides.first()).toHaveAttribute('aria-label', '1 de 3');
    await expect(slides.last()).toHaveAttribute('aria-label', '3 de 3');

    // UI-D-09: every slide shares the FIRST image's clamped ratio, even though the seed gives the
    // three photos DIFFERENT native ratios (1200x800, 900x1200, 1000x1000).
    const ratios = await slides.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-ratio')),
    );
    expect(new Set(ratios).size).toBe(1);

    await expect(card.getByTestId('post-gallery-dot')).toHaveCount(3);
    expect(await activeDot(card)).toBe(0);
    await expect(card.getByTestId('post-gallery-live')).toHaveText('1 de 3');

    // The swipe: a snap strip's gesture IS a horizontal scroll, so the scroll is what is driven
    // here; the keyboard path below drives the same transition through real user input.
    await strip.evaluate((el) => {
      el.scrollTo({ left: el.clientWidth * 2, behavior: 'instant' as ScrollBehavior });
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(card.getByTestId('post-gallery-live')).toHaveText('3 de 3');
    expect(await activeDot(card)).toBe(2);

    // …and back one slide with the arrow keys, which is the same transition through the keyboard.
    await strip.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(card.getByTestId('post-gallery-live')).toHaveText('2 de 3');
    expect(await activeDot(card)).toBe(1);
  });

  test('a text-only post renders no media frame at all — the caption is the card’s anchor', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardFor(page, seededFeedMedia.textOnlyCaption);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('post-gallery-slide')).toHaveCount(0);
    await expect(card.getByTestId('post-attachments')).toHaveCount(0);
  });
});

/**
 * The video case reads tria-LAB on purpose. `media-video.spec.ts` hard-resets the tria-demo video
 * library before and after every one of its tests (its empty-state, newest-first and pagination
 * assertions are absolute counts), which detaches the demo tenant's seeded video post. The lab
 * tenant carries the identical fixture (SCHEMA-CONVENTIONS §(j)) and no spec resets it, so this is
 * order-independent rather than "passes when it happens to run first".
 */
test.describe('D-53 — the video post renders a player frame and no carousel', () => {
  test('the seeded video post shows the Phase 3 player, never a gallery strip', async ({
    page,
  }) => {
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);

    const card = cardFor(page, seededFeedMedia.videoCaption);
    await expect(card).toBeVisible();

    // The seed's video is `ready` through the `fake` provider, so the shipped `ready` frame mounts.
    // Either Phase 3 state is a pass here: what this asserts is that a PLAYER frame is what the
    // video branch renders, and that the gallery chrome is absent.
    await expect(
      card.getByTestId('video-ready').or(card.getByTestId('video-processing')),
    ).toBeVisible();
    await expect(card.getByTestId('post-gallery-strip')).toHaveCount(0);
    await expect(card.getByTestId('post-gallery-dot')).toHaveCount(0);
  });
});

test.describe('UI-D-23 — the attachment row gives real pending feedback', () => {
  test('the seeded PDF row shows its stored filename and goes busy while the file is fetched', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const card = cardFor(page, seededFeedMedia.attachmentCaption);
    await expect(card).toBeVisible();
    // A PDF-only post is `media_kind: 'none'`: no media frame, one attachment row.
    await expect(card.getByTestId('post-gallery-slide')).toHaveCount(0);

    const row = card.getByTestId('post-attachments').getByRole('button');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-label', `Baixar ${seededFeedMedia.attachmentFilename}`);
    // The 94-character filename truncates rather than growing the row, and keeps an accessible
    // `title` (UI-SPEC E07 long-text).
    await expect(card.getByTitle(seededFeedMedia.attachmentFilename)).toBeVisible();
    expect((await row.boundingBox())?.height ?? 0).toBeLessThan(96);

    // Hold the download open so the pending state is OBSERVABLE rather than a race: the row must be
    // busy for as long as the round trip lasts, which is the whole point of UI-D-23.
    await page.route('**/v1/media/*/original', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    await row.click();

    await expect(row).toHaveAttribute('aria-busy', 'true');
    await expect(card.getByTestId('attachment-spinner')).toBeVisible();

    // What UI-D-23 promises is the PENDING state and its clean exit, so that is what is asserted.
    // The OS-level save is deliberately not: a headless `download` event is a property of the
    // browser's download handling, and waiting on one turns an unrelated Storage hiccup into a
    // 30-second timeout rather than the honest failure it is.
    await expect(row).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(card.getByTestId('attachment-download-glyph')).toBeVisible();
  });
});
