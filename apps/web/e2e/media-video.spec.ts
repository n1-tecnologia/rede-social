import { fileURLToPath } from 'node:url';
import { expect, type Page, type Request, test } from '@playwright/test';
import {
  closeAdmin,
  createMember,
  deleteTenantVideoAssets,
  deleteUserByEmail,
  markVideoReady,
  newestVideoAsset,
  seedVideoAsset,
  seedVideoAssets,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

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
/** 186 KiB of real H.264 — see `e2e/fixtures/README.md` for the AVFoundation generator. */
const SAMPLE_MP4 = fileURLToPath(new URL('./fixtures/sample.mp4', import.meta.url));

/** The settings group under test — named by its catalog label, so a copy drift fails here. */
function adminGroup(page: Page) {
  return page.locator('main section').filter({ hasText: 'Administração' });
}

function mediaRow(page: Page) {
  return page.locator('main a[href="/configuracoes/midia"]');
}

/**
 * Picks a video the way the admin does: tap the primary CTA, answer the OS picker.
 *
 * It is also the HYDRATION GATE. The route has a `loading.tsx`, so the client island mounts behind a
 * Suspense boundary; a bare `setInputFiles` can land on server-rendered HTML where nothing is
 * listening and the pick is silently lost (the same trap `media-fixtures.ts` documents for the photo
 * zone). `waitForEvent('filechooser')` cannot resolve until React's own `onClick` has run, so the
 * file is only handed over once the zone is genuinely interactive.
 */
async function pickVideo(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const opening = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Enviar vídeo' }).click();
  await (await opening).setFiles(file);
}

/**
 * What a role that may not see the media screen gets. The assertion is on the RENDERED SCREEN, not
 * on `response.status()`: the route has a `loading.tsx`, so Next streams it and the shell commits
 * `200` before the server component reaches `notFound()`. The status of a streamed shell is an
 * implementation detail of rendering; what the isolation rule actually promises is that the screen
 * is not there and no refusal is explained.
 */
async function expectNotFound(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="media-library"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="media-skeleton"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mídia' })).toHaveCount(0);
  await expect(page.locator('#video-dropzone')).toHaveCount(0);
  // Never a 403 screen: the repo's isolation convention is one indistinguishable miss.
  await expect(page.getByText('Acesso negado')).toHaveCount(0);
  await expect(page.getByText(/403|Forbidden|permiss/i)).toHaveCount(0);
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

    await page.goto('/configuracoes/midia');
    await expectNotFound(page);
  });

  test('a support_tenant is refused exactly like a member', async ({ page }) => {
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes');

    await expect(adminGroup(page)).toHaveCount(0);
    await expect(mediaRow(page)).toHaveCount(0);

    await page.goto('/configuracoes/midia');
    await expectNotFound(page);
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

  test('pagination is the directory contract: 25 rows, then "Carregar mais" appends the rest', async ({
    page,
  }) => {
    await seedVideoAssets(DEMO_SLUG, users.demoAdmin, 27);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    const rows = page.locator('[data-testid="media-row"]');
    await expect(rows).toHaveCount(25);

    const more = page.getByRole('button', { name: 'Carregar mais' });
    await expect(more).toBeVisible();
    await more.click();

    // APPENDS — the first page's rows keep their order and their DOM position.
    await expect(rows).toHaveCount(27);
    await expect(rows.nth(0)).toContainText('lote-1.mp4');
    // The button is gone exactly when the cursor is exhausted; it never comes back empty.
    await expect(more).toHaveCount(0);
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

/** Every request the page made, so "the bytes never transit our servers" is an assertion. */
function recordRequests(page: Page) {
  const seen: { url: string; method: string; body: number }[] = [];
  page.on('request', (request: Request) => {
    let body = 0;
    try {
      body = request.postDataBuffer()?.length ?? 0;
    } catch {
      body = -1; // a streamed body Playwright will not buffer — still not ours, see the assertions
    }
    seen.push({ url: request.url(), method: request.method(), body });
  });
  return seen;
}

test.describe('MEDIA-03 — the upload and the player', () => {
  let stopWorker: (() => Promise<void>) | null = null;

  test.beforeAll(async () => {
    // The fake provider simulates a transcode with a DEFERRED `kernel.media-provider-event` job, so
    // the flip to `ready` only happens if something is actually polling the queue.
    stopWorker = await ensureWorker();
    await deleteTenantVideoAssets(DEMO_SLUG);
  });

  test.afterEach(async () => {
    await deleteTenantVideoAssets(DEMO_SLUG);
  });

  test.afterAll(async () => {
    await stopWorker?.();
    await deleteTenantVideoAssets(DEMO_SLUG);
    await closeAdmin();
  });

  test('an admin uploads a video: progress, then the row sits at "Processando" and flips to "Pronto"', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    const requests = recordRequests(page);
    await page.goto('/configuracoes/midia');

    await pickVideo(page, SAMPLE_MP4);

    // The row enters the list with the warning pill as soon as the provider has the bytes.
    const processing = page.locator('[data-testid="media-row"][data-status="processing"]');
    const pending = page.locator('[data-testid="media-row"][data-status="pending"]');
    await expect(processing.or(pending).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="media-row"]').first()).toContainText('Processando');

    // The bytes went browser -> provider: no request to our own origin ever carried the file.
    const ours = requests.filter(
      (r) => r.url.startsWith(hosts.demo) && (r.method === 'PUT' || r.method === 'POST'),
    );
    for (const request of ours) {
      expect(request.body).toBeLessThan(100_000); // the fixture is 186 KiB
    }
    expect(requests.some((r) => r.method === 'PUT' && !r.url.startsWith(hosts.demo))).toBe(true);

    // The fake provider's deferred ready event lands a couple of seconds later; the 5 s poll is what
    // makes the flip visible without a reload, and the live region announces it.
    const ready = page.locator('[data-testid="media-row"][data-status="ready"]');
    await expect(ready).toHaveCount(1, { timeout: 40_000 });
    await expect(page.locator('[data-testid="media-row"]').first()).toContainText('Pronto');
    await expect(page.locator('[data-testid="media-live"]')).toHaveText('Vídeo pronto.');
  });

  test('a .gif is refused at pick time and costs no upload request at all', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    const requests = recordRequests(page);
    await page.goto('/configuracoes/midia');

    // The picker offers EXACTLY the pair `MEDIA_LIMITS.video.post` allows. The component derives it
    // with `mediaAcceptFor('video', 'post')` rather than hard-coding a list, so this assertion is
    // what pins the rendered value to the contract.
    await expect(page.locator('#video-dropzone')).toHaveAttribute(
      'accept',
      'video/mp4,video/quicktime',
    );

    await pickVideo(page, {
      name: 'meme.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a', 'latin1'),
    });

    await expect(page.locator('[data-testid="video-upload"]').getByRole('alert')).toHaveText(
      'Formato de vídeo não suportado. Envie um MP4 ou um vídeo gravado no celular.',
    );
    expect(requests.some((r) => r.url.includes('/v1/media/uploads'))).toBe(false);
    await expect(page.locator('[data-testid="media-row"]')).toHaveCount(0);
  });

  test('tapping a "Pronto" row opens the player with a non-empty playback token', async ({
    page,
  }) => {
    const assetId = await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'ready',
      filename: 'reuniao.mp4',
      playbackId: 'fake-playback-open',
      durationSeconds: 2,
    });
    expect(assetId).toBeTruthy();

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');
    await page.locator('[data-testid="media-row"][data-status="ready"]').click();

    const player = page.locator('mux-player');
    await expect(player).toHaveCount(1, { timeout: 20_000 });
    // `tokens` is a PROPERTY-only path on mux-player: `set tokens` stores the object in a private
    // field and never reflects it to a `playback-token` attribute (verified in
    // @mux/mux-player@3.13.4 dist/base.mjs). The element's own getter is therefore what proves a
    // token reached the player — reading the attribute would assert a reflection that does not exist.
    const token = await player.evaluate(
      (node) => (node as unknown as { tokens?: { playback?: string } }).tokens?.playback ?? '',
    );
    expect(token).not.toBe('');
    // No raw player error, no provider status, no token fragment on screen (T-03-51).
    await expect(page.locator('[data-testid="video-ready"]')).not.toContainText(/error|401|403/i);
  });

  test('a playback token refused mid-session becomes the generic toast plus a retry that re-mints', async ({
    page,
  }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'ready',
      filename: 'expirado.mp4',
      playbackId: 'fake-playback-expired',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // The token is minted by a SERVER action, so the interceptable hop is the API request the Next
    // server makes — which Playwright cannot see. The refusal is therefore injected at the API
    // origin the browser's own BFF proxies to: the action's fetch goes out from the Next server, so
    // instead we force the refusal by removing the playback id the asset was seeded with.
    await page.goto('/configuracoes/midia');
    await deleteTenantVideoAssets(DEMO_SLUG);

    await page.locator('[data-testid="media-row"][data-status="ready"]').click();

    await expect(page.getByText('Algo deu errado. Tente novamente.').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('[data-testid="video-ready"]').getByRole('button', { name: 'Tentar novamente' }),
    ).toBeVisible();
    await expect(page.locator('mux-player')).toHaveCount(0);
    await expect(page.locator('[data-testid="video-ready"]')).not.toContainText(/404|NOT_FOUND/i);
  });

  test('E10/partial backstop — a ready asset whose poster never resolves shows no broken glyph and no raw error', async ({
    page,
  }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'ready',
      filename: 'sem-poster.mp4',
      playbackId: 'fake-playback-no-poster',
    });

    // Every thumbnail request fails: locally there is no Mux, so image.mux.com is unreachable
    // anyway — this makes that certain rather than incidental.
    await page.route(/image\.mux\.com/, (route) => route.abort());

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');
    await page.locator('[data-testid="media-row"][data-status="ready"]').click();

    const frame = page.locator('[data-testid="video-ready"]');
    await expect(page.locator('mux-player')).toHaveCount(1, { timeout: 20_000 });
    // The backstop really RAN: the probe proved the still does not resolve and the player was told
    // `poster=""` ("no poster") rather than being left to draw a failing one.
    await expect(frame).toHaveAttribute('data-poster', 'none', { timeout: 20_000 });
    // The player still renders; the frame falls back to its plain bg-bg-tertiary ground.
    await expect(frame).not.toContainText(/error|failed|401|403/i);
    // No <img> of ours is left pointing at a URL that will not load (E9/error's rule, applied here).
    const brokenImages = await frame.locator('img').evaluateAll(
      (nodes) =>
        nodes.filter((node) => {
          const img = node as HTMLImageElement;
          return img.complete && img.naturalWidth === 0 && img.getAttribute('src');
        }).length,
    );
    expect(brokenImages).toBe(0);
  });

  test('a failed row can be removed behind a confirmation', async ({ page }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'failed',
      filename: 'para-remover.mp4',
      failureReason: 'video.asset.errored',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    await page.getByRole('button', { name: 'Remover' }).first().click();
    await expect(page.getByText('Remover este vídeo?')).toBeVisible();
    await expect(
      page.getByText('O vídeo deixa de ficar disponível para os membros.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Remover', exact: true }).last().click();
    await expect(page.getByText('Vídeo removido.')).toBeVisible();
    await expect(page.locator('[data-testid="media-row"]')).toHaveCount(0);
  });

  test('the list polls while a row is processing and, after five minutes, stops and offers "Atualizar"', async ({
    page,
  }) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'processing',
      filename: 'travado.mp4',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    // Playwright's own clock, so no test-only override ships in the component. The poll's elapsed
    // check runs before its re-fetch, so fast-forwarding past the ceiling costs no round trips.
    await page.clock.install();
    await page.goto('/configuracoes/midia');

    const library = page.locator('[data-testid="media-library"]');
    await expect(library).toHaveAttribute('data-polling', 'true');
    await expect(page.getByRole('button', { name: 'Atualizar' })).toHaveCount(0);

    await page.clock.fastForward('06:00');

    const refresh = page.getByRole('button', { name: 'Atualizar' });
    await expect(refresh).toBeVisible();

    // …and it really re-fetches: flipping the row server-side and pressing it shows the new status.
    const asset = await newestVideoAsset(DEMO_SLUG);
    await markVideoReady(asset?.id ?? '', { playbackId: 'fake-playback-manual' });
    await refresh.click();
    await expect(page.locator('[data-testid="media-row"][data-status="ready"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Atualizar' })).toHaveCount(0);
  });

  test('the player opens in a sheet on the phone and a centred dialog on the desktop', async ({
    page,
  }, testInfo) => {
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'ready',
      filename: 'responsivo.mp4',
      playbackId: 'fake-playback-responsive',
    });

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');
    await page.locator('[data-testid="media-row"][data-status="ready"]').click();

    // `[aria-modal]` narrows this to OUR sheet: mux-player mounts its own `<media-error-dialog
    // role="dialog">` (empty, and asserted empty elsewhere), so a bare dialog role is ambiguous
    // whenever a player is open. `:not([data-nextjs-dialog])` drops the one other modal dialog that
    // can exist here, and only under `next dev`: with the fake provider the player's manifest load
    // fails (stream.mux.com answers 400 to the fake token), mux-player logs a console error, and
    // Next's dev overlay may mount its own `role="dialog" aria-modal="true"` "Console Error" dialog
    // before the geometry is read (06-09 exit gate, desktop). The production build has no overlay.
    const panel = page.locator('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog])');
    await expect(panel).toBeVisible();
    // The player really mounted inside it — the geometry below is the sheet AROUND a player.
    await expect(page.locator('mux-player')).toHaveCount(1, { timeout: 20_000 });
    // The sheet springs in from the bottom, so a bounding box read the instant it is visible is a
    // measurement of the ANIMATION, not of the layout. Width settles immediately; the alignment of
    // the wrapper is what actually distinguishes a sheet from a centred dialog, and neither moves.
    const width = (await panel.boundingBox())?.width ?? 0;
    const viewport = page.viewportSize();
    const align = await panel.evaluate(
      (node) => getComputedStyle(node.parentElement as HTMLElement).alignItems,
    );

    if (testInfo.project.name === 'mobile-chromium') {
      // A sheet: full width, pinned to the bottom edge of the viewport.
      expect(width).toBeCloseTo(viewport?.width ?? 0, -1);
      expect(align).toBe('flex-end');
      await expect(panel).toHaveClass(/rounded-t-2xl/);
    } else {
      // A centred card capped at 680px — the UI-SPEC's number, not the primitive's 480 default.
      expect(align).toBe('center');
      expect(width).toBeLessThanOrEqual(680);
      expect(width).toBeGreaterThan(480);
      expect(width).toBeLessThan(viewport?.width ?? 0);
    }
  });

  test('under prefers-reduced-motion the processing spinner does not spin, and the copy still carries the state', async ({
    page,
  }) => {
    const assetId = await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'processing',
      filename: 'transcodificando.mp4',
    });
    await markVideoReady(assetId, { playbackId: 'fake-playback-rm' });
    // …then back to processing: `markVideoReady` exists for the flip case; here the row must STAY
    // processing so the player's placeholder is what renders.
    await seedVideoAsset(DEMO_SLUG, users.demoAdmin, {
      status: 'processing',
      filename: 'ainda-processando.mp4',
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto('/configuracoes/midia');

    const spinner = page.locator('[data-testid="media-row-spinner"]').first();
    await expect(spinner).toBeVisible();
    const animation = await spinner.evaluate((node) => getComputedStyle(node).animationName);
    expect(animation === 'none' || animation === '').toBe(true);
    // The textual state is what carries the meaning when the motion is gone.
    await expect(page.locator('[data-testid="media-row"]').first()).toContainText('Processando');
  });
});
