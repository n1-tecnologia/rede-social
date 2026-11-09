import { expect, type Locator, type Page } from '@playwright/test';
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import { untilHydrated } from './hydration';

/**
 * 2026-10-24 — the Loja is an AREA ("· Loja"), owned by its TopBar slot (the kernel's `activeArea`
 * falls back to the slots on the pages no tab claims), with a page per screen: Produtos (`/loja`),
 * Comprados (`/loja/comprados`) and, for a manager, Gerenciar (`/loja/gerenciar`, its archived list
 * at `?filtro=arquivados`). On a phone, inside `/loja*`, the TopBar names the area beside the logo
 * (`[data-shell-area="store"]`) and its right side is the area's sandwich menu (the button "Menu da
 * Loja", in `[data-area-menu="store"]`): the screens (`[data-area-menu-screens]`), a divider, then the
 * OTHER slots and "Meu perfil" (the Loja slot owns the area, so it is not repeated there). From `md`
 * up the TopBar is hidden and the same screens are the desktop rail's sub-rows right under the Loja
 * row (`a[data-slot="store"] + ul[data-rail-area="store"]`, named "Menu da Loja"), drawn only inside
 * `/loja*`. The current screen is `aria-current="page"` in both, matched by the EXACT path (the query
 * is ignored), so a product page (`/loja/{id}`) marks no screen and the rail's Loja row stays the
 * current one there.
 *
 * These helpers hide the two roads, as `school-area.ts` does for the courses area: a spec asks for a
 * screen by its label and the helper takes the right one for the page's viewport (so a case that
 * narrows a phone to 320px still reads the phone's menu). The copy is the catalog's (`store.area`),
 * never a literal.
 */

const AREA = storeMessages.store.area;

/** The rail replaces the TopBar from `md` (768px) up. */
function onDesktopRail(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 768;
}

/** The menu's rows, in order: Produtos and Comprados for every role, then a manager's Gerenciar. */
export function storeMenuLabels({ manager = false }: { manager?: boolean } = {}): string[] {
  const browse = [AREA.screens.products, AREA.screens.owned];
  return manager ? [...browse, AREA.screens.manage] : browse;
}

/** The area label next to the tenant's logo in the phone's TopBar ("· Loja"). */
export function storeAreaLabel(page: Page): Locator {
  return page.locator('[data-shell-area="store"]');
}

/** The phone's sandwich button ("Menu da Loja"); the TopBar draws it inside the store only. */
export function storeMenuButton(page: Page): Locator {
  return page
    .locator('[data-area-menu="store"]')
    .getByRole('button', { name: AREA.menu, exact: true });
}

/**
 * The container of the area's screen rows: the rail's sub-list on a desktop, the open menu panel's
 * list on a phone (the menu is opened first, once hydrated: a click before that would be lost).
 */
export async function storeScreenList(page: Page): Promise<Locator> {
  if (onDesktopRail(page)) {
    const rail = page.locator('[data-rail-area="store"]');
    await expect(rail).toHaveAttribute('aria-label', AREA.menu);
    return rail;
  }
  const button = storeMenuButton(page);
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await untilHydrated(button);
    await button.click();
  }
  const list = page.locator('[data-area-menu="store"] [data-area-menu-screens]');
  await expect(list).toBeVisible();
  return list;
}

/** Closes the phone menu again (a no-op on a desktop, where the rail is always there). */
export async function closeStoreMenu(page: Page): Promise<void> {
  if (onDesktopRail(page)) return;
  const button = storeMenuButton(page);
  if ((await button.count()) === 0) return;
  if ((await button.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  }
}

/** The labels of the area's screens, in menu order. */
export async function storeScreenLabels(page: Page): Promise<string[]> {
  const list = await storeScreenList(page);
  const labels = (await list.getByRole('link').allInnerTexts()).map((text) => text.trim());
  await closeStoreMenu(page);
  return labels;
}

/** The label of the screen the menu marks as current (`aria-current="page"`), or null. */
export async function currentStoreScreen(page: Page): Promise<string | null> {
  const list = await storeScreenList(page);
  const current = list.locator('a[aria-current="page"]');
  const label = (await current.count()) > 0 ? (await current.first().innerText()).trim() : null;
  await closeStoreMenu(page);
  return label;
}

/** The link of the screen named `label` (the menu is opened on a phone and left open). */
export async function storeScreenLink(page: Page, label: string): Promise<Locator> {
  const list = await storeScreenList(page);
  return list.getByRole('link', { name: label, exact: true });
}

/** Opens the screen named `label` through the area menu and, with `url`, waits for its address. */
export async function goToStoreScreen(page: Page, label: string, url?: RegExp): Promise<void> {
  const link = await storeScreenLink(page, label);
  await link.click();
  if (url) await expect(page).toHaveURL(url);
}
