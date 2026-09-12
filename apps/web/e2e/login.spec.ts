import { expect, test } from '@playwright/test';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

// baseURL = the tria-demo TENANT host (D-20). Runs on mobile-chromium (iPhone 14) by default.
test.describe('AUTH-02 — login on the tenant host', () => {
  test('a logged-out visit to /inicio redirects to /entrar', async ({ page }) => {
    await page.goto('/inicio');
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('/entrar shows the host tenant from the HOST, not from a cookie (D-22)', async ({
    page,
    context,
  }) => {
    await page.goto('/entrar');
    await expect(page.getByText('Comunidade: TRIA Demo')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Criar nova conta' })).toHaveAttribute(
      'href',
      '/cadastro',
    );
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'tenant_slug')).toBeUndefined();
  });

  test('a seeded member logs in and lands on /inicio with tenant, role and e-mail', async ({
    page,
    context,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TRIA Demo');
    await expect(page.getByText('Membro', { exact: true })).toBeVisible();
    await expect(page.getByText(users.demoMember)).toBeVisible();

    // T-02-01: the session lives in HttpOnly cookies set by the server, never in client JS.
    const session = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
    expect(session.length).toBeGreaterThan(0);
    for (const cookie of session) expect(cookie.httpOnly, `${cookie.name} httpOnly`).toBe(true);
  });

  test('a wrong password stays on /entrar with the single generic alert (T-02-05)', async ({
    page,
  }) => {
    await page.goto('/entrar');
    await page.locator('#email').fill(users.demoMember);
    await page.locator('#password').fill('senha-errada-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/entrar\?erro=credenciais$/);
    // `p[role=alert]`: Next's route announcer is also role=alert.
    await expect(page.locator('p[role="alert"]')).toHaveText('Email ou senha incorretos.');
  });

  test('generic host (D-21 fallback): neutral shell, membership wins', async ({ page }) => {
    test.skip(isRemote, 'local stack only');
    await page.goto(`${hosts.generic}/entrar`);
    await expect(page.getByText('Comunidade:')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Criar nova conta' })).toHaveCount(0);

    await login(page, users.demoMember, SEED_PASSWORD, hosts.generic);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TRIA Demo');
  });
});
