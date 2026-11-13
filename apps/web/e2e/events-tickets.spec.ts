import { expect, type Page, test } from '@playwright/test';
import { createMember } from './admin';
import { closeEventsAdmin, deleteEventsByTitlePrefix, insertEvent } from './events-admin';
import { hosts, login } from './fixtures';
import {
  closePayments,
  connectViaUi,
  enablePayments,
  eventIdByTitle,
  eventMappingFor,
  expectNoHorizontalScroll,
  expectTapTarget,
  insertEventMapping,
  LAB,
  labTenantId,
  loginLabAdmin,
  nameMember,
  newRunPrefix,
  openPayments,
  openUntilReady,
  PASSWORD,
  PAYMENTS_NAMESPACE,
  phoneContext,
  resetPayments,
  signedDelivery,
  ticketDiagnostics,
  waitForEventState,
  waitForFanoutBacklog,
} from './payments';
import { ensureWorker } from './worker';

/**
 * 10.1-15, Task 1 (TICK-15, TICK-21, UI-04; D-740, D-741, D-746, D-752): a paid event is sold, paid,
 * entered and refunded, in a browser on the phone project against the real API, worker, database and
 * Realtime, with the test gateway (`fake`).
 *
 *   1. the lab admin turns "Cobrar ingresso" on in the new-event form, types the id, the https link
 *      and the reference price, and saves: the event and its product mapping are stored
 *   2. a member sees the Pago tag, the price-first anchor "Comprar ingresso" whose href is the stored
 *      link (a new tab), and no Vou
 *   3. THE TRACER: a signed approved delivery for the member's e-mail swaps the page they have open
 *      into "Presença confirmada" without a reload, and the bell lists the row
 *   4. a member without a presence is turned away at both doors: the online Entrar lands on the
 *      ingresso screen, the venue check-in page draws its paid section
 *   5. the 320px backstops: the form section, the buy zone and the confirmed block do not scroll
 *      sideways and the controls answer a 44px tap
 *   6. Participantes marks the payer Pago, the admin releases a Cortesia from the sheet and removes it
 *   7. a signed refund removes the payer and the member's page returns to Comprar ingresso
 *   8. Pagamentos, Eventos recentes lists the ticket rows as "Ingresso · {evento}"
 *
 * Fixtures live in the `e2epay-` namespace and `resetPayments` removes them (mappings, attendance
 * rows, deliveries, accounts); the events are removed by their title prefix. The spec never resets or
 * seeds, and never touches the user's own account. The gateway name never appears here: the catalog
 * and the screens say "Gateway de teste" for the test adapter only.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const TOKEN = `tok-${prefix}-${Math.random().toString(36).slice(2, 12)}`;
const buyer = `${prefix}-buyer@rede-lab.local`;
const second = `${prefix}-second@rede-lab.local`;
const guest = `${prefix}-guest@rede-lab.local`;
const buyerName = `Comprador ${prefix}`;
const secondName = `Segundo ${prefix}`;
const guestName = `Convidado ${prefix}`;
const paidTitle = `${prefix} Encontro pago`;
const doorTitle = `${prefix} Encontro no local`;
const paidGatewayId = `${prefix}-ingresso-1`;
const doorGatewayId = `${prefix}-ingresso-2`;
const paidLink = `https://pay.example.test/${prefix}/ingresso-1`;
const doorLink = `https://pay.example.test/${prefix}/ingresso-2`;
const order = `${prefix}-order-1`;
const MEETING_URL = 'https://meet.example.test/e2e-tickets';

let webhook = '';
let paidId = '';
let doorId = '';
let stopWorker: (() => Promise<void>) | undefined;

/** `YYYY-MM-DD`, `days` from now (UTC; a start days ahead is in the future in any tenant zone). */
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const eventIdFrom = (page: Page) => page.url().split('/eventos/')[1]?.split(/[/?#]/)[0] ?? '';

const buyAnchor = (page: Page) => page.getByTestId('event-actions-buy');
const confirmedBanner = (page: Page) =>
  page.locator('[data-testid="event-banner"][data-kind="confirmed"]');

/**
 * Starts watching the page's Realtime sockets and returns a waiter that resolves once the page has
 * joined its own user topic (`tenant:{id}:user:{id}`, the topic the live swap listens on). The hook
 * ignores the first join and a signal sent before it is lost to that page, so a spec that sends the
 * delivery on a cold dev server (slow hydration) must wait for the join, not for the network to idle.
 * Call it BEFORE the navigation: the socket opens during it.
 */
function watchUserTopicJoin(page: Page): () => Promise<void> {
  let joined = false;
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8');
      if (text.includes('phx_reply') && text.includes(':user:') && text.includes('"status":"ok"')) {
        joined = true;
      }
    });
  });
  return async () => {
    await expect
      .poll(() => joined, { message: 'the page joined its user topic', timeout: 60_000 })
      .toBe(true);
  };
}

test.beforeAll(async ({ browser }) => {
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await deleteEventsByTitlePrefix(await labTenantId(), PAYMENTS_NAMESPACE);
  await enablePayments(LAB, ['events', 'notifications']);
  stopWorker = await ensureWorker();

  for (const [email, name] of [
    [buyer, buyerName],
    [second, secondName],
    [guest, guestName],
  ] as const) {
    await createMember(email, PASSWORD, LAB);
    await nameMember(LAB, email, name);
  }

  // The venue event and its mapping are stood up in one statement: the form is driven for the
  // online one (test 1); the check-in door only needs a mapped, in-person, future event.
  doorId = await insertEvent(await labTenantId(), {
    title: doorTitle,
    startsInMinutes: 3 * 24 * 60,
    endsInMinutes: 3 * 24 * 60 + 120,
  });
  await insertEventMapping({
    tenantSlug: LAB,
    eventId: doorId,
    externalProductId: doorGatewayId,
    checkoutUrl: doorLink,
  });

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
  await resetPayments(LAB, PAYMENTS_NAMESPACE);
  await deleteEventsByTitlePrefix(await labTenantId(), PAYMENTS_NAMESPACE);
  await stopWorker?.();
  await closeEventsAdmin();
  await closePayments();
});

test('1. the admin turns Cobrar ingresso on in the form and the event and its product are stored', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await openUntilReady(page, `${hosts.lab}/eventos/novo`, () =>
      page.locator('[data-event-ticket][data-ticket-state="free"]'),
    );

    await page
      .getByRole('group', { name: 'Formato' })
      .getByRole('button', { name: 'Online' })
      .click();
    await page.locator('#event-title').fill(paidTitle);
    await page.locator('#event-start-date').fill(dateIn(3));
    await page.locator('#event-start-time').fill('19:00');
    await page.locator('#event-url').fill(MEETING_URL);

    await page.getByRole('switch', { name: 'Cobrar ingresso' }).click();
    await page.locator('#event-gateway-id').fill(paidGatewayId);
    await page.locator('#event-checkout-url').fill(paidLink);
    await page.locator('#event-ticket-price').fill('80,00');
    await page.locator('[data-event-submit]').click();

    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    paidId = eventIdFrom(page);
    await expect(page.getByTestId('event-hero-title')).toHaveText(paidTitle);

    // The second write (the product) landed too: the mapping row holds the typed pair.
    const stored = await eventMappingFor(paidId);
    expect(stored?.externalProductId).toBe(paidGatewayId);
    expect(stored?.checkoutUrl).toBe(paidLink);
    expect(await eventIdByTitle(LAB, paidTitle)).toBe(paidId);
  } finally {
    await context.close();
  }
});

test('2. a member sees the Pago tag and one Comprar ingresso anchor with the stored link, and no Vou', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, second, PASSWORD, hosts.lab);
    await openUntilReady(page, `${hosts.lab}/eventos/${paidId}`, () => buyAnchor(page));

    await expect(buyAnchor(page)).toHaveCount(1);
    await expect(buyAnchor(page)).toContainText(/Comprar ingresso\s·\sR\$\s80,00/);
    await expect(buyAnchor(page)).toHaveAttribute('href', paidLink);
    await expect(buyAnchor(page)).toHaveAttribute('target', '_blank');
    await expect(buyAnchor(page)).toHaveAttribute('rel', /noopener/);
    await expect(page.getByTestId('event-actions-hint')).toContainText(
      'Depois de pagar, sua presença aparece aqui sozinha.',
    );
    await expect(page.getByRole('button', { name: /^Vou$/ })).toHaveCount(0);
    await expect(page.getByText('Pago', { exact: true }).first()).toBeVisible();

    // The list card carries the same tag.
    await page.goto(`${hosts.lab}/eventos`);
    await expect(
      page.locator(`a[href="/eventos/${paidId}"]`).getByText('Pago', { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('3. the tracer: a signed approved delivery swaps the open page into Presença confirmada without a reload', async ({
  browser,
}) => {
  // A backlog of fan-out jobs from earlier runs on this database would delay the notification that
  // drives the swap; let the worker clear it first.
  await waitForFanoutBacklog();
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, buyer, PASSWORD, hosts.lab);
    const joined = watchUserTopicJoin(page);
    await openUntilReady(page, `${hosts.lab}/eventos/${paidId}`, () => buyAnchor(page));
    // Let the shell's and the page's Realtime joins settle: a signal sent before the first join is the
    // page's own render, not a refresh.
    await joined();
    await page.waitForLoadState('networkidle');

    // Prove "no reload": a marker only the document that holds it can keep, and a counter of the loads.
    const url = page.url();
    await page.evaluate(() => {
      (window as unknown as { __ticketMarker: string }).__ticketMarker = 'same-document';
    });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });

    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'purchase_approved',
        externalRef: order,
        email: buyer,
        productId: paidGatewayId,
        amountCents: 8_000,
        currency: 'BRL',
        recurring: false,
      }),
    ).toBe(200);
    await waitForEventState(LAB, order, ['applied'], 'purchase_approved');

    try {
      await expect(confirmedBanner(page)).toContainText('Presença confirmada', { timeout: 45_000 });
    } catch (error) {
      // The browser cannot see why a swap did not happen: name what the database holds.
      throw new Error(
        `the open page did not swap into Presença confirmada (database: ${await ticketDiagnostics(paidId, buyer)})\n${(error as Error).message}`,
      );
    }
    await expect(buyAnchor(page)).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(loads, 'the document was loaded again').toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __ticketMarker?: string }).__ticketMarker),
      'the document was reloaded',
    ).toBe('same-document');

    // The bell lists the row, linking to the event.
    await expect
      .poll(
        async () => {
          await page.goto(`${hosts.lab}/notificacoes`);
          return page
            .locator(`a[href="/eventos/${paidId}"]`)
            .filter({ hasText: 'Presença confirmada' })
            .count();
        },
        {
          message: 'the bell lists "Presença confirmada"',
          timeout: 45_000,
          intervals: [1_000, 2_000],
        },
      )
      .toBe(1);
  } finally {
    await context.close();
  }
});

test('4. a member without a presence is turned away at both doors', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, second, PASSWORD, hosts.lab);

    // The online Entrar: a 303 to the ingresso screen, with the buy link and no meeting URL.
    await page.goto(`${hosts.lab}/eventos/${paidId}/entrar`);
    await expect(page).toHaveURL(new RegExp(`/eventos/${paidId}/entrar/aviso\\?motivo=ingresso$`));
    await expect(page.getByText('Este evento tem ingresso')).toBeVisible();
    await expect(page.getByTestId('ticket-door-buy')).toHaveAttribute('href', paidLink);
    expect(await page.content()).not.toContain('meet.example.test');

    // The venue check-in page: the paid section, no code form.
    await page.goto(`${hosts.lab}/eventos/${doorId}/check-in`);
    await expect(page.getByText('O check-in é só para quem tem ingresso.')).toBeVisible();
    await expect(page.getByTestId('ticket-door-buy')).toHaveAttribute('href', doorLink);
    await expect(page.locator('input[inputmode="text"], input[name="code"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('5. at 320px the form section, the buy zone and the confirmed block do not scroll sideways', async ({
  browser,
}) => {
  const admin = await (await phoneContext(browser, 320)).newPage();
  const memberContext = await phoneContext(browser, 320);
  const member = await memberContext.newPage();
  const holderContext = await phoneContext(browser, 320);
  const holder = await holderContext.newPage();
  try {
    // The admin's form: the Ingresso section with its three fields shown.
    await loginLabAdmin(admin);
    await openUntilReady(admin, `${hosts.lab}/eventos/novo`, () =>
      admin.locator('[data-event-ticket]'),
    );
    const toggle = admin.getByRole('switch', { name: 'Cobrar ingresso' });
    await toggle.click();
    await expect(admin.locator('#event-gateway-id')).toBeVisible();
    await expectNoHorizontalScroll(admin, 'the event form with the Ingresso section');
    // The shared Switch primitive is 24px tall app-wide (its row is 44px); the section's own fields are
    // what this phase draws, so the 44px tap is asserted on the first of them.
    await expectTapTarget(admin.locator('#event-gateway-id'));

    // A member's buy zone.
    await login(member, second, PASSWORD, hosts.lab);
    await member.goto(`${hosts.lab}/eventos/${paidId}`);
    await expect(buyAnchor(member)).toBeVisible();
    await expectNoHorizontalScroll(member, 'the buy zone of a paid event');
    await expectTapTarget(buyAnchor(member));

    // The payer's confirmed block.
    await login(holder, buyer, PASSWORD, hosts.lab);
    await holder.goto(`${hosts.lab}/eventos/${paidId}`);
    await expect(confirmedBanner(holder)).toBeVisible();
    await expectNoHorizontalScroll(holder, 'the Presença confirmada block');
  } finally {
    await admin.context().close();
    await memberContext.close();
    await holderContext.close();
  }
});

test('6. Participantes marks the payer Pago, a Cortesia is released from the sheet and removed', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await page.goto(`${hosts.lab}/eventos/${paidId}/participantes`);

    const payer = page.getByTestId('attendee-row').filter({ hasText: buyerName });
    await expect(payer.locator('[data-mark="paid"]')).toHaveText('Pago');

    // Liberar presença: the toolbar door, the sheet's search, the row, the confirm.
    await page.getByRole('button', { name: 'Liberar presença', exact: true }).first().click();
    await page.getByRole('searchbox', { name: 'Buscar membro' }).fill(guest.split('@')[0] ?? guest);
    const candidate = page.getByRole('button', { name: `Liberar presença de ${guestName}` });
    await expect(candidate).toBeVisible({ timeout: 20_000 });
    await candidate.click();
    await page
      .getByRole('dialog', { name: `Liberar presença de ${guestName}?` })
      .getByRole('button', { name: 'Liberar presença', exact: true })
      .click();
    await expect(page.getByText(`Presença de ${guestName} liberada.`)).toBeVisible();

    // Close the sheet; the list now holds the guest with the Cortesia mark.
    await page.keyboard.press('Escape');
    const courtesy = page.getByTestId('attendee-row').filter({ hasText: guestName });
    await expect(courtesy.locator('[data-mark="courtesy"]')).toHaveText('Cortesia', {
      timeout: 20_000,
    });

    // Remover cortesia, behind its confirm.
    await page.getByRole('button', { name: `Remover cortesia de ${guestName}` }).click();
    await page
      .getByRole('dialog', { name: `Remover a cortesia de ${guestName}?` })
      .getByRole('button', { name: 'Remover cortesia', exact: true })
      .click();
    await expect(page.getByText(`Cortesia de ${guestName} removida.`)).toBeVisible();
    await expect(page.getByTestId('attendee-row').filter({ hasText: guestName })).toHaveCount(0);
    // The payer is untouched.
    await expect(payer.locator('[data-mark="paid"]')).toHaveText('Pago');
  } finally {
    await context.close();
  }
});

test('7. a signed refund removes the payer and the member page returns to Comprar ingresso', async ({
  browser,
}) => {
  const adminContext = await phoneContext(browser);
  const admin = await adminContext.newPage();
  const memberContext = await phoneContext(browser);
  const member = await memberContext.newPage();
  try {
    expect(
      await signedDelivery(webhook, TOKEN, {
        type: 'purchase_refunded',
        externalRef: order,
        email: buyer,
        productId: paidGatewayId,
        recurring: false,
      }),
    ).toBe(200);
    await waitForEventState(LAB, order, ['applied'], 'purchase_refunded');

    await loginLabAdmin(admin);
    await admin.goto(`${hosts.lab}/eventos/${paidId}/participantes`);
    await expect(admin.getByTestId('attendee-row').filter({ hasText: buyerName })).toHaveCount(0);

    await login(member, buyer, PASSWORD, hosts.lab);
    await member.goto(`${hosts.lab}/eventos/${paidId}`);
    await expect(buyAnchor(member)).toHaveAttribute('href', paidLink);
    await expect(confirmedBanner(member)).toHaveCount(0);
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});

test('8. Pagamentos, Eventos recentes lists the ticket rows as Ingresso · evento', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await openPayments(page, 'eventos');
    await expect(page.getByText(`Ingresso · ${paidTitle}`).first()).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
});
