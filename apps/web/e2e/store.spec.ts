import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
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
import { closeAdmin, createCommunityAs, createVideoPostAs, deleteReelsFixtures } from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeStoreAdmin,
  createCommunityPostAs,
  createProduct,
  deleteCommunitiesByPrefix,
  deleteProductsByPrefix,
  grantEntitlement,
  lockPreviewAs,
  ordersFor,
  productByName,
  productLinkIds,
  productStatus,
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

  test('UI-D-373 / D-354 / D-356: the locked page shows the read-only sample, 3 placeholders and "+ 4" with no hidden content', async ({
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

  test('STORE-17 / UI-D-376 share: a hidden post link lands on the locked page with the "você abriu" line', async ({
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

  test('UI-D-376 revoke: a like refused mid-session toasts the locked copy and refreshes into the locked page', async ({
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
