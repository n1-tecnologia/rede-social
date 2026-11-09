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
import coursesMemberMessages from '../messages/pt-BR/courses.member.json' with { type: 'json' };
import eventsMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import notificationMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import reelsMessages from '../messages/pt-BR/reels.json' with { type: 'json' };
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { untilHydrated } from './hydration';
import {
  closeSchoolMenu,
  currentSchoolScreen,
  schoolAreaLabel,
  schoolScreenLabels,
  schoolScreenList,
} from './school-area';
import {
  closeStoreMenu,
  currentStoreScreen,
  storeAreaLabel,
  storeMenuLabels,
  storeScreenLabels,
  storeScreenList,
} from './store-area';

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
const MEMBROS = coursesMessages.courses.memberNav;
const REELS = reelsMessages.reels.nav;
/**
 * 2026-10-22 (the courses area redesign): the school's AREA, the member's "· Membros" (five
 * screens), and the Eventos area it must leave as it was. 2026-10-23: the admin's "· Cursos" area is
 * gone; a manager reads the same "· Membros" with a last row, "Gerenciar" (`MANAGE`).
 */
const MEMBER_AREA = coursesMemberMessages.courses.member.area;
const MANAGE = coursesMessages.courses.manage.title;
const EVENTS_AREA = eventsMessages.events.area;
/** 2026-10-24: the store's area, "· Loja", owned by its TopBar slot (`store-area.ts`). */
const STORE_AREA = storeMessages.store.area;
const MEMBER_SCREENS = [
  MEMBER_AREA.screens.home,
  MEMBER_AREA.screens.courses,
  MEMBER_AREA.screens.tracks,
  MEMBER_AREA.screens.lives,
  MEMBER_AREA.screens.progress,
];

/**
 * The bell slot in whichever chrome is visible: the TopBar on the phone, the desktop header's
 * shortcuts on desktop (the rail's bottom group until 2026-10-26).
 */
const bellSlot = (page: Page) =>
  page.locator('header a[href="/notificacoes"]').filter({ visible: true });

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
 * declares `yieldsTabTo: ['courses']`, which says the row is full while the school is on.
 * **2026-10-23:** a full row no longer moves Reels to the TopBar: Reels KEEPS its tab and the kernel
 * Perfil turns rail-only. On rede-demo (school on) the phone's BottomNav reads Início · Comunidades
 * · Cursos (Membros for a member) · Reels · Eventos, with Perfil's door the TopBar avatar beside Loja,
 * Notificações and Suporte; the desktop rail reads the same tabs plus Perfil, and the desktop
 * shortcuts (the rail's bottom group, the desktop header's since 2026-10-26) have no Reels.
 * rede-lab (school off) is the D-401 control: Início · Reels · Eventos · Perfil on
 * both chromes, exactly as before the phase. The two seed
 * tenants therefore differ HERE as well — which makes this assertion a second witness for the
 * module flags rather than the sameness it used to be. What still separates the two tenants in
 * every other respect is what the rest of this file measures: the brand token, the logo, the
 * display name, and the fact that neither tenant's brand ever appears in the other's HTML
 * (TENANT-02 adjacency).
 *
 * **2026-10-22 (the courses area redesign):** the school is an AREA, as Eventos is. Each of its
 * screens is a page of its own, named "· Membros" beside the logo on the phone, where the TopBar's
 * right side becomes the area's menu, and listed under the tab on the desktop rail, whose current
 * row is the screen's own (the tab stays plain on a screen and is current on the shared detail
 * routes). 2026-10-23: one menu for every role, a manager's ending with "Gerenciar" (current on the
 * hub and the management lists). The cases after the 08.5-11 one pin the member's five screens, the
 * manager's menu, and an Eventos area left as it was. The seeded
 * member never started a lesson, so their Início (/area-membros) lands on the catalogue
 * (/area-membros/cursos): Início appears from the first lesson on, and a preview never moves.
 *
 * **2026-10-24 (the Loja area):** a TopBar SLOT may own an area too, on the pages no tab claims: the
 * store's "· Loja" (Produtos, Comprados and a manager's Gerenciar). Inside `/loja*` the phone's
 * TopBar names it and folds into its menu, whose shortcuts leave the Loja out; the desktop rail lists
 * the screens right under the Loja row (Principal), never among the desktop header's shortcuts
 * (the rail's Atalhos until 2026-10-26). Outside the store the
 * slot row is exactly as before.
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

/**
 * 2026-10-23 (the grouped desktop rail): the phone's tab names as the rail reads them — the home tab
 * is "Feed" while the feed module is on, Perfil lives in the desktop account menu (the rail's account
 * card, the desktop header's since 2026-10-26), not the rail's tabs, and with the store on the Loja
 * closes the rail's navigation (the phone keeps it a TopBar slot).
 */
function navFor(
  mobile: boolean,
  labels: string[],
  { feed = true, store = false }: { feed?: boolean; store?: boolean } = {},
) {
  if (mobile) return labels;
  return [
    ...labels
      .filter((label) => label !== 'Perfil')
      .map((label) => (feed && label === 'Início' ? 'Feed' : label)),
    ...(store ? [storeMessages.store.nav] : []),
  ];
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
  test('rede-demo: logo, brand, Início · Perfil (2026-10-23: Perfil on the rail only, the TopBar avatar on the phone), the feed home slot, one tree visible', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
    expect(await brandPrimary(page)).toBe(BRAND.demo.primary);
    // The logo (as-is, D-26) renders in the visible chrome (TopBar on the phone, rail on desktop,
    // beside the brand's mark, shown once the collapsed rail opens) only: the home column has no
    // welcome block. The hidden tree's copy is not counted.
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
    // 05-01 / 06-01 / 08.5-11: rede-demo has the `communities` (order 20), `courses` and `reels`
    // (order 30 both, key order puts Cursos first) and `events` (order 40) tabs between the two
    // kernel entries. 2026-10-23: the row is full (Reels declares `yieldsTabTo: ['courses']`), so
    // Reels keeps its tab and Perfil is the rail's alone: the phone's BottomNav ends at Eventos. The
    // lab case below reads Início · Reels · Eventos · Perfil — the difference is the communities and
    // courses flags, rendered. The store is on here, so the desktop rail ends at the Loja.
    expect(await navLinkNames(nav)).toEqual(
      navFor(mobile, ['Início', 'Comunidades', MEMBROS, REELS, 'Eventos'], { store: true }),
    );
    await expect(nav.getByRole('link', { name: mobile ? 'Início' : 'Feed' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The Reels door is its tab, on both chromes; no Reels slot in the TopBar or the desktop
    // shortcuts any more (2026-10-23).
    await expect(nav.getByRole('link', { name: REELS, exact: true })).toBeVisible();
    await expect(
      page.locator('header a[data-slot="reels"], [data-shell-shortcuts] a[data-slot="reels"]'),
    ).toHaveCount(0);
    // Perfil's door on the phone is the TopBar avatar; on desktop it is the account menu ("Ver
    // perfil"), never one of the tabs: the rail's account card at its foot from 2026-10-23, the
    // desktop header's account button since 2026-10-26.
    if (mobile) {
      await expect(page.locator('header[data-shell-topbar] a[href="/perfil"]')).toBeVisible();
    } else {
      await expect(nav.locator('a[href="/perfil"]')).toHaveCount(0);
      await expect(
        page.locator('header[data-shell-header]').getByRole('button', { name: 'Menu da conta' }),
      ).toBeVisible();
    }

    // 07-01 (D-40, UI-D-268): rede-demo has notifications ON, so the bell is a TopBar slot on the
    // phone and one of the desktop header's shortcuts on desktop (2026-10-26), OUTSIDE the tab tree
    // above (the tab list is unchanged). Exactly one copy is visible.
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
    // still a tab, no Cursos tab, and no Reels slot in the TopBar or the desktop shortcuts. The
    // row is not full, so Perfil stays in the phone's BottomNav too (2026-10-23).
    expect(await navLinkNames(nav)).toEqual(navFor(mobile, ['Início', REELS, 'Eventos', 'Perfil']));
    await expect(page.locator('a[href="/cursos"]')).toHaveCount(0);
    await expect(
      page.locator('header a[data-slot="reels"], [data-shell-shortcuts] a[data-slot="reels"]'),
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

  test("08.5-11 (UI-D-423, COURSE-16): on rede-demo the member's Membros tab goes to /area-membros and holds it and /cursos (2026-10-22: on the desktop rail the screen's own row is the current one), and the slots read Loja, Notificações, Suporte (2026-10-23: Reels is a tab again)", async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The slot row, in order: the TopBar's right group on the phone (EP-04: store 5, notifications
    // 10, chat 20). 2026-10-23: Reels keeps its tab beside Cursos, so it is no longer a slot. On
    // desktop (the grouped rail) the Loja is the LAST row of Principal, the rail's navigation, and
    // the other two are the desktop header's shortcuts (the Atalhos at the rail's foot until
    // 2026-10-26); the rail comes first in the DOM, so DOM order reads the same three.
    // The rail's tab rows carry `data-slot` too, so on desktop only the store's row of the nav.
    const slotRow = page.locator(
      mobile
        ? 'header[data-shell-topbar] a[data-slot]'
        : '[data-shell-nav="rail"] a[data-slot="store"], [data-shell-shortcuts] a[data-slot]',
    );
    expect(
      await slotRow.evaluateAll((links) => links.map((a) => a.getAttribute('data-slot'))),
    ).toEqual(['store', 'notifications', 'chat']);
    // Named by the catalogs (a count suffix after a comma is the slot's state, not its name).
    const names = await slotRow.evaluateAll((links) =>
      links.map((a) => (a.getAttribute('aria-label') ?? '').split(',')[0]),
    );
    expect(names).toEqual([storeMessages.store.nav, BELL, chatMessages.chat.nav]);
    if (!mobile) {
      await expect(page.locator('[data-shell-nav="rail"] a[data-slot]').last()).toHaveAttribute(
        'data-slot',
        'store',
      );
      await expect(page.locator('[data-shell-shortcuts] a[data-slot="store"]')).toHaveCount(0);
    }

    // The member's school tab (quick 261019-k7x) is Membros: it takes you to /area-membros and holds
    // it (UI-D-423 accent item 2). 2026-10-22: the school is an AREA now, so the phone's bottom bar
    // still marks the TAB, while the desktop rail marks the screen's own row under it (as /eventos
    // always did) and leaves the tab plain. And the seeded member never started a lesson, so
    // /area-membros sends them on to the catalogue (Início appears from the first lesson on) ...
    await page.goto(`${hosts.demo}/area-membros`);
    await expect(page).toHaveURL(/\/area-membros\/cursos$/);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'cursos',
    );
    const nav = visibleNav(page, mobile);
    const tab = nav.getByRole('link', { name: MEMBROS });
    await expect(tab).toHaveAttribute('href', '/area-membros');
    if (mobile) await expect(tab).toHaveAttribute('aria-current', 'page');
    else await expect(tab).not.toHaveAttribute('aria-current', 'page');
    expect(await currentSchoolScreen(page)).toBe(MEMBER_AREA.screens.courses);
    // The KERNEL Início tab, by its href: the area's first row on the rail is named "Início" too.
    await expect(nav.locator('a[href="/inicio"]')).not.toHaveAttribute('aria-current', 'page');
    // ... and it stays current on the detail routes shared with the admin: the course not-found
    // boundary renders inside the shell for a well-formed unknown id, no fixture needed. No screen
    // of the area is this page, so the tab itself is the current one on both chromes.
    await page.goto(`${hosts.demo}/cursos/00000000-0000-4000-8000-000000000000`);
    await expect(nav.getByRole('link', { name: MEMBROS })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('a[href="/inicio"]')).not.toHaveAttribute('aria-current', 'page');
    expect(await currentSchoolScreen(page)).toBeNull();
    // The normal chrome there: the TopBar on the phone (still the member's "· Membros" area), the
    // BottomNav not dark.
    if (mobile) {
      await expect(page.locator('header[data-shell-topbar]')).toBeVisible();
      await expect(schoolAreaLabel(page)).toHaveText(`· ${MEMBER_AREA.label}`);
      await expect(page.locator('[data-shell-nav="bottom"]')).not.toHaveAttribute(
        'data-theme',
        'dark',
      );
    }
  });

  test('2026-10-22 (the courses area redesign): every member screen is a page of its own under the Membros tab, named "· Membros" on the phone, one row of its menu (the desktop rail\'s sub-list), with one h1', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // [the address opened, where it lands, the current row]. The seeded member never started a
    // lesson, so Início (/area-membros) lands on the catalogue: Início appears from the first lesson
    // on (2026-10-22), and only outside a preview.
    const screens: ReadonlyArray<readonly [string, string, string]> = [
      ['/area-membros', '/area-membros/cursos', MEMBER_AREA.screens.courses],
      ['/area-membros/cursos', '/area-membros/cursos', MEMBER_AREA.screens.courses],
      ['/area-membros/trilhas', '/area-membros/trilhas', MEMBER_AREA.screens.tracks],
      ['/area-membros/lives', '/area-membros/lives', MEMBER_AREA.screens.lives],
      ['/area-membros/progresso', '/area-membros/progresso', MEMBER_AREA.screens.progress],
    ];
    for (const [path, landing, label] of screens) {
      await page.goto(`${hosts.demo}${path}`);
      await expect(page).toHaveURL(new RegExp(`${landing}$`));
      if (mobile) {
        await expect(visibleNav(page, true).getByRole('link', { name: MEMBROS })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(schoolAreaLabel(page)).toHaveText(`· ${MEMBER_AREA.label}`);
        // Inside the area the TopBar's right side IS the area's menu: no slot row beside it.
        await expect(page.locator('header[data-shell-topbar] [data-shell-slots]')).toHaveCount(0);
      }
      expect(await schoolScreenLabels(page)).toEqual(MEMBER_SCREENS);
      expect(await currentSchoolScreen(page)).toBe(label);
      // One h1 per page: the screen's title, or on Início the greeting.
      await expect(page.locator('main.app-scroll h1')).toHaveCount(1);
    }
  });

  test('2026-10-23: the admin reads the member\'s "· Membros" under the Membros tab, with Gerenciar last and current on the hub and the management lists; in the member area every member row keeps the preview', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    const management = [
      '/cursos/gerenciar',
      '/cursos',
      '/cursos/trilhas',
      '/cursos/lives',
      '/cursos/categorias',
    ];
    for (const path of management) {
      await page.goto(`${hosts.demo}${path}`);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      if (mobile) {
        await expect(visibleNav(page, true).getByRole('link', { name: MEMBROS })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(schoolAreaLabel(page)).toHaveText(`· ${MEMBER_AREA.label}`);
      }
      expect(await schoolScreenLabels(page)).toEqual([...MEMBER_SCREENS, MANAGE]);
      expect(await currentSchoolScreen(page)).toBe(MANAGE);
    }

    // The member area, the same tab and menu: every member row keeps the preview (`ver=aluno`), so
    // the menu never drops the manager out of it, and Gerenciar leads back to authoring.
    await page.goto(`${hosts.demo}/area-membros?ver=aluno`);
    await expect(page).toHaveURL(/\/area-membros\?ver=aluno$/);
    if (mobile) {
      await expect(visibleNav(page, true).getByRole('link', { name: MEMBROS })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(schoolAreaLabel(page)).toHaveText(`· ${MEMBER_AREA.label}`);
    }
    const rows = (await schoolScreenList(page)).getByRole('link');
    expect(await rows.evaluateAll((links) => links.map((a) => a.getAttribute('href')))).toEqual([
      '/area-membros?ver=aluno',
      '/area-membros/cursos?ver=aluno',
      '/area-membros/trilhas?ver=aluno',
      '/area-membros/lives?ver=aluno',
      '/area-membros/progresso?ver=aluno',
      '/cursos/gerenciar',
    ]);
    await closeSchoolMenu(page);
    expect(await currentSchoolScreen(page)).toBe(MEMBER_AREA.screens.home);
  });

  test('2026-10-22: the Eventos area is as it was beside the courses one: "· Eventos", its four screens and the list current on /eventos', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);

    let list: Locator;
    if (mobile) {
      await expect(page.locator('[data-shell-area="events"]')).toHaveText(`· ${EVENTS_AREA.label}`);
      await page.getByRole('button', { name: EVENTS_AREA.menu, exact: true }).click();
      list = page.locator('[data-area-menu-screens]');
    } else {
      // The rail's sub-list is named by the area's menu label since 2026-10-22, Eventos included.
      list = page.locator('[data-rail-area="events"]');
      await expect(list).toHaveAttribute('aria-label', EVENTS_AREA.menu);
    }
    await expect(list.getByRole('link')).toHaveText([
      EVENTS_AREA.screens.events,
      EVENTS_AREA.screens.photos,
      EVENTS_AREA.screens.checkin,
      EVENTS_AREA.screens.mine,
    ]);
    await expect(list.locator('a[aria-current="page"]')).toHaveText(EVENTS_AREA.screens.events);
    // The school's area never leaks here, nor the store's (2026-10-24: a slot's area holds only on
    // the pages no tab claims).
    await expect(
      page.locator('[data-shell-area="courses"], [data-rail-area="courses"]'),
    ).toHaveCount(0);
    const storeArea = page.locator('[data-shell-area="store"], [data-rail-area="store"]');
    await expect(storeArea).toHaveCount(0);
  });

  test('2026-10-24: the Loja is an area ("· Loja") for the member and the admin: the phone\'s TopBar names it and folds into its menu, whose shortcuts never repeat the Loja; the desktop rail lists its screens right under the Loja row; a product page marks no screen', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    const storeRow = page.locator('[data-shell-nav="rail"] a[data-slot="store"]');
    for (const { email, manager } of [
      { email: users.demoMember, manager: false },
      { email: users.demoAdmin, manager: true },
    ]) {
      await page.context().clearCookies();
      await login(page, email, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/loja`);
      await expect(
        page.getByRole('heading', { level: 1, name: storeMessages.store.list.title, exact: true }),
      ).toBeVisible();

      if (mobile) {
        const bar = page.locator('header[data-shell-topbar]');
        await expect(storeAreaLabel(page)).toHaveText(`· ${STORE_AREA.label}`);
        // The bar's right side IS the area's menu: no slot row and no slot beside it.
        await expect(bar.locator('[data-shell-slots]')).toHaveCount(0);
        await expect(bar.locator('a[data-slot]')).toHaveCount(0);
        // The open menu: the screens, a divider, then the OTHER slots and the profile. The Loja slot
        // owns the area, so it is not one of the shortcuts (Produtos is its page).
        await storeScreenList(page);
        const shortcuts = bar.locator('[data-area-menu-panel] ul:not([data-area-menu-screens]) a');
        expect(
          await shortcuts.evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
        ).toEqual(['/notificacoes', '/suporte', '/perfil']);
        await closeStoreMenu(page);
      } else {
        // Under Principal, the screens right after the Loja row; the row gives its highlight up to
        // the screen that IS this page.
        const screensUnderRow =
          '[data-shell-nav="rail"] a[data-slot="store"] + ul[data-rail-area="store"]';
        await expect(page.locator(screensUnderRow)).toHaveCount(1);
        await expect(storeRow).not.toHaveAttribute('aria-current', 'page');
        // Nothing extra among the desktop header's shortcuts (2026-10-26, the rail's Atalhos
        // before): Notificações and Suporte, and no list of screens.
        const shortcuts = page.locator('header[data-shell-header] [data-shell-shortcuts]');
        expect(
          await shortcuts
            .locator('a')
            .evaluateAll((links) => links.map((a) => a.getAttribute('data-slot'))),
        ).toEqual(['notifications', 'chat']);
        await expect(shortcuts.locator('[data-rail-area]')).toHaveCount(0);
      }
      expect(await storeScreenLabels(page)).toEqual(storeMenuLabels({ manager }));
      expect(await currentStoreScreen(page)).toBe(STORE_AREA.screens.products);

      // A product page (the store's not-found card for a well-formed unknown id, so no fixture is
      // needed): still the area, no screen current, and on the rail the Loja row is current again.
      await page.goto(`${hosts.demo}/loja/00000000-0000-4000-8000-000000000000`);
      await expect(page.getByTestId('store-not-found')).toBeVisible();
      if (mobile) await expect(storeAreaLabel(page)).toHaveText(`· ${STORE_AREA.label}`);
      else await expect(storeRow).toHaveAttribute('aria-current', 'page');
      expect(await currentStoreScreen(page)).toBeNull();
    }
  });

  test('2026-10-26: on the desktop a 64px header over the content column names the page and holds the shortcuts and the account menu, which drops down; the page scrolls below it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the header is the desktop chrome');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    const header = page.locator('header[data-shell-header]');
    await expect(header).toBeVisible();
    // The page's name, from the nav: the home tab under its desktop name. Plain text, never a
    // heading: the page keeps its one h1.
    const title = header.locator('[data-shell-header-title]');
    await expect(title).toHaveText('Feed');
    await expect(header.getByRole('heading')).toHaveCount(0);
    // Right of the 72px rail (collapsed, opening over the page on hover), 64px tall, as tall as the rail's brand
    // band. 2026-10-26 (Instagram's chrome): the scroll root starts at the top too, UNDER the header,
    // so the page scrolls beneath it; the header has no ground until it does, then blurs it.
    const box = await header.boundingBox();
    const band = await page.locator('aside [data-shell-brand]').locator('..').boundingBox();
    const scroller = await page.locator('main.app-scroll').boundingBox();
    if (!box || !band || !scroller) throw new Error('the desktop chrome has no box');
    expect(box.x).toBe(72);
    expect(box.y).toBe(0);
    expect(box.height).toBe(64);
    expect(band.height).toBe(64);
    expect(scroller.y).toBe(0);
    expect(scroller.x).toBe(72);
    await expect(header).not.toHaveAttribute('data-scrolled');
    await page.locator('main.app-scroll').evaluate((el) => el.scrollTo(0, 400));
    await expect(header).toHaveAttribute('data-scrolled', 'true');
    await page.locator('main.app-scroll').evaluate((el) => el.scrollTo(0, 0));
    await expect(header).not.toHaveAttribute('data-scrolled');

    // The shortcuts the rail used to hold at its foot, then the account button; the rail keeps
    // no shortcut and no account.
    const shortcuts = header.locator('[data-shell-shortcuts]');
    expect(
      await shortcuts
        .locator('a[data-slot]')
        .evaluateAll((links) => links.map((a) => a.getAttribute('data-slot'))),
    ).toEqual(['notifications', 'chat']);
    await expect(
      page.locator('aside [data-shell-shortcuts], aside [data-shell-account]'),
    ).toHaveCount(0);
    const account = header.getByRole('button', { name: 'Menu da conta' });
    await untilHydrated(account);
    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('[data-shell-account-menu]');
    await expect(menu).toBeVisible();
    // It drops DOWN from the header, right-aligned under the button.
    const menuBox = await menu.boundingBox();
    const accountBox = await account.boundingBox();
    if (!menuBox || !accountBox) throw new Error('the account menu has no box');
    expect(menuBox.y).toBeGreaterThanOrEqual(accountBox.y + accountBox.height);
    expect(Math.abs(menuBox.x + menuBox.width - (accountBox.x + accountBox.width))).toBeLessThan(1);
    await expect(menu.getByRole('link', { name: 'Ver perfil' })).toHaveAttribute('href', '/perfil');
    await expect(menu.getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'href',
      '/configuracoes',
    );
    await expect(menu.getByRole('switch', { name: 'Tema' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sair' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await expect(account).toBeFocused();
    await expect(menu).toHaveCount(0);

    // Inside an area the header names the screen that IS the page.
    await page.goto(`${hosts.demo}/eventos/fotos`);
    await expect(title).toHaveText(EVENTS_AREA.screens.photos);
  });

  test("UI E01/overflow backstop (UI-D-423): at 320px the TopBar holds Loja, Notificações, Suporte and the avatar (2026-10-23: no Reels slot, the avatar is Perfil's door) with gap-1, every slot and the home link at least 44px", async ({
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
    ).toEqual(['store', 'notifications', 'chat']);
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
    // The avatar link fits after the slots, inside the viewport. It is Perfil's door on the phone
    // (2026-10-23: rede-demo's BottomNav draws no Perfil tab).
    const avatar = bar.getByRole('link', { name: 'Meu perfil' });
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute('href', '/perfil');
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

      // The desktop chrome also carries the toggle, in step with the settings row: a row of the
      // account menu (the rail's account card from 2026-10-23, the desktop header's account button
      // since 2026-10-26), so the menu opens first.
      if (!mobile) {
        const account = page
          .locator('header[data-shell-header]')
          .getByRole('button', { name: 'Menu da conta' });
        await untilHydrated(account);
        await account.click();
        await expect(
          page.locator('[data-shell-account-menu]').getByRole('switch', { name: 'Tema' }),
        ).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');
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

  test("/perfil: e-mail, no role pill, the desktop account menu's Ver perfil current on the desktop (the header's since 2026-10-26), TopBar avatar current on the phone (2026-10-23: no Perfil tab in rede-demo's BottomNav); back from Configurações returns here", async ({
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
    await expect(nav.getByRole('link', { name: mobile ? 'Início' : 'Feed' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    if (mobile) {
      // 2026-10-23: rede-demo's row is full (the school is on), so Perfil is a rail-only tab: the
      // phone's BottomNav draws no Perfil and marks no tab here, and the TopBar avatar is current.
      await expect(nav.locator('a[href="/perfil"]')).toHaveCount(0);
      await expect(nav.locator('a[aria-current="page"]')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Meu perfil' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    } else {
      // 2026-10-23: Perfil is the account menu's (the rail's account card, the desktop header's
      // account button since 2026-10-26): its "Ver perfil" is the current page here, the header
      // names the page, and the tabs mark none.
      await expect(nav.locator('a[aria-current="page"]')).toHaveCount(0);
      await expect(page.locator('header[data-shell-header] [data-shell-header-title]')).toHaveText(
        'Perfil',
      );
      const account = page
        .locator('header[data-shell-header]')
        .getByRole('button', { name: 'Menu da conta' });
      await untilHydrated(account);
      await account.click();
      await expect(page.getByRole('link', { name: 'Ver perfil' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await page.keyboard.press('Escape');
      await expect(account).toHaveAttribute('aria-expanded', 'false');
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
