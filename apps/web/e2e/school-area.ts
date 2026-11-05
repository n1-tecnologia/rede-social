import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 2026-10-22 — the courses area's screens are pages of their own (the social-igoralves members area),
 * reached from the shell's AREA MENU instead of the tabs that sat under the old "Cursos" title. On a
 * phone the TopBar names the area ("· Membros", in `[data-shell-area="courses"]`) and its menu
 * button ("Menu de Membros") opens a panel whose screen rows are `[data-area-menu-screens]`; from
 * `md` up the TopBar is hidden and the same screens are the desktop rail's sub-rows under the tab
 * (`[data-rail-area="courses"]`, named "Menu de Membros"). The current screen is
 * `aria-current="page"` in both, matched by path (the query is ignored). These helpers hide the two
 * roads: a spec asks for a screen by its label and the helper takes the right one for the project's
 * viewport.
 *
 * 2026-10-23: ONE menu for every role. The admin's "· Cursos" area is gone; a manager reads the same
 * "· Membros" with a last row "Gerenciar" (`/cursos/gerenciar`, current on the management lists too).
 */

export type SchoolMenu = 'Membros';

/** The rail replaces the TopBar from `md` (768px) up. */
export function hasDesktopRail(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 768;
}

/** The area label next to the tenant name in the phone's TopBar ("· Membros"). */
export function schoolAreaLabel(page: Page): Locator {
  return page.locator('[data-shell-area="courses"]');
}

/**
 * The container of the area's screen rows: the rail's sub-list on a desktop, the open menu panel's
 * list on a phone (the menu is opened first, once).
 */
export async function schoolScreenList(page: Page, menu: SchoolMenu = 'Membros'): Promise<Locator> {
  if (hasDesktopRail(page)) {
    const rail = page.locator('[data-rail-area="courses"]');
    await expect(rail).toHaveAttribute('aria-label', `Menu de ${menu}`);
    return rail;
  }
  const button = page.getByRole('button', { name: `Menu de ${menu}`, exact: true });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const list = page.locator('[data-area-menu-screens]');
  await expect(list).toBeVisible();
  return list;
}

/** Closes the phone menu again (a no-op on a desktop, where the rail is always there). */
export async function closeSchoolMenu(page: Page, menu: SchoolMenu = 'Membros'): Promise<void> {
  if (hasDesktopRail(page)) return;
  const button = page.getByRole('button', { name: `Menu de ${menu}`, exact: true });
  if ((await button.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  }
}

/** The labels of the area's screens, in menu order. */
export async function schoolScreenLabels(
  page: Page,
  menu: SchoolMenu = 'Membros',
): Promise<string[]> {
  const list = await schoolScreenList(page, menu);
  const labels = (await list.getByRole('link').allInnerTexts()).map((text) => text.trim());
  await closeSchoolMenu(page, menu);
  return labels;
}

/** The label of the screen the menu marks as current (`aria-current="page"`), or null. */
export async function currentSchoolScreen(
  page: Page,
  menu: SchoolMenu = 'Membros',
): Promise<string | null> {
  const list = await schoolScreenList(page, menu);
  const current = list.locator('a[aria-current="page"]');
  const label = (await current.count()) > 0 ? (await current.first().innerText()).trim() : null;
  await closeSchoolMenu(page, menu);
  return label;
}

/** The link of the screen named `label` (the menu is opened on a phone). */
export async function schoolScreenLink(
  page: Page,
  label: string,
  menu: SchoolMenu = 'Membros',
): Promise<Locator> {
  const list = await schoolScreenList(page, menu);
  return list.getByRole('link', { name: label, exact: true });
}

/** Opens the screen named `label` through the area menu and, with `url`, waits for its address. */
export async function goToSchoolScreen(
  page: Page,
  label: string,
  { menu = 'Membros', url }: { menu?: SchoolMenu; url?: RegExp } = {},
): Promise<void> {
  const link = await schoolScreenLink(page, label, menu);
  await link.click();
  if (url) await expect(page).toHaveURL(url);
}
