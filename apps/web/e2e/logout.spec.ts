import { expect, test } from '@playwright/test';
import { baseURL, login, SEED_PASSWORD, signOut, users } from './fixtures';

// AUTH-05 / D-08: "Sair" lives in the (app) layout (every authenticated page) and signs out THIS
// device only (`signOut({ scope: 'local' })`). Two browser contexts = two devices of the same member.
test.describe('AUTH-05 — device-local logout', () => {
  test('"Sair" on device A leaves device B logged in', async ({ browser }) => {
    const deviceA = await browser.newContext();
    const deviceB = await browser.newContext();
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();

    await login(pageA, users.demoMember, SEED_PASSWORD, baseURL);
    await login(pageB, users.demoMember, SEED_PASSWORD, baseURL);

    // "Sair" lives on /configuracoes (D-42); the desktop rail carries it on every (app) page too.
    await signOut(pageA, baseURL);
    await pageA.goto(`${baseURL}/inicio`);
    await expect(pageA).toHaveURL(/\/entrar$/);

    const responseB = await pageB.goto(`${baseURL}/inicio`);
    expect(responseB?.status()).toBe(200);
    await expect(pageB).toHaveURL(/\/inicio$/);
    // Início has no visible welcome block (2026-10-01): its one h1 is the screen-reader "Início",
    // and the tenant shows in the shell's home link (TopBar on the phone, rail on desktop), named
    // by the logo's alt (or by the name itself without a logo).
    await expect(pageB.getByRole('heading', { level: 1 })).toHaveText('Início');
    await expect(pageB.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');

    await deviceA.close();
    await deviceB.close();
  });
});
