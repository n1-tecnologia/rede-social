import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/** The bell's label comes from the catalog (07-01), never a literal. */
const BELL = notificationMessages.notifications.nav;
/**
 * 07-03 (UI-D-253): with unseen rows the slot's accessible name carries its state after the plain
 * label ("Notificações, 2 novas"), so the name is the label alone or the label plus that suffix.
 */
const BELL_NAME = new RegExp(`^${BELL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, .+)?$`);

/** The bell slot in whichever chrome is visible: the TopBar on the phone, the rail's bottom group on desktop. */
const bellSlot = (page: Page) =>
  page
    .locator('header a[href="/notificacoes"], aside a[href="/notificacoes"]')
    .filter({ visible: true });

/**
 * UI-03 / MOD-04 / D-39 / D-40 / D-42 (plan 02-07): the registry-driven, branded shell on both seed
 * tenants, at 390px (`mobile-chromium`: TopBar + floating BottomNav) and 1280px (`desktop-chromium`:
 * rail + centred column). Everything the shell shows comes from `GET /v1/me/bootstrap`: the tenant's
 * logo and `--brand-primary`, the tabs of its ENABLED modules and the home slots.
 *
 * **The "Em breve" card is no longer observable on either seed tenant (04-06, UI-D-20).** It means
 * "no module contributed anything", and since 04-01 both seed tenants have the `feed` module
 * enabled, so a slot IS registered and the feed's own card takes that position.
 *
 * **The nav is the REGISTRY's, and since 05-01 it is no longer kernel-only.** `feed` deliberately
 * contributes a home slot and no tab (D-55); `communities` contributes a TAB at `nav.order: 20`
 * (D-40) and, since 05.3-01, `reels` a TAB at `nav.order: 30` (D-123, it requires `feed`). So
 * rede-demo (both modules on) shows Início · Comunidades · Reels · Perfil and rede-lab (reels on,
 * communities off) shows Início · Reels · Perfil. The two seed tenants therefore
 * differ HERE as well — which makes this assertion a second witness for the module flag rather
 * than the sameness it used to be. What still separates the two tenants in
 * every other respect is what the rest of this file measures: the brand token, the logo, the
 * display name, and the fact that neither tenant's brand ever appears in the other's HTML
 * (TENANT-02 adjacency).
 */

const BRAND = {
  demo: { primary: '#7c3aed', name: 'Rede Demo' },
  lab: { primary: '#0f766e', name: 'Rede Lab' },
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
  test('rede-demo: logo, brand, Início · Perfil, the feed home slot, one tree visible', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à Rede Demo');
    expect(await brandPrimary(page)).toBe(BRAND.demo.primary);
    // The logo (as-is, D-26) renders in the visible chrome (TopBar on the phone, rail on desktop) and
    // on the home column; the hidden tree's copy is not counted.
    await expect(
      page.locator(mobile ? 'header' : 'aside').locator('img[alt="Rede Demo"]'),
    ).toBeVisible();
    await expect(page.locator('main img[alt="Rede Demo"]')).toBeVisible();
    await expect(page.locator('img[alt="Rede Demo"]:visible')).toHaveCount(2);

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
    // 05-01 / 05.3-01 / 06-01: rede-demo has the `communities` (order 20), `reels` (order 30) and
    // `events` (order 40) modules, so their manifests' tabs sit between the two kernel entries. The
    // lab case below reads Início · Reels · Eventos · Perfil — the pair is the communities flag,
    // rendered.
    expect(await navLinkNames(nav)).toEqual([
      'Início',
      'Comunidades',
      'Reels',
      'Eventos',
      'Perfil',
    ]);
    await expect(nav.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');

    // 07-01 (D-40, UI-D-268): rede-demo has notifications ON, so the bell is a TopBar slot on the
    // phone and a rail bottom-group row on desktop, OUTSIDE the tab tree above (the tab list is
    // unchanged). Exactly one copy is visible.
    await expect(bellSlot(page)).toHaveCount(1);
    await expect(bellSlot(page)).toHaveAttribute('aria-label', BELL_NAME);

    // D-42: the enabled module's home slot renders; the "Em breve" card does not. Since 04-10 that
    // slot is the FEED's — the reference module that used to fill it was deleted with D-19.
    await expect(
      page.locator('main.app-scroll').getByRole('region', { name: 'Feed principal' }),
    ).toBeVisible();
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);

    // Children render exactly once and scroll inside the shell's single scroll root.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main.app-scroll')).toHaveCount(1);
    await expect(page.locator('main.app-scroll h1')).toHaveCount(1);

    // TENANT-02 adjacency: the other tenant's brand never appears; no Rede Social mark inside a tenant shell.
    const html = await page.content();
    expect(html).not.toContain(BRAND.lab.primary);
    expect(html).not.toContain(BRAND.lab.name);
    await expect(
      page.locator('[data-brand-root]').getByText('Rede Social', { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('[data-brand-root] img[alt="Rede Social"]')).toHaveCount(0);
  });

  test('rede-lab: the same tab set and the same slot shape, under a different brand', async ({
    page,
  }, testInfo) => {
    test.skip(isRemote, 'local stack only (needs the rede-lab host)');
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à Rede Lab');
    expect(await brandPrimary(page)).toBe(BRAND.lab.primary);

    const nav = visibleNav(page, mobile);
    // Scoped to the NAV: the lab feed carries 04-05's seeded link posts, whose auto-linked URLs are
    // links too — a page-wide count would read those as tabs and fail for the wrong reason.
    // 06-01: rede-lab has `events` on (D-17), so the Eventos tab sits after Reels (order 40).
    expect(await navLinkNames(nav)).toEqual(['Início', 'Reels', 'Eventos', 'Perfil']);
    // 07-01 (D-40): rede-lab keeps notifications OFF, so its chrome has no bell at all.
    await expect(page.locator('a[href="/notificacoes"]')).toHaveCount(0);
    // UI-D-20: a module DID contribute a slot here, so the kernel placeholder must be absent and
    // the feed widget must be what fills the home column instead.
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);
    await expect(
      page.locator('main.app-scroll').getByRole('region', { name: 'Feed principal' }),
    ).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(BRAND.demo.primary);
    expect(html).not.toContain(BRAND.demo.name);
    await expect(
      page.locator('[data-brand-root]').getByText('Rede Social', { exact: true }),
    ).toHaveCount(0);
  });

  test('D-41: dark theme from /configuracoes survives a JS-disabled reload (no flash) and a JS reload', async ({
    browser,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

      await page.goto(`${hosts.demo}/configuracoes`);
      const toggle = page.locator('main').getByRole('switch', { name: 'Tema escuro' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      const cookie = (await context.cookies()).find((c) => c.name === 'rede_theme');
      expect(cookie?.value).toBe('dark');
      expect(cookie?.httpOnly).toBe(false);
      expect(cookie?.sameSite).toBe('Lax');

      // The rail (desktop) also carries the toggle, in step with the settings row.
      if (!mobile) {
        await expect(page.locator('aside').getByRole('switch', { name: 'Tema' })).toHaveAttribute(
          'aria-checked',
          'true',
        );
      }

      // Server-rendered theme with JavaScript OFF: the first HTML already says dark (Pitfall 2).
      await withoutJavaScript(browser, await context.storageState(), async (noJs) => {
        await noJs.goto(`${hosts.demo}/inicio`, { waitUntil: 'domcontentloaded' });
        await expect(noJs.locator('html')).toHaveAttribute('data-theme', 'dark');
      });

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally {
      await context.close();
    }
  });

  test('D-08: "Sair" on /configuracoes signs this device out and /inicio then lands on /entrar', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configurações');
    // No "Em breve" pill is left: 03-04 turned "Editar perfil" into a real navigating row, and 07-07
    // replaced the "Notificações" placeholder with this device's push row (broken-windows 10).
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);
    await expect(page.locator('main [data-push-row]')).toHaveCount(1);
    await expect(page.locator('main a[href="/perfil/editar"]')).toBeVisible();
    await page.locator('main').getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.goto(`${hosts.demo}/inicio`);
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('/perfil: e-mail, no role pill, Perfil tab current, TopBar avatar current on the phone', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/perfil`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perfil');
    await expect(page.getByText(users.demoMember)).toBeVisible();
    // The role pill left this screen in 03-05 (UI-D-01/D-45); pinned absent so it cannot return.
    await expect(page.getByText('Membro', { exact: true })).toHaveCount(0);

    const nav = visibleNav(page, mobile);
    await expect(nav.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Início' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    if (mobile) {
      await expect(page.getByRole('link', { name: 'Meu perfil' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
    await page.getByRole('link', { name: 'Configurações' }).first().click();
    await expect(page).toHaveURL(/\/configuracoes$/);
  });
});

async function withoutJavaScript(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
  fn: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState, javaScriptEnabled: false });
  try {
    await fn(await context.newPage());
  } finally {
    await context.close();
  }
}
