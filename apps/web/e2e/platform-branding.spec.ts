import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { closeAdmin, deleteTenantBySlug, deleteUserByEmail } from './admin';
import { closeBrandingAdmin, getTenantBranding, insertVerifiedHost } from './branding-admin';
import { hosts, isRemote } from './fixtures';
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

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
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

const UUID_PATH =
  /\/plataforma\/tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Per-run suffix, stable across worker restarts (02-12 pattern), distinct per project. */
const rand = process.ppid.toString(36);
let slug = '';
let name = '';
let adminEmail = '';
let host = '';
let tenantId = '';

let context: BrowserContext;
let page: Page;
let stopWorker: () => Promise<void> = async () => {};

const SEED_LOGO = fileURLToPath(new URL('../public/seed-logos/tria-lab.svg', import.meta.url));
const SQUARE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#dc2626"/></svg>',
);

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
    // New tenant form (02-12) now carries the kernel BrandPreview (E12/empty: the typed name).
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await page.locator('#displayName').fill(name);
    await page.locator('#slug').fill(slug);
    const light = page.locator('[data-brand-scope][data-theme="light"]');
    const dark = page.locator('[data-brand-scope][data-theme="dark"]');
    await expect(light).toBeVisible();
    await expect(dark).toBeVisible();
    await expect(light).toContainText(name);

    await page.locator('#primary').fill('#7c3aed');
    await page.locator('#secondary').fill('#a78bfa');
    await page.locator('#adminEmail').fill(adminEmail);
    // The alias fix, proven by the RENDERED colour of the brand Button inside each frame.
    await expect.poll(() => brandButtonBg(page, 'light')).toBe('rgb(124, 58, 237)');
    expect(await brandButtonBg(page, 'dark')).not.toBe(await brandButtonBg(page, 'light'));

    await page.getByRole('button', { name: 'Criar tenant' }).click();
    await expect(page).toHaveURL(new RegExp(`${UUID_PATH.source}/marca`), { timeout: 30_000 });
    const match = page.url().match(UUID_PATH);
    if (!match) throw new Error(`no tenant id in ${page.url()}`);
    tenantId = match[0].slice('/plataforma/tenants/'.length);

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

  test('2. logo upload → icons generated → tenant host carries the icon URLs; square icon override → remove', async () => {
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
    // E14/empty: no logo yet, no app-icons card.
    await expect(
      page.getByText('Nenhum logo enviado — o nome da comunidade aparece no lugar.'),
    ).toBeVisible();
    await expect(page.locator('[data-icons-status]')).toHaveCount(0);

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

    // Square-icon override (D-28): same signed-PUT path with kind 'icon'.
    await page
      .locator('[data-upload-zone="icon"] input[type="file"]')
      .setInputFiles({ name: 'quadrado.svg', mimeType: 'image/svg+xml', buffer: SQUARE_SVG });
    const override = page.locator(`img[alt="Ícone quadrado de ${name}"]`);
    await expect(override).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Gerados a partir do ícone quadrado')).toBeVisible();
    const withOverride = await getTenantBranding(slug);
    expect(withOverride.iconUrl).not.toBeNull();
    expect(withOverride.iconVersion).toBeGreaterThan(b.iconVersion);

    // Remover → ConfirmDialog → DELETE …/branding/icon → icons re-derive from the logo.
    await page.getByRole('button', { name: 'Remover' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remover ícone quadrado?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remover' }).click();
    await expect(override).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.getByText(
        'Opcional. Use quando o logo for horizontal ou ficar ilegível em um quadrado.',
      ),
    ).toBeVisible();
    await expect.poll(async () => (await getTenantBranding(slug)).iconUrl).toBeNull();
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Gerados a partir do logo')).toBeVisible();
  });
});
