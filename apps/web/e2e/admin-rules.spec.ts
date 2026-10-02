import { type Browser, expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { closeAdmin } from './admin';
import { isRemote, login } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  type MembersTenant,
  membersTenantSlug,
  sweepMembersTenants,
} from './members-admin';
import { closeTenantFixtures } from './tenant-fixtures';

/**
 * 08-07 — the community rules on the tenant lane (ADMIN-03, D-341, UI-D-280/281): the admin edits
 * the rules from Configurações → Regras da comunidade, previews them exactly as `/cadastro` shows
 * them, and the next sign-up accepts the new text at the new version.
 *
 * The subject is a THROWAWAY community with its own admin (`createMembersTenant(…, 0)`, the 08-06
 * precedent), never a seed tenant: other specs and suites read rede-demo's rules and present its
 * version 1 as the current one, so a version bump there would leak into them. The API integration
 * suite (`admin-rules.test.ts`) proves the same flow on `admin@rede-demo.local` itself and restores
 * the seed afterwards. Each project gets its own tenant and host, unique per run (`membersTenantSlug`:
 * the host caches never point a new run at a deleted tenant). `/cadastro` on that host is the tenant's
 * own public sign-up (the proxy rewrites it to `/cadastro/{slug}`).
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.skip(isRemote, 'local stack only');

const PREFIX = 'regr';
let tenant: MembersTenant;

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

async function storedRules(slug: string): Promise<{ text: string; version: number }> {
  const [row] = await sql()<{ rules_text: string; rules_version: number }[]>`
    select rules_text, rules_version from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`no tenant ${slug}`);
  return { text: row.rules_text, version: row.rules_version };
}

async function tenantRulesConsentVersion(email: string): Promise<number | null> {
  const [row] = await sql()<{ text_version: number }[]>`
    select c.text_version from public.consent_records c
      join public.users u on u.id = c.user_id
     where u.email = ${email} and c.kind = 'tenant_rules'`;
  return row?.text_version ?? null;
}

/**
 * After a full navigation the textarea exists before React hydrated it; a fill dispatched in that
 * window is lost. React tags hydrated DOM nodes with its internal props key (the 02-14 probe).
 */
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps'));
    },
    selector,
    { timeout: 30_000 },
  );
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Salvar regras', exact: true });
}

/** The tenant's `/cadastro` in a signed-out context: returns the page with the rules sheet open. */
async function openSignupRules(
  browser: Browser,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${tenant.origin}/cadastro`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta');
  await page.getByRole('button', { name: 'ver regras' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return { page, close: () => context.close() };
}

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  await sweepMembersTenants(
    `${PREFIX}-${testInfo.project.name.replace(/[^a-z0-9]/g, '').slice(0, 10)}`,
  );
  tenant = await createMembersTenant(
    membersTenantSlug(PREFIX, testInfo.project.name),
    'Segredo123',
    0,
  );
});

test.afterAll(async () => {
  if (tenant) await deleteMembersTenant(tenant.slug);
  await client?.end();
  client = null;
  await closeAdmin();
  await closeMembersAdmin();
  await closeTenantFixtures();
});

test.describe('08-07 — Regras da comunidade', () => {
  test('rules tracer: the admin saves new rules and the next sign-up reads and accepts them at the new version', async ({
    page,
    browser,
  }) => {
    const run = Date.now().toString(36);
    const marker = `Regra nova ${run}: trate todos com respeito.`;
    const before = await storedRules(tenant.slug);

    await login(page, tenant.admin.email, tenant.password, tenant.origin);

    // D-339: the row sits in the Administração group and opens the full screen.
    await page.goto(`${tenant.origin}/configuracoes`);
    const row = page.getByRole('link', { name: 'Regras da comunidade', exact: true });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(`${tenant.origin}/configuracoes/regras`);
    await waitForHydration(page, '#rulesText');

    await expect(page.getByText(`Versão ${before.version} em vigor`)).toBeVisible();
    // Unchanged text cannot be saved (D-341: no empty version bump from the UI).
    await expect(saveButton(page)).toBeDisabled();

    await page.locator('#rulesText').fill(`${marker}\n\nSegundo parágrafo ${run}.`);
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();

    await expect(
      page.getByText('Regras salvas. Valem para quem entrar a partir de agora.').first(),
    ).toBeVisible();
    await expect(page.getByText(`Versão ${before.version + 1} em vigor`)).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    expect(await storedRules(tenant.slug)).toEqual({
      text: `${marker}\n\nSegundo parágrafo ${run}.`,
      version: before.version + 1,
    });

    // A visitor on the tenant's /cadastro reads the new text in the rules sheet, then signs up.
    const visitor = await openSignupRules(browser);
    try {
      await expect(visitor.page.getByRole('dialog')).toContainText(marker);
      await visitor.page.getByRole('button', { name: 'Fechar' }).click();
      const email = `novo-${run}@${tenant.slug}.local`;
      await visitor.page.locator('#name').fill('Pessoa Nova');
      await visitor.page.locator('#email').fill(email);
      await visitor.page.locator('#password').fill('Segredo123');
      await visitor.page.locator('#acceptRules').check();
      await visitor.page.locator('#acceptTerms').check();
      await visitor.page.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(visitor.page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
      expect(await tenantRulesConsentVersion(email)).toBe(before.version + 1);
    } finally {
      await visitor.close();
    }
  });
});
