import { expect, type Page, test } from '@playwright/test';
import { closeAdmin, getTenantModuleFlag } from './admin';
import { hosts, isRemote } from './fixtures';
import {
  closeTenantFixtures,
  createThrowawayTenant,
  deleteTenantBySlug,
  setTenantModuleFlag,
} from './tenant-fixtures';

/**
 * Phase 09 - Rede social, the platform panel's side (plan 09-12, UI-D-505, D-474, D-478, D-482).
 *
 * **Tracer (Task 1).** The `super_admin` opens a tenant's Módulos tab and finds the "Rede social"
 * row; switching it on opens the shipped `ConfirmDialog` with the exact copy instead of writing;
 * Cancel leaves it off and writes nothing; Confirm turns it on with the "Alterações salvas." toast
 * and the tenant's `social` flag (the row the bootstrap lists) reads on; switching it off needs no
 * dialog; while Feed is off the switch is disabled and the row explains why.
 *
 * Every case runs on a THROWAWAY tenant (`tenant-fixtures.ts`), never on a seed tenant: the seed
 * tenants are shared by the whole suite and their flags sit in the API's 30 s cache. `afterAll`
 * deletes what was created. Local stack only (the fixtures write through the admin connection).
 */

test.skip(isRemote, 'local stack only (the tenant fixtures write through the admin connection)');
test.describe.configure({ timeout: 120_000 });
test.use({ serviceWorkers: 'block' });

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** Per-run suffix, stable across worker restarts; the projects never share a slug. */
const rand = process.ppid.toString(36);
const slugFor = (project: string, name: string) =>
  `e2e-soc-${name}-${rand}${project.startsWith('mobile') ? 'm' : 'd'}`;

const SOCIAL_SWITCH = 'Ativar ou desativar Rede social';
const CONFIRM_TITLE = (tenant: string) => `Ativar a Rede social em ${tenant}?`;
const CONFIRM_BODY =
  'Os membros passarão a seguir uns aos outros e a publicar conteúdo próprio. Antes de ativar, revise os termos de uso, as regras da comunidade e a política de privacidade para conteúdo de terceiros (item “Ativar a Rede social” em docs/DEPLOY.md).';

async function signInSuperAdmin(page: Page): Promise<void> {
  await page.goto(`${hosts.platform}/entrar`);
  await page.locator('#email').fill(SUPER_ADMIN_EMAIL);
  await page.locator('#password').fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

async function openModulesTab(page: Page, tenantId: string): Promise<void> {
  await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/modulos`);
  await expect(page.getByRole('switch', { name: SOCIAL_SWITCH })).toBeVisible();
}

/** A throwaway tenant with Feed ON and no `social` row (the state of a tenant the panel just made). */
async function makeTenant(
  project: string,
  name: string,
  opts: { feed: boolean },
): Promise<{ id: string; slug: string; displayName: string }> {
  const slug = slugFor(project, name);
  const displayName = `Social ${name} ${rand}`;
  const { id } = await createThrowawayTenant({
    slug,
    displayName,
    hosts: [],
    colors: { primary: '#7c3aed', secondary: '#a78bfa' },
  });
  await setTenantModuleFlag(slug, 'feed', opts.feed);
  return { id, slug, displayName };
}

test.beforeAll(() => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value used by `pnpm db:seed`)');
  }
});

test.afterAll(async ({ browser: _browser }, testInfo) => {
  for (const name of ['enable', 'nofeed', 'limits']) {
    await deleteTenantBySlug(slugFor(testInfo.project.name, name));
  }
  await closeTenantFixtures();
  await closeAdmin();
});

test.describe('09-12 - platform panel: the Rede social row (tracer)', () => {
  test('1. enabling confirms first, cancel writes nothing, confirm turns it on, off is immediate', async ({
    browser,
  }, testInfo) => {
    const tenant = await makeTenant(testInfo.project.name, 'enable', { feed: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await openModulesTab(page, tenant.id);

    // The row: the catalog name and description, off, enabled switch, no note.
    await expect(
      page.getByText('Membros seguem uns aos outros e publicam em Explorar.'),
    ).toBeVisible();
    const sw = page.getByRole('switch', { name: SOCIAL_SWITCH });
    await expect(sw).not.toBeChecked();
    await expect(sw).toBeEnabled();
    await expect(page.getByText('Ative Feed para usar a Rede social.')).toHaveCount(0);

    // Switching on opens the dialog with the exact copy and writes nothing yet.
    await sw.click();
    const dialog = page.getByRole('dialog', { name: CONFIRM_TITLE(tenant.displayName) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(CONFIRM_BODY)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ativar Rede social' })).toBeVisible();
    expect(await getTenantModuleFlag(tenant.slug, 'social')).toBeNull();

    // Cancel: the switch stays off and nothing is written.
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(sw).not.toBeChecked();
    expect(await getTenantModuleFlag(tenant.slug, 'social')).toBeNull();

    // Confirm: the usual optimistic switch and toast, and the flag the bootstrap reads is on.
    await sw.click();
    await page
      .getByRole('dialog', { name: CONFIRM_TITLE(tenant.displayName) })
      .getByRole('button', { name: 'Ativar Rede social' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Alterações salvas.' })).toBeVisible();
    await expect(sw).toBeChecked();
    await expect.poll(() => getTenantModuleFlag(tenant.slug, 'social')).toBe(true);

    // Off needs no dialog: the action runs at once and toasts.
    await sw.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => getTenantModuleFlag(tenant.slug, 'social')).toBe(false);
    await expect(sw).not.toBeChecked();

    await context.close();
  });

  test('2. with Feed off the switch is disabled and the row says why', async ({
    browser,
  }, testInfo) => {
    const tenant = await makeTenant(testInfo.project.name, 'nofeed', { feed: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await openModulesTab(page, tenant.id);

    const sw = page.getByRole('switch', { name: SOCIAL_SWITCH });
    await expect(sw).toBeDisabled();
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Ative Feed para usar a Rede social.')).toBeVisible();

    // Nothing opens and nothing is written.
    await sw.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await getTenantModuleFlag(tenant.slug, 'social')).toBeNull();

    await context.close();
  });
});
