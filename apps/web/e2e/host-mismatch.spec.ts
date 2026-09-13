import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { hosts, isRemote, SEED_PASSWORD, users } from './fixtures';

/**
 * TENANT-01 / D-23 on a phone viewport (`mobile-chromium`): the membership is the authority, and the
 * host can only DENY. A tria-demo member who opens tria-lab's address is signed out and told only
 * "Este endereço não pertence à sua comunidade." — never which community is theirs, never which
 * community this address serves. The same member keeps working on a generic host (D-21) and on their
 * own host.
 *
 * Local stack only: it needs three distinct origins on one dev server.
 */

test.describe.configure({ timeout: 120_000 });

const MISMATCH = 'Este endereço não pertence à sua comunidade.';

/** Submits `/entrar` on `origin` and waits for whatever the server decides to show. */
async function signIn(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(users.demoMember);
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.describe('TENANT-01/D-23 — a session on another tenant’s host', () => {
  test('1. tria-demo member on the tria-lab host: signed out, no tenant named', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.lab);
    await expect(page).toHaveURL(`${hosts.lab}/endereco-invalido`, { timeout: 30_000 });
    await expect(page.getByText(MISMATCH)).toBeVisible();

    // No query string: the URL itself must not carry a tenant (nor land in the browser history).
    expect(new URL(page.url()).search).toBe('');

    // Neither tenant may appear anywhere on the page.
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const secret of ['tria demo', 'tria lab', 'tria-demo', 'tria-lab']) {
      expect(body).not.toContain(secret);
    }

    // The session was cleared, so the private area is closed again.
    expect((await context.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);
    await page.goto(`${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/entrar$/, { timeout: 30_000 });

    await context.close();
  });

  test('2. D-21: the same member on a generic host logs in normally', async ({ browser }) => {
    test.skip(isRemote, 'local stack only');

    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.generic);
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TRIA Demo', {
      timeout: 20_000,
    });

    await context.close();
  });

  test('3. the same member on their own host logs in normally', async ({ browser }) => {
    test.skip(isRemote, 'local stack only');

    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.demo);
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TRIA Demo', {
      timeout: 20_000,
    });

    await context.close();
  });
});
