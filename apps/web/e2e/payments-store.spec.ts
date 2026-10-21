import { expect, test } from '@playwright/test';
import { createCommunityAs, createMember } from './admin';
import { hosts, login, users } from './fixtures';
import {
  closePayments,
  connectViaUi,
  enablePayments,
  LAB,
  loginLabAdmin,
  newRunPrefix,
  openPayments,
  openUntilReady,
  PASSWORD,
  PAYMENTS_NAMESPACE,
  phoneContext,
  resetPayments,
  signedDelivery,
  waitForEventState,
} from './payments';
import {
  closeStoreAdmin,
  createProduct,
  deleteCommunitiesByPrefix,
  deleteProductsByPrefix,
  entitlementsFor,
  ordersFor,
} from './store-admin';
import { ensureWorker } from './worker';

/**
 * 09.1-19, Task 3: the store purchase through the payment page, in a browser (PAY-24, PAY-34, D-506,
 * D-508, UI-D-524, UI-D-525, UI-D-526), on the phone project against the real API, worker, database and
 * Realtime.
 *
 *   an admin maps a product to a gateway product id and a checkout link in the product form  ->  the
 *   member's product page offers "Comprar" as a new-tab link and no dialog; a product with no mapping
 *   is a disabled "Indisponível" to the member and "Sem link de pagamento" to the admin  ->  a signed
 *   approved purchase for the member's e-mail, at an amount that is NOT the listed price, refreshes the
 *   product page they have open into the owned block WITHOUT a navigation, puts "Compra confirmada" in
 *   the bell and writes one order at the gateway's amount  ->  a signed refund takes the product back.
 *
 * The store and notifications modules are turned on for rede-lab for the run and put back after.
 *
 * Copy: the owned block is the SHIPPED one ("Comprado" / "Você tem acesso a este produto."), not the
 * plan's "Você já tem este produto": finding F-2 of sketch 013, followed by plan 17.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const TOKEN = `tok-${prefix}-${Math.random().toString(36).slice(2, 12)}`;
const member = `${prefix}-buyer@rede-lab.local`;
const paidName = `${prefix} Produto pago`;
const bareName = `${prefix} Sem mapeamento`;
const paidGatewayId = `${prefix}-prod-1`;
const paidLink = `https://pay.example.test/${prefix}/produto-1`;
const order = `${prefix}-order-1`;
const GATEWAY_AMOUNT = 12_345;

let webhook = '';
let paidId = '';
let bareId = '';
let stopWorker: (() => Promise<void>) | undefined;

test.beforeAll(async ({ browser }) => {
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await enablePayments(LAB, ['store', 'notifications']);
  stopWorker = await ensureWorker();

  const communityId = await createCommunityAs(users.labAdmin, LAB, `${prefix} Clube`);
  paidId = await createProduct({
    tenantSlug: LAB,
    name: paidName,
    priceCents: 99_900,
    communityIds: [communityId],
  });
  bareId = await createProduct({ tenantSlug: LAB, name: bareName, priceCents: 1_990 });

  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await openPayments(page);
    webhook = await connectViaUi(page, TOKEN);
  } finally {
    await context.close();
  }
});

test.afterAll(async () => {
  await deleteProductsByPrefix(PAYMENTS_NAMESPACE);
  await deleteCommunitiesByPrefix(PAYMENTS_NAMESPACE);
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await stopWorker?.();
  await closeStoreAdmin();
  await closePayments();
});

test('1. the product form maps the gateway product, and the member sees a checkout link, not a dialog', async ({
  browser,
}) => {
  const adminContext = await phoneContext(browser);
  const adminPage = await adminContext.newPage();
  const memberContext = await phoneContext(browser);
  const memberPage = await memberContext.newPage();
  try {
    await loginLabAdmin(adminPage);

    // The admin types the gateway product id and an https link in the Pagamento block and saves.
    await openUntilReady(adminPage, `${hosts.lab}/loja/${paidId}/editar`, () =>
      adminPage.locator('#product-gateway-id'),
    );
    await adminPage.locator('#product-gateway-id').fill(paidGatewayId);
    await adminPage.locator('#product-checkout-url').fill(paidLink);
    await adminPage.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(adminPage).toHaveURL(new RegExp(`/loja/${paidId}$`), { timeout: 30_000 });

    // A link without an id is refused in the form (the coupling rule), before any save.
    await adminPage.goto(`${hosts.lab}/loja/${bareId}/editar`);
    await adminPage.locator('#product-checkout-url').fill(`https://pay.example.test/${prefix}/x`);
    await adminPage.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(
      adminPage.getByText('Informe o ID do produto para usar o link de compra.'),
    ).toBeVisible();
    await expect(adminPage).toHaveURL(/\/editar$/);

    // The member opens the mapped product: "Comprar" is a new-tab link, with the helper and no dialog.
    await createMember(member, PASSWORD, LAB);
    await login(memberPage, member, PASSWORD, hosts.lab);
    await openUntilReady(memberPage, `${hosts.lab}/loja/${paidId}`, () =>
      memberPage.locator('a[data-store-buy-gateway]'),
    );
    const buy = memberPage.locator('a[data-store-buy-gateway]');
    await expect(buy).toContainText('Comprar');
    await expect(buy).toHaveAttribute('href', paidLink);
    await expect(buy).toHaveAttribute('target', '_blank');
    await expect(buy).toHaveAttribute('rel', /noopener/);
    await expect(
      memberPage.getByText(
        'O valor final e a forma de pagamento aparecem na página de pagamento. Quando o pagamento for confirmado, o produto é liberado aqui.',
      ),
    ).toBeVisible();
    await expect(memberPage.getByRole('dialog')).toHaveCount(0);

    // A product with no mapping: a disabled "Indisponível" for the member, a pill for the manager.
    await memberPage.goto(`${hosts.lab}/loja/${bareId}`);
    await expect(memberPage.getByRole('button', { name: 'Indisponível' })).toBeDisabled();
    await expect(memberPage.getByText('Este produto não está à venda no momento.')).toBeVisible();
    await expect(memberPage.locator('a[data-store-buy-gateway]')).toHaveCount(0);
    await adminPage.goto(`${hosts.lab}/loja/${bareId}`);
    await expect(adminPage.getByText('Sem link de pagamento').first()).toBeVisible();
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});

test('2. a signed purchase unlocks the open product page without a reload, and a refund takes it back', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, member, PASSWORD, hosts.lab);
    await openUntilReady(page, `${hosts.lab}/loja/${paidId}`, () =>
      page.locator('a[data-store-buy-gateway]'),
    );
    // Let the shell's and the page's Realtime joins settle: a signal sent before the first join is the
    // page's own render, not a refresh.
    await page.waitForLoadState('networkidle');

    // Prove "no reload": a marker only the document that holds it can keep, and a counter of the
    // document loads (a `router.refresh()` is not one; `framenavigated` would also count same-document
    // history changes, which are not a reload either).
    const url = page.url();
    await page.evaluate(() => {
      (window as unknown as { __payMarker: string }).__payMarker = 'same-document';
    });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });

    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'purchase_approved',
        externalRef: order,
        email: member,
        productId: paidGatewayId,
        amountCents: GATEWAY_AMOUNT,
        currency: 'BRL',
        recurring: false,
      }),
    ).toBe(200);
    await waitForEventState(LAB, order, ['applied'], 'purchase_approved');

    // The page refreshes into the owned block on its own (the shipped words, finding F-2).
    await expect(page.getByText('Você tem acesso a este produto.')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('store-product-owned')).toContainText('Comprado');
    await expect(page.getByTestId('store-product-pill')).toHaveText('Comprado');
    await expect(page.locator('a[data-store-buy-gateway]')).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(loads, 'the document was loaded again').toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __payMarker?: string }).__payMarker),
      'the document was reloaded',
    ).toBe('same-document');

    // The order is the gateway's figure, not the listed price, and there is one entitlement.
    const orders = await ordersFor(paidId, member);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.amountCents).toBe(GATEWAY_AMOUNT);
    expect(orders[0]?.provider).toBe('fake');
    const held = await entitlementsFor(paidId, member);
    expect(held.filter((row) => row.status === 'active')).toHaveLength(1);

    // The bell lists "Compra confirmada", linking to the product.
    await expect
      .poll(
        async () => {
          await page.goto(`${hosts.lab}/notificacoes`);
          return page
            .locator(`a[href="/loja/${paidId}"]`)
            .filter({ hasText: 'Compra confirmada' })
            .count();
        },
        {
          message: 'the bell lists "Compra confirmada"',
          timeout: 45_000,
          intervals: [1_000, 2_000],
        },
      )
      .toBe(1);

    // A signed refund of the same sale locks the product again (D-505).
    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'purchase_refunded',
        externalRef: order,
        email: member,
        productId: paidGatewayId,
        recurring: false,
      }),
    ).toBe(200);
    await waitForEventState(LAB, order, ['applied'], 'purchase_refunded');
    await page.goto(`${hosts.lab}/loja/${paidId}`);
    await expect(page.locator('a[data-store-buy-gateway]')).toHaveAttribute('href', paidLink);
    await expect(page.getByText('Você tem acesso a este produto.')).toHaveCount(0);
    const after = await entitlementsFor(paidId, member);
    expect(after.filter((row) => row.status === 'active')).toHaveLength(0);
    expect((await ordersFor(paidId, member))[0]?.status).toBe('revoked');
  } finally {
    await context.close();
  }
});
