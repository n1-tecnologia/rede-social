import { expect, test } from '@playwright/test';
import { deleteExampleItemsLike } from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * D-19 end to end on a phone viewport: the admin creates, the member reads, and a tenant without
 * the module sees nothing at all. This is the user-visible half of the module contract — the API
 * half lives in `apps/api/tests/integration/example.test.ts`.
 *
 * baseURL = the tria-demo TENANT host (D-20).
 */

const TITLE = `Item e2e ${Date.now()}`;

test.afterAll(async () => {
  await deleteExampleItemsLike('Item e2e %');
});

test.describe('MOD-01/ROLE-06 — the example module on /inicio', () => {
  test('the admin sees the form, creates an item, and it appears in the list', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD);

    const widget = page.locator('#exemplo');
    await expect(widget.getByRole('heading', { name: 'Exemplo' })).toBeVisible();

    await widget.getByLabel('Título do item').fill(TITLE);
    await widget.getByRole('button', { name: 'Adicionar' }).click();

    await expect(widget.getByText(TITLE)).toBeVisible();
  });

  test('a member of the same tenant reads the list but gets no form', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD);

    const widget = page.locator('#exemplo');
    await expect(widget.getByRole('heading', { name: 'Exemplo' })).toBeVisible();
    // The item the admin created in the previous test is visible to the member...
    await expect(widget.getByText(TITLE)).toBeVisible();
    // ...but ROLE-06 means no write affordance at all.
    await expect(widget.getByRole('button', { name: 'Adicionar' })).toHaveCount(0);
    await expect(widget.locator('input[name="title"]')).toHaveCount(0);
  });

  test('a tenant without the module sees no widget at all', async ({ page }) => {
    // tria-lab must be visited on ITS OWN host: on the demo host that session is refused with
    // TENANT_HOST_MISMATCH (D-23), which would prove nothing about the module flag.
    test.skip(isRemote, 'local stack only (needs the tria-lab host)');

    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('TRIA Lab');
    await expect(page.locator('#exemplo')).toHaveCount(0);
  });
});
