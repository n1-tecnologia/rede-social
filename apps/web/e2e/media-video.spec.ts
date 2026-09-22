import { expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  createMember,
  deleteTenantVideoAssets,
  deleteUserByEmail,
  seedVideoAsset,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

/**
 * MEDIA-03 / TENANT-04 (plan 03-07): the admin media screen `/configuracoes/midia` and the video
 * player, on the phone (`mobile-chromium`, an iPhone 14 preset) and on the desktop.
 *
 * The isolation half of the contract is what most of this file is about: a member and a
 * `support_tenant` must not even learn that the screen exists, so the "Administração" group is
 * asserted ABSENT from the DOM (`toHaveCount(0)`) rather than merely invisible, and a direct
 * navigation answers the app's not-found page rather than a 403 screen.
 *
 * Everything runs against `VIDEO_PROVIDER=fake`; the real Mux transcode and the real-device HLS
 * playback stay the two known-blocked Phase 01.1 UAT lines recorded in `docs/DEPLOY.md`.
 */

const DEMO_SLUG = 'tria-demo';
/** A throwaway `support_tenant`: the seeded set has no support user, and E7 needs all three roles. */
const SUPPORT_EMAIL = 'support-media@tria-demo.local';

/** The settings group under test — named by its catalog label, so a copy drift fails here. */
function adminGroup(page: Page) {
  return page.locator('main section').filter({ hasText: 'Administração' });
}

function mediaRow(page: Page) {
  return page.locator('main a[href="/configuracoes/midia"]');
}

test.describe('MEDIA-03 — the admin media screen', () => {
  test.beforeAll(async () => {
    await deleteTenantVideoAssets(DEMO_SLUG);
    await createMember(SUPPORT_EMAIL, SEED_PASSWORD, DEMO_SLUG, 'support_tenant');
  });

  test.afterEach(async () => {
    await deleteTenantVideoAssets(DEMO_SLUG);
  });

  test.afterAll(async () => {
    await deleteTenantVideoAssets(DEMO_SLUG);
    await deleteUserByEmail(SUPPORT_EMAIL);
    await closeAdmin();
  });

  test('an admin_tenant reaches "Mídia" from Configurações and lands on the empty library', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes');

    await expect(adminGroup(page)).toHaveCount(1);
    await expect(mediaRow(page)).toBeVisible();

    await mediaRow(page).click();
    await expect(page).toHaveURL(/\/configuracoes\/midia$/);
    await expect(page.getByRole('heading', { name: 'Mídia' })).toBeVisible();
    await expect(page.getByText('Nenhum vídeo ainda')).toBeVisible();
    await expect(
      page.getByText('Envie um vídeo para testar a reprodução no celular.'),
    ).toBeVisible();
  });

  test('a member never learns the screen exists — no group, and a direct visit is not-found', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes');

    // ABSENT from the DOM, not hidden by CSS and not disabled (E7/partial, T-03-48).
    await expect(adminGroup(page)).toHaveCount(0);
    await expect(mediaRow(page)).toHaveCount(0);
    // The rest of the settings page is unchanged for a member.
    await expect(page.getByText('Editar perfil')).toBeVisible();
    await expect(page.getByText('Em breve')).toBeVisible();

    const response = await page.goto('/configuracoes/midia');
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="media-library"]')).toHaveCount(0);
    // Never a 403 screen: the repo's isolation convention is one indistinguishable miss.
    await expect(page.getByText('Acesso negado')).toHaveCount(0);
  });

  test('a support_tenant is refused exactly like a member', async ({ page }) => {
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes');

    await expect(adminGroup(page)).toHaveCount(0);
    await expect(mediaRow(page)).toHaveCount(0);

    const response = await page.goto('/configuracoes/midia');
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="media-library"]')).toHaveCount(0);
  });

  test('the library lists the community videos newest-first with their real statuses', async ({
    page,
  }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'ready',
      filename: 'primeiro.mp4',
      playbackId: 'fake-playback-e2e-1',
      durationSeconds: 12,
    });
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'processing',
      filename: 'segundo.mp4',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    const rows = page.locator('[data-testid="media-row"]');
    await expect(rows).toHaveCount(2);
    // Newest first: the processing row was inserted last, so it heads the list.
    await expect(rows.nth(0)).toContainText('segundo.mp4');
    await expect(rows.nth(0)).toContainText('Processando');
    await expect(rows.nth(1)).toContainText('primeiro.mp4');
    await expect(rows.nth(1)).toContainText('Pronto');
    // The pt-BR date is rendered, not an ISO string.
    await expect(rows.nth(1)).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  });

  test('a processing row is NOT interactive; a ready row is a button', async ({ page }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'processing',
      filename: 'aguardando.mp4',
    });
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'ready',
      filename: 'pronto.mp4',
      playbackId: 'fake-playback-e2e-2',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    const processing = page.locator('[data-testid="media-row"][data-status="processing"]');
    const ready = page.locator('[data-testid="media-row"][data-status="ready"]');
    await expect(processing).toHaveCount(1);
    await expect(ready).toHaveCount(1);
    // "Not interactive" is structural: the processing row is not a <button> at all.
    expect(await processing.evaluate((node) => node.tagName)).toBe('DIV');
    // The processing thumbnail shows the spinner and no poster.
    await expect(processing.locator('[data-testid="media-row-spinner"]')).toHaveCount(1);
    await expect(processing.locator('img')).toHaveCount(0);
  });

  test('a failed row carries the danger pill and the failure line', async ({ page }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'failed',
      filename: 'quebrado.mp4',
      failureReason: 'video.asset.errored',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    const row = page.locator('[data-testid="media-row"][data-status="failed"]');
    await expect(row).toContainText('Falhou');
    await expect(row.locator('[data-testid="media-row-failure"]')).toHaveText(
      'Não foi possível processar este vídeo.',
    );
    // No provider text ever reaches the screen (T-03-51).
    await expect(row).not.toContainText('video.asset.errored');
  });

  test('a rejected row reads "Recusado" — the duration cap refusal', async ({ page }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'rejected',
      filename: 'longo-demais.mp4',
      failureReason: 'duration_too_long',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    await expect(page.locator('[data-testid="media-row"][data-status="rejected"]')).toContainText(
      'Recusado',
    );
    await expect(page.locator('main')).not.toContainText('duration_too_long');
  });
});
