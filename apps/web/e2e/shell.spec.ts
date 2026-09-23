import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * UI-03 / MOD-04 / D-39 / D-40 / D-42 (plan 02-07): the registry-driven, branded shell on both seed
 * tenants, at 390px (`mobile-chromium`: TopBar + floating BottomNav) and 1280px (`desktop-chromium`:
 * rail + centred column). Everything the shell shows comes from `GET /v1/me/bootstrap`: the tenant's
 * logo and `--brand-primary`, the tabs of its ENABLED modules (demo has `example`, lab does not) and
 * the home slots.
 *
 * **The "Em breve" card is no longer observable on either seed tenant (04-06, UI-D-20).** It means
 * "no module contributed anything", and since 04-01 the lab tenant has the `feed` module enabled,
 * so a slot IS registered and the feed's own card takes that position. What the lab case proves now
 * is the thing that actually distinguishes it from demo — no `example` tab, no `#exemplo` widget —
 * plus the positive fact that the registered slot rendered. Asserting the placeholder here would
 * contradict `feed.spec.ts`, which asserts the opposite for the same tenant.
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

  test('tria-lab: no Exemplo tab, no #exemplo, the feed slot instead of "Em breve", the lab brand', async ({
    page,
  }, testInfo) => {
    test.skip(isRemote, 'local stack only (needs the tria-lab host)');
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo(a) à TRIA Lab');
    expect(await brandPrimary(page)).toBe(BRAND.lab.primary);

    const nav = visibleNav(page, mobile);
    expect(await navLinkNames(nav)).toEqual(['Início', 'Perfil']);
    // Scoped to the NAV and matched exactly: the lab feed carries 04-05's seeded link posts, whose
    // auto-linked URLs (`…exemplo.invalid/…`) are links whose accessible name CONTAINS "exemplo".
    // A page-wide substring match would read those as an example TAB and fail for the wrong reason.
    await expect(nav.getByRole('link', { name: 'Exemplo', exact: true })).toHaveCount(0);
    await expect(page.locator('#exemplo')).toHaveCount(0);
    // UI-D-20: a module DID contribute a slot here, so the kernel placeholder must be absent and
    // the feed widget must be what fills the home column instead.
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);
    await expect(
      page.locator('main.app-scroll').getByRole('region', { name: 'Publicações da comunidade' }),
    ).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(BRAND.demo.primary);
    expect(html).not.toContain(BRAND.demo.name);
    await expect(page.locator('[data-brand-root]').getByText('TRIA', { exact: true })).toHaveCount(
      0,
    );
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
      const cookie = (await context.cookies()).find((c) => c.name === 'tria_theme');
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
    // ONE "Em breve" pill is left: 03-04 turned "Editar perfil" into a real navigating row, and
    // "Notificações" keeps its placeholder until Phase 7 wires push (broken-windows 10).
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(1);
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
