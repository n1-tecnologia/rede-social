import { expect, type Page, test } from '@playwright/test';
import { closeAdmin, deleteTenantBySlug, getTenantModuleFlag } from './admin';
import { hosts } from './fixtures';

/**
 * Platform panel screens I (02-12, ROLE-03/ROLE-05, D-31/D-32/D-33): the super_admin provisions
 * a tenant from `/plataforma` on the platform host against the real 02-05 API — list, the D-31
 * form, the tenant page with its five tabs, the Status flip — and every state the UI-SPEC
 * enumerates. Both Playwright projects run it: the mobile one exercises the card rows and the top
 * bar, so locators stay role-based.
 */

test.describe.configure({ timeout: 120_000 });

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

const UUID_PATH =
  /\/plataforma\/tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const rand = Math.random().toString(36).slice(2, 8);
const createdSlugs = new Set<string>();

/** Submits `/entrar` on `origin` without asserting the landing (owned by 02-07). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

/** Text that exists twice in the DOM (desktop table + mobile cards): match the visible copy only. */
function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true }).first();
}

async function signInSuperAdmin(page: Page): Promise<void> {
  await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
}

test.afterAll(async () => {
  for (const slug of createdSlugs) await deleteTenantBySlug(slug);
  await closeAdmin();
});

test.describe('02-12 — platform panel: tenants list, creation, tenant page, status', () => {
  test('1. list → create → tenant page → status flip', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);

    // The list (D-33 `tenant-list`): title, the seed tenant row linked by id, its host and pill.
    await page.goto(`${hosts.platform}/plataforma`);
    await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
    const demoRow = page.getByRole('link', { name: /TRIA Demo \(tria-demo\)/ });
    await expect(demoRow).toBeVisible();
    await expect(demoRow).toHaveAttribute('href', UUID_PATH);
    await expect(visibleText(page, 'tria-demo.localhost')).toBeVisible();
    await expect(visibleText(page, 'Ativo')).toBeVisible();

    // "Novo tenant" → the D-31 form; the slug is suggested from the name while untouched.
    await page.getByRole('link', { name: 'Novo tenant' }).click();
    await expect(page).toHaveURL(`${hosts.platform}/plataforma/novo`);
    const slug = `e2e-painel-${rand}`;
    const name = `E2E Painel ${rand}`;
    createdSlugs.add(slug);
    await page.locator('#displayName').fill(name);
    await expect(page.locator('#slug')).toHaveValue(slug);
    await page.locator('#primary').fill('#7c3aed');
    await page.locator('#secondary').fill('#a78bfa');
    await page.locator('#adminEmail').fill(`admin+${rand}@e2e.local`);
    await page.getByRole('button', { name: 'Criar tenant' }).click();

    // Lands on the tenant page, Marca tab, with the "Tenant criado." toast.
    await expect(page).toHaveURL(new RegExp(`${UUID_PATH.source}/marca`), { timeout: 30_000 });
    await expect(page.getByRole('status')).toContainText('Tenant criado.');
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Ativo');
    await expect(page.getByText(slug, { exact: true })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText([
      'Marca',
      'Módulos',
      'Domínios',
      'Admins',
      'Status',
    ]);
    // The slug is immutable after creation (D-31): no slug input on the tenant page.
    await expect(page.locator('input#slug')).toHaveCount(0);

    // Status tab: suspend through the ConfirmDialog, then reactivate directly (D-32).
    await page.getByRole('tab', { name: 'Status' }).click();
    await expect(page).toHaveURL(/\/status$/);
    await page.getByRole('button', { name: 'Suspender tenant' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Suspender ${name}?`);
    await dialog.getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByRole('status')).toContainText('Alterações salvas.');
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Suspenso');
    await page.getByRole('button', { name: 'Reativar tenant' }).click();
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Ativo');

    // D-17/D-19 wiring: the six real modules are on, the reference module was never offered.
    expect(await getTenantModuleFlag(slug, 'events')).toBe(true);
    expect(await getTenantModuleFlag(slug, 'example')).toBe(false);

    // Back on the list: the new row, without a domain yet.
    await page.goto(`${hosts.platform}/plataforma`);
    const newRow = page.getByRole('link', { name: `${name} (${slug})` });
    await expect(newRow).toBeVisible();
    await expect(visibleText(page, 'Sem domínio')).toBeVisible();

    await context.close();
  });
});
