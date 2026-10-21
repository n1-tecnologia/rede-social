import { expect, test } from '@playwright/test';
import { createMember } from './admin';
import { hosts, login, signOut } from './fixtures';
import {
  addAccessProductViaUi,
  closePayments,
  connectViaUi,
  enablePayments,
  gotoWhileRedirected,
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
import { ensureWorker } from './worker';

/**
 * 09.1-19, Task 1 (the tracer): the whole access story in a browser, on the phone project, against the
 * real API, the real worker, the real database and a signed request from "the gateway".
 *
 *   an admin connects the integration, registers an access product with a checkout link and requires
 *   a subscription  ->  a visitor with no access reads the one-sentence notice and the "Assinar" link
 *   ->  a signed purchase makes the same sign-up reach the verification screen  ->  a member signs in,
 *   a signed cancellation lands them on "Sua assinatura não está ativa" with the session intact
 *   ->  a signed renewal and "Verificar de novo" bring them back  ->  the admin's Membros list tells
 *   the same story with the "Assinatura pendente" pill, and not after the return.
 *
 * The test gateway is the only adapter of the servers this run launches (`PAYMENTS_PROVIDERS=fake` in
 * `playwright.config.ts`); the webhook URL is read from the Pagamentos screen, so a change of its shape
 * fails here. The run touches only what carries its prefix; the module rows go back as they were and
 * the gate never survives the run (`resetPayments`, `beforeAll` and `afterAll`).
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const visitor = `${prefix}-visitor@rede-lab.local`;
const member = `${prefix}-member@rede-lab.local`;
const productName = `${prefix} Assinatura`;
const gatewayProductId = `${prefix}-sub`;
const checkout = `https://pay.example.test/${prefix}`;
const sale1 = `${prefix}-sale-1`;
const sale2 = `${prefix}-sale-2`;
const TOKEN = `tok-${prefix}-${Math.random().toString(36).slice(2, 12)}`;

let webhook = '';
let stopWorker: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  // Also repairs a killed run: the gate goes off before anything else.
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await enablePayments(LAB);
  stopWorker = await ensureWorker();
});

test.afterAll(async () => {
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await stopWorker?.();
  await closePayments();
});

test('1. the admin connects the gateway, registers an access product and requires a subscription', async ({
  page,
}) => {
  await loginLabAdmin(page);
  await openPayments(page);
  webhook = await connectViaUi(page, TOKEN);
  expect(webhook).toContain('/v1/webhooks/fake/');
  await addAccessProductViaUi(page, {
    name: productName,
    externalId: gatewayProductId,
    link: checkout,
  });
  await turnGateOnViaUi(page);
  await signOut(page, hosts.lab);
});

test('2. a visitor with no access reads the notice, and a signed purchase opens the door', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(`${hosts.lab}/cadastro`);
    await submitSignup(page, visitor);
    await expect(page).toHaveURL(/\/cadastro\?erro=nao-liberado$/, { timeout: 60_000 });
    const notice = page.locator('[role="alert"]').filter({ hasText: 'Seu acesso' });
    await expect(notice).toContainText(
      'Seu acesso ainda não foi liberado. Use o mesmo e-mail da compra.',
    );
    await expect(notice.getByRole('link', { name: /Assinar/ })).toHaveAttribute('href', checkout);

    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'purchase_approved',
        externalRef: sale1,
        email: visitor,
        productId: gatewayProductId,
        recurring: true,
      }),
    ).toBe(200);
    expect((await waitForEventState(LAB, sale1, ['applied'])).outcome).toBe('access_granted');

    await page.goto(`${hosts.lab}/cadastro`);
    await submitSignup(page, visitor);
    await expect(page).toHaveURL(/\/verifique-seu-email$/, { timeout: 60_000 });
  } finally {
    await context.close();
  }
});

test('3. a canceled subscription cuts a member without signing them out, and a renewal returns them', async ({
  browser,
}) => {
  // The purchase arrives before the account exists (D-490), then the person gets one.
  expect(
    await signedDelivery(webhook, TOKEN, {
      type: 'purchase_approved',
      externalRef: sale2,
      email: member,
      productId: gatewayProductId,
      recurring: true,
    }),
  ).toBe(200);
  await waitForEventState(LAB, sale2, ['applied'], 'purchase_approved');
  await createMember(member, PASSWORD, LAB);

  const memberContext = await phoneContext(browser);
  const memberPage = await memberContext.newPage();
  const adminContext = await phoneContext(browser);
  const adminPage = await adminContext.newPage();
  try {
    await login(memberPage, member, PASSWORD, hosts.lab);

    // The cut.
    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'subscription_canceled',
        externalRef: sale2,
        email: member,
        productId: gatewayProductId,
      }),
    ).toBe(200);
    expect(
      (await waitForEventState(LAB, sale2, ['applied'], 'subscription_canceled')).outcome,
    ).toBe('access_cut');

    // The open app may get there on its own (the realtime nudge); either way it ends on the screen.
    await gotoWhileRedirected(memberPage, `${hosts.lab}/inicio`);
    await expect(memberPage).toHaveURL(/\/assinatura-pendente/, { timeout: 30_000 });
    await expect(memberPage.getByText('Sua assinatura não está ativa')).toBeVisible();
    await expect(memberPage.getByRole('link', { name: /Regularizar/ })).toHaveAttribute(
      'href',
      checkout,
    );
    await expect(memberPage.getByRole('link', { name: 'Verificar de novo' })).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Sair' })).toBeVisible();
    // PR-3, D-499: a cut never signs the person out.
    const session = (await memberContext.cookies()).filter((cookie) =>
      cookie.name.startsWith('sb-'),
    );
    expect(session.length, 'the Supabase session cookies survive the cut').toBeGreaterThan(0);

    // The admin's Membros list tells the same story.
    await loginLabAdmin(adminPage);
    await adminPage.goto(`${hosts.lab}/configuracoes/membros`);
    const row = adminPage.locator('[data-member-row]').filter({ hasText: member });
    await expect(row).toContainText('Assinatura pendente');
    await adminPage.getByRole('button', { name: 'Assinatura pendente', exact: true }).click();
    await expect(adminPage).toHaveURL(/status=subscription_pending/);
    await expect(adminPage.locator('[data-member-row]')).toHaveCount(1);
    await expect(adminPage.locator('[data-member-row]')).toContainText(member);

    // The return.
    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'subscription_renewed',
        externalRef: sale2,
        email: member,
        productId: gatewayProductId,
      }),
    ).toBe(200);
    await waitForEventState(LAB, sale2, ['applied'], 'subscription_renewed');
    await memberPage.getByRole('link', { name: 'Verificar de novo' }).click();
    await expect(memberPage).toHaveURL(/\/inicio$/, { timeout: 30_000 });

    await adminPage.goto(`${hosts.lab}/configuracoes/membros`);
    await expect(adminPage.locator('[data-member-row]').filter({ hasText: member })).toBeVisible();
    await expect(
      adminPage.locator('[data-member-row]').filter({ hasText: 'Assinatura pendente' }),
    ).toHaveCount(0);
  } finally {
    await memberContext.close();
    await adminContext.close();
  }
});
