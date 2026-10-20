import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import platformModulesMessages from '../messages/pt-BR/platformModules.json' with { type: 'json' };
import platformModulesSocialMessages from '../messages/pt-BR/platformModules.social.json' with {
  type: 'json',
};
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import {
  closeAdmin,
  createVideoPostAs,
  deleteReelsFixtures,
  feedPostIdFor,
  getTenantModuleFlag,
  membershipIdFor,
  waitForReadyPostImages,
} from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeSocialAdmin,
  followerCountOf,
  followMember,
  markAsMemberPost,
  notificationCountFor,
  unfollowMember,
  visibilityOfPostWithCaption,
} from './social-admin';
import { ensureWorker } from './worker';

/**
 * Phase 9 smoke (plan 09-13): the phase's one walk, in the shape every phase since 02-16 repeated.
 * One serial spec on the local stack, real fixtures, each ROADMAP Phase 9 success criterion touched
 * once, on a freshly reset and seeded database (rede-lab has `social` ON with the seeded follows
 * Alvaro -> Helena and Helena -> Marcos; rede-demo has it OFF).
 *
 *   1. SC 1: the platform `super_admin` opens rede-lab's Módulos tab and finds Rede social on (turning
 *      it on through the confirmation when it is off) with its limits button.
 *   2. SC 3 and 6: Helena opens the composer from Explorar, picks a real photo (the worker derives
 *      it), publishes, and lands on top of Explorar. The API stamped the post `followers`.
 *   3. SC 3, 4 and 7: Alvaro, a follower, reads the post in Explorar with its like and comment
 *      controls and not in Início; Helena's followed video heads Reels 'Todos'. Nobody was notified.
 *   4. SC 2 and 5: Marcos, a stranger, opens the link and meets only the locked card; the same
 *      stranger's Reels does not hold the video. He taps Seguir, reads the post, and Helena's profile
 *      shows the follower count and his follow. Following notified nobody.
 *   5. SC 3 (D-475): the administrator sees the member post in Explorar and removes it through the
 *      menu and the confirmation; Alvaro and Marcos no longer see it, and its link is the standard
 *      not-found screen.
 *   6. SC 1 on rede-demo (no `social`): no chip row, no composer outside Início (none at all for a
 *      member), and a bare not-found for the id of a rede-lab member post.
 *
 * What this spec deliberately does not prove: the visual fit of any of these screens and anything on
 * a real phone (the sketch 012 review and the device checklist stay with the developer), the hosted
 * push for the comment notice, and a real Mux duration rejection. The copy comes from the catalog,
 * never from a literal. Every row it writes carries the `Teste fase 9` prefix and `afterAll` removes
 * it; the seeded follow graph is put back exactly as it was.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (member posts are stamped through the admin connection)');
test.use({ serviceWorkers: 'block' });

const F = feedMessages.feed;
const PM = platformModulesMessages.platformModules;
const PMS = platformModulesSocialMessages.platformModules.social;
const R = reelsMessages.reels;
const S = socialMessages.social;

const PREFIX = 'Teste fase 9';
const LAB = 'rede-lab';
const ALVARO = 'alvaro.pinheiro@rede-lab.local';
const HELENA = 'helena.kuster@rede-lab.local';
const HELENA_NAME = 'Helena Küster';
const MARCOS = 'marcos.vinicius@rede-lab.local';
const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const SOCIAL_SWITCH = PM.toggle.replace('{module}', 'Rede social');

/** Per-run stamp: the two projects run one after the other but never reuse a caption. */
const RUN = Date.now().toString(36);

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

let stopWorker: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value used by `pnpm db:seed`)');
  }
  // The member photo is derived (`kernel.media-derive-variants`) by the worker role.
  stopWorker = await ensureWorker();
  await deleteReelsFixtures(PREFIX);
  // The graph this walk relies on: Alvaro follows Helena (seed), Marcos does not (the stranger).
  await followMember(ALVARO, HELENA, LAB);
  await unfollowMember(MARCOS, HELENA, LAB);
});

test.afterAll(async () => {
  await stopWorker();
  await deleteReelsFixtures(PREFIX);
  // Back to the seeded graph: Alvaro -> Helena stays, Marcos -> Helena goes.
  await followMember(ALVARO, HELENA, LAB);
  await unfollowMember(MARCOS, HELENA, LAB);
  await client?.end();
  client = null;
  await closeSocialAdmin();
  await closeAdmin();
});

/** The chip row: a tablist of links named "Áreas do início". */
function chipRow(page: Page): Locator {
  return page.getByRole('tablist', { name: S.tabs.label });
}

/** The composer entry, wherever the shell put it: the phone's FAB, or the desktop header button. */
function composerEntry(page: Page): Locator {
  return page.getByRole('link', { name: F.empty.cta });
}

/** A card by post id, wherever it sits in the column. */
function cardById(page: Page, id: string): Locator {
  return page.locator(`[data-post-id="${id}"]`);
}

/** The Reels page that is in front (not an inert neighbour). */
function reelPage(page: Page): Locator {
  return page.locator('[data-reel-page]:not([inert])');
}

/** The removal confirmation (its confirm label repeats the menu row's, so it is scoped to the dialog). */
function removalDialog(page: Page): Locator {
  return page.getByRole('alertdialog').or(page.getByRole('dialog', { name: F.remove.title }));
}

/** The streams stay loading forever, so the cases assert the page the host built (reels.spec). */
async function hangStreams(page: Page): Promise<void> {
  await page.route('**/stream.mux.com/**', () => undefined);
}

/** The standard miss screen of 04 UI-D-16: the same words for every reason. */
async function expectNotFound(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: F.notFound.title })).toBeVisible();
  await expect(page.locator('[data-post-id]')).toHaveCount(0);
}

/** Starts the next actor from a clean browser: cookies are per host, so one clear covers them all. */
async function signInAs(page: Page, email: string, origin: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email, SEED_PASSWORD, origin);
}

test.describe('Phase 9 smoke - Rede social: follow, member posts and Explorar', () => {
  test('the walk: enable, publish, follow, read, lock, remove - and rede-demo sees none of it', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name !== 'desktop-chromium';
    const caption = `${PREFIX} foto de Helena ${RUN} ${mobile ? 'm' : 'd'}`;
    const videoCaption = `${PREFIX} vídeo de Helena ${RUN} ${mobile ? 'm' : 'd'}`;
    const helenaProfile = `/membros/${await membershipIdFor(HELENA, LAB)}`;

    // A followed member's video, already `ready` (the fake provider): it heads Reels 'Todos' for her
    // followers (SC 7). It is stamped a MEMBER post, the way the API stamps it for a member.
    const video = await createVideoPostAs(HELENA, LAB, videoCaption);
    await markAsMemberPost(video.postId);

    // ── 1. the platform: Rede social is on for rede-lab, through the confirmation (SC 1) ─────────
    await page.goto(`${hosts.platform}/entrar`);
    await page.locator('#email').fill(SUPER_ADMIN_EMAIL);
    await page.locator('#password').fill(SUPER_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });

    const [labTenant] = await sql()<{ id: string; display_name: string }[]>`
      select id, display_name from public.tenants where slug = ${LAB}`;
    if (!labTenant) throw new Error('the seeded rede-lab tenant does not exist');
    await page.goto(`${hosts.platform}/plataforma/tenants/${labTenant.id}/modulos`);
    const socialSwitch = page.getByRole('switch', { name: SOCIAL_SWITCH });
    await expect(socialSwitch).toBeVisible();
    if (!(await socialSwitch.isChecked())) {
      await socialSwitch.click();
      const confirm = page.getByRole('dialog', {
        name: PMS.confirm.title.replace('{tenant}', labTenant.display_name),
      });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: PMS.confirm.confirm }).click();
      await expect(page.getByRole('status').filter({ hasText: PM.toasts.saved })).toBeVisible();
    }
    await expect(socialSwitch).toBeChecked();
    await expect(page.getByRole('button', { name: PMS.limits.open })).toBeVisible();
    expect(await getTenantModuleFlag(LAB, 'social')).toBe(true);

    // ── 2. Helena publishes a photo post from Explorar and lands on top of it (SC 3, 6) ───────────
    const toldAlvaro = await notificationCountFor(ALVARO, LAB);
    const toldHelena = await notificationCountFor(HELENA, LAB);
    await signInAs(page, HELENA, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    await expect(chipRow(page)).toBeVisible();
    await composerEntry(page).click();
    await expect(page).toHaveURL(/\/criar$/);
    await expect(page.getByText(F.composer.audience)).toBeVisible();
    // The controls the API forbids a member are absent, not disabled.
    await expect(page.getByTestId('composer-add-file')).toHaveCount(0);
    await expect(page.locator('[data-composer-destination]')).toHaveCount(0);
    const publish = page.getByRole('button', { name: F.composer.publish, exact: true });
    await expect(publish).toBeDisabled();

    const since = new Date();
    await page.getByLabel(F.composer.captionLabel).fill(caption);
    await page.locator('input[type="file"][multiple]').setInputFiles(PHOTO);
    await expect(page.locator('[data-composer-thumbs] li')).toHaveCount(1, { timeout: 60_000 });
    await waitForReadyPostImages(LAB, since, 1);
    await expect(publish).toBeEnabled();
    await publish.click();

    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/, { timeout: 30_000 });
    await expect(page.getByText(F.toasts.created)).toBeVisible();
    const feedCards = page.getByRole('region', { name: F.region }).getByRole('article');
    await expect(feedCards.first()).toContainText(caption);
    expect(await visibilityOfPostWithCaption(caption)).toBe('followers');
    const postId = await feedPostIdFor(caption, LAB);

    // ── 3. Alvaro, a follower, reads it in Explorar, not in Início; the video heads Reels ─────────
    await signInAs(page, ALVARO, hosts.lab);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(page.getByRole('region', { name: F.region }).getByRole('article')).not.toHaveCount(
      0,
    );
    await expect(cardById(page, postId)).toHaveCount(0);
    await expect(page.getByText(caption)).toHaveCount(0);

    await chipRow(page).getByRole('tab', { name: S.tabs.explore }).click();
    await expect(page).toHaveURL(/\/inicio\?aba=explorar$/);
    const alvaroCard = cardById(page, postId);
    await expect(alvaroCard).toBeVisible();
    await expect(alvaroCard).toContainText(caption);
    await expect(alvaroCard.getByRole('button', { name: F.actions.like })).toBeVisible();
    await expect(
      alvaroCard.getByRole('button', { name: F.actions.comment, exact: true }),
    ).toBeVisible();
    // A member post never wears the organization's mark (PR-5).
    await expect(alvaroCard.getByRole('img', { name: F.post.adminBadge })).toHaveCount(0);

    await hangStreams(page);
    await page.goto(`${hosts.lab}/reels`);
    await expect(reelPage(page).locator('[data-reel-caption-text]')).toHaveText(videoCaption, {
      timeout: 20_000,
    });
    // Rendered like an administrator's video: the author opens the profile (D-470).
    await expect(
      reelPage(page).getByRole('link', { name: R.rail.author.replace('{name}', HELENA_NAME) }),
    ).toHaveAttribute('href', helenaProfile);

    // ── 4. Marcos, a stranger: the locked card, Seguir, the post, the profile (SC 2, 5) ───────────
    await signInAs(page, MARCOS, hosts.lab);
    const followersBefore = await followerCountOf(HELENA, LAB);

    await expect(cardById(page, postId)).toHaveCount(0);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(cardById(page, postId)).toHaveCount(0);
    await hangStreams(page);
    await page.goto(`${hosts.lab}/reels`);
    await expect(page.locator('[data-reel-page]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(videoCaption)).toHaveCount(0);

    const response = await page.goto(`${hosts.lab}/post/${postId}`);
    const html = (await response?.text()) ?? '';
    expect(html).toContain('Helena');
    expect(html).not.toContain(caption);
    await expect(
      page.getByRole('heading', { name: S.locked.title.replace('{name}', HELENA_NAME) }),
    ).toBeVisible();
    await expect(page.getByText(S.locked.body.replace('{name}', HELENA_NAME))).toBeVisible();
    await expect(page.getByText(caption)).toHaveCount(0);
    await expect(cardById(page, postId)).toHaveCount(0);

    await page
      .getByRole('button', { name: S.follow.ariaFollow.replace('{name}', HELENA_NAME) })
      .click();
    await expect(page.getByText(caption)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/post/${postId}$`));
    await expect.poll(() => followerCountOf(HELENA, LAB)).toBe(followersBefore + 1);

    await page.goto(`${hosts.lab}${helenaProfile}`);
    await expect(page.getByRole('heading', { level: 1, name: HELENA_NAME })).toBeVisible();
    const counts = page.locator('div.grid.grid-cols-2.border-y');
    await expect(counts).toBeVisible();
    await expect(counts.locator('> div').first()).toContainText(String(followersBefore + 1));
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${S.follow.following} ${HELENA_NAME}`),
      }),
    ).toBeVisible();

    // Nothing of this was announced: a member post and a follow notify nobody (PR-3).
    expect(await notificationCountFor(ALVARO, LAB)).toBe(toldAlvaro);
    expect(await notificationCountFor(HELENA, LAB)).toBe(toldHelena);

    // ── 5. the administrator removes it through the menu (SC 3, D-475) ────────────────────────────
    await signInAs(page, users.labAdmin, hosts.lab);
    await page.goto(`${hosts.lab}/inicio?aba=explorar`);
    const adminCard = cardById(page, postId);
    await expect(adminCard).toBeVisible();
    await expect(cardById(page, video.postId)).toBeVisible();
    await adminCard.getByRole('button', { name: F.actions.more }).click();
    await page.getByRole('button', { name: F.menu.remove }).click();
    const dialog = removalDialog(page);
    await expect(dialog.getByText(F.remove.title)).toBeVisible();
    await dialog.getByRole('button', { name: F.remove.confirm }).click();
    await expect(page.getByText(F.toasts.removed)).toBeVisible();
    await expect(cardById(page, postId)).toHaveCount(0);
    expect(await notificationCountFor(HELENA, LAB)).toBe(toldHelena);

    // Alvaro and Marcos no longer see it, and the link is the standard not-found screen.
    for (const email of [ALVARO, MARCOS]) {
      await signInAs(page, email, hosts.lab);
      await page.goto(`${hosts.lab}/inicio?aba=explorar`);
      await expect(page.getByRole('region', { name: F.region })).toBeVisible();
      await expect(cardById(page, postId)).toHaveCount(0);
      await expect(page.getByText(caption)).toHaveCount(0);
      await page.goto(`${hosts.lab}/post/${postId}`);
      await expectNotFound(page);
      await expect(page.getByText(caption)).toHaveCount(0);
    }

    // ── 6. rede-demo (no `social`): none of it exists there (SC 1) ───────────────────────────────
    await signInAs(page, users.demoMember, hosts.demo);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(chipRow(page)).toHaveCount(0);
    await expect(composerEntry(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.find.cta })).toHaveCount(0);

    await page.goto(`${hosts.demo}/inicio?aba=explorar`);
    await expect(page.getByRole('region', { name: F.region })).toBeVisible();
    await expect(chipRow(page)).toHaveCount(0);
    await expect(composerEntry(page)).toHaveCount(0);

    // A rede-lab member post id (the video, still live in rede-lab) is a bare not-found here.
    await page.goto(`${hosts.demo}/post/${video.postId}`);
    await expectNotFound(page);
    await expect(page.getByText(videoCaption)).toHaveCount(0);
  });
});
