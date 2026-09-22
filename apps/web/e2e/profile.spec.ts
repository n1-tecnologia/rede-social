import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  memberProfileForEmail,
  resetMemberProfile,
  stubUnfetchableAvatar,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { pickPhoto } from './media-fixtures';
import { ensureWorker } from './worker';

/**
 * PROF-01 (plan 03-04): the member's own profile and its edit form, on the phone
 * (`mobile-chromium`, an iPhone 14 preset) and on the desktop. Everything here is the member's own
 * screen — `GET /v1/me/profile` through the Next BFF, `PATCH` through the server action — and every
 * string asserted is the catalog's, so a copy drift fails the spec rather than shipping.
 *
 * The seeded `member@tria-demo.local` is SHARED by the whole suite, so `afterEach` puts the row back
 * to the values `pnpm db:seed` writes (no photo, no bio).
 */

/** What `scripts/seed.ts` writes for the demo member. */
const SEEDED = { displayName: 'Membro TRIA Demo', bio: null } as const;

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
    await expect(profileName(page)).toHaveCount(1);
    await expect(profileName(page)).toHaveText(SEEDED.displayName);
    await expect(page.getByText(users.demoMember)).toBeVisible();

    // The seeded member has no photo and no bio: the neutral avatar, and no placeholder line.
    await expect(page.locator('main [role="img"][aria-label="Membro TRIA Demo"]')).toBeVisible();
    await expect(page.locator('main img[src^="/v1/media/"]')).toHaveCount(0);

    for (const [name, href] of [
      ['Editar perfil', '/perfil/editar'],
      ['Membros', '/membros'],
      ['Configurações', '/configuracoes'],
    ] as const) {
      await expect(page.locator('main').getByRole('link', { name })).toHaveAttribute('href', href);
    }

    // UI-D-01: the Phase 2 role pill is gone — no role word appears anywhere on the screen.
    await expect(page.getByText(/^(Administrador|Membro|Suporte)$/)).toHaveCount(0);
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

  test('E7: the settings "Editar perfil" row is a real link now, and Notificações keeps its pill', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes');

    await expect(page.locator('main').getByText('Em breve')).toHaveCount(1); // Notificações only
    await page.locator('main').getByRole('link', { name: 'Editar perfil' }).click();
    await expect(page).toHaveURL(/\/perfil\/editar$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Editar perfil' })).toBeVisible();
  });
});
