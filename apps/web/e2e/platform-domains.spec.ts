import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { closeAdmin, deleteTenantBySlug, deleteUserByEmail } from './admin';
import {
  type ApiFetch,
  apiSession,
  closeDomainsAdmin,
  expireDomain,
  getDomainStatus,
} from './domains-admin';
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
/** A plain alias (CNAME only) — promoted to primary in test 2, the member's host in test 6. */
const host2 = `alias-${rand}.exemplo.test`;
/** The fake provider never reports it configured — the expired → restart path of test 3. */
const host3 = `never-verifies-${rand}.exemplo.test`;
/** A 57-character first label — the overflow backstop of test 5. */
const longHost = `${'a'.repeat(50)}-${rand}.exemplo.test`;

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

/** Fills the attach form and waits for the card of the normalised host. */
async function attachHost(page: Page, host: string) {
  await page.locator('#host').fill(host);
  await page.getByRole('button', { name: 'Adicionar domínio' }).click();
  await expect(toast(page, 'Domínio adicionado.')).toBeVisible();
  const card = cardOf(page, host.toLowerCase());
  await expect(card).toBeVisible();
  return card;
}

/** "Remover" on a non-primary card → danger dialog → confirm → the card is gone. */
async function removeHost(page: Page, host: string) {
  const card = cardOf(page, host);
  await card.getByRole('button', { name: 'Remover' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Remover ${host}?`);
  await dialog.getByRole('button', { name: 'Remover' }).click();
  await expect(toast(page, 'Domínio removido.')).toBeVisible();
  await expect(page.getByRole('heading', { name: host, exact: true })).toHaveCount(0);
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

  test('2. second host → set primary (confirm) → primary remove refused on both layers → remove alias', async () => {
    await page.goto(domainsUrl());
    const card2 = await attachHost(page, host2);
    await expect(card2.getByText('Aguardando DNS', { exact: true })).toBeVisible();
    await expect(card2.getByText('Primário', { exact: true })).toHaveCount(0);
    // Not verified → "Tornar primário" is not offered anywhere (D-35).
    await expect(page.getByRole('button', { name: 'Tornar primário' })).toHaveCount(0);

    await card2.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(toast(page, 'Domínio verificado.')).toBeVisible();
    await expect(card2.getByText('Verificado', { exact: true })).toBeVisible();

    await card2.getByRole('button', { name: 'Tornar primário' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Tornar ${host2} o domínio primário?`);
    await expect(dialog).toContainText('Os outros endereços passam a redirecionar para ele.');
    await dialog.getByRole('button', { name: 'Tornar primário' }).click();
    await expect(toast(page, 'Domínio primário atualizado.')).toBeVisible();

    // API order: the promoted host first, carrying "Primário"; the former primary offers the switch.
    const first = page.getByTestId('domain-card').first();
    await expect(first.getByRole('heading', { name: host2, exact: true })).toBeVisible();
    await expect(first.getByText('Primário', { exact: true })).toBeVisible();
    const card1 = cardOf(page, host1);
    await expect(card1.getByText('Primário', { exact: true })).toHaveCount(0);
    await expect(card1.getByRole('button', { name: 'Tornar primário' })).toBeVisible();
    await expect(page.getByRole('link', { name: `Abrir ${host2} em uma nova aba` })).toHaveText(
      host2,
    );
    expect(await getDomainStatus(host2)).toMatchObject({ isPrimary: true });
    expect(await getDomainStatus(host1)).toMatchObject({ isPrimary: false });

    // D-35 layer 1 (panel): the primary cannot be removed while an alias exists.
    const primaryCard = cardOf(page, host2);
    await expect(primaryCard.getByRole('button', { name: 'Remover' })).toBeDisabled();
    await expect(
      primaryCard.getByText(
        'Não é possível remover o domínio primário. Torne outro domínio primário antes.',
      ),
    ).toBeVisible();
    // D-35 layer 2 (API): the same rule answers 409 primary_with_aliases.
    const detailRes = await platformApi(`/v1/platform/tenants/${tenantId}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { domains: { id: string; host: string }[] };
    const host2DomainId = detail.domains.find((d) => d.host === host2)?.id ?? '';
    expect(host2DomainId).not.toBe('');
    const refused = await platformApi(`/v1/platform/tenants/${tenantId}/domains/${host2DomainId}`, {
      method: 'DELETE',
    });
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('primary_with_aliases');

    await removeHost(page, host1);
    await expect(page.getByTestId('domain-card')).toHaveCount(1);
    const only = page.getByTestId('domain-card').first();
    await expect(only.getByRole('heading', { name: host2, exact: true })).toBeVisible();
    await expect(only.getByText('Primário', { exact: true })).toBeVisible();
    await expect(only.getByText('Verificado', { exact: true })).toBeVisible();
    await expect(only.getByRole('button', { name: 'Remover' })).toBeEnabled();

    expect((await byHost(host1)).status).toBe(404);
    const resolved = await byHost(host2);
    expect(resolved.status).toBe(200);
    expect(resolved.body.isPrimary).toBe(true);
  });

  test('3. never-verifies → verify fails → expired → Reiniciar verificação → pending again', async () => {
    await page.goto(domainsUrl());
    const card = await attachHost(page, host3);
    await expect(card.getByText('Aguardando DNS', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(toast(page, 'A verificação falhou:')).toBeVisible();
    await expect(card.getByText('Aguardando DNS', { exact: true })).toBeVisible();

    // The deadline passes; the NEXT check flips the host to expired (D-34).
    await expireDomain(host3);
    await card.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(toast(page, 'O prazo de verificação expirou')).toBeVisible();
    await expect(card.getByText('Expirado', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reiniciar verificação' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Verificar agora' })).toHaveCount(0);
    expect(await getDomainStatus(host3)).toMatchObject({ status: 'expired' });

    await card.getByRole('button', { name: 'Reiniciar verificação' }).click();
    await expect(toast(page, 'Verificação reiniciada.')).toBeVisible();
    await expect(card.getByText('Aguardando DNS', { exact: true })).toBeVisible();
    await expect(
      card.getByText('fake.tria-dns.test').filter({ visible: true }).first(),
    ).toBeVisible();
    expect(await getDomainStatus(host3)).toMatchObject({ status: 'pending' });

    await removeHost(page, host3);
    await expect(page.getByTestId('domain-card')).toHaveCount(1);
  });

  test('4. add-form errors: invalid, taken (no owner leak), platform host, idempotent re-add', async () => {
    await page.goto(domainsUrl());
    const form = page.locator('form', { has: page.locator('#host') });
    const submit = () => page.getByRole('button', { name: 'Adicionar domínio' }).click();

    await page.locator('#host').fill('not a host');
    await submit();
    await expect(form.getByRole('alert')).toHaveText(
      'Domínio inválido. Use um endereço como comunidade.cliente.com.br.',
    );
    await expect(page.locator('#host')).toHaveValue('not a host');

    // A verified host of another (seeded) tenant: 409 DOMAIN_IN_USE names no owner (T-02-96).
    await page.locator('#host').fill('tria-demo.localhost');
    await submit();
    await expect(form.getByRole('alert')).toHaveText('Este domínio já está em uso.');
    await expect(page.locator('#host')).toHaveValue('tria-demo.localhost');
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('TRIA Demo');
    expect(body).not.toContain('tria-demo');

    await page.locator('#host').fill('tria.localhost');
    await submit();
    await expect(form.getByRole('alert')).toHaveText('Este endereço é reservado pela plataforma.');
    await expect(page.locator('#host')).toHaveValue('tria.localhost');

    // Same tenant, same host: the API answers 200 (idempotent) — no error, still one card.
    await page.locator('#host').fill(host2);
    await submit();
    await expect(toast(page, 'Domínio adicionado.')).toBeVisible();
    await expect(form.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: host2, exact: true })).toHaveCount(1);
    await expect(page.getByTestId('domain-card')).toHaveCount(1);
  });

  test('5. long host backstop: the card never widens, phone stacks the DNS records', async () => {
    await page.goto(domainsUrl());
    const card = await attachHost(page, longHost);
    const heading = card.getByRole('heading', { name: longHost, exact: true });
    await expect(heading).toHaveAttribute('title', longHost);
    const widths = await card.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);

    if (test.info().project.name === 'mobile-chromium') {
      await expect(card.getByRole('table')).toBeHidden();
      await expect(card.getByRole('list', { name: 'Registros DNS' })).toBeVisible();
      const page_ = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(page_.scrollWidth).toBeLessThanOrEqual(page_.innerWidth);
    } else {
      await expect(card.getByRole('table', { name: 'Registros DNS' })).toBeVisible();
    }

    await removeHost(page, longHost);
    await expect(page.getByTestId('domain-card')).toHaveCount(1);
  });
});
