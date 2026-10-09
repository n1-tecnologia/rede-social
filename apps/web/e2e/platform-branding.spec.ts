import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import brandingMessages from '../messages/pt-BR/platformBranding.json' with { type: 'json' };
import { closeAdmin, deleteTenantBySlug, deleteUserByEmail } from './admin';
import { closeBrandingAdmin, getTenantBranding, insertVerifiedHost } from './branding-admin';
import { hosts, isRemote } from './fixtures';
import { continueFromData, fillTenantData, finishWizard } from './wizard';
import { ensureWorker } from './worker';

/**
 * Marca tab (02-14, ROLE-03/UI-04, D-25/D-27/D-28/D-31/D-41): the super_admin rebrands a tenant
 * from `/plataforma/tenants/{id}/marca` against the real 02-13 API — colours with the live
 * light/dark `BrandPreview` and the both-modes contrast confirmation — and the tenant's public
 * by-host answer reflects it on the next request. Colours are asserted by RENDERED computed style
 * (the tokens.css alias-scoping fix), never by reading the raw variable.
 *
 * Serial: every test builds on the tenant test 1 creates; a shared context keeps the session. The
 * spec brings its own `ROLE=worker` (`ensureWorker`) because icon derivation runs off the request
 * path and the Playwright config starts API + web only.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.skip(isRemote, 'local stack only');

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD: string = (() => {
  const value = process.env.SUPER_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD is required for the platform e2e (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();
const API_URL = process.env.API_URL ?? 'http://localhost:8787';
/** Seed lab primary (scripts/seed.ts) — must never appear on the throwaway tenant's page. */
const LAB_PRIMARY = '#0f766e';

/** Per-run suffix, stable across worker restarts (02-12 pattern), distinct per project. */
const rand = process.ppid.toString(36);
let slug = '';
let name = '';
let adminEmail = '';
let host = '';
let tenantId = '';
let logoBefore: string | null = null;

let context: BrowserContext;
let page: Page;
let stopWorker: () => Promise<void> = async () => {};

const SEED_LOGO = fileURLToPath(new URL('../public/seed-logos/rede-lab.svg', import.meta.url));
const SQUARE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#dc2626"/></svg>',
);
/** The catalog is the source of copy — never a literal in a spec. */
const BRANDING = brandingMessages.platformBranding;
/**
 * "Arte única" (2026-10-09): a landscape art (cropped in its centre) of about 3 MB, over the 2 MiB
 * branding limit an upload zone holds a file to; the editor takes sources up to 15 MiB and uploads
 * the composed 1024 px square.
 */
const LARGE_ART = {
  name: 'arte.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><!--${'arte '.repeat(600_000)}--><rect width="1600" height="900" fill="#0e7490"/><circle cx="800" cy="450" r="320" fill="#f59e0b"/></svg>`,
  ),
};

/** The width and height a PNG's IHDR chunk declares (bytes 16..23). */
function pngSize(bytes: Buffer): { png: boolean; width: number; height: number } {
  return {
    png: bytes.subarray(1, 4).toString('latin1') === 'PNG',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

/** Submits `/entrar` on `origin` without asserting the landing (owned by 02-07). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

type HostAnswer = {
  slug: string;
  branding: {
    logoUrl: string | null;
    faviconUrl: string | null;
    iconUrls: Record<string, string> | null;
    colors: { primary: string; secondary: string };
  };
};

/** `GET /v1/public/tenants/by-host` for the throwaway tenant's verified host (no auth). */
async function byHost(): Promise<HostAnswer> {
  const res = await fetch(`${API_URL}/v1/public/tenants/by-host?host=${host}`);
  if (!res.ok) throw new Error(`by-host ${host}: ${res.status}`);
  return (await res.json()) as HostAnswer;
}

/**
 * After a full navigation the file input exists before React hydrated it; a pick dispatched in that
 * window is lost (no handler yet). React tags hydrated DOM nodes with its internal props key, so
 * waiting for it is the cheapest honest "interactive" probe before `setInputFiles`.
 */
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps'));
    },
    selector,
    { timeout: 30_000 },
  );
}

/**
 * Reopens the Marca tab once the icons are ready, so the next interaction meets a form that will not
 * remount under it. When the status poll sees the icons ready it renders "ready" and THEN calls
 * `router.refresh()`, and the page keys `BrandingForm` on the view (`formKey`), so the refreshed
 * server view REMOUNTS the form. Whatever was begun in that window goes with the old tree: in the
 * 06-09 exit gate (desktop) the icon's removal dialog detached mid-click and the test timed out. A
 * fresh navigation renders the settled server view (icons ready: no poll, no refresh); the app
 * icon's editor opens closed, so its "Personalizar ícone" / "Editar ícone" is what must hydrate.
 */
async function reopenSettled(page: Page): Promise<void> {
  await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
  await expect(page.locator('[data-icons-status="ready"]')).toBeVisible();
  await waitForHydration(page, '[data-upload-zone="icon"] [data-app-icon-open]');
}

/** The RENDERED background of the mini login CTA inside one preview frame. */
function brandButtonBg(page: Page, theme: 'light' | 'dark'): Promise<string> {
  return page
    .locator(`[data-brand-scope][data-theme="${theme}"] button`)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.beforeAll(async ({ browser }, testInfo) => {
  const s = `${rand}${testInfo.project.name.startsWith('mobile') ? 'm' : 'd'}`;
  slug = `e2e-marca-${s}`;
  name = `E2E Marca ${s}`;
  adminEmail = `admin+${s}@e2e.local`;
  host = `e2e-marca-${s}.cliente.test`;
  stopWorker = await ensureWorker();
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await stopWorker();
  await deleteUserByEmail(adminEmail);
  await deleteTenantBySlug(slug);
  await closeAdmin();
  await closeBrandingAdmin();
  await context?.close();
});

test.describe('02-14 — Marca tab: preview, colours, contrast confirmation, host reflection', () => {
  test('1. preview follows the form; low contrast warns; confirmation saves; the tenant host reflects the new primary', async () => {
    // The new-tenant wizard: Dados (02-12) names the tenant, then its Personalização step carries
    // the colours and the kernel BrandPreview (E12/empty: the typed name) below xl; from xl up the
    // wizard's phone previews the draft beside the form and the frames are hidden.
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await fillTenantData(page, { name, slug, email: adminEmail });
    await continueFromData(page);
    const light = page.locator('[data-brand-scope][data-theme="light"]');
    const dark = page.locator('[data-brand-scope][data-theme="dark"]');
    if (test.info().project.name === 'desktop-chromium') {
      await expect(light).toBeHidden();
      await expect(dark).toBeHidden();
      await expect(page.locator('[data-device-screen]')).toContainText(name);
    } else {
      await expect(light).toBeVisible();
      await expect(dark).toBeVisible();
      await expect(light).toContainText(name);
    }

    await page.locator('#primary').fill('#7c3aed');
    await page.locator('#secondary').fill('#a78bfa');
    // The alias fix, proven by the RENDERED colour of the brand Button inside each frame.
    await expect.poll(() => brandButtonBg(page, 'light')).toBe('rgb(124, 58, 237)');
    expect(await brandButtonBg(page, 'dark')).not.toBe(await brandButtonBg(page, 'light'));

    // The wizard creates the tenant at the summary's confirmation; the Marca TAB asserted below is
    // the tenant page's.
    tenantId = await finishWizard(page);
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);

    await insertVerifiedHost(slug, host);
    expect((await byHost()).branding.colors.primary).toBe('#7c3aed'); // host cache warmed

    // The Marca tab (mockup `tenant-page-marca`): Cores card, two frames, save disabled (not dirty).
    await expect(page.getByText('Cores', { exact: true })).toBeVisible();
    await expect(page.locator('[data-brand-scope]')).toHaveCount(2);
    const save = page.getByRole('button', { name: 'Salvar alterações' });
    await expect(save).toBeDisabled();
    expect(await page.content()).not.toContain(LAB_PRIMARY);

    // A low-contrast pair: warning + checkbox gate (D-41), preview follows the typed primary.
    await page.locator('#primary').fill('#ffff00');
    await page.locator('#secondary').fill('#ffffaa');
    await expect(page.getByText(/^Baixo /).first()).toBeVisible();
    await expect(page.getByText(/Contraste baixo no modo claro/)).toBeVisible();
    await expect.poll(() => brandButtonBg(page, 'light')).toBe('rgb(255, 255, 0)');
    await expect(save).toBeDisabled();
    await page.locator('#confirmLowContrast').check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    expect((await getTenantBranding(slug)).colors.primary).toBe('#ffff00');
    // Same API instance, no wait: the save invalidated the host cache (TENANT-02 from the UI).
    expect((await byHost()).branding.colors.primary).toBe('#ffff00');

    // A good pair saves without any confirmation.
    await page.locator('#primary').fill('#1d4ed8');
    await page.locator('#secondary').fill('#60a5fa');
    await expect(page.getByText(/^Baixo /)).toHaveCount(0);
    await expect(page.locator('#confirmLowContrast')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    await expect.poll(async () => (await byHost()).branding.colors.primary).toBe('#1d4ed8');
    await expect.poll(() => brandButtonBg(page, 'light')).toBe('rgb(29, 78, 216)');
    expect(await page.content()).not.toContain(LAB_PRIMARY);
  });

  test('2. logo upload → icons generated → tenant host carries the icon URLs; the app icon composed (logo and ground, then a single art) → remove', async () => {
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
    // E14/empty: no logo yet, no app-icons card.
    await expect(
      page.getByText('Nenhum logo enviado. O nome de exibição aparece no lugar.'),
    ).toBeVisible();
    await expect(page.locator('[data-icons-status]')).toHaveCount(0);
    await waitForHydration(page, '[data-upload-zone="logo"] input[type="file"]');

    // Browser → signed Storage URL → complete (D-27); the zone shows the new logo through <img>.
    await page.locator('[data-upload-zone="logo"] input[type="file"]').setInputFiles(SEED_LOGO);
    await expect(page.getByText('Alterações salvas.').first()).toBeVisible({ timeout: 30_000 });
    const logo = page.locator(`img[alt="Logo de ${name}"]`);
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute(
      'src',
      new RegExp(`/storage/v1/object/public/branding/${tenantId}/branding/`),
    );

    // D-28: honest status until the worker wrote the set for the current iconVersion.
    await expect(page.locator('[data-icons-status="generating"]')).toBeVisible();
    await expect(page.locator('[data-icons-status="generating"]')).toHaveText(
      /Ícones sendo gerados…/,
    );
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('[data-icons-status="ready"]')).toHaveText(/Ícones gerados/);
    await expect(page.locator('[data-icon-thumb]')).toHaveCount(4);

    const b = await getTenantBranding(slug);
    expect(b.logoUrl).toContain(tenantId);
    expect(b.iconUrls?.i512).toContain(`/icons/${b.iconVersion}/`);
    await expect(page.getByText(`Versão ${b.iconVersion}`)).toBeVisible();
    await expect(page.getByText('Gerados a partir do logo')).toBeVisible();

    // The job's write invalidated the host: by-host carries the same URLs; the PNG really exists.
    const h = await byHost();
    expect(h.branding.iconUrls?.i512).toBe(b.iconUrls?.i512);
    expect(h.branding.faviconUrl).toBe(b.faviconUrl);
    const png = await fetch(b.iconUrls?.i512 ?? '');
    expect(png.status).toBe(200);
    expect((png.headers.get('content-type') ?? '').startsWith('image/png')).toBe(true);
    expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // E12/populated: the mini-shells now carry the uploaded logo.
    await expect(
      page.locator(`[data-brand-scope][data-theme="light"] img[src="${b.logoUrl}"]`).first(),
    ).toBeAttached();

    // "Ícone do app" (2026-10-09), on a settled form: closed, the home screen shows the logo the
    // icons come from.
    await reopenSettled(page);
    const editor = page.locator('[data-upload-zone="icon"]');
    const iosTile = editor.locator('[data-home-tile="ios"] img');
    const apply = editor.getByRole('button', { name: BRANDING.appIcon.apply });
    await expect(editor).toHaveAttribute('data-app-icon-editor', 'closed');
    await expect(iosTile).toHaveAttribute('src', b.logoUrl ?? '');

    // A logo the browser cannot read (the bucket answering without CORS): the editor says so, asks
    // for the file and applies nothing until one is picked; "Cancelar" leaves nothing behind.
    const bucket = '**/storage/v1/object/public/branding/**';
    await page.route(bucket, (route) =>
      route.request().resourceType() === 'fetch' ? route.abort('failed') : route.continue(),
    );
    try {
      await editor.getByRole('button', { name: BRANDING.appIcon.customize }).click();
      await expect(editor.locator('[data-app-icon-logo-state="unreachable"]')).toHaveText(
        BRANDING.appIcon.logo.unreachable,
        { timeout: 30_000 },
      );
      await expect(apply).toBeDisabled();
      await editor
        .locator('[data-app-icon-zone="logo"] input[type="file"]')
        .setInputFiles({ name: 'quadrado.svg', mimeType: 'image/svg+xml', buffer: SQUARE_SVG });
      await expect(apply).toBeEnabled({ timeout: 30_000 });
      await editor.getByRole('button', { name: BRANDING.appIcon.cancel }).click();
      await expect(editor).toHaveAttribute('data-app-icon-editor', 'closed');
    } finally {
      await page.unroute(bucket);
    }
    expect((await getTenantBranding(slug)).iconUrl).toBeNull();

    // "Logo e fundo": the light logo read from the bucket, at 50% over the primary, composed into a
    // 1024 px PNG and sent as the square override (kind 'icon'); the icons re-derive from it.
    await editor.getByRole('button', { name: BRANDING.appIcon.customize }).click();
    await expect(editor.locator('[data-app-icon-logo-state="ready"]')).toBeAttached({
      timeout: 30_000,
    });
    await editor.locator('input[type="range"]').fill('50');
    await expect(editor.locator('output')).toHaveText(
      BRANDING.appIcon.logo.sizeValue.replace('{percent}', '50'),
    );
    await apply.click();
    await expect(editor).toHaveAttribute('data-app-icon-editor', 'closed', { timeout: 30_000 });
    await expect.poll(async () => (await getTenantBranding(slug)).iconUrl).not.toBeNull();
    const withIcon = await getTenantBranding(slug);
    expect(withIcon.iconVersion).toBeGreaterThan(b.iconVersion);
    await expect(iosTile).toHaveAttribute('src', withIcon.iconUrl ?? '');
    await expect(editor.getByRole('button', { name: BRANDING.appIcon.edit })).toBeVisible();
    const composed = pngSize(
      Buffer.from(await (await fetch(withIcon.iconUrl ?? '')).arrayBuffer()),
    );
    expect(composed).toEqual({ png: true, width: 1024, height: 1024 });
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(BRANDING.icons.fromOverride)).toBeVisible();

    // "Arte única": a ~3 MB landscape art (over the 2 MiB an upload zone takes) is cropped in its
    // centre and uploaded as the composed square.
    await reopenSettled(page);
    await editor.getByRole('button', { name: BRANDING.appIcon.edit }).click();
    await editor.getByRole('button', { name: BRANDING.appIcon.mode.art }).click();
    await editor.locator('[data-app-icon-zone="art"] input[type="file"]').setInputFiles(LARGE_ART);
    await expect(apply).toBeEnabled({ timeout: 30_000 });
    await apply.click();
    await expect(editor).toHaveAttribute('data-app-icon-editor', 'closed', { timeout: 30_000 });
    await expect
      .poll(async () => (await getTenantBranding(slug)).iconVersion)
      .toBeGreaterThan(withIcon.iconVersion);
    const withArt = await getTenantBranding(slug);
    expect(withArt.iconUrl).not.toBe(withIcon.iconUrl);
    const art = pngSize(Buffer.from(await (await fetch(withArt.iconUrl ?? '')).arrayBuffer()));
    expect(art).toEqual({ png: true, width: 1024, height: 1024 });
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });

    // Remover → ConfirmDialog → DELETE …/branding/icon → icons re-derive from the logo. On a settled
    // form (see `reopenSettled`), where the icon of its own is still shown after the navigation.
    await reopenSettled(page);
    await expect(iosTile).toHaveAttribute('src', withArt.iconUrl ?? '');
    await page.getByRole('button', { name: BRANDING.icon.remove }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(BRANDING.icon.confirmTitle)).toBeVisible();
    await dialog.getByRole('button', { name: BRANDING.icon.confirm }).click();
    await expect(editor.getByRole('button', { name: BRANDING.appIcon.customize })).toBeVisible({
      timeout: 30_000,
    });
    await expect(iosTile).toHaveAttribute('src', b.logoUrl ?? '');
    await expect.poll(async () => (await getTenantBranding(slug)).iconUrl).toBeNull();
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(BRANDING.icons.fromLogo)).toBeVisible();
    logoBefore = (await getTenantBranding(slug)).logoUrl;
  });

  test('3. upload errors: type and size never reach the API; transfer and not-an-image refusals keep the logo and the zone usable', async () => {
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
    const zone = page.locator('[data-upload-zone="logo"]');
    const input = zone.locator('input[type="file"]');
    const alert = zone.getByRole('alert');
    await waitForHydration(page, '[data-upload-zone="logo"] input[type="file"]');
    const urls: string[] = [];
    page.on('request', (req) => urls.push(req.url()));

    // (a) wrong type — client gate, no request.
    await input.setInputFiles({
      name: 'anim.gif',
      mimeType: 'image/gif',
      buffer: Buffer.alloc(64),
    });
    await expect(alert).toHaveText('Formato não suportado. Use PNG, SVG, WebP ou JPEG.');
    expect(urls.some((u) => u.includes('/branding/uploads'))).toBe(false);

    // (b) too large — client gate, no request.
    await input.setInputFiles({
      name: 'grande.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(alert).toHaveText('Arquivo muito grande. O limite é 2 MB.');
    expect(urls.some((u) => u.includes('/branding/uploads'))).toBe(false);

    // (c) the PUT to Storage fails — transfer error, zone back to idle.
    await page.route('**/storage/v1/object/upload/sign/**', (route) => route.abort('failed'));
    try {
      await input.setInputFiles({ name: 'ok.svg', mimeType: 'image/svg+xml', buffer: SQUARE_SVG });
      await expect(alert).toHaveText('Falha no envio. Tente novamente.', { timeout: 30_000 });
    } finally {
      await page.unroute('**/storage/v1/object/upload/sign/**');
    }

    // (d) a text payload named .png: the PUT succeeds, complete refuses it (object removed).
    await input.setInputFiles({
      name: 'falso.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<html>hi</html>'),
    });
    await expect(alert).toHaveText('O arquivo não é uma imagem válida. Escolha outro arquivo.', {
      timeout: 30_000,
    });

    // Nothing persisted, zone idle and usable again.
    expect((await getTenantBranding(slug)).logoUrl).toBe(logoBefore);
    await expect(input).toBeEnabled();
    await expect(zone.getByRole('progressbar')).toHaveCount(0);

    // (e) the zone still works afterwards.
    await input.setInputFiles({ name: 'novo.svg', mimeType: 'image/svg+xml', buffer: SQUARE_SVG });
    await expect(page.getByText('Alterações salvas.').first()).toBeVisible({ timeout: 30_000 });
    await expect(alert).toHaveCount(0);
    await expect.poll(async () => (await getTenantBranding(slug)).logoUrl).not.toBe(logoBefore);
  });

  test('4. mobile: the two zones and the two mini-shells stack; no horizontal overflow', async () => {
    test.skip(test.info().project.name !== 'mobile-chromium', 'phone layout only');
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
    const logoZone = page.locator('[data-upload-zone="logo"]');
    const iconZone = page.locator('[data-upload-zone="icon"]');
    await expect(iconZone).toBeVisible();
    const [logoBox, iconBox] = await Promise.all([logoZone.boundingBox(), iconZone.boundingBox()]);
    if (!logoBox || !iconBox) throw new Error('zones have no box');
    expect(Math.abs(logoBox.x - iconBox.x)).toBeLessThanOrEqual(1);
    expect(iconBox.y).toBeGreaterThan(logoBox.y + logoBox.height - 1);

    const frames = page.locator('[data-brand-scope]');
    await expect(frames).toHaveCount(2);
    const [lightBox, darkBox] = await Promise.all([
      frames.nth(0).boundingBox(),
      frames.nth(1).boundingBox(),
    ]);
    if (!lightBox || !darkBox) throw new Error('frames have no box');
    expect(Math.abs(lightBox.x - darkBox.x)).toBeLessThanOrEqual(1);
    expect(darkBox.y).toBeGreaterThan(lightBox.y + lightBox.height - 1);

    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
  });

  test('5. mobile: the new-tenant preview stacks two 200 px frames', async () => {
    test.skip(test.info().project.name !== 'mobile-chromium', 'phone layout only');
    // The colours (and their preview) are the wizard's Personalização step, after Dados.
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await fillTenantData(page, {
      name: 'E2E Prévia',
      slug: 'e2e-previa-celular',
      email: 'previa@e2e.local',
    });
    await continueFromData(page);
    const frames = page.locator('[data-brand-scope]');
    await expect(frames).toHaveCount(2);
    const [lightBox, darkBox] = await Promise.all([
      frames.nth(0).boundingBox(),
      frames.nth(1).boundingBox(),
    ]);
    if (!lightBox || !darkBox) throw new Error('frames have no box');
    expect(Math.abs(lightBox.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(darkBox.width - 200)).toBeLessThanOrEqual(1);
    expect(darkBox.y).toBeGreaterThan(lightBox.y + lightBox.height - 1);
  });
});
