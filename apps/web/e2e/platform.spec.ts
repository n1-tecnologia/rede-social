import { expect, type Page, test } from '@playwright/test';
import { hosts, isRemote, SEED_PASSWORD, signOut, users } from './fixtures';

/**
 * D-21 + D-23 on a phone viewport (`mobile-chromium`): the platform host is TRIA's `super_admin`
 * entry and nobody else's.
 *
 * The authority is the API, not the browser: `/inicio` renders only after
 * `GET /v1/platform/tenants` answers 200, so a member who signs in here is signed out and shown the
 * neutral "Este endereço não pertence à sua comunidade." screen, and the super_admin's own session
 * is refused on a tenant domain.
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

const MISMATCH = 'Este endereço não pertence à sua comunidade.';

/** Submits `/entrar` on `origin` and returns without asserting where it lands. */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.describe('D-21 — the platform host serves the super_admin and only the super_admin', () => {
  test('1. super_admin logs in on the platform host and sees the tenant list', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // The platform login offers no member sign-up (D-21).
    await page.goto(`${hosts.platform}/entrar`);
    await expect(page.getByText('Entrar na plataforma TRIA')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Criar nova conta' })).toHaveCount(0);

    await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await expect(page).toHaveURL(`${hosts.platform}/inicio`, { timeout: 30_000 });

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plataforma TRIA');
    const body = page.locator('body');
    await expect(body).toContainText('tria-demo');
    await expect(body).toContainText('tria-lab');
    // The module counts come from the API (7 for tria-demo, 2 for tria-lab).
    await expect(body).toContainText('módulos');

    // D-21/D-42: the neutral shell's single tab points at the platform panel (02-12), reachable with
    // one tap from the landing — asserted by href (the label is re-valued by 02-12), never clicked here.
    await expect(
      page
        .locator('[data-shell-nav="bottom"]:visible, [data-shell-nav="rail"]:visible')
        .locator('a[href="/plataforma"]'),
    ).toHaveCount(1);

    // "Sair" works from the platform chrome too (D-08): the settings page shows Preferências + Sair.
    await signOut(page, hosts.platform);

    await context.close();
  });

  test('2. a tenant member signing in on the platform host is signed out, no tenant named', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.platform, users.demoMember, SEED_PASSWORD);
    await expect(page).toHaveURL(`${hosts.platform}/endereco-invalido`, { timeout: 30_000 });
    await expect(page.getByText(MISMATCH)).toBeVisible();

    const text = (await page.locator('body').innerText()).toLowerCase();
    for (const secret of ['tria demo', 'tria-demo', 'tria lab', 'tria-lab']) {
      expect(text).not.toContain(secret);
    }
    expect((await context.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);

    await context.close();
  });

  test('3. D-23: the super_admin is refused on a tenant host', async ({ browser }) => {
    test.skip(isRemote, 'local stack only');

    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, hosts.demo, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await expect(page).toHaveURL(`${hosts.demo}/endereco-invalido`, { timeout: 30_000 });
    await expect(page.getByText(MISMATCH)).toBeVisible();
    expect((await context.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);

    await context.close();
  });

  test('4. D-21: a generic host is a member host — the super_admin lands on /sem-comunidade', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const context = await browser.newContext();
    const page = await context.newPage();

    // Expected, not a bug: the platform UI is reached through PLATFORM_HOST only, so the layout runs
    // the tenant branch and the API answers 403 NO_MEMBERSHIP for an identity with no membership.
    await signIn(page, hosts.generic, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await expect(page).toHaveURL(`${hosts.generic}/sem-comunidade`, { timeout: 30_000 });

    await context.close();
  });
});
