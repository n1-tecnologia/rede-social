import { expect, test } from '@playwright/test';
import { baseURL, login, SEED_PASSWORD, users } from './fixtures';

// AUTH-02 / D-05: the session is indefinite while the app is used — 1 h access token refreshed by a
// rotating refresh token, no inactivity time-box. Cookies are HttpOnly and written only by the server.
test.describe('AUTH-02 — session persistence', () => {
  test('closing and reopening the browser keeps the member logged in (storageState round-trip)', async ({
    browser,
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD);
    const state = await page.context().storageState();
    expect(state.cookies.some((c) => c.name.startsWith('sb-'))).toBe(true);

    // A brand-new context with the saved cookies simulates closing and reopening the browser / PWA.
    const reopened = await browser.newContext({ storageState: state });
    const reopenedPage = await reopened.newPage();
    const response = await reopenedPage.goto(`${baseURL}/inicio`);
    expect(response?.status()).toBe(200);
    await expect(reopenedPage).toHaveURL(/\/inicio$/);
    await expect(reopenedPage.getByRole('heading', { level: 1 })).toContainText('TRIA Demo');

    // proxy.ts runs getClaims() on every request: a later reload is still served, never /entrar.
    await reopenedPage.waitForTimeout(2000);
    const reload = await reopenedPage.reload();
    expect(reload?.status()).toBe(200);
    await expect(reopenedPage).toHaveURL(/\/inicio$/);
    await expect(reopenedPage.getByRole('heading', { level: 1 })).toContainText('TRIA Demo');
    await reopened.close();
  });
});
