import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  deleteHighlightsByTitlePrefix,
  insertHighlightFixture,
} from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { untilHydrated } from './hydration';
import {
  closeStoreAdmin,
  createProduct,
  deleteCommunitiesByPrefix,
  deleteProductsByPrefix,
} from './store-admin';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const S = storeMessages.store;
const H = storiesMessages.stories.highlights;
const P = S.form.communities.permissions;

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/**
 * 11.1-13 (UI-D-883, UI-D-886, UI-D-887, BPERM-20, BPERM-24): the administrator's side of the buyer
 * permissions, as one walk: the five boxes under a product's community, then the community's highlight
 * screen with the "Aberto a compradores" switch and the neutral "Compradores" mark.
 *
 * **WRITTEN FOR THE OWNER TO RUN.** The phase's agents only ever `playwright test --list` this file (the
 * full e2e takes about 1.5 h and fills the disk); the ledger rows that depend on it are Igor's. It type
 * checks and lints, and it follows `store.spec.ts`: every row is a fixture written through
 * `store-admin.ts` / `admin.ts`, prefixed per run and project, and removed in `afterAll`.
 *
 * It runs at 390 px (the iPhone 14 preset of `mobile-chromium`) and then at 320 px, and once at the
 * desktop project's own viewport. `serviceWorkers: 'block'`: a worker answering navigations from its
 * cache would have these assertions read what a previous run left behind (the 03-05 lesson).
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'mobile-chromium';
}

/** The widths one case walks: the phone preset's 390, then the narrowest phone; desktop keeps its own. */
function widths(testInfo: TestInfo): (number | null)[] {
  return isMobile(testInfo) ? [390, 320] : [null];
}

async function resize(page: Page, width: number | null): Promise<void> {
  if (width !== null) await page.setViewportSize({ width, height: 844 });
}

/** True when the document scrolls sideways — nothing here may. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.describe('buyer permissions, the administrator', () => {
  test.skip(isRemote, 'the fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let highlightPrefix = '';
  const names = { community: '', product: '', highlight: '' };
  const ids = { community: '', product: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    const project = testInfo.project.name;
    prefix = `e2e-bpa-${project}-${run}`;
    // The highlight title is capped at 50 characters, so it carries a shorter prefix of its own.
    highlightPrefix = `e2e-bpa-${isMobile(testInfo) ? 'm' : 'd'}-${run}`;
    await deleteHighlightsByTitlePrefix('rede-demo', `e2e-bpa-${isMobile(testInfo) ? 'm' : 'd'}-`);
    await deleteProductsByPrefix(`e2e-bpa-${project}-`);
    await deleteCommunitiesByPrefix(`e2e-bpa-${project}-`);

    names.community = `${prefix} Clube`;
    names.product = `${prefix} Mentoria`;
    names.highlight = `${highlightPrefix} Bastidores`;
    ids.community = await createCommunityAs(users.demoAdmin, 'rede-demo', names.community);
    ids.product = await createProduct({
      tenantSlug: 'rede-demo',
      name: names.product,
      priceCents: 1990,
      communityIds: [ids.community],
    });
    await insertHighlightFixture('rede-demo', ids.community, names.highlight);
  });

  test.afterAll(async () => {
    await deleteHighlightsByTitlePrefix('rede-demo', highlightPrefix);
    await deleteProductsByPrefix(prefix);
    await deleteCommunitiesByPrefix(prefix);
    await closeStoreAdmin();
    await closeAdmin();
  });

  const form = (page: Page) => page.locator('[data-product-form]');
  const group = (page: Page) => form(page).locator(`[data-product-permissions="${ids.community}"]`);
  const box = (page: Page, label: string) => group(page).getByRole('checkbox', { name: label });
  const toast = (page: Page, message: string) =>
    page.getByRole('status').filter({ hasText: message });

  test('the product form draws the five boxes under the community, three ticked, and keeps a story tick after a save', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    for (const width of widths(testInfo)) {
      await resize(page, width);
      await page.goto(`${hosts.demo}/loja/${ids.product}/editar`);
      await untilHydrated(form(page));

      // The legend names the group, with the community as a screen-reader-only suffix.
      await expect(group(page)).toBeVisible();
      await expect(group(page)).toContainText(P.legend);
      await expect(
        page.getByRole('group', {
          name: `${P.legend}${fill(P.legendCommunity, { community: names.community })}`,
        }),
      ).toBeVisible();

      // The five boxes in the fixed order, with the three defaults ticked and post and story not.
      await expect(group(page).getByRole('checkbox')).toHaveCount(5);
      const labels = await group(page).locator('label').allInnerTexts();
      expect(labels.map((text) => text.trim())).toEqual([
        P.like,
        P.comment,
        P.share,
        P.post,
        P.story,
      ]);
      await expect(box(page, P.like)).toBeChecked();
      await expect(box(page, P.comment)).toBeChecked();
      await expect(box(page, P.share)).toBeChecked();
      await expect(box(page, P.post)).not.toBeChecked();
      await expect(box(page, P.story)).not.toBeChecked();
      expect(await scrollsSideways(page)).toBe(false);
    }

    // Tick "Postar story", save, reopen and see it kept (a flags-only edit asks nothing).
    await resize(page, widths(testInfo)[0] ?? null);
    await page.goto(`${hosts.demo}/loja/${ids.product}/editar`);
    await untilHydrated(form(page));
    await box(page, P.story).check();
    await form(page).locator('button[type="submit"]').click();
    await expect(toast(page, S.toasts.saved)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`${hosts.demo}/loja/${ids.product}/editar`);
    await untilHydrated(form(page));
    await expect(box(page, P.story)).toBeChecked();
    await expect(box(page, P.post)).not.toBeChecked();
    await expect(box(page, P.like)).toBeChecked();
  });

  test('the highlight screen: turning "Aberto a compradores" on shows the toast and, in the list, the pill; turning it off removes both', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    const manage = `${hosts.demo}/comunidades/${ids.community}/destaques`;
    const rowButton = () =>
      page.getByRole('button', { name: fill(H.manage.edit, { title: names.highlight }) });
    const openSheet = async () => {
      await rowButton().click();
      const sheet = page.getByRole('dialog', { name: H.edit.title });
      await expect(sheet).toBeVisible();
      return sheet;
    };
    const theSwitch = (sheet: Locator) =>
      sheet.getByRole('switch', { name: H.edit.openToBuyers.label });

    for (const width of widths(testInfo)) {
      await resize(page, width);
      await page.goto(manage);
      await untilHydrated(rowButton());

      // Closed to begin with: no pill on the row, and the switch is off in the sheet.
      await expect(page.getByText(H.manage.openPill, { exact: true })).toHaveCount(0);
      const sheet = await openSheet();
      const open = theSwitch(sheet);
      await expect(open).toHaveAttribute('aria-checked', 'false');
      await expect(sheet.getByText(H.edit.openToBuyers.helper)).toBeVisible();
      await expect(open).toBeInViewport();
      expect(await scrollsSideways(page)).toBe(false);

      // On: persisted at once (no Save button), the success toast, the switch stays on.
      await open.click();
      await expect(toast(page, H.edit.openToBuyers.toastOn)).toBeVisible();
      await expect(open).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: H.edit.title })).toHaveCount(0);

      // The list marks it: the short visible word, named "Aberto a compradores" for a screen reader.
      await expect(page.getByText(H.manage.openPill, { exact: true })).toHaveCount(1);
      await expect(rowButton()).toHaveAccessibleDescription(
        new RegExp(`${H.manage.openPillPrefix}${H.manage.openPill}`, 'i'),
      );

      // It is the stored state, not a client one: a reload keeps the pill and the switch.
      await page.reload();
      await untilHydrated(rowButton());
      await expect(page.getByText(H.manage.openPill, { exact: true })).toHaveCount(1);
      const again = await openSheet();
      await expect(theSwitch(again)).toHaveAttribute('aria-checked', 'true');

      // Off: nothing is asked, the closing toast, and the pill goes.
      await theSwitch(again).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(toast(page, H.edit.openToBuyers.toastOff)).toBeVisible();
      await expect(theSwitch(again)).toHaveAttribute('aria-checked', 'false');
      await page.keyboard.press('Escape');
      await expect(page.getByText(H.manage.openPill, { exact: true })).toHaveCount(0);
    }
  });

  test('the member side never shows the mark: the community page carries no "Compradores" word', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${ids.community}`);
    await expect(page.getByText(H.manage.openPill, { exact: true })).toHaveCount(0);
    await expect(page.getByText(H.edit.openToBuyers.label)).toHaveCount(0);
  });
});
