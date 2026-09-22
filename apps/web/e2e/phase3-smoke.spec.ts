import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  deleteTenantVideoAssets,
  memberProfileForEmail,
  resetMemberProfile,
} from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { pickPhoto } from './media-fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 3 smoke (plan 03-08) — the phase GOAL walked end to end on a phone, in the
 * `phase2-smoke.spec.ts` shape: one spec, real fixtures, two witnesses (a member and the community's
 * `admin_tenant`), and an explicit annotation wherever the walk deliberately proves nothing.
 *
 * The goal, in the user's own words: *"a member uploads their photo from their phone, edits their
 * name and bio, and finds the other members by name — and the admin uploads a phone-recorded video
 * that just plays for everyone."* So the walk is:
 *
 *   1. the member sets a photo, renames themselves and writes a bio, and the avatar really renders
 *      from `/v1/media/…` in the worker's derived widths;
 *   2. the member finds `João Gonçalves` by typing the unaccented fragment `goncal`, opens him, and
 *      sees a name and a bio and nothing else — no role, no e-mail (D-45/D-46);
 *   3. the admin uploads `sample.mp4`, watches the row sit at "Processando" and flip to "Pronto",
 *      and opens the player.
 *
 * It does NOT duplicate `profile.spec.ts`, `members.spec.ts`, `media-upload.spec.ts` or
 * `media-video.spec.ts` — those own the states, the errors and the role matrix. This file owns the
 * single question "does the phase's story hold from end to end on an iPhone".
 *
 * **What this spec deliberately does not prove** is recorded as annotations naming Phase 01.1: real
 * HLS playback on a real device, and a real Mux transcode. See `docs/DEPLOY.md` for both.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (seeded tria-demo, the local worker, Storage fixtures)');

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** The SAME iPhone capture the kernel unit suite pins — the phone case the goal actually names. */
const HEIC = `${FIXTURES}iphone.heic`;
/** 6.98 MiB at 2048 px: above the resumable threshold, so the photo really travels over TUS. */
const LARGE = `${FIXTURES}large.jpg`;
/** 186 KiB of real H.264 — see `e2e/fixtures/README.md` for the AVFoundation generator. */
const SAMPLE_MP4 = `${FIXTURES}sample.mp4`;

const DEMO_SLUG = 'tria-demo';
const SEEDED = { displayName: 'Membro TRIA Demo', bio: null } as const;
const NEW_NAME = 'Membro TRIA Demo';
const NEW_BIO = 'Venho aos encontros de sábado.';

/** What the seed writes for the member the search must find (`scripts/seed.ts`). */
const GONCALVES = {
  name: 'João Gonçalves',
  bio: 'Organizo os encontros de sábado.',
  email: 'joao.goncalves@tria-demo.local',
} as const;

let stopWorker: (() => Promise<void>) | null = null;

/** The photo field's OWN alert — Next renders a permanent empty route announcer otherwise. */
function photoAlert(page: Page) {
  return page.locator('[data-photo-field]').getByRole('alert');
}

/**
 * Picks a video the way the admin does, through the real OS picker. It is also the HYDRATION GATE:
 * `/configuracoes/midia` has a `loading.tsx`, so a bare `setInputFiles` can land on server-rendered
 * HTML where nothing is listening and the pick is silently lost (03-07's finding).
 */
async function pickVideo(page: Page, file: string): Promise<void> {
  const opening = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Enviar vídeo' }).click();
  await (await opening).setFiles(file);
}

test.beforeAll(async () => {
  // Variant derivation (`kernel.media-derive-variants`) and the fake provider's deferred ready event
  // both run in the worker role, so the walk needs one spawned for its whole length.
  stopWorker = await ensureWorker();
  await deleteTenantVideoAssets(DEMO_SLUG);
});

test.afterAll(async () => {
  await resetMemberProfile(users.demoMember, {
    displayName: SEEDED.displayName,
    bio: SEEDED.bio,
    avatarAssetId: null,
  });
  await deleteTenantVideoAssets(DEMO_SLUG);
  await stopWorker?.();
  await closeAdmin();
});

test.describe('03-08 — the Phase 3 goal walked on a phone', () => {
  // ROADMAP criterion 1's "on a phone": the walk is the iPhone 14 preset. The desktop project keeps
  // the per-screen suites; re-walking the whole goal there would buy a second copy of the same
  // evidence at the cost of the slowest spec in the repo.
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== 'mobile-chromium',
      'the phase-goal walk is a phone walk (ROADMAP criterion 1)',
    );
  });

  test('1. a member sets a photo from their phone, renames themselves and writes a bio', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await page.goto('/perfil');
    await page.locator('main').getByRole('link', { name: 'Editar perfil' }).click();
    await expect(page).toHaveURL(/\/perfil\/editar$/);

    // The phone case first: a real iPhone HEIC, handed to the browser re-encode (R-12). Chromium
    // ships no HEIC decoder, so the honest local answer is the "could not prepare" copy; Safari on a
    // real device decodes it through the OS codec and succeeds. BOTH branches are accepted here and
    // NEITHER may ever name the format to the member — the silent-success half is the real-device
    // check recorded as blocked on Phase 01.1 below.
    await pickPhoto(page, HEIC);
    const heicSucceeded = await page
      .getByRole('status')
      .filter({ hasText: 'Foto atualizada.' })
      .isVisible()
      .catch(() => false);
    if (!heicSucceeded) {
      await expect(photoAlert(page)).toHaveText(
        'Não foi possível preparar esta imagem. Tente outra foto.',
      );
    }
    await expect(page.locator('body')).not.toContainText(/heic/i);
    await expect(page.locator('body')).not.toContainText('Formato não suportado');
    testInfo.annotations.push({
      type: 'HEIC branch taken locally',
      description: heicSucceeded
        ? 'browser decoded it'
        : 'browser has no HEIC decoder (expected on Chromium)',
    });

    // …then the photo that carries the walk: 6.98 MiB, so it really goes over TUS, straight to
    // Storage, and never through our own origin.
    await pickPhoto(page, LARGE);
    await expect(page.getByRole('status')).toHaveText('Foto atualizada.', { timeout: 60_000 });

    const committed = await expect
      .poll(async () => (await memberProfileForEmail(users.demoMember))?.avatarAssetId ?? null, {
        timeout: 20_000,
      })
      .not.toBeNull()
      .then(async () => (await memberProfileForEmail(users.demoMember))?.avatarAssetId as string);

    // The name and the bio are the FORM's half, saved explicitly (the photo commits on its own).
    await page.locator('#displayName').fill(NEW_NAME);
    await page.locator('#bio').fill(NEW_BIO);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page).toHaveURL(/\/perfil$/);

    // The worker derived the ladder off the request path, so the display size really exists.
    await expect
      .poll(async () => (await page.request.get(`/v1/media/${committed}/w320`)).status(), {
        timeout: 60_000,
      })
      .toBe(200);

    await page.goto('/perfil');
    const photo = page.locator('main img[src^="/v1/media/"]');
    await expect(photo).toHaveAttribute('src', `/v1/media/${committed}/w320`);
    await expect(photo).toHaveAttribute('srcset', /w128 128w.*w320 320w/);
    // Rendered, not merely addressed: a 404 would have cleared `src` through `onError` (03-04 E9).
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('main').getByText(NEW_BIO)).toBeVisible();
  });

  test('2. the member finds another member by an unaccented fragment and opens their profile', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await page.goto('/perfil');
    await page.locator('main').getByRole('link', { name: 'Membros' }).click();
    await expect(page).toHaveURL(/\/membros$/);

    const rows = page.locator('main a[href^="/membros/"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(1);

    // `goncal` has neither the cedilla nor the accent: the fold is the database's, not the typist's.
    await page.getByLabel('Buscar por nome').fill('goncal');
    await expect(page).toHaveURL(/\?q=goncal$/);
    await expect(rows).toHaveCount(1);
    await expect(page.locator('main').getByText(GONCALVES.name)).toBeVisible();

    await rows.first().click();
    await expect(page).toHaveURL(/\/membros\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GONCALVES.name);
    await expect(page.locator('main').getByText(GONCALVES.bio)).toBeVisible();

    // A name and a bio and NOTHING else: no e-mail (D-46) and no role word (D-45).
    const main = page.locator('main');
    await expect(main.getByText(GONCALVES.email)).toHaveCount(0);
    await expect(main.getByText(/@tria-demo\.local/)).toHaveCount(0);
    await expect(main.getByText(/^(Administrador|Membro|Suporte)$/)).toHaveCount(0);
  });

  test('3. the admin uploads a phone-recorded video and watches it reach "Pronto"', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    await page.goto('/configuracoes');
    await page.locator('main a[href="/configuracoes/midia"]').click();
    await expect(page).toHaveURL(/\/configuracoes\/midia$/);
    await expect(page.getByRole('heading', { name: 'Mídia' })).toBeVisible();

    await pickVideo(page, SAMPLE_MP4);

    const rows = page.locator('[data-testid="media-row"]');
    const processing = page.locator('[data-testid="media-row"][data-status="processing"]');
    const pending = page.locator('[data-testid="media-row"][data-status="pending"]');
    await expect(processing.or(pending).first()).toBeVisible({ timeout: 60_000 });
    await expect(rows.first()).toContainText('Processando');

    // The fake provider's deferred ready event lands a couple of seconds later; the 5 s poll is what
    // makes the flip visible without a reload, and the live region announces it.
    await expect(page.locator('[data-testid="media-row"][data-status="ready"]')).toHaveCount(1, {
      timeout: 90_000,
    });
    await expect(rows.first()).toContainText('Pronto');
    await expect(page.locator('[data-testid="media-live"]')).toHaveText('Vídeo pronto.');

    // Opening the sheet is where a member would press play. What a headless Chromium can witness is
    // that the player mounts with a credential and reports no error; that a real device DECODES the
    // HLS rendition is the Phase 01.1 check annotated below.
    await page.locator('[data-testid="media-row"][data-status="ready"]').click();
    await expect(page.locator('[data-testid="video-ready"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="video-ready"]')).not.toContainText(
      /error|401|403|404/i,
    );

    testInfo.annotations.push({
      type: 'NOT PROVEN HERE — blocked on Phase 01.1',
      description:
        'Real-device HLS playback: that the "Pronto" video actually plays, with a thumbnail, on an ' +
        'iPhone (Safari) and an Android device (Chrome). Playwright bundles Chromium, which cannot ' +
        'stand in for iOS Safari HLS — the same class of finding as 02-11 standalone install. ' +
        'Re-run instructions: docs/DEPLOY.md, Phase 01.1 section.',
    });
    testInfo.annotations.push({
      type: 'NOT PROVEN HERE — blocked on Phase 01.1',
      description:
        'A real Mux transcode: no Mux account and no GCP Secret Manager exist yet, so every ' +
        'automated proof in Phase 3 runs against VIDEO_PROVIDER=fake. Flipping it to mux is the ' +
        'Phase 01.1 runbook item in docs/DEPLOY.md.',
    });
  });
});
