import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { closeAdmin, consentCountForEmailIn, membershipForEmailIn } from './admin';
import { hosts, isRemote, SEED_PASSWORD, users } from './fixtures';

/**
 * TENANT-01 / D-23 on a phone viewport (`mobile-chromium`), as amended by 08.1 (D-305, D-316): the
 * host selects among the session's OWN memberships and grants nothing. A rede-demo member who signs in
 * on rede-lab's address holds no membership there, so they are offered "Participar de Rede Lab" —
 * never shown which community is theirs. A platform account is still signed out with "Este endereço
 * não pertence à sua comunidade.". The same member keeps working on a generic host (D-21) and on
 * their own host.
 *
 * Local stack only: it needs three distinct origins on one dev server.
 */

test.describe.configure({ timeout: 120_000 });

const MISMATCH = 'Este endereço não pertence à sua comunidade.';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';

/** Submits `/entrar` on `origin` and waits for whatever the server decides to show. */
async function signIn(
  page: Page,
  origin: string,
  email: string = users.demoMember,
  password: string = SEED_PASSWORD,
): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.afterAll(async () => {
  await closeAdmin();
});

test.describe('TENANT-01/D-23 — a session on another tenant’s host', () => {
  test('1. D-305: rede-demo member on the rede-lab host lands on /participar, which names only rede-lab', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.lab);
    await expect(page).toHaveURL(`${hosts.lab}/participar`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Participar de Rede Lab');

    // No query string: the URL itself must not carry a tenant (nor land in the browser history).
    expect(new URL(page.url()).search).toBe('');

    // rede-demo appears nowhere on the page. The session's own e-mail is shown (it is the person's,
    // and its domain happens to be `rede-demo.local`), so it is cut before the check.
    const body = (await page.locator('body').innerText())
      .replace(users.demoMember, '')
      .toLowerCase();
    for (const secret of ['rede demo', 'rede-demo']) expect(body).not.toContain(secret);

    // The SEED member never joins rede-lab here: "Não participar" signs out of this origin only.
    await page.getByRole('button', { name: 'Não participar' }).click();
    await expect(page).toHaveURL(`${hosts.lab}/entrar`, { timeout: 30_000 });
    expect((await context.cookies(hosts.lab)).filter((c) => c.name.startsWith('sb-'))).toHaveLength(
      0,
    );
    expect(await membershipForEmailIn(users.demoMember, 'rede-lab')).toBeNull();
    expect(await consentCountForEmailIn(users.demoMember, 'rede-lab')).toBe(0);

    await context.close();
  });

  test('1b. D-316: the platform super_admin on the rede-lab host is still signed out on /endereco-invalido', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!password)
      throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');

    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.lab, SUPER_ADMIN_EMAIL, password);
    await expect(page).toHaveURL(`${hosts.lab}/endereco-invalido`, { timeout: 30_000 });
    await expect(page.getByText(MISMATCH)).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const secret of ['rede demo', 'rede lab', 'rede-demo', 'rede-lab']) {
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
    // Início has no visible welcome block (2026-10-01): its one h1 is the screen-reader "Início",
    // and the MEMBERSHIP's tenant shows in the shell's home link (TopBar on the phone, rail on
    // desktop), named by the logo's alt (or by the name itself without a logo).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início', { timeout: 20_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');

    await context.close();
  });

  test('3. the same member on their own host logs in normally', async ({ browser }) => {
    test.skip(isRemote, 'local stack only');

    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.demo);
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início', { timeout: 20_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');

    await context.close();
  });
});
