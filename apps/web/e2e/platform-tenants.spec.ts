import { expect, type Page, test } from '@playwright/test';
import { closeAdmin, deleteTenantBySlug, getTenantModuleFlag } from './admin';
import { hosts, isRemote, SEED_PASSWORD, users } from './fixtures';
import {
  continueFromData,
  continueFromPersonalization,
  createTenantThroughWizard,
  finishWizard,
} from './wizard';

/**
 * Platform panel screens I (02-12, ROLE-03/ROLE-05, D-31/D-32/D-33): the super_admin provisions
 * a tenant from `/plataforma` on the platform host against the real 02-05 API — list, the D-31
 * form, the tenant page with its five tabs, the Status flip — and every state the UI-SPEC
 * enumerates. Both Playwright projects run it: the mobile one exercises the card rows and the top
 * bar, so locators stay role-based.
 */

test.describe.configure({ timeout: 120_000 });

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD: string = (() => {
  const value = process.env.SUPER_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD is required for the platform e2e (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();

const UUID_PATH =
  /\/plataforma\/tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
/**
 * Per-run suffix, stable across worker restarts (Playwright restarts the worker after a failed
 * test, which would regenerate a random suffix and orphan the tenants earlier tests created):
 * the runner's pid plus the project, so the two projects never share a slug.
 */
const rand = process.ppid.toString(36);
const suffixFor = (project: string) => `${rand}${project.startsWith('mobile') ? 'm' : 'd'}`;
/** Every slug the suite may create, per project — deleted in `afterAll` whether or not it exists. */
const slugsFor = (project: string) => {
  const s = suffixFor(project);
  return {
    painel: `e2e-painel-${s}`,
    mod: `e2e-mod-${s}`,
    a: `mesmo-nome-a-${s}`,
    b: `mesmo-nome-b-${s}`,
    refused: `e2e-recusado-${s}`,
  };
};

/** Every visible row link ("display name (slug)") — the hidden table/cards are excluded by role. */
function rowLinks(page: Page) {
  return page.getByRole('link', { name: /\(.+\)$/ });
}

/** Opens the tenant page's Marca tab of a tenant the wizard just created. */
async function openTenantPage(page: Page, id: string): Promise<void> {
  await page.goto(`${hosts.platform}/plataforma/tenants/${id}/marca`);
  await expect(page).toHaveURL(new RegExp(`${UUID_PATH.source}/marca`));
}

/**
 * The whole wizard (Dados → Personalização → Domínio → Resumo → confirmation), then the tenant page's Marca
 * tab, where the assertions below continue. Resolves with the new tenant id.
 */
async function createTenant(
  page: Page,
  input: { name: string; slug: string; email: string },
): Promise<string> {
  const id = await createTenantThroughWizard(page, input);
  await openTenantPage(page, id);
  return id;
}

/**
 * From a filled Dados to a refused confirmation and back: "Continuar" through Personalização and
 * Domínio, the
 * summary's "Criar tenant", the confirmation, then "Corrigir os dados" (nothing was created).
 */
async function refuseAtConfirmation(page: Page): Promise<void> {
  await continueFromData(page);
  await continueFromPersonalization(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Criar tenant', exact: true }).click();
  await page.locator('[data-create-confirm]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Corrigir os dados' }).click();
  await expect(page).toHaveURL(`${hosts.platform}/plataforma/novo`);
}

/**
 * The tenant a test depends on, created by an earlier test — or created now when a worker restart
 * wiped it (each test stays runnable on its own). Returns the tenant id.
 */
async function ensureTenant(
  page: Page,
  input: { name: string; slug: string; email: string },
): Promise<string> {
  await page.goto(`${hosts.platform}/plataforma?q=${input.slug}`);
  const row = page.getByRole('link', { name: `${input.name} (${input.slug})` });
  await expect(row.or(page.getByText('Nenhum tenant encontrado'))).toBeVisible();
  if ((await row.count()) === 0) return createTenant(page, input);
  await row.click();
  await expect(page).toHaveURL(UUID_PATH);
  const match = page.url().match(UUID_PATH);
  if (!match) throw new Error(`no tenant id in ${page.url()}`);
  return match[0].slice('/plataforma/tenants/'.length);
}

async function setStatus(page: Page, tenantId: string, next: 'suspended' | 'active') {
  await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/status`);
  if (next === 'suspended') {
    await page.getByRole('button', { name: 'Suspender tenant' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Suspenso');
  } else {
    await page.getByRole('button', { name: 'Reativar tenant' }).click();
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Ativo');
  }
}

/** Submits `/entrar` on `origin` without asserting the landing (owned by 02-07). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

/** Text that exists twice in the DOM (desktop table + mobile cards): match the visible copy only. */
function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true }).first();
}

async function signInSuperAdmin(page: Page): Promise<void> {
  await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
}

test.afterAll(async ({ browser: _browser }, testInfo) => {
  for (const slug of Object.values(slugsFor(testInfo.project.name))) await deleteTenantBySlug(slug);
  await closeAdmin();
});

test.describe('02-12 — platform panel: tenants list, creation, tenant page, status', () => {
  test('1. list → create → tenant page → status flip', async ({ browser }, testInfo) => {
    const slugs = slugsFor(testInfo.project.name);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);

    // The list (D-33 `tenant-list`): title, the seed tenant row linked by id, its host and pill.
    await page.goto(`${hosts.platform}/plataforma`);
    await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
    const demoRow = page.getByRole('link', { name: /Rede Demo \(rede-demo\)/ });
    await expect(demoRow).toBeVisible();
    await expect(demoRow).toHaveAttribute('href', UUID_PATH);
    await expect(visibleText(page, 'rede-demo.localhost')).toBeVisible();
    await expect(visibleText(page, 'Ativo')).toBeVisible();

    // "Novo tenant" → the D-31 form; the slug is suggested from the name while untouched.
    await page.getByRole('link', { name: 'Novo tenant' }).click();
    await expect(page).toHaveURL(`${hosts.platform}/plataforma/novo`);
    const slug = slugs.painel;
    const name = `E2E Painel ${suffixFor(testInfo.project.name)}`;
    await page.locator('#displayName').fill(name);
    await expect(page.locator('#slug')).toHaveValue(slug);
    await page.locator('#adminEmail').fill(`admin+${slug}@e2e.local`);
    // The wizard creates nothing until the summary's confirmation; then the invite step shows the
    // "Tenant criado." toast, and the tenant page is one navigation away.
    await continueFromData(page);
    expect(await getTenantModuleFlag(slug, 'feed')).toBeNull();
    const id = await finishWizard(page, { primary: '#7c3aed', secondary: '#a78bfa' });
    await expect(page.getByRole('status').filter({ hasText: 'Tenant criado.' })).toBeVisible();
    await openTenantPage(page, id);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Ativo');
    await expect(page.getByText(slug, { exact: true })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText([
      'Marca',
      'Módulos',
      'Domínios',
      'Admins',
      'Status',
    ]);
    // The slug is immutable after creation (D-31): no slug input on the tenant page.
    await expect(page.locator('input#slug')).toHaveCount(0);

    // Status tab: suspend through the ConfirmDialog, then reactivate directly (D-32).
    await page.getByRole('tab', { name: 'Status' }).click();
    await expect(page).toHaveURL(/\/status$/);
    await page.getByRole('button', { name: 'Suspender tenant' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Suspender ${name}?`);
    await dialog.getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByRole('status')).toContainText('Alterações salvas.');
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Suspenso');
    await page.getByRole('button', { name: 'Reativar tenant' }).click();
    await expect(page.getByTestId('tenant-status-pill')).toHaveText('Ativo');

    // D-17 wiring: the seven real modules are on for a panel-created tenant.
    expect(await getTenantModuleFlag(slug, 'events')).toBe(true);
    expect(await getTenantModuleFlag(slug, 'feed')).toBe(true);

    // Back on the list: the new row, without a domain yet.
    await page.goto(`${hosts.platform}/plataforma`);
    const newRow = page.getByRole('link', { name: `${name} (${slug})` });
    await expect(newRow).toBeVisible();
    await expect(visibleText(page, 'Sem domínio')).toBeVisible();

    await context.close();
  });

  test('2. form errors: required name, invalid slug, invalid e-mail, duplicate slug', async ({
    browser,
  }, testInfo) => {
    const slugs = slugsFor(testInfo.project.name);
    const s = suffixFor(testInfo.project.name);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    // The duplicate-slug case needs test 1's tenant to exist.
    await ensureTenant(page, {
      name: `E2E Painel ${s}`,
      slug: slugs.painel,
      email: `admin+${slugs.painel}@e2e.local`,
    });
    await page.goto(`${hosts.platform}/plataforma/novo`);
    // Next's route announcer is a permanent `role=alert`; the form's own alerts are scoped to it.
    const alerts = page.locator('form').getByRole('alert');

    // An unfilled form shows no error until the first "Continuar" (E11/empty).
    await expect(page.locator('form[data-draft-ready]')).toBeVisible();
    await expect(alerts).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(alerts.filter({ hasText: 'Informe o nome de exibição.' })).toBeVisible();

    const name = `Erro Form ${s}`;
    await page.locator('#displayName').fill(name);
    await page.locator('#slug').fill('São José');
    await page.locator('#adminEmail').fill('nao-e-um-email');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Use apenas letras minúsculas, números e hífens.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Informe um e-mail válido.' }),
    ).toBeVisible();

    // The slug test 1 created still exists: only the API knows, so the confirmation answers 400
    // { slug: 'taken' }, creates nothing and sends the person back to Dados with the field error;
    // the already-valid fields keep their values (E11/partial).
    await page.locator('#slug').fill(slugs.painel);
    await page.locator('#adminEmail').fill(`erro+${s}@e2e.local`);
    await refuseAtConfirmation(page);
    await expect(alerts.filter({ hasText: 'Este slug já está em uso.' })).toBeVisible();
    await expect(page.locator('#displayName')).toHaveValue(name);
    await expect(page.locator('#adminEmail')).toHaveValue(`erro+${s}@e2e.local`);
    await expect(page).toHaveURL(`${hosts.platform}/plataforma/novo`);

    await context.close();
  });

  test('3. module switches + contrast gate; Admins tab with a 60-character e-mail (E17 backstop)', async ({
    browser,
  }, testInfo) => {
    const slugs = slugsFor(testInfo.project.name);
    const s = suffixFor(testInfo.project.name);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await page.goto(`${hosts.platform}/plataforma/novo`);
    const longEmail = `${'a'.repeat(45)}@e2e-long.local`;
    expect(longEmail).toHaveLength(60);
    await expect(page.locator('form[data-draft-ready]')).toBeVisible();
    await page.locator('#displayName').fill(`Mod E2E ${s}`);
    await page.locator('#slug').fill(slugs.mod);
    await page.locator('#adminEmail').fill(longEmail);
    await continueFromData(page);

    // Personalização. A light primary fails the AA checks: "Baixo" pill, warning copy, explicit
    // acknowledgement before "Continuar".
    await page.locator('#primary').fill('#f5f7fb');
    await expect(page.getByText(/^Baixo /).first()).toBeVisible();
    const confirm = page.getByRole('checkbox', { name: 'Salvar mesmo assim' });
    await expect(confirm).toBeVisible();
    const submit = page.getByRole('button', { name: 'Continuar', exact: true });
    await expect(submit).toBeDisabled();
    await confirm.check();
    await expect(submit).toBeEnabled();

    // Seven switches, all on by default (D-17) — exactly the key vocabulary and nothing else.
    // Scoped to the form column: the desktop rail carries the "Tema" switch (02-16 theme row).
    const switches = page.locator('main').getByRole('switch');
    await expect(switches).toHaveCount(7);
    for (const sw of await switches.all()) await expect(sw).toBeChecked();
    await page.getByRole('switch', { name: 'Stories' }).click();
    await expect(page.getByRole('switch', { name: 'Stories' })).not.toBeChecked();

    await openTenantPage(page, await finishWizard(page));

    expect(await getTenantModuleFlag(slugs.mod, 'stories')).toBe(false);
    expect(await getTenantModuleFlag(slugs.mod, 'feed')).toBe(true);

    // Admins tab: the pending invite with its e-mail, the empty admins row, no horizontal overflow.
    await page.getByRole('tab', { name: 'Admins' }).click();
    await expect(page).toHaveURL(/\/admins$/);
    await expect(page.getByText(longEmail)).toBeVisible();
    await expect(page.getByText('Aguardando domínio verificado')).toBeVisible();
    await expect(page.getByText('Nenhum administrador ativo ainda.')).toBeVisible();
    const inviteCard = page.getByTestId('invite-card');
    const overflow = await inviteCard.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    await context.close();
  });

  test('4. search, status filter, cursor pagination and the empty states (ROLE-05/empty)', async ({
    browser,
  }, testInfo) => {
    const slugs = slugsFor(testInfo.project.name);
    const s = suffixFor(testInfo.project.name);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    const painelName = `E2E Painel ${s}`;
    const modName = `Mod E2E ${s}`;
    const modSlug = slugs.mod;
    await ensureTenant(page, {
      name: painelName,
      slug: slugs.painel,
      email: `admin+${slugs.painel}@e2e.local`,
    });
    const modTenantId = await ensureTenant(page, {
      name: modName,
      slug: modSlug,
      email: `admin+${modSlug}@e2e.local`,
    });

    // ?q= is forwarded to the API: only the matching rows come back.
    await page.goto(`${hosts.platform}/plataforma?q=e2e-painel-`);
    await expect(page.getByRole('link', { name: `${painelName} (${slugs.painel})` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${modName} (${modSlug})` })).toHaveCount(0);

    // No match: the search-empty card while the toolbar keeps the query (filters preserved).
    await page.goto(`${hosts.platform}/plataforma?q=zzz-nao-existe`);
    await expect(page.getByText('Nenhum tenant encontrado')).toBeVisible();
    await expect(page.locator('#q')).toHaveValue('zzz-nao-existe');

    // Typing is debounced into the URL, then the row appears.
    await page.locator('#q').fill('e2e-mod');
    await page.waitForURL(/q=e2e-mod/);
    await expect(page.getByRole('link', { name: `${modName} (${modSlug})` })).toBeVisible();

    // Status filter: the suspended tenant is listed, rede-demo is not, the chip is current.
    await setStatus(page, modTenantId, 'suspended');
    await page.goto(`${hosts.platform}/plataforma?status=suspended`);
    const modRow = page.getByRole('link', { name: `${modName} (${modSlug})` });
    await expect(modRow).toBeVisible();
    await expect(visibleText(page, 'Suspenso')).toBeVisible();
    await expect(page.getByRole('link', { name: /Rede Demo \(rede-demo\)/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Suspensos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await setStatus(page, modTenantId, 'active');

    // Cursor pagination: one row per page, "Carregar mais" appends until nextCursor is null.
    await page.goto(`${hosts.platform}/plataforma?limit=1`);
    await expect(rowLinks(page)).toHaveCount(1);
    const more = page.getByRole('button', { name: 'Carregar mais' });
    await expect(more).toBeVisible();
    await more.click();
    await expect(rowLinks(page)).toHaveCount(2);
    for (let i = 0; i < 10 && (await more.count()) > 0; i += 1) {
      const before = await rowLinks(page).count();
      await more.click();
      await expect
        .poll(async () => (await rowLinks(page).count()) > before || (await more.count()) === 0)
        .toBe(true);
    }
    await expect(more).toHaveCount(0);

    await context.close();
  });

  test('5. two tenants with the same display name stay distinct by slug and id (ROLE-05/adjacency)', async ({
    browser,
  }, testInfo) => {
    const slugs = slugsFor(testInfo.project.name);
    const s = suffixFor(testInfo.project.name);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    const name = `Mesmo Nome E2E ${s}`;
    const slugA = slugs.a;
    const slugB = slugs.b;
    const idA = await createTenant(page, { name, slug: slugA, email: `a+${s}@e2e.local` });
    const idB = await createTenant(page, { name, slug: slugB, email: `b+${s}@e2e.local` });
    expect(idA).not.toBe(idB);

    await page.goto(`${hosts.platform}/plataforma?q=mesmo-nome-`);
    const rowA = page.getByRole('link', { name: `${name} (${slugA})` });
    const rowB = page.getByRole('link', { name: `${name} (${slugB})` });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveAttribute('href', `/plataforma/tenants/${idA}`);
    await expect(rowB).toHaveAttribute('href', `/plataforma/tenants/${idB}`);
    await expect(visibleText(page, slugA)).toBeVisible();
    await expect(visibleText(page, slugB)).toBeVisible();

    await context.close();
  });

  test('6. the five tabs render without clipping at 320 px (E13 backstop)', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'phone viewport only');
    const slugs = slugsFor(testInfo.project.name);
    const s = suffixFor(testInfo.project.name);
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 720 });
    await signInSuperAdmin(page);
    const tenantId = await ensureTenant(page, {
      name: `Mod E2E ${s}`,
      slug: slugs.mod,
      email: `admin+${slugs.mod}@e2e.local`,
    });
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);

    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    const widths = await tablist.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(widths.scrollWidth).toBeGreaterThanOrEqual(widths.clientWidth);
    for (const label of ['Marca', 'Módulos', 'Domínios', 'Admins', 'Status']) {
      const tab = page.getByRole('tab', { name: label });
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeVisible();
      const [tabBox, listBox] = await Promise.all([tab.boundingBox(), tablist.boundingBox()]);
      if (!tabBox || !listBox) throw new Error(`no box for ${label}`);
      expect(tabBox.x).toBeGreaterThanOrEqual(listBox.x - 1);
      expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
    }

    await context.close();
  });

  test('7. access refusals: anonymous, tenant host, member on the platform host, unknown id (D-21/D-23)', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    // (a) anonymous → /entrar (proxy.ts, untouched).
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`${hosts.platform}/plataforma`);
    await expect(anonPage).toHaveURL(/\/entrar$/);
    await anon.close();

    // (b) a member on a TENANT host: the panel does not exist there — 404 before any API call.
    const member = await browser.newContext();
    const memberPage = await member.newPage();
    await signIn(memberPage, hosts.demo, users.demoMember, SEED_PASSWORD);
    const response = await memberPage.goto(`${hosts.demo}/plataforma`);
    expect(response?.status()).toBe(404);
    await expect(memberPage.getByRole('heading', { level: 1, name: 'Tenants' })).toHaveCount(0);
    await member.close();

    // (c) a member on the PLATFORM host is signed out — whichever layer refuses first — and the
    //     panel never renders; no tenant is named.
    const stray = await browser.newContext();
    const strayPage = await stray.newPage();
    await signIn(strayPage, hosts.platform, users.demoMember, SEED_PASSWORD);
    await strayPage.goto(`${hosts.platform}/plataforma`);
    await expect(strayPage).toHaveURL(/\/(entrar|endereco-invalido)$/, { timeout: 30_000 });
    expect((await stray.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);
    const text = (await strayPage.locator('body').innerText()).toLowerCase();
    for (const secret of ['rede-demo', 'rede-lab']) expect(text).not.toContain(secret);
    await expect(strayPage.getByRole('heading', { level: 1, name: 'Tenants' })).toHaveCount(0);
    await stray.close();

    // (d) the super_admin with an unknown uuid or a non-uuid id: the in-panel not-found screen.
    const admin = await browser.newContext();
    const adminPage = await admin.newPage();
    await signInSuperAdmin(adminPage);
    for (const id of ['00000000-0000-4000-8000-000000000000', 'nao-e-um-id']) {
      await adminPage.goto(`${hosts.platform}/plataforma/tenants/${id}/status`);
      await expect(adminPage.getByText('Tenant não encontrado')).toBeVisible();
      await expect(adminPage.getByRole('link', { name: 'Voltar para a lista' })).toBeVisible();
    }
    await admin.close();
  });

  test('8. a platform account as the admin e-mail is refused as a field error (D-316)', async ({
    browser,
  }, testInfo) => {
    test.skip(isRemote, 'local stack only');
    const slugs = slugsFor(testInfo.project.name);
    const s = suffixFor(testInfo.project.name);
    // 08.1-06: a member of another tenant may be the first admin now (D-314); only a platform
    // account is refused. The API's 400 VALIDATION_FAILED { adminEmail: 'in_use' } becomes a field
    // error under #adminEmail, the form keeps every typed value and no tenant row is created.
    const inUse = SUPER_ADMIN_EMAIL;
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);

    await page.goto(`${hosts.platform}/plataforma/novo`);
    // The session draft is read back right after hydration: type only after it (the WR-03 flake).
    await expect(page.locator('form[data-draft-ready]')).toBeVisible();
    const alerts = page.locator('form').getByRole('alert');
    const name = `Recusado ${s}`;
    await page.locator('#displayName').fill(name);
    await page.locator('#slug').fill(slugs.refused);
    await page.locator('#adminEmail').fill(inUse);
    await refuseAtConfirmation(page);

    await expect(
      page.getByRole('alert').filter({ hasText: 'Este e-mail já possui uma conta na plataforma' }),
    ).toBeVisible();
    await expect(
      alerts.filter({
        hasText:
          'Este e-mail já possui uma conta na plataforma. Use outro e-mail para o primeiro administrador.',
      }),
    ).toHaveCount(1);
    await expect(page).toHaveURL(`${hosts.platform}/plataforma/novo`);
    await expect(page.locator('#displayName')).toHaveValue(name);
    await expect(page.locator('#slug')).toHaveValue(slugs.refused);
    await expect(page.locator('#adminEmail')).toHaveValue(inUse);
    expect(await getTenantModuleFlag(slugs.refused, 'feed')).toBeNull();

    await context.close();
  });
});
