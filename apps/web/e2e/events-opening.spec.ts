import { expect, type Locator, type Page, test } from '@playwright/test';
import { createMember, envValue } from './admin';
import {
  closeEventsAdmin,
  deleteEventsByTitlePrefix,
  eventOpeningFor,
  insertEvent,
  setEventOpening,
} from './events-admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  closePayments,
  connectViaUi,
  enablePayments,
  eventIdByTitle,
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
  waitForEventState,
  waitForFanoutBacklog,
} from './payments';
import { ensureWorker } from './worker';

/**
 * 10.2-16, Task 1 (OPEN-10, OPEN-17 to OPEN-19, UI-04; D-782, D-788, D-789, D-793): the opening of the sale
 * of a paid event, in a browser on the phone project against the real API, worker, database and Realtime,
 * with the test gateway (`fake`).
 *
 *   1. the lab admin turns "Cobrar ingresso" on in the new-event form WITH an opening date and time, saves,
 *      and the edit form reads the pair back
 *   2. a member sees the `Em breve` tag and the `Abre em` note on the card, the zone with the count blocks,
 *      the exact opening and no `Comprar ingresso`; the API detail carries no link
 *   3. THE TRACER: an event whose opening is seconds ahead, opened in a browser whose OWN clock is a day
 *      ahead, counts from the server's seed and swaps to the `Comprar ingresso` anchor by itself, with no
 *      reload
 *   4. a signed approved delivery for a member while the page shows `Em breve` swaps it to `Presença
 *      confirmada` with the count to the event; Participantes marks `Pago` and `Antes da abertura`, and
 *      Pagamentos, Eventos recentes carries the same pill
 *   5. with that paid presence the edit form shows the opening read-only with the sold line, and a direct
 *      PUT that changes it answers 409 `opening_locked` (the same date is never refused)
 *   6. turning the ticket off on an event with no sale clears the stored opening, and the member sees a
 *      free event
 *   7. a free event shows no `Em breve` and keeps `Faltam N dias`
 *   8. at 320px the zone, the card and the form field do not scroll sideways and `Limpar abertura` answers
 *      a 44px tap
 *
 * Fixtures live in the `e2epay-` namespace and `resetPayments` removes them (mappings, attendance rows,
 * deliveries, accounts); the events are removed by their title prefix. The spec never resets or seeds, and
 * never touches the user's own account. The gateway brand never appears here: the screens say "Gateway de
 * teste" for the test adapter only.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const TOKEN = `tok-${prefix}-${Math.random().toString(36).slice(2, 12)}`;
const buyer = `${prefix}-early@rede-lab.local`;
const viewer = `${prefix}-viewer@rede-lab.local`;
const buyerName = `Comprador ${prefix}`;
const viewerName = `Espectador ${prefix}`;
const openTitle = `${prefix} Evento com abertura`;
const tracerTitle = `${prefix} Evento do traçador`;
const clearTitle = `${prefix} Evento sem venda`;
const freeTitle = `${prefix} Evento gratuito`;
const openGatewayId = `${prefix}-ingresso-1`;
const tracerGatewayId = `${prefix}-ingresso-2`;
const clearGatewayId = `${prefix}-ingresso-3`;
const openLink = `https://pay.example.test/${prefix}/ingresso-1`;
const tracerLink = `https://pay.example.test/${prefix}/ingresso-2`;
const clearLink = `https://pay.example.test/${prefix}/ingresso-3`;
const order = `${prefix}-order-1`;
const MEETING_URL = 'https://meet.example.test/e2e-opening';
const OPEN_TIME = '10:00';
const DAY_MS = 86_400_000;

let webhook = '';
let openId = '';
let tracerId = '';
let clearId = '';
let freeId = '';
let tenantId = '';
let stopWorker: (() => Promise<void>) | undefined;

/** `YYYY-MM-DD`, `days` from now (UTC; a date days ahead is in the future in any tenant zone). */
const dateIn = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

const eventIdFrom = (page: Page) => page.url().split('/eventos/')[1]?.split(/[/?#]/)[0] ?? '';

const buyAnchor = (page: Page) => page.getByTestId('event-actions-buy');
const soonZone = (page: Page) => page.getByTestId('event-soon-zone');
const confirmedBanner = (page: Page) =>
  page.locator('[data-testid="event-banner"][data-kind="confirmed"]');
const card = (page: Page, eventId: string): Locator =>
  page.locator(`a[href="/eventos/${eventId}"]`);

/** The API as a member of the lab: a real password session on the lab's own host (Node-side fetch). */
async function apiAs(
  email: string,
  password: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> & { error?: unknown } }> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  const { access_token } = (await session.json()) as { access_token: string };
  const res = await fetch(`${process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787'}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${access_token}`,
      'x-tenant-host': `${LAB}.localhost`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as never };
}

/**
 * Starts watching the page's Realtime sockets and returns a waiter that resolves once the page has joined
 * its own user topic (the topic the live swap listens on). Call it BEFORE the navigation.
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
  tenantId = await labTenantId();
  await deleteEventsByTitlePrefix(tenantId, PAYMENTS_NAMESPACE);
  await enablePayments(LAB, ['events', 'notifications']);
  stopWorker = await ensureWorker();

  for (const [email, name] of [
    [buyer, buyerName],
    [viewer, viewerName],
  ] as const) {
    await createMember(email, PASSWORD, LAB);
    await nameMember(LAB, email, name);
  }

  // The tracer event, the unsold event whose ticket is turned off and the free event are stood up in
  // SQL (relative to the database clock); the first event is the one the form creates (test 1).
  tracerId = await insertEvent(tenantId, {
    title: tracerTitle,
    startsInMinutes: 3 * 24 * 60,
    endsInMinutes: 3 * 24 * 60 + 120,
  });
  await insertEventMapping({
    tenantSlug: LAB,
    eventId: tracerId,
    externalProductId: tracerGatewayId,
    checkoutUrl: tracerLink,
  });
  clearId = await insertEvent(tenantId, {
    title: clearTitle,
    startsInMinutes: 3 * 24 * 60,
    endsInMinutes: 3 * 24 * 60 + 120,
  });
  await insertEventMapping({
    tenantSlug: LAB,
    eventId: clearId,
    externalProductId: clearGatewayId,
    checkoutUrl: clearLink,
  });
  await setEventOpening(clearId, 2 * 24 * 60 * 60);
  freeId = await insertEvent(tenantId, {
    title: freeTitle,
    startsInMinutes: 3 * 24 * 60,
    endsInMinutes: 3 * 24 * 60 + 120,
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

test('1. the admin sets an opening in the form and the edit form reads the pair back', async ({
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
    await page.locator('#event-title').fill(openTitle);
    await page.locator('#event-start-date').fill(dateIn(3));
    await page.locator('#event-start-time').fill('19:00');
    await page.locator('#event-url').fill(MEETING_URL);

    await page.getByRole('switch', { name: 'Cobrar ingresso' }).click();
    await page.locator('#event-gateway-id').fill(openGatewayId);
    await page.locator('#event-checkout-url').fill(openLink);
    await page.locator('#event-ticket-price').fill('80,00');
    await expect(page.locator('[data-ticket-opening]')).toHaveAttribute(
      'data-opening-state',
      'empty',
    );
    await page.locator('#event-opens-date').fill(dateIn(2));
    await page.locator('#event-opens-time').fill(OPEN_TIME);
    await expect(page.locator('[data-ticket-opening]')).toHaveAttribute(
      'data-opening-state',
      'filled',
    );
    await page.locator('[data-event-submit]').click();

    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    openId = eventIdFrom(page);
    expect(await eventIdByTitle(LAB, openTitle)).toBe(openId);
    expect(await eventOpeningFor(openId), 'the opening is stored').not.toBeNull();

    // The edit form reads the very pair back, in the tenant's wall clock.
    await page.goto(`${hosts.lab}/eventos/${openId}/editar`);
    await expect(page.locator('#event-opens-date')).toHaveValue(dateIn(2));
    await expect(page.locator('#event-opens-time')).toHaveValue(OPEN_TIME);
    await expect(page.locator('[data-ticket-opening]')).toHaveAttribute(
      'data-opening-state',
      'filled',
    );
  } finally {
    await context.close();
  }
});

test('2. a member sees Em breve, the count, the exact opening and no Comprar ingresso, and the API sends no link', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, viewer, PASSWORD, hosts.lab);
    await openUntilReady(page, `${hosts.lab}/eventos/${openId}`, () => soonZone(page));

    await expect(page.getByText('Em breve', { exact: true }).first()).toBeVisible();
    await expect(soonZone(page)).toContainText('As inscrições abrem em');
    expect(
      await page.getByTestId('live-countdown-cell').count(),
      'the count draws its blocks',
    ).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('event-soon-opens-at')).toContainText(/^Abertura: .+10:00/);
    await expect(page.getByTestId('event-soon-zone-label')).toContainText('Fuso horário:');
    await expect(buyAnchor(page)).toHaveCount(0);
    expect(await page.content(), 'the page never carries the buy link').not.toContain(openLink);

    // The list card: the tag and the short live note.
    await page.goto(`${hosts.lab}/eventos`);
    await expect(card(page, openId)).toContainText('Em breve');
    await expect(card(page, openId)).toContainText(/Abre em /);

    // The API detail, read as that member: a stored opening ahead of the server's now and no link.
    const detail = await apiAs(viewer, PASSWORD, `/v1/events/${openId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.checkoutUrl ?? null).toBeNull();
    expect(typeof detail.body.registrationOpensAt).toBe('string');
    expect(typeof detail.body.serverNow).toBe('string');
    expect(
      Date.parse(String(detail.body.registrationOpensAt)),
      'the opening is ahead of the server clock',
    ).toBeGreaterThan(Date.parse(String(detail.body.serverNow)));
    expect(JSON.stringify(detail.body)).not.toContain(openLink);
  } finally {
    await context.close();
  }
});

test('3. the tracer: with the browser clock a day ahead, the zone counts from the server and swaps to Comprar ingresso by itself', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, viewer, PASSWORD, hosts.lab);
    // ONLY the browser's clock is moved: the API and the database keep the real one (a stale or wrong
    // device clock must change nothing the member sees).
    await page.clock.install({ time: new Date(Date.now() + DAY_MS) });
    const skew = await page.evaluate(() => Date.now());
    expect(skew - Date.now(), 'the browser clock is about a day ahead').toBeGreaterThan(
      DAY_MS - 60_000,
    );

    // The opening is a few seconds ahead of the database clock; a cold server can eat the margin, so the
    // opening is pushed ahead again until the page is drawn as `Em breve` (the premise of the swap).
    let armed = false;
    for (let attempt = 0; attempt < 3 && !armed; attempt += 1) {
      await setEventOpening(tracerId, 45);
      await page.goto(`${hosts.lab}/eventos/${tracerId}`);
      armed = await soonZone(page).isVisible();
    }
    expect(armed, 'the page opened as Em breve before the opening passed').toBe(true);
    await expect(buyAnchor(page)).toHaveCount(0);

    // Prove "no reload": a marker only this document can keep, and a counter of the loads.
    await page.evaluate(() => {
      (window as unknown as { __openingMarker: string }).__openingMarker = 'same-document';
    });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });

    // The swap: the boundary refresh asks the server at the opening, whatever the device clock says.
    await expect(buyAnchor(page)).toHaveAttribute('href', tracerLink, { timeout: 120_000 });
    await expect(buyAnchor(page)).toHaveCount(1);
    await expect(soonZone(page)).toHaveCount(0);
    expect(loads, 'the document was loaded again').toBe(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __openingMarker?: string }).__openingMarker,
      ),
      'the document was reloaded',
    ).toBe('same-document');
  } finally {
    await context.close();
  }
});

test('4. an early payer is confirmed while the page shows Em breve, and both admin views carry the mark', async ({
  browser,
}) => {
  await waitForFanoutBacklog();
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, buyer, PASSWORD, hosts.lab);
    const joined = watchUserTopicJoin(page);
    await openUntilReady(page, `${hosts.lab}/eventos/${openId}`, () => soonZone(page));
    await joined();
    await page.waitForLoadState('networkidle');

    const url = page.url();
    await page.evaluate(() => {
      (window as unknown as { __earlyMarker: string }).__earlyMarker = 'same-document';
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
        productId: openGatewayId,
        amountCents: 8_000,
        currency: 'BRL',
        recurring: false,
      }),
    ).toBe(200);
    await waitForEventState(LAB, order, ['applied'], 'purchase_approved');

    await expect(confirmedBanner(page)).toContainText('Presença confirmada', { timeout: 45_000 });
    await expect(soonZone(page)).toHaveCount(0);
    await expect(buyAnchor(page)).toHaveCount(0);
    // The holder's count runs to the EVENT, not to the opening.
    await expect(page.getByTestId('live-countdown-text').first()).toContainText(/Falt/);
    expect(page.url()).toBe(url);
    expect(loads, 'the document was loaded again').toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __earlyMarker?: string }).__earlyMarker),
      'the document was reloaded',
    ).toBe('same-document');

    // Participantes: Pago, then Antes da abertura.
    const admin = await (await phoneContext(browser)).newPage();
    try {
      await loginLabAdmin(admin);
      await admin.goto(`${hosts.lab}/eventos/${openId}/participantes`);
      const payer = admin.getByTestId('attendee-row').filter({ hasText: buyerName });
      await expect(payer.locator('[data-mark="paid"]')).toHaveText('Pago');
      await expect(payer.locator('[data-mark="beforeOpening"]')).toHaveText('Antes da abertura');

      // Pagamentos, Eventos recentes: the same pill on the ticket row.
      await openPayments(admin, 'eventos');
      const row = admin
        .locator('li')
        .filter({ hasText: `Ingresso · ${openTitle}` })
        .first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText('Antes da abertura');
    } finally {
      await admin.context().close();
    }
  } finally {
    await context.close();
  }
});

test('5. with a paid presence the form shows the opening read-only and a direct PUT answers 409 opening_locked', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await loginLabAdmin(page);
    await page.goto(`${hosts.lab}/eventos/${openId}/editar`);
    await expect(page.locator('[data-ticket-opening]')).toHaveAttribute(
      'data-opening-state',
      'locked',
    );
    await expect(page.locator('#event-opens-date')).toBeDisabled();
    await expect(page.locator('#event-opens-time')).toBeDisabled();
    await expect(page.locator('#event-opens-date')).toHaveValue(dateIn(2));
    await expect(page.locator('[data-opening-locked]')).toContainText('1 ingresso vendido');
    await expect(page.locator('[data-opening-clear]')).toHaveCount(0);
  } finally {
    await context.close();
  }

  // The same refusal over the API: the database is the only judge, whatever the client does.
  const edit = await apiAs(users.labAdmin, SEED_PASSWORD, `/v1/events/${openId}/edit`);
  expect(edit.status).toBe(200);
  const stored = edit.body.registrationOpens as { date: string; time: string };
  const base = {
    title: edit.body.title,
    description: edit.body.description,
    category: edit.body.category,
    capacity: edit.body.capacity,
    format: edit.body.format,
    venueName: edit.body.venueName,
    address: edit.body.address,
    meetingUrl: edit.body.meetingUrl,
    start: edit.body.start,
    end: edit.body.end,
    schedule: edit.body.schedule,
    ticketPriceCents: edit.body.ticketPriceCents,
  };
  const moved = await apiAs(users.labAdmin, SEED_PASSWORD, `/v1/events/${openId}`, {
    method: 'PUT',
    body: { ...base, registrationOpens: { date: stored.date, time: '11:00' } },
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(409);
  expect(JSON.stringify(moved.body)).toContain('opening_locked');
  const cleared = await apiAs(users.labAdmin, SEED_PASSWORD, `/v1/events/${openId}`, {
    method: 'PUT',
    body: { ...base, registrationOpens: null },
  });
  expect(cleared.status, JSON.stringify(cleared.body)).toBe(409);
  // Saving the same date is never refused.
  const same = await apiAs(users.labAdmin, SEED_PASSWORD, `/v1/events/${openId}`, {
    method: 'PUT',
    body: { ...base, registrationOpens: stored },
  });
  expect(same.status, JSON.stringify(same.body)).toBe(200);
});

test('6. turning the ticket off on an unsold event clears the stored opening and the member then sees a free event', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  const memberContext = await phoneContext(browser);
  const member = await memberContext.newPage();
  try {
    expect(await eventOpeningFor(clearId), 'the fixture holds an opening').not.toBeNull();
    await loginLabAdmin(page);
    await openUntilReady(page, `${hosts.lab}/eventos/${clearId}/editar`, () =>
      page.locator('[data-ticket-opening]'),
    );
    await expect(page.locator('#event-opens-date')).not.toHaveValue('');

    await page.getByRole('switch', { name: 'Cobrar ingresso' }).click();
    await expect(page.locator('[data-opening-off-warning]')).toBeVisible();
    await page.locator('[data-event-submit]').click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${clearId}$`), { timeout: 30_000 });

    await expect
      .poll(() => eventOpeningFor(clearId), { message: 'the opening is cleared', timeout: 30_000 })
      .toBeNull();

    await login(member, viewer, PASSWORD, hosts.lab);
    await member.goto(`${hosts.lab}/eventos/${clearId}`);
    await expect(member.getByRole('button', { name: 'Garantir minha vaga' })).toBeVisible();
    await expect(soonZone(member)).toHaveCount(0);
    await expect(buyAnchor(member)).toHaveCount(0);
    await expect(member.getByText('Em breve', { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    await memberContext.close();
  }
});

test('7. a free event shows no Em breve and keeps Faltam N dias', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  try {
    await login(page, viewer, PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/eventos`);
    await expect(card(page, freeId)).toBeVisible();
    await expect(card(page, freeId)).not.toContainText('Em breve');
    await expect(card(page, freeId)).not.toContainText(/Abre em /);

    // The page: the hero keeps the shipped static count, with no zone and no tag.
    await page.goto(`${hosts.lab}/eventos/${freeId}`);
    await expect(page.getByRole('button', { name: 'Garantir minha vaga' })).toBeVisible();
    await expect(page.getByText(/Falt(a|am) \d+ dias? · /).first()).toBeVisible();
    await expect(soonZone(page)).toHaveCount(0);
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);

    // The card of a member who answered Vou keeps its `Faltam N dias` note, as before the phase.
    const answered = await apiAs(viewer, PASSWORD, `/v1/events/${freeId}/rsvp`, {
      method: 'PUT',
      body: { answer: 'going' },
    });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    await page.goto(`${hosts.lab}/eventos`);
    await expect(card(page, freeId)).toContainText(/Falt(a|am) \d+ dias?/);
    await expect(card(page, freeId)).not.toContainText('Em breve');
  } finally {
    await context.close();
  }
});

test('8. at 320px the zone, the card and the form field do not scroll sideways and Limpar abertura answers a 44px tap', async ({
  browser,
}) => {
  const admin = await (await phoneContext(browser, 320)).newPage();
  const memberContext = await phoneContext(browser, 320);
  const member = await memberContext.newPage();
  try {
    // The form field: the pair, the zone line and the clear button.
    await loginLabAdmin(admin);
    await openUntilReady(admin, `${hosts.lab}/eventos/novo`, () =>
      admin.locator('[data-event-ticket]'),
    );
    await admin.getByRole('switch', { name: 'Cobrar ingresso' }).click();
    await expect(admin.locator('#event-opens-date')).toBeVisible();
    await admin.locator('#event-opens-date').fill(dateIn(2));
    await admin.locator('#event-opens-time').fill(OPEN_TIME);
    await expect(admin.locator('[data-opening-clear]')).toBeVisible();
    await expectNoHorizontalScroll(admin, 'the opening field of the event form');
    await expectTapTarget(admin.locator('[data-opening-clear]'));

    // The member's zone and card.
    await login(member, viewer, PASSWORD, hosts.lab);
    await member.goto(`${hosts.lab}/eventos/${openId}`);
    await expect(soonZone(member)).toBeVisible();
    await expectNoHorizontalScroll(member, 'the Em breve zone');
    await member.goto(`${hosts.lab}/eventos`);
    await expect(card(member, openId)).toContainText('Em breve');
    await expectNoHorizontalScroll(member, 'the Em breve card in the gallery');
  } finally {
    await admin.context().close();
    await memberContext.close();
  }
});
