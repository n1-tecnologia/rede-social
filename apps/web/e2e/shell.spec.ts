import { expect, type Locator, type Page, test } from '@playwright/test';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * UI-03 / MOD-04 / D-39 / D-40 / D-42 (plan 02-07): the registry-driven, branded shell on both seed
 * tenants, at 390px (`mobile-chromium`: TopBar + floating BottomNav) and 1280px (`desktop-chromium`:
 * rail + centred column). Everything the shell shows comes from `GET /v1/me/bootstrap`: the tenant's
 * logo and `--brand-primary`, the tabs of its ENABLED modules (demo has `example`, lab does not) and
 * the home slots (the example widget on demo, the "Em breve" card on lab).
 */

const BRAND = {
  demo: { primary: '#7c3aed', name: 'TRIA Demo' },
  lab: { primary: '#0f766e', name: 'TRIA Lab' },
} as const;

async function brandPrimary(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-brand-root]');
    if (!el) throw new Error('no [data-brand-root]');
    return getComputedStyle(el).getPropertyValue('--brand-primary').trim();
  });
}

/** The navigation tree visible on this project (BottomNav on the phone, the rail on desktop). */
function visibleNav(page: Page, mobile: boolean): Locator {
  return page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]');
}

/** Link names of a nav tree: BottomNav links are icon-only (`aria-label`), rail links carry text. */
async function navLinkNames(nav: Locator): Promise<string[]> {
  return nav
    .locator('a')
    .evaluateAll((links) =>
      links.map((a) => a.getAttribute('aria-label') ?? a.textContent?.trim() ?? ''),
    );
}

test.describe('UI-03 / MOD-04 — the registry-driven branded shell', () => {
  test('tria-demo: logo, brand, Início · Exemplo · Perfil, the example home slot, one tree visible', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à TRIA Demo');
    expect(await brandPrimary(page)).toBe(BRAND.demo.primary);
    // The logo (as-is, D-26) renders in the visible chrome (TopBar on the phone, rail on desktop) and
    // on the home column; the hidden tree's copy is not counted.
    await expect(
      page.locator(mobile ? 'header' : 'aside').locator('img[alt="TRIA Demo"]'),
    ).toBeVisible();
    await expect(page.locator('main img[alt="TRIA Demo"]')).toBeVisible();
    await expect(page.locator('img[alt="TRIA Demo"]:visible')).toHaveCount(2);

    // Both trees are in the DOM; the breakpoint decides which one shows (D-39, no layout flash).
    await expect(page.locator('[data-shell-nav="bottom"]')).toHaveCount(1);
    await expect(page.locator('[data-shell-nav="rail"]')).toHaveCount(1);
    if (mobile) {
      await expect(page.locator('[data-shell-nav="bottom"]')).toBeVisible();
      await expect(page.locator('[data-shell-nav="rail"]')).toBeHidden();
    } else {
      await expect(page.locator('[data-shell-nav="rail"]')).toBeVisible();
      await expect(page.locator('[data-shell-nav="bottom"]')).toBeHidden();
    }

    const nav = visibleNav(page, mobile);
    expect(await navLinkNames(nav)).toEqual(['Início', 'Exemplo', 'Perfil']);
    await expect(nav.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');

    // D-42: the enabled module's home slot renders; the "Em breve" card does not.
    await expect(page.locator('#exemplo')).toBeVisible();
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);

    // Children render exactly once and scroll inside the shell's single scroll root.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main.app-scroll')).toHaveCount(1);
    await expect(page.locator('main.app-scroll h1')).toHaveCount(1);

    // TENANT-02 adjacency: the other tenant's brand never appears; no TRIA mark inside a tenant shell.
    const html = await page.content();
    expect(html).not.toContain(BRAND.lab.primary);
    expect(html).not.toContain(BRAND.lab.name);
    await expect(page.locator('[data-brand-root]').getByText('TRIA', { exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('[data-brand-root] img[alt="TRIA"]')).toHaveCount(0);
  });

  test('tria-lab: no Exemplo tab, no #exemplo, the "Em breve" card, the lab brand', async ({
    page,
  }, testInfo) => {
    test.skip(isRemote, 'local stack only (needs the tria-lab host)');
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à TRIA Lab');
    expect(await brandPrimary(page)).toBe(BRAND.lab.primary);

    const nav = visibleNav(page, mobile);
    expect(await navLinkNames(nav)).toEqual(['Início', 'Perfil']);
    await expect(page.getByRole('link', { name: 'Exemplo' })).toHaveCount(0);
    await expect(page.locator('#exemplo')).toHaveCount(0);
    await expect(page.getByText('Em breve', { exact: true })).toBeVisible();
    await expect(
      page.locator('main.app-scroll').getByText('Em breve', { exact: true }),
    ).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(BRAND.demo.primary);
    expect(html).not.toContain(BRAND.demo.name);
    await expect(page.locator('[data-brand-root]').getByText('TRIA', { exact: true })).toHaveCount(
      0,
    );
  });
});
