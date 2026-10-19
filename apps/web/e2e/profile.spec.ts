import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import dashboardMessages from '../messages/pt-BR/dashboard.json' with { type: 'json' };
import eventsMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import profileMessages from '../messages/pt-BR/profile.json' with { type: 'json' };
import {
  closeAdmin,
  feedPostIdFor,
  memberProfileForEmail,
  membershipIdFor,
  resetMemberProfile,
  stubUnfetchableAvatar,
} from './admin';
import {
  buildDashboardSnapshot,
  closeDashboardAdmin,
  dashboardSnapshotFacts,
  dashboardSoonestEventFacts,
} from './dashboard-admin';
import {
  hosts,
  isRemote,
  login,
  SEED_PASSWORD,
  seededFeed,
  seededFeedPaging,
  users,
} from './fixtures';
import { untilHydrated } from './hydration';
import { pickPhoto } from './media-fixtures';
import {
  closeStoreAdmin,
  createProduct,
  deleteProductsByPrefix,
  insertPaidOrders,
} from './store-admin';
import { ensureWorker } from './worker';

/**
 * PROF-01 (plan 03-04): the member's own profile and its edit form, on the phone
 * (`mobile-chromium`, an iPhone 14 preset) and on the desktop. Everything here is the member's own
 * screen — `GET /v1/me/profile` through the Next BFF, `PATCH` through the server action — and every
 * string asserted is the catalog's, so a copy drift fails the spec rather than shipping.
 *
 * The seeded `member@rede-demo.local` is SHARED by the whole suite, so `afterEach` puts the row back
 * to the values `pnpm db:seed` writes (no photo, no bio).
 */

/** What `scripts/seed.ts` writes for the demo member. */
const SEEDED = { displayName: 'Membro Rede Demo', bio: null } as const;

/** The display name on `/perfil` — the Title role (24/700) of the hero. */
function profileName(page: Page) {
  return page.locator('main [data-profile-name]');
}

/**
 * The hero of `/perfil` (2026-10-12): the band, the photo and the identity. The sections under it
 * carry event posters and comunidade covers, so the photo and paragraph checks look here only.
 */
function hero(page: Page) {
  return page.locator('main [data-profile-hero]');
}

test.describe('PROF-01 — /perfil and /perfil/editar', () => {
  test.afterEach(async () => {
    await resetMemberProfile(users.demoMember, {
      displayName: SEEDED.displayName,
      bio: SEEDED.bio,
    });
  });

  test.afterAll(async () => {
    await closeAdmin();
  });

  test('the profile screen shows the member, the two icons and no role badge (UI-D-01)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');

    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible();
    // A tab page (2026-10-09): no "< Perfil" bar, the h1 above is the screen reader's only.
    await expect(page.locator('main header')).toHaveCount(0);
    await expect(profileName(page)).toHaveCount(1);
    await expect(profileName(page)).toHaveText(SEEDED.displayName);
    await expect(page.getByText(users.demoMember)).toBeVisible();

    // The seeded member has no photo and no bio: the neutral avatar, and no placeholder line.
    await expect(hero(page).locator('[role="img"][aria-label="Membro Rede Demo"]')).toBeVisible();
    await expect(hero(page).locator('img[src^="/v1/media/"]')).toHaveCount(0);

    // 2026-10-12: "Editar perfil" and "Configurações" are the pencil and the gear on the band, named
    // for screen readers, and nothing on the screen leads to the member directory any more.
    const actions = hero(page).locator('[data-profile-action]');
    const expected = [
      ['Editar perfil', '/perfil/editar'],
      ['Configurações', '/configuracoes'],
    ] as const;
    await expect(actions).toHaveCount(expected.length);
    for (const [index, [name, href]] of expected.entries()) {
      await expect(actions.nth(index)).toHaveAccessibleName(name);
      await expect(actions.nth(index)).toHaveAttribute('href', href);
      await expect(actions.nth(index)).toBeInViewport();
    }
    await expect(page.locator('main a[href="/membros"]')).toHaveCount(0);
    await expect(
      page.locator('main').getByRole('link', { name: 'Membros', exact: true }),
    ).toHaveCount(0);

    // UI-D-01: the Phase 2 role pill is gone — no role word appears anywhere in the profile. Scoped
    // to `main` since 07-08: the shell's chat slot is labelled "Suporte" (the support conversation,
    // not a role), and it lives in the TopBar / rail, outside the profile.
    await expect(page.locator('main').getByText(/^(Administrador|Membro|Suporte)$/)).toHaveCount(0);
  });

  test('a member renames themselves and writes a bio, and it persists', async ({ page }) => {
    const name = 'Membro Renomeado';
    const bio = 'Gosto de caminhar aos sábados.';

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    await page.locator('main').getByRole('link', { name: 'Editar perfil' }).click();
    await expect(page).toHaveURL(/\/perfil\/editar$/);

    const save = page.getByRole('button', { name: 'Salvar alterações' });
    await expect(save).toBeDisabled();

    await page.locator('#displayName').fill(name);
    await expect(save).toBeEnabled();
    await page.locator('#bio').fill(bio);

    // The counter is the bio's only helper, and it is not at the cap.
    const counter = page.locator('#bio-counter');
    await expect(counter).toHaveText(`${bio.length}/150`);
    await expect(counter).not.toHaveClass(/text-danger/);

    await save.click();
    await expect(page.getByRole('status')).toHaveText('Perfil atualizado.');
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(profileName(page)).toHaveText(name);
    await expect(page.getByText(bio)).toBeVisible();

    // Persistence: a reload reads the row again, and so does the database.
    await page.reload();
    await expect(profileName(page)).toHaveText(name);
    await expect(page.getByText(bio)).toBeVisible();
    expect(await memberProfileForEmail(users.demoMember)).toMatchObject({
      displayName: name,
      bio,
    });
  });
});

/**
 * The photo half of PROF-01 (MEDIA-02): a committed photo really renders from the stable
 * `/v1/media/{assetId}/{variant}` endpoint in the worker's display sizes, and removing it puts the
 * neutral icon back. A `ROLE=worker` is spawned because the variant ladder is derived off the
 * request path.
 */
test.describe('PROF-01 — the member photo on /perfil', () => {
  let stopWorker: (() => Promise<void>) | null = null;

  test.beforeAll(async () => {
    stopWorker = await ensureWorker();
  });

  test.afterEach(async () => {
    await resetMemberProfile(users.demoMember, {
      displayName: SEEDED.displayName,
      bio: SEEDED.bio,
      avatarAssetId: null,
    });
  });

  test.afterAll(async () => {
    await stopWorker?.();
    await closeAdmin();
  });

  test('a photo renders from /v1/media in the derived widths, and "Remover foto" puts the icon back', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    await pickPhoto(page, fileURLToPath(new URL('./fixtures/large.jpg', import.meta.url)));
    await expect(page.getByRole('status')).toHaveText('Foto atualizada.', { timeout: 30_000 });

    // The photo commits on its own: the form was never submitted, yet the row already points at it.
    const committed = await expect
      .poll(async () => (await memberProfileForEmail(users.demoMember))?.avatarAssetId ?? null, {
        timeout: 15_000,
      })
      .not.toBeNull()
      .then(async () => (await memberProfileForEmail(users.demoMember))?.avatarAssetId as string);

    // …and the worker derives the ladder off the request path, so the display size really exists.
    await expect
      .poll(async () => (await page.request.get(`/v1/media/${committed}/w320`)).status(), {
        timeout: 30_000,
      })
      .toBe(200);

    await page.goto('/perfil');
    const photo = hero(page).locator('img[src^="/v1/media/"]');
    await expect(photo).toHaveAttribute('src', `/v1/media/${committed}/w320`);
    await expect(photo).toHaveAttribute('srcset', /w128 128w.*w320 320w/);
    await expect(photo).toHaveAttribute('alt', SEEDED.displayName);
    // Rendered, not merely addressed: a 404 would have cleared `src` through `onError`.
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await page.goto('/perfil/editar');
    await page.getByRole('button', { name: 'Remover foto' }).click();
    await expect(page.getByText('Remover sua foto?')).toBeVisible();
    await expect(page.getByText('Seu perfil volta a mostrar o ícone padrão.')).toBeVisible();
    await page.getByRole('button', { name: 'Remover', exact: true }).click();

    await expect(page.getByRole('status')).toHaveText('Foto removida.');
    await page.goto('/perfil');
    await expect(hero(page).locator('img[src^="/v1/media/"]')).toHaveCount(0);
    await expect(
      hero(page).locator(`[role="img"][aria-label="${SEEDED.displayName}"]`),
    ).toBeVisible();
    expect((await memberProfileForEmail(users.demoMember))?.avatarAssetId).toBeNull();
  });
});

/**
 * The UI states the approved contract enumerates for these screens (UI-SPEC E1, E2, E9): what the
 * member sees with nothing filled in, with the longest values the form allows, when a field is
 * refused, and when a photo cannot be fetched at all.
 */
test.describe('PROF-01 — the states of the profile screens', () => {
  test.afterEach(async () => {
    await resetMemberProfile(users.demoMember, {
      displayName: SEEDED.displayName,
      bio: SEEDED.bio,
      avatarAssetId: null,
    });
  });

  test.afterAll(async () => {
    await closeAdmin();
  });

  test('E1/E2 empty: no photo, no bio paragraph, and "Salvar alterações" disabled until dirty', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');

    // The bio block is OMITTED, not replaced by a placeholder: the hero ends at the e-mail.
    await expect(page.getByText('Sem bio')).toHaveCount(0);
    await expect(hero(page).locator('p')).toHaveCount(1); // the e-mail, and nothing else

    await page.goto('/perfil/editar');
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
    await expect(page.locator('#bio')).toHaveValue('');
    await expect(page.locator('#bio-counter')).toHaveText('0/150');
    // With no photo there is nothing to remove.
    await expect(page.getByRole('button', { name: 'Remover foto' })).toHaveCount(0);
  });

  test('E1 overflow/long-text: the longest allowed name and bio wrap instead of truncating', async ({
    page,
  }, testInfo) => {
    const name = 'Maria Aparecida Gonçalves de Albuquerque Nóbrega Sá'.slice(0, 60);
    const bio = 'Conto histórias da comunidade. '.repeat(5).slice(0, 150);
    await resetMemberProfile(users.demoMember, { displayName: name, bio });

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');

    const heading = profileName(page);
    await expect(heading).toHaveText(name);
    // Nothing is clipped at either width, and the class that would clip it is absent…
    expect(await heading.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    await expect(heading).not.toHaveClass(/truncate/);
    // …and on the phone, where 60 characters cannot fit on one line, it really wraps.
    if (testInfo.project.name === 'mobile-chromium') {
      const box = await heading.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThan(36);
    }

    const paragraph = hero(page).getByText(bio.trim());
    await expect(paragraph).toBeVisible();
    const bioBox = await paragraph.boundingBox();
    expect(bioBox?.width ?? 999).toBeLessThanOrEqual(448); // the max-w-md measure
  });

  test('E2 error: a blank name is refused with the catalog message on the field', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    // Whitespace passes the native `required` gate and is refused by the schema the API runs.
    await page.locator('#displayName').fill('   ');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    // The refusal is ANNOUNCED, not merely printed: the `Input` renders it with role="alert",
    // linked to the field through aria-describedby.
    const fieldError = page.locator('main').getByRole('alert');
    await expect(fieldError).toHaveText('Informe seu nome.');
    await expect(fieldError).toHaveAttribute('id', 'displayName-error');
    await expect(page).toHaveURL(/\/perfil\/editar$/);
    expect((await memberProfileForEmail(users.demoMember))?.displayName).toBe(SEEDED.displayName);
  });

  test('E9 error: a photo that cannot be fetched degrades to the neutral icon, never a broken glyph', async ({
    page,
  }) => {
    // A `ready` asset no object backs — what an expired, deleted or cross-tenant photo looks like.
    await stubUnfetchableAvatar(users.demoMember);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');

    await expect(
      hero(page).locator(`[role="img"][aria-label="${SEEDED.displayName}"]`),
    ).toBeVisible();
    await expect(hero(page).locator('img[src^="/v1/media/"]')).toHaveCount(0);
  });

  test('E7: the settings "Editar perfil" row is a real link now, and Notificações is the push row (07-07)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes');

    // 07-07 (UI-D-256) replaced the last "Em breve" pill with this device's push switch.
    await expect(page.locator('main').getByText('Em breve')).toHaveCount(0);
    await expect(page.locator('main [data-push-row]')).toHaveCount(1);
    await page.locator('main').getByRole('link', { name: 'Editar perfil' }).click();
    await expect(page).toHaveURL(/\/perfil\/editar$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Editar perfil' })).toBeVisible();
  });
});

/**
 * 2026-10-09 — the Instagram @ under the name, on the profile and on the member's posts. Front
 * only: the handle is the bio's last line (`lib/profile-instagram.ts`), and every surface reads it
 * back out of the bio the API already serves. The cases drive the seeded ADMINISTRATOR, the author
 * of the seeded posts, so a member's feed has a real card to carry the line; each case puts the
 * administrator's row back the way it found it.
 */
test.describe('Instagram — the @ under the name on the profile and on posts', () => {
  const HANDLE = 'rede.demo_oficial';
  /** What the bio keeps beside it: 150 minus the blank line, `Instagram: @` and the handle. */
  const ROOM = 150 - 2 - 12 - HANDLE.length;
  /** The link's accessible name (`feed.post.instagram`). */
  const LINK_NAME = `Ver @${HANDLE} no Instagram`;
  const HREF = `https://instagram.com/${HANDLE}`;

  let saved: Awaited<ReturnType<typeof memberProfileForEmail>> = null;

  test.beforeEach(async () => {
    saved = await memberProfileForEmail(users.demoAdmin);
    expect(saved, 'the seeded demo admin has a profile row').not.toBeNull();
  });

  test.afterEach(async () => {
    if (saved) await resetMemberProfile(users.demoAdmin, saved);
  });

  test.afterAll(async () => {
    await closeAdmin();
  });

  test('a pasted profile link becomes the handle, the bio counts its line, and /perfil shows the link', async ({
    page,
  }) => {
    if (!saved) throw new Error('no profile row to start from');
    await resetMemberProfile(users.demoAdmin, { ...saved, bio: null });
    const bio = 'Organizo os encontros da comunidade.';

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    const field = page.locator('#instagram');
    const counter = page.locator('#bio-counter');
    await expect(field).toHaveValue('');
    await expect(page.locator('#instagram-hint')).toHaveText(
      'Aparece abaixo do seu nome no seu perfil e nas suas publicações.',
    );
    await expect(counter).toHaveText('0/150');

    // A link copied from Instagram, tracking query and all: the field keeps only the handle.
    await field.fill(`https://www.instagram.com/${HANDLE}/?igsh=MWx0aDZ1ZzQ=`);
    await field.blur();
    await expect(field).toHaveValue(HANDLE);
    await expect(counter).toHaveText(`0/${ROOM}`);

    await page.locator('#bio').fill(bio);
    await expect(counter).toHaveText(`${bio.length}/${ROOM}`);

    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status')).toHaveText('Perfil atualizado.');
    await expect(page).toHaveURL(/\/perfil$/);

    const main = page.locator('main');
    const link = main.getByRole('link', { name: LINK_NAME });
    await expect(link).toHaveText(`@${HANDLE}`);
    await expect(link).toHaveAttribute('href', HREF);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(main.getByText(bio)).toBeVisible();
    // The storage line never shows raw.
    await expect(main.getByText('Instagram:')).toHaveCount(0);

    // The row holds the composed bio, and the form reads it back as two fields.
    expect((await memberProfileForEmail(users.demoAdmin))?.bio).toBe(
      `${bio}\n\nInstagram: @${HANDLE}`,
    );
    await page.goto('/perfil/editar');
    await expect(field).toHaveValue(HANDLE);
    await expect(page.locator('#bio')).toHaveValue(bio);
  });

  test('a member sees it under the administrator’s name: in the feed, on the post page and on the profile', async ({
    page,
  }) => {
    if (!saved) throw new Error('no profile row to start from');
    await resetMemberProfile(users.demoAdmin, { ...saved, bio: `Instagram: @${HANDLE}` });
    const [adminMembership, adminPost, memberPost] = await Promise.all([
      membershipIdFor(users.demoAdmin, 'rede-demo'),
      feedPostIdFor(seededFeed.newest, 'rede-demo'),
      feedPostIdFor(seededFeedPaging.longNameCaption, 'rede-demo'),
    ]);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // Início: the administrator's card carries the line under the name, opening Instagram.
    const card = page
      .getByRole('article', { name: `Publicação de ${seededFeed.demoAuthor}`, exact: true })
      .first();
    const line = card.getByRole('link', { name: LINK_NAME });
    await expect(line).toHaveText(`@${HANDLE}`);
    await expect(line).toHaveAttribute('href', HREF);
    await expect(line).toHaveAttribute('target', '_blank');
    await expect(card.locator('[data-post-handle]')).toHaveCount(1);

    // The post page: the same card, the same line.
    await page.goto(`/post/${adminPost}`);
    await expect(page.locator('main').getByRole('link', { name: LINK_NAME })).toHaveAttribute(
      'href',
      HREF,
    );

    // A member who has none gets no line at all.
    await page.goto(`/post/${memberPost}`);
    await expect(
      page.getByRole('article', { name: `Publicação de ${seededFeedPaging.longDisplayName}` }),
    ).toBeVisible();
    await expect(page.locator('main [data-post-handle]')).toHaveCount(0);

    // The administrator's profile, by direct link (D-47): the link, and never the raw line.
    await page.goto(`/membros/${adminMembership}`);
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: LINK_NAME })).toHaveText(`@${HANDLE}`);
    await expect(main.getByText('Instagram:')).toHaveCount(0);
  });

  test('a value that is not a handle is announced on the field, and nothing is saved', async ({
    page,
  }) => {
    if (!saved) throw new Error('no profile row to start from');
    await resetMemberProfile(users.demoAdmin, { ...saved, bio: null });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    await page.locator('#instagram').fill('perfil..duplo');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    const fieldError = page.locator('main').getByRole('alert');
    await expect(fieldError).toHaveText(
      'Esse @ não é válido. Use até 30 letras, números, pontos ou sublinhados, sem ponto no início, no fim ou repetido.',
    );
    await expect(fieldError).toHaveAttribute('id', 'instagram-error');
    await expect(page.locator('#instagram')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/perfil\/editar$/);
    expect((await memberProfileForEmail(users.demoAdmin))?.bio).toBeNull();
  });
});

const PROFILE = profileMessages.profile;
const EVENTS = eventsMessages.events;

/** The horizontal centre of an element's box, in page pixels. */
async function centreX(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box to measure');
  return box.x + box.width / 2;
}

/**
 * 2026-10-12 / 13 — what follows the hero: the "Complete seu perfil" warning, only while the photo,
 * the bio or the Instagram is missing; for a MEMBER, "Sua atividade" (the rede-social-dashboard
 * preview's report; since 08.7-03 on the member's own numbers of the nightly snapshot, with "Em
 * breve" where nothing is measured yet); then
 * the "Eventos" and "Comunidades" galleries, each only with its module on. The first "Atividades"
 * dashboard (event numbers, chart, Loja) was removed at the owner's request on 2026-10-13, as was the
 * hero's left alignment: the photo and the identity are centred on the band.
 */
test.describe('Perfil — o aviso, Eventos e Comunidades (2026-10-12)', () => {
  // 08.7-03 (D-463): "Sua atividade" reads the member's row of the daily snapshot; build both seed
  // tenants as the worker would, so the report renders instead of the preparing card.
  test.beforeAll(async () => {
    if (isRemote) return;
    await buildDashboardSnapshot('rede-demo');
    await buildDashboardSnapshot('rede-lab');
  });

  test.afterEach(async () => {
    await resetMemberProfile(users.demoMember, {
      displayName: SEEDED.displayName,
      bio: SEEDED.bio,
      avatarAssetId: null,
    });
  });

  test.afterAll(async () => {
    await closeAdmin();
    await closeDashboardAdmin();
  });

  test('the hero is centred on the band, and the warning counts the photo, the bio and the Instagram until nothing is missing', async ({
    page,
  }) => {
    const bio = 'Gosto de caminhar aos sábados.';
    await resetMemberProfile(users.demoMember, { displayName: SEEDED.displayName, bio });

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    const main = page.locator('main');

    // The photo and the name share the band's vertical axis.
    const band = hero(page).locator(':scope > div').first();
    const avatar = hero(page).locator(`[role="img"][aria-label="${SEEDED.displayName}"]`);
    const axis = await centreX(band);
    expect(Math.abs((await centreX(avatar)) - axis)).toBeLessThanOrEqual(2);
    expect(Math.abs((await centreX(profileName(page))) - axis)).toBeLessThanOrEqual(2);

    // rede-demo has every module on: the member's report, then the two galleries, in this order.
    const sections = main.locator('[data-profile-section]');
    expect(
      await sections.evaluateAll((els) => els.map((el) => el.getAttribute('data-profile-section'))),
    ).toEqual(['activity', 'events', 'communities']);
    for (const name of [
      PROFILE.activity.title,
      PROFILE.sections.events,
      PROFILE.sections.communities,
    ]) {
      await expect(main.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    }
    // The warning comes before the report.
    const order = await main
      .locator('[data-profile-completeness], [data-profile-section="activity"]')
      .evaluateAll((els) =>
        els.map((el) => (el.hasAttribute('data-profile-completeness') ? 'warning' : 'activity')),
      );
    expect(order).toEqual(['warning', 'activity']);

    // A bio and nothing else: one of the three, and the way to the form.
    const warning = main.locator('[data-profile-completeness]');
    await expect(warning).toHaveCount(1);
    await expect(warning.getByText(PROFILE.completeness.title, { exact: true })).toBeVisible();
    await expect(warning.getByText('1 de 3 itens preenchidos')).toBeVisible();
    await expect(warning.getByText('33%', { exact: true })).toBeVisible();
    await expect(warning.getByRole('link', { name: PROFILE.completeness.cta })).toHaveAttribute(
      'href',
      '/perfil/editar',
    );

    // The Instagram line counts too (it lives in the bio until the backend has its column).
    const withInstagram = `${bio}\n\nInstagram: @rede.demo_membro`;
    await resetMemberProfile(users.demoMember, {
      displayName: SEEDED.displayName,
      bio: withInstagram,
    });
    await page.reload();
    await expect(warning.getByText('2 de 3 itens preenchidos')).toBeVisible();
    await expect(warning.getByText('67%', { exact: true })).toBeVisible();

    // A photo as well: nothing is missing, so there is nothing to warn about.
    await stubUnfetchableAvatar(users.demoMember);
    await page.reload();
    await expect(profileName(page)).toHaveText(SEEDED.displayName);
    await expect(warning).toHaveCount(0);
  });

  test('the galleries: at most ten each, the right links, and "Ver todos" opens their screens', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    const main = page.locator('main');

    // Eventos: the member's gallery, or its empty card.
    const events = main.locator('[data-profile-section="events"]');
    const posters = events.getByTestId('event-poster');
    const empty = events.getByText(EVENTS.sections.mine.emptyTitle);
    await expect(posters.first().or(empty)).toBeVisible();
    if ((await posters.count()) > 0) {
      expect(await posters.count()).toBeLessThanOrEqual(10);
      for (const href of await posters.evaluateAll((els) =>
        els.map((el) => el.getAttribute('href') ?? ''),
      )) {
        expect(href).toMatch(/^\/eventos\/[^/]+$/);
      }
    } else {
      await expect(events.getByRole('link', { name: EVENTS.reine.mine.explore })).toHaveAttribute(
        'href',
        '/eventos',
      );
    }

    // Comunidades: the seeded open comunidades, in the compact card, at most ten.
    const communities = main.locator('[data-profile-section="communities"]');
    const cards = communities.getByTestId('community-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThanOrEqual(10);
    for (const href of await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute('href') ?? ''),
    )) {
      expect(href).toMatch(/^\/comunidades\/[^/]+$/);
    }

    // "Ver todos" and "Ver todas" open the two screens (each tapped once React owns the link: a
    // tap right after a document load can land before hydration and be lost).
    const seeAllEvents = events.getByRole('link', { name: PROFILE.sections.seeAllEventsLabel });
    await untilHydrated(seeAllEvents);
    await seeAllEvents.click();
    await expect(page).toHaveURL(/\/eventos\/meus$/);
    await page.goto('/perfil');
    const seeAllCommunities = communities.getByRole('link', {
      name: PROFILE.sections.seeAllCommunitiesLabel,
    });
    await untilHydrated(seeAllCommunities);
    await seeAllCommunities.click();
    await expect(page).toHaveURL(/\/comunidades$/);
  });

  test('08.7: "Sua atividade" on the member’s own numbers — five blocks, Em breve in its places, the freshness line first', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only (the snapshot is built through the fixture connection)');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');

    const report = page.locator('main [data-profile-section="activity"]');
    await expect(report).toContainText(PROFILE.activity.period);
    const blocks = report.locator('[data-activity-block]');
    await expect(blocks).toHaveCount(5);
    expect(
      await blocks.evaluateAll((els) => els.map((el) => el.getAttribute('data-activity-block'))),
    ).toEqual(['usage', 'engagement', 'seen', 'communities', 'presence']);
    // UI-D-468: the freshness line is the report body's first child.
    expect(
      await report
        .locator('[data-member-activity]')
        .evaluate((el) => el.firstElementChild?.hasAttribute('data-snapshot-freshness') ?? false),
    ).toBe(true);

    // UI-D-467: the usage block is ONE "Em breve" tile, with no chart image.
    const usage = report.locator('[data-activity-block="usage"]');
    await expect(usage.locator('[data-activity-card]')).toHaveCount(1);
    await expect(usage.locator('[data-activity-value]')).toHaveText(REPORT.comingSoon.value);
    await expect(usage.getByRole('img')).toHaveCount(0);

    // Engagement: likes and comments are numbers; saves and shares are "Em breve" (D-457 order).
    const engagement = report.locator('[data-activity-block="engagement"] [data-activity-value]');
    await expect(engagement).toHaveCount(4);
    await expect(engagement.nth(0)).toHaveText(/^\d[\d.]*$/);
    await expect(engagement.nth(1)).toHaveText(/^\d[\d.]*$/);
    await expect(engagement.nth(2)).toHaveText(REPORT.comingSoon.value);
    await expect(engagement.nth(3)).toHaveText(REPORT.comingSoon.value);

    // Seen: stories is a number, posts / videos / time are "Em breve" (D-458).
    const seen = report.locator('[data-activity-block="seen"] [data-activity-value]');
    await expect(seen).toHaveText([
      REPORT.comingSoon.value,
      /^\d[\d.]*$/,
      REPORT.comingSoon.value,
      REPORT.comingSoon.value,
    ]);

    // rede-demo has Comunidades: the block is there (bars or its empty line).
    await expect(report.locator('[data-activity-block="communities"]')).toBeVisible();
  });

  test('the staff never see "Sua atividade"', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    await expect(page.locator('main [data-profile-section="events"]')).toBeVisible();
    await expect(page.locator('main [data-profile-section="activity"]')).toHaveCount(0);
    await expect(page.locator('main [data-member-activity]')).toHaveCount(0);
  });

  test('a community without Comunidades: the report without its comunidades, and only the Eventos gallery', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only (the seeded rede-lab)');
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    // Absolute: a bare path would resolve against the config's base URL, rede-demo.
    await page.goto(`${hosts.lab}/perfil`);
    // The one-shot read below must not race the route's loading skeleton (a cold dev compile):
    // wait for the last section to be on the page first (08.7-01 deferred item).
    await expect(page.locator('main [data-profile-section="events"]')).toBeVisible();

    const sections = page.locator('main [data-profile-section]');
    expect(
      await sections.evaluateAll((els) => els.map((el) => el.getAttribute('data-profile-section'))),
    ).toEqual(['activity', 'events']);
    await expect(page.locator('main [data-activity-block]')).toHaveCount(4);
    await expect(page.locator('main [data-activity-block="communities"]')).toHaveCount(0);
  });
});

const OWNER = dashboardMessages.dashboard.tenantOwner;
const REPORT = dashboardMessages.dashboard.report;

/** The six areas of the owner's panel, in tab order, with their `?area=` slug. */
const OWNER_TABS = [
  ['visao-geral', OWNER.areas.overview],
  ['membros', OWNER.areas.members],
  ['conteudo', OWNER.areas.content],
  ['eventos', OWNER.areas.events],
  ['financeiro', OWNER.areas.finance],
  ['atendimento', OWNER.areas.support],
] as const;

/** The owner's panel on `/perfil` (its section). */
function ownerPanel(page: Page) {
  return page.locator('main [data-profile-section="owner"]');
}

/**
 * 2026-10-15 — the owner's panel ("Visão do dono", the rede-social-dashboard preview's "Dono do
 * cliente" screen) on the ADMIN's `/perfil`, right under the warning and above the galleries, on its
 * sample numbers by the owner's decision (`docs/pendencias-backend.md` item 10). Its areas, lists and
 * details are query params on `/perfil`; a member never sees it, whatever the query says.
 */
test.describe('Perfil — o painel do dono para o admin (2026-10-15)', () => {
  // 08.7-01 (D-464): Visão geral reads rede-demo's daily snapshot; build it as the worker would, so
  // the area renders its cards instead of the preparing card.
  test.beforeAll(async () => {
    if (!isRemote) await buildDashboardSnapshot('rede-demo');
  });

  test.afterAll(async () => {
    await closeDashboardAdmin();
  });

  test('08.7: Visão geral shows the real member count from the snapshot, under its freshness line', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only (the snapshot is built through the fixture connection)');
    const facts = await dashboardSnapshotFacts('rede-demo');
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    const overview = ownerPanel(page).locator('[data-owner-area="visao-geral"]');
    await expect(overview.locator('[data-snapshot-freshness]')).toHaveText(
      REPORT.freshness.today.replace('{time}', facts.time),
    );
    const members = overview
      .locator(':scope > [data-dash-stagger]')
      .first()
      .locator('[data-kpi-card]')
      .first();
    await expect(members).toContainText(OWNER.kpi.members);
    await expect(members).toContainText(new Intl.NumberFormat('pt-BR').format(facts.count));
    await expect(overview.locator('[data-owner-area-state]')).toHaveCount(0);
  });

  test('the admin sees the panel, with its header, its six tabs and the six overview cards', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    const main = page.locator('main');
    const panel = ownerPanel(page);
    await expect(panel).toBeVisible();

    // In the member report's place: before the galleries (rede-demo has every module on).
    expect(
      await main
        .locator('[data-profile-section]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-profile-section'))),
    ).toEqual(['owner', 'events', 'communities']);
    await expect(main.locator('[data-profile-section="activity"]')).toHaveCount(0);

    // The header: the tenant's mark and name, "Visão do dono", the window and the alerts bell.
    await expect(panel.locator('[data-tenant-mark]')).toHaveCount(1);
    await expect(panel.getByText(OWNER.header.subtitle, { exact: true })).toBeVisible();
    await expect(panel.getByText(OWNER.header.period, { exact: true })).toBeVisible();
    await expect(panel.locator('[data-alerts-bell]')).toBeVisible();

    // Six tabs, Visão geral open, each a link on /perfil.
    const tabs = panel.getByRole('navigation', { name: OWNER.areas.label }).getByRole('link');
    await expect(tabs).toHaveText(OWNER_TABS.map(([, label]) => label));
    for (const [index, [slug]] of OWNER_TABS.entries()) {
      await expect(tabs.nth(index)).toHaveAttribute('href', `/perfil?area=${slug}`);
    }
    await expect(tabs.first()).toHaveAttribute('aria-current', 'page');

    // Visão geral: the six numbers across the top, then the account and the admin's way out.
    const overview = panel.locator('[data-owner-area="visao-geral"]');
    const cards = overview
      .locator(':scope > [data-dash-stagger]')
      .first()
      .locator('[data-kpi-card]');
    await expect(cards).toHaveCount(6);
    // One label per card, in the source screen's order.
    await expect(cards).toContainText([
      OWNER.kpi.members,
      OWNER.kpi.engaged,
      OWNER.kpi.perPost,
      OWNER.kpi.attendance,
      OWNER.kpi.orderValue,
      OWNER.kpi.awaiting,
    ]);
    // "Conta", closed: the domain's state (rede-demo is served on its verified host).
    await expect(overview.getByText(OWNER.account.domainStatus.verified)).toBeVisible();
    await expect(overview.getByRole('link', { name: OWNER.adminLink })).toHaveAttribute(
      'href',
      '/configuracoes',
    );
    // No other client of the owner reaches the panel.
    await expect(panel).not.toContainText(/Igor|drigoralves|Instituto/);
  });

  test('?area= switches the area, a tab lands on the panel, and the bell opens its alerts', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    for (const [slug] of OWNER_TABS) {
      await page.goto(`/perfil?area=${slug}`);
      const panel = ownerPanel(page);
      await expect(panel.locator(`[data-owner-area="${slug}"]`)).toBeVisible();
      await expect(
        panel.getByRole('navigation', { name: OWNER.areas.label }).getByRole('link', {
          name: OWNER_TABS.find(([s]) => s === slug)?.[1] ?? '',
          exact: true,
        }),
      ).toHaveAttribute('aria-current', 'page');
      // A step of the panel lands on it, not on the profile's hero.
      await expect(panel.getByRole('navigation', { name: OWNER.areas.label })).toBeInViewport();
    }

    // A tab is a plain link on /perfil: clicking Membros opens that area.
    await page.goto('/perfil');
    const tab = ownerPanel(page)
      .getByRole('navigation', { name: OWNER.areas.label })
      .getByRole('link', { name: OWNER.areas.members, exact: true });
    await untilHydrated(tab);
    await tab.click();
    await expect(page).toHaveURL(/\/perfil\?area=membros$/);
    await expect(ownerPanel(page).locator('[data-owner-area="membros"]')).toBeVisible();

    // The bell opens the three alerts under the header.
    const bell = ownerPanel(page).locator('[data-alerts-bell]');
    await untilHydrated(bell);
    await bell.click();
    await expect(ownerPanel(page).locator('[data-alerts-panel]')).toBeVisible();
  });

  test('Membros on real data: the six bands, "Em breve" for who left, a band\'s members and one member detail', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only (the snapshot is built through the fixture connection)');
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil?area=membros');
    const area = ownerPanel(page).locator('[data-owner-area="membros"]');
    await expect(area.locator('[data-snapshot-freshness]')).toBeVisible();
    await expect(area.locator('[data-owner-area-state]')).toHaveCount(0);

    // The six bands, each summary an exact count and share (UI-D-486).
    const bands = area.locator('details');
    await expect(bands).toHaveCount(6);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await expect(bands.nth(index).locator('summary')).toContainText(/\d+ · /);
    }

    // "Saíram" is an "Em breve" tile, never a number (D-465).
    const left = area
      .locator('[data-kpi-card]')
      .filter({ has: page.getByText(OWNER.growth.left, { exact: true }) });
    await expect(left).toContainText(REPORT.comingSoon.value);

    // "Avisar sobre o próximo evento" stays disabled, the "Em breve" pill after it (UI-D-478).
    const recover = area
      .locator('[data-disabled-action]')
      .filter({ hasText: OWNER.recover.action });
    await expect(recover.getByRole('button', { name: OWNER.recover.action })).toBeDisabled();
    await expect(recover.locator('[data-coming-soon]')).toHaveText(REPORT.comingSoon.value);

    // A band with members lists them; a member card opens the panel's member detail (D-461).
    const member = area.locator('details a[href*="&membro="]').first();
    await expect(member).toHaveCount(1);
    const href = (await member.getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/perfil\?area=membros(&[a-z]+=[\w-]+)*&membro=[0-9a-f-]{36}$/);
    await page.goto(href);
    const detail = ownerPanel(page).locator('[data-owner-area="membros"]');
    await expect(detail.getByText(OWNER.memberDetail.last30.title, { exact: true })).toBeVisible();
    await expect(
      detail.getByText(OWNER.memberDetail.evolution.today, { exact: false }),
    ).toBeVisible();
    // Its suggestion's action is disabled with the pill, as every capability action.
    const suggestion = detail.locator('[data-disabled-action]').first();
    await expect(suggestion.getByRole('button')).toBeDisabled();
    await expect(suggestion.locator('[data-coming-soon]')).toHaveText(REPORT.comingSoon.value);
    // "Publicações vistas" is an "Em breve" tile and opens nothing.
    expect(await detail.locator('a[href*="lista=posts-vistos"]').count()).toBe(0);
  });

  test('Conteúdo on real data: Em breve where nothing is measured, a post card, its detail and its likers', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only (the snapshot is built through the fixture connection)');
    const CONTENT = OWNER.content;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil?area=conteudo');
    const area = ownerPanel(page).locator('[data-owner-area="conteudo"]');
    await expect(area.locator('[data-snapshot-freshness]')).toBeVisible();
    await expect(area.locator('[data-owner-area-state]')).toHaveCount(0);

    // "Taxa de engajamento" is an unlinked "Em breve" tile (D-455): no post view is recorded.
    const rate = area
      .locator('[data-kpi-card]')
      .filter({ has: page.getByText(CONTENT.overview.kpis.rate, { exact: true }) });
    await expect(rate).toContainText(REPORT.comingSoon.value);
    await expect(area.locator('a[href*="numero=taxa"]')).toHaveCount(0);

    // Publicações: the seeded posts as cards, each with its member like count, opening its detail.
    await page.goto('/perfil?area=conteudo&vista=publicacoes');
    const card = area
      .locator('a[href*="&post="]')
      .filter({ has: page.locator('[data-count="likes"]') });
    await expect(card.first()).toBeVisible();
    await expect(card.first().locator('[data-count="likes"]')).toContainText(/\d/);
    const href = (await card.first().getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/perfil\?area=conteudo&vista=publicacoes&post=[0-9a-f-]{36}$/);

    // The detail: its likes open who liked; saves never open (D-455).
    await page.goto(href);
    const likes = area.locator('a#quem-curtidas');
    await expect(likes).toBeVisible();
    expect(await area.locator('a[href*="quem=salvamentos"]').count()).toBe(0);
    await page.goto((await likes.getAttribute('href')) ?? '');
    await expect(area.getByText(CONTENT.people.title.likes, { exact: true })).toBeVisible();
    await expect(area.locator('[data-owner-area-state]')).toHaveCount(0);

    // The comments waiting for the team: "Responder" opens the post page (D-461), when one waits.
    await page.goto('/perfil?area=conteudo&responder=comentarios');
    await expect(area.getByText(CONTENT.replies.title, { exact: true })).toBeVisible();
    const replies = area.locator('a[data-reply]');
    if ((await replies.count()) > 0) {
      await expect(replies.first()).toHaveAttribute('href', /^\/post\/[0-9a-f-]{36}$/);
    }
  });

  test('Eventos on real data: the soonest seeded event with its confirmed count, opening its attendee list', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only (the snapshot is built through the fixture connection)');
    const soonest = await dashboardSoonestEventFacts('rede-demo');
    test.skip(soonest === null, 'rede-demo has no upcoming event in the seed');
    if (!soonest) return;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil?area=eventos');
    const area = ownerPanel(page).locator('[data-owner-area="eventos"]');
    await expect(area.locator('[data-snapshot-freshness]')).toBeVisible();
    await expect(area.locator('[data-owner-area-state]')).toHaveCount(0);

    // Próximos eventos: the soonest event first, with its Inscritos, linked to its attendee list.
    const card = area.locator(`a[href="/eventos/${soonest.id}/participantes"]`).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(soonest.title);
    const confirmed = card
      .locator('dt', { hasText: OWNER.upcoming.columns.confirmed })
      .locator('xpath=following-sibling::dd[1]');
    await expect(confirmed).toHaveText(new Intl.NumberFormat('pt-BR').format(soonest.confirmed));
    // "Receita" is the Em breve pill (D-455); the waiting list is an Em breve block, its action off.
    await expect(card.locator('[data-coming-soon]')).toHaveText(REPORT.comingSoon.value);
    await expect(area.locator('[data-coming-soon-block]')).toHaveCount(1);
    await expect(
      area.locator('[data-disabled-action]').getByRole('button', { name: OWNER.waitlist.see }),
    ).toBeDisabled();

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${soonest.id}/participantes$`));
  });

  test('Financeiro on real data: a product with its revenue, a floored band, Ofertas Em breve and the store’s buyers link', async ({
    page,
  }, testInfo) => {
    test.skip(isRemote, 'local stack only (the snapshot is built through the fixture connection)');
    const prefix = `E2E 087-10 ${testInfo.project.name} `;
    const name = `${prefix}Guia`;
    await deleteProductsByPrefix(prefix);
    try {
      // A product of three days ago with two paid orders two days ago: 2 × R$ 123,45 in the window,
      // two buyers, so every band they fall in is floored (D-462).
      const productId = await createProduct({
        tenantSlug: 'rede-demo',
        name,
        priceCents: 12345,
        minutesAgo: 3 * 24 * 60,
      });
      await insertPaidOrders({ tenantSlug: 'rede-demo', productId, count: 2, daysAgo: 2 });
      await buildDashboardSnapshot('rede-demo');

      await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
      await page.goto('/perfil?area=financeiro');
      const area = ownerPanel(page).locator('[data-owner-area="financeiro"]');
      await expect(area.locator('[data-snapshot-freshness]')).toBeVisible();
      await expect(area.locator('[data-owner-area-state]')).toHaveCount(0);

      // De onde vem a receita: the product by its live name with its revenue; by band, the floor.
      const product = area.locator('[data-finance-sources="product"] li', { hasText: name });
      await expect(product).toContainText(/R\$\s247/);
      const bands = area.locator('[data-finance-sources="band"]');
      await expect(bands).toContainText(OWNER.finance.overview.sources.byBand);
      await expect(bands.locator('li[data-floored]').first()).toContainText(
        OWNER.finance.overview.sources.floor.replace('{floor}', '5'),
      );
      // The accesses that expire are an Em breve line, never a link (D-465).
      await expect(
        area.locator('[data-finance-attention="expiring"] [data-coming-soon]'),
      ).toHaveText(REPORT.comingSoon.value);

      // The product's detail: "Ofertas" reads Em breve, its buyers open the store's screen (D-461).
      await page.goto(`/perfil?area=financeiro&vista=produtos&produto=${productId}`);
      const offers = area.locator('[data-coming-soon-block]', {
        hasText: OWNER.finance.offers.title,
      });
      await expect(offers).toContainText(REPORT.comingSoon.value);
      await expect(area.locator('a[data-finance-buyers-link]')).toHaveAttribute(
        'href',
        `/loja/${productId}/compradores`,
      );
    } finally {
      await deleteProductsByPrefix(prefix);
      await buildDashboardSnapshot('rede-demo');
      await closeStoreAdmin();
    }
  });

  test('a member never sees the panel, whatever the query says', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    for (const path of ['/perfil', '/perfil?area=membros', '/perfil?area=financeiro']) {
      await page.goto(path);
      await expect(page.locator('main [data-profile-section="events"]')).toBeVisible();
      await expect(ownerPanel(page)).toHaveCount(0);
      await expect(page.locator('main [data-owner-area]')).toHaveCount(0);
    }
  });
});
