import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { closeAdmin, deleteTenantBySlug, deleteUserByEmail } from './admin';
import { closeBrandingAdmin, getTenantBranding, insertVerifiedHost } from './branding-admin';
import { hosts, isRemote } from './fixtures';

/**
 * Marca tab (02-14, ROLE-03/UI-04, D-25/D-27/D-28/D-31/D-41): the super_admin rebrands a tenant
 * from `/plataforma/tenants/{id}/marca` against the real 02-13 API — colours with the live
 * light/dark `BrandPreview` and the both-modes contrast confirmation — and the tenant's public
 * by-host answer reflects it on the next request. Colours are asserted by RENDERED computed style
 * (the tokens.css alias-scoping fix), never by reading the raw variable.
 *
 * Serial: every test builds on the tenant test 1 creates; a shared context keeps the session.
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
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

test.afterAll(async () => {
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
});
