import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  createFeedPostAs,
  deleteFeedPostsLike,
  deletePostAssetsSince,
  waitForReadyPostImages,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

/**
 * FEED-01 / FEED-03 / UI-02 E14–E15–E18 — the admin's half of the phase in a real browser.
 *
 * Five claims:
 *   1. the floating create control is gated on the composed `feed.post.create` permission — the
 *      admin sees it, the member does not, and on DESKTOP nobody does (UI-D-17: the header-row
 *      button is the desktop entry point);
 *   2. an admin publishes a two-image post from a phone, through the REAL file chooser, and the
 *      card is on the home route afterwards with its caption on it;
 *   3. D-53 is visible, not merely refused: with photos picked, the video picker is disabled and
 *      the exclusivity helper line is on screen;
 *   4. the "…" menu on an own post carries edit and delete; saving an edit puts the "editado"
 *      marker on the card (UI-D-15);
 *   5. deleting behind the confirmation takes the card off the feed.
 *
 * **Every expected string is read from the catalog**, never inlined: `apps/web/messages/pt-BR/feed.json`
 * is the single source of this app's copy, and a spec that hard-coded "Publicar" would keep passing
 * after somebody changed the button and the catalog together.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a registered Serwist worker can answer a
 * navigation from its own cache and turn a server-rendered assertion into a cached one.
 *
 * The worker process is brought up because variant derivation (`kernel.media-derive-variants`) runs
 * in the worker ROLE, and `createPost` requires an image to be `ready` (04-04 — a video may publish
 * mid-transcode, an image may not).
 */
test.use({ serviceWorkers: 'block' });

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PHOTO_A = `${FIXTURES}post-a.jpg`;
const PHOTO_B = `${FIXTURES}post-b.jpg`;

/** THE copy under test, read from the catalog the app itself loads. */
const feed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../messages/pt-BR/feed.json', import.meta.url)), 'utf8'),
).feed as {
  composer: {
    createTitle: string;
    editTitle: string;
    publish: string;
    save: string;
    close: string;
    captionPlaceholder: string;
    mediaHelper: string;
  };
  empty: { cta: string };
  actions: { more: string };
  menu: { edit: string; delete: string };
  delete: { title: string; confirm: string };
  share: { copyLink: string };
  meta: { edited: string };
  toasts: { created: string; saved: string; deleted: string };
};

/** Every caption this file writes starts here, so the teardown can find all of them. */
const PREFIX = 'E2E composer 04-09';
const startedAt = new Date();

const composer = {
  fab: (page: Page) => page.locator('[data-compose-fab]'),
  photos: (page: Page) => page.getByTestId('composer-add-photos'),
  video: (page: Page) => page.getByTestId('composer-add-video'),
  thumbs: (page: Page) => page.locator('[data-composer-thumbs] li'),
  exclusive: (page: Page) => page.locator('[data-composer-exclusive]'),
  caption: (page: Page) => page.locator('#composer-caption'),
};

/** The card for a caption, scoped so a substring match cannot drift onto a neighbouring post. */
const cardFor = (page: Page, caption: string) =>
  page.getByRole('article').filter({ hasText: caption });

test.afterAll(async () => {
  await deleteFeedPostsLike(PREFIX);
  await deletePostAssetsSince('rede-demo', startedAt);
  await closeAdmin();
});

test.describe('UI-D-17 / E15 — the create control is a permission, not a role', () => {
  test('the admin sees the floating control on a phone and the member does not', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the FAB is the phone entry point');

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await expect(composer.fab(page)).toBeVisible();
    await expect(composer.fab(page)).toHaveAttribute('aria-label', feed.empty.cta);

    // A fresh context rather than a sign-out: the two sessions must not share a cookie jar.
    const memberContext = await page.context().browser()?.newContext({ serviceWorkers: 'block' });
    if (!memberContext) throw new Error('could not open a second context');
    const memberPage = await memberContext.newPage();
    await login(memberPage, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(memberPage.locator('[data-compose-fab]')).toHaveCount(0);
    await memberContext.close();
  });

  test('desktop shows the header-row button and NO floating control', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'UI-D-17 is a breakpoint rule');

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    // The floating control is `md:hidden`, so at this breakpoint it must not be rendered visibly.
    await expect(composer.fab(page)).toBeHidden();
    await expect(
      page.getByRole('main').getByRole('link', { name: feed.empty.cta, exact: true }),
    ).toBeVisible();
  });
});

test.describe('FEED-01 / E14 — publishing from a phone', () => {
  test('two images through the real file chooser, then the card on the home route', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the composer is a phone-first screen');
    test.setTimeout(240_000);

    const stopWorker = await ensureWorker();
    try {
      const caption = `${PREFIX} publicacao com duas fotos`;
      const since = new Date();

      await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
      await composer.fab(page).click();
      await expect(page).toHaveURL(/\/criar$/);
      await expect(
        page.getByRole('heading', { name: feed.composer.createTitle, exact: true }),
      ).toBeVisible();

      const publish = page.getByRole('button', { name: feed.composer.publish, exact: true });
      // E14/empty: an unfilled form shows placeholders only and the submit is disabled.
      await expect(publish).toBeDisabled();
      // UI-D-46: the placeholder now names the tenant, so the catalog value is interpolated here
      // the same way the server interpolates it.
      await expect(composer.caption(page)).toHaveAttribute(
        'placeholder',
        feed.composer.captionPlaceholder.replace('{tenant}', 'Rede Demo'),
      );

      await composer.caption(page).fill(caption);
      await expect(publish).toBeEnabled();

      // The REAL OS picker, both files in one answer — the path a phone actually takes.
      const choosing = page.waitForEvent('filechooser');
      await composer.photos(page).click();
      await (await choosing).setFiles([PHOTO_A, PHOTO_B]);

      await expect(composer.thumbs(page)).toHaveCount(2, { timeout: 60_000 });

      // D-53 is VISIBLE: the other picker is disabled and the helper line says why.
      await expect(composer.video(page)).toBeDisabled();
      await expect(composer.exclusive(page)).toHaveText(feed.composer.mediaHelper);

      // The worker has to have derived the ladder before an image may be published (04-04).
      await waitForReadyPostImages('rede-demo', since, 2);

      await publish.click();
      await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(page.getByRole('status')).toHaveText(feed.toasts.created);

      await page.goto('/inicio');
      const card = cardFor(page, caption);
      await expect(card).toBeVisible();
      // Newest first: the post just published heads the column.
      await expect(page.getByRole('article').first()).toContainText(caption);
    } finally {
      await stopWorker();
    }
  });
});

test.describe('FEED-03 / E03 + E18 — the overflow menu, the edit marker and the delete', () => {
  test('edits an own post and the card gains the edited marker', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one project is enough for the flow');

    const caption = `${PREFIX} publicacao para editar`;
    const edited = `${caption} atualizada`;
    await createFeedPostAs(users.demoAdmin, 'rede-demo', caption);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    const card = cardFor(page, caption);
    await expect(card).toBeVisible();
    // The marker is absent before the edit — otherwise the assertion below proves nothing.
    await expect(card).not.toContainText(feed.meta.edited);

    await card.getByRole('button', { name: feed.actions.more, exact: true }).click();
    const menu = page.getByRole('dialog');
    await expect(menu.getByRole('link', { name: feed.menu.edit, exact: true })).toBeVisible();
    await expect(
      menu.getByRole('button', { name: feed.share.copyLink, exact: true }),
    ).toBeVisible();
    await expect(menu.getByRole('button', { name: feed.menu.delete, exact: true })).toBeVisible();

    await menu.getByRole('link', { name: feed.menu.edit, exact: true }).click();
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}\/editar$/);
    await expect(
      page.getByRole('heading', { name: feed.composer.editTitle, exact: true }),
    ).toBeVisible();
    // The SAME form, pre-filled with what the post already says.
    await expect(composer.caption(page)).toHaveValue(caption);

    await composer.caption(page).fill(edited);
    await page.getByRole('button', { name: feed.composer.save, exact: true }).click();
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('status')).toHaveText(feed.toasts.saved);

    await page.goto('/inicio');
    const updated = cardFor(page, edited);
    await expect(updated).toBeVisible();
    // UI-D-15: the bare word appended to the timestamp, with no date of its own.
    await expect(updated).toContainText(feed.meta.edited);
  });

  test('deletes an own post behind the confirmation and the card leaves the feed', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one project is enough for the flow');

    const caption = `${PREFIX} publicacao para excluir`;
    await createFeedPostAs(users.demoAdmin, 'rede-demo', caption);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    const card = cardFor(page, caption);
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: feed.actions.more, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: feed.menu.delete }).click();

    // E18/overflow: the confirmation quotes NOTHING — the caption is nowhere in the dialog. It is
    // located by its accessible NAME rather than by its text: the sheet behind it is a dialog too,
    // and a text filter matches both.
    const confirmation = page.getByRole('dialog', { name: feed.delete.title, exact: true });
    await expect(confirmation).not.toContainText(caption);
    await confirmation.getByRole('button', { name: feed.delete.confirm, exact: true }).click();

    // Scoped to the toast: on the feed a seeded video card can carry its own role="status" line
    // (FeedVideo's playback error, which the fake provider's token always reaches).
    await expect(page.getByRole('status').filter({ hasText: feed.toasts.deleted })).toBeVisible();
    await expect(cardFor(page, caption)).toHaveCount(0);
  });
});
