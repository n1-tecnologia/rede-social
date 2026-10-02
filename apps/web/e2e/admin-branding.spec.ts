import { expect, type Page, test } from '@playwright/test';
import { closeBrandingAdmin, getTenantBranding } from './branding-admin';
import { isRemote, login, SEED_PASSWORD } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  type MembersTenant,
  membersTenantSlug,
  sweepMembersTenants,
} from './members-admin';
import { closeTenantFixtures } from './tenant-fixtures';

/**
 * 08-06 — the tenant lane's Marca screen (ADMIN-01, D-339, D-342, UI-D-279): the admin edits their
 * own community's brand with the super_admin's editor, unchanged, from Configurações → Marca.
 *
 * The subject is a THROWAWAY community with its own admin (`createMembersTenant(…, 0)`), never a seed
 * tenant: a brand change sits in the web and API host caches for up to 60 s, so flipping rede-demo
 * would leak into every spec that runs after this one (`tenant-fixtures.ts`). The API integration
 * suite proves the same flow on `admin@rede-demo.local` itself and restores the seed afterwards.
 * Each project gets its own tenant and host, unique per run (the host-cache rule of
 * `membersTenantSlug`).
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(isRemote, 'local stack only');

const PREFIX = 'brnd';
let tenant: MembersTenant;

/**
 * After a full navigation the inputs exist before React hydrated them; a fill dispatched in that
 * window is lost. React tags hydrated DOM nodes with its internal props key (the 02-14 probe).
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

/** The RENDERED background of the mini login CTA inside one `BrandPreview` frame. */
function previewButtonBg(page: Page, theme: 'light' | 'dark'): Promise<string> {
  return page
    .locator(`[data-brand-scope][data-theme="${theme}"] button`)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** The `--brand-primary` the shell's `main` inherits (custom properties come back raw). */
function shellPrimary(page: Page): Promise<string> {
  return page
    .locator('main')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary').trim());
}

async function openMarca(page: Page): Promise<void> {
  await page.goto(`${tenant.origin}/configuracoes/marca`);
  await expect(page.getByRole('heading', { name: 'Marca' })).toBeVisible();
  await waitForHydration(page, '#primary');
}

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  await sweepMembersTenants(
    `${PREFIX}-${testInfo.project.name.replace(/[^a-z0-9]/g, '').slice(0, 10)}`,
  );
  tenant = await createMembersTenant(
    membersTenantSlug(PREFIX, testInfo.project.name),
    SEED_PASSWORD,
    0,
  );
});

test.afterAll(async () => {
  if (tenant) await deleteMembersTenant(tenant.slug);
  await closeMembersAdmin();
  await closeTenantFixtures();
  await closeBrandingAdmin();
});

test.describe('08-06 — Marca on the tenant lane', () => {
  test('branding tracer: the admin changes the primary from Marca and the app shell shows it', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);

    // D-339: "Marca" is the first row of the Administração group.
    await page.goto(`${tenant.origin}/configuracoes`);
    const row = page.getByRole('link', { name: 'Marca' });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(`${tenant.origin}/configuracoes/marca`);
    await expect(page.getByText(/As mudanças aparecem no app na hora/)).toBeVisible();
    await waitForHydration(page, '#primary');

    // The unchanged form: the colours card, both preview frames, save disabled until a change.
    const save = page.getByRole('button', { name: 'Salvar alterações' });
    await expect(page.locator('[data-brand-scope]')).toHaveCount(2);
    await expect(save).toBeDisabled();

    // The preview follows the typed value live.
    await page.locator('#primary').fill('#1d4ed8');
    await page.locator('#secondary').fill('#60a5fa');
    await expect.poll(() => previewButtonBg(page, 'light')).toBe('rgb(29, 78, 216)');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    expect((await getTenantBranding(tenant.slug)).colors.primary).toBe('#1d4ed8');

    // The next navigation renders the new brand from the per-request bootstrap.
    await page.goto(`${tenant.origin}/inicio`);
    await expect.poll(() => shellPrimary(page)).toBe('#1d4ed8');
  });

  test('the form reopens on the saved colours', async ({ page }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    await expect(page.locator('#primary')).toHaveValue('#1d4ed8');
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  });
});
