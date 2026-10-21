import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { closeAdmin, deleteUserByEmail } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

/**
 * Helpers of the Phase 09.1 payments e2e (plan 19): the module and data reset, the signed deliveries a
 * gateway would send, the polling of an event until the apply job settles it, and the repeated steps
 * of the Pagamentos screen driven through the normal UI.
 *
 * The harness is NOT a lane (the `store-admin.ts` precedent): rows are written through a direct
 * superuser connection, so a spec can stand up a state in one statement, while everything the admin
 * does in the product goes through the screens. Every row a run writes is found again by the RUN
 * PREFIX (an e-mail local part, an external reference, a gateway product id, a product name), never by
 * tenant alone: the seeded tenants hold the user's own manual test data, which a sweep must not touch.
 *
 * Three rows have no prefix and are handled by a recorded baseline instead: the tenant's module rows
 * (`payments`, and `store` / `notifications` when a spec turns them on) are put back exactly as they
 * were found, and the tenant's integration is deleted only when the run created it. The baseline is
 * written to a file in the OS temp folder at the first change and removed on restore, so a run that
 * was killed half way is repaired by the next run's `beforeAll` (it turns the gate off first, which
 * is what keeps every other spec's sign-up from meeting a gate left on).
 */

/** The label of the test gateway (`fake.ts#displayName`), which the Integração card prints. */
export const TEST_GATEWAY_LABEL = 'Gateway de teste';

/** The tenant the payments specs run against: the seeded second community. */
export const LAB = 'rede-lab';

/**
 * The namespace every payments spec puts at the start of what it writes (e-mail local parts, sale
 * references, gateway product ids, product and community names). `resetPayments` sweeps the whole
 * namespace, so the leftovers of a killed run (which had another run id) are removed too, and nothing
 * outside it, the user's own data included, is ever matched.
 */
export const PAYMENTS_NAMESPACE = 'e2epay-';

/** A fresh prefix for one run of one spec: the namespace plus a base-36 clock. */
export function newRunPrefix(): string {
  return `${PAYMENTS_NAMESPACE}${Date.now().toString(36)}`;
}

/** A password every throwaway account of these specs uses. */
export const PASSWORD = 'Segredo123';

/** The local API origin a Node-side helper posts to (Node does not resolve `*.localhost`). */
const API_ORIGIN = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connections (call from `test.afterAll` so Playwright can exit). */
export async function closePayments(): Promise<void> {
  await client?.end();
  client = null;
  await closeAdmin();
}

// ── Module rows: remembered, changed, restored ─────────────────────────────────────────────────────

type ModuleBaseline = { existed: boolean; enabled: boolean; settings: Record<string, unknown> };
type TenantBaseline = {
  modules: Record<string, ModuleBaseline>;
  /** Whether the tenant already had an integration of the test gateway when the run began. */
  integrationExisted: boolean;
};

const BASELINE_FILE = join(tmpdir(), 'rede-social-e2e-payments-baseline.json');

function readBaselines(): Record<string, TenantBaseline> {
  if (!existsSync(BASELINE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Record<string, TenantBaseline>;
  } catch {
    return {};
  }
}

function writeBaselines(baselines: Record<string, TenantBaseline>): void {
  if (Object.keys(baselines).length === 0) {
    rmSync(BASELINE_FILE, { force: true });
    return;
  }
  writeFileSync(BASELINE_FILE, JSON.stringify(baselines));
}

async function integrationExists(tenantSlug: string): Promise<boolean> {
  const rows = await sql()<{ n: number }[]>`
    select count(*)::int as n
      from public.payment_integrations i
      join public.tenants t on t.id = i.tenant_id
     where t.slug = ${tenantSlug} and i.provider = 'fake'`;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Turns the `payments` module of `tenantSlug` on (and every key of `also`, e.g. `store`), remembering
 * what each row was before so `resetPayments` can put it back. The API caches module flags for 30
 * seconds per instance: `openPayments` therefore polls instead of asserting at once.
 */
export async function enablePayments(
  tenantSlug: string,
  also: readonly string[] = [],
): Promise<void> {
  const baselines = readBaselines();
  const base: TenantBaseline = baselines[tenantSlug] ?? {
    modules: {},
    integrationExisted: await integrationExists(tenantSlug),
  };
  for (const key of ['payments', ...also]) {
    if (!(key in base.modules)) {
      const rows = await sql()<{ enabled: boolean; settings: Record<string, unknown> }[]>`
        select tm.enabled, tm.settings
          from public.tenant_modules tm
          join public.tenants t on t.id = tm.tenant_id
         where t.slug = ${tenantSlug} and tm.module_key = ${key}`;
      const row = rows[0];
      base.modules[key] = row
        ? { existed: true, enabled: row.enabled, settings: row.settings }
        : { existed: false, enabled: false, settings: {} };
      // Written before the change so a crash between the two still leaves the way back.
      baselines[tenantSlug] = base;
      writeBaselines(baselines);
    }
    await sql()`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      select t.id, ${key}, true from public.tenants t where t.slug = ${tenantSlug}
      on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  }
  baselines[tenantSlug] = base;
  writeBaselines(baselines);
}

/** Puts every module row `enablePayments` changed back as it was found (the gate goes off with it). */
async function restoreModules(tenantSlug: string): Promise<{ ownsIntegration: boolean }> {
  const baselines = readBaselines();
  const base = baselines[tenantSlug];
  if (!base) return { ownsIntegration: false };
  for (const [key, before] of Object.entries(base.modules)) {
    if (before.existed) {
      await sql()`
        update public.tenant_modules tm
           set enabled = ${before.enabled}, settings = ${sql().json(before.settings as never)},
               updated_at = now()
          from public.tenants t
         where t.id = tm.tenant_id and t.slug = ${tenantSlug} and tm.module_key = ${key}`;
    } else {
      await sql()`
        delete from public.tenant_modules tm
         using public.tenants t
         where t.id = tm.tenant_id and t.slug = ${tenantSlug} and tm.module_key = ${key}`;
    }
  }
  delete baselines[tenantSlug];
  writeBaselines(baselines);
  return { ownsIntegration: !base.integrationExisted };
}

/**
 * Removes everything a run of the payments specs wrote on `tenantSlug`, found by `prefix`, and puts
 * the module rows back. Call it first in `beforeAll` (it also repairs an aborted run: the gate goes
 * off before anything else) and last in `afterAll`. Safe to call twice.
 *
 * Order: the gate and module rows first (so nothing deleted below leaves a locked tenant), then the
 * events, the gateway access rows (any tenant: the run's e-mails also hold a demo manual release),
 * the mappings, the integration (only when the run created it) and the throwaway identities.
 */
export async function resetPayments(tenantSlug: string, prefix: string): Promise<void> {
  const { ownsIntegration } = await restoreModules(tenantSlug);
  const like = `${prefix}%`;
  await sql()`
    delete from public.payment_events e
     using public.tenants t
     where t.id = e.tenant_id and t.slug = ${tenantSlug}
       and (e.external_ref like ${like} or e.email like ${like} or e.external_product_id like ${like})`;
  await sql()`
    delete from public.access_grants ag
     where ag.email like ${like}
        or (ag.external_ref like ${like}
            and ag.tenant_id = (select id from public.tenants where slug = ${tenantSlug}))`;
  await sql()`
    delete from public.payment_products p
     using public.tenants t
     where t.id = p.tenant_id and t.slug = ${tenantSlug}
       and (p.external_product_id like ${like} or p.name like ${like})`;
  if (ownsIntegration) {
    await sql()`
      delete from public.payment_integrations i
       using public.tenants t
       where t.id = i.tenant_id and t.slug = ${tenantSlug} and i.provider = 'fake'`;
  }
  const accounts = await sql()<{ email: string }[]>`
    select email from auth.users where email like ${like}`;
  for (const account of accounts) await deleteUserByEmail(account.email);
}

// ── Rows a spec stands up in one statement ─────────────────────────────────────────────────────────

/** A MANUAL, active release of `email` in `tenantSlug` (what the Acessos "Liberar e-mail" writes). */
export async function insertManualAccess(tenantSlug: string, email: string): Promise<void> {
  await sql()`
    insert into public.access_grants (tenant_id, email, source, status)
    select t.id, lower(btrim(${email})), 'manual', 'active'
      from public.tenants t where t.slug = ${tenantSlug}
    on conflict (tenant_id, email, status) where source = 'manual'
    do update set updated_at = now()`;
}

/**
 * Maps a store product to a gateway product id (what the product form's "Pagamento" block writes),
 * for the Eventos cases that need a mapped product without driving the form.
 */
export async function insertStoreMapping(input: {
  tenantSlug: string;
  storeProductId: string;
  externalProductId: string;
  checkoutUrl?: string;
}): Promise<void> {
  await sql()`
    insert into public.payment_products
      (tenant_id, provider, kind, external_product_id, target_id, checkout_url)
    select t.id, 'fake', 'store_product', ${input.externalProductId}, ${input.storeProductId}::uuid,
           ${input.checkoutUrl ?? null}
      from public.tenants t where t.slug = ${input.tenantSlug}`;
}

/** Inserts a long-named access product (a row of the Produtos de acesso list) straight in the table. */
export async function insertAccessProduct(input: {
  tenantSlug: string;
  name: string;
  externalProductId: string;
  checkoutUrl?: string;
}): Promise<void> {
  await sql()`
    insert into public.payment_products
      (tenant_id, provider, kind, name, external_product_id, checkout_url)
    select t.id, 'fake', 'access', ${input.name}, ${input.externalProductId},
           ${input.checkoutUrl ?? null}
      from public.tenants t where t.slug = ${input.tenantSlug}`;
}

// ── Deliveries and the apply job ───────────────────────────────────────────────────────────────────

export type DeliveryType =
  | 'purchase_approved'
  | 'purchase_refused'
  | 'purchase_refunded'
  | 'chargeback'
  | 'subscription_renewed'
  | 'subscription_late'
  | 'subscription_canceled';

export type DeliveryEvent = {
  type: DeliveryType;
  externalRef: string;
  email?: string;
  productId?: string;
  amountCents?: number;
  currency?: string;
  /** ISO instant; a grant defaults to thirty days ahead so an access row reads active. */
  validUntil?: string;
  /** Subscription events default to recurring; a purchase defaults to a one-off sale. */
  recurring?: boolean;
  orderRef?: string;
};

let deliveries = 0;

/**
 * Where a Node-side helper posts: the path of the URL the Pagamentos screen shows (so a change of the
 * URL shape fails the spec that parses it), on the loopback address. A local host of the screen keeps
 * its own port; a configured public base (`API_PUBLIC_URL`) is replaced by the local API origin.
 */
export function webhookTarget(shown: string): string {
  const url = new URL(shown);
  expect(url.pathname, 'the webhook URL shown on the screen').toMatch(
    /^\/v1\/webhooks\/fake\/[0-9a-f-]{36}$/,
  );
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname.endsWith('.localhost');
  if (local) {
    url.hostname = '127.0.0.1';
    url.search = '';
    return url.toString();
  }
  return `${API_ORIGIN}${url.pathname}`;
}

/**
 * Posts one signed delivery the way the test gateway sends it: the neutral JSON body, signed with
 * HMAC-SHA256 hex over the EXACT string sent, in `?signature=`. Every delivery carries a unique
 * `orderRef` unless one is given, because the inbox dedupes on the hash of the body and a renewal
 * that looked like the last one would be a no-op. Returns the HTTP status; the token is never logged.
 */
export async function signedDelivery(
  webhookUrl: string,
  token: string,
  event: DeliveryEvent,
): Promise<number> {
  deliveries += 1;
  const grants = event.type === 'purchase_approved' || event.type === 'subscription_renewed';
  const recurring = event.recurring ?? event.type.startsWith('subscription_');
  const body = JSON.stringify({
    type: event.type,
    externalRef: event.externalRef,
    orderRef: event.orderRef ?? `${event.externalRef}-d${deliveries}-${Date.now().toString(36)}`,
    ...(event.productId === undefined ? {} : { productId: event.productId }),
    ...(event.email === undefined ? {} : { email: event.email }),
    ...(event.amountCents === undefined ? {} : { amountCents: event.amountCents }),
    ...(event.currency === undefined ? {} : { currency: event.currency }),
    validUntil:
      event.validUntil ??
      (grants ? new Date(Date.now() + 30 * 24 * 3_600_000).toISOString() : undefined),
    recurring,
  });
  const signature = createHmac('sha256', token).update(body).digest('hex');
  const res = await fetch(`${webhookTarget(webhookUrl)}?signature=${signature}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return res.status;
}

const SETTLED = ['applied', 'no_membership', 'unknown_product', 'ignored', 'failed'] as const;

/**
 * Polls the newest event of a sale (and of a type, when given) until the apply job settles it into one
 * of `states`, or fails after `timeoutMs` naming the last state it saw. There is no fixed sleep: the
 * worker's pace sets the wait. A `failed` event that the caller did not ask for fails at once.
 */
export async function waitForEventState(
  tenantSlug: string,
  externalRef: string,
  states: readonly string[] = ['applied'],
  type?: DeliveryType,
  timeoutMs = 20_000,
): Promise<{ state: string; outcome: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no event';
  while (Date.now() < deadline) {
    const rows = await sql()<{ state: string; outcome: string | null }[]>`
      select e.state, e.outcome
        from public.payment_events e
        join public.tenants t on t.id = e.tenant_id
       where t.slug = ${tenantSlug} and e.external_ref = ${externalRef}
         and (${type ?? null}::text is null or e.type = ${type ?? null})
       order by e.received_at desc, e.id desc
       limit 1`;
    const row = rows[0];
    if (row) {
      last = `${row.state}${row.outcome ? `/${row.outcome}` : ''}`;
      if (states.includes(row.state)) return row;
      if (row.state === 'failed') break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `payment event ${externalRef}${type ? ` (${type})` : ''} did not reach ${states.join(' or ')} (last: ${last}); is the worker running?`,
  );
}

/** Every state an event can settle into, for a spec that only needs the apply job to be done. */
export const SETTLED_STATES: readonly string[] = SETTLED;

// ── The Pagamentos screen, through the normal UI ───────────────────────────────────────────────────

/** Opens the lab admin session on the lab host. */
export async function loginLabAdmin(page: Page): Promise<void> {
  await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
}

/**
 * Opens `/configuracoes/pagamentos` (optionally another tab) on the lab host. The API's module flags
 * sit in a 30 s cache, so a module turned on a moment ago answers 404 until the entry expires: the
 * goto is repeated until the screen answers.
 */
export async function openPayments(page: Page, aba?: 'acessos' | 'eventos'): Promise<void> {
  const target = `${hosts.lab}/configuracoes/pagamentos${aba ? `?aba=${aba}` : ''}`;
  await expect
    .poll(async () => (await page.goto(target))?.status() ?? 0, {
      message: 'the Pagamentos screen answers once the module flag cache expires',
      timeout: 75_000,
      intervals: [500, 1_000, 2_000, 3_000],
    })
    .toBe(200);
  await expect(page.getByRole('heading', { name: 'Pagamentos', level: 1 })).toBeVisible();
}

/**
 * Connects the test gateway: checks that the card names it (a web or API server started by hand keeps
 * its own environment and would register the real adapter), pastes `token`, saves, and returns the
 * webhook URL the screen shows. The page must be on the Configuração tab.
 */
export async function connectViaUi(page: Page, token: string): Promise<string> {
  const label = page.getByText(TEST_GATEWAY_LABEL, { exact: true }).first();
  await label.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
    throw new Error(
      `the Integração card does not name "${TEST_GATEWAY_LABEL}": the web or API server was started without PAYMENTS_PROVIDERS=fake. Export PAYMENTS_PROVIDERS=fake before starting it, or stop it and let Playwright start the servers.`,
    );
  });
  await page.locator('#payments-webhook-token').fill(token);
  await page.getByRole('button', { name: 'Salvar integração' }).click();
  await expect(page.getByText('Integração salva.')).toBeVisible();
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  return page.locator('#payments-webhook-url').inputValue();
}

/** Adds an access product through its sheet and waits for the toast. The page is on Configuração. */
export async function addAccessProductViaUi(
  page: Page,
  input: { name: string; externalId: string; link?: string },
): Promise<void> {
  await page
    .getByRole('button', { name: /^Adicionar produto de acesso$/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('#payments-product-name').fill(input.name);
  await sheet.locator('#payments-product-id').fill(input.externalId);
  if (input.link) await sheet.locator('#payments-product-link').fill(input.link);
  await sheet.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
  await expect(page.getByText('Produto adicionado.')).toBeVisible();
  await expect(sheet).toBeHidden();
}

/**
 * Turns "Exigir assinatura para entrar" on through the switch and its dialog, accepting the release
 * box as it stands (checked by default, when there is anyone to release). The page is on Configuração
 * with the integration connected and one access product registered.
 */
export async function turnGateOnViaUi(page: Page): Promise<void> {
  const gate = page.getByRole('switch', { name: 'Exigir assinatura para entrar' });
  await expect(gate).toBeEnabled();
  await gate.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/^Exigir assinatura em /)).toBeVisible();
  await dialog.getByRole('button', { name: 'Exigir assinatura', exact: true }).click();
  await expect(page.getByText(/^Assinatura exigida/)).toBeVisible();
  await expect(gate).toBeChecked();
}

/** Fills the sign-up form on the current host and presses "Cadastrar" (both consents ticked). */
export async function submitSignup(page: Page, email: string): Promise<void> {
  await page.locator('#name').fill('Pessoa de Teste');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#acceptRules').check();
  await page.locator('#acceptTerms').check();
  await page.getByRole('button', { name: 'Cadastrar' }).click();
}

/** `scrollWidth <= innerWidth`: the document does not scroll sideways (the 320px backstop). */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll, `${label}: the document scrolls sideways`).toBeLessThanOrEqual(
    widths.inner,
  );
}
