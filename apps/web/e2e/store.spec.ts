import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { formatBrl } from '@rede-social/contracts/money';
import { createTranslator } from 'next-intl';
import appStoreMessages from '../messages/pt-BR/app.store.json' with { type: 'json' };
import communitiesMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import communitiesStoreMessages from '../messages/pt-BR/communities.store.json' with {
  type: 'json',
};
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import feedStoreMessages from '../messages/pt-BR/feed.store.json' with { type: 'json' };
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  createMember,
  createVideoPostAs,
  deleteReelsFixtures,
  deleteUserByEmail,
  membershipIdFor,
  setMemberDisplayName,
} from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeStoreAdmin,
  createCommunityPostAs,
  createLockedCommunityWithMedia,
  createProduct,
  deleteCommunitiesByPrefix,
  deleteCopiedMedia,
  deleteProductsByPrefix,
  entitlementsFor,
  grantEntitlement,
  type LockedMediaCommunity,
  lockPreviewAs,
  ordersFor,
  productByName,
  productLinkIds,
  productStatus,
  purchaseAs,
  revokeEntitlement,
  setProductPrice,
  setProductStatus,
  waitForReadyCoverIn,
} from './store-admin';
import { ensureWorker } from './worker';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const S = storeMessages.store;
const SETTINGS_ROW = appStoreMessages.app.settings.rows.store;

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/**
 * 08.2-07 — the Loja browse surfaces, on the phone (`mobile-chromium`) and on the desktop:
 * the TopBar slot (UI-D-366), the grid with its chips (UI-D-367, D-352), the poster (UI-D-368), the
 * product page (UI-D-369, D-353), the manager's additions (D-362) and the Configurações row
 * (UI-D-382), plus the store being off on rede-lab (UI-D-387).
 *
 * The seed turns `store` ON for rede-demo with no product (Pitfall 13), so every product here is a
 * fixture written through `store-admin.ts`, prefixed per run and project, and removed in `afterAll`.
 * Prices are compared against `formatBrl(...)` itself, so the U+00A0 after "R$" is exact (P20).
 *
 * `serviceWorkers: 'block'`: a worker answering navigations from its cache would have these
 * assertions read what a previous run left behind (the 03-05 lesson).
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

/** The visible chrome holding the slots: the TopBar on the phone, the rail on the desktop. */
function chrome(page: Page) {
  return page.locator('header a, aside a').filter({ visible: true });
}

function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'mobile-chromium';
}

test.describe('browse', () => {
  test.skip(isRemote, 'the store fixtures write rows through the local database');

  const run = Date.now().toString(36);
  let prefix = '';
  const ids = { free: '', paid: '', owned: '', archived: '', long: '' };
  const names = { free: '', paid: '', owned: '', archived: '', long: '', community: '' };
  let longDescription = '';

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-st-${testInfo.project.name}-${run}`;
    await deleteProductsByPrefix(`e2e-st-${testInfo.project.name}-`);
    await deleteCommunitiesByPrefix(`e2e-st-${testInfo.project.name}-`);

    names.community = `${prefix} Clube`;
    const communityId = await createCommunityAs(users.demoAdmin, 'rede-demo', names.community);

    names.free = `${prefix} Livre`;
    names.paid = `${prefix} Pago`;
    names.owned = `${prefix} Meu`;
    names.archived = `${prefix} Antigo`;
    // E03/E04 long-text: exactly 80 characters, the name cap.
    names.long = `${prefix} Longo `.padEnd(80, 'x');
    const url = `https://exemplo.com.br/${'caminho-muito-longo-sem-espacos-'.repeat(8)}fim`;
    const paragraph = 'Uma linha de descrição que se repete para ocupar espaço. ';
    longDescription = `${paragraph.repeat(10)}\n\n${url}\n\n`;
    longDescription = `${longDescription}${paragraph.repeat(40)}`.slice(0, 2000);

    ids.free = await createProduct({
      tenantSlug: 'rede-demo',
      name: names.free,
      priceCents: 0,
      minutesAgo: 5,
    });
    ids.paid = await createProduct({
      tenantSlug: 'rede-demo',
      name: names.paid,
      priceCents: 1990,
      description: 'Encontros mensais.\nCom material.',
      communityIds: [communityId],
      minutesAgo: 4,
    });
    ids.owned = await createProduct({
      tenantSlug: 'rede-demo',
      name: names.owned,
      priceCents: 4990,
      communityIds: [communityId],
      minutesAgo: 3,
    });
    ids.archived = await createProduct({
      tenantSlug: 'rede-demo',
      name: names.archived,
      priceCents: 2990,
      status: 'archived',
      minutesAgo: 2,
    });
    ids.long = await createProduct({
      tenantSlug: 'rede-demo',
      name: names.long,
      priceCents: 10_000_000,
      description: longDescription,
      minutesAgo: 1,
    });
    await grantEntitlement(users.demoMember, ids.owned);
  });

  test.afterAll(async () => {
    await deleteProductsByPrefix(prefix);
    await deleteCommunitiesByPrefix(prefix);
    await closeStoreAdmin();
    await closeAdmin();
  });

  test('UI-D-366: the member sees the Loja slot first in the slot row and opens the grid', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const order = await chrome(page).evaluateAll((links) =>
      links
        .map((link) => link.getAttribute('href'))
        .filter((href) => href === '/loja' || href === '/notificacoes' || href === '/suporte'),
    );
    expect(order).toEqual(['/loja', '/notificacoes', '/suporte']);

    const slot = chrome(page).and(page.locator('a[href="/loja"]'));
    await expect(slot).toHaveAccessibleName(S.nav);
    // No badge on the store slot.
    await expect(slot).not.toContainText(/\d/);
    await slot.click();
    await expect(page).toHaveURL(/\/loja$/);
    await expect(page.getByRole('heading', { level: 1, name: S.list.title })).toBeVisible();
    await expect(page.getByText(fill(S.list.subtitle, { tenant: 'Rede Demo' }))).toBeVisible();

    // D-351: two columns at every width, "Grátis" at zero and the formatBrl price.
    const grid = page.getByRole('list', { name: fill(S.list.region, { tenant: 'Rede Demo' }) });
    await expect(grid).toBeVisible();
    const columns = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(2);
    await expect(
      grid.getByRole('link', { name: `${names.free}, ${S.price.free}`, exact: true }),
    ).toBeVisible();
    const paid = grid.getByRole('link', { name: `${names.paid}, ${formatBrl(1990)}`, exact: true });
    await expect(paid).toBeVisible();
    await expect(paid).toContainText(formatBrl(1990));
    // Held: the "Comprado" pill and ", comprado".
    await expect(
      grid.getByRole('link', { name: `${names.owned}, ${formatBrl(4990)}, comprado`, exact: true }),
    ).toContainText(S.card.owned);
    // Archived products are not in "Todos"; the manager-only chip is absent for a member.
    await expect(grid.getByRole('link', { name: new RegExp(names.archived) })).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.list.filter.archived })).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.list.create })).toHaveCount(0);

    // P21: the server's order, newest first, never re-sorted by the web.
    const mine = await grid
      .getByRole('link')
      .evaluateAll(
        (links, p) =>
          links.map((l) => l.getAttribute('aria-label') ?? '').filter((n) => n.startsWith(p)),
        prefix,
      );
    expect(mine.map((label) => label.split(',')[0])).toEqual([
      names.long,
      names.owned,
      names.paid,
      names.free,
    ]);
  });

  test('D-352: "Comprados" lists what the member holds, archived included; ?filtro=arquivados reads as Todos', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja`);
    await page.getByRole('link', { name: S.list.filter.owned }).click();
    await expect(page).toHaveURL(/\/loja\?filtro=comprados$/);
    await expect(page.getByRole('link', { name: S.list.filter.owned })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const ownedName = `${names.owned}, ${formatBrl(4990)}, comprado`;
    await expect(page.getByRole('link', { name: ownedName, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(names.paid) })).toHaveCount(0);

    // Archived after the grant: still under "Comprados", with "Comprado" and no archive wording.
    await setProductStatus(ids.owned, 'archived');
    try {
      await page.reload();
      const card = page.getByRole('link', { name: ownedName, exact: true });
      await expect(card).toBeVisible();
      await expect(card).toContainText(S.card.owned);
      await expect(card).not.toContainText(S.card.archived);
    } finally {
      await setProductStatus(ids.owned, 'active');
    }

    // T-08.2-32: a member asking for the manager filter gets "Todos".
    await page.goto(`${hosts.demo}/loja?filtro=arquivados`);
    await expect(page.getByRole('link', { name: S.list.filter.all })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: new RegExp(names.archived) })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: `${names.paid}, ${formatBrl(1990)}`, exact: true }),
    ).toBeVisible();
  });

  test('P19: "Comprados" with nothing held shows its empty copy and "Ver todos"', async ({
    page,
  }) => {
    // The seeded admin holds no product of this run (and the seed grants none).
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja?filtro=comprados`);
    await expect(page.getByText(S.list.ownedEmpty.title)).toBeVisible();
    await expect(page.getByText(S.list.ownedEmpty.body)).toBeVisible();
    await page.getByRole('link', { name: S.list.ownedEmpty.cta }).click();
    await expect(page).toHaveURL(/\/loja$/);
  });

  test('D-353 / UI-D-369: the product page with and without communities, and the held state', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // No linked community: nothing is said about communities.
    await page.goto(`${hosts.demo}/loja/${ids.free}`);
    await expect(page.getByRole('heading', { name: names.free })).toBeVisible();
    await expect(page.getByTestId('store-product-price')).toHaveText(S.price.free);
    await expect(page.getByText(S.product.unlocks.title)).toHaveCount(0);
    await expect(page.getByTestId('store-product-description')).toHaveCount(0);
    await expect(page.getByRole('link', { name: S.product.back })).toHaveAttribute('href', '/loja');

    // One active community: the section, a static row with a padlock, the price and the text.
    await page.goto(`${hosts.demo}/loja/${ids.paid}`);
    await expect(page.getByTestId('store-product-price')).toHaveText(formatBrl(1990));
    await expect(page.getByText(S.product.unlocks.title)).toBeVisible();
    const locked = page.getByRole('listitem', {
      name: fill(S.product.unlocks.rowLocked, { community: names.community }),
    });
    await expect(locked).toBeVisible();
    await expect(locked.getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId('store-product-description')).toHaveText(
      'Encontros mensais.\nCom material.',
      { useInnerText: true },
    );
    await expect(page.getByTestId('store-product-owned')).toHaveCount(0);
    // A member never gets the manager card.
    await expect(page.getByText(S.product.manage.title)).toHaveCount(0);

    // Held: the owned block, the success pill and rows that open the community.
    await page.goto(`${hosts.demo}/loja/${ids.owned}`);
    await expect(page.getByTestId('store-product-owned')).toContainText(S.product.owned.body);
    await expect(page.getByTestId('store-product-pill')).toHaveText(S.card.owned);
    await expect(
      page.getByRole('link', {
        name: fill(S.product.unlocks.rowOpen, { community: names.community }),
      }),
    ).toHaveAttribute('href', /^\/comunidades\/[0-9a-f-]{36}$/);

    // An archived product the member does not hold is the store's not-found card.
    await page.goto(`${hosts.demo}/loja/${ids.archived}`);
    await expect(page.getByText(S.notFound.title)).toBeVisible();
    await expect(page.getByRole('link', { name: S.notFound.cta })).toHaveAttribute('href', '/loja');
  });

  test('D-362: the manager gets the create control, "Arquivados", the manage card and reactivates', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja`);
    await expect(page.getByRole('link', { name: S.list.create })).toHaveAttribute(
      'href',
      '/loja/novo',
    );
    await page.getByRole('link', { name: S.list.filter.archived }).click();
    await expect(page).toHaveURL(/\/loja\?filtro=arquivados$/);
    const card = page.getByRole('link', {
      name: fill(S.card.ariaArchived, { product: names.archived }),
      exact: true,
    });
    await expect(card).toContainText(S.card.archived);
    await card.click();

    await expect(page).toHaveURL(new RegExp(`/loja/${ids.archived}$`));
    await expect(page.getByTestId('store-product-pill')).toHaveText(S.card.archived);
    await expect(page.getByText(S.product.archived.note)).toBeVisible();
    await expect(page.getByText(S.product.manage.title)).toBeVisible();
    await expect(
      page.getByRole('link', { name: new RegExp(S.product.manage.buyers) }),
    ).toContainText('Ninguém com acesso ainda');
    await expect(page.getByRole('link', { name: S.product.manage.edit })).toHaveAttribute(
      'href',
      `/loja/${ids.archived}/editar`,
    );

    await page.getByRole('button', { name: S.product.archived.reactivate }).click();
    const dialog = page.getByRole('dialog', { name: S.form.reactivateDialog.title });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: S.form.reactivateDialog.confirm, exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: S.toasts.reactivated })).toBeVisible();
    await expect(page.getByText(S.product.archived.note)).toHaveCount(0);
    await expect.poll(() => productStatus(ids.archived)).toBe('active');
    await setProductStatus(ids.archived, 'archived');
  });

  test('UI-D-382: Configurações shows "Loja" to the admin and not to the member', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    const row = page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true });
    await expect(row).toHaveAttribute('href', '/loja');

    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(
      page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }),
    ).toHaveCount(0);
  });

  test('E04 long-text: a 2,000-character description and an 80-character name at 320px', async ({
    page,
  }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${ids.long}`);

    const description = page.getByTestId('store-product-description');
    await expect(description).toBeVisible();
    expect(await description.evaluate((el) => el.textContent)).toBe(longDescription);
    // The blank lines survive (pre-line) and the long URL wraps instead of widening the page.
    const fits = await description.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    const pageFits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(pageFits).toBe(true);
    await expect(page.getByTestId('store-product-price')).toHaveText(formatBrl(10_000_000));

    // The card at 320px: the 80-character name clamps, the cap price stays on one line.
    await page.goto(`${hosts.demo}/loja`);
    const card = page.getByRole('link', {
      name: `${names.long}, ${formatBrl(10_000_000)}`,
      exact: true,
    });
    await expect(card).toBeVisible();
    const price = card.getByTestId('product-card-price');
    const priceLines = await price.evaluate((el) => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      return Math.round(el.getBoundingClientRect().height / lineHeight);
    });
    expect(priceLines).toBe(1);
    const nameClamped = await card
      .getByTestId('product-card-name')
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(nameClamped).toBe(true);
  });

  test('UI-D-387: with the store off (rede-lab) there is no slot and /loja is the generic not-found', async ({
    page,
  }) => {
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    await expect(chrome(page).and(page.locator('a[href="/loja"]'))).toHaveCount(0);
    await page.goto(`${hosts.lab}/loja`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByText(S.notFound.title)).toHaveCount(0);
    await page.goto(`${hosts.lab}/loja/${ids.paid}`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByText(S.notFound.title)).toHaveCount(0);
  });
});

/**
 * 08.2-08 — the purchase pop-up (D-358, D-361, UI-D-370, UI-D-371, UI-D-386, STORE-07/08) on the
 * phone and the desktop. Every case buys a product of its own (a member who already holds a product
 * would see the owned block, not "Comprar"), prefixed `e2e-st-purchase-<project>-<run>` so the
 * browse block's cleanup never touches these rows and `afterAll` removes their orders and
 * entitlements. The ledger is read through the admin connection: a purchase is exactly one `paid`
 * order with provider `none` and the product row's amount, never one the client chose.
 */
test.describe('purchase', () => {
  test.skip(isRemote, 'the store fixtures write rows through the local database');

  const run = Date.now().toString(36);
  let prefix = '';
  const communities = { a: '', b: '', c: '' };
  const communityNames = { a: '', b: '', c: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-st-purchase-${testInfo.project.name}-${run}`;
    await deleteProductsByPrefix(`e2e-st-purchase-${testInfo.project.name}-`);
    await deleteCommunitiesByPrefix(`e2e-st-purchase-${testInfo.project.name}-`);
    communityNames.a = `${prefix} Clube A`;
    communityNames.b = `${prefix} Clube B`;
    communityNames.c = `${prefix} Clube C`;
    communities.a = await createCommunityAs(users.demoAdmin, 'rede-demo', communityNames.a);
    communities.b = await createCommunityAs(users.demoAdmin, 'rede-demo', communityNames.b);
    communities.c = await createCommunityAs(users.demoAdmin, 'rede-demo', communityNames.c);
  });

  test.afterAll(async () => {
    await deleteProductsByPrefix(prefix);
    await deleteCommunitiesByPrefix(prefix);
    await closeStoreAdmin();
    await closeAdmin();
  });

  async function product(
    label: string,
    priceCents: number,
    communityIds: readonly string[] = [],
  ): Promise<{ id: string; name: string }> {
    const name = `${prefix} ${label}`;
    const id = await createProduct({ tenantSlug: 'rede-demo', name, priceCents, communityIds });
    return { id, name };
  }

  async function openDialog(page: Page, buyLabel: string) {
    await page.getByRole('button', { name: buyLabel, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
  }

  function toast(page: Page, message: string) {
    return page.getByRole('status').filter({ hasText: message });
  }

  test('D-358 / P28: a priced product with no community ends on "{product} agora é seu." and the owned block', async ({
    page,
  }) => {
    const { id, name } = await product('Kit', 1990);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);
    await expect(page.getByTestId('store-product-price')).toHaveText(formatBrl(1990));

    const dialog = await openDialog(page, S.product.buy);
    await expect(dialog).toHaveAccessibleName(fill(S.purchase.title, { product: name }));
    await expect(dialog).toContainText(fill(S.purchase.body, { price: formatBrl(1990) }));
    const confirm = dialog.getByRole('button', { name: S.purchase.confirm, exact: true });
    // UI-D-386: the dialog opens on "Confirmar".
    await expect(confirm).toBeFocused();
    await confirm.click();

    await expect(dialog.getByRole('heading', { name: S.purchase.success.title })).toBeFocused();
    await expect(dialog).toContainText(fill(S.purchase.success.none, { product: name }));
    await expect(dialog.getByRole('link')).toHaveCount(0);
    await expect(dialog.getByRole('button')).toHaveText([S.purchase.success.close]);
    await dialog.getByRole('button', { name: S.purchase.success.close }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    const owned = page.getByTestId('store-product-owned');
    await expect(owned).toContainText(S.product.owned.body);
    await expect(owned).toBeFocused();
    await expect(page.getByRole('button', { name: S.product.buy, exact: true })).toHaveCount(0);
    // STORE-07: exactly one paid order, provider none, the product row's amount.
    await expect
      .poll(() => ordersFor(id, users.demoMember))
      .toEqual([{ status: 'paid', amountCents: 1990, provider: 'none' }]);
  });

  test('D-361: a 0-cent product shows "Grátis" and "Obter" and completes through the same purchase', async ({
    page,
  }) => {
    const { id, name } = await product('Livre', 0);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);
    await expect(page.getByTestId('store-product-price')).toHaveText(S.price.free);
    await expect(page.getByRole('button', { name: S.product.buy, exact: true })).toHaveCount(0);

    const dialog = await openDialog(page, S.product.get);
    await expect(dialog).toHaveAccessibleName(fill(S.purchase.titleFree, { product: name }));
    await expect(dialog).toContainText(fill(S.purchase.body, { price: S.price.free }));
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).click();
    await expect(dialog).toContainText(fill(S.purchase.success.none, { product: name }));
    await expect
      .poll(() => ordersFor(id, users.demoMember))
      .toEqual([{ status: 'paid', amountCents: 0, provider: 'none' }]);
  });

  test('UI-D-370: one community → "Ir para a comunidade" lands on it', async ({ page }) => {
    const { id } = await product('Um', 2990, [communities.a]);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);

    const dialog = await openDialog(page, S.product.buy);
    await expect(dialog).toContainText(
      fill(S.purchase.bodyCommunities, {
        price: formatBrl(2990),
        communities: communityNames.a,
      }),
    );
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).click();
    await expect(dialog).toContainText(
      fill(S.purchase.success.one, { community: communityNames.a }),
    );
    const go = dialog.getByRole('link', { name: S.purchase.success.goToCommunity });
    await expect(go).toHaveAttribute('href', `/comunidades/${communities.a}`);
    await go.click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${communities.a}$`));
  });

  test('UI-D-370 / E05: three communities → "A, B e mais 1" on confirm, the scrolling link list on success', async ({
    page,
  }) => {
    const { id } = await product('Tres', 4990, [communities.a, communities.b, communities.c]);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);

    const dialog = await openDialog(page, S.product.buy);
    const body = (await dialog.locator('p').first().textContent()) ?? '';
    expect(body).toContain(fill(S.purchase.andMore, { n: '1' }));
    expect(body).not.toContain('e e mais');
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).click();

    await expect(dialog).toContainText(S.purchase.success.several);
    const list = dialog.getByRole('list');
    await expect(list).toHaveClass(/max-h-60/);
    const hrefs = await list
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')).sort());
    expect(hrefs).toEqual(
      [communities.a, communities.b, communities.c].map((c) => `/comunidades/${c}`).sort(),
    );
    // A single full-width "Fechar", no "Ir para a comunidade".
    await expect(dialog.getByRole('button')).toHaveText([S.purchase.success.close]);
    await expect(dialog.getByRole('link', { name: S.purchase.success.goToCommunity })).toHaveCount(
      0,
    );
  });

  test('D-358: started from a locked community (?comunidade=) the purchase returns there with the toast', async ({
    page,
  }) => {
    const { id } = await product('Volta', 1500, [communities.b]);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}?comunidade=${communities.b}`);
    await expect(
      page.getByRole('link', {
        name: fill(S.product.backToCommunity, { community: communityNames.b }),
      }),
    ).toHaveAttribute('href', `/comunidades/${communities.b}`);

    const dialog = await openDialog(page, S.product.buy);
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${communities.b}$`));
    await expect(
      toast(page, fill(S.purchase.success.returned, { community: communityNames.b })),
    ).toBeVisible();
    // The success step was skipped.
    await expect(page.getByText(S.purchase.success.title, { exact: true })).toHaveCount(0);
  });

  test('STORE-08: a double click on "Confirmar" leaves exactly one order', async ({ page }) => {
    const { id } = await product('Duplo', 990);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);

    const dialog = await openDialog(page, S.product.buy);
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).dblclick();
    await expect(dialog.getByRole('heading', { name: S.purchase.success.title })).toBeVisible();
    await expect
      .poll(() => ordersFor(id, users.demoMember))
      .toEqual([{ status: 'paid', amountCents: 990, provider: 'none' }]);
  });

  test('UI-D-371: a price changed after the page loaded refuses, shows the new price and buys nothing', async ({
    page,
  }) => {
    const { id } = await product('Preco', 1990);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);
    await expect(page.getByTestId('store-product-price')).toHaveText(formatBrl(1990));

    await setProductPrice(id, 2490);
    const dialog = await openDialog(page, S.product.buy);
    // The member confirms the number they saw; the API refuses the stale one.
    await expect(dialog).toContainText(formatBrl(1990));
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).click();

    await expect(toast(page, S.purchase.errors.priceChanged)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('store-product-price')).toHaveText(formatBrl(2490));
    // UI-D-386: focus back on "Comprar" after a refusal.
    await expect(page.getByRole('button', { name: S.product.buy, exact: true })).toBeFocused();
    expect(await ordersFor(id, users.demoMember)).toEqual([]);
  });

  test('UI-D-371: a product archived after the page loaded refuses with the unavailable toast', async ({
    page,
  }) => {
    const { id } = await product('Arquivado', 1990);
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${id}`);

    await setProductStatus(id, 'archived');
    const dialog = await openDialog(page, S.product.buy);
    await dialog.getByRole('button', { name: S.purchase.confirm, exact: true }).click();
    await expect(toast(page, S.purchase.errors.unavailable)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The refresh follows the archived rules: a non-holder gets the store's not-found card.
    await expect(page.getByText(S.notFound.title)).toBeVisible();
    expect(await ordersFor(id, users.demoMember)).toEqual([]);
  });
});

/** The tag and page copy of the locked community (08.2-09), from the catalogs. */
const TAGS = communitiesStoreMessages.communities.tags;
const FEED = feedMessages.feed;
const LOCKED_TOAST = feedStoreMessages.feed.errors.communityLocked;
const HIGHLIGHTS = communitiesMessages.communities.page.highlights;

/** "+ N publicações exclusivas" for N ≥ 2 (the ICU `other` branch, filled by hand). */
function countLine(n: number): string {
  return n === 1 ? '+ 1 publicação exclusiva' : `+ ${n} publicações exclusivas`;
}

/**
 * 08.2-09 — the locked community as a member meets it (D-354..D-357, UI-D-372..UI-D-376), and as
 * staff never do.
 *
 * Fixtures (per project and run, through `store-admin.ts` and `admin.ts`):
 *  - "Bastidores": five posts — the NEWEST a ready video (the sample), then a text post, a PDF post,
 *    an image post and the oldest text post — linked to ONE product ("Ver produto");
 *  - "Opções": two posts, linked to TWO products ("Ver opções" → the sheet);
 *  - "Arquivo": two posts, its only product archived ("Produto arquivado", nothing buyable);
 *  - "Compra": one post and one product, bought in the last case (no tag afterwards);
 *  - "Revogada": two posts and a product GRANTED to the member, revoked mid-session (`-g revoke`).
 * The member is the seeded rede-demo member; the admin and support are the seeded staff.
 */
test.describe('locked community', () => {
  test.skip(isRemote, 'the store fixtures write rows through the local database');

  const run = Date.now().toString(36);
  let prefix = '';
  const c = { main: '', many: '', archived: '', buy: '', revoke: '' };
  const n = { main: '', many: '', archived: '', buy: '', revoke: '' };
  const p = { main: '', manyA: '', manyB: '', archived: '', buy: '', revoke: '' };
  const pn = { main: '', manyA: '', manyB: '', buy: '' };
  const captions = { sample: '', hidden: [] as string[] };
  const hiddenAssets: string[] = [];
  let hiddenPostId = '';
  let sampleAssetId = '';
  let revokeGrant = '';
  const revokeCaptions = { newest: '', older: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-st-locked-${testInfo.project.name}-${run}`;
    const stale = `e2e-st-locked-${testInfo.project.name}-`;
    await deleteProductsByPrefix(stale);
    await deleteReelsFixtures(stale);

    for (const key of Object.keys(c) as (keyof typeof c)[]) {
      n[key] = `${prefix} ${key}`;
      c[key] = await createCommunityAs(users.demoAdmin, 'rede-demo', n[key], { minutesAgo: 30 });
    }

    // "Bastidores": five posts, the newest a video (the sample); the four others stay hidden.
    const author = users.demoAdmin;
    const text1 = `${prefix} oculto mais antigo`;
    const image = `${prefix} oculto com imagem`;
    const pdf = `${prefix} oculto com pdf`;
    const text2 = `${prefix} oculto segundo mais novo`;
    await createCommunityPostAs(author, 'rede-demo', text1, { communityId: c.main, minutesAgo: 9 });
    const imagePost = await createCommunityPostAs(author, 'rede-demo', image, {
      communityId: c.main,
      kind: 'image',
      minutesAgo: 8,
    });
    const pdfPost = await createCommunityPostAs(author, 'rede-demo', pdf, {
      communityId: c.main,
      kind: 'pdf',
      minutesAgo: 7,
    });
    const second = await createCommunityPostAs(author, 'rede-demo', text2, {
      communityId: c.main,
      minutesAgo: 6,
    });
    hiddenPostId = second.postId;
    captions.sample = `${prefix} amostra em video`;
    const video = await createVideoPostAs(author, 'rede-demo', captions.sample, {
      communityId: c.main,
      minutesAgo: 5,
      width: 1920,
      height: 1080,
    });
    sampleAssetId = video.assetId;
    captions.hidden = [text1, image, pdf, text2];
    for (const asset of [imagePost.assetId, pdfPost.assetId]) if (asset) hiddenAssets.push(asset);

    for (const key of ['many', 'archived', 'revoke'] as const) {
      await createCommunityPostAs(author, 'rede-demo', `${prefix} ${key} antigo`, {
        communityId: c[key],
        minutesAgo: 9,
      });
      await createCommunityPostAs(author, 'rede-demo', `${prefix} ${key} novo`, {
        communityId: c[key],
        minutesAgo: 8,
      });
    }
    revokeCaptions.older = `${prefix} revoke antigo`;
    revokeCaptions.newest = `${prefix} revoke novo`;
    await createCommunityPostAs(author, 'rede-demo', `${prefix} buy unico`, {
      communityId: c.buy,
      minutesAgo: 9,
    });

    pn.main = `${prefix} Mentoria`;
    p.main = await createProduct({
      tenantSlug: 'rede-demo',
      name: pn.main,
      priceCents: 1990,
      communityIds: [c.main],
    });
    pn.manyA = `${prefix} Opcao A`;
    pn.manyB = `${prefix} Opcao B`;
    p.manyA = await createProduct({
      tenantSlug: 'rede-demo',
      name: pn.manyA,
      priceCents: 2990,
      communityIds: [c.many],
      minutesAgo: 2,
    });
    p.manyB = await createProduct({
      tenantSlug: 'rede-demo',
      name: pn.manyB,
      priceCents: 0,
      communityIds: [c.many],
      minutesAgo: 1,
    });
    p.archived = await createProduct({
      tenantSlug: 'rede-demo',
      name: `${prefix} Antigo`,
      priceCents: 990,
      status: 'archived',
      communityIds: [c.archived],
    });
    pn.buy = `${prefix} Compra`;
    p.buy = await createProduct({
      tenantSlug: 'rede-demo',
      name: pn.buy,
      priceCents: 1500,
      communityIds: [c.buy],
    });
    p.revoke = await createProduct({
      tenantSlug: 'rede-demo',
      name: `${prefix} Revogavel`,
      priceCents: 500,
      communityIds: [c.revoke],
    });
    revokeGrant = await grantEntitlement(users.demoMember, p.revoke);
  });

  test.afterAll(async () => {
    await deleteProductsByPrefix(prefix);
    await deleteReelsFixtures(prefix);
    await closeStoreAdmin();
    await closeAdmin();
  });

  function card(page: Page, name: string) {
    return page.getByTestId('community-card').filter({ hasText: name });
  }

  function toast(page: Page, message: string) {
    return page.getByRole('status').filter({ hasText: message });
  }

  test('UI-D-372 / P44 / P47: the member sees "Exclusiva" on the cover in colour, and "Produto arquivado" where it applies', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    const main = card(page, n.main);
    await expect(main).toBeVisible();
    // The pill is on the cover, inside the card's single link, its glyph aria-hidden (P46).
    const badge = main.getByTestId('community-cover-badge').getByTestId('exclusive-badge');
    await expect(badge).toHaveText(TAGS.exclusive);
    await expect(badge.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(main).toHaveAccessibleName(new RegExp(TAGS.exclusive));
    // D-357: the cover stays in colour, the name, description and count unchanged (P48: all 5).
    expect(await main.innerHTML()).not.toContain('grayscale');
    await expect(main).toContainText(n.main);
    await expect(main).toContainText('5 publicações');
    await expect(main).not.toContainText(TAGS.productArchived);

    const archived = card(page, n.archived);
    await expect(archived.getByTestId('exclusive-badge')).toBeVisible();
    await expect(archived).toContainText(TAGS.productArchived);

    // The holder (granted) sees no tag on "Revogada".
    await expect(card(page, n.revoke).getByTestId('exclusive-badge')).toHaveCount(0);
  });

  test('UI-D-373 / D-354 / D-356 / E07 overflow: the locked page shows the read-only sample, 3 placeholders and "+ 4" with no hidden content', async ({
    page,
  }) => {
    // Server-action POSTs, minus the sample video's own playback-token mint (its body names the
    // sample's asset id): what is left would be a feed page request.
    const actions: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST' || !request.headers()['next-action']) return;
      if ((request.postData() ?? '').includes(sampleAssetId)) return;
      actions.push(request.url());
    });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${c.main}`);

    // Header tags; no highlights row (D-355).
    await expect(page.locator('[data-community-tag="exclusive"]')).toHaveText(TAGS.exclusive);
    await expect(page.getByRole('region', { name: HIGHLIGHTS })).toHaveCount(0);

    // Top section with one call to action.
    const section = page.getByTestId('locked-section');
    await expect(section.getByRole('heading', { name: S.locked.title })).toBeVisible();
    await expect(section).toContainText(
      fill(S.locked.bodyOne, { product: pn.main, community: n.main }),
    );
    await expect(section.getByRole('link', { name: S.locked.viewProduct })).toHaveAttribute(
      'href',
      `/loja/${p.main}?comunidade=${c.main}`,
    );

    // The sample, read-only (UI-D-374): no like, comment, share or menu control.
    const sample = page.getByRole('article').filter({ hasText: captions.sample });
    await expect(sample).toBeVisible();
    for (const name of [FEED.actions.like, FEED.actions.comment, FEED.actions.share]) {
      await expect(sample.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(sample.getByRole('button', { name: FEED.actions.more })).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(1);

    // min(3, 4) static placeholders inside one aria-hidden wrapper, then the exact count.
    await expect(page.getByTestId('locked-post-placeholder')).toHaveCount(3);
    await expect(page.locator('[data-locked-placeholders][aria-hidden="true"]')).toHaveCount(1);
    const count = page.getByTestId('locked-count');
    await expect(count).toContainText(countLine(4));
    await expect(count).toContainText(fill(S.locked.countBody, { community: n.main }));
    await expect(count.getByRole('link', { name: S.locked.viewProduct })).toBeVisible();

    // T-08.2-39: no hidden caption and no hidden media id anywhere in the HTML or the RSC payload.
    const html = await page.content();
    for (const hidden of [...captions.hidden, ...hiddenAssets]) expect(html).not.toContain(hidden);

    // P85: no paging sentinel; scrolling to the end asks for no further page.
    await expect(page.locator('[data-infinite-scroll-skeleton]')).toHaveCount(0);
    actions.length = 0;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1500);
    expect(actions).toEqual([]);

    // "Ver produto" opens the product with ?comunidade= (D-358's return path).
    await section.getByRole('link', { name: S.locked.viewProduct }).click();
    await expect(page).toHaveURL(new RegExp(`/loja/${p.main}\\?comunidade=${c.main}$`));
  });

  test('UI-D-375 / P53: two buyable products → "Ver opções" opens the sheet with ?comunidade= links', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${c.many}`);
    const section = page.getByTestId('locked-section');
    await expect(section).toContainText(fill(S.locked.bodyMany, { community: n.many }));
    await expect(page.getByTestId('locked-post-placeholder')).toHaveCount(1);
    await expect(page.getByTestId('locked-count')).toContainText(countLine(1));

    await section.getByRole('button', { name: S.locked.viewOptions }).click();
    const sheet = page.getByRole('dialog', { name: S.locked.choice.title });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(fill(S.locked.choice.helper, { community: n.many }));
    const rows = sheet.getByRole('link');
    await expect(rows).toHaveCount(2);
    // The server's order: newest product first.
    await expect(rows.nth(0)).toHaveAttribute('href', `/loja/${p.manyB}?comunidade=${c.many}`);
    await expect(rows.nth(0)).toHaveAccessibleName(`${pn.manyB}, ${S.price.free}`);
    await expect(rows.nth(1)).toHaveAttribute('href', `/loja/${p.manyA}?comunidade=${c.many}`);
    await expect(rows.nth(1)).toHaveAccessibleName(`${pn.manyA}, ${formatBrl(2990)}`);
  });

  test('P54: only an archived product → no top section, the "não está à venda" body and no button', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${c.archived}`);
    await expect(page.locator('[data-community-tag="product-archived"]')).toHaveText(
      TAGS.productArchived,
    );
    await expect(page.getByTestId('locked-section')).toHaveCount(0);
    const count = page.getByTestId('locked-count');
    await expect(count).toContainText(countLine(1));
    await expect(count).toContainText(S.locked.unavailable);
    await expect(count.getByRole('link')).toHaveCount(0);
    await expect(count.getByRole('button')).toHaveCount(0);
  });

  test('STORE-17 / UI-D-376 / E10 partial share: a hidden post link lands on the locked page with the "você abriu" line', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/post/${hiddenPostId}`);
    await expect(page).toHaveURL(new RegExp(`/comunidades/${c.main}\\?exclusivo=1$`));
    await expect(page.getByTestId('locked-section-extra')).toHaveText(S.locked.fromPost);
    expect(await page.content()).not.toContain(captions.hidden[3]);
  });

  test('UI-D-372 staff: the admin sees "Exclusiva" in the list and the full community; support sees no tag', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(card(page, n.main).getByTestId('exclusive-badge')).toBeVisible();
    await expect(card(page, n.revoke).getByTestId('exclusive-badge')).toBeVisible();
    await page.goto(`${hosts.demo}/comunidades/${c.main}`);
    await expect(page.getByTestId('locked-section')).toHaveCount(0);
    await expect(page.getByTestId('locked-post-placeholder')).toHaveCount(0);
    for (const caption of [captions.sample, ...captions.hidden]) {
      await expect(page.getByRole('article').filter({ hasText: caption })).toBeVisible();
    }
  });

  test('UI-D-372 support: no tag and the full community', async ({ page }) => {
    await login(page, 'support@rede-demo.local', SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);
    await expect(card(page, n.main)).toBeVisible();
    await expect(card(page, n.main).getByTestId('exclusive-badge')).toHaveCount(0);
    await page.goto(`${hosts.demo}/comunidades/${c.main}`);
    await expect(page.getByTestId('locked-section')).toHaveCount(0);
    await expect(page.getByRole('article').filter({ hasText: captions.hidden[0] })).toBeVisible();
  });

  test('UI-D-376 / E10 partial / P65 revoke: a like refused mid-session toasts the locked copy and refreshes into the locked page', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${c.revoke}`);
    // Held: the full community, both posts, the like control on the newest.
    const newest = page.getByRole('article').filter({ hasText: revokeCaptions.newest });
    await expect(newest).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: revokeCaptions.older })).toBeVisible();

    await revokeEntitlement(revokeGrant);
    await newest.getByRole('button', { name: FEED.actions.like, exact: true }).click();

    await expect(toast(page, LOCKED_TOAST)).toBeVisible();
    await expect(page.locator('[data-community-tag="exclusive"]')).toBeVisible();
    await expect(page.getByTestId('locked-count')).toContainText(countLine(1));
    await expect(page.getByRole('article').filter({ hasText: revokeCaptions.older })).toHaveCount(
      0,
    );
  });

  test('D-358 / UI-D-372: after buying from the locked page the community opens and the tag is gone', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${c.buy}`);
    await page
      .getByTestId('locked-section')
      .getByRole('link', { name: S.locked.viewProduct })
      .click();
    await expect(page).toHaveURL(new RegExp(`/loja/${p.buy}\\?comunidade=${c.buy}$`));
    await page.getByRole('button', { name: S.product.buy, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: S.purchase.confirm, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${c.buy}$`));
    await expect(page.getByTestId('locked-section')).toHaveCount(0);
    await expect(page.locator('[data-community-tag="exclusive"]')).toHaveCount(0);

    await page.goto(`${hosts.demo}/comunidades`);
    await expect(card(page, n.buy)).toBeVisible();
    await expect(card(page, n.buy).getByTestId('exclusive-badge')).toHaveCount(0);
  });
});

/**
 * 08.2-10 — the admin's product form (D-362, D-363, D-364, UI-D-377..UI-D-379), on the phone and
 * the desktop, serial inside each project: the product created in the first case is edited,
 * archived and reactivated by the later ones.
 *
 * The danger dialog's numbers are compared with the REAL API's lock preview (`lockPreviewAs`), and
 * its copy is built from the catalog through next-intl's own translator (ICU plurals included), so
 * neither the count nor the sentence is a literal here. The image is a real upload through the file
 * chooser, derived by a real worker, and the form is submitted only once the database says the
 * cover is `ready` (the API refuses any other image, `image_invalid`).
 */
const tStore = createTranslator({ locale: 'pt-BR', messages: storeMessages, namespace: 'store' });
const ACCESS = communitiesStoreMessages.communities.form.access;
const LIST = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });

test.describe('product admin', () => {
  test.skip(isRemote, 'the store fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;
  const run = Date.now().toString(36);
  let prefix = '';
  let stopWorker: (() => Promise<void>) | null = null;
  const communities = { open: '', gated: '', free: '', five: [] as string[] };
  const names = {
    open: '',
    gated: '',
    free: '',
    five: [] as string[],
    other: '',
    created: '',
  };
  let createdId = '';

  const form = (page: Page) => page.locator('[data-product-form]');
  const submit = (page: Page) => form(page).locator('button[type="submit"]');
  const toast = (page: Page, message: string) =>
    page.getByRole('status').filter({ hasText: message });

  /** Opens the picker, toggles each named community on, and closes it with "Concluir". */
  async function pick(page: Page, picked: readonly string[], opener: string): Promise<void> {
    await form(page).getByRole('button', { name: opener, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: S.form.picker.title });
    await expect(sheet).toBeVisible();
    for (const community of picked) {
      await sheet.getByRole('button', { name: fill(S.form.picker.rowOff, { community }) }).click();
      await expect(
        sheet.getByRole('button', { name: fill(S.form.picker.rowOn, { community }) }),
      ).toBeVisible();
    }
    await sheet.getByRole('button', { name: S.form.picker.done }).click();
    await expect(sheet).toHaveCount(0);
  }

  /** The dialog body for the preview's rows, in the API's order, through the catalog. */
  function lockBody(
    items: readonly { communityId: string; membersLosingAccess: number }[],
    nameOf: (id: string) => string,
  ): { title: string; body: string } {
    const [only] = items;
    if (items.length === 1 && only) {
      const community = nameOf(only.communityId);
      return {
        title: tStore('lockWarning.one.title', { community }),
        body:
          only.membersLosingAccess === 0
            ? tStore('lockWarning.one.bodyNone', { community })
            : tStore('lockWarning.one.body', { community, N: only.membersLosingAccess }),
      };
    }
    const list = LIST.format(
      items.map((item) =>
        tStore('lockWarning.many.item', {
          community: nameOf(item.communityId),
          N: item.membersLosingAccess,
        }),
      ),
    );
    return {
      title: tStore('lockWarning.many.title', { count: items.length }),
      body: tStore('lockWarning.many.body', { list }),
    };
  }

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-pa-${testInfo.project.name}-${run}`;
    await deleteProductsByPrefix(`e2e-pa-${testInfo.project.name}-`);
    await deleteCommunitiesByPrefix(`e2e-pa-${testInfo.project.name}-`);

    names.open = `${prefix} Aberta`;
    names.gated = `${prefix} Já exclusiva`;
    names.free = `${prefix} Sem produto`;
    names.other = `${prefix} Outro produto`;
    names.created = `${prefix} Mentoria`;
    communities.open = await createCommunityAs(users.demoAdmin, 'rede-demo', names.open);
    communities.gated = await createCommunityAs(users.demoAdmin, 'rede-demo', names.gated);
    communities.free = await createCommunityAs(users.demoAdmin, 'rede-demo', names.free);
    for (let index = 1; index <= 5; index += 1) {
      const name = `${prefix} Lote ${index}`;
      names.five.push(name);
      communities.five.push(await createCommunityAs(users.demoAdmin, 'rede-demo', name));
    }
    // An ARCHIVED product already gates `gated`: it stays gated (P43), and the community form
    // lists it with the " (arquivado)" suffix.
    await createProduct({
      tenantSlug: 'rede-demo',
      name: names.other,
      priceCents: 990,
      status: 'archived',
      communityIds: [communities.gated],
      minutesAgo: 30,
    });
    stopWorker = await ensureWorker();
  });

  test.afterAll(async () => {
    await stopWorker?.();
    await deleteProductsByPrefix(prefix);
    await deleteCommunitiesByPrefix(prefix);
    await closeStoreAdmin();
    await closeAdmin();
  });

  test('D-362 / D-364: the admin creates a product with an image, "19,90" and a newly locked community', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/novo`);

    await expect(page.getByRole('heading', { name: S.form.createTitle })).toBeVisible();
    await expect(submit(page)).toBeDisabled();
    await expect(page.locator('[data-product-image-fallback]')).toBeVisible();
    await expect(page.getByText(S.form.communities.none)).toBeVisible();

    // The image through the real file chooser (also the hydration proof).
    const since = new Date(Date.now() - 1_000);
    const choosing = page.waitForEvent('filechooser');
    await form(page).locator('button', { hasText: S.form.image.add }).click();
    await (await choosing).setFiles(PHOTO);
    await expect(page.locator('[data-product-image-local]')).toBeVisible({ timeout: 60_000 });
    const coverId = await waitForReadyCoverIn('rede-demo', since);

    await page.locator('#product-name').fill(names.created);
    await page.locator('#product-price').fill('19,9');
    await page.locator('#product-price').press('Tab');
    await expect(page.locator('#product-price')).toHaveValue('19,90');

    await pick(page, [names.open], S.form.communities.choose);
    await expect(
      form(page).locator(`[data-product-community="${communities.open}"]`),
    ).toContainText(names.open);
    await expect(
      form(page).getByRole('button', { name: S.form.communities.change, exact: true }),
    ).toBeVisible();

    // The numbers the dialog must show: the API's own answer for a NEW product.
    const expected = await lockPreviewAs(users.demoAdmin, { communityIds: [communities.open] });
    expect(expected).toHaveLength(1);
    const words = lockBody(expected, () => names.open);

    await submit(page).click();
    const dialog = page.getByRole('dialog', { name: words.title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(words.body);
    await dialog.getByRole('button', { name: S.lockWarning.one.confirm, exact: true }).click();

    await expect(toast(page, S.toasts.created)).toBeVisible();
    await expect(page).toHaveURL(/\/loja\/[0-9a-f-]{36}$/);
    const saved = await productByName(names.created);
    if (!saved) throw new Error('the product was not saved');
    createdId = saved.id;
    expect(page.url()).toContain(`/loja/${createdId}`);
    expect(saved.priceCents).toBe(1990);
    expect(saved.imageAssetId).toBe(coverId);
    expect(await productLinkIds(createdId)).toEqual([communities.open]);
    await expect(page.getByTestId('store-product-price')).toHaveText(formatBrl(1990));
    await expect(page.getByTestId('store-product-image')).toBeVisible();
    await expect(page.getByTestId('store-product-unlocks')).toContainText(names.open);
  });

  test('D-364: adding a community another product already gates saves without the dialog', async ({
    page,
  }) => {
    test.skip(!createdId, 'needs the product the first case created');
    // The API agrees: nothing newly locks.
    expect(
      await lockPreviewAs(users.demoAdmin, {
        productId: createdId,
        communityIds: [communities.gated],
      }),
    ).toEqual([]);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${createdId}/editar`);
    await expect(page.getByRole('heading', { name: S.form.editTitle })).toBeVisible();
    await expect(page.locator('#product-price')).toHaveValue('19,90');
    // Clean: nothing to save yet.
    await expect(submit(page)).toBeDisabled();

    await pick(page, [names.gated], S.form.communities.change);
    await submit(page).click();
    await expect(toast(page, S.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/loja/${createdId}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await productLinkIds(createdId)).toEqual([communities.open, communities.gated].sort());
  });

  test('E12 long-text: five newly gated communities are all named with their counts; "Voltar" keeps the selection', async ({
    page,
  }, testInfo) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/novo`);
    const name = `${prefix} Cinco`;
    await page.locator('#product-name').fill(name);
    await page.locator('#product-price').fill('0');
    await page.locator('#product-price').press('Tab');
    await pick(page, names.five, S.form.communities.choose);
    await expect(form(page).locator('[data-product-community]')).toHaveCount(5);

    const expected = await lockPreviewAs(users.demoAdmin, { communityIds: communities.five });
    expect(expected.map((item) => item.communityId).sort()).toEqual([...communities.five].sort());
    const nameOf = (id: string) => names.five[communities.five.indexOf(id)] ?? '';
    const words = lockBody(expected, nameOf);

    await submit(page).click();
    const dialog = page.getByRole('dialog', { name: words.title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(words.body);
    for (const community of names.five) await expect(dialog).toContainText(community);

    const confirm = dialog.getByRole('button', { name: S.lockWarning.many.confirm, exact: true });
    const back = dialog.getByRole('button', { name: S.lockWarning.cancel, exact: true });
    if (isMobile(testInfo)) {
      // E12 overflow at the narrowest phone: both buttons stay on screen and tappable.
      await page.setViewportSize({ width: 320, height: 568 });
      await expect(confirm).toBeInViewport();
      await expect(back).toBeInViewport();
    }

    await back.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(form(page).locator('[data-product-community]')).toHaveCount(5);
    await expect(page).toHaveURL(/\/loja\/novo$/);
    expect(await productByName(name)).toBeNull();
  });

  test('UI-D-383: the price field refuses "19.90" and "100.000,01"', async ({ page }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/novo`);
    await page.locator('#product-name').fill(`${prefix} Preço`);

    await page.locator('#product-price').fill('19.90');
    await page.locator('#product-price').press('Tab');
    await expect(page.locator('#product-price-error')).toHaveText(S.form.errors.priceInvalid);
    await expect(submit(page)).toBeDisabled();

    await page.locator('#product-price').fill('100.000,01');
    await page.locator('#product-price').press('Tab');
    await expect(page.locator('#product-price-error')).toHaveText(S.form.errors.priceTooHigh);
    await expect(submit(page)).toBeDisabled();

    await page.locator('#product-price').fill('100.000,00');
    await page.locator('#product-price').press('Tab');
    await expect(page.locator('#product-price-error')).toHaveCount(0);
    await expect(submit(page)).toBeEnabled();
  });

  test('UI-D-377: archive, then reactivate, through the form', async ({ page }) => {
    test.skip(!createdId, 'needs the product the first case created');
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${createdId}/editar`);

    await form(page).getByRole('button', { name: S.form.archive }).click();
    const archive = page.getByRole('dialog', { name: S.form.archiveDialog.title });
    await archive.getByRole('button', { name: S.form.archiveDialog.confirm, exact: true }).click();
    await expect(toast(page, S.toasts.archived)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/loja/${createdId}$`));
    await expect(page.getByText(S.product.archived.note)).toBeVisible();
    await expect.poll(() => productStatus(createdId)).toBe('archived');

    await page.goto(`${hosts.demo}/loja/${createdId}/editar`);
    await form(page).getByRole('button', { name: S.form.reactivate }).click();
    const reactivate = page.getByRole('dialog', { name: S.form.reactivateDialog.title });
    await reactivate
      .getByRole('button', { name: S.form.reactivateDialog.confirm, exact: true })
      .click();
    await expect(toast(page, S.toasts.reactivated)).toBeVisible();
    await expect.poll(() => productStatus(createdId)).toBe('active');
    // Neither write touched the links.
    expect(await productLinkIds(createdId)).toEqual([communities.open, communities.gated].sort());
  });

  test('D-363 / UI-D-379: the community edit form shows its products read-only, or "Aberta para todos os membros."', async ({
    page,
  }) => {
    test.skip(!createdId, 'needs the product the first case created');
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${communities.gated}/editar`);

    const block = page.locator('[data-community-access]');
    await expect(block).toContainText(ACCESS.label);
    // Newest product first (the API's order); the archived one carries the suffix.
    await expect(page.locator('[data-community-access-value]')).toHaveText(
      fill(ACCESS.value, {
        products: LIST.format([names.created, `${names.other}${ACCESS.archivedSuffix}`]),
      }),
    );
    await expect(block.getByRole('link', { name: names.created })).toHaveAttribute(
      'href',
      `/loja/${createdId}`,
    );
    await expect(block).toContainText(ACCESS.helper);
    await expect(block.locator('input, textarea, button, select')).toHaveCount(0);

    await page.goto(`${hosts.demo}/comunidades/${communities.free}/editar`);
    await expect(page.locator('[data-community-access-value]')).toHaveText(ACCESS.open);
  });

  test('T-08.2-45: a member opening the form routes gets the not-found page', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/novo`);
    await expect(page.getByText(S.notFound.title)).toBeVisible();
    await expect(page.locator('[data-product-form]')).toHaveCount(0);
    if (createdId) {
      await page.goto(`${hosts.demo}/loja/${createdId}/editar`);
      await expect(page.getByText(S.notFound.title)).toBeVisible();
      await expect(page.locator('[data-product-form]')).toHaveCount(0);
    }
  });
});

/**
 * 08.2-11 — "Compradores" and "Conceder acesso" (D-359, D-360, UI-D-380, UI-D-381), on the phone
 * and the desktop, serial inside each project: the rows the first cases change are the ones the
 * later cases read.
 *
 * The holders are THROWAWAY members of rede-demo (never the seeded users, which the whole suite
 * shares): one buys through the REAL purchase route (a genuine paid order and `purchase`
 * entitlement), one is granted by the fixture, one carries a 60-character name for the 320px
 * backstop, and one is granted through the UI after being found by e-mail. Each later signs in to
 * prove what the grant or the revoke did to their community (D-359, D-360).
 *
 * E15 partial: the grant action's request is rewritten in flight to carry a rede-lab membership id;
 * the API's bare 404 must surface as the member-gone toast and write nothing.
 */
test.describe('buyers', () => {
  test.skip(isRemote, 'the store fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const PASSWORD = 'Segredo123';
  const run = Date.now().toString(36);
  let prefix = '';
  let productId = '';
  let communityId = '';
  let productName = '';
  const who = {
    buyer: { email: '', name: '' },
    granted: { email: '', name: '' },
    long: { email: '', name: '' },
    found: { email: '', name: '' },
    spoof: { email: '', name: '' },
  };
  const captions = { post: '' };

  /** Today in the tenant's zone, the way the rows print it (`dd/MM/yyyy`). */
  const today = () =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date());

  const buyersUrl = () => `${hosts.demo}/loja/${productId}/compradores`;
  const rowOf = (page: Page, name: string) =>
    page.locator('[data-buyer-row]').filter({ has: page.getByText(name, { exact: true }) });
  const count = (page: Page) => page.locator('[data-buyers-count]');
  const toast = (page: Page, message: string) =>
    page.getByRole('status').filter({ hasText: message });
  const grantButton = (page: Page) =>
    page.getByRole('button', { name: S.buyers.grant, exact: true });

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    const project = testInfo.project.name;
    prefix = `e2e-by-${project}-${run}`;
    await deleteProductsByPrefix(`e2e-by-${project}-`);
    await deleteReelsFixtures(`e2e-by-${project}-`);

    communityId = await createCommunityAs(users.demoAdmin, 'rede-demo', `${prefix} Clube`, {
      minutesAgo: 30,
    });
    captions.post = `${prefix} publicacao exclusiva`;
    await createCommunityPostAs(users.demoAdmin, 'rede-demo', `${prefix} amostra`, {
      communityId,
      minutesAgo: 9,
    });
    await createCommunityPostAs(users.demoAdmin, 'rede-demo', captions.post, {
      communityId,
      minutesAgo: 10,
    });
    productName = `${prefix} Mentoria`;
    productId = await createProduct({
      tenantSlug: 'rede-demo',
      name: productName,
      priceCents: 1990,
      communityIds: [communityId],
    });

    // `zz-` e-mails and "Zz" names keep these rows at the END of the Membros list, out of the way
    // of the admin-members spec, which reads the top of that list.
    const stamp = `${project.slice(0, 1)}${run}`;
    for (const key of Object.keys(who) as (keyof typeof who)[]) {
      who[key].email = `zz-e2e-by-${stamp}-${key}@rede-demo.local`;
      who[key].name = `Zz ${stamp} ${key}`;
    }
    who.long.name = `Zz ${stamp} Maria Aparecida dos Santos `.padEnd(60, 'n');
    expect(who.long.name).toHaveLength(60);
    for (const member of Object.values(who)) {
      await deleteUserByEmail(member.email);
      await createMember(member.email, PASSWORD, 'rede-demo');
      await setMemberDisplayName(member.email, 'rede-demo', member.name);
    }

    // Oldest first: the purchase, then the two fixture grants (the list is newest first).
    await purchaseAs(who.buyer.email, PASSWORD, productId, 1990);
    await grantEntitlement(who.granted.email, productId);
    await grantEntitlement(who.long.email, productId);
  });

  test.afterAll(async () => {
    // The ledgers reference the users without a cascade: products (and their ledgers) go first.
    await deleteProductsByPrefix(prefix);
    await deleteReelsFixtures(prefix);
    for (const member of Object.values(who)) {
      if (member.email) await deleteUserByEmail(member.email);
    }
    await closeStoreAdmin();
    await closeAdmin();
  });

  test('D-360 / UI-D-380: the manage card opens Compradores; purchase and grants with their tags and dates, newest first', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/${productId}`);
    await page.locator('[data-store-manage-buyers]').click();
    await expect(page).toHaveURL(new RegExp(`/loja/${productId}/compradores$`));

    await expect(page.getByRole('heading', { name: S.buyers.title })).toBeVisible();
    await expect(page.locator('[data-buyers-product]')).toHaveText(productName);
    await expect(count(page)).toHaveText(tStore('buyers.count', { count: 3 }));
    await expect(grantButton(page)).toBeVisible();

    const list = page.getByRole('list', { name: fill(S.buyers.region, { product: productName }) });
    await expect(list.locator('[data-buyer-name]')).toHaveText([
      who.long.name,
      who.granted.name,
      who.buyer.name,
    ]);
    const bought = rowOf(page, who.buyer.name);
    await expect(bought.locator('[data-buyer-tag]')).toHaveText(S.buyers.tag.purchase);
    await expect(bought).toContainText(fill(S.buyers.meta.purchase, { date: today() }));
    const granted = rowOf(page, who.granted.name);
    await expect(granted.locator('[data-buyer-tag]')).toHaveText(S.buyers.tag.grant);
    await expect(granted).toContainText(fill(S.buyers.meta.grant, { date: today() }));
    await expect(
      page.getByRole('button', { name: fill(S.buyers.revoke.label, { name: who.buyer.name }) }),
    ).toBeVisible();
  });

  test('D-359: revoking the purchase removes the row, and the buyer is locked out with "Comprar" back', async ({
    page,
    browser,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(buyersUrl());
    await page
      .getByRole('button', { name: fill(S.buyers.revoke.label, { name: who.buyer.name }) })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName(
      fill(S.buyers.revoke.title, { name: who.buyer.name }),
    );
    await expect(dialog).toContainText(
      fill(S.buyers.revoke.purchase, { name: who.buyer.name, product: productName }),
    );
    await dialog.getByRole('button', { name: S.buyers.revoke.confirm, exact: true }).click();

    await expect(toast(page, fill(S.buyers.revoke.done, { name: who.buyer.name }))).toBeVisible();
    await expect(rowOf(page, who.buyer.name)).toHaveCount(0);
    await expect(count(page)).toHaveText(tStore('buyers.count', { count: 2 }));
    // The last row left: focus moves to the revoke control of the row above it (UI-D-386).
    await expect(
      page.getByRole('button', { name: fill(S.buyers.revoke.label, { name: who.granted.name }) }),
    ).toBeFocused();
    // Both ledger rows stay as history, revoked (D-359).
    await expect
      .poll(() => entitlementsFor(productId, who.buyer.email))
      .toEqual([{ source: 'purchase', status: 'revoked' }]);
    await expect
      .poll(() => ordersFor(productId, who.buyer.email))
      .toEqual([{ status: 'revoked', amountCents: 1990, provider: 'none' }]);

    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const member = await context.newPage();
      await login(member, who.buyer.email, PASSWORD, hosts.demo);
      await member.goto(`${hosts.demo}/comunidades/${communityId}`);
      await expect(member.getByTestId('locked-section')).toBeVisible();
      await expect(member.getByRole('article').filter({ hasText: captions.post })).toHaveCount(0);
      await member.goto(`${hosts.demo}/loja/${productId}`);
      await expect(member.getByRole('button', { name: S.product.buy, exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('D-360 / UI-D-381: a member found by e-mail is granted, the row comes in as "Concedido" and their community opens', async ({
    page,
    browser,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(buyersUrl());
    await grantButton(page).click();
    const sheet = page.getByRole('dialog', { name: S.grant.title, exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(fill(S.grant.helper, { product: productName }));
    await expect(sheet).toContainText(S.grant.hint);
    const field = sheet.getByRole('searchbox', { name: S.grant.search });
    await expect(field).toBeFocused();
    await field.fill(who.found.email);
    await sheet.getByRole('button', { name: fill(S.grant.row, { name: who.found.name }) }).click();

    const confirm = page.getByRole('dialog', {
      name: fill(S.grant.confirm.title, { name: who.found.name }),
    });
    await expect(confirm).toContainText(
      fill(S.grant.confirm.body, { name: who.found.name, product: productName }),
    );
    await confirm.getByRole('button', { name: S.grant.confirm.confirm, exact: true }).click();

    await expect(toast(page, fill(S.grant.done, { name: who.found.name }))).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('[data-buyer-name]').first()).toHaveText(who.found.name);
    const row = rowOf(page, who.found.name);
    await expect(row.locator('[data-buyer-tag]')).toHaveText(S.buyers.tag.grant);
    await expect(row).toContainText(fill(S.buyers.meta.grant, { date: today() }));
    await expect(count(page)).toHaveText(tStore('buyers.count', { count: 3 }));
    await expect(grantButton(page)).toBeFocused();
    await expect
      .poll(() => entitlementsFor(productId, who.found.email))
      .toEqual([{ source: 'grant', status: 'active' }]);

    // The list read back from the server agrees.
    await page.reload();
    await expect(page.locator('[data-buyer-name]').first()).toHaveText(who.found.name);

    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const member = await context.newPage();
      await login(member, who.found.email, PASSWORD, hosts.demo);
      await member.goto(`${hosts.demo}/comunidades/${communityId}`);
      await expect(member.getByRole('article').filter({ hasText: captions.post })).toBeVisible();
      await expect(member.getByTestId('locked-section')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('D-360: granting the same member again toasts that they already have access and keeps the sheet', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(buyersUrl());
    await grantButton(page).click();
    const sheet = page.getByRole('dialog', { name: S.grant.title, exact: true });
    await sheet.getByRole('searchbox', { name: S.grant.search }).fill(who.found.email);
    await sheet.getByRole('button', { name: fill(S.grant.row, { name: who.found.name }) }).click();
    await page
      .getByRole('dialog', { name: fill(S.grant.confirm.title, { name: who.found.name }) })
      .getByRole('button', { name: S.grant.confirm.confirm, exact: true })
      .click();

    await expect(toast(page, fill(S.grant.already, { name: who.found.name }))).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(count(page)).toHaveText(tStore('buyers.count', { count: 3 }));
    await expect
      .poll(() => entitlementsFor(productId, who.found.email))
      .toEqual([{ source: 'grant', status: 'active' }]);
  });

  test('E15 partial / T-08.2-50: a rede-lab membership id through the grant action is the member-gone toast and writes nothing', async ({
    page,
  }) => {
    const demoId = await membershipIdFor(who.spoof.email, 'rede-demo');
    const labId = await membershipIdFor(users.labMember, 'rede-lab');
    let rewritten = 0;
    await page.route(
      (url) => url.pathname.endsWith('/compradores'),
      async (route) => {
        const request = route.request();
        const body = request.postData();
        if (request.method() === 'POST' && body?.includes(demoId)) {
          rewritten += 1;
          await route.continue({ postData: body.replaceAll(demoId, labId) });
          return;
        }
        await route.continue();
      },
    );

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(buyersUrl());
    await grantButton(page).click();
    const sheet = page.getByRole('dialog', { name: S.grant.title, exact: true });
    await sheet.getByRole('searchbox', { name: S.grant.search }).fill(who.spoof.email);
    await sheet.getByRole('button', { name: fill(S.grant.row, { name: who.spoof.name }) }).click();
    await page
      .getByRole('dialog', { name: fill(S.grant.confirm.title, { name: who.spoof.name }) })
      .getByRole('button', { name: S.grant.confirm.confirm, exact: true })
      .click();

    await expect(toast(page, fill(S.grant.errors.gone, { tenant: 'Rede Demo' }))).toBeVisible();
    expect(rewritten).toBe(1);
    await expect(toast(page, fill(S.grant.done, { name: who.spoof.name }))).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(count(page)).toHaveText(tStore('buyers.count', { count: 3 }));
    expect(await entitlementsFor(productId, users.labMember)).toEqual([]);
    expect(await entitlementsFor(productId, who.spoof.email)).toEqual([]);
  });

  test('E14 long-text: at 320px a 60-character name truncates; the "Concedido" tag and the 44px revoke control stay whole', async ({
    page,
  }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 720 });
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(buyersUrl());
    const row = rowOf(page, who.long.name);
    await expect(row).toBeVisible();
    await expect
      .poll(() =>
        row.locator('[data-buyer-name]').evaluate((node) => node.scrollWidth > node.clientWidth),
      )
      .toBe(true);
    const tag = row.locator('[data-buyer-tag]');
    await expect(tag).toHaveText(S.buyers.tag.grant);
    const control = row.getByRole('button', {
      name: fill(S.buyers.revoke.label, { name: who.long.name }),
    });
    for (const box of [await tag.boundingBox(), await control.boundingBox()]) {
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    const controlBox = await control.boundingBox();
    expect(controlBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The tag is never squeezed: its text is not clipped.
    expect(await tag.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });

  test('T-08.2-47: a member opening Compradores gets the not-found page', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(buyersUrl());
    await expect(page.getByText(S.notFound.title)).toBeVisible();
    await expect(page.locator('[data-buyer-row]')).toHaveCount(0);
    await expect(grantButton(page)).toHaveCount(0);
  });
});

/**
 * A landscape PNG built in memory (08.2-12, E11 media): three vertical bands, so a centre crop keeps
 * the middle one. No image fixture of the repo is landscape, and a stored one would be one more
 * binary to keep; `node:zlib` has both the deflate and the CRC the format needs.
 */
function landscapePng(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    const band =
      x < width / 3 ? [40, 40, 40] : x < (2 * width) / 3 ? [124, 58, 237] : [230, 230, 230];
    row.set(band, 1 + x * 3);
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no box');
  return box;
}

/** The rendered geometry of an image inside its 4:5 box: the box ratio and the image's fit. */
async function cropOf(box: Locator): Promise<{
  ratio: number;
  fit: string;
  position: string;
  landscape: boolean;
}> {
  await expect(box).toBeVisible();
  const img = box.locator('img').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const { width, height } = await boxOf(box);
  return img.evaluate((node, ratio) => {
    const image = node as HTMLImageElement;
    const style = getComputedStyle(image);
    return {
      ratio,
      fit: style.objectFit,
      position: style.objectPosition,
      landscape: image.naturalWidth > image.naturalHeight,
    };
  }, width / height);
}

/**
 * 08.2-12 — the phase's backstops (VALIDATION "backstop" truths of plans 07-11 and the edge items
 * P65/P86 authored in 08.2-09), one case per id. The ids already proven by an earlier describe are
 * titled there and not duplicated here:
 *  - E04 long-text → `browse` "E04 long-text …";
 *  - E07 overflow → `locked community` "UI-D-373 / … / E07 overflow …" (no feed request while
 *    scrolling, no hidden caption or media id in the HTML);
 *  - E10 partial and P65 → `locked community` "… E10 partial share …" (`-g share`) and
 *    "… E10 partial / P65 revoke …" (`-g revoke`);
 *  - E12 long-text (five communities) → `product admin` "E12 long-text …";
 *  - E14 long-text and E15 partial → `buyers` "E14 long-text …" and "E15 partial …".
 *
 * Fixtures are per project and run (`e2e-st-bk-<project>-<run>`), swept at the start and removed in
 * `afterAll`, the Storage copies of `createLockedCommunityWithMedia` included.
 */
test.describe('backstops', () => {
  test.skip(isRemote, 'the store fixtures write rows through the local database');

  const run = Date.now().toString(36);
  let prefix = '';
  let stopWorker: (() => Promise<void>) | null = null;
  const e03 = { image: '', plain: '' };
  const e06 = { id: '', name: '' };
  const e08: { video: LockedMediaCommunity | null; gallery: LockedMediaCommunity | null } = {
    video: null,
    gallery: null,
  };
  const p86 = { community: '', product: '', hidden: '' };
  const e12 = { names: [] as string[] };
  const CAP = 10_000_000;

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    const project = testInfo.project.name;
    prefix = `e2e-st-bk-${project}-${run}`;
    await deleteProductsByPrefix(`e2e-st-bk-${project}-`);
    await deleteReelsFixtures(`e2e-st-bk-${project}-`);

    // E08: the sample is a video (+ PDF) in one community and a two-image gallery (+ PDF) in the
    // other; a post holds one band or the other, never both.
    e08.video = await createLockedCommunityWithMedia({
      tenantSlug: 'rede-demo',
      authorEmail: users.demoAdmin,
      name: `${prefix} E08 video`,
      sample: 'video',
      priceCents: 1990,
    });
    e08.gallery = await createLockedCommunityWithMedia({
      tenantSlug: 'rede-demo',
      authorEmail: users.demoAdmin,
      name: `${prefix} E08 galeria`,
      sample: 'gallery',
      priceCents: 1990,
    });

    // P86: one locked community bought from a second page.
    p86.community = await createCommunityAs(users.demoAdmin, 'rede-demo', `${prefix} P86`, {
      minutesAgo: 30,
    });
    p86.hidden = `${prefix} P86 oculto`;
    await createCommunityPostAs(users.demoAdmin, 'rede-demo', p86.hidden, {
      communityId: p86.community,
      minutesAgo: 9,
    });
    await createCommunityPostAs(users.demoAdmin, 'rede-demo', `${prefix} P86 amostra`, {
      communityId: p86.community,
      minutesAgo: 8,
    });
    p86.product = await createProduct({
      tenantSlug: 'rede-demo',
      name: `${prefix} P86 Produto`,
      priceCents: 1500,
      communityIds: [p86.community],
    });

    if (!isMobile(testInfo)) return;

    // E03: two 80-character names at the price cap, one card per branch (image, gradient).
    e03.image = `${prefix} E03 com imagem `.padEnd(80, 'x');
    e03.plain = `${prefix} E03 sem imagem `.padEnd(80, 'x');
    await createProduct({
      tenantSlug: 'rede-demo',
      name: e03.image,
      priceCents: CAP,
      imageAssetId: e08.gallery.imageAssetIds[0] ?? null,
    });
    await createProduct({ tenantSlug: 'rede-demo', name: e03.plain, priceCents: CAP });

    // E12 overflow: ten open communities a new product would gate at once.
    for (let index = 1; index <= 10; index += 1) {
      const name = `${prefix} Dez ${String(index).padStart(2, '0')}`;
      e12.names.push(name);
      await createCommunityAs(users.demoAdmin, 'rede-demo', name);
    }

    // E06: a 60-character community gated only by an ARCHIVED product (both tags), with posts.
    // Created LAST and with fresh activity, so it heads the list's first page (newest activity).
    e06.name = `${prefix} E06 `.padEnd(60, 'n');
    e06.id = await createCommunityAs(users.demoAdmin, 'rede-demo', e06.name);
    for (const index of [1, 2, 3]) {
      await createCommunityPostAs(users.demoAdmin, 'rede-demo', `${prefix} E06 post ${index}`, {
        communityId: e06.id,
      });
    }
    await createProduct({
      tenantSlug: 'rede-demo',
      name: `${prefix} E06 Produto`,
      priceCents: 990,
      status: 'archived',
      communityIds: [e06.id],
    });
  });

  test.afterAll(async () => {
    await stopWorker?.();
    await deleteProductsByPrefix(prefix);
    await deleteReelsFixtures(prefix);
    await deleteCommunitiesByPrefix(prefix);
    await deleteCopiedMedia();
    await closeStoreAdmin();
    await closeAdmin();
  });

  test('E01 overflow: at 320px the tenant logo, the three slots and the avatar sit on one line without overlap', async ({
    page,
  }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    const bar = page.locator('[data-shell-topbar]');
    const logo = bar.locator('[data-tenant-logo] img');
    await expect(logo).toBeVisible();
    // The seeded logo is a 240x64 wordmark: 150px wide at the bar's 40px height, wider than the
    // UI-SPEC's 120px, so this case cannot pass on a narrow logo.
    const natural = await logo.evaluate((node) => {
      const image = node as HTMLImageElement;
      return (image.naturalWidth / image.naturalHeight) * 40;
    });
    expect(natural).toBeGreaterThanOrEqual(120);

    const slots = bar.locator('a[data-slot]');
    await expect(slots).toHaveCount(3);
    expect(
      await slots.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(['/loja', '/notificacoes', '/suporte']);
    const avatar = bar.locator('a[href="/perfil"]');
    const brand = await boxOf(bar.locator('[data-shell-brand]'));
    const image = await boxOf(logo);
    const row = [
      brand,
      ...(await Promise.all([0, 1, 2].map((index) => boxOf(slots.nth(index))))),
      await boxOf(avatar),
    ];

    // Left to right with no overlap, all inside the 320px screen, one line.
    for (const [index, box] of row.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      const next = row[index + 1];
      if (next) expect(box.x + box.width).toBeLessThanOrEqual(next.x + 0.5);
      expect(Math.abs(box.y + box.height / 2 - (brand.y + brand.height / 2))).toBeLessThan(2);
    }
    // The logo is drawn inside its link (never under the slots), and every slot keeps 44px.
    expect(image.x).toBeGreaterThanOrEqual(brand.x - 0.5);
    expect(image.x + image.width).toBeLessThanOrEqual(brand.x + brand.width + 0.5);
    for (const index of [1, 2, 3]) expect(row[index]?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('E03 long-text: at 320px an 80-character name clamps and "R$ 100.000,00" stays on one line, with and without an image', async ({
    page,
  }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja`);

    for (const [name, branch] of [
      [e03.image, 'product-card-image'],
      [e03.plain, 'product-card-fallback'],
    ] as const) {
      const card = page.getByRole('link', { name: `${name}, ${formatBrl(CAP)}`, exact: true });
      await expect(card).toBeVisible();
      await expect(card.getByTestId(branch)).toBeVisible();
      const outer = await boxOf(card);
      // Two columns at 320px: a ~138px card.
      expect(outer.width).toBeLessThanOrEqual(140);

      const price = card.getByTestId('product-card-price');
      await expect(price).toHaveText(formatBrl(CAP));
      const lines = await price.evaluate((node) => {
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
        return Math.round(node.getBoundingClientRect().height / lineHeight);
      });
      expect(lines).toBe(1);
      const priceBox = await boxOf(price);
      expect(priceBox.x).toBeGreaterThanOrEqual(outer.x);
      expect(priceBox.x + priceBox.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);

      const title = card.getByTestId('product-card-name');
      expect(await title.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      const titleLines = await title.evaluate((node) => {
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
        return Math.round(node.getBoundingClientRect().height / lineHeight);
      });
      expect(titleLines).toBe(2);
    }
  });

  test('E06 long-text: at 320px a 60-character community with "Exclusiva" and "Produto arquivado" keeps its counts row on one line', async ({
    page,
  }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades`);

    const card = page.getByTestId('community-card').filter({ hasText: e06.name });
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('exclusive-badge')).toHaveText(TAGS.exclusive);
    const outer = await boxOf(card);

    // The name truncates on the cover instead of wrapping.
    const title = card.getByText(e06.name, { exact: true });
    expect(await title.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

    // The counts row: the count, the archived pill and the chevron on one line, inside the card.
    const pill = card.getByText(TAGS.productArchived, { exact: true });
    await expect(pill).toBeVisible();
    const count = card.getByText(/^3 publicações$/);
    await expect(count).toBeAttached();
    const countBox = await boxOf(count);
    const pillBox = await boxOf(pill);
    expect(
      Math.abs(countBox.y + countBox.height / 2 - (pillBox.y + pillBox.height / 2)),
    ).toBeLessThan(2);
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(pillBox.x + 0.5);
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(outer.x + outer.width);
    // The pill is never squeezed, and the count is readable (at worst truncated, never wrapped).
    expect(await pill.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const countLines = await count.evaluate((node) => {
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      return Math.round(node.getBoundingClientRect().height / lineHeight);
    });
    expect(countLines).toBe(1);
    expect(countBox.width).toBeGreaterThan(30);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('E08 media: on the locked sample a video gets its playback token, the gallery carousel moves and the PDF downloads, for a member without access', async ({
    page,
  }) => {
    const video = e08.video;
    const gallery = e08.gallery;
    if (!video || !gallery) throw new Error('the E08 fixtures were not created');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The video sample.
    await page.goto(`${hosts.demo}/comunidades/${video.communityId}`);
    await expect(page.getByTestId('locked-section')).toBeVisible();
    const videoSample = page.getByRole('article').filter({ hasText: video.sampleCaption });
    await expect(videoSample).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    expect(await page.content()).not.toContain(video.hiddenCaption);
    await videoSample.scrollIntoViewIfNeeded();
    const player = videoSample.locator('mux-player').first();
    await expect(player).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          player.evaluate(
            (node) =>
              (node as unknown as { tokens?: { playback?: string } }).tokens?.playback ?? '',
          ),
        { timeout: 20_000 },
      )
      .not.toBe('');
    await expect(videoSample.getByTestId('video-ready')).not.toContainText(/error|401|403/i);

    const download = fill(FEED.attachment.download, { name: video.attachmentFilename });
    const downloading = page.waitForEvent('download');
    await videoSample.getByRole('button', { name: download, exact: true }).click();
    expect((await downloading).suggestedFilename()).toBe(video.attachmentFilename);

    // The gallery sample: two real images, the second reached through the carousel.
    await page.goto(`${hosts.demo}/comunidades/${gallery.communityId}`);
    await expect(page.getByTestId('locked-section')).toBeVisible();
    const gallerySample = page.getByRole('article').filter({ hasText: gallery.sampleCaption });
    await expect(gallerySample).toBeVisible();
    const slides = gallerySample.getByTestId('post-gallery-slide');
    await expect(slides).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect
        .poll(
          () =>
            slides
              .nth(index)
              .locator('img')
              .first()
              .evaluate((node) => (node as HTMLImageElement).naturalWidth),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    }
    const live = gallerySample.getByTestId('post-gallery-live');
    await expect(live).toHaveText(fill(FEED.gallery.slide, { index: '1', total: '2' }));
    await gallerySample.getByTestId('post-gallery-strip').focus();
    await page.keyboard.press('ArrowRight');
    await expect(live).toHaveText(fill(FEED.gallery.slide, { index: '2', total: '2' }));
    await expect(slides.nth(1)).toBeInViewport({ ratio: 0.5 });

    const downloadingPdf = page.waitForEvent('download');
    await gallerySample
      .getByRole('button', {
        name: fill(FEED.attachment.download, { name: gallery.attachmentFilename }),
        exact: true,
      })
      .click();
    expect((await downloadingPdf).suggestedFilename()).toBe(gallery.attachmentFilename);
    expect(await page.content()).not.toContain(gallery.hiddenCaption);
  });

  test('E11 media: a landscape upload shows the same 4:5 centre crop in the form, the card and the product page', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    stopWorker ??= await ensureWorker();
    const name = `${prefix} E11 Paisagem`;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/novo`);

    const since = new Date(Date.now() - 1_000);
    const choosing = page.waitForEvent('filechooser');
    await page
      .locator('[data-product-form]')
      .locator('button', { hasText: S.form.image.add })
      .click();
    await (await choosing).setFiles({
      name: 'paisagem.png',
      mimeType: 'image/png',
      buffer: landscapePng(1200, 600),
    });
    const preview = page.locator('[data-product-image-preview]');
    await expect(page.locator('[data-product-image-local]')).toBeVisible({ timeout: 60_000 });
    const local = await cropOf(preview);
    const coverId = await waitForReadyCoverIn('rede-demo', since);

    await page.locator('#product-name').fill(name);
    await page.locator('#product-price').fill('0');
    await page.locator('#product-price').press('Tab');
    await page.locator('[data-product-form] button[type="submit"]').click();
    await expect(page.getByRole('status').filter({ hasText: S.toasts.created })).toBeVisible();
    await expect(page).toHaveURL(/\/loja\/[0-9a-f-]{36}$/);
    const saved = await productByName(name);
    expect(saved?.imageAssetId).toBe(coverId);

    const onPage = await cropOf(page.getByTestId('store-product-image'));

    await page.goto(`${hosts.demo}/loja`);
    const card = page.getByRole('link', { name: `${name}, ${S.price.free}`, exact: true });
    await expect(card).toBeVisible();
    const onCard = await cropOf(card.getByTestId('product-card-image'));

    await page.goto(`${hosts.demo}/loja/${saved?.id}/editar`);
    const onForm = await cropOf(page.locator('[data-product-image-preview]'));

    for (const crop of [local, onForm, onCard, onPage]) {
      expect(crop.ratio).toBeCloseTo(0.8, 1);
      expect(Math.abs(crop.ratio - 0.8)).toBeLessThan(0.02);
      expect(crop.fit).toBe('cover');
      expect(crop.position).toBe('50% 50%');
      expect(crop.landscape).toBe(true);
    }
  });

  test('E12 overflow: ten newly gated communities at 320px stay inside the dialog and both buttons stay on screen', async ({
    page,
  }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 568 });
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/loja/novo`);
    const form = page.locator('[data-product-form]');
    const name = `${prefix} Dez Produto`;
    await page.locator('#product-name').fill(name);
    await page.locator('#product-price').fill('0');
    await page.locator('#product-price').press('Tab');

    await form.getByRole('button', { name: S.form.communities.choose, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: S.form.picker.title });
    await expect(sheet).toBeVisible();
    for (const community of e12.names) {
      await sheet.getByRole('button', { name: fill(S.form.picker.rowOff, { community }) }).click();
      await expect(
        sheet.getByRole('button', { name: fill(S.form.picker.rowOn, { community }) }),
      ).toBeVisible();
    }
    await sheet.getByRole('button', { name: S.form.picker.done }).click();
    await expect(sheet).toHaveCount(0);
    await expect(form.locator('[data-product-community]')).toHaveCount(10);

    await form.locator('button[type="submit"]').click();
    const dialog = page.getByRole('dialog', {
      name: tStore('lockWarning.many.title', { count: 10 }),
    });
    await expect(dialog).toBeVisible();
    const text = (await dialog.textContent()) ?? '';
    for (const community of e12.names) expect(text).toContain(community);

    const confirm = dialog.getByRole('button', { name: S.lockWarning.many.confirm, exact: true });
    const back = dialog.getByRole('button', { name: S.lockWarning.cancel, exact: true });
    await expect(confirm).toBeInViewport();
    await expect(back).toBeInViewport();
    const frame = await boxOf(dialog);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.y + frame.height).toBeLessThanOrEqual(568);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(320);

    // Every name can be reached inside the dialog: the body scrolls (or fits) and nothing is cut
    // at the side.
    const body = await dialog.evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
      const scroller = nodes.find(
        (node) =>
          node.scrollHeight > node.clientHeight + 1 &&
          ['auto', 'scroll'].includes(getComputedStyle(node).overflowY),
      );
      const wide = nodes.some((node) => node.scrollWidth > node.clientWidth + 1);
      return { scrolls: Boolean(scroller), fits: root.scrollHeight <= root.clientHeight + 1, wide };
    });
    expect(body.scrolls || body.fits).toBe(true);
    expect(body.wide).toBe(false);
    const last = e12.names[9] ?? '';
    await dialog.getByText(last, { exact: false }).last().scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    await expect(back).toBeInViewport();

    await back.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await productByName(name)).toBeNull();
  });

  test('P86: a purchase made in another tab is not pushed to the open locked page; a reload shows the community unlocked', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${p86.community}`);
    await expect(page.getByTestId('locked-section')).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: p86.hidden })).toHaveCount(0);

    // Page B of the SAME context (the same session) buys the product.
    const other = await page.context().newPage();
    try {
      await other.goto(`${hosts.demo}/loja/${p86.product}?comunidade=${p86.community}`);
      await other.getByRole('button', { name: S.product.buy, exact: true }).click();
      await other
        .getByRole('dialog')
        .getByRole('button', { name: S.purchase.confirm, exact: true })
        .click();
      await expect(other).toHaveURL(new RegExp(`/comunidades/${p86.community}$`));
      await expect(other.getByRole('article').filter({ hasText: p86.hidden })).toBeVisible();
    } finally {
      await other.close();
    }

    // Page A is not pushed: it still shows the locked page until the member reloads.
    await page.bringToFront();
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('locked-section')).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: p86.hidden })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('locked-section')).toHaveCount(0);
    await expect(page.locator('[data-community-tag="exclusive"]')).toHaveCount(0);
    await expect(page.getByRole('article').filter({ hasText: p86.hidden })).toBeVisible();
  });
});
