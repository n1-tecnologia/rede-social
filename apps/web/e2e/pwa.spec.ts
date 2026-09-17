import { expect, type Page, test } from '@playwright/test';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * PWA-01 against a PRODUCTION build (playwright.pwa.config.ts → `pnpm --filter @tria/web e2e:pwa`).
 * baseURL = the tria-demo tenant host on :3100. Runs on iphone-chromium (iPhone 14), pixel-chromium
 * (Pixel 7) and desktop-chromium.
 *
 * Tags: `@tracer` (manifest, head links, SW served + controlling, standalone emulation, public
 * plumbing), `@offline` (Task 2), `@install` (Task 3).
 */
test.skip(
  process.env.PWA_PROD !== '1',
  'run with pnpm --filter @tria/web e2e:pwa (production build)',
);

const DEMO_MANIFEST = '/m/tria-demo/manifest.webmanifest';
const ICON_SRC = /^(\/icons\/tria-|.*\/storage\/v1\/object\/public\/branding\/)/;

async function waitForController(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test.describe('PWA-01 — installable tenant shell (tracer)', () => {
  test('the demo host serves its own no-store manifest (D-25, D-28)', { tag: ['@tracer'] }, async ({
    request,
  }) => {
    const res = await request.get(DEMO_MANIFEST);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/manifest+json');
    expect(res.headers()['cache-control']).toContain('no-store');

    const body = await res.json();
    expect(body.name).toBe('TRIA Demo');
    expect(body.short_name.length).toBeLessThanOrEqual(12);
    expect(body.theme_color).toBe('#7c3aed');
    expect(body.background_color).toBe('#f5f7fb');
    expect(body.id).toBe('/?tenant=tria-demo');
    expect(body.start_url).toBe('/');
    expect(body.scope).toBe('/');
    expect(body.display).toBe('standalone');
    expect(body.lang).toBe('pt-BR');
    expect(body.icons).toHaveLength(3);
    expect(body.icons.map((i: { sizes: string }) => i.sizes)).toEqual([
      '192x192',
      '512x512',
      '512x512',
    ]);
    expect(body.icons.filter((i: { purpose?: string }) => i.purpose === 'maskable')).toHaveLength(
      1,
    );
    for (const icon of body.icons as { src: string }[]) expect(icon.src).toMatch(ICON_SRC);
  });

  test('/entrar (before login) links the tenant manifest, icons, theme-color and app title', {
    tag: ['@tracer'],
  }, async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', DEMO_MANIFEST);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#7c3aed');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', ICON_SRC);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'TRIA Demo',
    );
  });

  test('the service-worker script is served no-store with Service-Worker-Allowed: /', {
    tag: ['@tracer'],
  }, async ({ request }) => {
    const res = await request.get('/serwist/sw.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('javascript');
    expect(res.headers()['cache-control']).toContain('no-store');
    expect(res.headers()['service-worker-allowed']).toBe('/');
  });

  test('the service worker registers with updateViaCache none and controls the page after a reload', {
    tag: ['@tracer'],
  }, async ({ page }) => {
    await page.goto('/entrar');
    await waitForController(page);
    const state = await page.evaluate(async () => ({
      scriptURL: navigator.serviceWorker.controller?.scriptURL ?? null,
      updateViaCache: (await navigator.serviceWorker.getRegistration())?.updateViaCache ?? null,
      scope: (await navigator.serviceWorker.getRegistration())?.scope ?? null,
    }));
    expect(state.scriptURL?.endsWith('/serwist/sw.js')).toBe(true);
    expect(state.updateViaCache).toBe('none');
    expect(state.scope).toBe(`${new URL(page.url()).origin}/`);
  });

  test('a normal tab mirrors display-mode: browser onto <html data-display-mode>', {
    tag: ['@tracer'],
  }, async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.locator('html')).toHaveAttribute('data-display-mode', 'browser');
    expect(await page.evaluate(() => matchMedia('(display-mode: browser)').matches)).toBe(true);
  });

  test(
    'data-display-mode follows display-mode: standalone (CDP emulation on the mobile projects)',
    { tag: ['@tracer'] },
    async ({ page }, testInfo) => {
      test.skip(
        !/iphone|pixel/.test(testInfo.project.name),
        'standalone emulation is attempted on the phone projects',
      );
      await page.goto('/entrar');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'display-mode', value: 'standalone' }],
      });
      await page.reload();
      const standalone = await page.evaluate(
        () => matchMedia('(display-mode: standalone)').matches,
      );
      // Chromium ignores the `display-mode` media feature in Emulation.setEmulatedMedia (verified on
      // the bundled Chromium 153): the test must not pass vacuously — it skips with an annotation and
      // the real-device install/launch check (02-VALIDATION.md, manual) stays the standalone proof.
      if (!standalone) {
        testInfo.annotations.push({
          type: 'skip',
          description: 'CDP display-mode emulation unsupported — real-device check required',
        });
        testInfo.skip();
      }
      await expect(page.locator('html')).toHaveAttribute('data-display-mode', 'standalone');
    },
  );

  test('public plumbing (T-02-77): manifest and SW are reachable without a session, /inicio is not', {
    tag: ['@tracer'],
  }, async ({ request }) => {
    const inicio = await request.get('/inicio', { maxRedirects: 0 });
    expect(inicio.status()).toBe(307);
    expect(inicio.headers().location).toMatch(/\/entrar$/);
    expect((await request.get('/serwist/sw.js')).status()).toBe(200);
    expect((await request.get(DEMO_MANIFEST)).status()).toBe(200);
    expect(hosts.demo).toContain('tria-demo');
  });
});

const OFFLINE_TITLE = 'Você está offline';
const OFFLINE_BANNER = 'Você está offline. Alguns conteúdos podem não estar disponíveis.';

/** Every request URL held in Cache Storage (precache + runtime caches). */
async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) urls.push(req.url);
    }
    return urls;
  });
}

test.describe('PWA-01 — offline fallback and caching contract', () => {
  test('/~offline is precached per build', { tag: ['@offline'] }, async ({ page }) => {
    await page.goto('/entrar');
    await waitForController(page);
    const precached = await page.evaluate(async () => {
      const hit = await caches.match('/~offline', { ignoreSearch: true });
      return Boolean(hit);
    });
    expect(precached).toBe(true);
  });

  test('an offline navigation renders the neutral offline page; retry lands on /entrar once online', {
    tag: ['@offline'],
  }, async ({ page, context }) => {
    await page.goto('/entrar');
    await waitForController(page);

    await context.setOffline(true);
    await page.goto('/inicio', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: OFFLINE_TITLE })).toBeVisible();
    await expect(page.getByText('Verifique sua conexão e tente novamente.')).toBeVisible();
    const retry = page.getByRole('button', { name: 'Tentar novamente' });
    await expect(retry).toBeVisible();
    expect(await page.locator('[data-brand-root]').count()).toBe(0);
    expect(await page.content()).not.toContain('data-brand-root');

    await context.setOffline(false);
    await retry.click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('the service worker never stores authenticated documents, RSC payloads or API/auth answers (T-02-70)', {
    tag: ['@offline'],
  }, async ({ page }) => {
    await page.goto('/entrar');
    await waitForController(page);
    await login(page, users.demoMember, SEED_PASSWORD);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.goto('/inicio', { waitUntil: 'networkidle' });
    await page.goto('/configuracoes', { waitUntil: 'networkidle' });
    await page.goto('/inicio', { waitUntil: 'networkidle' });

    const urls = await cachedUrls(page);
    expect(urls.length).toBeGreaterThan(0);
    const paths = urls.map((u) => new URL(u));
    for (const url of paths) {
      const full = url.pathname + url.search;
      expect(['/inicio', '/configuracoes', '/perfil', '/entrar'], full).not.toContain(url.pathname);
      expect(full, full).not.toContain('_rsc=');
      expect(url.pathname, full).not.toMatch(/^\/(v1|auth|m)\//);
      expect(url.pathname, full).not.toContain('/v1/');
      // The only document-like entry (no file extension) is the offline fallback.
      if (!/\.[a-z0-9]+$/i.test(url.pathname)) expect(url.pathname, full).toBe('/~offline');
    }
  });

  test('the offline banner follows connectivity on an open page', { tag: ['@offline'] }, async ({
    page,
    context,
  }) => {
    await page.goto('/entrar');
    await expect(page.getByRole('status').filter({ hasText: OFFLINE_BANNER })).toHaveCount(0);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('status').filter({ hasText: OFFLINE_BANNER })).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('status').filter({ hasText: OFFLINE_BANNER })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});

const INSTALL_TITLE = 'Adicione à Tela de Início';
const NEUTRAL_ICON = /^\/icons\/tria-/;
const BUCKET_ICON = /\/storage\/v1\/object\/public\/branding\//;

test.describe('PWA-01 — second tenant, cross-host isolation, neutral fallback, unmounted hint', () => {
  test('the lab host serves its own manifest and head links', { tag: ['@install'] }, async ({
    request,
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const res = await request.get(`${hosts.lab}/m/tria-lab/manifest.webmanifest`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('TRIA Lab');
    expect(body.theme_color).toBe('#0f766e');
    expect(body.id).toBe('/?tenant=tria-lab');

    await page.goto(`${hosts.lab}/entrar`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/m/tria-lab/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f766e');
  });

  test('cross-host manifests are refused (T-02-71); _tria answers only on non-tenant hosts', {
    tag: ['@install'],
  }, async ({ request }) => {
    test.skip(isRemote, 'local stack only');
    const refused = [
      `${hosts.demo}/m/tria-lab/manifest.webmanifest`,
      `${hosts.generic}/m/tria-demo/manifest.webmanifest`,
      `${hosts.platform}/m/tria-demo/manifest.webmanifest`,
      `${hosts.demo}/m/_tria/manifest.webmanifest`,
      `${hosts.demo}/m/not%20a%20slug/manifest.webmanifest`,
    ];
    for (const url of refused) {
      // The route answers 404; a slug the proxy's PUBLIC class rejects never reaches the route and
      // is bounced to /entrar instead (307) — both are refusals, neither is a manifest.
      const res = await request.get(url, { maxRedirects: 0 });
      expect([404, 307], url).toContain(res.status());
      if (res.status() === 307) expect(res.headers().location, url).toMatch(/\/entrar$/);
      else expect(res.headers()['cache-control'], url).toContain('no-store');
      expect(res.headers()['content-type'] ?? '', url).not.toContain('manifest+json');
    }

    const neutral = await request.get(`${hosts.generic}/m/_tria/manifest.webmanifest`);
    expect(neutral.status()).toBe(200);
    const body = await neutral.json();
    expect(body.name).toBe('TRIA');
    expect(body.id).toBe('/?tenant=_tria');
    for (const icon of body.icons as { src: string }[]) expect(icon.src).toMatch(NEUTRAL_ICON);

    const platform = await request.get(`${hosts.platform}/m/_tria/manifest.webmanifest`);
    expect(platform.status()).toBe(200);
    expect((await platform.json()).name).toBe('TRIA');
  });

  test('the neutral icon set is served cookie-less as image/png', { tag: ['@install'] }, async ({
    request,
  }) => {
    for (const path of ['/icons/tria-192.png', '/icons/tria-maskable-512.png']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toContain('image/png');
    }
  });

  test('the demo manifest icons are all neutral or all from the branding bucket — never mixed (T-02-72)', {
    tag: ['@install'],
  }, async ({ request }) => {
    const body = await (await request.get(DEMO_MANIFEST)).json();
    const srcs = (body.icons as { src: string }[]).map((i) => i.src);
    const neutral = srcs.filter((s) => NEUTRAL_ICON.test(s)).length;
    const bucket = srcs.filter((s) => BUCKET_ICON.test(s)).length;
    expect(neutral + bucket).toBe(3);
    expect(neutral === 3 || bucket === 3, srcs.join(', ')).toBe(true);
  });

  test('the install hint is built but unmounted: no dialog and no hint copy on any page', {
    tag: ['@install'],
  }, async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(INSTALL_TITLE);

    await login(page, users.demoMember, SEED_PASSWORD);
    for (const path of ['/inicio', '/configuracoes']) {
      await page.goto(path);
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      expect(await page.locator('body').innerText(), path).not.toContain(INSTALL_TITLE);
    }
  });
});
