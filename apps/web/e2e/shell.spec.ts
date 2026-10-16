import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { untilHydrated } from './hydration';

/** The bell's label comes from the catalog (07-01), never a literal. */
const BELL = notificationMessages.notifications.nav;
/** The back control of `/configuracoes` (2026-10-09: "Voltar", the previous screen). */
const SETTINGS_BACK = appMessages.app.settings.back;
/**
 * 07-03 (UI-D-253): with unseen rows the slot's accessible name carries its state after the plain
 * label ("Notificações, 2 novas"), so the name is the label alone or the label plus that suffix.
 */
const BELL_NAME = new RegExp(`^${BELL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, .+)?$`);

/** 08.5-11 (UI-D-423): the tab and slot names, from the catalogs. */
const CURSOS = coursesMessages.courses.nav;
const REELS = reelsMessages.reels.nav;

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
 * (D-40) and, since 05.3-01, `reels` a TAB at `nav.order: 30` (D-123, it requires `feed`).
 * **08.5-11 (D-401, D-419, UI-D-423):** `courses` spends the Cursos TAB at order 30 and Reels
 * declares `yieldsTabTo: ['courses']`, so on rede-demo (school on) the bar reads Início ·
 * Comunidades · Cursos · Eventos · Perfil and Reels is the LEFTMOST TopBar slot (the first row of
 * the rail's bottom group on desktop), before Loja, Notificações and Suporte. rede-lab (school off)
 * is the D-401 control: Início · Reels · Eventos · Perfil, exactly as before the phase. The two seed
 * tenants therefore differ HERE as well — which makes this assertion a second witness for the
 * module flags rather than the sameness it used to be. What still separates the two tenants in
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

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
    expect(await brandPrimary(page)).toBe(BRAND.demo.primary);
    // The logo (as-is, D-26) renders in the visible chrome (TopBar on the phone, rail on desktop)
    // only: the home column has no welcome block. The hidden tree's copy is not counted.
    await expect(
      page.locator(mobile ? 'header' : 'aside').locator('img[alt="Rede Demo"]'),
    ).toBeVisible();
    await expect(page.locator('main img[alt="Rede Demo"]')).toHaveCount(0);
    await expect(page.locator('img[alt="Rede Demo"]:visible')).toHaveCount(1);
    // PDF #1 (2026-10-02): with a logo the brand link shows the logo ALONE, the name is never drawn
    // beside it, and the link is named by the img's alt exactly once (it read "Rede Demo Rede Demo"
    // on the phone). The marker, not a[href="/inicio"]: in the rail that also matches the Início tab.
    const brandLink = page.locator(mobile ? 'header' : 'aside').locator('[data-shell-brand]');
    await expect(brandLink).toHaveAccessibleName(BRAND.demo.name);
    await expect(brandLink).not.toContainText(BRAND.demo.name);

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
    // 05-01 / 06-01 / 08.5-11: rede-demo has the `communities` (order 20), `courses` (order 30) and
    // `events` (order 40) tabs between the two kernel entries; `reels` (order 30 too) yields its tab
    // to Cursos (D-419) and is a slot instead. The lab case below reads Início · Reels · Eventos ·
    // Perfil — the difference is the communities and courses flags, rendered.
    expect(await navLinkNames(nav)).toEqual(['Início', 'Comunidades', CURSOS, 'Eventos', 'Perfil']);
    await expect(nav.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
    // The Reels door is the slot: in the TopBar on the phone, the rail's bottom group on desktop.
    await expect(nav.getByRole('link', { name: REELS })).toHaveCount(0);
    await expect(
      page.locator(mobile ? 'header[data-shell-topbar]' : 'aside').getByRole('link', {
        name: REELS,
        exact: true,
      }),
    ).toBeVisible();

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

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
    expect(await brandPrimary(page)).toBe(BRAND.lab.primary);

    const nav = visibleNav(page, mobile);
    // Scoped to the NAV: the lab feed carries 04-05's seeded link posts, whose auto-linked URLs are
    // links too — a page-wide count would read those as tabs and fail for the wrong reason.
    // 06-01: rede-lab has `events` on (D-17), so the Eventos tab sits after Reels (order 40).
    // 08.5-11 (D-401): the school is OFF here, so this bar is exactly the pre-08.5 one: Reels is
    // still a tab, no Cursos tab, and no Reels slot in the TopBar or the rail's bottom group.
    expect(await navLinkNames(nav)).toEqual(['Início', REELS, 'Eventos', 'Perfil']);
    await expect(page.locator('a[href="/cursos"]')).toHaveCount(0);
    await expect(
      page.locator(
        'header a[data-slot="reels"], [data-shell-nav="rail"] ~ div a[data-slot="reels"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator('header a[href="/reels"]')).toHaveCount(0);
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

  test('08.5-11 (UI-D-423, COURSE-16): on rede-demo the Cursos tab is current under /cursos, and the slots read Reels, Loja, Notificações, Suporte', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The slot row, in order: the TopBar's right group on the phone, the rail's bottom group on
    // desktop (EP-04: reels 1, store 5, notifications 10, chat 20).
    // The rail's tab rows carry `data-slot` too, so on desktop only the group AFTER the tab nav.
    const slotRow = page.locator(
      mobile
        ? 'header[data-shell-topbar] a[data-slot]'
        : '[data-shell-nav="rail"] ~ div a[data-slot]',
    );
    expect(
      await slotRow.evaluateAll((links) => links.map((a) => a.getAttribute('data-slot'))),
    ).toEqual(['reels', 'store', 'notifications', 'chat']);
    // Named by the catalogs (a count suffix after a comma is the slot's state, not its name).
    const names = await slotRow.evaluateAll((links) =>
      links.map((a) => (a.getAttribute('aria-label') ?? '').split(',')[0]),
    );
    expect(names).toEqual([REELS, storeMessages.store.nav, BELL, chatMessages.chat.nav]);

    // The Cursos tab takes you to /cursos and is the current tab there (UI-D-423 accent item 2).
    await page.goto(`${hosts.demo}/cursos`);
    const nav = visibleNav(page, mobile);
    await expect(nav.getByRole('link', { name: CURSOS })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Início' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    // The normal chrome there: the TopBar on the phone, the BottomNav not dark.
    if (mobile) {
      await expect(page.locator('header[data-shell-topbar]')).toBeVisible();
      await expect(page.locator('[data-shell-nav="bottom"]')).not.toHaveAttribute(
        'data-theme',
        'dark',
      );
    }
  });

  test('UI E01/overflow backstop (UI-D-423): at 320px the TopBar holds Reels, Loja, Notificações, Suporte and the avatar with gap-1, every slot and the home link at least 44px', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const bar = page.locator('header[data-shell-topbar]');
    await expect(bar).toBeVisible();
    const group = bar.locator('[data-shell-slots]');
    // Below 360px the right group's gap is gap-1 (4px); from 360px it is gap-3.
    expect(await group.evaluate((el) => getComputedStyle(el).columnGap)).toBe('4px');

    const slots = group.locator('a[data-slot]');
    expect(
      await slots.evaluateAll((links) => links.map((a) => a.getAttribute('data-slot'))),
    ).toEqual(['reels', 'store', 'notifications', 'chat']);
    const boxes = await slots.evaluateAll((links) =>
      links.map((a) => {
        const r = a.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, height: r.height };
      }),
    );
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320 + 0.5);
    }
    // The avatar link fits after the slots, inside the viewport.
    const avatar = bar.getByRole('link', { name: 'Meu perfil' });
    await expect(avatar).toBeVisible();
    const avatarBox = await avatar.boundingBox();
    if (!avatarBox) throw new Error('the avatar link has no box');
    expect(avatarBox.x + avatarBox.width).toBeLessThanOrEqual(320 + 0.5);
    // The home link keeps its 44px floor and never runs under the first slot.
    const home = await bar.locator('[data-shell-brand]').boundingBox();
    if (!home) throw new Error('the home link has no box');
    expect(home.width).toBeGreaterThanOrEqual(44);
    expect(home.x + home.width).toBeLessThanOrEqual((boxes[0]?.left ?? 0) + 0.5);
    // The page itself never scrolls sideways at 320px.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );

    await testInfo.attach('topbar-320', {
      body: await bar.screenshot(),
      contentType: 'image/png',
    });
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

  test('/perfil: e-mail, no role pill, Perfil tab current, TopBar avatar current on the phone; back from Configurações returns here', async ({
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
    const settings = page.getByRole('link', { name: 'Configurações' }).first();
    await untilHydrated(settings);
    await settings.click();
    await expect(page).toHaveURL(/\/configuracoes$/);

    // 2026-10-09: back returns to the screen the member came from (Perfil), not to Início. It is a
    // real step back through history: no entry is added, so the browser's forward goes to
    // Configurações again.
    const back = page.getByRole('link', { name: SETTINGS_BACK, exact: true });
    await untilHydrated(back);
    const entries = await page.evaluate(() => window.history.length);
    await back.click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perfil');
    expect(await page.evaluate(() => window.history.length)).toBe(entries);
    await page.goForward();
    await expect(page).toHaveURL(/\/configuracoes$/);
  });

  test('/configuracoes opened directly: back falls back to Perfil, its parent on the phone', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configurações');

    // Nothing of the app is behind a page opened by its address: the link's own href, the fallback.
    const back = page.getByRole('link', { name: SETTINGS_BACK, exact: true });
    await expect(back).toHaveAttribute('href', '/perfil');
    await untilHydrated(back);
    await back.click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perfil');
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
