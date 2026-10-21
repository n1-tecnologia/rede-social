import { expect, test } from '@playwright/test';
import { createMember } from './admin';
import { hosts, login } from './fixtures';
import {
  addAccessProductViaUi,
  closePayments,
  connectViaUi,
  enablePayments,
  expectInsideViewportX,
  expectNoHorizontalScroll,
  expectTapTarget,
  gotoWhileRedirected,
  insertAccessProduct,
  insertManualAccess,
  insertStoreMapping,
  LAB,
  loginLabAdmin,
  newRunPrefix,
  openPayments,
  PASSWORD,
  PAYMENTS_NAMESPACE,
  phoneContext,
  resetPayments,
  signedDelivery,
  submitSignup,
  turnGateOnViaUi,
  waitForEventState,
} from './payments';
import {
  closeStoreAdmin,
  createProduct,
  deleteProductsByPrefix,
  entitlementsFor,
} from './store-admin';
import { ensureWorker } from './worker';

/**
 * 09.1-19, Task 2: the Pagamentos hub in a browser (Acessos, Eventos, "Liberar manualmente") and the
 * 320px long-text backstops the UI-SPEC delegated to the end-to-end suite (E02, E03, E05, E06, E07),
 * on the phone project against the real API, worker and database.
 *
 * `beforeAll` connects the test gateway, registers one access product and requires a subscription
 * through the normal screens, so every test starts from a connected, gated lab. A signed request plays
 * the gateway; long values are written straight into the tables (the harness is not a lane) because no
 * screen takes a 120-character e-mail from a gateway. Everything the run writes carries its prefix and
 * is removed in `afterAll` (and swept again in `beforeAll`).
 *
 * Long names: an access product's name is capped at 80 characters by the table CHECK (and the sheet's
 * `maxLength`), so the "120-character product name" of the UI-SPEC row is 80 characters here, the
 * longest a product can have; the 120-character values are the e-mails, which the tables allow.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const TOKEN = `tok-${prefix}-${Math.random().toString(36).slice(2, 12)}`;
const accessName = `${prefix} Assinatura`;
const gatewayProductId = `${prefix}-sub`;
const checkout = `https://pay.example.test/${prefix}`;
const DOMAIN = 'rede-lab.local';

/** An e-mail of exactly `total` characters whose local part is 64 characters and starts with the prefix. */
function longEmail(tag: string, total = 120): string {
  const local = `${prefix}-${tag}-`.padEnd(64, 'a');
  const label = 'd'.repeat(total - local.length - 1 - `.${DOMAIN}`.length);
  return `${local}@${label}.${DOMAIN}`;
}

let webhook = '';
let stopWorker: (() => Promise<void>) | undefined;

test.beforeAll(async ({ browser }) => {
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await enablePayments(LAB, ['store']);
  stopWorker = await ensureWorker();

  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await openPayments(page);
    webhook = await connectViaUi(page, TOKEN);
    await addAccessProductViaUi(page, {
      name: accessName,
      externalId: gatewayProductId,
      link: checkout,
    });
    await turnGateOnViaUi(page);
  } finally {
    await context.close();
  }
});

test.afterAll(async () => {
  await deleteProductsByPrefix(PAYMENTS_NAMESPACE);
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await stopWorker?.();
  await closeStoreAdmin();
  await closePayments();
});

test('1. the tabs are deep links, and an unknown value reads Configuração', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await openPayments(page, 'acessos');
    await expect(page.getByTestId('payments-access')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Acessos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await openPayments(page, 'eventos');
    await expect(page.getByTestId('payments-events')).toBeVisible();

    await page.goto(`${hosts.lab}/configuracoes/pagamentos?aba=desconhecida`);
    await expect(page.getByTestId('payments-setup')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // A tab is a link: pressing it navigates, and the URL is the tab.
    await page.getByRole('tab', { name: 'Eventos' }).click();
    await expect(page).toHaveURL(/aba=eventos$/);
    await expect(page.getByTestId('payments-events')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('2. Acessos lists a gateway access, blocks and unblocks it, and releases an e-mail with no account', async ({
  browser,
}) => {
  const member = `${prefix}-acc@rede-lab.local`;
  const released = `${prefix}-rel@rede-lab.local`;
  const sale = `${prefix}-acc-sale`;

  expect(
    await signedDelivery(webhook, TOKEN, {
      type: 'purchase_approved',
      externalRef: sale,
      email: member,
      productId: gatewayProductId,
      recurring: true,
    }),
  ).toBe(200);
  await waitForEventState(LAB, sale, ['applied'], 'purchase_approved');
  await createMember(member, PASSWORD, LAB);

  const memberContext = await phoneContext(browser);
  const memberPage = await memberContext.newPage();
  const adminContext = await phoneContext(browser);
  const page = await adminContext.newPage();
  const visitorContext = await phoneContext(browser);
  try {
    await login(memberPage, member, PASSWORD, hosts.lab);

    await loginLabAdmin(page);
    await openPayments(page, 'acessos');
    const row = page.locator(`[data-access-row="${member}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Ativo');
    await expect(row).not.toContainText('Manual');

    // Block it through the sheet and the danger dialog.
    await row.click();
    await expect(page.locator(`[data-access-sheet="${member}"]`)).toBeVisible();
    await page.getByRole('button', { name: 'Bloquear acesso' }).click();
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByText(`Acesso de ${member} bloqueado.`)).toBeVisible();
    await expect(row).toContainText('Bloqueado');

    // D-489: a person blocked by an admin is told they are blocked, not that they owe money.
    await gotoWhileRedirected(memberPage, `${hosts.lab}/inicio`);
    await expect(memberPage).toHaveURL(/\/acesso-suspenso/, { timeout: 30_000 });
    expect(memberPage.url()).not.toContain('assinatura-pendente');

    // Unblock restores what the gateway says.
    await row.click();
    await page.getByRole('button', { name: 'Desbloquear acesso' }).click();
    await expect(page.getByText(`Acesso de ${member} desbloqueado.`)).toBeVisible();
    await expect(row).toContainText('Ativo');
    await login(memberPage, member, PASSWORD, hosts.lab);

    // Release an e-mail that has no account yet, then that person signs up.
    await page.getByRole('button', { name: 'Liberar e-mail' }).first().click();
    await page.locator('#payments-release-email').fill(released);
    await page.getByRole('button', { name: 'Liberar acesso' }).click();
    await expect(page.getByText(`Acesso liberado para ${released}.`)).toBeVisible();
    const releasedRow = page.locator(`[data-access-row="${released}"]`);
    await expect(releasedRow).toContainText('Ainda sem conta');
    await expect(releasedRow).toContainText('Manual');

    const visitor = await visitorContext.newPage();
    await visitor.goto(`${hosts.lab}/cadastro`);
    await submitSignup(visitor, released);
    await expect(visitor).toHaveURL(/\/verifique-seu-email$/, { timeout: 60_000 });
  } finally {
    await memberContext.close();
    await adminContext.close();
    await visitorContext.close();
  }
});

test('3. Eventos shows "Sem conta" and releases the purchase by hand once the account exists', async ({
  browser,
}) => {
  const buyer = `${prefix}-noacc@rede-lab.local`;
  const storeName = `${prefix} Produto da loja`;
  const storeGatewayId = `${prefix}-store`;
  const sale = `${prefix}-evt-sale`;
  const unmappedSale = `${prefix}-evt-unmapped`;

  const productId = await createProduct({ tenantSlug: LAB, name: storeName, priceCents: 5000 });
  await insertStoreMapping({
    tenantSlug: LAB,
    storeProductId: productId,
    externalProductId: storeGatewayId,
  });

  expect(
    await signedDelivery(webhook, TOKEN, {
      type: 'purchase_approved',
      externalRef: sale,
      email: buyer,
      productId: storeGatewayId,
      amountCents: 5000,
      currency: 'BRL',
    }),
  ).toBe(200);
  await waitForEventState(LAB, sale, ['no_membership']);
  expect(
    await signedDelivery(webhook, TOKEN, {
      type: 'purchase_approved',
      externalRef: unmappedSale,
      email: `${prefix}-who@rede-lab.local`,
      productId: `${prefix}-unmapped`,
      amountCents: 1000,
      currency: 'BRL',
    }),
  ).toBe(200);
  await waitForEventState(LAB, unmappedSale, ['unknown_product']);

  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await openPayments(page, 'eventos');
    const events = page.getByRole('list', { name: 'Eventos recentes' });
    const row = events.getByRole('listitem').filter({ hasText: buyer });
    await expect(row).toContainText('Compra aprovada');
    await expect(row).toContainText('Sem conta');
    const grant = row.getByRole('button', { name: 'Liberar manualmente' });

    // No account yet: the action answers with the no-account line and changes nothing.
    await grant.click();
    await page.getByRole('button', { name: 'Liberar', exact: true }).click();
    await expect(
      page.getByText(
        'Esta pessoa ainda não tem conta em Rede Lab. Peça que crie a conta com o mesmo e-mail da compra.',
      ),
    ).toBeVisible();
    await expect(row).toContainText('Sem conta');
    expect(await entitlementsFor(productId, buyer)).toHaveLength(0);

    // The person signs up; the same action grants the product, once.
    await createMember(buyer, PASSWORD, LAB);
    await grant.click();
    await page.getByRole('button', { name: 'Liberar', exact: true }).click();
    await expect(page.getByText(`${storeName} liberado para ${buyer}.`)).toBeVisible();
    await expect(row).toContainText('Aplicado');
    await expect(row.getByRole('button', { name: 'Liberar manualmente' })).toHaveCount(0);
    const held = await entitlementsFor(productId, buyer);
    expect(held).toHaveLength(1);
    expect(held[0]?.status).toBe('active');

    // A delivery for a product nobody registered offers "Cadastrar produto".
    const unmapped = events.getByRole('listitem').filter({ hasText: `${prefix}-who@` });
    await expect(unmapped).toContainText('Produto desconhecido');
    await expect(unmapped.getByRole('link', { name: 'Cadastrar produto' })).toBeVisible();

    // PR-9: a delivery shows no payload, no signature and no header anywhere in the DOM.
    const html = await page.getByTestId('payments-events').innerHTML();
    for (const forbidden of [
      TOKEN,
      'signature',
      'authorization',
      'purchase_approved',
      'orderRef',
      '"type"',
    ]) {
      expect(html.toLowerCase(), `the Eventos DOM carries "${forbidden}"`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
    expect(await page.content()).not.toContain(TOKEN);
  } finally {
    await context.close();
  }
});

test('4. at 320px the long values keep their controls on screen (E02, E03, E05, E06, E07)', async ({
  browser,
}) => {
  const longName = `${prefix} Produto de nome muito longo `.padEnd(80, 'N');
  const longId = `${prefix}-`.padEnd(60, 'x');
  const accessEmail = longEmail('acc');
  const eventEmail = longEmail('evt');
  const eventStoreName = `${prefix} Loja com nome longo `.padEnd(80, 'L');
  const eventStoreGatewayId = `${prefix}-longstore`;
  const eventSale = `${prefix}-long-sale`;

  await insertAccessProduct({
    tenantSlug: LAB,
    name: longName,
    externalProductId: longId,
  });
  await insertManualAccess(LAB, accessEmail);
  const longStoreId = await createProduct({
    tenantSlug: LAB,
    name: eventStoreName,
    priceCents: 5000,
  });
  await insertStoreMapping({
    tenantSlug: LAB,
    storeProductId: longStoreId,
    externalProductId: eventStoreGatewayId,
  });
  expect(
    await signedDelivery(webhook, TOKEN, {
      type: 'purchase_approved',
      externalRef: eventSale,
      email: eventEmail,
      productId: eventStoreGatewayId,
      amountCents: 5000,
      currency: 'BRL',
    }),
  ).toBe(200);
  await waitForEventState(LAB, eventSale, ['no_membership']);

  const context = await phoneContext(browser, 320);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);

    // E02: a 150-character webhook URL scrolls inside its read-only field; the copy button keeps its place.
    await openPayments(page);
    const url = page.locator('#payments-webhook-url');
    await url.evaluate((element) => {
      (element as HTMLInputElement).value =
        `https://api.exemplo.com.br/v1/webhooks/fake/${'a'.repeat(106)}`;
    });
    expect(await url.inputValue()).toHaveLength(150);
    expect(
      await url.evaluate((element) => element.scrollWidth > element.clientWidth),
      'the long URL scrolls inside its field',
    ).toBe(true);
    const copy = page.getByRole('button', { name: 'Copiar URL do webhook' });
    await expectInsideViewportX(page, copy, 'E02 copy button');
    await expectTapTarget(copy);
    await expectNoHorizontalScroll(page, 'E02 Configuração');

    // E03: an 80-character name and a 60-character id keep the pills line and the chevron.
    const productRow = page.getByRole('button', { name: new RegExp(`^${prefix} Produto de nome`) });
    await expect(productRow).toBeVisible();
    await expectInsideViewportX(page, productRow, 'E03 product row');
    await expectInsideViewportX(
      page,
      productRow.getByText('Sem link de compra'),
      'E03 "Sem link de compra" pill',
    );
    await expectInsideViewportX(page, productRow.locator('svg').last(), 'E03 chevron');
    await expect(productRow.locator('svg').last()).toBeVisible();
    await expect(productRow.locator('.truncate').first()).toHaveText(longName);
    expect(
      await productRow
        .locator('.truncate')
        .first()
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      'the long product name is truncated, not wrapped over the chevron',
    ).toBe(true);
    await expectNoHorizontalScroll(page, 'E03 Configuração');

    // E05: a 64-character local part plus a long domain truncates; the chevron and the pills stay.
    expect(accessEmail).toHaveLength(120);
    await openPayments(page, 'acessos');
    const accessRow = page.locator(`[data-access-row="${accessEmail}"]`);
    await expect(accessRow).toBeVisible();
    await expectInsideViewportX(page, accessRow, 'E05 access row');
    await expectInsideViewportX(page, accessRow.locator('[data-access-pills]'), 'E05 pills');
    await expectInsideViewportX(page, accessRow.locator('svg').last(), 'E05 chevron');
    expect(
      await accessRow
        .locator('.truncate')
        .first()
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      'the long e-mail is truncated',
    ).toBe(true);
    await expectNoHorizontalScroll(page, 'E05 Acessos');

    // E06: the same address as the sheet title and in the block dialog wraps and keeps the buttons.
    await accessRow.click();
    const sheet = page.locator(`[data-access-sheet="${accessEmail}"]`);
    await expect(sheet).toBeVisible();
    const title = page.getByRole('heading', { name: accessEmail });
    await expectInsideViewportX(page, title, 'E06 sheet title');
    expect(
      await title.evaluate((el) => el.scrollWidth <= el.clientWidth),
      'the sheet title wraps instead of scrolling',
    ).toBe(true);
    await expectInsideViewportX(
      page,
      page.getByRole('button', { name: 'Bloquear acesso' }),
      'E06 block button',
    );
    await page.getByRole('button', { name: 'Bloquear acesso' }).click();
    const blockTitle = page.getByRole('heading', { name: `Bloquear ${accessEmail}?` });
    await expect(blockTitle).toBeVisible();
    await expectInsideViewportX(page, blockTitle, 'E06 dialog title');
    for (const name of ['Bloquear', 'Cancelar']) {
      const button = page.getByRole('button', { name, exact: true });
      await expectInsideViewportX(page, button, `E06 dialog "${name}"`);
      const box = await button.boundingBox();
      const height = await page.evaluate(() => window.innerHeight);
      expect(
        (box?.y ?? -1) + (box?.height ?? 0),
        `E06 "${name}" is below the screen`,
      ).toBeLessThanOrEqual(height);
    }
    await expectNoHorizontalScroll(page, 'E06 block dialog');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    // E07: a long e-mail and an 80-character product name truncate; "Liberar manualmente" stays a tap target.
    await openPayments(page, 'eventos');
    const eventRow = page
      .getByRole('list', { name: 'Eventos recentes' })
      .getByRole('listitem')
      .filter({ hasText: eventEmail.slice(0, 40) });
    await expect(eventRow).toBeVisible();
    await expectInsideViewportX(page, eventRow, 'E07 event row');
    const grant = eventRow.getByRole('button', { name: 'Liberar manualmente' });
    await expectInsideViewportX(page, grant, 'E07 "Liberar manualmente"');
    // The shipped `hitArea` of an OUTLINE `sm` button reaches 42px, not the 44px its comment claims: the
    // insets are measured from the padding box, inside the 1px border (deferred-items.md, 09.1-19).
    await expectTapTarget(grant, 42);
    expect(
      await eventRow
        .locator('.truncate')
        .first()
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      'the long e-mail of the event is truncated',
    ).toBe(true);
    await expectNoHorizontalScroll(page, 'E07 Eventos');
  } finally {
    await context.close();
  }
});
