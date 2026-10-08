import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { formatBrl } from '@rede-social/contracts/money';
import appStoreMessages from '../messages/pt-BR/app.store.json' with { type: 'json' };
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import { closeAdmin, createCommunityAs } from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeStoreAdmin,
  createProduct,
  deleteCommunitiesByPrefix,
  deleteProductsByPrefix,
  grantEntitlement,
  productStatus,
  setProductStatus,
} from './store-admin';

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
