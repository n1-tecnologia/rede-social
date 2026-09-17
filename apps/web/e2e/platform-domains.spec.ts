import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { closeAdmin, deleteTenantBySlug, deleteUserByEmail } from './admin';
import { type ApiFetch, apiSession, closeDomainsAdmin, getDomainStatus } from './domains-admin';
import { hosts, isRemote } from './fixtures';

/**
 * Platform panel screens III (02-15, TENANT-07 UI half, ROLE-04, MOD-04, D-33..D-36): the Domínios
 * and Módulos tabs of the tenant page against the real 02-09/02-05 API with the fake domain
 * provider (`DOMAIN_PROVIDER=fake`, the local default — no worker: "Verificar agora" is the only
 * verification path here). Both Playwright projects run it; locators stay role-based so the
 * desktop table and the phone's stacked DNS blocks are asserted through the same names.
 *
 * Serial: every test builds on the tenant `beforeAll` creates through the API. Node-side calls use
 * `localhost` URLs (Node does not special-case `*.localhost`); the browser navigates the platform
 * origin.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD: string = (() => {
  const value = process.env.SUPER_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD is required for the platform e2e (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();
const API_URL = process.env.API_URL ?? 'http://localhost:8787';

const rand = Math.random().toString(36).slice(2, 8);
const slug = `e2e-dom-${rand}`;
const adminEmail = `admin+${rand}@e2e.local`;
/** 3 labels + `needs-txt` → CNAME + TXT rows from the fake provider; verifies on the first check. */
const host1 = `novo-needs-txt-${rand}.exemplo.test`;

/** Submits `/entrar` on `origin` without asserting the landing (owned by 02-07). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

/** The card of one host: the `Card` wrapping its heading. */
function cardOf(page: Page, host: string) {
  return page
    .getByTestId('domain-card')
    .filter({ has: page.getByRole('heading', { name: host, exact: true }) });
}

/** The single visible toast (`@tria/ui` `Toast`, `role=status`). */
function toast(page: Page, text: string | RegExp) {
  return page.getByRole('status').filter({ hasText: text }).first();
}

async function byHost(host: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`);
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

let context: BrowserContext;
let page: Page;
let platformApi: ApiFetch;
let tenantId = '';
const domainsUrl = () => `${hosts.platform}/plataforma/tenants/${tenantId}/dominios`;

test.beforeAll(async ({ browser }) => {
  test.skip(isRemote, 'local stack only');
  platformApi = await apiSession(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  const res = await platformApi('/v1/platform/tenants', {
    method: 'POST',
    body: JSON.stringify({
      displayName: `E2E Domínios ${rand}`,
      slug,
      colors: { primary: '#2e6fd0', secondary: '#5b9cf8' },
      modules: ['feed', 'communities', 'stories', 'events', 'chat', 'notifications'],
      adminEmail,
    }),
  });
  expect(res.status, 'POST /v1/platform/tenants').toBe(201);
  tenantId = ((await res.json()) as { tenant: { id: string } }).tenant.id;

  context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: hosts.platform,
  });
  page = await context.newPage();
  await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

test.afterAll(async () => {
  // The invite creates the admin's auth user when host1 verifies; the tenant delete cascades hosts.
  await deleteUserByEmail(adminEmail);
  await deleteTenantBySlug(slug);
  await closeAdmin();
  await closeDomainsAdmin();
  await context?.close();
});

test.describe('02-15 — Domínios tab', () => {
  test('1. attach → Aguardando DNS → copy → Verificar agora → Verificado (tracer)', async () => {
    await page.goto(domainsUrl());
    await expect(page.getByRole('heading', { name: 'Domínios', exact: true })).toBeVisible();
    await expect(page.getByText('Nenhum domínio ainda')).toBeVisible();
    await expect(page.getByText('Sem domínio', { exact: true })).toBeVisible();

    // TENANT-07/adjacency (UI half): the case variant is normalised by the shared schema.
    await page.locator('#host').fill(`Novo-Needs-TXT-${rand}.Exemplo.Test`);
    await page.getByRole('button', { name: 'Adicionar domínio' }).click();
    await expect(toast(page, 'Domínio adicionado.')).toBeVisible();

    const card = cardOf(page, host1);
    await expect(card).toBeVisible();
    await expect(card.getByText('Primário', { exact: true })).toBeVisible();
    await expect(card.getByText('Aguardando DNS', { exact: true })).toBeVisible();
    await expect(page.locator('#host')).toHaveValue('');

    // DNS records as TEXT: CNAME routing + TXT ownership challenge (needs-txt).
    const visible = (text: string) => card.getByText(text).filter({ visible: true }).first();
    await expect(visible('CNAME')).toBeVisible();
    await expect(visible('fake.tria-dns.test')).toBeVisible();
    await expect(visible('TXT')).toBeVisible();
    await expect(visible('_vercel.exemplo.test')).toBeVisible();
    await expect(visible(`vc-domain-verify=${host1},fake`)).toBeVisible();
    await expect(
      card.getByText('Crie estes registros no DNS do cliente', { exact: false }).first(),
    ).toBeVisible();

    const copyButtons = card.getByRole('button', { name: 'Copiar valor' });
    expect(await copyButtons.count()).toBeGreaterThanOrEqual(2);
    await copyButtons.first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Valor copiado' }).first(),
    ).toBeVisible();
    if (test.info().project.name === 'desktop-chromium') {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe('fake.tria-dns.test');
    }

    // D-36: an unverified host never resolves.
    expect((await byHost(host1)).status).toBe(404);

    await card.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(toast(page, 'Domínio verificado.')).toBeVisible();
    await expect(card.getByText('Verificado', { exact: true })).toBeVisible();
    await expect(card.getByText('vc-domain-verify=', { exact: false })).toHaveCount(0);

    // The header (02-12 layout) now links the verified primary host instead of "Sem domínio".
    await expect(page.getByText('Sem domínio', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: `Abrir ${host1} em uma nova aba` })).toHaveText(
      host1,
    );

    const resolved = await byHost(host1);
    expect(resolved.status).toBe(200);
    expect(resolved.body.isPrimary).toBe(true);
    expect(resolved.body.primaryHost).toBe(host1);
    expect(await getDomainStatus(host1)).toMatchObject({ status: 'verified', isPrimary: true });
  });
});
