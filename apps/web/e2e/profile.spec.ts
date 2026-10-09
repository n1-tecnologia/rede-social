import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  feedPostIdFor,
  memberProfileForEmail,
  membershipIdFor,
  resetMemberProfile,
  stubUnfetchableAvatar,
} from './admin';
import { hosts, login, SEED_PASSWORD, seededFeed, seededFeedPaging, users } from './fixtures';
import { pickPhoto } from './media-fixtures';
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

/** The display name on `/perfil` — the Title role (24/700), the one 24px element of the screen. */
function profileName(page: Page) {
  return page.locator('main .text-2xl');
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

  test('the profile screen shows the member, three rows and no role badge (UI-D-01)', async ({
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
    await expect(page.locator('main [role="img"][aria-label="Membro Rede Demo"]')).toBeVisible();
    await expect(page.locator('main img[src^="/v1/media/"]')).toHaveCount(0);

    for (const [name, href] of [
      ['Editar perfil', '/perfil/editar'],
      ['Membros', '/membros'],
      ['Configurações', '/configuracoes'],
    ] as const) {
      await expect(page.locator('main').getByRole('link', { name })).toHaveAttribute('href', href);
    }

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
    const photo = page.locator('main img[src^="/v1/media/"]');
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
    await expect(page.locator('main img[src^="/v1/media/"]')).toHaveCount(0);
    await expect(
      page.locator(`main [role="img"][aria-label="${SEEDED.displayName}"]`),
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

    // The bio block is OMITTED, not replaced by a placeholder: the rows follow the name directly.
    await expect(page.getByText('Sem bio')).toHaveCount(0);
    await expect(page.locator('main p')).toHaveCount(1); // the e-mail, and nothing else

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

    const paragraph = page.getByText(bio.trim());
    await expect(paragraph).toBeVisible();
    const bioBox = await paragraph.boundingBox();
    expect(bioBox?.width ?? 999).toBeLessThanOrEqual(320); // the max-w-xs measure
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
      page.locator(`main [role="img"][aria-label="${SEEDED.displayName}"]`),
    ).toBeVisible();
    await expect(page.locator('main img[src^="/v1/media/"]')).toHaveCount(0);
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
